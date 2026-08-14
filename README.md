# Sightread soundfonts

Houses scripts for reproducibly building the MIDI.js soundfonts

* Soundfont 2 Files (SF2) are manually added via GH Releases.
* Scripts turn those SF2 files into MIDI.js-compatible MP3 packs
* We publish the MIDI.js MP3 packs as versioned GH Release assets. 

Scripts require `fluidsynth`, `lame`, and `bun`.

## Packs

| Pack | Source | License |
|------|--------|---------|
| FluidR3_GM | [pianobooster/fluid-soundfont](https://github.com/pianobooster/fluid-soundfont) v3.1 | CC-BY-3.0-US |
| SalC5Light2 | [musical-artifacts](https://musical-artifacts.com/artifacts/6881) | CC-BY-3.0 |

## Build

```sh
bun run fetch   # download pinned SF2 sources into vendor/, verify hashes
bun run build   # check, generate, verify, package -- writes archives to dist/
bun run clean   # removes dist/ and vendor/
```

## Publish a release

1. Bump `version` (and `source`, if the SF2 changed) in `soundfonts.json`.
2. `bun test && bun run build`
3. Commit, and tag `<pack-lowercase>-v<version>` (e.g. `fluidr3_gm-v1.0.0`)
4. Push the commit and tag 

CI rebuilds from the pinned source and creates an appropriate release. Never overwrite an existing release, as live applications may depend on them.

## How to use 

Download the pack you'd like from GH Releases, and optionally verify the checksum.
Ideally pin both via version control.

```sh
curl --fail --location --retry 3 -o /tmp/FluidR3_GM.tar.gz \
  https://github.com/sightread/soundfonts/releases/download/fluidr3_gm-v1.0.0/FluidR3_GM-mp3-js-v1.0.0.tar.gz
echo "$PINNED_SHA256  /tmp/FluidR3_GM.tar.gz" | shasum -a 256 --check
tar -xzf /tmp/FluidR3_GM.tar.gz -C public/soundfonts
```

## License

* Scripts and docs: MIT.
* Soundfont licenses can be found in `THIRD_PARTY_LICENSES/`.
