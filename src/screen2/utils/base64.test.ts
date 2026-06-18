import { describe, expect, it } from "vitest";
import { base64ToUint8Array } from "./base64";

describe("base64ToUint8Array", () => {
  it("decodes ASCII content", () => {
    const bytes = base64ToUint8Array(btoa("Hello"));
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });

  it("preserves high/binary byte values (PDF header + 0xFF/0x80/0x00)", () => {
    // "%PDF-1.4" followed by bytes that a naive decode could mangle.
    const src = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0xff, 0x00, 0x80]);
    const b64 = btoa(String.fromCharCode(...src));
    expect(Array.from(base64ToUint8Array(b64))).toEqual(Array.from(src));
  });

  it("round-trips every byte value 0..255", () => {
    const src = new Uint8Array(256);
    for (let i = 0; i < 256; i++) src[i] = i;
    const b64 = btoa(String.fromCharCode(...src));
    expect(Array.from(base64ToUint8Array(b64))).toEqual(Array.from(src));
  });

  it("returns an empty array for empty input", () => {
    expect(base64ToUint8Array("").length).toBe(0);
  });
});
