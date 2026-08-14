# Sightread soundfonts

Reproducible packaging and release tooling for the soundfonts used by
Sightread. Generated audio assets are published as GitHub Release assets rather
than committed to Git history.

## What belongs in this repository

Git tracks the download scripts, source pins, integrity metadata, packaging
workflow, and third-party notices. Downloaded files under `vendor/` and release
artifacts under `dist/` are intentionally ignored.

The initial pack is FluidR3_GM in MIDI.js MP3/JavaScript format. Its default
source and percussion override are pinned to immutable commits in
`soundfonts.json`, and its reviewed instrument inventory is tracked under
`manifests/`.

## Requirements

- Node.js 20 or newer

There are no npm dependencies.

## Build a release locally

```sh
npm run build
```

This performs three operations:

1. Downloads every instrument in the reviewed inventory from the pinned
   upstream commit and generates `instruments.txt`.
2. Verifies the inventory and file contents, and computes SHA-256 hashes.
3. Creates a versioned archive, a machine-readable manifest, the third-party
   notice, and `SHA256SUMS` under `dist/`.

If a verified local copy already exists, fetching is skipped. To replace it:

```sh
npm run fetch -- --force
```

For an offline or migration build, copy from an existing directory:

```sh
npm run fetch -- --source-dir /path/to/FluidR3_GM
```

Remove generated files with `npm run clean`.

## Publish a release

1. Update the pack version and upstream pin in `soundfonts.json`.
2. Run `npm test` and `npm run build` locally.
3. Commit the metadata and tag it as `fluidr3-v<version>`, for example
   `fluidr3-v1.0.0`.
4. Push the tag.

The `Publish soundfont release` workflow verifies that the tag matches the
configured version, rebuilds from the pinned upstream source, and creates a
GitHub Release containing everything in `dist/`.

Published assets are immutable by convention: never replace an asset on an
existing tag. Publish a new version instead.

## Consume from Sightread

The private application should pin both the release URL and archive checksum.
Its build downloads and extracts the archive before `react-router build`:

```sh
curl --fail --location --retry 3 \
  --output /tmp/FluidR3_GM.tar.gz \
  https://github.com/sightread/soundfonts/releases/download/fluidr3-v1.0.0/FluidR3_GM-mp3-js-v1.0.0.tar.gz

echo "$PINNED_SOUNDFONT_SHA256  /tmp/FluidR3_GM.tar.gz" | shasum -a 256 --check
tar -xzf /tmp/FluidR3_GM.tar.gz -C public/soundfonts
```

`PINNED_SOUNDFONT_SHA256` should be copied from that release's `SHA256SUMS`
into the private application's own versioned configuration.

The deployed application can continue serving
`/soundfonts/FluidR3_GM/<instrument>-mp3.js` from its own origin. A PWA service
worker can precache piano and percussion and runtime-cache other instruments
without changing the release layout.

## Adding another soundfont

Treat each collection as an independently licensed pack:

1. Confirm that redistribution and format conversion are permitted.
2. Add its source URL, immutable revision, expected inventory, and version to
   `soundfonts.json`.
3. Add a pack-specific third-party notice. Do not assume FluidR3_GM's license
   applies to another collection.
4. Add a fetcher/verifier or generalize the existing scripts.
5. Publish it under a distinct tag and artifact name.

## Licenses

Sightread's scripts and documentation are MIT licensed. Soundfont assets retain
their own licenses; see `THIRD_PARTY_LICENSES/` and the notices embedded in each
release archive.
