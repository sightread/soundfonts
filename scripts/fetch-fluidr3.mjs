import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  loadInstrumentInventory,
  loadPack,
  vendorDir,
  verifyFluidR3,
} from "./common.mjs";

function optionsFrom(argv) {
  const options = { force: false, sourceDir: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") options.force = true;
    else if (argument === "--source-dir") options.sourceDir = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (argv.includes("--source-dir") && !options.sourceDir) {
    throw new Error("--source-dir requires a path");
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

async function concurrentMap(items, concurrency, operation) {
  let nextIndex = 0;
  let completed = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        await operation(items[index]);
        completed += 1;
        if (completed % 16 === 0 || completed === items.length) {
          console.log(`Fetched ${completed}/${items.length} instruments`);
        }
      }
    },
  );
  await Promise.all(workers);
}

function rawSourceUrl(source, filename) {
  const repository = new URL(source.repository);
  const [owner, name] = repository.pathname.split("/").filter(Boolean);
  return `https://raw.githubusercontent.com/${owner}/${name}/${source.commit}/${source.path}/${filename}`;
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  const pack = await loadPack();
  const target = path.join(vendorDir, "FluidR3_GM");

  if (!options.force) {
    try {
      const manifest = await verifyFluidR3({ directory: target });
      console.log(
        `Using verified local FluidR3_GM (${manifest.instrumentCount} instruments, ${manifest.totalBytes} bytes)`,
      );
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn(`Existing vendor copy is incomplete: ${error.message}`);
      }
    }
  }

  const staging = path.join(vendorDir, `.FluidR3_GM.tmp-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    const instruments = await loadInstrumentInventory(pack);
    await writeFile(
      path.join(staging, "instruments.txt"),
      `${instruments.join("\n")}\n`,
    );

    await concurrentMap(instruments, 8, async (name) => {
      const filename = `${name}-mp3.js`;
      const destination = path.join(staging, filename);
      if (options.sourceDir) {
        await copyFile(path.join(options.sourceDir, filename), destination);
      } else {
        const source = pack.sourceOverrides?.[name] ?? pack.upstream;
        const contents = await fetchWithRetry(rawSourceUrl(source, filename));
        await writeFile(destination, contents);
      }
    });

    await verifyFluidR3({ directory: staging });
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    console.log(`FluidR3_GM is ready at ${target}`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
