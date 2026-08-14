import process from "node:process";

import { loadAllPacks, optionsFrom, verifyPack } from "./common.mjs";

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  const allPacks = await loadAllPacks();
  const packs = options.packs.length
    ? allPacks.filter((p) => options.packs.includes(p.name))
    : allPacks;

  if (packs.length === 0) {
    throw new Error("No matching packs found in soundfonts.json");
  }

  for (const pack of packs) {
    const manifest = await verifyPack(pack.name);
    const mib = (manifest.totalBytes / 1024 / 1024).toFixed(1);
    console.log(
      `Verified ${manifest.id}: ${manifest.instrumentCount} instruments, ${manifest.files.length} files, ${mib} MiB`,
    );
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
