import { useEffect, useRef, useState } from "react";

export type SnapshotRow = {
  unitId: number;
  functionCode: number;
  address: number;
  valueWord: number | null;
  valueBit: boolean | null;
  sourceStatus?: string | null;
};

export type ValueHistoryKey = { unitId: number; functionCode: number; address: number } | null;

const keyId = (k: ValueHistoryKey) => (k ? `${k.unitId}:${k.functionCode}:${k.address}` : null);

export function useValueHistory(snapshot: SnapshotRow[], key: ValueHistoryKey, cap = 60): number[] {
  const bufferRef = useRef<number[]>([]);
  const [history, setHistory] = useState<number[]>([]);
  const prevKeyIdRef = useRef<string | null>(keyId(key));

  useEffect(() => {
    const id = keyId(key);
    if (id !== prevKeyIdRef.current) {
      prevKeyIdRef.current = id;
      bufferRef.current = [];
      setHistory([]);
      return; // wait for the next snapshot update before sampling the new key
    }
    if (!key) return;

    const row = snapshot.find(
      (r) => r.unitId === key.unitId && r.functionCode === key.functionCode && r.address === key.address,
    );
    if (!row) return;

    let value: number | null = null;
    if (row.valueBit !== null && row.valueBit !== undefined) {
      value = row.valueBit ? 1 : 0;
    } else if (row.valueWord !== null && row.valueWord !== undefined) {
      value = row.valueWord;
    }
    if (value === null) return;

    const next = [...bufferRef.current, value];
    if (next.length > cap) next.splice(0, next.length - cap);
    bufferRef.current = next;
    setHistory(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, key?.unitId, key?.functionCode, key?.address, cap]);

  return history;
}
