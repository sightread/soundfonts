import { describe, it, expect } from "bun:test";

import {
  archiveName,
  loadInstrumentInventory,
  loadPack,
  parseInstrumentList,
  releaseTag,
} from "../scripts/common.mjs";

describe("the source is pinned to an immutable commit", () => {
  it("has valid upstream commit and inventory", async () => {
    const pack = await loadPack();
    expect(pack.upstream.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(pack.upstream.path).toBe("FluidR3_GM");
    expect(pack.expectedInstrumentCount).toBe(129);
    expect(pack.sourceOverrides.percussion.commit).toMatch(/^[0-9a-f]{40}$/);
    const inventory = await loadInstrumentInventory(pack);
    expect(inventory.length).toBe(129);
    expect(inventory[0]).toBe("acoustic_grand_piano");
    expect(inventory.at(-1)).toBe("percussion");
  });
});

describe("instrument lists are normalized and validated", () => {
  it("trims and splits correctly", () => {
    expect(parseInstrumentList("piano\r\npercussion\n\n")).toEqual([
      "piano",
      "percussion",
    ]);
  });

  it("rejects duplicates", () => {
    expect(() => parseInstrumentList("piano\npiano\n")).toThrow(/duplicate/);
  });

  it("rejects path traversal", () => {
    expect(() => parseInstrumentList("../piano\n")).toThrow(/Unsafe/);
  });
});

describe("release names are derived from the configured version", () => {
  it("returns correct tag and archive name", async () => {
    const pack = await loadPack();
    expect(releaseTag(pack)).toBe("fluidr3-v1.0.0");
    expect(archiveName(pack)).toBe("FluidR3_GM-mp3-js-v1.0.0.tar.gz");
  });
});
