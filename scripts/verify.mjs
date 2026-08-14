import { vendorDir, verifyFluidR3 } from "./common.mjs";

verifyFluidR3()
  .then((manifest) => {
    const mib = (manifest.totalBytes / 1024 / 1024).toFixed(1);
    console.log(
      `Verified ${manifest.id}: ${manifest.instrumentCount} instruments, ${manifest.files.length} files, ${mib} MiB in ${vendorDir}`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
