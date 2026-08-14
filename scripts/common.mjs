import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const rootDir = fileURLToPath(new URL("../", import.meta.url));
export const vendorDir = path.join(rootDir, "vendor");
export const distDir = path.join(rootDir, "dist");

export async function loadConfig() {
  return JSON.parse(
    await readFile(path.join(rootDir, "soundfonts.json"), "utf8"),
  );
}

export async function loadPack(packName) {
  const config = await loadConfig();
  if (config.schemaVersion !== 1) {
    throw new Error("soundfonts.json must have schemaVersion 1");
  }
  const pack = config.packs?.[packName];
  if (!pack) {
    throw new Error(`Pack "${packName}" not found in soundfonts.json`);
  }
  if (!/^https?:\/\//.test(pack.source?.url)) {
    throw new Error(`Pack "${packName}" source URL must be an HTTP(S) URL`);
  }
  if (pack.source.sha256 && !/^[0-9a-f]{64}$/.test(pack.source.sha256)) {
    throw new Error(
      `Pack "${packName}" source SHA-256 must be a lowercase 64-character hex string`,
    );
  }
  if (pack.source.format && pack.source.format !== "sf2") {
    throw new Error(
      `Pack "${packName}" source format must be "sf2", got "${pack.source.format}"`,
    );
  }
  return { name: packName, ...pack };
}

export async function loadAllPacks() {
  const config = await loadConfig();
  return Object.entries(config.packs ?? {}).map(([name, pack]) => ({
    name,
    ...pack,
  }));
}

export async function loadInstrumentInventory(pack) {
  const inventory = JSON.parse(
    await readFile(path.join(rootDir, pack.inventory), "utf8"),
  );
  if (!Array.isArray(inventory))
    throw new Error(`${pack.inventory} must contain a JSON array`);
  return parseInstrumentList(inventory.join("\n"));
}

export function parseInstrumentList(contents) {
  const names = contents
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);

  if (new Set(names).size !== names.length) {
    throw new Error("instrument list contains duplicate names");
  }
  return names;
}

export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyPack(packName, { directory } = {}) {
  const pack = await loadPack(packName);
  directory ??= path.join(vendorDir, packName);
  const instrumentsFile = path.join(directory, "instruments.txt");
  const instruments = parseInstrumentList(
    await readFile(instrumentsFile, "utf8"),
  );
  const expectedInstruments = await loadInstrumentInventory(pack);
  if (JSON.stringify(instruments) !== JSON.stringify(expectedInstruments)) {
    throw new Error(
      `${packName}: instruments.txt does not match the canonical instrument inventory`,
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
      `${packName}: inventory mismatch; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
    );
  }

  const files = [];
  for (const name of instruments.toSorted()) {
    const filename = `${name}-mp3.js`;
    const file = path.join(directory, filename);
    const fileStat = await stat(file);
    if (fileStat.size < 64 * 1024)
      throw new Error(`${packName}: ${filename} is unexpectedly small`);

    const handle = await open(file, "r");
    try {
      const headerBuffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(
        headerBuffer,
        0,
        headerBuffer.length,
        0,
      );
      const header = headerBuffer.subarray(0, bytesRead).toString("utf8");
      if (!header.includes(`MIDI.Soundfont.${name} = {`)) {
        throw new Error(
          `${packName}: ${filename} does not declare the expected MIDI.Soundfont entry`,
        );
      }
      if (!header.includes("data:audio/mp3;base64,")) {
        throw new Error(
          `${packName}: ${filename} does not contain MP3 data URLs`,
        );
      }
    } finally {
      await handle.close();
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
    id: packName,
    version: pack.version,
    format: pack.format,
    source: pack.source,
    license: pack.license,
    instrumentCount: instruments.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
  };
}

export function optionsFrom(argv) {
  const options = { force: false, packs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") options.force = true;
    else if (argument === "--pack") {
      const name = argv[++index];
      if (!name) throw new Error("--pack requires a name");
      options.packs.push(name);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export function releaseTag(pack) {
  return `${pack.name.toLowerCase()}-v${pack.version}`;
}

export function archiveName(pack) {
  return `${pack.name}-mp3-js-v${pack.version}.tar.gz`;
}
