import { stat } from "node:fs/promises";
import path from "node:path";

import { loadAllPacks, vendorDir } from "./common.mjs";

async function main() {
  const packs = await loadAllPacks();
  const missing = [];

  for (const pack of packs) {
    const sf2Path = path.join(vendorDir, pack.name, `${pack.name}.sf2`);
    try {
      await stat(sf2Path);
    } catch {
      missing.push(pack.name);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `SF2 source files not found for: ${missing.join(", ")}\n` +
      `Run "bun run fetch" to download them.`,
    );
  }

  console.log(`All ${packs.length} pack SF2 files are present.`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
