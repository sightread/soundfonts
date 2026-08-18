import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadAllPacks, sha256, vendorDir } from "./common.mjs";

function optionsFrom(argv) {
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

async function fetchWithRetry(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "sightread-soundfonts-release-builder" },
      });
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * 2 ** (attempt - 1)),
        );
      }
    }
  }
  throw new Error(
    `Failed to download ${url}: ${lastError?.message ?? lastError}`,
  );
}

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
    const targetDir = path.join(vendorDir, pack.name);
    const sf2Path = path.join(targetDir, `${pack.name}.sf2`);
    const tmpDir = path.join(vendorDir, `.${pack.name}.tmp-${process.pid}`);

    if (!options.force) {
      try {
        const existingHash = await sha256(sf2Path);
        if (!pack.source.sha256 || existingHash === pack.source.sha256) {
          const existingStat = await stat(sf2Path);
          console.log(
            `Using existing ${pack.name}.sf2 (${(existingStat.size / 1024 / 1024).toFixed(1)} MiB)`,
          );
          continue;
        }
        console.log(
          `Existing ${pack.name}.sf2 hash mismatch, re-downloading`,
        );
      } catch {
        // File doesn't exist, download it
      }
    }

    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });

    try {
      console.log(`Downloading ${pack.name}.sf2...`);
      const data = await fetchWithRetry(pack.source.url);
      const actualHash = createHash("sha256").update(data).digest("hex");

      if (pack.source.sha256 && actualHash !== pack.source.sha256) {
        throw new Error(
          `SHA-256 mismatch for ${pack.name}.sf2: expected ${pack.source.sha256}, got ${actualHash}`,
        );
      }

      console.log(
        `Downloaded ${pack.name}.sf2 (${(data.length / 1024 / 1024).toFixed(1)} MiB, sha256=${actualHash})`,
      );

      if (!pack.source.sha256) {
        console.log(
          `  Pin this hash in soundfonts.json: "${actualHash}"`,
        );
      }

      await writeFile(path.join(tmpDir, `${pack.name}.sf2`), data);
      await rm(targetDir, { recursive: true, force: true });
      await rename(tmpDir, targetDir);
      console.log(`${pack.name}.sf2 is ready at ${targetDir}`);
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true });
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
