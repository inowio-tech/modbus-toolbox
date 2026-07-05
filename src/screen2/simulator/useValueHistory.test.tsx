import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useValueHistory, type SnapshotRow } from "./useValueHistory";

const key = { unitId: 1, functionCode: 3, address: 5 };
const row = (valueWord: number | null, o: Partial<SnapshotRow> = {}): SnapshotRow => ({
  unitId: 1,
  functionCode: 3,
  address: 5,
  valueWord,
  valueBit: null,
  ...o,
});

describe("useValueHistory", () => {
  it("accumulates numeric samples as snapshot changes", () => {
    const { result, rerender } = renderHook(
      ({ snapshot, k }) => useValueHistory(snapshot, k, 60),
      { initialProps: { snapshot: [row(10)] as SnapshotRow[], k: key } },
    );
    expect(result.current).toEqual([10]);

    rerender({ snapshot: [row(20)], k: key });
    expect(result.current).toEqual([10, 20]);

    rerender({ snapshot: [row(30)], k: key });
    expect(result.current).toEqual([10, 20, 30]);
  });

  it("coalesces valueBit true/false to 1/0", () => {
    const bitKey = { unitId: 2, functionCode: 1, address: 0 };
    const { result, rerender } = renderHook(
      ({ snapshot, k }) => useValueHistory(snapshot, k, 60),
      {
        initialProps: {
          snapshot: [{ unitId: 2, functionCode: 1, address: 0, valueWord: null, valueBit: true }] as SnapshotRow[],
          k: bitKey,
        },
      },
    );
    expect(result.current).toEqual([1]);

    rerender({
      snapshot: [{ unitId: 2, functionCode: 1, address: 0, valueWord: null, valueBit: false }],
      k: bitKey,
    });
    expect(result.current).toEqual([1, 0]);
  });

  it("skips samples where the matching row has no value", () => {
    const { result, rerender } = renderHook(
      ({ snapshot, k }) => useValueHistory(snapshot, k, 60),
      { initialProps: { snapshot: [row(10)] as SnapshotRow[], k: key } },
    );
    expect(result.current).toEqual([10]);

    rerender({ snapshot: [row(null)], k: key });
    expect(result.current).toEqual([10]);
  });

  it("ignores snapshots that have no row matching the key", () => {
    const { result, rerender } = renderHook(
      ({ snapshot, k }) => useValueHistory(snapshot, k, 60),
      { initialProps: { snapshot: [row(10)] as SnapshotRow[], k: key } },
    );
    expect(result.current).toEqual([10]);

    rerender({ snapshot: [row(99, { address: 6 })], k: key });
    expect(result.current).toEqual([10]);
  });

  it("caps the buffer length at cap, dropping the oldest samples", () => {
    const { result, rerender } = renderHook(
      ({ snapshot, k }) => useValueHistory(snapshot, k, 3),
      { initialProps: { snapshot: [row(1)] as SnapshotRow[], k: key } },
    );
    rerender({ snapshot: [row(2)], k: key });
    rerender({ snapshot: [row(3)], k: key });
    expect(result.current).toEqual([1, 2, 3]);

    rerender({ snapshot: [row(4)], k: key });
    expect(result.current).toEqual([2, 3, 4]);
  });

  it("resets the buffer when the key changes", () => {
    const otherKey = { unitId: 1, functionCode: 3, address: 6 };
    const { result, rerender } = renderHook(
      ({ snapshot, k }: { snapshot: SnapshotRow[]; k: typeof key | null }) => useValueHistory(snapshot, k, 60),
      { initialProps: { snapshot: [row(10)] as SnapshotRow[], k: key as typeof key | null } },
    );
    expect(result.current).toEqual([10]);

    rerender({ snapshot: [row(10)], k: otherKey });
    expect(result.current).toEqual([]);

    rerender({ snapshot: [row(10, { address: 6 })], k: otherKey });
    expect(result.current).toEqual([10]);
  });

  it("resets the buffer when the key becomes null", () => {
    const { result, rerender } = renderHook(
      ({ snapshot, k }: { snapshot: SnapshotRow[]; k: typeof key | null }) => useValueHistory(snapshot, k, 60),
      { initialProps: { snapshot: [row(10)] as SnapshotRow[], k: key as typeof key | null } },
    );
    expect(result.current).toEqual([10]);

    rerender({ snapshot: [row(10)], k: null });
    expect(result.current).toEqual([]);
  });
});
