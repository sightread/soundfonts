import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  loadAllPacks,
  loadInstrumentInventory,
  optionsFrom,
  vendorDir,
  verifyPack,
} from "./common.mjs";

const execFileAsync = promisify(execFile);

// The 128 General MIDI melodic program names, in program-number order (bank 0).
const GM_MELODIC_INSTRUMENTS = [
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

// Note range: C1 (24) to B7 (95) — matches the original soundfont_builder.rb
const MIN_NOTE = 24;
const MAX_NOTE = 95;

const NOTE_NAMES = [
  "C","C#","D","D#","E","F","F#","G","G#","A","A#","B",
];

function noteToName(midiNote) {
  const octave = Math.floor(midiNote / 12) - 1;
  const note = NOTE_NAMES[midiNote % 12];
  return `${note}${octave}`;
}

// --- MIDI file generation ---

function createMidi(program, note, bank = 0) {
  const vel = 85;
  const duration = 3000;
  const events = [];
  const deltas = [];

  if (bank !== 0) {
    events.push(Buffer.from([0xb0, 0x00, (bank >> 7) & 0x7f]));
    deltas.push(Buffer.from([0x00]));
    events.push(Buffer.from([0xb0, 0x20, bank & 0x7f]));
    deltas.push(Buffer.from([0x00]));
  }

  events.push(Buffer.from([0xc0, program & 0x7f]));
  deltas.push(Buffer.from([0x00]));

  events.push(Buffer.from([0x90, note & 0x7f, vel]));
  deltas.push(Buffer.from([0x00]));

  events.push(Buffer.from([0x80, note & 0x7f, 0x00]));
  deltas.push(encodeVariableLength(duration));

  const trackChunks = [];
  for (let i = 0; i < events.length; i++) {
    trackChunks.push(deltas[i]);
    trackChunks.push(events[i]);
  }
  trackChunks.push(Buffer.from([0x00, 0xff, 0x2f, 0x00]));

  const trackData = Buffer.concat(trackChunks);

  const header = Buffer.alloc(14);
  header.write("MThd", 0);
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(1, 10);
  header.writeUInt16BE(480, 12);

  const trackHeader = Buffer.alloc(8);
  trackHeader.write("MTrk", 0);
  trackHeader.writeUInt32BE(trackData.length, 4);

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

async function renderNote(sf2Path, bank, program, note, midiPath, wavPath) {
  const midi = createMidi(program, note, bank);
  await writeFile(midiPath, midi);

  await execFileAsync("fluidsynth", [
    "-ni",
    "-R", "no",
    "-g", "0.5",
    "-F", wavPath,
    sf2Path,
    midiPath,
  ]);
}

async function convertToMp3(wavPath, mp3Path) {
  await execFileAsync("lame", [
    "-v",
    "-b", "8",
    "-B", "64",
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

// --- Main ---

// Resolves an instrument name to a {bank, program} to render, purely by its
// fixed position in the General MIDI program table (bank 0). "percussion" is
// special-cased to the standard GM drum kit (bank 128, program 0) for
// backwards compatibility with existing packs; a future release can expose
// more than one kit per pack.
export function resolveProgram(name) {
  if (name === "percussion") return { bank: 128, program: 0 };
  const gmIndex = GM_MELODIC_INSTRUMENTS.indexOf(name);
  if (gmIndex >= 0) return { bank: 0, program: gmIndex };
  return null;
}

async function generatePack(pack) {
  const sf2Dir = path.join(vendorDir, pack.name);
  const sf2Path = path.join(sf2Dir, `${pack.name}.sf2`);

  try {
    await readFile(sf2Path);
  } catch {
    throw new Error(
      `${pack.name}.sf2 not found at ${sf2Path}\n` +
      `Run "bun run fetch" to download SF2 source files first.`,
    );
  }

  const instruments = await loadInstrumentInventory(pack);

  const renderList = [];
  for (const name of instruments) {
    const resolved = resolveProgram(name);
    if (!resolved) {
      throw new Error(
        `${name}: not a GM instrument.\nInventory: ${instruments.join(", ")}`,
      );
    }
    renderList.push({ name, bank: resolved.bank, program: resolved.program });
  }

  const generateDir = path.join(vendorDir, `${pack.name}.gen-${process.pid}`);
  await rm(generateDir, { recursive: true, force: true });
  await mkdir(generateDir, { recursive: true });

  try {
    let completedInstruments = 0;
    const totalInstruments = renderList.length;
    const totalNotes = renderList.length * (MAX_NOTE - MIN_NOTE + 1);
    let completedNotes = 0;

    const concurrency = 4;
    let nextInstrument = 0;

    async function worker() {
      while (nextInstrument < renderList.length) {
        const index = nextInstrument++;
        const { name, bank, program } = renderList[index];

        const instTmpDir = path.join(generateDir, `.tmp-${name}`);
        await mkdir(instTmpDir, { recursive: true });

        try {
          const noteMap = {};

          for (let n = MIN_NOTE; n <= MAX_NOTE; n++) {
            const noteName = noteToName(n);
            const midiPath = path.join(instTmpDir, `${noteName}.mid`);
            const wavPath = path.join(instTmpDir, `${noteName}.wav`);
            const mp3Path = path.join(instTmpDir, `${noteName}.mp3`);

            await renderNote(sf2Path, bank, program, n, midiPath, wavPath);
            await convertToMp3(wavPath, mp3Path);

            const mp3Data = await readFile(mp3Path);
            noteMap[noteName] = mp3Data.toString("base64");

            completedNotes += 1;
          }

          const jsContent = writeMidiJsFile(name, noteMap);
          await writeFile(path.join(generateDir, `${name}-mp3.js`), jsContent);
        } finally {
          await rm(instTmpDir, { recursive: true, force: true });
        }

        completedInstruments += 1;
        if (completedInstruments % 4 === 0 || completedInstruments === totalInstruments) {
          console.log(
            `Generated ${completedInstruments}/${totalInstruments} instruments ` +
            `(${completedNotes}/${totalNotes} notes)`,
          );
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, renderList.length) },
      () => worker(),
    );
    await Promise.all(workers);

    await writeFile(
      path.join(generateDir, "instruments.txt"),
      `${instruments.join("\n")}\n`,
    );

    const targetDir = path.join(vendorDir, pack.name);
    await verifyPack(pack.name, { directory: generateDir });

    await rm(targetDir, { recursive: true, force: true });
    await rename(generateDir, targetDir);
    console.log(
      `${pack.name}: generated ${instruments.length} instruments ` +
      `(${totalNotes} notes) at ${targetDir}`,
    );
  } catch (error) {
    await rm(generateDir, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));

  const isWindows = process.platform === "win32";
  for (const cmd of ["fluidsynth", "lame"]) {
    try {
      await execFileAsync(isWindows ? "where" : "which", [cmd]);
    } catch {
      const installHint = process.platform === "darwin"
        ? `brew install ${cmd}`
        : `apt-get install ${cmd}`;
      throw new Error(`"${cmd}" not found. Install it: ${installHint}`);
    }
  }

  const allPacks = await loadAllPacks();
  const packs = options.packs.length
    ? allPacks.filter((p) => options.packs.includes(p.name))
    : allPacks;

  for (const pack of packs) {
    await generatePack(pack);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
