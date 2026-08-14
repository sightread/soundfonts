import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const rootDir = fileURLToPath(new URL("../", import.meta.url));
export const vendorDir = path.join(rootDir, "vendor");
export const distDir = path.join(rootDir, "dist");

export async function loadPack() {
  const config = JSON.parse(
    await readFile(path.join(rootDir, "soundfonts.json"), "utf8"),
  );
  const pack = config.packs?.FluidR3_GM;
  if (config.schemaVersion !== 1 || !pack) {
    throw new Error(
      "soundfonts.json does not define a schema-v1 FluidR3_GM pack",
    );
  }
  for (const [name, source] of [
    ["default", pack.upstream],
    ...Object.entries(pack.sourceOverrides ?? {}),
  ]) {
    if (!/^[0-9a-f]{40}$/.test(source.commit)) {
      throw new Error(
        `${name} source commit must be a full 40-character Git SHA`,
      );
    }
    if (
      !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(
        source.repository,
      )
    ) {
      throw new Error(
        `${name} source must be a canonical GitHub repository URL`,
      );
    }
  }
  return pack;
}

export async function loadInstrumentInventory(pack) {
  pack ??= await loadPack();
  const inventory = JSON.parse(
    await readFile(path.join(rootDir, pack.inventory), "utf8"),
  );
  if (!Array.isArray(inventory))
    throw new Error(`${pack.inventory} must contain a JSON array`);
  const instruments = parseInstrumentList(inventory.join("\n"));
  if (instruments.length !== pack.expectedInstrumentCount) {
    throw new Error(
      `Expected ${pack.expectedInstrumentCount} inventory entries, found ${instruments.length}`,
    );
  }
  return instruments;
}

export function parseInstrumentList(contents) {
  const names = contents
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);

  for (const name of names) {
    if (!/^[a-z0-9_]+$/.test(name)) {
      throw new Error(`Unsafe instrument name: ${JSON.stringify(name)}`);
    }
  }
  if (new Set(names).size !== names.length) {
    throw new Error("instruments.txt contains duplicate names");
  }
  return names;
}

export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyFluidR3({
  directory = path.join(vendorDir, "FluidR3_GM"),
} = {}) {
  const pack = await loadPack();
  const instrumentsFile = path.join(directory, "instruments.txt");
  const instruments = parseInstrumentList(
    await readFile(instrumentsFile, "utf8"),
  );
  const expectedInstruments = await loadInstrumentInventory(pack);
  if (JSON.stringify(instruments) !== JSON.stringify(expectedInstruments)) {
    throw new Error(
      "instruments.txt does not match the canonical instrument inventory",
    );
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const actualJsFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith("-mp3.js"))
    .map((entry) => entry.name)
    .sort();
  const expectedJsFiles = instruments.map((name) => `${name}-mp3.js`).sort();

  if (JSON.stringify(actualJsFiles) !== JSON.stringify(expectedJsFiles)) {
    const missing = expectedJsFiles.filter(
      (file) => !actualJsFiles.includes(file),
    );
    const unexpected = actualJsFiles.filter(
      (file) => !expectedJsFiles.includes(file),
    );
    throw new Error(
      `Soundfont inventory mismatch; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
    );
  }

  const files = [];
  for (const name of instruments.toSorted()) {
    const filename = `${name}-mp3.js`;
    const file = path.join(directory, filename);
    const fileStat = await stat(file);
    if (fileStat.size < 64 * 1024)
      throw new Error(`${filename} is unexpectedly small`);

    const handle = await open(file, "r");
    const headerBuffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(
      headerBuffer,
      0,
      headerBuffer.length,
      0,
    );
    await handle.close();
    const header = headerBuffer.subarray(0, bytesRead).toString("utf8");
    if (!header.includes(`MIDI.Soundfont.${name} = {`)) {
      throw new Error(
        `${filename} does not declare the expected MIDI.Soundfont entry`,
      );
    }
    if (!header.includes("data:audio/mp3;base64,")) {
      throw new Error(`${filename} does not contain MP3 data URLs`);
    }

    files.push({ filename, bytes: fileStat.size, sha256: await sha256(file) });
  }

  const instrumentsStat = await stat(instrumentsFile);
  files.push({
    filename: "instruments.txt",
    bytes: instrumentsStat.size,
    sha256: await sha256(instrumentsFile),
  });
  files.sort((a, b) => a.filename.localeCompare(b.filename));

  return {
    schemaVersion: 1,
    id: "FluidR3_GM",
    version: pack.version,
    format: pack.format,
    sources: {
      default: pack.upstream,
      overrides: pack.sourceOverrides ?? {},
    },
    license: pack.license,
    instrumentCount: instruments.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
  };
}

export function releaseTag(pack) {
  return `fluidr3-v${pack.version}`;
}

export function archiveName(pack) {
  return `FluidR3_GM-mp3-js-v${pack.version}.tar.gz`;
}
