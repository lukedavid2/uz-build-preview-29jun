/* Undercover Zest — mobile view shell.
   Stage 1: breakpoint mount + shared data layer (drives the SAME desktop `state` via window.UZ → round-trip is automatic).
   Stage 2: interactive chords lane — tap-select + chord editor sheet, ripple-OUTWARD drag, start/length,
            key-aware chord palette sheet, meter chip. All mutate the shared progressionLines[].chords[]
            ({chord, roman, id, beats, accent, start, shape}); the prototype's name/len map to chord/beats.
   The full builder (tab/melody lanes, song view, lyrics, tools, audio) lands in later stages. */

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const METERS = [4, 3, 6, 2];               // bpb (top); displayed 4/4, 3/4, 6/8, 2/4
const METER_LABEL = { 4: '4/4', 3: '3/4', 6: '6/8', 2: '2/4' };
const MIN_BARS = 4;                          // a section always offers at least 4 bars of room
const QUALS = [
  { label: 'maj', suf: '' }, { label: 'min', suf: 'm' }, { label: 'dim', suf: 'dim' },
  { label: 'aug', suf: 'aug' }, { label: 'sus2', suf: 'sus2' }, { label: 'sus4', suf: 'sus4' },
];
const EXTS = [
  { label: '—', suf: '' }, { label: '7', suf: '7' }, { label: 'maj7', suf: 'maj7' },
  { label: '6', suf: '6' }, { label: '9', suf: '9' }, { label: 'add9', suf: 'add9' },
];

let UZ = null, root = null, saveTimer = null, uidSeq = 0;
// transient view state (not persisted)
const view = { sheet: null, selId: null, addAt: null, pick: { root: 'C', qual: 0, ext: 0 }, shapesOn: false, sh: null, lane: 'chords', fret: null, playing: false, loopOn: true, playBeat: 0, playId: null, pianoOpen: false, recording: false, octave: 4, scaleLock: false, recCursor: 0, song: false, songShapes: false, songLyrics: false, lyrics: false, lyrPick: null, howtoOpen: true, tool: null, kf: { root: 'C', qual: '', chords: [], selKey: null, selType: null }, scale: { type: 'major', blues: false }, arp: { root: 'C', qual: '' } };
let audioUnlocked = false;
// piano keyboard layout: [noteName, octaveOffset(, leftPct for black)]
const PIANO_WHITE = [['C', 0], ['D', 0], ['E', 0], ['F', 0], ['G', 0], ['A', 0], ['B', 0], ['C', 1], ['D', 1]];
const PIANO_BLACK = [['C#', 0, 7.5], ['D#', 0, 18.6], ['F#', 0, 40.8], ['G#', 0, 51.9], ['A#', 0, 63.0], ['C#', 1, 85.3]];
const PC = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
// chord-shape detection (ported from the prototype; frets index 0 = low E, null = muted, 0 = open —
// the desktop shape.frets format, so shapes round-trip with the v2 builder)
const OPEN_PC = [4, 9, 2, 7, 11, 4];        // E A D G B e pitch classes (low→high)
const SH_QUAL = [['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['7', [0, 4, 7, 10]], ['m7', [0, 3, 7, 10]], ['maj7', [0, 4, 7, 11]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]]];
const IVNAME = { 0: 'R', 1: '♭9', 2: '9', 3: '♭3', 4: '3', 5: '4', 6: '♭5', 7: '5', 8: '♯5', 9: '6', 10: '♭7', 11: '7' };
let drag = null, songDrag = null, justDragged = false;
let rhymeFrame = null, rhymePending = null;  // persistent /rhymeforge/?embed=1 iframe, hosted OUTSIDE #app-mobile

export function initMobile(uz, el) {
  UZ = uz;
  root = el || document.getElementById('app-mobile');
  if (!root) { console.error('[uz-mobile] no #app-mobile mount'); return; }
  const st = UZ.state;
  if (typeof st.currentLineIndex !== 'number' || st.currentLineIndex < 0 || st.currentLineIndex >= (st.progressionLines || []).length) st.currentLineIndex = 0;
  view.pick.root = st.selectedKey || 'C';
  // document-level drag listeners (added once)
  document.addEventListener('pointermove', onDragMove, { passive: false });
  document.addEventListener('pointerup', onDragUp);
  // RhymeForge → UZ import: the desktop app.js 'message' handler (still live in this bundle) mutates
  // state.lyrics + saves; we only need to refresh the mobile DOM afterwards (deferred so it runs after it).
  window.addEventListener('message', function (e) {
    const d = e.data; if (!d || d.type !== 'rhymeforge-import-to-uz') return;
    setTimeout(function () { if (view.lyrics) render(); }, 0);
  });
  render();
  console.info('[uz-mobile] mounted — Stage 2 (interactive chords lane)');
}

// ── persistence (debounced ~400ms; brief §3.4) ──
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); }
function flush() { clearTimeout(saveTimer); try { UZ.save(); } catch (e) { console.warn('[uz-mobile] save failed', e); } }

// ── helpers ──
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function isMinor() { return UZ.state.selectedTab === 'dark'; }
function uid() { return 'm' + Date.now().toString(36) + (uidSeq++).toString(36); }
function snap05(v) { return Math.round(v * 2) / 2; }
function lines() { return UZ.state.progressionLines || []; }
function curIdx() { return Math.min(UZ.state.currentLineIndex || 0, Math.max(0, lines().length - 1)); }
function curLine() { return lines()[curIdx()] || { chords: [] }; }
function bpbOf(line) { return (line && line.bpb) || 4; }
function axisOf(line) {
  const bpb = bpbOf(line);
  let maxEnd = 0;
  (line.chords || []).forEach(function (c) { const e = (c.start || 0) + (c.beats || 4); if (e > maxEnd) maxEnd = e; });
  const nbars = Math.max(MIN_BARS, Math.ceil(maxEnd / bpb - 1e-9));
  return { bpb: bpb, nbars: nbars, axis: nbars * bpb };
}
function lenLabel(beats, bpb) {
  if (beats === bpb) return '1 bar';
  if (beats === bpb * 2) return '2 bars';
  if (beats === bpb / 2) return '½';
  return beats + '♩';
}
// ripple OUTWARD: anchor the dragged chord at its dropped start, then cascade left→right pushing any
// chord that would overlap the previous one's end rightward (grows into new bars; never compacts inward;
// never overlaps). The dragged chord wins start-ties so it keeps its dropped position. This is the
// no-overlap form of the prototype's _onMove (whose "push left to 0" stacks chords in dense lines).
function rippleOutward(chords, meId) {
  let cursor = -Infinity;
  chords.slice()
    .sort(function (a, b) { return ((a.start || 0) - (b.start || 0)) || (a.id === meId ? -1 : 1); })
    .forEach(function (c) { let s = c.start || 0; if (s < cursor - 1e-9) s = cursor; c.start = s; cursor = s + c.beats; });
}
// key-aware roman for a chord name (via the v2 model's diatonic palette); '' if non-diatonic
function romanFor(name) {
  try {
    const groups = UZ.Model && UZ.Model.paletteFor ? UZ.Model.paletteFor(UZ.state.selectedKey || 'C', isMinor()) : null;
    if (!groups) return '';
    for (let g = 0; g < groups.length; g++) { const hit = (groups[g].chords || []).find(function (c) { return c.name === name; }); if (hit) return hit.roman || ''; }
  } catch (e) {}
  return '';
}
function pickerName() {
  const root = view.pick.root, q = QUALS[view.pick.qual].suf, e = EXTS[view.pick.ext].suf;
  // mirror desktop getPickerChord special-cases so the name is canonical
  if (e === '7') { if (q === 'sus2') return root + '7sus2'; if (q === 'sus4') return root + '7sus4'; }
  if (e === 'maj7' && q === 'm') return root + 'mMaj7';
  return root + q + e;
}

// ── chord-shape editor (Stage 3, Option A) ──
function shPcs(frets) { const s = {}; frets.forEach(function (f, i) { if (f != null && f >= 0) s[((OPEN_PC[i] + f) % 12 + 12) % 12] = true; }); return s; }
function detectShape(frets) {
  const set = Object.keys(shPcs(frets)).map(Number).sort(function (a, b) { return a - b; });
  if (set.length < 3) return '';
  for (let r = 0; r < 12; r++) for (let q = 0; q < SH_QUAL.length; q++) {
    const iv = SH_QUAL[q][1].map(function (x) { return (r + x) % 12; }).sort(function (a, b) { return a - b; });
    if (iv.length === set.length && iv.every(function (v, k) { return v === set[k]; })) return KEYS[r] + SH_QUAL[q][0];
  }
  return '';
}
function rootPcOf(name) { const m = name && name.match(/^[A-G][#b]?/); if (!m) return -1; return KEYS.indexOf(m[0].replace('b', '#')); }
function shNotes(frets) {
  const det = detectShape(frets), rp = det ? rootPcOf(det) : -1, out = [];
  frets.forEach(function (f, i) { if (f != null && f >= 0) { const pc = ((OPEN_PC[i] + f) % 12 + 12) % 12; out.push({ note: KEYS[pc], iv: rp >= 0 ? (IVNAME[((pc - rp) % 12 + 12) % 12] || '') : '' }); } });
  return out;
}
function shAlts(frets) {
  const det = detectShape(frets); if (!det) return [];
  const rp = rootPcOf(det), rn = det.match(/^[A-G][#b]?/)[0], entered = shPcs(frets);
  const FORMS = [['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['6', [0, 4, 7, 9]], ['add9', [0, 4, 7, 2]], ['9', [0, 4, 7, 10, 2]], ['m7', [0, 3, 7, 10]]];
  return FORMS.map(function (F) { const pcs = F[1].map(function (x) { return (rp + x) % 12; }); const match = pcs.filter(function (p) { return entered[p]; }).length; return { name: rn + F[0], ratio: match + '/' + pcs.length }; })
    .filter(function (a) { return a.name !== det; }).slice(0, 5);
}
function openShapeFor(cid) {
  const c = (curLine().chords || []).find(function (x) { return x.id === cid; });
  const frets = (c && c.shape && c.shape.frets) ? c.shape.frets.slice() : [null, null, null, null, null, null];
  return { cid: cid, name: c ? c.chord : '', frets: frets, base: (c && c.shape && c.shape.baseFret) || 0, pick: null };
}
function miniDiagram(shape) {
  if (!shape || !shape.frets) return '';
  let dots = '';
  shape.frets.forEach(function (f, i) {
    const cls = f == null ? 'x' : (f === 0 ? 'o' : 'd');
    dots += '<span class="m-md ' + cls + '" style="left:' + (i / 5 * 100) + '%">' + (f == null ? '×' : f === 0 ? '○' : f) + '</span>';
  });
  return '<span class="m-mini">' + dots + '</span>';
}
function shapeSheet() {
  const sh = view.sh; if (!sh) return '';
  const det = detectShape(sh.frets), title = det || sh.name || '—', mism = det && sh.name && det !== sh.name;
  const cols = [0, 1, 2, 3, 4].map(function (r) { return sh.base + r; });
  let body = '<div class="m-sh-nav">'
    + '<button class="m-seg" data-act="shWin" data-d="-1">◀</button>'
    + '<span class="m-sh-winlbl">Frets ' + sh.base + '–' + (sh.base + 4) + '</span>'
    + '<button class="m-seg" data-act="shWin" data-d="1">▶</button><span class="m-spacer"></span>'
    + '<span class="m-ed-lbl">Shift</span><button class="m-seg" data-act="shShift" data-d="-1">↓1</button><button class="m-seg" data-act="shShift" data-d="1">↑1</button></div>';
  body += '<div class="m-sh-type"><span class="m-ed-lbl">TYPE</span><span class="m-sh-typestr">' + sh.frets.map(function (f) { return f == null ? 'x' : String(f); }).join(' ') + '</span><span class="m-sh-typehint">low E → high e</span></div>';
  let colhd = '<div class="m-sh-row"><span class="m-sh-slbl"></span><span class="m-sh-val" style="visibility:hidden">×</span><div class="m-sh-cols">' + cols.map(function (c) { return '<span class="m-sh-col">' + c + '</span>'; }).join('') + '</div></div>';
  let rows = '';
  ['E', 'A', 'D', 'G', 'B', 'e'].forEach(function (sn, i) {
    const v = sh.frets[i];
    let cells = '';
    cols.forEach(function (fr) { cells += '<button class="m-sh-cell' + (sh.frets[i] === fr ? ' on' : '') + '" data-act="shGrid" data-si="' + i + '" data-fr="' + fr + '"></button>'; });
    let pick = '';
    if (sh.pick === i) { let keys = ''; for (let n = 0; n <= 12; n++) keys += '<button class="m-sh-pk" data-act="shSet" data-si="' + i + '" data-v="' + n + '">' + n + '</button>'; keys += '<button class="m-sh-pk" data-act="shSet" data-si="' + i + '" data-v="x">×</button>'; pick = '<div class="m-sh-pickpop">' + keys + '</div>'; }
    rows += '<div class="m-sh-row"><span class="m-sh-slbl">' + sn + '</span>'
      + '<button class="m-sh-val' + (v == null ? ' muted' : '') + '" data-act="shPick" data-si="' + i + '">' + (v == null ? '×' : String(v)) + '</button>' + pick
      + '<div class="m-sh-cols">' + cells + '</div></div>';
  });
  body += '<div class="m-sh-fb">' + colhd + rows + '</div>';
  const notes = shNotes(sh.frets), alts = shAlts(sh.frets);
  body += '<div class="m-sh-info">';
  body += '<div class="m-sh-check"><span class="m-ed-lbl">CHORD CHECK</span>' + (det ? (mism ? '<span class="m-sh-mism">⚠ ≠ ' + esc(sh.name) + '</span>' : '<span class="m-sh-ok">' + esc(det) + ' ✓</span>') : '<span class="m-faint">—</span>') + '</div>';
  if (notes.length) body += '<div class="m-sh-chips"><span class="m-ed-lbl">NOTES</span>' + notes.map(function (n) { return '<span class="m-sh-note">' + esc(n.note) + '<small>' + esc(n.iv) + '</small></span>'; }).join('') + '</div>';
  if (alts.length) body += '<div class="m-sh-chips"><span class="m-ed-lbl">ALSO</span>' + alts.map(function (a) { return '<span class="m-sh-alt">' + esc(a.name) + '<small>' + esc(a.ratio) + '</small></span>'; }).join('') + '</div>';
  body += '</div>';
  const foot = '<button class="m-btn" data-act="shClear">Clear</button><span class="m-spacer"></span><button class="m-btn m-primary" data-act="saveShape">Save Shape</button>';
  return sheetFrame('Chord Shape: ' + esc(title), body, foot);
}

// ── Stage 4: tab + melody lanes (one unified note array per line = state.melody.lines[ci],
//    records {bar,slot,d,o,len,acc}; tab shows it as frets, melody as pitches — round-trips with desktop) ──
const TAB_OPEN = [64, 59, 55, 50, 45, 40];  // string 0 = high e … 5 = low E (MIDI)
const STR_LBL = ['e', 'B', 'G', 'D', 'A', 'E'];
const TIER = { chord: { f: '#6fcf86', t: '#16361f' }, scale: { f: '#e8b84a', t: '#4a3608' }, passing: { f: '#b79ad8', t: '#2e1a47' }, outside: { f: '#df7d6f', t: '#451712' } };
function melRes(line) { return line.melRes || (UZ.state.melody && UZ.state.melody.resolution) || 8; }
function slotModel(line) { const ax = axisOf(line), res = melRes(line), spb = ax.bpb * res / 4; return { bpb: ax.bpb, nbars: ax.nbars, res: res, spb: spb, totalSlots: ax.nbars * spb }; }
function notesOf() { const ci = curIdx(); const st = UZ.state; st.melody = st.melody || { lines: {} }; st.melody.lines = st.melody.lines || {}; if (!Array.isArray(st.melody.lines[ci])) st.melody.lines[ci] = []; return st.melody.lines[ci]; }
function pcKey() { return (UZ.Model && UZ.Model.PC) ? (UZ.Model.PC[UZ.state.selectedKey || 'C'] || 0) : 0; }
function noteMidi(n) { try { return UZ.Model.degMidi(n.d, n.o || 0, n.acc || 0, pcKey(), isMinor()); } catch (e) { return 60; } }
function chooseString(midi) { let best = 5, bc = 1e9; for (let s = 0; s < 6; s++) { const f = midi - TAB_OPEN[s]; if (f < 0 || f > 15) continue; const c = Math.abs(f - 4); if (c < bc) { bc = c; best = s; } } return best; }
function noteTier(n, line) {
  const sm = slotModel(line), beat = n.bar * sm.bpb + n.slot * 4 / sm.res;
  const ch = UZ.Model && UZ.Model.chordAtBeat ? UZ.Model.chordAtBeat(line, beat) : null;
  if (!ch) return 'scale';
  try { return UZ.Model.gradePitch(noteMidi(n), ch.name || ch.chord, pcKey(), isMinor()) || 'scale'; } catch (e) { return 'scale'; }
}
function melRows(line) {  // pitch rows, high → low, across melOctaves of the key scale
  const oct = (UZ.state.melody && UZ.state.melody.octaves) || 2, rows = [];
  for (let o = oct - 1; o >= 0; o--) for (let d = 7; d >= 1; d--) {
    const pc = ((noteMidi({ d: d, o: o, acc: 0 }) % 12) + 12) % 12;
    rows.push({ d: d, o: o, label: (UZ.Model && UZ.Model.spell) ? UZ.Model.spell(pc, UZ.state.selectedKey || 'C') : KEYS[pc] });
  }
  return rows;
}
function addNoteAt(bar, slot, d, o, acc) {
  const ci = curIdx(); const keep = notesOf().filter(function (n) { return !(n.bar === bar && n.slot === slot); }); // monophonic per slot
  keep.push({ bar: bar, slot: slot, d: d, o: o || 0, len: 1, acc: acc || 0 });
  UZ.state.melody.lines[ci] = keep; flush();
}
function delNoteAt(bar, slot) { const ci = curIdx(); UZ.state.melody.lines[ci] = notesOf().filter(function (n) { return !(n.bar === bar && n.slot === slot); }); flush(); }

// one lane block in the accordion (active = expanded, else a 46px peek strip)
function laneBlock(kind, line, sm) {
  const active = view.lane === kind;
  const label = kind === 'chords' ? 'Chords' : kind === 'tab' ? 'Tab' : 'Melody';
  if (!active) return '<button class="m-peek" data-act="promote" data-lane="' + kind + '"><span class="m-peek-lbl">' + label + '</span><span class="m-peek-cv">▸</span></button>';
  let body;
  if (kind === 'chords') body = chordsLaneBody(line, sm);
  else if (kind === 'tab') body = tabLaneBody(line, sm);
  else body = melodyLaneBody(line, sm);
  return '<div class="m-lane m-lane-' + kind + '"><div class="m-lane-body">' + body + '</div></div>';
}
function chordsLaneBody(line, sm) {
  let cells = '';
  for (let b = 0; b < sm.nbars; b++) cells += '<div class="m-bar" data-act="insertAt" data-beat="' + (b * sm.bpb) + '"><span class="m-barnum">' + (b + 1) + '</span></div>';
  const chords = (line.chords || []).slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
  let chips = '';
  chords.forEach(function (c) {
    const beats = c.beats || 4, left = (c.start || 0) / (sm.nbars * sm.bpb) * 100, width = beats / (sm.nbars * sm.bpb) * 100, seld = c.id === view.selId;
    chips += '<div class="m-chordpos" style="left:' + left + '%;width:' + width + '%"><div class="m-chord' + (seld ? ' sel' : '') + (c.id === view.playId ? ' playing' : '') + '" data-act="chord" data-id="' + esc(c.id) + '">'
      + '<span class="m-cn">' + esc(c.chord || '?') + '</span>' + (c.roman ? '<span class="m-rm">' + esc(c.roman) + '</span>' : '')
      + '<span class="m-len">' + lenLabel(beats, sm.bpb) + '</span>'
      + (c.accent === 'stop' ? '<span class="m-acc">✋</span>' : c.accent === 'push' ? '<span class="m-acc">→</span>' : '')
      + (view.shapesOn && c.shape ? miniDiagram(c.shape) : '') + '<span class="m-shapepip" data-act="shape" data-id="' + esc(c.id) + '">◆</span>'
      + '</div></div>';
  });
  let ph = '';
  if (view.playing && view.playId) { const pc = chords.find(function (c) { return c.id === view.playId; }); if (pc) ph = '<div class="m-playhead" style="left:' + ((pc.start || 0) / (sm.nbars * sm.bpb) * 100) + '%"></div>'; }
  return '<div class="m-bars" style="grid-template-columns:repeat(' + sm.nbars + ',1fr)">' + cells + '</div><div class="m-chips-abs">' + chips + ph + '</div>';
}
function tabLaneBody(line, sm) {
  const notes = notesOf();
  // 6 string rows; one slot grid per row over the shared axis
  let rows = '';
  STR_LBL.forEach(function (sn, si) {
    let gcells = '';
    for (let gs = 0; gs < sm.totalSlots; gs++) gcells += '<button class="m-tcell' + (gs % sm.spb === 0 ? ' barstart' : '') + '" data-act="tabCell" data-si="' + si + '" data-gs="' + gs + '"></button>';
    rows += '<div class="m-trow"><span class="m-tlbl">' + sn + '</span><div class="m-tcells">' + gcells + '</div></div>';
  });
  let marks = '';
  notes.forEach(function (n) {
    const midi = noteMidi(n), si = (n.string != null ? n.string : chooseString(midi)), fret = midi - TAB_OPEN[si];
    if (fret < 0 || fret > 24) return;
    const gs = n.bar * sm.spb + n.slot, left = (gs + 0.5) / sm.totalSlots * 100, top = (si + 0.5) / 6 * 100;
    marks += '<button class="m-tmark" data-act="tabMark" data-bar="' + n.bar + '" data-slot="' + n.slot + '" style="left:' + left + '%;top:' + top + '%">' + fret + '</button>';
  });
  return '<div class="m-tgrid">' + rows + '<div class="m-tmarks">' + marks + '</div></div>';
}
function melodyLaneBody(line, sm) {
  const rows = melRows(line), notes = notesOf(), rh = 100 / rows.length;
  let rowEls = '';
  rows.forEach(function (r, ri) {
    let gcells = '';
    for (let gs = 0; gs < sm.totalSlots; gs++) gcells += '<button class="m-mcell' + (gs % sm.spb === 0 ? ' barstart' : '') + '" data-act="melCell" data-d="' + r.d + '" data-o="' + r.o + '" data-gs="' + gs + '"></button>';
    rowEls += '<div class="m-mrow" style="height:' + rh + '%"><span class="m-mlbl">' + esc(r.label) + '</span><div class="m-mcells">' + gcells + '</div></div>';
  });
  let chips = '';
  notes.forEach(function (n) {
    let ri = rows.findIndex(function (r) { return r.d === n.d && r.o === (n.o || 0); });
    const off = ri < 0; if (off) ri = (n.o || 0) >= ((UZ.state.melody && UZ.state.melody.octaves) || 2) ? 0 : rows.length - 1;
    const gs = n.bar * sm.spb + n.slot, left = gs / sm.totalSlots * 100, width = (n.len || 1) / sm.totalSlots * 100, tc = TIER[noteTier(n, line)] || TIER.scale;
    chips += '<button class="m-mnote' + (off ? ' off' : '') + '" data-act="melMark" data-bar="' + n.bar + '" data-slot="' + n.slot + '" style="left:' + left + '%;width:' + width + '%;top:' + (ri * rh) + '%;height:' + rh + '%;background:' + tc.f + ';color:' + tc.t + '">' + esc((UZ.Model && UZ.Model.spell) ? UZ.Model.spell(((noteMidi(n) % 12) + 12) % 12, UZ.state.selectedKey || 'C') : '') + '</button>';
  });
  return '<div class="m-mgrid">' + rowEls + '<div class="m-mnotes">' + chips + '</div></div>';
}
function fretKeypadSheet() {
  const fk = view.fret; if (!fk) return '';
  const lo = fk.ext ? 13 : 0, hi = fk.ext ? 24 : 12;
  let keys = '';
  for (let n = lo; n <= hi; n++) keys += '<button class="m-fk" data-act="setFret" data-f="' + n + '">' + n + '</button>';
  const body = '<div class="m-fk-grid">' + keys + '</div>'
    + '<div class="m-fk-row"><button class="m-btn" data-act="fretExt">' + (fk.ext ? '▴ Frets 0–12' : '▾ Frets 13–24') + '</button>'
    + '<button class="m-btn" data-act="fretMute">✕ Mute</button><span class="m-spacer"></span><button class="m-btn m-danger" data-act="fretDel">⌫ Remove</button></div>';
  return sheetFrame('Fret · ' + STR_LBL[fk.string] + ' string', body, '');
}
function bottomBar() {
  const tab = function (k, t) { return '<button class="m-tabbtn' + (view.lane === k && !view.pianoOpen ? ' on' : '') + '" data-act="promote" data-lane="' + k + '">' + t + '</button>'; };
  return '<div class="m-bottombar">' + tab('chords', 'Build') + tab('tab', 'Tab') + tab('melody', 'Melody')
    + '<button class="m-tabbtn' + (view.pianoOpen ? ' on' : '') + '" data-act="openPiano">Play</button>'
    + '<button class="m-tabbtn" data-act="more">More</button></div>';
}

// ── Stage 5b: piano dock + REC ──
function curChordForPiano(line) {
  if (view.playing && view.playId) { const pc = (line.chords || []).find(function (c) { return c.id === view.playId; }); if (pc) return pc; }
  return (UZ.Model && UZ.Model.chordAtBeat ? UZ.Model.chordAtBeat(line, 0) : null) || (line.chords || [])[0] || null;
}
function keyTier(pc, chordName) { if (!chordName) return 'scale'; try { return UZ.Model.gradePitch(60 + pc, chordName, pcKey(), isMinor()) || 'scale'; } catch (e) { return 'scale'; } }
function pianoDock(line) {
  const curC = curChordForPiano(line), curName = curC ? (curC.chord || curC.name) : '';
  let tones = '';
  try { (UZ.Model.chordPitchClasses(curName) || []).forEach(function (p) { tones += '<span class="m-ptone">' + esc((UZ.Model.spell ? UZ.Model.spell(p, UZ.state.selectedKey || 'C') : KEYS[p])) + '</span>'; }); } catch (e) {}
  let white = '', black = '';
  PIANO_WHITE.forEach(function (w) {
    const pc = PC[w[0]], oct = view.octave + w[1], tier = keyTier(pc, curName), tc = TIER[tier] || TIER.scale, dis = view.scaleLock && tier === 'outside';
    white += '<button class="m-pkey' + (dis ? ' dis' : '') + '" data-act="pianoKey" data-pc="' + pc + '" data-oct="' + oct + '"><span class="m-pdot" style="background:' + tc.f + '"></span><span class="m-plabel">' + w[0] + '</span></button>';
  });
  PIANO_BLACK.forEach(function (bk) {
    const pc = PC[bk[0]], oct = view.octave + bk[1], tier = keyTier(pc, curName), tc = TIER[tier] || TIER.scale, dis = view.scaleLock && tier === 'outside';
    black += '<button class="m-pkeyb' + (dis ? ' dis' : '') + '" data-act="pianoKey" data-pc="' + pc + '" data-oct="' + oct + '" style="left:' + bk[2] + '%"><span class="m-pdot" style="background:' + tc.f + '"></span></button>';
  });
  return '<div class="m-piano">'
    + '<div class="m-piano-ctl">'
    + '<button class="m-recbtn' + (view.recording ? ' on' : '') + '" data-act="toggleRec">● REC</button>'
    + '<span class="m-curchord"><b>' + esc(curName || '—') + '</b><span class="m-ptones">' + tones + '</span></span>'
    + '<span class="m-spacer"></span>'
    + '<span class="m-octctl"><button class="m-tchip" data-act="octDown">−</button><span class="m-octlbl">OCT ' + view.octave + '</span><button class="m-tchip" data-act="octUp">+</button></span>'
    + '<button class="m-tchip' + (view.scaleLock ? ' on' : '') + '" data-act="scaleLock">Scale-lock</button>'
    + '</div>'
    + '<div class="m-keys"><div class="m-keys-inner">' + white + black + '</div></div>'
    + '<div class="m-piano-ft"><span class="m-leg c">●chord</span><span class="m-leg s">●scale</span><span class="m-leg o">●out</span><span class="m-spacer"></span>'
    + '<button class="m-btn" data-act="closePiano">Close</button><button class="m-btn m-keep" data-act="keepTake">Keep take</button></div>'
    + '</div>';
}

// ── Stage 5: audio transport (reuses the desktop audio.js engine via UZ.Audio) ──
function unlockAudio() { if (audioUnlocked) return; audioUnlocked = true; try { if (UZ.Audio && UZ.Audio.initAudio) UZ.Audio.initAudio(); } catch (e) {} }
function audition(chordName) { unlockAudio(); try { if (UZ.Audio && UZ.Audio.playChord && chordName) UZ.Audio.playChord(chordName); } catch (e) {} }
function posLabel(line) { const sm = slotModel(line), b = Math.max(0, view.playBeat || 0); return (Math.floor(b / sm.bpb) + 1) + '·' + (Math.floor(b % sm.bpb) + 1); }
function startPlay() {
  unlockAudio();
  const st = UZ.state, flat = UZ.buildFlat(), bpm = st.looperBpm || 100, style = (st.looperStyle || 'pop');
  const opts = { drums: st.looperDrums, bass: st.looperBass, keys: st.looperKeys, variant: st.looperStyleVariant, infiniteLoop: view.loopOn };
  view.playing = true;
  try {
    UZ.Audio.startBackingLoop(flat, style, bpm, opts,
      function onMeasure(idx) {  // follow the section + highlight the sounding chord
        const f = flat[idx]; if (!f) return;
        if (f.lineIdx !== curIdx()) UZ.state.currentLineIndex = f.lineIdx;
        view.playId = f.id;
        const ln = lines()[f.lineIdx], ch = ((ln && ln.chords) || []).find(function (c) { return c.id === f.id; });
        view.playBeat = ch ? (ch.start || 0) : 0;
        render();
      },
      function onSchedule(idx, t0, dur) { try { if (UZ.Melody && UZ.Melody.onScheduleMeasure) UZ.Melody.onScheduleMeasure(flat[idx], t0, dur); } catch (e) {} }
    );
  } catch (e) { console.warn('[uz-mobile] play failed', e); view.playing = false; }
  render();
}
function stopPlay() { view.playing = false; view.playId = null; try { if (UZ.Audio && UZ.Audio.stopLoop) UZ.Audio.stopLoop(); } catch (e) {} render(); }

// ── Stage 6: Song view (full-screen arrange — reorder sections + chord chips, ◆ Shapes / ♪ Lyrics toggles).
//    Edits go straight to the shared state.progressionLines[] + index-keyed melody.lines so they round-trip
//    to desktop; section reorder mirrors desktop handleLineDrop's currentLineIndex fixup. Chip reorder
//    RE-PACKS starts (contiguous) — the opposite of the builder lane's ripple-outward. ──
function songScreen() {
  const st = UZ.state, ls = lines(), ci = curIdx();
  let rows = '';
  if (ls.length) ls.forEach(function (l, i) { rows += songRow(l, i, ci); });
  else rows = '<div class="m-empty">No sections yet — add one to start.</div>';
  return ''
    + '<div class="m-song">'
    + '<div class="m-song-hd">'
    + '<button class="m-song-back" data-act="closeSong">✕ Builder</button>'
    + '<span class="m-song-name">' + esc(st.songName || 'Song') + '</span>'
    + '<span class="m-spacer"></span>'
    + '<button class="m-song-tg' + (view.songShapes ? ' on' : '') + '" data-act="songShapes">◆ Shapes</button>'
    + '<button class="m-song-tg' + (view.songLyrics ? ' on' : '') + '" data-act="songLyrics">♪ Lyrics</button>'
    + '</div>'
    + '<div class="m-song-list" data-songlist="1">' + rows + '</div>'
    + '<div class="m-song-ft"><button class="m-btn m-song-add" data-act="songAddSection">＋ Add section</button></div>'
    + '</div>';
}
function songRow(line, i, ciActive) {
  const ax = axisOf(line), chords = (line.chords || []).slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
  const nch = chords.length, active = (i === ciActive), dragging = !!(songDrag && songDrag.kind === 'section' && songDrag.idx === i);
  const meta = ax.nbars + ' bar' + (ax.nbars === 1 ? '' : 's') + ' · ' + nch + ' chord' + (nch === 1 ? '' : 's');
  const wordsByChord = view.songLyrics ? songLyricWords(line) : null, wordCounter = {};
  let chips = '';
  chords.forEach(function (c) {
    const beats = c.beats || 4, rm = romanFor(c.chord), ook = !rm;
    let extra = '';
    if (view.songShapes) extra += c.shape ? '<span class="m-songdia">' + miniDiagram(c.shape) + '</span>' : '<span class="m-songdia m-songdia-none">—</span>';
    if (view.songLyrics) {
      let w = '·', has = false;
      if (wordsByChord) { const arr = wordsByChord[c.chord]; if (arr && arr.length) { const k = wordCounter[c.chord] || 0; if (k < arr.length) { w = arr[k]; has = true; } wordCounter[c.chord] = k + 1; } }
      extra += '<span class="m-songly' + (has ? ' has' : '') + '">' + esc(w) + '</span>';
    }
    chips += '<div class="m-songchip' + (ook ? ' ook' : '') + '" data-act="songChord" data-i="' + i + '" data-id="' + esc(c.id) + '" style="flex:' + beats + ' 1 0">'
      + '<span class="m-songcn">' + esc(c.chord || '?') + '</span>'
      + (rm ? '<span class="m-songrm">' + esc(rm) + '</span>' : '')
      + (ook ? '<span class="m-songbang">!</span>' : '')
      + extra
      + '</div>';
  });
  if (!nch) chips = '<span class="m-songnochords">empty section</span>';
  return '<div class="m-songrow' + (active ? ' active' : '') + (dragging ? ' dragging' : '') + '" data-songrow="1" data-i="' + i + '">'
    + '<div class="m-songrow-hd">'
    + '<span class="m-songhandle" data-act="songHandle" data-i="' + i + '">⠿</span>'
    + '<button class="m-songname" data-act="openSection" data-i="' + i + '">' + esc(line.name || ('Line ' + (i + 1))) + '</button>'
    + '<span class="m-songmeta">' + meta + '</span>'
    + '<span class="m-spacer"></span>'
    + '<button class="m-songopen" data-act="openSection" data-i="' + i + '">Edit →</button>'
    + '</div>'
    + '<div class="m-songchips" data-songchords="1" data-i="' + i + '">' + chips + '</div>'
    + '</div>';
}
// lyric words landing on each chord, from the real lyrics contract (chordMap[lyricLineIdx][wordIdx]=chordName),
// inverted to chordName→[words] in document order; section linked by case-insensitive name. Best-effort —
// stays empty until the lyrics editor (Stage 7) populates it, so it degrades to faint '·' placeholders.
function songLyricWords(line) {
  const out = {};
  try {
    const lyr = UZ.state.lyrics; if (!lyr || !lyr.sections) return out;
    const nm = (line.name || '').trim().toLowerCase(); if (!nm) return out;
    const sec = lyr.sections.find(function (s) { return (s.label || '').trim().toLowerCase() === nm; });
    if (!sec || !sec.lines) return out;
    sec.lines.forEach(function (text, li) {
      const cm = (sec.chordMap && sec.chordMap[li]) || {}, words = String(text).split(/\s+/).filter(Boolean);
      Object.keys(cm).map(Number).sort(function (a, b) { return a - b; }).forEach(function (wi) {
        const ch = cm[wi], w = words[wi]; if (ch && w) (out[ch] = out[ch] || []).push(w);
      });
    });
  } catch (e) {}
  return out;
}
// move a whole section, mirroring desktop handleLineDrop: splice progressionLines, carry the index-keyed
// melody along the same permutation, and fix up currentLineIndex so the active pointer tracks the move.
function moveSection(from, to) {
  const ls = lines(); if (from === to || to < 0 || to >= ls.length || from < 0 || from >= ls.length) return false;
  const n = ls.length, st = UZ.state;
  const m = ls.splice(from, 1)[0]; ls.splice(to, 0, m);
  try {
    const mel = st.melody && st.melody.lines;
    if (mel) {
      const order = []; for (let k = 0; k < n; k++) order.push(k);
      const mm = order.splice(from, 1)[0]; order.splice(to, 0, mm);
      const next = {}; order.forEach(function (oldIdx, newIdx) { if (mel[oldIdx] != null) next[newIdx] = mel[oldIdx]; });
      st.melody.lines = next;
    }
  } catch (e) {}
  const ci = st.currentLineIndex;
  if (ci === from) st.currentLineIndex = to;
  else if (from < ci && to >= ci) st.currentLineIndex = ci - 1;
  else if (from > ci && to <= ci) st.currentLineIndex = ci + 1;
  return true;
}
// re-pack a section's chords into a new order with contiguous starts (Song view RE-PACKS).
function moveChordInSection(secIdx, id, targetIdx) {
  const line = lines()[secIdx]; if (!line) return false;
  const sorted = (line.chords || []).slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
  const cur = sorted.findIndex(function (c) { return c.id === id; }); if (cur < 0) return false;
  targetIdx = Math.max(0, Math.min(sorted.length - 1, targetIdx)); if (targetIdx === cur) return false;
  const m = sorted.splice(cur, 1)[0]; sorted.splice(targetIdx, 0, m);
  let cursor = 0; sorted.forEach(function (c) { c.start = cursor; cursor += (c.beats || 4); });
  line.chords = sorted; return true;
}
function onSongSecDown(e, idx) { songDrag = { kind: 'section', idx: idx, moved: false }; if (e.preventDefault) e.preventDefault(); }
function onSongChordDown(e, secIdx, id) { songDrag = { kind: 'chord', secIdx: secIdx, id: id, moved: false }; if (e.stopPropagation) e.stopPropagation(); if (e.preventDefault) e.preventDefault(); }
function onSongMove(e) {
  if (!songDrag) return;
  if (songDrag.kind === 'section') {
    const rowsEls = root.querySelectorAll('[data-songrow]'); if (!rowsEls.length) return;
    let over = rowsEls.length - 1;
    for (let k = 0; k < rowsEls.length; k++) { const r = rowsEls[k].getBoundingClientRect(); if (e.clientY < r.bottom) { over = k; break; } }
    if (over !== songDrag.idx && moveSection(songDrag.idx, over)) { songDrag.idx = over; songDrag.moved = true; flush(); render(); }
  } else {
    const wrap = root.querySelector('[data-songchords][data-i="' + songDrag.secIdx + '"]'); if (!wrap) return;
    const r = wrap.getBoundingClientRect(), line = lines()[songDrag.secIdx]; if (!line) return;
    const sorted = (line.chords || []).slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); }), n = sorted.length; if (!n) return;
    const cur = sorted.findIndex(function (c) { return c.id === songDrag.id; });
    const rel = (e.clientX - r.left) / Math.max(1, r.width), target = Math.max(0, Math.min(n - 1, Math.floor(rel * n)));
    if (target !== cur && moveChordInSection(songDrag.secIdx, songDrag.id, target)) { songDrag.moved = true; flush(); render(); }
  }
  if (e.preventDefault) e.preventDefault();
}
function onSongUp() {
  if (!songDrag) return;
  const moved = songDrag.moved; songDrag = null;
  if (moved) { justDragged = true; setTimeout(function () { justDragged = false; }, 0); flush(); }
  render();
}

// ── Stage 7: Lyrics / RhymeForge (full-screen, always-dark; edits the shared state.lyrics so it round-trips
//    to desktop verbatim — same v3 schema field, same chordMap contract the Stage 6 Song-view overlay reads).
//    Free-write + [Section] parse + structured chord-over-word + chord picker + the persistent
//    /rhymeforge/?embed=1 iframe (hosted OUTSIDE #app-mobile so render()'s innerHTML wipe can't reload it). ──
const LYR_MARK = /^\s*\[([^\]]+)\]\s*$/;   // a whole line that is just [Label] — byte-identical to desktop
function ensureLyrics() { const st = UZ.state; if (!st.lyrics) st.lyrics = { freeText: '', sections: [], currentView: 'freewrite', currentTab: 'lyrics' }; return st.lyrics; }
function plName(pl, i) { return pl.name || ('Line ' + (i + 1)); }
// reproduce desktop parseFreeTextSections verbatim (regex, blank-line drop, pre-marker drop, case-insensitive name link)
function parseLyricSections(text) {
  const src = String(text || '').split('\n'), secs = []; let cur = null;
  src.forEach(function (ln) {
    const m = ln.match(LYR_MARK);
    if (m) { cur = { label: m[1].trim(), lines: [], lineIdx: -1, chordMap: {} }; secs.push(cur); }
    else if (cur && ln.trim() !== '') cur.lines.push(ln);
  });
  const pls = lines();
  secs.forEach(function (sec) {
    const idx = pls.findIndex(function (pl, i) { return plName(pl, i).toLowerCase() === sec.label.toLowerCase(); });
    if (idx >= 0) sec.lineIdx = idx;
  });
  return secs;
}
function reparseLyrics() {
  const lyr = ensureLyrics(), old = lyr.sections || [], secs = parseLyricSections(lyr.freeText);
  secs.forEach(function (sec) {  // carry chordMap over by case-insensitive label so chord placements survive a re-parse
    const prev = old.find(function (o) { return (o.label || '').toLowerCase() === sec.label.toLowerCase(); });
    if (prev && prev.chordMap) sec.chordMap = prev.chordMap;
  });
  lyr.sections = secs; lyr.currentView = 'structured'; flush();
}
function insertSectionMarker(name) {
  const lyr = ensureLyrics(), t = lyr.freeText || '';
  lyr.freeText = t + ((t && !/\n$/.test(t)) ? '\n' : '') + '[' + name + ']\n'; flush();
}
function lyrSectionChords(lineIdx) {  // unique chord names of the linked progression line, stored order (matches desktop)
  const pls = lines(); if (lineIdx < 0 || !pls[lineIdx]) return [];
  const seen = {}, out = [];
  (pls[lineIdx].chords || []).forEach(function (c) { if (c.chord && !seen[c.chord]) { seen[c.chord] = 1; out.push(c.chord); } });
  return out;
}
function lyrFreewriteBody(lyr) {
  const pls = lines();
  let chips = '<span class="m-lyr-il">Insert section:</span>';
  pls.forEach(function (pl, i) { const nm = plName(pl, i); chips += '<button class="m-lyr-secbtn" data-act="lyrInsert" data-name="' + esc(nm) + '">' + esc(nm) + '</button>'; });
  const ph = 'Write your lyrics here, then tap a section button above to insert a marker.\n\nExample:\n[Verse]\nWalking down the street today\nFeeling all the words to say\n\n[Chorus]\nThis is where the song begins';
  return '<div class="m-lyr-secbtns">' + chips + '</div>'
    + '<textarea class="m-lyr-ta" placeholder="' + esc(ph) + '">' + esc(lyr.freeText || '') + '</textarea>'
    + '<div class="m-lyr-hint">Tap a section button to drop a [Section] marker. Sections auto-link to the progression line with the matching name.</div>'
    + '<button class="m-btn m-primary m-lyr-parse" data-act="lyrParse">Parse Sections →</button>'
    + '<button class="m-lyr-howtohd" data-act="lyrHowto">' + (view.howtoOpen ? '▾' : '▸') + ' How it works</button>'
    + (view.howtoOpen ? '<ol class="m-lyr-howto"><li>Name your progression sections first (tap a section chip in the builder).</li><li>Tap a section button above to drop its [Section] marker.</li><li>Write your lyrics under each marker.</li><li>Tap <b>Parse Sections</b>, then <b>Structured / Chords</b> to place chords above the words.</li></ol>' : '');
}
function lyrStructuredBody(lyr) {
  const secs = lyr.sections || [];
  if (!secs.length) return '<div class="m-lyr-empty">No sections yet.<br>Switch to <b>Free Write</b>, add <b>[Verse]</b> / <b>[Chorus]</b> markers, then tap <b>Parse Sections</b>.</div>';
  const pls = lines(); let html = '';
  secs.forEach(function (sec, si) {
    const linked = sec.lineIdx >= 0 && pls[sec.lineIdx];
    html += '<div class="m-lyr-sec"><div class="m-lyr-sechd"><span class="m-lyr-seclbl">' + esc(sec.label) + '</span>'
      + (linked ? '<span class="m-lyr-linked">⟵ ' + esc(plName(pls[sec.lineIdx], sec.lineIdx)) + '</span>' : '<span class="m-lyr-unlinked">Not linked</span>') + '</div>';
    (sec.lines || []).forEach(function (lineText, li) {
      const lc = (sec.chordMap && sec.chordMap[li]) || {}, toks = String(lineText).split(/(\s+)/);
      let wi = 0, row = '';
      toks.forEach(function (w) {
        if (/^\s+$/.test(w)) { row += '<span class="m-lyr-stack m-lyr-sp"><span class="m-lyr-ch">&nbsp;</span><span class="m-lyr-w">' + w.replace(/ /g, '&nbsp;') + '</span></span>'; }
        else { const ch = lc[wi] || ''; row += '<span class="m-lyr-stack"><span class="m-lyr-ch' + (ch ? ' has' : '') + '">' + (ch ? esc(ch) : '&nbsp;') + '</span>'
          + '<button class="m-lyr-w' + (ch ? ' has' : '') + '" data-act="lyrPick" data-si="' + si + '" data-li="' + li + '" data-wi="' + wi + '">' + esc(w) + '</button></span>'; wi++; }
      });
      html += '<div class="m-lyr-line">' + row + '</div>';
    });
    html += '</div>';
  });
  return html;
}
function lyrPickSheet(lyr) {
  const p = view.lyrPick, sec = (lyr.sections || [])[p.si]; if (!sec) return '';
  const chords = lyrSectionChords(sec.lineIdx), cur = (sec.chordMap && sec.chordMap[p.li] && sec.chordMap[p.li][p.wi]) || '';
  let chips;
  if (!chords.length) chips = '<div class="m-lyr-pickempty">This section isn’t linked to a progression line with chords. Name the section to match a line, then add chords there.</div>';
  else chips = chords.map(function (c) { return '<button class="m-lyr-pickchip' + (c === cur ? ' on' : '') + '" data-act="lyrAssign" data-ch="' + esc(c) + '">' + esc(c) + '</button>'; }).join('');
  return '<div class="m-lyr-pscrim" data-act="lyrPickClose"></div>'
    + '<div class="m-lyr-psheet"><div class="m-grab"></div>'
    + '<div class="m-lyr-pshd"><span>Place a chord</span><button class="m-x" data-act="lyrPickClose">×</button></div>'
    + '<div class="m-lyr-pchips">' + chips + '</div>'
    + (cur ? '<div class="m-lyr-psft"><button class="m-lyr-pickrm" data-act="lyrRemove">× Remove</button></div>' : '')
    + '</div>';
}
function lyricsScreen() {
  const lyr = ensureLyrics(), tab = lyr.currentTab || 'lyrics', view2 = lyr.currentView || 'freewrite';
  let body;
  if (tab === 'rhymes') body = '<div class="m-lyr-rhymeslot"></div>';   // the persistent iframe overlays this region
  else body = '<div class="m-lyr-body">' + (view2 === 'structured' ? lyrStructuredBody(lyr) : lyrFreewriteBody(lyr)) + '</div>';
  return '<div class="m-lyr">'
    + '<div class="m-lyr-hd"><span class="m-lyr-mark">♪ RhymeForge</span><span class="m-spacer"></span><button class="m-lyr-back" data-act="closeLyrics">✕ Builder</button></div>'
    + '<div class="m-lyr-tabs">'
    + '<button class="m-lyr-tab' + (tab === 'lyrics' ? ' on' : '') + '" data-act="lyrTab" data-tab="lyrics">Lyrics</button>'
    + '<button class="m-lyr-tab' + (tab === 'rhymes' ? ' on' : '') + '" data-act="lyrTab" data-tab="rhymes">Rhymes</button>'
    + '</div>'
    + (tab === 'lyrics'
      ? '<div class="m-lyr-views"><button class="m-lyr-vw' + (view2 !== 'structured' ? ' on' : '') + '" data-act="lyrView" data-vw="freewrite">Free Write</button><button class="m-lyr-vw' + (view2 === 'structured' ? ' on' : '') + '" data-act="lyrView" data-vw="structured">Structured / Chords</button></div>'
      : '')
    + body
    + (view.lyrPick ? lyrPickSheet(lyr) : '')
    + '</div>';
}
// ── persistent RhymeForge iframe (created once, lives in document.body, toggled by display) ──
function ensureRhymeFrame() {
  if (rhymeFrame) return rhymeFrame;
  const wrap = document.createElement('div');
  wrap.id = 'uz-rhyme-frame';
  wrap.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:33;background:#08080c;display:none;';
  const f = document.createElement('iframe');
  f.src = 'rhymeforge/?embed=1';
  f.style.cssText = 'width:100%;height:100%;border:none;background:#08080c;display:block;';
  f.addEventListener('load', function () { if (rhymePending) { try { f.contentWindow.postMessage({ type: 'rhymeSearch', word: rhymePending }, '*'); } catch (e) {} } });
  wrap.appendChild(f); document.body.appendChild(wrap);
  rhymeFrame = { wrap: wrap, frame: f };
  return rhymeFrame;
}
function showRhymeFrame(word) {
  const rf = ensureRhymeFrame();
  if (word) { rhymePending = word; try { rf.frame.contentWindow.postMessage({ type: 'rhymeSearch', word: word }, '*'); } catch (e) {} }
  rf.wrap.style.display = 'block';
  const tabs = root.querySelector('.m-lyr-tabs');  // pin the frame just below the header tabs so they stay tappable
  rf.wrap.style.top = (tabs ? tabs.getBoundingClientRect().bottom : 96) + 'px';
}
function hideRhymeFrame() { if (rhymeFrame) rhymeFrame.wrap.style.display = 'none'; }

// ── Stage 8: Tools (More menu + Chord Picker, Key Finder, Progression Analysis, Show Scale).
//    Key Finder + Analysis reuse the desktop theory engines via window.UZ (findPossibleKeys /
//    analyzeProgression); Show Scale uses UZ.getScaleNotes. Chord Picker is the existing palette
//    sheet (now with a ▶ audition). Tools follow the Bright/Shadow key-mode theme. ──
const TOOLS = [
  { id: 'chordpicker', icon: '🎹', name: 'Chord Picker', desc: 'Build a chord by name and add it' },
  { id: 'keyfinder', icon: '🔍', name: 'Key Finder', desc: 'Enter chords → ranked keys' },
  { id: 'analysis', icon: '📊', name: 'Progression Analysis', desc: 'Romans, cadences, mood arc' },
  { id: 'scale', icon: '📐', name: 'Show Scale', desc: 'Scale notes over your key' },
  { id: 'arp', icon: '🎼', name: 'Arpeggiator', desc: 'Chord tones across the neck' },
  { id: 'tuner', icon: '🎯', name: 'Tuner', desc: 'Mic guitar tuner' },
];
const KF_QUALS = [['Maj', ''], ['min', 'm'], ['7', '7'], ['m7', 'm7'], ['maj7', 'maj7'], ['dim', 'dim'], ['sus4', 'sus4']];
const SCALE_TYPES = [['Major', 'major', false], ['Minor', 'minor', false], ['Pent Major', 'pentMajor', false], ['Pent Minor', 'pentMinor', false], ['Blues', 'pentMinor', true]];
function normChord(c) { return String(c || '').replace(/♭/g, 'b').replace(/♯/g, '#'); }   // for matching
function kfPreview() { return view.kf.root + view.kf.qual; }
function toolsSheet() {
  let rows = '';
  TOOLS.forEach(function (t) {
    rows += '<button class="m-toolrow" data-act="openTool" data-tool="' + t.id + '">'
      + '<span class="m-toolico">' + t.icon + '</span>'
      + '<span class="m-toolmeta"><span class="m-toolname">' + esc(t.name) + '</span><span class="m-tooldesc">' + esc(t.desc) + '</span></span>'
      + '<span class="m-toolarr">›</span></button>';
  });
  return sheetFrame('Tools', '<div class="m-toollist">' + rows + '</div>', '');
}
function toolScreen() {
  const t = view.tool;
  const title = t === 'keyfinder' ? '🔍 Key Finder' : t === 'analysis' ? '📊 Progression Analysis' : t === 'scale' ? '📐 Show Scale' : t === 'arp' ? '🎼 Arpeggiator' : t === 'tuner' ? '🎯 Tuner' : 'Tool';
  let body = '';
  if (t === 'keyfinder') body = keyFinderBody();
  else if (t === 'analysis') body = analysisBody();
  else if (t === 'scale') body = scaleBody();
  else if (t === 'arp') body = arpBody();
  else if (t === 'tuner') body = tunerBody();
  return '<div class="m-tool">'
    + '<div class="m-tool-hd"><span class="m-tool-title">' + title + '</span><span class="m-spacer"></span><button class="m-tool-back" data-act="closeTool">✕ Builder</button></div>'
    + '<div class="m-tool-body">' + body + '</div>'
    + '</div>';
}
function keyFinderBody() {
  const kf = view.kf;
  let roots = ''; KEYS.forEach(function (r) { roots += '<button class="m-kfroot' + (kf.root === r ? ' on' : '') + '" data-act="kfRoot" data-r="' + r + '">' + r + '</button>'; });
  let quals = ''; KF_QUALS.forEach(function (q) { quals += '<button class="m-kfqual' + (kf.qual === q[1] ? ' on' : '') + '" data-act="kfQual" data-q="' + q[1] + '">' + q[0] + '</button>'; });
  let chips = '';
  if (!kf.chords.length) chips = '<span class="m-kf-empty">No chords yet — add a few above.</span>';
  else kf.chords.forEach(function (c, i) { chips += '<span class="m-kfchip">' + esc(c) + '<button class="m-kfx" data-act="kfRemove" data-i="' + i + '">×</button></span>' + (i < kf.chords.length - 1 ? '<span class="m-kfsep">→</span>' : ''); });
  const res = kf.chords.length && UZ.findPossibleKeys ? UZ.findPossibleKeys(kf.chords) : [];
  const entered = {}; kf.chords.forEach(function (c) { entered[normChord(c)] = 1; });
  let results = '';
  if (kf.chords.length && !res.length) results = '<div class="m-kf-none">No common key found — try adding more chords.</div>';
  res.forEach(function (r) {
    const sel = (kf.selKey === r.key && kf.selType === r.type);
    let dia = '';
    (r.diatonic || []).forEach(function (ch, i) {
      dia += '<span class="m-kfdia' + (entered[normChord(ch)] ? ' matched' : '') + '"><span class="m-kfrm">' + esc((r.romans || [])[i] || '') + '</span>' + esc(ch) + '</span>';
    });
    results += '<div class="m-kfkey' + (sel ? ' sel' : '') + '">'
      + '<div class="m-kfkeyhd"><span class="m-kfkeyname">' + esc(r.key) + ' ' + esc(r.type) + '</span>'
      + '<button class="m-btn m-kfselbtn" data-act="kfSelect" data-key="' + esc(r.key) + '" data-type="' + esc(r.type) + '">' + (sel ? '✓ Selected' : 'Select') + '</button></div>'
      + '<div class="m-kfdias">' + dia + '</div></div>';
  });
  return '<div class="m-pick-lbl">ROOT</div><div class="m-kfroots">' + roots + '</div>'
    + '<div class="m-pick-lbl">QUALITY</div><div class="m-kfquals">' + quals + '</div>'
    + '<div class="m-kf-addrow"><span class="m-kf-prev">' + esc(kfPreview()) + '</span><button class="m-btn m-primary" data-act="kfAdd">+ Add</button></div>'
    + '<div class="m-kfchips">' + chips + '</div>'
    + '<div class="m-pick-lbl">POSSIBLE KEYS</div>' + (results || '<div class="m-kf-none">Add chords to see ranked keys.</div>')
    + '<div class="m-kf-foot"><button class="m-btn" data-act="kfClear">Clear</button><span class="m-spacer"></span><button class="m-btn m-primary" data-act="kfUse">Use This Key</button></div>';
}
function analysisBody() {
  const line = curLine(), chords = (line.chords || []).slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
  const a = UZ.analyzeProgression ? UZ.analyzeProgression(chords, isMinor()) : null;
  if (!a || a.isEmpty) return '<div class="m-an-empty">' + esc((a && a.reason) || 'Add at least 2 chords to analyse.') + '</div>';
  const TC = ['#6fcf86', '#9ccc65', '#e8b84a', '#e8975a', '#df7d6f'];
  let arc = '';
  (a.moodArc.tensions || []).forEach(function (tn, i) {
    const cls = (a.moodArc.classifications || [])[i];
    const col = cls === 'outside' ? '#b06a64' : (TC[Math.max(0, Math.min(4, (tn | 0) - 1))] || '#9ccc65');
    arc += '<span class="m-an-bar" style="height:' + (16 + (tn | 0) * 12) + 'px;background:' + col + '"></span>';
  });
  let html = '<div class="m-an-key">' + esc(UZ.state.selectedKey || 'C') + (isMinor() ? ' minor' : ' major') + '</div>';
  if (a.moodArc.character) html += '<div class="m-an-char">' + esc(a.moodArc.character) + '</div>';
  html += '<div class="m-an-roman">' + (a.chordRomans || []).map(function (r) { return esc(r || '?'); }).join('  –  ') + '</div>';
  if (arc) html += '<div class="m-an-arc">' + arc + '</div>';
  if (a.moodArc.narrative) html += '<div class="m-an-narr">' + esc(a.moodArc.narrative) + '</div>';
  if ((a.outsideChords || []).length) html += '<div class="m-an-sec"><div class="m-an-lbl">OUTSIDE THE KEY</div><div class="m-an-pills">' + a.outsideChords.map(function (o) { return '<span class="m-an-pill out">' + esc(o.chord) + '</span>'; }).join('') + '</div></div>';
  if ((a.cadences || []).length) html += '<div class="m-an-sec"><div class="m-an-lbl">CADENCES</div>' + a.cadences.map(function (c) { return '<div class="m-an-row"><b>' + esc(c.name) + '</b>' + (c.tip ? '<div class="m-an-tip">' + esc(c.tip) + '</div>' : '') + '</div>'; }).join('') + '</div>';
  if ((a.transitions || []).length) html += '<div class="m-an-sec"><div class="m-an-lbl">TRANSITIONS</div>' + a.transitions.map(function (t) { return '<div class="m-an-row"><b>' + esc(t.from) + ' → ' + esc(t.to) + '</b>' + (t.strength ? '<span class="m-an-strength">' + esc(t.strength) + '</span>' : '') + (t.explanation ? '<div class="m-an-tip">' + esc(t.explanation) + '</div>' : '') + (t.voiceLead ? '<div class="m-an-vl">🎵 ' + esc(t.voiceLead) + '</div>' : '') + '</div>'; }).join('') + '</div>';
  if ((a.substitutions || []).length) html += '<div class="m-an-sec"><div class="m-an-lbl">TRY INSTEAD</div>' + a.substitutions.map(function (s) { return '<div class="m-an-row"><b>' + esc(s.chord) + '</b> <small>(' + esc(s.roman) + ')</small>: ' + (s.alternatives || []).map(esc).join(', ') + '</div>'; }).join('') + '</div>';
  return html;
}
function scaleBody() {
  const key = UZ.state.selectedKey || 'C', sc = view.scale;
  let chips = '';
  SCALE_TYPES.forEach(function (s) { const on = (sc.type === s[1] && sc.blues === s[2]); chips += '<button class="m-sc-chip' + (on ? ' on' : '') + '" data-act="scaleType" data-t="' + s[1] + '" data-b="' + (s[2] ? 1 : 0) + '">' + s[0] + '</button>'; });
  const notes = UZ.getScaleNotes ? (UZ.getScaleNotes(key, sc.type, sc.blues) || []) : [];
  const line = curLine(), curC = curChordForPiano(line), curName = curC ? (curC.chord || curC.name) : '';
  const tonePcs = {}; try { (UZ.Model.chordPitchClasses(curName) || []).forEach(function (p) { tonePcs[p] = 1; }); } catch (e) {}
  let tiles = '';
  notes.forEach(function (n) {
    let pc = null; try { pc = UZ.Model.PC[normChord(n.note)]; } catch (e) {}
    const chordTone = pc != null && tonePcs[pc];
    tiles += '<div class="m-sc-tile' + (chordTone ? ' chord' : '') + (n.isBlue ? ' blue' : '') + '"><span class="m-sc-note">' + esc(n.note) + '</span><span class="m-sc-deg">' + esc(String(n.degree)) + '</span></div>';
  });
  const label = (SCALE_TYPES.filter(function (s) { return s[1] === sc.type && s[2] === sc.blues; })[0] || [sc.type])[0];
  return '<div class="m-sc-chips">' + chips + '</div>'
    + '<div class="m-sc-head">' + esc(key) + ' ' + esc(label) + (curName ? ' <small>over ' + esc(curName) + '</small>' : '') + '</div>'
    + '<div class="m-sc-tiles">' + tiles + '</div>'
    + '<div class="m-sc-legend"><span class="m-sc-leg chord">● chord tone</span><span class="m-sc-leg scale">● scale tone</span></div>';
}
// Arpeggiator — fretboard VISUALIZER (not a sequencer): root×quality → chord tones across a 15-fret
// neck (degree-labelled, NOTE_COLORS-tinted) + ▶ audition. Reuses UZ.Audio.getChordTones/playChord.
const ARP_QUALS = [['Maj', ''], ['Min', 'm'], ['7', '7'], ['m7', 'm7'], ['maj7', 'maj7'], ['6', '6'], ['m6', 'm6'], ['9', '9'], ['add9', 'add9'], ['dim', 'dim'], ['aug', 'aug'], ['sus2', 'sus2'], ['sus4', 'sus4']];
const ARP_DEG = { 0: 'R', 1: '♭2', 2: '2', 3: '♭3', 4: '3', 5: '4', 6: '♭5', 7: '5', 8: '♯5', 9: '6', 10: '♭7', 11: '7' };
function arpName() { return view.arp.root + view.arp.qual; }
function arpTones() { try { return UZ.Audio.getChordTones(view.arp.root, view.arp.qual) || []; } catch (e) { return []; } }
function arpToneMap(tones) {
  const map = {}, rootPc = (UZ.Model && UZ.Model.PC[view.arp.root]) || 0;
  tones.forEach(function (t) {
    const iv = ((t.interval || 0) % 12 + 12) % 12, pc = (rootPc + iv) % 12;
    map[pc] = { deg: ARP_DEG[iv] || '', color: (UZ.Data && UZ.Data.NOTE_COLORS && UZ.Data.NOTE_COLORS[t.note]) || '#888', root: iv === 0 };
  });
  return map;
}
function arpBody() {
  const arp = view.arp, FRETS = 15, MARK = { 3: 1, 5: 1, 7: 1, 9: 1, 12: 1, 15: 1 };
  let roots = ''; KEYS.forEach(function (r) { roots += '<button class="m-arproot' + (arp.root === r ? ' on' : '') + '" data-act="arpRoot" data-r="' + r + '">' + r + '</button>'; });
  let quals = ''; ARP_QUALS.forEach(function (q) { quals += '<button class="m-arpqual' + (arp.qual === q[1] ? ' on' : '') + '" data-act="arpQual" data-q="' + q[1] + '">' + q[0] + '</button>'; });
  const tones = arpTones(), map = arpToneMap(tones);
  let chips = '';
  tones.forEach(function (t) { const iv = ((t.interval || 0) % 12 + 12) % 12; chips += '<span class="m-arpchip" style="background:' + ((UZ.Data && UZ.Data.NOTE_COLORS && UZ.Data.NOTE_COLORS[t.note]) || '#888') + '">' + esc(t.note) + '<small>' + (ARP_DEG[iv] || '') + '</small></span>'; });
  let head = '<div class="m-arp-row m-arp-head"><span class="m-arp-slbl"></span>';
  for (let f = 0; f <= FRETS; f++) head += '<span class="m-arp-fnum' + (MARK[f] ? ' mk' : '') + '">' + f + '</span>';
  head += '</div>';
  let rows = '';
  STR_LBL.forEach(function (sn, si) {
    let cells = '';
    for (let f = 0; f <= FRETS; f++) {
      const pc = (((TAB_OPEN[si] + f) % 12) + 12) % 12, m = map[pc];
      cells += '<span class="m-arp-cell' + (MARK[f] ? ' mk' : '') + '">' + (m ? '<span class="m-arp-dot' + (m.root ? ' root' : '') + '" style="background:' + m.color + '">' + esc(m.deg) + '</span>' : '') + '</span>';
    }
    rows += '<div class="m-arp-row"><span class="m-arp-slbl">' + sn + '</span>' + cells + '</div>';
  });
  return '<div class="m-pick-lbl">ROOT</div><div class="m-arproots">' + roots + '</div>'
    + '<div class="m-pick-lbl">TYPE</div><div class="m-arpquals">' + quals + '</div>'
    + '<div class="m-arp-result"><span class="m-arp-name">' + esc(arpName()) + '</span><div class="m-arp-chips">' + chips + '</div><button class="m-btn m-primary m-arp-play" data-act="arpPlay">▶ Play</button></div>'
    + '<div class="m-pick-lbl">NECK</div><div class="m-arp-neck">' + head + rows + '</div>';
}

// ── Tuner (mic pitch detection) — DSP ported verbatim from desktop app.js (YIN/CMND + One-Euro
//    smoothing + median/voiced/hold gating + auto nearest-string with lock). Standard tuning.
//    DEVICE-GATED (getUserMedia) — cannot be verified headlessly. The rAF loop drives the DOM
//    directly (never render()) so the readout doesn't rebuild 60×/s. ──
const TUN_SEMI = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function tunFreq(note, oct) { return 440 * Math.pow(2, ((oct + 1) * 12 + TUN_SEMI[note] - 69) / 12); }
const TUN_TARGETS = [['E', 2], ['A', 2], ['D', 3], ['G', 3], ['B', 3], ['E', 4]].map(function (s) { return { note: s[0], oct: s[1], freq: tunFreq(s[0], s[1]) }; });
const TUN_IN_TUNE = 3, TUN_CLOSE = 10, TUN_REF = 55, TUN_FILTER_BUF = 12, TUN_CONF_START = 0.35, TUN_CONF_SUSTAIN = 0.12, TUN_HOLD = 55, TUN_LOCK = 10;
let tunCtx = null, tunAnalyser = null, tunStream = null, tunRAF = null, tunBuf = null, tunActive = false, tunErr = null;
let tFreqBuf = [], tVoiced = false, tHold = 0, tLastGood = null, tLockedStr = null, tLockCtr = 0, tFiltX = null, tFiltDx = 0, tFiltT = null;
function tunFreqToCents(f) { return 1200 * Math.log2(f / TUN_REF); }
function tunCentsToFreq(c) { return TUN_REF * Math.pow(2, c / 1200); }
function tunOneEuro(x, t) {  // one-euro filter in the cents domain (minCutoff 0.9, beta 0.012, dCutoff 1.0)
  if (tFiltT === null) { tFiltT = t; tFiltX = x; tFiltDx = 0; return x; }
  let dt = (t - tFiltT) / 1000; if (dt <= 0 || dt > 0.25) dt = 1 / 60;
  const a = function (cut) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); };
  const dx = (x - tFiltX) / dt, aD = a(1.0), dxHat = aD * dx + (1 - aD) * tFiltDx;
  const al = a(0.9 + 0.012 * Math.abs(dxHat)), xHat = al * x + (1 - al) * tFiltX;
  tFiltX = xHat; tFiltDx = dxHat; tFiltT = t; return xHat;
}
function tunDetect(buf, sr) {
  let rms = 0; for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]; rms = Math.sqrt(rms / buf.length);
  if (rms < 0.0009) return null;
  const n = Math.floor(buf.length / 2), diff = new Float32Array(n);
  for (let tau = 0; tau < n; tau++) { let s = 0; for (let i = 0; i < n; i++) { const d = buf[i] - buf[i + tau]; s += d * d; } diff[tau] = s; }
  const cmnd = new Float32Array(n); cmnd[0] = 1; let run = 0;
  for (let tau = 1; tau < n; tau++) { run += diff[tau]; cmnd[tau] = run > 0 ? (diff[tau] * tau / run) : 1; }
  const minTau = Math.max(2, Math.floor(sr / 500)), maxTau = Math.min(n - 2, Math.floor(sr / 55));
  let best = -1;
  for (let tau = minTau; tau < maxTau; tau++) { if (cmnd[tau] < 0.15) { while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) tau++; best = tau; break; } }
  if (best < 0) { for (let tau = minTau; tau < maxTau; tau++) { if (cmnd[tau] < 0.35) { while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) tau++; best = tau; break; } } }
  if (best < 1) return null;
  const prev = cmnd[best - 1], cur = cmnd[best], next = (best + 1 < n) ? cmnd[best + 1] : cur, den = 2 * cur - prev - next; let rt = best;
  if (Math.abs(den) > 0.0001) { const sh = (prev - next) / (2 * den); if (isFinite(sh) && Math.abs(sh) < 1) rt = best + sh; }
  let freq = sr / rt; if (freq < 55 || freq > 500) return null;
  let cF = Infinity, cH = Infinity;
  TUN_TARGETS.forEach(function (s) { const c1 = Math.abs(1200 * Math.log2(freq / s.freq)), c2 = Math.abs(1200 * Math.log2((freq / 2) / s.freq)); if (c1 < cF) cF = c1; if (c2 < cH) cH = c2; });
  const dTau = Math.round(rt * 2);
  if (cH < cF - 150 && dTau < n - 1 && cmnd[dTau] < 0.4 && (freq / 2) >= 55) freq = freq / 2;
  return { freq: freq, confidence: 1 - Math.min(1, cmnd[best]) };
}
function tunResolve(freq) {
  let idx = 0, cents = Infinity;
  for (let i = 0; i < TUN_TARGETS.length; i++) { const c = 1200 * Math.log2(freq / TUN_TARGETS[i].freq); if (Math.abs(c) < Math.abs(cents)) { cents = c; idx = i; } }
  if (tLockedStr === null) { tLockedStr = idx; tLockCtr = 0; }
  else if (idx !== tLockedStr) { if (Math.abs(cents) < 200) tLockCtr++; if (tLockCtr >= TUN_LOCK) { tLockedStr = idx; tLockCtr = 0; } else { idx = tLockedStr; cents = 1200 * Math.log2(freq / TUN_TARGETS[tLockedStr].freq); } }
  else tLockCtr = 0;
  return { idx: idx, cents: cents };
}
function tunColor(cents) { const a = Math.abs(cents); return a <= TUN_IN_TUNE ? '#4caf50' : a <= TUN_CLOSE ? '#c8a04a' : '#e53935'; }
function tunUpdateUI(freq) {
  const r = tunResolve(freq), tgt = TUN_TARGETS[r.idx], cents = r.cents; if (Math.abs(cents) > 300) return;
  const col = tunColor(cents), inTune = Math.abs(cents) <= TUN_IN_TUNE, shown = Math.round(cents);
  const note = root.querySelector('.m-tun-note'); if (note) { note.innerHTML = esc(tgt.note) + '<small>' + tgt.oct + '</small>'; note.style.color = col; }
  const ce = root.querySelector('.m-tun-cents'); if (ce) { ce.textContent = (shown > 0 ? '+' : '') + shown + '¢'; ce.style.color = col; }
  const stx = root.querySelector('.m-tun-status'); if (stx) { stx.textContent = inTune ? 'In tune ✓' : (cents < 0 ? 'Flat — tune up ↑' : 'Sharp — tune down ↓'); stx.style.color = col; }
  const ndl = root.querySelector('.m-tun-needle'); if (ndl) { ndl.style.left = Math.max(0, Math.min(100, 50 + (Math.max(-50, Math.min(50, cents)) / 50) * 50)) + '%'; ndl.style.background = col; }
  const det = root.querySelector('.m-tun-det'); if (det) det.textContent = 'Detected ' + freq.toFixed(1) + ' Hz · target ' + tgt.freq.toFixed(1) + ' Hz';
  root.querySelectorAll('.m-tun-str').forEach(function (b) { b.classList.toggle('on', +b.dataset.i === r.idx); });
}
function tunDecayUI() { const stx = root.querySelector('.m-tun-status'); if (stx && tunActive) { stx.textContent = 'Listening — pluck a string'; stx.style.color = 'var(--muted)'; } }
function tunFrame(now) {
  tunRAF = requestAnimationFrame(tunFrame);
  if (!tunAnalyser || !tunBuf) return;
  tunAnalyser.getFloatTimeDomainData(tunBuf);
  let rms = 0; for (let i = 0; i < tunBuf.length; i++) rms += tunBuf[i] * tunBuf[i]; rms = Math.sqrt(rms / tunBuf.length);
  const bar = root.querySelector('.m-tun-levelbar'); if (bar) bar.style.width = Math.min(100, Math.sqrt(rms) * 170) + '%';
  const res = tunDetect(tunBuf, tunCtx.sampleRate), conf = res ? res.confidence : 0, thr = tVoiced ? TUN_CONF_SUSTAIN : TUN_CONF_START;
  if (res && conf > thr) {
    tFreqBuf.push(res.freq); if (tFreqBuf.length > TUN_FILTER_BUF) tFreqBuf.shift();
    const sorted = tFreqBuf.slice().sort(function (a, b) { return a - b; }), med = sorted[Math.floor(sorted.length / 2)];
    if ((tFreqBuf.length < 3) || Math.abs(1200 * Math.log2(res.freq / med)) < 120) { tVoiced = true; tHold = TUN_HOLD; tLastGood = res.freq; tunUpdateUI(tunCentsToFreq(tunOneEuro(tunFreqToCents(res.freq), now))); }
  } else if (tVoiced && tHold > 0) { tHold--; if (tLastGood) tunUpdateUI(tunCentsToFreq(tunOneEuro(tunFreqToCents(tLastGood), now))); if (tHold === 0) { tVoiced = false; tFreqBuf = []; } }
  else { tVoiced = false; tunDecayUI(); }
}
async function startTuner() {
  tunErr = null;
  try {
    tunCtx = new (window.AudioContext || window.webkitAudioContext)();
    tunStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const src = tunCtx.createMediaStreamSource(tunStream);
    tunAnalyser = tunCtx.createAnalyser(); tunAnalyser.fftSize = 8192; tunAnalyser.smoothingTimeConstant = 0;
    src.connect(tunAnalyser); tunBuf = new Float32Array(tunAnalyser.fftSize);
    tFreqBuf = []; tVoiced = false; tHold = 0; tLastGood = null; tLockedStr = null; tLockCtr = 0; tFiltX = null; tFiltDx = 0; tFiltT = null;
    tunActive = true; render();
    tunRAF = requestAnimationFrame(tunFrame);
  } catch (e) { tunErr = 'Could not access the microphone. Please allow mic permission and try again.'; tunActive = false; console.warn('[uz-mobile] tuner mic', e); render(); }
}
function stopTuner() {
  try { if (tunRAF) { cancelAnimationFrame(tunRAF); tunRAF = null; } if (tunStream) { tunStream.getTracks().forEach(function (t) { t.stop(); }); tunStream = null; } if (tunCtx && tunCtx.state !== 'closed') tunCtx.close().catch(function () {}); } catch (e) {}
  tunCtx = null; tunAnalyser = null; tunBuf = null; tunActive = false;
}
function tunerBody() {
  let strs = ''; TUN_TARGETS.forEach(function (s, i) { strs += '<button class="m-tun-str" data-act="tunStr" data-i="' + i + '">' + esc(s.note) + '<small>' + s.oct + '</small></button>'; });
  return '<div class="m-tun">'
    + (tunErr ? '<div class="m-tun-err">' + esc(tunErr) + '</div>' : '')
    + '<div class="m-tun-readout"><span class="m-tun-note">—</span><span class="m-tun-cents">0¢</span></div>'
    + '<div class="m-tun-meter"><span class="m-tun-zone"></span><span class="m-tun-mid"></span><span class="m-tun-needle"></span></div>'
    + '<div class="m-tun-scale"><span>♭ flat</span><span class="m-spacer"></span><span>sharp ♯</span></div>'
    + '<div class="m-tun-status">' + (tunActive ? 'Listening — pluck a string' : 'Tap Start and allow the mic') + '</div>'
    + '<div class="m-tun-det"></div>'
    + '<div class="m-tun-level"><span class="m-tun-levelbar"></span></div>'
    + '<div class="m-tun-strings">' + strs + '</div>'
    + '<button class="m-btn ' + (tunActive ? 'm-danger' : 'm-primary') + ' m-tun-toggle" data-act="tunToggle">' + (tunActive ? '■ Stop' : '🎤 Start Tuning') + '</button>'
    + '<div class="m-tun-foot">Standard tuning · auto-detects the nearest string. The mic stays on your device.</div>'
    + '</div>';
}

// ── render ──
function render() {
  const st = UZ.state, minor = isMinor();
  if (tunActive && view.tool !== 'tuner') stopTuner();   // release the mic when navigating away from the Tuner
  root.className = minor ? 'uz-shadow' : 'uz-bright';
  const ls = lines(), ci = curIdx(), line = ls[ci] || { chords: [] };
  if (view.lyrics) {
    root.innerHTML = lyricsScreen(); bind();
    if ((ensureLyrics().currentTab || 'lyrics') === 'rhymes') showRhymeFrame(); else hideRhymeFrame();
    return;
  }
  hideRhymeFrame();
  if (view.song) { root.innerHTML = songScreen(); bind(); return; }
  if (view.tool) { root.innerHTML = toolScreen(); bind(); return; }
  const ax = axisOf(line);

  let html = ''
    + '<div class="m-topbar">'
    + '  <span class="m-mark">🍋</span>'
    + '  <span class="m-title">' + esc(st.songName || 'Untitled Song') + '</span>'
    + '  <button class="m-keypill" data-act="cycleKey">' + esc(st.selectedKey || 'C') + ' <span class="m-mode" data-act="toggleMode">' + (minor ? 'min' : 'maj') + '</span> ▾</button>'
    + '  <button class="m-songbtn" data-act="openSong">▦ Song</button>'
    + '  <button class="m-songbtn m-lyrbtn" data-act="openLyrics">✎ Lyrics</button>'
    + '</div>';

  // section chips
  html += '<div class="m-sections">';
  ls.forEach(function (l, i) { html += '<button class="m-chip' + (i === ci ? ' active' : '') + '" data-act="section" data-i="' + i + '">' + esc(l.name || ('Line ' + (i + 1))) + '</button>'; });
  html += '<button class="m-chip m-add" data-act="addSection">＋</button></div>';

  // lane toolbar — controls for the active lane
  const sm = slotModel(line);
  html += '<div class="m-lanebar">'
    + '<span class="m-lanetag">' + (view.lane === 'chords' ? 'Chords' : view.lane === 'tab' ? 'Tab' : 'Melody') + '</span>'
    + '<button class="m-metchip" data-act="cycleMeter" title="time signature">' + METER_LABEL[sm.bpb] + '</button>'
    + '<span class="m-spacer"></span>'
    + (view.lane === 'chords'
      ? '<button class="m-metchip' + (view.shapesOn ? ' on' : '') + '" data-act="toggleShapes">◆ Shapes</button><button class="m-btn m-addchord" data-act="openPalette">＋ Chord</button>'
      : '<span class="m-lanehint">tap the grid to add notes</span>')
    + '</div>';

  // canvas: the fixed-order Chords / Tab / Melody accordion on ONE shared bar ruler
  html += '<div class="m-accordion">'
    + laneBlock('chords', line, sm) + laneBlock('tab', line, sm) + laneBlock('melody', line, sm)
    + '</div>';

  // transport bar (or piano dock when open) + bottom lane tab bar
  if (view.pianoOpen) {
    html += pianoDock(line);
  } else {
    html += '<div class="m-transport">'
      + '<button class="m-play' + (view.playing ? ' on' : '') + '" data-act="togglePlay">' + (view.playing ? '■ Stop' : '▶ Loop') + '</button>'
      + '<button class="m-tchip' + (view.loopOn ? ' on' : '') + '" data-act="toggleLoop" title="loop">⟳</button>'
      + '<span class="m-bpmctl"><button class="m-tchip" data-act="bpmDown">−</button><b>' + (st.looperBpm || 100) + '</b><button class="m-tchip" data-act="bpmUp">+</button></span>'
      + '<span class="m-spacer"></span>'
      + '<span class="m-pos">' + (view.playing ? posLabel(line) : (st.looperStyle || 'pop')) + '</span>'
      + '</div>';
  }
  html += bottomBar();

  // sheets
  if (view.sheet === 'editor') html += editorSheet(line);
  else if (view.sheet === 'palette') html += paletteSheet();
  else if (view.sheet === 'shape') html += shapeSheet();
  else if (view.sheet === 'fret') html += fretKeypadSheet();
  else if (view.sheet === 'tools') html += toolsSheet();

  root.innerHTML = html;
  bind();
}

function sheetFrame(title, bodyHtml, footHtml) {
  return '<div class="m-scrim" data-act="closeSheet"></div>'
    + '<div class="m-sheet">'
    + '<div class="m-grab"></div>'
    + '<div class="m-sheet-hd"><span class="m-sheet-title">' + title + '</span><button class="m-x" data-act="closeSheet">×</button></div>'
    + '<div class="m-sheet-body">' + bodyHtml + '</div>'
    + (footHtml ? '<div class="m-sheet-ft">' + footHtml + '</div>' : '')
    + '</div>';
}

function editorSheet(line) {
  const c = (line.chords || []).find(function (x) { return x.id === view.selId; });
  if (!c) return '';
  const bpb = bpbOf(line), beats = c.beats || 4, acc = c.accent || 'norm';
  const seg = function (b, t) { return '<button class="m-seg' + (beats === b ? ' on' : '') + '" data-act="setLen" data-beats="' + b + '">' + t + '</button>'; };
  const accBtn = function (a, t) { return '<button class="m-seg' + (acc === a ? ' on' : '') + '" data-act="setAccent" data-acc="' + a + '">' + t + '</button>'; };
  const body = ''
    + '<div class="m-ed-name"><span class="m-cn">' + esc(c.chord) + '</span>' + (c.roman ? '<span class="m-rm">' + esc(c.roman) + '</span>' : '') + '</div>'
    + '<div class="m-ed-row"><span class="m-ed-lbl">Length</span><div class="m-seg-group">' + seg(bpb / 2, '½') + seg(bpb, '1 bar') + seg(bpb * 2, '2 bars') + '</div></div>'
    + '<div class="m-ed-row"><span class="m-ed-lbl">Start</span><div class="m-nudge"><button class="m-seg" data-act="nudgeStart" data-d="-0.5">‹</button><span class="m-nudval">beat ' + ((c.start || 0) + 1) + '</span><button class="m-seg" data-act="nudgeStart" data-d="0.5">›</button></div></div>'
    + '<div class="m-ed-row"><span class="m-ed-lbl">Accent</span><div class="m-seg-group">' + accBtn('norm', 'Normal') + accBtn('stop', '✋ Stop') + accBtn('push', '→ Push') + '</div></div>';
  const foot = '<button class="m-btn" data-act="dupChord">＋ Duplicate</button><span class="m-spacer"></span><button class="m-btn m-danger" data-act="removeChord">× Remove</button>';
  return sheetFrame('Chord', body, foot);
}

function paletteSheet() {
  const result = pickerName(), rm = romanFor(result);
  let roots = '';
  KEYS.forEach(function (r) { roots += '<button class="m-pk' + (view.pick.root === r ? ' on' : '') + '" data-act="pickRoot" data-r="' + r + '">' + r + '</button>'; });
  let quals = ''; QUALS.forEach(function (q, i) { quals += '<button class="m-pill' + (view.pick.qual === i ? ' on' : '') + '" data-act="pickQual" data-i="' + i + '">' + q.label + '</button>'; });
  let exts = ''; EXTS.forEach(function (e, i) { exts += '<button class="m-pill' + (view.pick.ext === i ? ' on' : '') + '" data-act="pickExt" data-i="' + i + '">' + e.label + '</button>'; });
  const body = ''
    + '<div class="m-pick">'
    + '  <div class="m-pick-roots"><div class="m-pick-lbl">ROOT</div><div class="m-root-grid">' + roots + '</div></div>'
    + '  <div class="m-pick-qe"><div class="m-pick-lbl">TYPE</div><div class="m-pillrow">' + quals + '</div>'
    + '    <div class="m-pick-lbl">EXTENSIONS</div><div class="m-pillrow">' + exts + '</div></div>'
    + '</div>';
  const foot = '<span class="m-ed-lbl">Result</span><span class="m-pick-result">' + esc(result) + (rm ? ' <small>' + esc(rm) + '</small>' : '') + '</span><span class="m-spacer"></span>'
    + '<button class="m-btn" data-act="auditionPicked">▶</button><button class="m-btn m-primary" data-act="addPicked">Add</button>';
  return sheetFrame('🎹 Chord Picker', body, foot);
}

// ── add a chord (it={chord,roman}); at=beat or null=append; matches prototype addChord ──
function addChordAt(it, at) {
  const line = curLine(), ax = axisOf(line), T = ax.axis;
  let start, beats;
  if (at != null) {
    start = at;
    const after = (line.chords || []).filter(function (x) { return (x.start || 0) > start; });
    const next = after.length ? Math.min.apply(null, after.map(function (x) { return x.start || 0; })) : T;
    beats = Math.min(ax.bpb, Math.max(ax.bpb / 2, next - start));
  } else {
    let end = 0; (line.chords || []).forEach(function (x) { end = Math.max(end, (x.start || 0) + x.beats); });
    start = end; beats = Math.min(ax.bpb, Math.max(ax.bpb, T - end)) || ax.bpb;
  }
  (line.chords = line.chords || []).push({ chord: it.chord, roman: it.roman || '', id: uid(), active: false, beats: beats, accent: 'norm', start: start });
  flush();
}

// ── drag (ripple-outward) ──
function onDragDown(e, id) {
  if (e.target.closest('.m-shapepip')) return;   // the ◆ pip opens the shape editor, not a drag
  const lane = root.querySelector('.m-chips-abs'); if (!lane) return;
  const c = (curLine().chords || []).find(function (x) { return x.id === id; }); if (!c) return;
  const ax = axisOf(curLine());
  drag = { id: id, startX: e.clientX, orig: c.start || 0, moved: false, beatPx: lane.getBoundingClientRect().width / ax.axis };
  if (e.preventDefault) e.preventDefault();
}
function onDragMove(e) {
  if (songDrag) { onSongMove(e); return; }
  if (!drag) return;
  const dxBeats = (e.clientX - drag.startX) / (drag.beatPx || 10);
  if (Math.abs(e.clientX - drag.startX) > 4) drag.moved = true;
  if (!drag.moved) return;
  const me = (curLine().chords || []).find(function (x) { return x.id === drag.id; }); if (!me) return;
  me.start = Math.max(0, snap05(drag.orig + dxBeats));   // no upper clamp → grow into new bars
  rippleOutward(curLine().chords, drag.id);
  render();
}
function onDragUp() {
  if (songDrag) { onSongUp(); return; }
  if (!drag) return;
  const d = drag; drag = null;
  if (!d.moved) {  // tap = audition + select + edit
    const c = (curLine().chords || []).find(function (x) { return x.id === d.id; });
    if (c) audition(c.chord);
    view.selId = d.id; view.sheet = 'editor'; render();
  } else { flush(); }
}

// ── delegated events ──
function bind() {
  // pointerdown starts a drag on a chord (so a press-and-drag ripples; a tap opens the editor)
  root.querySelectorAll('.m-chord[data-act="chord"]').forEach(function (el) {
    el.addEventListener('pointerdown', function (e) { onDragDown(e, el.dataset.id); });
  });
  // Stage 6: song-view drag handles (sections) + chord chips
  root.querySelectorAll('.m-songhandle').forEach(function (el) {
    el.addEventListener('pointerdown', function (e) { onSongSecDown(e, +el.dataset.i); });
  });
  root.querySelectorAll('.m-songchip[data-id]').forEach(function (el) {
    el.addEventListener('pointerdown', function (e) { onSongChordDown(e, +el.dataset.i, el.dataset.id); });
  });
  // Stage 7: lyrics free-write textarea — debounced save, NO re-render (preserves focus/caret)
  const lyrTa = root.querySelector('.m-lyr-ta');
  if (lyrTa) lyrTa.addEventListener('input', function (e) { ensureLyrics().freeText = e.target.value; save(); });
  root.onclick = function (e) {
    const t = e.target.closest('[data-act]'); if (!t) return;
    if (justDragged) { justDragged = false; return; }   // swallow the click synthesized by a drag release
    const act = t.dataset.act, st = UZ.state, line = curLine();
    switch (act) {
      case 'toggleMode': e.stopPropagation(); st.selectedTab = isMinor() ? 'standard' : 'dark'; save(); render(); break;
      case 'cycleKey': { const i = KEYS.indexOf(st.selectedKey || 'C'); st.selectedKey = st.progressionKey = KEYS[(i + 1) % KEYS.length]; save(); render(); break; }
      case 'section': st.currentLineIndex = +t.dataset.i; view.selId = null; view.sheet = null; save(); render(); break;
      case 'addSection': (st.progressionLines = st.progressionLines || []).push({ chords: [], repeats: 1, tab: [], showTab: false, bpb: 4, viewMode: 'stacked' }); st.currentLineIndex = st.progressionLines.length - 1; flush(); render(); break;
      case 'cycleMeter': { const i = METERS.indexOf(bpbOf(line)); line.bpb = METERS[(i + 1) % METERS.length]; flush(); render(); break; }
      case 'chord': /* handled by pointerdown/up (tap→editor) */ break;
      case 'insertAt': if (drag) break; view.addAt = +t.dataset.beat; view.sheet = 'palette'; render(); break;
      case 'openPalette': view.addAt = null; view.sheet = 'palette'; render(); break;
      case 'closeSheet': view.sheet = null; view.selId = null; view.addAt = null; view.sh = null; view.fret = null; render(); break;
      // Stage 4: lane accordion + tab/melody editing
      case 'promote': view.lane = t.dataset.lane; view.selId = null; view.sheet = null; render(); break;
      case 'tabCell': view.fret = { string: +t.dataset.si, gs: +t.dataset.gs, ext: false }; view.sheet = 'fret'; render(); break;
      case 'melCell': { const sm = slotModel(line), gs = +t.dataset.gs, d = +t.dataset.d, o = +t.dataset.o, bar = Math.floor(gs / sm.spb), slot = gs % sm.spb; const ex = notesOf().find(function (n) { return n.bar === bar && n.slot === slot && n.d === d && n.o === o; }); if (ex) delNoteAt(bar, slot); else addNoteAt(bar, slot, d, o, 0); render(); break; }
      case 'setFret': { const fk = view.fret, sm = slotModel(line), midi = TAB_OPEN[fk.string] + (+t.dataset.f); let dd = null; try { dd = UZ.Model.midiToDeg(midi, pcKey(), isMinor()); } catch (e) {} if (dd) { const bar = Math.floor(fk.gs / sm.spb), slot = fk.gs % sm.spb; addNoteAt(bar, slot, dd.d, dd.o, dd.acc); } view.sheet = null; view.fret = null; render(); break; }
      case 'fretExt': view.fret.ext = !view.fret.ext; render(); break;
      case 'fretMute': case 'fretDel': { const fk = view.fret, sm = slotModel(line), bar = Math.floor(fk.gs / sm.spb), slot = fk.gs % sm.spb; delNoteAt(bar, slot); view.sheet = null; view.fret = null; render(); break; }
      // Stage 5: transport
      case 'togglePlay': view.playing ? stopPlay() : startPlay(); break;
      case 'toggleLoop': view.loopOn = !view.loopOn; if (view.playing) { stopPlay(); startPlay(); } else render(); break;
      case 'bpmDown': st.looperBpm = Math.max(60, (st.looperBpm || 100) - 5); save(); if (view.playing) { stopPlay(); startPlay(); } else render(); break;
      case 'bpmUp': st.looperBpm = Math.min(180, (st.looperBpm || 100) + 5); save(); if (view.playing) { stopPlay(); startPlay(); } else render(); break;
      // Stage 5b: piano dock + REC
      case 'openPiano': view.pianoOpen = true; view.lane = 'melody'; view.recording = true; view.recCursor = 0; view.sheet = null; unlockAudio(); render(); break;
      case 'closePiano': view.pianoOpen = false; view.recording = false; if (view.playing) stopPlay(); else render(); break;
      case 'keepTake': view.recording = false; view.pianoOpen = false; if (view.playing) stopPlay(); else render(); break;
      case 'toggleRec': view.recording = !view.recording; render(); break;
      case 'octDown': view.octave = Math.max(2, view.octave - 1); render(); break;
      case 'octUp': view.octave = Math.min(6, view.octave + 1); render(); break;
      case 'scaleLock': view.scaleLock = !view.scaleLock; render(); break;
      case 'pianoKey': {
        const pc = +t.dataset.pc, oct = +t.dataset.oct, midi = 12 * (oct + 1) + pc;
        unlockAudio(); try { if (UZ.Audio && UZ.Audio.playNote) UZ.Audio.playNote(KEYS[pc], oct); } catch (e) {}
        if (view.recording) { const sm = slotModel(line); let dd = null; try { dd = UZ.Model.midiToDeg(midi, pcKey(), isMinor()); } catch (e) {} if (dd) { const gs = view.recCursor % sm.totalSlots; addNoteAt(Math.floor(gs / sm.spb), gs % sm.spb, dd.d, dd.o, dd.acc); view.recCursor = (gs + 1) % sm.totalSlots; } }
        render(); break;
      }
      // Stage 6: Song view
      case 'openSong': view.song = true; view.sheet = null; view.selId = null; if (view.playing) stopPlay(); render(); break;
      case 'closeSong': view.song = false; render(); break;
      case 'openSection': st.currentLineIndex = +t.dataset.i; view.song = false; view.lane = 'chords'; view.selId = null; view.sheet = null; save(); render(); break;
      case 'songShapes': view.songShapes = !view.songShapes; render(); break;
      case 'songLyrics': view.songLyrics = !view.songLyrics; render(); break;
      case 'songAddSection': (st.progressionLines = st.progressionLines || []).push({ chords: [], repeats: 1, tab: [], showTab: false, bpb: 4, viewMode: 'stacked' }); st.currentLineIndex = st.progressionLines.length - 1; flush(); render(); break;
      case 'songHandle': break;   // section drag handled via pointerdown
      case 'songChord': break;    // chord drag handled via pointerdown
      // Stage 7: Lyrics / RhymeForge
      case 'openLyrics': view.lyrics = true; view.song = false; view.sheet = null; view.selId = null; view.lyrPick = null; if (view.playing) stopPlay(); ensureLyrics(); render(); break;
      case 'closeLyrics': view.lyrics = false; view.lyrPick = null; hideRhymeFrame(); render(); break;
      case 'lyrTab': { const lyr = ensureLyrics(); lyr.currentTab = t.dataset.tab; flush(); render(); break; }
      case 'lyrView': { const lyr = ensureLyrics(); lyr.currentView = t.dataset.vw; view.lyrPick = null; flush(); render(); break; }
      case 'lyrInsert': insertSectionMarker(t.dataset.name); render(); break;
      case 'lyrParse': reparseLyrics(); render(); break;
      case 'lyrHowto': view.howtoOpen = !view.howtoOpen; render(); break;
      case 'lyrPick': view.lyrPick = { si: +t.dataset.si, li: +t.dataset.li, wi: +t.dataset.wi }; render(); break;
      case 'lyrAssign': { const p = view.lyrPick, lyr = ensureLyrics(), sec = lyr.sections[p.si]; if (sec) { sec.chordMap = sec.chordMap || {}; sec.chordMap[p.li] = sec.chordMap[p.li] || {}; sec.chordMap[p.li][p.wi] = t.dataset.ch; } view.lyrPick = null; flush(); render(); break; }
      case 'lyrRemove': { const p = view.lyrPick, lyr = ensureLyrics(), sec = lyr.sections[p.si]; if (sec && sec.chordMap && sec.chordMap[p.li]) delete sec.chordMap[p.li][p.wi]; view.lyrPick = null; flush(); render(); break; }
      case 'lyrPickClose': view.lyrPick = null; render(); break;
      // Stage 8: Tools (More menu + Chord Picker / Key Finder / Progression Analysis / Show Scale)
      case 'more': view.sheet = 'tools'; render(); break;
      case 'openTool': { const id = t.dataset.tool; if (id === 'chordpicker') { view.sheet = 'palette'; view.addAt = null; } else { view.tool = id; view.sheet = null; view.song = false; view.lyrics = false; if (view.playing) stopPlay(); } render(); break; }
      case 'closeTool': view.tool = null; render(); break;
      case 'auditionPicked': audition(pickerName()); break;
      case 'kfRoot': view.kf.root = t.dataset.r; render(); break;
      case 'kfQual': view.kf.qual = t.dataset.q; render(); break;
      case 'kfAdd': { const nm = kfPreview(); view.kf.chords.push(nm); view.kf.selKey = null; view.kf.selType = null; audition(nm); render(); break; }
      case 'kfRemove': view.kf.chords.splice(+t.dataset.i, 1); view.kf.selKey = null; view.kf.selType = null; render(); break;
      case 'kfClear': view.kf.chords = []; view.kf.selKey = null; view.kf.selType = null; render(); break;
      case 'kfSelect': view.kf.selKey = t.dataset.key; view.kf.selType = t.dataset.type; render(); break;
      case 'kfUse': { const kf = view.kf; if (kf.selKey) { st.selectedKey = st.progressionKey = kf.selKey; st.selectedTab = (kf.selType === 'minor') ? 'dark' : 'standard'; view.tool = null; flush(); render(); } break; }
      case 'scaleType': view.scale.type = t.dataset.t; view.scale.blues = t.dataset.b === '1'; render(); break;
      case 'arpRoot': view.arp.root = t.dataset.r; render(); break;
      case 'arpQual': view.arp.qual = t.dataset.q; render(); break;
      case 'arpPlay': audition(arpName()); break;
      case 'tunToggle': if (tunActive) { stopTuner(); render(); } else { startTuner(); } break;
      case 'tunStr': break;   // auto-detect highlights the nearest string; manual select is a deferred refinement
      // editor
      case 'setLen': { const c = line.chords.find(x => x.id === view.selId); if (c) { c.beats = +t.dataset.beats; rippleOutward(line.chords, c.id); flush(); render(); } break; }
      case 'nudgeStart': { const c = line.chords.find(x => x.id === view.selId); if (c) { c.start = Math.max(0, snap05((c.start || 0) + (+t.dataset.d))); rippleOutward(line.chords, c.id); flush(); render(); } break; }
      case 'setAccent': { const c = line.chords.find(x => x.id === view.selId); if (c) { c.accent = t.dataset.acc; flush(); render(); } break; }
      case 'dupChord': { const c = line.chords.find(x => x.id === view.selId); if (c) { const copy = Object.assign({}, c, { id: uid(), start: (c.start || 0) + c.beats }); if (c.shape) copy.shape = { frets: c.shape.frets.slice(), baseFret: c.shape.baseFret || 0 }; line.chords.push(copy); rippleOutward(line.chords, copy.id); view.selId = copy.id; flush(); render(); } break; }
      case 'removeChord': line.chords = line.chords.filter(x => x.id !== view.selId); view.selId = null; view.sheet = null; flush(); render(); break;
      // palette
      case 'pickRoot': view.pick.root = t.dataset.r; render(); break;
      case 'pickQual': view.pick.qual = +t.dataset.i; render(); break;
      case 'pickExt': view.pick.ext = +t.dataset.i; render(); break;
      case 'addPicked': { const name = pickerName(); addChordAt({ chord: name, roman: romanFor(name) }, view.addAt); view.sheet = null; view.addAt = null; render(); break; }
      // shape editor (Option A)
      case 'toggleShapes': view.shapesOn = !view.shapesOn; render(); break;
      case 'shape': e.stopPropagation(); view.sh = openShapeFor(t.dataset.id); view.selId = t.dataset.id; view.sheet = 'shape'; render(); break;
      case 'shGrid': { const sh = view.sh; const si = +t.dataset.si, fr = +t.dataset.fr; sh.frets[si] = (sh.frets[si] === fr) ? null : fr; sh.pick = null; render(); break; }
      case 'shSet': { const sh = view.sh; sh.frets[+t.dataset.si] = (t.dataset.v === 'x') ? null : +t.dataset.v; sh.pick = null; render(); break; }
      case 'shPick': { const sh = view.sh, si = +t.dataset.si; sh.pick = (sh.pick === si) ? null : si; render(); break; }
      case 'shShift': { const sh = view.sh, d = +t.dataset.d; sh.frets = sh.frets.map(function (f) { return (f != null && f > 0) ? Math.max(0, f + d) : f; }); render(); break; }
      case 'shWin': { const sh = view.sh; sh.base = Math.max(0, Math.min(20, sh.base + (+t.dataset.d))); render(); break; }
      case 'shClear': view.sh.frets = [null, null, null, null, null, null]; view.sh.pick = null; render(); break;
      case 'saveShape': { const sh = view.sh, c = line.chords.find(x => x.id === sh.cid); if (c) { const any = sh.frets.some(f => f != null); if (any) c.shape = { frets: sh.frets.slice(), baseFret: sh.base }; else delete c.shape; flush(); } view.sheet = null; view.sh = null; render(); break; }
    }
  };
}

export function _state() { return UZ && UZ.state; }
