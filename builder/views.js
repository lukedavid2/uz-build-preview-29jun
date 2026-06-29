/* views.js — chord-builder shell: chips, stacked bars, the shared-ruler timeline
   (chords + tab + melody in one scroll), functional palette, transport. Pure
   render — no mutation. Tab/melody lanes come from window.TAB / window.MELODY. */
(function () {
  'use strict';
  const M = window.MODEL;
  const GUT = 58;

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // abstract dot (half-bar chips) ------------------------------------------------
  function dotDiag(name) {
    const h = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const pts = [];
    for (let i = 0; i < 3; i++) pts.push([22 + ((h * (i + 3)) % 56), 16 + ((h * (i + 5)) % 64)]);
    return `<span class="minidiag">${pts.map((d) => `<i style="left:${d[0]}%;top:${d[1]}%"></i>`).join('')}</span>`;
  }
  // real fingering grid (stacked / full-bar chips) -------------------------------
  function shapeDiagram(shape) {
    if (!shape) return '';
    const order = [5, 4, 3, 2, 1, 0]; // render low E … high e left→right
    const nFret = 4;
    let markers = '', dots = '';
    order.forEach((si, col) => {
      const f = shape.frets[si];
      const mk = f === null ? '✕' : f === 0 ? '○' : '';
      markers += `<span class="sd-mk" style="left:${(col + 0.5) / 6 * 100}%">${mk}</span>`;
      if (f && f > 0) {
        const row = Math.min(nFret, f - (shape.baseFret || 0));
        dots += `<span class="sd-dot" style="left:${(col + 0.5) / 6 * 100}%;top:${(row - 0.5) / nFret * 100}%"></span>`;
      }
    });
    return `<span class="shape-grid">
      <span class="sd-markers">${markers}</span>
      <span class="sd-fb">${dots}</span></span>`;
  }

  function shapeEditor(line, c) {
    const L = line.id, C = c.id;
    const sh = c.shape || M.defaultShape(c.name) || { frets: [null, null, null, null, null, null], baseFret: 0 };
    const order = [5, 4, 3, 2, 1, 0]; // low E … high e, matching shapeDiagram
    const rows = order.map((si) => {
      const f = sh.frets[si];
      const val = f === null ? '✕' : (f === 0 ? '○' : f);
      return `<span class="shr${f === null ? ' muted' : ''}">
        <span class="shr-lbl">${M.STRING_LBL[si]}</span>
        <span class="st-btn mini" data-action="shapeFret" data-line="${L}" data-cid="${C}" data-string="${si}" data-dir="-1">−</span>
        <span class="shr-val">${val}</span>
        <span class="st-btn mini" data-action="shapeFret" data-line="${L}" data-cid="${C}" data-string="${si}" data-dir="1">＋</span>
        <span class="st-btn mini mute" data-action="shapeMute" data-line="${L}" data-cid="${C}" data-string="${si}" title="mute string">✕</span>
      </span>`;
    }).join('');
    return `<div class="shape-editor">
      <span class="lane-tag">Fingering · ${escapeHTML(c.name)}</span>
      <div class="shr-grid">${rows}</div>
      <span class="st-btn" data-action="shapeAuto" data-line="${L}" data-cid="${C}" title="auto-fit an open-position shape">↺ Auto-fit</span>
      <span class="st-btn" data-action="editChordShape" data-line="${L}" data-cid="${C}">Done</span>
    </div>`;
  }

  function isSel(state, line, id) { return state.selection.lineId === line.id && state.selection.ids.indexOf(id) >= 0; }

  function chipHTML(state, line, chord, opts) {
    opts = opts || {};
    const sel = isSel(state, line, chord.id);
    const single = sel && state.selection.ids.length === 1;
    const cls = ['chip', 'anatomy3'];
    if (chord.cat) cls.push(chord.cat);
    if (sel) cls.push('sel');
    if (opts.short) cls.push('short');
    const _bp = M.bpb(line); const dur = (chord.beats % _bp === 0) ? (chord.beats / _bp) + (chord.beats / _bp > 1 ? ' bars' : ' bar') : chord.beats + '\u2669';
    // diagram: real grid (full bar) · ♦ dot (half bar) · +shape affordance (none yet)
    let dgm;
    if (opts.short) dgm = `<span class="shapedot" data-action="editChordShape" data-line="${line.id}" data-cid="${chord.id}">\u2666</span>`;
    else if (chord.shape) dgm = `<span class="shape-grid-wrap">${shapeDiagram(chord.shape)}</span>`;
    else { const sh = M.defaultShape(chord.name); dgm = sh ? `<span class="shape-grid-wrap">${shapeDiagram(sh)}</span>` : `<span class="shape-grid-wrap muted">${dotDiag(chord.name)}</span>`; }
    // small explicit edit pip — only this opens the fingering editor (chip body now selects)
    const editPip = opts.short ? '' : `<span class="chord-shape-btn" data-action="editChordShape" data-line="${line.id}" data-cid="${chord.id}" title="edit fingering">\u2666</span>`;
    const handle = single ? `<span class="handle handle-l" data-action="resizeStartLeft" data-line="${line.id}" data-cid="${chord.id}" title="drag the start (end stays put)"></span><span class="handle handle-r" data-action="resizeStart" data-line="${line.id}" data-cid="${chord.id}" title="drag to resize the end"></span>` : '';
    const badge = `<span class="durbadge" data-action="cycleDur" data-line="${line.id}" data-cid="${chord.id}" title="tap to cycle length">${dur}</span>`;
    return `<div class="${cls.join(' ')}" data-action="selectChord" data-line="${line.id}" data-cid="${chord.id}" data-chipfor="${chord.id}">
      ${opts.short ? '' : dgm}${editPip}
      <span class="chip-id"><span class="nm">${escapeHTML(chord.name)}</span><span class="rm">${escapeHTML(chord.roman)}</span></span>
      ${badge}${handle}${opts.short ? dgm : ''}</div>`;
  }

  function stackedBody(state, line) {
    const axis = M.axisBeats(line), nb = M.nbarsOf(line);
    const cells = Array.from({ length: nb }, (_, i) => `<div class="barcell" data-bar="${i + 1}"><span class="barnum">BAR ${i + 1}</span></div>`).join('');
    const chips = line.chords.map((c) => `<div class="chip-pos" style="left:${(c.start || 0) / axis * 100}%;width:${c.beats / axis * 100}%">${chipHTML(state, line, c, { short: c.beats <= 2 })}</div>`).join('');
    // min-width floor per bar keeps chord names readable on narrow viewports; the .stacked-scroll
    // wrapper scrolls horizontally when bars hit the floor. grid is 1fr so it still fills wide canvases.
    // chips-abs (left:0;right:0) shares the stacked-wrap width, so the %-positioned chips stay aligned.
    return `<div class="stacked-scroll"><div class="stacked-wrap" style="min-width:${nb * 78}px"><div class="bargrid-bg" style="grid-template-columns:repeat(${nb}, 1fr)">${cells}</div><div class="chips-abs">${chips}</div></div></div>
      <div class="stacked-addrow"><span class="addbar-btn" data-action="addBar" data-line="${line.id}">＋ Add bar</span></div>`;
  }

  // ---- shared-ruler timeline ------------------------------------------------
  function timelineBody(state, line) {
    const axis = M.axisBeats(line); const nbars = M.nbarsOf(line); const bp = M.bpb(line);
    const ruler = Array.from({ length: nbars }, (_, i) => `<span style="flex:0 0 ${bp / axis * 100}%">${i + 1}</span>`).join('');
    const gridlines = `<div class="tl-grid">${Array.from({ length: axis + 1 }, (_, i) => `<span class="${i % bp === 0 ? 'bar' : 'beat'}" style="left:${i / axis * 100}%"></span>`).join('')}</div>`;
    const chips = line.chords.map((c) => `<div class="chip-pos" style="left:${(c.start || 0) / axis * 100}%;width:${c.beats / axis * 100}%">${chipHTML(state, line, c, { short: c.beats <= 2 })}</div>`).join('');
    const tabLane = line.tabOpen ? window.TAB.render(state, line) : '';
    const melLane = line.melodyOpen ? window.MELODY.render(state, line) : '';
    const zoom = line.zoom || 1;
    const innerW = `width:${Math.max(1, nbars) * 132 * zoom}px;min-width:100%`;
    const zoombar = `<div class="tl-zoombar">
      <span class="zoombtn" data-action="zoomOut" data-line="${line.id}">−</span>
      <span class="zoomval">${Math.round(zoom * 100)}%</span>
      <span class="zoombtn" data-action="zoomIn" data-line="${line.id}">＋</span>
      <span class="zoomgap"></span>
      <span class="zoombtn" data-action="panLeft" data-line="${line.id}" title="scroll left">◂</span>
      <span class="zoombtn" data-action="panRight" data-line="${line.id}" title="scroll right">▸</span>
      <span style="flex:1"></span>
      <span class="addbar-btn" data-action="addBar" data-line="${line.id}">＋ Add bar</span></div>`;
    return `${zoombar}<div class="tl-scroll" data-scroll="${line.id}"><div class="lanes tl-inner" data-linebody="${line.id}" style="${innerW}">
      ${gridlines}
      <div class="lanerow"><span class="lane-gutter"></span><div class="bigruler">${ruler}</div></div>
      <div class="lanerow"><span class="lane-label">Chords</span><div class="strip-body tl-strip chords-abs">${chips}</div></div>
      ${tabLane}${melLane}
      <span class="ph tl-ph" style="display:none"></span>
    </div></div>`;
  }

  // ---- selected-chip editor (multi + single + rest) -------------------------
  function selEditor(state, line) {
    const seln = state.selection;
    if (seln.lineId !== line.id || !seln.ids.length) return '';
    const chords = seln.ids.map((id) => line.chords.find((x) => x.id === id)).filter(Boolean);
    if (!chords.length) return '';
    const L = line.id;
    if (chords.length > 1) {
      const bp = M.bpb(line);
      const lb = (b, t) => `<span class="st-btn" data-action="setLenSel" data-line="${L}" data-beats="${b}">${t}</span>`;
      return `<div class="seltools"><span class="lane-tag">Chords</span>
        <span class="who">${chords.length} chords selected</span>
        <span class="lbl">length:</span>${lb(bp / 2, '½')}${lb(bp, '1')}${lb(bp * 2, '2')}
        <span style="flex:1"></span>
        <span class="st-btn" data-action="copySel" data-line="${L}">⧉ Copy</span>
        <span class="st-btn" data-action="dupSel" data-line="${L}">＋ Duplicate</span>
        <span class="st-btn" data-action="blankSel" data-line="${L}">⌫ Blank</span>
        <span class="st-btn danger" data-action="removeSel" data-line="${L}">× Remove</span>
        <span class="st-btn" data-action="clearSel">Done</span></div>`;
    }
    const c = chords[0]; const C = c.id;
    const lb = (b, t) => `<span class="st-btn${c.beats === b ? ' on' : ''}" data-action="setLen" data-line="${L}" data-cid="${C}" data-beats="${b}">${t}</span>`;
    const bp = M.bpb(line);
    return `<div class="seltools"><span class="lane-tag">Chords</span>
      <span class="who">${escapeHTML(c.name)} <span style="color:var(--muted);font-weight:600;font-size:11px">${escapeHTML(c.roman)}</span></span>
      <span class="lbl">Length:</span>
      <span class="st-btn" data-action="nudgeLen" data-line="${L}" data-cid="${C}" data-d="-0.5">−</span>
      <span class="fretval">${c.beats}\u2669</span>
      <span class="st-btn" data-action="nudgeLen" data-line="${L}" data-cid="${C}" data-d="0.5">＋</span>
      ${lb(bp / 2, '½ bar')}${lb(bp, '1 bar')}${lb(bp * 2, '2 bars')}
      <span style="width:8px"></span>
      <span class="lbl">Starts on beat:</span>
      <span class="st-btn" data-action="nudgeStart" data-line="${L}" data-cid="${C}" data-d="-0.5">−</span>
      <span class="fretval">${(c.start || 0) + 1}</span>
      <span class="st-btn" data-action="nudgeStart" data-line="${L}" data-cid="${C}" data-d="0.5">＋</span>
      <span style="width:8px"></span>
      <span class="lbl">Accent:</span>
      ${(() => { const a = c.accent || 'normal'; const next = { normal: 'stop', stop: 'push', push: 'normal' }[a]; const lbl = { normal: 'Normal', stop: 'Stop', push: 'Push' }[a]; return `<span class="st-btn${a !== 'normal' ? ' on' : ''}" data-action="setAccent" data-line="${L}" data-cid="${C}" data-acc="${next}" title="cycle accent: normal → stop → push">${lbl}</span>`; })()}
      <span style="flex:1"></span>
      <span class="st-btn" data-action="copySel" data-line="${L}">⧉ Copy</span>
      <span class="st-btn" data-action="dupChord" data-line="${L}" data-cid="${C}">＋ Duplicate</span>
      <span class="st-btn danger" data-action="removeChord" data-line="${L}" data-cid="${C}">× Remove</span></div>`;
  }

  function lineHeader(state, line) {
    const bars = M.nbarsOf(line);
    const mode = (m, t) => `<span class="${line.mode === m ? 'on' : ''}" data-action="setMode" data-line="${line.id}" data-mode="${m}">${t}</span>`;
    const paste = state.clipboard.length ? `<span class="lh-btn paste" data-action="pasteInto" data-line="${line.id}">📋 Paste ${state.clipboard.length}</span>` : '';
    return `<div class="lineheader">
      <span class="lh-grip" draggable="true" data-grip="${line.id}" title="drag to reorder">⠿</span>
      <span class="lh-btn play${state.playing && state.playMode === 'line' && state.playLineId === line.id ? ' on' : ''}" data-action="playSection" data-line="${line.id}" title="play just this section">▶</span>
      ${state.renamingLine === line.id
        ? `<input class="lh-name-input" data-rename="${line.id}" value="${escapeHTML(line.name)}" />`
        : `<span class="lh-name" data-action="playLine" data-line="${line.id}">${escapeHTML(line.name)}</span><span class="lh-rename" data-action="renameLine" data-line="${line.id}" title="rename section">✎</span>`}
      <span class="lh-bars">${bars} bars</span>
      <select class="uz-select meter-select" data-change="setMeter" data-line="${line.id}" title="beats per bar">${[2,3,4,5,6,7].map((b) => `<option value="${b}"${M.bpb(line) === b ? ' selected' : ''}>${b}/4</option>`).join('')}</select>
      <span class="lh-btn loop${line.loop !== false ? ' on' : ''}" data-action="toggleLineLoop" data-line="${line.id}" title="loop just this section (∞) while you work on it">🔁 Loop ∞</span>
      <span class="lh-spacer"></span>
      <span class="modeswitch">${mode('stacked', '▦ Stacked')}${mode('timeline', '▭ Timeline')}</span>
      ${paste}
      <span class="lh-btn${line.tabOpen ? ' on' : ''}" data-action="toggleTab" data-line="${line.id}">♫ Tab</span>
      <span class="lh-btn${line.melodyOpen ? ' on' : ''}" data-action="toggleMelody" data-line="${line.id}">✏ Melody</span>
      <span class="lh-btn" data-action="removeLine" data-line="${line.id}" title="remove section">×</span></div>`;
  }

  function lineCard(state, line) {
    const timeline = line.mode === 'timeline';
    const body = timeline ? timelineBody(state, line) : stackedBody(state, line);
    const cur = state.currentLine === line.id ? ' current' : '';
    const phStacked = !timeline ? '<span class="ph stacked-ph" style="display:none"></span>' : '';
    return `<div class="linecard${cur}" data-line="${line.id}">
      ${lineHeader(state, line)}
      ${selEditor(state, line)}
      <div class="linebody" style="position:relative">${body}${phStacked}</div></div>`;
  }

  function transport(state) {
    return `<div class="uzcard transport-card">
      <div class="transport">
        <span class="t-loop${state.playing ? ' stop' : ''}" data-action="togglePlay">${state.playing ? '■ Stop' : '▶ Play Song'}</span>
        <span class="t-chip mini${state.loopSong ? ' on' : ''}" data-action="toggleLoopSong" title="loop the whole song">🔁 Song</span>
        <span class="t-chip">${state.style}</span>
        <span class="t-bpm">BPM <input type="range" class="bpm-range" min="60" max="180" value="${state.bpm}" data-change="bpm" /> <b>${state.bpm}</b></span>
        <span class="t-chip mini selbtn${state.selectMode ? ' on' : ''}" data-action="toggleSelectMode" title="tap chords to multi-select (touch-friendly)">☑ Select</span>
        <span style="flex:1"></span>
        <span class="t-chip mini${state.muted ? ' on' : ''}" data-action="toggleMute">${state.muted ? '🔇' : '🔊'}</span>
      </div>
      <div class="sharebar"><span class="t-chip share-btn" data-action="copyShare" title="copy a shareable link">🔗 Share progression</span></div></div>`;
  }

  function palette(state) {
    const groups = M.paletteFor(state.key, state.minor);
    const lab = state.palLabel === 'notes' ? 'notes' : 'degrees';
    const grpHtml = groups.map((g) => {
      const chords = g.chords.map((c) => `<span class="pal-btn ${c.cat || ''}" data-action="addChord" data-name="${escapeHTML(c.name)}" data-roman="${escapeHTML(c.roman)}" data-cat="${c.cat || ''}">${escapeHTML(c.name)}${lab === 'degrees' ? `<span class="deg">${escapeHTML(c.roman)}</span>` : ''}</span>`).join('');
      return `<div class="pal-group"><div class="pal-grouplbl">${g.label}${g.hint ? ` <span class="pal-hint">· ${g.hint}</span>` : ''}</div><div class="pal-row">${chords}</div></div>`;
    }).join('');
    const cur = M.lineById(state, state.currentLine);
    const target = cur ? `adds to “${escapeHTML(cur.name)}”` : 'select a section above';
    return `<div class="uzcard palette">
      <div class="palette-head"><div class="uzlabel" style="margin:0">Add chords · grouped by function → ${target}</div>
        <span class="modeswitch tiny"><span class="${lab === 'degrees' ? 'on' : ''}" data-action="palDegrees">DEGREES</span><span class="${lab === 'notes' ? 'on' : ''}" data-action="palNotes">NOTES</span></span></div>
      ${grpHtml}</div>`;
  }

  function app(state) {
    return `<div class="appwrap${state.minor ? ' darkwrap' : ''}${state.selectMode ? ' select-mode' : ''}">
      <div class="apphead">
        <div class="apptitle">Builder <em>Lab</em> <span class="badge">PROTOTYPE</span></div>
        <a class="backlink" href="#" onclick="return false">← Design canvas</a></div>
      ${transport(state)}
      <div class="lines">${state.lines.map((l) => lineCard(state, l)).join('')}
        <span class="addline" data-action="addLine">＋ Add section</span></div>
      ${palette(state)}
      <div class="hintbar"><b>Open ♫ Tab / ✏ Melody</b> to unfold one shared ruler · click the grid to add notes, drag to move/resize · hover the tab to drop a fret · <b>☑ Select</b> or shift-click to multi-select &amp; paste across sections. <span class="resetlink" data-action="reset">↺ reset demo</span></div></div>`;
  }

  // lineCard / lane renderers exported for the production port (mount the builder lanes
  // without the prototype's standalone transport/palette/header — the site supplies those).
  window.VIEWS = { app, lineCard, timelineBody, stackedBody, palette, axisBeats: M.axisBeats };
})();
