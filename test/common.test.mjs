import { describe, it, expect } from "bun:test";

import {
  archiveName,
  loadAllPacks,
  loadInstrumentInventory,
  loadPack,
  parseInstrumentList,
  releaseTag,
} from "../scripts/common.mjs";

describe("soundfonts.json has valid packs", () => {
  it("loads all packs", async () => {
    const packs = await loadAllPacks();
    expect(packs.length).toBe(2);
    expect(packs.map((p) => p.name).sort()).toEqual([
      "FluidR3_GM",
      "SalC5Light2",
    ]);
  });

  it("FluidR3_GM has correct source and inventory", async () => {
    const pack = await loadPack("FluidR3_GM");
    expect(pack.source.url).toContain("FluidR3_GM.sf2");
    expect(pack.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pack.source.sha256).toBe(
      "74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0",
    );
    const inventory = await loadInstrumentInventory(pack);
    expect(inventory.length).toBe(129);
    expect(inventory[0]).toBe("acoustic_grand_piano");
    expect(inventory.at(-1)).toBe("percussion");
  });

  it("SalC5Light2 has correct source and inventory", async () => {
    const pack = await loadPack("SalC5Light2");
    expect(pack.source.url).toContain("sources-v1/SalC5Light2.sf2");
    expect(pack.source.format).toBe("sf2");
    const inventory = await loadInstrumentInventory(pack);
    expect(inventory).toEqual(["acoustic_grand_piano"]);
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
  it("returns correct tag and archive for FluidR3_GM", async () => {
    const pack = await loadPack("FluidR3_GM");
    expect(releaseTag(pack)).toBe("fluidr3_gm-v1.0.0");
    expect(archiveName(pack)).toBe("FluidR3_GM-mp3-js-v1.0.0.tar.gz");
  });

  it("returns correct tag and archive for SalC5Light2", async () => {
    const pack = await loadPack("SalC5Light2");
    expect(releaseTag(pack)).toBe("salc5light2-v1.0.0");
    expect(archiveName(pack)).toBe("SalC5Light2-mp3-js-v1.0.0.tar.gz");
  });
});
