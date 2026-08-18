import { loadAllPacks, verifyPack } from "./common.mjs";

async function main() {
  const packs = await loadAllPacks();

  for (const pack of packs) {
    const manifest = await verifyPack(pack.name);
    const mib = (manifest.totalBytes / 1024 / 1024).toFixed(1);
    console.log(
      `Verified ${manifest.id}: ${manifest.instrumentCount} instruments, ${manifest.files.length} files, ${mib} MiB`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
