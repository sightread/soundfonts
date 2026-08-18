import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import path from "node:path";
import process from "node:process";

import {
  archiveName,
  distDir,
  loadAllPacks,
  rootDir,
  sha256,
  vendorDir,
  verifyPack,
} from "./common.mjs";

function writeTarString(header, offset, length, value) {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length > length)
    throw new Error(`Tar header value is too long: ${value}`);
  encoded.copy(header, offset);
}

function writeTarOctal(header, offset, length, value) {
  const encoded = `${value.toString(8).padStart(length - 1, "0")}\0`;
  writeTarString(header, offset, length, encoded);
}

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeTarString(header, 156, 1, "0");
  writeTarString(header, 257, 6, "ustar\0");
  writeTarString(header, 263, 2, "00");

  const checksum = header.reduce((total, byte) => total + byte, 0);
  writeTarString(
    header,
    148,
    8,
    `${checksum.toString(8).padStart(6, "0")}\0 `,
  );
  return header;
}

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(
        ...(await listFiles(path.join(directory, entry.name), relative)),
      );
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

async function* tarContents(sourceDirectory, rootName) {
  for (const relative of await listFiles(sourceDirectory)) {
    const file = path.join(sourceDirectory, relative);
    const fileStat = await stat(file);
    yield tarHeader(`${rootName}/${relative}`, fileStat.size);
    for await (const chunk of createReadStream(file)) yield chunk;
    const padding = (512 - (fileStat.size % 512)) % 512;
    if (padding) yield Buffer.alloc(padding);
  }
  yield Buffer.alloc(1024);
}

async function createDeterministicArchive(sourceDirectory, archive) {
  await pipeline(
    Readable.from(
      tarContents(sourceDirectory, path.basename(sourceDirectory)),
    ),
    createGzip({ level: 9, mtime: 0 }),
    createWriteStream(archive, { flags: "wx" }),
  );
}

async function main() {
  const packs = await loadAllPacks();
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  for (const pack of packs) {
    const stagingRoot = path.join(distDir, `.stage-${process.pid}`);
    const stagingPack = path.join(stagingRoot, pack.name);

    await mkdir(stagingPack, { recursive: true });

    try {
      await cp(path.join(vendorDir, pack.name), stagingPack, {
        recursive: true,
      });
      await copyFile(
        path.join(rootDir, "THIRD_PARTY_LICENSES", `${pack.name}.md`),
        path.join(stagingPack, "LICENSE.md"),
      );

      const manifest = await verifyPack(pack.name);
      await writeFile(
        path.join(stagingPack, "MANIFEST.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );

      const archive = path.join(distDir, archiveName(pack));
      const temporaryArchive = `${archive}.tmp`;
      await createDeterministicArchive(stagingPack, temporaryArchive);
      await rename(temporaryArchive, archive);

      const manifestName = `${pack.name}-manifest-v${pack.version}.json`;
      const licenseName = `${pack.name}-LICENSE-v${pack.version}.md`;
      await writeFile(
        path.join(distDir, manifestName),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await copyFile(
        path.join(rootDir, "THIRD_PARTY_LICENSES", `${pack.name}.md`),
        path.join(distDir, licenseName),
      );
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }

  // Write per-pack SHA256SUMS files
  for (const pack of packs) {
    const releaseFiles = [
      archiveName(pack),
      `${pack.name}-LICENSE-v${pack.version}.md`,
      `${pack.name}-manifest-v${pack.version}.json`,
    ].sort();

    const checksumLines = [];
    for (const filename of releaseFiles) {
      checksumLines.push(
        `${await sha256(path.join(distDir, filename))}  ${filename}`,
      );
    }
    await writeFile(
      path.join(distDir, `${pack.name}-SHA256SUMS`),
      `${checksumLines.join("\n")}\n`,
    );

    const archive = path.join(distDir, archiveName(pack));
    const archiveStat = await stat(archive);
    console.log(
      `Packaged ${path.basename(archive)} (${(archiveStat.size / 1024 / 1024).toFixed(1)} MiB)`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
