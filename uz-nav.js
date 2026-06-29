/**
 * ════════════════════════════════════════════════════════════════════
 * Undercover Zest Suite — Navigation Bar  (uz-nav.js)
 * ════════════════════════════════════════════════════════════════════
 *
 * Self-contained, zero-dependency nav bar for the Undercover Zest
 * creative writing tool suite. Injects a fixed top rail with app
 * icons, which gradually fades on scroll and morphs into a floating
 * lemon FAB. Clicking the FAB opens a dock with all apps.
 * No build step, no external CSS, no framework required.
 *
 * ── APPS IN THE SUITE ──────────────────────────────────────────────
 *
 *  Key         | Label            | Path             | Colour
 *  ------------|------------------|------------------|----------
 *  home        | Home (homepage)  | /homepage/       | #c8a04a (gold)
 *  zest        | Undercover Zest  | /                | #c8a04a
 *  rhyme       | RhymeForge       | /rhymeforge/     | #d4a853
 *  collision   | CollisionLab     | /collisionlab/   | #a78bfa
 *  morning     | Morning Pages    | /morningpages/   | #8b7355
 *  sense       | SenseSpark       | /sensespark/     | #E8453C
 *  blog        | Field Notes      | /blog/           | #d4a853 (gold)
 *
 * ── HOW TO ADD TO A PAGE ───────────────────────────────────────────
 *
 *  Place at the bottom of <body>, after your app's root element:
 *
 *    <body>
 *      <div id="root"></div>
 *      <!-- your app scripts -->
 *      <script src="/uz-nav.js"><\/script>
 *    </body>
 *
 *  Or inline the entire IIFE in a <script> block in the same spot.
 *  The script auto-detects the active app from the URL pathname.
 *
 * ── WHAT IT INJECTS ────────────────────────────────────────────────
 *
 *  1. .uz-nav-spacer  — 52px div at top of <body> (pushes content down)
 *  2. .uz-nav-rail    — fixed top bar, z-index 9999
 *  3. .uz-lemon-fab   — floating 42px circle button, z-index 9998
 *  4. .uz-float-dock  — expandable dock panel, z-index 9999
 *  5. <style> in <head> — all classes prefixed uz- to avoid collisions
 *
 * ── CRITICAL: THE --uz-rail-h CSS VARIABLE ─────────────────────────
 *
 *  The script sets a CSS custom property on <html>:
 *
 *    --uz-rail-h
 *
 *  It interpolates smoothly from 52px (rail visible) to 0px (rail
 *  collapsed) as the user scrolls. ANY sticky or fixed header in
 *  your app MUST use this for its top value:
 *
 *    CSS:    top: var(--uz-rail-h, 52px);
 *    React:  style={{ top: "var(--uz-rail-h, 52px)" }}
 *
 *  The 52px fallback ensures correct positioning before the script loads.
 *
 * ── TOAST / POPUP Z-INDEX ──────────────────────────────────────────
 *
 *  Nav uses z-index 9999. Toasts/modals that must sit above it need
 *  z-index 10000+ and should offset from the rail:
 *
 *    top: calc(var(--uz-rail-h, 52px) + 12px);
 *    z-index: 10000;
 *
 * ── SCROLL BEHAVIOUR ───────────────────────────────────────────────
 *
 *  NOT a binary snap — uses eased interpolation over 40–200px scroll:
 *    • 0–40px:    Rail fully visible, FAB hidden
 *    • 40–200px:  Rail slides up & fades; nav items fade first (1.8x),
 *                 lemon lingers (0.7x); FAB crossfades in with scale-up
 *    • 200px+:    Rail fully hidden, FAB visible; click opens dock
 *
 * ── DARK THEME ─────────────────────────────────────────────────────
 *
 *  Designed for dark backgrounds. Set --lab-bg on :root or body to
 *  match your app background and prevent spacer bleed-through:
 *
 *    :root { --lab-bg: #141210; }
 *
 * ── ADDING A NEW APP ───────────────────────────────────────────────
 *
 *  1. Add entry to APPS array with key, label, short, href, match
 *  2. Create iconNewapp(sz) returning SVG string (viewBox 0 0 48 48,
 *     stroke="currentColor")
 *  3. Register in iconFns, railSz, dockSz
 *  4. Add active-state CSS rules for .uz-rail-item[data-app="newapp"]
 *     and .uz-dock-item[data-app="newapp"]
 *
 * ── DO'S AND DON'TS ───────────────────────────────────────────────
 *
 *  DO  place script at bottom of <body>
 *  DO  use top: var(--uz-rail-h, 52px) on any sticky header
 *  DO  use z-index 10000+ for toasts/modals above the nav
 *  DO  set --lab-bg to your app's background colour
 *
 *  DON'T  add your own spacer/padding-top — the script handles it
 *  DON'T  use uz- prefixed class names in your own CSS
 *  DON'T  set overflow:hidden on <body> — breaks scroll detection
 *
 * ════════════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  // ── App definitions ────────────────────────────────────────────────
  var HOMEPAGE_HREF = '/homepage/';

  // Auto-detect a base-path prefix for GitHub Pages preview support.
  // On live (undercoverzest.app), this evaluates to '' so absolute hrefs work as written.
  // On lukedavid2.github.io/uz-build-preview-XX/, evaluates to '/uz-build-preview-XX'
  // so we prefix every absolute href to land inside the preview repo path.
  function uzGetBasePath() {
    try {
      var host = window.location.hostname || '';
      if (host.endsWith('.github.io')) {
        var segs = (window.location.pathname || '').split('/').filter(Boolean);
        if (segs.length > 0) return '/' + segs[0];
      }
    } catch (e) {}
    return '';
  }
  var UZ_BASE = uzGetBasePath();
  function uzHref(p) {
    if (!p) return p;
    if (p.charAt(0) === '/' && UZ_BASE) return UZ_BASE + p;
    return p;
  }

  var APPS = [
    { key: 'zest',      label: 'Undercover Zest', short: 'Zest',      href: '/',              match: ['/index.html', '/'] },
    { key: 'rhyme',     label: 'RhymeForge',      short: 'Rhyme',     href: '/rhymeforge/',   match: ['/rhymeforge'] },
    { key: 'collision', label: 'CollisionLab',     short: 'Collision', href: '/collisionlab/', match: ['/collisionlab'] },
    { key: 'morning',   label: 'Morning Pages',    short: 'Morning',   href: '/morningpages/', match: ['/morningpages'] },
    { key: 'sense',     label: 'SenseSpark',       short: 'Sense',     href: '/sensespark/',   match: ['/sensespark'] },
    { key: 'resources', label: 'Resources',        short: 'Refs',      href: '/resources/',    match: ['/resources', '/chord-progressions', '/chord', '/chord-embellishments', '/arpeggios'] },
    { key: 'blog',      label: 'Field Notes',     short: 'Blog',      href: '/blog/',         match: ['/blog'] },
  ];

  // ── Detect active page ─────────────────────────────────────────────
  var path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  var activeApp = 'zest'; // default
  APPS.forEach(function (a) {
    a.match.forEach(function (m) {
      if (path === m || path.indexOf(m + '/') === 0 || path.indexOf(m + '/index') === 0) {
        activeApp = a.key;
      }
    });
  });

  // Home page (the Undercover Zest chord builder at '/') keeps the original
  // scroll-collapse behaviour; every other page keeps the nav rail pinned and
  // visible so Resources is always reachable at the top.
  var isHome = (path === '' || path === '/index.html');

  // ── SVG Icons (currentColor, thick strokes) ────────────────────────
  function iconZest(sz) {
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 48 48" fill="none">' +
      '<path d="M24 38 C24 38 15 26 15 18 C15 12 19 9 24 9 C29 9 33 12 33 18 C33 26 24 38 24 38Z" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linejoin="round"/>' +
      '<line x1="17.5" y1="17" x2="30.5" y2="17" stroke="currentColor" stroke-width="1.8" opacity="0.45"/>' +
      '<line x1="16.5" y1="22" x2="31.5" y2="22" stroke="currentColor" stroke-width="1.8" opacity="0.45"/>' +
      '<line x1="18.5" y1="27" x2="29.5" y2="27" stroke="currentColor" stroke-width="1.8" opacity="0.45"/></svg>';
  }
  function iconRhyme(sz) {
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 48 48" fill="none">' +
      '<path d="M13 14h12M13 21h9M13 28h12M13 35h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M28 14 C28 14 36 16 36 21 C36 26 28 28 28 28 C28 28 36 30 36 35" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>';
  }
  function iconCollision(sz) {
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 48 48" fill="none">' +
      '<path d="M10 24 L19 24" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>' +
      '<path d="M15 20 L19 24 L15 28" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M38 24 L29 24" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>' +
      '<path d="M33 20 L29 24 L33 28" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M24 17 V15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M24 33 V31" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M20 19 L18.5 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M28 29 L29.5 30.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M28 19 L29.5 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M20 29 L18.5 30.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  function iconMorning(sz) {
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 48 48" fill="none">' +
      '<circle cx="24" cy="19" r="5" stroke="currentColor" stroke-width="2.5" fill="none"/>' +
      '<path d="M24 11 V13" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M17 14 L18.5 15.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M31 14 L29.5 15.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M14 19 H16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M32 19 H34" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
      '<line x1="12" y1="26" x2="36" y2="26" stroke="currentColor" stroke-width="2" opacity="0.4"/>' +
      '<line x1="14" y1="31" x2="34" y2="31" stroke="currentColor" stroke-width="2" opacity="0.3"/>' +
      '<line x1="16" y1="36" x2="32" y2="36" stroke="currentColor" stroke-width="2" opacity="0.2"/></svg>';
  }
  function iconSense(sz) {
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 48 48" fill="none">' +
      '<ellipse cx="24" cy="24" rx="12" ry="8" stroke="currentColor" stroke-width="2.5" fill="none"/>' +
      '<circle cx="24" cy="24" r="3.5" stroke="currentColor" stroke-width="2.2" fill="none"/>' +
      '<circle cx="24" cy="24" r="1.2" fill="currentColor"/>' +
      '<path d="M24 14 L24 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity="0.5"/>' +
      '<path d="M19 15 L16 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.45"/>' +
      '<path d="M29 15 L32 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.45"/>' +
      '<path d="M14.5 18 L10 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.35"/>' +
      '<path d="M33.5 18 L38 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.35"/>' +
      '<path d="M12 22 L8 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.3"/>' +
      '<path d="M36 22 L40 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.3"/></svg>';
  }

  function iconBlog(sz) {
    // Quill drawing a wave-line on lined paper — "field notes" feel.
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 48 48" fill="none">' +
      // page corner
      '<path d="M14 9 H30 L36 15 V38 H14 Z" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linejoin="round"/>' +
      '<path d="M30 9 V15 H36" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round" opacity="0.55"/>' +
      // ruled lines
      '<path d="M18 22 H32" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.55"/>' +
      '<path d="M18 28 H32" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.4"/>' +
      '<path d="M18 34 H28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.28"/></svg>';
  }

  function iconHome(sz) {
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 48 48" fill="none">' +
      '<path d="M24 10 L8 24 L12 24 L12 38 L20 38 L20 28 L28 28 L28 38 L36 38 L36 24 L40 24 Z" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linejoin="round"/></svg>';
  }

  function iconResources(sz) {
    // Three stacked books leaning slightly, library/reference iconography
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 48 48" fill="none">' +
      '<rect x="9" y="14" width="8" height="26" rx="1" stroke="currentColor" stroke-width="2.4" fill="none"/>' +
      '<rect x="20" y="12" width="8" height="28" rx="1" stroke="currentColor" stroke-width="2.4" fill="none"/>' +
      '<rect x="31" y="16" width="8" height="24" rx="1" stroke="currentColor" stroke-width="2.4" fill="none" transform="rotate(8 35 28)"/>' +
      '<line x1="9" y1="22" x2="17" y2="22" stroke="currentColor" stroke-width="1.6"/>' +
      '<line x1="20" y1="20" x2="28" y2="20" stroke="currentColor" stroke-width="1.6"/></svg>';
  }

  var iconFns = {
    home: iconHome,
    zest: iconZest,
    rhyme: iconRhyme,
    collision: iconCollision,
    morning: iconMorning,
    sense: iconSense,
    resources: iconResources,
    blog: iconBlog
  };
  var railSz = { home: 34, zest: 34, rhyme: 34, collision: 40, morning: 40, sense: 40, resources: 34, blog: 32 };
  var dockSz = { home: 44, zest: 44, rhyme: 44, collision: 52, morning: 52, sense: 52, resources: 44, blog: 42 };
  var RAIL_H = 52;

  // ── Inject CSS ─────────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent = [
    '/* === UZ Nav === */',
    '.uz-nav-rail{position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;align-items:center;height:52px;background:rgba(8,8,12,0.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,0.06);padding:0 1rem;will-change:transform,opacity;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '.uz-rail-home{display:flex;align-items:center;padding:0 .75rem;height:100%;font-size:1.6rem;cursor:pointer;border-right:1px solid rgba(255,255,255,0.06);flex-shrink:0;text-decoration:none;transition:background .2s}',
    '.uz-rail-home:hover{background:rgba(212,168,83,0.06)}',
    '.uz-rail-items{display:flex;align-items:center;height:100%;flex:1;overflow-x:auto;transition:opacity .15s}',
    '.uz-rail-item{display:flex;align-items:center;gap:.5rem;height:100%;padding:0 .9rem;color:rgba(255,255,255,0.3);font-size:.75rem;font-weight:500;cursor:pointer;transition:color .2s,background .2s;border-bottom:2px solid transparent;user-select:none;white-space:nowrap;flex-shrink:0;text-decoration:none}',
    '.uz-rail-item:hover{color:rgba(255,255,255,0.55);background:rgba(255,255,255,0.02)}',
    '.uz-rail-item.uz-active{color:rgba(255,255,255,0.9)}',
    '.uz-rail-item svg{flex-shrink:0}',
    '.uz-rail-item[data-app="zest"].uz-active{border-bottom-color:#c8a04a}',
    '.uz-rail-item[data-app="rhyme"].uz-active{border-bottom-color:#d4a853}',
    '.uz-rail-item[data-app="collision"].uz-active{border-bottom-color:#a78bfa}',
    '.uz-rail-item[data-app="morning"].uz-active{border-bottom-color:#8b7355}',
    '.uz-rail-item[data-app="sense"].uz-active{border-bottom-color:#E8453C}',
    '.uz-rail-item[data-app="resources"].uz-active{border-bottom-color:#6ba6c4}',
    '.uz-rail-item[data-app="blog"].uz-active{border-bottom-color:#d4a853}',
    '.uz-rail-item[data-app="blog"]{margin-left:auto;border-left:1px solid rgba(255,255,255,0.1)}',

    '/* Lemon FAB */',
    '.uz-lemon-fab{position:fixed;top:.75rem;left:.75rem;z-index:9998;width:42px;height:42px;border-radius:50%;background:rgba(14,14,20,0.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.08);box-shadow:0 6px 24px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1.2rem;line-height:1;opacity:0;pointer-events:none;will-change:transform,opacity;transition:border-color .2s,background .2s,box-shadow .2s}',
    '.uz-lemon-fab:hover{border-color:#d4a853;background:rgba(212,168,83,0.1);box-shadow:0 6px 28px rgba(212,168,83,0.15)}',

    '/* Expanded dock */',
    '.uz-float-dock{position:fixed;top:.75rem;left:.75rem;z-index:9999;display:flex;align-items:center;gap:.35rem;padding:.4rem;background:rgba(14,14,20,0.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.08);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.5);width:fit-content;opacity:0;transform:translateX(-10px) scale(.9);pointer-events:none;transition:all .35s cubic-bezier(.16,1,.3,1);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '.uz-float-dock.uz-expanded{opacity:1;transform:translateX(0) scale(1);pointer-events:all}',
    '.uz-dock-item{display:flex;flex-direction:column;align-items:center;gap:.25rem;padding:.6rem .85rem;border-radius:10px;cursor:pointer;transition:all .2s;min-width:64px;text-decoration:none}',
    '.uz-dock-item:hover{background:rgba(255,255,255,0.05)}',
    '.uz-dock-item.uz-active{background:rgba(212,168,83,0.12)}',
    '.uz-dock-label{font-size:.65rem;font-weight:500;color:rgba(255,255,255,0.3);white-space:nowrap}',
    '.uz-dock-item.uz-active .uz-dock-label{color:#d4a853}',
    '.uz-dock-item[data-app="home"]{color:rgba(255,255,255,0.45)}',
    '.uz-dock-item[data-app="home"]:hover{background:rgba(212,168,83,0.08)}',
    '.uz-dock-item[data-app="home"] .uz-dock-label{color:rgba(255,255,255,0.45)}',
    '.uz-dock-item[data-app="collision"].uz-active{background:rgba(167,139,250,0.12)}',
    '.uz-dock-item[data-app="collision"].uz-active .uz-dock-label{color:#a78bfa}',
    '.uz-dock-item[data-app="morning"].uz-active{background:rgba(139,115,85,0.12)}',
    '.uz-dock-item[data-app="morning"].uz-active .uz-dock-label{color:#c4b59a}',
    '.uz-dock-item[data-app="sense"].uz-active{background:rgba(232,69,60,0.12)}',
    '.uz-dock-item[data-app="sense"].uz-active .uz-dock-label{color:#E8453C}',
    '.uz-dock-item[data-app="resources"].uz-active{background:rgba(107,166,196,0.12)}',
    '.uz-dock-item[data-app="resources"].uz-active .uz-dock-label{color:#6ba6c4}',
    '.uz-dock-item[data-app="blog"].uz-active{background:rgba(212,168,83,0.12)}',
    '.uz-dock-item[data-app="blog"].uz-active .uz-dock-label{color:#d4a853}',
    '.uz-dock-close{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;cursor:pointer;color:rgba(255,255,255,0.3);font-size:.9rem;transition:all .2s;flex-shrink:0}',
    '.uz-dock-close:hover{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.6)}',

    '/* Push page content below rail */',
    '.uz-nav-spacer{height:52px;background:var(--lab-bg, #08080c)}',

    '/* ── Mobile responsive ── */',
    '@media (max-width: 600px) {',
    '  .uz-nav-rail{padding:0 .4rem}',
    '  .uz-rail-item{padding:0 .5rem;font-size:.65rem;gap:.3rem}',
    '  .uz-rail-item span{display:none}',
    '  .uz-rail-item svg{width:22px!important;height:22px!important}',
    '  .uz-rail-home{padding:0 .5rem;font-size:1.3rem}',
    '  .uz-float-dock{left:.5rem;right:.5rem;top:.5rem;width:auto;padding:.4rem;gap:.15rem;max-width:calc(100vw - 1rem);overflow-x:auto;border-radius:12px}',
    '  .uz-dock-item{flex:1;min-width:0;padding:.5rem .35rem;border-radius:8px}',
    '  .uz-dock-item svg{width:26px!important;height:26px!important}',
    '  .uz-dock-label{font-size:.55rem}',
    '  .uz-dock-close{width:24px;height:24px;flex-shrink:0}',
    '}'
  ].join('\n');
  document.head.appendChild(css);

  // ── Build HTML ─────────────────────────────────────────────────────

  // Spacer to push page content below the fixed rail
  var spacer = document.createElement('div');
  spacer.className = 'uz-nav-spacer';
  document.body.insertBefore(spacer, document.body.firstChild);

  // Top Rail
  var rail = document.createElement('nav');
  rail.className = 'uz-nav-rail';
  rail.id = 'uzNavRail';
  var railHTML = '<a class="uz-rail-home" href="' + uzHref(HOMEPAGE_HREF) + '" title="Home">\uD83C\uDF4B</a><div class="uz-rail-items">';
  APPS.forEach(function (a) {
    var cls = a.key === activeApp ? ' uz-active' : '';
    railHTML += '<a class="uz-rail-item' + cls + '" data-app="' + a.key + '" href="' + uzHref(a.href) + '">' + iconFns[a.key](railSz[a.key]) + '<span>' + a.label + '</span></a>';
  });
  railHTML += '</div>';
  rail.innerHTML = railHTML;
  document.body.insertBefore(rail, spacer);

  var railHome = rail.querySelector('.uz-rail-home');
  var railItems = rail.querySelector('.uz-rail-items');

  // Lemon FAB
  var fab = document.createElement('div');
  fab.className = 'uz-lemon-fab';
  fab.id = 'uzLemonFab';
  fab.innerHTML = '\uD83C\uDF4B';
  document.body.appendChild(fab);

  // Float Dock
  var dock = document.createElement('div');
  dock.className = 'uz-float-dock';
  dock.id = 'uzFloatDock';
  var dockHTML = '';
  // Homepage entry first
  dockHTML += '<a class="uz-dock-item" data-app="home" href="' + uzHref(HOMEPAGE_HREF) + '">' + iconFns.home(dockSz.home) + '<div class="uz-dock-label">Home</div></a>';
  APPS.forEach(function (a) {
    var cls = a.key === activeApp ? ' uz-active' : '';
    dockHTML += '<a class="uz-dock-item' + cls + '" data-app="' + a.key + '" href="' + uzHref(a.href) + '">' + iconFns[a.key](dockSz[a.key]) + '<div class="uz-dock-label">' + a.label + '</div></a>';
  });
  dockHTML += '<div class="uz-dock-close" id="uzDockClose">\u2715</div>';
  dock.innerHTML = dockHTML;
  document.body.appendChild(dock);

  // ── Gradual scroll-driven collapse ─────────────────────────────────
  var dockExpanded = false;
  var fadeStart = 40;
  var fadeEnd = 200;
  var wasCollapsed = false;

  function expandDock() {
    dockExpanded = true;
    fab.style.opacity = '0';
    fab.style.pointerEvents = 'none';
    dock.classList.add('uz-expanded');
  }

  function collapseDock() {
    dockExpanded = false;
    dock.classList.remove('uz-expanded');
    if (wasCollapsed) {
      fab.style.opacity = '1';
      fab.style.pointerEvents = 'all';
    }
  }

  fab.addEventListener('click', expandDock);
  document.getElementById('uzDockClose').addEventListener('click', function (e) {
    e.stopPropagation();
    collapseDock();
  });

  document.documentElement.style.setProperty('--uz-rail-h', RAIL_H + 'px');

  function ease(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

  var ticking = false;
  if (isHome) {
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
  }

  function onScroll() {
    ticking = false;
    var y = window.pageYOffset || document.documentElement.scrollTop;

    if (y <= fadeStart) {
      // ── Fully visible ──
      rail.style.transform = 'translateY(0)';
      rail.style.opacity = '1';
      rail.style.pointerEvents = '';
      railHome.style.opacity = '1';
      railItems.style.opacity = '1';
      fab.style.opacity = '0';
      fab.style.pointerEvents = 'none';
      fab.style.transform = 'scale(.85)';
      if (dockExpanded) collapseDock();
      document.documentElement.style.setProperty('--uz-rail-h', RAIL_H + 'px');
      wasCollapsed = false;

    } else if (y >= fadeEnd) {
      // ── Fully collapsed ──
      rail.style.transform = 'translateY(-100%)';
      rail.style.opacity = '0';
      rail.style.pointerEvents = 'none';
      railHome.style.opacity = '0';
      railItems.style.opacity = '0';
      if (!dockExpanded) { fab.style.opacity = '1'; fab.style.pointerEvents = 'all'; }
      fab.style.transform = 'scale(1)';
      document.documentElement.style.setProperty('--uz-rail-h', '0px');
      wasCollapsed = true;

    } else {
      // ── Transitioning ──
      var raw = (y - fadeStart) / (fadeEnd - fadeStart);
      var p = ease(raw);

      // Rail slides up gradually
      rail.style.transform = 'translateY(-' + (p * 100) + '%)';
      rail.style.opacity = String(1 - p);
      rail.style.pointerEvents = p > 0.6 ? 'none' : '';

      // Nav items fade out faster than the lemon — creates the "detach" feel
      railItems.style.opacity = String(Math.max(0, 1 - p * 1.8));
      railHome.style.opacity = String(Math.max(0, 1 - p * 0.7));

      // FAB fades in later, crossfading with the rail lemon
      var fabP = Math.max(0, (p - 0.25) / 0.75);
      if (!dockExpanded) {
        fab.style.opacity = String(fabP);
        fab.style.pointerEvents = fabP > 0.4 ? 'all' : 'none';
      }
      fab.style.transform = 'scale(' + (0.85 + fabP * 0.15) + ')';

      // Interpolate the content offset
      var currentH = Math.round(RAIL_H * (1 - p));
      document.documentElement.style.setProperty('--uz-rail-h', currentH + 'px');
      wasCollapsed = p > 0.6;
    }
  }

  // Close dock when clicking outside
  document.addEventListener('click', function (e) {
    if (dockExpanded && !dock.contains(e.target) && e.target !== fab) {
      collapseDock();
    }
  });

})();
