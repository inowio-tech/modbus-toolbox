//! Modbus TCP **server** ("TCP Simulator"): exposes configured registers so
//! external masters can poll/write the app as one or more virtual devices.
//!
//! Layer 1 (this module): in-memory banks per Unit ID, a tokio-modbus TCP
//! server task, Hold registers, register CRUD, Start/Stop. Generators, rules,
//! route-from-slave, and device templates arrive in later plans.

#![allow(dead_code)] // trimmed as later tasks consume these items

use std::collections::HashMap;
use std::future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::task::{Context, Poll};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio_modbus::prelude::*;
use tokio_modbus::server::tcp::{accept_tcp_connection, Server};
use tokio_modbus::server::Service;

/// Number of 16-bit words a data type occupies (1-, 2- and 4-word types).
pub fn word_count(data_type: &str) -> usize {
    match data_type {
        "u64" | "i64" | "f64" => 4,
        "u32" | "i32" | "f32" => 2,
        _ => 1, // bool/u16/i16
    }
}

fn swap_bytes_word(w: u16) -> u16 {
    (w << 8) | (w >> 8)
}

/// Big-endian bytes of the value for the given type. Integer casts saturate
/// (Rust float→int semantics); precision beyond 2^53 is lossy for u64/i64 —
/// acceptable for simulated values.
fn value_to_be_bytes(data_type: &str, value: f64) -> Result<Vec<u8>, String> {
    match data_type {
        "u16" => Ok(((value as i64) as u16).to_be_bytes().to_vec()),
        "i16" => Ok(((value as i64) as i16).to_be_bytes().to_vec()),
        "u32" => Ok(((value as i64) as u32).to_be_bytes().to_vec()),
        "i32" => Ok(((value as i64) as i32).to_be_bytes().to_vec()),
        "f32" => Ok((value as f32).to_be_bytes().to_vec()),
        "u64" => Ok((value as u64).to_be_bytes().to_vec()),
        "i64" => Ok((value as i64).to_be_bytes().to_vec()),
        "f64" => Ok(value.to_be_bytes().to_vec()),
        other => Err(format!("unsupported simulator data type '{other}'")),
    }
}

/// The byte-order tokens understood by the codec; anything else falls back to
/// `ABCD`. Mirrors `KNOWN_ORDERS` in `src/screen2/utils/modbusValueCodec.ts`.
fn normalize_order(order: &str) -> String {
    let o = order.trim().to_uppercase();
    const KNOWN: [&str; 8] = [
        "ABCD", "BADC", "CDAB", "DCBA",
        "HALF_SWAP", "HALF_SWAP_BS", "INTRA_HALF_SWAP", "INTRA_HALF_SWAP_BS",
    ];
    if o.is_empty() || !KNOWN.contains(&o.as_str()) { "ABCD".to_string() } else { o }
}

fn is_byte_swap_order(o: &str) -> bool {
    matches!(o, "BADC" | "DCBA" | "HALF_SWAP_BS" | "INTRA_HALF_SWAP_BS")
}

/// Reorder words for the given (normalized) byte order. 1-word types are a
/// no-op for every order (forgiving, like the frontend codec). Mirrors
/// `applyOrderWords` in `modbusValueCodec.ts`.
fn apply_order_words(words: &[u16], order: &str) -> Vec<u16> {
    match words.len() {
        2 => match order {
            "CDAB" | "DCBA" => vec![words[1], words[0]],
            _ => vec![words[0], words[1]],
        },
        4 => match order {
            "CDAB" | "DCBA" => vec![words[3], words[2], words[1], words[0]],
            "HALF_SWAP" | "HALF_SWAP_BS" => vec![words[2], words[3], words[0], words[1]],
            "INTRA_HALF_SWAP" | "INTRA_HALF_SWAP_BS" => vec![words[1], words[0], words[3], words[2]],
            _ => vec![words[0], words[1], words[2], words[3]],
        },
        _ => words.to_vec(),
    }
}

/// Encode a numeric value into Modbus words in address order, honoring byte
/// order. Canonical = big-endian words; byte-swap first (BADC/DCBA/*_BS), then
/// word-reorder. Mirrors `encodeWriteWordsInAddressOrder` in
/// `src/screen2/utils/modbusValueCodec.ts`, including 4-word types and the
/// HALF_SWAP orders. Only an unknown data type errors; an order that doesn't
/// apply to the type's width is a silent no-op (matches the frontend).
pub fn encode_value(data_type: &str, byte_order: &str, value: f64) -> Result<Vec<u16>, String> {
    let bytes = value_to_be_bytes(data_type, value)?;
    let words: Vec<u16> = bytes
        .chunks(2)
        .map(|c| ((c[0] as u16) << 8) | (c[1] as u16))
        .collect();
    let order = normalize_order(byte_order);
    let ordered: Vec<u16> = if is_byte_swap_order(&order) {
        words.iter().map(|w| swap_bytes_word(*w)).collect()
    } else {
        words
    };
    Ok(apply_order_words(&ordered, &order))
}

/// Decode Modbus words (in address order) back into a numeric value, the
/// inverse of `encode_value`. Used by route-from-slave to apply scale/offset to
/// a source value before re-encoding in the sim register's own order. Mirrors
/// `decodeWordsInAddressOrder` in `modbusValueCodec.ts`.
pub fn decode_value(data_type: &str, byte_order: &str, words: &[u16]) -> Option<f64> {
    let wc = word_count(data_type);
    if words.len() < wc { return None; }
    let words = &words[..wc];
    let order = normalize_order(byte_order);
    // Inverse of encode: undo word-reorder, then undo the byte-swap.
    let unordered = apply_order_words(words, &order);
    let canonical: Vec<u16> = if is_byte_swap_order(&order) {
        unordered.iter().map(|w| swap_bytes_word(*w)).collect()
    } else {
        unordered
    };
    let mut bytes = Vec::with_capacity(canonical.len() * 2);
    for w in &canonical {
        bytes.push((w >> 8) as u8);
        bytes.push((w & 0xff) as u8);
    }
    let val = match data_type {
        "u16" => u16::from_be_bytes([bytes[0], bytes[1]]) as f64,
        "i16" => i16::from_be_bytes([bytes[0], bytes[1]]) as f64,
        "u32" => u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f64,
        "i32" => i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f64,
        "f32" => f32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f64,
        "u64" => u64::from_be_bytes(bytes[..8].try_into().ok()?) as f64,
        "i64" => i64::from_be_bytes(bytes[..8].try_into().ok()?) as f64,
        "f64" => f64::from_be_bytes(bytes[..8].try_into().ok()?),
        _ => return None,
    };
    Some(val)
}

use std::f64::consts::PI;

#[derive(Debug, Clone, Copy)]
pub struct GenParams {
    pub min: f64,
    pub max: f64,
    pub period_ms: f64,
}

/// Deterministic value in [0,1) from a 64-bit seed (SplitMix64 finalizer).
fn unit_random(seed: u64) -> f64 {
    let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}

pub fn generator_value(kind: &str, p: &GenParams, elapsed_ms: f64, seed: u64) -> f64 {
    let span = p.max - p.min;
    let period = if p.period_ms <= 0.0 { 1000.0 } else { p.period_ms };
    match kind {
        "sine" => {
            let mid = p.min + span / 2.0;
            mid + (span / 2.0) * (2.0 * PI * elapsed_ms / period).sin()
        }
        "ramp" => {
            let frac = (elapsed_ms % period) / period;
            p.min + span * frac
        }
        // Continuous sawtooth downward: max → min each period (the mirror of ramp).
        "decrement" => {
            let frac = (elapsed_ms % period) / period;
            p.max - span * frac
        }
        // Integer staircase: +1 whole unit per period, wrapping across the band
        // (min, min+1, …, max, min, …). Advances in discrete steps rather than
        // ramp's continuous slope.
        "step" => {
            let steps = span.max(1.0);
            p.min + ((elapsed_ms / period).floor() % (steps + 1.0))
        }
        "random" => p.min + span * unit_random(seed),
        "toggle" => {
            if (elapsed_ms % period) < period / 2.0 {
                p.max
            } else {
                p.min
            }
        }
        _ => p.min,
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PresetParams {
    pub min: f64,
    pub max: f64,
    pub period_ms: f64,
}

pub fn preset_value(preset: &str, p: &PresetParams, elapsed_ms: f64, seed: u64) -> f64 {
    let span = p.max - p.min;
    let period = if p.period_ms <= 0.0 { 60000.0 } else { p.period_ms };
    let clamp = |v: f64| v.max(p.min).min(p.max);
    // Per-register phase offset (a deterministic fraction of the period from the
    // seed) so two registers with the SAME preset+params don't move in lockstep.
    let e = elapsed_ms + unit_random(seed) * period;
    // deterministic small wobble within the band, amplitude ~2% of span
    let wobble = |amp: f64, fast: f64| (span * amp) * (2.0 * PI * e / fast).sin();
    match preset {
        // slow drift across the band + small noise
        "temperature" | "humidity" | "pressure" | "flow" | "analog" => {
            let mid = p.min + span / 2.0;
            clamp(mid + (span / 2.0 * 0.8) * (2.0 * PI * e / period).sin() + wobble(0.02, period / 13.0))
        }
        // higher-frequency noisy signal
        "vibration" => {
            let mid = p.min + span / 2.0;
            clamp(mid + (span / 2.0 * 0.5) * (2.0 * PI * e / (period / 20.0)).sin() + wobble(0.1, period / 47.0))
        }
        // on/off by half period
        "discrete" => {
            if (e % period) < period / 2.0 { p.max } else { p.min }
        }
        // monotonic within [min,max], wraps at max — NOT phase-shifted (a
        // counter is monotonic by definition); uses the raw elapsed time.
        "counter" => {
            let step_per_period = span.max(1.0);
            p.min + ((elapsed_ms / period) * step_per_period) % span.max(1.0)
        }
        _ => p.min + span / 2.0,
    }
}

/// Transform raw source words read from a routed slave into the words this
/// register exposes. Fast path (identity scale/offset AND matching byte order)
/// mirrors the source verbatim. Otherwise: decode the source words with
/// `src_byte_order`, apply `value * scale + offset`, and re-encode with the
/// register's own `data_type`/`byte_order`. Any decode/encode failure falls
/// back to the raw words so the register never goes dark.
pub fn transform_route_words(
    d: &DynReg,
    words: &[u16],
    scale: f64,
    offset: f64,
    src_byte_order: &str,
) -> Vec<u16> {
    let identity = scale == 1.0 && offset == 0.0
        && src_byte_order.trim().eq_ignore_ascii_case(d.byte_order.trim());
    if identity {
        return words.to_vec();
    }
    match decode_value(&d.data_type, src_byte_order, words) {
        Some(v) => encode_value(&d.data_type, &d.byte_order, v * scale + offset)
            .unwrap_or_else(|_| words.to_vec()),
        None => words.to_vec(),
    }
}

/// Dynamic (device/generator) register resolved from a `SimRegister`'s
/// `value_source` + `source_params`. `None` from `parse_dynamic` for hold
/// registers (Plan 1 behavior) or unparseable params.
#[derive(Debug, Clone)]
pub enum DynKind {
    Generator { kind: String, params: GenParams, seed: u64 },
    Preset { preset: String, params: PresetParams, seed: u64 },
    Route {
        slave_unit: u8,
        connection_kind: String,
        src_fc: u8,
        src_addr: u16,
        count: u16,
        /// Linear transform applied to the decoded source value before it is
        /// re-encoded into this register: `exposed = source * scale + offset`.
        scale: f64,
        offset: f64,
        /// Byte order the SOURCE value is decoded with. When it equals the
        /// register's own `byte_order` and scale/offset are identity, the tick
        /// takes a fast path and mirrors the raw words verbatim.
        src_byte_order: String,
    },
}

#[derive(Debug, Clone)]
pub struct DynReg {
    pub unit: u8,
    pub bank: u8,
    pub address: u16,
    pub data_type: String,
    pub byte_order: String,
    pub kind: DynKind,
    pub interval_ms: f64,
}

fn json_f64(v: &serde_json::Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(|x| x.as_f64()).unwrap_or(default)
}

/// Parse a `SimRegister` into a `DynReg` for `value_source` `"generator"`/`"device"`.
/// Returns `None` for `"hold"` (and any other/unrecognized source) or when
/// `source_params` isn't valid JSON.
pub fn parse_dynamic(reg: &SimRegister) -> Option<DynReg> {
    let v: serde_json::Value = serde_json::from_str(&reg.source_params).ok()?;
    let interval_ms = if reg.interval_ms > 0 { reg.interval_ms as f64 } else { 1000.0 };
    let seed = ((reg.unit_id as u64) << 32) ^ (reg.function_code as u64) << 16 ^ (reg.address as u64);
    let common = (json_f64(&v, "min", 0.0), json_f64(&v, "max", 100.0), json_f64(&v, "periodMs", 1000.0));
    let kind = match reg.value_source.as_str() {
        "generator" => DynKind::Generator {
            kind: v.get("kind").and_then(|x| x.as_str()).unwrap_or("sine").to_string(),
            params: GenParams { min: common.0, max: common.1, period_ms: common.2 },
            seed,
        },
        "device" => DynKind::Preset {
            preset: v.get("preset").and_then(|x| x.as_str()).unwrap_or("analog").to_string(),
            params: PresetParams { min: common.0, max: common.1, period_ms: common.2 },
            seed,
        },
        "route" => DynKind::Route {
            slave_unit: v.get("slaveUnitId").and_then(|x| x.as_u64()).unwrap_or(1) as u8,
            connection_kind: v.get("connectionKind").and_then(|x| x.as_str()).unwrap_or("tcp").to_string(),
            src_fc: v.get("functionCode").and_then(|x| x.as_u64()).unwrap_or(3) as u8,
            src_addr: v.get("address").and_then(|x| x.as_u64()).unwrap_or(0) as u16,
            count: word_count(&reg.data_type) as u16,
            scale: json_f64(&v, "scale", 1.0),
            offset: json_f64(&v, "offset", 0.0),
            src_byte_order: v
                .get("srcByteOrder")
                .and_then(|x| x.as_str())
                .unwrap_or(&reg.byte_order)
                .to_string(),
        },
        _ => return None,
    };
    Some(DynReg {
        unit: reg.unit_id as u8, bank: reg.function_code as u8, address: reg.address as u16,
        data_type: reg.data_type.clone(), byte_order: reg.byte_order.clone(), kind, interval_ms,
    })
}

/// Compute the live value of a dynamic register at `elapsed_ms` since the
/// simulator started.
pub fn dyn_value(d: &DynReg, elapsed_ms: f64) -> f64 {
    match &d.kind {
        DynKind::Generator { kind, params, seed } => {
            // vary the random seed with time so successive ticks differ
            generator_value(kind, params, elapsed_ms, seed ^ (elapsed_ms as u64))
        }
        DynKind::Preset { preset, params, seed } => preset_value(preset, params, elapsed_ms, *seed),
        // Route registers are populated by the tick's routed network read
        // (Task 4), not by `dyn_value`; this arm only exists to keep the
        // match exhaustive.
        DynKind::Route { .. } => 0.0,
    }
}

/// Write `words` at consecutive addresses starting at `address`, in the bank
/// selected by Modbus function code (1=coils, 2=discrete inputs, 3=holding,
/// 4=input). Bit banks store a word as `!= 0`.
pub fn place_words(banks: &mut HashMap<u8, SimBanks>, unit: u8, bank: u8, address: u16, words: &[u16]) {
    let b = banks.entry(unit).or_default();
    for (i, &w) in words.iter().enumerate() {
        let addr = address.wrapping_add(i as u16);
        match bank {
            1 => { b.coils.insert(addr, w != 0); }
            2 => { b.discrete_inputs.insert(addr, w != 0); }
            3 => { b.holding.insert(addr, w); }
            4 => { b.input.insert(addr, w); }
            _ => {}
        }
    }
}

type Banks = Arc<RwLock<HashMap<u8, SimBanks>>>;

/// Per-register source status for route-from-slave registers, keyed by
/// (unit, bank/function-code, address); values `"ok"`/`"stale"`/`"missing"`.
/// Not present in the map for non-route registers (snapshot rows default to
/// `None` in that case).
type StatusMap = Arc<Mutex<HashMap<(u8, u8, u16), &'static str>>>;

/// Wall-clock epoch milliseconds (for uptime + event/connection timestamps).
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A currently-connected client, surfaced in the Clients list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub id: u64,
    pub addr: String,
    pub connected_at_ms: u64,
}

/// A logged simulator event (server lifecycle + client connect/disconnect).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimEvent {
    pub at_ms: u64,
    /// `"started"` | `"stopped"` | `"clientConnected"` | `"clientDisconnected"`.
    pub kind: String,
    pub detail: String,
}

const MAX_EVENTS: usize = 200;

/// Shared observability state: the live client registry + a bounded event ring,
/// updated as clients connect/drop and the server starts/stops. Persists across
/// Start/Stop cycles (the event ring is history) — cleared only of live clients
/// on Stop.
#[derive(Default)]
struct ObserverInner {
    clients: HashMap<u64, ClientInfo>,
    events: std::collections::VecDeque<SimEvent>,
    next_id: u64,
}

impl ObserverInner {
    fn log(&mut self, kind: &str, detail: String) {
        self.events.push_back(SimEvent { at_ms: now_ms(), kind: kind.to_string(), detail });
        while self.events.len() > MAX_EVENTS {
            self.events.pop_front();
        }
    }
}

type Observer = Arc<Mutex<ObserverInner>>;

/// Wraps a `TcpStream` and increments/decrements the shared `clients` counter
/// (so `SimEngine::client_count()` reflects active open connections) and
/// registers/deregisters the connection in the `Observer` (Clients list + a
/// connect/disconnect event).
struct CountedStream {
    inner: tokio::net::TcpStream,
    clients: Arc<AtomicUsize>,
    observer: Observer,
    id: u64,
}

impl CountedStream {
    fn new(inner: tokio::net::TcpStream, clients: Arc<AtomicUsize>, observer: Observer, addr: SocketAddr) -> Self {
        clients.fetch_add(1, Ordering::Relaxed);
        let mut id = 0;
        if let Ok(mut o) = observer.lock() {
            o.next_id += 1;
            id = o.next_id;
            o.clients.insert(id, ClientInfo { id, addr: addr.to_string(), connected_at_ms: now_ms() });
            o.log("clientConnected", addr.to_string());
        }
        Self { inner, clients, observer, id }
    }
}

impl Drop for CountedStream {
    fn drop(&mut self) {
        self.clients.fetch_sub(1, Ordering::Relaxed);
        if let Ok(mut o) = self.observer.lock() {
            let addr = o.clients.remove(&self.id).map(|c| c.addr).unwrap_or_default();
            o.log("clientDisconnected", addr);
        }
    }
}

impl AsyncRead for CountedStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for CountedStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[std::io::IoSlice<'_>],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write_vectored(cx, bufs)
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }
}

// Safety: CountedStream is Unpin because TcpStream is Unpin.
impl Unpin for CountedStream {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenInfo {
    pub bound: String,
    pub port: u16,
    pub addresses: Vec<String>,
}

#[derive(Clone)]
struct SimService {
    banks: Banks,
    clients: Arc<AtomicUsize>,
    /// Client-write events `(unit, bank, address)`, drained by the tick task
    /// each interval so `onWrite` rules can react. Bank is the FC's bank: coil
    /// writes → 1, register writes → 3.
    writes: Arc<Mutex<Vec<(u8, u8, u16)>>>,
}

impl Service for SimService {
    type Request = SlaveRequest<'static>;
    type Response = Response;
    type Exception = ExceptionCode;
    type Future = future::Ready<Result<Response, ExceptionCode>>;

    fn call(&self, req: SlaveRequest<'static>) -> Self::Future {
        let unit = req.slave;
        future::ready(self.handle(unit, req.request))
    }
}

impl SimService {
    fn handle(&self, unit: u8, req: Request<'static>) -> Result<Response, ExceptionCode> {
        let mut banks = self.banks.write().map_err(|_| ExceptionCode::ServerDeviceFailure)?;
        let bank = banks.get_mut(&unit).ok_or(ExceptionCode::IllegalDataAddress)?;
        match req {
            Request::ReadCoils(a, c) => Ok(Response::ReadCoils(bank.read_coils(a, c)?)),
            Request::ReadDiscreteInputs(a, c) => {
                Ok(Response::ReadDiscreteInputs(bank.read_discrete_inputs(a, c)?))
            }
            Request::ReadHoldingRegisters(a, c) => {
                Ok(Response::ReadHoldingRegisters(bank.read_holding(a, c)?))
            }
            Request::ReadInputRegisters(a, c) => {
                Ok(Response::ReadInputRegisters(bank.read_input(a, c)?))
            }
            Request::WriteSingleCoil(a, v) => {
                bank.write_single_coil(a, v)?;
                self.push_write(unit, 1, a);
                Ok(Response::WriteSingleCoil(a, v))
            }
            Request::WriteSingleRegister(a, v) => {
                bank.write_single_register(a, v)?;
                self.push_write(unit, 3, a);
                Ok(Response::WriteSingleRegister(a, v))
            }
            Request::WriteMultipleCoils(a, vals) => {
                bank.write_multiple_coils(a, &vals)?;
                self.push_write(unit, 1, a);
                Ok(Response::WriteMultipleCoils(a, vals.len() as u16))
            }
            Request::WriteMultipleRegisters(a, vals) => {
                bank.write_multiple_registers(a, &vals)?;
                self.push_write(unit, 3, a);
                Ok(Response::WriteMultipleRegisters(a, vals.len() as u16))
            }
            _ => Err(ExceptionCode::IllegalFunction),
        }
    }

    /// Record a successful client write's target for `onWrite` rules to see
    /// on the next tick drain. Best-effort: a poisoned lock silently drops
    /// the event rather than failing the client's write response.
    fn push_write(&self, unit: u8, bank: u8, address: u16) {
        if let Ok(mut w) = self.writes.lock() {
            w.push((unit, bank, address));
        }
    }
}

/// Abstraction over "can emit the `simulator_values` event", so
/// `SimEngine::start`'s tick task doesn't need a live `tauri::AppHandle` to be
/// exercised in tests. Blanket-implemented for any real `tauri::AppHandle<R>`;
/// tests use a plain no-op/recording sink instead of `tauri::test::mock_app()`
/// (its `MockRuntime` still links real wry/tao/webview2-com natively, which
/// reproducibly crashes the test binary at process load with
/// `STATUS_ENTRYPOINT_NOT_FOUND` on this machine even after a full clean
/// rebuild — see Task 6 report for details).
pub trait ValuesSink: Send + 'static {
    fn emit_values(&self, event: SimValuesEvent);
}

impl<R: tauri::Runtime> ValuesSink for tauri::AppHandle<R> {
    fn emit_values(&self, event: SimValuesEvent) {
        let _ = self.emit("simulator_values", event);
    }
}

/// Minimum interval between `simulator_values` pushes to the UI. Values still
/// animate at each register's own interval; this only caps the display refresh.
const EMIT_INTERVAL_MS: f64 = 100.0;

#[derive(Default)]
pub struct SimEngine {
    banks: Option<Banks>,
    clients: Arc<AtomicUsize>,
    shutdown: Option<oneshot::Sender<()>>,
    handle: Option<JoinHandle<()>>,
    tick_shutdown: Option<oneshot::Sender<()>>,
    tick_handle: Option<JoinHandle<()>>,
    statuses: StatusMap,
    // Live generator/route + rule lists the tick reads each iteration. Held
    // behind a shared lock so mutations (add/edit/delete register, rule, or
    // device) take effect immediately without a Stop/Start.
    dynamics: Arc<Mutex<Vec<DynReg>>>,
    rules: Arc<Mutex<Vec<RuleDef>>>,
    // Observability: live client registry + event ring, and the wall-clock
    // start time (for uptime). `observer` persists across Start/Stop so the
    // event log is history; `started_at_ms` is set on Start, cleared on Stop.
    observer: Observer,
    started_at_ms: Option<u64>,
}

impl SimEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_running(&self) -> bool {
        self.handle.is_some()
    }

    pub fn client_count(&self) -> usize {
        self.clients.load(Ordering::Relaxed)
    }

    /// Currently-connected clients, oldest first.
    pub fn client_list(&self) -> Vec<ClientInfo> {
        let mut v: Vec<ClientInfo> = self
            .observer
            .lock()
            .map(|o| o.clients.values().cloned().collect())
            .unwrap_or_default();
        v.sort_by_key(|c| c.connected_at_ms);
        v
    }

    /// The event ring (oldest first).
    pub fn events(&self) -> Vec<SimEvent> {
        self.observer.lock().map(|o| o.events.iter().cloned().collect()).unwrap_or_default()
    }

    /// Wall-clock start time in epoch ms while running, else `None`.
    pub fn started_at_ms(&self) -> Option<u64> {
        self.started_at_ms
    }

    pub fn snapshot(&self) -> HashMap<u8, SimBanks> {
        self.banks
            .as_ref()
            .and_then(|b| b.read().ok().map(|g| g.clone()))
            .unwrap_or_default()
    }

    /// Snapshot of per-register route source statuses (unit, bank, address) →
    /// `"ok"`/`"stale"`/`"missing"`. Empty when the simulator isn't running or
    /// no route registers have ticked yet.
    pub fn statuses(&self) -> HashMap<(u8, u8, u16), &'static str> {
        self.statuses.lock().ok().map(|g| g.clone()).unwrap_or_default()
    }

    /// Upsert (Some) or remove (None) a single configured address in the live banks.
    pub fn apply_register_change(
        &self,
        unit: u8,
        bank: u8,
        addr: u16,
        value_word: Option<u16>,
        value_bit: Option<bool>,
    ) {
        let Some(banks) = self.banks.as_ref() else { return };
        let Ok(mut guard) = banks.write() else { return };
        let entry = guard.entry(unit).or_default();
        match bank {
            1 => set_bit(&mut entry.coils, addr, value_bit),
            2 => set_bit(&mut entry.discrete_inputs, addr, value_bit),
            3 => set_word(&mut entry.holding, addr, value_word),
            4 => set_word(&mut entry.input, addr, value_word),
            _ => {}
        }
    }

    /// Upsert consecutive words at `address` (device/generator registers span
    /// multiple addresses); mirrors `place_words`' bank routing.
    pub fn apply_words(&self, unit: u8, bank: u8, address: u16, words: &[u16]) {
        let Some(banks) = self.banks.as_ref() else { return };
        let Ok(mut guard) = banks.write() else { return };
        place_words(&mut guard, unit, bank, address, words);
    }

    /// Remove `count` consecutive configured addresses starting at `address`
    /// from the given bank (1=coils, 2=discrete inputs, 3=holding, 4=input).
    pub fn clear_span(&self, unit: u8, bank: u8, address: u16, count: u16) {
        let Some(banks) = self.banks.as_ref() else { return };
        let Ok(mut guard) = banks.write() else { return };
        let entry = guard.entry(unit).or_default();
        for i in 0..count {
            let addr = address.wrapping_add(i);
            match bank {
                1 => { entry.coils.remove(&addr); }
                2 => { entry.discrete_inputs.remove(&addr); }
                3 => { entry.holding.remove(&addr); }
                4 => { entry.input.remove(&addr); }
                _ => {}
            }
        }
    }

    /// Replace the live generator/route list the tick animates. Takes effect on
    /// the next tick — no Stop/Start needed.
    pub fn set_dynamics(&self, dynamics: Vec<DynReg>) {
        if let Ok(mut g) = self.dynamics.lock() {
            *g = dynamics;
        }
    }

    /// Replace the live rule list the tick evaluates (sorted by priority).
    pub fn set_rules(&self, mut rules: Vec<RuleDef>) {
        rules.sort_by_key(|r| r.sort_order);
        if let Ok(mut g) = self.rules.lock() {
            *g = rules;
        }
    }

    pub async fn start<S: ValuesSink>(
        &mut self,
        app: S,
        workspace: String,
        host: &str,
        port: u16,
        tick_ms: u64,
        initial: HashMap<u8, SimBanks>,
        dynamics: Vec<DynReg>,
        tcp_sessions: crate::modbus::SessionMap,
        rtu_sessions: crate::modbus::SessionMap,
        rules: Vec<RuleDef>,
    ) -> Result<ListenInfo, String> {
        if self.is_running() {
            return Err("simulator already running".to_string());
        }
        let addr: SocketAddr = format!("{host}:{port}")
            .parse()
            .map_err(|e| format!("invalid bind address {host}:{port}: {e}"))?;
        let listener = TcpListener::bind(addr)
            .await
            .map_err(|e| format!("failed to bind {host}:{port}: {e}"))?;
        let bound = listener.local_addr().map_err(|e| e.to_string())?;

        let banks: Banks = Arc::new(RwLock::new(initial));
        self.banks = Some(banks.clone());
        self.clients.store(0, Ordering::Relaxed);
        self.started_at_ms = Some(now_ms());
        if let Ok(mut o) = self.observer.lock() {
            o.clients.clear();
            o.log("started", bound.to_string());
        }

        // Client-write events, pushed by `SimService::handle` on every
        // successful write and drained by the tick task each interval so
        // `onWrite` rules can react to them.
        let writes: Arc<Mutex<Vec<(u8, u8, u16)>>> = Arc::new(Mutex::new(Vec::new()));

        let clients_arc = self.clients.clone();
        let observer_arc = self.observer.clone();
        let service = SimService { banks: banks.clone(), clients: self.clients.clone(), writes: writes.clone() };
        let server = Server::new(listener);
        let new_service = move |_addr: SocketAddr| Ok(Some(service.clone()));
        let on_connected = move |stream, socket_addr| {
            let new_service = new_service.clone();
            let clients = clients_arc.clone();
            let observer = observer_arc.clone();
            async move {
                accept_tcp_connection(stream, socket_addr, new_service)
                    .map(|opt| opt.map(|(svc, tcp)| (svc, CountedStream::new(tcp, clients, observer, socket_addr))))
            }
        };
        let on_error = |err| log::error!("simulator server error: {err}");

        let (tx, rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            let _ = server
                .serve_until(&on_connected, on_error, async {
                    let _ = rx.await;
                })
                .await;
        });
        self.shutdown = Some(tx);
        self.handle = Some(handle);

        // Interval tick task: recomputes device/generator registers and pushes
        // live values via the `simulator_values` event. Never holds the banks
        // write lock across an `.await`.
        let statuses: StatusMap = Arc::new(Mutex::new(HashMap::new()));
        self.statuses = statuses.clone();

        // Store the generator/rule lists behind shared locks so mutations while
        // running take effect on the next tick (no Stop/Start).
        let dynamics_arc: Arc<Mutex<Vec<DynReg>>> = Arc::new(Mutex::new(dynamics));
        self.dynamics = dynamics_arc.clone();
        let rules_arc: Arc<Mutex<Vec<RuleDef>>> = Arc::new(Mutex::new(rules));
        self.rules = rules_arc.clone();

        let (tick_tx, mut tick_rx) = oneshot::channel::<()>();
        let tick_banks = banks.clone();
        let tick_statuses = statuses.clone();
        let tick_writes = writes.clone();
        let tick_dynamics = dynamics_arc.clone();
        let tick_rules = rules_arc.clone();
        let tick_handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(tick_ms.max(10)));
            let start = std::time::Instant::now();
            // Per-register next-due time keyed by (unit, bank, address) so the
            // list can change under us (add/remove) without misaligning timing.
            let mut next_due: HashMap<(u8, u8, u16), f64> = HashMap::new();
            let mut last_emit = 0.0f64;
            let mut rule_states: HashMap<i64, RuleState> = HashMap::new();
            // Actions whose rule fired but whose per-action delay hasn't elapsed
            // yet: (due_ms, action, rng_seed). Drained each tick when due.
            let mut pending_actions: Vec<(f64, TimedAction, u64)> = Vec::new();
            loop {
                tokio::select! {
                    _ = &mut tick_rx => break,
                    _ = ticker.tick() => {
                        let elapsed = start.elapsed().as_millis() as f64;
                        // Read the live config under a short lock, cloned so the
                        // lock is never held across the route-read `.await` below.
                        let dynamics: Vec<DynReg> = tick_dynamics.lock().map(|g| g.clone()).unwrap_or_default();
                        let rules: Vec<RuleDef> = tick_rules.lock().map(|g| g.clone()).unwrap_or_default();
                        // Collect updates WITHOUT holding the banks lock: route
                        // reads await the network, generator/preset values are
                        // computed synchronously. The std write lock is taken
                        // once below, after every `.await` has resolved.
                        let mut updates: Vec<(u8, u8, u16, Vec<u16>)> = Vec::new();
                        for d in dynamics.iter() {
                            let key = (d.unit, d.bank, d.address);
                            if elapsed < *next_due.get(&key).unwrap_or(&0.0) { continue; }
                            next_due.insert(key, elapsed + d.interval_ms);
                            match &d.kind {
                                DynKind::Generator { .. } | DynKind::Preset { .. } => {
                                    if let Ok(words) = encode_value(&d.data_type, &d.byte_order, dyn_value(d, elapsed)) {
                                        updates.push((d.unit, d.bank, d.address, words));
                                    }
                                }
                                DynKind::Route { slave_unit, connection_kind, src_fc, src_addr, count, scale, offset, src_byte_order } => {
                                    let map = if connection_kind == "serial" { &rtu_sessions } else { &tcp_sessions };
                                    let session = map.lock().ok().and_then(|g| g.get(&workspace).cloned());
                                    // "missing" = no client session for this workspace (client not
                                    // connected). "stale" = a session exists but the source read
                                    // errored/timed out. Last-good value is kept in both cases; a
                                    // finer "dangling config / deleted slave" distinction is a
                                    // possible future refinement.
                                    let status = match session {
                                        None => "missing", // no session yet → keep last-good
                                        Some(sess) => match route_read_words(sess, *slave_unit, *src_fc, *src_addr, *count, 1000).await {
                                            Ok(words) => {
                                                let out = transform_route_words(d, &words, *scale, *offset, src_byte_order);
                                                updates.push((d.unit, d.bank, d.address, out));
                                                "ok"
                                            }
                                            Err(_) => "stale", // read error/timeout → keep last-good
                                        },
                                    };
                                    if let Ok(mut s) = tick_statuses.lock() {
                                        s.insert((d.unit, d.bank, d.address), status);
                                    }
                                }
                            }
                        }
                        {
                            let Ok(mut guard) = tick_banks.write() else { continue };
                            for (u, b, a, w) in &updates {
                                place_words(&mut guard, *u, *b, *a, w);
                            }
                            // Rules run last, synchronously, under the same
                            // write lock: they see this tick's generator/route
                            // updates and their own actions apply before serve.
                            let drained: Vec<(u8, u8, u16)> = tick_writes
                                .lock()
                                .map(|mut w| std::mem::take(&mut *w))
                                .unwrap_or_default();
                            // First apply any previously-scheduled delayed actions
                            // that have come due, then evaluate rules for this tick.
                            pending_actions.retain(|(due, ta, seed)| {
                                if *due <= elapsed {
                                    apply_timed_action(&mut guard, ta, *seed);
                                    false
                                } else {
                                    true
                                }
                            });
                            let acts = eval_rules(&rules, &mut rule_states, &guard, elapsed, &drained);
                            for (id, ta) in acts {
                                let seed = elapsed as u64 ^ id as u64;
                                if ta.delay_ms <= 0.0 {
                                    apply_timed_action(&mut guard, &ta, seed);
                                } else {
                                    pending_actions.push((elapsed + ta.delay_ms, ta, seed));
                                }
                            }
                        } // lock dropped before any await/emit
                        if elapsed - last_emit >= EMIT_INTERVAL_MS {
                            last_emit = elapsed;
                            let rows = snapshot_rows(&tick_banks, &tick_statuses);
                            app.emit_values(SimValuesEvent { workspace: workspace.clone(), rows });
                        }
                    }
                }
            }
        });
        self.tick_shutdown = Some(tick_tx);
        self.tick_handle = Some(tick_handle);

        Ok(ListenInfo {
            bound: bound.to_string(),
            port: bound.port(),
            addresses: resolve_client_addresses(host, bound.port()),
        })
    }

    pub async fn stop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(tx) = self.tick_shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.take() {
            // Intentional hard stop: the oneshot signals graceful shutdown, but
            // abort() is deliberate — Stop must unbind and drop all client
            // connections immediately rather than waiting for them to drain.
            handle.abort();
            let _ = handle.await;
        }
        if let Some(handle) = self.tick_handle.take() {
            handle.abort();
            let _ = handle.await;
        }
        self.banks = None;
        self.clients.store(0, Ordering::Relaxed);
        self.started_at_ms = None;
        // Connections are force-dropped above; clear the live registry (their
        // Drop may not have run yet) and log the stop.
        if let Ok(mut o) = self.observer.lock() {
            o.clients.clear();
            o.log("stopped", String::new());
        }
    }
}

fn set_bit(map: &mut HashMap<u16, bool>, addr: u16, v: Option<bool>) {
    match v {
        Some(b) => { map.insert(addr, b); }
        None => { map.remove(&addr); }
    }
}
fn set_word(map: &mut HashMap<u16, u16>, addr: u16, v: Option<u16>) {
    match v {
        Some(w) => { map.insert(addr, w); }
        None => { map.remove(&addr); }
    }
}

/// Client-reachable addresses to display. For `0.0.0.0` we surface the primary
/// outbound IPv4 (a UDP "connect" sets the route's local addr without sending);
/// otherwise just the bound host. Multi-NIC enumeration can be added later.
fn resolve_client_addresses(host: &str, port: u16) -> Vec<String> {
    if host == "0.0.0.0" {
        if let Some(ip) = primary_local_ipv4() {
            return vec![format!("{ip}:{port}")];
        }
        return vec![format!("127.0.0.1:{port}")];
    }
    vec![format!("{host}:{port}")]
}

fn primary_local_ipv4() -> Option<std::net::Ipv4Addr> {
    use std::net::{IpAddr, UdpSocket};
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    match sock.local_addr().ok()?.ip() {
        IpAddr::V4(v4) => Some(v4),
        IpAddr::V6(_) => None,
    }
}

/// In-memory Modbus banks for ONE simulated Unit ID. Addresses present in a map
/// are "configured"; absent addresses are not served (reads/writes there raise
/// IllegalDataAddress, matching real devices).
#[derive(Debug, Default, Clone)]
pub struct SimBanks {
    pub coils: HashMap<u16, bool>,
    pub discrete_inputs: HashMap<u16, bool>,
    pub holding: HashMap<u16, u16>,
    pub input: HashMap<u16, u16>,
}

fn read_bits(map: &HashMap<u16, bool>, addr: u16, cnt: u16) -> Result<Vec<bool>, ExceptionCode> {
    let mut out = Vec::with_capacity(cnt as usize);
    for i in 0..cnt {
        let a = addr.checked_add(i).ok_or(ExceptionCode::IllegalDataAddress)?;
        out.push(*map.get(&a).ok_or(ExceptionCode::IllegalDataAddress)?);
    }
    Ok(out)
}

fn read_words(map: &HashMap<u16, u16>, addr: u16, cnt: u16) -> Result<Vec<u16>, ExceptionCode> {
    let mut out = Vec::with_capacity(cnt as usize);
    for i in 0..cnt {
        let a = addr.checked_add(i).ok_or(ExceptionCode::IllegalDataAddress)?;
        out.push(*map.get(&a).ok_or(ExceptionCode::IllegalDataAddress)?);
    }
    Ok(out)
}

fn write_bits(map: &mut HashMap<u16, bool>, addr: u16, vals: &[bool]) -> Result<(), ExceptionCode> {
    for (i, &v) in vals.iter().enumerate() {
        let a = addr.checked_add(i as u16).ok_or(ExceptionCode::IllegalDataAddress)?;
        match map.get_mut(&a) {
            Some(slot) => *slot = v,
            None => return Err(ExceptionCode::IllegalDataAddress),
        }
    }
    Ok(())
}

fn write_words(map: &mut HashMap<u16, u16>, addr: u16, vals: &[u16]) -> Result<(), ExceptionCode> {
    for (i, &v) in vals.iter().enumerate() {
        let a = addr.checked_add(i as u16).ok_or(ExceptionCode::IllegalDataAddress)?;
        match map.get_mut(&a) {
            Some(slot) => *slot = v,
            None => return Err(ExceptionCode::IllegalDataAddress),
        }
    }
    Ok(())
}

impl SimBanks {
    pub fn read_coils(&self, addr: u16, cnt: u16) -> Result<Vec<bool>, ExceptionCode> {
        read_bits(&self.coils, addr, cnt)
    }
    pub fn read_discrete_inputs(&self, addr: u16, cnt: u16) -> Result<Vec<bool>, ExceptionCode> {
        read_bits(&self.discrete_inputs, addr, cnt)
    }
    pub fn read_holding(&self, addr: u16, cnt: u16) -> Result<Vec<u16>, ExceptionCode> {
        read_words(&self.holding, addr, cnt)
    }
    pub fn read_input(&self, addr: u16, cnt: u16) -> Result<Vec<u16>, ExceptionCode> {
        read_words(&self.input, addr, cnt)
    }
    pub fn write_single_coil(&mut self, addr: u16, val: bool) -> Result<(), ExceptionCode> {
        write_bits(&mut self.coils, addr, &[val])
    }
    pub fn write_multiple_coils(&mut self, addr: u16, vals: &[bool]) -> Result<(), ExceptionCode> {
        write_bits(&mut self.coils, addr, vals)
    }
    pub fn write_single_register(&mut self, addr: u16, val: u16) -> Result<(), ExceptionCode> {
        write_words(&mut self.holding, addr, &[val])
    }
    pub fn write_multiple_registers(&mut self, addr: u16, vals: &[u16]) -> Result<(), ExceptionCode> {
        write_words(&mut self.holding, addr, vals)
    }
}

use rusqlite::Connection;

use crate::models::{SimConfig, SimDevice, SimRegister, SimRule};

pub fn create_sim_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sim_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL DEFAULT 0,
            host TEXT NOT NULL DEFAULT '0.0.0.0',
            port INTEGER NOT NULL DEFAULT 502,
            tick_ms INTEGER NOT NULL DEFAULT 100,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sim_registers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_instance_id INTEGER,
            unit_id INTEGER NOT NULL,
            function_code INTEGER NOT NULL,
            address INTEGER NOT NULL,
            alias TEXT NOT NULL DEFAULT '',
            data_type TEXT NOT NULL DEFAULT 'u16',
            byte_order TEXT,
            display_format TEXT,
            unit TEXT,
            value_source TEXT NOT NULL DEFAULT 'hold',
            source_params TEXT,
            interval_ms INTEGER,
            hold_value INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            UNIQUE(unit_id, function_code, address)
        );
        CREATE TABLE IF NOT EXISTS sim_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_instance_id INTEGER,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            trigger TEXT NOT NULL,
            actions TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sim_devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_key TEXT,
            name TEXT NOT NULL,
            unit_id INTEGER NOT NULL,
            base_address INTEGER,
            params TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0
        );",
    )
}

pub fn db_get_config(conn: &Connection) -> rusqlite::Result<SimConfig> {
    conn.query_row(
        "SELECT enabled, host, port, tick_ms FROM sim_config WHERE id = 1",
        [],
        |r| Ok(SimConfig {
            enabled: r.get::<_, i64>(0)? != 0,
            host: r.get(1)?,
            port: r.get(2)?,
            tick_ms: r.get(3)?,
        }),
    )
    .or_else(|_| Ok(SimConfig { enabled: false, host: "0.0.0.0".into(), port: 502, tick_ms: 100 }))
}

pub fn db_set_config(conn: &Connection, cfg: &SimConfig) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sim_config (id, enabled, host, port, tick_ms, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
             enabled = excluded.enabled, host = excluded.host,
             port = excluded.port, tick_ms = excluded.tick_ms,
             updated_at = excluded.updated_at",
        rusqlite::params![cfg.enabled as i64, cfg.host, cfg.port, cfg.tick_ms],
    )?;
    Ok(())
}

pub fn db_list_registers(conn: &Connection) -> rusqlite::Result<Vec<SimRegister>> {
    let mut stmt = conn.prepare(
        "SELECT id, unit_id, function_code, address, alias, data_type, hold_value, sort_order,
                COALESCE(value_source,'hold'), COALESCE(byte_order,'ABCD'),
                COALESCE(source_params,'{}'), COALESCE(interval_ms,1000), device_instance_id,
                unit, display_format
         FROM sim_registers ORDER BY unit_id, function_code, address",
    )?;
    let rows = stmt.query_map([], |r| Ok(SimRegister {
        id: r.get(0)?,
        unit_id: r.get(1)?,
        function_code: r.get(2)?,
        address: r.get(3)?,
        alias: r.get(4)?,
        data_type: r.get(5)?,
        hold_value: r.get(6)?,
        sort_order: r.get(7)?,
        value_source: r.get(8)?,
        byte_order: r.get(9)?,
        source_params: r.get(10)?,
        interval_ms: r.get(11)?,
        device_instance_id: r.get::<_, Option<i64>>(12)?,
        unit: r.get::<_, Option<String>>(13)?,
        display_format: r.get::<_, Option<String>>(14)?,
    }))?;
    rows.collect()
}

pub fn db_insert_register(conn: &Connection, reg: &SimRegister) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO sim_registers
            (unit_id, function_code, address, alias, data_type, hold_value, sort_order,
             value_source, byte_order, source_params, interval_ms, unit, display_format)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        rusqlite::params![
            reg.unit_id, reg.function_code, reg.address, reg.alias, reg.data_type,
            reg.hold_value, reg.sort_order, reg.value_source, reg.byte_order,
            reg.source_params, reg.interval_ms, reg.unit, reg.display_format
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn db_update_register(conn: &Connection, reg: &SimRegister) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sim_registers SET
            unit_id=?2, function_code=?3, address=?4, alias=?5, data_type=?6, hold_value=?7,
            sort_order=?8, value_source=?9, byte_order=?10, source_params=?11, interval_ms=?12,
            unit=?13, display_format=?14
         WHERE id=?1",
        rusqlite::params![
            reg.id, reg.unit_id, reg.function_code, reg.address, reg.alias, reg.data_type,
            reg.hold_value, reg.sort_order, reg.value_source, reg.byte_order,
            reg.source_params, reg.interval_ms, reg.unit, reg.display_format
        ],
    )?;
    Ok(())
}

pub fn db_delete_register(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM sim_registers WHERE id = ?1", [id])?;
    Ok(())
}

pub fn db_list_rules(conn: &Connection) -> rusqlite::Result<Vec<SimRule>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, enabled, trigger, actions, sort_order FROM sim_rules ORDER BY sort_order, id",
    )?;
    let rows = stmt.query_map([], |r| Ok(SimRule {
        id: r.get(0)?, name: r.get(1)?, enabled: r.get::<_, i64>(2)? != 0,
        trigger: r.get(3)?, actions: r.get(4)?, sort_order: r.get(5)?,
    }))?;
    rows.collect()
}
pub fn db_insert_rule(conn: &Connection, rule: &SimRule) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO sim_rules (name, enabled, trigger, actions, sort_order) VALUES (?1,?2,?3,?4,?5)",
        rusqlite::params![rule.name, rule.enabled as i64, rule.trigger, rule.actions, rule.sort_order],
    )?;
    Ok(conn.last_insert_rowid())
}
pub fn db_update_rule(conn: &Connection, rule: &SimRule) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sim_rules SET name=?2, enabled=?3, trigger=?4, actions=?5, sort_order=?6 WHERE id=?1",
        rusqlite::params![rule.id, rule.name, rule.enabled as i64, rule.trigger, rule.actions, rule.sort_order],
    )?;
    Ok(())
}
pub fn db_delete_rule(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM sim_rules WHERE id = ?1", [id])?;
    Ok(())
}

pub fn db_list_devices(conn: &Connection) -> rusqlite::Result<Vec<SimDevice>> {
    let mut stmt = conn.prepare(
        "SELECT id, COALESCE(template_key,''), name, unit_id, COALESCE(base_address,0), enabled, sort_order
         FROM sim_devices ORDER BY sort_order, id",
    )?;
    let rows = stmt.query_map([], |r| Ok(SimDevice {
        id: r.get(0)?, template_key: r.get(1)?, name: r.get(2)?, unit_id: r.get(3)?,
        base_address: r.get(4)?, enabled: r.get::<_, i64>(5)? != 0, sort_order: r.get(6)?,
    }))?;
    rows.collect()
}
pub fn db_insert_device(conn: &Connection, d: &SimDevice) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO sim_devices (template_key, name, unit_id, base_address, enabled, sort_order)
         VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![d.template_key, d.name, d.unit_id, d.base_address, d.enabled as i64, d.sort_order],
    )?;
    Ok(conn.last_insert_rowid())
}
pub fn db_update_device(conn: &Connection, d: &SimDevice) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sim_devices SET name=?2, unit_id=?3, base_address=?4, enabled=?5, sort_order=?6 WHERE id=?1",
        rusqlite::params![d.id, d.name, d.unit_id, d.base_address, d.enabled as i64, d.sort_order],
    )?;
    Ok(())
}
pub fn db_delete_device(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM sim_registers WHERE device_instance_id = ?1", [id])?;
    conn.execute("DELETE FROM sim_rules WHERE device_instance_id = ?1", [id])?;
    conn.execute("DELETE FROM sim_devices WHERE id = ?1", [id])?;
    Ok(())
}

/// Registers belonging to a given device instance (its "children").
pub fn db_list_registers_for_device(conn: &Connection, device_id: i64) -> rusqlite::Result<Vec<SimRegister>> {
    let mut stmt = conn.prepare(
        "SELECT id, unit_id, function_code, address, alias, data_type, hold_value, sort_order,
                COALESCE(value_source,'hold'), COALESCE(byte_order,'ABCD'),
                COALESCE(source_params,'{}'), COALESCE(interval_ms,1000), device_instance_id,
                unit, display_format
         FROM sim_registers WHERE device_instance_id = ?1 ORDER BY unit_id, function_code, address",
    )?;
    let rows = stmt.query_map([device_id], |r| Ok(SimRegister {
        id: r.get(0)?,
        unit_id: r.get(1)?,
        function_code: r.get(2)?,
        address: r.get(3)?,
        alias: r.get(4)?,
        data_type: r.get(5)?,
        hold_value: r.get(6)?,
        sort_order: r.get(7)?,
        value_source: r.get(8)?,
        byte_order: r.get(9)?,
        source_params: r.get(10)?,
        interval_ms: r.get(11)?,
        device_instance_id: r.get::<_, Option<i64>>(12)?,
        unit: r.get::<_, Option<String>>(13)?,
        display_format: r.get::<_, Option<String>>(14)?,
    }))?;
    rows.collect()
}

/// Registers NOT belonging to a given device instance (i.e. every other
/// register, whether unowned or owned by a different device). Used to check
/// that a re-base doesn't collide with anything outside the device itself.
pub fn db_list_registers_excluding_device(conn: &Connection, device_id: i64) -> rusqlite::Result<Vec<SimRegister>> {
    let mut stmt = conn.prepare(
        "SELECT id, unit_id, function_code, address, alias, data_type, hold_value, sort_order,
                COALESCE(value_source,'hold'), COALESCE(byte_order,'ABCD'),
                COALESCE(source_params,'{}'), COALESCE(interval_ms,1000), device_instance_id,
                unit, display_format
         FROM sim_registers WHERE device_instance_id IS NULL OR device_instance_id != ?1
         ORDER BY unit_id, function_code, address",
    )?;
    let rows = stmt.query_map([device_id], |r| Ok(SimRegister {
        id: r.get(0)?,
        unit_id: r.get(1)?,
        function_code: r.get(2)?,
        address: r.get(3)?,
        alias: r.get(4)?,
        data_type: r.get(5)?,
        hold_value: r.get(6)?,
        sort_order: r.get(7)?,
        value_source: r.get(8)?,
        byte_order: r.get(9)?,
        source_params: r.get(10)?,
        interval_ms: r.get(11)?,
        device_instance_id: r.get::<_, Option<i64>>(12)?,
        unit: r.get::<_, Option<String>>(13)?,
        display_format: r.get::<_, Option<String>>(14)?,
    }))?;
    rows.collect()
}

/// One register in a `DeviceTemplate`'s register map, relative to the
/// device's `base_address` (absolute address = `base_address + offset`).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRegister {
    pub offset: u16,
    pub bank: u8,
    #[serde(default = "default_u16")]
    pub data_type: String,
    #[serde(default = "default_abcd")]
    pub byte_order: String,
    #[serde(default = "default_hold")]
    pub value_source: String,
    #[serde(default = "default_empty_obj")]
    pub source_params: String,
    #[serde(default)]
    pub alias: String,
}

fn default_u16() -> String { "u16".into() }
fn default_abcd() -> String { "ABCD".into() }
fn default_hold() -> String { "hold".into() }
fn default_empty_obj() -> String { "{}".into() }

/// A built-in (or, in a later plan, custom) device register-map template.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTemplate {
    pub template_key: String,
    pub name: String,
    #[serde(default = "default_custom_category")]
    pub category: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_device_icon")]
    pub icon: String,
    #[serde(default)]
    pub registers: Vec<TemplateRegister>,
}

fn default_custom_category() -> String { "Custom".into() }
fn default_device_icon() -> String { "📟".into() }

fn treg(offset: u16, bank: u8, data_type: &str, byte_order: &str, value_source: &str, source_params: &str, alias: &str) -> TemplateRegister {
    TemplateRegister {
        offset,
        bank,
        data_type: data_type.into(),
        byte_order: byte_order.into(),
        value_source: value_source.into(),
        source_params: source_params.into(),
        alias: alias.into(),
    }
}

/// The built-in device template catalog (Plan 5 v1: register-maps only, no
/// bundled rules — see plan's Global Constraints).
pub fn builtin_templates() -> Vec<DeviceTemplate> {
    vec![
        DeviceTemplate {
            template_key: "register_playground".into(),
            name: "Register Playground".into(),
            category: "Learning".into(),
            description: "Learn Modbus with mixed live values".into(),
            icon: "🎓".into(),
            registers: vec![
                treg(0, 1, "bool", "ABCD", "hold", "{}", ""),
                treg(1, 1, "bool", "ABCD", "hold", "{}", ""),
                treg(2, 1, "bool", "ABCD", "hold", "{}", ""),
                treg(3, 1, "bool", "ABCD", "hold", "{}", ""),
                treg(0, 3, "u16", "ABCD", "hold", "{}", "Setpoint"),
                treg(1, 3, "u16", "ABCD", "generator", r#"{"kind":"sine","min":0,"max":1000,"periodMs":5000}"#, "Sine"),
                treg(2, 3, "u16", "ABCD", "generator", r#"{"kind":"ramp","min":0,"max":100,"periodMs":4000}"#, "Ramp"),
                treg(0, 4, "u16", "ABCD", "device", r#"{"preset":"temperature","min":20,"max":30}"#, "Temp"),
                treg(1, 4, "u16", "ABCD", "device", r#"{"preset":"counter","min":0,"max":10000,"periodMs":1000}"#, "Counter"),
            ],
        },
        DeviceTemplate {
            template_key: "temp_humidity".into(),
            name: "Temp/Humidity Sensor".into(),
            category: "Sensors".into(),
            description: "Temperature + humidity transmitter".into(),
            icon: "🌡️".into(),
            registers: vec![
                treg(0, 4, "u16", "ABCD", "device", r#"{"preset":"temperature","min":18,"max":28}"#, "Temperature"),
                treg(1, 4, "u16", "ABCD", "device", r#"{"preset":"humidity","min":40,"max":70}"#, "Humidity"),
            ],
        },
        DeviceTemplate {
            template_key: "ac_energy_meter".into(),
            name: "AC Energy Meter".into(),
            category: "Power".into(),
            description: "AC energy/power meter".into(),
            icon: "⚡".into(),
            registers: vec![
                treg(0, 4, "f32", "ABCD", "device", r#"{"preset":"analog","min":220,"max":240}"#, "Voltage"),
                treg(2, 4, "f32", "ABCD", "device", r#"{"preset":"analog","min":0,"max":30}"#, "Current"),
                treg(4, 4, "f32", "ABCD", "device", r#"{"preset":"analog","min":0,"max":7000}"#, "Power W"),
                treg(6, 4, "f32", "ABCD", "device", r#"{"preset":"counter","min":0,"max":1000000,"periodMs":2000}"#, "Energy kWh"),
            ],
        },
        DeviceTemplate {
            template_key: "relay_board".into(),
            name: "Relay Board".into(),
            category: "I/O".into(),
            description: "8-channel relay board".into(),
            icon: "🔀".into(),
            registers: vec![
                treg(0, 1, "bool", "ABCD", "hold", "{}", "Relay 1"),
                treg(1, 1, "bool", "ABCD", "hold", "{}", "Relay 2"),
                treg(2, 1, "bool", "ABCD", "hold", "{}", "Relay 3"),
                treg(3, 1, "bool", "ABCD", "hold", "{}", "Relay 4"),
                treg(4, 1, "bool", "ABCD", "hold", "{}", "Relay 5"),
                treg(5, 1, "bool", "ABCD", "hold", "{}", "Relay 6"),
                treg(6, 1, "bool", "ABCD", "hold", "{}", "Relay 7"),
                treg(7, 1, "bool", "ABCD", "hold", "{}", "Relay 8"),
            ],
        },
        DeviceTemplate {
            template_key: "vfd_drive".into(),
            name: "VFD Drive".into(),
            category: "Drives".into(),
            description: "Variable frequency drive".into(),
            icon: "⚙️".into(),
            registers: vec![
                treg(0, 3, "u16", "ABCD", "hold", "{}", "Control word"),
                treg(1, 3, "u16", "ABCD", "hold", "{}", "Freq setpoint"),
                treg(0, 4, "u16", "ABCD", "hold", "{}", "Status word"),
                treg(1, 4, "u16", "ABCD", "generator", r#"{"kind":"sine","min":0,"max":500,"periodMs":8000}"#, "Output freq"),
                treg(2, 4, "u16", "ABCD", "device", r#"{"preset":"analog","min":0,"max":100}"#, "Output current"),
            ],
        },
        DeviceTemplate {
            template_key: "soil_sensor".into(),
            name: "Soil Sensor".into(),
            category: "Sensors".into(),
            description: "RS485 soil 7-in-1 sensor".into(),
            icon: "🌱".into(),
            registers: vec![
                treg(0, 4, "u16", "ABCD", "device", r#"{"preset":"analog","min":0,"max":100}"#, "Moisture %"),
                treg(1, 4, "u16", "ABCD", "device", r#"{"preset":"temperature","min":10,"max":30}"#, "Soil temp"),
                treg(2, 4, "u16", "ABCD", "device", r#"{"preset":"analog","min":0,"max":2000}"#, "EC"),
                treg(3, 4, "u16", "ABCD", "device", r#"{"preset":"analog","min":40,"max":90}"#, "pH x10"),
            ],
        },
    ]
}

/// Look up a built-in template by key.
pub fn find_template(key: &str) -> Option<DeviceTemplate> {
    builtin_templates().into_iter().find(|t| t.template_key == key)
}

/// Path to the app-global custom device-template catalog (shared by every
/// workspace). Community templates are imported/authored here.
fn custom_templates_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create app data dir: {e}"))?;
    Ok(dir.join("custom_device_templates.json"))
}

/// Read the custom template catalog (empty if the file is absent or invalid).
fn read_custom_templates(app: &tauri::AppHandle) -> Vec<DeviceTemplate> {
    let Ok(path) = custom_templates_path(app) else { return Vec::new() };
    let Ok(text) = std::fs::read_to_string(&path) else { return Vec::new() };
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_custom_templates(app: &tauri::AppHandle, templates: &[DeviceTemplate]) -> Result<(), String> {
    let path = custom_templates_path(app)?;
    let json = serde_json::to_string_pretty(templates).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("failed to write template catalog: {e}"))
}

/// Validate a template before it enters the catalog: keys/name present and
/// every register well-formed (bank/type/order), reusing `validate_register`
/// against a probe instance at base 0.
fn validate_template(t: &DeviceTemplate) -> Result<(), String> {
    if t.template_key.trim().is_empty() {
        return Err("template key is required".into());
    }
    if t.name.trim().is_empty() {
        return Err("template name is required".into());
    }
    for r in &t.registers {
        let probe = SimRegister {
            id: 0,
            unit_id: 1,
            function_code: r.bank as i64,
            address: r.offset as i64,
            alias: r.alias.clone(),
            data_type: r.data_type.clone(),
            hold_value: 0,
            sort_order: 0,
            device_instance_id: None,
            value_source: r.value_source.clone(),
            byte_order: r.byte_order.clone(),
            source_params: r.source_params.clone(),
            interval_ms: 1000,
            unit: None,
            display_format: None,
        };
        validate_register(&probe).map_err(|e| format!("register '{}': {e}", r.alias))?;
    }
    Ok(())
}

/// Merge built-in + custom templates, custom overriding a built-in with the
/// same key (so a user can shadow a built-in). Built-in order is preserved;
/// new custom templates are appended.
#[tauri::command]
pub fn simulator_list_device_templates(app: tauri::AppHandle) -> Result<Vec<DeviceTemplate>, String> {
    let custom = read_custom_templates(&app);
    let mut out = builtin_templates();
    for c in custom {
        if let Some(existing) = out.iter_mut().find(|t| t.template_key == c.template_key) {
            *existing = c;
        } else {
            out.push(c);
        }
    }
    Ok(out)
}

/// Just the custom (user-authored) templates, for the Device Builder's library
/// management (built-ins are read-only; customs can be edited/deleted).
#[tauri::command]
pub fn simulator_list_custom_templates(app: tauri::AppHandle) -> Result<Vec<DeviceTemplate>, String> {
    Ok(read_custom_templates(&app))
}

/// Upsert a custom template (by `templateKey`) into the app-global catalog.
#[tauri::command]
pub fn simulator_save_custom_template(app: tauri::AppHandle, template: DeviceTemplate) -> Result<(), String> {
    validate_template(&template)?;
    // Don't let a custom template shadow a built-in with a reserved key by accident.
    if builtin_templates().iter().any(|b| b.template_key == template.template_key) {
        return Err(format!("'{}' is a built-in template key; choose a different key", template.template_key));
    }
    let mut custom = read_custom_templates(&app);
    if let Some(existing) = custom.iter_mut().find(|t| t.template_key == template.template_key) {
        *existing = template;
    } else {
        custom.push(template);
    }
    write_custom_templates(&app, &custom)
}

/// Delete a custom template from the catalog by key.
#[tauri::command]
pub fn simulator_delete_custom_template(app: tauri::AppHandle, template_key: String) -> Result<(), String> {
    let mut custom = read_custom_templates(&app);
    let before = custom.len();
    custom.retain(|t| t.template_key != template_key);
    if custom.len() == before {
        return Err(format!("no custom template '{template_key}'"));
    }
    write_custom_templates(&app, &custom)
}

/// Import a shared template `.json` file into the catalog (community sharing)
/// via a native open dialog (Rust backend). Returns the imported template, or
/// `None` if the dialog was cancelled.
#[tauri::command]
pub async fn simulator_import_custom_template(app: tauri::AppHandle) -> Result<Option<DeviceTemplate>, String> {
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("Device Template", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|e| format!("failed to read file: {e}"))?;
    let template: DeviceTemplate =
        serde_json::from_str(&text).map_err(|e| format!("invalid template JSON: {e}"))?;
    validate_template(&template)?;
    if builtin_templates().iter().any(|b| b.template_key == template.template_key) {
        return Err(format!("'{}' clashes with a built-in template key; rename it before importing", template.template_key));
    }
    let mut custom = read_custom_templates(&app);
    if let Some(existing) = custom.iter_mut().find(|t| t.template_key == template.template_key) {
        *existing = template.clone();
    } else {
        custom.push(template.clone());
    }
    write_custom_templates(&app, &custom)?;
    Ok(Some(template))
}

/// Export any template (built-in or custom) to a shareable `.json` file via a
/// native save dialog (Rust backend). Returns `true` if saved, `false` if
/// cancelled.
#[tauri::command]
pub async fn simulator_export_template(app: tauri::AppHandle, template_key: String) -> Result<bool, String> {
    let all = simulator_list_device_templates(app.clone())?;
    let t = all
        .into_iter()
        .find(|t| t.template_key == template_key)
        .ok_or_else(|| format!("no template '{template_key}'"))?;
    let json = serde_json::to_string_pretty(&t).map_err(|e| e.to_string())?;
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("Device Template", &["json"])
        .set_file_name(format!("{template_key}.template.json"))
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("failed to write file: {e}"))?;
    Ok(true)
}

/// Build a `DeviceTemplate` from a live workspace device — the "Save as
/// template" bridge. Register offsets are made base-relative so the template
/// can be re-instantiated anywhere. Not saved; the caller edits/saves it.
#[tauri::command]
pub fn simulator_device_to_template(
    app: tauri::AppHandle,
    name: String,
    device_id: i64,
    template_key: String,
    template_name: String,
    category: String,
    icon: String,
    description: String,
) -> Result<DeviceTemplate, String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    let device = db_list_devices(&conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|d| d.id == device_id)
        .ok_or_else(|| "device not found".to_string())?;
    let regs = db_list_registers_for_device(&conn, device_id).map_err(|e| e.to_string())?;
    let base = device.base_address;
    let registers: Vec<TemplateRegister> = regs
        .into_iter()
        .map(|r| TemplateRegister {
            offset: (r.address - base).max(0) as u16,
            bank: r.function_code as u8,
            data_type: r.data_type,
            byte_order: r.byte_order,
            value_source: r.value_source,
            source_params: r.source_params,
            alias: r.alias,
        })
        .collect();
    Ok(DeviceTemplate {
        template_key,
        name: template_name,
        category,
        description,
        icon,
        registers,
    })
}

/// Expand a `DeviceTemplate` into concrete `SimRegister`s for a device
/// instance at unit `unit_id` with absolute addresses starting at `base`.
/// `device_instance_id` is left unset (0) — the caller sets it after the
/// owning `sim_devices` row is inserted.
pub fn template_to_registers(t: &DeviceTemplate, unit_id: i64, base: i64) -> Vec<SimRegister> {
    t.registers
        .iter()
        .map(|r| SimRegister {
            id: 0,
            unit_id,
            function_code: r.bank as i64,
            address: base + r.offset as i64,
            alias: r.alias.clone(),
            data_type: r.data_type.clone(),
            hold_value: 0,
            sort_order: 0,
            device_instance_id: None,
            value_source: r.value_source.clone(),
            byte_order: r.byte_order.clone(),
            source_params: r.source_params.clone(),
            interval_ms: 1000,
            unit: None,
            display_format: None,
        })
        .collect()
}

/// Reject `new` registers that would collide with `existing` ones on the
/// `(unit_id, function_code, address)` key, treating multi-word registers
/// (e.g. f32/u32/i32) as occupying `word_count` consecutive addresses.
/// Also detects overlaps between registers within `new` itself.
pub fn validate_no_overlap(existing: &[SimRegister], new: &[SimRegister]) -> Result<(), String> {
    use std::collections::HashSet;

    let mut occupied: HashSet<(i64, i64, i64)> = HashSet::new();
    for e in existing {
        let span = word_count(&e.data_type) as i64;
        for addr in e.address..=(e.address + span - 1) {
            occupied.insert((e.unit_id, e.function_code, addr));
        }
    }

    for n in new {
        let span = word_count(&n.data_type) as i64;
        for addr in n.address..=(n.address + span - 1) {
            if occupied.contains(&(n.unit_id, n.function_code, addr)) {
                return Err(format!(
                    "device would overlap existing register at unit {} bank {} address {}",
                    n.unit_id, n.function_code, addr
                ));
            }
        }
        for addr in n.address..=(n.address + span - 1) {
            occupied.insert((n.unit_id, n.function_code, addr));
        }
    }
    Ok(())
}

/// Shift a device's child registers by `new_base - old_base`, returning the
/// updated copies (addresses only; ids/other fields unchanged). Errors if any
/// resulting address (accounting for the register's word-count span) would
/// fall outside the valid 0..=65535 range.
pub fn rebase_children(children: &[SimRegister], old_base: i64, new_base: i64) -> Result<Vec<SimRegister>, String> {
    let delta = new_base - old_base;
    let mut shifted = Vec::with_capacity(children.len());
    for reg in children {
        let new_address = reg.address + delta;
        let span = word_count(&reg.data_type) as i64;
        if new_address < 0 || new_address + span - 1 > 65535 {
            return Err(format!(
                "rebased address {} out of range (0-65535)",
                new_address
            ));
        }
        shifted.push(SimRegister { address: new_address, ..reg.clone() });
    }
    Ok(shifted)
}

#[tauri::command]
pub fn simulator_add_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
    device_name: String,
    template_key: String,
    unit_id: i64,
    base_address: i64,
) -> Result<i64, String> {
    let ws = validate_workspace_name(&name)?;
    // Include custom (app-global) templates, not just built-ins, so an imported
    // community device can be instantiated.
    let t = simulator_list_device_templates(app.clone())?
        .into_iter()
        .find(|t| t.template_key == template_key)
        .ok_or("unknown template")?;
    instantiate_device(&app, &state, &ws, &t, template_key, device_name, unit_id, base_address)
}

/// Instantiate a device from a template supplied inline rather than looked up in
/// the catalog. Used for "workspace-slave" devices (see
/// `simulator_list_slave_device_templates`), whose route-register maps are built
/// on the fly from a real slave and aren't part of the shared template catalog.
#[tauri::command]
pub fn simulator_add_inline_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
    template: DeviceTemplate,
    device_name: String,
    unit_id: i64,
    base_address: i64,
) -> Result<i64, String> {
    let ws = validate_workspace_name(&name)?;
    validate_template(&template)?;
    let key = template.template_key.clone();
    instantiate_device(&app, &state, &ws, &template, key, device_name, unit_id, base_address)
}

/// Shared body for catalog and inline device creation: expand the template at
/// `unit_id`/`base_address`, reject out-of-range / overlapping registers, insert
/// the device + its child registers, and push them into the live banks.
fn instantiate_device(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, SimulatorState>,
    ws: &str,
    template: &DeviceTemplate,
    stored_key: String,
    device_name: String,
    unit_id: i64,
    base_address: i64,
) -> Result<i64, String> {
    if !(0..=255).contains(&unit_id) {
        return Err(format!("unit id {} out of range (0-255)", unit_id));
    }
    if !(0..=65535).contains(&base_address) {
        return Err(format!("base address {} out of range (0-65535)", base_address));
    }
    let regs = template_to_registers(template, unit_id, base_address);

    for reg in &regs {
        if reg.address + word_count(&reg.data_type) as i64 - 1 > 65535 {
            return Err(format!(
                "device does not fit: register at address {} exceeds 65535",
                reg.address
            ));
        }
    }

    let mut conn = open_workspace_db(app, ws)?;
    let existing = db_list_registers(&conn).map_err(|e| e.to_string())?;
    validate_no_overlap(&existing, &regs)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let device_id = db_insert_device(
        &tx,
        &SimDevice {
            id: 0,
            template_key: stored_key,
            name: device_name,
            unit_id,
            base_address,
            enabled: true,
            sort_order: 0,
        },
    )
    .map_err(|e| e.to_string())?;

    for reg in &regs {
        let reg_id = db_insert_register(&tx, reg).map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE sim_registers SET device_instance_id = ?1 WHERE id = ?2",
            rusqlite::params![device_id, reg_id],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    // Push the new registers into the live banks so a device added while the
    // server is running is served immediately (parity with add/update register).
    // No-op when the server is stopped — the next Start rebuilds banks from the DB.
    for reg in &regs {
        apply_to_running(state, ws, reg, false);
    }
    refresh_running_config(app, state, &conn, ws);

    Ok(device_id)
}

/// Map one slave register row to a route `TemplateRegister` that mirrors it:
/// same bank/address/type, exposed at the same offset, reading through the
/// slave's own connection + unit. Bit banks (coil/discrete) are forced to
/// `bool`/`ABCD` so `validate_register` accepts them.
fn slave_row_to_route_register(
    unit_id: i64,
    conn_kind: &str,
    fc: i64,
    addr: i64,
    alias: &str,
    data_type: &str,
    order: &str,
) -> TemplateRegister {
    let is_bit = fc == 1 || fc == 2;
    let source_params = serde_json::json!({
        "slaveUnitId": unit_id,
        "connectionKind": conn_kind,
        "functionCode": fc,
        "address": addr,
        "scale": 1.0,
        "offset": 0.0,
    })
    .to_string();
    TemplateRegister {
        offset: addr.clamp(0, 65535) as u16,
        bank: fc as u8,
        data_type: if is_bit { "bool".into() } else { data_type.to_string() },
        byte_order: if is_bit || order.is_empty() { "ABCD".into() } else { order.to_string() },
        value_source: "route".into(),
        source_params,
        alias: alias.to_string(),
    }
}

/// Build synthetic "Workspace" device templates from the workspace's own slaves:
/// each slave becomes a device whose registers ROUTE to that slave (using the
/// slave's connection + unit), so a real device configured on the Slaves page can
/// be exposed over the TCP simulator in one step. Not part of the shared catalog
/// — instantiated inline via `simulator_add_inline_device`.
#[tauri::command]
pub fn simulator_list_slave_device_templates(
    app: tauri::AppHandle,
    name: String,
) -> Result<Vec<DeviceTemplate>, String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;

    let mut slave_stmt = conn
        .prepare("SELECT id, name, unit_id, connection_kind FROM slaves ORDER BY unit_id ASC;")
        .map_err(|e| e.to_string())?;
    let slaves: Vec<(i64, String, i64, String)> = slave_stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let mut out: Vec<DeviceTemplate> = Vec::new();
    for (slave_id, slave_name, unit_id, conn_kind_raw) in slaves {
        let conn_kind = if conn_kind_raw.is_empty() { "tcp".to_string() } else { conn_kind_raw };
        let mut row_stmt = conn
            .prepare(
                "SELECT function_code, address, alias, data_type, \"order\"
                 FROM slave_register_rows
                 WHERE slave_id = ?1 AND function_code IN (1,2,3,4)
                 ORDER BY function_code ASC, address ASC;",
            )
            .map_err(|e| e.to_string())?;
        let registers: Vec<TemplateRegister> = row_stmt
            .query_map([slave_id], |r| {
                let fc: i64 = r.get(0)?;
                let addr: i64 = r.get(1)?;
                let alias: String = r.get::<_, Option<String>>(2)?.unwrap_or_default();
                let data_type: String = r.get::<_, Option<String>>(3)?.unwrap_or_else(|| "u16".into());
                let order: String = r.get::<_, Option<String>>(4)?.unwrap_or_default();
                Ok(slave_row_to_route_register(unit_id, &conn_kind, fc, addr, &alias, &data_type, &order))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;

        if registers.is_empty() {
            continue; // nothing readable to route — skip
        }

        let count = registers.len();
        out.push(DeviceTemplate {
            template_key: format!("ws-slave:{slave_id}"),
            name: slave_name,
            category: "Workspace".into(),
            description: format!(
                "Routes to {} unit {} · {} register{}",
                conn_kind, unit_id, count, if count == 1 { "" } else { "s" }
            ),
            icon: "🔗".into(),
            registers,
        });
    }

    Ok(out)
}

#[tauri::command]
pub fn simulator_list_devices(app: tauri::AppHandle, name: String) -> Result<Vec<SimDevice>, String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    db_list_devices(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn simulator_delete_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
    id: i64,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    // Capture the device's registers before the cascade delete so we can also
    // drop them from the live banks (otherwise a running server keeps serving
    // the deleted device's stale addresses until the next Start).
    let children = db_list_registers_for_device(&conn, id).map_err(|e| e.to_string())?;
    db_delete_device(&conn, id).map_err(|e| e.to_string())?;
    for reg in &children {
        apply_to_running(&state, &ws, reg, true);
    }
    refresh_running_config(&app, &state, &conn, &ws);
    Ok(())
}

#[tauri::command]
pub fn simulator_update_device(app: tauri::AppHandle, name: String, device: SimDevice) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    db_update_device(&conn, &device).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn simulator_rebase_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
    id: i64,
    new_base_address: i64,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    if !(0..=65535).contains(&new_base_address) {
        return Err(format!("base address {} out of range (0-65535)", new_base_address));
    }
    let conn = open_workspace_db(&app, &ws)?;

    let mut device = db_list_devices(&conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|d| d.id == id)
        .ok_or_else(|| format!("device {} not found", id))?;

    let children = db_list_registers_for_device(&conn, id).map_err(|e| e.to_string())?;
    let shifted = rebase_children(&children, device.base_address, new_base_address)?;

    // The shifted registers must not collide with anything outside this
    // device (other devices' registers or unowned/manual registers).
    let others = db_list_registers_excluding_device(&conn, id).map_err(|e| e.to_string())?;
    validate_no_overlap(&others, &shifted)?;

    device.base_address = new_base_address;
    db_update_device(&conn, &device).map_err(|e| e.to_string())?;
    for reg in &shifted {
        db_update_register(&conn, reg).map_err(|e| e.to_string())?;
    }

    // Move the registers in the live banks too: clear all old addresses first,
    // then place the shifted ones (clear-before-place is safe when spans overlap).
    for reg in &children {
        apply_to_running(&state, &ws, reg, true);
    }
    for reg in &shifted {
        apply_to_running(&state, &ws, reg, false);
    }
    refresh_running_config(&app, &state, &conn, &ws);
    Ok(())
}

/// A rule's trigger condition, parsed from the `SimRule.trigger` JSON.
#[derive(Debug, Clone, PartialEq)]
pub enum Trigger {
    /// Fires every `ms` milliseconds.
    Interval { ms: f64 },
    /// Fires (edge-triggered) when `register op value` transitions to true.
    Condition { unit: u8, bank: u8, address: u16, op: String, value: i64 },
    /// Fires when a client writes to `(unit, bank, address)`; `address: None`
    /// matches any address in that unit/bank.
    OnWrite { unit: u8, bank: u8, address: Option<u16> },
}

/// A rule's action, parsed from an entry in the `SimRule.actions` JSON array.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Set { unit: u8, bank: u8, address: u16, value: i64 },
    Inc { unit: u8, bank: u8, address: u16, by: i64 },
    Dec { unit: u8, bank: u8, address: u16, by: i64 },
    Toggle { unit: u8, bank: u8, address: u16 },
    Copy {
        src_unit: u8,
        src_bank: u8,
        src_addr: u16,
        unit: u8,
        bank: u8,
        address: u16,
        scale: f64,
        offset: f64,
    },
    Randomize { unit: u8, bank: u8, address: u16, min: i64, max: i64 },
}

/// An action plus its scheduling and target-width metadata. `delay_ms` (0 =
/// immediate) staggers the action after its rule fires; `data_type`/`byte_order`
/// let a `set`/`inc`/`dec`/`copy`/`randomize` write a MULTI-word register
/// (u32/f32/u64/… ) correctly. Both default to today's behavior (fire now,
/// single u16 word), so existing rules are unaffected.
#[derive(Debug, Clone, PartialEq)]
pub struct TimedAction {
    pub action: Action,
    pub delay_ms: f64,
    pub data_type: String,
    pub byte_order: String,
}

/// A fully-parsed rule, ready for evaluation.
#[derive(Debug, Clone)]
pub struct RuleDef {
    pub id: i64,
    pub enabled: bool,
    pub trigger: Trigger,
    pub actions: Vec<TimedAction>,
    pub sort_order: i64,
}

fn json_u8(v: &serde_json::Value, key: &str, default: u8) -> u8 {
    v.get(key).and_then(|x| x.as_u64()).map(|x| x as u8).unwrap_or(default)
}

fn json_u16(v: &serde_json::Value, key: &str, default: u16) -> u16 {
    v.get(key).and_then(|x| x.as_u64()).map(|x| x as u16).unwrap_or(default)
}

fn json_i64(v: &serde_json::Value, key: &str, default: i64) -> i64 {
    v.get(key).and_then(|x| x.as_i64()).unwrap_or(default)
}

/// Parse a single action from its JSON object; unknown `type` → `None` (the
/// caller skips it, so one bad action doesn't invalidate the whole rule).
/// Reads optional `delayMs` (per-action delay) and `dataType`/`byteOrder`
/// (multi-word target width), both defaulting to legacy single-word/immediate.
fn parse_action(v: &serde_json::Value) -> Option<TimedAction> {
    let unit = json_u8(v, "unit", 1);
    let bank = json_u8(v, "bank", 1);
    let address = json_u16(v, "address", 0);
    let action = match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
        "set" => Action::Set { unit, bank, address, value: json_i64(v, "value", 0) },
        "inc" => Action::Inc { unit, bank, address, by: json_i64(v, "by", 1) },
        "dec" => Action::Dec { unit, bank, address, by: json_i64(v, "by", 1) },
        "toggle" => Action::Toggle { unit, bank, address },
        "copy" => Action::Copy {
            src_unit: json_u8(v, "srcUnit", unit),
            src_bank: json_u8(v, "srcBank", bank),
            src_addr: json_u16(v, "srcAddr", 0),
            unit,
            bank,
            address,
            scale: v.get("scale").and_then(|x| x.as_f64()).unwrap_or(1.0),
            offset: v.get("offset").and_then(|x| x.as_f64()).unwrap_or(0.0),
        },
        "randomize" => Action::Randomize {
            unit,
            bank,
            address,
            min: json_i64(v, "min", 0),
            max: json_i64(v, "max", 0),
        },
        _ => return None,
    };
    Some(TimedAction {
        action,
        delay_ms: v.get("delayMs").and_then(|x| x.as_f64()).unwrap_or(0.0).max(0.0),
        data_type: v.get("dataType").and_then(|x| x.as_str()).unwrap_or("u16").to_string(),
        byte_order: v.get("byteOrder").and_then(|x| x.as_str()).unwrap_or("ABCD").to_string(),
    })
}

/// Parse a `SimRule`'s `trigger`/`actions` JSON into a `RuleDef`. Returns
/// `None` if the rule is disabled, or its `trigger`/`actions` JSON is
/// malformed or has an unrecognized trigger `type`. Unrecognized action
/// types are skipped (not fatal to the rule).
pub fn parse_rule(rule: &SimRule) -> Option<RuleDef> {
    if !rule.enabled {
        return None;
    }
    let tv: serde_json::Value = serde_json::from_str(&rule.trigger).ok()?;
    let trigger = match tv.get("type").and_then(|x| x.as_str()).unwrap_or("") {
        "interval" => Trigger::Interval { ms: tv.get("ms").and_then(|x| x.as_f64()).unwrap_or(1000.0) },
        "condition" => Trigger::Condition {
            unit: json_u8(&tv, "unit", 1),
            bank: json_u8(&tv, "bank", 1),
            address: json_u16(&tv, "address", 0),
            op: tv.get("op").and_then(|x| x.as_str()).unwrap_or("==").to_string(),
            value: json_i64(&tv, "value", 0),
        },
        "onWrite" => {
            let address = match tv.get("address").and_then(|x| x.as_i64()) {
                Some(a) if a >= 0 => Some(a as u16),
                _ => None,
            };
            Trigger::OnWrite { unit: json_u8(&tv, "unit", 1), bank: json_u8(&tv, "bank", 1), address }
        }
        _ => return None,
    };
    let av: serde_json::Value = serde_json::from_str(&rule.actions).ok()?;
    let actions: Vec<TimedAction> = av
        .as_array()
        .map(|arr| arr.iter().filter_map(parse_action).collect())
        .unwrap_or_default();
    Some(RuleDef { id: rule.id, enabled: rule.enabled, trigger, actions, sort_order: rule.sort_order })
}

/// Read a single word/bit from the banks: bit banks (1=coil, 2=discrete
/// input) read as `0`/`1`; word banks (3=holding, 4=input) read as the
/// stored `u16`. Returns `None` if the unit/bank/address isn't present.
pub fn read_word(banks: &HashMap<u8, SimBanks>, unit: u8, bank: u8, addr: u16) -> Option<u16> {
    let b = banks.get(&unit)?;
    match bank {
        1 => b.coils.get(&addr).map(|&v| v as u16),
        2 => b.discrete_inputs.get(&addr).map(|&v| v as u16),
        3 => b.holding.get(&addr).copied(),
        4 => b.input.get(&addr).copied(),
        _ => None,
    }
}

/// Apply a rule `Action` to the in-memory banks, mutating the target
/// word/bit. `Set`/`Toggle`/`Inc`/`Dec`/`Randomize` upsert the target
/// (created if absent, default current value `0`); `Copy` and `Inc`/`Dec`
/// no-op if their source isn't present (documented limitation — there is
/// nothing sensible to increment/copy from). `Randomize` uses the
/// deterministic `unit_random(rng_seed)` from Plan 2.
pub fn apply_action(banks: &mut HashMap<u8, SimBanks>, action: &Action, rng_seed: u64) {
    match *action {
        Action::Set { unit, bank, address, value } => {
            place_words(banks, unit, bank, address, &[value as u16]);
        }
        Action::Inc { unit, bank, address, by } => {
            let cur = read_word(banks, unit, bank, address).unwrap_or(0);
            let next = cur.wrapping_add(by as u16);
            place_words(banks, unit, bank, address, &[next]);
        }
        Action::Dec { unit, bank, address, by } => {
            let cur = read_word(banks, unit, bank, address).unwrap_or(0);
            let next = cur.wrapping_sub(by as u16);
            place_words(banks, unit, bank, address, &[next]);
        }
        Action::Toggle { unit, bank, address } => {
            let cur = read_word(banks, unit, bank, address).unwrap_or(0);
            let next: u16 = match bank {
                1 | 2 => if cur != 0 { 0 } else { 1 },
                _ => if cur == 0 { 1 } else { 0 },
            };
            place_words(banks, unit, bank, address, &[next]);
        }
        Action::Copy { src_unit, src_bank, src_addr, unit, bank, address, scale, offset } => {
            if let Some(src) = read_word(banks, src_unit, src_bank, src_addr) {
                let next = ((src as f64) * scale + offset) as i64 as u16;
                place_words(banks, unit, bank, address, &[next]);
            }
        }
        Action::Randomize { unit, bank, address, min, max } => {
            let span = (max - min + 1).max(1);
            let value = min + (unit_random(rng_seed) * span as f64) as i64;
            place_words(banks, unit, bank, address, &[value as u16]);
        }
    }
}

/// The `(unit, bank, address)` an action writes to.
fn action_target(action: &Action) -> (u8, u8, u16) {
    match *action {
        Action::Set { unit, bank, address, .. }
        | Action::Inc { unit, bank, address, .. }
        | Action::Dec { unit, bank, address, .. }
        | Action::Toggle { unit, bank, address }
        | Action::Copy { unit, bank, address, .. }
        | Action::Randomize { unit, bank, address, .. } => (unit, bank, address),
    }
}

/// Read a multi-word register from the banks as a number, decoding across its
/// `word_count` addresses with `data_type`/`byte_order`. `None` if any word of
/// the span is absent.
fn read_typed(banks: &HashMap<u8, SimBanks>, unit: u8, bank: u8, addr: u16, data_type: &str, byte_order: &str) -> Option<f64> {
    let wc = word_count(data_type);
    let mut words = Vec::with_capacity(wc);
    for i in 0..wc as u16 {
        words.push(read_word(banks, unit, bank, addr.wrapping_add(i))?);
    }
    decode_value(data_type, byte_order, &words)
}

/// Apply a `TimedAction`'s effect. For single-word/bit targets (`data_type`
/// resolving to 1 word — the default) this delegates to `apply_action`, keeping
/// legacy behavior byte-for-byte. For multi-word targets it computes the numeric
/// result, encodes it across the register's words with `data_type`/`byte_order`,
/// and places them. `delay_ms` is handled by the caller (the tick scheduler),
/// not here.
pub fn apply_timed_action(banks: &mut HashMap<u8, SimBanks>, ta: &TimedAction, rng_seed: u64) {
    if word_count(&ta.data_type) <= 1 {
        apply_action(banks, &ta.action, rng_seed);
        return;
    }
    let dt = &ta.data_type;
    let bo = &ta.byte_order;
    let (unit, bank, address) = action_target(&ta.action);
    // Multi-word only applies to word banks (holding/input); bit banks are 1-word.
    let result: f64 = match &ta.action {
        Action::Set { value, .. } => *value as f64,
        Action::Inc { by, .. } => read_typed(banks, unit, bank, address, dt, bo).unwrap_or(0.0) + *by as f64,
        Action::Dec { by, .. } => read_typed(banks, unit, bank, address, dt, bo).unwrap_or(0.0) - *by as f64,
        Action::Randomize { min, max, .. } => {
            let span = (max - min + 1).max(1);
            (min + (unit_random(rng_seed) * span as f64) as i64) as f64
        }
        Action::Copy { src_unit, src_bank, src_addr, scale, offset, .. } => {
            match read_typed(banks, *src_unit, *src_bank, *src_addr, dt, bo) {
                Some(s) => s * scale + offset,
                None => return, // source absent → no-op (matches single-word Copy)
            }
        }
        // Toggle has no meaningful multi-word semantics — fall back to the
        // single-word toggle on the first word.
        Action::Toggle { .. } => { apply_action(banks, &ta.action, rng_seed); return; }
    };
    if let Ok(words) = encode_value(dt, bo, result) {
        place_words(banks, unit, bank, address, &words);
    }
}

/// Per-rule runtime state carried across ticks, keyed by `RuleDef.id`.
#[derive(Debug, Clone, Default)]
pub struct RuleState {
    pub next_due: f64,
    pub last_condition: bool,
    pub last_value: Option<i64>,
}

/// Evaluate a `Condition` trigger's comparison operator. `changed` compares
/// `cur` against the rule's previously-seen value rather than the trigger's
/// configured `value`.
fn compare(cur: i64, op: &str, value: i64, last_value: Option<i64>) -> bool {
    match op {
        "==" => cur == value,
        "!=" => cur != value,
        "<" => cur < value,
        ">" => cur > value,
        ">=" => cur >= value,
        "<=" => cur <= value,
        "changed" => Some(cur) != last_value,
        _ => false,
    }
}

/// Evaluate every rule's trigger against the current tick, returning the
/// `(rule_id, action)` pairs to apply, in the given rule order (callers pass
/// rules pre-sorted by `sort_order`). Rules with no existing `RuleState` get a
/// default one inserted (Interval `next_due: 0.0` fires at t=0).
///
/// - `Interval`: fires when `elapsed_ms >= next_due`, then reschedules
///   `next_due = elapsed_ms + ms`.
/// - `Condition`: edge-fired — reads the current word/bit, compares it, and
///   fires only on the false→true transition; `last_condition`/`last_value`
///   are updated every call (fired or not).
/// - `OnWrite`: fires if any drained write matches `unit`/`bank`, and either
///   `address` is `None` (match-any) or equals the write's address.
pub fn eval_rules(
    rules: &[RuleDef],
    states: &mut HashMap<i64, RuleState>,
    banks: &HashMap<u8, SimBanks>,
    elapsed_ms: f64,
    writes: &[(u8, u8, u16)],
) -> Vec<(i64, TimedAction)> {
    let mut out = Vec::new();
    for r in rules {
        let state = states.entry(r.id).or_default();
        let fired = match &r.trigger {
            Trigger::Interval { ms } => {
                if elapsed_ms >= state.next_due {
                    state.next_due = elapsed_ms + ms;
                    true
                } else {
                    false
                }
            }
            Trigger::Condition { unit, bank, address, op, value } => {
                let cur = read_word(banks, *unit, *bank, *address).unwrap_or(0) as i64;
                let c = compare(cur, op, *value, state.last_value);
                let fired = if op == "changed" {
                    // `changed` is itself a transition, not a level to be
                    // edge-gated: fire on every real change (but not on the
                    // very first observation, when there's no prior value).
                    state.last_value.is_some() && Some(cur) != state.last_value
                } else {
                    c && !state.last_condition
                };
                state.last_condition = c;
                state.last_value = Some(cur);
                fired
            }
            Trigger::OnWrite { unit, bank, address } => writes
                .iter()
                .any(|w| *unit == w.0 && *bank == w.1 && (address.is_none() || *address == Some(w.2))),
        };
        if fired {
            for action in &r.actions {
                out.push((r.id, action.clone()));
            }
        }
    }
    out
}

/// Expand stored registers into in-memory banks keyed by Unit ID.
///
/// Hold registers (Plan 1 behavior, unchanged): single-word numeric types
/// (u16/i16) and bit banks; `hold_value` is reduced to a 16-bit word (i16 via
/// two's complement) or a bit (!= 0).
///
/// Device/generator registers (Plan 2): parsed via `parse_dynamic`, encoded
/// via `encode_value` at `elapsed_ms = 0` (their initial/"t=0" value), and
/// placed across as many consecutive addresses as their data type occupies
/// via `place_words`.
pub fn registers_to_banks(regs: &[SimRegister]) -> HashMap<u8, SimBanks> {
    let mut out: HashMap<u8, SimBanks> = HashMap::new();
    for reg in regs {
        let unit = reg.unit_id as u8;
        let bank = reg.function_code as u8;
        let addr = reg.address as u16;
        if let Some(d) = parse_dynamic(reg) {
            // device/generator: place the t=0 value
            let val = dyn_value(&d, 0.0);
            match encode_value(&d.data_type, &d.byte_order, val) {
                Ok(words) => place_words(&mut out, unit, bank, addr, &words),
                Err(e) => log::warn!(
                    "simulator: skipping register unit={} fc={} addr={}: {}",
                    unit, bank, addr, e
                ),
            }
        } else {
            // hold: single word / bit (Plan 1 behavior)
            let b = out.entry(unit).or_default();
            match bank {
                1 => { b.coils.insert(addr, reg.hold_value != 0); }
                2 => { b.discrete_inputs.insert(addr, reg.hold_value != 0); }
                3 => { b.holding.insert(addr, reg.hold_value as u16); }
                4 => { b.input.insert(addr, reg.hold_value as u16); }
                _ => {}
            }
        }
    }
    out
}

use std::sync::Mutex;

use crate::db::open_workspace_db;
use crate::workspace::validate_workspace_name;

#[derive(Default)]
pub struct SimulatorState(pub Mutex<HashMap<String, SimEngine>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimStatus {
    pub running: bool,
    pub listen: Option<ListenInfo>,
    pub client_count: usize,
    /// Wall-clock start time (epoch ms) while running, for the uptime display.
    pub started_at_ms: Option<u64>,
    /// Currently-connected clients (the Clients list).
    pub clients: Vec<ClientInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimSnapshotRow {
    pub unit_id: u8,
    pub function_code: u8,
    pub address: u16,
    pub value_word: Option<u16>,
    pub value_bit: Option<bool>,
    /// Route-from-slave source status (`"ok"`/`"stale"`/`"missing"`); `None`
    /// for non-route registers (hold/generator/device).
    pub source_status: Option<String>,
}

/// Payload for the `simulator_values` event emitted by the tick task.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimValuesEvent {
    workspace: String,
    rows: Vec<SimSnapshotRow>,
}

/// Flatten configured banks into snapshot rows (one per configured address),
/// attaching `source_status` from `statuses` for matching (unit, bank/fc,
/// address) keys; `None` for registers with no tracked status (non-route).
fn rows_from_banks(
    map: &HashMap<u8, SimBanks>,
    statuses: &HashMap<(u8, u8, u16), &'static str>,
) -> Vec<SimSnapshotRow> {
    let mut rows = Vec::new();
    for (&unit, banks) in map {
        for (&address, &v) in &banks.coils {
            let source_status = statuses.get(&(unit, 1, address)).map(|s| s.to_string());
            rows.push(SimSnapshotRow { unit_id: unit, function_code: 1, address, value_word: None, value_bit: Some(v), source_status });
        }
        for (&address, &v) in &banks.discrete_inputs {
            let source_status = statuses.get(&(unit, 2, address)).map(|s| s.to_string());
            rows.push(SimSnapshotRow { unit_id: unit, function_code: 2, address, value_word: None, value_bit: Some(v), source_status });
        }
        for (&address, &v) in &banks.holding {
            let source_status = statuses.get(&(unit, 3, address)).map(|s| s.to_string());
            rows.push(SimSnapshotRow { unit_id: unit, function_code: 3, address, value_word: Some(v), value_bit: None, source_status });
        }
        for (&address, &v) in &banks.input {
            let source_status = statuses.get(&(unit, 4, address)).map(|s| s.to_string());
            rows.push(SimSnapshotRow { unit_id: unit, function_code: 4, address, value_word: Some(v), value_bit: None, source_status });
        }
    }
    rows
}

/// Snapshot the live banks (behind the shared `RwLock`) into rows for the
/// `simulator_values` event, attaching route source statuses. Both locks are
/// dropped before returning.
fn snapshot_rows(banks: &Banks, statuses: &StatusMap) -> Vec<SimSnapshotRow> {
    let Ok(guard) = banks.read() else { return Vec::new() };
    match statuses.lock() {
        Ok(s) => rows_from_banks(&guard, &s),
        Err(_) => rows_from_banks(&guard, &HashMap::new()),
    }
}

fn validate_config(cfg: &SimConfig) -> Result<(), String> {
    if !(1..=65535).contains(&cfg.port) {
        return Err(format!("port {} out of range (1-65535)", cfg.port));
    }
    if cfg.host != "0.0.0.0" && cfg.host != "127.0.0.1" {
        return Err(format!("host must be 0.0.0.0 or 127.0.0.1, got {}", cfg.host));
    }
    Ok(())
}

fn validate_register(reg: &SimRegister) -> Result<(), String> {
    if !(0..=255).contains(&reg.unit_id) {
        return Err(format!("unit id {} out of range (0-255)", reg.unit_id));
    }
    if !(1..=4).contains(&reg.function_code) {
        return Err("register type must be 1=coil, 2=discrete, 3=holding, 4=input".into());
    }
    if !(0..=65535).contains(&reg.address) {
        return Err(format!("address {} out of range (0-65535)", reg.address));
    }
    if !matches!(
        reg.data_type.as_str(),
        "bool" | "u16" | "i16" | "u32" | "i32" | "f32" | "u64" | "i64" | "f64"
    ) {
        return Err(format!(
            "unsupported data type '{}' (bool, u16, i16, u32, i32, f32, u64, i64, f64)",
            reg.data_type
        ));
    }
    if !matches!(reg.value_source.as_str(), "hold" | "device" | "generator" | "route") {
        return Err(format!(
            "unsupported value source '{}' (Plan 3: hold, device, generator, route)",
            reg.value_source
        ));
    }
    if reg.value_source == "hold" && !matches!(reg.data_type.as_str(), "bool" | "u16" | "i16") {
        return Err(format!(
            "hold value source only supports data type 'bool', 'u16', or 'i16', got '{}'",
            reg.data_type
        ));
    }
    if reg.value_source != "hold" && reg.data_type == "bool" {
        return Err(
            "data type 'bool' is only valid for Hold registers; use u16 for coil/discrete generators".into(),
        );
    }
    // byte order must be applicable to the type's word count. Word/half swaps
    // only mean something on multi-word types; the HALF_SWAP family is 4-word
    // only (matches the frontend codec's supported orders per width).
    let order = reg.byte_order.trim().to_uppercase();
    let words = word_count(&reg.data_type);
    let order_valid = match words {
        1 => matches!(order.as_str(), "ABCD" | "BADC"),
        2 => matches!(order.as_str(), "ABCD" | "BADC" | "CDAB" | "DCBA"),
        4 => matches!(
            order.as_str(),
            "ABCD" | "BADC" | "CDAB" | "DCBA"
                | "HALF_SWAP" | "HALF_SWAP_BS" | "INTRA_HALF_SWAP" | "INTRA_HALF_SWAP_BS"
        ),
        _ => false,
    };
    if !order_valid {
        return Err(format!(
            "byte order '{}' invalid for {}-word type '{}'",
            reg.byte_order, words, reg.data_type
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn simulator_get_config(app: tauri::AppHandle, name: String) -> Result<SimConfig, String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    db_get_config(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn simulator_set_config(app: tauri::AppHandle, name: String, config: SimConfig) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    validate_config(&config)?;
    let conn = open_workspace_db(&app, &ws)?;
    db_set_config(&conn, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn simulator_list_registers(app: tauri::AppHandle, name: String) -> Result<Vec<SimRegister>, String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    db_list_registers(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn simulator_add_register(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
    register: SimRegister,
) -> Result<i64, String> {
    let ws = validate_workspace_name(&name)?;
    validate_register(&register)?;
    let conn = open_workspace_db(&app, &ws)?;
    let id = db_insert_register(&conn, &register).map_err(|e| e.to_string())?;
    apply_to_running(&state, &ws, &register, false);
    refresh_running_config(&app, &state, &conn, &ws);
    Ok(id)
}

#[tauri::command]
pub fn simulator_update_register(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
    register: SimRegister,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    validate_register(&register)?;
    let conn = open_workspace_db(&app, &ws)?;
    db_update_register(&conn, &register).map_err(|e| e.to_string())?;
    apply_to_running(&state, &ws, &register, false);
    refresh_running_config(&app, &state, &conn, &ws);
    Ok(())
}

#[tauri::command]
pub fn simulator_delete_register(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
    id: i64,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    // capture identity before delete so we can remove it from live banks
    let existing = db_list_registers(&conn).map_err(|e| e.to_string())?
        .into_iter().find(|r| r.id == id);
    db_delete_register(&conn, id).map_err(|e| e.to_string())?;
    if let Some(reg) = existing {
        apply_to_running(&state, &ws, &reg, true);
        // A device is just a grouping of its registers — once the last one is
        // deleted, remove the now-empty device instead of leaving a phantom.
        if let Some(device_id) = reg.device_instance_id {
            let remaining = db_list_registers_for_device(&conn, device_id).map_err(|e| e.to_string())?;
            if remaining.is_empty() {
                db_delete_device(&conn, device_id).map_err(|e| e.to_string())?;
            }
        }
    }
    refresh_running_config(&app, &state, &conn, &ws);
    Ok(())
}

#[tauri::command]
pub fn simulator_list_rules(app: tauri::AppHandle, name: String) -> Result<Vec<SimRule>, String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    db_list_rules(&conn).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn simulator_add_rule(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
    rule: SimRule,
) -> Result<i64, String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    let id = db_insert_rule(&conn, &rule).map_err(|e| e.to_string())?;
    refresh_running_config(&app, &state, &conn, &ws);
    Ok(id)
}
#[tauri::command]
pub fn simulator_update_rule(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
    rule: SimRule,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    db_update_rule(&conn, &rule).map_err(|e| e.to_string())?;
    refresh_running_config(&app, &state, &conn, &ws);
    Ok(())
}
#[tauri::command]
pub fn simulator_delete_rule(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
    id: i64,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    db_delete_rule(&conn, id).map_err(|e| e.to_string())?;
    refresh_running_config(&app, &state, &conn, &ws);
    Ok(())
}

fn apply_to_running(state: &tauri::State<'_, SimulatorState>, ws: &str, reg: &SimRegister, remove: bool) {
    let map = state.0.lock().unwrap();
    if let Some(engine) = map.get(ws) {
        if !engine.is_running() { return; }
        let bank = reg.function_code as u8;
        let unit = reg.unit_id as u8;
        let addr = reg.address as u16;
        if remove {
            // Covers both hold (1 word) and dynamic (multi-word) registers.
            engine.clear_span(unit, bank, addr, word_count(&reg.data_type) as u16);
            return;
        }
        if reg.value_source == "hold" {
            let (word, bit) = if bank == 1 || bank == 2 {
                (None, Some(reg.hold_value != 0))
            } else {
                (Some(reg.hold_value as u16), None)
            };
            engine.apply_register_change(unit, bank, addr, word, bit);
        } else if let Some(d) = parse_dynamic(reg) {
            // Device/generator: seed the full-width t=0 value immediately so
            // there's no illegal-address gap before the next tick.
            // `refresh_running_config` updates the tick's live list so it then
            // animates without a Stop/Start.
            if let Ok(words) = encode_value(&d.data_type, &d.byte_order, dyn_value(&d, 0.0)) {
                engine.apply_words(unit, bank, addr, &words);
            }
        }
    }
}

/// Re-derive the live generator/route + rule lists from the DB and push them to
/// a running engine so config edits take effect on the next tick (no Stop/Start).
/// No-op when the workspace's simulator isn't running.
fn refresh_running_config(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, SimulatorState>,
    conn: &Connection,
    ws: &str,
) {
    let map = state.0.lock().unwrap();
    let Some(engine) = map.get(ws) else { return };
    if !engine.is_running() {
        return;
    }
    if let Ok(regs) = db_list_registers(conn) {
        let mut dynamics: Vec<DynReg> = regs.iter().filter_map(parse_dynamic).collect();
        // Resolve each route register's on-wire source address, mirroring Start.
        for d in dynamics.iter_mut() {
            if let DynKind::Route { slave_unit, connection_kind, src_addr, .. } = &mut d.kind {
                let (_id, offset) = crate::modbus::lookup_slave_id_and_address_offset(
                    app, ws, *slave_unit as i64, connection_kind,
                );
                *src_addr = (*src_addr as i64 + offset).clamp(0, 65535) as u16;
            }
        }
        engine.set_dynamics(dynamics);
    }
    if let Ok(rules_raw) = db_list_rules(conn) {
        let rules: Vec<RuleDef> = rules_raw.iter().filter_map(parse_rule).collect();
        engine.set_rules(rules);
    }
}

#[tauri::command]
pub async fn simulator_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    modbus: tauri::State<'_, crate::modbus::ModbusState>,
    name: String,
) -> Result<SimStatus, String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    let cfg = db_get_config(&conn).map_err(|e| e.to_string())?;
    validate_config(&cfg)?;
    let regs = db_list_registers(&conn).map_err(|e| e.to_string())?;
    let banks = registers_to_banks(&regs);
    let mut dynamics: Vec<DynReg> = regs.iter().filter_map(parse_dynamic).collect();
    let mut rules: Vec<RuleDef> = db_list_rules(&conn)
        .map_err(|e| e.to_string())?
        .iter()
        .filter_map(parse_rule)
        .collect();
    rules.sort_by_key(|r| r.sort_order);

    // Resolve each route register's on-wire source address once at start:
    // user-facing source address + the source slave's configured
    // address_offset, the same mapping manual reads use.
    // Note: the source slave's address_offset is captured once here, at Start.
    // Editing that slave's offset while the simulator is running has no effect
    // until the next Start; the live connection itself, though, IS re-resolved
    // on every tick.
    for d in dynamics.iter_mut() {
        if let DynKind::Route { slave_unit, connection_kind, src_addr, .. } = &mut d.kind {
            let (_id, offset) = crate::modbus::lookup_slave_id_and_address_offset(
                &app, &ws, *slave_unit as i64, connection_kind,
            );
            *src_addr = (*src_addr as i64 + offset).clamp(0, 65535) as u16;
        }
    }

    // Establish the route source client session(s) up front so route registers
    // can read immediately on Start — routing no longer depends on the
    // slave/client page being actively connected. Reuses an existing shared
    // session when present (a serial port is never opened twice). Non-fatal:
    // the server still starts; an unreachable source just shows as MISSING, and
    // the reason is logged to the workspace log. Deduped per connection kind
    // (one session per workspace per kind serves every unit).
    {
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for d in dynamics.iter() {
            let DynKind::Route { slave_unit, connection_kind, .. } = &d.kind else { continue };
            if !seen.insert(connection_kind.clone()) { continue; }
            if let Err(e) = crate::modbus::ensure_route_session(
                &modbus, &app, &ws, connection_kind, *slave_unit as i64,
            ).await {
                let _ = crate::logs::log_event(
                    app.clone(),
                    crate::logs::LogEventInput {
                        scope: "workspace".into(),
                        level: "warn".into(),
                        workspace_name: Some(ws.clone()),
                        source: "simulator".into(),
                        message: format!(
                            "Route source connection failed ({connection_kind}); routed registers will show MISSING until it is reachable: {e}"
                        ),
                        details_json: None,
                    },
                );
            }
        }
    }

    // Take the engine out of the map to start it without holding the lock across await.
    let mut engine = {
        let mut map = state.0.lock().unwrap();
        map.remove(&ws).unwrap_or_default()
    };
    let result = engine.start(
        app.clone(),
        ws.clone(),
        &cfg.host,
        cfg.port as u16,
        cfg.tick_ms as u64,
        banks,
        dynamics,
        modbus.tcp_sessions.clone(),
        modbus.rtu_sessions.clone(),
        rules,
    ).await;
    let status = match &result {
        Ok(info) => SimStatus {
            running: true,
            listen: Some(info.clone()),
            client_count: engine.client_count(),
            started_at_ms: engine.started_at_ms(),
            clients: engine.client_list(),
        },
        Err(_) => SimStatus { running: false, listen: None, client_count: 0, started_at_ms: None, clients: Vec::new() },
    };
    {
        let mut map = state.0.lock().unwrap();
        map.insert(ws, engine);
    }
    result.map(|_| status)
}

#[tauri::command]
pub async fn simulator_stop(
    state: tauri::State<'_, SimulatorState>,
    name: String,
) -> Result<(), String> {
    let ws = validate_workspace_name(&name)?;
    let mut engine = {
        let mut map = state.0.lock().unwrap();
        map.remove(&ws)
    };
    if let Some(engine) = engine.as_mut() {
        engine.stop().await;
    }
    if let Some(engine) = engine {
        state.0.lock().unwrap().insert(ws, engine);
    }
    Ok(())
}

#[tauri::command]
pub fn simulator_status(state: tauri::State<'_, SimulatorState>, name: String) -> Result<SimStatus, String> {
    let ws = validate_workspace_name(&name)?;
    let map = state.0.lock().unwrap();
    let status = match map.get(&ws) {
        Some(engine) if engine.is_running() => SimStatus {
            running: true,
            listen: None,
            client_count: engine.client_count(),
            started_at_ms: engine.started_at_ms(),
            clients: engine.client_list(),
        },
        _ => SimStatus { running: false, listen: None, client_count: 0, started_at_ms: None, clients: Vec::new() },
    };
    Ok(status)
}

/// The simulator event log for a workspace (server lifecycle + client
/// connect/disconnect), oldest first. Empty if the simulator has never run this
/// session.
#[tauri::command]
pub fn simulator_events(state: tauri::State<'_, SimulatorState>, name: String) -> Result<Vec<SimEvent>, String> {
    let ws = validate_workspace_name(&name)?;
    let map = state.0.lock().unwrap();
    Ok(map.get(&ws).map(|e| e.events()).unwrap_or_default())
}

/// A portable snapshot of a workspace's entire simulator setup — config +
/// devices + registers + rules — for export/import (backup or move between
/// workspaces). IDs are exported as-is and remapped on import.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimProfile {
    #[serde(default = "profile_version")]
    pub version: u32,
    pub config: SimConfig,
    #[serde(default)]
    pub devices: Vec<SimDevice>,
    #[serde(default)]
    pub registers: Vec<SimRegister>,
    #[serde(default)]
    pub rules: Vec<SimRule>,
}

fn profile_version() -> u32 { 1 }

/// Gather the whole workspace simulator setup from the DB.
fn build_profile(conn: &Connection) -> rusqlite::Result<SimProfile> {
    Ok(SimProfile {
        version: profile_version(),
        config: db_get_config(conn)?,
        devices: db_list_devices(conn)?,
        registers: db_list_registers(conn)?,
        rules: db_list_rules(conn)?,
    })
}

/// Replace the DB's simulator setup with `profile`: validate every register,
/// clear the existing config/devices/registers/rules, then repopulate with
/// fresh IDs, remapping each register's `device_instance_id` to the device's
/// new ID so device grouping survives the round-trip.
fn apply_profile(conn: &Connection, profile: &SimProfile) -> Result<(), String> {
    for reg in &profile.registers {
        validate_register(reg)?;
    }
    for r in db_list_registers(conn).map_err(|e| e.to_string())? {
        db_delete_register(conn, r.id).map_err(|e| e.to_string())?;
    }
    for d in db_list_devices(conn).map_err(|e| e.to_string())? {
        db_delete_device(conn, d.id).map_err(|e| e.to_string())?;
    }
    for rl in db_list_rules(conn).map_err(|e| e.to_string())? {
        db_delete_rule(conn, rl.id).map_err(|e| e.to_string())?;
    }
    db_set_config(conn, &profile.config).map_err(|e| e.to_string())?;
    let mut id_map: HashMap<i64, i64> = HashMap::new();
    for d in &profile.devices {
        let mut nd = d.clone();
        let old = nd.id;
        nd.id = 0;
        let new_id = db_insert_device(conn, &nd).map_err(|e| e.to_string())?;
        id_map.insert(old, new_id);
    }
    for reg in &profile.registers {
        let mut nr = reg.clone();
        nr.id = 0;
        // `db_insert_register` doesn't persist the device link, so set it with a
        // follow-up UPDATE (the same two-step the device-add path uses).
        let linked = reg.device_instance_id.and_then(|old| id_map.get(&old).copied());
        nr.device_instance_id = linked;
        let new_reg_id = db_insert_register(conn, &nr).map_err(|e| e.to_string())?;
        if let Some(dev) = linked {
            conn.execute(
                "UPDATE sim_registers SET device_instance_id = ?1 WHERE id = ?2",
                rusqlite::params![dev, new_reg_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    for rule in &profile.rules {
        let mut nrule = rule.clone();
        nrule.id = 0;
        db_insert_rule(conn, &nrule).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Export the whole workspace simulator setup to a JSON file. Opens a native
/// save dialog (Rust backend) and writes the pretty JSON to the chosen path.
/// Returns `true` if saved, `false` if the dialog was cancelled. `async` so it
/// runs off the main thread (the blocking dialog dispatches to the UI thread).
#[tauri::command]
pub async fn simulator_export_profile(app: tauri::AppHandle, name: String) -> Result<bool, String> {
    let ws = validate_workspace_name(&name)?;
    let conn = open_workspace_db(&app, &ws)?;
    let profile = build_profile(&conn).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("Simulator Profile", &["json"])
        .set_file_name(format!("{ws}-simulator.json"))
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("failed to write file: {e}"))?;
    Ok(true)
}

/// Replace the workspace's simulator setup with a profile chosen via a native
/// open dialog (Rust backend). Requires the simulator to be STOPPED. Returns
/// `true` if imported, `false` if cancelled.
#[tauri::command]
pub async fn simulator_import_profile(
    app: tauri::AppHandle,
    state: tauri::State<'_, SimulatorState>,
    name: String,
) -> Result<bool, String> {
    let ws = validate_workspace_name(&name)?;
    {
        let map = state.0.lock().unwrap();
        if map.get(&ws).map(|e| e.is_running()).unwrap_or(false) {
            return Err("Stop the simulator before importing a profile.".into());
        }
    }
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("Simulator Profile", &["json"])
        .blocking_pick_file()
    else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let json = std::fs::read_to_string(&path).map_err(|e| format!("failed to read file: {e}"))?;
    let profile: SimProfile =
        serde_json::from_str(&json).map_err(|e| format!("invalid profile JSON: {e}"))?;
    let conn = open_workspace_db(&app, &ws)?;
    apply_profile(&conn, &profile)?;
    Ok(true)
}

#[tauri::command]
pub fn simulator_snapshot(state: tauri::State<'_, SimulatorState>, name: String) -> Result<Vec<SimSnapshotRow>, String> {
    let ws = validate_workspace_name(&name)?;
    let map = state.0.lock().unwrap();
    let rows = match map.get(&ws) {
        Some(engine) => rows_from_banks(&engine.snapshot(), &engine.statuses()),
        None => Vec::new(),
    };
    Ok(rows)
}

/// Read `qty` raw words starting at `start` from a live client session, over
/// function code `fc` (1=coils, 2=discrete inputs, 3=holding, 4=input),
/// addressed to `unit`. Reused by route-from-slave (Plan 3) so a routed
/// register mirrors exactly what a real master would see. Coil/discrete bit
/// results are mapped to `u16` 0/1 to keep the return type uniform. Timeout,
/// transport, and Modbus-exception errors are all normalized to `Err(String)`.
pub async fn route_read_words(
    session: std::sync::Arc<tokio::sync::Mutex<tokio_modbus::client::Context>>,
    unit: u8,
    fc: u8,
    start: u16,
    qty: u16,
    timeout_ms: u64,
) -> Result<Vec<u16>, String> {
    use tokio::time::timeout;
    let mut ctx = session.lock().await;
    ctx.set_slave(tokio_modbus::prelude::Slave(unit));
    let dur = Duration::from_millis(timeout_ms.max(50));
    let words = match fc {
        3 => timeout(dur, ctx.read_holding_registers(start, qty)).await,
        4 => timeout(dur, ctx.read_input_registers(start, qty)).await,
        1 | 2 => {
            let res = if fc == 1 {
                timeout(dur, ctx.read_coils(start, qty)).await
            } else {
                timeout(dur, ctx.read_discrete_inputs(start, qty)).await
            };
            let bits = res
                .map_err(|_| format!("route read timed out after {timeout_ms} ms"))?
                .map_err(|e| format!("route read transport error: {e}"))?
                .map_err(|e| format!("route read modbus exception: {e}"))?;
            return Ok(bits.into_iter().map(|b| if b { 1u16 } else { 0u16 }).collect());
        }
        other => return Err(format!("unsupported route function code {other}")),
    };
    let out = words
        .map_err(|_| format!("route read timed out after {timeout_ms} ms"))?
        .map_err(|e| format!("route read transport error: {e}"))?
        .map_err(|e| format!("route read modbus exception: {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// No-op `ValuesSink` for tests: `SimEngine::start` requires a sink, but
    /// most tests only care about server/tick bank behavior, not the emitted
    /// event. Avoids `tauri::test::mock_app()` (see `ValuesSink` doc comment).
    struct NoopSink;
    impl ValuesSink for NoopSink {
        fn emit_values(&self, _event: SimValuesEvent) {}
    }

    fn banks_with(holding: &[(u16, u16)], coils: &[(u16, bool)]) -> SimBanks {
        let mut b = SimBanks::default();
        for &(a, v) in holding { b.holding.insert(a, v); }
        for &(a, v) in coils { b.coils.insert(a, v); }
        b
    }

    #[test]
    fn reads_configured_holding_registers() {
        let b = banks_with(&[(257, 3), (258, 19200)], &[]);
        assert_eq!(b.read_holding(257, 2).unwrap(), vec![3, 19200]);
    }

    #[test]
    fn reading_an_unconfigured_address_is_illegal() {
        let b = banks_with(&[(257, 3)], &[]);
        assert_eq!(b.read_holding(0, 1), Err(ExceptionCode::IllegalDataAddress));
        // partially-configured range also fails
        assert_eq!(b.read_holding(257, 2), Err(ExceptionCode::IllegalDataAddress));
    }

    #[test]
    fn writing_a_configured_holding_register_sticks() {
        let mut b = banks_with(&[(10, 0)], &[]);
        b.write_single_register(10, 1234).unwrap();
        assert_eq!(b.read_holding(10, 1).unwrap(), vec![1234]);
    }

    #[test]
    fn writing_an_unconfigured_register_is_illegal() {
        let mut b = SimBanks::default();
        assert_eq!(b.write_single_register(5, 1), Err(ExceptionCode::IllegalDataAddress));
    }

    #[test]
    fn coils_round_trip() {
        let mut b = banks_with(&[], &[(0, false), (1, false)]);
        b.write_multiple_coils(0, &[true, true]).unwrap();
        assert_eq!(b.read_coils(0, 2).unwrap(), vec![true, true]);
    }

    use std::collections::HashMap as Map;

    fn two_unit_banks() -> Map<u8, SimBanks> {
        let mut m = Map::new();
        let mut u1 = SimBanks::default();
        u1.holding.insert(0, 111);
        let mut u2 = SimBanks::default();
        u2.holding.insert(0, 222);
        u2.holding.insert(1, 0); // writable target
        m.insert(1, u1);
        m.insert(2, u2);
        m
    }

    #[tokio::test]
    async fn serves_and_routes_by_unit_id() {
        let mut engine = SimEngine::new();
        // port 0 → OS-assigned ephemeral port
        let info = engine.start(NoopSink, "ws".into(), "127.0.0.1", 0, 100, two_unit_banks(), Vec::new(), Default::default(), Default::default(), Vec::new()).await.unwrap();
        let addr: std::net::SocketAddr = info.bound.parse().unwrap();

        // Unit 1 → 111
        let mut c1 = tokio_modbus::client::tcp::connect_slave(addr, Slave(1)).await.unwrap();
        assert_eq!(c1.read_holding_registers(0, 1).await.unwrap().unwrap(), vec![111]);

        // Unit 2 → 222, and a write sticks
        let mut c2 = tokio_modbus::client::tcp::connect_slave(addr, Slave(2)).await.unwrap();
        assert_eq!(c2.read_holding_registers(0, 1).await.unwrap().unwrap(), vec![222]);
        c2.write_single_register(1, 4321).await.unwrap().unwrap();
        assert_eq!(c2.read_holding_registers(1, 1).await.unwrap().unwrap(), vec![4321]);

        // Reading an unconfigured address → Modbus exception (Err inner result)
        assert!(c1.read_holding_registers(50, 1).await.unwrap().is_err());

        engine.stop().await;
        assert!(!engine.is_running());
    }

    #[tokio::test]
    async fn client_count_tracks_connections() {
        use std::time::Duration;
        use tokio::time::sleep;

        let mut engine = SimEngine::new();
        let info = engine.start(NoopSink, "ws".into(), "127.0.0.1", 0, 100, two_unit_banks(), Vec::new(), Default::default(), Default::default(), Vec::new()).await.unwrap();
        let addr: std::net::SocketAddr = info.bound.parse().unwrap();

        // Connect one client and do a successful read to ensure the connection
        // is fully accepted by the server.
        let mut client = tokio_modbus::client::tcp::connect_slave(addr, Slave(1)).await.unwrap();
        let _ = client.read_holding_registers(0, 1).await.unwrap().unwrap();

        // Poll until client_count reaches 1 (accept is async, slightly after connect).
        let mut count = 0usize;
        for _ in 0..20 {
            count = engine.client_count();
            if count == 1 {
                break;
            }
            sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(count, 1, "expected 1 active connection after connect");

        // Drop the client to close the TCP connection.
        drop(client);

        // Poll until client_count returns to 0 (Drop fires when per-connection task ends).
        for _ in 0..20 {
            if engine.client_count() == 0 {
                break;
            }
            sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(engine.client_count(), 0, "expected 0 active connections after disconnect");

        engine.stop().await;
    }

    #[tokio::test]
    async fn observer_tracks_clients_events_and_uptime() {
        use std::time::Duration;
        use tokio::time::sleep;

        let mut engine = SimEngine::new();
        assert!(engine.started_at_ms().is_none());
        let info = engine.start(NoopSink, "ws".into(), "127.0.0.1", 0, 100, two_unit_banks(), Vec::new(), Default::default(), Default::default(), Vec::new()).await.unwrap();
        let addr: std::net::SocketAddr = info.bound.parse().unwrap();
        assert!(engine.started_at_ms().is_some(), "uptime start time set on Start");

        let mut client = tokio_modbus::client::tcp::connect_slave(addr, Slave(1)).await.unwrap();
        let _ = client.read_holding_registers(0, 1).await.unwrap().unwrap();

        // Wait for the connection to register.
        let mut list = Vec::new();
        for _ in 0..20 {
            list = engine.client_list();
            if !list.is_empty() { break; }
            sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(list.len(), 1, "one client in the list");
        assert!(!list[0].addr.is_empty(), "client addr recorded");

        let events = engine.events();
        assert!(events.iter().any(|e| e.kind == "started"), "started event logged");
        assert!(events.iter().any(|e| e.kind == "clientConnected"), "connect event logged");

        drop(client);
        for _ in 0..20 {
            if engine.client_list().is_empty() { break; }
            sleep(Duration::from_millis(25)).await;
        }
        assert!(engine.client_list().is_empty(), "client removed on disconnect");
        assert!(engine.events().iter().any(|e| e.kind == "clientDisconnected"), "disconnect event logged");

        engine.stop().await;
        assert!(engine.started_at_ms().is_none(), "uptime cleared on Stop");
        assert!(engine.events().iter().any(|e| e.kind == "stopped"), "stopped event logged (history persists)");
    }

    use crate::models::{SimConfig, SimDevice, SimRegister};
    use rusqlite::Connection;

    fn mem_db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        create_sim_schema(&c).unwrap();
        c
    }

    #[test]
    fn config_round_trips_with_defaults() {
        let c = mem_db();
        let cfg = db_get_config(&c).unwrap();
        assert_eq!(cfg.port, 502);
        assert_eq!(cfg.host, "0.0.0.0");
        assert!(!cfg.enabled);

        db_set_config(&c, &SimConfig { enabled: true, host: "127.0.0.1".into(), port: 5502, tick_ms: 100 }).unwrap();
        let cfg = db_get_config(&c).unwrap();
        assert!(cfg.enabled);
        assert_eq!(cfg.port, 5502);
        assert_eq!(cfg.host, "127.0.0.1");
    }

    #[test]
    fn profile_export_import_round_trips_and_remaps_device_ids() {
        let c = mem_db();
        // A device with two registers + a standalone register + a rule.
        let dev_id = db_insert_device(&c, &SimDevice {
            id: 0, template_key: "temp_humidity".into(), name: "Sensor".into(),
            unit_id: 1, base_address: 0, enabled: true, sort_order: 0,
        }).unwrap();
        let reg = |addr: i64, alias: &str| SimRegister {
            id: 0, unit_id: 1, function_code: 4, address: addr, alias: alias.into(),
            data_type: "u16".into(), hold_value: 0, sort_order: 0, device_instance_id: None,
            value_source: "device".into(), byte_order: "ABCD".into(),
            source_params: "{\"preset\":\"temperature\"}".into(), interval_ms: 1000,
            unit: None, display_format: None,
        };
        // Insert + link the device registers the way the device-add path does.
        for addr in [0, 1] {
            let rid = db_insert_register(&c, &reg(addr, "R")).unwrap();
            c.execute("UPDATE sim_registers SET device_instance_id = ?1 WHERE id = ?2", rusqlite::params![dev_id, rid]).unwrap();
        }
        db_insert_register(&c, &SimRegister { value_source: "hold".into(), source_params: "{}".into(), ..reg(10, "Standalone") }).unwrap();
        db_insert_rule(&c, &SimRule {
            id: 0, name: "r".into(), enabled: true,
            trigger: "{\"type\":\"interval\",\"ms\":1000}".into(),
            actions: "[{\"type\":\"toggle\",\"unit\":1,\"bank\":1,\"address\":0}]".into(),
            sort_order: 0,
        }).unwrap();

        // Export → JSON → import into a FRESH db.
        let profile = build_profile(&c).unwrap();
        let json = serde_json::to_string(&profile).unwrap();

        let c2 = mem_db();
        let parsed: SimProfile = serde_json::from_str(&json).unwrap();
        apply_profile(&c2, &parsed).unwrap();

        let devs = db_list_devices(&c2).unwrap();
        assert_eq!(devs.len(), 1);
        let new_dev_id = devs[0].id;
        let regs = db_list_registers(&c2).unwrap();
        assert_eq!(regs.len(), 3);
        // The two device registers were relinked to the device's NEW id.
        let linked = regs.iter().filter(|r| r.device_instance_id == Some(new_dev_id)).count();
        assert_eq!(linked, 2, "both device registers relinked to the new device id");
        // The standalone register stays unlinked.
        assert_eq!(regs.iter().filter(|r| r.device_instance_id.is_none()).count(), 1);
        assert_eq!(db_list_rules(&c2).unwrap().len(), 1);
    }

    #[test]
    fn validate_template_checks_keys_and_registers() {
        let good = DeviceTemplate {
            template_key: "custom_x".into(), name: "X".into(), category: "Custom".into(),
            description: "".into(), icon: "📟".into(),
            registers: vec![TemplateRegister {
                offset: 0, bank: 4, data_type: "f32".into(), byte_order: "CDAB".into(),
                value_source: "device".into(), source_params: "{\"preset\":\"analog\"}".into(), alias: "V".into(),
            }],
        };
        assert!(validate_template(&good).is_ok());
        // Missing key.
        assert!(validate_template(&DeviceTemplate { template_key: "".into(), ..good.clone() }).is_err());
        // Bad register (u128 type).
        let bad_reg = DeviceTemplate {
            registers: vec![TemplateRegister { data_type: "u128".into(), ..good.registers[0].clone() }],
            ..good.clone()
        };
        assert!(validate_template(&bad_reg).is_err());
    }

    #[test]
    fn template_deserializes_with_defaults() {
        // A shared/minimal template JSON fills in sensible defaults.
        let t: DeviceTemplate = serde_json::from_str(
            r#"{"templateKey":"k","name":"N","registers":[{"offset":0,"bank":3}]}"#,
        ).unwrap();
        assert_eq!(t.category, "Custom");
        assert_eq!(t.icon, "📟");
        assert_eq!(t.registers[0].data_type, "u16");
        assert_eq!(t.registers[0].byte_order, "ABCD");
        assert_eq!(t.registers[0].value_source, "hold");
    }

    #[test]
    fn apply_profile_rejects_invalid_register() {
        let c = mem_db();
        let bad = SimProfile {
            version: 1,
            config: db_get_config(&c).unwrap(),
            devices: Vec::new(),
            registers: vec![SimRegister {
                id: 0, unit_id: 1, function_code: 3, address: 0, alias: "".into(),
                data_type: "u128".into(), hold_value: 0, sort_order: 0, device_instance_id: None,
                value_source: "generator".into(), byte_order: "ABCD".into(), source_params: "{}".into(),
                interval_ms: 1000, unit: None, display_format: None,
            }],
            rules: Vec::new(),
        };
        assert!(apply_profile(&c, &bad).is_err());
    }

    #[test]
    fn register_crud_round_trips() {
        let c = mem_db();
        let id = db_insert_register(&c, &SimRegister {
            id: 0, unit_id: 1, function_code: 3, address: 257,
            alias: "Device addr".into(), data_type: "u16".into(), hold_value: 3, sort_order: 0,
            device_instance_id: None,
            value_source: "hold".into(), byte_order: "ABCD".into(), source_params: "{}".into(), interval_ms: 1000,
            unit: None, display_format: None,
        }).unwrap();
        let mut rows = db_list_registers(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].hold_value, 3);

        rows[0].hold_value = 7;
        db_update_register(&c, &rows[0]).unwrap();
        assert_eq!(db_list_registers(&c).unwrap()[0].hold_value, 7);

        db_delete_register(&c, id).unwrap();
        assert!(db_list_registers(&c).unwrap().is_empty());
    }

    #[test]
    fn register_crud_round_trips_source_fields() {
        let c = mem_db();
        let id = db_insert_register(&c, &SimRegister {
            id: 0, unit_id: 1, function_code: 4, address: 10,
            alias: "temp".into(), data_type: "f32".into(), hold_value: 0,
            value_source: "device".into(), byte_order: "CDAB".into(),
            source_params: "{\"preset\":\"temperature\",\"min\":20,\"max\":30}".into(),
            interval_ms: 500, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        }).unwrap();
        let rows = db_list_registers(&c).unwrap();
        let r = rows.iter().find(|r| r.id == id).unwrap();
        assert_eq!(r.value_source, "device");
        assert_eq!(r.byte_order, "CDAB");
        assert_eq!(r.interval_ms, 500);
        assert!(r.source_params.contains("temperature"));
    }

    #[test]
    fn rule_crud_round_trips() {
        let c = mem_db();
        let id = db_insert_rule(&c, &SimRule {
            id: 0, name: "trip".into(), enabled: true,
            trigger: "{\"type\":\"interval\",\"ms\":1000}".into(),
            actions: "[{\"type\":\"toggle\",\"unit\":1,\"bank\":1,\"address\":0}]".into(),
            sort_order: 0,
        }).unwrap();
        let mut rows = db_list_rules(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "trip");
        rows[0].enabled = false;
        db_update_rule(&c, &rows[0]).unwrap();
        assert!(!db_list_rules(&c).unwrap()[0].enabled);
        db_delete_rule(&c, id).unwrap();
        assert!(db_list_rules(&c).unwrap().is_empty());
    }

    #[test]
    fn parses_a_rule() {
        let r = SimRule {
            id: 5, name: "x".into(), enabled: true,
            trigger: "{\"type\":\"condition\",\"unit\":1,\"bank\":3,\"address\":0,\"op\":\">=\",\"value\":100}".into(),
            actions: "[{\"type\":\"set\",\"unit\":1,\"bank\":1,\"address\":0,\"value\":1},{\"type\":\"inc\",\"unit\":1,\"bank\":3,\"address\":2,\"by\":5}]".into(),
            sort_order: 0,
        };
        let d = parse_rule(&r).unwrap();
        assert!(matches!(d.trigger, Trigger::Condition { value: 100, .. }));
        assert_eq!(d.actions.len(), 2);
        // disabled → None
        let off = SimRule { enabled: false, ..r.clone() };
        assert!(parse_rule(&off).is_none());
    }

    fn banks1(pairs: &[(u8, u8, u16, u16)]) -> HashMap<u8, SimBanks> {
        let mut m = HashMap::new();
        for &(u, b, a, v) in pairs { place_words(&mut m, u, b, a, &[v]); }
        m
    }

    fn timed(action: Action) -> TimedAction {
        TimedAction { action, delay_ms: 0.0, data_type: "u16".into(), byte_order: "ABCD".into() }
    }
    fn rule(id: i64, trig: Trigger, acts: Vec<Action>) -> RuleDef {
        RuleDef { id, enabled: true, trigger: trig, actions: acts.into_iter().map(timed).collect(), sort_order: id }
    }
    #[test]
    fn interval_fires_each_period() {
        let rules = vec![rule(1, Trigger::Interval { ms: 100.0 }, vec![Action::Toggle{unit:1,bank:1,address:0}])];
        let mut st = HashMap::new();
        let b = HashMap::new();
        assert_eq!(eval_rules(&rules, &mut st, &b, 0.0, &[]).len(), 1);   // due at t=0
        assert_eq!(eval_rules(&rules, &mut st, &b, 50.0, &[]).len(), 0);  // not yet
        assert_eq!(eval_rules(&rules, &mut st, &b, 100.0, &[]).len(), 1); // next period
    }
    #[test]
    fn condition_is_edge_fired() {
        let rules = vec![rule(1, Trigger::Condition{unit:1,bank:3,address:0,op:">=".into(),value:100}, vec![Action::Set{unit:1,bank:1,address:0,value:1}])];
        let mut st = HashMap::new();
        let below = banks1(&[(1,3,0,50)]);
        let above = banks1(&[(1,3,0,150)]);
        assert_eq!(eval_rules(&rules, &mut st, &below, 0.0, &[]).len(), 0);   // false
        assert_eq!(eval_rules(&rules, &mut st, &above, 10.0, &[]).len(), 1);  // false→true edge
        assert_eq!(eval_rules(&rules, &mut st, &above, 20.0, &[]).len(), 0);  // stays true, no re-fire
    }
    #[test]
    fn changed_fires_on_each_change() {
        let rules = vec![rule(1, Trigger::Condition{unit:1,bank:3,address:0,op:"changed".into(),value:0}, vec![Action::Inc{unit:1,bank:3,address:1,by:1}])];
        let mut st = HashMap::new();
        let v10 = banks1(&[(1,3,0,10)]);
        let v20 = banks1(&[(1,3,0,20)]);
        let v30 = banks1(&[(1,3,0,30)]);
        assert_eq!(eval_rules(&rules, &mut st, &v10, 0.0, &[]).len(), 0);  // first observation, no prior
        assert_eq!(eval_rules(&rules, &mut st, &v20, 10.0, &[]).len(), 1); // 10 -> 20: fires
        assert_eq!(eval_rules(&rules, &mut st, &v20, 20.0, &[]).len(), 0); // unchanged: no fire
        assert_eq!(eval_rules(&rules, &mut st, &v30, 30.0, &[]).len(), 1); // 20 -> 30: fires
    }
    #[test]
    fn on_write_matches_drained_write() {
        let rules = vec![rule(1, Trigger::OnWrite{unit:1,bank:3,address:Some(5)}, vec![Action::Inc{unit:1,bank:3,address:6,by:1}])];
        let mut st = HashMap::new();
        let b = HashMap::new();
        assert_eq!(eval_rules(&rules, &mut st, &b, 0.0, &[(1,3,5)]).len(), 1);
        assert_eq!(eval_rules(&rules, &mut st, &b, 0.0, &[(1,3,9)]).len(), 0);
    }

    #[test]
    fn action_set_inc_toggle() {
        let mut b = banks1(&[(1, 3, 0, 10), (1, 1, 0, 0)]);
        apply_action(&mut b, &Action::Set { unit: 1, bank: 3, address: 0, value: 42 }, 0);
        assert_eq!(read_word(&b, 1, 3, 0), Some(42));
        apply_action(&mut b, &Action::Inc { unit: 1, bank: 3, address: 0, by: 8 }, 0);
        assert_eq!(read_word(&b, 1, 3, 0), Some(50));
        apply_action(&mut b, &Action::Toggle { unit: 1, bank: 1, address: 0 }, 0);
        assert_eq!(read_word(&b, 1, 1, 0), Some(1));
    }

    #[test]
    fn action_copy_with_scale_offset() {
        let mut b = banks1(&[(1, 3, 0, 10), (1, 3, 1, 0)]);
        apply_action(&mut b, &Action::Copy {
            src_unit: 1, src_bank: 3, src_addr: 0, unit: 1, bank: 3, address: 1, scale: 2.0, offset: 1.0,
        }, 0);
        assert_eq!(read_word(&b, 1, 3, 1), Some(21)); // 10*2+1
    }

    #[test]
    fn action_inc_wraps() {
        let mut b = banks1(&[(1, 3, 0, 0xFFFF)]);
        apply_action(&mut b, &Action::Inc { unit: 1, bank: 3, address: 0, by: 2 }, 0);
        assert_eq!(read_word(&b, 1, 3, 0), Some(1)); // wraps
    }

    #[test]
    fn timed_action_sets_multi_word_register() {
        // A `set` targeting an f32 holding register writes 2 words (ABCD).
        let mut b = HashMap::new();
        let one = TimedAction {
            action: Action::Set { unit: 1, bank: 3, address: 10, value: 1 },
            delay_ms: 0.0, data_type: "f32".into(), byte_order: "ABCD".into(),
        };
        apply_timed_action(&mut b, &one, 0);
        // f32(1.0) = 0x3F80_0000 → words [0x3F80, 0x0000]
        assert_eq!(read_word(&b, 1, 3, 10), Some(0x3F80));
        assert_eq!(read_word(&b, 1, 3, 11), Some(0x0000));
    }

    #[test]
    fn timed_action_inc_reads_and_writes_multi_word() {
        // Seed an f32 register = 10.0, inc by 5 → 15.0.
        let mut b = HashMap::new();
        let seed = TimedAction { action: Action::Set { unit: 1, bank: 3, address: 0, value: 10 }, delay_ms: 0.0, data_type: "f32".into(), byte_order: "ABCD".into() };
        apply_timed_action(&mut b, &seed, 0);
        let inc = TimedAction { action: Action::Inc { unit: 1, bank: 3, address: 0, by: 5 }, ..seed.clone() };
        apply_timed_action(&mut b, &inc, 0);
        let got = read_typed(&b, 1, 3, 0, "f32", "ABCD").unwrap();
        assert!((got - 15.0).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn single_word_timed_action_matches_legacy() {
        // Default u16 timed action == apply_action (no multi-word path).
        let mut a = banks1(&[(1, 3, 0, 10)]);
        let mut b = banks1(&[(1, 3, 0, 10)]);
        let ta = TimedAction { action: Action::Inc { unit: 1, bank: 3, address: 0, by: 8 }, delay_ms: 0.0, data_type: "u16".into(), byte_order: "ABCD".into() };
        apply_timed_action(&mut a, &ta, 0);
        apply_action(&mut b, &ta.action, 0);
        assert_eq!(read_word(&a, 1, 3, 0), read_word(&b, 1, 3, 0));
    }

    #[test]
    fn parse_action_reads_delay_and_type() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"type":"set","unit":1,"bank":3,"address":0,"value":5,"delayMs":500,"dataType":"u32","byteOrder":"CDAB"}"#,
        ).unwrap();
        let ta = parse_action(&v).unwrap();
        assert_eq!(ta.delay_ms, 500.0);
        assert_eq!(ta.data_type, "u32");
        assert_eq!(ta.byte_order, "CDAB");
        // Defaults when omitted.
        let v2: serde_json::Value = serde_json::from_str(r#"{"type":"toggle","unit":1,"bank":1,"address":0}"#).unwrap();
        let ta2 = parse_action(&v2).unwrap();
        assert_eq!(ta2.delay_ms, 0.0);
        assert_eq!(ta2.data_type, "u16");
    }

    #[test]
    fn builds_banks_grouped_by_unit_and_function() {
        let regs = vec![
            SimRegister { id: 1, unit_id: 1, function_code: 3, address: 257, alias: "".into(), data_type: "u16".into(), hold_value: 3, sort_order: 0, device_instance_id: None, value_source: "hold".into(), byte_order: "ABCD".into(), source_params: "{}".into(), interval_ms: 1000, unit: None, display_format: None },
            SimRegister { id: 2, unit_id: 1, function_code: 4, address: 1, alias: "".into(), data_type: "u16".into(), hold_value: 250, sort_order: 0, device_instance_id: None, value_source: "hold".into(), byte_order: "ABCD".into(), source_params: "{}".into(), interval_ms: 1000, unit: None, display_format: None },
            SimRegister { id: 3, unit_id: 2, function_code: 1, address: 0, alias: "".into(), data_type: "bool".into(), hold_value: 1, sort_order: 0, device_instance_id: None, value_source: "hold".into(), byte_order: "ABCD".into(), source_params: "{}".into(), interval_ms: 1000, unit: None, display_format: None },
        ];
        let banks = registers_to_banks(&regs);
        assert_eq!(banks.get(&1).unwrap().holding.get(&257), Some(&3));
        assert_eq!(banks.get(&1).unwrap().input.get(&1), Some(&250));
        assert_eq!(banks.get(&2).unwrap().coils.get(&0), Some(&true));
    }

    #[test]
    fn i16_negative_stored_as_twos_complement_word() {
        let regs = vec![
            SimRegister { id: 1, unit_id: 1, function_code: 3, address: 0, alias: "".into(), data_type: "i16".into(), hold_value: -1, sort_order: 0, device_instance_id: None, value_source: "hold".into(), byte_order: "ABCD".into(), source_params: "{}".into(), interval_ms: 1000, unit: None, display_format: None },
        ];
        let banks = registers_to_banks(&regs);
        assert_eq!(banks.get(&1).unwrap().holding.get(&0), Some(&0xFFFF));
    }

    #[test]
    fn encodes_single_word_types() {
        assert_eq!(encode_value("u16", "ABCD", 300.0).unwrap(), vec![0x012C]);
        assert_eq!(encode_value("u16", "BADC", 300.0).unwrap(), vec![0x2C01]); // byte swap
        assert_eq!(encode_value("i16", "ABCD", -1.0).unwrap(), vec![0xFFFF]);
    }

    #[test]
    fn encodes_u32_all_orders() {
        let v = 0x1234_5678u32 as f64;
        assert_eq!(encode_value("u32", "ABCD", v).unwrap(), vec![0x1234, 0x5678]);
        assert_eq!(encode_value("u32", "BADC", v).unwrap(), vec![0x3412, 0x7856]);
        assert_eq!(encode_value("u32", "CDAB", v).unwrap(), vec![0x5678, 0x1234]);
        assert_eq!(encode_value("u32", "DCBA", v).unwrap(), vec![0x7856, 0x3412]);
    }

    #[test]
    fn encodes_f32_all_orders() {
        assert_eq!(encode_value("f32", "ABCD", 1.0).unwrap(), vec![0x3F80, 0x0000]);
        assert_eq!(encode_value("f32", "CDAB", 1.0).unwrap(), vec![0x0000, 0x3F80]);
        assert_eq!(encode_value("f32", "BADC", 1.0).unwrap(), vec![0x803F, 0x0000]);
        assert_eq!(encode_value("f32", "DCBA", 1.0).unwrap(), vec![0x0000, 0x803F]);
    }

    #[test]
    fn word_count_matches_type() {
        assert_eq!(word_count("u16"), 1);
        assert_eq!(word_count("i16"), 1);
        assert_eq!(word_count("f32"), 2);
        assert_eq!(word_count("u32"), 2);
        assert_eq!(word_count("u64"), 4);
        assert_eq!(word_count("i64"), 4);
        assert_eq!(word_count("f64"), 4);
    }

    #[test]
    fn encodes_four_word_types_all_orders() {
        // u64 with distinct bytes so every reorder is observable. Value stays
        // under 2^53 so it round-trips exactly through the f64 value channel.
        let v = 0x0001_0203_0405_0607u64 as f64;
        assert_eq!(encode_value("u64", "ABCD", v).unwrap(), vec![0x0001, 0x0203, 0x0405, 0x0607]);
        assert_eq!(encode_value("u64", "CDAB", v).unwrap(), vec![0x0607, 0x0405, 0x0203, 0x0001]);
        assert_eq!(encode_value("u64", "HALF_SWAP", v).unwrap(), vec![0x0405, 0x0607, 0x0001, 0x0203]);
        assert_eq!(encode_value("u64", "INTRA_HALF_SWAP", v).unwrap(), vec![0x0203, 0x0001, 0x0607, 0x0405]);
        assert_eq!(encode_value("u64", "BADC", v).unwrap(), vec![0x0100, 0x0302, 0x0504, 0x0706]);
        // f64 1.0 = 0x3FF0000000000000
        assert_eq!(encode_value("f64", "ABCD", 1.0).unwrap(), vec![0x3FF0, 0x0000, 0x0000, 0x0000]);
    }

    #[test]
    fn encode_is_forgiving_but_rejects_unknown_type() {
        // Unknown data type is the only hard error.
        assert!(encode_value("u128", "ABCD", 1.0).is_err());
        // A word-swap order on a 1-word type is a silent no-op (matches the
        // frontend codec), not an error.
        assert_eq!(encode_value("u16", "CDAB", 300.0).unwrap(), vec![0x012C]);
    }

    #[test]
    fn decode_round_trips_every_type_and_order() {
        for dt in ["u16", "i16", "u32", "i32", "f32", "u64", "i64", "f64"] {
            for order in ["ABCD", "BADC", "CDAB", "DCBA", "HALF_SWAP", "INTRA_HALF_SWAP"] {
                let v = 42.0;
                let words = encode_value(dt, order, v).unwrap();
                let back = decode_value(dt, order, &words).unwrap();
                assert!((back - v).abs() < 1e-6, "round-trip failed for {dt}/{order}: {back}");
            }
        }
        // Too few words → None.
        assert!(decode_value("u32", "ABCD", &[0x1234]).is_none());
    }

    #[test]
    fn sine_stays_in_range_and_varies() {
        let p = GenParams { min: 0.0, max: 100.0, period_ms: 1000.0 };
        let a = generator_value("sine", &p, 0.0, 0);
        let b = generator_value("sine", &p, 250.0, 0); // quarter period → peak
        assert!((a - 50.0).abs() < 1e-6);   // sine starts mid-range
        assert!((b - 100.0).abs() < 1e-6);  // quarter period → max
        for t in [0.0, 123.0, 500.0, 999.0] {
            let v = generator_value("sine", &p, t, 0);
            assert!(v >= 0.0 && v <= 100.0);
        }
    }

    #[test]
    fn ramp_is_sawtooth() {
        let p = GenParams { min: 0.0, max: 10.0, period_ms: 1000.0 };
        assert!((generator_value("ramp", &p, 0.0, 0) - 0.0).abs() < 1e-6);
        assert!((generator_value("ramp", &p, 500.0, 0) - 5.0).abs() < 1e-6);
        assert!(generator_value("ramp", &p, 1000.0, 0) < 1e-6); // wraps to 0
    }

    #[test]
    fn decrement_is_reverse_sawtooth() {
        let p = GenParams { min: 0.0, max: 10.0, period_ms: 1000.0 };
        assert!((generator_value("decrement", &p, 0.0, 0) - 10.0).abs() < 1e-6); // starts at max
        assert!((generator_value("decrement", &p, 500.0, 0) - 5.0).abs() < 1e-6); // half → midpoint
        // approaches min at the end of the period
        assert!(generator_value("decrement", &p, 999.0, 0) < 0.5);
        for t in [0.0, 250.0, 750.0, 1500.0] {
            let v = generator_value("decrement", &p, t, 0);
            assert!(v >= 0.0 && v <= 10.0);
        }
    }

    #[test]
    fn step_is_integer_staircase() {
        let p = GenParams { min: 0.0, max: 3.0, period_ms: 1000.0 };
        assert_eq!(generator_value("step", &p, 0.0, 0), 0.0);
        assert_eq!(generator_value("step", &p, 1000.0, 0), 1.0);
        assert_eq!(generator_value("step", &p, 2500.0, 0), 2.0);
        assert_eq!(generator_value("step", &p, 3000.0, 0), 3.0); // reaches max
        assert_eq!(generator_value("step", &p, 4000.0, 0), 0.0); // wraps back to min
    }

    #[test]
    fn random_in_range_and_deterministic() {
        let p = GenParams { min: 5.0, max: 6.0, period_ms: 0.0 };
        let v1 = generator_value("random", &p, 0.0, 42);
        let v2 = generator_value("random", &p, 0.0, 42);
        assert_eq!(v1, v2);
        assert!(v1 >= 5.0 && v1 <= 6.0);
    }

    #[test]
    fn toggle_is_binary_by_half_period() {
        let p = GenParams { min: 0.0, max: 1.0, period_ms: 1000.0 };
        assert_eq!(generator_value("toggle", &p, 100.0, 0), 1.0); // first half
        assert_eq!(generator_value("toggle", &p, 600.0, 0), 0.0); // second half
    }

    #[test]
    fn presets_stay_within_range() {
        let p = PresetParams { min: 20.0, max: 30.0, period_ms: 60000.0 };
        for preset in ["temperature", "humidity", "pressure", "flow", "vibration", "analog"] {
            for t in [0.0, 1000.0, 30000.0, 59000.0] {
                for seed in [0u64, 7, 12345] {
                    let v = preset_value(preset, &p, t, seed);
                    assert!(v >= 20.0 && v <= 30.0, "{preset} out of range at {t} seed {seed}: {v}");
                }
            }
        }
    }

    #[test]
    fn two_registers_with_same_preset_are_independent() {
        // Regression: preset_value took no per-register seed, so two registers
        // with identical params moved in lockstep (bug: Temperature & Humidity
        // showing the same value). Different seeds must give different values.
        let p = PresetParams { min: 0.0, max: 100.0, period_ms: 5000.0 };
        let seed = |addr: i64| ((1u64) << 32) ^ (4u64 << 16) ^ (addr as u64);
        let mut any_diff = false;
        for t in [100.0, 800.0, 1700.0, 3300.0] {
            let a = preset_value("temperature", &p, t, seed(0));
            let b = preset_value("temperature", &p, t, seed(1));
            if (a - b).abs() > 1e-6 { any_diff = true; }
        }
        assert!(any_diff, "two preset registers with the same params must not be identical");
    }

    #[test]
    fn discrete_is_binary() {
        let p = PresetParams { min: 0.0, max: 1.0, period_ms: 1000.0 };
        let v = preset_value("discrete", &p, 100.0, 0);
        assert!(v == 0.0 || v == 1.0);
    }

    #[test]
    fn counter_is_monotonic_nondecreasing() {
        let p = PresetParams { min: 0.0, max: 1000.0, period_ms: 1000.0 };
        // Two non-wrapping samples within the same period: the sawtooth must
        // strictly rise between them (previously t=1000 & t=5000 both wrap to
        // 0, so the old assertion `b >= a` passed trivially without proving
        // the ramp actually rises within a period).
        let a = preset_value("counter", &p, 500.0, 0);
        let b = preset_value("counter", &p, 600.0, 0);
        assert!(b > a, "expected counter to rise within a period: a={a} b={b}");

        // Wrap check: a full period later, value returns to (approximately) min.
        let wrapped = preset_value("counter", &p, 1500.0, 0);
        assert!((wrapped - a).abs() < 1e-6, "expected wrap back to same phase: a={a} wrapped={wrapped}");
    }

    #[test]
    fn preset_varies_over_time() {
        let p = PresetParams { min: 0.0, max: 100.0, period_ms: 10000.0 };
        let a = preset_value("temperature", &p, 0.0, 0);
        let b = preset_value("temperature", &p, 2500.0, 0);
        assert!((a - b).abs() > 1e-6);
    }

    #[test]
    fn parses_generator_and_device_registers() {
        let gen = SimRegister {
            id: 1, unit_id: 1, function_code: 4, address: 0, alias: "".into(), data_type: "f32".into(),
            hold_value: 0, value_source: "generator".into(), byte_order: "ABCD".into(),
            source_params: "{\"kind\":\"sine\",\"min\":0,\"max\":100,\"periodMs\":1000}".into(),
            interval_ms: 100, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        };
        let d = parse_dynamic(&gen).unwrap();
        assert_eq!(d.address, 0);
        assert!(matches!(d.kind, DynKind::Generator { .. }));

        let hold = SimRegister { value_source: "hold".into(), ..gen.clone() };
        assert!(parse_dynamic(&hold).is_none());
    }

    #[test]
    fn parses_route_registers() {
        let reg = SimRegister {
            id: 1, unit_id: 2, function_code: 3, address: 100, alias: "".into(), data_type: "f32".into(),
            hold_value: 0, value_source: "route".into(), byte_order: "ABCD".into(),
            source_params: "{\"slaveUnitId\":7,\"connectionKind\":\"tcp\",\"functionCode\":4,\"address\":1}".into(),
            interval_ms: 500, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        };
        let d = parse_dynamic(&reg).unwrap();
        match d.kind {
            DynKind::Route { slave_unit, connection_kind, src_fc, src_addr, count, scale, offset, src_byte_order } => {
                assert_eq!(slave_unit, 7);
                assert_eq!(connection_kind, "tcp");
                assert_eq!(src_fc, 4);
                assert_eq!(src_addr, 1);
                assert_eq!(count, 2); // f32 → 2 words
                assert_eq!(scale, 1.0); // defaults
                assert_eq!(offset, 0.0);
                assert_eq!(src_byte_order, "ABCD"); // defaults to the register's own order
            }
            _ => panic!("expected Route"),
        }
        assert!(validate_register(&reg).is_ok());
    }

    #[test]
    fn parses_route_scale_offset_and_source_order() {
        let reg = SimRegister {
            id: 1, unit_id: 2, function_code: 3, address: 100, alias: "".into(), data_type: "u16".into(),
            hold_value: 0, value_source: "route".into(), byte_order: "ABCD".into(),
            source_params: "{\"slaveUnitId\":7,\"functionCode\":3,\"address\":1,\"scale\":0.1,\"offset\":-40,\"srcByteOrder\":\"BADC\"}".into(),
            interval_ms: 500, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        };
        match parse_dynamic(&reg).unwrap().kind {
            DynKind::Route { scale, offset, src_byte_order, .. } => {
                assert_eq!(scale, 0.1);
                assert_eq!(offset, -40.0);
                assert_eq!(src_byte_order, "BADC");
            }
            _ => panic!("expected Route"),
        }
    }

    #[test]
    fn transform_route_words_scales_and_reencodes() {
        // u16 register, identity order, scale 0.1 offset -40: source 700 → 30.
        let d = DynReg {
            unit: 1, bank: 3, address: 0, data_type: "u16".into(), byte_order: "ABCD".into(),
            kind: DynKind::Route { slave_unit: 1, connection_kind: "tcp".into(), src_fc: 3, src_addr: 0, count: 1, scale: 0.1, offset: -40.0, src_byte_order: "ABCD".into() },
            interval_ms: 1000.0,
        };
        assert_eq!(transform_route_words(&d, &[700], 0.1, -40.0, "ABCD"), vec![30]);
        // Identity transform mirrors verbatim.
        assert_eq!(transform_route_words(&d, &[1234], 1.0, 0.0, "ABCD"), vec![1234]);
        // Byte-order conversion only (source BADC, expose ABCD): 0x2C01 → 0x012C.
        let f = DynReg { data_type: "u16".into(), byte_order: "ABCD".into(), ..d.clone() };
        assert_eq!(transform_route_words(&f, &[0x2C01], 1.0, 0.0, "BADC"), vec![0x012C]);
    }

    #[test]
    fn multi_word_register_occupies_two_addresses() {
        let reg = SimRegister {
            id: 1, unit_id: 1, function_code: 3, address: 10, alias: "".into(), data_type: "f32".into(),
            hold_value: 0, value_source: "generator".into(), byte_order: "ABCD".into(),
            source_params: "{\"kind\":\"ramp\",\"min\":0,\"max\":10,\"periodMs\":1000}".into(),
            interval_ms: 100, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        };
        let banks = registers_to_banks(&[reg]);
        let h = &banks.get(&1).unwrap().holding;
        assert!(h.contains_key(&10) && h.contains_key(&11)); // f32 → 2 words
    }

    #[test]
    fn validate_accepts_plan2_types_and_sources() {
        let ok = SimRegister {
            id: 0, unit_id: 1, function_code: 3, address: 0, alias: "".into(), data_type: "u32".into(),
            hold_value: 0, value_source: "generator".into(), byte_order: "CDAB".into(),
            source_params: "{}".into(), interval_ms: 100, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        };
        assert!(validate_register(&ok).is_ok());
        // 4-word types are now supported (u64/i64/f64), including their orders.
        assert!(validate_register(&SimRegister { data_type: "f64".into(), byte_order: "DCBA".into(), ..ok.clone() }).is_ok());
        assert!(validate_register(&SimRegister { data_type: "u64".into(), byte_order: "HALF_SWAP".into(), ..ok.clone() }).is_ok());
        // Unknown type is still rejected.
        let bad = SimRegister { data_type: "u128".into(), ..ok.clone() };
        assert!(validate_register(&bad).is_err());
        // HALF_SWAP is 4-word only — invalid on a 2-word type.
        let bad_order = SimRegister { data_type: "u32".into(), byte_order: "HALF_SWAP".into(), ..ok.clone() };
        assert!(validate_register(&bad_order).is_err());
    }

    #[test]
    fn rejects_bool_for_dynamic_sources() {
        let base = SimRegister {
            id: 0, unit_id: 1, function_code: 1, address: 0, alias: "".into(), data_type: "bool".into(),
            hold_value: 0, value_source: "generator".into(), byte_order: "ABCD".into(),
            source_params: "{}".into(), interval_ms: 100, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        };
        assert!(validate_register(&base).is_err());
        let device = SimRegister { value_source: "device".into(), ..base.clone() };
        assert!(validate_register(&device).is_err());
        let hold = SimRegister { value_source: "hold".into(), ..base.clone() };
        assert!(validate_register(&hold).is_ok());
    }

    #[tokio::test]
    async fn tick_updates_a_generator_register_over_time() {
        // a ramp on input register (unit 1, addr 0), f32, fast period
        let reg = SimRegister {
            id: 1, unit_id: 1, function_code: 4, address: 0, alias: "".into(), data_type: "f32".into(),
            hold_value: 0, value_source: "generator".into(), byte_order: "ABCD".into(),
            source_params: "{\"kind\":\"ramp\",\"min\":0,\"max\":100,\"periodMs\":1000}".into(),
            interval_ms: 50, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        };
        let banks = registers_to_banks(&[reg.clone()]);
        let dynamics: Vec<DynReg> = [reg].iter().filter_map(parse_dynamic).collect();

        let mut engine = SimEngine::new();
        let info = engine.start(NoopSink, "ws".into(), "127.0.0.1", 0, 100, banks, dynamics, Default::default(), Default::default(), Vec::new()).await.unwrap();
        let addr: std::net::SocketAddr = info.bound.parse().unwrap();

        let mut client = tokio_modbus::client::tcp::connect_slave(addr, tokio_modbus::prelude::Slave(1)).await.unwrap();
        let first = client.read_input_registers(0, 2).await.unwrap().unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let later = client.read_input_registers(0, 2).await.unwrap().unwrap();
        assert_ne!(first, later, "generator value should change over ~300ms");
        engine.stop().await;
    }

    #[tokio::test]
    async fn two_random_registers_produce_independent_values() {
        let mk = |addr: i64| SimRegister {
            id: addr + 1, unit_id: 1, function_code: 4, address: addr, alias: "".into(),
            data_type: "u16".into(), hold_value: 0, value_source: "generator".into(),
            byte_order: "ABCD".into(),
            source_params: "{\"kind\":\"random\",\"min\":0,\"max\":60000}".into(),
            interval_ms: 20, sort_order: 0, device_instance_id: None, unit: None, display_format: None,
        };
        let (r0, r1) = (mk(0), mk(1));
        let banks = registers_to_banks(&[r0.clone(), r1.clone()]);
        let dynamics: Vec<DynReg> = [r0, r1].iter().filter_map(parse_dynamic).collect();
        let mut engine = SimEngine::new();
        let info = engine.start(NoopSink, "ws".into(), "127.0.0.1", 0, 20, banks, dynamics, Default::default(), Default::default(), Vec::new()).await.unwrap();
        let addr: std::net::SocketAddr = info.bound.parse().unwrap();
        let mut client = tokio_modbus::client::tcp::connect_slave(addr, tokio_modbus::prelude::Slave(1)).await.unwrap();
        let mut differ = false;
        for _ in 0..10 {
            tokio::time::sleep(std::time::Duration::from_millis(40)).await;
            let v = client.read_input_registers(0, 2).await.unwrap().unwrap();
            if v[0] != v[1] { differ = true; break; }
        }
        engine.stop().await;
        assert!(differ, "two independent random registers must not always share a value");
    }

    #[tokio::test]
    async fn set_dynamics_animates_a_register_added_while_running() {
        // Start with an EMPTY simulator, then add a generator via set_dynamics —
        // the running tick must pick it up and start serving/animating it with
        // no restart (this is the "next Start" fix + the live-values fix).
        let mut engine = SimEngine::new();
        let info = engine.start(NoopSink, "ws".into(), "127.0.0.1", 0, 50, HashMap::new(), Vec::new(), Default::default(), Default::default(), Vec::new()).await.unwrap();
        let addr: std::net::SocketAddr = info.bound.parse().unwrap();
        let mut client = tokio_modbus::client::tcp::connect_slave(addr, tokio_modbus::prelude::Slave(1)).await.unwrap();

        // Before: address 0 doesn't exist → read is an exception.
        assert!(client.read_input_registers(0, 2).await.unwrap().is_err(), "unconfigured address should be illegal");

        let reg = SimRegister {
            id: 1, unit_id: 1, function_code: 4, address: 0, alias: "".into(), data_type: "f32".into(),
            hold_value: 0, value_source: "generator".into(), byte_order: "ABCD".into(),
            source_params: "{\"kind\":\"ramp\",\"min\":0,\"max\":100,\"periodMs\":500}".into(),
            interval_ms: 50, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        };
        engine.set_dynamics([reg].iter().filter_map(parse_dynamic).collect());

        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let first = client.read_input_registers(0, 2).await.unwrap().unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let later = client.read_input_registers(0, 2).await.unwrap().unwrap();
        assert_ne!(first, later, "register added via set_dynamics should animate live");
        engine.stop().await;
    }

    #[tokio::test]
    async fn set_rules_applies_a_rule_added_while_running() {
        // A hold register at 0; add an interval rule live that sets it to 42.
        let reg = SimRegister {
            id: 1, unit_id: 1, function_code: 3, address: 0, alias: "".into(), data_type: "u16".into(),
            hold_value: 0, value_source: "hold".into(), byte_order: "ABCD".into(),
            source_params: "{}".into(), interval_ms: 1000, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        };
        let banks = registers_to_banks(&[reg]);
        let mut engine = SimEngine::new();
        let info = engine.start(NoopSink, "ws".into(), "127.0.0.1", 0, 50, banks, Vec::new(), Default::default(), Default::default(), Vec::new()).await.unwrap();
        let addr: std::net::SocketAddr = info.bound.parse().unwrap();
        let mut client = tokio_modbus::client::tcp::connect_slave(addr, tokio_modbus::prelude::Slave(1)).await.unwrap();
        assert_eq!(client.read_holding_registers(0, 1).await.unwrap().unwrap(), vec![0]);

        let rule = SimRule {
            id: 1, name: "".into(), enabled: true,
            trigger: "{\"type\":\"interval\",\"ms\":10}".into(),
            actions: "[{\"type\":\"set\",\"unit\":1,\"bank\":3,\"address\":0,\"value\":42}]".into(),
            sort_order: 0,
        };
        engine.set_rules([rule].iter().filter_map(parse_rule).collect());

        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        assert_eq!(client.read_holding_registers(0, 1).await.unwrap().unwrap(), vec![42], "rule added via set_rules should fire live");
        engine.stop().await;
    }

    /// Recording `ValuesSink` for tests that need to assert on the emitted
    /// `simulator_values` payload (as opposed to `NoopSink`, which discards it).
    #[derive(Clone)]
    struct RecordingSink(std::sync::Arc<std::sync::Mutex<Vec<SimValuesEvent>>>);
    impl ValuesSink for RecordingSink {
        fn emit_values(&self, event: SimValuesEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    #[tokio::test]
    async fn tick_emits_values_events() {
        // a ramp on input register (unit 1, addr 0), f32, fast period — same
        // shape as `tick_updates_a_generator_register_over_time`.
        let reg = SimRegister {
            id: 1, unit_id: 1, function_code: 4, address: 0, alias: "".into(), data_type: "f32".into(),
            hold_value: 0, value_source: "generator".into(), byte_order: "ABCD".into(),
            source_params: "{\"kind\":\"ramp\",\"min\":0,\"max\":100,\"periodMs\":1000}".into(),
            interval_ms: 50, sort_order: 0, device_instance_id: None,
            unit: None, display_format: None,
        };
        let banks = registers_to_banks(&[reg.clone()]);
        let dynamics: Vec<DynReg> = [reg].iter().filter_map(parse_dynamic).collect();

        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = RecordingSink(events.clone());

        let mut engine = SimEngine::new();
        engine.start(sink, "ws".into(), "127.0.0.1", 0, 100, banks, dynamics, Default::default(), Default::default(), Vec::new()).await.unwrap();

        // The tick loop throttles emits to every ~250ms; wait long enough for
        // at least one to fire.
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;

        engine.stop().await;

        let recorded = events.lock().unwrap();
        assert!(!recorded.is_empty(), "expected at least one simulator_values event");
        assert!(
            recorded.iter().any(|e| e.workspace == "ws" && !e.rows.is_empty()),
            "expected an event for workspace 'ws' with non-empty rows"
        );
    }

    #[tokio::test]
    async fn apply_words_and_clear_span_handle_multiword() {
        // `apply_words`/`clear_span` need `self.banks` to exist, which is only
        // set up by `start`. Use an empty initial map + NoopSink (like the
        // other tick tests) so we exercise them through the public API.
        let mut engine = SimEngine::new();
        engine.start(NoopSink, "ws".into(), "127.0.0.1", 0, 100, HashMap::new(), Vec::new(), Default::default(), Default::default(), Vec::new()).await.unwrap();

        // Place a 2-word span (unit 1, holding bank, addr 10).
        engine.apply_words(1, 3, 10, &[0x1234, 0x5678]);
        let snap = engine.snapshot();
        let holding = &snap.get(&1).unwrap().holding;
        assert_eq!(holding.get(&10), Some(&0x1234));
        assert_eq!(holding.get(&11), Some(&0x5678));

        // Clearing the span removes both addresses.
        engine.clear_span(1, 3, 10, 2);
        let snap = engine.snapshot();
        let holding = &snap.get(&1).unwrap().holding;
        assert!(!holding.contains_key(&10));
        assert!(!holding.contains_key(&11));

        engine.stop().await;
    }

    #[tokio::test]
    async fn route_read_words_reads_live_registers() {
        // source server: unit 7 holding[0..2] = [111, 222]
        let mut src = SimEngine::new();
        let mut banks = HashMap::new();
        let mut b = SimBanks::default();
        b.holding.insert(0, 111);
        b.holding.insert(1, 222);
        banks.insert(7u8, b);
        let info = src.start(NoopSink, "ws".into(), "127.0.0.1", 0, 100, banks, Vec::new(), Default::default(), Default::default(), Vec::new()).await.unwrap();
        let addr: std::net::SocketAddr = info.bound.parse().unwrap();

        // a client Context wrapped like ModbusState stores it
        let ctx = tokio_modbus::client::tcp::connect(addr).await.unwrap();
        let session = std::sync::Arc::new(tokio::sync::Mutex::new(ctx));

        let words = route_read_words(session.clone(), 7, 3, 0, 2, 1000).await.unwrap();
        assert_eq!(words, vec![111, 222]);

        // unconfigured address → Err (Modbus exception), not a panic
        assert!(route_read_words(session, 7, 3, 50, 1, 1000).await.is_err());
        src.stop().await;
    }

    #[tokio::test]
    async fn route_mirrors_a_live_source_over_the_tick() {
        use crate::modbus::SessionMap;

        // SOURCE device: engine A, unit 7, holding[0]=1234
        let mut a = SimEngine::new();
        let mut abanks = HashMap::new();
        let mut ab = SimBanks::default();
        ab.holding.insert(0, 1234);
        abanks.insert(7u8, ab);
        let ainfo = a.start(NoopSink, "src".into(), "127.0.0.1", 0, 100, abanks, Vec::new(), Default::default(), Default::default(), Vec::new()).await.unwrap();
        let aaddr: std::net::SocketAddr = ainfo.bound.parse().unwrap();

        // Put a client session to A into a SessionMap keyed by workspace "ws"
        let tcp_map: SessionMap = Default::default();
        {
            let ctx = tokio_modbus::client::tcp::connect(aaddr).await.unwrap();
            tcp_map.lock().unwrap().insert("ws".to_string(), std::sync::Arc::new(tokio::sync::Mutex::new(ctx)));
        }
        let rtu_map: SessionMap = Default::default();

        // ROUTE: engine B, unit 1 holding[0] mirrors A unit7 holding[0]
        let route = DynReg {
            unit: 1, bank: 3, address: 0, data_type: "u16".into(), byte_order: "ABCD".into(), interval_ms: 50.0,
            kind: DynKind::Route { slave_unit: 7, connection_kind: "tcp".into(), src_fc: 3, src_addr: 0, count: 1, scale: 1.0, offset: 0.0, src_byte_order: "ABCD".into() },
        };
        let mut b = SimEngine::new();
        let binfo = b.start(NoopSink, "ws".into(), "127.0.0.1", 0, 100, HashMap::new(), vec![route], tcp_map, rtu_map, Vec::new()).await.unwrap();
        let baddr: std::net::SocketAddr = binfo.bound.parse().unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let mut client = tokio_modbus::client::tcp::connect_slave(baddr, tokio_modbus::prelude::Slave(1)).await.unwrap();
        let got = client.read_holding_registers(0, 1).await.unwrap().unwrap();
        assert_eq!(got, vec![1234], "route register should mirror the source value");

        b.stop().await;
        a.stop().await;
    }

    #[tokio::test]
    async fn rule_sets_coil_when_condition_true() {
        // holding[0]=150 (Hold), coil[0]=0; rule: when holding[0] >= 100 → set coil[0]=1
        let mut banks = HashMap::new();
        place_words(&mut banks, 1, 3, 0, &[150]);
        place_words(&mut banks, 1, 1, 0, &[0]);
        let rules = vec![RuleDef {
            id: 1, enabled: true, sort_order: 0,
            trigger: Trigger::Condition { unit: 1, bank: 3, address: 0, op: ">=".into(), value: 100 },
            actions: vec![timed(Action::Set { unit: 1, bank: 1, address: 0, value: 1 })],
        }];
        let mut engine = SimEngine::new();
        // match the REAL start signature; rules is the new trailing arg
        let info = engine.start(NoopSink, "ws".into(), "127.0.0.1", 0, 100, banks, Vec::new(), Default::default(), Default::default(), rules).await.unwrap();
        let addr: std::net::SocketAddr = info.bound.parse().unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        let mut c = tokio_modbus::client::tcp::connect_slave(addr, tokio_modbus::prelude::Slave(1)).await.unwrap();
        assert_eq!(c.read_coils(0, 1).await.unwrap().unwrap(), vec![true]);
        engine.stop().await;
    }

    #[test]
    fn device_crud_cascades_registers() {
        let c = mem_db();
        let id = db_insert_device(&c, &SimDevice {
            id: 0, template_key: "temp".into(), name: "Sensor A".into(),
            unit_id: 1, base_address: 0, enabled: true, sort_order: 0,
        }).unwrap();
        // a child register
        db_insert_register(&c, &SimRegister {
            id: 0, unit_id: 1, function_code: 4, address: 0, alias: "t".into(),
            data_type: "u16".into(), hold_value: 0, value_source: "device".into(),
            byte_order: "ABCD".into(), source_params: "{}".into(), interval_ms: 1000, sort_order: 0,
            device_instance_id: None,
            unit: None, display_format: None,
        }).unwrap();
        // link it (device_instance_id) — set directly
        c.execute("UPDATE sim_registers SET device_instance_id = ?1", [id]).unwrap();

        assert_eq!(db_list_devices(&c).unwrap().len(), 1);
        db_delete_device(&c, id).unwrap();
        assert!(db_list_devices(&c).unwrap().is_empty());
        assert!(db_list_registers(&c).unwrap().is_empty(), "child registers should be cascaded");
    }

    #[test]
    fn device_instance_id_round_trips() {
        let c = mem_db();
        let device_id = db_insert_device(&c, &SimDevice {
            id: 0, template_key: "temp".into(), name: "Sensor A".into(),
            unit_id: 1, base_address: 0, enabled: true, sort_order: 0,
        }).unwrap();
        db_insert_register(&c, &SimRegister {
            id: 0, unit_id: 1, function_code: 4, address: 0, alias: "t".into(),
            data_type: "u16".into(), hold_value: 0, value_source: "device".into(),
            byte_order: "ABCD".into(), source_params: "{}".into(), interval_ms: 1000, sort_order: 0,
            device_instance_id: None,
            unit: None, display_format: None,
        }).unwrap();
        c.execute("UPDATE sim_registers SET device_instance_id = ?1", [device_id]).unwrap();

        let rows = db_list_registers(&c).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].device_instance_id, Some(device_id), "read path must carry device_instance_id");
    }

    #[test]
    fn slave_row_maps_to_route_register() {
        // Holding register on unit 3 over serial → route reg mirroring it.
        let r = slave_row_to_route_register(3, "serial", 3, 40, "Temperature", "u16", "");
        assert_eq!(r.bank, 3);
        assert_eq!(r.offset, 40);
        assert_eq!(r.data_type, "u16");
        assert_eq!(r.byte_order, "ABCD");
        assert_eq!(r.value_source, "route");
        assert_eq!(r.alias, "Temperature");
        let p: serde_json::Value = serde_json::from_str(&r.source_params).unwrap();
        assert_eq!(p["slaveUnitId"], 3);
        assert_eq!(p["connectionKind"], "serial");
        assert_eq!(p["functionCode"], 3);
        assert_eq!(p["address"], 40);
        assert_eq!(p["scale"], 1.0);
        assert_eq!(p["offset"], 0.0);
        // The synthetic template must survive catalog validation (so inline add works).
        let t = DeviceTemplate {
            template_key: "ws-slave:1".into(), name: "SHT20".into(), category: "Workspace".into(),
            description: "".into(), icon: "🔗".into(), registers: vec![r],
        };
        assert!(validate_template(&t).is_ok());
    }

    #[test]
    fn slave_bit_row_forces_bool_and_preserves_order_for_words() {
        // Coil → bool/ABCD regardless of stored type/order.
        let bit = slave_row_to_route_register(1, "tcp", 1, 5, "Run", "u16", "DCBA");
        assert_eq!(bit.data_type, "bool");
        assert_eq!(bit.byte_order, "ABCD");
        // Multi-word holding preserves a real byte order.
        let word = slave_row_to_route_register(1, "tcp", 3, 100, "Power", "f32", "CDAB");
        assert_eq!(word.data_type, "f32");
        assert_eq!(word.byte_order, "CDAB");
    }

    #[test]
    fn builtin_catalog_is_valid() {
        let cat = builtin_templates();
        assert!(cat.len() >= 6);
        // keys unique
        let mut keys: Vec<&str> = cat.iter().map(|t| t.template_key.as_str()).collect();
        keys.sort();
        let n = keys.len();
        keys.dedup();
        assert_eq!(keys.len(), n, "template keys must be unique");
        // every register has a valid bank + non-empty type; the temp/humidity sensor exists
        assert!(find_template("temp_humidity").is_some());
        for t in &cat {
            assert!(!t.registers.is_empty(), "{} has no registers", t.template_key);
            for r in &t.registers {
                assert!((1..=4).contains(&r.bank));
                assert!(!r.data_type.is_empty());
            }
        }
    }

    #[test]
    fn template_to_registers_offsets_and_addresses() {
        let t = find_template("temp_humidity").unwrap();
        let regs = template_to_registers(&t, 3, 100);
        assert_eq!(regs.len(), 2);
        assert_eq!(regs[0].unit_id, 3);
        assert_eq!(regs[0].function_code, 4);
        assert_eq!(regs[0].address, 100); // base 100 + offset 0
        assert_eq!(regs[1].address, 101); // offset 1
        assert_eq!(regs[0].value_source, "device");
    }

    #[test]
    fn overlap_is_rejected() {
        let existing = vec![SimRegister { id:1, unit_id:1, function_code:3, address:5, alias:"".into(), data_type:"u16".into(), hold_value:0, value_source:"hold".into(), byte_order:"ABCD".into(), source_params:"{}".into(), interval_ms:1000, sort_order:0, device_instance_id: None, unit: None, display_format: None }];
        let new = vec![SimRegister { id:0, unit_id:1, function_code:3, address:5, alias:"".into(), data_type:"u16".into(), hold_value:0, value_source:"hold".into(), byte_order:"ABCD".into(), source_params:"{}".into(), interval_ms:1000, sort_order:0, device_instance_id: None, unit: None, display_format: None }];
        assert!(validate_no_overlap(&existing, &new).is_err());
        let free = vec![SimRegister { address:6, ..new[0].clone() }];
        assert!(validate_no_overlap(&existing, &free).is_ok());
    }

    #[test]
    fn multi_word_overlap_is_detected() {
        let existing = vec![SimRegister { id:1, unit_id:1, function_code:3, address:101, alias:"".into(), data_type:"u16".into(), hold_value:0, value_source:"hold".into(), byte_order:"ABCD".into(), source_params:"{}".into(), interval_ms:1000, sort_order:0, device_instance_id: None, unit: None, display_format: None }];
        // f32 at address 100 spans 100-101, colliding with the existing register at 101.
        let overlapping = vec![SimRegister { id:0, unit_id:1, function_code:3, address:100, alias:"".into(), data_type:"f32".into(), hold_value:0, value_source:"hold".into(), byte_order:"ABCD".into(), source_params:"{}".into(), interval_ms:1000, sort_order:0, device_instance_id: None, unit: None, display_format: None }];
        assert!(validate_no_overlap(&existing, &overlapping).is_err());

        // f32 at address 102 spans 102-103, which is free.
        let free = vec![SimRegister { address:102, ..overlapping[0].clone() }];
        assert!(validate_no_overlap(&existing, &free).is_ok());
    }

    #[test]
    fn rebase_shifts_child_addresses() {
        // pure helper: given child regs + old base + new base, produce shifted regs; error on out-of-range
        let children = vec![
            SimRegister { id:1, unit_id:1, function_code:4, address:100, alias:"".into(), data_type:"u16".into(), hold_value:0, value_source:"device".into(), byte_order:"ABCD".into(), source_params:"{}".into(), interval_ms:1000, sort_order:0, device_instance_id: None, unit: None, display_format: None },
            SimRegister { id:2, unit_id:1, function_code:4, address:101, alias:"".into(), data_type:"u16".into(), hold_value:0, value_source:"device".into(), byte_order:"ABCD".into(), source_params:"{}".into(), interval_ms:1000, sort_order:0, device_instance_id: None, unit: None, display_format: None },
        ];
        let shifted = rebase_children(&children, 100, 200).unwrap();
        assert_eq!(shifted[0].address, 200);
        assert_eq!(shifted[1].address, 201);
        assert!(rebase_children(&children, 100, 70000).is_err()); // out of u16 range
    }

    #[test]
    fn device_rebase_updates_base_and_children_without_colliding() {
        let c = mem_db();
        let device_id = db_insert_device(&c, &SimDevice {
            id: 0, template_key: "temp".into(), name: "Sensor A".into(),
            unit_id: 1, base_address: 100, enabled: true, sort_order: 0,
        }).unwrap();
        let reg_id = db_insert_register(&c, &SimRegister {
            id: 0, unit_id: 1, function_code: 4, address: 100, alias: "t".into(),
            data_type: "u16".into(), hold_value: 0, value_source: "device".into(),
            byte_order: "ABCD".into(), source_params: "{}".into(), interval_ms: 1000, sort_order: 0,
            device_instance_id: None,
            unit: None, display_format: None,
        }).unwrap();
        c.execute("UPDATE sim_registers SET device_instance_id = ?1 WHERE id = ?2", [device_id, reg_id]).unwrap();

        // an unrelated, manually-added register that must NOT be disturbed
        db_insert_register(&c, &SimRegister {
            id: 0, unit_id: 1, function_code: 4, address: 5, alias: "other".into(),
            data_type: "u16".into(), hold_value: 0, value_source: "hold".into(),
            byte_order: "ABCD".into(), source_params: "{}".into(), interval_ms: 1000, sort_order: 0,
            device_instance_id: None,
            unit: None, display_format: None,
        }).unwrap();

        let device = db_list_devices(&c).unwrap().into_iter().find(|d| d.id == device_id).unwrap();
        let children = db_list_registers_for_device(&c, device_id).unwrap();
        let shifted = rebase_children(&children, device.base_address, 200).unwrap();
        let others = db_list_registers_excluding_device(&c, device_id).unwrap();
        validate_no_overlap(&others, &shifted).unwrap();

        assert_eq!(others.len(), 1, "the unrelated register should not be part of this device's children");
        assert_eq!(others[0].address, 5);
        assert_eq!(shifted[0].address, 200);
    }

    #[test]
    fn unit_and_display_format_round_trip() {
        let c = Connection::open_in_memory().unwrap();
        create_sim_schema(&c).unwrap();
        let mut reg = SimRegister {
            id: 0, unit_id: 1, function_code: 3, address: 5, alias: "T".into(),
            data_type: "u16".into(), hold_value: 0, sort_order: 0, device_instance_id: None,
            value_source: "hold".into(), byte_order: "ABCD".into(), source_params: "{}".into(),
            interval_ms: 1000, unit: Some("°C".into()), display_format: Some("dec2".into()),
        };
        let id = db_insert_register(&c, &reg).unwrap();
        let got = db_list_registers(&c).unwrap().into_iter().find(|r| r.id == id).unwrap();
        assert_eq!(got.unit.as_deref(), Some("°C"));
        assert_eq!(got.display_format.as_deref(), Some("dec2"));
        // update path preserves them too
        reg.id = id; reg.unit = Some("kPa".into());
        db_update_register(&c, &reg).unwrap();
        let got2 = db_list_registers(&c).unwrap().into_iter().find(|r| r.id == id).unwrap();
        assert_eq!(got2.unit.as_deref(), Some("kPa"));
    }
}
