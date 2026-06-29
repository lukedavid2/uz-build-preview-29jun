// audio.js - Enhanced Audio Engine with Reverb, Better Instruments & Backing Tracks
import { NOTE_NAMES_SHARP, CHORD_FORMULAS } from './data.js?v=99';

let audioCtx = null;
let masterGain = null;
let compressor = null;
let reverbGain = null;
let convolver = null;
let isAudioReady = false;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  // Always try to resume if suspended (Safari/autoplay policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Ensure audio is ready before playing
async function ensureAudioReady() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (e) {
      console.warn('Could not resume audio context:', e);
    }
  }
  setupAudioChain();
  return ctx;
}

// Create impulse response for reverb
function createReverbImpulse(ctx, duration = 1.5, decay = 2) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const channelData = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function setupAudioChain() {
  const ctx = getAudioContext();

  if (!compressor) {
    // Compressor for consistent levels
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 25;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;

    // Master gain
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.6;

    // Reverb
    convolver = ctx.createConvolver();
    convolver.buffer = createReverbImpulse(ctx, 1.2, 2.5);

    reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.15;

    // Routing
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    compressor.connect(convolver);
    convolver.connect(reverbGain);
    reverbGain.connect(ctx.destination);
  }

  return compressor;
}

// ========== SAFE NODE HANDLING ==========

/**
 * Safely disconnect an audio node and catch any errors silently
 */
function safeDisconnect(node) {
  if (!node) return;
  try {
    node.disconnect();
  } catch (e) {
    // Silently catch errors - node may already be disconnected
  }
}

const FLAT_TO_SHARP = { 'Db':'C#', 'Eb':'D#', 'Gb':'F#', 'Ab':'G#', 'Bb':'A#' };

function normalizeNoteName(note) {
  return FLAT_TO_SHARP[note] || note;
}

function noteToIndex(note) {
  return NOTE_NAMES_SHARP.indexOf(normalizeNoteName(note));
}

function getNoteFrequency(note, octave) {
  const semitonesFromA4 = noteToIndex(note) - noteToIndex('A') + (octave - 4) * 12;
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

export function getChordTones(rootNote, quality) {
  const rootIndex = noteToIndex(rootNote);
  const raw = quality || '';
  let intervals = CHORD_FORMULAS[raw] ? CHORD_FORMULAS[raw].slice() : null;
  if (!intervals) {
    // Fallback heuristic for slash/compound/unknown suffixes.
    const q = raw.toLowerCase();
    if (q.includes('dim7')) intervals = [0, 3, 6, 9];
    else if (q.includes('m7b5')) intervals = [0, 3, 6, 10];
    else if (q.includes('dim')) intervals = [0, 3, 6];
    else if (q.includes('aug') || q === '+') intervals = [0, 4, 8];
    else if (q.includes('sus2')) intervals = [0, 2, 7];
    else if (q.includes('sus4')) intervals = [0, 5, 7];
    else if (q.startsWith('m') && !q.startsWith('maj')) intervals = [0, 3, 7];
    else intervals = [0, 4, 7];
    if (q.includes('maj7')) intervals.push(11);
    else if (q.includes('7')) intervals.push(10);
    if (q.includes('6') && !q.includes('6/')) intervals.push(9);
    if (q.includes('add9') || q.includes('9')) intervals.push(14);
  }

  return intervals.map(interval => {
    const index = (rootIndex + interval) % 12;
    const octaveOffset = Math.floor((rootIndex + interval) / 12);
    return { note: NOTE_NAMES_SHARP[index], offset: octaveOffset, interval };
  });
}

// ========== CHORD DETECTION FROM NOTES ==========

/**
 * Extract pitch classes from a chord shape editor fret array.
 * Shape editor uses [lowE, A, D, G, B, highE] (index 0 = low E string).
 * Returns a Set of pitch class indices (0-11) and an array of {string, fret, noteIdx, noteName}.
 */
export function extractNotesFromShape(frets) {
  // Open string pitch classes: low E=4, A=9, D=2, G=7, B=11, high E=4
  const OPEN = [4, 9, 2, 7, 11, 4];
  const notes = [];
  const pitchClasses = new Set();

  for (let s = 0; s < 6; s++) {
    if (frets[s] === null || frets[s] === undefined) continue;
    const noteIdx = (OPEN[s] + frets[s]) % 12;
    pitchClasses.add(noteIdx);
    notes.push({ string: s, fret: frets[s], noteIdx, noteName: NOTE_NAMES_SHARP[noteIdx] });
  }

  return { pitchClasses, notes };
}

/**
 * Detect the most likely chord name from a set of played pitch classes.
 * Uses interval-based matching against all chord qualities for each possible root.
 * Returns { chord, root, quality, confidence, bassNote, isSlash, alternatives[] }
 */
export function detectChordFromNotes(pitchClassSet, noteDetails) {
  if (!pitchClassSet || pitchClassSet.size === 0) return null;

  const played = [...pitchClassSet];
  if (played.length < 2) return null; // Need at least 2 distinct notes

  // All chord types to try, ordered by priority (simpler = higher priority for ties)
  const CHORD_TYPES = [
    { quality: '',      label: '',      intervals: [0, 4, 7] },
    { quality: 'm',     label: 'm',     intervals: [0, 3, 7] },
    { quality: '7',     label: '7',     intervals: [0, 4, 7, 10] },
    { quality: 'm7',    label: 'm7',    intervals: [0, 3, 7, 10] },
    { quality: 'maj7',  label: 'maj7',  intervals: [0, 4, 7, 11] },
    { quality: 'sus4',  label: 'sus4',  intervals: [0, 5, 7] },
    { quality: 'sus2',  label: 'sus2',  intervals: [0, 2, 7] },
    { quality: 'dim',   label: 'dim',   intervals: [0, 3, 6] },
    { quality: 'aug',   label: 'aug',   intervals: [0, 4, 8] },
    { quality: '6',     label: '6',     intervals: [0, 4, 7, 9] },
    { quality: 'm6',    label: 'm6',    intervals: [0, 3, 7, 9] },
    { quality: 'dim7',  label: 'dim7',  intervals: [0, 3, 6, 9] },
    { quality: 'm7b5',  label: 'm7b5',  intervals: [0, 3, 6, 10] },
    { quality: 'add9',  label: 'add9',  intervals: [0, 4, 7, 14] },
    { quality: '9',     label: '9',     intervals: [0, 4, 7, 10, 14] },
  ];

  const results = [];

  // Try every root note (0-11)
  for (let root = 0; root < 12; root++) {
    for (const ct of CHORD_TYPES) {
      // Build expected pitch classes for this chord
      const expected = new Set(ct.intervals.map(i => (root + i) % 12));

      // Count how many played notes are in expected, and vice versa
      let matchedPlayed = 0; // played notes that are in the chord
      let extraPlayed = 0;   // played notes NOT in the chord
      played.forEach(n => {
        if (expected.has(n)) matchedPlayed++;
        else extraPlayed++;
      });

      let missingExpected = 0; // chord tones not played
      expected.forEach(n => {
        if (!pitchClassSet.has(n)) missingExpected++;
      });

      // Skip if root note isn't played at all
      if (!pitchClassSet.has(root)) continue;

      // Skip if fewer than half of chord tones are present
      if (matchedPlayed < Math.ceil(expected.size * 0.5)) continue;

      // Score calculation:
      // - Reward matching played notes
      // - Penalize extra notes and missing tones
      // - Prefer simpler chords (fewer intervals) when scores tie
      const totalNotes = played.length;
      const matchRatio = matchedPlayed / totalNotes;
      const coverageRatio = matchedPlayed / expected.size;
      let score = (matchRatio * 0.4) + (coverageRatio * 0.5) - (extraPlayed * 0.08) - (missingExpected * 0.05);

      // Bonus for perfect match (all played notes in chord, all chord tones played)
      if (extraPlayed === 0 && missingExpected === 0) score += 0.3;
      // Bonus for all chord tones present even with extras
      else if (missingExpected === 0) score += 0.15;

      // Simpler chord bonus (triads preferred over 7ths when tied)
      score += (1 - ct.intervals.length / 10) * 0.05;

      const rootName = NOTE_NAMES_SHARP[root];
      results.push({
        chord: rootName + ct.label,
        root: rootName,
        quality: ct.quality,
        score,
        matchedPlayed,
        extraPlayed,
        missingExpected,
        expectedSize: expected.size
      });
    }
  }

  if (results.length === 0) return null;

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  const best = results[0];

  // Determine if it's a slash chord (bass note different from root)
  let bassNote = null;
  let isSlash = false;
  if (noteDetails && noteDetails.length > 0) {
    // Find lowest string that's played (highest string index in shape = lowest pitch)
    // Shape: 0=lowE, so index 0 is lowest
    const lowestPlayed = noteDetails.reduce((lowest, n) => {
      if (!lowest || n.string < lowest.string) return n;
      if (n.string === lowest.string && n.fret < lowest.fret) return n;
      return lowest;
    }, null);

    if (lowestPlayed) {
      const bassNoteIdx = lowestPlayed.noteIdx;
      const rootIdx = NOTE_NAMES_SHARP.indexOf(best.root);
      if (bassNoteIdx !== rootIdx) {
        bassNote = NOTE_NAMES_SHARP[bassNoteIdx];
        isSlash = true;
      }
    }
  }

  // Confidence: map score to 0-1 range
  const confidence = Math.max(0, Math.min(1, best.score));

  // Get alternatives (top 5 different chord names, with match details)
  const seen = new Set([best.chord]);
  const alternatives = [];
  for (const r of results) {
    if (!seen.has(r.chord) && alternatives.length < 5) {
      seen.add(r.chord);
      alternatives.push({
        chord: r.chord, root: r.root, quality: r.quality,
        confidence: Math.max(0, Math.min(1, r.score)),
        matchedPlayed: r.matchedPlayed, extraPlayed: r.extraPlayed,
        missingExpected: r.missingExpected, expectedSize: r.expectedSize
      });
    }
  }

  // Use flat names for flat-key-friendly chords
  const SHARP_TO_FLAT = { 'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb' };
  const flatify = (chordStr) => {
    const r = chordStr.match(/^([A-G][#]?)(.*)/);
    if (r && SHARP_TO_FLAT[r[1]]) return SHARP_TO_FLAT[r[1]] + r[2];
    return chordStr;
  };
  let displayChord = flatify(best.chord);
  let displayBass = bassNote;
  if (bassNote && SHARP_TO_FLAT[bassNote]) {
    displayBass = SHARP_TO_FLAT[bassNote];
  }

  // Classify match quality
  const isFullMatch = best.missingExpected === 0 && best.extraPlayed === 0;
  const isFullWithExtras = best.missingExpected === 0 && best.extraPlayed > 0;

  return {
    chord: displayChord,
    root: best.root,
    quality: best.quality,
    confidence,
    matchedPlayed: best.matchedPlayed,
    extraPlayed: best.extraPlayed,
    missingExpected: best.missingExpected,
    expectedSize: best.expectedSize,
    isFullMatch,
    isFullWithExtras,
    bassNote: displayBass,
    isSlash,
    slashChord: isSlash ? displayChord + '/' + displayBass : null,
    alternatives: alternatives.map(a => ({
      ...a,
      chord: flatify(a.chord),
      isFullMatch: a.missingExpected === 0 && a.extraPlayed === 0,
      isFullWithExtras: a.missingExpected === 0 && a.extraPlayed > 0
    }))
  };
}

// ========== INSTRUMENT SYNTHESIS ==========

// Rich piano tone with multiple oscillators and harmonics
function createPianoTone(ctx, freq, startTime, duration, velocity = 0.5) {
  const output = ctx.createGain();

  // Ensure startTime is never less than currentTime (Safari fix)
  const safeStart = Math.max(startTime, ctx.currentTime);

  // Main tone (triangle for warmth)
  const osc1 = ctx.createOscillator();
  osc1.type = 'triangle';
  osc1.frequency.value = freq;

  // Slight detune for richness
  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = freq * 1.003;

  // Octave harmonic
  const osc3 = ctx.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.value = freq * 2;

  // Fifth harmonic
  const osc4 = ctx.createOscillator();
  osc4.type = 'sine';
  osc4.frequency.value = freq * 3;

  const gains = [0.4, 0.3, 0.15, 0.05];
  const oscs = [osc1, osc2, osc3, osc4];

  oscs.forEach((osc, i) => {
    const g = ctx.createGain();
    g.gain.value = gains[i] * velocity;
    osc.connect(g);
    g.connect(output);

    // Clean up oscillator after stop
    osc.onended = () => {
      safeDisconnect(osc);
      safeDisconnect(g);
    };
  });

  // Envelope with Safari-safe scheduling
  const attack = 0.01;
  const sustainLevel = velocity * 0.4;
  const totalDur = duration + 0.5; // Extra time to cover release tail

  output.gain.cancelScheduledValues(safeStart);
  output.gain.setValueAtTime(0, safeStart); // Start at absolute 0
  output.gain.linearRampToValueAtTime(0.001, safeStart + 0.001); // Tiny ramp to avoid pop
  output.gain.linearRampToValueAtTime(velocity, safeStart + attack);
  output.gain.linearRampToValueAtTime(sustainLevel, safeStart + attack + 0.2);
  output.gain.linearRampToValueAtTime(0.001, safeStart + duration);

  oscs.forEach(osc => {
    osc.start(safeStart);
    osc.stop(safeStart + totalDur);
  });

  return output;
}

// Electric piano / Rhodes-style with FM synthesis
function createEPianoTone(ctx, freq, startTime, duration, velocity = 0.5) {
  const output = ctx.createGain();

  // Ensure startTime is never less than currentTime (Safari fix)
  const safeStart = Math.max(startTime, ctx.currentTime);

  // Carrier
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = freq;

  // Modulator (FM)
  const modulator = ctx.createOscillator();
  modulator.type = 'sine';
  modulator.frequency.value = freq * 2;

  const modGain = ctx.createGain();
  modGain.gain.value = freq * 0.3;

  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(output);

  // Bell harmonic
  const bell = ctx.createOscillator();
  bell.type = 'sine';
  bell.frequency.value = freq * 4;
  const bellGain = ctx.createGain();
  bellGain.gain.setValueAtTime(0, safeStart);
  bellGain.gain.linearRampToValueAtTime(velocity * 0.1, safeStart + 0.001);
  bellGain.gain.linearRampToValueAtTime(0.001, safeStart + 0.3);
  bell.connect(bellGain);
  bellGain.connect(output);

  // Clean up oscillators after stop
  carrier.onended = () => {
    safeDisconnect(carrier);
    safeDisconnect(modGain);
  };
  modulator.onended = () => {
    safeDisconnect(modulator);
  };
  bell.onended = () => {
    safeDisconnect(bell);
    safeDisconnect(bellGain);
  };

  // Envelope with Safari-safe scheduling
  output.gain.cancelScheduledValues(safeStart);
  output.gain.setValueAtTime(0, safeStart);
  output.gain.linearRampToValueAtTime(0.001, safeStart + 0.001);
  output.gain.linearRampToValueAtTime(velocity * 0.6, safeStart + 0.01);
  output.gain.linearRampToValueAtTime(velocity * 0.3, safeStart + 0.15);
  output.gain.linearRampToValueAtTime(0.001, safeStart + duration);

  const totalDur = duration + 0.5; // Extra time to cover release tail
  carrier.start(safeStart);
  carrier.stop(safeStart + totalDur);
  modulator.start(safeStart);
  modulator.stop(safeStart + totalDur);
  bell.start(safeStart);
  bell.stop(safeStart + totalDur);

  return output;
}

// Bass tone with sub and punch
function createBassTone(ctx, freq, startTime, duration, velocity = 0.6) {
  const output = ctx.createGain();

  // Ensure startTime is never less than currentTime (Safari fix)
  const safeStart = Math.max(startTime, ctx.currentTime);

  // Sub bass
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = freq;

  // Mid punch
  const mid = ctx.createOscillator();
  mid.type = 'triangle';
  mid.frequency.value = freq;

  // Filter for warmth
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  filter.Q.value = 1;

  const subGain = ctx.createGain();
  subGain.gain.value = velocity * 0.5;
  const midGain = ctx.createGain();
  midGain.gain.value = velocity * 0.4;

  sub.connect(subGain);
  mid.connect(midGain);
  subGain.connect(filter);
  midGain.connect(filter);
  filter.connect(output);

  // Clean up oscillators after stop
  sub.onended = () => {
    safeDisconnect(sub);
    safeDisconnect(subGain);
  };
  mid.onended = () => {
    safeDisconnect(mid);
    safeDisconnect(midGain);
  };

  // Envelope with Safari-safe scheduling
  const totalDur = duration + 0.5; // Extra time to cover release tail
  output.gain.cancelScheduledValues(safeStart);
  output.gain.setValueAtTime(0, safeStart);
  output.gain.linearRampToValueAtTime(0.001, safeStart + 0.001);
  output.gain.linearRampToValueAtTime(velocity, safeStart + 0.02);
  output.gain.linearRampToValueAtTime(velocity * 0.7, safeStart + 0.1);
  output.gain.linearRampToValueAtTime(0.001, safeStart + duration);

  sub.start(safeStart);
  sub.stop(safeStart + totalDur);
  mid.start(safeStart);
  mid.stop(safeStart + totalDur);

  return output;
}

// ========== KARPLUS-STRONG STRING SYNTHESIS ==========

/**
 * Karplus-Strong algorithm for realistic plucked string sounds.
 * Creates a noise burst fed through a delay line (one period = 1/frequency),
 * with a lowpass filter in the feedback loop for natural decay.
 */
function createGuitarTone(ctx, freq, startTime, duration, velocity = 0.5) {
  const output = ctx.createGain();
  const safeStart = Math.max(startTime, ctx.currentTime);

  // Period of the string = 1/frequency (in seconds)
  const period = 1 / freq;

  // Create noise burst for pluck attack
  const burstDuration = period; // One period worth of noise
  const bufferSize = Math.floor(ctx.sampleRate * burstDuration);
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);

  // Fill with white noise, slightly shaped with envelope
  for (let i = 0; i < bufferSize; i++) {
    const envelope = 1 - (i / bufferSize); // Decay envelope on burst
    data[i] = (Math.random() * 2 - 1) * envelope;
  }

  // Create the pluck noise source
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer;

  // Delay line (using DelayNode to create the string period delay)
  const delay = ctx.createDelay(0.1); // Max delay of 100ms
  delay.delayTime.value = period;

  // Lowpass filter in feedback loop for natural damping
  const feedbackFilter = ctx.createBiquadFilter();
  feedbackFilter.type = 'lowpass';
  feedbackFilter.frequency.value = 3000; // Cutoff frequency
  feedbackFilter.Q.value = 1;

  // Feedback gain - controls decay rate
  const feedbackGain = ctx.createGain();
  feedbackGain.gain.value = 0.95; // Slight attenuation per loop

  // Create feedback loop: delay -> filter -> gain -> back to delay
  delay.connect(feedbackFilter);
  feedbackFilter.connect(feedbackGain);
  feedbackGain.connect(delay);

  // Connect noise burst to delay
  noiseSource.connect(delay);

  // Output from delay (also feeds back internally)
  delay.connect(output);

  // Envelope for the overall output
  const totalDur = duration + 0.2;
  output.gain.cancelScheduledValues(safeStart);
  output.gain.setValueAtTime(0, safeStart);
  output.gain.linearRampToValueAtTime(velocity, safeStart + 0.001);
  output.gain.linearRampToValueAtTime(velocity * 0.8, safeStart + 0.05);
  output.gain.linearRampToValueAtTime(0.001, safeStart + duration);

  // Start noise source
  noiseSource.start(safeStart);
  noiseSource.stop(safeStart + burstDuration);

  // Clean up after sound ends
  noiseSource.onended = () => {
    safeDisconnect(noiseSource);
    safeDisconnect(delay);
    safeDisconnect(feedbackFilter);
    safeDisconnect(feedbackGain);
  };

  return output;
}

// ========== DRUM SYNTHESIS ==========

function createKick(ctx, startTime, velocity = 0.8) {
  const output = ctx.createGain();
  const safeStart = Math.max(startTime, ctx.currentTime);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, safeStart);
  osc.frequency.exponentialRampToValueAtTime(35, safeStart + 0.08);

  // Click transient
  const click = ctx.createOscillator();
  click.type = 'square';
  click.frequency.value = 800;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0, safeStart);
  clickGain.gain.linearRampToValueAtTime(velocity * 0.3, safeStart + 0.001);
  clickGain.gain.linearRampToValueAtTime(0.001, safeStart + 0.02);
  click.connect(clickGain);
  clickGain.connect(output);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0, safeStart);
  oscGain.gain.linearRampToValueAtTime(velocity, safeStart + 0.001);
  oscGain.gain.linearRampToValueAtTime(0.001, safeStart + 0.35);

  osc.connect(oscGain);
  oscGain.connect(output);

  // Clean up after stop
  osc.onended = () => {
    safeDisconnect(osc);
    safeDisconnect(oscGain);
  };
  click.onended = () => {
    safeDisconnect(click);
    safeDisconnect(clickGain);
  };

  osc.start(safeStart);
  osc.stop(safeStart + 0.5);
  click.start(safeStart);
  click.stop(safeStart + 0.1);

  return output;
}

function createSnare(ctx, startTime, velocity = 0.6) {
  const output = ctx.createGain();
  const safeStart = Math.max(startTime, ctx.currentTime);

  // Noise for snares
  const bufferSize = ctx.sampleRate * 0.15;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 3000;
  noiseFilter.Q.value = 1;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0, safeStart);
  noiseGain.gain.linearRampToValueAtTime(velocity * 0.4, safeStart + 0.001);
  noiseGain.gain.linearRampToValueAtTime(0.001, safeStart + 0.12);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(output);

  // Tone body
  const tone = ctx.createOscillator();
  tone.type = 'triangle';
  tone.frequency.value = 180;

  const toneGain = ctx.createGain();
  toneGain.gain.setValueAtTime(0, safeStart);
  toneGain.gain.linearRampToValueAtTime(velocity * 0.5, safeStart + 0.001);
  toneGain.gain.linearRampToValueAtTime(0.001, safeStart + 0.08);

  tone.connect(toneGain);
  toneGain.connect(output);

  // Clean up after stop
  noise.onended = () => {
    safeDisconnect(noise);
    safeDisconnect(noiseFilter);
    safeDisconnect(noiseGain);
  };
  tone.onended = () => {
    safeDisconnect(tone);
    safeDisconnect(toneGain);
  };

  noise.start(safeStart);
  tone.start(safeStart);
  tone.stop(safeStart + 0.2);

  return output;
}

function createHiHat(ctx, startTime, open = false, velocity = 0.25) {
  const duration = open ? 0.25 : 0.06;
  const output = ctx.createGain();
  const safeStart = Math.max(startTime, ctx.currentTime);

  const bufferSize = ctx.sampleRate * duration;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7000;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, safeStart);
  gain.gain.linearRampToValueAtTime(velocity, safeStart + 0.001);
  gain.gain.linearRampToValueAtTime(0.001, safeStart + duration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(output);

  // Clean up after stop
  noise.onended = () => {
    safeDisconnect(noise);
    safeDisconnect(filter);
    safeDisconnect(gain);
  };

  noise.start(safeStart);

  return output;
}

// ========== PUBLIC API ==========

export function playNote(note, octave = 4, duration = 0.8, instrument = 'piano', startTime = null) {
  const ctx = getAudioContext();
  const dest = setupAudioChain();
  const freq = getNoteFrequency(note, octave);
  // Small buffer time to ensure audio context is ready
  const now = startTime !== null ? startTime : ctx.currentTime + 0.02;

  let tone;
  if (instrument === 'bass') {
    tone = createBassTone(ctx, freq, now, duration, 0.6);
  } else if (instrument === 'epiano') {
    tone = createEPianoTone(ctx, freq, now, duration, 0.5);
  } else if (instrument === 'guitar') {
    tone = createGuitarTone(ctx, freq, now, duration, 0.5);
  } else {
    tone = createPianoTone(ctx, freq, now, duration, 0.5);
  }
  tone.connect(dest);
}

export function playChord(chordStr, duration = 1.2, startTime = null, instrument = 'piano') {
  const ctx = getAudioContext();
  const dest = setupAudioChain();
  // Small buffer time for reliability
  const time = startTime !== null ? startTime : ctx.currentTime + 0.02;

  // Parse chord
  let root, quality;
  if (chordStr.length >= 2 && (chordStr[1] === '#' || chordStr[1] === 'b')) {
    root = chordStr.substring(0, 2);
    quality = chordStr.substring(2);
  } else {
    root = chordStr[0];
    quality = chordStr.substring(1);
  }

  const tones = getChordTones(root, quality);
  const rootIdx = noteToIndex(root);
  const baseOctave = rootIdx >= 5 ? 3 : 4;
  const strumDelay = 0.015;

  tones.forEach((t, i) => {
    const octave = baseOctave + t.offset;
    const freq = getNoteFrequency(t.note, octave);
    const noteTime = time + i * strumDelay;
    const vel = 0.35 + Math.random() * 0.1;

    let tone;
    if (instrument === 'epiano') {
      tone = createEPianoTone(ctx, freq, noteTime, duration, vel);
    } else if (instrument === 'guitar') {
      tone = createGuitarTone(ctx, freq, noteTime, duration, vel);
    } else {
      tone = createPianoTone(ctx, freq, noteTime, duration, vel);
    }
    tone.connect(dest);
  });
}

export function playBass(note, octave = 2, duration = 0.8, startTime = null) {
  const ctx = getAudioContext();
  const dest = setupAudioChain();
  const time = startTime !== null ? startTime : ctx.currentTime;
  const freq = getNoteFrequency(note, octave);
  const tone = createBassTone(ctx, freq, time, duration, 0.6);
  tone.connect(dest);
}

export function playDrum(type, startTime = null, velocity = 0.6) {
  const ctx = getAudioContext();
  const dest = setupAudioChain();
  const time = startTime !== null ? startTime : ctx.currentTime;

  let drum;
  switch(type) {
    case 'kick': drum = createKick(ctx, time, velocity); break;
    case 'snare': drum = createSnare(ctx, time, velocity); break;
    case 'hihat': drum = createHiHat(ctx, time, false, velocity * 0.5); break;
    case 'hihat-open': drum = createHiHat(ctx, time, true, velocity * 0.5); break;
    default: return;
  }
  drum.connect(dest);
}

// Play a chord shape preview (strum the actual fret positions)
export function playShapePreview(frets) {
  const ctx = getAudioContext();
  const dest = setupAudioChain();
  const now = ctx.currentTime + 0.02;

  // Guitar string tuning: [lowE2, A2, D3, G3, B3, highE4]
  // MIDI-style: E2=4+2*12=28, A2=9+2*12=33, D3=2+3*12=38, G3=7+3*12=43, B3=11+3*12=47, E4=4+4*12=52
  const OPEN_NOTES = ['E', 'A', 'D', 'G', 'B', 'E'];
  const OPEN_OCTAVES = [2, 2, 3, 3, 3, 4];
  const OPEN_SEMITONES = [4, 9, 2, 7, 11, 4]; // pitch classes

  const strumDelay = 0.03; // guitar-like strum spread
  let strumIdx = 0;

  for (let s = 0; s < 6; s++) {
    if (frets[s] === null || frets[s] === undefined) continue;
    const fret = frets[s];
    const noteIdx = (OPEN_SEMITONES[s] + fret) % 12;
    const noteName = NOTE_NAMES_SHARP[noteIdx];
    // Calculate octave: open string octave + semitones added by fret
    const totalSemitones = OPEN_SEMITONES[s] + fret;
    const octave = OPEN_OCTAVES[s] + Math.floor((OPEN_SEMITONES[s] + fret - OPEN_SEMITONES[s]) / 12);
    // More accurate: count from open string
    const openAbsolute = OPEN_OCTAVES[s] * 12 + OPEN_SEMITONES[s];
    const noteAbsolute = openAbsolute + fret;
    const finalOctave = Math.floor(noteAbsolute / 12);

    const freq = getNoteFrequency(noteName, finalOctave);
    const noteTime = now + strumIdx * strumDelay;
    const vel = 0.3 + Math.random() * 0.1;
    const tone = createGuitarTone(ctx, freq, noteTime, 1.5, vel);
    tone.connect(dest);
    strumIdx++;
  }
}

// ========== BACKING TRACK LOOPER ==========

let loopTimeoutId = null;
let isLooping = false;
let nextScheduleTime = 0;
let visualRafId = null;

export function getAudioTime() {
  return getAudioContext().currentTime;
}

export function stopLoop() {
  isLooping = false;
  if (loopTimeoutId) {
    clearTimeout(loopTimeoutId);
    loopTimeoutId = null;
  }
  if (visualRafId) {
    cancelAnimationFrame(visualRafId);
    visualRafId = null;
  }
}

export function isPlaying() {
  return isLooping;
}

// Play one measure of backing track
export function playBackingMeasure(chord, style, bpm, startTime, options = {}) {
  const ctx = getAudioContext();
  setupAudioChain();

  const beatDur = 60 / bpm;
  const measureDur = beatDur * 4;
  const variant = options.variant || 1;

  // Parse chord
  let root, quality;
  if (chord.length >= 2 && (chord[1] === '#' || chord[1] === 'b')) {
    root = chord.substring(0, 2);
    quality = chord.substring(2);
  } else {
    root = chord[0];
    quality = chord.substring(1);
  }

  const tones = getChordTones(root, quality);
  const fifth = tones[2]?.note || root;
  const third = tones[1]?.note || root;

  // ===== KEYS =====
  if (options.keys !== false) {
    if (style === 'ballad') {
      if (variant === 1) {
        playChord(chord, measureDur * 0.9, startTime, 'epiano');
      } else {
        // Variant 2: Arpeggiated
        playChord(chord, beatDur * 1.5, startTime, 'epiano');
        playChord(chord, beatDur * 1.5, startTime + beatDur * 2, 'epiano');
      }
    } else if (style === 'pop') {
      if (variant === 1) {
        for (let b = 0; b < 4; b++) {
          playChord(chord, beatDur * 0.7, startTime + b * beatDur, 'piano');
        }
      } else {
        // Variant 2: Syncopated
        playChord(chord, beatDur * 0.6, startTime, 'piano');
        playChord(chord, beatDur * 0.6, startTime + beatDur * 1.5, 'piano');
        playChord(chord, beatDur * 0.6, startTime + beatDur * 2.5, 'piano');
      }
    } else if (style === 'jazz') {
      if (variant === 1) {
        playChord(chord, beatDur * 1.4, startTime, 'epiano');
        playChord(chord, beatDur * 1.4, startTime + beatDur * 2.5, 'epiano');
      } else {
        // Variant 2: Swing comping
        playChord(chord, beatDur * 0.8, startTime + beatDur * 0.66, 'epiano');
        playChord(chord, beatDur * 0.8, startTime + beatDur * 2.66, 'epiano');
      }
    } else if (style === 'rock') {
      if (variant === 1) {
        // Power chord hits
        playChord(chord, beatDur * 0.5, startTime, 'piano');
        playChord(chord, beatDur * 0.5, startTime + beatDur * 2, 'piano');
      } else {
        // Driving eighths
        for (let i = 0; i < 8; i++) {
          playChord(chord, beatDur * 0.4, startTime + i * beatDur * 0.5, 'piano');
        }
      }
    } else if (style === 'rnb') {
      if (variant === 1) {
        // Smooth sustained
        playChord(chord, measureDur * 0.85, startTime, 'epiano');
      } else {
        // Neo-soul rhythmic
        playChord(chord, beatDur * 0.7, startTime, 'epiano');
        playChord(chord, beatDur * 0.5, startTime + beatDur * 1.5, 'epiano');
        playChord(chord, beatDur * 0.7, startTime + beatDur * 2.5, 'epiano');
      }
    } else if (style === 'folk') {
      if (variant === 1) {
        // Strummed pattern
        playChord(chord, beatDur * 0.8, startTime, 'piano');
        playChord(chord, beatDur * 0.4, startTime + beatDur * 2, 'piano');
        playChord(chord, beatDur * 0.4, startTime + beatDur * 2.5, 'piano');
        playChord(chord, beatDur * 0.4, startTime + beatDur * 3, 'piano');
      } else {
        // Fingerpicking style
        playChord(chord, beatDur * 1.8, startTime, 'piano');
        playChord(chord, beatDur * 1.8, startTime + beatDur * 2, 'piano');
      }
    }
  }

  // ===== BASS =====
  if (options.bass !== false) {
    if (style === 'ballad') {
      if (variant === 1) {
        playBass(root, 2, beatDur * 1.8, startTime);
        playBass(fifth, 2, beatDur * 1.8, startTime + beatDur * 2);
      } else {
        playBass(root, 2, beatDur * 3.5, startTime);
      }
    } else if (style === 'pop') {
      if (variant === 1) {
        playBass(root, 2, beatDur * 0.9, startTime);
        playBass(root, 2, beatDur * 0.9, startTime + beatDur);
        playBass(fifth, 2, beatDur * 0.9, startTime + beatDur * 2);
        playBass(root, 2, beatDur * 0.9, startTime + beatDur * 3);
      } else {
        // Syncopated bass
        playBass(root, 2, beatDur * 0.7, startTime);
        playBass(fifth, 2, beatDur * 0.7, startTime + beatDur * 1.5);
        playBass(root, 2, beatDur * 0.7, startTime + beatDur * 2.5);
      }
    } else if (style === 'jazz') {
      // Walking bass
      if (variant === 1) {
        playBass(root, 2, beatDur * 0.9, startTime);
        playBass(third, 2, beatDur * 0.9, startTime + beatDur);
        playBass(fifth, 2, beatDur * 0.9, startTime + beatDur * 2);
        const approach = NOTE_NAMES_SHARP[(noteToIndex(root) + 11) % 12];
        playBass(approach, 2, beatDur * 0.9, startTime + beatDur * 3);
      } else {
        // Two-feel
        playBass(root, 2, beatDur * 1.8, startTime);
        playBass(fifth, 2, beatDur * 1.8, startTime + beatDur * 2);
      }
    } else if (style === 'rock') {
      if (variant === 1) {
        // Straight eighths
        for (let i = 0; i < 8; i++) {
          const note = i % 2 === 0 ? root : fifth;
          playBass(note, 2, beatDur * 0.4, startTime + i * beatDur * 0.5);
        }
      } else {
        // Root-fifth pattern
        playBass(root, 2, beatDur * 0.9, startTime);
        playBass(root, 2, beatDur * 0.9, startTime + beatDur);
        playBass(fifth, 2, beatDur * 0.9, startTime + beatDur * 2);
        playBass(fifth, 2, beatDur * 0.9, startTime + beatDur * 3);
      }
    } else if (style === 'rnb') {
      if (variant === 1) {
        // Smooth groove
        playBass(root, 2, beatDur * 1.5, startTime);
        playBass(fifth, 2, beatDur * 0.7, startTime + beatDur * 2);
        playBass(root, 2, beatDur * 0.7, startTime + beatDur * 3);
      } else {
        // Syncopated
        playBass(root, 2, beatDur * 0.8, startTime);
        playBass(third, 2, beatDur * 0.6, startTime + beatDur * 1.5);
        playBass(fifth, 2, beatDur * 0.8, startTime + beatDur * 2.5);
      }
    } else if (style === 'folk') {
      if (variant === 1) {
        // Boom-chuck
        playBass(root, 2, beatDur * 0.9, startTime);
        playBass(fifth, 2, beatDur * 0.9, startTime + beatDur * 2);
      } else {
        // Walking feel
        playBass(root, 2, beatDur * 0.9, startTime);
        playBass(third, 2, beatDur * 0.9, startTime + beatDur);
        playBass(fifth, 2, beatDur * 0.9, startTime + beatDur * 2);
        playBass(third, 2, beatDur * 0.9, startTime + beatDur * 3);
      }
    }
  }

  // ===== DRUMS =====
  if (options.drums === true) {
    if (style === 'ballad') {
      if (variant === 1) {
        playDrum('kick', startTime, 0.5);
        playDrum('snare', startTime + beatDur * 2, 0.3);
        for (let i = 0; i < 4; i++) {
          playDrum('hihat', startTime + i * beatDur, 0.2);
        }
      } else {
        // Brushes feel
        playDrum('kick', startTime, 0.4);
        playDrum('kick', startTime + beatDur * 2.5, 0.3);
        playDrum('snare', startTime + beatDur * 2, 0.25);
        for (let i = 0; i < 8; i++) {
          playDrum('hihat', startTime + i * beatDur * 0.5, 0.15);
        }
      }
    } else if (style === 'pop') {
      if (variant === 1) {
        playDrum('kick', startTime, 0.7);
        playDrum('kick', startTime + beatDur * 2, 0.7);
        playDrum('snare', startTime + beatDur, 0.5);
        playDrum('snare', startTime + beatDur * 3, 0.5);
        for (let i = 0; i < 8; i++) {
          playDrum('hihat', startTime + i * beatDur * 0.5, 0.3);
        }
      } else {
        // Four on the floor
        for (let i = 0; i < 4; i++) {
          playDrum('kick', startTime + i * beatDur, 0.6);
        }
        playDrum('snare', startTime + beatDur, 0.5);
        playDrum('snare', startTime + beatDur * 3, 0.5);
        for (let i = 0; i < 8; i++) {
          playDrum('hihat', startTime + i * beatDur * 0.5, 0.25);
        }
      }
    } else if (style === 'jazz') {
      if (variant === 1) {
        playDrum('kick', startTime, 0.4);
        playDrum('kick', startTime + beatDur * 2.5, 0.3);
        for (let i = 0; i < 4; i++) {
          playDrum('hihat', startTime + i * beatDur, 0.25);
          playDrum('hihat', startTime + i * beatDur + beatDur * 0.66, 0.15);
        }
      } else {
        // Swing with ride pattern
        for (let i = 0; i < 4; i++) {
          playDrum('hihat', startTime + i * beatDur, 0.3);
          playDrum('hihat', startTime + i * beatDur + beatDur * 0.66, 0.2);
        }
        playDrum('kick', startTime + beatDur, 0.35);
        playDrum('kick', startTime + beatDur * 3.5, 0.3);
      }
    } else if (style === 'rock') {
      if (variant === 1) {
        // Driving rock
        playDrum('kick', startTime, 0.8);
        playDrum('kick', startTime + beatDur * 2, 0.8);
        playDrum('snare', startTime + beatDur, 0.7);
        playDrum('snare', startTime + beatDur * 3, 0.7);
        for (let i = 0; i < 8; i++) {
          playDrum('hihat', startTime + i * beatDur * 0.5, 0.35);
        }
      } else {
        // Heavy rock with double kick feel
        playDrum('kick', startTime, 0.8);
        playDrum('kick', startTime + beatDur * 0.5, 0.6);
        playDrum('kick', startTime + beatDur * 2, 0.8);
        playDrum('kick', startTime + beatDur * 2.5, 0.6);
        playDrum('snare', startTime + beatDur, 0.7);
        playDrum('snare', startTime + beatDur * 3, 0.7);
        for (let i = 0; i < 4; i++) {
          playDrum('hihat', startTime + i * beatDur, 0.4);
        }
      }
    } else if (style === 'rnb') {
      if (variant === 1) {
        // Smooth groove
        playDrum('kick', startTime, 0.6);
        playDrum('kick', startTime + beatDur * 1.75, 0.4);
        playDrum('kick', startTime + beatDur * 2.5, 0.5);
        playDrum('snare', startTime + beatDur, 0.4);
        playDrum('snare', startTime + beatDur * 3, 0.4);
        for (let i = 0; i < 8; i++) {
          playDrum('hihat', startTime + i * beatDur * 0.5, 0.2);
        }
      } else {
        // Trap-influenced
        playDrum('kick', startTime, 0.7);
        playDrum('kick', startTime + beatDur * 2.25, 0.5);
        playDrum('snare', startTime + beatDur, 0.5);
        playDrum('snare', startTime + beatDur * 3, 0.5);
        for (let i = 0; i < 16; i++) {
          playDrum('hihat', startTime + i * beatDur * 0.25, 0.18);
        }
      }
    } else if (style === 'folk') {
      if (variant === 1) {
        // Simple folk
        playDrum('kick', startTime, 0.5);
        playDrum('kick', startTime + beatDur * 2, 0.5);
        playDrum('snare', startTime + beatDur, 0.35);
        playDrum('snare', startTime + beatDur * 3, 0.35);
      } else {
        // Train beat
        playDrum('kick', startTime, 0.5);
        playDrum('kick', startTime + beatDur * 2, 0.5);
        for (let i = 0; i < 8; i++) {
          playDrum('snare', startTime + i * beatDur * 0.5, 0.25);
        }
      }
    }
  }

  return measureDur;
}

// Start looping the backing track with improved timing using lookahead scheduling
// v102: half-bar comp figure for 2-beat chords — keys/bass only, drums
// stay on the bar clock (see startBackingLoop).
export function playBackingHalfBar(chord, style, bpm, startTime, options = {}) {
  const beatDur = 60 / bpm;
  if (options.keys !== false) {
    const inst = (style === 'folk') ? 'guitar' : 'epiano';
    playChord(chord, beatDur * 1.7, startTime, inst);
  }
  if (options.bass !== false) {
    const root = (chord.length >= 2 && (chord[1] === '#' || chord[1] === 'b')) ? chord.substring(0, 2) : chord[0];
    playBass(root, 2, beatDur * 0.9, startTime);
    playBass(root, 2, beatDur * 0.85, startTime + beatDur);
  }
}

// v102 two-clock scheduler.
// Items may carry {beats: 2|4|8, accent: 'norm'|'stop'|'push'} — defaults 4/'norm'.
// Drums run on a continuous BAR clock (immune to chord boundaries); keys/bass
// run on a CHORD clock for each chord's exact span. For all-4-beat 'norm'
// progressions the emitted events are identical to v1.
export function startBackingLoop(progression, style, bpm, options = {}, onMeasure = null, onSchedule = null) {
  const ctx = getAudioContext();
  setupAudioChain();

  isLooping = true;
  const beatDur = 60 / bpm;
  const barDur = beatDur * 4;
  const lookaheadTime = 0.1;
  const scheduleCheckInterval = 0.025;

  const items = progression.map(p => ({
    chord: p.chord,
    beats: (typeof p.beats === 'number' && p.beats > 0) ? p.beats : 4,  // v2 port: allow free ½-beat lengths (was clamped to 2/4/8)
    accent: (p.accent === 'stop' || p.accent === 'push') ? p.accent : 'norm',
    start: (typeof p.start === 'number') ? p.start : null
  }));
  // v2 port: onsets come from each chord's absolute `start` (free positions / gaps / per-line meter).
  // When start is absent (old callers / non-positioned data) fall back to sequential packing — back-compat.
  let cum = 0;
  const starts = items.map((it, idx) => { const beat = (it.start != null) ? it.start : cum; cum = Math.max(cum, beat + it.beats); return { idx, item: it, beat }; });
  const songBeats = (typeof progression.songBeats === 'number' && progression.songBeats > 0) ? progression.songBeats : cum;
  const totalBeats = Math.max(4, Math.ceil(songBeats / 4) * 4);

  function chordAt(beat) {
    // highest-onset chord at/just-before `beat` (robust to array order after free repositioning)
    let best = null;
    for (let i = 0; i < starts.length; i++) { if (starts[i].beat <= beat && (!best || starts[i].beat > best.beat)) best = starts[i]; }
    return best || starts[0];
  }

  // Visual sync (unchanged from v1)
  let pendingVisualCallbacks = [];
  function visualSyncLoop() {
    if (!isLooping) return;
    const now = ctx.currentTime;
    while (pendingVisualCallbacks.length > 0 && pendingVisualCallbacks[0].time <= now) {
      const cb = pendingVisualCallbacks.shift();
      cb.fn(cb.idx);
    }
    visualRafId = requestAnimationFrame(visualSyncLoop);
  }
  if (onMeasure) {
    visualRafId = requestAnimationFrame(visualSyncLoop);
  }

  nextScheduleTime = ctx.currentTime + lookaheadTime;
  const t0 = nextScheduleTime;          // audio time of loop-beat 0
  let barIndex = 0;                     // absolute bar counter (drum clock)
  let chordCursor = 0;                  // absolute chord-event counter (harmony clock)

  function scheduleNextWindow() {
    if (!isLooping) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const horizon = ctx.currentTime + lookaheadTime;

    // ---- bar clock: drums ----
    while (t0 + barIndex * barDur < horizon) {
      const barT = t0 + barIndex * barDur;
      const loopBeat = (barIndex * 4) % totalBeats;
      const cov = chordAt(loopBeat);
      const covEnd = cov.beat + cov.item.beats;
      const stopBar = cov.item.accent === 'stop' && loopBeat >= cov.beat && loopBeat < covEnd;
      if (options.drums === true) {
        if (stopBar) {
          playDrum('kick', barT, 0.7);
        } else {
          playBackingMeasure(cov.item.chord, style, bpm, barT, { ...options, keys: false, bass: false, drums: true });
        }
      }
      barIndex++;
    }

    // ---- chord clock: keys/bass + callbacks ----
    while (true) {
      const rep = Math.floor(chordCursor / starts.length);
      const s = starts[chordCursor % starts.length];
      let t = t0 + (rep * totalBeats + s.beat) * beatDur;
      if (t >= horizon) break;
      let playT = t;
      if (s.item.accent === 'push') playT = Math.max(ctx.currentTime + 0.02, t - beatDur * 0.5);

      if (s.item.accent === 'stop') {
        // whole band stabs beat one, then space
        if (options.keys !== false) playChord(s.item.chord, beatDur * 1.2, playT, 'epiano');
        if (options.bass !== false) {
          const root = (s.item.chord.length >= 2 && (s.item.chord[1] === '#' || s.item.chord[1] === 'b')) ? s.item.chord.substring(0, 2) : s.item.chord[0];
          playBass(root, 2, beatDur * 1.1, playT);
        }
      } else if (s.item.beats === 2) {
        playBackingHalfBar(s.item.chord, style, bpm, playT, options);
      } else {
        playBackingMeasure(s.item.chord, style, bpm, playT, { ...options, drums: false });
        if (s.item.beats === 8) {
          playBackingMeasure(s.item.chord, style, bpm, playT + barDur, { ...options, drums: false });
        }
      }

      if (onSchedule) {
        try { onSchedule(s.idx, t, s.item.beats * beatDur); } catch (e) {}
      }
      if (onMeasure) {
        pendingVisualCallbacks.push({ time: t, fn: onMeasure, idx: s.idx });
      }
      chordCursor++;
    }

    nextScheduleTime = horizon;
    if (isLooping) {
      loopTimeoutId = setTimeout(scheduleNextWindow, scheduleCheckInterval * 1000);
    }
  }

  scheduleNextWindow();
}

export function playSequence(progression, callback) {
  const ctx = getAudioContext();
  setupAudioChain();

  let currentTime = ctx.currentTime + 0.1;
  const chordDuration = 1.2;
  const gap = 0.1;

  progression.forEach(({ chord }, index) => {
    playChord(chord, chordDuration, currentTime);
    currentTime += chordDuration + gap;
  });

  if (callback) {
    const targetTime = currentTime;
    function checkDone() {
      if (ctx.currentTime >= targetTime) {
        callback(-1);
      } else {
        requestAnimationFrame(checkDone);
      }
    }
    requestAnimationFrame(checkDone);
  }
}

export async function initAudio() {
  const ctx = getAudioContext();

  // Resume if suspended - MUST await this for Safari
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }

  setupAudioChain();

  // Play silent buffer to unlock audio (Safari)
  const buffer = ctx.createBuffer(1, 1, 22050);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);

  // Also play a very short oscillator to ensure unlock
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.001;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.001);

  // Clean up after stop
  osc.onended = () => {
    safeDisconnect(osc);
    safeDisconnect(gain);
  };
}


// ── Gesture-level resume guard (v101) ───────────────────────────────
// "Sound sometimes works, sometimes doesn't": browsers suspend the
// AudioContext after interruptions (tab switch, iOS audio focus, power
// saving). Any pointer gesture is a legal moment to resume — so always
// try. Cheap no-op when already running.
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => {
    if (audioCtx && audioCtx.state !== 'running') {
      audioCtx.resume().catch(() => {});
    }
  }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  });
}
