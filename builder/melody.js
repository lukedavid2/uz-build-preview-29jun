/* melody.js — scale-degree sketchpad lane for the unified ruler.
   Mirrors production melody.js: degree rows (2/3 octaves), 8th/16th resolution,
   degrees↔notes labels, chord-tone / key-scale tinting, suggest-contour ghosts,
   20-step undo, →tab. Adds an optional chromatic row mode. */
(function () {
  'use strict';
  const M = window.MODEL;
  const ROW_H = 22;

  // build the row list (top = highest pitch). s = semitones above key tonic at o0.
  function rows(line, keyPc, minor) {
    const oct = line.melOctaves || 2;
    const chrom = !!line.melChromatic;
    const sc = M.scaleSemis(minor);
    const degOf = {}; sc.forEach((s, i) => { degOf[s] = i + 1; });
    const out = [];
    for (let s = oct * 12; s >= 0; s--) {
      const rel = ((s % 12) + 12) % 12;
      const inScale = degOf[rel] !== undefined;
      if (!chrom && !inScale) continue;
      out.push({ s, midi: 60 + keyPc + s, rel, inScale, tonic: rel === 0, d: inScale ? degOf[rel] : null, o: Math.floor(s / 12) });
    }
    return out;
  }
  function rowIndexForNote(rs, n, keyPc, minor) {
    // exact raw-semitone match: an off-scale acc!=0 note yields -1 (caller pins it to the nearest edge row + .offgrid so it stays visible/selectable).
    const s = M.degSemis(n.d, n.o, n.acc, minor);
    return rs.findIndex((r) => r.s === s);
  }
  // resolve a render row: exact match, else pin to the nearest edge row and mark it off-grid (render-only; stored d/o/acc untouched).
  function rowFor(rs, n, keyPc, minor) {
    const ri = rowIndexForNote(rs, n, keyPc, minor);
    if (ri >= 0) return { ri, offgrid: false };
    if (!rs.length) return { ri: 0, offgrid: true };
    const s = M.degSemis(n.d, n.o, n.acc, minor);
    // rs is ordered top = highest pitch (largest s) → bottom = lowest. Pin above-grid to top, below-grid (or chromatic gap) to nearest edge.
    const pinned = s > rs[0].s ? 0 : rs.length - 1;
    return { ri: pinned, offgrid: true };
  }

  function toolbar(state, line) {
    const L = line.id;
    const b = (act, txt, on, title) => `<span class="mel-tb-btn${on ? ' on' : ''}" data-action="${act}" data-line="${L}" title="${title}">${txt}</span>`;
    const ned = editor(state, line);
    return `<div class="lane-toolbar mel-toolbar">
      <span class="lane-tag">✏ Melody</span>
      ${b('melLabelToggle', line.melLabel === 'notes' ? 'Notes' : 'Deg', false, 'degrees ↔ note names')}
      ${b('melRes8', '8ths', (line.melRes || 8) === 8, '8th-note grid')}
      ${b('melRes16', '16ths', line.melRes === 16, '16th-note grid')}
      ${b('melOct', '+8VA', (line.melOctaves || 2) === 3, 'add a third octave')}
      ${b('melChrom', '♯ Chr', !!line.melChromatic, 'add chromatic rows')}
      ${b('melTint', '◐ Tones', line.melTint !== false, 'chord-tone tinting')}
      ${b('melScale', '◑ Scale', !!line.melScale, 'key-scale tinting')}
      ${b('melSuggest', '✨ Suggest', !!(line.melGhosts && line.melGhosts.length), 'suggest a contour')}
      ${b('melUndo', '↶', false, 'undo (20 steps)')}
      ${b('melToTab', '→ Tab', false, 'write this melody into the tab')}
      ${ned ? `<span class="tb-div"></span>${ned}` : ''}
    </div>`;
  }

  function render(state, line) {
    const keyPc = M.PC[state.key];
    const rs = rows(line, keyPc, state.minor);
    const res = line.melRes || 8; const bp = M.bpb(line); const spb = bp * res / 4;
    const nbars = M.nbarsOf(line);
    const totalSlots = nbars * spb;
    const H = rs.length * ROW_H;
    const tintOn = line.melTint !== false;
    const scaleOn = !!line.melScale;

    // gutter labels: degree number + actual note name
    const gutter = rs.map((r, i) => {
      const nm = M.spell(((r.midi % 12) + 12) % 12, state.key);
      return `<div class="mel-rlabel${r.tonic ? ' tonic' : ''}" style="top:${i * ROW_H}px;height:${ROW_H}px">
        <span class="rg-deg">${r.d || '·'}</span><span class="rg-nm">${nm}</span></div>`;
    }).join('');

    // per-bar chord-tone / scale-tone reference (the actual notes)
    const scp = M.scalePcs(keyPc, state.minor);
    // R1-5: every chord overlapping the bar contributes a tone set (not just the downbeat chord);
    // 2-3 sets stack compactly. chordsIn(a,b) = chords whose [start,end) intersects [a,b).
    const chordsIn = (a, bz) => (line.chords || []).filter((c) => (c.start || 0) < bz - 1e-9 && (c.start || 0) + c.beats > a + 1e-9);
    const toneRow = Array.from({ length: nbars }, (_, bar) => {
      const chs = chordsIn(bar * bp, (bar + 1) * bp);
      const multi = chs.length > 1;
      const sets = chs.map((ch) => {
        const ct = M.chordPitchClasses(ch.name);
        const cts = ct.map((pc) => `<i class="tp ct">${M.spell(pc, state.key)}</i>`).join('');
        const scs = (scaleOn && !multi) ? scp.filter((pc) => ct.indexOf(pc) < 0).map((pc) => `<i class="tp sc">${M.spell(pc, state.key)}</i>`).join('') : '';
        return `<span class="mtone-set"><b>${ch.name}</b>${cts}${scs}</span>`;
      }).join('');
      return `<div class="mtone-bar${multi ? ' multi' : ''}" style="flex:0 0 ${1 / nbars * 100}%">${sets}</div>`;
    }).join('');
    const tonesRow = `<div class="mel-tones"><span class="mel-tone-gut"></span>${toneRow}</div>`;

    // per-bar tint rects (chord tones green; scale amber if enabled)
    // R1-5: scale tint spans the whole bar; chord-tone tint is drawn per chord SEGMENT (on top) so it
    // changes at a mid-bar chord boundary instead of staying on the downbeat chord.
    let tint = '';
    for (let bar = 0; bar < nbars; bar++) {
      const bx = bar / nbars * 100, bw = 1 / nbars * 100;
      if (scaleOn) rs.forEach((r, i) => { if (r.inScale) tint += `<div class="mel-tint sc" style="left:${bx}%;width:${bw}%;top:${i * ROW_H}px;height:${ROW_H}px"></div>`; });
      if (tintOn) chordsIn(bar * bp, (bar + 1) * bp).forEach((ch) => {
        const ct = M.chordPitchClasses(ch.name);
        const segS = Math.max(bar * bp, ch.start || 0), segE = Math.min((bar + 1) * bp, (ch.start || 0) + ch.beats);
        if (segE <= segS + 1e-9) return;                       // skip degenerate/zero-width segments
        const x = segS / (nbars * bp) * 100, w = (segE - segS) / (nbars * bp) * 100;
        rs.forEach((r, i) => { if (ct.indexOf(r.rel) >= 0) tint += `<div class="mel-tint ct" style="left:${x}%;width:${w}%;top:${i * ROW_H}px;height:${ROW_H}px"></div>`; });
      });
    }

    // slot gridlines as absolutely-positioned spans (percentage of content — aligns with bars, no drift)
    const slotLines = Array.from({ length: totalSlots + 1 }, (_, i) => `<span class="${i % spb === 0 ? 'bar' : ''}" style="left:${i / totalSlots * 100}%"></span>`).join('');

    // notes
    const notesHtml = line.notes.map((n) => {
      const { ri, offgrid } = rowFor(rs, n, keyPc, state.minor);
      const ch = M.chordAtBeat(line, n.bar * bp + n.slot * 4 / res);
      const midi = M.degMidi(n.d, n.o, n.acc, keyPc, state.minor);
      const tier = ch ? M.gradePitch(midi, ch.name, keyPc, state.minor) : 'scale';
      const inMulti = state.melSel && state.melSel.lane === 'mel' && state.melSel.lineId === line.id && state.melSel.ids.indexOf(n.id) >= 0;
      const sel = inMulti || (state.selNote && state.selNote.noteId === n.id && state.selNote.lane === 'mel');
      const x = (n.bar * spb + n.slot) / totalSlots * 100;
      const w = n.len / totalSlots * 100;
      const lbl = line.melLabel === 'notes' ? M.spell(((midi % 12) + 12) % 12, state.key) : (n.d || '');
      return `<div class="mel-note tier-${tier}${sel ? ' sel' : ''}${offgrid ? ' offgrid' : ''}" data-action="selMelNote" data-line="${line.id}" data-nid="${n.id}"
        style="left:${x}%;width:${w}%;top:${ri * ROW_H + 2}px;height:${ROW_H - 4}px">
        <span class="mel-lbl">${lbl}</span><span class="mel-rz" data-rz="1"></span></div>`;
    }).join('');

    // suggest ghosts
    const ghosts = (line.melGhosts || []).map((n) => {
      const { ri, offgrid } = rowFor(rs, n, keyPc, state.minor);
      const x = (n.bar * spb + n.slot) / totalSlots * 100;
      const w = n.len / totalSlots * 100;
      return `<div class="mel-note ghost${offgrid ? ' offgrid' : ''}" data-action="adoptGhost" data-line="${line.id}" data-gid="${n.id}"
        style="left:${x}%;width:${w}%;top:${ri * ROW_H + 2}px;height:${ROW_H - 4}px"><span class="mel-lbl">${n.d || ''}</span></div>`;
    }).join('');
    const ghostBar = (line.melGhosts && line.melGhosts.length)
      ? `<div class="ghost-actions"><span class="acceptbtn" data-action="ghostKeepAll" data-line="${line.id}">✓ Keep all</span>
         <span class="st-btn" data-action="melSuggest" data-line="${line.id}">↻ Another</span>
         <span class="st-btn" data-action="ghostHide" data-line="${line.id}">× Hide</span></div>` : '';

    return `<div class="mel-lane" data-mel="${line.id}">
      ${toolbar(state, line)}
      ${tonesRow}
      <div class="mel-gridwrap">
        <div class="mel-gutter" style="height:${H}px">${gutter}</div>
        <div class="mel-grid" data-line="${line.id}" data-res="${res}" data-spb="${spb}" data-nbars="${nbars}" data-rowh="${ROW_H}" data-rows="${rs.length}"
          style="height:${H}px;background-size:100% ${ROW_H}px">
          <div class="mel-slots">${slotLines}</div>
          <div class="mel-tints">${tint}</div>
          ${notesHtml}${ghosts}
        </div>
      </div>
      ${ghostBar}
    </div>`;
  }

  function editor(state, line) {
    const keyPc = M.PC[state.key];
    const rs = rows(line, keyPc, state.minor);
    return noteEditor(state, line, rs);
  }

  function noteEditor(state, line, rs) {
    if (!state.selNote || state.selNote.lane !== 'mel' || state.selNote.lineId !== line.id) return '';
    const n = line.notes.find((x) => x.id === state.selNote.noteId);
    if (!n) return '';
    const keyPc = M.PC[state.key];
    const midi = M.degMidi(n.d, n.o, n.acc, keyPc, state.minor);
    const nm = M.spell(((midi % 12) + 12) % 12, state.key);
    return `<div class="seltools melnote-edit">
      <span class="who">♪ degree ${n.d} <span style="color:var(--muted);font-weight:600;font-size:11px">${nm} · bar ${n.bar + 1}</span></span>
      <span class="lbl">Pitch:</span>
      <span class="st-btn" data-action="melNoteOct" data-line="${line.id}" data-nid="${n.id}" data-dir="1">▲ 8ve</span>
      <span class="st-btn" data-action="melNoteOct" data-line="${line.id}" data-nid="${n.id}" data-dir="-1">▼ 8ve</span>
      <span class="lbl">Length:</span>
      <span class="st-btn" data-action="melNoteLen" data-line="${line.id}" data-nid="${n.id}" data-dir="-1">−</span>
      <span class="fretval">${n.len}</span>
      <span class="st-btn" data-action="melNoteLen" data-line="${line.id}" data-nid="${n.id}" data-dir="1">＋</span>
      <span style="flex:1"></span>
      <span class="st-btn danger" data-action="melNoteDel" data-line="${line.id}" data-nid="${n.id}">× Delete</span>
    </div>`;
  }

  // ---- contour suggestion (rule-based, 4 patterns) --------------------------
  const PATTERNS = [
    [0, 2, 4, 2], [4, 2, 1, 0], [0, 1, 2, 4], [2, 4, 2, 0],
  ];
  let _lastPat = -1;
  function suggest(state, line) {
    const res = line.melRes || 8; const nbars = M.nbarsOf(line);
    const bp = M.bpb(line); const spb = bp * res / 4;
    const keyPc = M.PC[state.key]; const sc = M.scaleSemis(state.minor);
    let pi = Math.floor(Math.random() * (PATTERNS.length - 1)); if (pi >= _lastPat) pi++; _lastPat = pi;
    const pat = PATTERNS[pi];
    const g = [];
    for (let bar = 0; bar < nbars; bar++) {
      const steps = pat.length;
      for (let k = 0; k < steps; k++) {
        // R1-5: pick the safe note against the chord actually sounding at THIS note's beat
        // (not the bar downbeat), so a 2nd-half-of-bar ghost matches a mid-bar chord change.
        const sl = Math.round(k * spb / steps);                // the note's actual quantized slot…
        const ch = M.chordAtBeat(line, bar * bp + sl * 4 / res); // …so the chord matches where the note lands (correct in non-4/4 too)
        const tonePcs = ch ? M.chordPitchClasses(ch.name) : [keyPc];
        let degs = []; for (let d = 1; d <= 7; d++) if (tonePcs.indexOf((keyPc + sc[d - 1]) % 12) >= 0) degs.push(d);
        if (!degs.length) degs = [1, 3, 5];
        let deg = degs[Math.min(degs.length - 1, Math.round(pat[k] / 4 * (degs.length - 1)))];
        if (bar === nbars - 1 && k === steps - 1) deg = 1;        // resolve to the tonic
        const baseO = 1; const bumpO = pat[k] >= 4 ? baseO + 1 : baseO; // higher contour points jump an octave
        const maxS = (line.melOctaves || 2) * 12;
        const o = (12 * bumpO + sc[(deg - 1) % 7] <= maxS) ? bumpO : baseO; // keep ghost on a visible, adoptable row
        const note = M.note(bar, sl, Math.max(1, Math.round(spb / steps)), deg, o);
        note.id = M.uid('g'); g.push(note);
      }
    }
    line.melGhosts = g;
  }

  // ---- actions install ------------------------------------------------------
  function install(A, getState, render, pushUndo, toast) {
    const lof = (d) => M.lineById(getState(), d.line);
    const H = {
      melLabelToggle(d) { const l = lof(d); l.melLabel = l.melLabel === 'notes' ? 'degrees' : 'notes'; },
      melRes8(d) { const l = lof(d); rescale(l, 8); },
      melRes16(d) { const l = lof(d); rescale(l, 16); },
      melOct(d) { const l = lof(d); l.melOctaves = (l.melOctaves || 2) === 2 ? 3 : 2; },
      melChrom(d) { const l = lof(d); l.melChromatic = !l.melChromatic; },
      melTint(d) { const l = lof(d); l.melTint = l.melTint === false ? true : false; },
      melScale(d) { const l = lof(d); l.melScale = !l.melScale; },
      melSuggest(d) { suggest(getState(), lof(d)); },
      ghostKeepAll(d) { const l = lof(d); pushUndo(); (l.melGhosts || []).forEach((g) => { l.notes.push(Object.assign({}, g, { id: M.uid('n') })); }); l.melGhosts = []; l.melodyAuthored = true; },
      ghostHide(d) { lof(d).melGhosts = []; },
      adoptGhost(d) { const l = lof(d); const g = (l.melGhosts || []).find((x) => x.id === d.gid); if (g) { pushUndo(); l.notes.push(Object.assign({}, g, { id: M.uid('n') })); l.melGhosts = (l.melGhosts || []).filter((x) => x.id !== d.gid); l.melodyAuthored = true; } },
      melUndo() { pushUndo.pop && pushUndo.pop(); },
      melToTab(d) { const l = lof(d); l.tabAuthored = true; l.tabOpen = true; toast('Melody written into the tab'); },
      selMelNote(d, e) {
        const s = getState();
        if (e && e.shiftKey) { // shift-click toggles the note in the multi-selection (R1-6)
          if (!s.melSel || s.melSel.lane !== 'mel' || s.melSel.lineId !== d.line) s.melSel = { lane: 'mel', lineId: d.line, ids: [] };
          const i = s.melSel.ids.indexOf(d.nid); if (i >= 0) s.melSel.ids.splice(i, 1); else s.melSel.ids.push(d.nid);
          s.selNote = null; return;
        }
        s.selNote = { lane: 'mel', lineId: d.line, noteId: d.nid }; s.selection = { lineId: null, ids: [] }; s.melSel = null;
      },
      melNoteOct(d) { const l = lof(d); const n = l.notes.find((x) => x.id === d.nid); if (n) { pushUndo(); n.o = Math.max(0, Math.min((l.melOctaves || 2), n.o + (+d.dir))); } },
      melNoteLen(d) { const l = lof(d); const n = l.notes.find((x) => x.id === d.nid); if (n) { pushUndo(); n.len = Math.max(1, n.len + (+d.dir)); } },
      melNoteDel(d) { const l = lof(d); pushUndo(); l.notes = l.notes.filter((x) => x.id !== d.nid); getState().selNote = null; },
    };
    Object.keys(H).forEach((k) => { A[k] = (d, e) => { H[k](d, e); render(); }; });
  }
  function rescale(line, res) {
    const old = line.melRes || 8; if (old === res) return;
    const f = res / old;
    line.notes.forEach((n) => { n.slot = Math.round(n.slot * f); n.len = Math.max(1, Math.round(n.len * f)); });
    line.melRes = res;
    mono(line, M.bpb(line) * res / 4);   // de-dup colliding onsets + trim sustains; mono keys by slots-per-bar (spb), not raw res
  }

  // enforce a monophonic line: one note per onset column, and trim a note that sustains into the next
  function mono(line, spb) {
    const seen = {};
    for (let i = line.notes.length - 1; i >= 0; i--) { const n = line.notes[i]; const k = n.bar * spb + n.slot; if (seen[k]) line.notes.splice(i, 1); else seen[k] = true; }
    const ns = line.notes.slice().sort((a, b) => (a.bar * spb + a.slot) - (b.bar * spb + b.slot));
    for (let i = 0; i < ns.length - 1; i++) { const cs = ns[i].bar * spb + ns[i].slot, nx = ns[i + 1].bar * spb + ns[i + 1].slot; if (cs + ns[i].len > nx) ns[i].len = Math.max(1, nx - cs); }
  }
  // pointer drag (add / move / resize) — direct-DOM during the drag, one render on commit
  function installPointer(getState, render, pushUndo, preview) {
    let drag = null;
    document.addEventListener('pointerdown', (e) => {
      const grid = e.target.closest('.mel-grid'); if (!grid) return;
      const st = getState(); const line = M.lineById(st, grid.dataset.line); if (!line) return;
      const rect = grid.getBoundingClientRect();
      const res = +grid.dataset.res, nbars = +grid.dataset.nbars, rowh = +grid.dataset.rowh; const spb = (+grid.dataset.spb) || res;
      const totalSlots = nbars * spb; const slotPx = rect.width / totalSlots;
      const rs = rows(line, M.PC[st.key], st.minor);
      const noteEl = e.target.closest('.mel-note');
      if (noteEl && noteEl.dataset.action === 'selMelNote') {
        const n = line.notes.find((x) => x.id === noteEl.dataset.nid); if (!n) return;
        e.preventDefault();
        const ri0 = rowIndexForNote(rs, n, M.PC[st.key], st.minor);
        pushUndo();
        drag = { mode: e.target.dataset.rz ? 'resize' : 'move', n, line, el: noteEl, rs, rowh, slotPx, totalSlots, res, spb, x0: e.clientX, y0: e.clientY, sb: n.bar, ss: n.slot, sl: n.len, ri0, moved: false, pending: null };
      } else if (!noteEl) {
        e.preventDefault();
        // empty-grid: a TAP adds a note; a DRAG draws a marquee selection (R1-6) — these don't conflict
        drag = { mode: 'add', line, rs, rect, grid, res, spb, rowh, totalSlots, slotPx, x: e.clientX, y: e.clientY, moved: false };
      }
    });
    document.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.abs(e.clientX - (drag.x0 ?? drag.x)) > 4 || Math.abs(e.clientY - (drag.y0 ?? drag.y)) > 4) drag.moved = true;
      if (drag.mode === 'add') {                                // marquee box while dragging on empty grid
        if (!drag.moved) return;
        const rect = drag.rect;
        const left = Math.min(drag.x, e.clientX) - rect.left, top = Math.min(drag.y, e.clientY) - rect.top;
        if (!drag.box) { drag.box = document.createElement('div'); drag.box.className = 'mel-marquee'; drag.grid.appendChild(drag.box); }
        drag.box.style.left = left + 'px'; drag.box.style.top = top + 'px';
        drag.box.style.width = Math.abs(e.clientX - drag.x) + 'px'; drag.box.style.height = Math.abs(e.clientY - drag.y) + 'px';
        return;
      }
      if (!drag.moved) return;
      if (drag.mode === 'move') {
        const ds = Math.round((e.clientX - drag.x0) / drag.slotPx);
        const dr = Math.round((e.clientY - drag.y0) / drag.rowh);
        let abs = drag.sb * drag.spb + drag.ss + ds; abs = Math.max(0, Math.min(drag.totalSlots - drag.n.len, abs));
        const ri = Math.max(0, Math.min(drag.rs.length - 1, drag.ri0 + dr));
        drag.pending = { abs, ri };
        if (drag.el) { drag.el.style.left = (abs / drag.totalSlots * 100) + '%'; drag.el.style.top = (ri * ROW_H + 2) + 'px'; }
      } else if (drag.mode === 'resize') {
        const dl = Math.round((e.clientX - drag.x0) / drag.slotPx);
        const len = Math.max(1, Math.min(drag.totalSlots - (drag.sb * drag.spb + drag.ss), drag.sl + dl));
        drag.pending = { len };
        if (drag.el) drag.el.style.width = (len / drag.totalSlots * 100) + '%';
      }
    });
    document.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const st = getState();
      if (drag.mode === 'add' && drag.moved) {                  // marquee → select enclosed notes (R1-6)
        const rect = drag.rect;
        const slot0 = (Math.min(drag.x, e.clientX) - rect.left) / drag.slotPx, slot1 = (Math.max(drag.x, e.clientX) - rect.left) / drag.slotPx;
        const row0 = Math.max(0, Math.floor((Math.min(drag.y, e.clientY) - rect.top) / drag.rowh));
        const row1 = Math.min(drag.rs.length - 1, Math.floor((Math.max(drag.y, e.clientY) - rect.top) / drag.rowh));
        const ids = [];
        drag.line.notes.forEach((n) => {
          const ns = n.bar * drag.spb + n.slot, ne = ns + (n.len || 1);
          const ri = rowIndexForNote(drag.rs, n, M.PC[st.key], st.minor);
          if (ne > slot0 && ns < slot1 && ri >= row0 && ri <= row1) ids.push(n.id);
        });
        st.melSel = ids.length ? { lane: 'mel', lineId: drag.line.id, ids: ids } : null; st.selNote = null;
        if (drag.box) drag.box.remove();
        render();
      } else if (drag.mode === 'add' && !drag.moved) {
        const xrel = (e.clientX - drag.rect.left) / drag.rect.width;
        const yrel = (e.clientY - drag.rect.top);
        const abs = Math.max(0, Math.min(drag.totalSlots - 1, Math.floor(xrel * drag.totalSlots)));
        const ri = Math.max(0, Math.floor(yrel / drag.rowh));
        const r = drag.rs[Math.min(ri, drag.rs.length - 1)];
        if (r) { pushUndo(); const n = M.note(Math.floor(abs / drag.spb), abs % drag.spb, 1, r.d || 1, r.o, 0); drag.line.notes.push(n); mono(drag.line, drag.spb); drag.line.melodyAuthored = true; st.selNote = { lane: 'mel', lineId: drag.line.id, noteId: n.id }; st.melSel = null; if (preview) preview(n); render(); }
      } else if (drag.moved && drag.pending) {
        const n = drag.n;
        if (drag.mode === 'move') { n.bar = Math.floor(drag.pending.abs / drag.spb); n.slot = drag.pending.abs % drag.spb; const r = drag.rs[drag.pending.ri]; if (r && r.d) { n.d = r.d; n.o = r.o; n.acc = 0; } if (preview) preview(n); }
        else if (drag.mode === 'resize') { n.len = drag.pending.len; }
        mono(drag.line, drag.spb); render();
      }
      drag = null;
    });
  }
  window.MELODY = { render, install, installPointer, ROW_H };
})();
