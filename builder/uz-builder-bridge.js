/* uz-builder-bridge.js — maps the production `state` <-> the v2 unified builder model.
   Classic script (window.UZ_BUILDER_BRIDGE). Under Strategy A the v2 model is the builder's
   primary state; seedFromProduction() migrates an existing production save in once, and
   writeBackToProduction() serializes back to the production shape (for undercoverZestState +
   share/MIDI compat) on each commit.
   NOTE: tab[][] <-> notes reverse-mapping is phase 3 (§4d); this handles chords + melody. */
(function () {
  'use strict';
  var M = window.MODEL;

  // production chord-item normalisers (mirror app.js chordBeats/chordAccent semantics)
  function prodBeats(item) { var b = item && item.beats; return (typeof b === 'number' && b > 0) ? b : 4; }
  function prodAccent(item) { return (item && (item.accent === 'stop' || item.accent === 'push')) ? item.accent : 'norm'; }
  var ACC_TO_V2 = { norm: 'normal', stop: 'stop', push: 'push' };   // production -> v2
  var ACC_FROM_V2 = { normal: 'norm', stop: 'stop', push: 'push' }; // v2 -> production

  // production state -> v2 unified model (run once to migrate an existing save, and again
  // on each render so the v2 lanes reflect the live production state — see app.js renderProgression).
  // opts.displayName(item) lets app.js supply the key-transposed display name (transposeChord/
  // displayChordForKey are module-private there); without it the stored chord name is used.
  function seedFromProduction(ps, opts) {
    opts = opts || {};
    var displayName = (typeof opts.displayName === 'function') ? opts.displayName : function (c) { return c.chord; };
    var minor = ps.selectedTab === 'dark';
    var melLines = (ps.melody && ps.melody.lines) || {};
    var lines = (ps.progressionLines || []).map(function (pl, li) {
      var bpb = pl.bpb || 4;
      var acc = 0;
      var chords = (pl.chords || []).map(function (c) {
        var beats = prodBeats(c);
        var ch = M.chord(displayName(c), c.roman || '', beats);
        ch.id = c.id || ch.id;
        ch._orig = c.chord;                               // original key-relative name; survives dup/paste (Object.assign) so writeBack never persists the transposed display name → no double-transpose
        ch.accent = ACC_TO_V2[prodAccent(c)] || 'normal';
        ch.shape = c.shape || null;
        ch.start = (typeof c.start === 'number') ? c.start : acc; // honor saved positions; else sequential
        acc = Math.max(acc, ch.start + beats);
        return ch;
      });
      // melody notes map 1:1 (§4d); tab[][] -> notes reverse-mapping is phase 3
      var notes = [];
      var mel = melLines[li];
      if (Array.isArray(mel)) {
        mel.forEach(function (n) { notes.push(M.note(n.bar || 0, n.slot || 0, n.len || 1, n.d, n.o || 0, n.acc || 0)); });
      }
      return {
        id: pl.id || M.uid('line'),
        name: pl.name || ('Line ' + (li + 1)),
        mode: pl.viewMode || 'stacked',
        bpb: bpb, minBars: pl.minBars || 0,
        // builder UI state persisted out-of-band on the production line (writeBack) so the
        // re-seed-each-render cycle is lossless; default-safe for pre-v2 saves.
        loop: pl.loop !== false, zoom: pl.zoom || 1, scroll: pl.scroll || 0,
        tabOpen: !!pl.showTab, melodyOpen: !!pl.showMelody,
        tabAuthored: !!(pl.tab && pl.tab.length), melodyAuthored: notes.length > 0,
        melRes: (typeof pl.melRes === 'number') ? pl.melRes : ((ps.melody && ps.melody.resolution) || 8),
        melOctaves: (typeof pl.melOctaves === 'number') ? pl.melOctaves : ((ps.melody && ps.melody.octaves) || 2),
        melLabel: pl.melLabel || 'notes', melChromatic: !!pl.melChromatic,
        tabColor: pl.tabColor !== false, tabLabel: pl.tabLabel || 'fret',
        chords: chords, notes: notes
      };
    });
    if (!lines.length) lines.push(M.seed().lines[0]); // empty save -> one empty line
    var ci = (typeof ps.currentLineIndex === 'number' && ps.currentLineIndex >= 0 && lines[ps.currentLineIndex]) ? ps.currentLineIndex : 0;
    var sel = { lineId: null, ids: [] };
    if (ps.v2sel && ps.v2sel.lineId) {
      var sl = lines.find(function (l) { return l.id === ps.v2sel.lineId; });
      if (sl) {
        var live = {}; sl.chords.forEach(function (c) { live[c.id] = 1; });
        var ids = (ps.v2sel.ids || []).filter(function (id) { return live[id]; }); // drop ids whose chord was removed
        if (ids.length) sel = { lineId: ps.v2sel.lineId, ids: ids };
      }
    }
    return {
      key: ps.selectedKey || 'C', minor: minor,
      bpm: ps.looperBpm || 96, style: ps.looperStyle || 'Pop',
      loop: true, loopSong: !!ps.loopSong, playing: false, muted: false, playBeat: 0,
      selectMode: !!ps.v2selectMode, palLabel: ps.v2palLabel || 'notes',
      currentLine: (lines[ci] && lines[ci].id) || (lines[0] && lines[0].id),
      selection: sel, selNote: ps.v2selNote || null,
      clipboard: Array.isArray(ps.v2clipboard) ? ps.v2clipboard.slice() : [], undo: [],
      lines: lines
    };
  }

  // v2 model -> production state (serialize on each commit; caller then saveStateToLocalStorage).
  // MERGE-BY-ID: a chord that already exists in production keeps its ORIGINAL key-relative
  // chord/roman (so the displayName re-transpose on the next seed does NOT double-apply); only
  // positional/feel/shape are updated from the builder. Chords created inside the builder (dup/
  // paste) carry their own name/roman. progressionKey is left untouched — production transposes by
  // roman, and equalizing it would freeze transposition. UI fields + selection are persisted so the
  // re-seed-each-render cycle is lossless.
  function writeBackToProduction(v2, ps) {
    ps.selectedKey = v2.key;
    ps.selectedTab = v2.minor ? 'dark' : 'standard';
    var prevLines = ps.progressionLines || [];
    ps.progressionLines = (v2.lines || []).map(function (vl, li) {
      var prevLine = prevLines[li] || {};
      var byId = {};
      (prevLine.chords || []).forEach(function (pc) { if (pc.id != null) byId[pc.id] = pc; });
      var chords = (vl.chords || []).slice()
        .sort(function (a, b) { return (a.start || 0) - (b.start || 0); })
        .map(function (c) {
          var prev = byId[c.id];
          var out = {
            chord: prev ? prev.chord : (c._orig || c.name),  // builder-created chords (dup/paste) carry _orig from their source → original key-relative name, not the transposed display
            roman: prev ? (prev.roman || '') : (c.roman || ''),
            id: c.id, active: false,
            beats: c.beats,
            accent: ACC_FROM_V2[c.accent || 'normal'] || 'norm',
            start: (c.start || 0)
          };
          if (c.shape) out.shape = c.shape; else if (prev && prev.shape) out.shape = prev.shape;
          return out;
        });
      return {
        id: vl.id, name: vl.name, repeats: 1, bpb: vl.bpb || 4,
        viewMode: vl.mode || 'stacked', chords: chords,
        tab: prevLine.tab || [],                       // tab[][] retired under Strategy A; preserve until A3
        showTab: !!vl.tabOpen, showMelody: !!vl.melodyOpen,
        minBars: vl.minBars || 0, zoom: vl.zoom || 1, scroll: vl.scroll || 0, loop: vl.loop !== false,
        melRes: vl.melRes, melOctaves: vl.melOctaves, melLabel: vl.melLabel,
        melChromatic: !!vl.melChromatic, tabColor: vl.tabColor !== false, tabLabel: vl.tabLabel || 'fret'
      };
    });
    // melody back to state.melody.lines — INDEX-keyed (production MIDI/share read m.lines[lineIdx]),
    // rebuilt FRESH each time so a removed line can't orphan a stale higher index. progressionLines is
    // rebuilt in the same v2 order just above, so the two arrays stay index-aligned.
    ps.melody = ps.melody || {};
    ps.melody.lines = {};
    (v2.lines || []).forEach(function (vl, li) {
      ps.melody.lines[li] = (vl.notes || []).map(function (n) { return { bar: n.bar, slot: n.slot, d: n.d, o: n.o, len: n.len, acc: n.acc || 0 }; });
    });
    // transient builder UI state -> out-of-band production fields (read back by seedFromProduction)
    ps.v2sel = v2.selection ? { lineId: v2.selection.lineId, ids: (v2.selection.ids || []).slice() } : { lineId: null, ids: [] };
    ps.v2selNote = v2.selNote || null;
    ps.v2selectMode = !!v2.selectMode;
    ps.v2palLabel = v2.palLabel || 'notes';
    ps.v2clipboard = Array.isArray(v2.clipboard) ? v2.clipboard : [];
    ps.loopSong = !!v2.loopSong;
    var ci = (v2.lines || []).findIndex(function (l) { return l.id === v2.currentLine; });
    if (ci >= 0) ps.currentLineIndex = ci;
    return ps;
  }

  window.UZ_BUILDER_BRIDGE = { seedFromProduction: seedFromProduction, writeBackToProduction: writeBackToProduction };
})();
