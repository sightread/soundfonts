# Sightread soundfonts

Reproducible packaging and release tooling for the soundfonts used by
Sightread. Generated audio assets are published as GitHub Release assets.

## Soundfont packs

| Pack | Source | License | Instruments |
|------|--------|---------|-------------|
| FluidR3_GM | [pianobooster/fluid-soundfont](https://github.com/pianobooster/fluid-soundfont) v3.1 | CC-BY-3.0-US | 129 |
| SalC5Light2 | [musical-artifacts #6881](https://musical-artifacts.com/artifacts/6881) | CC-BY-3.0 | 1 |

## Requirements

- [Bun](https://bun.sh/) 1.0+
- [FluidSynth](https://www.fluidsynth.org/) (`brew install fluidsynth`)
- [LAME](https://lame.sourceforge.io/) (`brew install lame`)

## Source releases

SF2 source files are hosted as GitHub Release assets under the `sources-v1`
tag to avoid depending on external sites. Each pack's `source.url` in
`soundfonts.json` points to these assets.

| Asset | URL | SHA256 |
|-------|-----|--------|
| FluidR3_GM.sf2 | `sources-v1/FluidR3_GM.sf2` | `74594e8f...` |
| SalC5Light2.sf2 | `sources-v1/SalC5Light2.sf2` | _(pin after upload)_ |

### Creating a source release

1. Download the SF2 files to a local directory.
2. Create the release:
   ```sh
   gh release create sources-v1 \
     FluidR3_GM.sf2 SalC5Light2.sf2 \
     --title "SF2 source files" \
     --notes "Pinned SoundFont 2 source files for the sightread-soundfonts build."
   ```
3. Run `bun run fetch --force` to download from the new URLs and verify hashes.
4. Pin any missing SHA256 values in `soundfonts.json`.

Source releases are immutable: to add or replace SF2 files, create a new tag
(e.g. `sources-v2`).

## What belongs in this repository

Git tracks the generation scripts, SF2 source pins, instrument inventories,
packaging workflow, and third-party notices. Downloaded SF2 files under `vendor/`
and generated artifacts under `dist/` are intentionally ignored.

## Build a release locally

```sh
bun run build
```

This performs three operations:

1. Parses each pack's SF2 source file, renders each instrument through
   FluidSynth + LAME, and generates MIDI.js `.js` files.
2. Verifies the inventory and file contents, and computes SHA-256 hashes.
3. Creates a versioned archive, a machine-readable manifest, the third-party
   notice, and `SHA256SUMS` under `dist/` for each pack.

### Individual steps

```sh
# Download SF2 source files (skip if already cached)
bun run fetch

# Generate MIDI.js files from SF2 sources
bun run generate

# Verify generated files
bun run verify

# Package into release archives
bun run package
```

Options:

```sh
bun run fetch -- --force            # Re-download even if cached
bun run fetch -- --pack FluidR3_GM  # Fetch only a specific pack
bun run generate -- --pack SalC5Light2  # Generate only one pack
```

Remove generated files with `bun run clean`.

## Publish a release

1. Update the pack version and source pin in `soundfonts.json`.
2. Run `bun test` and `bun run build` locally.
3. Commit the metadata and tag it as `<pack-lowercase>-v<version>`, e.g.
   `fluidr3_gm-v1.0.0` or `salc5light2-v1.0.0`.
4. Push the tag.

The workflow verifies the tag, rebuilds from the pinned SF2 source, and creates
a GitHub Release containing the archive, manifest, license, and checksums.

Published assets are immutable by convention: never replace an asset on an
existing tag. Publish a new version instead.

## Adding another soundfont

1. Obtain a SoundFont 2 (.sf2) file with a compatible license (redistribution
   and format conversion must be permitted).
2. Upload the `.sf2` file to a source release (e.g. `sources-v1` or create a
   new `sources-v2` if needed). Use `gh release upload`.
3. Create `manifests/<PackName>.instruments.json` listing the instrument names
   to render (lowercase, underscores, alphanumeric only).
4. Add the pack to `soundfonts.json` with `source.url` pointing to the
   `sources-v<N>/<filename>.sf2` asset and `source.sha256` pinned to its hash.
   Leave `sha256` empty to auto-pin on first fetch.
5. Add a `THIRD_PARTY_LICENSES/<PackName>.md` with the attribution notice.
6. Run `bun run fetch`, `bun run generate`, `bun test`, and `bun run build`.

## How to consume in an app

Pin both the release URL and archive checksum. Download and extract as needed:

```sh
curl --fail --location --retry 3 \
  --output /tmp/FluidR3_GM.tar.gz \
  https://github.com/sightread/soundfonts/releases/download/fluidr3_gm-v1.0.0/FluidR3_GM-mp3-js-v1.0.0.tar.gz

echo "$PINNED_SHA256  /tmp/FluidR3_GM.tar.gz" | shasum -a 256 --check
tar -xzf /tmp/FluidR3_GM.tar.gz -C public/soundfonts
```

## Licenses

Sightread's scripts and documentation are MIT licensed. Soundfont assets retain
their own licenses; see `THIRD_PARTY_LICENSES/` and the notices embedded in each
release archive.
