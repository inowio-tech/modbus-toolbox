import type { SimRegister } from "../components/SimRegisterModal";

export type PageRegister = SimRegister & { deviceInstanceId?: number | null };

export type RegisterFilter = { search: string; unit: number | "all"; source: string | "all"; type: string | "all" };
export const EMPTY_FILTER: RegisterFilter = { search: "", unit: "all", source: "all", type: "all" };

export function filterRegisters(rows: PageRegister[], f: RegisterFilter): PageRegister[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.unit !== "all" && r.unitId !== f.unit) return false;
    if (f.source !== "all" && r.valueSource !== f.source) return false;
    if (f.type !== "all" && r.dataType !== f.type) return false;
    if (q && !(`${r.alias}`.toLowerCase().includes(q) || `${r.address}`.includes(q) || `${r.unitId}`.includes(q))) return false;
    return true;
  });
}

export function rwLabel(functionCode: number): "R" | "R/W" {
  return functionCode === 1 || functionCode === 3 ? "R/W" : "R";
}

export type ColumnKey = "unit" | "fc" | "address" | "alias" | "type" | "source" | "interval" | "rw" | "value" | "device";
export const ALL_COLUMNS: ColumnKey[] = ["unit", "fc", "address", "alias", "type", "source", "interval", "rw", "value", "device"];
export const DEFAULT_COLUMNS: ColumnKey[] = ["unit", "fc", "address", "alias", "type", "source", "rw", "value", "device"];

const colKey = (ws: string) => `sim.cols.${ws}`;
export function readColumns(ws: string): ColumnKey[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(colKey(ws)) ?? "null");
    return Array.isArray(v) && v.length ? v : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}
export function writeColumns(ws: string, cols: ColumnKey[]): void {
  try {
    window.localStorage.setItem(colKey(ws), JSON.stringify(cols));
  } catch {
    // best-effort persistence
  }
}

const pageKey = (ws: string) => `sim.pageSize.${ws}`;
export function readPageSize(ws: string): number {
  try {
    const n = Number(window.localStorage.getItem(pageKey(ws)));
    return n === 10 || n === 20 || n === 50 || n === 100 ? n : 20;
  } catch {
    return 20;
  }
}
export function writePageSize(ws: string, n: number): void {
  try {
    window.localStorage.setItem(pageKey(ws), String(n));
  } catch {
    // best-effort persistence
  }
}
