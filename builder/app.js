/* app.js — controller: state, render, delegated actions, two-clock playback,
   audio. Installs melody (window.MELODY) and tab (window.TAB) action handlers. */
(function () {
  'use strict';
  const M = window.MODEL;
  const VIEWS = window.VIEWS;
  const STORE = 'uz-proto-v2-2';

  let state;
  const _shared = M.parseShareToken && M.parseShareToken(location.search);
  if (_shared) { state = _shared; try { history.replaceState({}, '', location.pathname); } catch (e) {} } // consume the share token once so later reloads keep the user's own edits
  else state = load() || M.seed();

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE)); if (!s || !s.lines) return null;
      s.selection = s.selection || { lineId: null, ids: [] };
      s.clipboard = s.clipboard || []; s.undo = s.undo || [];
      if (s.selNote === undefined) s.selNote = null;
      if (s.loop === undefined) s.loop = true;
      // migrate old sequential chords -> positioned (start) + per-line meter; drop rests into gaps
      (s.lines || []).forEach((l) => {
        if (l.bpb == null) l.bpb = 4;
        if (l.chords && l.chords.some((c) => c.start == null)) { let acc = 0; const out = []; for (const c of l.chords) { const b = c.beats || 4; if (c.rest) { acc += b; continue; } c.start = acc; acc += b; out.push(c); } l.chords = out; }
      });
      return s;
    } catch (e) { return null; }
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(strip(state))); } catch (e) {} }
  function strip(s) { const c = JSON.parse(JSON.stringify(s)); c.playing = false; c.playBeat = 0; c.undo = []; c.editingShape = null; return c; }

  const $app = document.getElementById('app');
  function render() {
    $app.innerHTML = VIEWS.app(state);
    document.body.classList.toggle('dark-mode', state.minor);
    // restore shared scroll positions
    state.lines.forEach((l) => {
      if (l.scroll) { const el = $app.querySelector(`.tl-scroll[data-scroll="${l.id}"]`); if (el) el.scrollLeft = l.scroll; }
    });
    save();
  }

  // ---- undo -----------------------------------------------------------------
  function pushUndo() { state.undo.push(JSON.stringify({ lines: state.lines, selection: state.selection, selNote: state.selNote })); if (state.undo.length > 20) state.undo.shift(); }
  pushUndo.pop = function () { const s = state.undo.pop(); if (s) { try { const u = JSON.parse(s); state.lines = u.lines; state.selection = u.selection || { lineId: null, ids: [] }; state.selNote = u.selNote || null; } catch (e) {} render(); } };

  // ---- selection helpers ----------------------------------------------------
  function selOne(lineId, id) { state.selection = { lineId, ids: [id] }; state.selNote = null; }
  function chordOf(d) { const l = M.lineById(state, d.line); return l && l.chords.find((x) => x.id === d.cid); }
  function ensureShape(c) { if (!c.shape) c.shape = M.defaultShape(c.name) || { frets: [null, null, null, null, null, null], baseFret: 0 }; return c.shape; }
  function selChords(line) { return state.selection.ids.map((id) => line.chords.find((x) => x.id === id)).filter(Boolean); }
  function selIdx(line) { return state.selection.ids.map((id) => line.chords.findIndex((x) => x.id === id)).filter((i) => i >= 0).sort((a, b) => a - b); }

  const A = {
    selectChord(d, e) {
      const add = state.selectMode || (e && (e.shiftKey || e.metaKey || e.ctrlKey)); state.selNote = null;
      if (add && state.selection.lineId === d.line && state.selection.ids.length) {
        const ids = state.selection.ids.slice(); const i = ids.indexOf(d.cid);
        if (i >= 0) ids.splice(i, 1); else ids.push(d.cid);
        state.selection = { lineId: d.line, ids };
      } else state.selection = { lineId: d.line, ids: [d.cid] };
      state.currentLine = d.line; render();
    },
    toggleSelectMode() { state.selectMode = !state.selectMode; render(); },
    toggleLineLoop(d) { const l = M.lineById(state, d.line); l.loop = l.loop === false ? true : false; render(); },
    clearSel() { state.selection = { lineId: null, ids: [] }; render(); },
    cycleDur(d) { const c = chordOf(d); if (!c) return; pushUndo(); const l = M.lineById(state, d.line); const bp = M.bpb(l); const want = c.beats < bp ? bp : c.beats < bp * 2 ? bp * 2 : bp / 2; c.beats = clampBeats(l, c, want); selOne(d.line, d.cid); render(); },
    setLen(d) { const c = chordOf(d); if (c) { pushUndo(); c.beats = clampBeats(M.lineById(state, d.line), c, +d.beats); render(); } },
    setLenSel(d) { const l = M.lineById(state, d.line); pushUndo(); selChords(l).forEach((c) => { c.beats = clampBeats(l, c, +d.beats); }); render(); },
    nudgeLen(d) { const c = chordOf(d); if (c) { pushUndo(); c.beats = clampBeats(M.lineById(state, d.line), c, Math.max(0.5, Math.round((c.beats + +d.d) * 2) / 2)); render(); } },
    nudgeStart(d) { const c = chordOf(d); if (!c) return; pushUndo(); const l = M.lineById(state, d.line); const ns = Math.max(0, Math.round(((c.start || 0) + +d.d) * 2) / 2); if (!overlapsOthers(l, c, ns, c.beats)) c.start = ns; render(); },
    // PRESERVED HOOK (MAPPING.md): aliased to cycleChordAccent on port; no prototype UI emitter — do not prune
    setAccent(d) { const c = chordOf(d); if (c) { pushUndo(); c.accent = d.acc; render(); } },
    dupChord(d) { const l = M.lineById(state, d.line); const i = l.chords.findIndex((x) => x.id === d.cid); if (i < 0) return; pushUndo(); const src = l.chords[i]; const copy = Object.assign({}, src, { id: M.uid('c') }); copy.start = (src.start || 0) + src.beats; if (overlapsOthers(l, copy, copy.start, copy.beats)) copy.start = l.chords.reduce((m, c) => Math.max(m, (c.start || 0) + c.beats), 0); l.chords.splice(i + 1, 0, copy); selOne(d.line, copy.id); render(); },
    dupSel(d) { const l = M.lineById(state, d.line); const idx = selIdx(l); if (!idx.length) return; pushUndo(); const sel = idx.map((i) => l.chords[i]); const minS = Math.min(...sel.map((c) => c.start || 0)); const maxE = Math.max(...sel.map((c) => (c.start || 0) + c.beats)); let copies = sel.map((c) => Object.assign({}, c, { id: M.uid('c'), start: (c.start || 0) + (maxE - minS) })); if (copies.some((cp) => overlapsOthers(l, cp, cp.start, cp.beats))) { const base = l.chords.reduce((m, c) => Math.max(m, (c.start || 0) + c.beats), 0); copies = sel.map((c) => Object.assign({}, c, { id: M.uid('c'), start: base + ((c.start || 0) - minS) })); } l.chords.splice(idx[idx.length - 1] + 1, 0, ...copies); state.selection = { lineId: d.line, ids: copies.map((c) => c.id) }; render(); },
    copySel(d) { const l = M.lineById(state, d.line); state.clipboard = selIdx(l).map((i) => JSON.parse(JSON.stringify(l.chords[i]))); toast(`Copied ${state.clipboard.length} chord${state.clipboard.length > 1 ? 's' : ''} — paste into any section`); render(); },
    pasteInto(d) { const l = M.lineById(state, d.line); if (!state.clipboard.length) return; pushUndo(); const appendAt = l.chords.reduce((m, c) => Math.max(m, (c.start || 0) + c.beats), 0); const minClip = Math.min(...state.clipboard.map((c) => c.start || 0)); const copies = state.clipboard.map((c) => Object.assign({}, c, { id: M.uid('c'), start: appendAt + ((c.start || 0) - minClip) })); l.chords.push(...copies); state.currentLine = d.line; state.selection = { lineId: d.line, ids: copies.map((c) => c.id) }; render(); },
    blankSel(d) { const l = M.lineById(state, d.line); pushUndo(); const ids = state.selection.ids; l.chords = l.chords.filter((x) => ids.indexOf(x.id) < 0); state.selection = { lineId: null, ids: [] }; render(); },
    removeChord(d) { const l = M.lineById(state, d.line); pushUndo(); l.chords = l.chords.filter((x) => x.id !== d.cid); state.selection = { lineId: null, ids: [] }; render(); },
    removeSel(d) { const l = M.lineById(state, d.line); pushUndo(); const ids = state.selection.ids; l.chords = l.chords.filter((x) => ids.indexOf(x.id) < 0); state.selection = { lineId: null, ids: [] }; render(); },
    setMode(d) { const l = M.lineById(state, d.line); l.mode = d.mode; if (d.mode === 'stacked') { l.tabOpen = false; l.melodyOpen = false; } state.currentLine = d.line; render(); },
    toggleTab(d) { const l = M.lineById(state, d.line); l.tabOpen = !l.tabOpen; if (l.tabOpen) l.mode = 'timeline'; if (!l.tabOpen && !l.melodyOpen) l.mode = 'stacked'; state.currentLine = d.line; render(); },
    toggleMelody(d) { const l = M.lineById(state, d.line); l.melodyOpen = !l.melodyOpen; if (l.melodyOpen) l.mode = 'timeline'; if (!l.tabOpen && !l.melodyOpen) l.mode = 'stacked'; state.currentLine = d.line; render(); },
    addChord(d) {
      const line = M.lineById(state, state.currentLine); if (!line) return;
      pushUndo();
      const start = line.chords.reduce((m, c) => Math.max(m, (c.start || 0) + c.beats), 0);
      const c = M.chord(d.name, d.roman, M.bpb(line), d.cat || M.catFor(d.roman)); c.start = start;
      line.chords.push(c); selOne(line.id, c.id); render();
    },
    addBar(d) { const l = M.lineById(state, d.line); pushUndo(); l.minBars = M.nbarsOf(l) + 1; state.currentLine = l.id; render(); },
    zoomIn(d) { const l = M.lineById(state, d.line); l.zoom = Math.min(5, (l.zoom || 1) + 0.5); render(); },
    zoomOut(d) { const l = M.lineById(state, d.line); l.zoom = Math.max(1, (l.zoom || 1) - 0.5); render(); },
    playLine(d) { state.currentLine = d.line; render(); },
    renameLine(d) { state.renamingLine = d.line; render(); setTimeout(() => { const i = $app.querySelector('.lh-name-input'); if (i) { i.focus(); i.select(); } }, 0); },
    panLeft(d) { const el = $app.querySelector(`.tl-scroll[data-scroll="${d.line}"]`); if (el) el.scrollBy({ left: -el.clientWidth * 0.6, behavior: 'smooth' }); },
    panRight(d) { const el = $app.querySelector(`.tl-scroll[data-scroll="${d.line}"]`); if (el) el.scrollBy({ left: el.clientWidth * 0.6, behavior: 'smooth' }); },
    addLine() { pushUndo(); const id = M.uid('line'); state.lines.push({ id, name: 'Section', mode: 'stacked', zoom: 1, scroll: 0, loop: true, tabOpen: false, melodyOpen: false, tabAuthored: false, melodyAuthored: false, melRes: 8, melOctaves: 2, melLabel: 'notes', tabColor: true, tabLabel: 'fret', minBars: 4, chords: [], notes: [] }); state.currentLine = id; render(); },
    removeLine(d) { if (state.lines.length <= 1) return; pushUndo(); state.lines = state.lines.filter((l) => l.id !== d.line); if (state.currentLine === d.line) state.currentLine = state.lines[0].id; render(); },
    // port hooks: major/minor mode lives in the production chrome; no prototype UI emitter
    setMajor() { state.minor = false; render(); },
    setMinor() { state.minor = true; render(); },
    palDegrees() { state.palLabel = 'degrees'; render(); },
    palNotes() { state.palLabel = 'notes'; render(); },
    toggleMute() { state.muted = !state.muted; render(); },
    togglePlay() { state.playing ? stop() : play('song'); },
    playSection(d) { if (state.playing) stop(); state.currentLine = d.line; play('line', d.line); },
    toggleLoopSong() { state.loopSong = !state.loopSong; render(); },
    copyShare() { try { navigator.clipboard.writeText(M.shareToken(state)); toast('Share link copied'); } catch (e) {} },
    // PRESERVED PORT HOOK (MAPPING.md): production reattaches its own editor via uz-deferred-patches.js.
    // Prototype provides a minimal inline fingering editor toggled here.
    editChordShape(d) { const c = chordOf(d); if (!c) return; state.editingShape = (state.editingShape === d.cid) ? null : d.cid; selOne(d.line, d.cid); render(); },
    shapeFret(d) { const c = chordOf(d); if (!c) return; pushUndo(); const sh = ensureShape(c); const s = +d.string; const cur = sh.frets[s]; let nf; if (cur == null) nf = (+d.dir > 0 ? 0 : null); else { nf = cur + (+d.dir); if (nf < 0) nf = null; else nf = Math.min(nf, M.MAX_FRET || 24); } sh.frets[s] = nf; render(); },
    shapeMute(d) { const c = chordOf(d); if (!c) return; pushUndo(); ensureShape(c).frets[+d.string] = null; render(); },
    shapeAuto(d) { const c = chordOf(d); if (!c) return; pushUndo(); c.shape = M.defaultShape(c.name) || { frets: [null, null, null, null, null, null], baseFret: 0 }; render(); },
    reset() { state = M.seed(); render(); },
    resizeStart() {}, // no-op handler; the data-action="resizeStart" attr on .handle is read by the pointerdown drag logic (~app.js:176) — do not remove the attribute
  };

  window.MELODY.install(A, () => state, render, pushUndo, toast);
  window.TAB.install(A, () => state, render, pushUndo, toast);
  window.MELODY.installPointer(() => state, render, pushUndo, previewMel);
  window.TAB.installPointer(() => state, render, pushUndo);

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]'); if (!el) return;
    if (el.dataset.action === 'selectChord' && chordDragged) { chordDragged = false; return; }
    const fn = A[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el.dataset, e); }
    else if (el.dataset.action) console.warn('[chord-builder] no handler for data-action:', el.dataset.action);
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-change]'); if (!el) return;
    if (el.dataset.change === 'bpm') { state.bpm = +el.value; const b = el.parentElement.querySelector('b'); if (b) b.textContent = state.bpm; save(); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]'); if (!el) return;
    if (el.dataset.change === 'setMeter') { const l = M.lineById(state, el.dataset.line); if (l) { pushUndo(); const oldBp = M.bpb(l); const res = l.melRes || 8; const bps = 4 / res; const nb = +el.value; (l.notes || []).forEach((n) => { const beat = n.bar * oldBp + n.slot * bps; n.bar = Math.floor(beat / nb + 1e-9); n.slot = Math.round((beat - n.bar * nb) / bps); }); l.bpb = nb; render(); } return; }
    if (el.dataset.change === 'setArticSel') { const l = M.lineById(state, el.dataset.line); const n = l && l.notes.find((x) => x.id === el.dataset.nid); if (n) { pushUndo(); n.artic = el.value; render(); } return; }
    if (el.dataset.change === 'key') {
      const semis = (M.PC[el.value] - M.PC[state.key] + 1200) % 12;
      pushUndo();
      state.lines.forEach((l) => l.chords.forEach((c) => { if (!c.rest) c.name = M.transpose(c.name, semis, el.value); }));
      state.key = el.value; render();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    if ((e.key === 'Backspace' || e.key === 'Delete') && state.selNote) { e.preventDefault(); const l = M.lineById(state, state.selNote.lineId); if (l) { pushUndo(); l.notes = l.notes.filter((n) => n.id !== state.selNote.noteId); state.selNote = null; render(); } }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && state.selection.ids.length && state.selection.lineId) { e.preventDefault(); A.removeSel({ line: state.selection.lineId }); }
  });
  function commitRename(i) { const l = M.lineById(state, i.dataset.rename); if (l) { const v = i.value.trim(); if (v) { pushUndo(); l.name = v; } } state.renamingLine = null; render(); }
  document.addEventListener('keydown', (e) => { const i = e.target.closest && e.target.closest('.lh-name-input'); if (!i) return; if (e.key === 'Enter') { e.preventDefault(); commitRename(i); } else if (e.key === 'Escape') { e.preventDefault(); state.renamingLine = null; render(); } });
  document.addEventListener('focusout', (e) => { const i = e.target.closest && e.target.closest('.lh-name-input'); if (i && state.renamingLine) commitRename(i); });

  // remember shared scroll
  document.addEventListener('scroll', (e) => {
    const el = e.target.closest ? e.target.closest('.tl-scroll') : null;
    if (el && el.dataset.scroll) { const l = M.lineById(state, el.dataset.scroll); if (l) l.scroll = el.scrollLeft; }
  }, true);

  // ---- line reorder (drag the ⠿ grip) --------------------------------------
  let dragLine = null;
  document.addEventListener('dragstart', (e) => { const g = e.target.closest && e.target.closest('.lh-grip'); if (!g) return; dragLine = g.dataset.grip; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragLine); } catch (x) {} });
  document.addEventListener('dragover', (e) => { if (dragLine && e.target.closest && e.target.closest('.linecard')) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (!dragLine) return; const card = e.target.closest && e.target.closest('.linecard'); if (card) { e.preventDefault(); const targetId = card.dataset.line; if (targetId && targetId !== dragLine) { const from = state.lines.findIndex((l) => l.id === dragLine); const to = state.lines.findIndex((l) => l.id === targetId); if (from >= 0 && to >= 0) { pushUndo(); const [m] = state.lines.splice(from, 1); state.lines.splice(to, 0, m); render(); } } } dragLine = null; });
  document.addEventListener('dragend', () => { dragLine = null; });

  // ---- chord move / resize drag (free-floating on the ½-beat grid) ---------
  let cdrag = null, chordDragged = false;
  function snap05(v) { return Math.round(v * 2) / 2; }
  function overlapsOthers(line, chord, start, beats) { for (const c of line.chords) { if (c.id === chord.id) continue; const s = c.start || 0; if (start < s + c.beats && s < start + beats) return true; } return false; }
  // block/snap invariant: cap a chord's length at the gap before the next chord (by start)
  function maxBeatsAt(line, chord) { let cap = Infinity; const st = chord.start || 0; for (const c of line.chords) { if (c.id === chord.id) continue; const s = c.start || 0; if (s > st && (s - st) < cap) cap = s - st; } return cap; }
  function clampBeats(line, chord, want) { return Math.max(0.5, Math.min(want, maxBeatsAt(line, chord))); }
  document.addEventListener('pointerdown', (e) => {
    const chipEl = e.target.closest('.chip'); if (!chipEl || chipEl.classList.contains('blank')) return;
    if (e.target.closest('.chord-shape-btn, .shapedot, .durbadge')) return;
    const posEl = chipEl.closest('.chip-pos'); const host = chipEl.closest('.chords-abs, .chips-abs'); if (!posEl || !host) return;
    const line = M.lineById(state, chipEl.dataset.line); const c = line && line.chords.find((x) => x.id === chipEl.dataset.cid); if (!c) return;
    const resize = !!e.target.closest('[data-action="resizeStart"]');
    cdrag = { c, line, resize, posEl, x0: e.clientX, beatPx: host.getBoundingClientRect().width / M.axisBeats(line), start0: c.start || 0, beats0: c.beats, moved: false, pending: null };
  });
  document.addEventListener('pointermove', (e) => {
    if (!cdrag) return;
    if (Math.abs(e.clientX - cdrag.x0) > 3) cdrag.moved = true;
    if (!cdrag.moved) return;
    const db = (e.clientX - cdrag.x0) / cdrag.beatPx; const axis = M.axisBeats(cdrag.line);
    if (cdrag.resize) { const len = Math.max(0.5, snap05(cdrag.beats0 + db)); cdrag.pending = { beats: len }; cdrag.posEl.style.width = (len / axis * 100) + '%'; }
    else { const st = Math.max(0, snap05(cdrag.start0 + db)); cdrag.pending = { start: st }; cdrag.posEl.style.left = (st / axis * 100) + '%'; }
  });
  document.addEventListener('pointerup', () => {
    if (!cdrag) return;
    if (cdrag.moved && cdrag.pending) { pushUndo(); if (cdrag.resize) cdrag.c.beats = clampBeats(cdrag.line, cdrag.c, cdrag.pending.beats); else { if (!overlapsOthers(cdrag.line, cdrag.c, cdrag.pending.start, cdrag.c.beats)) cdrag.c.start = cdrag.pending.start; } chordDragged = true; render(); }
    cdrag = null;
  });

  // ---- playback (Web-Audio look-ahead scheduler) ----------------------------
  let schedTimer = null, rafId = null, audioStart = 0, sched = null;
  const LOOKAHEAD = 0.12, TICK_MS = 25;
  function segmentsForSong() { let off = 0; const segs = []; for (const line of state.lines) { const ax = M.axisBeats(line); segs.push({ line, off, end: off + ax }); off += ax; } return { segs, total: off || 1 }; }
  function buildEvents(line) {
    const evs = []; const axis = M.axisBeats(line); const res = line.melRes || 8; const bp = M.bpb(line);
    for (let b = 0; b < axis; b++) evs.push({ beat: b, type: 'click', strong: b % bp === 0 });
    // accent: stop→soft (quieter dynamic) is wired via ev.soft; push reserved (not yet audibly differentiated)
    for (const c of line.chords) { if (c.rest) continue; evs.push({ beat: c.start || 0, type: 'chord', chord: c, soft: c.accent === 'stop' }); }
    line.notes.forEach((n) => { evs.push({ beat: n.bar * bp + n.slot * 4 / res, type: 'mel', note: n, durBeats: n.len * 4 / res }); });
    return evs.sort((a, b) => a.beat - b.beat);
  }
  function buildSongEvents(plan) { const evs = []; for (const s of plan.segs) { buildEvents(s.line).forEach((e) => { const c = Object.assign({}, e); c.beat += s.off; c.lineId = s.line.id; evs.push(c); }); } return evs.sort((a, b) => a.beat - b.beat); }

  function play(mode, lineId) {
    ensureAudio();
    state.playing = true; state.playMode = mode || 'song';
    if (state.playMode === 'line') state.playLineId = lineId || state.currentLine;
    state.playBeat = 0;
    if (state.playMode === 'song') { const plan = segmentsForSong(); sched = { segs: plan.segs, total: plan.total, evs: buildSongEvents(plan), loop: !!state.loopSong }; }
    else { const line = M.lineById(state, state.playLineId) || M.lineById(state, state.currentLine); if (!line || !line.chords.length) { state.playing = false; return; } sched = { line, total: M.axisBeats(line), evs: buildEvents(line), loop: line.loop !== false }; }
    sched.i = 0; sched.cycle = 0; sched.done = false;
    audioStart = (actx ? actx.currentTime : performance.now() / 1000) + 0.06;
    render();
    if (schedTimer) clearInterval(schedTimer);
    schedTimer = setInterval(scheduleTick, TICK_MS); scheduleTick();
    if (rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(paint);
  }
  function stop() { state.playing = false; if (schedTimer) clearInterval(schedTimer); schedTimer = null; if (rafId) cancelAnimationFrame(rafId); rafId = null; sched = null; clearPlayheads(); render(); }
  function scheduleTick() {
    if (!actx || !sched || !state.playing) return;
    const spb = 60 / state.bpm; const horizon = actx.currentTime + LOOKAHEAD;
    let guard = 0;
    while (guard++ < 2000) {
      if (sched.i >= sched.evs.length) { if (sched.loop) { sched.cycle++; sched.i = 0; } else { sched.done = true; break; } }
      const ev = sched.evs[sched.i];
      const when = audioStart + (sched.cycle * sched.total + ev.beat) * spb;
      if (when >= horizon) break;
      if (when >= actx.currentTime - 0.02) fireEvent(ev, when);
      sched.i++;
    }
    if (sched.done && !sched.loop) { const endTime = audioStart + sched.total * spb; if (actx.currentTime >= endTime) stop(); }
  }
  function fireEvent(ev, when) {
    if (ev.type === 'click') clickSound(ev.strong, when);
    else if (ev.type === 'chord') chordSound(ev.chord, ev.soft, when);
    else if (ev.type === 'mel') melSound(ev.note, ev.durBeats, when);
  }
  function paint() {
    if (!state.playing) return;
    if (actx) { const spb = 60 / state.bpm; let b = (actx.currentTime - audioStart) / spb; if (b < 0) b = 0; b = (sched && sched.loop) ? (b % sched.total) : Math.min(b, sched ? sched.total : b); state.playBeat = b; }
    if (state.playMode === 'song') updateSongPlayhead(); else if (sched && sched.line) updatePlayhead(sched.line, sched.total, state.playBeat);
    rafId = requestAnimationFrame(paint);
  }
  // .chip.playing / .chip.preglow are PRESERVED hooks toggled imperatively here (invisible to render-template scans) — do not prune
  function clearPlayheads() {
    document.querySelectorAll('.chip.playing, .chip.preglow').forEach((c) => c.classList.remove('playing', 'preglow'));
    document.querySelectorAll('.tl-ph, .stacked-ph').forEach((p) => { p.style.display = 'none'; });
    document.querySelectorAll('.barcell.activebar').forEach((c) => c.classList.remove('activebar'));
  }
  // segs MUST stay contiguous and ordered by .off
  function updateSongPlayhead() { if (!sched || !sched.segs) return; let seg = sched.segs[sched.segs.length - 1]; for (const s of sched.segs) { if (state.playBeat < s.end) { seg = s; break; } } updatePlayhead(seg.line, M.axisBeats(seg.line), state.playBeat - seg.off); }
  function updatePlayhead(line, axis, beatInLine) {
    if (beatInLine === undefined) beatInLine = state.playBeat;
    const card = document.querySelector(`.linecard[data-line="${line.id}"]`); if (!card) return;
    clearPlayheads();
    const active = M.chordAtBeat(line, beatInLine); if (!active) return; const next = line.chords.filter((c) => !c.rest && (c.start || 0) > (active.start || 0)).sort((a, b) => (a.start || 0) - (b.start || 0))[0];
    const a = card.querySelector(`[data-chipfor="${active.id}"]`); if (a) a.classList.add('playing');
    if (next) { const n = card.querySelector(`[data-chipfor="${next.id}"]`); if (n) n.classList.add('preglow'); }
    const frac = Math.max(0, Math.min(1, beatInLine / axis));
    if (line.mode === 'timeline') {
      const ph = card.querySelector('.tl-ph'); if (ph) { ph.style.display = 'block'; ph.style.left = `calc(var(--gut, 58px) + (100% - var(--gut, 58px)) * ${frac})`; }
    } else {
      const bp = M.bpb(line);
      const ph = card.querySelector('.stacked-ph'); const cell = card.querySelector(`.barcell[data-bar="${Math.floor(beatInLine / bp) + 1}"]`); const body = card.querySelector('.linebody');
      if (ph && cell && body) { cell.classList.add('activebar'); const cr = cell.getBoundingClientRect(); const br = body.getBoundingClientRect(); const within = (beatInLine % bp) / bp; ph.style.display = 'block'; ph.style.left = (cr.left - br.left + within * cr.width) + 'px'; ph.style.top = (cr.top - br.top) + 'px'; ph.style.height = cr.height + 'px'; }
    }
  }

  // ---- audio (master bus + compressor, click-free envelopes) ----------------
  let actx = null, masterGain = null;
  function ensureAudio() { if (actx) { if (actx.state === 'suspended') actx.resume(); return; } try { actx = new (window.AudioContext || window.webkitAudioContext)(); const comp = actx.createDynamicsCompressor(); masterGain = actx.createGain(); masterGain.gain.value = 0.9; masterGain.connect(comp); comp.connect(actx.destination); } catch (e) { actx = null; } }
  function out() { return masterGain || actx.destination; }
  function clickSound(strong, when) { if (!actx || state.muted) return; const t = when || actx.currentTime; const o = actx.createOscillator(); const g = actx.createGain(); o.type = 'square'; o.frequency.value = strong ? 1500 : 1000; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(strong ? 0.05 : 0.025, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(g).connect(out()); o.start(t); o.stop(t + 0.07); }
  function chordSound(chord, soft, when) { if (!actx || state.muted || chord.rest) return; const t = when || actx.currentTime; const spb = 60 / state.bpm; const dur = spb * Math.max(0.5, chord.beats || 4) * 0.95; const master = actx.createGain(); const vol = soft ? 0.04 : 0.07; master.gain.setValueAtTime(0.0001, t); master.gain.linearRampToValueAtTime(vol, t + 0.014); master.gain.setValueAtTime(vol, t + Math.max(0.03, dur * 0.55)); master.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08); master.connect(out()); M.chordVoicing(chord.name, 4).forEach((mm) => { const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.value = M.midiToFreq(mm); o.connect(master); o.start(t); o.stop(t + dur + 0.12); }); }
  function melSound(n, durBeats, when) { if (!actx || state.muted) return; const midi = M.degMidi(n.d, n.o, n.acc, M.PC[state.key], state.minor); const t = when || actx.currentTime; const dur = Math.max(0.15, durBeats * 60 / state.bpm * 0.9); const o = actx.createOscillator(); const g = actx.createGain(); o.type = 'sawtooth'; o.frequency.value = M.midiToFreq(midi); const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1, t + 0.012); g.gain.setValueAtTime(0.1, t + Math.max(0.03, dur * 0.5)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05); o.connect(lp).connect(g).connect(out()); o.start(t); o.stop(t + dur + 0.08); }

  function previewMel(n) { ensureAudio(); if (!actx) return; melSound(n, 1, actx.currentTime); }

  // ---- toast ----------------------------------------------------------------
  let toEl = null, toTimer = null;
  function toast(msg) { if (!toEl) { toEl = document.createElement('div'); toEl.className = 'uz-toast'; document.body.appendChild(toEl); } toEl.textContent = msg; toEl.classList.add('show'); clearTimeout(toTimer); toTimer = setTimeout(() => toEl.classList.remove('show'), 1600); }

  render();
})();
