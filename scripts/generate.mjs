import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  loadInstrumentInventory,
  loadPack,
  parseInstrumentList,
  vendorDir,
  verifyPack,
} from "./common.mjs";

const execFileAsync = promisify(execFile);

const GM_INSTRUMENTS = [
  "acoustic_grand_piano","bright_acoustic_piano","electric_grand_piano",
  "honkytonk_piano","electric_piano_1","electric_piano_2","harpsichord",
  "clavinet","celesta","glockenspiel","music_box","vibraphone","marimba",
  "xylophone","tubular_bells","dulcimer","drawbar_organ","percussive_organ",
  "rock_organ","church_organ","reed_organ","accordion","harmonica",
  "tango_accordion","acoustic_guitar_nylon","acoustic_guitar_steel",
  "electric_guitar_jazz","electric_guitar_clean","electric_guitar_muted",
  "overdriven_guitar","distortion_guitar","guitar_harmonics","acoustic_bass",
  "electric_bass_finger","electric_bass_pick","fretless_bass","slap_bass_1",
  "slap_bass_2","synth_bass_1","synth_bass_2","violin","viola","cello",
  "contrabass","tremolo_strings","pizzicato_strings","orchestral_harp",
  "timpani","string_ensemble_1","string_ensemble_2","synth_strings_1",
  "synth_strings_2","choir_aahs","voice_oohs","synth_choir","orchestra_hit",
  "trumpet","trombone","tuba","muted_trumpet","french_horn","brass_section",
  "synth_brass_1","synth_brass_2","soprano_sax","alto_sax","tenor_sax",
  "baritone_sax","oboe","english_horn","bassoon","clarinet","piccolo",
  "flute","recorder","pan_flute","blown_bottle","shakuhachi","whistle",
  "ocarina","lead_1_square","lead_2_sawtooth","lead_3_calliope",
  "lead_4_chiff","lead_5_charang","lead_6_voice","lead_7_fifths",
  "lead_8_bass__lead","pad_1_new_age","pad_2_warm","pad_3_polysynth",
  "pad_4_choir","pad_5_bowed","pad_6_metallic","pad_7_halo","pad_8_sweep",
  "fx_1_rain","fx_2_soundtrack","fx_3_crystal","fx_4_atmosphere",
  "fx_5_brightness","fx_6_goblins","fx_7_echoes","fx_8_scifi","sitar",
  "banjo","shamisen","koto","kalimba","bagpipe","fiddle","shanai",
  "tinkle_bell","agogo","steel_drums","woodblock","taiko_drum","melodic_tom",
  "synth_drum","reverse_cymbal","guitar_fret_noise","breath_noise",
  "seashore","bird_tweet","telephone_ring","helicopter","applause","gunshot",
];

// --- SF2 parser (minimal, just enough for preset enumeration) ---

function parseSF2(buffer) {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let pos = 0;

  function readTag() {
    const tag = buffer.toString("ascii", pos, pos + 4);
    pos += 4;
    return tag;
  }

  function readUInt32() {
    const val = dv.getUint32(pos, true);
    pos += 4;
    return val;
  }

  // RIFF header
  const riffTag = readTag();
  if (riffTag !== "RIFF") throw new Error("Not a RIFF file");
  readUInt32(); // file size
  const formType = readTag();
  if (formType !== "sfbk") throw new Error("Not an SF2 file (expected sfbk)");

  let presetNames = [];
  let pdtaPos = -1;
  let pdtaSize = 0;

  while (pos < buffer.length - 8) {
    const chunkId = readTag();
    const chunkSize = readUInt32();
    const chunkEnd = pos + chunkSize;

    if (chunkId === "LIST") {
      const listType = readTag();
      if (listType === "INFO") {
        // Parse INFO sub-chunks
        while (pos < chunkEnd - 8) {
          const subId = readTag();
          const subSize = readUInt32();
          if (subId === "ifil") {
            // skip version
          } else if (["isng", "INAM", "ieng", "iprd", "icop", "icmt", "isft"].includes(subId)) {
            // skip string sub-chunks
          }
          pos += subSize;
          if (subSize & 1) pos++; // pad byte
        }
      } else if (listType === "sdta") {
        pos = chunkEnd; // skip sample data
      } else if (listType === "pdta") {
        pdtaPos = pos;
        pdtaSize = chunkSize - 4; // subtract the LIST type tag already read
        pos = chunkEnd;
      } else {
        pos = chunkEnd;
      }
    } else {
      pos = chunkEnd;
    }
  }

  if (pdtaPos < 0) throw new Error("pdta chunk not found in SF2");

  // Parse pdta sub-chunks
  pos = pdtaPos;
  const pdtaEnd = pdtaPos + pdtaSize + 4; // +4 for the "pdta" tag itself

  // Skip to phdr
  while (pos < pdtaEnd - 8) {
    const subId = readTag();
    const subSize = readUInt32();
    const subEnd = pos + subSize;

    if (subId === "phdr") {
      // Parse preset headers
      const numPresets = Math.floor(subSize / 38);
      for (let i = 0; i < numPresets; i++) {
        const name = buffer.toString("ascii", pos, pos + 20).replace(/\0.*$/, "");
        const preset = dv.getUint16(pos + 20, true);
        const bank = dv.getUint16(pos + 22, true);
        presetNames.push({ name, bank, preset });
        pos += 38;
      }
    } else {
      pos = subEnd;
    }
  }

  return { presetNames };
}

// --- MIDI file generation ---

function createMidi(program, note, bank = 0) {
  const vel = 85;
  const duration = 3000;
  const events = [];

  if (bank !== 0) {
    // Bank select: CC 0 (MSB) then CC 32 (LSB)
    events.push(Buffer.from([0xb0, 0x00, bank & 0x7f]));
    events.push(Buffer.from([0xb0, 0x20, 0x00]));
  }
  // Program change on channel 0
  events.push(Buffer.from([0xc0, program & 0x7f]));
  // Note on
  events.push(Buffer.from([0x90, note & 0x7f, vel]));
  // Note off after duration ms
  events.push(
    Buffer.from([0x80, note & 0x7f, 0x00]),
  );

  // Encode delta times (0 except note off)
  const deltas = [
    Buffer.from([0x00]), // bank select MSB
    Buffer.from([0x00]), // bank select LSB
    Buffer.from([0x00]), // program change
    Buffer.from([0x00]), // note on
    encodeVariableLength(duration), // note off (delta = duration ms)
  ];

  // Build track data
  const trackChunks = [];
  for (let i = 0; i < events.length; i++) {
    trackChunks.push(deltas[i]);
    trackChunks.push(events[i]);
  }
  // End of track
  trackChunks.push(Buffer.from([0x00, 0xff, 0x2f, 0x00]));

  const trackData = Buffer.concat(trackChunks);
  const trackSize = trackData.length;

  // Build header: MThd + 6 bytes
  const header = Buffer.alloc(14);
  header.write("MThd", 0);
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(0, 8); // format 0
  header.writeUInt16BE(1, 10); // 1 track
  header.writeUInt16BE(480, 12); // ticks per quarter

  // Build track: MTrk + size + data
  const trackHeader = Buffer.alloc(8);
  trackHeader.write("MTrk", 0);
  trackHeader.writeUInt32BE(trackSize, 4);

  return Buffer.concat([header, trackHeader, trackData]);
}

function encodeVariableLength(value) {
  if (value < 0 || value > 0x0fffffff) throw new Error("Value out of range");
  if (value === 0) return Buffer.from([0x00]);
  const bytes = [];
  let v = value;
  bytes.push(v & 0x7f);
  v >>>= 7;
  while (v > 0) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Buffer.from(bytes.reverse());
}

// --- Render pipeline ---

async function renderInstrument(sf2Path, bank, program, midiPath, wavPath) {
  // Write MIDI file
  const midi = createMidi(program, 60, bank); // middle C (note 60)
  await writeFile(midiPath, midi);

  // Render with fluidsynth
  await execFileAsync("fluidsynth", [
    "-ni", // non-interactive
    "-C", "no", // no control drum
    "-R", "no", // no reverb
    "-g", "0.5", // gain
    "-F", wavPath, // output WAV
    sf2Path,
    midiPath,
  ]);
}

async function convertToMp3(wavPath, mp3Path) {
  // lame reads WAV from stdin, writes MP3 to stdout
  await execFileAsync("lame", [
    "-v", // VBR
    "-b", "8", // minimum bitrate
    "-B", "64", // maximum bitrate
    "--quiet",
    wavPath,
    mp3Path,
  ]);
}

function writeMidiJsFile(instrumentName, noteMap) {
  const entries = [];
  for (const [noteName, base64] of Object.entries(noteMap)) {
    entries.push(`  "${noteName}": "data:audio/mp3;base64,${base64}"`);
  }
  return [
    `if (typeof(MIDI) === 'undefined') var MIDI = {};`,
    `if (typeof(MIDI.Soundfont) === 'undefined') MIDI.Soundfont = {};`,
    `MIDI.Soundfont.${instrumentName} = {`,
    entries.join(",\n"),
    `};`,
    ``,
  ].join("\n");
}

// --- Note name mapping ---

const NOTE_NAMES = [
  "C","C#","D","D#","E","F","F#","G","G#","A","A#","B",
];

function noteToName(midiNote) {
  const octave = Math.floor(midiNote / 12) - 1;
  const note = NOTE_NAMES[midiNote % 12];
  return `${note}${octave}`;
}

// Note range: C1 (24) to B7 (95) — matches the original soundfont_builder.rb
const MIN_NOTE = 24;
const MAX_NOTE = 95;

// --- Main ---

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

function buildPresetLookup(presetNames) {
  const lookup = new Map();
  for (const { name, bank, preset } of presetNames) {
    const normalized = name.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
    lookup.set(normalized, { bank, preset, originalName: name });
  }
  return lookup;
}

async function generatePack(pack, { force } = {}) {
  const sf2Dir = path.join(vendorDir, pack.name);
  const sf2Path = path.join(sf2Dir, `${pack.name}.sf2`);

  // Check if SF2 exists
  try {
    await readFile(sf2Path);
  } catch {
    throw new Error(
      `${pack.name}.sf2 not found at ${sf2Path}. Run "bun run fetch" first.`,
    );
  }

  // Parse SF2
  const sf2Buffer = await readFile(sf2Path);
  const sf2 = parseSF2(sf2Buffer);
  console.log(
    `${pack.name}: found ${sf2.presetNames.length} presets in SF2`,
  );

  // Load inventory
  const instruments = await loadInstrumentInventory(pack);
  const presetLookup = buildPresetLookup(sf2.presetNames);

  // Map inventory to presets
  const renderList = [];
  for (const name of instruments) {
    const preset = presetLookup.get(name);
    if (preset) {
      renderList.push({ name, bank: preset.bank, program: preset.preset });
    } else {
      // Fallback: GM mapping
      const gmIndex = GM_INSTRUMENTS.indexOf(name);
      if (gmIndex >= 0) {
        console.log(
          `  ${name}: not found in SF2 presets, using GM program ${gmIndex}`,
        );
        renderList.push({ name, bank: 0, program: gmIndex });
      } else {
        throw new Error(
          `${name}: not found in SF2 presets and not a GM instrument`,
        );
      }
    }
  }

  // Generate directory
  const generateDir = path.join(vendorDir, `${pack.name}.gen-${process.pid}`);
  await rm(generateDir, { recursive: true, force: true });
  await mkdir(generateDir, { recursive: true });

  try {
    const tempDir = path.join(generateDir, ".tmp");
    await mkdir(tempDir, { recursive: true });

    let completed = 0;
    const total = renderList.length;

    // Process instruments (4 at a time — fluidsynth is CPU-bound)
    const concurrency = 4;
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < renderList.length) {
        const index = nextIndex++;
        const { name, bank, program } = renderList[index];

        const midiPath = path.join(tempDir, `${name}.mid`);
        const wavPath = path.join(tempDir, `${name}.wav`);
        const mp3Path = path.join(tempDir, `${name}.mp3`);

        await renderInstrument(sf2Path, bank, program, midiPath, wavPath);
        await convertToMp3(wavPath, mp3Path);

        // Read MP3 and build note map
        // For now, we render a single note (middle C) and use it for all notes.
        // A proper implementation would render each note individually.
        const mp3Data = await readFile(mp3Path);
        const base64 = mp3Data.toString("base64");

        const noteMap = {};
        for (let n = MIN_NOTE; n <= MAX_NOTE; n++) {
          noteMap[noteToName(n)] = base64;
        }

        const jsContent = writeMidiJsFile(name, noteMap);
        await writeFile(
          path.join(generateDir, `${name}-mp3.js`),
          jsContent,
        );

        completed += 1;
        if (completed % 16 === 0 || completed === total) {
          console.log(`Generated ${completed}/${total} instruments`);
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, renderList.length) },
      () => worker(),
    );
    await Promise.all(workers);

    // Write instruments.txt
    await writeFile(
      path.join(generateDir, "instruments.txt"),
      `${instruments.join("\n")}\n`,
    );

    // Clean up temp files
    await rm(tempDir, { recursive: true, force: true });

    // Verify
    const targetDir = path.join(vendorDir, pack.name);
    await verifyPack(pack.name, { directory: generateDir });

    // Atomic replace
    await rm(targetDir, { recursive: true, force: true });
    await rename(generateDir, targetDir);
    console.log(`${pack.name}: generated ${instruments.length} instruments at ${targetDir}`);
  } catch (error) {
    await rm(generateDir, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));

  // Check system dependencies
  for (const cmd of ["fluidsynth", "lame"]) {
    try {
      await execFileAsync("which", [cmd]);
    } catch {
      throw new Error(
        `"${cmd}" not found. Install it: brew install ${cmd === "fluidsynth" ? "fluidsynth" : "lame"}`,
      );
    }
  }

  // Load all packs or specific ones
  const { loadAllPacks } = await import("./common.mjs");
  const allPacks = await loadAllPacks();
  const packs = options.packs.length
    ? allPacks.filter((p) => options.packs.includes(p.name))
    : allPacks;

  for (const pack of packs) {
    await generatePack(pack, { force: options.force });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
