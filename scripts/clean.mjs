import { rm } from "node:fs/promises";

import { distDir, vendorDir } from "./common.mjs";

await Promise.all([
  rm(distDir, { recursive: true, force: true }),
  rm(vendorDir, { recursive: true, force: true }),
]);
console.log("Removed generated vendor and dist directories");
