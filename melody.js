// ════════════════════════════════════════════════════════════════════
// Undercover Zest — Melody Sketcher  (melody.js, v1)
// ════════════════════════════════════════════════════════════════════
// Scale-grid melody sketchpad ("Stage" direction, design session 10–11
// Jun 2026). Vanilla port of the React prototype: template-literal
// renderer repainting from state, pointer interactions, chord-tone
// tints + pills, rule-based Suggest, loop-synced playback + playhead.
import * as Audio from './audio.js?v=102';

let D = null; // injected deps: { state, getScaleNotes, transposeChord, displayChordForKey, saveState, onPreviewBlocked }

// ── tokens (Stage direction) ────────────────────────────────────────
const GOLD = '#c8a04a', YELLOW = '#fdd835';
const TIER = { chord: '#5ec878', scale: '#e8b84a' };
const MONO = "'JetBrains Mono','Courier New',monospace";
const BODY = "'Outfit',sans-serif";
const ROW_H = 24, BAR_GAP = 7, LABEL_W = 64, HEADER_H = 40;
const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_IDX = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,'Cb':11,'E#':5,'B#':0,'Fb':4 };
const MAJ_OFF = [0, 2, 4, 5, 7, 9, 11];

// ── module state (transient — committed data lives in D.state.melody) ──
let drag = null, hover = null, ghosts = null, justPlaced = null;
let undoStack = [];

function pushUndo() {
    const m = st();
    undoStack.push(JSON.stringify({ lines: m.lines, activeLine: m.activeLine, resolution: m.resolution }));
    if (undoStack.length > 20) undoStack.shift();
}

function popUndo() {
    if (!undoStack.length) return;
    const snap = JSON.parse(undoStack.pop());
    const m = st();
    m.lines = snap.lines;
    m.activeLine = snap.activeLine;
    if (snap.resolution === 8 || snap.resolution === 16) m.resolution = snap.resolution;
    ghosts = null;
    D.saveState();
    render();
}
let playingBar = -1;            // bar index within the ACTIVE line, -1 = none
let playWindow = [];            // [{t0, dur, lineIdx, chordIdx}] scheduled measures
let rafId = null;

export function defaults() {
    return { lines: {}, instrument: 'pluck', resolution: 8, octaves: 2, labelMode: 'degrees', open: false, activeLine: 0, zoom: 1, showChordTones: true, showKeyScale: false };
}

function st() {
    const s = D.state;
    if (!s.melody) s.melody = defaults();
    const m = s.melody;
    if (!m.lines) m.lines = {};
    if (m.resolution !== 8 && m.resolution !== 16) m.resolution = 8;
    if (m.octaves !== 2 && m.octaves !== 3) m.octaves = 2;
    if (!(m.zoom >= 0.7 && m.zoom <= 2)) m.zoom = 1;
    if (typeof m.showChordTones !== 'boolean') m.showChordTones = true;
    if (typeof m.showKeyScale !== 'boolean') m.showKeyScale = false;
    return m;
}

export function init(deps) { D = deps; st(); attachPointer(); }

// ── music helpers ───────────────────────────────────────────────────
function scaleNoteNames() {
    return D.getScaleNotes(D.state.selectedKey, 'major').map(n => n.note);
}

// absolute semitone of degree d (1-7) at row octave o (0 = the 4th octave)
function absSemis(d, o) {
    const rootPc = NOTE_IDX[D.state.selectedKey] || 0;
    return (4 + o) * 12 + rootPc + MAJ_OFF[d - 1];
}
function noteOf(d, o) {
    const a = absSemis(d, o);
    return { note: SHARP[a % 12], octave: Math.floor(a / 12) };
}
export function midiPitch(d, o) { return absSemis(d, o) + 12; }

function activeLineIdx() {
    const s = D.state, m = st();
    let li = m.activeLine | 0;
    if (li >= s.progressionLines.length) li = s.progressionLines.length - 1;
    if (li < 0) li = 0;
    m.activeLine = li;
    return li;
}

function notesOf(lineIdx) {
    const m = st();
    if (!Array.isArray(m.lines[lineIdx])) m.lines[lineIdx] = [];
    return m.lines[lineIdx];
}

// bars of the active line: [{chord, roman, tones:[deg], toneNames:[str]}]
export function bars(lineIdx) {
    const s = D.state;
    const li = lineIdx == null ? activeLineIdx() : lineIdx;
    const line = s.progressionLines[li] || { chords: [] };
    const sc = scaleNoteNames();
    return line.chords.filter(c => c.chord && c.chord !== '?').map(item => {
        const raw = item.roman ? D.transposeChord(item.chord, item.roman, s.progressionKey, s.selectedKey) : item.chord;
        const disp = D.displayChordForKey(raw, s.selectedKey);
        const mroot = raw.match(/^[A-G][#b]?/);
        const root = mroot ? mroot[0] : 'C';
        const quality = raw.slice(root.length);
        const toneNames = [], toneDegs = [];
        Audio.getChordTones(root, quality).forEach(t => {
            if (toneNames.length >= 3 || toneNames.includes(t.note)) return;
            toneNames.push(t.note);
            const di = sc.indexOf(t.note);
            if (di >= 0) toneDegs.push(di + 1);
        });
        return { chord: disp, roman: item.roman || '', tones: toneDegs, toneNames };
    });
}

function tierOf(prog, bar, d) {
    const b = prog[bar];
    return b && b.tones.includes(d) ? 'chord' : 'scale';
}

function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── geometry ────────────────────────────────────────────────────────
function geo() {
    const m = st();
    const slots = m.resolution;
    const cellW = Math.round((slots === 16 ? 15 : 30) * (m.zoom || 1));
    const prog = bars();
    const topP = m.octaves * 7;
    const rows = topP + 1;
    const barW = slots * cellW;
    return {
        m, slots, cellW, prog, topP, rows, barW,
        bodyH: rows * ROW_H,
        width: LABEL_W + prog.length * barW + Math.max(0, prog.length - 1) * BAR_GAP,
        barX: b => LABEL_W + b * (barW + BAR_GAP),
        rowY: p => HEADER_H + (topP - p) * ROW_H,
    };
}

// ── rendering ───────────────────────────────────────────────────────
export function render() {
    const c = document.getElementById('melodySketcherContainer');
    if (!c) return;
    const m = st();
    c.classList.toggle('open', !!m.open);
    if (!m.open) { c.innerHTML = ''; stopRaf(); return; }
    const s = D.state;
    const g = geo();
    const li = activeLineIdx();
    const notes = drag ? drag.work : notesOf(li);
    const sc = scaleNoteNames();

    // ── header ──
    const tabs = s.progressionLines.map((line, i) =>
        `<button class="mel-tab ${i === li ? 'active' : ''}" data-action="melLine" data-line="${i}">${(line.name || 'Line ' + (i + 1)).toUpperCase()}</button>`
    ).join('');
    const playBtn = D.state.looperPlaying
        ? `<button class="mel-btn mel-play playing" data-action="toggleLooper">■ STOP</button>`
        : `<button class="mel-btn mel-play" data-action="toggleLooper">▶ PLAY</button>`;
    const suggestCluster = ghosts
        ? `<button class="mel-btn mel-btn-on" data-action="melKeep" title="Commit every remaining suggested note">✓ KEEP ALL</button>
           <button class="mel-btn" data-action="melAnother">↻ ANOTHER</button>
           <button class="mel-btn" data-action="melSuggest" title="Hide the suggestion">× HIDE</button>`
        : `<button class="mel-btn mel-suggest" data-action="melSuggest">✨ SUGGEST A SHAPE</button>`;
    const header = `
    <div class="mel-header">
      <span class="mel-title">✏️ MELODY SKETCH</span>
      <span class="mel-tabs">${tabs}</span>
      <span class="mel-controls">
        ${playBtn}
        <span class="mel-seg">
          <button class="mel-btn ${m.labelMode === 'degrees' ? 'mel-btn-on' : ''}" data-action="melLabelMode" data-mode="degrees">DEGREES</button>
          <button class="mel-btn ${m.labelMode === 'notes' ? 'mel-btn-on' : ''}" data-action="melLabelMode" data-mode="notes">NOTES</button>
        </span>
        <span class="mel-seg">
          <button class="mel-btn ${m.resolution === 8 ? 'mel-btn-on' : ''}" data-action="melRes" data-res="8">8THS</button>
          <button class="mel-btn ${m.resolution === 16 ? 'mel-btn-on' : ''}" data-action="melRes" data-res="16">16THS</button>
        </span>
        <button class="mel-btn ${m.octaves === 3 ? 'mel-btn-on' : ''}" data-action="melOctaves">+8VA</button>
        <button class="mel-btn" title="Melody voice">PLUCK ▾</button>
        ${suggestCluster}
        <button class="mel-btn ${undoStack.length ? '' : 'mel-btn-dim'}" data-action="melUndo" title="Undo last melody edit">↶ UNDO</button>
        <button class="mel-btn" data-action="melToTab" title="Write this melody into the line's ♫ Tab as fret numbers">→ TAB</button>
        <button class="mel-close" data-action="toggleMelodySketcher" aria-label="Close">×</button>
      </span>
    </div>`;

    if (!g.prog.length) {
        c.innerHTML = `<div class="mel-card">${header}<div class="mel-stage mel-empty-note">Add chords to this line first — the melody grid maps to your progression.</div></div>`;
        return;
    }

    // ── grid layers ──
    let L = '';
    const surface = '#15151d';

    // bar headers: chord chip + tone pills
    g.prog.forEach((bar, b) => {
        const playing = b === playingBar;
        const pills = bar.toneNames.map(t =>
            `<span class="mel-pill">${t.replace('#', '♯')}</span>`).join('');
        L += `<div style="position:absolute;left:${g.barX(b)}px;top:0;width:${g.barW}px;height:${HEADER_H}px;display:flex;align-items:center;gap:6px;padding-left:2px;overflow:hidden;">
          <span class="mel-chip ${playing ? 'playing' : ''}" data-melbar-chip="${b}"><b>${bar.chord}</b><i>${bar.roman}</i></span>
          <span style="display:inline-flex;gap:2px;">${pills}</span>
        </div>`;
    });

    // row labels
    for (let p = g.topP; p >= 0; p--) {
        const deg = (p % 7) + 1, oct = 4 + Math.floor(p / 7);
        const tonic = deg === 1;
        const name = sc[deg - 1].replace('#', '♯');
        const chip = m.labelMode !== 'notes'
            ? `<span style="width:15px;height:15px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-family:${MONO};font-size:9.5px;font-weight:700;background:${tonic ? GOLD : 'rgba(255,255,255,0.06)'};color:${tonic ? '#111' : '#999'};">${deg}</span>` : '';
        const nm = `<span style="font-family:${BODY};font-size:10px;font-weight:${m.labelMode === 'notes' && tonic ? 700 : 500};color:${tonic ? GOLD : '#666'};min-width:20px;">${name}<span style="font-size:8px;opacity:0.65;">${oct}</span></span>`;
        L += `<div style="position:absolute;left:0;top:${g.rowY(p)}px;width:${LABEL_W - 8}px;height:${ROW_H}px;display:flex;align-items:center;justify-content:flex-end;gap:5px;">${chip}${nm}</div>`;
    }

    // bar blocks with layered gridlines
    const beatW = (g.slots / 4) * g.cellW;
    g.prog.forEach((bar, b) => {
        L += `<div style="position:absolute;left:${g.barX(b)}px;top:${HEADER_H}px;width:${g.barW}px;height:${g.bodyH}px;background:${surface};background-image:
          repeating-linear-gradient(to right, rgba(255,255,255,0.11) 0 1px, transparent 1px ${beatW}px),
          repeating-linear-gradient(to right, rgba(255,255,255,0.05) 0 1px, transparent 1px ${g.cellW}px),
          repeating-linear-gradient(to bottom, rgba(255,255,255,0.035) 0 1px, transparent 1px ${ROW_H}px);
          border-radius:3px;border:1px solid rgba(255,255,255,0.05);"></div>`;
        for (let p = g.topP; p >= 0; p--) {
            if ((p % 7) + 1 !== 1) continue;
            L += `<div style="position:absolute;left:${g.barX(b)}px;top:${g.rowY(p) + ROW_H - 1}px;width:${g.barW}px;height:1px;background:rgba(200,160,74,0.16);"></div>`;
        }
    });

    // row tints: chord tones (green) and, optionally, the rest of the
    // key scale (amber) — every row in this grid is in key, the wash
    // makes that explicit.
    g.prog.forEach((bar, b) => {
        const playing = b === playingBar;
        for (let p = g.topP; p >= 0; p--) {
            const deg = (p % 7) + 1;
            const isTone = bar.tones.includes(deg);
            if (isTone && m.showChordTones) {
                L += `<div class="mel-tint ${playing ? 'bar-active' : ''}" data-meltint-bar="${b}" style="position:absolute;left:${g.barX(b)}px;top:${g.rowY(p)}px;width:${g.barW}px;height:${ROW_H}px;"></div>`;
            } else if (!isTone && m.showKeyScale) {
                L += `<div class="mel-tint-scale ${playing ? 'bar-active' : ''}" data-meltint-bar="${b}" style="position:absolute;left:${g.barX(b)}px;top:${g.rowY(p)}px;width:${g.barW}px;height:${ROW_H}px;"></div>`;
            }
        }
    });

    // playhead (positioned by rAF; hidden until playing)
    L += `<div id="melPlayCol" style="display:none;position:absolute;top:${HEADER_H}px;width:${g.cellW}px;height:${g.bodyH}px;background:${rgba(YELLOW, 0.07)};will-change:transform;"></div>
          <div id="melPlayLine" style="display:none;position:absolute;top:${HEADER_H - 5}px;width:2px;height:${g.bodyH + 5}px;background:${YELLOW};box-shadow:0 0 8px rgba(253,216,53,0.7);border-radius:1px;will-change:transform;">
            <span style="position:absolute;left:-3px;top:-4px;width:8px;height:5px;background:${YELLOW};border-radius:2px 2px 0 0;"></span>
          </div>`;

    // notes + ghosts
    const renderNote = (n, i, ghost) => {
        const tier = tierOf(g.prog, n.bar, n.d);
        const col = TIER[tier];
        const p = n.o * 7 + (n.d - 1);
        if (n.bar >= g.prog.length || p > g.topP) return '';
        const x = g.barX(n.bar) + n.slot * g.cellW, y = g.rowY(p), w = n.len * g.cellW;
        const num = (w - 4) >= 24 ? `<span style="font-family:${MONO};font-size:9.5px;font-weight:700;color:${col};padding-left:7px;">${n.d}</span>` : '';
        const style = ghost
            ? `background:transparent;border:1.5px dashed ${rgba(col, 0.7)};opacity:0.85;`
            : `background:linear-gradient(${rgba(col, 0.22)},${rgba(col, 0.22)}),${surface};border:1.5px solid ${rgba(col, 0.9)};box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
        const anim = (!ghost && justPlaced && n.bar === justPlaced.bar && n.slot === justPlaced.slot && n.d === justPlaced.d && n.o === justPlaced.o) ? ' mel-note-anim' : '';
        return `<div class="mel-note${anim}" data-melnote="${i}" style="position:absolute;left:${x + 2}px;top:${y + 2.5}px;width:${w - 4}px;height:${ROW_H - 5}px;border-radius:${ROW_H / 2}px;display:flex;align-items:center;z-index:3;${style}">${num}</div>`;
    };
    notes.forEach((n, i) => { L += renderNote(n, i, false); });
    (ghosts || []).forEach((n, i) => { L += renderNote(n, i, true); });

    // hover affordance: persistent overlay cell, moved on pointermove
    // without re-rendering (re-renders made every note replay its
    // entrance animation — the "flashing" bug).
    L += `<span id="melHoverCell" style="display:none;position:absolute;width:${g.cellW - 4}px;height:${ROW_H - 5}px;border-radius:${ROW_H / 2}px;border:1.5px dashed rgba(253,216,53,0.45);background:rgba(253,216,53,0.05);align-items:center;justify-content:center;color:rgba(253,216,53,0.65);font-size:12px;z-index:4;pointer-events:none;will-change:left,top;">+</span>`;

    const emptyNote = (!notes.length && !ghosts)
        ? `<div class="mel-placeholder">Tap to add notes for this section</div>` : '';

    const hintBar = playingBar >= 0 && g.prog[playingBar]
        ? `Green rows are <b>${g.prog[playingBar].toneNames.join(' · ').replace(/#/g, '♯')}</b> while the loop is on ${g.prog[playingBar].chord} — safe places to land.`
        : `Green rows are the current chord's tones — safe places to land.`;

    let cursor = drag ? (drag.kind === 'move' ? 'grabbing' : 'col-resize') : 'default';

    const _justPlacedConsumed = justPlaced; justPlaced = null;
    c.innerHTML = `
    <div class="mel-card">
      ${header}
      <div class="mel-toolbar">
        <span class="mel-tool-group"><span class="mel-scroll-label">Zoom</span><input type="range" id="melZoomSlider" min="0.7" max="2" step="0.1" value="${m.zoom || 1}"><span class="mel-zoom-value">${(m.zoom || 1).toFixed(1)}x</span></span>
        <span class="mel-tool-group mel-tool-scroll"><span class="mel-scroll-label">Scroll</span><input type="range" id="melScrollSlider" min="0" max="100" step="1" value="0"></span>
        <span class="mel-tool-group">
          <button class="mel-btn ${m.showChordTones ? 'mel-btn-on' : ''}" data-action="melChordTones" title="Highlight each bar's chord tones (green)">♪ CHORD TONES</button>
          <button class="mel-btn ${m.showKeyScale ? 'mel-btn-on' : ''}" data-action="melKeyScale" title="Wash the remaining in-key rows (amber) — every row here is in the key of ${D.state.selectedKey}">♪ KEY SCALE</button>
        </span>
      </div>
      <div class="mel-stage">
        <div id="melGridWrap" style="position:relative;width:${g.width}px;height:${HEADER_H + g.bodyH}px;font-family:${BODY};cursor:${cursor};touch-action:none;user-select:none;-webkit-user-select:none;">
          ${L}${emptyNote}
        </div>
      </div>
      <div class="mel-footer">
        <span class="mel-legend"><i style="background:${TIER.chord}"></i> chord tone — safe, always lands <i style="background:${TIER.scale};margin-left:10px;"></i> colour note — passes through</span>
        <span class="mel-hint" id="melHint">${hintBar}</span>
      </div>
    </div>`;
}

// re-render only if open (cheap guard used by app hooks)
export function refresh() { if (D && st().open) render(); }

// ── hit testing (port of igrid.jsx) ─────────────────────────────────
function locate(e) {
    const wrap = document.getElementById('melGridWrap');
    if (!wrap) return null;
    const g = geo();
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (y < HEADER_H || y >= HEADER_H + g.bodyH || x < LABEL_W) return null;
    const bx = x - LABEL_W;
    const bar = Math.floor(bx / (g.barW + BAR_GAP));
    if (bar < 0 || bar >= g.prog.length) return null;
    const ix = bx - bar * (g.barW + BAR_GAP);
    if (ix >= g.barW) return null;
    const slot = Math.floor(ix / g.cellW);
    const p = g.topP - Math.floor((y - HEADER_H) / ROW_H);
    if (p < 0 || p > g.topP) return null;
    return { bar, slot, p, edge: ix - slot * g.cellW > g.cellW * 0.55 };
}

function noteAt(list, loc, g) {
    for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (n.bar === loc.bar && n.o * 7 + (n.d - 1) === loc.p && loc.slot >= n.slot && loc.slot < n.slot + n.len) return i;
    }
    return -1;
}
function isEdgeHit(n, loc) {
    return loc.slot === n.slot + n.len - 1 && (loc.edge || (n.len > 1 && loc.slot > n.slot));
}
function mono(list, keepIdx) {
    const k = list[keepIdx];
    return list.filter((n, i) => i === keepIdx || n.bar !== k.bar || n.slot + n.len <= k.slot || n.slot >= k.slot + k.len);
}
function fromP(p) { return { d: (p % 7) + 1, o: Math.floor(p / 7) }; }

function preview(d, o) {
    try { const n = noteOf(d, o); Audio.playNote(n.note, n.octave, 0.25, 'guitar'); } catch (e) {}
}

// ── pointer handlers (document-level delegation, attached once) ─────
let pointerAttached = false;
export function attachPointer() {
    if (pointerAttached) return;
    pointerAttached = true;
    // Scroll slider (same pattern as the tab editor's tab-scroll-slider)
    document.addEventListener('input', (e) => {
        if (e.target.id === 'melZoomSlider') {
            // live readout only — re-rendering here would replace the slider
            // mid-drag and kill the gesture (the "one notch at a time" bug)
            const v = document.querySelector('.mel-zoom-value');
            if (v) v.textContent = (parseFloat(e.target.value) || 1).toFixed(1) + 'x';
            return;
        }
        if (e.target.id !== 'melScrollSlider') return;
        const stage = e.target.closest('.mel-card')?.querySelector('.mel-stage');
        if (!stage) return;
        const max = stage.scrollWidth - stage.clientWidth;
        stage.scrollLeft = (parseFloat(e.target.value) / 100) * Math.max(0, max);
    });
    document.addEventListener('change', (e) => {
        if (e.target.id !== 'melZoomSlider') return;
        const m2 = st();
        m2.zoom = parseFloat(e.target.value) || 1;
        D.saveState();
        const stage = document.querySelector('.mel-stage');
        const ratio = stage && stage.scrollWidth > stage.clientWidth ? stage.scrollLeft / (stage.scrollWidth - stage.clientWidth) : 0;
        render();
        const stage2 = document.querySelector('.mel-stage');
        if (stage2) stage2.scrollLeft = ratio * Math.max(0, stage2.scrollWidth - stage2.clientWidth);
    });
    document.addEventListener('scroll', (e) => {
        if (!e.target.classList || !e.target.classList.contains('mel-stage')) return;
        const slider = document.getElementById('melScrollSlider');
        if (!slider) return;
        const max = e.target.scrollWidth - e.target.clientWidth;
        if (max > 0) slider.value = Math.round((e.target.scrollLeft / max) * 100);
    }, true);
    document.addEventListener('pointerdown', (e) => {
        const wrap = e.target.closest && e.target.closest('#melGridWrap');
        if (!wrap) return;
        const loc = locate(e);
        if (!loc) return;
        e.preventDefault();
        const li = activeLineIdx();
        const notes = notesOf(li);
        const g = geo();
        const idx = noteAt(notes, loc, g);
        if (idx >= 0) {
            const kind = isEdgeHit(notes[idx], loc) ? 'resize' : 'move';
            drag = { kind, work: notes.map(n => ({ ...n })), idx, grabOff: loc.slot - notes[idx].slot, moved: false, startLoc: loc };
        } else {
            // Tap on a ghost adopts just that suggested note (ghosts stay
            // visible so you can cherry-pick — toggle ✨ or × to clear).
            const gIdx = ghosts ? noteAt(ghosts, loc, g) : -1;
            if (gIdx >= 0) {
                pushUndo();
                const adopted = { ...ghosts[gIdx] };
                ghosts = ghosts.filter((_, i2) => i2 !== gIdx);
                if (!ghosts.length) ghosts = null;
                const work = [...notes.map(n => ({ ...n })), adopted];
                st().lines[li] = mono(work, work.length - 1);
                preview(adopted.d, adopted.o);
                justPlaced = adopted;
                D.saveState();
                render();
                return;
            }
            const nn = { bar: loc.bar, slot: loc.slot, ...fromP(loc.p), len: 1 };
            preview(nn.d, nn.o);
            drag = { kind: 'create', work: [...notes.map(n => ({ ...n })), nn], idx: notes.length, grabOff: 0, moved: false, startLoc: loc };
        }
        hover = null;
        render();
    });
    document.addEventListener('pointermove', (e) => {
        const overGrid = e.target.closest && e.target.closest('#melGridWrap');
        if (!drag) {
            const cell = document.getElementById('melHoverCell');
            const wrap = document.getElementById('melGridWrap');
            if (!overGrid) { hover = null; if (cell) cell.style.display = 'none'; if (wrap) wrap.style.cursor = 'default'; return; }
            hover = locate(e);
            if (!cell || !wrap) return;
            if (!hover) { cell.style.display = 'none'; wrap.style.cursor = 'default'; return; }
            const g = geo();
            const li = activeLineIdx();
            const notes = notesOf(li);
            const idx = noteAt(notes, hover, g);
            const gIdx = ghosts ? noteAt(ghosts, hover, g) : -1;
            if (idx >= 0) {
                cell.style.display = 'none';
                wrap.style.cursor = isEdgeHit(notes[idx], hover) ? 'col-resize' : 'pointer';
            } else {
                cell.style.left = (g.barX(hover.bar) + hover.slot * g.cellW + 2) + 'px';
                cell.style.top = (g.rowY(hover.p) + 2.5) + 'px';
                cell.style.width = (g.cellW - 4) + 'px';
                cell.style.display = gIdx >= 0 ? 'none' : 'flex';
                wrap.style.cursor = 'pointer';
            }
            return;
        }
        const loc = locate(e);
        if (!loc) return;
        const g = geo();
        const n = { ...drag.work[drag.idx] };
        drag.moved = drag.moved || loc.bar !== drag.startLoc.bar || loc.slot !== drag.startLoc.slot || loc.p !== drag.startLoc.p;
        if (drag.kind === 'resize' || drag.kind === 'create') {
            if (loc.bar === n.bar) n.len = Math.max(1, Math.min(g.slots - n.slot, loc.slot - n.slot + 1));
            if (drag.kind === 'create') {
                const np = fromP(loc.p);
                if (np.d !== n.d || np.o !== n.o) { n.d = np.d; n.o = np.o; preview(n.d, n.o); }
            }
        } else {
            n.bar = loc.bar;
            n.slot = Math.max(0, Math.min(g.slots - n.len, loc.slot - drag.grabOff));
            const np = fromP(loc.p);
            if (np.d !== n.d || np.o !== n.o) { n.d = np.d; n.o = np.o; preview(n.d, n.o); }
        }
        drag.work[drag.idx] = n;
        render();
    });
    document.addEventListener('pointerup', () => {
        if (!drag) return;
        const li = activeLineIdx();
        const m = st();
        pushUndo();
        if (drag.kind === 'move' && !drag.moved) {
            m.lines[li] = notesOf(li).filter((_, i) => i !== drag.idx); // tap = remove
        } else {
            if (drag.kind === 'create') justPlaced = { ...drag.work[drag.idx] };
            m.lines[li] = mono(drag.work, drag.idx);
        }
        drag = null;
        D.saveState();
        render();
    });
}

// ── header actions (called from the app's delegated listener) ───────
export function handleAction(action, btn) {
    const m = st();
    if (action === 'melLine') { m.activeLine = parseInt(btn.dataset.line, 10) || 0; ghosts = null; }
    else if (action === 'melLabelMode') { m.labelMode = btn.dataset.mode; }
    else if (action === 'melRes') {
        const target = parseInt(btn.dataset.res, 10);
        if (target !== m.resolution) {
            pushUndo();
            const f = target / m.resolution;
            Object.keys(m.lines).forEach(k => {
                m.lines[k] = m.lines[k].map(n => ({ ...n, slot: Math.round(n.slot * f), len: Math.max(1, Math.round(n.len * f)) }));
            });
            if (ghosts) ghosts = ghosts.map(n => ({ ...n, slot: Math.round(n.slot * f), len: Math.max(1, Math.round(n.len * f)) }));
            m.resolution = target;
        }
    }
    else if (action === 'melOctaves') { m.octaves = m.octaves === 2 ? 3 : 2; }
    else if (action === 'melSuggest') { ghosts = ghosts ? null : suggest(); }
    else if (action === 'melAnother') { ghosts = suggest(); }
    else if (action === 'melUndo') { popUndo(); return true; }
    else if (action === 'melChordTones') { m.showChordTones = !m.showChordTones; }
    else if (action === 'melKeyScale') { m.showKeyScale = !m.showKeyScale; }
    else if (action === 'melKeep') {
        if (ghosts) {
            pushUndo();
            const li = activeLineIdx();
            let work = notesOf(li).map(n => ({ ...n }));
            ghosts.forEach(gn => { work = mono([...work, { ...gn }], work.length); });
            m.lines[li] = work;
            ghosts = null;
        }
    }
    else if (action === 'melDiscard') { ghosts = null; }
    else if (action === 'melToTab') { melodyToTab(); return true; }
    else return false;
    D.saveState();
    render();
    return true;
}

// Standard-tuning open-string MIDI pitches, high e -> low E
// (matches the tab editor's string order: index 0 = high e).
const TAB_OPEN_MIDI = [64, 59, 55, 50, 45, 40];

export function melodyToTab() {
    const s = D.state;
    const li = activeLineIdx();
    const line = s.progressionLines[li];
    if (!line) return;
    const notes = notesOf(li);
    if (!notes.length) { alert('No melody notes on this line yet — sketch something first.'); return; }
    const hasTab = (line.tab || []).some(col => col && col.some(v => v !== null && v !== ''));
    if (hasTab && !confirm('This line already has tab. Replace it with the sketched melody?')) return;
    const cols = [...notes]
        .sort((a, b) => (a.bar - b.bar) || (a.slot - b.slot))
        .map(n => {
            const midi = midiPitch(n.d, n.o);
            const col = [null, null, null, null, null, null];
            for (let str = 0; str < 6; str++) {
                const fret = midi - TAB_OPEN_MIDI[str];
                if (fret >= 0 && fret <= 15) { col[str] = String(fret); break; }
            }
            return col;
        });
    line.tab = cols;
    line.tabArtic = [];
    line.showTab = true;
    D.saveState();
    if (D.renderProgression) D.renderProgression();
}

export function toggle() {
    const m = st();
    m.open = !m.open;
    const menuBtn = document.getElementById('btnMelody');
    if (menuBtn) menuBtn.classList.toggle('active', m.open);
    D.saveState();
    render();
    if (m.open) {
        const c = document.getElementById('melodySketcherContainer');
        if (c) setTimeout(() => c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    }
}

// ── ✨ suggest (port of uzSuggestContour) ────────────────────────────
function suggest() {
    const g = geo();
    if (!g.prog.length) return null;
    const scale = g.slots / 8;
    const patterns = [
        [[0, 2], [2, 1], [3, 1], [4, 2], [6, 2]],
        [[0, 2], [2, 2], [4, 2], [6, 2]],
        [[0, 1], [1, 1], [2, 2], [4, 4]],
        [[0, 2], [2, 1], [3, 1], [4, 4]],
    ];
    const chordPs = (b) => {
        const out = [];
        for (let p = 2; p <= 12; p++) if (g.prog[b].tones.includes((p % 7) + 1)) out.push(p);
        return out.length ? out : [7];
    };
    const nearest = (arr, target) => arr.reduce((a, c2) => (Math.abs(c2 - target) < Math.abs(a - target) ? c2 : a));
    let cur = nearest(chordPs(0), 8);
    const out = [];
    g.prog.forEach((bar, b) => {
        const pat = patterns[Math.floor(Math.random() * patterns.length)];
        pat.forEach(([s2, l], j) => {
            const isLast = b === g.prog.length - 1 && j === pat.length - 1;
            if (isLast) cur = 7;
            else if (s2 % 4 === 0) cur = nearest(chordPs(b), cur + (Math.random() < 0.5 ? -1 : 1));
            else cur = Math.max(2, Math.min(12, cur + (Math.random() < 0.5 ? -1 : 1)));
            out.push({ bar: b, slot: s2 * scale, len: l * scale, d: (cur % 7) + 1, o: Math.floor(cur / 7) });
        });
    });
    return out;
}

// ── playback integration ────────────────────────────────────────────
// Called from app.js when the looper SCHEDULES a measure (ahead of time,
// with the precise audio start time). flat = {chord, lineIdx, chordIdx}.
export function onScheduleMeasure(flat, t0, measureDur) {
    const m = st();
    const notes = m.lines[flat.lineIdx];
    playWindow.push({ t0, dur: measureDur, lineIdx: flat.lineIdx, chordIdx: flat.chordIdx });
    if (playWindow.length > 12) playWindow.splice(0, playWindow.length - 12);
    if (!notes || !notes.length) return;
    const slotDur = measureDur / m.resolution;
    notes.forEach(n => {
        if (n.bar !== flat.chordIdx) return;
        const nm = noteOf(n.d, n.o);
        try { Audio.playNote(nm.note, nm.octave, Math.max(n.len * slotDur * 0.92, 0.12), 'guitar', t0 + n.slot * slotDur); } catch (e) {}
    });
    if (m.open && !rafId) rafId = requestAnimationFrame(rafLoop);
}

function stopRaf() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    playingBar = -1;
    playWindow = [];
    const line = document.getElementById('melPlayLine');
    const col = document.getElementById('melPlayCol');
    if (line) line.style.display = 'none';
    if (col) col.style.display = 'none';
}

function rafLoop() {
    rafId = null;
    const m = st();
    if (!D.state.looperPlaying) {
        stopRaf();
        if (m.open) updateBarVisuals(-1);
        return;
    }
    if (!m.open) { rafId = requestAnimationFrame(rafLoop); return; }
    const now = Audio.getAudioTime();
    const w = playWindow.find(x => now >= x.t0 && now < x.t0 + x.dur);
    const li = activeLineIdx();
    const line = document.getElementById('melPlayLine');
    const col = document.getElementById('melPlayCol');
    if (w && w.lineIdx === li) {
        const g = geo();
        if (w.chordIdx < g.prog.length) {
            const el = (now - w.t0) / w.dur;            // 0..1 through the bar
            const slotF = el * g.slots;
            const slot = Math.floor(slotF);
            const frac = Math.floor((slotF - slot) * 3) / 3 + 0.17;
            const x = g.barX(w.chordIdx) + slot * g.cellW;
            if (col) { col.style.display = 'block'; col.style.transform = `translateX(${x}px)`; col.style.left = '0px'; }
            if (line) { line.style.display = 'block'; line.style.transform = `translateX(${x + frac * g.cellW - 1}px)`; line.style.left = '0px'; }
            if (playingBar !== w.chordIdx) updateBarVisuals(w.chordIdx);
        }
    } else {
        if (line) line.style.display = 'none';
        if (col) col.style.display = 'none';
        if (playingBar !== -1) updateBarVisuals(-1);
    }
    rafId = requestAnimationFrame(rafLoop);
}

// light-touch DOM update for the playing bar (no full re-render per bar)
function updateBarVisuals(bar) {
    playingBar = bar;
    document.querySelectorAll('[data-meltint-bar]').forEach(el => {
        el.classList.toggle('bar-active', parseInt(el.dataset.meltintBar, 10) === bar);
    });
    document.querySelectorAll('[data-melbar-chip]').forEach(el => {
        el.classList.toggle('playing', parseInt(el.dataset.melbarChip, 10) === bar);
    });
    const hint = document.getElementById('melHint');
    if (hint) {
        const g = geo();
        const b = g.prog[bar];
        hint.innerHTML = b
            ? `Green rows are <b>${b.toneNames.join(' · ').replace(/#/g, '♯')}</b> while the loop is on ${b.chord} — safe places to land.`
            : `Green rows are the current chord's tones — safe places to land.`;
    }
}

// ── share-URL serialisation: b.s.d.o.l tuples, '_' joined, '~' lines ──
export function serialize() {
    const m = st();
    const lineKeys = Object.keys(m.lines).map(Number).sort((a, b) => a - b);
    if (!lineKeys.some(k => (m.lines[k] || []).length)) return null;
    const maxLine = Math.max(...lineKeys);
    const parts = [];
    for (let i = 0; i <= maxLine; i++) {
        parts.push((m.lines[i] || []).map(n => [n.bar, n.slot, n.d, n.o, n.len].join('.')).join('_'));
    }
    return m.resolution + '|' + parts.join('~');
}

export function deserialize(str) {
    if (!str) return;
    const m = st();
    const [resPart, body] = str.includes('|') ? str.split('|') : ['8', str];
    const res = parseInt(resPart, 10);
    if (res === 8 || res === 16) m.resolution = res;
    const lines = {};
    (body || '').split('~').forEach((seg, i) => {
        if (!seg) return;
        const notes = seg.split('_').map(t => {
            const [bar, slot, d, o, len] = t.split('.').map(Number);
            if ([bar, slot, d, o, len].some(v => !Number.isFinite(v) || v < 0) || d < 1 || d > 7 || o > 3 || len < 1) return null;
            return { bar, slot, d, o, len };
        }).filter(Boolean);
        if (notes.length) lines[i] = notes;
    });
    if (Object.keys(lines).length) { m.lines = lines; m.open = true; }
}

export function hasNotes() {
    const m = st();
    return Object.values(m.lines).some(arr => arr && arr.length);
}
