// Per-workspace UI preferences for the TCP Simulator page. Browser localStorage,
// machine-local (does not travel with workspace export/import). Each accessor is
// defensive so a storage failure degrades to the default.

export type AddressFormat = "dec" | "hex";

export function addressFormatStorageKey(workspace: string): string {
  return `inowio.simulator.addressFormat.${workspace}`;
}

export function readAddressFormat(workspace: string): AddressFormat {
  try {
    return window.localStorage.getItem(addressFormatStorageKey(workspace)) === "hex" ? "hex" : "dec";
  } catch {
    return "dec";
  }
}

export function writeAddressFormat(workspace: string, fmt: AddressFormat): void {
  try {
    window.localStorage.setItem(addressFormatStorageKey(workspace), fmt);
  } catch {
    // best-effort persistence
  }
}
