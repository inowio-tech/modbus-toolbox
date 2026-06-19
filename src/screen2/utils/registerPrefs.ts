// Per-scope persistence for the Read/Write Registers card preferences.
//
// The Modbus register *type* (function code) is remembered per slave, because
// different slaves expose different register maps — opening a slave should
// return you to the register set you last looked at on *that* device. The
// Edit/Monitor *view* is remembered per workspace.
//
// Everything lives in the browser's localStorage, so these preferences are
// machine-local: they do NOT travel with workspace export/import. Each accessor
// is defensive (wrapped in try/catch) so a storage failure or private-mode
// quota error degrades to the default instead of throwing.

const VALID_FUNCTION_CODES = [1, 2, 3, 4, 5, 6, 15, 16] as const;
const DEFAULT_FUNCTION_CODE = 4;

export type RegisterView = "edit" | "monitor";

export function isValidFunctionCode(fc: number): boolean {
  return (VALID_FUNCTION_CODES as readonly number[]).includes(fc);
}

/** Storage key for a slave's last-used register type (function code). */
export function functionCodeStorageKey(workspace: string, slaveId: number | string): string {
  return `inowio.registers.functionCode.${workspace}.${slaveId}`;
}

/** Storage key for a workspace's Edit/Monitor view choice. */
export function registerViewStorageKey(workspace: string): string {
  return `inowio.registers.view.${workspace}`;
}

/** Read the saved register type for a slave, falling back to 0x04 (Input). */
export function readFunctionCode(workspace: string, slaveId: number | string): number {
  try {
    const stored = Number.parseInt(
      window.localStorage.getItem(functionCodeStorageKey(workspace, slaveId)) ?? "",
      10,
    );
    return isValidFunctionCode(stored) ? stored : DEFAULT_FUNCTION_CODE;
  } catch {
    return DEFAULT_FUNCTION_CODE;
  }
}

/** Persist the register type for a slave (best-effort). */
export function writeFunctionCode(workspace: string, slaveId: number | string, fc: number): void {
  try {
    window.localStorage.setItem(functionCodeStorageKey(workspace, slaveId), String(fc));
  } catch {
    // best-effort persistence
  }
}

/** Read the saved Edit/Monitor view for a workspace, defaulting to Edit. */
export function readRegisterView(workspace: string): RegisterView {
  try {
    return window.localStorage.getItem(registerViewStorageKey(workspace)) === "monitor"
      ? "monitor"
      : "edit";
  } catch {
    return "edit";
  }
}

/** Persist the Edit/Monitor view for a workspace (best-effort). */
export function writeRegisterView(workspace: string, view: RegisterView): void {
  try {
    window.localStorage.setItem(registerViewStorageKey(workspace), view);
  } catch {
    // best-effort persistence
  }
}
