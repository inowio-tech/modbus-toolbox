/** Lowest and highest Unit ID a Modbus slave may use. */
export const MIN_UNIT_ID = 1;
export const MAX_UNIT_ID = 247;

const COPY_SUFFIX = /\s*\(copy(?:\s+\d+)?\)\s*$/i;

/** "Pump (copy 3)" -> "Pump", so cloning a clone does not stack suffixes. */
export function stripCopySuffix(name: string): string {
  return name.trim().replace(COPY_SUFFIX, "").trim();
}

/**
 * Suggests a free name for a clone: "<name> (copy)", then "(copy 2)", "(copy 3)"...
 * Matching against existing names is case-insensitive and ignores surrounding space.
 */
export function suggestCloneName(sourceName: string, existingNames: string[]): string {
  const base = stripCopySuffix(sourceName) || sourceName.trim();
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));

  const first = `${base} (copy)`;
  if (!taken.has(first.toLowerCase())) return first;

  for (let i = 2; i <= 1000; i += 1) {
    const candidate = `${base} (copy ${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return first;
}

/** Lowest Unit ID in 1..247 not already in use, or null when all are taken. */
export function nextFreeUnitId(usedUnitIds: number[]): number | null {
  const used = new Set(usedUnitIds);
  for (let id = MIN_UNIT_ID; id <= MAX_UNIT_ID; id += 1) {
    if (!used.has(id)) return id;
  }
  return null;
}
