/**
 * Decode a base64 string into raw bytes.
 *
 * Used by the attachment preview to turn the backend's base64 payload into a
 * Blob for an object URL. We deliberately avoid embedding large binaries in a
 * `data:` URL: Chromium/WebView2 fails to render PDFs from multi-megabyte
 * `data:` URLs (they blank out), whereas `blob:` URLs have no length limit.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes;
}
