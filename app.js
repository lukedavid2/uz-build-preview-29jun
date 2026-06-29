import * as Data from './data.js?v=99';
import * as Audio from './audio.js?v=102';
import * as Melody from './melody.js?v=5';

const state = {
  selectedKey: 'C',
  progressionKey: 'C', // The key the progression was created in (for transposition)
  // New multi-line progression structure with roman numerals
  progressionLines: [
    { chords: [], repeats: 1, tab: [], showTab: false }
  ],
  currentLineIndex: 0,
  highlightedChords: new Set(),
  selectedChordForDetail: null,
  selectedTab: 'standard',
  selectedNotes: new Set(),
  showFretboard: false,
  leftScale: 'major',
  rightScale: 'pentMajor',
  // Chord Picker State
  pickerRoot: 'C',
  pickerQuality: '',
  pickerExtension: '',
  showChordPicker: false,
  // Arpeggiator State
  showArpeggiator: false,
  arpRoot: 'C',
  arpQuality: '',
  arpExtension: '',
  arpViewMode: 'all', // 'all' or 'shapes'
  arpSelectedShape: null,
  // Melody sketcher state (see melody.js)
  melody: null,
  // Looper State
  looperPlaying: false,
  looperStyle: 'pop',
  looperStyleVariant: 1, // 1 or 2 for each style
  looperBpm: 100,
  looperDrums: false,
  looperBass: true,
  looperKeys: true,
  // Playback tracking
  currentPlayingLine: -1,
  currentPlayingChord: -1,
  // Arpeggiator locked boards
  arpLockedBoards: [],
  // Key Finder State
  showKeyFinder: false,
  kfRoot: 'C',
  kfQuality: '',
  kfChords: [],
  kfResultKey: null,
  kfResultType: null,
  // Tuner State
  showTuner: false,
  tunerActive: false,
  tunerAutoDetect: true,
  tunerSelectedString: null,
  tunerTuning: 'standard',
  // Chord Shape Editor State
  shapeEditorOpen: false,
  shapeEditorLine: null,
  shapeEditorIdx: null,
  shapeEditorFrets: [null, null, null, null, null, null],
  shapeEditorBaseFret: 0,
  shapeEditorBlankEntry: false, // true when adding chord by shape (no name yet)
  shapeEditorSelectedChord: null, // chord name selected from detection alternatives
  // Tab Editor State
  tabEditing: null,  // { line, col, string } when editing a cell
  // Song Name
  songName: ''
};

// ========== UNDO / REDO HISTORY ==========
const MAX_UNDO_HISTORY = 50;
let undoStack = [];
let redoStack = [];

function snapshotProgression() {
    return JSON.parse(JSON.stringify({
        progressionLines: state.progressionLines,
        selectedKey: state.selectedKey,
        progressionKey: state.progressionKey,
        songName: state.songName,
        currentLineIndex: state.currentLineIndex
    }));
}

function pushUndoState() {
    undoStack.push(snapshotProgression());
    if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift();
    redoStack = []; // Clear redo on new action
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(snapshotProgression());
    const prev = undoStack.pop();
    state.progressionLines = prev.progressionLines;
    state.selectedKey = prev.selectedKey;
    state.progressionKey = prev.progressionKey;
    state.songName = prev.songName;
    state.currentLineIndex = prev.currentLineIndex;
    render();
    saveStateToLocalStorage();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(snapshotProgression());
    const next = redoStack.pop();
    state.progressionLines = next.progressionLines;
    state.selectedKey = next.selectedKey;
    state.progressionKey = next.progressionKey;
    state.songName = next.songName;
    state.currentLineIndex = next.currentLineIndex;
    render();
    saveStateToLocalStorage();
}

// Roman numeral lookup for transposition
// BUG FIX #4: Swapped III/iii mappings - Major III is 4 semitones, minor iii is 3
const ROMAN_TO_SEMITONES = {
  'I': 0, 'i': 0,
  'bII': 1, 'bii': 1, 'N': 1,
  'II': 2, 'ii': 2,
  'bIII': 3, 'biii': 3,
  'III': 4, 'iii': 3,
  'IV': 5, 'iv': 5,
  '#IV': 6, '#iv': 6, 'bV': 6,
  'V': 7, 'v': 7,
  'bVI': 8, 'bvi': 8,
  'VI': 9, 'vi': 9,
  'bVII': 10, 'bvii': 10,
  'VII': 11, 'vii': 11
};

// BUG FIX #5: Helper function to restart looper with new parameters
function restartLooperIfPlaying() {
  if (!state.looperPlaying) return;

  Audio.stopLoop();
  state.looperPlaying = false;
  state.currentPlayingLine = -1;
  state.currentPlayingChord = -1;

  const flatProgression = buildFlatProgression();
  if (flatProgression.length > 0) {
    state.looperPlaying = true;
    const hasInfiniteLoop = state.progressionLines.some(line => line.repeats === 999);
    Audio.startBackingLoop(
      flatProgression,
      state.looperStyle,
      state.looperBpm,
      {
        drums: state.looperDrums,
        bass: state.looperBass,
        keys: state.looperKeys,
        variant: state.looperStyleVariant,
        infiniteLoop: hasInfiniteLoop
      },
      (idx) => {
        if (idx >= 0 && idx < flatProgression.length) {
          highlightProgressionChord(flatProgression[idx].lineIdx, flatProgression[idx].chordIdx);
        }
      },
      (idx, t0, dur) => {
        if (idx >= 0 && idx < flatProgression.length) {
          Melody.onScheduleMeasure(flatProgression[idx], t0, dur);
        }
      }
    );
  }
}

// Dark Harmony chord generator — selected key IS the minor root
// e.g. selecting "A" means A minor, and we harmonise from there
function generateDarkHarmonyChords(key) {
  // The selected key IS the minor root directly
  const minorRoot = key;
  const minorRootIdx = noteToIndex(minorRoot);

  // Relative major = 3 semitones up from minor root
  const relMajorIdx = (minorRootIdx + 3) % 12;

  // Flat minor keys: Dm, Gm, Cm, Fm, Bbm, Ebm, Abm, Dbm
  const flatMinorKeys = ['C', 'D', 'F', 'G', 'Bb', 'Eb', 'Ab', 'Db'];
  const useFlats = flatMinorKeys.includes(key);

  const relMajor = indexToNote(relMajorIdx, useFlats);

  function noteAt(semitones, forceFlat = false) {
    const idx = (minorRootIdx + semitones) % 12;
    return indexToNote(idx, forceFlat || useFlats);
  }

  // --- MAIN CHORDS (Harmonic Minor, chord_files order) ---
  // i, bIII Aug, iv, bVI, V, #vii°, ii°
  const main = [
    noteAt(0) + 'm',     // i — minor tonic
    noteAt(3) + '+',     // bIII Aug — augmented (raised 7th)
    noteAt(5) + 'm',     // iv — minor subdominant
    noteAt(8),           // bVI — major
    noteAt(7),           // V — major dominant (raised 7th)
    noteAt(11) + 'dim',  // #vii° — leading-tone diminished
    noteAt(2) + 'dim'    // ii° — supertonic diminished
  ];
  const mainLabels = ['i', 'bIII', 'iv', 'bVI', 'V', '#vii°', 'ii°'];
  const mainExt = ['Maj7', 'Maj7', '', 'Maj7', '7', '7', 'm7b5'];

  // --- NEAPOLITAN (bII) — major chord on lowered 2nd, first inversion ---
  const neapolitan = noteAt(1, true);
  const neapBass = noteAt(5);

  // --- SECONDARY DIMINISHED (combined) ---
  // Group 1 (of V): half step below V — resolves up to dominant-side chords
  const sdvRootIdx = (minorRootIdx + 6) % 12;
  const secDimV = [0, 3, 6, 9].map(offset => {
    const idx = (sdvRootIdx + offset) % 12;
    return indexToNote(idx, useFlats) + 'dim7';
  });
  // Roman numerals: each is an inversion of the same dim7 chord
  // Root degrees relative to minor key: #iv, vi, i, biii
  const secDimVLabels = ['#iv°7', 'vi°7', 'i°7', 'biii°7'];

  // Group 2 (of iv/bVI): half step below iv — resolves up to subdominant-side chords
  const sdivRootIdx = (minorRootIdx + 4) % 12;
  const secDimIV = [0, 3, 6, 9].map(offset => {
    const idx = (sdivRootIdx + offset) % 12;
    return indexToNote(idx, useFlats) + 'dim7';
  });
  // Root degrees relative to minor key: #iii, v, bvii, #i
  const secDimIVLabels = ['#iii°7', 'v°7', 'bvii°7', '#i°7'];

  return { main, mainLabels, mainExt, secDimV, secDimVLabels, secDimIV, secDimIVLabels, neapolitan, neapBass, relMajor, minorRoot };
}

// Transpose a chord from one key to another based on roman numeral
function transposeChord(originalChord, roman, fromKey, toKey) {
  if (!roman || fromKey === toKey) return originalChord;

  const keyOrder = Data.KEY_ORDER;
  const fromIdx = keyOrder.indexOf(fromKey);
  const toIdx = keyOrder.indexOf(toKey);
  if (fromIdx === -1 || toIdx === -1) return originalChord;

  // Get semitone difference
  const semitoneDiff = (toIdx - fromIdx + 12) % 12;

  // Parse the original chord
  let root, quality;
  if (originalChord.length >= 2 && (originalChord[1] === '#' || originalChord[1] === 'b')) {
    root = originalChord.substring(0, 2);
    quality = originalChord.substring(2);
  } else {
    root = originalChord[0];
    quality = originalChord.substring(1);
  }

  // Get new root
  const noteOrder = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flatToSharp = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };
  const sharpToFlat = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };

  const normalizedRoot = flatToSharp[root] || root;
  const rootIdx = noteOrder.indexOf(normalizedRoot);
  if (rootIdx === -1) return originalChord;

  const newRootIdx = (rootIdx + semitoneDiff) % 12;
  let newRoot = noteOrder[newRootIdx];

  // Use flats for flat keys
  const flatKeys = ['F', 'Bb', 'Eb', 'Ab', 'Db'];
  if (flatKeys.includes(toKey) && sharpToFlat[newRoot]) {
    newRoot = sharpToFlat[newRoot];
  }

  return newRoot + quality;
}

// --- CAGED System ---
// Base CAGED positions for C major (fret ranges)
const CAGED_BASE_POSITIONS = {
  'C': { start: 0, end: 4, center: 2 },
  'A': { start: 2, end: 6, center: 4 },
  'G': { start: 5, end: 9, center: 7 },
  'E': { start: 7, end: 11, center: 9 },
  'D': { start: 10, end: 14, center: 12 }
};

// CAGED order (repeating pattern up the neck)
const CAGED_ORDER = ['C', 'A', 'G', 'E', 'D'];

function getCAGEDPositions(key, scaleType) {
  const chromaticNotes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  let keyNote = key.replace('Db','C#').replace('Eb','D#').replace('Gb','F#').replace('Ab','G#').replace('Bb','A#');
  let keyIndex = chromaticNotes.indexOf(keyNote);

  const positions = {};

  CAGED_ORDER.forEach(shape => {
    const base = CAGED_BASE_POSITIONS[shape];
    let start = base.start + keyIndex;
    let end = base.end + keyIndex;
    let center = base.center + keyIndex;

    // If center goes past fret 15, wrap the ENTIRE shape down an octave
    if (center > 15) {
      start -= 12;
      end -= 12;
      center -= 12;
    }

    // Clamp to visible fret range (0-15)
    positions[shape] = {
      start: Math.max(0, start),
      end: Math.min(15, end),
      center: center,
      wrapsLow: null
    };
  });

  return positions;
}

// Get CAGED shapes sorted by position (left to right on neck)
function getSortedCAGEDShapes(key, scaleType) {
  const positions = getCAGEDPositions(key, scaleType);
  return CAGED_ORDER
    .map(shape => ({ shape, ...positions[shape] }))
    .sort((a, b) => a.center - b.center);
}

// --- Helpers ---
const FLAT_TO_SHARP = { 'Db':'C#', 'Eb':'D#', 'Gb':'F#', 'Ab':'G#', 'Bb':'A#' };
const SHARP_TO_FLAT_MAP = { 'C#':'Db', 'D#':'Eb', 'F#':'Gb', 'G#':'Ab', 'A#':'Bb' };
const FLAT_KEY_SET = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);
function keyUsesFlats(key) {
    if (!key) return false;
    return FLAT_KEY_SET.has(key) || key.includes('b');
}
// Display a chord name using flats or sharps based on the current key
function displayChordForKey(chordName, key) {
    if (!chordName || chordName === '?') return chordName;
    const useFlats = keyUsesFlats(key);
    const convertRoot = (r) => {
        if (useFlats && SHARP_TO_FLAT_MAP[r]) return SHARP_TO_FLAT_MAP[r];
        if (!useFlats && FLAT_TO_SHARP[r]) return FLAT_TO_SHARP[r];
        return r;
    };
    // Handle slash chords: "A#m/F" → root="A#", quality="m", bass="F"
    const slashIdx = chordName.indexOf('/');
    let mainPart = chordName, bassPart = '';
    if (slashIdx > 0) {
        mainPart = chordName.substring(0, slashIdx);
        bassPart = chordName.substring(slashIdx + 1);
    }
    const m = mainPart.match(/^([A-G][#b]?)(.*)/);
    if (!m) return chordName;
    const displayRoot = convertRoot(m[1]);
    let result = displayRoot + m[2];
    if (bassPart) {
        const bassM = bassPart.match(/^([A-G][#b]?)(.*)/);
        if (bassM) {
            result += '/' + convertRoot(bassM[1]) + bassM[2];
        } else {
            result += '/' + bassPart;
        }
    }
    return result;
}
// Extract the base chord from a slash chord or extended chord (e.g. "A#m/F" → "A#m", "Dm7" → "Dm")
function getBaseChord(chordName) {
    if (!chordName || chordName === '?') return chordName;
    // Strip slash bass note
    const slashIdx = chordName.indexOf('/');
    let main = slashIdx > 0 ? chordName.substring(0, slashIdx) : chordName;
    // Parse into root + quality
    const m = main.match(/^([A-G][#b]?)(.*)/);
    if (!m) return main;
    const root = m[1];
    const quality = m[2];
    // Simplify quality: strip extensions to get base triad quality
    // "m7" → "m", "maj7" → "", "7" → "", "sus4" → "sus4", "dim7" → "dim", "aug" → "aug", "m7b5" → "m"
    let baseQ = quality;
    if (baseQ.startsWith('m') && !baseQ.startsWith('maj')) {
        baseQ = 'm'; // m7, m6, m7b5 → m
    } else if (baseQ.startsWith('maj') || baseQ === '7' || baseQ === '6' || baseQ === '9' || baseQ === 'add9') {
        baseQ = ''; // major extensions → major
    } else if (baseQ.startsWith('dim')) {
        baseQ = 'dim';
    } else if (baseQ.startsWith('aug') || baseQ === '+') {
        baseQ = 'aug';
    } else if (baseQ.startsWith('sus')) {
        baseQ = 'sus'; // preserve sus identity for root-only matching
    }
    return root + baseQ;
}
function normalizeNoteName(note) { return FLAT_TO_SHARP[note] || note; }

function noteToIndex(note) { return Data.NOTE_NAMES_SHARP.indexOf(normalizeNoteName(note)); }

function indexToNote(index, preferFlat = false) {
  const i = ((index % 12) + 12) % 12;
  return preferFlat ? Data.NOTE_NAMES_FLAT[i] : Data.NOTE_NAMES_SHARP[i];
}

function parseChord(chordStr) {
  let note = '', quality = '';
  if (chordStr.length >= 2 && (chordStr[1] === '#' || chordStr[1] === 'b')) {
    note = chordStr.substring(0, 2);
    quality = chordStr.substring(2);
  } else {
    note = chordStr[0];
    quality = chordStr.substring(1);
  }
  return { note, quality };
}

// STRICT INTERVAL MAPPER
function semitonesToInterval(semitones) {
    const map = {
        0: 'R', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4', 6: 'b5',
        7: '5', 8: 'b6', 9: '6', 10: 'b7', 11: '7', 12: 'R',
        13: 'b9', 14: '9'
    };
    return map[semitones] || '?';
}

function getScaleNotes(key, scaleType = 'major', addBlues = false) {
  const patterns = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentMajor: [0, 2, 4, 7, 9],
    pentMinor: [0, 3, 5, 7, 10],
    relMinor: [0, 2, 3, 5, 7, 8, 10],      // Natural minor pattern
    relMinorPent: [0, 3, 5, 7, 10]         // Minor pentatonic pattern
  };

  const degrees = {
    major: ['1','2','3','4','5','6','7'],
    minor: ['1','2','♭3','4','5','♭6','♭7'],
    pentMajor: ['1','2','3','5','6'],
    pentMinor: ['1','♭3','4','5','♭7'],
    relMinor: ['1','2','♭3','4','5','♭6','♭7'],
    relMinorPent: ['1','♭3','4','5','♭7']
  };

  // Blues notes to add (semitone offsets and their degree labels)
  const bluesAdditions = {
    major: [{ interval: 3, degree: '♭3' }, { interval: 6, degree: '♭5' }, { interval: 10, degree: '♭7' }],
    pentMajor: [{ interval: 3, degree: '♭3' }, { interval: 6, degree: '♭5' }, { interval: 10, degree: '♭7' }],
    minor: [{ interval: 6, degree: '♭5' }],
    pentMinor: [{ interval: 6, degree: '♭5' }],
    relMinor: [{ interval: 6, degree: '♭5' }],
    relMinorPent: [{ interval: 6, degree: '♭5' }]
  };

  const rootIndex = noteToIndex(key);
  const basePattern = patterns[scaleType] || patterns.major;
  const baseDegrees = degrees[scaleType] || degrees.major;

  // Build base scale notes
  let notes = basePattern.map((interval, i) => ({
    note: indexToNote((rootIndex + interval) % 12),
    degree: baseDegrees[i],
    isBlue: false
  }));

  // Add blues notes if enabled
  if (addBlues && bluesAdditions[scaleType]) {
    const existingIntervals = new Set(basePattern);
    bluesAdditions[scaleType].forEach(blue => {
      if (!existingIntervals.has(blue.interval)) {
        notes.push({
          note: indexToNote((rootIndex + blue.interval) % 12),
          degree: blue.degree,
          isBlue: true
        });
      }
    });
  }

  return notes;
}

// Scale descriptions for the info popup
const SCALE_DESCRIPTIONS = {
  major: {
    name: "Major Scale",
    subtitle: "Bright",
    when: "Standard major sound. Use across the whole progression for a happy, complete feel.",
    avoid: "Can sound vanilla over bluesy sections - consider adding blues notes.",
    feel: "Bright, happy, resolved",
    supportsBlues: true
  },
  pentMajor: {
    name: "Major Pentatonic",
    subtitle: "Catchy",
    when: "Five-note major palette. No avoid notes! Safe and melodic across the whole progression.",
    avoid: "Can sound too simple - mix with full major or add blues notes for color.",
    feel: "Sweet, safe, melodic",
    supportsBlues: true
  },
  relMinor: {
    name: "Relative Minor",
    subtitle: "Soft Minor",
    when: "Emotional minor from the vi chord. Works beautifully across the whole major progression.",
    avoid: "Emphasizing the minor root too much when you want a major feel.",
    feel: "Emotional, expressive, versatile",
    supportsBlues: true
  },
  relMinorPent: {
    name: "Relative Minor Pentatonic",
    subtitle: "Classic Lead",
    when: "Classic minor lead sound. Works across the whole progression - the secret weapon of rock guitar.",
    avoid: "Landing hard on minor root over bright major I chord moments.",
    feel: "Soulful, powerful, universal",
    supportsBlues: true
  },
  minor: {
    name: "Parallel Minor",
    subtitle: "Dark Minor",
    when: "Darker minor from the same root. Creates dramatic tension across the progression.",
    avoid: "Over purely bright major sections unless you want deliberate tension.",
    feel: "Dark, dramatic, intense",
    supportsBlues: true
  },
  pentMinor: {
    name: "Parallel Minor Pentatonic",
    subtitle: "Blues/Rock",
    when: "Blues/rock minor feel. The ♭3 against major chords = instant blues sound.",
    avoid: "If you want a clean, happy major sound - this adds grit.",
    feel: "Bluesy, gritty, raw",
    supportsBlues: true
  },
  harmonicMinor: {
    name: "Harmonic Minor",
    subtitle: "Dark Classical",
    when: "Classical dark minor with raised 7th. Creates tension and resolution. Great for dramatic passages.",
    avoid: "The gap between ♭6 and 7 can sound odd in fast passages.",
    feel: "Dark, classical, dramatic",
    supportsBlues: false
  },
  phrygianDom: {
    name: "Phrygian Dominant",
    subtitle: "Spanish",
    when: "Spanish/Flamenco minor with major 3rd. Exotic and atmospheric.",
    avoid: "Landing hard on the root - emphasize the ♭2 for character.",
    feel: "Exotic, Spanish, moody",
    supportsBlues: false
  },
  phrygian: {
    name: "Phrygian",
    subtitle: "Dark Modal",
    when: "Dark mode with flat 2nd. Creates unique and mysterious sounds.",
    avoid: "Can sound dissonant over major chords - use with dark progressions.",
    feel: "Dark, mysterious, modal",
    supportsBlues: false
  },
  locrian: {
    name: "Locrian",
    subtitle: "Diminished Root",
    when: "Darkest mode with diminished root and 5th. For extreme darkness and dissonance.",
    avoid: "Avoid over bright chords. Best with dark, minor progressions.",
    feel: "Very dark, dissonant, extreme",
    supportsBlues: false
  }
};

// Get relative minor key (3 semitones down from major)
function getRelativeMinor(majorKey) {
  const majorIndex = noteToIndex(majorKey);
  const minorIndex = (majorIndex + 9) % 12; // -3 semitones = +9
  return indexToNote(minorIndex);
}

function renderChordSVG(positions, fingers, baseFret = 1, chordRoot = null, chordQuality = '') {
  // Undercover Zest chord diagram — matches the embellishment/arpeggio style.
  const W = 116, H = 134, frets = 5, strings = 6;
  const left = 34, top = 30, right = 10, bottom = 116;
  const gridW = W - left - right, gridH = bottom - top;
  const sw = gridW / (strings - 1), fh = gridH / frets;
  const stringNotes = ['E','A','D','G','B','E'];
  const noteOrder = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const flatToSharp = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };
  const DEG = {0:'1',1:'b2',2:'2',3:'b3',4:'3',5:'4',6:'b5',7:'5',8:'#5',9:'6',10:'b7',11:'7'};
  let rootPc = null;
  if (chordRoot) { const r = flatToSharp[chordRoot] || chordRoot; rootPc = noteOrder.indexOf(r); }
  function pcAt(s, fret) { const a = noteOrder.indexOf(stringNotes[s]); const actual = fret === 0 ? 0 : fret + (baseFret - 1); return (a + actual + 1200) % 12; }
  const mono = "'JetBrains Mono', monospace";
  let svg = `<svg class="cp-fretboard" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  if (baseFret === 1) {
    svg += `<rect x="${left-1.5}" y="${top-4}" width="${gridW+3}" height="4" fill="#d4a853" rx="1"/>`;
  } else {
    svg += `<text x="${left-10}" y="${top+11}" fill="#d4a853" font-family="${mono}" font-size="8.5" text-anchor="end">fr.${baseFret}</text>`;
  }
  for (let f = 0; f <= frets; f++) svg += `<line x1="${left}" y1="${top+f*fh}" x2="${left+gridW}" y2="${top+f*fh}" stroke="#3a3a48" stroke-width="1"/>`;
  for (let s = 0; s < strings; s++) svg += `<line x1="${left+s*sw}" y1="${top}" x2="${left+s*sw}" y2="${bottom}" stroke="#5a5a68" stroke-width="1"/>`;
  positions.forEach((fret, s) => {
    const x = left + s * sw;
    if (fret === null || fret === -1) {
      svg += `<text x="${x}" y="${top-7}" text-anchor="middle" fill="#888894" font-family="${mono}" font-size="9" font-weight="600">×</text>`;
      return;
    }
    const pc = pcAt(s, fret);
    const deg = rootPc != null ? (DEG[(pc - rootPc + 12) % 12] || '') : '';
    const note = noteOrder[pc];
    if (fret === 0) {
      const y = top - 9;
      svg += `<circle cx="${x}" cy="${y}" r="7" fill="#0a0b0e" stroke="#ebe8e2" stroke-width="1.4"/>`;
      svg += `<text class="fb-deg" x="${x}" y="${y+2.6}" text-anchor="middle" fill="#ebe8e2" font-family="${mono}" font-size="7.5" font-weight="700">${deg}</text>`;
      svg += `<text class="fb-note" display="none" x="${x}" y="${y+2.6}" text-anchor="middle" fill="#ebe8e2" font-family="${mono}" font-size="6.5" font-weight="700">${note}</text>`;
    } else {
      const y = top + (fret - 0.5) * fh;
      svg += `<circle cx="${x}" cy="${y}" r="8" fill="#d4a853" stroke="#1a1a1f" stroke-width="0.8"/>`;
      svg += `<text class="fb-deg" x="${x}" y="${y+3}" text-anchor="middle" fill="#1a1a1f" font-family="${mono}" font-size="8.5" font-weight="700">${deg}</text>`;
      svg += `<text class="fb-note" display="none" x="${x}" y="${y+3}" text-anchor="middle" fill="#1a1a1f" font-family="${mono}" font-size="7.5" font-weight="700">${note}</text>`;
    }
  });
  return svg + '</svg>';
}

function renderKeyButtons() {
  const container = document.getElementById('keyButtons');
  container.innerHTML = Data.KEY_ORDER.map(key => `<button class="key-btn ${state.selectedKey === key ? 'active' : ''}" data-key="${key}">${key}</button>`).join('');
  // Update the collapsed-state label to reflect the current selection.
  const cur = document.getElementById('keyCollapserCurrent');
  if (cur) cur.textContent = state.selectedKey;
}

function renderTabs() {
  const container = document.getElementById('tabButtons');
  container.innerHTML = ['standard', 'dark'].map(tab => `<button class="tab-btn ${state.selectedTab === tab ? 'active' : ''}" data-tab="${tab}">${tab === 'standard' ? 'Bright Chords (Major)' : 'Shadow Chords (Minor)'}</button>`).join('');
  // Update the collapsed-state label.
  const cur = document.getElementById('tabCollapserCurrent');
  if (cur) cur.textContent = state.selectedTab === 'dark' ? 'Shadow Chords (Minor)' : 'Bright Chords (Major)';
}

const createChordHTML = (chord, label, idx, tooltip) => {
    const parsed = parseChord(chord);
    const isHighlighted = state.highlightedChords.has(idx);
    const isSelected = state.selectedChordForDetail === chord;
    const tones = Audio.getChordTones(parsed.note, parsed.quality);

    // Context-aware note spelling: use flats when chord root has a flat
    // or when we're in a flat key with a natural root
    const rootHasFlat = parsed.note.includes('b');
    const rootHasSharp = parsed.note.includes('#');
    const FLAT_KEYS = ['F', 'Bb', 'Eb', 'Ab', 'Db'];
    const useFlats = rootHasFlat || (!rootHasSharp && FLAT_KEYS.includes(state.selectedKey));
    const S2F = { 'C#':'Db', 'D#':'Eb', 'F#':'Gb', 'G#':'Ab', 'A#':'Bb' };

    const toneHtml = tones.map(t => {
      let displayNote = t.note; // always sharp from getChordTones
      if (t.interval === 0) {
        // Root tone always matches the chord name exactly
        displayNote = parsed.note;
      } else if (useFlats && S2F[displayNote]) {
        displayNote = S2F[displayNote];
      }
      const norm = normalizeNoteName(displayNote);
      const color = Data.NOTE_COLORS[displayNote] || Data.NOTE_COLORS[norm] || '#888';
      const isSel = state.selectedNotes.has(norm);
      const deg = semitonesToInterval(t.interval);

      return `<div class="tone-stack ${isSel?'selected-note':''}" data-note="${norm}">
                <div class="tone-top" style="background:${color}">${deg}</div>
                <div class="tone-bot">${displayNote}</div>
              </div>`;
    }).join('');

    return `
      <div class="chord-wrapper" title="${tooltip || ''}">
        <div class="chord-numeral">${label}</div>
        <div class="chord-box ${isHighlighted ? 'highlighted' : ''} ${isSelected ? 'selected' : ''}"
             data-chord="${chord}" data-id="${idx}" data-roman="${label}">
          <span class="note">${parsed.note}</span>
          <span class="chord-type">${parsed.quality === '+' ? 'Aug' : (parsed.quality || '')}</span>
        </div>
        <div class="chord-tones">${toneHtml}</div>
      </div>
    `;
};

// Generate borrowed chords from Lydian, Mixolydian, and Phrygian modes
// Returns { lydian: [{chord, roman, resolves}], mixolydian: [...], phrygian: [...] }
function generateBorrowedChords(selectedKey, keyData) {
    const rootIdx = noteToIndex(selectedKey);
    const FLAT_KEYS = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];
    const isKeyFlat = FLAT_KEYS.includes(selectedKey) || selectedKey.includes('b');
    // For borrowed chords, use flat spelling for lowered degrees (bII, bIII, bVII, v)
    // and sharp/natural for raised degrees (II, #iv) — unless we're in a flat key
    const noteName = (semitones, preferFlat) => {
        const idx = ((rootIdx + semitones) % 12 + 12) % 12;
        return indexToNote(idx, isKeyFlat || preferFlat);
    };

    // Helper: check if a chord (by root+quality string) is already in diatonic or modal pools
    const existingChords = [...keyData.diatonic, ...keyData.modal].map(c => {
        const bc = getBaseChord(c);
        return bc.replace('♭','b').replace('♯','#');
    });
    const alreadyExists = (chordStr) => {
        const norm = getBaseChord(chordStr).replace('♭','b').replace('♯','#');
        const ENHARMONICS = { 'C#':'Db','Db':'C#','D#':'Eb','Eb':'D#','F#':'Gb','Gb':'F#','G#':'Ab','Ab':'G#','A#':'Bb','Bb':'A#' };
        if (existingChords.includes(norm)) return true;
        // Check enharmonic
        const parsed = parseChord(norm);
        const enh = ENHARMONICS[parsed.note];
        if (enh && existingChords.includes(enh + parsed.quality)) return true;
        return false;
    };

    const result = { lydian: [], mixolydian: [], phrygian: [] };

    // LYDIAN: raised 4th scale degree → II major chord (resolves to V)
    // II = root + 2 semitones, major quality (no preferFlat — raised degree)
    const lydianRoot = noteName(2, false);
    const lydianChord = lydianRoot; // major chord
    if (!alreadyExists(lydianChord)) {
        result.lydian.push({
            chord: lydianChord,
            roman: 'II',
            resolves: '→ V',
            resolvesTo: noteName(7, false),
            tip: 'Lydian borrowed chord: II major — the raised 4th creates a bright, uplifting sound. Resolves naturally to V.'
        });
    }
    // Also #iv dim (Lydian) — root + 6 semitones, dim quality (no preferFlat — raised degree)
    const lydianDimRoot = noteName(6, false);
    const lydianDimChord = lydianDimRoot + 'dim';
    if (!alreadyExists(lydianDimChord)) {
        result.lydian.push({
            chord: lydianDimChord,
            roman: '#iv°',
            resolves: '→ V',
            resolvesTo: noteName(7, false),
            tip: 'Lydian borrowed chord: #iv° diminished — creates tension that resolves up to V.'
        });
    }

    // MIXOLYDIAN: lowered 7th scale degree → v minor chord and bVII major
    // v minor = root + 7 semitones (preferFlat for lowered degrees)
    const mixoVRoot = noteName(7, true);
    const mixoVChord = mixoVRoot + 'm';
    if (!alreadyExists(mixoVChord)) {
        result.mixolydian.push({
            chord: mixoVChord,
            roman: 'v',
            resolves: '→ I',
            resolvesTo: selectedKey,
            tip: 'Mixolydian borrowed chord: v minor — a softer, less-resolved dominant. Resolves gently to I.'
        });
    }
    // bVII is often already in modal interchange, but check (preferFlat — lowered degree)
    const bVIIRoot = noteName(10, true);
    const bVIIChord = bVIIRoot;
    if (!alreadyExists(bVIIChord)) {
        result.mixolydian.push({
            chord: bVIIChord,
            roman: '♭VII',
            resolves: '→ I',
            resolvesTo: selectedKey,
            tip: 'Mixolydian borrowed chord: ♭VII major — creates a rock/blues feel. Resolves strongly to I.'
        });
    }

    // PHRYGIAN: lowered 2nd scale degree → bII major (Neapolitan) (preferFlat — lowered degree)
    const phrygRoot = noteName(1, true);
    const phrygChord = phrygRoot;
    if (!alreadyExists(phrygChord)) {
        result.phrygian.push({
            chord: phrygChord,
            roman: '♭II',
            resolves: '→ V → I',
            resolvesTo: noteName(7, true),
            tip: 'Phrygian/Neapolitan borrowed chord: ♭II major — exotic, dramatic color. Typically resolves through V to I.'
        });
    }
    // biii from Phrygian: root + 3 semitones, major quality (preferFlat — lowered degree)
    const phrygIIIRoot = noteName(3, true);
    const phrygIIIChord = phrygIIIRoot;
    if (!alreadyExists(phrygIIIChord)) {
        result.phrygian.push({
            chord: phrygIIIChord,
            roman: '♭III',
            resolves: '→ I',
            resolvesTo: selectedKey,
            tip: 'Phrygian borrowed chord: ♭III major — adds a dark, Spanish flavor.'
        });
    }

    // SECONDARY DOMINANT TRIADS: major triads that match secDom roots but without the 7th
    // e.g. F major in key of Db (F7 is V/vi, F major can resolve the same way)
    result.secDomTriads = [];
    const secDomLabels = ['I', 'ii', 'iii', 'IV', 'V', 'vi'];
    if (keyData.secDom) {
        keyData.secDom.forEach((sd, i) => {
            if (!sd) return;
            const sdRoot = parseChord(sd).note;
            const triad = sdRoot; // major triad
            if (!alreadyExists(triad)) {
                // Check it's not already generated in another mode section
                const alreadyInModes = [...result.lydian, ...result.mixolydian, ...result.phrygian].some(c => {
                    const cRoot = parseChord(c.chord).note;
                    const ENHARMONICS = { 'C#':'Db','Db':'C#','D#':'Eb','Eb':'D#','F#':'Gb','Gb':'F#','G#':'Ab','Ab':'G#','A#':'Bb','Bb':'A#' };
                    return cRoot === sdRoot || ENHARMONICS[cRoot] === sdRoot;
                });
                if (!alreadyInModes) {
                    const targetRoman = secDomLabels[i];
                    const targetChord = keyData.diatonic[i];
                    result.secDomTriads.push({
                        chord: triad,
                        roman: sd.replace(sdRoot, '') === '7' ? `V/${targetRoman}` : `(${sd})`,
                        resolves: `→ ${targetRoman}`,
                        resolvesTo: targetChord,
                        tip: `${triad} major triad — same root as ${sd} (secondary dominant) but without the 7th. Resolves to ${targetRoman} (${targetChord}). Use for a softer, less urgent resolution than ${sd}.`
                    });
                }
            }
        });
    }

    return result;
}

// Build HTML sections for borrowed mode chords (Lydian, Mixolydian, Phrygian, SecDom Triads)
function buildBorrowedModeSections(keyData) {
    const borrowed = generateBorrowedChords(state.selectedKey, keyData);
    let html = '';

    const buildRow = (chords, label, cssClass, description) => {
        if (chords.length === 0) return '';
        const chordsHtml = chords.map((c, i) => {
            const resolveLabel = c.resolves.replace('→ ', '');
            // Use createChordHTML for the chord itself, then wrap with resolve badge
            const chordHtml = createChordHTML(c.chord, c.roman, `${cssClass}-${i}`, c.tip);
            const badge = `<div class="borrowed-resolve-badge">
                    <svg class="resolve-badge-arrow" viewBox="0 0 10 10" width="10" height="10"><path d="M2 3l3 4 3-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <span class="resolve-badge-text">${resolveLabel}</span>
                  </div>`;
            return `<div class="borrowed-chord-cell">${chordHtml}${badge}</div>`;
        }).join('');

        return `
          <div class="chord-row borrowed-mode ${cssClass}">
            <div class="row-label">${label} <span class="row-label-sub">${description}</span></div>
            <div class="chords-container borrowed-chords-container">${chordsHtml}</div>
          </div>
        `;
    };

    const lydianHtml = buildRow(borrowed.lydian, 'LYDIAN', 'lydian', '— bright, raised 4th');
    const mixoHtml = buildRow(borrowed.mixolydian, 'MIXOLYDIAN', 'mixolydian', '— relaxed, lowered 7th');
    const phrygHtml = buildRow(borrowed.phrygian, 'PHRYGIAN', 'phrygian', '— dark, lowered 2nd');
    const secTriadHtml = buildRow(borrowed.secDomTriads, 'DOMINANT TRIADS', 'dom-triads', '— secondary dominant roots without the 7th');

    if (lydianHtml || mixoHtml || phrygHtml || secTriadHtml) {
        html += `<div class="connector-area"><span class="nav-text">↓ MORE BORROWED CHORDS from other modes</span></div>`;
        html += lydianHtml + mixoHtml + phrygHtml;
    }
    if (secTriadHtml) {
        html += `<div class="connector-area"><span class="nav-text">↓ SECONDARY DOMINANT TRIADS — same roots as above, without the 7th</span></div>`;
        html += secTriadHtml;
    }

    return html;
}

function renderChordGrid() {
  const grid = document.getElementById('chordGrid');
  const keyData = Data.CHORD_DATA[state.selectedKey];

  // Toggle a body class so the optional free-play banner can react via CSS.
  const inFreePlay = state.currentLineIndex == null || state.currentLineIndex < 0
      || !state.progressionLines[state.currentLineIndex];
  document.body.classList.toggle('free-play-mode', inFreePlay);

  if (state.selectedTab === 'dark') {
      // Dark Harmony — selected key IS the minor root
      const dk = generateDarkHarmonyChords(state.selectedKey);
      const minorRoot = state.selectedKey;

      // Helper: get enharmonic alternative name
      const getEnhar = (note) => {
        const m = { 'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb','Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };
        return m[note] || null;
      };

      // Build a dark-chord cell with optional enharmonic + extension
      const mkCell = (chord, label, id, tip, ext) => {
        const p = parseChord(chord);
        const eh = getEnhar(p.note);
        return `<div class="dark-chord-cell">
          ${eh ? `<div class="chord-enharmonic">${eh}</div>` : '<div class="chord-enharmonic">&nbsp;</div>'}
          ${createChordHTML(chord, label, id, tip)}
          ${ext ? `<div class="dark-ext-hint">${ext}</div>` : ''}
        </div>`;
      };

      // Destructure main chord names for use in tooltips and template
      const [iC, bIII, ivC, bVI, vC, viiC, iiC] = dk.main;
      const neapSlash = dk.neapolitan + '/' + dk.neapBass;
      const sd0 = dk.secDimV[0].replace('dim7','dim');
      const sd4 = dk.secDimIV[0].replace('dim7','dim');

      // Main chords HTML
      const mainHTML = dk.main.map((c, i) =>
        mkCell(c, dk.mainLabels[i], `dk-m-${i}`, `${minorRoot} harmonic minor: ${dk.mainLabels[i]}`, dk.mainExt[i])
      ).join('');

      // Secondary diminished V (top row) — each resolves ½ step up to V
      const secDimVHTML = dk.secDimV.map((c, i) => {
        const p = parseChord(c);
        const eh = getEnhar(p.note);
        const roman = dk.secDimVLabels[i];
        return `<div class="dark-chord-cell">
          ${eh ? `<div class="chord-enharmonic">${eh}</div>` : '<div class="chord-enharmonic">&nbsp;</div>'}
          ${createChordHTML(c, roman, `dk-sdv-${i}`, `Secondary dim: ${roman} — resolves ½ step up to V (${vC})`)}
          <div class="dark-ext-hint">7</div>
        </div>`;
      }).join('');

      // Secondary diminished iv/bVI (bottom row) — each resolves ½ step up to iv
      const secDimIVHTML = dk.secDimIV.map((c, i) => {
        const p = parseChord(c);
        const eh = getEnhar(p.note);
        const roman = dk.secDimIVLabels[i];
        return `<div class="dark-chord-cell">
          ${eh ? `<div class="chord-enharmonic">${eh}</div>` : '<div class="chord-enharmonic">&nbsp;</div>'}
          ${createChordHTML(c, roman, `dk-sdiv-${i}`, `Secondary dim: ${roman} — resolves ½ step up to iv (${ivC})`)}
          <div class="dark-ext-hint">7</div>
        </div>`;
      }).join('');

      // Neapolitan HTML
      const neapHTML = mkCell(dk.neapolitan, 'bII', 'dk-neap', 'Neapolitan — bII major, first inversion', 'Maj7')
        + `<div class="dark-neap-bass">/${dk.neapBass}</div>`;

      let darkHtml = `
        <div class="dark-harmony-container">

          <div class="dark-header">
            <div class="dark-header-title">Shadow Chords — ${minorRoot} minor</div>
            <div class="dark-header-sub">relative major: ${dk.relMajor} · click any chord to hear it</div>
          </div>

          <!-- TOP ROW: Secondary Diminished V  +  Neapolitan -->
          <div class="dark-top-row">
            <div class="chord-row dark-section dark-sec-row">
              <div class="row-label">SECONDARY DIMINISHED <span class="row-label-sub">V</span></div>
              <div class="chords-container dark-chords-grid">${secDimVHTML}</div>
            </div>
            <div class="chord-row dark-section dark-neap-box">
              <div class="row-label">NEAPOLITAN</div>
              <div class="chords-container dark-chords-grid dark-neap-grid">${neapHTML}</div>
              <div class="dark-neap-resolve">resolves ${neapSlash} → ${vC} → ${iC}</div>
            </div>
          </div>

          <!-- ARROW BAR: Top ↔ Main -->
          <div class="dark-arrow-bar">
            <div class="dark-arrow-bar-label">
              <svg viewBox="0 0 18 12"><polyline points="3,10 9,3 15,10"/></svg>
              UP: TO ANY CHORD
            </div>
            <div class="dark-arrow-bar-label dark-arrow-resolve">
              RESOLVES DOWN TO
              <span class="dark-resolve-target">${vC} <span class="dark-resolve-numeral">(V)</span></span>
              <svg viewBox="0 0 18 12"><polyline points="3,2 9,9 15,2"/></svg>
            </div>
          </div>

          <!-- MIDDLE ROW: Main Chords — START HERE -->
          <div class="dark-main-section">
            <div class="dark-start-badge">→ START HERE</div>
            <div class="chord-row dark-section dark-main-row">
              <div class="row-label">MAIN CHORDS</div>
              <div class="chords-container dark-chords-grid">${mainHTML}</div>
            </div>
          </div>

          <!-- ARROW BAR: Main ↔ Bottom -->
          <div class="dark-arrow-bar">
            <div class="dark-arrow-bar-label">
              <svg viewBox="0 0 18 12"><polyline points="3,2 9,9 15,2"/></svg>
              DOWN: TO ANY CHORD
            </div>
            <div class="dark-arrow-bar-label dark-arrow-resolve">
              RESOLVES UP TO
              <span class="dark-resolve-target">${ivC} <span class="dark-resolve-numeral">(iv)</span></span>
              <svg viewBox="0 0 18 12"><polyline points="3,10 9,3 15,10"/></svg>
            </div>
          </div>

          <!-- BOTTOM ROW: Secondary Diminished iv, bVI -->
          <div class="chord-row dark-section dark-sec-row">
            <div class="row-label">SECONDARY DIMINISHED <span class="row-label-sub">iv, bVI</span></div>
            <div class="chords-container dark-chords-grid">${secDimIVHTML}</div>
          </div>

          <!-- Example Progressions -->
          <div class="dark-examples">
            <div class="dark-examples-title">Example progressions in ${minorRoot} minor</div>
            <div class="dark-example-list">
              <div class="dark-example-item">
                <span class="dark-ex-prog">${iC} · ${viiC} · ${bVI} · ${vC}7</span>
                <span class="dark-ex-label">Main chords</span>
              </div>
              <div class="dark-example-item">
                <span class="dark-ex-prog">${ivC} · ${vC}7 · ${iC} · ${sd4}</span>
                <span class="dark-ex-label">+ secondary dim</span>
              </div>
              <div class="dark-example-item">
                <span class="dark-ex-prog">${iC} · ${bVI} · ${neapSlash} · ${vC}7</span>
                <span class="dark-ex-label">+ Neapolitan</span>
              </div>
              <div class="dark-example-item">
                <span class="dark-ex-prog">${iC} · ${neapSlash} · ${sd0} · ${vC}7</span>
                <span class="dark-ex-label">Combined</span>
              </div>
            </div>
          </div>

        </div>
      `;
      grid.innerHTML = darkHtml;
      return;
  }

  // Secondary dominants: [null, V/ii, V/iii, V/IV, V/V, V/vi] - aligned with diatonic [I, ii, iii, IV, V, vi]
  const secDomLabels = ['—', 'V/ii', 'V/iii', 'V/IV', 'V/V', 'V/vi'];
  const secDomChords = keyData.secDom.map((c, i) => {
      if (!c) return `<div class="chord-wrapper"><div class="chord-numeral" style="color:#555;">—</div><div class="chord-box empty" style="opacity:0.3; pointer-events:none;"><span class="note">—</span></div></div>`;
      return createChordHTML(c, secDomLabels[i], `sec-${i}`, Data.SONGWRITING_TIPS[secDomLabels[i]] ? '' : 'Secondary Dominant');
  });
  const mainLabels = ['I', 'ii', 'iii', 'IV', 'V', 'vi'];
  const mainChords = keyData.diatonic.map((c, i) => {
      return createChordHTML(c, mainLabels[i], `main-${i}`, Data.ROMAN_EXPLANATIONS[mainLabels[i]]);
  });
  const modalChords = keyData.modal.map((c, i) => {
      const labels = ['♭III', '♭VI', 'iv', '♭VII'];
      return createChordHTML(c, labels[i], `modal-${i}`, Data.ROMAN_EXPLANATIONS[labels[i]]);
  });

  grid.innerHTML = `
    <div class="connector-area"><span class="row-warning">⚠️ Don't mix these together – each resolves to a different key center</span></div>
    <div class="chord-row secondary">
      <div class="row-label">SECONDARY DOMINANTS</div>
      <div class="chords-container">${secDomChords.join('')}</div>
    </div>
    <div class="connector-area"><span class="nav-text">↓ RESOLVES DOWN to the chord directly below (V/x → x)</span></div>

    <div class="chord-row main">
      <div class="row-label">MAIN CHORDS (Diatonic)</div>
      <div class="chords-container">${mainChords.join('')}</div>
    </div>
    <div class="connector-area"><span class="nav-text">↓ BORROW from parallel minor for color | ↑ RETURN to I, IV, or V</span></div>

    <div class="chord-row modal">
      <div class="row-label">MODAL INTERCHANGE (Borrowed from minor)</div>
      <div class="chords-container">${modalChords.join('')}</div>
    </div>
    ${buildBorrowedModeSections(keyData)}
  `;
}

// Render a mini chord diagram (SVG) showing fret positions
// Uses neutral colors visible on both light and dark backgrounds
function renderMiniChordDiagram(shape) {
    if (!shape || !shape.frets) return '';
    const frets = shape.frets;

    // Find fret range
    const playedFrets = frets.filter(f => f !== null && f > 0);
    if (playedFrets.length === 0) return '';

    const minFret = Math.max(1, Math.min(...playedFrets));
    const maxFret = Math.max(minFret + 3, Math.max(...playedFrets));
    const baseFret = minFret;
    const numFrets = Math.min(5, maxFret - baseFret + 2);

    const w = 72, h = 100;
    const padL = 18, padR = 8, padT = 16, padB = 18;
    const sw = (w - padL - padR) / 5; // string spacing
    const fh = (h - padT - padB) / numFrets; // fret height

    let svg = `<svg class="mini-chord-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible">`;

    // Fret lines — neutral grey visible on both light and dark
    for (let f = 0; f <= numFrets; f++) {
        const y = padT + f * fh;
        svg += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#999" stroke-width="1.5"/>`;
    }

    // Nut (thick bar at top if starting at fret 1)
    if (baseFret <= 1) {
        svg += `<rect x="${padL - 1}" y="${padT - 3}" width="${w - padL - padR + 2}" height="4" rx="1" fill="#666"/>`;
    }

    // String lines
    for (let s = 0; s < 6; s++) {
        const x = padL + s * sw;
        svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${h - padB}" stroke="#aaa" stroke-width="0.8"/>`;
    }

    // Dots and markers
    for (let s = 0; s < 6; s++) {
        const x = padL + s * sw;
        const fretVal = frets[s];
        if (fretVal === null) {
            // Muted — X above nut
            svg += `<text x="${x}" y="${padT - 6}" text-anchor="middle" fill="#e05555" font-size="12" font-weight="700" font-family="Outfit, sans-serif">×</text>`;
        } else if (fretVal === 0) {
            // Open — O above nut
            svg += `<circle cx="${x}" cy="${padT - 8}" r="3.5" fill="none" stroke="#c8a04a" stroke-width="1.5"/>`;
        } else {
            // Fretted — gold dot
            const fretOffset = fretVal - baseFret;
            if (fretOffset >= 0 && fretOffset < numFrets) {
                const y = padT + fretOffset * fh + fh / 2;
                svg += `<circle cx="${x}" cy="${y}" r="5" fill="#c8a04a"/>`;
            }
        }
    }

    // Fret numbers on the left side
    for (let f = 0; f < numFrets; f++) {
        const fretNum = baseFret + f;
        const y = padT + f * fh + fh / 2 + 3;
        svg += `<text x="3" y="${y}" fill="#b08830" font-size="9" font-family="Outfit, sans-serif">${fretNum}</text>`;
    }

    // String labels at bottom (E A D G B e)
    const stringLabels = ['E', 'A', 'D', 'G', 'B', 'e'];
    for (let s = 0; s < 6; s++) {
        const x = padL + s * sw;
        const y = h - 2;
        svg += `<text x="${x}" y="${y}" text-anchor="middle" fill="#999" font-size="8" font-family="Outfit, sans-serif">${stringLabels[s]}</text>`;
    }

    svg += '</svg>';
    return svg;
}

// ========== MELODY TAB SECTION ==========
// Articulation symbols for tab
const TAB_ARTIC_SYMBOLS = { h: 'h', p: 'p', '/': '/', '\\': '\\' };
const TAB_ARTIC_LABELS = { h: 'Hammer-on', p: 'Pull-off', '/': 'Slide up', '\\': 'Slide down' };
const TAB_ARTIC_ORDER = ['h', 'p', '/', '\\'];

function renderTabSection(line, lineIdx) {
    // Ensure tab array and articulations exist
    if (!line.tab) line.tab = [];
    if (!line.tabArtic) line.tabArtic = []; // articulations[i] = between col i and i+1
    // Safety net: every chord in the progression should have at least one tab
    // column so the chord-zone label can render above it. If the user added
    // chords after first opening the tab, top up with empty columns. Also
    // clear any stale chordBoundaries so they get recomputed.
    if (line.chords && line.tab.length < line.chords.length) {
        const need = line.chords.length - line.tab.length;
        for (let i = 0; i < need; i++) {
            line.tab.push([null, null, null, null, null, null]);
        }
        line.chordBoundaries = null;
    }
    const tab = line.tab;
    const artic = line.tabArtic;
    const strings = ['e', 'B', 'G', 'D', 'A', 'E']; // high to low

    const tabZoom = line.tabZoom || 1;
    let html = `<div class="tab-section" data-line="${lineIdx}" style="--tab-zoom: ${tabZoom}">`;

    // Tab toolbar
    html += `<div class="tab-toolbar">`;
    html += `<div class="tab-transpose">`;
    html += `<button class="tab-transpose-btn" data-action="transposeTab" data-line="${lineIdx}" data-delta="-1" title="Shift all frets down 1 (lower pitch)">← Down</button>`;
    html += `<button class="tab-transpose-btn" data-action="transposeTab" data-line="${lineIdx}" data-delta="1" title="Shift all frets up 1 (higher pitch)">Up →</button>`;
    html += `</div>`;
    html += `<div class="tab-zoom-group">`;
    html += `<span class="tab-zoom-label">Zoom</span>`;
    html += `<input type="range" class="tab-zoom-slider" min="0.7" max="3.0" step="0.1" value="${tabZoom}" data-line="${lineIdx}">`;
    html += `<span class="tab-zoom-value">${tabZoom}x</span>`;
    html += `</div>`;
    html += `<div class="tab-zoom-group">`;
    html += `<span class="tab-zoom-label">Scroll</span>`;
    html += `<input type="range" class="tab-scroll-slider" min="0" max="100" step="1" value="0" data-line="${lineIdx}">`;
    html += `</div>`;
    if (line.chords.length > 0) {
        // Build dynamic tooltip content for each tier
        const NOTE_DISPLAY = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
        const isDarkMode = state.selectedTab === 'dark';
        const keyName = state.selectedKey;
        const kIdx = noteToIndex(keyName);
        const scPat = isDarkMode ? [0,2,3,5,7,8,10] : [0,2,4,5,7,9,11];
        const scaleNoteNames = scPat.map(i => NOTE_DISPLAY[(kIdx + i) % 12]);
        const scaleName = isDarkMode ? 'natural minor' : 'major';

        // Chord tones summary for each chord in progression
        const chordToneSummary = line.chords.map(item => {
            const c = item.roman ? transposeChord(item.chord, item.roman, state.progressionKey, state.selectedKey) : item.chord;
            const tones = getChordTonesForItem(item);
            const toneNames = [...tones].map(i => NOTE_DISPLAY[i]).join(', ');
            return c + ' → ' + toneNames;
        }).join('  |  ');

        // Scales that work over each chord
        const MODAL_SCALES = {
            '': ['Ionian (major)', 'Lydian'],
            'm': ['Aeolian (minor)', 'Dorian', 'Phrygian'],
            '7': ['Mixolydian', 'Blues'],
            'm7': ['Dorian', 'Aeolian', 'Phrygian'],
            'maj7': ['Ionian', 'Lydian'],
            'dim': ['Locrian', 'Half-whole dim'],
            'aug': ['Whole tone', 'Lydian augmented'],
            'sus4': ['Mixolydian'],
            'sus2': ['Mixolydian', 'Major pent.']
        };
        const chordScaleHints = line.chords.map(item => {
            const c = item.roman ? transposeChord(item.chord, item.roman, state.progressionKey, state.selectedKey) : item.chord;
            const m = c.match(/^([A-G][#b]?)(.*)/);
            const q = m ? m[2] : '';
            const qKey = Object.keys(MODAL_SCALES).find(k => q.toLowerCase() === k) || '';
            const scales = MODAL_SCALES[qKey] || ['Major/minor'];
            return c + ': ' + scales.join(', ');
        }).join('  |  ');

        // Build chord tone entries HTML
        const chordEntriesHtml = line.chords.map(item => {
            const c = item.roman ? transposeChord(item.chord, item.roman, state.progressionKey, state.selectedKey) : item.chord;
            const tones = getChordTonesForItem(item);
            const toneNotes = [...tones].map(i => `<span class="tier-tooltip-note" style="background:rgba(80,200,120,0.15);color:#5ec878;">${NOTE_DISPLAY[i]}</span>`).join('');
            const m = c.match(/^([A-G][#b]?)(.*)/);
            const q = m ? m[2] : '';
            const qKey = Object.keys(MODAL_SCALES).find(k => q.toLowerCase() === k) || '';
            const scales = MODAL_SCALES[qKey] || ['Major/minor'];
            return `<div class="tier-tooltip-chord-entry"><span class="tier-tooltip-chord-name">${c}</span>: ${toneNotes}<div class="tier-tooltip-scales">Try: ${scales.join(', ')}</div></div>`;
        }).join('');

        const scaleNotesHtml = scaleNoteNames.map(n => `<span class="tier-tooltip-note" style="background:rgba(240,190,60,0.12);color:#e8b84a;">${n}</span>`).join('');

        html += `<span class="tab-tier-legend">`;

        // Chord tier
        html += `<span class="tab-tier-item"><span class="tab-tier-dot tier-chord-dot"></span> chord`;
        html += `<div class="tier-tooltip"><div class="tier-tooltip-title">Chord Tones</div>`;
        html += `<div class="tier-tooltip-detail">Notes that belong to the chord playing at that moment. These are the strongest, most consonant choices.</div>`;
        html += chordEntriesHtml;
        html += `</div></span> `;

        // Scale tier
        html += `<span class="tab-tier-item"><span class="tab-tier-dot tier-scale-dot"></span> scale`;
        html += `<div class="tier-tooltip"><div class="tier-tooltip-title">${keyName} ${scaleName} tones</div>`;
        html += `<div class="tier-tooltip-detail">In the key's scale but not in the current chord. Safe melodic choices that add movement.</div>`;
        html += `<div class="tier-tooltip-notes">${scaleNotesHtml}</div>`;
        html += `</div></span> `;

        // Outside tier
        html += `<span class="tab-tier-item"><span class="tab-tier-dot tier-outside-dot"></span> outside`;
        html += `<div class="tier-tooltip"><div class="tier-tooltip-title">Outside Notes</div>`;
        html += `<div class="tier-tooltip-detail">Chromatic notes — not in the ${keyName} ${scaleName} scale. Can sound tense, but powerful when used intentionally as passing tones, approach notes, or colour.</div>`;
        html += `</div></span> `;

        // Passing tier
        html += `<span class="tab-tier-item"><span class="tab-tier-dot tier-passing-dot"></span> passing`;
        html += `<div class="tier-tooltip"><div class="tier-tooltip-title">Passing Notes</div>`;
        html += `<div class="tier-tooltip-detail">Notes you've marked by typing <b>p</b> after the fret (e.g. <b>5p</b>). Passing tones connect two important notes quickly — shown at half width to reflect their brief duration.</div>`;
        html += `</div></span>`;

        html += `</span>`;

        // Toggles for chord tones and key scale
        const showTones = line.showChordTones || false;
        const showScale = line.showKeyScale || false;
        html += `<button class="tab-tones-toggle ${showScale ? 'active' : ''}" data-action="toggleKeyScale" data-line="${lineIdx}" title="Show key scale notes above the tab">♪ Key scale</button>`;
        html += `<button class="tab-tones-toggle ${showTones ? 'active' : ''}" data-action="toggleChordTones" data-line="${lineIdx}" title="Show chord tones under each chord">♪ Chord tones</button>`;
    }
    html += `</div>`;

    // Always build chord validation when chords exist (three-tier: chord/scale/outside)
    const tabValidation = (line.chords.length > 0) ? buildTabChordValidation(line) : null;

    // Pre-compute key scale note set for colouring chord tone pills
    const FLAT_KEYS_SET = new Set(['F','Bb','Eb','Ab','Db','Gb']);
    const tabUseFlats = FLAT_KEYS_SET.has(state.selectedKey);
    const tabNN = tabUseFlats ? Data.NOTE_NAMES_FLAT : Data.NOTE_NAMES_SHARP;
    const tabIsDark = state.selectedTab === 'dark';
    const tabKeyIdx = noteToIndex(state.selectedKey);
    const tabScalePat = tabIsDark ? [0,2,3,5,7,8,10] : [0,2,4,5,7,9,11];
    const tabScaleSet = new Set(tabScalePat.map(i => (tabKeyIdx + i) % 12));

    // Key scale row (shown above the tab grid when toggle is on)
    if (line.showKeyScale) {
        const scaleNotes = tabScalePat.map(i => tabNN[(tabKeyIdx + i) % 12]);
        html += `<div class="tab-key-scale-row">`;
        html += `<span class="tab-key-scale-label">${state.selectedKey} ${tabIsDark ? 'minor' : 'major'}:</span>`;
        html += scaleNotes.map(n => `<span class="tab-key-scale-note">${n}</span>`).join('');
        html += `</div>`;
    }

    const gridExtraClass = (line.showChordTones || line.showKeyScale) ? 'show-tones' : '';
    html += `<div class="tab-grid ${gridExtraClass}">`;

    // String labels column
    html += `<div class="tab-labels">`;
    for (let s = 0; s < 6; s++) {
        html += `<div class="tab-label">${strings[s]}</div>`;
    }
    html += `</div>`;

    // Opening bar line
    html += `<div class="tab-barline"></div>`;

    // Tab columns with articulations between them
    tab.forEach((col, colIdx) => {
        // Articulation connector before this column (between colIdx-1 and colIdx)
        if (colIdx > 0) {
            const artVal = artic[colIdx - 1] || null; // articulation between prev and this
            html += `<div class="tab-artic-col" data-line="${lineIdx}" data-artic-idx="${colIdx - 1}">`;
            for (let s = 0; s < 6; s++) {
                const aVal = artVal && artVal[s] ? artVal[s] : null;
                html += `<div class="tab-artic-cell" data-action="cycleArtic" data-line="${lineIdx}" data-artic-idx="${colIdx - 1}" data-string="${s}">`;
                html += aVal ? `<span class="tab-artic-sym">${TAB_ARTIC_SYMBOLS[aVal]}</span>` : `<span class="tab-artic-empty"></span>`;
                html += `</div>`;
            }
            html += `</div>`;
        }

        // Add chord boundary marker if this column starts a new chord zone
        const isChordBoundary = tabValidation && tabValidation.chordBoundaries && tabValidation.chordBoundaries.has(colIdx);
        if (isChordBoundary && colIdx > 0) {
            // Find which chord index this boundary belongs to
            const bArr = line.chordBoundaries || [];
            const bIdx = bArr.indexOf(colIdx);
            html += `<div class="tab-chord-boundary" data-action="dragBoundary" data-line="${lineIdx}" data-boundary-idx="${bIdx}" title="Drag to move chord zone boundary"></div>`;
        }

        // Chord name label above the first column of each chord zone.
        // Use the transposed display name so the label stays in sync with the
        // currently-selected key (chords are stored in their entered key but
        // displayed via their roman numeral against state.selectedKey).
        const chordZoneIdx = tabValidation && line.chordBoundaries
            ? line.chordBoundaries.indexOf(colIdx)
            : -1;
        const chordZoneItem = (chordZoneIdx >= 0 && line.chords[chordZoneIdx]) ? line.chords[chordZoneIdx] : null;
        const chordZoneLabel = chordZoneItem
            ? (chordZoneItem.roman
                ? transposeChord(chordZoneItem.chord, chordZoneItem.roman, state.progressionKey, state.selectedKey)
                : (chordZoneItem.chord || ''))
            : '';

        // Check if this column has any passing notes
        const passingSet = line.tabPassing || {};
        const colHasPassing = Object.keys(passingSet).some(k => k.startsWith(colIdx + ','));

        const sel = state.tabSelection;
        const isSelected = sel && sel.line === lineIdx && colIdx >= sel.start && colIdx <= sel.end;
        html += `<div class="tab-column ${isChordBoundary ? 'chord-zone-start' : ''} ${colHasPassing ? 'tab-col-passing' : ''} ${isSelected ? 'tab-col-selected' : ''}" data-line="${lineIdx}" data-col="${colIdx}">`;
        if (chordZoneLabel) {
            // Build chord tone pills if toggle is on
            let tonesHtml = '';
            if (line.showChordTones && chordZoneIdx >= 0 && line.chords[chordZoneIdx]) {
                const tones = getChordTonesForItem(line.chords[chordZoneIdx]);
                const pills = [...tones].map(i => {
                    const inKey = tabScaleSet.has(i);
                    const cls = inKey ? 'tab-tone-pill in-key' : 'tab-tone-pill outside-key';
                    return `<span class="${cls}">${tabNN[i]}</span>`;
                }).join('');
                tonesHtml = `<span class="tab-zone-tones">${pills}</span>`;
            }
            html += `<div class="tab-zone-chord-label">${chordZoneLabel}${tonesHtml}</div>`;
        }
        for (let s = 0; s < 6; s++) {
            const val = col[s];
            const hasNote = val !== null && val !== undefined;
            const isPassing = passingSet[colIdx + ',' + s] === true;
            const editingThis = state.tabEditing &&
                state.tabEditing.line === lineIdx &&
                state.tabEditing.col === colIdx &&
                state.tabEditing.string === s;

            // Three-tier chord-aware classification (passing notes get their own tier)
            const cellVal = tabValidation && tabValidation[colIdx] ? tabValidation[colIdx][s] : null;
            const tierClass = hasNote && isPassing ? 'tab-tier-passing' : (cellVal ? `tab-tier-${cellVal.tier}` : '');
            const noteLabel = cellVal ? cellVal.noteName : '';

            if (editingThis) {
                // Show current value with "p" suffix if passing
                const editVal = hasNote ? (val + (isPassing ? 'p' : '')) : '';
                html += `<div class="tab-cell editing" data-line="${lineIdx}" data-col="${colIdx}" data-string="${s}">`;
                html += `<input class="tab-cell-input" type="text" maxlength="4" value="${editVal}" data-action="tabCellInput" data-line="${lineIdx}" data-col="${colIdx}" data-string="${s}" autofocus>`;
                html += `</div>`;
            } else {
                html += `<div class="tab-cell ${hasNote ? 'has-note' : ''} ${hasNote ? tierClass : ''} ${isPassing ? 'passing-note' : ''}" data-action="tabCellClick" data-line="${lineIdx}" data-col="${colIdx}" data-string="${s}">`;
                if (hasNote && noteLabel) {
                    html += `<span class="tab-fret">${val}</span><span class="tab-note-label">${noteLabel}</span>`;
                } else {
                    html += hasNote ? `<span class="tab-fret">${val}</span>` : `<span class="tab-dash">–</span>`;
                }
                html += `</div>`;
            }
        }
        // Show quick-insert button if this column is being edited
        if (state.tabEditing && state.tabEditing.line === lineIdx && state.tabEditing.col === colIdx) {
            html += `<button class="tab-col-insert-after" data-action="insertTabColAfter" data-line="${lineIdx}" data-col="${colIdx}" title="Insert column after this one">+</button>`;
        }
        // Per-column footer: × (remove) and ⠿ (drag-to-reorder) at the bottom
        // of the column rather than the top, so chord names + boundary bars
        // sit cleanly above the fret cells.
        html += `<div class="tab-col-footer">
            <button class="tab-col-remove" data-action="removeTabCol" data-line="${lineIdx}" data-col="${colIdx}" title="Remove">×</button>
            <span class="tab-col-drag-handle" data-action="dragTabCol" data-line="${lineIdx}" data-col="${colIdx}" title="Drag to reorder">⠿</span>
        </div>`;
        html += `</div>`;
    });

    // Closing bar line
    if (tab.length > 0) {
        html += `<div class="tab-barline"></div>`;
    }

    // Add column button
    html += `<button class="tab-add-col" data-action="addTabCol" data-line="${lineIdx}" title="Add note column">+</button>`;

    html += `</div>`; // tab-grid
    html += `</div>`; // tab-section

    return html;
}

// Convert fret + string index to a note name
// Parse tab cell input: "5" → {fret:5, passing:false}, "5p" → {fret:5, passing:true}, "" → {fret:null, passing:false}
function parseTabInput(raw) {
    const s = String(raw).trim().toLowerCase();
    if (s === '') return { fret: null, passing: false };
    const isPassing = s.endsWith('p');
    const numStr = isPassing ? s.slice(0, -1) : s;
    const num = parseInt(numStr);
    if (isNaN(num)) return { fret: null, passing: false };
    return { fret: Math.max(0, Math.min(24, num)), passing: isPassing };
}

function fretToNote(fret, stringIdx) {
    // stringIdx 0=e(high), 1=B, 2=G, 3=D, 4=A, 5=E(low)
    const openNotes = [4, 11, 7, 2, 9, 4]; // E4=4, B=11, G=7, D=2, A=9, E2=4 (semitone indices)
    const noteIdx = (openNotes[stringIdx] + fret) % 12;
    return noteIdx;
}

// Get chord tones for a line's chord, using shape notes when available
function getChordTonesForItem(item) {
    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const FLAT_MAP = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };

    // Try shape first
    if (item.shape && item.shape.frets) {
        const { pitchClasses } = Audio.extractNotesFromShape(item.shape.frets);
        if (pitchClasses.size >= 2) return pitchClasses;
    }

    // Fall back to chord name
    const chord = item.chord;
    if (!chord || chord === '?') return new Set();
    const m = chord.match(/^([A-G][#b]?)(.*)/);
    if (!m) return new Set();
    const rawRoot = m[1];
    const quality = m[2];
    const tones = Audio.getChordTones(rawRoot, quality);
    return new Set(tones.map(t => NOTE_NAMES.indexOf(FLAT_MAP[t.note] || t.note)));
}

// Build tab-vs-chord validation data for a line
function buildTabChordValidation(line) {
    if (!line.tab || line.tab.length === 0 || line.chords.length === 0) return null;

    const numCols = line.tab.length;
    const numChords = line.chords.length;
    // Use flat note names for flat keys, sharp for sharp keys (matches tooltip display)
    const FLAT_KEYS = new Set(['F','Bb','Eb','Ab','Db','Gb']);
    const useFlats = FLAT_KEYS.has(state.selectedKey);
    const NOTE_NAMES = useFlats ? Data.NOTE_NAMES_FLAT : Data.NOTE_NAMES_SHARP;

    // Persist chord boundaries so they don't shift when columns are added.
    // Reset if chord count changed (user added/removed a chord).
    if (!line.chordBoundaries || line.chordBoundaries.length !== numChords) {
        // Even-split initial boundaries
        const colsPerChord = Math.max(1, Math.floor(numCols / numChords));
        line.chordBoundaries = [];
        for (let i = 0; i < numChords; i++) {
            line.chordBoundaries.push(i * colsPerChord);
        }
        // First chord always starts at 0
        line.chordBoundaries[0] = 0;
    }

    const boundaries = line.chordBoundaries;

    const getChordIdx = (colIdx) => {
        for (let i = boundaries.length - 1; i >= 0; i--) {
            if (colIdx >= boundaries[i]) return Math.min(i, numChords - 1);
        }
        return 0;
    };

    // Pre-compute chord tone sets
    const chordToneSets = line.chords.map(item => getChordTonesForItem(item));

    // Build the scale for the selected key (for "scale tone" classification)
    const isDark = state.selectedTab === 'dark';
    const scalePattern = isDark ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const keyIdx = noteToIndex(state.selectedKey);
    const scaleNotes = new Set(scalePattern.map(i => (keyIdx + i) % 12));

    // For each cell: classify as chord-tone, scale-tone, or outside
    // cellData[colIdx][stringIdx] = { noteName, noteIdx, tier, chordIdx, intervalLabel }
    // tier: 'chord' | 'scale' | 'outside'
    const cellData = [];
    const chordBoundarySet = new Set(); // columns where a new chord starts

    for (let colIdx = 0; colIdx < numCols; colIdx++) {
        const col = line.tab[colIdx];
        const chordIdx = getChordIdx(colIdx);
        const chordTones = chordToneSets[chordIdx];

        // Track chord boundaries for visual separators
        if (colIdx === 0 || getChordIdx(colIdx) !== getChordIdx(colIdx - 1)) {
            chordBoundarySet.add(colIdx);
        }

        const colData = [];
        for (let s = 0; s < 6; s++) {
            const fret = col[s];
            if (fret === null || fret === undefined) {
                colData.push(null);
            } else {
                const noteIdx = fretToNote(fret, s);
                const noteName = NOTE_NAMES[noteIdx];
                const inChord = chordTones.has(noteIdx);
                const inScale = scaleNotes.has(noteIdx);
                const tier = inChord ? 'chord' : inScale ? 'scale' : 'outside';
                colData.push({ noteName, noteIdx, tier, chordIdx, inChord });
            }
        }
        cellData.push(colData);
    }

    cellData.chordBoundaries = chordBoundarySet;
    return cellData;
}

// Analyse the melody tab for key/scale information
function analyzeTabMelody(line) {
    if (!line.tab || line.tab.length === 0) return null;

    // Collect all played note indices (pitch classes)
    const notesPlayed = new Set();
    const notePositions = []; // {noteIdx, col, string, fret}

    line.tab.forEach((col, colIdx) => {
        for (let s = 0; s < 6; s++) {
            const fret = col[s];
            if (fret !== null && fret !== undefined) {
                const noteIdx = fretToNote(fret, s);
                notesPlayed.add(noteIdx);
                notePositions.push({ noteIdx, col: colIdx, string: s, fret });
            }
        }
    });

    if (notesPlayed.size === 0) return null;
    const noteArr = [...notesPlayed];

    // Define scales to check
    const scalePatterns = {
        'Major': [0, 2, 4, 5, 7, 9, 11],
        'Natural Minor': [0, 2, 3, 5, 7, 8, 10],
        'Major Pentatonic': [0, 2, 4, 7, 9],
        'Minor Pentatonic': [0, 3, 5, 7, 10],
        'Blues': [0, 3, 5, 6, 7, 10],
        'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
        'Dorian': [0, 2, 3, 5, 7, 9, 10],
        'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
        'Phrygian': [0, 1, 3, 5, 7, 8, 10]
    };

    const roots = Data.NOTE_NAMES_SHARP;
    let bestMatch = null;
    let bestScore = -1;

    // Try every root + scale combo
    roots.forEach((root, rootIdx) => {
        Object.entries(scalePatterns).forEach(([scaleName, pattern]) => {
            const scaleNotes = new Set(pattern.map(i => (rootIdx + i) % 12));
            // Score: how many played notes are in this scale
            let inScale = 0;
            let outOfScale = 0;
            noteArr.forEach(n => {
                if (scaleNotes.has(n)) inScale++;
                else outOfScale++;
            });

            const score = inScale - (outOfScale * 2); // penalise out-of-scale notes
            const coverage = inScale / noteArr.length;

            if (coverage >= 0.5 && (score > bestScore || (score === bestScore && pattern.length < (bestMatch ? bestMatch.patternLen : 99)))) {
                bestScore = score;
                bestMatch = {
                    root,
                    rootIdx,
                    scaleName,
                    scaleNotes,
                    inScale,
                    outOfScale,
                    total: noteArr.length,
                    coverage,
                    patternLen: pattern.length
                };
            }
        });
    });

    if (!bestMatch) return { noMatch: true, noteCount: notesPlayed.size };

    // Identify out-of-key notes and their positions
    const outOfKeyNotes = [];
    const outOfKeyPositions = [];
    notePositions.forEach(np => {
        if (!bestMatch.scaleNotes.has(np.noteIdx)) {
            const noteName = Data.NOTE_NAMES_SHARP[np.noteIdx];
            if (!outOfKeyNotes.includes(noteName)) outOfKeyNotes.push(noteName);
            outOfKeyPositions.push({ col: np.col, string: np.string, note: noteName });
        }
    });

    // Check against the currently selected key
    const currentKey = state.selectedKey;
    const isDark = state.selectedTab === 'dark';
    const currentScaleType = isDark ? 'minor' : 'major';
    const currentScalePattern = scalePatterns[isDark ? 'Natural Minor' : 'Major'];
    const currentKeyIdx = noteToIndex(currentKey);
    const currentScaleNotes = new Set(currentScalePattern.map(i => (currentKeyIdx + i) % 12));
    const fitsCurrentKey = noteArr.every(n => currentScaleNotes.has(n));

    // Also find notes outside the SELECTED key (not just the best-match scale)
    const outsideSelectedKey = [];
    noteArr.forEach(n => {
        if (!currentScaleNotes.has(n)) {
            const name = Data.NOTE_NAMES_SHARP[n];
            if (!outsideSelectedKey.includes(name)) outsideSelectedKey.push(name);
        }
    });
    const inSelectedKey = noteArr.filter(n => currentScaleNotes.has(n)).length;

    return {
        bestRoot: bestMatch.root,
        bestScale: bestMatch.scaleName,
        inScale: inSelectedKey,
        outOfScale: bestMatch.outOfScale,
        total: bestMatch.total,
        coverage: bestMatch.coverage,
        outOfKeyNotes: outsideSelectedKey,
        outOfKeyPositions,
        fitsCurrentKey,
        currentKey,
        currentScaleType,
        noteCount: notesPlayed.size
    };
}

function renderTabAnalysis(analysis, lineIdx) {
    if (!analysis) return '';

    let html = `<div class="tab-analysis" data-line="${lineIdx}">`;

    if (analysis.noMatch) {
        html += `<span class="tab-analysis-text">Not enough notes to analyse (${analysis.noteCount} unique note${analysis.noteCount !== 1 ? 's' : ''})</span>`;
    } else {
        // Primary: does the melody fit the selected key?
        if (analysis.fitsCurrentKey) {
            html += `<span class="tab-analysis-badge good">✓ All ${analysis.total} notes fit ${analysis.currentKey} ${analysis.currentScaleType}</span>`;
        } else {
            const outsideDisplay = analysis.outOfKeyNotes.map(n => displayChordForKey(n, analysis.currentKey)).join(', ');
            html += `<span class="tab-analysis-badge warn">${analysis.inScale}/${analysis.total} notes fit ${analysis.currentKey} ${analysis.currentScaleType}</span>`;
            if (outsideDisplay) {
                html += `<span class="tab-analysis-badge outside">${outsideDisplay} outside scale</span>`;
            }
        }

        // Secondary: suggest a better-fitting scale if the melody doesn't fit the selected key
        if (!analysis.fitsCurrentKey && analysis.coverage >= 0.8) {
            const bestScaleDisplay = displayChordForKey(analysis.bestRoot, analysis.currentKey);
            html += `<span class="tab-analysis-badge key" title="Best-fitting scale for these notes">Try: ${bestScaleDisplay} ${analysis.bestScale}</span>`;
        }
    }

    html += `<button class="tab-analysis-close" data-action="closeTabAnalysis" data-line="${lineIdx}">×</button>`;
    html += `</div>`;
    return html;
}

// ===== v112: per-chord duration & accent helpers =====
function chordBeats(item) { const b = item && item.beats; return (typeof b === 'number' && b > 0) ? b : 4; } // v2 port: allow arbitrary ½-beat lengths (was clamped to 2/4/8); old saves keep their 2/4/8 values
function chordAccent(item) { return (item && (item.accent === 'stop' || item.accent === 'push')) ? item.accent : 'norm'; }

// ===== chord-builder v2 port: free-floating positions + per-line meter =====
// Additive + backward-compatible. Old saves have no `start`/`bpb`; normalizeLinePositions
// derives a sequential `start` from `beats` once on load so they render identically, then
// edits set `start` explicitly. `bpb` defaults to 4 (4/4). Nothing outside the builder
// reads these, so they survive in the persisted state harmlessly.
function lineBpb(line) { return (line && line.bpb) || 4; }
function lineNextStart(line) { return (line.chords || []).reduce((m, c) => Math.max(m, (c.start || 0) + chordBeats(c)), 0); }
function lineTotalBeats(line) { return lineNextStart(line); }
function lineNbars(line) { return Math.max(1, line.minBars || 0, Math.ceil(lineTotalBeats(line) / lineBpb(line) - 1e-9)); }
function lineAxisBeats(line) { return lineNbars(line) * lineBpb(line); }
// chord sounding at an absolute beat offset within a line (null over a gap); last-in-array wins on overlap
function chordAtBeat(line, beat) { let best = null; (line.chords || []).forEach(c => { const s = c.start || 0; if (beat >= s && beat < s + chordBeats(c)) best = c; }); return best; }
function normalizeLinePositions(line) {
    if (!line) return line;
    if (line.bpb == null) line.bpb = 4;
    if (line.viewMode == null) line.viewMode = 'stacked';
    if (Array.isArray(line.chords)) {
        // Fill only chords that LACK a start (old saves → all sequential; a newly-added
        // start-less chord → appended at the running end). Never clobber explicit positions.
        let acc = 0;
        line.chords.forEach(c => { if (c.start == null) c.start = acc; acc = Math.max(acc, (c.start || 0) + chordBeats(c)); });
    }
    return line;
}
function normalizeProgressionState() { (state.progressionLines || []).forEach(normalizeLinePositions); }
// drag/positioning helpers (block-on-overlap moves; clamp-to-gap resizes; ½-beat snap)
function snap05(v) { return Math.round(v * 2) / 2; }
function chordsOverlap(line, chord, start, beats) { return (line.chords || []).some(c => c !== chord && start < (c.start || 0) + chordBeats(c) && (c.start || 0) < start + beats); }
function chordMaxBeats(line, chord) { let cap = Infinity; const st = chord.start || 0; (line.chords || []).forEach(c => { if (c === chord) return; const s = c.start || 0; if (s > st && (s - st) < cap) cap = s - st; }); return cap; }
function clampChordBeats(line, chord, want) { return Math.max(0.5, Math.min(want, chordMaxBeats(line, chord))); }

// Strategy A: the v2 unified builder (shared-ruler Chords/Tab/Melody lanes) is mounted into
// #progressionArea, replacing the old chord row + melody sketcher + tab editor. Production `state`
// stays the source of truth: renderV2BuilderHTML() re-seeds the v2 model from `state` on every render
// (with the site's key-transposed display names), so the site palette / key buttons / Bright-Shadow /
// add-line all keep flowing through the existing production handlers. The in-lane v2 edit controls
// (drag/resize/length/accent/tab+melody lanes) are handled by installV2Controller(), which mutates
// the live v2state and re-renders the mount without re-seeding (see below).
let v2state = null;
function renderV2BuilderHTML() {
    if (!window.UZ_BUILDER_BRIDGE || !window.VIEWS) return '<div class="uzv2-missing">Builder library failed to load.</div>';
    v2state = window.UZ_BUILDER_BRIDGE.seedFromProduction(state, {
        displayName: (c) => {
            const raw = c.roman ? transposeChord(c.chord, c.roman, state.progressionKey, state.selectedKey) : c.chord;
            return displayChordForKey(raw, state.selectedKey);
        }
    });
    const V = window.VIEWS;
    const cards = v2state.lines.map((l) => V.lineCard(v2state, l)).join('');
    const dark = (state.selectedTab === 'dark') ? ' dark-mode' : '';
    return `<div class="uzv2${dark}" id="uzv2Builder"><div class="appwrap${v2state.minor ? ' darkwrap' : ''}"><div class="lines">${cards}</div></div></div>`;
}

// ── v2 builder interaction controller ──────────────────────────────────────
// Ported from the prototype controller (builder/app.js), embedded in the production module so it
// can drive the module-private state. It mutates the live v2state in place, then v2SoftRender()
// re-renders #uzv2Builder from that same v2state (NO re-seed → references stay valid mid-drag and
// transient state survives), and v2commit() additionally writes back to production + saves (for
// persistence / audio / share). Re-seed only happens on production-driven renderProgression()
// (palette / key / Bright-Shadow). All builder listeners are capture-phase + scoped to
// #uzv2Builder and stopPropagation, so production's body dispatchers never double-handle them.
// R1-1: badge v2 chips whose drawn fingering doesn't play the named (displayed) chord. Uses the
// production matcher exposed by uz-deferred-patches.js; runs after every render (both paths).
function v2ApplyMismatchBadges() {
    if (!v2state || typeof window.UZ_SHAPE_MATCH !== 'function') return;
    const root = document.getElementById('uzv2Builder'); if (!root) return;
    v2state.lines.forEach((l) => (l.chords || []).forEach((c) => {
        const chip = root.querySelector(`.chip[data-chipfor="${c.id}"]`); if (!chip) return;
        let bad = false;
        // compare the fingering to the chord's ORIGINAL key-relative name (the key the shape was drawn
        // in — the overlay shows that name), not the transposed display name, so transposing the
        // progression doesn't fire a false mismatch.
        try { bad = !!(c.shape && c.shape.frets && !window.UZ_SHAPE_MATCH(c._orig || c.name, c.shape.frets)); } catch (e) { console.warn('[v2] mismatch badge', c.id, e); }
        chip.classList.toggle('uz-chord-mismatch', bad);
        if (bad) chip.setAttribute('title', "This shape doesn't play the named chord. Tap ♦ to edit.");
        else if (chip.getAttribute('title')) chip.removeAttribute('title');
    }));
}

function installV2Controller() {
    if (window.__uzv2ControllerInstalled) return;
    window.__uzv2ControllerInstalled = true;
    const M = window.MODEL;
    const inB = (e) => e.target.closest && e.target.closest('#uzv2Builder');

    function v2SoftRender() {
        const root = document.getElementById('uzv2Builder');
        if (!root || !window.VIEWS || !v2state) return;
        root.className = 'uzv2' + (state.selectedTab === 'dark' ? ' dark-mode' : '');
        root.classList.toggle('select-mode', !!v2state.selectMode);
        root.innerHTML = `<div class="appwrap${v2state.minor ? ' darkwrap' : ''}"><div class="lines">${v2state.lines.map((l) => window.VIEWS.lineCard(v2state, l)).join('')}</div></div>`;
        v2state.lines.forEach((l) => { if (l.scroll) { const el = root.querySelector(`.tl-scroll[data-scroll="${l.id}"]`); if (el) el.scrollLeft = l.scroll; } });
        v2ApplyMismatchBadges();
    }
    function v2commit() {
        try { window.UZ_BUILDER_BRIDGE.writeBackToProduction(v2state, state); saveStateToLocalStorage(); } catch (e) { console.warn('[v2] writeBack failed', e); }
        v2SoftRender();
    }
    const getV2 = () => v2state;
    const pushUndo = () => { try { pushUndoState(); } catch (e) {} };
    let toEl = null, toTimer = null;
    function toast(msg) { if (!toEl) { toEl = document.createElement('div'); toEl.className = 'uz-toast'; document.body.appendChild(toEl); } toEl.textContent = msg; toEl.classList.add('show'); clearTimeout(toTimer); toTimer = setTimeout(() => toEl.classList.remove('show'), 1600); }
    const previewMel = () => {}; // melody audio re-wires to production voices in A3
    // delegate to production's looper transport (full per-section transport is A2)
    const v2Play = () => { const b = document.querySelector('[data-action="toggleLooper"], .looper-play-btn, [data-action="playProgression"]'); if (b) b.click(); else toast('Use the Loop button to play'); };
    // the production body click handler unlocks WebAudio on first gesture; our capture-phase
    // stopPropagation would swallow a builder-first click, so kick the unlock here too.
    let v2AudioKicked = false;
    const v2KickAudio = () => { if (v2AudioKicked) return; v2AudioKicked = true; try { if (typeof Audio !== 'undefined' && Audio.initAudio) Audio.initAudio(); } catch (e) {} };

    // ── helpers (½-beat grid, block-on-overlap, clamp-to-gap) ──
    function snap05(v) { return Math.round(v * 2) / 2; }
    function overlapsOthers(line, chord, start, beats) { for (const c of line.chords) { if (c.id === chord.id) continue; const s = c.start || 0; if (start < s + c.beats && s < start + beats) return true; } return false; }
    function maxBeatsAt(line, chord) { let cap = Infinity; const st = chord.start || 0; for (const c of line.chords) { if (c.id === chord.id) continue; const s = c.start || 0; if (s > st && (s - st) < cap) cap = s - st; } return cap; }
    function clampBeats(line, chord, want) { return Math.max(0.5, Math.min(want, maxBeatsAt(line, chord))); }
    // furthest end of any chord lying entirely to the LEFT of `chord` (the floor for a left-edge drag)
    function leftBoundOf(line, chord) { let lb = 0; for (const c of line.chords) { if (c.id === chord.id) continue; const e = (c.start || 0) + c.beats; if (e <= (chord.start || 0) + 1e-9 && e > lb) lb = e; } return lb; }
    // R1-2 ripple: insert `dragged` at dropStart, pushing the chord occupying that beat (and everything
    // after it) right by the dragged length — a clean insert that preserves the no-overlap invariant.
    // nbarsOf() auto-grows with content, so the lane extends on its own.
    function rippleInsert(line, dragged, dropStart) {
        const occ = line.chords.find((c) => c.id !== dragged.id && (c.start || 0) <= dropStart + 1e-9 && dropStart < (c.start || 0) + c.beats - 1e-9);
        const anchor = occ ? (occ.start || 0) : dropStart;   // drop onto a chord = insert before it (can't split an indivisible chord)
        line.chords.forEach((c) => { if (c.id !== dragged.id && (c.start || 0) >= anchor - 1e-9) c.start = (c.start || 0) + dragged.beats; });
        dragged.start = anchor;
        // defensive normalize: resolve any residual overlap left-to-right (a no-op from a clean state,
        // but guarantees the no-overlap invariant even if the seed/import arrived with overlaps).
        let cursor = -Infinity;
        line.chords.slice().sort((a, b) => ((a.start || 0) - (b.start || 0)) || (a.id === dragged.id ? -1 : 1))
            .forEach((c) => { let s = c.start || 0; if (s < cursor - 1e-9) s = cursor; c.start = s; cursor = s + c.beats; });
    }
    function chordOf(d) { const l = M.lineById(v2state, d.line); return l && l.chords.find((x) => x.id === d.cid); }
    function ensureShape(c) { if (!c.shape) c.shape = M.defaultShape(c.name) || { frets: [null, null, null, null, null, null], baseFret: 0 }; return c.shape; }
    // copy a chord with a NEW id and a DEEP-copied shape (Object.assign shares the shape ref → editing
    // a duplicate's fingering would otherwise mutate the original). Used by dup/paste.
    function cloneChord(c, extra) { const o = Object.assign({}, c, extra || {}); if (o.shape && o.shape.frets) o.shape = { frets: o.shape.frets.slice(), baseFret: o.shape.baseFret || 0 }; return o; }
    function selOne(lineId, id) { v2state.selection = { lineId, ids: [id] }; v2state.selNote = null; }
    function selChords(line) { return v2state.selection.ids.map((id) => line.chords.find((x) => x.id === id)).filter(Boolean); }
    function selIdx(line) { return v2state.selection.ids.map((id) => line.chords.findIndex((x) => x.id === id)).filter((i) => i >= 0).sort((a, b) => a - b); }

    const V2A = {
        selectChord(d, e) {
            const add = v2state.selectMode || (e && (e.shiftKey || e.metaKey || e.ctrlKey)); v2state.selNote = null;
            if (add && v2state.selection.lineId === d.line && v2state.selection.ids.length) {
                const ids = v2state.selection.ids.slice(); const i = ids.indexOf(d.cid);
                if (i >= 0) ids.splice(i, 1); else ids.push(d.cid);
                v2state.selection = { lineId: d.line, ids };
            } else v2state.selection = { lineId: d.line, ids: [d.cid] };
            v2state.currentLine = d.line; v2commit();
        },
        toggleSelectMode() { v2state.selectMode = !v2state.selectMode; v2commit(); },
        toggleLineLoop(d) { const l = M.lineById(v2state, d.line); l.loop = l.loop === false ? true : false; v2commit(); },
        clearSel() { v2state.selection = { lineId: null, ids: [] }; v2commit(); },
        cycleDur(d) { const c = chordOf(d); if (!c) return; pushUndo(); const l = M.lineById(v2state, d.line); const bp = M.bpb(l); const want = c.beats < bp ? bp : c.beats < bp * 2 ? bp * 2 : bp / 2; c.beats = clampBeats(l, c, want); selOne(d.line, d.cid); v2commit(); },
        setLen(d) { const c = chordOf(d); if (c) { pushUndo(); c.beats = clampBeats(M.lineById(v2state, d.line), c, +d.beats); v2commit(); } },
        setLenSel(d) { const l = M.lineById(v2state, d.line); pushUndo(); selChords(l).forEach((c) => { c.beats = clampBeats(l, c, +d.beats); }); v2commit(); },
        nudgeLen(d) { const c = chordOf(d); if (c) { pushUndo(); c.beats = clampBeats(M.lineById(v2state, d.line), c, Math.max(0.5, Math.round((c.beats + +d.d) * 2) / 2)); v2commit(); } },
        nudgeStart(d) { const c = chordOf(d); if (!c) return; pushUndo(); const l = M.lineById(v2state, d.line); const ns = Math.max(0, Math.round(((c.start || 0) + +d.d) * 2) / 2); if (!overlapsOthers(l, c, ns, c.beats)) c.start = ns; v2commit(); },
        setAccent(d) { const c = chordOf(d); if (c) { pushUndo(); c.accent = d.acc; v2commit(); } },
        dupChord(d) { const l = M.lineById(v2state, d.line); const i = l.chords.findIndex((x) => x.id === d.cid); if (i < 0) return; pushUndo(); const src = l.chords[i]; const copy = cloneChord(src, { id: M.uid('c') }); copy.start = (src.start || 0) + src.beats; if (overlapsOthers(l, copy, copy.start, copy.beats)) copy.start = l.chords.reduce((m, c) => Math.max(m, (c.start || 0) + c.beats), 0); l.chords.splice(i + 1, 0, copy); selOne(d.line, copy.id); v2commit(); },
        dupSel(d) { const l = M.lineById(v2state, d.line); const idx = selIdx(l); if (!idx.length) return; pushUndo(); const sel = idx.map((i) => l.chords[i]); const minS = Math.min(...sel.map((c) => c.start || 0)); const maxE = Math.max(...sel.map((c) => (c.start || 0) + c.beats)); let copies = sel.map((c) => cloneChord(c, { id: M.uid('c'), start: (c.start || 0) + (maxE - minS) })); if (copies.some((cp) => overlapsOthers(l, cp, cp.start, cp.beats))) { const base = l.chords.reduce((m, c) => Math.max(m, (c.start || 0) + c.beats), 0); copies = sel.map((c) => cloneChord(c, { id: M.uid('c'), start: base + ((c.start || 0) - minS) })); } l.chords.splice(idx[idx.length - 1] + 1, 0, ...copies); v2state.selection = { lineId: d.line, ids: copies.map((c) => c.id) }; v2commit(); },
        copySel(d) { const l = M.lineById(v2state, d.line); v2state.clipboard = selIdx(l).map((i) => JSON.parse(JSON.stringify(l.chords[i]))); toast(`Copied ${v2state.clipboard.length} chord${v2state.clipboard.length > 1 ? 's' : ''} — paste into any section`); v2commit(); },
        pasteInto(d) { const l = M.lineById(v2state, d.line); if (!v2state.clipboard.length) return; pushUndo(); const appendAt = l.chords.reduce((m, c) => Math.max(m, (c.start || 0) + c.beats), 0); const minClip = Math.min(...v2state.clipboard.map((c) => c.start || 0)); const copies = v2state.clipboard.map((c) => cloneChord(c, { id: M.uid('c'), start: appendAt + ((c.start || 0) - minClip) })); l.chords.push(...copies); v2state.currentLine = d.line; v2state.selection = { lineId: d.line, ids: copies.map((c) => c.id) }; v2commit(); },
        blankSel(d) { const l = M.lineById(v2state, d.line); if (!l) { v2state.selection = { lineId: null, ids: [] }; v2commit(); return; } pushUndo(); const ids = v2state.selection.ids; l.chords = l.chords.filter((x) => ids.indexOf(x.id) < 0); v2state.selection = { lineId: null, ids: [] }; v2commit(); },
        removeChord(d) { const l = M.lineById(v2state, d.line); if (!l) return; pushUndo(); l.chords = l.chords.filter((x) => x.id !== d.cid); v2state.selection = { lineId: null, ids: [] }; v2commit(); },
        removeSel(d) { const l = M.lineById(v2state, d.line); if (!l) { v2state.selection = { lineId: null, ids: [] }; v2commit(); return; } pushUndo(); const ids = v2state.selection.ids; l.chords = l.chords.filter((x) => ids.indexOf(x.id) < 0); v2state.selection = { lineId: null, ids: [] }; v2commit(); },
        setMode(d) { const l = M.lineById(v2state, d.line); l.mode = d.mode; if (d.mode === 'stacked') { l.tabOpen = false; l.melodyOpen = false; } v2state.currentLine = d.line; v2commit(); },
        toggleTab(d) { const l = M.lineById(v2state, d.line); l.tabOpen = !l.tabOpen; if (l.tabOpen) l.mode = 'timeline'; if (!l.tabOpen && !l.melodyOpen) l.mode = 'stacked'; v2state.currentLine = d.line; v2commit(); },
        toggleMelody(d) { const l = M.lineById(v2state, d.line); l.melodyOpen = !l.melodyOpen; if (l.melodyOpen) l.mode = 'timeline'; if (!l.tabOpen && !l.melodyOpen) l.mode = 'stacked'; v2state.currentLine = d.line; v2commit(); },
        addChord(d) { const line = M.lineById(v2state, v2state.currentLine); if (!line) return; pushUndo(); const start = line.chords.reduce((m, c) => Math.max(m, (c.start || 0) + c.beats), 0); const c = M.chord(d.name, d.roman, M.bpb(line), d.cat || M.catFor(d.roman)); c.start = start; line.chords.push(c); selOne(line.id, c.id); v2commit(); },
        addBar(d) { const l = M.lineById(v2state, d.line); pushUndo(); l.minBars = M.nbarsOf(l) + 1; v2state.currentLine = l.id; v2commit(); },
        zoomIn(d) { const l = M.lineById(v2state, d.line); l.zoom = Math.min(5, (l.zoom || 1) + 0.5); v2commit(); },
        zoomOut(d) { const l = M.lineById(v2state, d.line); l.zoom = Math.max(1, (l.zoom || 1) - 0.5); v2commit(); },
        playLine(d) { v2state.currentLine = d.line; v2commit(); v2Play(); },
        renameLine(d) { v2state.renamingLine = d.line; v2SoftRender(); setTimeout(() => { const i = document.querySelector('#uzv2Builder .lh-name-input'); if (i) { i.focus(); i.select(); } }, 0); },
        panLeft(d) { const el = document.querySelector(`#uzv2Builder .tl-scroll[data-scroll="${d.line}"]`); if (el) el.scrollBy({ left: -el.clientWidth * 0.6, behavior: 'smooth' }); },
        panRight(d) { const el = document.querySelector(`#uzv2Builder .tl-scroll[data-scroll="${d.line}"]`); if (el) el.scrollBy({ left: el.clientWidth * 0.6, behavior: 'smooth' }); },
        addLine() { const b = document.querySelector('.add-line-btn'); if (b) b.click(); }, // production owns add-line
        removeLine(d) { if (v2state.lines.length <= 1) return; pushUndo(); v2state.lines = v2state.lines.filter((l) => l.id !== d.line); if (v2state.currentLine === d.line) v2state.currentLine = v2state.lines[0].id; if (v2state.selection && v2state.selection.lineId === d.line) v2state.selection = { lineId: null, ids: [] }; v2commit(); },
        setMajor() { v2state.minor = false; v2commit(); },
        setMinor() { v2state.minor = true; v2commit(); },
        palDegrees() { v2state.palLabel = 'degrees'; v2commit(); },
        palNotes() { v2state.palLabel = 'notes'; v2commit(); },
        toggleMute() { v2state.muted = !v2state.muted; v2SoftRender(); },
        togglePlay() { v2Play(); },
        playSection(d) { v2state.currentLine = d.line; v2commit(); v2Play(); },
        toggleLoopSong() { v2state.loopSong = !v2state.loopSong; v2commit(); },
        copyShare() { const b = document.querySelector('[data-action="copyShareLink"], [data-action="shareProgression"]'); if (b) b.click(); else toast('Share link copies in the next step'); },
        // R1-1 (Option A): the ♦ opens the production ADVANCED overlay (#chordShapeOverlay — fretboard,
        // chord-detection, type-a-shape, mismatch badge), not the inline editor. Flush v2 → production
        // first so the chord + its shape are live there, then map the v2 chord (id) to its production
        // (lineIdx, chordIdx). Save writes production + renderProgression → re-seed shows the new shape.
        editChordShape(d) {
            const c = chordOf(d); if (!c) return;
            selOne(d.line, d.cid); v2commit();
            const li = (state.progressionLines || []).findIndex((l) => l.id === d.line);
            const lineIdx = li >= 0 ? li : 0;
            const pl = state.progressionLines[lineIdx];
            const ci = pl ? pl.chords.findIndex((x) => x.id === d.cid) : -1;
            if (ci < 0) return;
            try { showChordShapeEditor(lineIdx, ci); } catch (e) { console.warn('[v2] open shape overlay', e); }
        },
        shapeFret(d) { const c = chordOf(d); if (!c) return; pushUndo(); const sh = ensureShape(c); const s = +d.string; const cur = sh.frets[s]; let nf; if (cur == null) nf = (+d.dir > 0 ? 0 : null); else { nf = cur + (+d.dir); if (nf < 0) nf = null; else nf = Math.min(nf, M.MAX_FRET || 24); } sh.frets[s] = nf; v2commit(); },
        shapeMute(d) { const c = chordOf(d); if (!c) return; pushUndo(); ensureShape(c).frets[+d.string] = null; v2commit(); },
        shapeAuto(d) { const c = chordOf(d); if (!c) return; pushUndo(); c.shape = M.defaultShape(c.name) || { frets: [null, null, null, null, null, null], baseFret: 0 }; v2commit(); },
        reset() {}, // disabled in production (no destructive demo reset)
        resizeStart() {}, // pointerdown drag logic reads the data-action attr; handler is a no-op
    };

    // melody + tab lane action handlers and pointer interactions (installed once)
    try { if (window.MELODY && window.MELODY.install) window.MELODY.install(V2A, getV2, v2commit, pushUndo, toast); } catch (e) { console.warn('[v2] MELODY.install', e); }
    try { if (window.TAB && window.TAB.install) window.TAB.install(V2A, getV2, v2commit, pushUndo, toast); } catch (e) { console.warn('[v2] TAB.install', e); }
    try { if (window.MELODY && window.MELODY.installPointer) window.MELODY.installPointer(getV2, v2commit, pushUndo, previewMel); } catch (e) { console.warn('[v2] MELODY.installPointer', e); }
    try { if (window.TAB && window.TAB.installPointer) window.TAB.installPointer(getV2, v2commit, pushUndo); } catch (e) { console.warn('[v2] TAB.installPointer', e); }

    // ── delegated click / change (capture-phase, scoped, stopPropagation) ──
    let cdrag = null, chordDragged = false, dragLine = null;
    document.addEventListener('click', (e) => {
        if (!inB(e)) return;
        v2KickAudio(); // unlock WebAudio on the first builder gesture (we stopPropagation, so production's body handler won't)
        const el = e.target.closest('[data-action]'); if (!el || !el.closest('#uzv2Builder')) return;
        e.preventDefault(); e.stopPropagation();
        if (el.dataset.action === 'selectChord' && chordDragged) { chordDragged = false; return; }
        const fn = V2A[el.dataset.action];
        if (fn) fn(el.dataset, e);
    }, true);
    document.addEventListener('change', (e) => {
        if (!inB(e)) return;
        const el = e.target.closest('[data-change]'); if (!el) return;
        e.stopPropagation();
        if (el.dataset.change === 'setMeter') { const l = M.lineById(v2state, el.dataset.line); if (l) { pushUndo(); const oldBp = M.bpb(l); const res = l.melRes || 8; const bps = 4 / res; const nb = +el.value; (l.notes || []).forEach((n) => { const beat = n.bar * oldBp + n.slot * bps; n.bar = Math.floor(beat / nb + 1e-9); n.slot = Math.round((beat - n.bar * nb) / bps); }); l.bpb = nb; v2commit(); } return; }
        if (el.dataset.change === 'setArticSel') { const l = M.lineById(v2state, el.dataset.line); const n = l && l.notes.find((x) => x.id === el.dataset.nid); if (n) { pushUndo(); n.artic = el.value; v2commit(); } return; }
    }, true);

    // ── delete / rename keyboard ──
    document.addEventListener('keydown', (e) => {
        if (e.target.closest && e.target.closest('input, select, textarea')) return;
        const hasMelSel = v2state && v2state.melSel && v2state.melSel.ids && v2state.melSel.ids.length;
        if (!(v2state && (v2state.selNote || hasMelSel || (v2state.selection && v2state.selection.ids.length)))) return;
        if (e.key === 'Backspace' || e.key === 'Delete') {
            if (hasMelSel) { e.preventDefault(); e.stopPropagation(); const l = M.lineById(v2state, v2state.melSel.lineId); if (l) { const ids = v2state.melSel.ids.filter((id) => l.notes.some((n) => n.id === id)); if (ids.length) { pushUndo(); l.notes = l.notes.filter((n) => ids.indexOf(n.id) < 0); } } v2state.melSel = null; v2state.selNote = null; v2commit(); } // R1-6/R1-7 bulk delete (stale ids dropped)
            else if (v2state.selNote) { e.preventDefault(); e.stopPropagation(); const l = M.lineById(v2state, v2state.selNote.lineId); if (l) { pushUndo(); l.notes = l.notes.filter((n) => n.id !== v2state.selNote.noteId); v2state.selNote = null; v2commit(); } }
            else if (v2state.selection.ids.length && v2state.selection.lineId) { e.preventDefault(); e.stopPropagation(); V2A.removeSel({ line: v2state.selection.lineId }); }
        }
    }, true);
    function commitRename(i) { const l = M.lineById(v2state, i.dataset.rename); if (l) { const v = i.value.trim(); if (v) { pushUndo(); l.name = v; } } v2state.renamingLine = null; v2commit(); }
    document.addEventListener('keydown', (e) => { const i = e.target.closest && e.target.closest('#uzv2Builder .lh-name-input'); if (!i) return; if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitRename(i); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); v2state.renamingLine = null; v2SoftRender(); } }, true);
    document.addEventListener('focusout', (e) => { const i = e.target.closest && e.target.closest('#uzv2Builder .lh-name-input'); if (i && v2state && v2state.renamingLine) commitRename(i); }, true);

    // ── A5: adopt the production toolbar "Select" button (#uzSelectToggle, injected by
    // uz-deferred-patches) for the v2 builder's tap-to-multiselect mode. Capture-phase +
    // stopPropagation blocks the deferred-patches handler (which targets the removed
    // .progression-chord markup and would otherwise toggle a dead body.uz-select-mode).
    document.addEventListener('click', (e) => {
        const st = e.target.closest && e.target.closest('#uzSelectToggle');
        if (!st || !v2state) return;
        e.preventDefault(); e.stopPropagation(); v2KickAudio();
        v2state.selectMode = !v2state.selectMode;
        st.classList.toggle('active', v2state.selectMode);
        st.setAttribute('aria-pressed', v2state.selectMode ? 'true' : 'false');
        v2commit();
    }, true);

    // ── shared-ruler scroll memory ──
    document.addEventListener('scroll', (e) => { const el = e.target.closest ? e.target.closest('#uzv2Builder .tl-scroll') : null; if (el && el.dataset.scroll) { const l = M.lineById(v2state, el.dataset.scroll); if (l) l.scroll = el.scrollLeft; } }, true);

    // ── line reorder (drag the ⠿ grip) ──
    document.addEventListener('dragstart', (e) => { if (!inB(e)) return; const g = e.target.closest('.lh-grip'); if (!g) return; dragLine = g.dataset.grip; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragLine); } catch (x) {} });
    document.addEventListener('dragover', (e) => { if (dragLine && inB(e) && e.target.closest('.linecard')) e.preventDefault(); });
    document.addEventListener('drop', (e) => { if (!dragLine || !inB(e)) { dragLine = null; return; } const card = e.target.closest('.linecard'); if (card) { e.preventDefault(); const targetId = card.dataset.line; if (targetId && targetId !== dragLine) { const from = v2state.lines.findIndex((l) => l.id === dragLine); const to = v2state.lines.findIndex((l) => l.id === targetId); if (from >= 0 && to >= 0) { pushUndo(); const [m] = v2state.lines.splice(from, 1); v2state.lines.splice(to, 0, m); v2commit(); } } } dragLine = null; });
    document.addEventListener('dragend', () => { dragLine = null; });

    // ── chord move / resize drag (free-floating on the ½-beat grid) ──
    document.addEventListener('pointerdown', (e) => {
        if (!inB(e)) return;
        const chipEl = e.target.closest('.chip'); if (!chipEl || chipEl.classList.contains('blank')) return;
        if (e.target.closest('.chord-shape-btn, .shapedot, .durbadge')) return;
        const posEl = chipEl.closest('.chip-pos'); const host = chipEl.closest('.chords-abs, .chips-abs'); if (!posEl || !host) return;
        const line = M.lineById(v2state, chipEl.dataset.line); const c = line && line.chords.find((x) => x.id === chipEl.dataset.cid); if (!c) return;
        const resizeLeft = !!e.target.closest('[data-action="resizeStartLeft"]');
        const resizeRight = !resizeLeft && !!e.target.closest('[data-action="resizeStart"]');
        cdrag = { lineId: chipEl.dataset.line, cid: chipEl.dataset.cid, line, resizeLeft, resizeRight, posEl, x0: e.clientX, beatPx: host.getBoundingClientRect().width / M.axisBeats(line), start0: c.start || 0, beats0: c.beats, end0: (c.start || 0) + c.beats, moved: false, pending: null };
    });
    document.addEventListener('pointermove', (e) => {
        if (!cdrag) return;
        if (Math.abs(e.clientX - cdrag.x0) > 3) cdrag.moved = true;
        if (!cdrag.moved) return;
        const db = (e.clientX - cdrag.x0) / cdrag.beatPx; const axis = M.axisBeats(cdrag.line);
        if (cdrag.resizeLeft) {                                  // drag the START, keep the END fixed
            const ns = Math.min(cdrag.end0 - 0.5, Math.max(0, snap05(cdrag.start0 + db)));
            const beats = cdrag.end0 - ns;
            cdrag.pending = { start: ns, beats: beats };
            cdrag.posEl.style.left = (ns / axis * 100) + '%';
            cdrag.posEl.style.width = (beats / axis * 100) + '%';
        } else if (cdrag.resizeRight) {                          // drag the END (length), start fixed
            const len = Math.max(0.5, snap05(cdrag.beats0 + db)); cdrag.pending = { beats: len }; cdrag.posEl.style.width = (len / axis * 100) + '%';
        } else {                                                 // body drag = move
            const st = Math.max(0, snap05(cdrag.start0 + db)); cdrag.pending = { start: st }; cdrag.posEl.style.left = (st / axis * 100) + '%';
        }
    });
    document.addEventListener('pointerup', () => {
        if (!cdrag) return;
        // re-resolve the chord/line by id from the LIVE v2state (a re-seed mid-drag would have
        // replaced the objects captured at pointerdown — apply to the current ones, or bail).
        const line = M.lineById(v2state, cdrag.lineId); const c = line && line.chords.find((x) => x.id === cdrag.cid);
        if (cdrag.moved && cdrag.pending && c && line) {
            pushUndo();
            if (cdrag.resizeLeft) {                              // commit start+beats, clamp start to the previous chord
                const ns = Math.min(cdrag.end0 - 0.5, Math.max(leftBoundOf(line, c), cdrag.pending.start));
                c.start = ns; c.beats = cdrag.end0 - ns;
            } else if (cdrag.resizeRight) {
                c.beats = clampBeats(line, c, cdrag.pending.beats);
            } else if (!overlapsOthers(line, c, cdrag.pending.start, c.beats)) {
                c.start = cdrag.pending.start;                   // free slot → plain move
            } else {
                rippleInsert(line, c, cdrag.pending.start);      // occupied → push the rest right (R1-2)
            }
            chordDragged = true; v2commit();
        }
        cdrag = null;
    });
}

function renderProgression() {
    const area = document.getElementById('progressionArea');
    const hasChords = state.progressionLines.some(line => line.chords.length > 0);

    // Header row: a small "Title:" label sits tight above the song-name
    // input on the left; the Loop button + status info sit on the right.
    // Title + input are stacked vertically and close together so the song
    // name has the full available width and never truncates.
    let html = `
    <div class="progression-header-row">
        <div class="progression-title-stack">
            <span class="progression-title">Title:</span>
            <input type="text" class="song-name-input" id="songNameInput"
                value="${(state.songName || '').replace(/"/g, '&quot;')}"
                placeholder="Untitled Song"
                spellcheck="false"
                data-action="songNameInput">
        </div>
        <div class="progression-loop-stack">
            <button class="looper-play-btn ${state.looperPlaying ? 'playing' : ''}" data-action="toggleLooper" ${!hasChords ? 'disabled' : ''}>
                ${state.looperPlaying ? '■ Stop' : '▶ Loop'}
            </button>
            <button class="looper-quickinfo" data-action="openPlaybackPanel" title="Playback settings — style, tempo, tracks">🎶 ${state.looperBpm} BPM &middot; ${state.looperStyle} ${state.looperStyleVariant === 2 ? 'V2' : 'V1'} ▾</button>
        </div>
    </div>`;

    // Build key reference from user-selected key for chord classification
    // The selected key button is always a major key root; determine if minor via tab
    const selectedKeyRef = { key: state.selectedKey, type: state.selectedTab === 'dark' ? 'minor' : 'major' };

    // Auto-detect key from chords and show suggestion if it differs
    const detectedKey = hasChords ? detectOverallKey() : null;

    // Build suggestion text if detected key differs from selected
    let keySuggestionHtml = '';
    if (detectedKey) {
        const formatKeyName = (k) => displayChordForKey(k.key + (k.type === 'minor' ? 'm' : ''), state.selectedKey);
        const detectedLabel = formatKeyName(detectedKey.best);
        const selectedLabel = displayChordForKey(state.selectedKey + (state.selectedTab === 'dark' ? 'm' : ''), state.selectedKey);
        if (detectedLabel !== selectedLabel) {
            keySuggestionHtml = `<span class="key-suggestion">Detected: <strong>${detectedLabel}</strong></span>`;
        }
    }

    html += `<div class="overall-key-badge">
        <span class="overall-key-label">Highlighting chords for:</span>
        <span class="overall-key-value">${displayChordForKey(state.selectedKey + (state.selectedTab === 'dark' ? 'm' : ''), state.selectedKey)}</span>
        ${keySuggestionHtml}
        <div class="chord-highlight-help">
            <button class="chord-highlight-help-btn" data-action="toggleHighlightHelp" title="Chord highlighting guide">?</button>
            <div class="chord-highlight-tooltip" id="chordHighlightTooltip">
                <div class="hl-legend-title">Chord Highlighting Guide</div>
                <div class="hl-legend-item"><div class="hl-swatch swatch-diatonic"></div><span><strong>Diatonic</strong> — in key</span></div>
                <div class="hl-legend-item"><div class="hl-swatch swatch-borrowed"></div><span><strong>Borrowed</strong> — modal interchange / parallel minor</span></div>
                <div class="hl-legend-item"><div class="hl-swatch swatch-lydian"></div><span><strong>Lydian</strong> — bright, raised 4th</span></div>
                <div class="hl-legend-item"><div class="hl-swatch swatch-mixolydian"></div><span><strong>Mixolydian</strong> — relaxed, lowered 7th</span></div>
                <div class="hl-legend-item"><div class="hl-swatch swatch-phrygian"></div><span><strong>Phrygian</strong> — dark, lowered 2nd</span></div>
                <div class="hl-legend-item"><div class="hl-swatch swatch-domtriad"></div><span><strong>Dominant triad</strong> — sec. dom. without the 7th</span></div>
                <div class="hl-legend-item"><div class="hl-swatch swatch-secdom"></div><span><strong>Secondary dom.</strong> — resolves to a diatonic chord</span></div>
                <div class="hl-legend-item"><div class="hl-swatch swatch-outside"></div><span><strong>Outside key</strong> — not in any pool</span></div>
            </div>
        </div>
    </div>`;

    // Progression lines — Strategy A: the v2 unified builder (Chords/Tab/Melody lanes) replaces the
    // old chord row, the melody sketcher, and the per-line tab editor (renderTabSection). The builder is
    // re-seeded from `state` inside renderV2BuilderHTML(); the site palette / key / Bright-Shadow keep
    // driving it through the existing production handlers. (In-lane v2 edits: interaction controller, A1b-ii.)
    html += renderV2BuilderHTML();

    // Add line button — lives OUTSIDE #uzv2Builder so the existing production addLine handler keeps working.
    html += `<button class="add-line-btn" data-action="addLine">+ Add Line</button>`;

    // Hidden file input for opening files
    html += `<input type="file" id="fileInput" accept=".txt,.json" style="display:none">`;

    area.innerHTML = html;

    // Strategy A: the v2 melody lane replaces the standalone melody sketcher — tear it down so it can't
    // double-render or steal pointer events. (Its boot-time Melody.render() is also skipped.)
    const ms = document.getElementById('melodySketcherContainer');
    if (ms) { ms.innerHTML = ''; ms.style.display = 'none'; }

    // Wire the v2 builder interaction controller (idempotent — installs once).
    installV2Controller();
    v2ApplyMismatchBadges();

    // Mirror the rich playback / file controls into their popup bodies so
    // they stay in sync with state. The popup containers (#playbackBody and
    // #fileBody) live in index.html as siblings of the main app.
    const pbBody = document.getElementById('playbackBody');
    if (pbBody) pbBody.innerHTML = renderPlaybackPopupBody();
    const filBody = document.getElementById('fileBody');
    if (filBody) filBody.innerHTML = renderFilePopupBody();

    // Song name input handler
    const songNameEl = document.getElementById('songNameInput');
    if (songNameEl) {
        songNameEl.addEventListener('input', (e) => {
            state.songName = e.target.value;
            saveStateToLocalStorage();
        });
    }

    // Setup drag and drop handlers
    setupDragAndDrop();
}

// Build the playback popup body — Loop button + style/variant/BPM/instruments.
// State-driven: rebuilt on every renderProgression() to reflect current state.
function renderPlaybackPopupBody() {
    const hasChords = state.progressionLines.some(line => line.chords.length > 0);
    return `
        <div class="pb-row">
            <button class="looper-play-btn ${state.looperPlaying ? 'playing' : ''}" data-action="toggleLooper" ${!hasChords ? 'disabled' : ''}>
                ${state.looperPlaying ? '■ Stop' : '▶ Loop'}
            </button>
        </div>
        <div class="pb-row pb-row-label">Style</div>
        <div class="pb-row looper-style">
            <button class="style-btn ${state.looperStyle === 'ballad' ? 'active' : ''}" data-action="setLooperStyle" data-style="ballad">Ballad</button>
            <button class="style-btn ${state.looperStyle === 'pop' ? 'active' : ''}" data-action="setLooperStyle" data-style="pop">Pop</button>
            <button class="style-btn ${state.looperStyle === 'jazz' ? 'active' : ''}" data-action="setLooperStyle" data-style="jazz">Jazz</button>
            <button class="style-btn ${state.looperStyle === 'rock' ? 'active' : ''}" data-action="setLooperStyle" data-style="rock">Rock</button>
            <button class="style-btn ${state.looperStyle === 'rnb' ? 'active' : ''}" data-action="setLooperStyle" data-style="rnb">R&amp;B</button>
            <button class="style-btn ${state.looperStyle === 'folk' ? 'active' : ''}" data-action="setLooperStyle" data-style="folk">Folk</button>
        </div>
        <div class="pb-row pb-row-label">Variant</div>
        <div class="pb-row looper-variant">
            <button class="variant-btn ${state.looperStyleVariant === 1 ? 'active' : ''}" data-action="setLooperVariant" data-variant="1">V1</button>
            <button class="variant-btn ${state.looperStyleVariant === 2 ? 'active' : ''}" data-action="setLooperVariant" data-variant="2">V2</button>
        </div>
        <div class="pb-row pb-row-label">Tempo</div>
        <div class="pb-row looper-bpm">
            <button class="bpm-btn" data-action="adjustBpm" data-delta="-5">−</button>
            <span class="bpm-display">${state.looperBpm} BPM</span>
            <button class="bpm-btn" data-action="adjustBpm" data-delta="5">+</button>
        </div>
        <div class="pb-row pb-row-label">Tracks</div>
        <div class="pb-row looper-tracks">
            <button class="track-btn ${state.looperKeys ? 'active' : ''}" data-action="toggleLooperKeys" title="Keys">🎹 Keys</button>
            <button class="track-btn ${state.looperBass ? 'active' : ''}" data-action="toggleLooperBass" title="Bass">🎸 Bass</button>
            <button class="track-btn ${state.looperDrums ? 'active' : ''}" data-action="toggleLooperDrums" title="Drums">🥁 Drums</button>
        </div>
    `;
}

// Build the file popup body — Undo/Redo/Save/Open/PDF/Clear.
function renderFilePopupBody() {
    return `
        <div class="file-body-row">
            <button class="file-btn undo-btn ${undoStack.length === 0 ? 'disabled' : ''}" data-action="undo" title="Undo (Ctrl+Z)">↩ Undo</button>
            <button class="file-btn redo-btn ${redoStack.length === 0 ? 'disabled' : ''}" data-action="redo" title="Redo (Ctrl+Shift+Z)">↪ Redo</button>
        </div>
        <div class="file-body-row">
            <button class="file-btn" data-action="saveProgression" title="Save">💾 Save</button>
            <button class="file-btn" data-action="openProgression" title="Open">📂 Open</button>
            <button class="file-btn" data-action="exportPdf" title="Export PDF">📄 PDF</button>
        </div>
        <div class="file-body-row">
            <button class="file-btn" data-action="openMidiExport" title="Export as MIDI file">🎵 MIDI</button>
            <button class="file-btn" data-action="copyShareLink" title="Copy a link to this progression">🔗 Share link</button>
        </div>
        <div class="file-body-row">
            <button class="file-btn clear-btn" data-action="clearProgression" title="Clear">🗑️ Clear progression</button>
        </div>
    `;
}

// ========== MIDI EXPORT ==========
// Build a Standard MIDI File (SMF) as a Uint8Array from the current
// progression. v1 scope: one bar per chord at user-selected tempo, root + 3rd +
// 5th (+ 7th if present) voicing in octave 4, GM piano (program 0), optional
// click track. No external library — we write the SMF bytes ourselves.
const MIDI_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const MIDI_FLAT_MAP = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };
// Mirror of the in-file CHORD_INTERVALS_MAP — root-relative semitones for each
// chord quality the builder can produce. Kept in sync deliberately.
const MIDI_CHORD_INTERVALS = Data.CHORD_FORMULAS;

function midiParseChord(chordName) {
    if (!chordName) return null;
    const m = chordName.match(/^([A-G][#b]?)(.*)$/);
    if (!m) return null;
    const rawRoot = m[1];
    const quality = m[2] || '';
    const root = MIDI_FLAT_MAP[rawRoot] || rawRoot;
    const rootPc = MIDI_NOTE_NAMES.indexOf(root);
    if (rootPc < 0) return null;
    const intervals = MIDI_CHORD_INTERVALS[quality] || MIDI_CHORD_INTERVALS[''];
    // Voicing: octave 4 starting at MIDI 60 = C4
    const notes = intervals.map(iv => 60 + rootPc + iv);
    return { root, quality, notes };
}

// Encode an unsigned int as a MIDI variable-length quantity (7-bit per byte,
// MSB set on all but the last). Used for delta times and meta-event lengths.
function midiVarLen(value) {
    const bytes = [];
    let v = value & 0x0FFFFFFF;
    bytes.push(v & 0x7F);
    v >>= 7;
    while (v > 0) {
        bytes.push((v & 0x7F) | 0x80);
        v >>= 7;
    }
    return bytes.reverse();
}

function midiPushU32(arr, v) {
    arr.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF);
}
function midiPushU16(arr, v) {
    arr.push((v >>> 8) & 0xFF, v & 0xFF);
}
function midiPushStr(arr, s) {
    for (let i = 0; i < s.length; i++) arr.push(s.charCodeAt(i) & 0xFF);
}

// Build a MIDI track chunk body (bytes between "MTrk" length and end-of-track).
function midiBuildChordTrack(events, ppq, beatsPerChord) {
    // events is the chord list already flattened across all progression lines
    // (taking repeats into account).
    const body = [];
    // Track name meta
    const name = 'Chords';
    body.push(...midiVarLen(0), 0xFF, 0x03, name.length);
    midiPushStr(body, name);
    // Program change to acoustic grand piano (program 0) on channel 0
    body.push(...midiVarLen(0), 0xC0, 0x00);
    const velocity = 80;
    events.forEach((ev) => {
        const evBeats = (ev && typeof ev === 'object') ? (ev.beats || beatsPerChord) : beatsPerChord;
        const ticksPerBar = ppq * evBeats;
        const chord = (ev && typeof ev === 'object') ? ev.chord : ev;
        const parsed = midiParseChord(chord);
        if (!parsed) {
            // Unparseable chord — still consume the bar with silence
            return;
        }
        // Note-on for all notes at delta 0 (subsequent at delta 0 too)
        parsed.notes.forEach((n, i) => {
            body.push(...midiVarLen(0), 0x90, n & 0x7F, velocity);
        });
        // Hold for the bar, then note-off: first off at ticksPerBar, rest at 0
        parsed.notes.forEach((n, i) => {
            const delta = (i === 0) ? ticksPerBar : 0;
            body.push(...midiVarLen(delta), 0x80, n & 0x7F, 0x40);
        });
    });
    // End of track
    body.push(...midiVarLen(0), 0xFF, 0x2F, 0x00);
    return body;
}

function midiBuildClickTrack(numBars, beatsPerBar, ppq) {
    const body = [];
    const name = 'Click';
    body.push(...midiVarLen(0), 0xFF, 0x03, name.length);
    midiPushStr(body, name);
    // Program change to woodblock-ish (use channel 9 / index 9 == MIDI ch10 for drums)
    // Simpler: use channel 0 with a high pitch click. Keep on ch 0 so DAWs handle it.
    body.push(...midiVarLen(0), 0xC0, 0x00);
    const clickNote = 76; // High woodblock-ish pitch
    let firstEvent = true;
    for (let bar = 0; bar < numBars; bar++) {
        for (let beat = 0; beat < beatsPerBar; beat++) {
            const isDownbeat = (beat === 0);
            const vel = isDownbeat ? 100 : 60;
            const note = isDownbeat ? (clickNote + 4) : clickNote;
            // Note-on at delta 0 (first event also at 0)
            body.push(...midiVarLen(0), 0x90, note, vel);
            // Note-off after a short duration (1/8 of a beat)
            const dur = Math.max(1, Math.floor(ppq / 8));
            body.push(...midiVarLen(dur), 0x80, note, 0x40);
            // Wait the remainder of the beat before next note (next note-on uses that delta)
            // To do that we tack an inert "pad" via the next note-on's delta:
            // we accomplish this by adjusting via inserting a 0-byte text event? Simpler:
            // use a Meta marker that consumes time. Actually the cleanest approach is to
            // change the NEXT note-on's delta. We'll handle that by remembering the
            // remaining ticks and prepending them to the next event.
            // Re-do: emit a "delay" using a meta text event of length 0? That won't
            // advance time. The way MIDI works: time advances ONLY via deltas before
            // events. So we need to absorb the remaining time into the next event's
            // delta. Let's restructure: track pending delta.
            // (See restructured version below.)
        }
    }
    // The above attempt is sloppy. Restart with proper accumulator:
    body.length = 0;
    body.push(...midiVarLen(0), 0xFF, 0x03, name.length);
    midiPushStr(body, name);
    body.push(...midiVarLen(0), 0xC0, 0x00);
    let pendingDelta = 0;
    for (let bar = 0; bar < numBars; bar++) {
        for (let beat = 0; beat < beatsPerBar; beat++) {
            const isDownbeat = (beat === 0);
            const vel = isDownbeat ? 100 : 60;
            const note = isDownbeat ? (clickNote + 4) : clickNote;
            const dur = Math.max(1, Math.floor(ppq / 8));
            // Note-on at pendingDelta
            body.push(...midiVarLen(pendingDelta), 0x90, note, vel);
            // Note-off after dur
            body.push(...midiVarLen(dur), 0x80, note, 0x40);
            // Remaining time until next beat
            pendingDelta = ppq - dur;
        }
    }
    body.push(...midiVarLen(0), 0xFF, 0x2F, 0x00);
    return body;
}

function midiBuildTempoTrack(tempoBpm) {
    const body = [];
    const name = 'Tempo';
    body.push(...midiVarLen(0), 0xFF, 0x03, name.length);
    midiPushStr(body, name);
    // Tempo meta: FF 51 03 tt tt tt where tt tt tt = microseconds per quarter
    const mpq = Math.round(60000000 / tempoBpm);
    body.push(...midiVarLen(0), 0xFF, 0x51, 0x03,
        (mpq >>> 16) & 0xFF, (mpq >>> 8) & 0xFF, mpq & 0xFF);
    // Time signature 4/4 (FF 58 04 nn dd cc bb)
    body.push(...midiVarLen(0), 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);
    body.push(...midiVarLen(0), 0xFF, 0x2F, 0x00);
    return body;
}

// Build the melody track (channel 1, acoustic guitar) from the sketcher's
// per-line melodies, flattened across lines/repeats exactly like the chords.
function midiBuildMelodyTrack(ppq, beatsPerChord) {
    const m = state.melody;
    if (!m || !m.lines) return null;
    const flat = [];
    state.progressionLines.forEach((line, lineIdx) => {
        const reps = (typeof line.repeats === 'number' && line.repeats > 0 && line.repeats < 999) ? line.repeats : 1;
        for (let r = 0; r < reps; r++) {
            line.chords.forEach((c, chordIdx) => {
                if (c && c.chord && c.chord !== '?') flat.push({ lineIdx, chordIdx, beats: chordBeats(c) });
            });
        }
    });
    if (!flat.length) return null;
    const res = (m.resolution === 16) ? 16 : 8;
    const events = []; // {tick, on, pitch}
    let cumTicks = 0;
    flat.forEach((bar, i) => {
        const barTicks = ppq * (bar.beats || beatsPerChord);
        const slotTicks = barTicks / res;
        const barStart = cumTicks;
        cumTicks += barTicks;
        const notes = m.lines[bar.lineIdx] || [];
        notes.forEach(n => {
            if (n.bar !== bar.chordIdx) return;
            const pitch = Melody.midiPitch(n.d, n.o) & 0x7F;
            const start = barStart + Math.round(n.slot * slotTicks);
            const end = start + Math.max(1, Math.round(n.len * slotTicks)) - 1;
            events.push({ tick: start, on: true, pitch });
            events.push({ tick: end, on: false, pitch });
        });
    });
    if (!events.length) return null;
    events.sort((x, y) => x.tick - y.tick || (x.on === y.on ? 0 : (x.on ? 1 : -1)));
    const body = [];
    const name = 'Melody';
    body.push(...midiVarLen(0), 0xFF, 0x03, name.length);
    midiPushStr(body, name);
    body.push(...midiVarLen(0), 0xC1, 24); // program 25 (0-indexed 24): acoustic nylon guitar
    let cursor = 0;
    events.forEach(ev => {
        const delta = Math.max(0, ev.tick - cursor);
        cursor = ev.tick;
        body.push(...midiVarLen(delta), ev.on ? 0x91 : 0x81, ev.pitch, ev.on ? 80 : 0x40);
    });
    body.push(...midiVarLen(0), 0xFF, 0x2F, 0x00);
    return body;
}

function midiBuildSMF(chords, opts) {
    const ppq = 480;
    const tempo = opts.tempo || 120;
    const beatsPerChord = opts.beatsPerChord || 4;
    const includeClick = !!opts.includeClick;
    const tempoTrack = midiBuildTempoTrack(tempo);
    const chordTrack = midiBuildChordTrack(chords, ppq, beatsPerChord);
    const tracks = [tempoTrack, chordTrack];
    const melodyTrack = midiBuildMelodyTrack(ppq, beatsPerChord);
    if (melodyTrack) tracks.push(melodyTrack);
    if (includeClick) {
        // Click runs the full progression length, 4 beats per bar
        const totalBeats = chords.reduce((s, c) => s + ((c && typeof c === 'object') ? (c.beats || beatsPerChord) : beatsPerChord), 0);
        const clickTrack = midiBuildClickTrack(Math.ceil(totalBeats / 4), 4, ppq);
        tracks.push(clickTrack);
    }
    const header = [];
    midiPushStr(header, 'MThd');
    midiPushU32(header, 6);            // header length
    midiPushU16(header, 1);            // format type 1
    midiPushU16(header, tracks.length); // num tracks
    midiPushU16(header, ppq);          // ticks per quarter
    const out = [...header];
    tracks.forEach(t => {
        midiPushStr(out, 'MTrk');
        midiPushU32(out, t.length);
        out.push(...t);
    });
    return new Uint8Array(out);
}

// Flatten the progression into a list of chord strings, expanding repeats.
function midiFlattenProgression() {
    const flat = [];
    state.progressionLines.forEach(line => {
        const reps = (typeof line.repeats === 'number' && line.repeats > 0 && line.repeats < 999) ? line.repeats : 1;
        for (let r = 0; r < reps; r++) {
            line.chords.forEach(c => {
                if (c && c.chord && c.chord !== '?') flat.push({ chord: c.chord, beats: chordBeats(c) });
            });
        }
    });
    return flat;
}

function midiGetDefaultFilename() {
    const ts = Math.floor(Date.now() / 1000);
    const mode = state.selectedTab === 'dark' ? 'min' : 'maj';
    const key = (state.selectedKey || 'C').replace('#', 's').replace('b', 'f');
    return `undercoverzest-progression-${key}${mode}-${ts}`;
}

function showMidiExportDialog() {
    const existing = document.getElementById('midiExportOverlay');
    if (existing) existing.remove();
    const chords = midiFlattenProgression();
    const isEmpty = chords.length === 0;
    const defaultName = midiGetDefaultFilename();
    const overlay = document.createElement('div');
    overlay.id = 'midiExportOverlay';
    overlay.className = 'save-dialog-overlay';
    overlay.innerHTML = `
        <div class="save-dialog" role="dialog" aria-modal="true" aria-labelledby="midiDialogTitle" style="min-width:340px;max-width:420px;">
            <div class="save-dialog-title" id="midiDialogTitle">Export MIDI</div>
            ${isEmpty ? '<div class="save-dialog-hint" style="color:#c8a04a;margin-bottom:14px;">Add at least one chord to export.</div>' : ''}
            <label class="save-dialog-label" for="midiFilename">File name</label>
            <input type="text" class="save-dialog-input" id="midiFilename" value="${defaultName}" spellcheck="false">
            <div class="save-dialog-hint">.mid will be added automatically</div>
            <label class="save-dialog-label" for="midiTempo">Tempo (BPM)</label>
            <input type="number" class="save-dialog-input" id="midiTempo" value="120" min="60" max="240" step="1">
            <div class="save-dialog-hint">Range 60 to 240</div>
            <label class="save-dialog-label" for="midiBeats">Bar length per chord</label>
            <select class="save-dialog-input" id="midiBeats">
                <option value="2">2 beats</option>
                <option value="4" selected>4 beats</option>
                <option value="8">8 beats</option>
            </select>
            <div class="save-dialog-hint">Each chord lasts this many beats</div>
            <label class="save-dialog-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="midiClick" style="width:16px;height:16px;accent-color:#c8a04a;cursor:pointer;">
                <span>Include click track</span>
            </label>
            <div class="save-dialog-hint" style="margin-bottom:18px;">Adds a second track with a metronome click</div>
            <div class="save-dialog-buttons">
                <button class="save-dialog-cancel" id="midiDialogCancel">Cancel</button>
                <button class="save-dialog-confirm" id="midiDialogConfirm" ${isEmpty ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>Download MIDI</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    const filenameInput = document.getElementById('midiFilename');
    if (filenameInput && !isEmpty) {
        filenameInput.focus();
        filenameInput.select();
    }
    const doCancel = () => overlay.remove();
    const doDownload = () => {
        if (isEmpty) return;
        const tempoRaw = parseInt(document.getElementById('midiTempo').value, 10);
        const tempo = Math.min(240, Math.max(60, isNaN(tempoRaw) ? 120 : tempoRaw));
        const beatsRaw = parseInt(document.getElementById('midiBeats').value, 10);
        const beats = [2, 4, 8].includes(beatsRaw) ? beatsRaw : 4;
        const includeClick = document.getElementById('midiClick').checked;
        const filename = (filenameInput.value.trim() || defaultName).replace(/\.mid$/i, '');
        const bytes = midiBuildSMF(chords, { tempo, beatsPerChord: beats, includeClick });
        const blob = new Blob([bytes], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.mid`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        overlay.remove();
        const filePopup = document.getElementById('filePopup');
        if (filePopup) filePopup.classList.add('hidden');
    };
    document.getElementById('midiDialogCancel').addEventListener('click', doCancel);
    document.getElementById('midiDialogConfirm').addEventListener('click', doDownload);
    overlay.addEventListener('click', e => { if (e.target === overlay) doCancel(); });
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') { doCancel(); document.removeEventListener('keydown', escHandler); }
        else if (e.key === 'Enter' && !isEmpty && document.activeElement !== document.getElementById('midiBeats')) {
            doDownload(); document.removeEventListener('keydown', escHandler);
        }
    });
}

// Expose for the action handler + tests
window.uzShowMidiExport = showMidiExportDialog;
window.uzMidiBuildSMF = midiBuildSMF;
window.uzMidiFlatten = midiFlattenProgression;

// Show chord shape editor modal
function showChordShapeEditor(lineIdx, chordIdx) {
    const chord = state.progressionLines[lineIdx].chords[chordIdx];
    const chordName = chord.chord;

    // Initialize editor state
    state.shapeEditorOpen = true;
    state.shapeEditorLine = lineIdx;
    state.shapeEditorIdx = chordIdx;
    state.shapeEditorBaseFret = 0;
    state.shapeEditorSelectedChord = null;

    if (chord.shape) {
        state.shapeEditorFrets = [...chord.shape.frets];
        state.shapeEditorBaseFret = chord.shape.baseFret || 0;
    } else {
        state.shapeEditorFrets = [null, null, null, null, null, null];
    }

    renderChordShapeEditor(chordName);
}

// Chord shape validation — shows whether user-drawn shape matches the target chord
function buildChordValidation(chordName, frets, baseFret) {
    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const FLAT_MAP = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };
    const SHARP_TO_FLAT = { 'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb' };
    const CHORD_INTERVALS_MAP = Data.CHORD_FORMULAS;
    const intervalNames = { 0:'R', 1:'♭2', 2:'2', 3:'♭3', 4:'3', 5:'4', 6:'♭5', 7:'5', 8:'♭6', 9:'6', 10:'♭7', 11:'7' };

    // Use shared extraction function
    const { pitchClasses, notes: playedNotes } = Audio.extractNotesFromShape(frets);

    if (playedNotes.length === 0) {
        return '<div class="shape-validation"><span class="shape-val-empty">Place fingers on the fretboard to see chord analysis</span></div>';
    }
    if (playedNotes.length < 2) {
        return '';
    }

    // Always run detection to get best match + alternatives
    const detection = Audio.detectChordFromNotes(pitchClasses, playedNotes);
    if (!detection) return '';

    // Determine the "current" chord — either the named chord or the best detection
    const m = chordName.match(/^([A-G][#b]?)(.*)/);
    const isBlank = !m || chordName === '?';

    // Build expected pitch class set for the current chord name
    // (used for note colouring and match verdict)
    let expectedPCs = new Set();
    let rootIdx = 0;
    let useFlats = false;
    let currentChordDisplay = chordName;

    if (!isBlank) {
        // We have a named chord — build expected set from its intervals
        const rawRoot = m[1];
        const quality = m[2];
        const root = FLAT_MAP[rawRoot] || rawRoot;
        rootIdx = NOTE_NAMES.indexOf(root);
        useFlats = !!FLAT_MAP[rawRoot];
        const intervals = CHORD_INTERVALS_MAP[quality] || [0,4,7];
        expectedPCs = new Set(intervals.map(i => (rootIdx + i) % 12));
        currentChordDisplay = chordName;
    } else {
        // Blank entry — use the best detection as the current chord
        rootIdx = NOTE_NAMES.indexOf(FLAT_MAP[detection.root] || detection.root);
        useFlats = !!SHARP_TO_FLAT[detection.root];
        const intervals = CHORD_INTERVALS_MAP[detection.quality] || [0,4,7];
        expectedPCs = new Set(intervals.map(i => (rootIdx + i) % 12));
        currentChordDisplay = detection.isSlash ? detection.slashChord : detection.chord;
    }

    const displayNote = (sharpName) => useFlats && SHARP_TO_FLAT[sharpName] ? SHARP_TO_FLAT[sharpName] : sharpName;

    // Colour-code each played note against the current chord
    const noteDetails = playedNotes.map(n => {
        const interval = (n.noteIdx - rootIdx + 12) % 12;
        const inChord = expectedPCs.has(n.noteIdx);
        return `<span class="shape-val-note ${inChord ? 'in-chord' : 'out-chord'}" title="${intervalNames[interval]}">${displayNote(n.noteName)}<sub>${intervalNames[interval]}</sub></span>`;
    });

    // Count matches
    const playedPCSet = new Set(playedNotes.map(n => n.noteIdx));
    let matchCount = 0, extraCount = 0, missingNotes = [];
    playedPCSet.forEach(pc => { if (expectedPCs.has(pc)) matchCount++; else extraCount++; });
    expectedPCs.forEach(pc => { if (!playedPCSet.has(pc)) missingNotes.push(displayNote(NOTE_NAMES[pc])); });
    const totalExpected = expectedPCs.size;

    // Overall verdict
    let verdict, verdictClass;
    if (matchCount === totalExpected && extraCount === 0) {
        verdict = '✓ Perfect match';
        verdictClass = 'shape-val-perfect';
    } else if (matchCount === totalExpected && extraCount > 0) {
        verdict = '✓ All chord tones + extras';
        verdictClass = 'shape-val-good';
    } else if (matchCount > 0 && extraCount === 0) {
        verdict = `${matchCount}/${totalExpected} chord tones`;
        verdictClass = 'shape-val-partial';
    } else if (matchCount > 0) {
        verdict = `${matchCount}/${totalExpected} chord tones + ${extraCount} outside`;
        verdictClass = 'shape-val-partial';
    } else {
        verdict = '✗ No chord tones matched';
        verdictClass = 'shape-val-wrong';
    }

    // Build the header — show current chord as clickable pill with match badge
    const headerBadge = matchCount === totalExpected && extraCount === 0 ? '✓ Full'
        : matchCount === totalExpected ? '✓ Full+extras'
        : `${matchCount}/${totalExpected}`;
    const headerBadgeClass = matchCount === totalExpected && extraCount === 0 ? 'shape-val-perfect'
        : matchCount === totalExpected ? 'shape-val-good' : 'shape-val-partial';

    const headerLabel = isBlank ? 'Detected:' : 'Chord Check:';

    // Build alternatives (always include the best detection too if it differs from current)
    let allAlts = [];
    // If current chord differs from best detection, include best detection as an option
    if (detection.chord !== chordName && !isBlank) {
        allAlts.push({
            chord: detection.chord, root: detection.root, quality: detection.quality,
            isFullMatch: detection.isFullMatch, isFullWithExtras: detection.isFullWithExtras,
            matchedPlayed: detection.matchedPlayed, expectedSize: detection.expectedSize,
            extraPlayed: detection.extraPlayed
        });
    }
    // Add other alternatives that aren't the current chord
    detection.alternatives.forEach(a => {
        if (a.chord !== chordName) allAlts.push(a);
    });
    // Deduplicate
    const seen = new Set([chordName]);
    allAlts = allAlts.filter(a => { if (seen.has(a.chord)) return false; seen.add(a.chord); return true; });

    let altsHtml = '';
    if (allAlts.length > 0) {
        const altPills = allAlts.map(a => {
            const matchLabel = a.isFullMatch ? '✓' : a.isFullWithExtras ? '✓+' : `${a.matchedPlayed}/${a.expectedSize}`;
            const matchClass = a.isFullMatch ? 'alt-full' : a.isFullWithExtras ? 'alt-full-extras' : 'alt-partial';
            return `<button class="shape-alt-pill ${matchClass}" data-action="selectDetectedChord" data-chord="${a.chord}" data-quality="${a.quality}" data-root="${a.root}" title="${a.matchedPlayed}/${a.expectedSize} tones, ${a.extraPlayed} extra">${a.chord} <span class="alt-match-badge">${matchLabel}</span></button>`;
        }).join('');
        altsHtml = `<div class="shape-val-alts"><span class="shape-val-label">Alternatives:</span><div class="shape-alt-list">${altPills}</div></div>`;
    }

    return `
        <div class="shape-validation">
            <div class="shape-val-header">
                <span class="shape-val-label">${headerLabel}</span>
                <button class="shape-best-pill" data-action="selectDetectedChord" data-chord="${isBlank ? detection.chord : chordName}" data-quality="${isBlank ? detection.quality : (m ? m[2] : '')}" data-root="${isBlank ? detection.root : (m ? m[1] : '')}">
                    ${currentChordDisplay} <span class="alt-match-badge ${headerBadgeClass}">${headerBadge}</span>
                </button>
            </div>
            <div class="shape-val-notes">
                <span class="shape-val-label">Notes:</span>
                ${noteDetails.join(' ')}
            </div>
            ${missingNotes.length > 0 ? `<div class="shape-val-missing">Missing: ${missingNotes.join(', ')}</div>` : ''}
            ${altsHtml}
        </div>
    `;
}

// Render the chord shape editor overlay
function renderChordShapeEditor(chordName) {
    const frets = state.shapeEditorFrets;
    const baseFret = state.shapeEditorBaseFret;

    const stringLabels = ['E', 'A', 'D', 'G', 'B', 'E'];
    const stringStates = frets.map(f => {
        if (f === null) return 'X';
        if (f === 0) return 'O';
        return '';
    });

    let html = `
    <div class="chord-shape-overlay" id="chordShapeOverlay">
        <div class="chord-shape-editor">
            <div class="shape-editor-header">
                <span class="shape-editor-title">Chord Shape: ${chordName}</span>
                <button class="shape-editor-close" data-action="closeShapeEditor">×</button>
            </div>
            <div class="shape-editor-body">
                <div class="shape-fret-nav">
                    <button data-action="shapeNavDown">◀</button>
                    <span>Frets ${baseFret}-${baseFret+4}</span>
                    <button data-action="shapeNavUp">▶</button>
                </div>
                <div class="shape-fretboard">
                    <div class="shape-string-headers">
                        <div class="shape-string-header-spacer"></div>
    `;

    // String headers
    stringLabels.forEach((name, s) => {
        const state = stringStates[s];
        html += `
                        <div class="shape-string-header" data-action="toggleShapeString" data-string="${s}">
                            <span class="shape-string-name">${name}</span>
                            <span class="shape-string-state">${state}</span>
                        </div>
        `;
    });

    html += `
                    </div>
                    <div class="shape-fret-rows">
    `;

    // Compute missing note hints for partial matches
    const OPEN_PITCHES = [4, 9, 2, 7, 11, 4]; // E A D G B E
    const NOTE_NAMES_ALL = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const CHORD_INTERVALS_LUT = Data.CHORD_FORMULAS;
    let hintPitchClasses = new Set();

    // Determine which chord to check for missing notes
    const checkChordName = state.shapeEditorSelectedChord || chordName;
    const hm = checkChordName.match(/^([A-G][b#]?)(.*)$/);
    if (hm) {
        const FLAT_TO_SHARP = {'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#'};
        const hRoot = FLAT_TO_SHARP[hm[1]] || hm[1];
        const hQuality = hm[2];
        const hRootIdx = NOTE_NAMES_ALL.indexOf(hRoot);
        const hIntervals = CHORD_INTERVALS_LUT[hQuality] || [0,4,7];
        const expectedPCs = new Set(hIntervals.map(i => (hRootIdx + i) % 12));
        // Find which expected notes are NOT in current frets
        const playedPCs = new Set();
        for (let s = 0; s < 6; s++) {
            if (frets[s] !== null && frets[s] !== undefined) {
                playedPCs.add((OPEN_PITCHES[s] + frets[s]) % 12);
            }
        }
        expectedPCs.forEach(pc => {
            if (!playedPCs.has(pc)) hintPitchClasses.add(pc);
        });
    }

    // Fret grid
    for (let fretOffset = 0; fretOffset < 5; fretOffset++) {
        const fret = baseFret + fretOffset;
        html += `<div class="shape-fret-row" data-fret="${fret}">
                            <span class="shape-fret-num">${fret}</span>`;

        for (let s = 0; s < 6; s++) {
            const isActive = frets[s] === fret;
            // Check if this position contains a missing note hint
            // Show on any non-active cell where the missing note can be found
            const cellPC = (OPEN_PITCHES[s] + fret) % 12;
            const isHint = !isActive && hintPitchClasses.has(cellPC);
            html += `<div class="shape-fret-cell ${isActive ? 'active' : ''} ${isHint ? 'hint-note' : ''}"
                              data-action="toggleShapeFret" data-string="${s}" data-fret="${fret}">
                              ${isHint ? '<span class="hint-dot"></span>' : ''}
                         </div>`;
        }
        html += `</div>`;
    }

    html += `
                    </div>
                </div>
            </div>
            <div class="shape-validation-container">${buildChordValidation(chordName, frets, baseFret)}</div>
            <div class="shape-editor-not-sure">
                Not sure of the shape?
                <button class="shape-editor-picker-link" data-action="switchToChordPicker" title="Open the Chord Picker to choose by name">Pick a chord by name →</button>
            </div>
            <div class="shape-editor-footer">
                <button data-action="clearChordShape">Clear</button>
                <button class="shape-preview-btn" data-action="previewChordShape" title="Preview sound">▶ Preview</button>
                <button data-action="saveChordShape">Save Shape</button>
            </div>
        </div>
    </div>
    `;

    // Create temporary container or append to body
    let overlay = document.getElementById('chordShapeOverlay');
    if (overlay) overlay.remove();

    const temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);
}

// Highlight current chord during looper playback
function highlightProgressionChord(lineIdx, chordIdx) {
    state.currentPlayingLine = lineIdx;
    state.currentPlayingChord = chordIdx;

    // Strategy A: the playhead highlight moves across the v2 builder chips (data-chipfor=<chord id>).
    // onMeasure passes (lineIdx, chordIdx); map to the chord id, mark it .playing and the next .preglow.
    // Class-only toggle (no re-render), re-applied every measure by the audio callback.
    const root = document.getElementById('uzv2Builder');
    if (!root) return;
    root.querySelectorAll('.chip.playing, .chip.preglow').forEach(el => el.classList.remove('playing', 'preglow'));
    const line = state.progressionLines[lineIdx];
    if (lineIdx < 0 || chordIdx < 0 || !line || !line.chords[chordIdx]) return;
    const cur = line.chords[chordIdx];
    const chip = root.querySelector(`.chip[data-chipfor="${cur.id}"]`);
    if (chip) chip.classList.add('playing');
    // preglow the next chord (by start order) so the player can read ahead
    const next = line.chords.filter(c => (c.start || 0) > (cur.start || 0)).sort((a, b) => (a.start || 0) - (b.start || 0))[0];
    if (next) { const n = root.querySelector(`.chip[data-chipfor="${next.id}"]`); if (n) n.classList.add('preglow'); }
}

// Build flat progression from lines with repeats for playback
function buildFlatProgression() {
    const flat = [];
    let songBeat = 0; // absolute beat offset across lines (× repeats) — honors free positions, gaps, and per-line meter
    state.progressionLines.forEach((line, lineIdx) => {
        normalizeLinePositions(line);
        // Handle infinite repeat (999) - just do one iteration for building
        const repeatCount = line.repeats === 999 ? 1 : (line.repeats || 1);
        const axis = lineAxisBeats(line);
        for (let rep = 0; rep < repeatCount; rep++) {
            line.chords.forEach((item, chordIdx) => {
                // Transpose chord if needed
                const chord = item.roman ?
                    transposeChord(item.chord, item.roman, state.progressionKey, state.selectedKey) :
                    item.chord;
                flat.push({
                    chord,
                    lineIdx,
                    chordIdx,
                    id: item.id,
                    beats: chordBeats(item),
                    accent: chordAccent(item),
                    start: songBeat + (item.start || 0) // absolute onset (line offset + free position)
                });
            });
            songBeat += axis; // advance by the line's full axis so gaps/meter/trailing space are preserved
        }
    });
    flat.songBeats = songBeat || 4; // total song length in beats (drives the loop boundary)
    return flat;
}

// ========== DRAG AND DROP ==========
let draggedChord = null;
let draggedLine = null;

function setupDragAndDrop() {
    // Chord-level interaction is now pointer-based (positioned / free-floating lane) —
    // see setupChordLaneDrag(). Only line-level reorder remains HTML5 drag.
    document.querySelectorAll('.progression-line').forEach(line => {
        line.addEventListener('dragstart', handleLineDragStart);
        line.addEventListener('dragend', handleLineDragEnd);
        line.addEventListener('dragover', handleLineDragOver);
        line.addEventListener('drop', handleLineDrop);
    });
}

// Positioned chord-lane interactions, installed ONCE (document-delegated so it survives
// renderProgression() innerHTML rebuilds): pointer move/resize of chips + per-line meter.
let __chordDragged = false;
function setupChordLaneDrag() {
    let cdrag = null;
    document.addEventListener('pointerdown', (e) => {
        const chipEl = e.target.closest && e.target.closest('.progression-chord'); if (!chipEl) return;
        if (e.target.closest('.chord-shape-btn, .remove-btn, .chord-time-btns')) return; // let the buttons act
        const posEl = chipEl.closest('.pc-pos'); const host = chipEl.closest('.chips-abs'); if (!posEl || !host) return;
        const lineIdx = parseInt(chipEl.dataset.line, 10), chordIdx = parseInt(chipEl.dataset.idx, 10);
        const line = state.progressionLines[lineIdx]; const c = line && line.chords[chordIdx]; if (!c) return;
        const resize = !!e.target.closest('[data-action="resizeStart"]');
        const ax = lineAxisBeats(line);
        cdrag = { c, line, resize, posEl, x0: e.clientX, beatPx: host.getBoundingClientRect().width / ax, start0: c.start || 0, beats0: chordBeats(c), moved: false, pending: null };
    });
    document.addEventListener('pointermove', (e) => {
        if (!cdrag) return;
        if (Math.abs(e.clientX - cdrag.x0) > 3) cdrag.moved = true;
        if (!cdrag.moved) return;
        const db = (e.clientX - cdrag.x0) / cdrag.beatPx; const ax = lineAxisBeats(cdrag.line);
        if (cdrag.resize) { const len = Math.max(0.5, snap05(cdrag.beats0 + db)); cdrag.pending = { beats: len }; cdrag.posEl.style.width = (len / ax * 100) + '%'; }
        else { const st = Math.max(0, snap05(cdrag.start0 + db)); cdrag.pending = { start: st }; cdrag.posEl.style.left = (st / ax * 100) + '%'; }
    });
    document.addEventListener('pointerup', () => {
        if (!cdrag) return;
        if (cdrag.moved && cdrag.pending) {
            pushUndoState();
            if (cdrag.resize) {
                cdrag.c.beats = clampChordBeats(cdrag.line, cdrag.c, cdrag.pending.beats);
            } else {
                const beats = chordBeats(cdrag.c);
                if (!chordsOverlap(cdrag.line, cdrag.c, cdrag.pending.start, beats)) cdrag.c.start = cdrag.pending.start;
            }
            __chordDragged = true; renderProgression(); saveStateToLocalStorage();
        }
        cdrag = null;
    });
    // a chip drag must not start the line-level HTML5 drag (the .progression-line is draggable)
    document.addEventListener('dragstart', (e) => { if (e.target.closest && e.target.closest('.progression-chord')) e.preventDefault(); }, true);
    // swallow the click that fires right after a move/resize commit (so it doesn't also select/act)
    document.addEventListener('click', (e) => { if (__chordDragged) { __chordDragged = false; if (e.target.closest && e.target.closest('.progression-chord')) { e.stopPropagation(); e.preventDefault(); } } }, true);
    // per-line meter (beats-per-bar) change
    document.addEventListener('change', (e) => {
        const sel = e.target.closest && e.target.closest('.line-meter-select'); if (!sel) return;
        const li = parseInt(sel.dataset.line, 10); const line = state.progressionLines[li]; if (!line) return;
        pushUndoState(); line.bpb = parseInt(sel.value, 10); renderProgression(); saveStateToLocalStorage();
    });
}

function handleChordDragStart(e) {
    draggedChord = {
        lineIdx: parseInt(this.dataset.line),
        chordIdx: parseInt(this.dataset.idx)
    };
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'chord');
    e.stopPropagation(); // Don't trigger line drag
}

function handleChordDragEnd(e) {
    this.classList.remove('dragging');
    clearChordDropIndicators();
    draggedChord = null;
}

function clearChordDropIndicators() {
    document.querySelectorAll('.drag-over, .drop-before, .drop-after').forEach(el => {
        el.classList.remove('drag-over', 'drop-before', 'drop-after');
    });
}

function handleChordDragLeave(e) {
    this.classList.remove('drop-before', 'drop-after', 'drag-over');
}

function handleContainerDragOver(e) {
    if (!draggedChord) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleChordDragOver(e) {
    if (!draggedChord) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Determine if cursor is on the left or right half of the target chord
    const target = this.closest ? this.closest('.progression-chord') : this;
    if (!target || !target.classList.contains('progression-chord')) return;

    clearChordDropIndicators();
    const rect = target.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (e.clientX < midX) {
        target.classList.add('drop-before');
    } else {
        target.classList.add('drop-after');
    }
}

function handleChordDrop(e) {
    if (!draggedChord) return;
    e.preventDefault();
    e.stopPropagation();

    const target = this.closest ? this.closest('.progression-chord') : this;
    if (!target) return;

    const targetLineIdx = parseInt(target.dataset.line);
    const targetChordIdx = parseInt(target.dataset.idx);

    // Detect left or right half
    const rect = target.getBoundingClientRect();
    const dropBefore = e.clientX < (rect.left + rect.width / 2);

    // Don't drop on self in the same position
    if (draggedChord.lineIdx === targetLineIdx && draggedChord.chordIdx === targetChordIdx) {
        clearChordDropIndicators();
        return;
    }

    pushUndoState();

    // Remove from original position
    const [movedChord] = state.progressionLines[draggedChord.lineIdx].chords.splice(draggedChord.chordIdx, 1);

    // Calculate insertion index
    let insertIdx = targetChordIdx;
    // Adjust if moving within same line and source was before target
    if (draggedChord.lineIdx === targetLineIdx && draggedChord.chordIdx < targetChordIdx) {
        insertIdx--;
    }
    // If dropping after, shift by one
    if (!dropBefore) {
        insertIdx++;
    }

    // Clamp
    const maxIdx = state.progressionLines[targetLineIdx].chords.length;
    insertIdx = Math.max(0, Math.min(insertIdx, maxIdx));

    state.progressionLines[targetLineIdx].chords.splice(insertIdx, 0, movedChord);

    clearChordDropIndicators();
    renderProgression();
    saveStateToLocalStorage();
}

function handleChordDropOnContainer(e) {
    if (!draggedChord) return;
    e.preventDefault();

    const targetLineIdx = parseInt(this.dataset.line);

    // Remove from original position
    const [movedChord] = state.progressionLines[draggedChord.lineIdx].chords.splice(draggedChord.chordIdx, 1);

    // Add to end of target line
    state.progressionLines[targetLineIdx].chords.push(movedChord);

    clearChordDropIndicators();
    renderProgression();
    saveStateToLocalStorage();
}

function handleLineDragStart(e) {
    // The browser starts a drag on the nearest draggable="true" ancestor.
    // For .progression-line that means a mousedown anywhere inside the line
    // (sliders, buttons, inputs, the tab cells) was incorrectly triggering a
    // whole-line drag — pulling the chord+melody box out of frame. Only allow
    // the drag to proceed when the user explicitly grabs the drag handle (☰).
    if (e.target.closest('.line-drag-handle')) {
        // Genuine line drag from the handle — fall through to set up below.
    } else if (e.target.closest('.progression-chord')) {
        // Chord has its own drag (handleChordDragStart). Don't claim it here,
        // and don't preventDefault either — that would cancel the chord drag.
        return;
    } else {
        // Anywhere else inside the line (range slider, input, button, tab
        // cells, etc.) — cancel the implicit drag so click-and-drag interactions
        // on those controls work as expected.
        e.preventDefault();
        return;
    }

    draggedLine = parseInt(this.dataset.line);
    this.classList.add('dragging-line');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'line');
}

function handleLineDragEnd(e) {
    this.classList.remove('dragging-line');
    document.querySelectorAll('.drag-over-line').forEach(el => el.classList.remove('drag-over-line'));
    draggedLine = null;
}

function handleLineDragOver(e) {
    if (draggedLine === null || draggedChord) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    this.classList.add('drag-over-line');
}

function handleLineDrop(e) {
    if (draggedLine === null || draggedChord) return;
    e.preventDefault();

    const targetLineIdx = parseInt(this.dataset.line);

    if (draggedLine === targetLineIdx) return;

    pushUndoState();

    // Remove line from original position
    const [movedLine] = state.progressionLines.splice(draggedLine, 1);

    // Insert at new position
    state.progressionLines.splice(targetLineIdx, 0, movedLine);

    // Adjust current line index if needed
    if (state.currentLineIndex === draggedLine) {
        state.currentLineIndex = targetLineIdx;
    } else if (draggedLine < state.currentLineIndex && targetLineIdx >= state.currentLineIndex) {
        state.currentLineIndex--;
    } else if (draggedLine > state.currentLineIndex && targetLineIdx <= state.currentLineIndex) {
        state.currentLineIndex++;
    }

    renderProgression();
    saveStateToLocalStorage();
}

// ========== LOCAL STORAGE AUTO-SAVE ==========
// BUG FIX #9: localStorage auto-save
function saveStateToLocalStorage() {
    const savedState = {
        selectedKey: state.selectedKey,
        selectedTab: state.selectedTab,
        progressionKey: state.progressionKey,
        progressionLines: state.progressionLines,
        looperBpm: state.looperBpm,
        looperStyle: state.looperStyle,
        looperStyleVariant: state.looperStyleVariant,
        looperDrums: state.looperDrums,
        looperBass: state.looperBass,
        looperKeys: state.looperKeys,
        songName: state.songName,
        lyrics: state.lyrics || null,
        melody: state.melody || null
    };
    localStorage.setItem('undercoverZestState', JSON.stringify(savedState));
    if (typeof getSongsRegistry === 'function') {
        const reg = getSongsRegistry();
        if (reg && reg.songs[reg.currentId]) {
            reg.songs[reg.currentId] = { data: buildSaveData(), updatedAt: Date.now() };
            saveSongsRegistry(reg);
        }
    }
}

function loadStateFromLocalStorage() {
    const saved = localStorage.getItem('undercoverZestState');
    if (!saved) return;

    // Rollback safety (builder-v2 port): on first v2 load, snapshot the pre-v2 save ONCE so a code
    // rollback can restore the user's original song. Never overwritten on later loads.
    try {
        if (!localStorage.getItem('undercoverZestState.preV2backup')) {
            localStorage.setItem('undercoverZestState.preV2backup', saved);
        }
    } catch (e) {}

    try {
        const parsed = JSON.parse(saved);
        if (parsed.selectedKey) state.selectedKey = parsed.selectedKey;
        if (parsed.selectedTab) state.selectedTab = parsed.selectedTab;
        if (parsed.progressionKey) state.progressionKey = parsed.progressionKey;
        if (parsed.progressionLines) state.progressionLines = parsed.progressionLines;
        if (parsed.looperBpm) state.looperBpm = parsed.looperBpm;
        if (parsed.looperStyle) state.looperStyle = parsed.looperStyle;
        if (parsed.looperStyleVariant) state.looperStyleVariant = parsed.looperStyleVariant;
        if (typeof parsed.looperDrums === 'boolean') state.looperDrums = parsed.looperDrums;
        if (typeof parsed.looperBass === 'boolean') state.looperBass = parsed.looperBass;
        if (typeof parsed.looperKeys === 'boolean') state.looperKeys = parsed.looperKeys;
        if (parsed.songName) state.songName = parsed.songName;
        if (parsed.lyrics) state.lyrics = parsed.lyrics;
        if (parsed.melody) state.melody = parsed.melody;
        normalizeProgressionState();
    } catch (err) {
        console.warn('Failed to load saved state:', err);
    }
}

// ========== SAVE / LOAD ==========
function buildSaveData() {
    return {
        version: 3,
        songName: state.songName || '',
        key: state.selectedKey,
        mode: state.selectedTab === 'dark' ? 'minor' : 'major',
        progressionKey: state.selectedKey,
        bpm: state.looperBpm,
        style: state.looperStyle,
        styleVariant: state.looperStyleVariant,
        drums: state.looperDrums,
        bass: state.looperBass,
        keys: state.looperKeys,
        lines: state.progressionLines.map(line => ({
            chords: line.chords.map(c => ({
                chord: c.chord, roman: c.roman || '',
                shape: c.shape || null
            })),
            repeats: line.repeats,
            name: line.name || '',
            tab: line.tab || [],
            tabArtic: line.tabArtic || [],
            showTab: line.showTab || false
        })),
        lyrics: state.lyrics || null,
        melody: state.melody || null
    };
}

function getDefaultFilename() {
    if (state.songName && state.songName.trim()) {
        // Sanitise song name for filename: replace non-alphanumeric with underscore
        return state.songName.trim().replace(/[^a-zA-Z0-9\s\-_]/g, '').replace(/\s+/g, '_');
    }
    return `progression_${state.selectedKey}_${state.looperBpm}bpm`;
}

async function saveProgression() {
    const data = buildSaveData();
    const text = JSON.stringify(data, null, 2);
    const defaultName = getDefaultFilename();

    // Try native File System Access API (Save As dialog)
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: `${defaultName}.json`,
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(text);
            await writable.close();
            return; // Done — saved via native dialog
        } catch (err) {
            // User cancelled the dialog — don't fall through to legacy
            if (err.name === 'AbortError') return;
            // Other error — fall through to legacy save
            console.warn('File System Access API failed, using fallback:', err);
        }
    }

    // Fallback: show custom save dialog with filename input + download
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    let overlay = document.getElementById('saveDialogOverlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'saveDialogOverlay';
    overlay.className = 'save-dialog-overlay';
    overlay.innerHTML = `
        <div class="save-dialog">
            <div class="save-dialog-title">Save Progression</div>
            <label class="save-dialog-label">File name:</label>
            <input type="text" class="save-dialog-input" id="saveDialogFilename" value="${defaultName}" spellcheck="false">
            <div class="save-dialog-hint">.json will be added automatically</div>
            ${isSafari ? '<div class="save-dialog-safari-hint">Safari tip: Go to Safari → Settings → General → set "File download location" to <strong>"Ask for each download"</strong> to choose where files save.</div>' : ''}
            <div class="save-dialog-buttons">
                <button class="save-dialog-cancel" id="saveDialogCancel">Cancel</button>
                <button class="save-dialog-confirm" id="saveDialogConfirm">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = document.getElementById('saveDialogFilename');
    input.focus();
    input.select();

    const doSave = () => {
        const filename = input.value.trim() || defaultName;
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        overlay.remove();
    };

    const doCancel = () => overlay.remove();

    document.getElementById('saveDialogConfirm').addEventListener('click', doSave);
    document.getElementById('saveDialogCancel').addEventListener('click', doCancel);
    overlay.addEventListener('click', e => { if (e.target === overlay) doCancel(); });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') doSave();
        if (e.key === 'Escape') doCancel();
    });
}

function openProgression() {
    const input = document.getElementById('fileInput');
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                loadProgressionData(data);
            } catch (err) {
                alert('Could not load file. Please ensure it is a valid progression file.');
                console.error('Load error:', err);
            }
        };
        reader.readAsText(file);
        input.value = ''; // BUG FIX #8: Reset file input
    };
    input.click();
}

// ========== EXPORT TO PDF ==========
function exportToPdf() {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
        alert('PDF library not loaded yet. Please try again in a moment.');
        return;
    }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 15;
    const usableW = pageW - margin * 2;
    let y = margin;

    const TAB_STRINGS = ['e', 'B', 'G', 'D', 'A', 'E'];
    const ARTIC_MAP = { h: 'h', p: 'p', '/': '/', '\\': '\\' };

    function checkPage(needed) {
        if (y + needed > pageH - margin) {
            doc.addPage();
            y = margin;
        }
    }

    // Title
    const title = state.songName || 'Untitled Song';
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(title, pageW / 2, y, { align: 'center' });
    y += 10;

    // Key and BPM
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`Key: ${state.selectedKey}  |  BPM: ${state.looperBpm}  |  Style: ${state.looperStyle}`, pageW / 2, y, { align: 'center' });
    y += 10;
    doc.setTextColor(0);

    // Separator line
    doc.setDrawColor(200);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 8;

    // Lines
    state.progressionLines.forEach((line, lineIdx) => {
        checkPage(30);

        // Line header
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(150, 130, 80);
        const repeatStr = line.repeats > 1 ? (line.repeats === 999 ? ' (Loop)' : ` (×${line.repeats})`) : '';
        doc.text(`${line.name || 'Line ' + (lineIdx + 1)}${repeatStr}`, margin, y);
        y += 5;
        doc.setTextColor(0);

        // Chords
        if (line.chords.length > 0) {
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');

            let chordX = margin;
            line.chords.forEach((item) => {
                const displayChord = item.roman ?
                    transposeChord(item.chord, item.roman, state.progressionKey, state.selectedKey) :
                    item.chord;

                const chordW = doc.getTextWidth(displayChord) + 6;
                if (chordX + chordW > pageW - margin) {
                    chordX = margin;
                    y += 8;
                    checkPage(20);
                }

                // Chord box
                doc.setDrawColor(180);
                doc.setFillColor(248, 248, 248);
                doc.roundedRect(chordX, y - 4, chordW, 7, 1, 1, 'FD');
                doc.setTextColor(40);
                doc.text(displayChord, chordX + 3, y + 1);

                // Roman numeral below
                if (item.roman) {
                    doc.setFontSize(7);
                    doc.setFont('helvetica', 'italic');
                    doc.setTextColor(140);
                    doc.text(item.roman, chordX + 3, y + 6);
                    doc.setFontSize(14);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(40);
                }

                chordX += chordW + 4;
            });
            y += 12;
        }

        // Tab section
        if (line.showTab && line.tab && line.tab.length > 0) {
            checkPage(35);

            const colW = 6;     // width per tab column
            const passColW = 3; // half-width for passing note columns
            const articW = 4;   // width per articulation column
            const labelW = 8;   // width for string labels
            const rowH = 3.5;   // height per string row
            const tabStartX = margin + labelW;

            // Pre-compute which columns are passing-note columns
            const pdfPassingSet = line.tabPassing || {};
            const isPassingCol = (c) => {
                for (let s = 0; s < 6; s++) {
                    if (pdfPassingSet[c + ',' + s]) return true;
                }
                return false;
            };
            const getColW = (c) => isPassingCol(c) ? passColW : colW;

            // Calculate how many columns fit per row
            const tabTotalW = usableW - labelW;
            const colsPerRow = Math.floor(tabTotalW / (colW + articW));

            // Split tab into rows if needed
            const totalCols = line.tab.length;
            for (let startCol = 0; startCol < totalCols; startCol += colsPerRow) {
                const endCol = Math.min(startCol + colsPerRow, totalCols);
                checkPage(30);

                // Draw string labels
                doc.setFontSize(7);
                doc.setFont('courier', 'normal');
                doc.setTextColor(120);
                for (let s = 0; s < 6; s++) {
                    doc.text(TAB_STRINGS[s], margin, y + s * rowH + 2);
                }

                // Draw tab lines
                doc.setDrawColor(200);
                doc.setLineWidth(0.15);
                let rowWidth = Math.max(0, endCol - startCol - 1) * articW;
                for (let rc = startCol; rc < endCol; rc++) rowWidth += getColW(rc);
                for (let s = 0; s < 6; s++) {
                    const lineY = y + s * rowH + 0.5;
                    doc.line(tabStartX, lineY, tabStartX + rowWidth, lineY);
                }

                // Build boundary set for this line
                const pdfBoundaries = line.chordBoundaries || [];
                const pdfBoundarySet = new Set(pdfBoundaries);

                // Draw chord zone labels above the tab
                if (pdfBoundaries.length > 0 && line.chords.length > 0) {
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7);
                    doc.setTextColor(150, 130, 80);
                    let labelX = tabStartX;
                    for (let c = startCol; c < endCol; c++) {
                        const bIdx = pdfBoundaries.indexOf(c);
                        if (bIdx >= 0 && line.chords[bIdx]) {
                            const displayChord = line.chords[bIdx].roman
                                ? transposeChord(line.chords[bIdx].chord, line.chords[bIdx].roman, state.progressionKey, state.selectedKey)
                                : line.chords[bIdx].chord;
                            doc.text(displayChord, labelX + 0.5, y - 1.5);
                        }
                        labelX += getColW(c);
                        if (c < endCol - 1) labelX += articW;
                    }
                    doc.setTextColor(30);
                }

                // Draw notes, articulations, and chord boundary dividers
                let curX = tabStartX;
                for (let c = startCol; c < endCol; c++) {
                    // Chord boundary divider line
                    if (pdfBoundarySet.has(c) && c > startCol) {
                        doc.setDrawColor(180, 150, 80);
                        doc.setLineWidth(0.4);
                        doc.line(curX - 1, y - 1.5, curX - 1, y + 6 * rowH - 1);
                        doc.setDrawColor(200);
                        doc.setLineWidth(0.15);
                    }

                    const col = line.tab[c];
                    const cw = getColW(c);
                    const isPass = isPassingCol(c);
                    if (col) {
                        doc.setFont('courier', isPass ? 'normal' : 'bold');
                        doc.setFontSize(isPass ? 6 : 7);
                        if (isPass) doc.setTextColor(130, 120, 190);
                        for (let s = 0; s < 6; s++) {
                            if (col[s] !== null && col[s] !== undefined) {
                                const fretStr = String(col[s]);
                                const tw = doc.getTextWidth(fretStr);
                                doc.setFillColor(255, 255, 255);
                                doc.rect(curX + cw / 2 - tw / 2 - 0.3, y + s * rowH - 1.2, tw + 0.6, 3, 'F');
                                doc.text(fretStr, curX + cw / 2, y + s * rowH + 0.8, { align: 'center' });
                            }
                        }
                        if (isPass) doc.setTextColor(30);
                    }
                    curX += cw;

                    // Articulation between columns
                    if (c < endCol - 1 && line.tabArtic && line.tabArtic[c]) {
                        const artic = line.tabArtic[c];
                        doc.setFont('courier', 'normal');
                        doc.setFontSize(6);
                        doc.setTextColor(150, 130, 80);
                        for (let s = 0; s < 6; s++) {
                            if (artic[s]) {
                                const sym = ARTIC_MAP[artic[s]] || artic[s];
                                doc.text(sym, curX + articW / 2, y + s * rowH + 0.8, { align: 'center' });
                            }
                        }
                        doc.setTextColor(30);
                        curX += articW;
                    }
                }

                y += 6 * rowH + 5;
            }
        }

        // Line separator
        y += 3;
        if (lineIdx < state.progressionLines.length - 1) {
            doc.setDrawColor(220);
            doc.setLineWidth(0.2);
            doc.line(margin + 20, y, pageW - margin - 20, y);
            y += 5;
        }
    });

    // Lyrics section (if any)
    if (state.lyrics && state.lyrics.sections && state.lyrics.sections.length > 0) {
        checkPage(20);
        y += 8;
        doc.setDrawColor(180, 150, 60);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageW - margin, y);
        y += 8;
        doc.setFontSize(14);
        doc.setTextColor(150, 130, 80);
        doc.text('Lyrics', margin, y);
        y += 8;

        state.lyrics.sections.forEach(sec => {
            checkPage(25);
            // Section label
            doc.setFontSize(11);
            doc.setTextColor(150, 130, 80);
            doc.text(`[${sec.label}]`, margin, y);
            y += 6;

            (sec.lines || []).forEach((lineText, lineIdx) => {
                checkPage(14);
                const lineChords = (sec.chordMap && sec.chordMap[lineIdx]) || {};
                const words = lineText.split(/(\s+)/);
                const hasChords = Object.keys(lineChords).length > 0;

                if (hasChords) {
                    // Build chord line positioned above words
                    doc.setFontSize(9);
                    doc.setTextColor(94, 200, 120);
                    let xPos = margin;
                    let wordIdx = 0;
                    words.forEach(w => {
                        if (/^\s+$/.test(w)) {
                            xPos += doc.getTextWidth(w);
                        } else {
                            const chord = lineChords[wordIdx] || '';
                            if (chord) {
                                doc.text(chord, xPos, y);
                            }
                            xPos += doc.getTextWidth(w + ' ');
                            wordIdx++;
                        }
                    });
                    y += 4;
                }

                // Lyric text
                doc.setFontSize(10);
                doc.setTextColor(60);
                doc.text(lineText, margin, y);
                y += 5;
            });
            y += 4;
        });
    }

    // Footer
    checkPage(15);
    y += 5;
    doc.setFontSize(8);
    doc.setTextColor(170);
    doc.text('Generated by Undercover Zest', pageW / 2, y, { align: 'center' });

    // Save
    const filename = getDefaultFilename();
    doc.save(`${filename}.pdf`);
}

function loadProgressionData(data) {
    // Song name: set unconditionally — a truthy guard here leaked the
    // previous song's name into untitled songs when switching (My Songs hub).
    state.songName = data.songName || '';

    // Set key if present
    if (data.key && Data.KEY_ORDER.includes(data.key)) {
        state.selectedKey = data.key;
    }

    // Restore major/minor mode
    if (data.mode === 'minor') {
        state.selectedTab = 'dark';
        document.body.classList.add('dark-mode');
    } else if (data.mode === 'major') {
        state.selectedTab = 'standard';
        document.body.classList.remove('dark-mode');
    } else {
        // Legacy files without mode: count minor vs major chords to decide
        const chordNames = (data.lines || []).flatMap(l => (l.chords || []).map(c => typeof c === 'string' ? c : c.chord)).filter(Boolean);
        let minorCount = 0, majorCount = 0;
        chordNames.forEach(c => {
            const base = getBaseChord(c);
            const m = base.match(/^[A-G][#b]?(.*)/);
            if (!m) return;
            const q = m[1];
            if (q.startsWith('m') && !q.startsWith('maj')) minorCount++;
            else if (q === '' || q.startsWith('maj') || q === '7' || q.startsWith('sus')) majorCount++;
        });
        if (minorCount > majorCount) {
            state.selectedTab = 'dark';
            document.body.classList.add('dark-mode');
        }
    }

    // Progression key should match selected key on load — chords are stored as-displayed
    // The old progressionKey field is ignored; it caused transposition bugs when adding new chords
    state.progressionKey = state.selectedKey;

    // Set looper settings
    if (data.bpm) state.looperBpm = data.bpm;
    if (data.style) state.looperStyle = data.style;
    if (data.styleVariant) state.looperStyleVariant = data.styleVariant;
    if (typeof data.drums === 'boolean') state.looperDrums = data.drums;
    if (typeof data.bass === 'boolean') state.looperBass = data.bass;
    if (typeof data.keys === 'boolean') state.looperKeys = data.keys;

    // Load lines
    if (data.lines && Array.isArray(data.lines)) {
        state.progressionLines = data.lines.map(line => ({
            chords: (line.chords || []).map(c => {
                // Handle both old format (string) and new format (object with chord and roman)
                if (typeof c === 'string') {
                    return { chord: c, roman: '', id: 'loaded' };
                } else {
                    return { chord: c.chord, roman: c.roman || '', id: 'loaded', shape: c.shape || null };
                }
            }),
            repeats: line.repeats || 1,
            name: line.name || '',
            tab: line.tab || [],
            tabArtic: line.tabArtic || [],
            showTab: line.showTab || false
        }));

        // Ensure at least one line
        if (state.progressionLines.length === 0) {
            state.progressionLines = [{ chords: [], repeats: 1, tab: [], showTab: false }];
        }
    }

    // Lyrics: same leak-prevention — reset to empty when the file has none.
    state.lyrics = data.lyrics || { freeText: '', sections: [], currentView: 'freewrite', currentTab: 'lyrics' };
    // Melody: leak-safe reset too.
    state.melody = data.melody || Melody.defaults();

    state.currentLineIndex = 0;
    render();
    renderLyricsPanel();
    saveStateToLocalStorage();
}

// FIX: Disappearing Buttons
function renderChordVariations(root, quality) {
    const container = document.getElementById('chordVariations');
    container.innerHTML = '';

    let base = 'major';
    if (quality.includes('dim') || quality.includes('m7b5')) base = 'dim';
    else if (quality.startsWith('m') && !quality.startsWith('maj')) base = 'minor';
    else if ((quality.includes('7') || quality.includes('9') || quality.includes('13')) && !quality.includes('maj')) base = 'dom7';

    const vars = Data.CHORD_VARIATIONS[base] || Data.CHORD_VARIATIONS['major'];

    vars.forEach(v => {
        const full = root + v;
        const isActive = full === state.selectedChordForDetail;
        container.innerHTML += `<button class="variation-btn ${isActive?'active':''}" data-var="${full}">${v || (base==='minor'?'m':'Major')}</button>`;
    });

    const diagramContainer = document.getElementById('chordDiagrams');
    // Fallback logic for diagrams (find simple version if complex missing)
    let lookup = state.selectedChordForDetail;
    let lookupQuality = quality;
    if (!Data.CHORD_DB[lookup]) {
        lookup = root + (base === 'minor' ? 'm' : base === 'dom7' ? '7' : '');
        lookupQuality = base === 'minor' ? 'm' : base === 'dom7' ? '7' : '';
    }
    if (!Data.CHORD_DB[lookup]) {
        lookup = root; // Fallback to root triad
        lookupQuality = '';
    }

    const dbChord = Data.CHORD_DB[lookup];
    if (dbChord && dbChord.positions.length > 0) {
        // Categorize chord shapes
        const mustKnow = [];
        const openChords = [];
        const moveable = [];

        dbChord.positions.forEach((pos, i) => {
            const baseFret = dbChord.baseFrets[i];
            const hasOpen = pos.some(p => p === 0);
            const hasMutes = pos.some(p => p === -1);

            if (i < 3) {
                // First 3 shapes are "must know"
                mustKnow.push({ pos, fingers: dbChord.fingers[i], baseFret, idx: i });
            } else if (hasOpen && baseFret <= 1) {
                // Open chord shapes
                openChords.push({ pos, fingers: dbChord.fingers[i], baseFret, idx: i });
            } else {
                // Moveable (barre) shapes
                moveable.push({ pos, fingers: dbChord.fingers[i], baseFret, idx: i });
            }
        });

        let html = '';

        if (mustKnow.length > 0) {
            html += `<div class="diagram-category">
                <div class="category-label">Must Know</div>
                <div class="category-diagrams">
                    ${mustKnow.map(c => `<div class="chord-diagram">${renderChordSVG(c.pos, c.fingers, c.baseFret, root, lookupQuality)}</div>`).join('')}
                </div>
            </div>`;
        }

        if (openChords.length > 0) {
            html += `<div class="diagram-category">
                <div class="category-label">Open Chords</div>
                <div class="category-diagrams">
                    ${openChords.map(c => `<div class="chord-diagram">${renderChordSVG(c.pos, c.fingers, c.baseFret, root, lookupQuality)}</div>`).join('')}
                </div>
            </div>`;
        }

        if (moveable.length > 0) {
            html += `<div class="diagram-category">
                <div class="category-label">Moveable</div>
                <div class="category-diagrams">
                    ${moveable.map(c => `<div class="chord-diagram">${renderChordSVG(c.pos, c.fingers, c.baseFret, root, lookupQuality)}</div>`).join('')}
                </div>
            </div>`;
        }

        diagramContainer.innerHTML = html;
    } else {
        diagramContainer.innerHTML = '<div style="color:#666; font-size:12px; padding:10px;">Diagram data coming soon</div>';
    }
}

function showChordDetail(chordStr, romanLabel) {
    state.selectedChordForDetail = chordStr;
    // Re-show the detail section in case the user previously dismissed it via
    // the close (×) button — closeAnalysis sets inline display:none.
    const detailSection = document.querySelector('.detail-section');
    if (detailSection) detailSection.style.display = '';
    document.getElementById('chordDetailTitle').textContent = chordStr;
    const p = parseChord(chordStr);
    renderChordVariations(p.note, p.quality);

    // Theory Context - always visible in the side panel
    const theoryDiv = document.getElementById('chordTheoryContext');

    // Determine which tip source to use based on active tab
    const isDark = state.selectedTab === 'dark';
    const tipSource = isDark ? Data.DARK_HARMONY_TIPS : Data.SONGWRITING_TIPS;

    // Check if this is a secondary dominant (standard tab only)
    const isSecondaryDom = !isDark && romanLabel && romanLabel.startsWith('V/');

    let warningHtml = '';
    if (isSecondaryDom) {
        warningHtml = `
            <div class="sec-dom-warning">
                <strong>Key Change Alert:</strong> This chord temporarily takes you outside the parent key of ${state.selectedKey}.
                It creates tension that wants to resolve to the ${romanLabel.replace('V/', '')} chord below.
                Use sparingly and resolve properly!
            </div>
        `;
    }

    if (romanLabel && tipSource[romanLabel]) {
        const tip = tipSource[romanLabel];
        const contextLabel = isDark ? `${romanLabel} in ${state.selectedKey} minor` : romanLabel;
        theoryDiv.innerHTML = `
            ${warningHtml}
            <div class="theory-grid">
                <div class="theory-item"><strong>Function:</strong> ${contextLabel}</div>
                <div class="theory-item"><strong>Feeling:</strong> ${tip.feeling}</div>
                <div class="theory-item full"><strong>Songwriter Tip:</strong> ${tip.try}</div>
                <div class="theory-item full"><strong>Where It Goes:</strong> ${tip.next}</div>
                ${tip.voiceLead ? `<div class="theory-item full"><strong>Voice Leading:</strong> ${tip.voiceLead}</div>` : ''}
                ${tip.commonProgs ? `<div class="theory-item full"><strong>Common Progressions:</strong> ${tip.commonProgs}</div>` : ''}
            </div>
        `;
    } else {
        theoryDiv.innerHTML = `${warningHtml}<div class="theory-item">Explore variations below to change the chord color.</div>`;
    }

    renderScaleBoards();
}

function renderScaleBoards() {
    const container = document.getElementById('fretboardContainer');
    if (!state.showFretboard) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');

    // Get chord tones for highlighting
    const chordTones = new Set();
    if (state.selectedChordForDetail) {
        const p = parseChord(state.selectedChordForDetail);
        Audio.getChordTones(p.note, p.quality).forEach(t => chordTones.add(normalizeNoteName(t.note)));
    }

    // Initialize scale boards array if not exists
    if (!state.scaleBoards) {
        state.scaleBoards = [{ id: 0, scale: 'major', showCaged: false, selectedCaged: null, addBlues: false }];
    }

    let html = `<div class="scale-boards-header">
        <span>Scale Visualizer</span>
        <button class="add-scale-btn" data-action="addScaleBoard">+ Add Scale</button>
        <button class="popout-btn" data-action="popoutPanel" data-panel="scaleVisualizer" title="Pop out to window">⧉</button>
        <button class="panel-close-btn" data-action="toggleFretboard" title="Close">×</button>
    </div>`;

    state.scaleBoards.forEach((board, idx) => {
        const relativeMinor = getRelativeMinor(state.selectedKey);
        const scaleInfo = SCALE_DESCRIPTIONS[board.scale] || {};

        // Determine the actual scale root based on scale type
        let scaleRoot = state.selectedKey;
        let actualScaleType = board.scale;

        if (board.scale === 'relMinorPent' || board.scale === 'relMinor') {
            scaleRoot = relativeMinor;
            actualScaleType = board.scale === 'relMinorPent' ? 'pentMinor' : 'minor';
        }

        // Use the actual scale root for CAGED positions
        const cagedPositions = getSortedCAGEDShapes(scaleRoot, actualScaleType);

        // Display key name
        let scaleKeyDisplay = scaleRoot;

        // Check if this scale supports blues notes
        const supportsBlues = scaleInfo.supportsBlues || false;

        html += `
          <div class="scale-board" data-board-idx="${idx}">
            <div class="scale-header">
              <span>${scaleKeyDisplay} Scale</span>
              <div class="scale-controls">
                <select class="scale-select" data-board-idx="${idx}">
                  ${state.selectedTab === 'dark' ? `
                    <optgroup label="── HARMONIC MINOR ──">
                        <option value="harmonicMinor" ${board.scale==='harmonicMinor'?'selected':''}>Harmonic Minor (Dark Classical)</option>
                        <option value="minor" ${board.scale==='minor'?'selected':''}>Natural Minor (Standard)</option>
                    </optgroup>
                    <optgroup label="── MINOR PENTATONICS ──">
                        <option value="pentMinor" ${board.scale==='pentMinor'?'selected':''}>Minor Pentatonic (Blues/Rock)</option>
                    </optgroup>
                    <optgroup label="── EXOTIC / MODAL ──">
                        <option value="phrygianDom" ${board.scale==='phrygianDom'?'selected':''}>Phrygian Dominant (Spanish)</option>
                        <option value="phrygian" ${board.scale==='phrygian'?'selected':''}>Phrygian (Dark Modal)</option>
                        <option value="locrian" ${board.scale==='locrian'?'selected':''}>Locrian (Diminished Root)</option>
                    </optgroup>
                  ` : `
                    <optgroup label="── MAJOR SCALES ──">
                        <option value="major" ${board.scale==='major'?'selected':''}>Major Scale (Bright)</option>
                        <option value="pentMajor" ${board.scale==='pentMajor'?'selected':''}>Major Pentatonic (Catchy)</option>
                    </optgroup>
                    <optgroup label="── RELATIVE MINOR (${relativeMinor}m) ──">
                        <option value="relMinor" ${board.scale==='relMinor'?'selected':''}>${relativeMinor}m Scale (Soft Minor)</option>
                        <option value="relMinorPent" ${board.scale==='relMinorPent'?'selected':''}>${relativeMinor}m Pentatonic (Classic Lead)</option>
                    </optgroup>
                    <optgroup label="── PARALLEL MINOR (${state.selectedKey}m) ──">
                        <option value="minor" ${board.scale==='minor'?'selected':''}>${state.selectedKey}m Scale (Dark Minor)</option>
                        <option value="pentMinor" ${board.scale==='pentMinor'?'selected':''}>${state.selectedKey}m Pentatonic (Blues/Rock)</option>
                    </optgroup>
                  `}
                </select>
                ${supportsBlues ? `<button class="blues-toggle-btn ${board.addBlues ? 'active' : ''}" data-action="toggleBlues" data-board-idx="${idx}" title="Add expressive blue notes">♭5</button>` : ''}
                <button class="scale-info-btn" data-action="showScaleInfo" data-scale="${board.scale}" title="Scale info">ⓘ</button>
                <button class="caged-toggle-btn ${board.showCaged ? 'active' : ''}" data-action="toggleCaged" data-board-idx="${idx}">CAGED</button>
                ${state.scaleBoards.length > 1 ? `<button class="remove-scale-btn" data-action="removeScaleBoard" data-board-idx="${idx}">×</button>` : ''}
              </div>
            </div>
            ${board.showCaged ? `
            <div class="caged-buttons" data-board-idx="${idx}">
              ${cagedPositions.map(pos => {
                // Position buttons to align with fret centers
                const nutPercent = 2.8;
                const fretPercent = (100 - nutPercent) / 15;
                let leftPos;
                if (pos.center === 0) {
                    leftPos = nutPercent / 2;
                } else {
                    leftPos = nutPercent + (pos.center - 0.5) * fretPercent;
                }
                return `
                <button class="caged-shape-btn ${board.selectedCaged === pos.shape ? 'active' : ''}"
                        data-action="selectCaged"
                        data-board-idx="${idx}"
                        data-shape="${pos.shape}"
                        style="left: ${leftPos.toFixed(1)}%">
                  ${pos.shape}
                </button>
              `}).join('')}
            </div>
            ` : ''}
            <div class="guitar-neck ${board.showCaged ? 'with-caged' : ''}" id="neck-${idx}"
                 data-selected-caged="${board.selectedCaged || ''}"
                 data-scale-type="${board.scale}"
                 data-scale-root="${scaleRoot}"></div>
          </div>
        `;
    });

    container.innerHTML = html;

    // Render each neck
    state.scaleBoards.forEach((board, idx) => {
        // Calculate actual scale root (same logic as above)
        let scaleRoot = state.selectedKey;
        let actualScaleType = board.scale;

        if (board.scale === 'relMinorPent' || board.scale === 'relMinor') {
            scaleRoot = getRelativeMinor(state.selectedKey);
            actualScaleType = board.scale === 'relMinorPent' ? 'pentMinor' : 'minor';
        }

        // Get CAGED highlight using the actual scale root
        const cagedHighlight = board.showCaged && board.selectedCaged ?
            getCAGEDPositions(scaleRoot, actualScaleType)[board.selectedCaged] : null;

        renderNeck(`neck-${idx}`, scaleRoot, actualScaleType, chordTones, cagedHighlight, board.addBlues || false);
    });
}

// Fretboard visual config
const FRETBOARD_CONFIG = {
    totalFrets: 15,
    inlayFrets: [3, 5, 7, 9, 15],
    doubleInlayFret: 12,
    blueNoteColor: '#6a9bd4'
};

function renderNeck(elId, keyRoot, scaleType, chordTones = new Set(), cagedHighlight = null, addBlues = false) {
    const el = document.getElementById(elId);
    const totalFrets = FRETBOARD_CONFIG.totalFrets;
    const scaleNotes = getScaleNotes(keyRoot, scaleType, addBlues);
    const noteMap = {};
    scaleNotes.forEach(n => noteMap[normalizeNoteName(n.note)] = n);

    // Determine which frets should be highlighted for CAGED
    const highlightedFrets = new Set();
    if (cagedHighlight) {
        for (let f = cagedHighlight.start; f <= cagedHighlight.end; f++) {
            highlightedFrets.add(f);
        }
        // Also highlight wrapped positions if any
        if (cagedHighlight.wrapsLow) {
            for (let f = cagedHighlight.wrapsLow.start; f <= cagedHighlight.wrapsLow.end; f++) {
                highlightedFrets.add(f);
            }
        }
    }

    let html = `<div class="fret-numbers"><div class="fnum nut ${highlightedFrets.has(0) ? 'caged-highlight' : ''}"></div>`;
    for(let i=1; i<=totalFrets; i++) html += `<div class="fnum ${highlightedFrets.has(i) ? 'caged-highlight' : ''}">${i}</div>`;
    html += `</div>`;
    const strings = [...Data.OPEN_STRINGS].reverse();
    strings.forEach((openStr, sIdx) => {
        const openIdx = noteToIndex(openStr);
        html += `<div class="neck-row"><div class="string-name">${openStr}</div>`;

        // NUT CELL - always render the cell, content only if note is in scale
        let noteName = normalizeNoteName(openStr);
        let scaleData = noteMap[noteName];
        let content = '';
        if (scaleData) {
            let isRoot = noteName === normalizeNoteName(keyRoot);
            let isChord = chordTones.has(noteName);
            let isBlue = scaleData.isBlue || false;
            let color = isBlue ? FRETBOARD_CONFIG.blueNoteColor : Data.NOTE_COLORS[noteName]; // Blue notes get special color
            content = `<div class="neck-note ${isRoot?'root':''} ${isChord?'chord-tone':''} ${isBlue?'blue-note':''}" style="background:${color}" data-note="${noteName}">
                <span class="note-interval">${scaleData.degree}</span>
                <span class="note-name">${noteName}</span>
            </div>`;
        }
        // ALWAYS render the nut cell with fixed width - content may be empty
        html += `<div class="fret-cell nut ${highlightedFrets.has(0) ? 'caged-highlight' : ''}">${content}</div>`;

        for(let f=1; f<=totalFrets; f++) {
            let idx = (openIdx + f) % 12;
            let n = normalizeNoteName(indexToNote(idx));
            scaleData = noteMap[n];
            content = '';
            // Inlay dots
            if (sIdx === 3 && FRETBOARD_CONFIG.inlayFrets.includes(f)) content += `<div class="inlay-dot"></div>`;
            if (f === FRETBOARD_CONFIG.doubleInlayFret) {
                 if (sIdx === 2) content += `<div class="inlay-dot" style="top:35%"></div>`;
                 if (sIdx === 4) content += `<div class="inlay-dot" style="top:65%"></div>`;
            }
            if (scaleData) {
                let isRoot = n === normalizeNoteName(keyRoot);
                let isChord = chordTones.has(n);
                let isBlue = scaleData.isBlue || false;
                let color = isBlue ? FRETBOARD_CONFIG.blueNoteColor : Data.NOTE_COLORS[n]; // Blue notes get special color
                content += `<div class="neck-note ${isRoot?'root':''} ${isChord?'chord-tone':''} ${isBlue?'blue-note':''}" style="background:${color}" data-note="${n}">
                    <span class="note-interval">${scaleData.degree}</span>
                    <span class="note-name">${n}</span>
                </div>`;
            }
            html += `<div class="fret-cell ${highlightedFrets.has(f) ? 'caged-highlight' : ''}">${content}</div>`;
        }
        html += `</div>`;
    });
    el.innerHTML = html;
}

// ========== ARPEGGIATOR ==========

// Get arpeggio shape positions
function getArpShapePositions(root) {
  const rootIdx = noteToIndex(root);

  // Base shapes in C - these represent playable arpeggio patterns from each position
  const baseShapes = {
    'E': { lowE: 0, start: 0, end: 4, center: 2 },   // Open position
    'D': { lowE: 2, start: 2, end: 5, center: 3 },   // 2nd position
    'C': { lowE: 3, start: 3, end: 7, center: 5 },   // 3rd position
    'A': { lowE: 5, start: 5, end: 9, center: 7 },   // 5th position
    'G': { lowE: 7, start: 7, end: 11, center: 9 }   // 7th position
  };

  const shapes = {};
  Object.keys(baseShapes).forEach(shape => {
    const base = baseShapes[shape];
    let start = base.start + rootIdx;
    let end = base.end + rootIdx;
    let center = base.center + rootIdx;

    // Wrap if goes past fret 15
    if (center > 15) {
      start -= 12;
      end -= 12;
      center -= 12;
    }

    shapes[shape] = {
      start: Math.max(0, start),
      end: Math.min(15, end),
      center: center
    };
  });

  return shapes;
}

function getSortedArpShapes(root) {
  const positions = getArpShapePositions(root);
  return ['E', 'D', 'C', 'A', 'G']
    .map(shape => ({ shape, ...positions[shape] }))
    .sort((a, b) => a.center - b.center);
}

function renderArpeggiator() {
    const container = document.getElementById('arpeggiatorContainer');
    if (!state.showArpeggiator) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');

    const chordName = getArpChordName();
    const chordTones = getArpChordTones();
    const arpShapes = getSortedArpShapes(state.arpRoot);

    const roots = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const qualities = [
        { val: '', label: 'Major' },
        { val: 'm', label: 'Minor' },
        { val: 'sus2', label: 'Sus2' },
        { val: 'sus4', label: 'Sus4' },
        { val: 'dim', label: 'Dim' },
        { val: 'aug', label: 'Aug' }
    ];
    const extensions = [
        { val: '', label: 'Triad' },
        { val: '6', label: '6' },
        { val: '7', label: '7' },
        { val: 'maj7', label: 'maj7' },
        { val: 'add9', label: 'add9' },
        { val: '9', label: '9' }
    ];

    let html = `
        <div class="arp-header">
            <span class="arp-title">Arpeggiator</span>
            <div class="arp-view-toggle">
                <button class="arp-view-btn ${state.arpViewMode === 'all' ? 'active' : ''}"
                        data-action="setArpView" data-view="all">All Notes</button>
                <button class="arp-view-btn ${state.arpViewMode === 'shapes' ? 'active' : ''}"
                        data-action="setArpView" data-view="shapes">Shapes</button>
            </div>
            <button class="popout-btn" data-action="popoutPanel" data-panel="arpeggiator" title="Pop out to window">⧉</button>
            <button class="panel-close-btn" data-action="toggleArpeggiator" title="Close">×</button>
        </div>`;

    // Render locked boards first
    state.arpLockedBoards.forEach((board, idx) => {
        html += `
        <div class="arp-locked-board">
            <div class="arp-locked-header">
                <span class="arp-locked-chord">${board.chordName}</span>
                <div class="arp-locked-tones">
                    ${board.tones.map(t => `
                        <span class="arp-tone mini" style="background:${Data.NOTE_COLORS[normalizeNoteName(t.note)] || '#666'}">
                            <span class="arp-tone-degree">${t.degree}</span>
                            <span class="arp-tone-note">${t.note}</span>
                        </span>
                    `).join('')}
                </div>
                <div class="arp-locked-view-toggle">
                    <button class="arp-view-btn ${board.viewMode === 'all' ? 'active' : ''}"
                            data-action="setLockedArpView" data-locked-idx="${idx}" data-view="all">All Notes</button>
                    <button class="arp-view-btn ${board.viewMode === 'shapes' ? 'active' : ''}"
                            data-action="setLockedArpView" data-locked-idx="${idx}" data-view="shapes">Shapes</button>
                </div>
                <button class="arp-unlock-btn" data-action="removeLockedArp" data-locked-idx="${idx}" title="Remove">×</button>
            </div>
            <div class="arp-neck-container">
                <div class="guitar-neck" id="arpLockedNeck${idx}"></div>
            </div>
        </div>`;
    });

    html += `
        <div class="arp-controls">
            <div class="arp-picker">
                <div class="arp-roots">
                    ${roots.map(r => `
                        <button class="arp-root-btn ${state.arpRoot === r ? 'active' : ''}"
                                data-action="setArpRoot" data-root="${r}">${r}</button>
                    `).join('')}
                </div>
                <div class="arp-selectors">
                    <div class="arp-selector-group">
                        <span class="arp-label">TYPE</span>
                        <div class="arp-buttons">
                            ${qualities.map(q => `
                                <button class="arp-qual-btn ${state.arpQuality === q.val ? 'active' : ''}"
                                        data-action="setArpQuality" data-quality="${q.val}">${q.label}</button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="arp-selector-group">
                        <span class="arp-label">EXTENSIONS</span>
                        <div class="arp-buttons">
                            ${extensions.map(e => `
                                <button class="arp-ext-btn ${state.arpExtension === e.val ? 'active' : ''}"
                                        data-action="setArpExtension" data-extension="${e.val}">${e.label}</button>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
            <div class="arp-result">
                <span class="arp-chord-name">${chordName}</span>
                <div class="arp-tones">
                    ${chordTones.map(t => `
                        <span class="arp-tone" style="background:${Data.NOTE_COLORS[normalizeNoteName(t.note)] || '#666'}">
                            <span class="arp-tone-degree">${t.degree}</span>
                            <span class="arp-tone-note">${t.note}</span>
                        </span>
                    `).join('')}
                </div>
                <button class="arp-play-btn" data-action="playArpChord">▶ Play</button>
                <button class="arp-lock-btn" data-action="lockArpBoard" title="Lock this fretboard and add another">🔒 Lock</button>
            </div>
        </div>
        ${state.arpViewMode === 'shapes' ? `
        <div class="arp-shapes-row">
            <span class="arp-shapes-label">Shape:</span>
            ${arpShapes.map(s => {
                const nutPercent = 2.8;
                const fretPercent = (100 - nutPercent) / 15;
                const leftPos = nutPercent + (s.center - 0.5) * fretPercent;
                return `
                <button class="arp-shape-btn ${state.arpSelectedShape === s.shape ? 'active' : ''}"
                        data-action="setArpShape" data-shape="${s.shape}"
                        style="left: ${leftPos.toFixed(1)}%">${s.shape}</button>
            `}).join('')}
        </div>
        ` : ''}
        <div class="arp-neck-container">
            <div class="guitar-neck" id="arpNeck"></div>
        </div>
    `;

    container.innerHTML = html;

    // Get highlighted fret range if in shapes mode
    let highlightRange = null;
    if (state.arpViewMode === 'shapes' && state.arpSelectedShape) {
        highlightRange = getArpShapePositions(state.arpRoot)[state.arpSelectedShape];
    }

    renderArpNeck('arpNeck', chordTones, highlightRange);

    // Render locked board fretboards
    state.arpLockedBoards.forEach((board, idx) => {
        let lockedHighlight = null;
        if (board.viewMode === 'shapes' && board.selectedShape) {
            const shapes = getArpShapePositions(board.root);
            lockedHighlight = shapes[board.selectedShape];
        }
        renderArpNeck(`arpLockedNeck${idx}`, board.tones, lockedHighlight);
    });
}

function getArpChordName() {
    let name = state.arpRoot;
    if (state.arpQuality === 'm') name += 'm';
    else if (state.arpQuality === 'dim') name += '°';
    else if (state.arpQuality === 'aug') name += '+';
    else if (state.arpQuality) name += state.arpQuality;
    if (state.arpExtension) name += state.arpExtension;
    return name;
}

function getArpChordTones() {
    const root = state.arpRoot;
    const quality = state.arpQuality;
    const ext = state.arpExtension;

    // Use the Audio module to get chord tones
    const chordName = getArpChordName();
    const rawTones = Audio.getChordTones(root, quality + ext);

    // Map intervals to degree labels
    const intervalToDegree = {
        0: 'R',
        2: '2',
        3: 'b3',
        4: '3',
        5: '4',
        6: 'b5',
        7: '5',
        8: '#5',
        9: '6',
        10: 'b7',
        11: '7',
        14: '9'
    };

    return rawTones.map(t => ({
        note: t.note,
        degree: intervalToDegree[t.interval] || t.interval.toString()
    }));
}

function renderArpNeck(elId, chordTones, highlightRange = null) {
    const el = document.getElementById(elId);
    if (!el) return;

    const totalFrets = 15;
    const toneMap = {};
    chordTones.forEach(t => toneMap[normalizeNoteName(t.note)] = t);

    // Build highlighted frets set
    const highlightedFrets = new Set();
    if (highlightRange) {
        for (let f = highlightRange.start; f <= highlightRange.end; f++) {
            highlightedFrets.add(f);
        }
    }

    let html = `<div class="fret-numbers"><div class="fnum nut ${highlightedFrets.has(0) ? 'caged-highlight' : ''}"></div>`;
    for(let i=1; i<=totalFrets; i++) html += `<div class="fnum ${highlightedFrets.has(i) ? 'caged-highlight' : ''}">${i}</div>`;
    html += `</div>`;

    const strings = [...Data.OPEN_STRINGS].reverse();
    strings.forEach((openStr, sIdx) => {
        const openIdx = noteToIndex(openStr);
        html += `<div class="neck-row"><div class="string-name">${openStr}</div>`;

        // NUT CELL
        let noteName = normalizeNoteName(openStr);
        let toneData = toneMap[noteName];
        let content = '';
        const showNut = !highlightRange || highlightedFrets.has(0);
        if (toneData && showNut) {
            let isRoot = toneData.degree === 'R' || toneData.degree === '1';
            let color = Data.NOTE_COLORS[noteName];
            content = `<div class="neck-note ${isRoot?'root':''} arp-tone-note" style="background:${color}" data-note="${noteName}">
                <span class="note-interval">${toneData.degree}</span>
                <span class="note-name">${noteName}</span>
            </div>`;
        }
        html += `<div class="fret-cell nut ${highlightedFrets.has(0) ? 'caged-highlight' : ''}">${content}</div>`;

        // FRET CELLS
        for(let f=1; f<=totalFrets; f++) {
            let idx = (openIdx + f) % 12;
            let n = normalizeNoteName(indexToNote(idx));
            toneData = toneMap[n];
            content = '';

            // Inlay dots
            if (sIdx === 3 && [3,5,7,9,15].includes(f)) content += `<div class="inlay-dot"></div>`;
            if (f === 12) {
                if (sIdx === 2) content += `<div class="inlay-dot" style="top:35%"></div>`;
                if (sIdx === 4) content += `<div class="inlay-dot" style="top:65%"></div>`;
            }

            // Only show notes if no highlight range, or if fret is in range
            const showFret = !highlightRange || highlightedFrets.has(f);
            if (toneData && showFret) {
                let isRoot = toneData.degree === 'R' || toneData.degree === '1';
                let color = Data.NOTE_COLORS[n];
                content += `<div class="neck-note ${isRoot?'root':''} arp-tone-note" style="background:${color}" data-note="${n}">
                    <span class="note-interval">${toneData.degree}</span>
                    <span class="note-name">${n}</span>
                </div>`;
            }
            html += `<div class="fret-cell ${highlightedFrets.has(f) ? 'caged-highlight' : ''}">${content}</div>`;
        }
        html += `</div>`;
    });

    el.innerHTML = html;
}

function renderScalePopup() {
    const container = document.getElementById('scaleContent');
    const scaleNotes = getScaleNotes(state.selectedKey, 'major');
    const labels = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];

    container.innerHTML = `
        <h3 style="color:#c9a227; margin-bottom:20px; text-align:center;">Scale Degrees in ${state.selectedKey} Major</h3>
        <div class="degree-grid">
            ${scaleNotes.map((n, i) => `
                <div class="degree-card">
                    <div class="deg-num">${labels[i] || n.degree}</div>
                    <div class="deg-note" style="color:${Data.NOTE_COLORS[normalizeNoteName(n.note)] || '#fff'}">${n.note}</div>
                </div>
            `).join('')}
        </div>
        <p style="color:#888; margin-top:25px; text-align:center; font-size:14px;">
            Major chords on I, IV, V. Minor chords on ii, iii, vi. Diminished on vii°.
        </p>
    `;
}

// ========== CHORD PICKER ==========
// BUG FIX #7: Handle extensions like dim7, aug7, sus27, sus47
function getPickerChord() {
    let chord = state.pickerRoot + state.pickerQuality;

    if (state.pickerExtension) {
        // Special cases for extensions
        if (state.pickerQuality === 'dim' && state.pickerExtension === '7') {
            chord = state.pickerRoot + 'dim7';
        } else if (state.pickerQuality === 'aug' && state.pickerExtension === '7') {
            chord = state.pickerRoot + 'aug7';
        } else if (state.pickerQuality === 'sus2' && state.pickerExtension === '7') {
            chord = state.pickerRoot + '7sus2';  // 7 takes precedence
        } else if (state.pickerQuality === 'sus4' && state.pickerExtension === '7') {
            chord = state.pickerRoot + '7sus4';  // 7 takes precedence
        } else if (state.pickerQuality === 'm' && state.pickerExtension === '7') {
            chord = state.pickerRoot + 'm7';
        } else if (state.pickerQuality === 'm' && state.pickerExtension === 'maj7') {
            chord = state.pickerRoot + 'mMaj7';
        } else if (state.pickerExtension === 'maj7' && state.pickerQuality === '') {
            chord = state.pickerRoot + 'maj7';
        } else {
            chord = state.pickerRoot + state.pickerQuality + state.pickerExtension;
        }
    }
    return chord;
}

function updatePickerResult() {
    const resultEl = document.getElementById('pickerResultChord');
    resultEl.textContent = getPickerChord();
}

function renderChordPicker() {
    const popup = document.getElementById('chordPickerPopup');
    popup.classList.toggle('hidden', !state.showChordPicker);

    if (!state.showChordPicker) return;

    // Render root note grid
    const rootGrid = document.getElementById('rootNoteGrid');
    const roots = [
        {note: 'C', alt: ''}, {note: 'C#', alt: 'Db'},
        {note: 'D', alt: ''}, {note: 'D#', alt: 'Eb'},
        {note: 'E', alt: ''}, {note: 'F', alt: ''},
        {note: 'F#', alt: 'Gb'}, {note: 'G', alt: ''},
        {note: 'G#', alt: 'Ab'}, {note: 'A', alt: ''},
        {note: 'A#', alt: 'Bb'}, {note: 'B', alt: ''}
    ];

    rootGrid.innerHTML = roots.map(r => `
        <button class="root-note-btn ${state.pickerRoot === r.note ? 'active' : ''}" data-root="${r.note}">
            ${r.note}
            ${r.alt ? `<span class="sharp-flat">${r.alt}</span>` : ''}
        </button>
    `).join('');

    // Update quality button states
    document.querySelectorAll('.quality-btn[data-quality]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.quality === state.pickerQuality);
    });
    document.querySelectorAll('.quality-btn[data-ext]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.ext === state.pickerExtension);
    });

    // Update result
    updatePickerResult();
}

// ========== KEY FINDER ==========
function renderKeyFinder() {
    const popup = document.getElementById('keyFinderPopup');
    if (!popup) return;
    popup.classList.toggle('hidden', !state.showKeyFinder);

    if (!state.showKeyFinder) return;

    // Render root note grid
    const rootGrid = document.getElementById('kfRootGrid');
    if (rootGrid) {
        const roots = [
            {note: 'C', alt: ''}, {note: 'C#', alt: 'Db'},
            {note: 'D', alt: ''}, {note: 'D#', alt: 'Eb'},
            {note: 'E', alt: ''}, {note: 'F', alt: ''},
            {note: 'F#', alt: 'Gb'}, {note: 'G', alt: ''},
            {note: 'G#', alt: 'Ab'}, {note: 'A', alt: ''},
            {note: 'A#', alt: 'Bb'}, {note: 'B', alt: ''}
        ];

        rootGrid.innerHTML = roots.map(r => `
            <button class="kf-root-btn ${state.kfRoot === r.note ? 'active' : ''}" data-kf-root="${r.note}">
                ${r.note}
                ${r.alt ? `<small>${r.alt}</small>` : ''}
            </button>
        `).join('');
    }

    // Update quality button states
    document.querySelectorAll('.kf-quality-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.kfQuality === state.kfQuality);
    });

    // Update preview
    const preview = document.getElementById('kfPreview');
    if (preview) {
        preview.textContent = state.kfRoot + state.kfQuality;
    }

    // Render chords in progression
    const progEl = document.getElementById('kfProgression');
    if (progEl) {
        if (state.kfChords.length === 0) {
            progEl.innerHTML = '<span class="kf-empty">Add chords above...</span>';
        } else {
            progEl.innerHTML = state.kfChords.map((c, i) => `
                ${i > 0 ? '<span class="kf-arrow">→</span>' : ''}
                <div class="kf-chord">
                    ${c}
                    <span class="kf-remove" data-action="kfRemoveChord" data-idx="${i}">×</span>
                </div>
            `).join('');
        }
    }

    // Calculate and show possible keys
    const resultEl = document.getElementById('kfResultKeys');
    if (resultEl) {
        const possibleKeys = findPossibleKeys(state.kfChords);
        if (possibleKeys.length === 0) {
            resultEl.textContent = state.kfChords.length > 0 ? 'No common key found' : '-';
            resultEl.style.color = '#888';
            state.kfResultKey = null;
            state.kfResultType = null;
        } else {
            // Auto-select first key if none selected or selection no longer valid
            const currentValid = possibleKeys.some(k => k.key === state.kfResultKey && k.type === state.kfResultType);
            if (!currentValid) {
                state.kfResultKey = possibleKeys[0].key;
                state.kfResultType = possibleKeys[0].type;
            }

            resultEl.innerHTML = possibleKeys.map(keyResult => {
                const normC = (c) => {
                    if (!c) return '';
                    return c.replace('♭', 'b').replace('♯', '#');
                };
                const parseCN = (c) => {
                    const m = c.match(/^([A-G][#b]?)(.*)/);
                    if (!m) return { root: c, quality: '' };
                    return { root: m[1], quality: m[2] };
                };
                const isMinorQ = (q) => q.startsWith('m') && !q.startsWith('maj');

                const isSelected = state.kfResultKey === keyResult.key && state.kfResultType === keyResult.type;

                const chordRows = keyResult.diatonic.map((chord, idx) => {
                    const kcNorm = normC(chord);
                    const kp = parseCN(kcNorm);
                    const ENH = { 'C#':'Db','Db':'C#','D#':'Eb','Eb':'D#','F#':'Gb','Gb':'F#','G#':'Ab','Ab':'G#','A#':'Bb','Bb':'A#' };
                    const isMatched = state.kfChords.some(uc => {
                        const ucNorm = normC(uc);
                        if (ucNorm === kcNorm) return true;
                        // Check enharmonic exact match
                        const up = parseCN(ucNorm);
                        const enhRoot = ENH[up.root];
                        if (enhRoot && (enhRoot + up.quality) === kcNorm) return true;
                        if (up.root !== kp.root && (!enhRoot || enhRoot !== kp.root)) return false;
                        return isMinorQ(up.quality) === isMinorQ(kp.quality);
                    });

                    const className = isMatched ? 'kf-key-chord-item matched' : 'kf-key-chord-item';
                    const action = isMatched ? '' : `data-action="kfAddChord" data-chord="${chord}"`;

                    return `
                        <div class="${className}" ${action}>
                            <div class="kf-key-chord-roman">${keyResult.romans[idx] || ''}</div>
                            <div class="kf-key-chord-name">${chord}</div>
                        </div>
                    `;
                }).join('');

                const typeLabel = keyResult.type === 'minor' ? 'minor' : 'major';

                return `
                    <div class="kf-key-block ${isSelected ? 'selected' : ''}">
                        <div class="kf-key-header">
                            <div class="kf-key-name">${keyResult.key} ${typeLabel}</div>
                            <button class="kf-select-btn ${isSelected ? 'active' : ''}"
                                    data-action="kfSelectKey" data-key="${keyResult.key}" data-type="${keyResult.type}">
                                ${isSelected ? '✓ Selected' : 'Select'}
                            </button>
                        </div>
                        <div class="kf-key-chords">${chordRows}</div>
                    </div>
                `;
            }).join('');

            resultEl.style.color = '#c8a04a';
        }
    }
}

// Classify a chord's relationship to the key: 'diatonic', 'borrowed', 'secondary-dom', or 'outside'
// Uses lenient matching: strips slash bass notes and extensions, matches on root + base quality
function classifyChordInKey(chordName, keyResult) {
    if (!chordName || chordName === '?' || !keyResult) return 'diatonic'; // don't flag unknowns
    const normalizeChord = (c) => c ? c.replace('♭', 'b').replace('♯', '#') : '';
    const ENHARMONICS = { 'C#':'Db','Db':'C#','D#':'Eb','Eb':'D#','F#':'Gb','Gb':'F#','G#':'Ab','Ab':'G#','A#':'Bb','Bb':'A#' };
    const rootsMatch = (a, b) => a === b || ENHARMONICS[a] === b;

    const baseChord = normalizeChord(getBaseChord(chordName));
    const parseChordName = (c) => {
        const m = c.match(/^([A-G][#b]?)(.*)/);
        if (!m) return { root: c, quality: '' };
        return { root: m[1], quality: m[2] };
    };
    const inp = parseChordName(baseChord);
    const isMinor = (q) => q.startsWith('m') && !q.startsWith('maj');
    const isSpecial = (q) => q.startsWith('dim') || q.startsWith('+') || q.startsWith('aug');

    const chordMatchesPool = (pool) => {
        const normalizedPool = pool.filter(c => c).map(c => normalizeChord(getBaseChord(c)));
        return normalizedPool.some(kc => {
            if (kc === baseChord) return true;
            const enharmonicNorm = ENHARMONICS[inp.root] ? ENHARMONICS[inp.root] + inp.quality : null;
            if (enharmonicNorm && kc === enharmonicNorm) return true;
            const k = parseChordName(kc);
            if (!rootsMatch(inp.root, k.root)) return false;
            if (isSpecial(inp.quality) || isSpecial(k.quality)) return inp.quality === k.quality;
            return isMinor(inp.quality) === isMinor(k.quality);
        });
    };

    // Get pools for this key
    const keyName = keyResult.key;
    const keyType = keyResult.type;
    let keyData;
    if (keyType === 'major') {
        keyData = Data.CHORD_DATA[keyName];
    } else {
        const minorRootIdx = noteToIndex(keyName);
        const relMajorIdx = (minorRootIdx + 3) % 12;
        const relMajor = indexToNote(relMajorIdx);
        keyData = Data.CHORD_DATA[relMajor];
    }
    if (!keyData) return 'diatonic';

    // Sus chords: root-only match (sus quality is ambiguous major/minor)
    if (inp.quality === 'sus') {
        const susRootMatchesPool = (pool) => {
            return pool.filter(c => c).some(kc => {
                const kcRoot = parseChordName(normalizeChord(getBaseChord(kc))).root;
                return rootsMatch(inp.root, kcRoot);
            });
        };
        if (susRootMatchesPool(keyData.diatonic)) return 'diatonic';
        if (susRootMatchesPool(keyData.modal)) return 'borrowed';
        return 'outside';
    }

    // Check pools in order of priority
    if (chordMatchesPool(keyData.diatonic)) return 'diatonic';
    if (chordMatchesPool(keyData.modal)) return 'borrowed';
    // Secondary dominants require a dominant quality (contains 7, 9, 11, 13)
    // A plain major triad matching a secDom root is classified as 'borrowed' instead
    if (keyData.secDom && chordMatchesPool(keyData.secDom)) {
        const origQuality = normalizeChord(chordName).replace(/^[A-G][#b]?/, '');
        const isDominant = /7|9|11|13/.test(origQuality) && !origQuality.startsWith('maj7');
        return isDominant ? 'secondary-dom' : 'dom-triad';
    }
    // Check borrowed chords from other modes (Lydian, Mixolydian, Phrygian, Dom Triads)
    // Use the major key root for borrowed chord generation (keyData is always for the major key)
    const majorKeyName = keyType === 'major' ? keyName : indexToNote((noteToIndex(keyName) + 3) % 12, keyName.includes('b'));
    const borrowedModes = generateBorrowedChords(majorKeyName, keyData);
    if (borrowedModes.lydian.length > 0 && chordMatchesPool(borrowedModes.lydian.map(c => c.chord))) return 'lydian';
    if (borrowedModes.mixolydian.length > 0 && chordMatchesPool(borrowedModes.mixolydian.map(c => c.chord))) return 'mixolydian';
    if (borrowedModes.phrygian.length > 0 && chordMatchesPool(borrowedModes.phrygian.map(c => c.chord))) return 'phrygian';
    if (borrowedModes.secDomTriads && borrowedModes.secDomTriads.length > 0 && chordMatchesPool(borrowedModes.secDomTriads.map(c => c.chord))) return 'dom-triad';
    return 'outside';
}

// Legacy wrapper for key detection (still needs combined pool check)
function isChordInKey(chordName, keyResult) {
    return classifyChordInKey(chordName, keyResult) !== 'outside';
}

// Detect the key for a single progression line, using shape notes when available
function detectLineKey(line) {
    if (!line.chords || line.chords.length < 2) return null;

    // Build chord name list: prefer shape-detected names, fall back to chord name
    const chordNames = line.chords.map(item => {
        if (item.shape && item.shape.frets) {
            const { pitchClasses, notes } = Audio.extractNotesFromShape(item.shape.frets);
            if (pitchClasses.size >= 2) {
                const detection = Audio.detectChordFromNotes(pitchClasses, notes);
                if (detection && detection.confidence > 0.4) {
                    return detection.isSlash ? detection.slashChord : detection.chord;
                }
            }
        }
        return item.chord;
    }).filter(c => c && c !== '?');

    if (chordNames.length < 2) return null;

    const keys = findPossibleKeys(chordNames);
    if (keys.length === 0) return null;

    return { best: keys[0], all: keys.slice(0, 3), chordNames };
}

// Detect overall key across all progression lines
function detectOverallKey() {
    const allChords = [];
    state.progressionLines.forEach(line => {
        line.chords.forEach(item => {
            if (item.shape && item.shape.frets) {
                const { pitchClasses, notes } = Audio.extractNotesFromShape(item.shape.frets);
                if (pitchClasses.size >= 2) {
                    const detection = Audio.detectChordFromNotes(pitchClasses, notes);
                    if (detection && detection.confidence > 0.4) {
                        allChords.push(detection.isSlash ? detection.slashChord : detection.chord);
                        return;
                    }
                }
            }
            if (item.chord && item.chord !== '?') allChords.push(item.chord);
        });
    });

    if (allChords.length < 2) return null;
    const keys = findPossibleKeys(allChords);
    if (keys.length === 0) return null;
    return { best: keys[0], all: keys.slice(0, 3) };
}

function findPossibleKeys(chords) {
    if (chords.length === 0) return [];

    const keys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'];
    const results = [];

    const normalizeChord = (c) => {
        if (!c) return '';
        return c.replace('♭', 'b').replace('♯', '#');
    };

    // Parse chord into root note and quality (e.g. "D#m" → {root:"D#", quality:"m"})
    const parseChordName = (c) => {
        const m = c.match(/^([A-G][#b]?)(.*)/);
        if (!m) return { root: c, quality: '' };
        return { root: m[1], quality: m[2] };
    };

    // Enharmonic equivalents — A# = Bb, C# = Db, etc.
    const ENHARMONICS = { 'C#':'Db','Db':'C#','D#':'Eb','Eb':'D#','F#':'Gb','Gb':'F#','G#':'Ab','Ab':'G#','A#':'Bb','Bb':'A#' };
    const rootsMatch = (a, b) => a === b || ENHARMONICS[a] === b;

    const chordFits = (chord, keyChords) => {
        // Use base chord for lenient matching (strip slash bass, simplify extensions)
        const base = normalizeChord(getBaseChord(chord));
        const inp = parseChordName(base);

        return keyChords.some(kc => {
            const kcBase = normalizeChord(getBaseChord(kc));
            // Exact match
            if (kcBase === base) return true;
            // Enharmonic exact match (e.g. "A#m" vs "Bbm")
            const enharmonicNorm = ENHARMONICS[inp.root] ? ENHARMONICS[inp.root] + inp.quality : null;
            if (enharmonicNorm && kcBase === enharmonicNorm) return true;

            const k = parseChordName(kcBase);

            // Roots must match (including enharmonic equivalents)
            if (!rootsMatch(inp.root, k.root)) return false;

            // Check quality compatibility:
            // Both major-family or both minor-family
            const isMinor = (q) => q.startsWith('m') && !q.startsWith('maj');
            const inputIsMinor = isMinor(inp.quality);
            const kcIsMinor = isMinor(k.quality);

            // dim/aug are special — match exactly or by root
            const isSpecial = (q) => q.startsWith('dim') || q.startsWith('+') || q.startsWith('aug');
            if (isSpecial(inp.quality) || isSpecial(k.quality)) {
                return inp.quality === k.quality;
            }

            return inputIsMinor === kcIsMinor;
        });
    };

    // --- Chord type helpers ---
    const isDom7Chord = (chord) => {
        const base = normalizeChord(chord);
        const quality = base.replace(/^[A-G][#b]?/, '');
        return (/7|9|11|13/.test(quality) && !quality.startsWith('maj') && !quality.startsWith('m'));
    };

    const isSusChord = (chord) => {
        const base = normalizeChord(getBaseChord(chord));
        return base.endsWith('sus');
    };

    // Check if a chord root is a perfect 5th (7 semitones) above a key root
    const isPrimaryDominant = (chordRoot, keyRoot) => {
        const chordIdx = noteToIndex(chordRoot);
        const keyIdx = noteToIndex(keyRoot);
        if (chordIdx < 0 || keyIdx < 0) return false;
        return ((keyIdx + 7) % 12) === chordIdx;
    };

    // Blues I7 / IV7: in a 12-bar-blues idiom, the tonic and subdominant are
    // played as dominant 7ths (e.g. C7 and F7 in C blues). The doc note
    // "C7 as I7 routes to secDom" intends these to score like secondary
    // dominants. Returns true if chordRoot === keyRoot (I7) or chordRoot is
    // a perfect 4th above keyRoot (IV7).
    const isBluesI7orIV7 = (chordRoot, keyRoot) => {
        const chordIdx = noteToIndex(chordRoot);
        const keyIdx = noteToIndex(keyRoot);
        if (chordIdx < 0 || keyIdx < 0) return false;
        const interval = ((chordIdx - keyIdx) + 12) % 12;
        return interval === 0 || interval === 5; // I (unison) or IV (P4)
    };

    // Sus chord root-only matching: matches any pool chord sharing the same root
    const susRootFitsDiatonic = (chord, diatonicPool) => {
        const base = normalizeChord(getBaseChord(chord));
        const susRoot = parseChordName(base).root;
        return diatonicPool.some(kc => {
            const kcRoot = parseChordName(normalizeChord(getBaseChord(kc))).root;
            return rootsMatch(susRoot, kcRoot);
        });
    };

    // --- Weighted scoring ---
    // Diatonic = 1.0, Modal = 0.6, SecDom = 0.4
    // V7 exception: dom7 whose root is P5 above key root → immediate 1.0
    // Sus exception: root-only match against diatonic pool → 1.0
    const weightedScore = (inputChords, keyData, keyRoot) => {
        const diatonicPool = keyData.diatonic.map(normalizeChord);
        const modalPool = keyData.modal.map(normalizeChord);
        const secDomPool = (keyData.secDom || []).filter(c => c).map(normalizeChord);

        let totalWeight = 0;
        let fitCount = 0;
        // V7 exception fires AT MOST ONCE per candidate key. Hearing V7→I once is
        // strong evidence; subsequent occurrences of the same V7 chord are not
        // independent evidence — they fall through to normal pool matching
        // (typically secDom). Without this cap, a progression like
        // C7-F7-C7-G7-F7-C7 would score F major higher than C major because
        // four C7s would each fire +1.0 against F (root P5 above F = C).
        let v7ExceptionFired = false;
        inputChords.forEach(chord => {
            const dom7 = isDom7Chord(chord);
            const sus = isSusChord(chord);
            const chordRoot = parseChordName(normalizeChord(getBaseChord(chord))).root;

            // 1. V7 exception: primary dominant 7th → immediate 1.0 (skip pool)
            //    Only the first occurrence per key fires; later occurrences fall through.
            if (dom7 && isPrimaryDominant(chordRoot, keyRoot) && !v7ExceptionFired) {
                totalWeight += 1.0;
                fitCount++;
                v7ExceptionFired = true;
                return;
            }

            // 2. Sus exception: root-only match against diatonic → 1.0
            if (sus) {
                if (susRootFitsDiatonic(chord, diatonicPool)) {
                    totalWeight += 1.0;
                    fitCount++;
                } else if (susRootFitsDiatonic(chord, modalPool)) {
                    totalWeight += 0.6;
                    fitCount++;
                }
                return;
            }

            // 3. Normal matching: dom7s excluded from diatonic/modal
            if (!dom7 && chordFits(chord, diatonicPool)) {
                totalWeight += 1.0;
                fitCount++;
            } else if (!dom7 && chordFits(chord, modalPool)) {
                totalWeight += 0.6;
                fitCount++;
            } else if (chordFits(chord, secDomPool)) {
                totalWeight += 0.4;
                fitCount++;
            } else if (dom7 && isBluesI7orIV7(chordRoot, keyRoot)) {
                // Blues idiom: I7 or IV7 of candidate key (e.g. C7 / F7 in C
                // blues). Score as secDom-equivalent so a 12-bar-blues
                // progression (C7-F7-C7-G7-F7-C7) detects as C, not Bb or F.
                totalWeight += 0.4;
                fitCount++;
            }
        });
        const score = inputChords.length > 0 ? totalWeight / inputChords.length : 0;
        return { score, fitCount };
    };

    // Check major keys
    keys.forEach(key => {
        const keyData = Data.CHORD_DATA[key];
        if (!keyData) return;

        const { score, fitCount } = weightedScore(chords, keyData, key);

        if (fitCount >= 2 && score >= 0.4) {
            results.push({
                key: key,
                type: 'major',
                score: score,
                fitCount: fitCount,
                diatonic: keyData.diatonic,
                romans: ['I', 'ii', 'iii', 'IV', 'V', 'vi']
            });
        }
    });

    // Check minor keys
    keys.forEach(key => {
        const minorRootIdx = noteToIndex(key);
        const relMajorIdx = (minorRootIdx + 3) % 12;
        const relMajor = indexToNote(relMajorIdx);
        const keyData = Data.CHORD_DATA[relMajor];
        if (!keyData) return;

        // Pass minor key root so V7 check uses the minor tonic (e.g. A for Am)
        const { score, fitCount } = weightedScore(chords, keyData, key);

        if (fitCount >= 2 && score >= 0.5) {
            // Reorder diatonic starting from minor root
            const diatonic = [...keyData.diatonic];
            const minorRootNorm = normalizeChord(key);
            const minorChord = diatonic.find(c => normalizeChord(c).replace('m','') === minorRootNorm || normalizeChord(c) === minorRootNorm + 'm');

            let reordered;
            if (minorChord) {
                const idx = diatonic.indexOf(minorChord);
                reordered = [...diatonic.slice(idx), ...diatonic.slice(0, idx)];
            } else {
                reordered = diatonic;
            }

            results.push({
                key: key,
                type: 'minor',
                score: score,
                fitCount: fitCount,
                diatonic: reordered,
                romans: ['i', 'III', 'iv', 'v', 'VI', 'VII']
            });
        }
    });

    // Root chord frequency bonus: count how many times the candidate's
    // root chord appears in the progression. This breaks relative major/minor
    // ties by favouring the key whose tonic is heard most often.
    //
    // Sus chords are excluded from this count: a sus chord is functionally
    // ambiguous (it's neither major nor minor), so e.g. Csus2 should NOT count
    // as evidence of C major. Without this exclusion, Dsus4-Csus2-G ties C
    // major and G major at 1.02 (both get +0.02 — G major from the literal G,
    // C major from Csus2 simplified to C), and the alphabetical tiebreaker
    // hands the win to C even though G major is the correct answer.
    results.forEach(r => {
        const rootNorm = normalizeChord(r.key);
        // For major keys, look for the major triad root (e.g. "C")
        // For minor keys, look for the minor triad root (e.g. "Am")
        const targetRoot = r.type === 'minor' ? rootNorm + 'm' : rootNorm;
        let rootCount = 0;
        chords.forEach(chord => {
            const base = normalizeChord(getBaseChord(chord));
            const chordParsed = parseChordName(base);
            // Skip sus chords — they don't establish a major or minor tonic.
            if (chordParsed.quality === 'sus') return;
            const targetParsed = parseChordName(targetRoot);
            if (rootsMatch(chordParsed.root, targetParsed.root)) {
                const isMinor = (q) => q.startsWith('m') && !q.startsWith('maj');
                if (isMinor(chordParsed.quality) === isMinor(targetParsed.quality)) {
                    rootCount++;
                }
            }
        });
        r.score += rootCount * 0.02;
    });

    // Sort by score descending, with stable tiebreakers:
    // 1. Higher fitCount wins
    // 2. Major beats minor at same score
    // 3. Alphabetical key name as final fallback
    results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if ((b.fitCount || 0) !== (a.fitCount || 0)) return (b.fitCount || 0) - (a.fitCount || 0);
        if (a.type !== b.type) return a.type === 'major' ? -1 : 1;
        return a.key.localeCompare(b.key);
    });
    return results.slice(0, 6);
}

function setupEventListeners() {
    // Initialize audio on first click (required for Safari)
    let audioInitialized = false;

    document.body.addEventListener('click', async e => {
        // Initialize audio on first interaction - MUST await for Safari.
        // Hardened: a stalled resume() must never wedge the click pipeline
        // (every later play call re-attempts resume via getAudioContext).
        if (!audioInitialized) {
            audioInitialized = true;
            try {
                await Promise.race([
                    Audio.initAudio(),
                    new Promise(resolve => setTimeout(resolve, 1500))
                ]);
            } catch (e) { /* audio unlocks on a later gesture */ }
        }

        // Key selection - transpose progression instead of clearing
        if (e.target.closest('.key-btn')) {
            const newKey = e.target.closest('.key-btn').dataset.key;
            const hasChords = state.progressionLines.some(line => line.chords.length > 0);

            if (hasChords) {
                // Just change key - chords will transpose on render
                state.selectedKey = newKey;
            } else {
                // No chords yet, also update progression key
                state.selectedKey = newKey;
                state.progressionKey = newKey;
            }
            state.selectedChordForDetail = null;
            // Collapse the key picker now that a key has been chosen.
            const keySel = document.getElementById('keySelector');
            if (keySel) keySel.classList.remove('open');
            render();
            // If the analysis panel is currently showing, re-run it against
            // the new key so it stays in sync without the user having to
            // click the lightbulb again.
            refreshActiveAnalysis();
            saveStateToLocalStorage();
        }
        if (e.target.closest('.tab-btn')) {
            state.selectedTab = e.target.closest('.tab-btn').dataset.tab;
            state.highlightedChords.clear();
            // Collapse the tab picker now that a mode has been chosen.
            const tabSel = document.querySelector('.controls-left');
            if (tabSel) tabSel.classList.remove('tab-expander-open');
            // Toggle dark mode background
            if (state.selectedTab === 'dark') {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
            render();
            // Major/minor mode change: re-run analysis if it's currently open.
            refreshActiveAnalysis();
            saveStateToLocalStorage();
        }
        // Chord Click
        const chordBox = e.target.closest('.chord-box');
        if (chordBox && !chordBox.classList.contains('empty')) {
            const chord = chordBox.dataset.chord;
            const id = chordBox.dataset.id;
            const roman = chordBox.dataset.roman;
            // Play audio immediately — wrapped in try/catch so UI still works if audio fails
            try { Audio.playChord(chord); } catch(err) { console.warn('Audio playback error:', err); }
            // Free-play mode: when no line is selected (currentLineIndex < 0)
            // the click only auditions the chord — it does NOT get added to
            // the progression. The user enters this mode by clicking the
            // already-selected line's header (toggle).
            const inFreePlay = state.currentLineIndex == null || state.currentLineIndex < 0
                || !state.progressionLines[state.currentLineIndex];
            if (inFreePlay) {
                showChordDetail(chord, roman);
                return;
            }
            // Add to current line with roman numeral for transposition
            pushUndoState();
            const _curLine = state.progressionLines[state.currentLineIndex];
            _curLine.chords.push({chord, roman, id, active:false, beats:4, accent:'norm', start: lineNextStart(_curLine)});
            // Set progression key on first chord added
            if (state.progressionLines.every(line => line.chords.length <= 1)) {
                state.progressionKey = state.selectedKey;
            }
            state.highlightedChords.add(id);
            try {
                renderChordGrid();
                renderProgression();
                showChordDetail(chord, roman);
            } catch(err) { console.warn('Render error after chord click:', err); }
            setTimeout(() => { state.highlightedChords.delete(id); try { renderChordGrid(); } catch(e) {} }, 500);
            saveStateToLocalStorage();
        }
        // Chord Tone Click
        const toneStack = e.target.closest('.tone-stack');
        if (toneStack && !e.target.closest('.chord-box')) {
            const note = toneStack.dataset.note;
            if (note) Audio.playNote(note, 4);
        }
        // Fretboard Note Click
        const neckNote = e.target.closest('.neck-note');
        if (neckNote) {
            const note = neckNote.dataset.note;
            if (note) Audio.playNote(note, 4);
        }
        // Progression chord click
        if (e.target.closest('.progression-chord') && !e.target.closest('.remove-btn') && !e.target.closest('.chord-shape-btn')) {
            const el = e.target.closest('.progression-chord');
            const c = el.dataset.chord;
            const roman = el.dataset.roman || '';
            const lineIdx = parseInt(el.dataset.line);
            // Also select the line
            if (lineIdx !== state.currentLineIndex) {
                state.currentLineIndex = lineIdx;
                renderProgression();
            }
            Audio.playChord(c);
            showChordDetail(c, roman);
        }
        // Click on line-chords container to select line
        if (e.target.closest('.line-chords') && !e.target.closest('.progression-chord')) {
            const lineIdx = parseInt(e.target.closest('.line-chords').dataset.line);
            if (lineIdx !== state.currentLineIndex) {
                state.currentLineIndex = lineIdx;
                renderProgression();
            }
        }
        // Edit chord shape
        const shapeBtn = e.target.closest('[data-action="editChordShape"]');
        if (shapeBtn) {
            e.stopPropagation();
            const lineIdx = parseInt(shapeBtn.dataset.line);
            const chordIdx = parseInt(shapeBtn.dataset.idx);
            showChordShapeEditor(lineIdx, chordIdx);
        }
        // v112: cycle chord length ½ → 1 → 2 bars
        const lenBtn = e.target.closest('[data-action="cycleChordBeats"]');
        if (lenBtn) {
            e.stopPropagation();
            pushUndoState();
            const it = state.progressionLines[parseInt(lenBtn.dataset.line)].chords[parseInt(lenBtn.dataset.idx)];
            if (it) {
                const b = chordBeats(it);
                it.beats = b === 2 ? 4 : b === 4 ? 8 : 2;
                renderProgression();
                saveStateToLocalStorage();
            }
            return;
        }
        // v112: cycle accent normal → stop-time → push
        const accBtn = e.target.closest('[data-action="cycleChordAccent"]');
        if (accBtn) {
            e.stopPropagation();
            pushUndoState();
            const it = state.progressionLines[parseInt(accBtn.dataset.line)].chords[parseInt(accBtn.dataset.idx)];
            if (it) {
                const acc = chordAccent(it);
                it.accent = acc === 'norm' ? 'stop' : acc === 'stop' ? 'push' : 'norm';
                renderProgression();
                saveStateToLocalStorage();
            }
            return;
        }
        // Remove chord from line
        const removeBtn = e.target.closest('[data-action="removeChord"]');
        if (removeBtn) {
            pushUndoState();
            const lineIdx = parseInt(removeBtn.dataset.line);
            const chordIdx = parseInt(removeBtn.dataset.idx);
            state.progressionLines[lineIdx].chords.splice(chordIdx, 1);

            // BUG FIX #6: Reset progressionKey if all lines are now empty
            const allEmpty = state.progressionLines.every(line => line.chords.length === 0);
            if (allEmpty) {
                state.progressionKey = state.selectedKey;
            }

            renderProgression();
            saveStateToLocalStorage();
        }
        // Play Button (legacy - kept for compatibility)
        if (e.target.closest('[data-action="playProgression"]')) {
            // Build flat progression for playback
            const flatProgression = buildFlatProgression();
            Audio.playSequence(flatProgression, () => {});
        }
        // Variations
        const varBtn = e.target.closest('.variation-btn');
        if (varBtn) {
            const c = varBtn.dataset.var;
            Audio.playChord(c);
            state.selectedChordForDetail = c;
            const p = parseChord(c);
            // Re-render vars to update active state, but DON'T wipe container
            renderChordVariations(p.note, p.quality);
            renderScaleBoards();
            // Update diagram
            const diagramContainer = document.getElementById('chordDiagrams');
            const root = p.note;
            const base = p.quality.startsWith('m') ? 'minor' : 'major';
            let lookup = c;
            if (!Data.CHORD_DB[lookup]) lookup = root + (base === 'minor' ? 'm' : '');
            if (!Data.CHORD_DB[lookup]) lookup = root;
            const dbChord = Data.CHORD_DB[lookup];
            if (dbChord) {
                diagramContainer.innerHTML = dbChord.positions.map((pos, i) => `
                    <div class="chord-diagram">${renderChordSVG(pos, dbChord.fingers[i], dbChord.baseFrets[i])}</div>
                `).join('');
            }
        }

        // ===== CHORD PICKER EVENTS =====
        // Root note selection
        const rootBtn = e.target.closest('.root-note-btn');
        if (rootBtn) {
            state.pickerRoot = rootBtn.dataset.root;
            renderChordPicker();
        }
        // Quality selection
        const qualityBtn = e.target.closest('.quality-btn[data-quality]');
        if (qualityBtn) {
            state.pickerQuality = qualityBtn.dataset.quality;
            renderChordPicker();
        }
        // Extension selection
        const extBtn = e.target.closest('.quality-btn[data-ext]');
        if (extBtn) {
            state.pickerExtension = extBtn.dataset.ext;
            renderChordPicker();
        }

        // ===== KEY FINDER EVENTS =====
        const kfRootBtn = e.target.closest('.kf-root-btn');
        if (kfRootBtn) {
            state.kfRoot = kfRootBtn.dataset.kfRoot;
            renderKeyFinder();
        }
        const kfQualityBtn = e.target.closest('.kf-quality-btn');
        if (kfQualityBtn) {
            state.kfQuality = kfQualityBtn.dataset.kfQuality;
            renderKeyFinder();
        }

        // Actions
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            if (action === 'toggleToolMenu') {
                const toolBtns = document.getElementById('toolButtons');
                if (toolBtns) toolBtns.classList.toggle('open');
            }
            // Auto-close the Tools dropdown when the user picks any tool from
            // it. Only close if the click originated INSIDE #toolButtons (and
            // wasn't the toggle itself, which we handle above).
            if (action !== 'toggleToolMenu' && actionBtn.closest('#toolButtons')) {
                const toolBtns = document.getElementById('toolButtons');
                if (toolBtns) toolBtns.classList.remove('open');
            }
            if (action === 'toggleScalePopup') {
                state.showScalePopup = !state.showScalePopup;
                document.getElementById('scalePopup').classList.toggle('hidden', !state.showScalePopup);
                if (state.showScalePopup) renderScalePopup();
            }
            if (action === 'toggleFretboard') {
                state.showFretboard = !state.showFretboard;
                document.getElementById('btnShowScale').classList.toggle('active', state.showFretboard);
                renderScaleBoards();
                if (state.showFretboard) {
                    const fc = document.getElementById('fretboardContainer');
                    if (fc) setTimeout(() => fc.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                }
            }
            // Arpeggiator Actions
            if (action === 'toggleArpeggiator') {
                state.showArpeggiator = !state.showArpeggiator;
                document.getElementById('btnArpeggiator').classList.toggle('active', state.showArpeggiator);
                renderArpeggiator();
                if (state.showArpeggiator) {
                    const ac = document.getElementById('arpeggiatorContainer');
                    if (ac) setTimeout(() => ac.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                }
            }
            if (action === 'setArpRoot') {
                state.arpRoot = actionBtn.dataset.root;
                state.arpSelectedShape = null; // Reset shape when root changes
                renderArpeggiator();
            }
            if (action === 'setArpQuality') {
                state.arpQuality = actionBtn.dataset.quality;
                renderArpeggiator();
            }
            if (action === 'setArpExtension') {
                state.arpExtension = actionBtn.dataset.extension;
                renderArpeggiator();
            }
            if (action === 'setArpView') {
                state.arpViewMode = actionBtn.dataset.view;
                if (state.arpViewMode === 'all') state.arpSelectedShape = null;
                renderArpeggiator();
            }
            if (action === 'setArpShape') {
                const shape = actionBtn.dataset.shape;
                state.arpSelectedShape = state.arpSelectedShape === shape ? null : shape;
                renderArpeggiator();
            }
            if (action === 'playArpChord') {
                const chordName = getArpChordName();
                Audio.playChord(chordName);
            }
            if (action === 'lockArpBoard') {
                // Snapshot current arpeggiator into a locked board
                const chordName = getArpChordName();
                const chordTones = getArpChordTones();
                state.arpLockedBoards.push({
                    chordName,
                    tones: chordTones,
                    viewMode: state.arpViewMode,
                    selectedShape: state.arpSelectedShape,
                    root: state.arpRoot
                });
                renderArpeggiator();
            }
            if (action === 'removeLockedArp') {
                const idx = parseInt(actionBtn.dataset.lockedIdx);
                state.arpLockedBoards.splice(idx, 1);
                renderArpeggiator();
            }
            if (action === 'setLockedArpView') {
                const idx = parseInt(actionBtn.dataset.lockedIdx);
                state.arpLockedBoards[idx].viewMode = actionBtn.dataset.view;
                if (actionBtn.dataset.view === 'all') state.arpLockedBoards[idx].selectedShape = null;
                renderArpeggiator();
            }

            // Tuner Actions
            if (action === 'toggleTuner') {
                state.showTuner = !state.showTuner;
                document.getElementById('btnTuner').classList.toggle('active', state.showTuner);
                if (!state.showTuner) stopTuner();
                renderTuner();
            }
            if (action === 'toggleTunerMic') {
                if (state.tunerActive) {
                    stopTuner();
                    renderTuner();
                } else {
                    startTuner();
                }
            }
            if (action === 'setTunerMode') {
                state.tunerAutoDetect = actionBtn.dataset.mode === 'auto';
                renderTuner();
            }
            if (action === 'selectTunerString') {
                state.tunerSelectedString = parseInt(actionBtn.dataset.stringIdx);
                if (state.tunerAutoDetect) {
                    state.tunerAutoDetect = false; // Switch to manual when user picks a string
                }
                renderTuner();
            }

            // Looper Actions
            if (action === 'toggleLooper') {
                if (state.looperPlaying) {
                    Audio.stopLoop();
                    state.looperPlaying = false;
                    state.currentPlayingLine = -1;
                    state.currentPlayingChord = -1;
                } else {
                    const flatProgression = buildFlatProgression();
                    if (flatProgression.length > 0) {
                        state.looperPlaying = true;
                        // Check for infinite loop line
                        const hasInfiniteLoop = state.progressionLines.some(line => line.repeats === 999);
                        Audio.startBackingLoop(
                            flatProgression,
                            state.looperStyle,
                            state.looperBpm,
                            {
                                drums: state.looperDrums,
                                bass: state.looperBass,
                                keys: state.looperKeys,
                                variant: state.looperStyleVariant,
                                infiniteLoop: hasInfiniteLoop
                            },
                            (idx) => {
                                if (idx >= 0 && idx < flatProgression.length) {
                                    highlightProgressionChord(flatProgression[idx].lineIdx, flatProgression[idx].chordIdx);
                                }
                            },
                            (idx, t0, dur) => {
                                if (idx >= 0 && idx < flatProgression.length) {
                                    Melody.onScheduleMeasure(flatProgression[idx], t0, dur);
                                }
                            }
                        );
                    }
                }
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'setLooperStyle') {
                state.looperStyle = actionBtn.dataset.style;
                // BUG FIX #5: Restart looper if playing
                restartLooperIfPlaying();
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'setLooperVariant') {
                state.looperStyleVariant = parseInt(actionBtn.dataset.variant);
                // BUG FIX #5: Restart looper if playing
                restartLooperIfPlaying();
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'toggleLooperDrums') {
                state.looperDrums = !state.looperDrums;
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'toggleLooperBass') {
                state.looperBass = !state.looperBass;
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'toggleLooperKeys') {
                state.looperKeys = !state.looperKeys;
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'adjustBpm') {
                const delta = parseInt(actionBtn.dataset.delta);
                state.looperBpm = Math.max(60, Math.min(180, state.looperBpm + delta));
                // BUG FIX #5: Restart looper if playing
                restartLooperIfPlaying();
                renderProgression();
                saveStateToLocalStorage();
            }

            // Line Actions
            if (action === 'addLine') {
                pushUndoState();
                state.progressionLines.push({ chords: [], repeats: 1, tab: [], showTab: false, bpb: 4, viewMode: 'stacked' });
                state.currentLineIndex = state.progressionLines.length - 1;
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'removeLine') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                if (state.progressionLines.length > 1) {
                    pushUndoState();
                    state.progressionLines.splice(lineIdx, 1);
                    if (state.currentLineIndex >= state.progressionLines.length) {
                        state.currentLineIndex = state.progressionLines.length - 1;
                    }
                    renderProgression();
                    saveStateToLocalStorage();
                }
            }
            if (action === 'editLineName') {
                e.stopPropagation();
                const lineIdx = parseInt(actionBtn.dataset.line);
                const line = state.progressionLines[lineIdx];
                const label = actionBtn;
                const currentName = line.name || 'Line ' + (lineIdx + 1);
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'line-name-input';
                input.value = currentName;
                input.maxLength = 30;
                label.replaceWith(input);
                input.focus();
                input.select();
                const commit = () => {
                    const val = input.value.trim();
                    pushUndoState();
                    line.name = val || '';
                    renderProgression();
                    saveStateToLocalStorage();
                };
                input.addEventListener('blur', commit);
                input.addEventListener('keydown', (ke) => {
                    if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
                    if (ke.key === 'Escape') { input.value = currentName; input.blur(); }
                });
                return;
            }
            if (action === 'selectLine') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                // Toggle: clicking the already-selected line deselects, which
                // enters "free-play" mode — chord-grid clicks just play the
                // chord without adding it to the progression. Clicking another
                // line selects that line (back to normal add-on-click mode).
                state.currentLineIndex = (state.currentLineIndex === lineIdx) ? -1 : lineIdx;
                renderProgression();
            }
            if (action === 'setLineRepeats') {
                pushUndoState();
                const lineIdx = parseInt(actionBtn.dataset.line);
                const repeats = parseInt(actionBtn.dataset.repeats);
                state.progressionLines[lineIdx].repeats = repeats;
                renderProgression();
                saveStateToLocalStorage();
            }

            // Tab Actions
            if (action === 'toggleTab') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const line = state.progressionLines[lineIdx];
                line.showTab = !line.showTab;
                if (line.showTab && (!line.tab || line.tab.length === 0)) {
                    // Initialize one empty column per chord so every chord in the
                    // progression gets its own zone and label above the tab.
                    // Falls back to a single column if no chords exist yet.
                    const n = Math.max(1, line.chords.length);
                    line.tab = [];
                    for (let i = 0; i < n; i++) {
                        line.tab.push([null, null, null, null, null, null]);
                    }
                }
                state.tabEditing = null;
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'toggleTabChordCheck') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const line = state.progressionLines[lineIdx];
                line.showTabValidation = !line.showTabValidation;
                renderProgression();
            }
            if (action === 'toggleKeyScale') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const line = state.progressionLines[lineIdx];
                line.showKeyScale = !line.showKeyScale;
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'toggleChordTones') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const line = state.progressionLines[lineIdx];
                line.showChordTones = !line.showChordTones;
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'addTabCol') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const line = state.progressionLines[lineIdx];
                if (!line.tab) line.tab = [];
                line.tab.push([null, null, null, null, null, null]);
                state.tabEditing = null;
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'insertTabColAfter') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const colIdx = parseInt(actionBtn.dataset.col);
                const line = state.progressionLines[lineIdx];
                if (!line.tab) return;
                pushUndoState();
                // Insert a blank column after the current one
                line.tab.splice(colIdx + 1, 0, [null, null, null, null, null, null]);
                // Also insert articulation data if present
                if (line.tabArtic && line.tabArtic.length > 0) {
                    line.tabArtic.splice(colIdx + 1, 0, [null, null, null, null, null, null]);
                }
                // Shift chord boundaries that are after the insert point
                if (line.chordBoundaries) {
                    line.chordBoundaries = line.chordBoundaries.map(b => b > colIdx ? b + 1 : b);
                }
                // Shift passing note keys
                if (line.tabPassing) {
                    const newPassing = {};
                    for (const key of Object.keys(line.tabPassing)) {
                        const [c, s] = key.split(',').map(Number);
                        if (c > colIdx) {
                            newPassing[(c + 1) + ',' + s] = line.tabPassing[key];
                        } else {
                            newPassing[key] = line.tabPassing[key];
                        }
                    }
                    line.tabPassing = newPassing;
                }
                line.tabAnalysis = null;
                // Move editing focus to the new column, same string
                state.tabEditing = { line: lineIdx, col: colIdx + 1, string: state.tabEditing ? state.tabEditing.string : 0 };
                renderProgression();
                saveStateToLocalStorage();
                setTimeout(() => { const inp = document.querySelector('.tab-cell-input'); if (inp) { inp.focus(); inp.select(); } }, 50);
            }
            if (action === 'removeTabCol') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const colIdx = parseInt(actionBtn.dataset.col);
                const line = state.progressionLines[lineIdx];
                if (line.tab && line.tab.length > 0) {
                    line.tab.splice(colIdx, 1);
                    // Clean up articulations: remove affected slot
                    if (line.tabArtic) {
                        if (colIdx > 0) {
                            line.tabArtic.splice(colIdx - 1, 1);
                        } else if (line.tabArtic.length > 0) {
                            line.tabArtic.splice(0, 1);
                        }
                    }
                    // Adjust persisted chord boundaries after column removal
                    if (line.chordBoundaries) {
                        line.chordBoundaries = line.chordBoundaries.map(b => b > colIdx ? b - 1 : b);
                        // Ensure first boundary is always 0
                        if (line.chordBoundaries.length > 0) line.chordBoundaries[0] = 0;
                        // Remove duplicates (two boundaries can't point to same column)
                        for (let bi = 1; bi < line.chordBoundaries.length; bi++) {
                            if (line.chordBoundaries[bi] <= line.chordBoundaries[bi - 1]) {
                                line.chordBoundaries[bi] = line.chordBoundaries[bi - 1] + 1;
                            }
                        }
                    }
                }
                    // Clean up passing note data for removed column and re-index
                    if (line.tabPassing) {
                        const newPassing = {};
                        for (const k of Object.keys(line.tabPassing)) {
                            const [c, s] = k.split(',').map(Number);
                            if (c === colIdx) continue; // removed column
                            const newC = c > colIdx ? c - 1 : c;
                            newPassing[newC + ',' + s] = true;
                        }
                        line.tabPassing = newPassing;
                    }
                line.tabAnalysis = null; // invalidate analysis
                state.tabEditing = null;
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'tabCellClick') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const colIdx = parseInt(actionBtn.dataset.col);
                const stringIdx = parseInt(actionBtn.dataset.string);
                state.tabEditing = { line: lineIdx, col: colIdx, string: stringIdx };
                // Editing a cell breaks any active range selection.
                if (state.tabSelection) state.tabSelection = null;
                renderProgression();
                // Focus the input after render
                setTimeout(() => {
                    const input = document.querySelector('.tab-cell-input');
                    if (input) {
                        input.focus();
                        input.select();
                    }
                }, 50);
            }
            if (action === 'cycleArtic') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const articIdx = parseInt(actionBtn.dataset.articIdx);
                const stringIdx = parseInt(actionBtn.dataset.string);
                const line = state.progressionLines[lineIdx];
                if (!line.tabArtic) line.tabArtic = [];
                // Ensure artic array is long enough
                while (line.tabArtic.length <= articIdx) {
                    line.tabArtic.push([null, null, null, null, null, null]);
                }
                // Cycle: null → h → p → / → \ → null
                const current = line.tabArtic[articIdx][stringIdx];
                const cycle = [null, 'h', 'p', '/', '\\'];
                const curIdx = cycle.indexOf(current);
                line.tabArtic[articIdx][stringIdx] = cycle[(curIdx + 1) % cycle.length];
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'analyzeTabMelody') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const line = state.progressionLines[lineIdx];
                line.tabAnalysis = analyzeTabMelody(line);
                renderProgression();
            }
            if (action === 'closeTabAnalysis') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                state.progressionLines[lineIdx].tabAnalysis = null;
                renderProgression();
            }
            if (action === 'transposeTab') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                const delta = parseInt(actionBtn.dataset.delta);
                const line = state.progressionLines[lineIdx];
                if (!line.tab || line.tab.length === 0) return;

                // Check bounds: no fret should go below 0 or above 24
                let canShift = true;
                line.tab.forEach(col => {
                    for (let s = 0; s < 6; s++) {
                        const v = col[s];
                        if (v !== null && v !== undefined) {
                            if (v + delta < 0 || v + delta > 24) canShift = false;
                        }
                    }
                });

                if (!canShift) return; // don't shift if it would go out of range

                // Apply shift
                line.tab.forEach(col => {
                    for (let s = 0; s < 6; s++) {
                        if (col[s] !== null && col[s] !== undefined) {
                            col[s] += delta;
                        }
                    }
                });

                // Re-run analysis if it was visible
                if (line.tabAnalysis) {
                    line.tabAnalysis = analyzeTabMelody(line);
                }
                renderProgression();
                saveStateToLocalStorage();
            }

            if (action === 'closeAnalysis') {
                const detailSection = document.querySelector('.detail-section');
                if (detailSection) detailSection.style.display = 'none';
                // Stop tracking the active analysis so future key/chord
                // changes don't silently re-render the closed panel.
                state.activeAnalysisLineIdx = null;
            }
            if (action === 'openOolimo') {
                const p = parseChord(state.selectedChordForDetail || 'C');
                window.open(`https://www.oolimo.com/guitarchords/${p.note.replace('#','sharp')}`, '_blank');
            }
            if (action === 'undo') {
                undo();
            }
            if (action === 'redo') {
                redo();
            }
            if (action === 'clearProgression') {
                pushUndoState();
                state.progressionLines = [{ chords: [], repeats: 1, tab: [], showTab: false }];
                state.currentLineIndex = 0;
                state.progressionKey = state.selectedKey;
                state.songName = '';
                renderProgression();
                saveStateToLocalStorage();
            }
            if (action === 'saveProgression') {
                saveProgression();
            }
            if (action === 'exportPdf') {
                exportToPdf();
            }
            if (action === 'openProgression') {
                openProgression();
            }
            if (action === 'analyzeProgression') {
                const lineIdx = parseInt(actionBtn.dataset.line);
                // Track which line is currently being analyzed so the analysis
                // can re-run automatically when the user changes key, edits
                // chords, or switches major/minor mode.
                state.activeAnalysisLineIdx = lineIdx;
                refreshActiveAnalysis();
                // Scroll the analysis panel into view so the user sees what
                // their click did (the lightbulb sits on the progression line,
                // potentially far above the side panel that hosts the
                // analysis result).
                const detailPanel = document.getElementById('chordDetailPanel');
                if (detailPanel && detailPanel.scrollIntoView) {
                    detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }

            // Chord Shape Editor Actions
            if (action === 'closeShapeEditor') {
                // If closing a blank entry without saving, remove the placeholder chord
                if (state.shapeEditorBlankEntry) {
                    const lineIdx = state.shapeEditorLine;
                    const chordIdx = state.shapeEditorIdx;
                    if (state.progressionLines[lineIdx] && state.progressionLines[lineIdx].chords[chordIdx] && state.progressionLines[lineIdx].chords[chordIdx].chord === '?') {
                        state.progressionLines[lineIdx].chords.splice(chordIdx, 1);
                    }
                    state.shapeEditorBlankEntry = false;
                    renderProgression();
                }
                state.shapeEditorOpen = false;
                state.shapeEditorSelectedChord = null;
                const overlay = document.getElementById('chordShapeOverlay');
                if (overlay) overlay.remove();
            }
            // "Pick a chord by name →" link inside the shape editor — closes
            // the editor (without saving / without removing the blank entry)
            // and opens the Chord Picker. The picker's Add-to-Progression
            // appends a new chord; the user can then drag-drop or delete the
            // unwanted placeholder if they entered the editor for a blank.
            if (action === 'switchToChordPicker') {
                // If we arrived here from a blank "+ ♦ Shape" entry, drop the
                // '?' placeholder we inserted. The Chord Picker's Add-to-
                // Progression APPENDS a fresh chord, so leaving the placeholder
                // in place produced a duplicate ('?' + the picked chord).
                if (state.shapeEditorBlankEntry) {
                    const li = state.shapeEditorLine;
                    const ci = state.shapeEditorIdx;
                    if (state.progressionLines[li] && state.progressionLines[li].chords[ci] && state.progressionLines[li].chords[ci].chord === '?') {
                        state.progressionLines[li].chords.splice(ci, 1);
                    }
                    renderProgression();
                }
                state.shapeEditorOpen = false;
                state.shapeEditorSelectedChord = null;
                state.shapeEditorBlankEntry = false;
                const overlay = document.getElementById('chordShapeOverlay');
                if (overlay) overlay.remove();
                state.showChordPicker = true;
                renderChordPicker();
            }
            if (action === 'toggleShapeFret') {
                const stringIdx = parseInt(actionBtn.dataset.string);
                const fret = parseInt(actionBtn.dataset.fret);

                // Toggle fret: if already selected, clear it; otherwise set it
                if (state.shapeEditorFrets[stringIdx] === fret) {
                    state.shapeEditorFrets[stringIdx] = null;
                } else {
                    state.shapeEditorFrets[stringIdx] = fret;
                }

                state.shapeEditorSelectedChord = null; // reset selection on fret change
                const chordName = state.progressionLines[state.shapeEditorLine].chords[state.shapeEditorIdx].chord;
                renderChordShapeEditor(chordName);
            }
            if (action === 'toggleShapeString') {
                const stringIdx = parseInt(actionBtn.dataset.string);

                // Cycle: normal (fretted) → open (0) → muted (null)
                const current = state.shapeEditorFrets[stringIdx];
                if (current === null) {
                    // null → 0 (open)
                    state.shapeEditorFrets[stringIdx] = 0;
                } else {
                    // anything → null (muted)
                    state.shapeEditorFrets[stringIdx] = null;
                }

                state.shapeEditorSelectedChord = null; // reset selection on fret change
                const chordName = state.progressionLines[state.shapeEditorLine].chords[state.shapeEditorIdx].chord;
                renderChordShapeEditor(chordName);
            }
            if (action === 'shapeNavDown') {
                state.shapeEditorBaseFret = Math.max(0, state.shapeEditorBaseFret - 1);
                const chordName = state.progressionLines[state.shapeEditorLine].chords[state.shapeEditorIdx].chord;
                renderChordShapeEditor(chordName);
            }
            if (action === 'shapeNavUp') {
                state.shapeEditorBaseFret = Math.min(20, state.shapeEditorBaseFret + 1);
                const chordName = state.progressionLines[state.shapeEditorLine].chords[state.shapeEditorIdx].chord;
                renderChordShapeEditor(chordName);
            }
            if (action === 'toggleHighlightHelp') {
                const tooltip = document.getElementById('chordHighlightTooltip');
                if (tooltip) tooltip.classList.toggle('visible');
            }
            if (action === 'previewChordShape') {
                const hasNotes = state.shapeEditorFrets.some(f => f !== null);
                if (hasNotes) {
                    Audio.playShapePreview(state.shapeEditorFrets);
                }
            }
            if (action === 'clearChordShape') {
                state.shapeEditorFrets = [null, null, null, null, null, null];
                const chordName = state.progressionLines[state.shapeEditorLine].chords[state.shapeEditorIdx].chord;
                renderChordShapeEditor(chordName);
            }
            if (action === 'saveChordShape') {
                const lineIdx = state.shapeEditorLine;
                const chordIdx = state.shapeEditorIdx;

                // Only save if at least one fret is selected
                const hasAnyFret = state.shapeEditorFrets.some(f => f !== null);
                if (hasAnyFret) {
                    pushUndoState();
                    if (!state.progressionLines[lineIdx].chords[chordIdx].shape) {
                        state.progressionLines[lineIdx].chords[chordIdx].shape = {};
                    }
                    state.progressionLines[lineIdx].chords[chordIdx].shape.frets = [...state.shapeEditorFrets];
                    state.progressionLines[lineIdx].chords[chordIdx].shape.baseFret = state.shapeEditorBaseFret;

                    // Use manually selected chord name if user clicked an alternative, otherwise auto-detect
                    if (state.shapeEditorSelectedChord) {
                        state.progressionLines[lineIdx].chords[chordIdx].chord = state.shapeEditorSelectedChord;
                    } else {
                        const { pitchClasses, notes } = Audio.extractNotesFromShape(state.shapeEditorFrets);
                        if (pitchClasses.size >= 2) {
                            const detection = Audio.detectChordFromNotes(pitchClasses, notes);
                            if (detection && detection.confidence > 0.4) {
                                const newName = detection.isSlash ? detection.slashChord : detection.chord;
                                state.progressionLines[lineIdx].chords[chordIdx].chord = newName;
                            } else if (state.shapeEditorBlankEntry) {
                                state.progressionLines[lineIdx].chords[chordIdx].chord = '?';
                            }
                        }
                    }
                } else if (state.shapeEditorBlankEntry) {
                    // No frets placed on blank entry — remove the chord
                    state.progressionLines[lineIdx].chords.splice(chordIdx, 1);
                }

                state.shapeEditorOpen = false;
                state.shapeEditorBlankEntry = false;
                state.shapeEditorSelectedChord = null;
                const overlay = document.getElementById('chordShapeOverlay');
                if (overlay) overlay.remove();

                renderProgression();
                saveStateToLocalStorage();
            }

            if (action === 'selectDetectedChord') {
                const selectedChord = actionBtn.dataset.chord;
                if (selectedChord && state.shapeEditorOpen) {
                    state.shapeEditorSelectedChord = selectedChord;
                    // Update the actual chord in the progression
                    const lineIdx = state.shapeEditorLine;
                    const chordIdx = state.shapeEditorIdx;
                    state.progressionLines[lineIdx].chords[chordIdx].chord = selectedChord;
                    // Re-render entire shape editor to show hint dots on fretboard
                    renderChordShapeEditor(selectedChord);
                }
            }

            // Chord Picker Actions
            if (action === 'openChordPicker') {
                state.showChordPicker = true;
                renderChordPicker();
            }
            if (action === 'closeChordPicker') {
                state.showChordPicker = false;
                renderChordPicker();
            }
            if (action === 'addPickedChord') {
                // Add explicitly resumes selection on the first line if the
                // user is in free-play mode — "Add to Progression" only makes
                // sense if there's a target line.
                if (state.currentLineIndex == null || state.currentLineIndex < 0
                    || !state.progressionLines[state.currentLineIndex]) {
                    state.currentLineIndex = 0;
                }
                pushUndoState();
                const chord = getPickerChord();
                state.progressionLines[state.currentLineIndex].chords.push({chord, id: 'picked', active: false});
                renderProgression();
                state.showChordPicker = false;
                renderChordPicker();
                saveStateToLocalStorage();
            }
            if (action === 'playPickedChord') {
                const chord = getPickerChord();
                Audio.playChord(chord);
            }

            if (action === 'addBlankChordByShape') {
                pushUndoState();
                const lineIdx = state.currentLineIndex;
                state.progressionLines[lineIdx].chords.push({ chord: '?', id: 'blank', active: false });
                const chordIdx = state.progressionLines[lineIdx].chords.length - 1;
                // Open shape editor immediately for the new blank chord
                state.shapeEditorOpen = true;
                state.shapeEditorLine = lineIdx;
                state.shapeEditorIdx = chordIdx;
                state.shapeEditorFrets = [null, null, null, null, null, null];
                state.shapeEditorBaseFret = 0;
                state.shapeEditorBlankEntry = true;
                state.shapeEditorSelectedChord = null;
                renderChordShapeEditor('?');
                renderProgression();
                saveStateToLocalStorage();
            }

            // Key / Chord-mode collapsible expanders
            if (action === 'toggleKeyExpander') {
                const sel = document.getElementById('keySelector');
                if (sel) sel.classList.toggle('open');
            }
            if (action === 'toggleTabExpander') {
                const sel = document.querySelector('.controls-left');
                if (sel) sel.classList.toggle('tab-expander-open');
            }
            // Collapsible How-It-Works in lyrics freewrite. Persist preference.
            if (action === 'toggleLyricsHowto') {
                const howto = document.getElementById('lpHowto');
                if (howto) {
                    const nowCollapsed = !howto.classList.contains('collapsed');
                    howto.classList.toggle('collapsed', nowCollapsed);
                    localStorage.setItem('uz-lyrics-howto-collapsed', nowCollapsed ? '1' : '0');
                    const chev = howto.querySelector('.lp-howto-chevron');
                    if (chev) chev.textContent = nowCollapsed ? '▸' : '▾';
                    const toggleBtn = howto.querySelector('.lp-howto-toggle');
                    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(!nowCollapsed));
                }
            }

            // Tutorial / Playback / File popup toggles
            if (action === 'openTutorial') {
                if (typeof window.uzShowTutorial === 'function') window.uzShowTutorial();
            }
            if (action === 'toggleMySongs') {
                const popup = document.getElementById('mySongsPopup');
                if (popup) {
                    popup.classList.toggle('hidden');
                    if (!popup.classList.contains('hidden')) { persistCurrentSong(); renderMySongs(); }
                }
                const toolBtns2 = document.getElementById('toolButtons');
                if (toolBtns2) toolBtns2.classList.remove('open');
            }
            if (action === 'closeMySongs') {
                const popup = document.getElementById('mySongsPopup');
                if (popup) popup.classList.add('hidden');
            }
            if (action === 'switchSong') { switchToSong(actionBtn.dataset.song); }
            if (action === 'newSongHub') { createNewSong(); }
            if (action === 'deleteSong') { deleteSongById(actionBtn.dataset.song); }
            if (action === 'exportSong') { exportSongById(actionBtn.dataset.song); }
            if (action === 'replaceSong') { replaceSongById(actionBtn.dataset.song); }
            if (action === 'importSongHub') { importSongFile(); }
            if (action === 'exportAllSongs') { exportAllSongs(); }
            if (action === 'toggleMelodySketcher') {
                Melody.toggle();
                const tb3 = document.getElementById('toolButtons');
                if (tb3) tb3.classList.remove('open');
            }
            if (action && action.startsWith('mel') && action !== 'melodyNoop') {
                Melody.handleAction(action, actionBtn);
            }
            if (action === 'copyShareLink') {
                const url = buildShareUrl();
                if (!url) {
                    actionBtn.textContent = 'Add chords first';
                    setTimeout(() => { actionBtn.innerHTML = '🔗 Share link'; }, 1500);
                } else {
                    navigator.clipboard.writeText(url).then(() => {
                        actionBtn.textContent = '✓ Link copied!';
                        setTimeout(() => { actionBtn.innerHTML = '🔗 Share link'; }, 1500);
                    }).catch(() => { window.prompt('Copy this link:', url); });
                }
            }
            if (action === 'openMidiExport') {
                // Close the file panel so the MIDI dialog is unambiguous
                const filePopup = document.getElementById('filePopup');
                if (filePopup) filePopup.classList.add('hidden');
                showMidiExportDialog();
            }
            if (action === 'openPlaybackPanel' || action === 'closePlaybackPanel') {
                const popup = document.getElementById('playbackPopup');
                if (popup) {
                    if (action === 'openPlaybackPanel') popup.classList.remove('hidden');
                    else popup.classList.add('hidden');
                }
            }
            if (action === 'openFilePanel' || action === 'closeFilePanel') {
                const popup = document.getElementById('filePopup');
                if (popup) {
                    if (action === 'openFilePanel') popup.classList.remove('hidden');
                    else popup.classList.add('hidden');
                }
            }
        }

        // Click-on-overlay closes the playback / file popups (sibling of the
        // chord-picker / key-finder pattern). Run outside the actionBtn block
        // so a click directly on .playback-popup (the dimmed background)
        // counts even though it has no data-action.
        const pbOverlay = e.target.closest('.playback-popup');
        if (pbOverlay && e.target === pbOverlay) {
            pbOverlay.classList.add('hidden');
        }
        const filOverlay = e.target.closest('.file-popup');
        if (filOverlay && e.target === filOverlay) {
            filOverlay.classList.add('hidden');
        }
        if (actionBtn) {
            const action = actionBtn.dataset.action;

            // Key Finder Actions
            if (action === 'openKeyFinder') {
                state.showKeyFinder = true;
                renderKeyFinder();
            }
            if (action === 'closeKeyFinder') {
                state.showKeyFinder = false;
                renderKeyFinder();
            }
            if (action === 'kfAddChord') {
                // Support both passing chord as data attribute and deriving from state
                const chord = actionBtn.dataset.chord || (state.kfRoot + state.kfQuality);
                // Allow duplicates: real progressions repeat chords, and the
                // detection algorithm scores per-occurrence (V7 cap aside) and
                // counts root-chord frequency. Deduping here would silently
                // strip information the algorithm relies on, which broke
                // doc-listed cases like C7-F7-C7-G7-F7-C7.
                if (chord) {
                    state.kfChords.push(chord);
                    Audio.playChord(chord);
                }
                renderKeyFinder();
            }
            if (action === 'kfRemoveChord') {
                const idx = parseInt(actionBtn.dataset.idx);
                state.kfChords.splice(idx, 1);
                renderKeyFinder();
            }
            if (action === 'kfClear') {
                state.kfChords = [];
                state.kfResultKey = null;
                state.kfResultType = null;
                renderKeyFinder();
            }
            if (action === 'kfUseKey') {
                if (state.kfResultKey) {
                    state.selectedKey = state.kfResultKey;
                    state.progressionKey = state.kfResultKey;
                    // Switch to correct tab based on type
                    if (state.kfResultType === 'minor') {
                        state.selectedTab = 'dark';
                        document.body.classList.add('dark-mode');
                    } else {
                        state.selectedTab = 'standard';
                        document.body.classList.remove('dark-mode');
                    }
                    state.showKeyFinder = false;
                    render();
                    saveStateToLocalStorage();
                }
            }
            if (action === 'kfSelectKey') {
                state.kfResultKey = actionBtn.dataset.key;
                state.kfResultType = actionBtn.dataset.type;
                renderKeyFinder();
            }

            // Scale Board Actions
            if (action === 'addScaleBoard') {
                if (!state.scaleBoards) state.scaleBoards = [{ id: 0, scale: 'major', showCaged: false, selectedCaged: null, addBlues: false }];
                const newId = state.scaleBoards.length;
                state.scaleBoards.push({ id: newId, scale: 'pentMajor', showCaged: false, selectedCaged: null, addBlues: false });
                renderScaleBoards();
            }
            if (action === 'removeScaleBoard') {
                const idx = parseInt(actionBtn.dataset.boardIdx);
                if (state.scaleBoards && state.scaleBoards.length > 1) {
                    state.scaleBoards.splice(idx, 1);
                    renderScaleBoards();
                }
            }

            // Blues Toggle
            if (action === 'toggleBlues') {
                const idx = parseInt(actionBtn.dataset.boardIdx);
                if (state.scaleBoards && state.scaleBoards[idx]) {
                    state.scaleBoards[idx].addBlues = !state.scaleBoards[idx].addBlues;
                    renderScaleBoards();
                }
            }

            // CAGED Actions
            if (action === 'toggleCaged') {
                const idx = parseInt(actionBtn.dataset.boardIdx);
                if (state.scaleBoards && state.scaleBoards[idx]) {
                    state.scaleBoards[idx].showCaged = !state.scaleBoards[idx].showCaged;
                    if (!state.scaleBoards[idx].showCaged) {
                        state.scaleBoards[idx].selectedCaged = null; // Clear selection when hiding
                    }
                    renderScaleBoards();
                }
            }
            if (action === 'selectCaged') {
                const idx = parseInt(actionBtn.dataset.boardIdx);
                const shape = actionBtn.dataset.shape;
                if (state.scaleBoards && state.scaleBoards[idx]) {
                    // Toggle: if already selected, deselect; otherwise select
                    if (state.scaleBoards[idx].selectedCaged === shape) {
                        state.scaleBoards[idx].selectedCaged = null;
                    } else {
                        state.scaleBoards[idx].selectedCaged = shape;
                    }
                    renderScaleBoards();
                }
            }

            // Scale Info Popup
            if (action === 'showScaleInfo') {
                const scaleType = actionBtn.dataset.scale;
                const info = SCALE_DESCRIPTIONS[scaleType];
                if (info) {
                    showScaleInfoPopup(info, state.selectedKey);
                }
            }

            if (action === 'popoutPanel') {
                const panelId = actionBtn.dataset.panel;
                popoutToWindow(panelId);
            }

            // Close scale info popup
            if (action === 'closeScaleInfo') {
                const popup = document.getElementById('scaleInfoPopup');
                if (popup) popup.classList.add('hidden');
            }

            // ── Auto-close popups after the user completes an action ──
            // After any "operation completed" action — picking a key in the
            // Key Finder, adding a chord from the picker, or any file
            // operation — close the popup so the user is back in the main UI.
            const FILE_ACTIONS = new Set(['undo', 'redo', 'saveProgression', 'openProgression', 'exportPdf', 'clearProgression']);
            if (FILE_ACTIONS.has(action)) {
                const filePopup = document.getElementById('filePopup');
                if (filePopup) filePopup.classList.add('hidden');
            }
            if (action === 'kfUseKey') {
                const kf = document.getElementById('keyFinderPopup');
                if (kf) kf.classList.add('hidden');
                state.showKeyFinder = false;
            }
            if (action === 'addPickedChord') {
                const cp = document.getElementById('chordPickerPopup');
                if (cp) cp.classList.add('hidden');
                state.showChordPicker = false;
            }
        }
    });
    // --- Draggable chord zone boundaries in tab grid ---
    document.body.addEventListener('mousedown', e => {
        const boundary = e.target.closest('[data-action="dragBoundary"]');
        if (!boundary) return;
        e.preventDefault();
        e.stopPropagation();

        const lineIdx = parseInt(boundary.dataset.line);
        const bIdx = parseInt(boundary.dataset.boundaryIdx);
        const line = state.progressionLines[lineIdx];
        if (!line || !line.chordBoundaries || bIdx <= 0) return;

        const tabGrid = boundary.closest('.tab-grid');
        if (!tabGrid) return;

        boundary.classList.add('dragging');

        // Snapshot column positions once at drag start
        const columns = tabGrid.querySelectorAll('.tab-column');
        const colRects = [];
        columns.forEach(col => {
            const rect = col.getBoundingClientRect();
            colRects.push({ col: parseInt(col.dataset.col), left: rect.left, cx: rect.left + rect.width / 2 });
        });

        const startX = boundary.getBoundingClientRect().left;
        let currentClamped = line.chordBoundaries[bIdx];

        const getColFromX = (clientX) => {
            let bestCol = currentClamped;
            let bestDist = Infinity;
            for (const cr of colRects) {
                const dist = Math.abs(clientX - cr.cx);
                if (dist < bestDist) { bestDist = dist; bestCol = cr.col; }
            }
            return bestCol;
        };

        // Get pixel offset for a target column relative to start
        const getOffsetForCol = (targetCol) => {
            const targetRect = colRects.find(c => c.col === targetCol);
            if (!targetRect) return 0;
            return targetRect.left - startX;
        };

        const onMove = (ev) => {
            const newCol = getColFromX(ev.clientX);
            const minCol = (line.chordBoundaries[bIdx - 1] || 0) + 1;
            const maxCol = bIdx < line.chordBoundaries.length - 1
                ? line.chordBoundaries[bIdx + 1] - 1
                : line.tab.length - 1;
            currentClamped = Math.max(minCol, Math.min(maxCol, newCol));
            // Visually move the boundary element without re-rendering
            const offset = getOffsetForCol(currentClamped);
            boundary.style.transform = `translateX(${offset}px)`;
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            boundary.classList.remove('dragging');
            boundary.style.transform = '';
            // Commit the new boundary position and re-render once
            line.chordBoundaries[bIdx] = currentClamped;
            renderProgression();
            saveStateToLocalStorage();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // --- Draggable column reorder in tab grid ---
    // Uses slot-based insertion: the user drops INTO a slot (the gap between
    // two columns) rather than ON a column. Slot N means "between column N-1
    // and column N", and chord boundaries land at slot positions naturally.
    // Dropping at slot 3 when chord 2 starts at column 3 places the moved
    // column AS the new first column of chord 2 (the boundary stays put).
    //
    // Range selection: shift+click on a drag handle extends a range selection
    // — click the leftmost handle then shift+click the rightmost. Plain
    // mousedown on any handle inside the range drags the whole block.
    document.body.addEventListener('mousedown', e => {
        const handle = e.target.closest('[data-action="dragTabCol"]');
        if (!handle) return;

        const lineIdx = parseInt(handle.dataset.line);
        const colIdx = parseInt(handle.dataset.col);

        // Shift+click: extend (or start) the range selection on this line.
        if (e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            const sel = state.tabSelection;
            if (sel && sel.line === lineIdx) {
                state.tabSelection = {
                    line: lineIdx,
                    start: Math.min(sel.start, colIdx),
                    end: Math.max(sel.end, colIdx)
                };
            } else {
                // No prior selection on this line — anchor it on the clicked col.
                state.tabSelection = { line: lineIdx, start: colIdx, end: colIdx };
            }
            renderProgression();
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        // If a range is selected on this line and the clicked column is in
        // it, drag the whole range as a block. Otherwise drag a single column
        // and clear the selection.
        let srcStart, srcEnd;
        const sel = state.tabSelection;
        if (sel && sel.line === lineIdx && colIdx >= sel.start && colIdx <= sel.end) {
            srcStart = sel.start;
            srcEnd = sel.end;
        } else {
            srcStart = colIdx;
            srcEnd = colIdx;
            if (state.tabSelection) {
                state.tabSelection = null;
                renderProgression();
            }
        }
        const srcCol = srcStart; // legacy alias for the range start
        const rangeLen = srcEnd - srcStart + 1;
        const line = state.progressionLines[lineIdx];
        if (!line || !line.tab) return;

        const tabGrid = handle.closest('.tab-grid');
        if (!tabGrid) return;

        const columns = tabGrid.querySelectorAll('.tab-column');
        // Mark every column in the dragged range as the drag source.
        columns.forEach(col => {
            const c = parseInt(col.dataset.col);
            if (c >= srcStart && c <= srcEnd) col.classList.add('drag-source');
        });

        // Snapshot column rects
        const colRects = [];
        columns.forEach(col => {
            const rect = col.getBoundingClientRect();
            colRects.push({ col: parseInt(col.dataset.col), left: rect.left, right: rect.right, cx: rect.left + rect.width / 2, el: col });
        });
        colRects.sort((a, b) => a.col - b.col);
        const N = colRects.length;

        // Compute insertion slot from cursor X: slot k means "between col k-1
        // and col k". Range: 0..N (inclusive).
        const slotFromX = (x) => {
            if (N === 0) return 0;
            if (x < colRects[0].cx) return 0;
            for (let i = 0; i < N - 1; i++) {
                if (x < colRects[i + 1].cx) return i + 1;
            }
            return N;
        };

        let lastSlot = srcStart; // initial slot is the range's start

        const clearIndicators = () => {
            columns.forEach(col => col.classList.remove('drag-over', 'drag-over-right'));
        };

        // Slots inside the source range or directly adjacent to it are no-ops.
        const isNoOpSlot = (slot) => slot >= srcStart && slot <= srcEnd + 1;

        const onMove = (ev) => {
            const slot = slotFromX(ev.clientX);
            if (slot === lastSlot) return;
            lastSlot = slot;
            clearIndicators();
            if (isNoOpSlot(slot)) return;
            // Visual indicator: highlight column on either side of the slot
            if (slot < N) {
                const right = colRects.find(c => c.col === slot);
                if (right) right.el.classList.add('drag-over');
            } else {
                const left = colRects.find(c => c.col === N - 1);
                if (left) left.el.classList.add('drag-over-right');
            }
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            clearIndicators();
            columns.forEach(col => col.classList.remove('drag-source'));

            const slot = lastSlot;
            if (isNoOpSlot(slot)) return;

            pushUndoState();

            // Splice-remove the entire range, then splice-insert at the right
            // index in the post-removal array.
            const movedCols = line.tab.splice(srcStart, rangeLen);
            const insertAt = slot > srcEnd ? slot - rangeLen : slot;
            line.tab.splice(insertAt, 0, ...movedCols);

            // Same move for articulations.
            if (line.tabArtic && line.tabArtic.length > 0) {
                const movedArtic = line.tabArtic.splice(srcStart, rangeLen);
                line.tabArtic.splice(insertAt, 0, ...movedArtic);
            }

            // Boundary adjustment with slot semantics for a multi-column range.
            // Boundaries inside the source range travel WITH the range — their
            // offset relative to srcStart is preserved against insertAt.
            if (line.chordBoundaries && line.chordBoundaries.length > 0) {
                line.chordBoundaries = line.chordBoundaries.map(b => {
                    if (b >= srcStart && b <= srcEnd) {
                        // Internal boundary — shift to track the moved range.
                        const offset = b - srcStart;
                        return insertAt + offset;
                    }
                    let nb = b;
                    if (nb > srcEnd) nb -= rangeLen;
                    if (nb >= insertAt) nb += rangeLen;
                    return nb;
                });
            }

            // Re-index tabPassing keys with the same logic.
            if (line.tabPassing) {
                const newPassing = {};
                for (const k of Object.keys(line.tabPassing)) {
                    let [c, s] = k.split(',').map(Number);
                    if (c >= srcStart && c <= srcEnd) {
                        c = insertAt + (c - srcStart);
                    } else {
                        if (c > srcEnd) c -= rangeLen;
                        if (c >= insertAt) c += rangeLen;
                    }
                    newPassing[c + ',' + s] = line.tabPassing[k];
                }
                line.tabPassing = newPassing;
            }

            // Move the selection along with the moved range so it stays
            // selected after the drop.
            if (state.tabSelection && state.tabSelection.line === lineIdx
                && state.tabSelection.start === srcStart && state.tabSelection.end === srcEnd) {
                state.tabSelection = { line: lineIdx, start: insertAt, end: insertAt + rangeLen - 1 };
            }

            renderProgression();
            saveStateToLocalStorage();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    document.body.addEventListener('change', e => {
        if (e.target.classList.contains('scale-select')) {
            const idx = parseInt(e.target.dataset.boardIdx);
            if (!state.scaleBoards) state.scaleBoards = [{ id: 0, scale: 'major', showCaged: false, selectedCaged: null, addBlues: false }];
            if (state.scaleBoards[idx]) {
                state.scaleBoards[idx].scale = e.target.value;
                state.scaleBoards[idx].selectedCaged = null; // Clear CAGED selection when scale changes
                // Keep addBlues state when changing scales
            }
            renderScaleBoards();
        }
        if (e.target.id === 'tunerTuningSelect') {
            state.tunerTuning = e.target.value;
            state.tunerSelectedString = null;
            renderTuner();
        }
    });

    // Tab zoom slider handler
    document.body.addEventListener('input', e => {
        if (!e.target.classList.contains('tab-zoom-slider')) return;
        const lineIdx = parseInt(e.target.dataset.line);
        const line = state.progressionLines[lineIdx];
        if (!line) return;
        const zoom = parseFloat(e.target.value);
        line.tabZoom = zoom;
        // Live-update the CSS custom property without full re-render
        const section = e.target.closest('.tab-section');
        if (section) section.style.setProperty('--tab-zoom', zoom);
        // Update the displayed value
        const valSpan = e.target.parentElement.querySelector('.tab-zoom-value');
        if (valSpan) valSpan.textContent = zoom.toFixed(1) + 'x';
        saveStateToLocalStorage();
    });

    // Prevent parent draggable elements from hijacking range input interactions
    document.body.addEventListener('dragstart', e => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'range') {
            e.preventDefault();
            return;
        }
        // Also prevent if the drag originated from within a tab-toolbar (sliders live there)
        if (e.target.closest && e.target.closest('.tab-toolbar')) {
            const fromHandle = e.target.classList.contains('line-drag-handle') || e.target.closest('.line-drag-handle');
            if (!fromHandle) {
                e.preventDefault();
                return;
            }
        }
    }, true); // capture phase so it fires before other dragstart handlers

    // Tab scroll slider handler
    document.body.addEventListener('input', e => {
        if (!e.target.classList.contains('tab-scroll-slider')) return;
        const section = e.target.closest('.tab-section');
        if (!section) return;
        const grid = section.querySelector('.tab-grid');
        if (!grid) return;
        const pct = parseFloat(e.target.value) / 100;
        const maxScroll = grid.scrollWidth - grid.clientWidth;
        grid.scrollLeft = pct * maxScroll;
    });

    // Tab cell input handling (keydown for Enter/Tab/Escape, blur for save)
    // Undo/Redo keyboard shortcuts
    document.addEventListener('keydown', e => {
        // Don't intercept if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
            e.preventDefault();
            redo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            redo();
        }
    });

    document.body.addEventListener('keydown', e => {
        if (!e.target.classList.contains('tab-cell-input')) return;
        const lineIdx = parseInt(e.target.dataset.line);
        const colIdx = parseInt(e.target.dataset.col);
        const stringIdx = parseInt(e.target.dataset.string);
        const line = state.progressionLines[lineIdx];
        if (!line || !line.tab) return;

        // Helper to apply parsed input to tab data
        const applyTabVal = (rawVal) => {
            const { fret, passing } = parseTabInput(rawVal);
            line.tab[colIdx][stringIdx] = fret;
            if (!line.tabPassing) line.tabPassing = {};
            const key = colIdx + ',' + stringIdx;
            if (fret !== null && passing) {
                line.tabPassing[key] = true;
            } else {
                delete line.tabPassing[key];
            }
        };

        if (e.key === 'Enter') {
            e.preventDefault();
            applyTabVal(e.target.value);
            // Move to next column same string, or done
            if (colIdx + 1 < line.tab.length) {
                state.tabEditing = { line: lineIdx, col: colIdx + 1, string: stringIdx };
            } else {
                state.tabEditing = null;
            }
            renderProgression();
            saveStateToLocalStorage();
            setTimeout(() => { const inp = document.querySelector('.tab-cell-input'); if (inp) { inp.focus(); inp.select(); } }, 50);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            applyTabVal(e.target.value);
            // Move to next string down, wrap to next column
            let nextString = stringIdx + 1;
            let nextCol = colIdx;
            if (nextString >= 6) { nextString = 0; nextCol++; }
            if (nextCol < line.tab.length) {
                state.tabEditing = { line: lineIdx, col: nextCol, string: nextString };
            } else {
                state.tabEditing = null;
            }
            renderProgression();
            saveStateToLocalStorage();
            setTimeout(() => { const inp = document.querySelector('.tab-cell-input'); if (inp) { inp.focus(); inp.select(); } }, 50);
        } else if (e.key === 'Escape') {
            state.tabEditing = null;
            renderProgression();
        } else if (e.key === 'Backspace' && e.target.value === '') {
            // Clear cell and stay
            e.preventDefault();
            line.tab[colIdx][stringIdx] = null;
            if (line.tabPassing) delete line.tabPassing[colIdx + ',' + stringIdx];
            state.tabEditing = null;
            renderProgression();
            saveStateToLocalStorage();
        }
    });

    // Save on blur (clicking away from input)
    document.body.addEventListener('focusout', e => {
        if (!e.target.classList.contains('tab-cell-input')) return;
        if (!state.tabEditing) return;
        // If focus is moving INTO the insert-column "+" button (or it's the
        // related target), skip the clear so the button's click handler can
        // run while tabEditing is still set. Without this, slow clicks (>100ms
        // mousedown→mouseup) trigger the timeout to clear tabEditing and
        // re-render, which removes the + button before mouseup fires the click.
        if (e.relatedTarget && (
            e.relatedTarget.closest('[data-action="insertTabColAfter"]') ||
            e.relatedTarget.classList.contains('tab-cell-input')
        )) return;

        const lineIdx = parseInt(e.target.dataset.line);
        const colIdx = parseInt(e.target.dataset.col);
        const stringIdx = parseInt(e.target.dataset.string);
        const line = state.progressionLines[lineIdx];
        if (!line || !line.tab || !line.tab[colIdx]) return;

        const { fret, passing } = parseTabInput(e.target.value);
        line.tab[colIdx][stringIdx] = fret;
        if (!line.tabPassing) line.tabPassing = {};
        const key = colIdx + ',' + stringIdx;
        if (fret !== null && passing) { line.tabPassing[key] = true; } else { delete line.tabPassing[key]; }
        // Larger delay so click events on nearby controls (like the inline +
        // insert button) get a chance to fire before tabEditing is cleared.
        setTimeout(() => {
            if (state.tabEditing && state.tabEditing.line === lineIdx && state.tabEditing.col === colIdx && state.tabEditing.string === stringIdx) {
                state.tabEditing = null;
                renderProgression();
                saveStateToLocalStorage();
            }
        }, 250);
    });

    // Belt-and-braces: also handle the insert-column "+" button on mousedown,
    // BEFORE the input's focusout fires. preventDefault() stops the input from
    // losing focus to a brief flicker, and we use the same insertTabColAfter
    // body-click handler by re-dispatching once the column is placed.
    document.body.addEventListener('mousedown', e => {
        const insertBtn = e.target.closest('[data-action="insertTabColAfter"]');
        if (!insertBtn) return;
        e.preventDefault(); // prevent the input from losing focus prematurely
    }, true);

    // Escape clears the tab range selection (when no input is focused).
    document.body.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (e.target && e.target.classList && e.target.classList.contains('tab-cell-input')) return;
        if (state.tabSelection) {
            state.tabSelection = null;
            renderProgression();
        }
    });

    // Click-off-to-deselect: any click outside a drag handle clears the tab
    // range selection. Drag handles get their own handling (shift+click
    // extends, plain click+drag moves the range, plain click on an unselected
    // handle clears + drags a single column).
    document.body.addEventListener('click', e => {
        if (!state.tabSelection) return;
        // Don't clear when the click is on a drag handle — that path is owned
        // by the mousedown handler and may want to preserve / extend the
        // selection.
        if (e.target.closest('[data-action="dragTabCol"]')) return;
        state.tabSelection = null;
        renderProgression();
    });
}

function showScaleInfoPopup(info, key) {
    const relMinor = getRelativeMinor(key);
    let popup = document.getElementById('scaleInfoPopup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'scaleInfoPopup';
        popup.className = 'scale-info-popup hidden';
        document.body.appendChild(popup);
    }

    popup.innerHTML = `
        <div class="scale-info-content">
            <button class="close-btn" data-action="closeScaleInfo">×</button>
            <h3>${info.name} ${info.subtitle ? `<span class="scale-subtitle">(${info.subtitle})</span>` : ''}</h3>
            <div class="scale-info-feel">${info.feel}</div>
            <div class="scale-info-section">
                <strong>✓ When to use:</strong>
                <p>${info.when}</p>
            </div>
            <div class="scale-info-section">
                <strong>⚠ Watch out:</strong>
                <p>${info.avoid}</p>
            </div>
            ${info.supportsBlues ? `
            <div class="scale-info-blues">
                <strong>♭5 Blues Notes:</strong>
                <p>Click the <span class="blues-badge">♭5</span> button to add expressive blue notes (♭3, ♭5, ♭7) for extra color and tension. Use them as passing tones - don't land on them!</p>
            </div>
            ` : ''}
            <div class="scale-info-tip">
                <strong>💡 Pro tip:</strong> In ${key} major, the relative minor is ${relMinor}m.
                ${relMinor}m pentatonic has the SAME notes as ${key} major pentatonic -
                just different emphasis!
            </div>
        </div>
    `;
    popup.classList.remove('hidden');
}

// ===== PROGRESSION ANALYSIS ENGINE =====

// Compute the roman numeral for a chord against the current key. Used as a
// fallback when a chord was added without a roman label (e.g. via the Chord
// Picker, the shape editor, or a "?" blank entry). Returns '' if the chord
// can't be parsed — the caller should treat that as "outside key".
function computeRomanForChord(chordName, keyRoot, isMinor) {
    if (!chordName || chordName === '?') return '';
    const p = parseChord(chordName);
    if (!p || !p.note) return '';
    const rootIdx = noteToIndex(p.note);
    const keyIdx = noteToIndex(keyRoot);
    if (rootIdx < 0 || keyIdx < 0) return '';
    const degree = ((rootIdx - keyIdx) + 12) % 12;

    // Major key diatonic chords:  I(0) ii(2) iii(4) IV(5) V(7) vi(9) vii°(11).
    // Minor key (natural minor):  i(0) ii°(2) ♭III(3) iv(5) v(7) ♭VI(8) ♭VII(10).
    //
    // Note: this codebase uses a "borrow-from-relative-major" labelling for
    // minor keys — bIII / bVI / bVII rather than the more common III / VI /
    // VII you'd see in classical analysis. CADENCE_PATTERNS, TRANSITION_RULES
    // and TENSION_VALUES all use that convention, so we match it here so the
    // computed romans actually trigger cadence/transition matching.
    const MAJOR_TABLE = { 0:'I', 2:'ii', 4:'iii', 5:'IV', 7:'V', 9:'vi', 11:'vii°' };
    const MINOR_TABLE = { 0:'i', 2:'ii°', 3:'bIII', 5:'iv', 7:'v', 8:'bVI', 10:'bVII' };
    const table = isMinor ? MINOR_TABLE : MAJOR_TABLE;
    let base = table[degree];
    if (!base) {
        // Out-of-key root. Use the chromatic alteration that's most common
        // in pop / rock harmony for that scale degree.
        const CHROMATIC_MAJ = { 1:'bII', 3:'bIII', 6:'#iv°', 8:'bVI', 10:'bVII' };
        const CHROMATIC_MIN = { 1:'bii', 4:'III', 6:'#iv°', 9:'VI', 11:'#vii°' };
        base = (isMinor ? CHROMATIC_MIN : CHROMATIC_MAJ)[degree] || '';
        if (!base) return '';
    }

    const q = p.quality || '';
    const chordIsMinor = q.startsWith('m') && !q.startsWith('maj');
    const chordIsDim = q.startsWith('dim') || q === '°' || q.startsWith('°');

    // Strip any leading b/# prefix before checking the case of the letters
    // (otherwise 'bIII' would falsely look "lowercase" because of the leading
    // 'b' and trip the case-correction logic below).
    const stripped = base.replace(/^[b#]+/, '');
    const baseIsMinor = stripped && stripped[0] === stripped[0].toLowerCase();

    if (chordIsMinor && !baseIsMinor) {
        // Lower-case the letter portion only — keep b/# prefix and any ° suffix.
        base = base.replace(/[A-Z]+/, m => m.toLowerCase());
    } else if (!chordIsMinor && !chordIsDim && baseIsMinor) {
        // Major chord on a normally-minor or normally-diminished degree.
        // Upper-case the letters; drop ° suffix since the chord isn't dim.
        base = base.replace(/°/g, '').replace(/[a-z]+/, m => m.toUpperCase());
    }
    // Make sure dim chords always have ° marker.
    if (chordIsDim && !base.includes('°')) base += '°';

    // Append dom7 marker so cadences like V7→I match. dom7 family covers
    // 7 / 9 / 11 / 13 (without 'maj' prefix). m7 / m9 / m11 / m13 are minor
    // sevenths and shouldn't add a literal '7' to the roman because cadence
    // patterns use 'iim7' or 'ii7' inconsistently — leave those un-suffixed
    // and let normalizeRoman handle matching.
    if (!chordIsMinor && /^(7|9|11|13)/.test(q) && !q.startsWith('maj')) {
        base += '7';
    }
    return base;
}

function analyzeProgression(chords, isMinor) {
    if (!chords || chords.length < 2) {
        return { cadences: [], transitions: [], substitutions: [], moodArc: { tensions: [], narrative: '', character: '' }, isEmpty: true, reason: 'Add at least 2 chords to analyse.' };
    }

    // Build a roman for every chord. Prefer the stored roman (carries the
    // user's original intent across key changes); otherwise compute from the
    // chord name + currently-selected key. Chords that still can't be
    // classified contribute '' and don't break the analysis — they just don't
    // match cadences or get transition rules.
    const keyRoot = state.selectedKey;
    const romans = chords.map(c => {
        if (c.roman) return c.roman;
        return computeRomanForChord(c.chord, keyRoot, isMinor);
    });
    const validCount = romans.filter(r => r).length;
    if (validCount < 2) {
        return {
            cadences: [], transitions: [], substitutions: [],
            moodArc: { tensions: [], narrative: '', character: '' },
            isEmpty: true,
            reason: 'Couldn\'t identify enough chords against ' + keyRoot + (isMinor ? ' minor' : ' major') + '. Try setting the key (top of page) to match your chords, or pick chords from the grid so they pick up roman labels automatically.'
        };
    }

    // --- 1. Cadence Detection ---
    const cadences = [];
    const patterns = Data.CADENCE_PATTERNS;

    for (const pat of patterns) {
        const seq = isMinor ? pat.minorSeq : pat.romanSeq;
        if (!seq) continue;
        const len = seq.length;
        for (let i = 0; i <= romans.length - len; i++) {
            let match = true;
            for (let j = 0; j < len; j++) {
                if (normalizeRoman(romans[i + j]) !== normalizeRoman(seq[j])) { match = false; break; }
            }
            if (match) {
                cadences.push({
                    name: pat.name,
                    position: i,
                    endPosition: i + len - 1,
                    chords: chords.slice(i, i + len).map(c => c.chord),
                    romansMatched: seq.join(' → '),
                    description: pat.description,
                    tip: pat.tip
                });
            }
        }
    }

    // --- 2. Transition Analysis ---
    const transitions = [];
    for (let i = 0; i < romans.length - 1; i++) {
        const fromR = normalizeRoman(romans[i]);
        const toR = normalizeRoman(romans[i + 1]);
        const key = `${fromR}→${toR}`;
        const rule = Data.TRANSITION_RULES[key];

        if (rule) {
            transitions.push({
                from: chords[i].chord, to: chords[i + 1].chord,
                fromRoman: romans[i], toRoman: romans[i + 1],
                strength: rule.strength,
                explanation: rule.explanation,
                voiceLead: rule.voiceLead,
                position: i
            });
        } else {
            // Fallback for unrecognised pairs
            const fallback = guessFallbackTransition(fromR, toR, isMinor);
            transitions.push({
                from: chords[i].chord, to: chords[i + 1].chord,
                fromRoman: romans[i], toRoman: romans[i + 1],
                ...fallback,
                position: i
            });
        }
    }

    // --- 3. Substitution Suggestions ---
    const substitutions = [];
    for (let i = 0; i < chords.length; i++) {
        const r = normalizeRoman(chords[i].roman || '');
        const subEntry = Data.CHORD_SUBSTITUTIONS[r];
        if (subEntry) {
            const alts = isMinor ? (subEntry.minor.length > 0 ? subEntry.minor : subEntry.major) : (subEntry.major.length > 0 ? subEntry.major : subEntry.minor);
            if (alts.length > 0) {
                substitutions.push({ chordIdx: i, chord: chords[i].chord, roman: r, alternatives: alts });
            }
        }
    }

    // --- 4. Mood Arc ---
    const tensionMap = isMinor ? Data.TENSION_VALUES.minor : Data.TENSION_VALUES.major;
    // Classify each chord against the current key using the same classifier
    // the chord-progression viewer uses, so the analysis and the viewer agree
    // on what's diatonic vs borrowed vs outside. Without this, the mood arc
    // would happily render an out-of-key chord with a moderate-gold colour
    // (the default tension fallback) while the viewer rendered it red.
    const keyResultForClassify = { key: keyRoot, type: isMinor ? 'minor' : 'major' };
    const classifications = chords.map(c => {
        const transposed = c.roman ? transposeChord(c.chord, c.roman, state.progressionKey, state.selectedKey) : c.chord;
        return classifyChordInKey(transposed, keyResultForClassify);
    });
    const tensions = romans.map((r, i) => {
        const nr = normalizeRoman(r);
        if (tensionMap[nr] !== undefined) return tensionMap[nr];
        // Outside-key chords are tense + ambiguous — surface that visually
        // rather than defaulting to "moderate" gold.
        if (classifications[i] === 'outside') return 3;
        return 2; // default moderate for unrecognised but in-key chords
    });

    const avgTension = tensions.reduce((a, b) => a + b, 0) / tensions.length;
    const maxT = Math.max(...tensions);
    const minT = Math.min(...tensions);
    const range = maxT - minT;
    const lastT = tensions[tensions.length - 1];
    const firstT = tensions[0];

    // Build narrative
    let narrative = '';
    if (firstT <= 0.5) narrative += 'Starts at rest';
    else if (firstT <= 1.5) narrative += 'Starts gently';
    else narrative += 'Starts with tension';

    if (range < 1) narrative += ' → stays steady throughout';
    else if (maxT > 2.5) narrative += ' → builds to a dramatic peak';
    else narrative += ' → moves through moderate shifts';

    if (lastT <= 0.5) narrative += ' → resolves completely.';
    else if (lastT <= 1.5) narrative += ' → settles softly.';
    else if (lastT >= 2.5) narrative += ' → ends with unresolved tension.';
    else narrative += ' → ends in transition.';

    // Character label
    let character = '';
    const hasCadence = name => cadences.some(c => c.name === name);
    if (hasCadence('Axis of Awesome')) character = 'Pop anthem formula';
    else if (hasCadence('Doo-Wop / 50s')) character = 'Classic nostalgic';
    else if (hasCadence('Andalusian Cadence')) character = 'Dramatic Spanish/flamenco';
    else if (hasCadence('Jazz ii-V-I')) character = 'Sophisticated jazz harmony';
    else if (hasCadence('Neapolitan Cadence')) character = 'Dark classical drama';
    else if (hasCadence('Rock Cadence')) character = 'Heroic rock anthem';
    else if (hasCadence('Circle Progression')) character = 'Elegant descending fifths';
    else if (hasCadence('Descending Bass')) character = 'Beautiful Pachelbel-style';
    else if (hasCadence('Backdoor Cadence')) character = 'Modal rock feel';
    else if (hasCadence('Minor Plagal')) character = 'Heartbreak moment';
    else if (hasCadence('Authentic Cadence') && hasCadence('Plagal Cadence')) character = 'Strong double resolution';
    else if (hasCadence('Authentic Cadence')) character = 'Classic strong resolution';
    else if (hasCadence('Deceptive Cadence')) character = 'Unexpected emotional turn';
    else if (hasCadence('Plagal Cadence')) character = 'Gentle hymn-like close';
    else if (hasCadence('Half Cadence')) character = 'Open-ended, anticipatory';
    else if (isMinor && avgTension > 2) character = 'Dark and intense';
    else if (isMinor) character = 'Moody minor journey';
    else if (avgTension < 1.5) character = 'Relaxed and smooth';
    else if (avgTension > 2.5) character = 'Tension-driven and dramatic';
    else character = 'Balanced harmonic movement';

    return {
        cadences,
        transitions,
        substitutions,
        moodArc: { tensions, narrative, character, classifications },
        chordRomans: romans,
        chordClassifications: classifications,
        outsideChords: classifications
            .map((cls, i) => cls === 'outside' ? { idx: i, chord: chords[i].chord } : null)
            .filter(Boolean),
        isEmpty: false
    };
}

function normalizeRoman(r) {
    // Strip quality suffixes for matching (e.g. "ii7" → "ii", "Imaj7" → "I")
    // But keep important qualifiers like °, dim, #
    return r.replace(/maj7|7|m7b5|m7|m9|m|add9|sus2|sus4|9|6/g, '').trim();
}

function guessFallbackTransition(fromR, toR, isMinor) {
    // Same chord repetition
    if (fromR === toR) return { strength: 'good', explanation: 'Repeating the same chord. Adds emphasis and rhythmic drive.', voiceLead: 'Sustain or re-articulate. Try adding rhythmic variation.' };

    // Augmented chord
    if (fromR.includes('+') || fromR.includes('aug')) {
        return { strength: 'colour', explanation: 'Augmented chord creating upward chromatic pull. The raised fifth wants to resolve up by semitone.', voiceLead: 'The augmented fifth resolves up a half step. Let the voice leading guide you.' };
    }

    // Suspended chord resolving
    if (fromR.includes('sus')) {
        return { strength: 'good', explanation: 'Suspended chord resolving — the sus4 or sus2 falls to the natural third, releasing tension.', voiceLead: 'The suspended note resolves by step. A classic tension-release moment.' };
    }

    // Seventh chord
    if (fromR.includes('7') || fromR.includes('maj7')) {
        return { strength: 'good', explanation: 'Seventh chord adding colour and pull. The added seventh creates a tendency tone that wants to resolve.', voiceLead: 'The seventh voice resolves down by step. Listen for smooth inner voice motion.' };
    }

    // Diminished chords resolving up a semitone
    if (fromR.includes('°') || fromR.includes('dim')) return { strength: 'colour', explanation: 'Diminished chord creating chromatic tension. Typically resolves up a half-step.', voiceLead: 'Diminished tones resolve by semitone — both tritones collapse inward.' };

    // Movement to V or V7 (any approach to dominant)
    if (toR === 'V' || toR === 'V7') {
        return { strength: 'good', explanation: 'Approaching the dominant — building tension before the big resolution. Almost any chord can lead to V.', voiceLead: 'Focus on voice leading into the dominant triad. The leading tone is key.' };
    }

    // Movement from any to IV or iv
    if (toR === 'IV' || toR === 'iv') {
        return { strength: 'good', explanation: 'Moving to the subdominant — a stable, warm landing point. Creates a sense of broadening.', voiceLead: 'The subdominant is forgiving — many approach angles work. Listen for common tones.' };
    }

    // Movement between two minor chords
    if (fromR === fromR.toLowerCase() && toR === toR.toLowerCase() && fromR !== toR && !fromR.includes('/') && !toR.includes('/')) {
        return { strength: 'good', explanation: 'Minor-to-minor motion — parallel quality creates a dark, cohesive mood. Common in film scores and minor key writing.', voiceLead: 'Look for common tones and stepwise motion between the minor triads.' };
    }

    // Movement between two major chords (not standard diatonic)
    if (fromR === fromR.toUpperCase() && toR === toR.toUpperCase() && fromR !== toR && fromR.length <= 3 && toR.length <= 3 && !fromR.includes('/') && !toR.includes('/')) {
        return { strength: 'colour', explanation: 'Major-to-major shift — parallel major motion creates a bold, cinematic sound. Often used in modal or chromatic writing.', voiceLead: 'Check the root motion interval — thirds and steps give the smoothest parallel major shifts.' };
    }

    // Any chord to I or i
    if (toR === 'I' || toR === 'i') return { strength: 'good', explanation: 'Resolving to tonic. Any chord can come home.', voiceLead: 'Listen for the strongest voice leading connection to the tonic triad.' };

    // Default
    return { strength: 'unusual', explanation: 'An unexpected pairing — could be chromatic, modal, or experimental. Unusual moves can be the most memorable!', voiceLead: 'Look for common tones or stepwise motion between chord tones.' };
}


// Re-run the currently-shown analysis (if any) against the current state.
// Called whenever the key, chord set, or major/minor mode changes so the
// displayed analysis stays in sync without the user having to re-click the
// lightbulb. No-op when nothing is being analyzed.
function refreshActiveAnalysis() {
    const lineIdx = state.activeAnalysisLineIdx;
    if (lineIdx == null) return;
    const line = state.progressionLines[lineIdx];
    if (!line) { state.activeAnalysisLineIdx = null; return; }
    const isMinor = state.selectedTab === 'dark';
    const analysis = analyzeProgression(line.chords, isMinor);
    showProgressionAnalysis(analysis, lineIdx);
}

function showProgressionAnalysis(analysis, lineIdx) {
    const theoryDiv = document.getElementById('chordTheoryContext');
    const titleDiv = document.getElementById('chordDetailTitle');
    // Make sure the detail panel is visible (the × button can hide it).
    const detailSection = document.querySelector('.detail-section');
    if (detailSection) detailSection.style.display = '';

    const line = state.progressionLines[lineIdx];

    if (analysis.isEmpty) {
        titleDiv.textContent = 'Progression Analysis';
        theoryDiv.innerHTML = analysis.reason
            ? `<div class="theory-item">${analysis.reason}</div>`
            : '<div class="theory-item">Add at least 2 chords to analyse.</div>';
        return;
    }

    titleDiv.textContent = `Analysis — ${(line && line.name) || 'Line ' + (lineIdx + 1)}`;

    let html = '<div class="analysis-panel">';

    // --- Character Badge ---
    html += `<div class="analysis-section">
        <div class="character-badge">${analysis.moodArc.character}</div>
    </div>`;

    // --- Mood Arc ---
    html += `<div class="analysis-section">
        <div class="analysis-section-title">Mood Arc</div>
        <div class="mood-bar-container">
            <div class="mood-bar">`;
    const maxTension = Math.max(...analysis.moodArc.tensions, 3.5);
    const cls = analysis.moodArc.classifications || [];
    analysis.moodArc.tensions.forEach((t, i) => {
        const pct = Math.max(8, (t / maxTension) * 100);
        // Outside-key chords get a distinctive grey-red so they visually stand
        // out from the in-key gold→red gradient — matches the chord-viewer's
        // out-of-key red border. This is what the user reported was missing
        // ("G shows as out of key in the viewer but colourful in the analysis").
        const isOutside = cls[i] === 'outside';
        const bg = isOutside
            ? 'hsl(0, 60%, 45%)'
            : `hsl(${45 - (t / maxTension) * 45}, 80%, 55%)`;
        const titleSuffix = isOutside ? ' (outside key)' : '';
        html += `<div class="mood-segment" style="height:${pct}%;background:${bg}" title="Tension: ${t.toFixed(1)}${titleSuffix}"></div>`;
    });
    html += `</div>
            <div class="mood-labels">
                <span>Rest</span><span>Tension</span>
            </div>
        </div>
        <div class="mood-narrative">${analysis.moodArc.narrative}</div>
    </div>`;

    // Explicit callout for chords that don't fit the current key, so the
    // analysis and the chord-viewer agree on what's outside.
    if (analysis.outsideChords && analysis.outsideChords.length > 0) {
        const list = analysis.outsideChords.map(o => `<span class="outside-chord-pill">${o.chord}</span>`).join(' ');
        html += `<div class="analysis-section analysis-outside">
            <div class="analysis-section-title">Outside the key</div>
            <div class="outside-chord-list">${list}</div>
            <div class="analysis-tip">These chords don't fit ${state.selectedKey}${(state.selectedTab === 'dark') ? ' minor' : ' major'}. Consider whether they're intentional colour, a key change, or a typo — and either change the key, replace them, or own the chromatic move.</div>
        </div>`;
    }

    // --- Detected Cadences ---
    if (analysis.cadences.length > 0) {
        html += `<div class="analysis-section">
            <div class="analysis-section-title">Detected Cadences</div>
            <div class="cadence-list">`;
        // De-duplicate overlapping cadences (keep all unique names)
        const seen = new Set();
        for (const cad of analysis.cadences) {
            const key = `${cad.name}-${cad.position}`;
            if (seen.has(key)) continue;
            seen.add(key);
            html += `
            <div class="cadence-item">
                <div class="cadence-tag">${cad.name}</div>
                <div class="cadence-chords">${cad.romansMatched} <span class="cadence-pos">(chords ${cad.position + 1}–${cad.endPosition + 1})</span></div>
                <div class="cadence-desc">${cad.description}</div>
                <div class="cadence-tip">💡 ${cad.tip}</div>
            </div>`;
        }
        html += `</div></div>`;
    } else {
        html += `<div class="analysis-section">
            <div class="analysis-section-title">Detected Cadences</div>
            <div class="cadence-none">No standard cadence patterns found — this is an unconventional progression! That can be a great thing.</div>
        </div>`;
    }

    // --- Chord-by-Chord Transitions ---
    html += `<div class="analysis-section">
        <div class="analysis-section-title">Transitions</div>
        <div class="transition-list">`;
    for (const tr of analysis.transitions) {
        const dotColor = tr.strength === 'strong' ? '#4caf50' :
                         tr.strength === 'good' ? '#c8a04a' :
                         tr.strength === 'colour' ? '#ff9800' :
                         tr.strength === 'unusual' ? '#f44336' : '#999';
        const label = tr.strength === 'strong' ? 'Strong' :
                      tr.strength === 'good' ? 'Natural' :
                      tr.strength === 'colour' ? 'Colourful' :
                      tr.strength === 'unusual' ? 'Unusual' : 'Rare';
        html += `
        <div class="transition-row">
            <div class="transition-header">
                <span class="strength-dot" style="background:${dotColor}" title="${label}"></span>
                <span class="transition-chords">${tr.from} <span class="transition-arrow-sm">→</span> ${tr.to}</span>
                <span class="transition-romans">${tr.fromRoman} → ${tr.toRoman}</span>
                <span class="transition-strength">${label}</span>
            </div>
            <div class="transition-explain">${tr.explanation}</div>
            <div class="transition-voice">🎵 ${tr.voiceLead}</div>
        </div>`;
    }
    html += `</div></div>`;

    // --- Substitution Suggestions ---
    if (analysis.substitutions.length > 0) {
        html += `<div class="analysis-section">
            <div class="analysis-section-title">Try Instead</div>
            <div class="substitution-list">`;
        for (const sub of analysis.substitutions) {
            html += `<div class="substitution-row">
                <div class="sub-chord">${sub.chord} <span class="sub-roman">(${sub.roman})</span></div>
                <div class="sub-alternatives">`;
            for (const alt of sub.alternatives) {
                html += `<span class="suggestion-chip" title="${alt.reason}">${alt.sub} — ${alt.reason}</span>`;
            }
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }

    html += '</div>';
    theoryDiv.innerHTML = html;
}

function popoutToWindow(panelId) {
    // Map panel IDs to their container elements
    // Pop-out is implemented by opening the SAME app URL with ?popout=<panelId>.
    // The popped-out window then runs a fully-functional second instance of
    // the app (with its own event handlers and state, picked up from
    // localStorage). On init the page detects the param, opens the requested
    // panel, and adds body.popout-mode + body.popout-mode-<panelId> so the CSS
    // can hide the surrounding chrome.
    //
    // The previous implementation cloned innerHTML into a static window — that
    // looked right but had no event handlers, so popped-out tools (especially
    // the Arpeggiator) were dead.

    const sizes = {
        'chordPicker': 'width=540,height=720',
        'keyFinder': 'width=540,height=600',
        'arpeggiator': 'width=1100,height=640',
        'scaleVisualizer': 'width=1100,height=720',
        'tuner': 'width=540,height=600'
    };
    if (!sizes[panelId]) return;

    const url = '/?popout=' + encodeURIComponent(panelId);
    const win = window.open(url, '_blank', sizes[panelId] + ',scrollbars=yes,resizable=yes');
    if (!win) { alert('Pop-up blocked! Please allow pop-ups for this site.'); return; }
}

// ===== GUITAR TUNER =====

// ══════════════════════════════════════════════════════════════════════
// GUITAR TUNER — Precision Strobe (redesign, ported from the demo)
// Strobe band + scrolling pitch tracker, adaptive one-euro detection,
// 27 categorised tunings, mic input meter. Detection is YIN (unchanged).
// ══════════════════════════════════════════════════════════════════════

const NOTE_SEMITONE = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11 };
function tunerNoteToFreq(note, oct) {
    const midi = (oct + 1) * 12 + NOTE_SEMITONE[note];
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// [key, display name, "note octave" sequence from low string to high]
const TUNING_GROUPS = [
  { category: 'Standard', items: [
    ['standard', 'Standard', 'E2 A2 D3 G3 B3 E4'],
  ]},
  { category: 'Power', items: [
    ['dropD',        'Drop D',           'D2 A2 D3 G3 B3 E4'],
    ['doubleDropD',  'Double Drop D',    'D2 A2 D3 G3 B3 D4'],
    ['dModal',       'D Modal (DADGAD)', 'D2 A2 D3 G3 A3 D4'],
    ['dropCsharp',   'Drop C#',          'C#2 G#2 C#3 F#3 A#3 D#4'],
    ['dropC',        'Drop C',           'C2 G2 C3 F3 A3 D4'],
    ['dropB',        'Drop B',           'B1 F#2 B2 E3 G#3 C#4'],
    ['dropA',        'Drop A',           'A1 E2 A2 D3 F#3 B3'],
    ['gModal',       'G Modal',          'D2 G2 D3 G3 C4 D4'],
  ]},
  { category: 'Open', items: [
    ['openC',  'Open C',   'C2 G2 C3 G3 C4 E4'],
    ['openE',  'Open E',   'E2 B2 E3 G#3 B3 E4'],
    ['openF',  'Open F',   'C2 F2 C3 F3 A3 F4'],
    ['openG',  'Open G',   'D2 G2 D3 G3 B3 D4'],
    ['openA',  'Open A',   'E2 A2 C#3 E3 A3 E4'],
    ['openA2', 'Open A 2', 'E2 A2 E3 A3 C#4 E4'],
    ['openAm', 'Open Am',  'E2 A2 E3 A3 C4 E4'],
    ['openEm', 'Open Em',  'E2 B2 E3 G3 B3 E4'],
    ['openD',  'Open D',   'D2 A2 D3 F#3 A3 D4'],
    ['openDm', 'Open Dm',  'D2 A2 D3 F3 A3 D4'],
  ]},
  { category: 'Extra', items: [
    ['halfStepDown',  'Half Step Down',  'D#2 G#2 C#3 F#3 A#3 D#4'],
    ['wholeStepDown', 'Whole Step Down', 'D2 G2 C3 F3 A3 D4'],
    ['plus1',         'Plus 1',          'F2 A#2 D#3 G#3 C4 F4'],
    ['plus2',         'Plus 2',          'F#2 B2 E3 A3 C#4 F#4'],
  ]},
  { category: 'Alternate', items: [
    ['doubleDaddy', 'Double Daddy', 'D2 A2 D3 D3 A3 D4'],
    ['all4th',      'All 4th',      'E2 A2 D3 G3 C4 F4'],
    ['nst',         'NST',          'C2 G2 D3 A3 E4 G4'],
    ['ostrich',     'Ostrich',      'D2 D3 D3 D4 D4 D4'],
  ]},
];
function buildTunings() {
  const map = {}, groups = [];
  for (const g of TUNING_GROUPS) {
    const out = [];
    for (const [key, name, seq] of g.items) {
      const strings = seq.trim().split(/\s+/).map(tok => {
        const m = tok.match(/^([A-G][#b]?)(-?\d+)$/);
        const note = m[1], oct = parseInt(m[2], 10);
        return { note, oct, freq: tunerNoteToFreq(note, oct) };
      });
      map[key] = { name, category: g.category, seq, strings };
      out.push({ key, name, seq });
    }
    groups.push({ category: g.category, items: out });
  }
  return { map, groups };
}
const _uzTun = buildTunings();
const TUNINGS = _uzTun.map;
const TUNING_SELECT_GROUPS = _uzTun.groups;

// ── Tuner colours + thresholds ──
const TUNER_COLORS = { green: '#4caf50', gold: '#c8a04a', red: '#e53935', idle: '#666666' };
const TUNER_IN_TUNE = 3, TUNER_CLOSE = 10;
function tnClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function tnColor(cents, inTune) {
  if (inTune || Math.abs(cents) <= TUNER_IN_TUNE) return TUNER_COLORS.green;
  if (Math.abs(cents) <= TUNER_CLOSE) return TUNER_COLORS.gold;
  return TUNER_COLORS.red;
}
function tnHexRgb(hex) { const h = hex.replace('#',''); return { r:parseInt(h.slice(0,2),16), g:parseInt(h.slice(2,4),16), b:parseInt(h.slice(4,6),16) }; }
function tnHexA(hex, a) { const c = tnHexRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }
function tnLerp(a, b, t) {
  const ca = tnHexRgb(a), cb = tnHexRgb(b);
  const r = Math.round(ca.r+(cb.r-ca.r)*t), g = Math.round(ca.g+(cb.g-ca.g)*t), bl = Math.round(ca.b+(cb.b-ca.b)*t);
  return '#' + [r,g,bl].map(x => x.toString(16).padStart(2,'0')).join('');
}

// ── One-euro adaptive filter (in the cents domain) ──
class TunerOneEuro {
  constructor(minCutoff=0.9, beta=0.012, dCutoff=1.0){ this.minCutoff=minCutoff; this.beta=beta; this.dCutoff=dCutoff; this.xPrev=null; this.dxPrev=0; this.tPrev=null; }
  alpha(cutoff, dt){ const tau = 1/(2*Math.PI*cutoff); return 1/(1+tau/dt); }
  reset(){ this.xPrev=null; this.dxPrev=0; this.tPrev=null; }
  filter(x, t){
    if (this.tPrev===null){ this.tPrev=t; this.xPrev=x; this.dxPrev=0; return x; }
    let dt=(t-this.tPrev)/1000; if (dt<=0||dt>0.25) dt=1/60;
    const dx=(x-this.xPrev)/dt, aD=this.alpha(this.dCutoff,dt), dxHat=aD*dx+(1-aD)*this.dxPrev;
    const cutoff=this.minCutoff+this.beta*Math.abs(dxHat), a=this.alpha(cutoff,dt), xHat=a*x+(1-a)*this.xPrev;
    this.xPrev=xHat; this.dxPrev=dxHat; this.tPrev=t; return xHat;
  }
}
const TUNER_CENT_REF = 55;
const tunerPitchFilter = new TunerOneEuro(0.9, 0.012, 1.0);
function tunerFreqToCents(f){ return 1200*Math.log2(f/TUNER_CENT_REF); }
function tunerCentsToFreq(c){ return TUNER_CENT_REF*Math.pow(2, c/1200); }

// ── Tuner runtime state ──
let tunerAudioCtx = null, tunerAnalyser = null, tunerMicStream = null;
let tunerAnimFrame = null, tunerMicBuf = null;
const TUNER_FILTER_BUF = 12;
let tunerFreqBuf = [];
const TUNER_CONF_START = 0.35, TUNER_CONF_SUSTAIN = 0.12, TUNER_HOLD_FRAMES = 55;
let tunerVoiced = false, tunerHold = 0, tunerLastGoodFreq = null;
let tunerLockedString = null, tunerLockCounter = 0;
const TUNER_LOCK_THRESHOLD = 10;
let tunerLastHadSignal = false, tunerLastFrameT = 0;
const tunerLevel = { lowFrames: 0 };
const TUNER_STROBE_ROWS = [
  { y: 4,  opacity: 0.5, blockW: 40 }, { y: 28, opacity: 0.8, blockW: 30 },
  { y: 52, opacity: 1.0, blockW: 20 }, { y: 76, opacity: 0.8, blockW: 30 },
  { y: 96, opacity: 0.5, blockW: 40 },
];
const tunerStrobe = { rows: [], velocity: 0, color: TUNER_COLORS.idle, targetColor: TUNER_COLORS.idle };
const tunerTracker = { ctx: null, w: 0, h: 0, buffer: [], cap: 150, hasSignal: [], pulse: 0 };

// ── DOM helpers ──
function tnEl(id){ return document.getElementById(id); }

function renderTuner() {
    const container = document.getElementById('tunerContainer');
    if (!state.showTuner) {
        container.classList.add('hidden');
        stopTuner();
        return;
    }
    container.classList.remove('hidden');
    const strings = TUNINGS[state.tunerTuning].strings;
    const labels = ['low','','','','','high'];

    const tuningOptions = TUNING_SELECT_GROUPS.map(g =>
        `<optgroup label="${g.category}">` +
        g.items.map(it => `<option value="${it.key}" ${it.key === state.tunerTuning ? 'selected' : ''}>${it.name} &middot; ${it.seq}</option>`).join('') +
        `</optgroup>`).join('');

    container.innerHTML = `
        <div class="tuner-panel ps-tuner">
          <div class="tuner-header">
            <span class="tuner-title">Tuner</span>
            <div class="tuner-mode-toggle">
              <button class="tuner-mode-btn ${state.tunerAutoDetect ? 'active' : ''}" data-action="setTunerMode" data-mode="auto">Auto</button>
              <button class="tuner-mode-btn ${!state.tunerAutoDetect ? 'active' : ''}" data-action="setTunerMode" data-mode="manual">Manual</button>
            </div>
            <select class="tuner-tuning-select" id="tunerTuningSelect">${tuningOptions}</select>
            <button class="popout-btn" data-action="popoutPanel" data-panel="tuner" title="Pop out to window">&#10696;</button>
            <button class="panel-close-btn" data-action="toggleTuner" title="Close">&times;</button>
          </div>

          <div class="ps-note-row">
            <span class="ps-note" id="tunerNote">&#183;</span>
            <div class="ps-cents-box" id="tunerCentsBox">
              <span class="ps-cents" id="tunerCents">0</span>
              <span class="ps-cents-label">cents</span>
            </div>
          </div>

          <div class="ps-freq-row">
            <span id="tunerDetFreq">Detected: &#8230; Hz</span>
            <span id="tunerTgtFreq">Target: &#8230; Hz</span>
          </div>

          <div class="ps-strobe" id="tunerStrobe">
            <div class="ps-strobe-center" id="tunerCenterLine"></div>
            <div class="ps-strobe-fade"></div>
            <div class="ps-strobe-hint" id="tunerStrobeHint">play a string</div>
          </div>

          <div class="ps-status">
            <span class="ps-status-dot" id="tunerStatusDot"></span>
            <span id="tunerStatusText">Press start and play a string</span>
          </div>

          <div class="ps-tracker-wrap"><canvas class="ps-tracker" id="tunerTracker"></canvas></div>

          <div class="tuner-strings-bar">
            ${strings.map((s, i) => `
              <button class="tuner-str-btn ${state.tunerSelectedString === i ? 'active' : ''}" data-action="selectTunerString" data-string-idx="${i}">
                <span class="tuner-str-name">${s.note}<sub>${s.oct}</sub></span>
                <span class="tuner-str-label">${labels[i] || ''}</span>
                ${state.tunerSelectedString === i ? '<span class="tuner-str-ind"></span>' : ''}
              </button>`).join('')}
          </div>

          <div class="ps-level-wrap" id="tunerLevelWrap">
            <div class="ps-level-head"><span>Mic input</span><span id="tunerLevelHint" class="ps-level-hint"></span></div>
            <div class="ps-level"><div class="ps-level-bar" id="tunerLevelBar"></div></div>
          </div>

          <div class="tuner-start-row">
            <button class="tuner-start-btn ${state.tunerActive ? 'active' : ''}" data-action="toggleTunerMic">
              ${state.tunerActive ? '&#9632; Stop Listening' : '&#127908; Start Tuning'}
            </button>
          </div>
        </div>`;

    buildTunerStrobeRows();
    setupTunerTracker();
    tunerStrobe.velocity = 0;
    tunerStrobe.targetColor = TUNER_COLORS.idle;
    tnEl('tunerLevelWrap').style.display = state.tunerActive ? 'block' : 'none';

    // single animation loop drives strobe + tracker (+ detection when listening)
    if (tunerAnimFrame) cancelAnimationFrame(tunerAnimFrame);
    tunerLastFrameT = performance.now();
    tunerAnimFrame = requestAnimationFrame(tunerFrame);
}

function buildTunerStrobeRows() {
    const strobe = tnEl('tunerStrobe');
    if (!strobe) return;
    tunerStrobe.rows.forEach(r => r.el.remove());
    tunerStrobe.rows = [];
    const width = 560;
    TUNER_STROBE_ROWS.forEach(cfg => {
        const tile = cfg.blockW * 2;
        const rowEl = document.createElement('div');
        rowEl.className = 'ps-strobe-row';
        rowEl.style.top = cfg.y + 'px';
        rowEl.style.opacity = cfg.opacity;
        const count = Math.ceil((width * 2) / tile) + 2;
        let inner = '';
        for (let i = 0; i < count; i++) {
            inner += `<span style="display:inline-block;width:${cfg.blockW}px;height:22px;background:${tunerStrobe.color};"></span>`;
            inner += `<span style="display:inline-block;width:${cfg.blockW}px;height:22px;"></span>`;
        }
        rowEl.style.width = (count * tile) + 'px';
        rowEl.innerHTML = inner;
        strobe.insertBefore(rowEl, strobe.querySelector('.ps-strobe-fade'));
        tunerStrobe.rows.push({ el: rowEl, tile, offset: 0, blocks: Array.from(rowEl.querySelectorAll('span:nth-child(odd)')) });
    });
}

function setupTunerTracker() {
    const canvas = tnEl('tunerTracker');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || 520, cssH = 80;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    tunerTracker.ctx = canvas.getContext('2d');
    if (!tunerTracker.ctx) return;
    tunerTracker.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tunerTracker.w = cssW; tunerTracker.h = cssH;
    tunerTracker.buffer = []; tunerTracker.hasSignal = [];
}

async function startTuner() {
    try {
        tunerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        tunerMicStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const source = tunerAudioCtx.createMediaStreamSource(tunerMicStream);
        tunerAnalyser = tunerAudioCtx.createAnalyser();
        tunerAnalyser.fftSize = 8192;
        tunerAnalyser.smoothingTimeConstant = 0;
        source.connect(tunerAnalyser);
        tunerMicBuf = new Float32Array(tunerAnalyser.fftSize);
        tunerFreqBuf = []; tunerVoiced = false; tunerHold = 0; tunerLastGoodFreq = null;
        tunerLevel.lowFrames = 0; tunerLockedString = null; tunerLockCounter = 0;
        tunerPitchFilter.reset();
        state.tunerActive = true;
        renderTuner();
    } catch (err) {
        alert('Could not access the microphone. Please allow microphone permission.');
        console.error('Tuner mic error:', err);
        state.tunerActive = false;
        renderTuner();
    }
}

function stopTuner() {
    try {
        if (tunerAnimFrame) { cancelAnimationFrame(tunerAnimFrame); tunerAnimFrame = null; }
        if (tunerMicStream) { tunerMicStream.getTracks().forEach(t => t.stop()); tunerMicStream = null; }
        if (tunerAudioCtx && tunerAudioCtx.state !== 'closed') { tunerAudioCtx.close().catch(() => {}); }
    } catch (err) { console.warn('Error stopping tuner:', err); }
    tunerAudioCtx = null; tunerAnalyser = null;
    state.tunerActive = false;
}

function tunerFrame(now) {
    tunerAnimFrame = requestAnimationFrame(tunerFrame);
    const dt = Math.min(0.05, (now - tunerLastFrameT) / 1000);
    tunerLastFrameT = now;

    // ── detection (when listening) ──
    if (tunerAnalyser && tunerMicBuf) {
        tunerAnalyser.getFloatTimeDomainData(tunerMicBuf);
        let rms = 0; for (let i = 0; i < tunerMicBuf.length; i++) rms += tunerMicBuf[i] * tunerMicBuf[i];
        rms = Math.sqrt(rms / tunerMicBuf.length);
        updateTunerLevel(rms);
        const res = detectPitch(tunerMicBuf, tunerAudioCtx.sampleRate);
        const conf = res ? res.confidence : 0;
        const threshold = tunerVoiced ? TUNER_CONF_SUSTAIN : TUNER_CONF_START;
        if (res && conf > threshold) {
            tunerFreqBuf.push(res.freq);
            if (tunerFreqBuf.length > TUNER_FILTER_BUF) tunerFreqBuf.shift();
            const sorted = [...tunerFreqBuf].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            const ok = (tunerFreqBuf.length < 3) || Math.abs(1200 * Math.log2(res.freq / median)) < 120;
            if (ok) {
                tunerVoiced = true; tunerHold = TUNER_HOLD_FRAMES; tunerLastGoodFreq = res.freq;
                const c = tunerPitchFilter.filter(tunerFreqToCents(res.freq), now);
                updateTunerReadout(tunerCentsToFreq(c));
            }
        } else if (tunerVoiced && tunerHold > 0) {
            tunerHold--;
            if (tunerLastGoodFreq) { const c = tunerPitchFilter.filter(tunerFreqToCents(tunerLastGoodFreq), now); updateTunerReadout(tunerCentsToFreq(c)); }
            if (tunerHold === 0) { tunerVoiced = false; tunerFreqBuf = []; }
        } else {
            tunerVoiced = false;
            decayTunerReadout();
        }
    }

    // ── strobe colour ease + scroll ──
    tunerStrobe.color = tnLerp(tunerStrobe.color, tunerStrobe.targetColor, Math.min(1, dt * 8));
    const cl = tnEl('tunerCenterLine');
    if (cl) { cl.style.background = tunerStrobe.color; cl.style.boxShadow = `0 0 8px ${tnHexA(tunerStrobe.color, 0.4)}`; }
    tunerStrobe.rows.forEach(r => { r.blocks.forEach(b => { b.style.background = tunerStrobe.color; }); });
    tunerStrobe.rows.forEach(r => {
        r.offset = (r.offset + tunerStrobe.velocity * dt) % r.tile;
        if (r.offset < 0) r.offset += r.tile;
        r.el.style.transform = `translate3d(${-r.offset}px,0,0)`;
    });
    tunerTracker.pulse += dt * 4;
    drawTunerTracker();
}

function detectPitch(buf, sampleRate) {
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms < 0.0009) return null;
    const halfLen = Math.floor(buf.length / 2);
    const diff = new Float32Array(halfLen);
    for (let tau = 0; tau < halfLen; tau++) {
        let sum = 0;
        for (let i = 0; i < halfLen; i++) { const d = buf[i] - buf[i + tau]; sum += d * d; }
        diff[tau] = sum;
    }
    const cmnd = new Float32Array(halfLen);
    cmnd[0] = 1; let runningSum = 0;
    for (let tau = 1; tau < halfLen; tau++) { runningSum += diff[tau]; cmnd[tau] = (runningSum > 0) ? (diff[tau] * tau / runningSum) : 1; }
    const minTau = Math.max(2, Math.floor(sampleRate / 500));
    const maxTau = Math.min(halfLen - 2, Math.floor(sampleRate / 55));
    let bestTau = -1;
    for (let tau = minTau; tau < maxTau; tau++) { if (cmnd[tau] < 0.15) { while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) tau++; bestTau = tau; break; } }
    if (bestTau < 0) { for (let tau = minTau; tau < maxTau; tau++) { if (cmnd[tau] < 0.35) { while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) tau++; bestTau = tau; break; } } }
    if (bestTau < 1) return null;
    const prev = cmnd[bestTau - 1], curr = cmnd[bestTau], next = (bestTau + 1 < halfLen) ? cmnd[bestTau + 1] : curr;
    const denom = 2 * curr - prev - next;
    let refinedTau = bestTau;
    if (Math.abs(denom) > 0.0001) { const shift = (prev - next) / (2 * denom); if (isFinite(shift) && Math.abs(shift) < 1) refinedTau = bestTau + shift; }
    let freq = sampleRate / refinedTau;
    if (freq < 55 || freq > 500) return null;
    const strings = TUNINGS[state.tunerTuning].strings;
    let closestToFreq = Infinity, closestToHalf = Infinity;
    for (const s of strings) {
        const c1 = Math.abs(1200 * Math.log2(freq / s.freq));
        const c2 = Math.abs(1200 * Math.log2((freq / 2) / s.freq));
        if (c1 < closestToFreq) closestToFreq = c1;
        if (c2 < closestToHalf) closestToHalf = c2;
    }
    const doubleTau = Math.round(refinedTau * 2);
    if (closestToHalf < closestToFreq - 150 && doubleTau < halfLen - 1 && cmnd[doubleTau] < 0.4 && (freq / 2) >= 55) freq = freq / 2;
    const confidence = 1 - Math.min(1, cmnd[bestTau]);
    return { freq, confidence, rms };
}

function resolveTunerString(freq) {
    const strings = TUNINGS[state.tunerTuning].strings;
    if (!state.tunerAutoDetect) {
        const idx = state.tunerSelectedString != null ? state.tunerSelectedString : 0;
        return { idx, cents: 1200 * Math.log2(freq / strings[idx].freq) };
    }
    let candIdx = 0, candCents = Infinity;
    for (let i = 0; i < strings.length; i++) { const c = 1200 * Math.log2(freq / strings[i].freq); if (Math.abs(c) < Math.abs(candCents)) { candCents = c; candIdx = i; } }
    if (tunerLockedString === null) { tunerLockedString = candIdx; tunerLockCounter = 0; }
    else if (candIdx !== tunerLockedString) {
        if (Math.abs(candCents) < 200) tunerLockCounter++;
        if (tunerLockCounter >= TUNER_LOCK_THRESHOLD) { tunerLockedString = candIdx; tunerLockCounter = 0; }
        else { candIdx = tunerLockedString; candCents = 1200 * Math.log2(freq / strings[tunerLockedString].freq); }
    } else { tunerLockCounter = 0; }
    return { idx: candIdx, cents: candCents };
}

function updateTunerReadout(freq) {
    const strings = TUNINGS[state.tunerTuning].strings;
    const { idx, cents } = resolveTunerString(freq);
    const target = strings[idx];
    if (Math.abs(cents) > 300) return;
    const inTune = Math.abs(cents) <= TUNER_IN_TUNE;
    const color = tnColor(cents, inTune);
    const noteEl = tnEl('tunerNote'); if (noteEl) { noteEl.innerHTML = `${target.note}<span class="ps-oct">${target.oct}</span>`; noteEl.style.color = color; }
    const shown = Math.round(cents);
    const centsEl = tnEl('tunerCents'); if (centsEl) { centsEl.textContent = (shown > 0 ? '+' : '') + shown; centsEl.style.color = color; }
    const box = tnEl('tunerCentsBox'); if (box) box.style.borderColor = tnHexA(color, 0.4);
    const det = tnEl('tunerDetFreq'); if (det) det.textContent = `Detected: ${freq.toFixed(1)} Hz`;
    const tgt = tnEl('tunerTgtFreq'); if (tgt) tgt.textContent = `Target: ${target.freq.toFixed(1)} Hz`;
    const dot = tnEl('tunerStatusDot'); if (dot) { dot.style.background = color; dot.style.boxShadow = `0 0 6px ${color}`; }
    const st = tnEl('tunerStatusText'); if (st) st.textContent = inTune ? 'Locked · In Tune' : (cents < 0 ? 'Flat · Tune Up ↑' : 'Sharp · Tune Down ↓');
    const hint = tnEl('tunerStrobeHint'); if (hint) hint.textContent = inTune ? 'locked' : (cents < 0 ? 'flat' : 'sharp');
    tunerStrobe.targetColor = color;
    tunerStrobe.velocity = inTune ? 0 : tnClamp(cents, -50, 50) * 11;
    if (state.tunerAutoDetect && idx !== state.tunerSelectedString) {
        state.tunerSelectedString = idx;
        document.querySelectorAll('.tuner-str-btn').forEach(btn => {
            const bi = parseInt(btn.dataset.stringIdx);
            btn.classList.toggle('active', bi === idx);
        });
    }
    tunerTracker.buffer.push(tnClamp(cents, -50, 50)); tunerTracker.hasSignal.push(true);
    if (tunerTracker.buffer.length > tunerTracker.cap) { tunerTracker.buffer.shift(); tunerTracker.hasSignal.shift(); }
    tunerLastHadSignal = true;
}

function decayTunerReadout() {
    tunerStrobe.velocity *= 0.9;
    if (Math.abs(tunerStrobe.velocity) < 2) tunerStrobe.velocity = 0;
    tunerTracker.buffer.push(0); tunerTracker.hasSignal.push(false);
    if (tunerTracker.buffer.length > tunerTracker.cap) { tunerTracker.buffer.shift(); tunerTracker.hasSignal.shift(); }
    if (tunerLastHadSignal) {
        const st = tnEl('tunerStatusText'); if (st) st.textContent = 'Waiting for signal';
        const dot = tnEl('tunerStatusDot'); if (dot) { dot.style.background = TUNER_COLORS.idle; dot.style.boxShadow = 'none'; }
    }
}

function drawTunerTracker() {
    const ctx = tunerTracker.ctx; if (!ctx) return;
    const W = tunerTracker.w, H = tunerTracker.h, cy = H / 2, maxCents = 50, scaleY = (cy - 4) / maxCents;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#0a0b0e'; ctx.fillRect(0, 0, W, H);
    const zoneH = 5 * scaleY; ctx.fillStyle = 'rgba(76,175,80,0.05)'; ctx.fillRect(0, cy - zoneH, W, zoneH * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
    [-40,-30,-20,-10,10,20,30,40].forEach(c => { const y = cy - c * scaleY; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); });
    ctx.strokeStyle = 'rgba(76,175,80,0.28)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(W,cy); ctx.stroke();
    const nn = tunerTracker.buffer.length;
    if (nn > 1) {
        const stepX = W / (tunerTracker.cap - 1), x0 = W - (nn - 1) * stepX;
        ctx.lineWidth = 2;
        for (let i = 1; i < nn; i++) {
            if (!tunerTracker.hasSignal[i] || !tunerTracker.hasSignal[i-1]) continue;
            const xA = x0+(i-1)*stepX, yA = cy - tnClamp(tunerTracker.buffer[i-1],-maxCents,maxCents)*scaleY;
            const xB = x0+i*stepX, yB = cy - tnClamp(tunerTracker.buffer[i],-maxCents,maxCents)*scaleY;
            const ageAlpha = Math.min(1, (i / nn) * 1.2);
            ctx.strokeStyle = tnHexA(tunerStrobe.color, 0.15 + 0.85 * ageAlpha);
            ctx.beginPath(); ctx.moveTo(xA,yA); ctx.lineTo(xB,yB); ctx.stroke();
        }
        if (tunerTracker.hasSignal[nn-1]) {
            const lastY = cy - tnClamp(tunerTracker.buffer[nn-1],-maxCents,maxCents)*scaleY;
            const inTune = Math.abs(tunerTracker.buffer[nn-1]) <= TUNER_IN_TUNE;
            const r = inTune ? (4 + Math.sin(tunerTracker.pulse) * 1.5) : 4;
            ctx.fillStyle = tnHexA(tunerStrobe.color, 0.25); ctx.beginPath(); ctx.arc(W-1,lastY,r+3,0,Math.PI*2); ctx.fill();
            ctx.fillStyle = tunerStrobe.color; ctx.beginPath(); ctx.arc(W-1,lastY,r,0,Math.PI*2); ctx.fill();
        }
    }
    const grad = ctx.createLinearGradient(0,0,W*0.18,0); grad.addColorStop(0,'#0a0b0e'); grad.addColorStop(1,'rgba(10,11,14,0)');
    ctx.fillStyle = grad; ctx.fillRect(0,0,W*0.18,H);
    ctx.font = '9px Outfit, sans-serif';
    ctx.fillStyle = 'rgba(229,57,53,0.55)'; ctx.textAlign = 'left'; ctx.fillText('♯ sharp', 6, 13); ctx.fillText('♭ flat', 6, H-6);
    ctx.fillStyle = 'rgba(76,175,80,0.7)'; ctx.textAlign = 'center'; ctx.fillText('in tune', W/2, cy - zoneH - 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W-1,0); ctx.lineTo(W-1,H); ctx.stroke();
}

function updateTunerLevel(rms) {
    const bar = tnEl('tunerLevelBar'); if (!bar) return;
    const pct = Math.min(100, Math.sqrt(Math.max(0, rms)) * 170);
    bar.style.width = pct.toFixed(1) + '%';
    bar.style.background = rms > 0.32 ? TUNER_COLORS.red : (rms < 0.004 ? '#6a5a32' : TUNER_COLORS.gold);
    if (rms < 0.004) tunerLevel.lowFrames++; else tunerLevel.lowFrames = Math.max(0, tunerLevel.lowFrames - 4);
    const hint = tnEl('tunerLevelHint');
    if (hint) { if (tunerLevel.lowFrames > 110) hint.textContent = 'Very low signal, check mic'; else if (tunerLevel.lowFrames === 0) hint.textContent = ''; }
}


function render() {
    renderKeyButtons();
    renderTabs();
    renderChordGrid();
    renderProgression();
    renderScaleBoards();
    renderTuner();
    renderKeyFinder();
}

// ========== LYRICS PANEL (Embedded RhymeForge) ==========

// Ensure lyrics state exists
if (!state.lyrics) {
    state.lyrics = {
        freeText: '',
        sections: [],
        currentView: 'freewrite',
        currentTab: 'lyrics'
    };
}

// ===== v100 — Import from embedded RhymeForge =====
// The rhymeforge iframe inside the lyrics panel posts this message when the
// user picks a .rhymeforge.json file via "Import to UZ". We append the chosen
// text into state.lyrics.freeText (appending preserves any work in progress)
// and only set the UZ song title if it's currently empty.
function _uzShowImportToast(msg) {
    let toast = document.getElementById('uzImportToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'uzImportToast';
        toast.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);'
            + 'background:#222;color:#f5e9c8;padding:0.7rem 1.1rem;border-radius:8px;'
            + 'border:1px solid rgba(212,168,83,0.5);font-family:-apple-system,Segoe UI,Roboto,sans-serif;'
            + 'font-size:0.88rem;z-index:99999;box-shadow:0 4px 18px rgba(0,0,0,0.4);'
            + 'opacity:0;transition:opacity 0.2s;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 3200);
}

// Shared apply function — used by both the iframe postMessage handler and the
// native "Load from RhymeForge…" button on the Lyrics tab.
function _uzApplyRhymeforgeImport(payload) {
    const incomingText = (payload.text || '').replace(/\r\n/g, '\n').trim();
    if (!incomingText) {
        _uzShowImportToast('Nothing to import — the file had no text.');
        return;
    }

    // Append to freewrite. Keep prior content intact; separate with a blank line.
    const existing = (state.lyrics.freeText || '').replace(/\s+$/,'');
    state.lyrics.freeText = existing
        ? existing + '\n\n' + incomingText
        : incomingText;

    // Only fill in song title if UZ doesn't already have one.
    if ((!state.songName || !state.songName.trim()) && payload.title) {
        state.songName = String(payload.title).trim();
    }

    if (state.lyrics.currentView !== 'freewrite') state.lyrics.currentView = 'freewrite';
    if (state.lyrics.currentTab !== 'lyrics') state.lyrics.currentTab = 'lyrics';

    try { saveStateToLocalStorage(); } catch (err) {}
    try {
        if (typeof render === 'function') render();
        if (typeof renderLyricsPanel === 'function') renderLyricsPanel();
        const ta = document.getElementById('lpFreewriteArea');
        if (ta) {
            ta.value = state.lyrics.freeText;
            ta.scrollTop = ta.scrollHeight;
        }
    } catch (err) {}

    const fieldLabel = payload.field === 'scratch' ? 'scratch'
        : payload.field === 'both' ? 'scratch + poem' : 'poem';
    _uzShowImportToast('Imported ' + fieldLabel + (payload.title ? ' from "' + payload.title + '"' : '') + ' into freewrite.');
}

window.addEventListener('message', e => {
    const data = e && e.data;
    if (!data || data.type !== 'rhymeforge-import-to-uz') return;
    _uzApplyRhymeforgeImport(data.payload || {});
});

// Native "Load from RhymeForge…" button (on the Lyrics tab in UZ itself).
// Opens a .rhymeforge.json, shows the same field picker, then calls the
// shared apply function above. Bypasses the iframe entirely.
function _uzOpenImportPicker() {
    async function readAndPrompt(file) {
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!parsed || parsed.rhymeforge !== true) {
                _uzShowImportToast('Not a RhymeForge file.');
                return;
            }
            _uzShowImportFieldPicker(parsed);
        } catch (e) {
            _uzShowImportToast('Could not read the file.');
        }
    }

    if (window.showOpenFilePicker) {
        (async () => {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{ description: 'RhymeForge Project', accept: { 'application/json': ['.json'] } }],
                    multiple: false
                });
                const file = await handle.getFile();
                await readAndPrompt(file);
            } catch (e) {
                if (e.name !== 'AbortError') {
                    // Fall through to <input type=file> on platforms that don't support FSA properly
                    _uzFallbackInput(readAndPrompt);
                }
            }
        })();
    } else {
        _uzFallbackInput(readAndPrompt);
    }
}
function _uzFallbackInput(onFile) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) onFile(file);
    });
    input.click();
}
function _uzShowImportFieldPicker(parsed) {
    let modal = document.getElementById('uzNativeImportModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'uzNativeImportModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);'
            + 'display:flex;align-items:center;justify-content:center;z-index:99998;padding:20px;';
        modal.innerHTML = `
          <div role="dialog" aria-modal="true" style="background:#fffbf0;color:#1a1410;border:1px solid #d4a745;border-radius:14px;max-width:520px;width:100%;padding:24px;box-shadow:0 12px 36px rgba(0,0,0,0.4);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <h3 style="margin:0 0 0.4rem;font-size:1.05rem;color:#8a5a00;font-family:'Playfair Display',serif;">Import lyrics from RhymeForge</h3>
            <div id="uzNativeImportMeta" style="margin:0 0 0.6rem;font-size:0.92rem;"></div>
            <p style="margin:0 0 1rem;font-size:0.82rem;color:#776;line-height:1.5;">Pick what to send into your freewrite. It will be appended below any lyrics already there.</p>
            <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1.1rem;">
              <label style="display:flex;gap:0.55rem;align-items:flex-start;padding:0.5rem 0.7rem;border:1px solid #e5d6a8;border-radius:8px;cursor:pointer;font-size:0.85rem;line-height:1.4;">
                <input type="radio" name="uzNativeImportField" value="poem" checked style="margin-top:0.2rem;accent-color:#c8a04a;">
                <div><strong>Polished poem only</strong> <span style="color:#998;">— the "Your Poem / Lyrics" field</span></div>
              </label>
              <label style="display:flex;gap:0.55rem;align-items:flex-start;padding:0.5rem 0.7rem;border:1px solid #e5d6a8;border-radius:8px;cursor:pointer;font-size:0.85rem;line-height:1.4;">
                <input type="radio" name="uzNativeImportField" value="scratch" style="margin-top:0.2rem;accent-color:#c8a04a;">
                <div><strong>Scratch only</strong> <span style="color:#998;">— raw scratchpad ideas</span></div>
              </label>
              <label style="display:flex;gap:0.55rem;align-items:flex-start;padding:0.5rem 0.7rem;border:1px solid #e5d6a8;border-radius:8px;cursor:pointer;font-size:0.85rem;line-height:1.4;">
                <input type="radio" name="uzNativeImportField" value="both" style="margin-top:0.2rem;accent-color:#c8a04a;">
                <div><strong>Both, stitched</strong> <span style="color:#998;">— scratch above poem with a divider</span></div>
              </label>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
              <button type="button" id="uzNativeImportCancel" style="padding:0.5rem 1rem;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer;font-family:inherit;">Cancel</button>
              <button type="button" id="uzNativeImportConfirm" style="padding:0.5rem 1rem;border:1px solid #c8a04a;background:#c8a04a;color:#fff;border-radius:6px;cursor:pointer;font-weight:600;font-family:inherit;">Send to freewrite</button>
            </div>
          </div>
        `;
        modal.addEventListener('click', e => {
            if (e.target === modal) modal.style.display = 'none';
        });
        document.body.appendChild(modal);
    }

    const meta = modal.querySelector('#uzNativeImportMeta');
    const savedDate = parsed.savedAt ? new Date(parsed.savedAt).toLocaleString() : '';
    meta.innerHTML = '<strong>' + escapeHtml(parsed.title || 'Untitled') + '</strong>'
                   + (savedDate ? ' <span style="color:#998;font-weight:400;">— saved ' + escapeHtml(savedDate) + '</span>' : '');

    const cancel = () => { modal.style.display = 'none'; };
    const confirm = () => {
        const field = (modal.querySelector('input[name="uzNativeImportField"]:checked') || {}).value || 'poem';
        const poem = (parsed.poem || '').trim();
        const scratch = (parsed.scratch || '').trim();
        let text;
        if (field === 'poem') text = poem;
        else if (field === 'scratch') text = scratch;
        else text = (scratch ? '--- scratch notes ---\n' + scratch + '\n\n' : '') + poem;
        cancel();
        _uzApplyRhymeforgeImport({ title: parsed.title || '', text, field, savedAt: parsed.savedAt || null });
    };

    const cancelBtn = modal.querySelector('#uzNativeImportCancel');
    const confirmBtn = modal.querySelector('#uzNativeImportConfirm');
    // Replace handlers via cloneNode to avoid stacking listeners across opens
    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    newCancel.addEventListener('click', cancel);
    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    newConfirm.addEventListener('click', confirm);

    modal.style.display = 'flex';
}

let lpActiveChordPicker = null; // track open chord picker

function syncBodyPanelSize() {
    document.body.classList.remove('lp-size-half', 'lp-size-third', 'lp-size-quarter');
    const panel = document.getElementById('lyricsPanel');
    if (panel.classList.contains('size-half')) document.body.classList.add('lp-size-half');
    else if (panel.classList.contains('size-third')) document.body.classList.add('lp-size-third');
    else if (panel.classList.contains('size-quarter')) document.body.classList.add('lp-size-quarter');
}

function openLyricsPanel() {
    const panel = document.getElementById('lyricsPanel');
    const tab = document.getElementById('lyricsPanelTab');
    panel.classList.add('open');
    if (!panel.classList.contains('size-half') && !panel.classList.contains('size-third') && !panel.classList.contains('size-quarter')) {
        panel.classList.add('size-half');
    }
    tab.classList.add('active');
    document.body.classList.add('lyrics-panel-open');
    syncBodyPanelSize();
    renderLyricsPanel();
}

function closeLyricsPanel() {
    const panel = document.getElementById('lyricsPanel');
    const tab = document.getElementById('lyricsPanelTab');
    panel.classList.remove('open');
    tab.classList.remove('active');
    document.body.classList.remove('lyrics-panel-open', 'lp-size-half', 'lp-size-third', 'lp-size-quarter');
}

function setLyricsPanelSize(size) {
    const panel = document.getElementById('lyricsPanel');
    panel.classList.remove('size-half', 'size-third', 'size-quarter');
    panel.classList.add('size-' + size);
    document.querySelectorAll('.lp-size-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.lpSize === size);
    });
    syncBodyPanelSize();
}

function parseFreeTextSections(text) {
    const lines = text.split('\n');
    const sections = [];
    let current = null;

    for (const line of lines) {
        const marker = line.match(/^\s*\[([^\]]+)\]\s*$/);
        if (marker) {
            if (current) sections.push(current);
            current = { label: marker[1].trim(), lines: [], lineIdx: -1, chordMap: {} };
        } else if (current) {
            if (line.trim() !== '') {
                current.lines.push(line);
            }
        }
        // Lines before any marker are ignored (or could be added to an "Intro" section)
    }
    if (current) sections.push(current);

    // Try to auto-match section labels to progression line names (including default "Line N" names)
    sections.forEach(sec => {
        const matchIdx = state.progressionLines.findIndex((pl, idx) => {
            const lineName = (pl.name || ('Line ' + (idx + 1))).toLowerCase();
            return lineName === sec.label.toLowerCase();
        });
        if (matchIdx >= 0) sec.lineIdx = matchIdx;
    });

    return sections;
}

function renderLyricsPanel() {
    const body = document.getElementById('lpBody');
    if (!body) return;

    const lyr = state.lyrics;
    const activeTab = lyr.currentTab || 'lyrics';
    const activeView = lyr.currentView || 'freewrite';

    // Update tab styling
    document.querySelectorAll('.lp-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.lpTab === activeTab);
    });

    // Maintain two persistent panes inside lpBody so the rhymeforge iframe
    // survives tab switches (otherwise it'd reload every time the user toggled
    // back to the rhymes tab).
    let lyricsPane = body.querySelector(':scope > .lp-pane-lyrics');
    let rhymesPane = body.querySelector(':scope > .lp-pane-rhymes');
    if (!lyricsPane || !rhymesPane) {
        body.innerHTML = '<div class="lp-pane lp-pane-lyrics"></div><div class="lp-pane lp-pane-rhymes"></div>';
        lyricsPane = body.querySelector(':scope > .lp-pane-lyrics');
        rhymesPane = body.querySelector(':scope > .lp-pane-rhymes');
    }
    lyricsPane.style.display = (activeTab === 'lyrics') ? '' : 'none';
    rhymesPane.style.display = (activeTab === 'rhymes') ? '' : 'none';

    if (activeTab === 'rhymes') {
        const rhymeQuery = state.lyrics._pendingRhymeSearch || '';
        // Re-use the existing iframe between searches so the rhymeforge bundle
        // (~1.6 MB) doesn't reload on every word click. The iframe is created
        // once on first render, then driven via postMessage thereafter. The
        // rhymeforge page's message listener (window.addEventListener('message')
        // in rhymeforge/index.html) handles {type:'rhymeSearch', word}.
        let iframe = rhymesPane.querySelector('.lp-rhymes-frame');
        const sendQuery = () => {
            if (!rhymeQuery || !iframe || !iframe.contentWindow) return;
            iframe.contentWindow.postMessage({ type: 'rhymeSearch', word: rhymeQuery }, '*');
        };
        if (!iframe) {
            // First time opening the rhymes tab — create the iframe with the
            // initial ?q= URL so the page auto-searches on load even if the
            // postMessage listener isn't ready yet. ?embed=1 tells rhymeforge
            // to hide its nav rail, suite footer, and big hero so we don't
            // duplicate the chrome we already have around it.
            const params = ['embed=1'];
            if (rhymeQuery) params.push('q=' + encodeURIComponent(rhymeQuery));
            const qs = '?' + params.join('&');
            rhymesPane.innerHTML = `<iframe class="lp-rhymes-frame" src="/rhymeforge/${qs}" title="RhymeForge"></iframe>`;
            iframe = rhymesPane.querySelector('.lp-rhymes-frame');
            // Belt-and-braces: also fire postMessage once the iframe loads.
            iframe.addEventListener('load', sendQuery);
        } else if (rhymeQuery) {
            // Iframe already exists — just push the new search via postMessage.
            sendQuery();
        }
        state.lyrics._pendingRhymeSearch = ''; // clear after use
        return;
    }

    // Lyrics tab
    let html = `<div class="lp-lyrics-content">`;
    html += `<div class="lp-view-toggle">
        <button class="lp-view-btn ${activeView === 'freewrite' ? 'active' : ''}" data-lp-view="freewrite">Free Write</button>
        <button class="lp-view-btn ${activeView === 'structured' ? 'active' : ''}" data-lp-view="structured">Structured / Chords</button>
    </div>`;

    if (activeView === 'freewrite') {
        html += `<div class="lp-freewrite">
            <div class="lp-section-btns">
                <span class="lp-section-btns-label">Insert section:</span>
                ${state.progressionLines.map((pl, i) => {
                    const name = pl.name || 'Line ' + (i + 1);
                    return `<button class="lp-insert-section-btn" data-section-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
                }).join('')}
                <button class="lp-insert-section-btn lp-import-rf-btn" id="lpImportRfBtn" title="Load a .rhymeforge.json file and append its text to your freewrite">Load RhymeForge file</button>
            </div>
            <textarea class="lp-freewrite-area" id="lpFreewriteArea" placeholder="Write your lyrics here then click a section button above to insert a marker...\n\nExample:\n[Verse]\nWalking down the street today\nFeeling all the words to say\n\n[Chorus]\nThis is where the song begins">${escapeHtml(lyr.freeText || '')}</textarea>
            <div class="lp-freewrite-hint">Click a section button to insert a <strong>[Section]</strong> marker at the cursor. Sections will auto-link to their matching progression line.</div>
            <button class="lp-parse-btn" id="lpParseBtn">Parse Sections →</button>

            ${(() => {
                // Collapsible How-It-Works. Persist the collapsed state in
                // localStorage so once the user dismisses it, it stays
                // dismissed across sessions. Default: open on first visit
                // (so the workflow is discoverable).
                const collapsed = localStorage.getItem('uz-lyrics-howto-collapsed') === '1';
                return `
            <div class="lp-howto ${collapsed ? 'collapsed' : ''}" id="lpHowto">
                <button class="lp-howto-toggle" data-action="toggleLyricsHowto" aria-expanded="${!collapsed}">
                    <span class="lp-howto-title">How it works</span>
                    <span class="lp-howto-chevron">${collapsed ? '▸' : '▾'}</span>
                </button>
                <div class="lp-howto-body">
                    <ol class="lp-howto-steps">
                        <li><strong>Name your progression lines first.</strong> In the main builder on the right, give each line a name like <em>Verse</em>, <em>Chorus</em>, <em>Bridge</em>. The buttons above this textarea pick up those names automatically.</li>
                        <li><strong>Click a section button</strong> above the textarea to drop a <code>[Section]</code> marker at the cursor — one per part of your song.</li>
                        <li><strong>Write your lyrics</strong> under each marker. Each block of text below a marker becomes that section's lyrics.</li>
                        <li><strong>Switch to Structured / Chords</strong> at the top to place chords above the words, line by line.</li>
                    </ol>
                    <div class="lp-howto-tip">Tip: double-click any word in the textarea to look it up in the Rhymes tab.</div>
                </div>
            </div>`;
            })()}
        </div>`;
    } else {
        // Structured view
        html += `<div class="lp-structured" id="lpStructured">`;
        // Re-check unlinked sections against current progression line names
        if (lyr.sections && lyr.sections.length > 0) {
            let anyLinked = false;
            lyr.sections.forEach(sec => {
                // Also check if previously linked line index is now out of range
                if (sec.lineIdx >= state.progressionLines.length) {
                    sec.lineIdx = -1;
                }
                if (sec.lineIdx < 0) {
                    const matchIdx = state.progressionLines.findIndex(pl => {
                        const lineName = (pl.name || ('Line ' + (state.progressionLines.indexOf(pl) + 1))).toLowerCase();
                        return lineName === sec.label.toLowerCase();
                    });
                    if (matchIdx >= 0) {
                        sec.lineIdx = matchIdx;
                        anyLinked = true;
                    }
                }
            });
            if (anyLinked) saveStateToLocalStorage();
        }

        if (!lyr.sections || lyr.sections.length === 0) {
            html += `<div class="lp-empty-msg">No sections yet.<br><strong>Switch to Free Write</strong> and use [Verse], [Chorus] markers,<br>then click <strong>Parse Sections</strong>.</div>`;
        } else {
            lyr.sections.forEach((sec, secIdx) => {
                const assignedLine = sec.lineIdx >= 0 && state.progressionLines[sec.lineIdx]
                    ? (state.progressionLines[sec.lineIdx].name || 'Line ' + (sec.lineIdx + 1))
                    : 'Unassigned';
                const chords = sec.lineIdx >= 0 && state.progressionLines[sec.lineIdx]
                    ? state.progressionLines[sec.lineIdx].chords.map(c => c.chord)
                    : [];

                const assignedLabel = sec.lineIdx >= 0 && state.progressionLines[sec.lineIdx]
                    ? (state.progressionLines[sec.lineIdx].name || 'Line ' + (sec.lineIdx + 1))
                    : null;
                html += `<div class="lp-section" data-sec="${secIdx}">
                    <div class="lp-section-header">
                        <span class="lp-section-label">${escapeHtml(sec.label)}</span>
                        ${assignedLabel ? `<span class="lp-section-linked">⟵ ${escapeHtml(assignedLabel)}</span>` : '<span class="lp-section-unlinked">Not linked</span>'}
                    </div>`;

                (sec.lines || []).forEach((lineText, lineIdx) => {
                    const words = lineText.split(/(\s+)/); // preserve spaces
                    const chordMapKey = secIdx + '-' + lineIdx;
                    const lineChords = (sec.chordMap && sec.chordMap[lineIdx]) || {};

                    // Build word-stacks: each token (word or whitespace) becomes
                    // a vertical column with the chord on top and the word
                    // below. Stacking guarantees the chord always sits directly
                    // above its word — earlier two-row layout drifted because
                    // chord cells (11px font, min-width:Nch) were systematically
                    // narrower than the words above them (13px font), so
                    // alignment accumulated error across the line.
                    let lineHtml = '';
                    let wordIdx = 0;

                    words.forEach((w, wi) => {
                        if (/^\s+$/.test(w)) {
                            // whitespace — same span on top and bottom so the gap
                            // matches the word's gap.
                            const sp = w.replace(/ /g, '&nbsp;');
                            lineHtml += `<span class="lp-word-stack lp-word-stack-space">`
                                + `<span class="lp-chord-marker" aria-hidden="true">&nbsp;</span>`
                                + `<span class="lp-word" style="cursor:default;white-space:pre">${sp}</span>`
                                + `</span>`;
                        } else {
                            const chordAbove = lineChords[wordIdx] || '';
                            lineHtml += `<span class="lp-word-stack">`
                                + `<span class="lp-chord-marker ${chordAbove ? 'has-chord' : ''}" `
                                +   `data-action="${chordAbove ? 'pickChord' : ''}" `
                                +   `data-sec="${secIdx}" data-line="${lineIdx}" data-word="${wordIdx}">`
                                +   `${chordAbove || '&nbsp;'}`
                                + `</span>`
                                + `<span class="lp-word ${chordAbove ? 'has-chord' : ''}" `
                                +   `data-action="pickChord" `
                                +   `data-sec="${secIdx}" data-line="${lineIdx}" data-word="${wordIdx}">`
                                +   `${escapeHtml(w)}`
                                + `</span>`
                                + `</span>`;
                            wordIdx++;
                        }
                    });

                    html += `<div class="lp-lyric-line">${lineHtml}</div>`;
                });

                html += `</div>`;
            });
        }
        html += `</div>`;
    }

    html += `</div>`;
    // Write into the lyrics pane (not body) so the persistent rhymes pane
    // (and its iframe) stays intact across tab switches.
    lyricsPane.innerHTML = html;
}

function showChordPicker(wordEl) {
    // Remove any existing picker
    closeChordPicker();

    const secIdx = parseInt(wordEl.dataset.sec);
    const lineIdx = parseInt(wordEl.dataset.line);
    const wordIdx = parseInt(wordEl.dataset.word);
    const sec = state.lyrics.sections[secIdx];
    if (!sec) return;

    // Get chords from the assigned progression line
    const chords = sec.lineIdx >= 0 && state.progressionLines[sec.lineIdx]
        ? state.progressionLines[sec.lineIdx].chords.map(c => c.chord)
        : [];

    if (chords.length === 0) {
        // No chords available
        return;
    }

    const currentChord = (sec.chordMap && sec.chordMap[lineIdx] && sec.chordMap[lineIdx][wordIdx]) || '';

    const picker = document.createElement('div');
    picker.className = 'lp-chord-picker';

    // Unique chords only
    const uniqueChords = [...new Set(chords)];
    uniqueChords.forEach(ch => {
        const opt = document.createElement('button');
        opt.className = 'lp-chord-option';
        opt.textContent = ch;
        if (ch === currentChord) opt.style.borderColor = '#d4a853';
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!sec.chordMap) sec.chordMap = {};
            if (!sec.chordMap[lineIdx]) sec.chordMap[lineIdx] = {};
            sec.chordMap[lineIdx][wordIdx] = ch;
            saveStateToLocalStorage();
            closeChordPicker();
            renderLyricsPanel();
        });
        picker.appendChild(opt);
    });

    // Remove chord option if one exists
    if (currentChord) {
        const removeOpt = document.createElement('button');
        removeOpt.className = 'lp-chord-option remove';
        removeOpt.textContent = '× Remove';
        removeOpt.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sec.chordMap && sec.chordMap[lineIdx]) {
                delete sec.chordMap[lineIdx][wordIdx];
            }
            saveStateToLocalStorage();
            closeChordPicker();
            renderLyricsPanel();
        });
        picker.appendChild(removeOpt);
    }

    // Position near the word
    const rect = wordEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.left = rect.left + 'px';
    picker.style.top = (rect.bottom + 4) + 'px';

    document.body.appendChild(picker);
    lpActiveChordPicker = picker;

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', closeChordPickerOnOutsideClick);
    }, 10);
}

function closeChordPicker() {
    if (lpActiveChordPicker) {
        lpActiveChordPicker.remove();
        lpActiveChordPicker = null;
    }
    document.removeEventListener('click', closeChordPickerOnOutsideClick);
}

function closeChordPickerOnOutsideClick(e) {
    if (lpActiveChordPicker && !lpActiveChordPicker.contains(e.target)) {
        closeChordPicker();
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Panel event listeners
document.getElementById('lyricsPanelTab').addEventListener('click', () => {
    const panel = document.getElementById('lyricsPanel');
    if (panel.classList.contains('open')) {
        closeLyricsPanel();
    } else {
        openLyricsPanel();
    }
});

document.getElementById('lyricsPanelClose').addEventListener('click', closeLyricsPanel);

document.addEventListener('click', e => {
    // Size buttons
    const sizeBtn = e.target.closest('.lp-size-btn');
    if (sizeBtn) {
        setLyricsPanelSize(sizeBtn.dataset.lpSize);
        return;
    }

    // Tab buttons
    const tabBtn = e.target.closest('.lp-tab');
    if (tabBtn) {
        state.lyrics.currentTab = tabBtn.dataset.lpTab;
        renderLyricsPanel();
        return;
    }

    // View toggle
    const viewBtn = e.target.closest('.lp-view-btn');
    if (viewBtn) {
        state.lyrics.currentView = viewBtn.dataset.lpView;
        renderLyricsPanel();
        return;
    }

    // Native "Load from RhymeForge…" button (re-uses the .lp-insert-section-btn
    // class for styling but has no section name — short-circuit before the
    // marker-insertion handler below).
    if (e.target.closest('#lpImportRfBtn')) {
        _uzOpenImportPicker();
        return;
    }

    // Insert section marker button
    const insertBtn = e.target.closest('.lp-insert-section-btn');
    if (insertBtn) {
        const name = insertBtn.dataset.sectionName;
        const area = document.getElementById('lpFreewriteArea');
        if (area && name) {
            const marker = `[${name}]`;
            const start = area.selectionStart;
            const end = area.selectionEnd;
            const text = area.value;
            // Insert on its own line: add newlines if needed
            let prefix = '';
            let suffix = '\n';
            if (start > 0 && text[start - 1] !== '\n') prefix = '\n';
            area.value = text.slice(0, start) + prefix + marker + suffix + text.slice(end);
            // Move cursor after the marker
            const newPos = start + prefix.length + marker.length + suffix.length;
            area.selectionStart = area.selectionEnd = newPos;
            area.focus();
            state.lyrics.freeText = area.value;
            saveStateToLocalStorage();
        }
        return;
    }

    // Parse button
    if (e.target.id === 'lpParseBtn') {
        // Save freetext first
        const area = document.getElementById('lpFreewriteArea');
        if (area) state.lyrics.freeText = area.value;

        // Parse into sections, preserving existing chordMaps where labels match
        const oldSections = state.lyrics.sections || [];
        const newSections = parseFreeTextSections(state.lyrics.freeText);

        // Carry over chordMap from old sections with matching labels
        newSections.forEach(ns => {
            const oldMatch = oldSections.find(os => os.label.toLowerCase() === ns.label.toLowerCase());
            if (oldMatch && oldMatch.chordMap) {
                ns.chordMap = oldMatch.chordMap;
                if (oldMatch.lineIdx >= 0) ns.lineIdx = oldMatch.lineIdx;
            }
        });

        state.lyrics.sections = newSections;
        state.lyrics.currentView = 'structured';
        saveStateToLocalStorage();
        renderLyricsPanel();
        return;
    }

    // Word click for chord picker
    const wordEl = e.target.closest('[data-action="pickChord"]');
    if (wordEl) {
        e.stopPropagation();
        showChordPicker(wordEl);
        return;
    }
});

// Double-click word in free write to search rhymes
document.addEventListener('dblclick', e => {
    if (!e.target.classList.contains('lp-freewrite-area')) return;
    const area = e.target;
    // Small delay to let the browser complete word selection
    setTimeout(() => {
        const selectedText = area.value.substring(area.selectionStart, area.selectionEnd).trim();
        if (!selectedText || selectedText.includes(' ') || selectedText.length < 2) return;
        // Clean the word: remove punctuation
        const word = selectedText.replace(/[^a-zA-Z'-]/g, '');
        if (!word || word.length < 2) return;

        // Store the word and switch to rhymes tab
        if (!state.lyrics) return;
        state.lyrics._pendingRhymeSearch = word;
        state.lyrics.currentTab = 'rhymes';
        renderLyricsPanel();
    }, 10);
});

// Section assign dropdown
document.addEventListener('change', e => {
    if (e.target.classList.contains('lp-section-assign')) {
        const secIdx = parseInt(e.target.dataset.sec);
        const lineIdx = parseInt(e.target.value);
        if (state.lyrics.sections[secIdx]) {
            state.lyrics.sections[secIdx].lineIdx = lineIdx;
            saveStateToLocalStorage();
            renderLyricsPanel();
        }
    }
});

// Freewrite auto-save on input
document.addEventListener('input', e => {
    if (e.target.id === 'lpFreewriteArea') {
        state.lyrics.freeText = e.target.value;
        saveStateToLocalStorage();
    }
});

// Load saved state on init
loadStateFromLocalStorage();

// Restore dark mode background if needed
if (state.selectedTab === 'dark') {
    document.body.classList.add('dark-mode');
}

// ========== MY SONGS (multi-song registry) ==========
// Registry of songs in localStorage. Each entry stores the same version-3
// object that File > Save writes, so export/import shares one format.
const SONGS_KEY = 'uzSongsRegistry';

function getSongsRegistry() {
    try {
        const reg = JSON.parse(localStorage.getItem(SONGS_KEY));
        if (reg && reg.songs) return reg;
    } catch (e) {}
    return null;
}

function saveSongsRegistry(reg) {
    try { localStorage.setItem(SONGS_KEY, JSON.stringify(reg)); } catch (e) {}
}

function persistCurrentSong() {
    let reg = getSongsRegistry();
    if (!reg) reg = { currentId: 's' + Date.now(), songs: {} };
    reg.songs[reg.currentId] = { data: buildSaveData(), updatedAt: Date.now() };
    saveSongsRegistry(reg);
}

function blankSongData() {
    return { version: 3, songName: '', key: state.selectedKey,
             mode: 'major', progressionKey: state.selectedKey,
             bpm: 100, style: 'pop', styleVariant: 1,
             drums: false, bass: true, keys: true,
             lines: [{ chords: [], repeats: 1, name: '', tab: [], tabArtic: [], showTab: false }],
             lyrics: null, melody: null };
}

function switchToSong(id) {
    const reg = getSongsRegistry();
    if (!reg || !reg.songs[id]) return;
    persistCurrentSong();
    reg.currentId = id;
    saveSongsRegistry(reg);
    loadProgressionData(reg.songs[id].data);
    saveStateToLocalStorage();
    renderMySongs();
}

function createNewSong() {
    persistCurrentSong();
    const reg = getSongsRegistry();
    const id = 's' + Date.now();
    reg.songs[id] = { data: blankSongData(), updatedAt: Date.now() };
    reg.currentId = id;
    saveSongsRegistry(reg);
    loadProgressionData(reg.songs[id].data);
    saveStateToLocalStorage();
    renderMySongs();
}

function deleteSongById(id) {
    const reg = getSongsRegistry();
    if (!reg || !reg.songs[id]) return;
    const name = (reg.songs[id].data.songName || 'Untitled song');
    if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
    delete reg.songs[id];
    if (reg.currentId === id) {
        const rest = Object.keys(reg.songs).sort((a, b) => reg.songs[b].updatedAt - reg.songs[a].updatedAt);
        if (rest.length === 0) {
            const nid = 's' + Date.now();
            reg.songs[nid] = { data: blankSongData(), updatedAt: Date.now() };
            reg.currentId = nid;
        } else {
            reg.currentId = rest[0];
        }
        saveSongsRegistry(reg);
        loadProgressionData(reg.songs[reg.currentId].data);
        saveStateToLocalStorage();
    } else {
        saveSongsRegistry(reg);
    }
    renderMySongs();
}

function exportSongById(id) {
    const reg = getSongsRegistry();
    if (!reg || !reg.songs[id]) return;
    const data = reg.songs[id].data;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement('a');
    aEl.href = url; aEl.download = songFileName(data, new Set());
    document.body.appendChild(aEl); aEl.click(); aEl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

let _jszipPromise = null;
function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (_jszipPromise) return _jszipPromise;
    _jszipPromise = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        sc.onload = () => resolve(window.JSZip);
        sc.onerror = () => { _jszipPromise = null; reject(new Error('JSZip failed to load')); };
        document.head.appendChild(sc);
    });
    return _jszipPromise;
}

function songFileName(data, taken) {
    let base = (data.songName || 'untitled-song').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled-song';
    let name = base, k = 2;
    while (taken.has(name)) { name = base + '-' + k; k++; }
    taken.add(name);
    return name + '.json';
}

async function exportAllSongs() {
    persistCurrentSong();
    const reg = getSongsRegistry();
    if (!reg) return;
    try {
        const JSZip = await loadJSZip();
        const zip = new JSZip();
        const taken = new Set();
        Object.values(reg.songs)
            .sort((x, y) => y.updatedAt - x.updatedAt)
            .forEach(entry => zip.file(songFileName(entry.data, taken), JSON.stringify(entry.data, null, 2)));
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const aEl = document.createElement('a');
        const d = new Date();
        aEl.href = url;
        aEl.download = 'undercover-zest-songs-' + d.toISOString().slice(0, 10) + '.zip';
        document.body.appendChild(aEl); aEl.click(); aEl.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
        alert('Could not build the zip — check your connection and try again.');
        console.warn('exportAllSongs:', err);
    }
}

function importSongsFromList(datas) {
    // import many parsed song objects; open the first
    const valid = datas.filter(d => d && d.lines);
    if (!valid.length) { alert('No valid song files found.'); return; }
    persistCurrentSong();
    const reg = getSongsRegistry();
    let firstId = null;
    valid.forEach((data, i) => {
        const id = 's' + Date.now() + '-' + i;
        reg.songs[id] = { data, updatedAt: Date.now() };
        if (!firstId) firstId = id;
    });
    reg.currentId = firstId;
    saveSongsRegistry(reg);
    loadProgressionData(reg.songs[firstId].data);
    saveStateToLocalStorage();
    renderMySongs();
}

// Per-song ⬆ — replace this song in place with a local .json (keeps the
// same registry id, so it's an update rather than a duplicate).
function replaceSongById(id) {
    const reg = getSongsRegistry();
    if (!reg || !reg.songs[id]) return;
    const input = document.getElementById('fileInput');
    input.setAttribute('accept', '.json,.txt');
    input.onchange = async (e) => {
        const file = e.target.files[0];
        input.value = '';
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            if (!data || !data.lines) throw new Error('not a song file');
            const curName = reg.songs[id].data.songName || 'Untitled song';
            const newName = data.songName || 'Untitled song';
            const label = curName === newName ? `"${curName}"` : `"${curName}" with "${newName}"`;
            if (!confirm(`Replace ${label} using ${file.name}? The version in this browser will be overwritten.`)) return;
            reg.songs[id] = { data, updatedAt: Date.now() };
            saveSongsRegistry(reg);
            if (reg.currentId === id) {
                loadProgressionData(data);
                saveStateToLocalStorage();
            }
            renderMySongs();
        } catch (err) {
            alert('Could not read that file — expected a song .json.');
            console.warn('replaceSongById:', err);
        }
    };
    input.click();
}

function importSongFile() {
    const input = document.getElementById('fileInput');
    input.setAttribute('accept', '.json,.zip,.txt');
    input.onchange = async (e) => {
        const file = e.target.files[0];
        input.value = '';
        if (!file) return;
        try {
            if (/\.zip$/i.test(file.name)) {
                const JSZip = await loadJSZip();
                const zip = await JSZip.loadAsync(file);
                const texts = await Promise.all(
                    Object.values(zip.files)
                        .filter(f => !f.dir && /\.json$/i.test(f.name) && !/__MACOSX/.test(f.name))
                        .map(f => f.async('string'))
                );
                const datas = texts.map(t => { try { return JSON.parse(t); } catch (e2) { return null; } });
                importSongsFromList(datas);
            } else {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!data || !data.lines) throw new Error('not a song file');
                importSongsFromList([data]);
            }
        } catch (err) {
            alert('Could not import — expected a song .json or a .zip of song .json files.');
            console.warn('importSongFile:', err);
        }
    };
    input.click();
}

function renderMySongs() {
    const popup = document.getElementById('mySongsPopup');
    if (!popup || popup.classList.contains('hidden')) return;
    const reg = getSongsRegistry();
    const body = document.getElementById('mySongsBody');
    if (!reg || !body) return;
    const ids = Object.keys(reg.songs).sort((a, b) => reg.songs[b].updatedAt - reg.songs[a].updatedAt);
    body.innerHTML = ids.map(id => {
        const entry = reg.songs[id];
        const d = entry.data;
        const isCurrent = id === reg.currentId;
        const chords = (d.lines && d.lines[0] && d.lines[0].chords || []).map(c => c.chord).slice(0, 6).join(' – ') || 'No chords yet';
        const nLines = (d.lines || []).filter(l => l.chords && l.chords.length).length;
        const hasLyrics = !!(d.lyrics && ((d.lyrics.freeText || '').trim() || (d.lyrics.structured || '').trim()));
        const when = new Date(entry.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        const safeName = (d.songName || 'Untitled song').replace(/[<>&"]/g, '');
        return `
        <div class="song-card ${isCurrent ? 'current' : ''}">
            <div class="song-card-main" ${isCurrent ? '' : `data-action="switchSong" data-song="${id}"`}>
                <span class="song-card-name">${safeName}${isCurrent ? ' <span class="song-card-badge">open</span>' : ''}</span>
                <span class="song-card-meta">Key of ${d.key || '?'} · ${nLines} line${nLines === 1 ? '' : 's'}${hasLyrics ? ' · lyrics' : ''} · ${when}</span>
                <span class="song-card-chords">${chords}</span>
            </div>
            <div class="song-card-actions">
                ${isCurrent ? '' : `<button class="file-btn" data-action="switchSong" data-song="${id}">Open</button>`}
                <button class="file-btn" data-action="replaceSong" data-song="${id}" title="Replace this song with a local .json (e.g. a newer copy)">⬆</button>
                <button class="file-btn" data-action="exportSong" data-song="${id}" title="Download .json">⬇</button>
                <button class="file-btn" data-action="deleteSong" data-song="${id}" title="Delete">×</button>
            </div>
        </div>`;
    }).join('');
}

(function migrateSongsRegistry() {
    if (getSongsRegistry()) return;
    // First run on this browser: wrap whatever the legacy single-song
    // localStorage held (already loaded into state by now) as song #1.
    const reg = { currentId: 's' + Date.now(), songs: {} };
    reg.songs[reg.currentId] = { data: buildSaveData(), updatedAt: Date.now() };
    saveSongsRegistry(reg);
})();

// ========== SHAREABLE PROGRESSION URLS ==========
// ?key=C&p=C-G-Am-F|F-G-C  (lines split by |, chords by -; URL-encoded)
const SHARE_CHORD_RE = /^[A-G][#b]?[A-Za-z0-9#°+()/-]{0,12}$/;

function buildShareUrl() {
    // Token grammar (backward-compatible): chord[.beats][@start][!|>], chords joined by '-', lines by '|'.
    // A line may be prefixed with 'bpb:' for non-4/4 meter. Old links (no @start, beats only 2/8, no
    // meter prefix) still parse. @start is emitted only when a chord isn't at its sequential position
    // (i.e. a free position or gap), so simple progressions stay compact and look like the old links.
    const lines = state.progressionLines
        .map(l => {
            let seqAcc = 0;
            const toks = (l.chords || []).filter(c => c.chord && c.chord !== '?').map(c => {
                let t = c.chord;
                const b = chordBeats(c);
                if (b !== 4) t += '.' + b;
                const st = (typeof c.start === 'number') ? c.start : seqAcc;
                if (st !== seqAcc) t += '@' + st;
                seqAcc = st + b;
                const acc = chordAccent(c);
                if (acc === 'stop') t += '!';
                if (acc === 'push') t += '>';
                return t;
            });
            if (!toks.length) return '';
            const meter = (l.bpb && l.bpb !== 4) ? (l.bpb + ':') : '';
            return meter + toks.join('-');
        })
        .filter(Boolean);
    if (!lines.length) return null;
    const params = new URLSearchParams();
    params.set('key', state.selectedKey);
    params.set('p', lines.join('|'));
    if (state.songName) params.set('n', state.songName.slice(0, 60));
    const mel = Melody.serialize();
    if (mel) params.set('m', mel);
    return location.origin + location.pathname + '?' + params.toString();
}

(function importSharedProgression() {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('p');
    if (!p) return;
    // chord[.beats][@start][!|>] — beats/start are any number (½-beat grid); old tokens (no @, beats
    // only 2/8) still match. An optional 'N:' line prefix carries the meter (bpb).
    const TOKEN_RE = /^([A-G][#b]?[A-Za-z0-9#°+()\/-]{0,12})(?:\.(\d+(?:\.\d+)?))?(?:@(\d+(?:\.\d+)?))?(!|>)?$/;
    const lines = p.split('|').map(seg => {
        seg = seg.trim();
        let bpb = 4;
        const mm = seg.match(/^(\d+):(.*)$/);
        if (mm) { bpb = parseInt(mm[1], 10) || 4; seg = mm[2]; }
        let acc = 0; // sequential fallback for chords without an explicit @start
        const chords = seg.split('-').map(t => t.trim()).map(t => {
            const m = t.match(TOKEN_RE);
            if (!m) return null;
            const beats = m[2] ? parseFloat(m[2]) : 4;
            const start = (m[3] != null) ? parseFloat(m[3]) : acc;
            acc = start + beats;
            return { chord: m[1], beats, start, accent: m[4] === '!' ? 'stop' : m[4] === '>' ? 'push' : 'norm' };
        }).filter(Boolean);
        return chords.length ? { chords, bpb } : null;
    }).filter(Boolean);
    if (!lines.length) return;
    const key = params.get('key');
    if (key && /^[A-G][#b]?m?$/.test(key)) {
        state.selectedKey = key;
        state.progressionKey = key;
    }
    state.progressionLines = lines.map((l, li) => ({
        chords: l.chords.map((c, i) => ({ chord: c.chord, beats: c.beats, accent: c.accent, start: c.start, id: 'shared-' + li + '-' + i, active: false })),
        bpb: l.bpb, repeats: 1, tab: [], showTab: false, viewMode: 'stacked'
    }));
    state.currentLineIndex = 0;
    const name = params.get('n');
    if (name) state.songName = name.slice(0, 60);
    const melParam = params.get('m');
    if (melParam) {
        state.melody = null; // fresh container; deserialize fills it after init
        state.__pendingMelodyParam = melParam;
    }
    saveStateToLocalStorage();
    // Strip the params so a reload doesn't clobber later edits.
    history.replaceState(null, '', location.pathname);
})();

// Pop-out mode: ?popout=<panelId> in the URL means this window is a popped-out
// tool view. Add body classes so CSS can hide the surrounding chrome and open
// the requested panel. This window is a fully-interactive instance of the app
// — it just visually presents one tool. State is shared with the parent via
// localStorage so the popped-out tool sees the user's current key/chords.
(function() {
    const params = new URLSearchParams(window.location.search);
    const popoutPanel = params.get('popout');
    if (!popoutPanel) return;
    document.body.classList.add('popout-mode', 'popout-mode-' + popoutPanel);
    if (popoutPanel === 'arpeggiator') state.showArpeggiator = true;
    else if (popoutPanel === 'scaleVisualizer') state.showFretboard = true;
    else if (popoutPanel === 'tuner') state.showTuner = true;
    else if (popoutPanel === 'chordPicker') state.showChordPicker = true;
    else if (popoutPanel === 'keyFinder') state.showKeyFinder = true;
    document.title = popoutPanel.charAt(0).toUpperCase() + popoutPanel.slice(1) + ' — Undercover Zest';
})();

// ── Mobile (breakpoint-mounted alternate view) ────────────────────────────────
// The mobile UI is the SAME site at phone width, not a separate app. The desktop module
// exposes its data layer on window.UZ; the mobile shell (mobile/mobile.js, dynamically
// imported only on mobile) drives the SAME `state` object + the same localStorage keys, so
// save/share/round-trip with the desktop v2 builder is structural, not re-implemented.
// Read the flag the head-shim set at parse time (BEFORE the share-import IIFE runs history.replaceState,
// which strips the query — incl. ?mobile=1). matchMedia is a fallback if the shim errored.
const IS_MOBILE = document.documentElement.classList.contains('uz-mobile')
  || (function () { try { return window.matchMedia('(max-width: 480px) and (pointer: coarse)').matches; } catch (e) { return false; } })();
window.UZ = {
    get state() { return state; },
    save: saveStateToLocalStorage,
    load: loadStateFromLocalStorage,
    normalize: normalizeProgressionState,
    buildSaveData: buildSaveData,
    buildShareUrl: buildShareUrl,
    buildFlat: buildFlatProgression,   // flat {chord,lineIdx,chordIdx,id,beats,accent,start}+songBeats for Audio.startBackingLoop
    songsRegistry: { get: getSongsRegistry, save: saveSongsRegistry, persistCurrent: persistCurrentSong },
    Audio: Audio,
    Melody: Melody,
    Model: (typeof window !== 'undefined' ? window.MODEL : null),
    bridge: (typeof window !== 'undefined' ? window.UZ_BUILDER_BRIDGE : null),
    isMobile: IS_MOBILE,
    // Stage 8 (mobile Tools): expose the desktop theory engines + data tables so the mobile
    // view reuses them instead of re-porting ~600 lines of tuned logic.
    Data: Data,                            // CHORD_DATA, NOTE_COLORS, SCALE_DATA, CADENCE_PATTERNS, …
    findPossibleKeys: findPossibleKeys,    // (chordNames[]) → ranked [{key,type,score,fitCount,diatonic[],romans[]}]
    analyzeProgression: analyzeProgression,// (line.chords[], isMinor) → {cadences,transitions,substitutions,moodArc,…}
    getScaleNotes: getScaleNotes,          // (keyName, scaleType, addBlues) → [{note,degree,isBlue}]
    scaleDescriptions: SCALE_DESCRIPTIONS,  // per-scale {name,subtitle,when,avoid,feel,supportsBlues}
};

// melody module is wired in both views; on mobile its renderProgression callback is a no-op
// (the desktop DOM is hidden) — mobile owns its own melody rendering from a later stage.
Melody.init({
    state,
    getScaleNotes,
    transposeChord,
    displayChordForKey,
    saveState: saveStateToLocalStorage,
    renderProgression: IS_MOBILE ? function () {} : renderProgression,
});
if (state.__pendingMelodyParam) {
    Melody.deserialize(state.__pendingMelodyParam);
    delete state.__pendingMelodyParam;
    saveStateToLocalStorage();
}

if (IS_MOBILE) {
    document.documentElement.classList.add('uz-mobile');
    // Data layer already initialised (loadStateFromLocalStorage + the share-import IIFE ran at module
    // eval). Mount the mobile view instead of the desktop UI; never call the desktop render().
    import('./mobile/mobile.js?v=12')
        .then(function (m) { m.initMobile(window.UZ, document.getElementById('app-mobile')); })
        .catch(function (e) { console.error('[uz-mobile] failed to mount mobile shell', e); });
} else {
    setupEventListeners();
    setupChordLaneDrag();
    render();
}
// Strategy A: the standalone melody sketcher UI is replaced by the v2 melody lane — skip its render.
// (Melody.init/deserialize above stay: they keep state.melody populated for share/MIDI compatibility.)
// Melody.render();

// In pop-out mode, the main render() doesn't call the panel-specific render
// functions (renderArpeggiator etc — those only fire on user toggle). Call
// the right one explicitly so the popped-out tool actually shows up.
function renderActivePopoutPanel() {
    if (!document.body.classList.contains('popout-mode')) return;
    if (document.body.classList.contains('popout-mode-arpeggiator')) renderArpeggiator();
    else if (document.body.classList.contains('popout-mode-scaleVisualizer')) renderScaleBoards();
    else if (document.body.classList.contains('popout-mode-tuner')) renderTuner();
    else if (document.body.classList.contains('popout-mode-chordPicker')) renderChordPicker();
    else if (document.body.classList.contains('popout-mode-keyFinder')) renderKeyFinder();
}
renderActivePopoutPanel();

// In pop-out mode, also refresh when the parent updates state in localStorage
// so the popped-out tool stays in sync with the user's main session.
window.addEventListener('storage', (e) => {
    if (!document.body.classList.contains('popout-mode')) return;
    if (e.key !== 'uz-progression-state') return;
    loadStateFromLocalStorage();
    render();
    renderActivePopoutPanel();
});


// show-notes label toggle (scale degrees <-> note names) for chord diagrams
document.addEventListener('click', function(e){
  var b = e.target.closest && e.target.closest('[data-lbl]');
  if(!b) return;
  document.body.classList.toggle('show-notes', b.dataset.lbl === 'note');
  document.querySelectorAll('[data-lbl]').forEach(function(x){ x.classList.toggle('on', x.dataset.lbl === b.dataset.lbl); });
});
