import { beforeEach, describe, expect, it } from "vitest";

import {
  addressFormatStorageKey,
  readAddressFormat,
  writeAddressFormat,
} from "./simulatorPrefs";

describe("simulatorPrefs", () => {
  beforeEach(() => window.localStorage.clear());

  it("scopes the address format per workspace", () => {
    expect(addressFormatStorageKey("Plant-A")).toBe("inowio.simulator.addressFormat.Plant-A");
    expect(addressFormatStorageKey("Plant-A")).not.toBe(addressFormatStorageKey("Plant-B"));
  });

  it("defaults to dec and round-trips", () => {
    expect(readAddressFormat("ws")).toBe("dec");
    writeAddressFormat("ws", "hex");
    expect(readAddressFormat("ws")).toBe("hex");
  });

  it("treats unexpected stored values as dec", () => {
    window.localStorage.setItem(addressFormatStorageKey("ws"), "garbage");
    expect(readAddressFormat("ws")).toBe("dec");
  });
});
