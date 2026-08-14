import { describe, it, expect } from "bun:test";

import {
  loadAllPacks,
  loadInstrumentInventory,
  parseInstrumentList,
} from "../scripts/common.mjs";

describe("soundfonts.json", () => {
  it("every pack's instrument inventory parses without error", async () => {
    for (const pack of await loadAllPacks()) {
      const inventory = await loadInstrumentInventory(pack);
      expect(inventory.length).toBeGreaterThan(0);
    }
  });
});

describe("instrument lists are normalized and validated", () => {
  it("rejects duplicates", () => {
    expect(() => parseInstrumentList("piano\npiano\n")).toThrow(/duplicate/);
  });
});
