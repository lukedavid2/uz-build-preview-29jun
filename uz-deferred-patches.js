/* uz-deferred-patches.js — consolidated production build
 * Generated 2026-05-24T08:23:11Z for undercoverzest.app
 * Part 1: v3 base (uz-deferred-patches.js @ fix/patches-v3-mobile-followups)
 * Part 2: v3.13 supplement (uz-deferred-patches-v31-supplement.js)
 * The two IIFEs run in order — base first, supplement overrides — exactly
 * as the debug bootstrap eval'd them during verification.
 */

/* ===== PART 1: v3 base ===== */
/**
 * uz-deferred-patches.js — runtime patches for the six "deferred"
 * items from the 2026-05-12 mobile UX audit. v3 adds 5 follow-up
 * mobile fixes (see commit message for details).
 */
(function () {
  'use strict';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInit);
  } else {
    scheduleInit();
  }

  function scheduleInit() { setTimeout(init, 1500); }

  function init() {
    injectStyles();
    setupHintDotGate();           // item 1 (overlay-scoped)
    setupShapeEditorExtras();     // items 2 + 3 (overlay-scoped, re-injects on app.js rerender)
    setupMismatchWarnings();      // item 4
    setupMultiSelectDrag();       // item 5
    setupToolbarSelectToggle();   // item 5 toolbar replacement for long-press
    setupTabBoundarySnapshot();   // item 6
    setupTabCellMobileKeyboard(); // v3 fix 3 — iOS keyboard on tab fret tap
    setupZoomSliderMinPatch();    // v3 fix 4 — zoom-out down to 0.2
  }

  function injectStyles() {
    var css = [
      'body.uz-shape-clean #chordShapeOverlay .hint-dot { display: none !important; }',
      '.uz-shape-shift-row { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 6px 0; margin-bottom: 4px; }',
      '.uz-shape-shift-btn { min-width: 38px; min-height: 32px; background: rgba(212,168,83,0.10); border: 1px solid rgba(212,168,83,0.4); color: #d4a853; border-radius: 6px; font-size: 16px; font-weight: 700; cursor: pointer; font-family: "Outfit", sans-serif; }',
      '.uz-shape-shift-btn:hover { background: rgba(212,168,83,0.18); border-color: #d4a853; }',
      '.uz-shape-shift-btn:active { transform: scale(0.96); }',
      '.uz-shape-shift-label { font-size: 12px; color: #999; }',
      '.uz-shape-type-row { display: flex; align-items: center; gap: 6px; padding: 8px 12px; margin: 0 12px 6px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; }',
      '.uz-shape-type-row label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }',
      '.uz-shape-type-input { flex: 1; min-width: 0; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; color: #e0e0e0; font-family: "JetBrains Mono", "Menlo", monospace; font-size: 14px; padding: 6px 8px; }',
      '.uz-shape-type-input:focus { outline: none; border-color: #d4a853; }',
      '.uz-shape-type-go { background: #d4a853; color: #1a1a2a; border: none; padding: 6px 10px; border-radius: 4px; font-size: 13px; font-weight: 700; cursor: pointer; }',
      '.uz-shape-type-go:hover { background: #e8ba50; }',
      '.uz-shape-type-row .uz-hint { font-size: 11px; color: #888; flex-shrink: 0; }',
      '.progression-chord.uz-chord-mismatch::after { content: "⚠️"; position: absolute; top: 2px; right: 18px; font-size: 14px; line-height: 1; pointer-events: none; filter: drop-shadow(0 0 2px rgba(0,0,0,0.6)); }',
      '.progression-chord { position: relative; }',
      '.progression-chord.uz-chord-mismatch { outline: 1px dashed rgba(255,180,60,0.7); outline-offset: -2px; }',
      '.progression-chord.uz-selected { outline: 2px solid #d4a853; outline-offset: -2px; background: rgba(212,168,83,0.08); }',
      '.progression-chord.uz-dragging, .progression-chord.uz-dragging-group { opacity: 0.4; }',
      'body.uz-select-mode .progression-chord::before { content: ""; position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; border: 2px solid rgba(212,168,83,0.6); border-radius: 3px; background: rgba(0,0,0,0.25); z-index: 2; pointer-events: none; }',
      'body.uz-select-mode .progression-chord.uz-selected::before { background: #d4a853; border-color: #d4a853; box-shadow: inset 0 0 0 2px #1a1a2a, inset 0 0 0 4px #d4a853; }',
      '.uz-select-mode-bar { position: fixed; top: 60px; left: 50%; transform: translateX(-50%); z-index: 9500; display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: rgba(26,26,40,0.96); border: 1px solid rgba(212,168,83,0.5); border-radius: 8px; color: #e0e0e0; font-family: "Outfit", sans-serif; font-size: 13px; box-shadow: 0 6px 18px rgba(0,0,0,0.5); }',
      '.uz-select-mode-bar button { background: rgba(212,168,83,0.18); border: 1px solid rgba(212,168,83,0.5); color: #d4a853; padding: 6px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; min-height: 32px; }',
      '.uz-drag-ghost { position: fixed; pointer-events: none; z-index: 9999; background: rgba(212,168,83,0.92); color: #1a1a2a; padding: 6px 12px; border-radius: 6px; font-weight: 700; font-family: "Outfit", sans-serif; font-size: 14px; box-shadow: 0 4px 14px rgba(0,0,0,0.5); transform: translate(-50%, -50%); }',
      '.uz-drop-target { outline: 2px dashed #d4a853 !important; outline-offset: 2px; }',
      'body.uz-select-mode .progression-chord { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }',
      '.uz-select-toggle-btn { background: rgba(212,168,83,0.12); border: 1px solid rgba(212,168,83,0.4); color: #d4a853; padding: 6px 10px; border-radius: 6px; font-family: "Outfit", sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; min-height: 32px; }',
      '.uz-select-toggle-btn:hover { background: rgba(212,168,83,0.22); border-color: #d4a853; }',
      '.uz-select-toggle-btn:active { transform: scale(0.97); }',
      '.uz-select-toggle-btn.uz-select-toggle-active { background: #d4a853; color: #1a1a2a; border-color: #d4a853; }',
      '.uz-select-toggle-icon { margin-right: 4px; }',
      // v3 fix 5 — chord-tones squashed on mobile
      '@media (max-width: 480px) {',
      '  .chord-tones { flex-wrap: wrap !important; gap: 4px !important; justify-content: center; row-gap: 4px; }',
      '  .chord-tones .tone-stack { min-width: 30px; flex-shrink: 0; }',
      '  .chord-tones .tone-top, .chord-tones .tone-bot { min-width: 28px; text-align: center; }',
      '}',
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'uzDeferredPatchesStyle';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Item 1: hint-dot gate (overlay-scoped observer)
  function setupHintDotGate() {
    var hintObs = null;
    function check() {
      var overlay = document.getElementById('chordShapeOverlay');
      if (!overlay) {
        document.body.classList.remove('uz-shape-clean');
        if (hintObs) { hintObs.disconnect(); hintObs = null; }
        return;
      }
      var hasPlaced = overlay.querySelector('.shape-fret-cell.active');
      document.body.classList.toggle('uz-shape-clean', !hasPlaced);
    }
    function attachOverlayObs() {
      var overlay = document.getElementById('chordShapeOverlay');
      if (!overlay) return;
      check();
      if (hintObs) hintObs.disconnect();
      hintObs = new MutationObserver(check);
      hintObs.observe(overlay, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-action="editChordShape"]');
      if (!t) return;
      setTimeout(attachOverlayObs, 50);
      setTimeout(attachOverlayObs, 250);
    }, true);
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-action="closeChordShape"], [data-action="saveChordShape"], [data-action="cancelChordShape"], [data-action="clearChordShape"]');
      if (!t) return;
      setTimeout(check, 200);
    }, true);
  }

  // Items 2 + 3: shape editor extras
  // v3 fix 1: use overlay-scoped MutationObserver so app.js's re-renders
  // (which wipe injected rows) trigger re-injection. injectShapeExtras
  // is idempotent via internal presence checks.
  var shapeEditorObs = null;
  var shapeEditorObsTarget = null;
  function setupShapeEditorExtras() {
    function attachOverlayObs() {
      var overlay = document.getElementById('chordShapeOverlay');
      if (!overlay) return;
      injectShapeExtras(overlay);
      if (shapeEditorObs && shapeEditorObsTarget === overlay) return;
      if (shapeEditorObs) { shapeEditorObs.disconnect(); shapeEditorObs = null; }
      shapeEditorObsTarget = overlay;
      shapeEditorObs = new MutationObserver(function () {
        var ov = document.getElementById('chordShapeOverlay');
        if (!ov) {
          shapeEditorObs.disconnect();
          shapeEditorObs = null;
          shapeEditorObsTarget = null;
          return;
        }
        injectShapeExtras(ov);
      });
      shapeEditorObs.observe(overlay, { childList: true, subtree: true });
    }
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-action="editChordShape"]');
      if (!t) return;
      setTimeout(attachOverlayObs, 50);
      setTimeout(attachOverlayObs, 200);
      setTimeout(attachOverlayObs, 500);
    }, true);
    attachOverlayObs();
  }

  function injectShapeExtras(overlay) {
    var nav = overlay.querySelector('.shape-fret-nav');
    if (nav && !nav.parentElement.querySelector('.uz-shape-shift-row')) {
      var shiftRow = document.createElement('div');
      shiftRow.className = 'uz-shape-shift-row';
      shiftRow.innerHTML = '<span class="uz-shape-shift-label">Shift shape:</span><button type="button" class="uz-shape-shift-btn" data-uz-shift="-1" title="Shift down 1 fret">↓ 1 fret</button><button type="button" class="uz-shape-shift-btn" data-uz-shift="+1" title="Shift up 1 fret">↑ 1 fret</button>';
      nav.parentElement.insertBefore(shiftRow, nav.nextSibling);
      shiftRow.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-uz-shift]');
        if (!btn) return;
        var dir = btn.getAttribute('data-uz-shift') === '+1' ? +1 : -1;
        shiftShape(overlay, dir);
      });
    }
    var body = overlay.querySelector('.shape-editor-body');
    var fretboard = overlay.querySelector('.shape-fretboard');
    if (body && fretboard && !body.querySelector('.uz-shape-type-row')) {
      var typeRow = document.createElement('div');
      typeRow.className = 'uz-shape-type-row';
      typeRow.innerHTML = '<label for="uzShapeTypeInput">Type:</label><input id="uzShapeTypeInput" class="uz-shape-type-input" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="x32010 or x 3 2 0 1 0"><button type="button" class="uz-shape-type-go">Set</button><span class="uz-hint">low E → high E</span>';
      body.insertBefore(typeRow, fretboard);
      var input = typeRow.querySelector('.uz-shape-type-input');
      var goBtn = typeRow.querySelector('.uz-shape-type-go');
      function apply() {
        // v3 fix 2: accept both no-space and space-separated input.
        var raw = (input.value || '').trim();
        var tokens;
        if (/\s/.test(raw)) {
          // Space-separated: legacy multi-digit format (frets >= 10)
          tokens = raw.split(/\s+/);
        } else {
          // No-space: each char is a single fret/symbol
          tokens = raw.split('');
        }
        applyFretString(overlay, tokens);
      }
      goBtn.addEventListener('click', apply);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); apply(); }
      });
      input.value = readCurrentFretString(overlay);
    }
  }

  function readCurrentFretsFromDOM(overlay) {
    var frets = [null, null, null, null, null, null];
    overlay.querySelectorAll('.shape-fret-cell.active').forEach(function (cell) {
      var s = parseInt(cell.dataset.string, 10);
      var f = parseInt(cell.dataset.fret, 10);
      if (isNaN(s) || isNaN(f)) return;
      if (s >= 0 && s < 6) frets[s] = f;
    });
    overlay.querySelectorAll('.shape-string-state').forEach(function (st, idx) {
      var t = (st.textContent || '').trim();
      var s = parseInt(st.parentElement && st.parentElement.dataset && st.parentElement.dataset.string, 10);
      if (isNaN(s)) s = idx;
      if (t === 'X') frets[s] = null;
      else if (t === 'O') frets[s] = 0;
    });
    return frets;
  }

  function readCurrentFretString(overlay) {
    var f = readCurrentFretsFromDOM(overlay);
    return f.map(function (v) { return v === null ? 'x' : String(v); }).join(' ');
  }

  function applyFretString(overlay, tokens) {
    if (tokens.length !== 6) { flashTypeError(overlay, 'Need 6 values (e.g. x32010 or x 3 2 0 1 0)'); return; }
    var target = tokens.map(function (t) {
      t = String(t).trim().toLowerCase();
      if (t === 'x' || t === '-') return null;
      var n = parseInt(t, 10);
      if (isNaN(n) || n < 0 || n > 24) return undefined;
      return n;
    });
    if (target.some(function (v) { return v === undefined; })) { flashTypeError(overlay, 'Use frets 0-24 or x for muted'); return; }
    var clearBtn = overlay.querySelector('[data-action="clearChordShape"]');
    if (clearBtn) clearBtn.click();
    setTimeout(function () { placeFrets(target); }, 30);
  }

  function flashTypeError(overlay, msg) {
    var input = overlay.querySelector('.uz-shape-type-input');
    if (!input) return;
    var orig = input.placeholder;
    input.placeholder = msg;
    input.style.borderColor = '#ff6666';
    setTimeout(function () { input.placeholder = orig; input.style.borderColor = ''; }, 2500);
  }

  function placeFrets(target) {
    var overlay = document.getElementById('chordShapeOverlay');
    if (!overlay) return;
    var stringHeaders = overlay.querySelectorAll('.shape-string-header');
    for (var s = 0; s < 6; s++) {
      var t = target[s];
      var header = stringHeaders[s];
      if (t === null) cycleStringHeader(header, 'X');
      else if (t === 0) cycleStringHeader(header, 'O');
      else clickFretAtAbsolute(s, t);
    }
  }

  function cycleStringHeader(header, want) {
    if (!header) return;
    var stateEl = header.querySelector('.shape-string-state');
    function read() { return (stateEl && stateEl.textContent || '').trim(); }
    for (var i = 0; i < 3 && read() !== want; i++) header.click();
  }

  function clickFretAtAbsolute(stringIdx, absFret) {
    var overlay = document.getElementById('chordShapeOverlay');
    if (!overlay) return;
    var rows = overlay.querySelectorAll('.shape-fret-row');
    var foundRow = null;
    rows.forEach(function (r) {
      var num = r.querySelector('.shape-fret-num');
      var n = num ? parseInt((num.textContent || '').trim(), 10) : NaN;
      if (n === absFret) foundRow = r;
    });
    if (!foundRow) {
      var navUp = overlay.querySelector('[data-action="shapeNavUp"]');
      var navDown = overlay.querySelector('[data-action="shapeNavDown"]');
      var navText = (overlay.querySelector('.shape-fret-nav span') || {}).textContent || '';
      var m = navText.match(/Frets\s+(\d+)/);
      var base = m ? parseInt(m[1], 10) : 0;
      var delta = absFret - (base + 2);
      var navBtn = delta > 0 ? navUp : navDown;
      for (var i = 0; i < Math.abs(delta) && i < 24; i++) if (navBtn) navBtn.click();
      setTimeout(function () { clickFretAtAbsolute(stringIdx, absFret); }, 30);
      return;
    }
    var cells = foundRow.querySelectorAll('.shape-fret-cell');
    var cell = cells[stringIdx];
    if (cell && !cell.classList.contains('active')) cell.click();
  }

  function shiftShape(overlay, dir) {
    var current = readCurrentFretsFromDOM(overlay);
    var next = current.map(function (v) {
      if (v === null || v === 0) return v;
      return v + dir;
    });
    if (next.some(function (v) { return v !== null && v < 0; })) { flashTypeError(overlay, 'Cannot shift below fret 0'); return; }
    if (next.some(function (v) { return v !== null && v > 24; })) { flashTypeError(overlay, 'Cannot shift above fret 24'); return; }
    var clearBtn = overlay.querySelector('[data-action="clearChordShape"]');
    if (clearBtn) clearBtn.click();
    setTimeout(function () { placeFrets(next); }, 30);
  }

  // Item 4: mismatch warning, using origChord captured at edit time
  var mismatchByCardKey = Object.create(null);
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-action]');
    if (!t) return;
    var action = t.getAttribute('data-action');
    if (action === 'editChordShape') {
      var line = t.getAttribute('data-line');
      var idx = t.getAttribute('data-idx');
      var card = t.closest('.progression-chord');
      var origChord = card ? (card.getAttribute('data-chord') || '') : '';
      window.__uzPendingShapeEdit = { line: line, idx: idx, origChord: origChord };
    } else if (action === 'saveChordShape') {
      try {
        var overlay = document.getElementById('chordShapeOverlay');
        var frets = overlay ? readCurrentFretsFromDOM(overlay) : null;
        var key = window.__uzPendingShapeEdit;
        var chordName = key && key.origChord;
        if (chordName && frets && key) {
          var mismatch = !shapeMatchesChord(chordName, frets);
          mismatchByCardKey[key.line + ':' + key.idx] = mismatch;
        }
      } catch (err) {}
      setTimeout(applyMismatchBadges, 100);
      setTimeout(applyMismatchBadges, 400);
    } else if (action === 'clearChordShape') {
      var k2 = window.__uzPendingShapeEdit;
      if (k2) delete mismatchByCardKey[k2.line + ':' + k2.idx];
      setTimeout(applyMismatchBadges, 100);
    }
  }, true);

  function setupMismatchWarnings() {
    var area = document.getElementById('progressionArea');
    if (!area) return;
    new MutationObserver(function () { applyMismatchBadges(); }).observe(area, { childList: true, subtree: true });
    setTimeout(applyMismatchBadges, 500);
  }

  function applyMismatchBadges() {
    document.querySelectorAll('.progression-chord').forEach(function (card) {
      var line = card.getAttribute('data-line');
      var idx = card.getAttribute('data-idx');
      var k = line + ':' + idx;
      var hasShape = !!card.querySelector('.mini-chord-svg');
      if (hasShape && mismatchByCardKey[k]) {
        card.classList.add('uz-chord-mismatch');
        card.setAttribute('title', 'This shape doesn\'t play the named chord. Tap ♦ to edit.');
      } else {
        card.classList.remove('uz-chord-mismatch');
      }
    });
  }

  var NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  var FLAT_TO_SHARP = { Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#', Bb:'A#' };
  var OPEN_PITCH_CLASSES = [4, 9, 2, 7, 11, 4];
  var CHORD_INTERVALS = {
    ''     : [0,4,7], 'm'    : [0,3,7], '7'    : [0,4,7,10], 'm7'   : [0,3,7,10],
    'maj7' : [0,4,7,11], 'sus4' : [0,5,7], 'sus2' : [0,2,7], 'dim'  : [0,3,6],
    'aug'  : [0,4,8], '6'    : [0,4,7,9], 'm6'   : [0,3,7,9], 'dim7' : [0,3,6,9],
    'm7b5' : [0,3,6,10], 'add9' : [0,4,7,14], '9'    : [0,4,7,10,14],
  };
  function chordExpectedPCs(chordName) {
    var m = chordName.match(/^([A-G][b#]?)(.*)$/);
    if (!m) return null;
    var root = FLAT_TO_SHARP[m[1]] || m[1];
    var ri = NOTE_NAMES.indexOf(root);
    if (ri < 0) return null;
    var iv = CHORD_INTERVALS[m[2] || ''] || CHORD_INTERVALS[''];
    var pcs = new Set();
    iv.forEach(function (i) { pcs.add((ri + i) % 12); });
    return pcs;
  }
  function actualPCsFromFrets(frets) {
    var pcs = new Set();
    for (var s = 0; s < 6; s++) {
      var f = frets[s];
      if (f === null || f === undefined) continue;
      pcs.add((OPEN_PITCH_CLASSES[s] + f) % 12);
    }
    return pcs;
  }
  function shapeMatchesChord(chordName, frets) {
    var expected = chordExpectedPCs(chordName);
    if (!expected) return true;
    var actual = actualPCsFromFrets(frets);
    if (actual.size === 0) return true;
    var allFound = true;
    expected.forEach(function (pc) { if (!actual.has(pc)) allFound = false; });
    var noOutside = true;
    actual.forEach(function (pc) { if (!expected.has(pc)) noOutside = false; });
    return allFound && noOutside;
  }
  // R1-1: expose the matcher so the v2 builder (app.js) can badge its own .chip elements
  // (the legacy applyMismatchBadges below targets .progression-chord, which the v2 builder replaced).
  window.UZ_SHAPE_MATCH = shapeMatchesChord;

  // Item 5: multi-select + drag (long-press removed, toolbar toggle is the entry)
  var selected = new Set();
  var selectMode = false;
  function cardKey(card) { return card.getAttribute('data-line') + ':' + card.getAttribute('data-idx'); }

  function setupMultiSelectDrag() {
    document.addEventListener('click', function (e) {
      var card = e.target.closest && e.target.closest('.progression-chord');
      if (!card) return;
      if (e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); extendSelection(card); }
      else if (e.metaKey || e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); toggleSelection(card); }
      else if (selectMode) { e.preventDefault(); e.stopImmediatePropagation(); toggleSelection(card); }
    }, true);
    setupPointerDrag();
    document.addEventListener('dragstart', function (e) {
      var card = e.target.closest && e.target.closest('.progression-chord');
      if (!card) return;
      var ck = cardKey(card);
      if (!selected.has(ck)) { clearSelection(); return; }
      var members = Array.from(selected);
      e.dataTransfer.setData('application/x-uz-multi', JSON.stringify(members));
      try { e.dataTransfer.setData('text/plain', members.join(',')); } catch (err) {}
      members.forEach(function (k) {
        var el = document.querySelector('.progression-chord[data-line="' + k.split(':')[0] + '"][data-idx="' + k.split(':')[1] + '"]');
        if (el) el.classList.add('uz-dragging-group');
      });
      var ghost = document.createElement('div');
      ghost.className = 'uz-drag-ghost';
      ghost.textContent = members.length + ' chords';
      ghost.style.cssText = 'position:absolute;top:-1000px;';
      document.body.appendChild(ghost);
      try { e.dataTransfer.setDragImage(ghost, 40, 16); } catch (err) {}
      setTimeout(function () { ghost.remove(); }, 200);
    }, true);
    document.addEventListener('dragend', function () {
      document.querySelectorAll('.uz-dragging-group').forEach(function (el) { el.classList.remove('uz-dragging-group'); });
    }, true);
    document.addEventListener('drop', function (e) {
      var multi = null;
      try { multi = e.dataTransfer && e.dataTransfer.getData('application/x-uz-multi'); } catch (err) {}
      if (!multi) return;
      var members = JSON.parse(multi);
      var dropTarget = e.target.closest('.progression-chord, .line-chords');
      if (!dropTarget) return;
      e.preventDefault(); e.stopImmediatePropagation();
      doMultiMove(members, dropTarget);
    }, true);
  }

  function setupToolbarSelectToggle() {
    function tryInject() {
      // v5: live next to the Tools toggle (always visible), not in the menu
      var controlsRight = document.querySelector('.controls-right');
      var toolButtons = controlsRight || document.getElementById('toolButtons');
      if (!toolButtons) return false;
      if (document.getElementById('uzSelectToggle')) return true;
      var btn = document.createElement('button');
      btn.id = 'uzSelectToggle';
      btn.className = 'uz-select-toggle-btn';
      btn.type = 'button';
      btn.title = 'Toggle multi-select mode — tap chord cards to select, then drag to move the group';
      btn.innerHTML = '<span class="uz-select-toggle-icon">☑</span> Select';
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (selectMode) { exitSelectMode(); btn.classList.remove('uz-select-toggle-active'); }
        else { enterSelectMode(); btn.classList.add('uz-select-toggle-active'); }
      });
      var menuToggle = document.getElementById('toolMenuToggle');
      if (controlsRight && menuToggle) controlsRight.insertBefore(btn, menuToggle);
      else toolButtons.appendChild(btn);
      return true;
    }
    if (tryInject()) return;
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (tryInject() || tries > 20) clearInterval(iv);
    }, 250);
  }

  function extendSelection(card) {
    if (selected.size === 0) { toggleSelection(card); return; }
    var siblings = Array.from(card.parentElement.querySelectorAll('.progression-chord'));
    var newIdx = siblings.indexOf(card);
    var existingIdx = -1;
    siblings.forEach(function (el, i) {
      if (selected.has(cardKey(el))) {
        if (existingIdx === -1 || Math.abs(i - newIdx) < Math.abs(existingIdx - newIdx)) existingIdx = i;
      }
    });
    if (existingIdx === -1) { toggleSelection(card); return; }
    var lo = Math.min(existingIdx, newIdx);
    var hi = Math.max(existingIdx, newIdx);
    for (var i = lo; i <= hi; i++) selected.add(cardKey(siblings[i]));
    refreshSelectionDOM();
  }

  function toggleSelection(card) {
    var k = cardKey(card);
    if (selected.has(k)) selected.delete(k); else selected.add(k);
    refreshSelectionDOM();
    updateSelectBar();
  }
  function clearSelection() { selected.clear(); refreshSelectionDOM(); updateSelectBar(); }
  function refreshSelectionDOM() {
    document.querySelectorAll('.progression-chord').forEach(function (card) {
      card.classList.toggle('uz-selected', selected.has(cardKey(card)));
    });
  }
  function enterSelectMode() {
    if (selectMode) return;
    selectMode = true;
    document.body.classList.add('uz-select-mode');
    syncSelectToggleBtn();
    updateSelectBar();
  }
  function exitSelectMode() {
    selectMode = false;
    document.body.classList.remove('uz-select-mode');
    clearSelection();
    syncSelectToggleBtn();
    var bar = document.getElementById('uzSelectModeBar');
    if (bar) bar.remove();
  }
  function syncSelectToggleBtn() {
    var btn = document.getElementById('uzSelectToggle');
    if (!btn) return;
    btn.classList.toggle('uz-select-toggle-active', selectMode);
  }
  function updateSelectBar() {
    if (!selectMode && selected.size === 0) {
      var existing = document.getElementById('uzSelectModeBar');
      if (existing) existing.remove();
      return;
    }
    var bar = document.getElementById('uzSelectModeBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'uzSelectModeBar';
      bar.className = 'uz-select-mode-bar';
      document.body.appendChild(bar);
      bar.innerHTML = '<span class="uz-select-count"></span><button type="button" data-uz-act="clear">Clear</button><button type="button" data-uz-act="exit">Done</button>';
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('[data-uz-act]');
        if (!b) return;
        var act = b.getAttribute('data-uz-act');
        if (act === 'clear') clearSelection();
        if (act === 'exit') exitSelectMode();
      });
    }
    bar.querySelector('.uz-select-count').textContent = selected.size + ' selected — drag any to move group';
  }
  function doMultiMove(members, dropTarget) {
    members.sort(function (a, b) {
      var ax = a.split(':').map(Number), bx = b.split(':').map(Number);
      return ax[0] - bx[0] || ax[1] - bx[1];
    });
    var rect = dropTarget.getBoundingClientRect();
    var isCont = dropTarget.classList.contains('line-chords');
    var cx = isCont ? rect.right - 4 : rect.left + 8;
    var cy = rect.top + rect.height / 2;
    members.forEach(function (k, i) {
      var parts = k.split(':');
      var sel = '.progression-chord[data-line="' + parts[0] + '"][data-idx="' + parts[1] + '"]';
      var src = document.querySelector(sel);
      if (!src) return;
      var dt = new DataTransfer();
      try { dt.setData('text/plain', parts.join(',')); } catch (err) {}
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      dropTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
      dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    selected.clear(); refreshSelectionDOM(); updateSelectBar();
  }

  var pdState = null;
  function setupPointerDrag() {
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
  }
  function onPointerMove(e) {
    if (!pdState) return;
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    pdState.ghost.style.left = e.clientX + 'px';
    pdState.ghost.style.top = e.clientY + 'px';
    var hit = document.elementFromPoint(e.clientX, e.clientY);
    var dt = hit && (hit.closest('.progression-chord') || hit.closest('.line-chords'));
    if (pdState.lastTarget && pdState.lastTarget !== dt) pdState.lastTarget.classList.remove('uz-drop-target');
    if (dt) dt.classList.add('uz-drop-target');
    pdState.lastTarget = dt;
  }
  function onPointerUp(e) {
    if (!pdState) return;
    pdState.ghost.remove();
    if (pdState.lastTarget) {
      pdState.lastTarget.classList.remove('uz-drop-target');
      doMultiMove(pdState.members, pdState.lastTarget);
    }
    pdState = null;
  }

  // v3 fix 3: iOS keyboard on melody tab fret-cell tap
  function setupTabCellMobileKeyboard() {
    document.addEventListener('click', function (e) {
      var cell = e.target.closest && e.target.closest('.tab-cell[data-action="tabCellClick"]');
      if (!cell) return;
      Promise.resolve().then(function () {
        var input = document.querySelector('.tab-cell-input');
        if (!input) return;
        input.setAttribute('inputmode', 'numeric');
        input.setAttribute('pattern', '[0-9]*');
        try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
      });
    }, false);
  }

  // v3 fix 4: extend tab-zoom-slider min to 0.2
  function setupZoomSliderMinPatch() {
    function patchSlider(slider) {
      if (!slider || slider.dataset.uzMinPatched) return;
      slider.dataset.uzMinPatched = '1';
      slider.setAttribute('min', '0.2');
      var step = slider.getAttribute('step');
      if (!step || parseFloat(step) > 0.05) slider.setAttribute('step', '0.05');
    }
    function scan() {
      document.querySelectorAll('.tab-zoom-slider, input[class*="zoom-slider"]').forEach(patchSlider);
    }
    scan();
    var area = document.getElementById('progressionArea');
    if (area) {
      new MutationObserver(scan).observe(area, { childList: true, subtree: true });
    }
  }

  // Item 6: boundary snapshot (defensive growth===1 guard)
  var boundarySnapshots = Object.create(null);
  function setupTabBoundarySnapshot() {
    var area = document.getElementById('progressionArea');
    if (!area) return;
    new MutationObserver(function () {
      document.querySelectorAll('.tab-grid').forEach(function (grid) {
        var lineEl = grid.closest('[data-line]') || grid.closest('.progression-line') || grid.closest('.line-card');
        if (!lineEl) return;
        var lineIdx = lineEl.getAttribute('data-line');
        if (lineIdx === null) return;
        snapshotOrRestore(parseInt(lineIdx, 10), grid);
      });
    }).observe(area, { childList: true, subtree: true });
  }
  function snapshotOrRestore(lineIdx, grid) {
    var children = Array.from(grid.children);
    var boundaries = [];
    var colCount = 0;
    children.forEach(function (el) {
      if (el.classList.contains('tab-chord-boundary')) boundaries.push(colCount);
      else if (/tab-col/.test(el.className)) colCount++;
    });
    var snap = boundarySnapshots[lineIdx];
    if (!snap) {
      boundarySnapshots[lineIdx] = { boundaries: boundaries.slice(), tabLen: colCount };
      return;
    }
    var growth = boundaries.length - snap.boundaries.length;
    if (growth === 1) {
      var expected = [];
      for (var i = 0; i < boundaries.length; i++) expected.push(Math.floor(i * colCount / boundaries.length));
      expected[0] = 0;
      var isEvenSplit = boundaries.every(function (b, i) { return Math.abs(b - expected[i]) <= 1; });
      if (isEvenSplit && snap.boundaries.length > 1) {
        var desired = snap.boundaries.slice();
        desired.push(snap.tabLen);
        restoreBoundaries(lineIdx, grid, desired);
      }
    }
    boundarySnapshots[lineIdx] = { boundaries: boundaries.slice(), tabLen: colCount };
  }
  function restoreBoundaries(lineIdx, grid, desired) {
    var boundaries = grid.querySelectorAll('.tab-chord-boundary');
    boundaries.forEach(function (bDiv, i) {
      var targetCol = desired[i];
      if (targetCol === undefined) return;
      var cols = grid.querySelectorAll('[class*="tab-col"]');
      var col = cols[targetCol];
      if (!col) return;
      var rect = col.getBoundingClientRect();
      var bRect = bDiv.getBoundingClientRect();
      if (Math.abs(rect.left - bRect.left) < 4) return;
      var dt = new DataTransfer();
      try { dt.setData('text/plain', 'boundary'); } catch (err) {}
      bDiv.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt, clientX: bRect.left, clientY: bRect.top }));
      col.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientX: rect.left, clientY: rect.top }));
      col.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX: rect.left, clientY: rect.top }));
      bDiv.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    });
  }

})();

/* ===== PART 2: v3.13 supplement ===== */
/**
 * uz-deferred-patches-v31-supplement.js  (v3.13 mobile updates)
 *
 * Loaded by the bootstrap AFTER the v3 IIFE. Re-implements the four
 * v3 behaviours that v3 got wrong on mobile, plus v3.2-v3.13
 * user-feedback iterations:
 *   - shape-type input keyboard: numeric keypad + in-app SPACE/X buttons,
 *     stacked layout (input row 1, buttons row 2)
 *   - chord-tones: two-row banding, max-content width, 22px chips
 *   - header: NO overrides (debug HTML matches production)
 *   - iOS scroll-jump dampening on chord-shape input focus
 *
 * v3.13: chord-tones bands were 30px tall — too short for a chip,
 * which stacks two text rows (interval label + pitch name). Chips
 * were clipped top/bottom. Bands raised to 38px, each tone row now
 * flex-centres its label so nothing clips. Wrapper padding bumped
 * to reserve the taller two-band area.
 */
(function () {
  'use strict';

  function injectShapeExtrasV31(overlay) {
    var nav = overlay.querySelector('.shape-fret-nav');
    if (nav && !nav.parentElement.querySelector('.uz-shape-shift-row')) {
      var shiftRow = document.createElement('div');
      shiftRow.className = 'uz-shape-shift-row';
      shiftRow.innerHTML =
        '<span class="uz-shape-shift-label">Shift shape:</span>' +
        '<button type="button" class="uz-shape-shift-btn" data-uz-shift="+1" title="Shift shape down (toward higher frets)">↓ 1 fret</button>' +
        '<button type="button" class="uz-shape-shift-btn" data-uz-shift="-1" title="Shift shape up (toward lower frets)">↑ 1 fret</button>';
      nav.parentElement.insertBefore(shiftRow, nav.nextSibling);
      shiftRow.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-uz-shift]');
        if (!btn) return;
        var dir = btn.getAttribute('data-uz-shift') === '+1' ? +1 : -1;
        shiftShapeV31(overlay, dir);
      });
    }
    var body = overlay.querySelector('.shape-editor-body');
    var fretboard = overlay.querySelector('.shape-fretboard');
    if (body && fretboard && !body.querySelector('.uz-shape-type-row')) {
      var typeRow = document.createElement('div');
      typeRow.className = 'uz-shape-type-row';
      // v3.6: stack input on its own row (full width so all 6 string
      // states are visible) and put SPACE/X/Set buttons on a second
      // row below.
      typeRow.innerHTML =
        '<div class="uz-shape-type-row-input">' +
          '<label for="uzShapeTypeInput">Type:</label>' +
          '<input id="uzShapeTypeInput" class="uz-shape-type-input" type="tel" inputmode="numeric" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" pattern="[0-9xX\\- ]*" placeholder="x32010 or x 3 2 0 1 0">' +
        '</div>' +
        '<div class="uz-shape-type-row-buttons">' +
          '<button type="button" class="uz-shape-type-insert" data-uz-insert=" " title="Insert space">␣ space</button>' +
          '<button type="button" class="uz-shape-type-insert" data-uz-insert="x" title="Insert x for muted">x mute</button>' +
          '<button type="button" class="uz-shape-type-go">Set</button>' +
          '<span class="uz-hint">low E → high E</span>' +
        '</div>';
      body.insertBefore(typeRow, fretboard);
      var input = typeRow.querySelector('.uz-shape-type-input');
      var goBtn = typeRow.querySelector('.uz-shape-type-go');
      function apply() {
        var raw = (input.value || '').trim();
        var tokens;
        if (/\s/.test(raw)) tokens = raw.split(/\s+/);
        else tokens = raw.split('');
        applyFretStringV31(overlay, tokens);
      }
      goBtn.addEventListener('click', apply);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); apply(); }
      });
      typeRow.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-uz-insert]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var ch = btn.getAttribute('data-uz-insert');
        try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
        var start = (input.selectionStart != null) ? input.selectionStart : input.value.length;
        var end = (input.selectionEnd != null) ? input.selectionEnd : input.value.length;
        if (typeof input.setRangeText === 'function') {
          input.setRangeText(ch, start, end, 'end');
        } else {
          input.value = input.value.slice(0, start) + ch + input.value.slice(end);
          var pos = start + ch.length;
          input.setSelectionRange(pos, pos);
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      input.value = readCurrentFretStringV31(overlay);
    }
  }

  function readCurrentFretsFromDOMV31(overlay) {
    var frets = [null, null, null, null, null, null];
    overlay.querySelectorAll('.shape-fret-cell.active').forEach(function (cell) {
      var s = parseInt(cell.dataset.string, 10);
      var f = parseInt(cell.dataset.fret, 10);
      if (isNaN(s) || isNaN(f)) return;
      if (s >= 0 && s < 6) frets[s] = f;
    });
    overlay.querySelectorAll('.shape-string-state').forEach(function (st, idx) {
      var t = (st.textContent || '').trim();
      var s = parseInt(st.parentElement && st.parentElement.dataset && st.parentElement.dataset.string, 10);
      if (isNaN(s)) s = idx;
      if (t === 'X') frets[s] = null;
      else if (t === 'O') frets[s] = 0;
    });
    return frets;
  }
  function readCurrentFretStringV31(overlay) {
    return readCurrentFretsFromDOMV31(overlay).map(function (v) { return v === null ? 'x' : String(v); }).join(' ');
  }
  function flashTypeErrorV31(overlay, msg) {
    var input = overlay.querySelector('.uz-shape-type-input');
    if (!input) return;
    var orig = input.placeholder;
    input.placeholder = msg;
    input.style.borderColor = '#ff6666';
    setTimeout(function () { input.placeholder = orig; input.style.borderColor = ''; }, 2500);
  }
  function applyFretStringV31(overlay, tokens) {
    if (tokens.length !== 6) { flashTypeErrorV31(overlay, 'Need 6 values (e.g. x32010 or x 3 2 0 1 0)'); return; }
    var target = tokens.map(function (t) {
      t = String(t).trim().toLowerCase();
      if (t === 'x' || t === '-') return null;
      var n = parseInt(t, 10);
      if (isNaN(n) || n < 0 || n > 24) return undefined;
      return n;
    });
    if (target.some(function (v) { return v === undefined; })) { flashTypeErrorV31(overlay, 'Use frets 0-24 or x for muted'); return; }
    var clearBtn = overlay.querySelector('[data-action="clearChordShape"]');
    if (clearBtn) clearBtn.click();
    setTimeout(function () { placeFretsV31(target); }, 50);
  }
  function placeFretsV31(target) {
    var overlay = document.getElementById('chordShapeOverlay');
    if (!overlay) return;
    var stringHeaders = overlay.querySelectorAll('.shape-string-header');
    for (var s = 0; s < 6; s++) {
      var t = target[s];
      var header = stringHeaders[s];
      if (t === null) cycleStringHeaderV31(header, 'X');
      else if (t === 0) cycleStringHeaderV31(header, 'O');
      else clickFretAtAbsoluteV31(s, t);
    }
  }
  function cycleStringHeaderV31(header, want) {
    if (!header) return;
    var stateEl = header.querySelector('.shape-string-state');
    function read() { return (stateEl && stateEl.textContent || '').trim(); }
    for (var i = 0; i < 3 && read() !== want; i++) header.click();
  }
  function clickFretAtAbsoluteV31(stringIdx, absFret) {
    var overlay = document.getElementById('chordShapeOverlay');
    if (!overlay) return;
    var rows = overlay.querySelectorAll('.shape-fret-row');
    var foundRow = null;
    rows.forEach(function (r) {
      var num = r.querySelector('.shape-fret-num');
      var n = num ? parseInt((num.textContent || '').trim(), 10) : NaN;
      if (n === absFret) foundRow = r;
    });
    if (!foundRow) {
      var navUp = overlay.querySelector('[data-action="shapeNavUp"]');
      var navDown = overlay.querySelector('[data-action="shapeNavDown"]');
      var navText = (overlay.querySelector('.shape-fret-nav span') || {}).textContent || '';
      var m = navText.match(/Frets\s+(\d+)/);
      var base = m ? parseInt(m[1], 10) : 0;
      var delta = absFret - (base + 2);
      var navBtn = delta > 0 ? navUp : navDown;
      for (var i = 0; i < Math.abs(delta) && i < 24; i++) if (navBtn) navBtn.click();
      setTimeout(function () { clickFretAtAbsoluteV31(stringIdx, absFret); }, 50);
      return;
    }
    var cells = foundRow.querySelectorAll('.shape-fret-cell');
    var cell = cells[stringIdx];
    if (cell && !cell.classList.contains('active')) cell.click();
  }
  function shiftShapeV31(overlay, dir) {
    var current = readCurrentFretsFromDOMV31(overlay);
    var next = current.map(function (v) {
      if (v === null || v === 0) return v;
      return v + dir;
    });
    if (next.some(function (v) { return v !== null && v < 0; })) { flashTypeErrorV31(overlay, 'Cannot shift below fret 0'); return; }
    if (next.some(function (v) { return v !== null && v > 24; })) { flashTypeErrorV31(overlay, 'Cannot shift above fret 24'); return; }
    var clearBtn = overlay.querySelector('[data-action="clearChordShape"]');
    if (clearBtn) clearBtn.click();
    setTimeout(function () { placeFretsV31(next); }, 50);
  }

  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n && n.nodeType === 1 && n.id === 'chordShapeOverlay') {
          injectShapeExtrasV31(n);
        }
      }
    }
  }).observe(document.body, { childList: true });
  var existingOverlay = document.getElementById('chordShapeOverlay');
  if (existingOverlay) injectShapeExtrasV31(existingOverlay);

  // Melody-tab cell input — numeric keypad
  var progressionArea = document.getElementById('progressionArea');
  if (progressionArea) {
    function patchTabCellInput(input) {
      if (!input || input.dataset.uzKbV31) return;
      input.dataset.uzKbV31 = '1';
      try { input.setAttribute('type', 'tel'); } catch (e) {}
      input.setAttribute('inputmode', 'numeric');
      input.setAttribute('pattern', '[0-9]*');
      if (document.activeElement === input) {
        try { input.blur(); } catch (e) {}
        try { input.focus({ preventScroll: true }); } catch (e) { try { input.focus(); } catch (e2) {} }
      } else {
        try { input.focus({ preventScroll: true }); } catch (e) { try { input.focus(); } catch (e2) {} }
      }
    }
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n || n.nodeType !== 1) continue;
          if (n.matches && n.matches('.tab-cell-input')) {
            patchTabCellInput(n);
          } else if (n.querySelector) {
            var inner = n.querySelector('.tab-cell-input');
            if (inner) patchTabCellInput(inner);
          }
        }
      }
    }).observe(progressionArea, { childList: true, subtree: true });
  }

  // Zoom slider min
  function patchZoomSlider(slider) {
    if (!slider) return;
    if (slider.getAttribute('min') !== '0.2') slider.setAttribute('min', '0.2');
    var step = slider.getAttribute('step');
    if (!step || parseFloat(step) > 0.05) slider.setAttribute('step', '0.05');
    slider.dataset.uzMinPatchedV31 = '1';
  }
  function scanForZoomSliders(root) {
    (root || document).querySelectorAll('.tab-zoom-slider').forEach(patchZoomSlider);
  }
  scanForZoomSliders();
  if (progressionArea) {
    new MutationObserver(function () { scanForZoomSliders(); }).observe(progressionArea, { childList: true, subtree: true });
  }
  new MutationObserver(function () { scanForZoomSliders(); }).observe(document.body, { childList: true });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('tab-zoom-slider')) {
      patchZoomSlider(t);
    }
  }, true);

  // v3.12: normalise progression-builder chord-card heights.
  // app.js renders the roman-numeral <span class="chord-roman">
  // only for chords that have an analysed roman, so cards with a
  // roman are one text-line taller than cards without. Inject a
  // hidden placeholder .chord-roman into any card missing one so
  // every .progression-chord has identical structure -> identical
  // height regardless of content.
  var normalisingChordsV31 = false;
  function normaliseProgressionChordsV31() {
    if (normalisingChordsV31) return;
    normalisingChordsV31 = true;
    try {
      var cards = document.querySelectorAll('.progression-chord');
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.querySelector('.chord-roman')) continue;
        var nameEl = card.querySelector('.chord-name');
        if (!nameEl) continue;
        var ph = document.createElement('span');
        ph.className = 'chord-roman uz-roman-placeholder-v31';
        ph.setAttribute('aria-hidden', 'true');
        ph.style.visibility = 'hidden';
        ph.textContent = '·';
        nameEl.insertAdjacentElement('afterend', ph);
      }
    } catch (e) {}
    normalisingChordsV31 = false;
  }
  normaliseProgressionChordsV31();
  if (progressionArea) {
    new MutationObserver(function () {
      if (normalisingChordsV31) return;
      normaliseProgressionChordsV31();
    }).observe(progressionArea, { childList: true, subtree: true });
  }

  // ─── v3.13 CSS ─────────────────────────────────────────────────
  var style = document.createElement('style');
  style.id = 'uzDeferredPatchesV31Style';
  style.textContent = [
    '@media (max-width: 480px) {',
    // ── chord-tones: TRUE two-row layout, width:max-content,
    //   no horizontal column-width constraint. Each strip is
    //   absolute-positioned, centered (left:50% + translateX), so
    //   it grows to fit all its chips at natural 22px size.
    //   Adjacent chord (opposite band) horizontal overlap is safe
    //   because they\'re vertically separated.
    //
    //   v3.13 vertical geometry (was clipping at 30px bands):
    //     band height        38px   (was 30px — a chip stacks two
    //                                 text rows + the ♭ glyph runs
    //                                 tall; 30px clipped top/bottom)
    //     even band  bottom:  0      (spans 0 → 38px)
    //     odd  band  bottom: 44px    (spans 44 → 82px; 6px gap)
    //     wrapper padding-bottom 86px (reserves both bands + gap
    //                                  + 4px breathing room)
    '  .chord-row .chord-wrapper,',
    '  .chord-row.modal .chord-wrapper {',
    '    overflow: visible !important;',
    '    position: relative !important;',
    '    padding-bottom: 86px !important;',
    '  }',
    '  .chord-row .chord-wrapper .chord-tones,',
    '  .chord-row.modal .chord-wrapper .chord-tones,',
    '  .chord-tones {',
    '    position: absolute !important;',
    '    left: 50% !important;',
    '    right: auto !important;',
    '    height: 38px !important;',
    '    flex-wrap: nowrap !important;',
    '    overflow: visible !important;',
    '    gap: 3px !important;',
    '    padding: 0 3px !important;',
    '    margin: 0 !important;',
    '    z-index: 1;',
    '    width: max-content !important;',
    '    max-width: none !important;',
    '    border-radius: 4px;',
    '    background: rgba(255,255,255,0.025);',
    '    justify-content: flex-start;',
    '    align-items: stretch;',
    '    box-sizing: border-box;',
    '    transform: translateX(-50%) !important;',
    '  }',
    // v3.10: every strip stays centered (left: 50% + translateX).
    // The v3.8 :first/:last clamps pulled edge strips toward the
    // wrapper boundary, causing the rightmost 4-chip strip to
    // overlap the strip 2 positions to its left in the same band.
    // Natural centering means edge strips bleed only ~1-5px past
    // viewport on common phone widths — acceptable.
    '  .chord-row .chord-wrapper:nth-child(odd) .chord-tones,',
    '  .chord-row.modal .chord-wrapper:nth-child(odd) .chord-tones {',
    '    bottom: 44px !important;',
    '  }',
    '  .chord-row .chord-wrapper:nth-child(even) .chord-tones,',
    '  .chord-row.modal .chord-wrapper:nth-child(even) .chord-tones {',
    '    bottom: 0 !important;',
    '  }',
    // Chip: 22px min-width, fills the full 38px band height. The
    // inner overflow:hidden only rounds the 4px corners — it no
    // longer clips content because the band is tall enough.
    '  .chord-row .chord-wrapper .chord-tones .tone-stack,',
    '  .chord-row.modal .chord-wrapper .chord-tones .tone-stack,',
    '  .chord-tones .tone-stack {',
    '    min-width: 22px !important;',
    '    flex: 0 0 auto !important;',
    '    border-radius: 4px;',
    '    overflow: hidden;',
    '    box-shadow: 0 1px 1px rgba(0,0,0,0.14), 0 0 0 1px rgba(255,255,255,0.04) inset;',
    '    height: 100% !important;',
    '    min-height: 38px !important;',
    '    display: flex;',
    '    flex-direction: column;',
    '  }',
    // v3.13: each tone row takes half the 38px band (~19px) and
    // flex-centres its label vertically + horizontally, so the
    // interval label and pitch name never clip at top or bottom.
    // flex:1 1 auto (was 1 0 auto) lets a row shrink rather than
    // force an overflow if a glyph runs tall.
    '  .chord-tones .tone-top, .chord-tones .tone-bot {',
    '    min-width: 20px;',
    '    text-align: center;',
    '    padding: 1px 2px;',
    '    font-size: 10px;',
    '    line-height: 1.15;',
    '    flex: 1 1 auto;',
    '    display: flex;',
    '    align-items: center;',
    '    justify-content: center;',
    '    box-sizing: border-box;',
    '    overflow: visible;',
    '  }',
    '  .chord-tones .tone-top {',
    '    font-weight: 700;',
    '  }',
    '  .chord-row .chords-container,',
    '  .chord-row.modal .chords-container {',
    '    padding-top: 4px !important;',
    '    padding-bottom: 4px !important;',
    '  }',
    '  .chord-tones .tone-stack:active {',
    '    transform: scale(0.92);',
    '    transition: transform 80ms ease-out;',
    '  }',
    '  .uz-shape-type-insert {',
    '    background: rgba(212,168,83,0.18);',
    '    border: 1px solid rgba(212,168,83,0.45);',
    '    color: #d4a853;',
    '    padding: 4px 10px;',
    '    border-radius: 5px;',
    '    font-family: "Outfit", sans-serif;',
    '    font-size: 13px; font-weight: 700;',
    '    cursor: pointer;',
    '    min-height: 32px;',
    '    flex-shrink: 0;',
    '  }',
    '  .uz-shape-type-insert:active { transform: scale(0.94); background: rgba(212,168,83,0.32); }',
    // v3.10: a little extra horizontal padding on the chord-row
    // card so the rightmost 4-chip strip doesn't kiss the card edge
    '  .chord-row { padding-left: 14px !important; padding-right: 14px !important; }',
    // v3.11: borrowed-mode rows (Lydian/Mixolydian/Phrygian/DomTriads)
    // never have a second chord-tones band, so the 44px reserved below
    // the top-band strip is wasted padding. Pin the strip to bottom:0
    // and trim wrapper padding so the strip sits flush at the wrapper
    // bottom — same 6px chord-box-to-strip gap as main-row top-band.
    // v3.13: 38px band + 6px breathing room = 44px.
    '  .chord-row.borrowed-mode .chord-wrapper {',
    '    padding-bottom: 44px !important;',
    '  }',
    '  .chord-row.borrowed-mode .chord-wrapper .chord-tones {',
    '    bottom: 0 !important;',
    '  }',
    '}',  // closes @media (max-width: 480px)
    // v3.7: fix vertical alignment of borrowed iv chord.
    // Roman numerals containing a ♭ (U+266D) glyph render in a
    // fallback font with different metrics than plain ASCII
    // numerals (e.g. "iv"), so the chord-numeral div height
    // varied per label and pushed some chord-boxes up vs. down.
    // Lock the numeral box to a fixed height with the text
    // bottom-aligned so the chord-box below always lines up.
    '.chord-numeral {',
    '  height: 18px !important;',
    '  line-height: 18px !important;',
    '  display: flex !important;',
    '  align-items: flex-end !important;',
    '  justify-content: center !important;',
    '  margin-bottom: 4px !important;',
    '  overflow: hidden;',
    '}',
    '.uz-shape-type-insert {',
    '  background: rgba(212,168,83,0.18);',
    '  border: 1px solid rgba(212,168,83,0.45);',
    '  color: #d4a853;',
    '  padding: 4px 10px;',
    '  border-radius: 5px;',
    '  font-family: "Outfit", sans-serif;',
    '  font-size: 13px; font-weight: 700;',
    '  cursor: pointer;',
    '  min-height: 32px;',
    '  flex-shrink: 0;',
    '}',
    '.uz-shape-type-insert:active { transform: scale(0.94); background: rgba(212,168,83,0.32); }',
    // v3.6 two-row shape-type structure
    '.uz-shape-type-row {',
    '  flex-direction: column !important;',
    '  align-items: stretch !important;',
    '  gap: 6px !important;',
    '}',
    '.uz-shape-type-row-input {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 6px;',
    '  width: 100%;',
    '}',
    '.uz-shape-type-row-input .uz-shape-type-input {',
    '  flex: 1 1 auto;',
    '  min-width: 0;',
    '}',
    '.uz-shape-type-row-buttons {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 6px;',
    '  flex-wrap: wrap;',
    '}',
    '.uz-shape-type-row-buttons .uz-hint {',
    '  margin-left: auto;',
    '  font-size: 11px;',
    '  color: #888;',
    '  flex-shrink: 1;',
    '}',
    '.uz-shape-type-input {',
    '  scroll-margin-bottom: 40vh;',
    '  scroll-margin-top: 12vh;',
    '}',
    'body:has(#chordShapeOverlay) {',
    '  overflow: hidden;',
    '  overscroll-behavior: contain;',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  window.__uzPatchesV31 = { loaded: true, version: '3.13' };
})();
