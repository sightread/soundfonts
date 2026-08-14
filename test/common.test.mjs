import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveName,
  loadInstrumentInventory,
  loadPack,
  parseInstrumentList,
  releaseTag,
} from "../scripts/common.mjs";

test("the source is pinned to an immutable commit", async () => {
  const pack = await loadPack();
  assert.match(pack.upstream.commit, /^[0-9a-f]{40}$/);
  assert.equal(pack.upstream.path, "FluidR3_GM");
  assert.equal(pack.expectedInstrumentCount, 129);
  assert.match(pack.sourceOverrides.percussion.commit, /^[0-9a-f]{40}$/);
  const inventory = await loadInstrumentInventory(pack);
  assert.equal(inventory.length, 129);
  assert.equal(inventory[0], "acoustic_grand_piano");
  assert.equal(inventory.at(-1), "percussion");
});

test("instrument lists are normalized and validated", () => {
  assert.deepEqual(parseInstrumentList("piano\r\npercussion\n\n"), [
    "piano",
    "percussion",
  ]);
  assert.throws(() => parseInstrumentList("piano\npiano\n"), /duplicate/);
  assert.throws(() => parseInstrumentList("../piano\n"), /Unsafe/);
});

test("release names are derived from the configured version", async () => {
  const pack = await loadPack();
  assert.equal(releaseTag(pack), "fluidr3-v1.0.0");
  assert.equal(archiveName(pack), "FluidR3_GM-mp3-js-v1.0.0.tar.gz");
});
