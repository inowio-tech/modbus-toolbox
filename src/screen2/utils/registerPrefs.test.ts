import { beforeEach, describe, expect, it } from "vitest";

import {
  functionCodeStorageKey,
  isValidFunctionCode,
  readFunctionCode,
  readRegisterView,
  registerViewStorageKey,
  writeFunctionCode,
  writeRegisterView,
} from "./registerPrefs";

describe("registerPrefs", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("storage keys", () => {
    it("scopes the function code per workspace AND slave", () => {
      expect(functionCodeStorageKey("Plant-A", 7)).toBe("inowio.registers.functionCode.Plant-A.7");
      expect(functionCodeStorageKey("Plant-A", 7)).not.toBe(functionCodeStorageKey("Plant-A", 8));
      expect(functionCodeStorageKey("Plant-A", 7)).not.toBe(functionCodeStorageKey("Plant-B", 7));
    });

    it("scopes the register view per workspace", () => {
      expect(registerViewStorageKey("Plant-A")).toBe("inowio.registers.view.Plant-A");
      expect(registerViewStorageKey("Plant-A")).not.toBe(registerViewStorageKey("Plant-B"));
    });
  });

  describe("isValidFunctionCode", () => {
    it("accepts the supported Modbus function codes", () => {
      for (const fc of [1, 2, 3, 4, 5, 6, 15, 16]) {
        expect(isValidFunctionCode(fc)).toBe(true);
      }
    });

    it("rejects unsupported codes", () => {
      for (const fc of [0, 7, 99, -1, Number.NaN]) {
        expect(isValidFunctionCode(fc)).toBe(false);
      }
    });
  });

  describe("readFunctionCode", () => {
    it("defaults to 0x04 (Input Registers) when nothing is stored", () => {
      expect(readFunctionCode("ws", 1)).toBe(4);
    });

    it("returns the stored value when it is a valid function code", () => {
      writeFunctionCode("ws", 1, 3);
      expect(readFunctionCode("ws", 1)).toBe(3);
    });

    it("falls back to the default for an invalid stored value", () => {
      window.localStorage.setItem(functionCodeStorageKey("ws", 1), "99");
      expect(readFunctionCode("ws", 1)).toBe(4);
    });

    it("falls back to the default for a non-numeric stored value", () => {
      window.localStorage.setItem(functionCodeStorageKey("ws", 1), "not-a-number");
      expect(readFunctionCode("ws", 1)).toBe(4);
    });

    it("keeps each slave's register type independent", () => {
      writeFunctionCode("ws", 1, 3);
      writeFunctionCode("ws", 2, 1);
      expect(readFunctionCode("ws", 1)).toBe(3);
      expect(readFunctionCode("ws", 2)).toBe(1);
      // A slave that was never touched still gets the default.
      expect(readFunctionCode("ws", 3)).toBe(4);
    });

    it("does not leak a register type across workspaces", () => {
      writeFunctionCode("Plant-A", 1, 16);
      expect(readFunctionCode("Plant-B", 1)).toBe(4);
    });
  });

  describe("register view", () => {
    it("defaults to edit when nothing is stored", () => {
      expect(readRegisterView("ws")).toBe("edit");
    });

    it("round-trips monitor and edit", () => {
      writeRegisterView("ws", "monitor");
      expect(readRegisterView("ws")).toBe("monitor");
      writeRegisterView("ws", "edit");
      expect(readRegisterView("ws")).toBe("edit");
    });

    it("treats any unexpected stored value as edit", () => {
      window.localStorage.setItem(registerViewStorageKey("ws"), "garbage");
      expect(readRegisterView("ws")).toBe("edit");
    });

    it("keeps the view independent per workspace", () => {
      writeRegisterView("Plant-A", "monitor");
      expect(readRegisterView("Plant-A")).toBe("monitor");
      expect(readRegisterView("Plant-B")).toBe("edit");
    });
  });
});
