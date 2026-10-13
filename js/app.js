/* Floor Plan 2027 — editor
 * Left: icon palette · Centre: SVG drawing canvas · Right: property inspector
 */
(function () {
  'use strict';

  const ICONS = window.FP_ICONS;
  const esc = window.FP_ESC;
  const byId = Object.fromEntries(ICONS.map((i) => [i.id, i]));
  const STORAGE_KEY = 'floorplan2027.plan';
  const MIN_SIZE = 5;
  const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const CURSORS = { '-1,-1': 'nwse', '1,1': 'nwse', '1,-1': 'nesw', '-1,1': 'nesw', '0,-1': 'ns', '0,1': 'ns', '-1,0': 'ew', '1,0': 'ew' };
  const SWATCHES = ['#1f2328', '#6b7280', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#ffffff'];
  const FILL_SWATCHES = ['#ffffff', '#f3f4f6', '#dbeafe', '#dcfce7', '#fef3c7', '#fee2e2', '#ede9fe', '#e7d8c9'];

  const $ = (s) => document.querySelector(s);
  const svg = $('#canvas');
  const viewport = $('#viewport');
  const itemsLayer = $('#items');
  const labelsLayer = $('#labels');
  const overlay = $('#overlay');
  const wrap = $('#canvasWrap');
  const props = $('#props');

  /* ───────────────────────── state ───────────────────────── */
  const state = {
    title: 'My Floor Plan',
    items: [],
    selId: null,
    grid: 10,
    snap: true,
    showGrid: true,
    bg: '#ffffff',
    zoom: 1,
    panX: 60,
    panY: 60,
    align: true,         // auto-align doors/windows into walls and wall ends together
    tool: null,          // null | 'fill'
    fillGap: 10,         // floor fill: openings narrower than this (cm) are treated as closed
    lastFloor: { material: 'wood', fill: null },
    lastGarden: { material: 'grass', fill: null },
    wallH: 300,          // height given to new walls and columns (cm) — 3.00 m
    wallMat2D: true,     // show wall materials as hatching in the 2D plan
    ground: 'plain',     // 3D surroundings: plain | grass | trees | street | street-trees | paving | gravel
  };
  const GROUNDS = [['plain', 'Plain'], ['grass', 'Grass'], ['trees', 'Grass with trees'], ['street', 'Street'],
    ['street-trees', 'Street with trees'], ['paving', 'Paved plaza'], ['gravel', 'Gravel'], ['brush', 'Brush / jungle']];
  const MATERIALS = window.FP_MATERIALS;
  const WALLMATS = window.FP_WALLMATS;
  const WALL_SWATCHES = ['#e4dfd6', '#ffffff', '#a4532f', '#7a3b22', '#a39b8b', '#5f5a52', '#b07d4f', '#6b4a2e'];
  const MATERIAL_SETS = window.FP_MATERIAL_SETS;
  const GARDEN_SWATCHES = ['#7fb069', '#5e8f45', '#b5523b', '#8f8a82', '#bdbab4', '#b5ad9f', '#a57a52', '#e3cf9c'];
  const FLOOR_SWATCHES = ['#c8a27a', '#8b5a3c', '#e8e4dc', '#f1efea', '#b1aa9e', '#8796ab', '#7fb069', '#3f3f46'];
  let nextId = 1;
  let clipboard = null;
  let drag = null;
  let spaceDown = false;
  /* Demo (top bar → Demo): a sample house built step by step. While it runs nothing is saved over your own plan
     (kept in demo.saved); while it is being built, no messages and no 3D rebuilds. See "demo houses" below. */
  const demo = { active: false, building: false, house: null, snaps: [], k: 0, anim: 0, play: 0, saved: null, hist: null };

  /* Selection: state.selId is the single selected object (null when 0 or several are selected);
     state.multi holds the ids when two or more objects are selected. */
  state.multi = new Set();
  /* Levels (storeys). Every object belongs to one level (it.lvl, default the ground floor 'L0').
     Level elevations are relative to the ground floor; only the current level is drawn and edited in 2D. */
  state.levels = [{ id: 'L0', name: 'Ground floor', elev: 0 }];
  state.level = 'L0';
  state.refLevel = null;   // another level whose walls are shown faintly as a reference
  state.showRef = false;
  state.allFloors = true;  // walls of every other floor as dashed lines in their level colour (toolbar "Other floors")
  // 3D: each level can be hidden (level.hide3d); by default levels above the one being designed are left out
  state.hideAbove = true;
  const lvlOf = (it) => it.lvl || 'L0';
  const levelItems = () => state.items.filter((it) => lvlOf(it) === state.level);
  const curLevel = () => state.levels.find((l) => l.id === state.level) || state.levels[0];
  const levelById = (id) => state.levels.find((l) => l.id === id);
  /* ── Units (Settings → Units): metric (m) or imperial (feet and inches) ──
     The plan is always stored in cm. In imperial every length is SHOWN rounded to the nearest 4 inches (under 2 ft:
     the nearest ½ inch), not converted digit for digit — 3.00 m shows as 10'-0", not 9'-10.1". Typed values are read
     exactly (10' 6" = 320.04 cm). The grid and the Height bar use inch steps (4" grid, 2 ft rows), so what is drawn
     in imperial lands on whole inches. */
  let UNITS = (() => { try { return localStorage.getItem('floorplan2027.units') === 'imperial' ? 'imperial' : 'metric'; } catch (e) { return 'metric'; } })();
  const imperial = () => UNITS === 'imperial';
  const IN = 2.54;
  const roundIn = (inch) => (Math.abs(inch) >= 24 ? Math.round(inch / 4) * 4 : Math.round(inch * 2) / 2);
  // a length in feet and inches: 10'-0", 6", 2'-8" (sign: '+' in front of positive values)
  function fmtFtIn(cm, sign = false) {
    let i = roundIn(cm / IN);
    const neg = i < 0;
    i = Math.abs(i);
    const ft = Math.floor(i / 12 + 1e-9), r = Math.round((i - ft * 12) * 10) / 10;
    const s = ft ? `${ft}'-${r}"` : `${r}"`;
    return (neg ? '−' : sign && i ? '+' : '') + s;
  }
  // read feet / inches typed by hand → cm (NaN when it cannot be read). 10' 6" · 10'-6" · 10.5' · 126" · 126 in ·
  // 10 6 (feet inches) · a plain number is feet
  function parseFtIn(str) {
    const s = String(str).trim().replace(/[−–—]/g, '-').replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/''/g, '"').toLowerCase();
    if (!s) return NaN;
    let m, sg = 1, t = s;
    if (/^[+-]/.test(t)) { if (t[0] === '-') sg = -1; t = t.slice(1).trim(); }
    const num = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
    if ((m = t.match(new RegExp(`^${num}\\s*(?:'|ft|feet|foot)\\s*-?\\s*(?:${num}\\s*(?:"|in|inch|inches)?)?$`)))) return round(sg * (parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0)) * IN, 2);
    if ((m = t.match(new RegExp(`^${num}\\s*(?:"|in|inch|inches)$`)))) return round(sg * parseFloat(m[1]) * IN, 2);
    if ((m = t.match(new RegExp(`^${num}\\s+${num}$`)))) return round(sg * (parseFloat(m[1]) * 12 + parseFloat(m[2])) * IN, 2);
    if ((m = t.match(new RegExp(`^${num}$`)))) return round(sg * parseFloat(m[1]) * 12 * IN, 2);
    return NaN;
  }
  // metric text → imperial text: "3.00 m", "+1.50 m", "250 cm", "12.5 m²"
  function imperialText(t) {
    return String(t)
      // sizes: "3.81 × 3.00 m" (and × … × …)
      .replace(/(\d+(?:\.\d+)?)((?:\s?×\s?\d+(?:\.\d+)?)+)\s?m\b(?![²2])/g, (x, a, rest) =>
        [a, ...rest.split('×').slice(1)].map((n) => fmtFtIn(parseFloat(n) * 100)).join(' × '))
      .replace(/([+−-]?)(\d+(?:\.\d+)?)\s?m²/g, (x, sg, n) => `${sg === '−' || sg === '-' ? '−' : ''}${Math.round(parseFloat(n) * 10.7639)} ft²`)
      .replace(/([+−-]?)(\d+(?:\.\d+)?)\s?cm\b/g, (x, sg, n) => fmtFtIn((sg === '−' || sg === '-' ? -1 : 1) * parseFloat(n), sg === '+'))
      .replace(/([+−-]?)(\d+(?:\.\d+)?)\s?m\b(?![²2])/g, (x, sg, n) => fmtFtIn((sg === '−' || sg === '-' ? -1 : 1) * parseFloat(n) * 100, sg === '+'))
      .replace(/±0(?:\.0+)?\s?m\b/g, '±0"');
  }
  const fmtElev = (e) => (imperial() ? (Math.abs(roundIn((e || 0) / IN)) < 0.25 ? '±0"' : fmtFtIn(e, true))
    : e ? `${e > 0 ? '+' : '−'}${(Math.abs(e) / 100).toFixed(2)} m` : '±0.00 m');
  // a plain length for text: 3.00 m / 10'-0"
  const fmtLen = (cm) => (imperial() ? fmtFtIn(cm) : `${(cm / 100).toFixed(2)} m`);
  // the snapping grid (cm): in imperial the nearest whole 4" multiple (4", 8", 12", 24", 48")
  const IMP_GRID = { 5: 4, 10: 4, 20: 8, 25: 12, 50: 24, 100: 48 };
  const gridCm = () => (imperial() ? (IMP_GRID[state.grid] || Math.max(1, Math.round(state.grid / (4 * IN))) * 4) * IN : state.grid);

  const sel = () => state.items.find((i) => i.id === state.selId) || null;
  const selIds = () => (state.multi.size ? [...state.multi] : state.selId != null ? [state.selId] : []);
  const sels = () => { const ids = new Set(selIds()); return state.items.filter((i) => ids.has(i.id)); };
  const isMulti = () => state.multi.size > 1;
  function applySel(ids) {
    ids = [...new Set(ids)].filter((id) => state.items.some((i) => i.id === id));
    state.multi = ids.length > 1 ? new Set(ids) : new Set();
    state.selId = ids.length === 1 ? ids[0] : null;
  }
  const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  const snapTo = (v, on) => (on ? round(Math.round(v / gridCm()) * gridCm(), 2) : v);
  // moving an object (plan and 3D, across or up/down): in steps of half a grid square when Snap is on
  const moveStep = () => gridCm() / 2;
  // snapping to the grid needs both "Grid" (shown) and "Snap" ticked: with the grid hidden, objects move freely
  const snapOn = () => !!state.snap && state.showGrid !== false;
  const snapMove = (v, on = snapOn()) => (on ? round(Math.round(v / moveStep()) * moveStep(), 2) : round(v, 1));

  function newItem(type, cx, cy) {
    const ic = byId[type];
    return {
      id: nextId++, type,
      x: cx - ic.w / 2, y: cy - ic.h / 2, w: ic.w, h: ic.h, r: 0,
      fx: false, fy: false,
      stroke: '#1f2328', fill: ic.fill || '#ffffff', fillNone: false, sw: 1.5, opacity: 1,
      label: ic.label || '', showLabel: false, locked: false, t: 15,
      lvl: state.level,
      ...(hasHeight(type) ? { wh: (levelById(state.level) || {}).wallH || state.wallH } : {}),
    };
  }
  // walls and columns have an adjustable height (used by the 3D view)
  const HEIGHT_TYPES = new Set(['column', 'column-round', 'pillar']);
  const hasHeight = (type) => window.FPWalls.WALL_TYPES.has(type) || HEIGHT_TYPES.has(type);

  /* ───────────────────────── history ───────────────────────── */
  let hist = [];
  let histIdx = -1;
  const snapshot = () => JSON.stringify({ items: state.items, sel: selIds(), levels: state.levels, wallH: state.wallH, aboveGround: state.aboveGround || 0 });
  function commit() {
    // stairs in "auto steps" follow any change of their rise (levels, floor heights …) before the state is saved
    const stairs = syncStairs(), slabs = syncSlabs(), moved = relevelSlabs(), apart = keepSlabsApart();
    if (stairs || slabs || moved || apart) { render(); syncPropFields(); }
    if (moved) buildProps();
    if (apart && selIds().length) buildProps();
    const s = snapshot();
    if (hist[histIdx] === s) return;
    hist = hist.slice(0, histIdx + 1);
    hist.push(s);
    if (hist.length > 150) hist.shift();
    histIdx = hist.length - 1;
    save();
    updateButtons();
  }
  function restore(i) {
    histIdx = i;
    const s = JSON.parse(hist[i]);
    state.items = s.items;
    if (s.levels) state.levels = s.levels;
    if (s.wallH) state.wallH = s.wallH;
    if (s.aboveGround != null) state.aboveGround = s.aboveGround;
    if (!levelById(state.level)) state.level = state.levels[0].id;
    applySel(s.sel || []);
    render();
    refreshSelectionUI();
    save();
  }
  const undo = () => histIdx > 0 && restore(histIdx - 1);
  const redo = () => histIdx < hist.length - 1 && restore(histIdx + 1);

  /* Tab guard: every tab of this browser autosaves to the same slot, so when another tab saves the plan this tab
     stops saving (it would overwrite that work) and asks which version to keep. */
  let lastSaved = null, stale = false;
  function save() {
    if (stale || demo.active) return; // a demo house never overwrites the saved plan
    try {
      lastSaved = JSON.stringify(serialize());
      localStorage.setItem(STORAGE_KEY, lastSaved);
    } catch (e) { /* storage unavailable */ }
  }
  window.addEventListener('storage', (e) => {
    // fires only in the other tabs, never in the one that saved
    if (e.key !== STORAGE_KEY || e.newValue == null || e.newValue === lastSaved) return;
    stale = true;
    if (state.tool) setTool(state.tool);
    $('#tabGuard').hidden = false;
  });
  // while the guard is up, keyboard shortcuts must not change the plan either
  window.addEventListener('keydown', (e) => { if (stale) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  $('#tabGuard').addEventListener('click', (e) => {
    const b = e.target.closest('[data-guard]');
    if (!b) return;
    if (b.dataset.guard === 'load') {
      // take the version the other tab saved
      try { load(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (err) { return toast('Could not read the other tab\'s version.', 'error'); }
      stale = false;
      render(); buildProps(); renderView(); commit();
      toast('Loaded the latest version from the other tab.');
    } else {
      // keep this tab's plan: it overwrites the other tab's, which then gets this notice itself
      stale = false;
      save();
      toast('Kept this tab\'s version — it is now the saved plan.');
    }
    $('#tabGuard').hidden = true;
  });
  function serialize() {
    return { app: 'floorplan2027', version: 2, title: state.title, grid: state.grid, bg: state.bg, fillGap: state.fillGap, wallH: state.wallH, wallMat2D: state.wallMat2D, stackWalls: state.stackWalls !== false, aboveGround: state.aboveGround || 0, slabT: state.slabT || 30, showDims: !!state.showDims, ground: state.ground,
      levels: state.levels, level: state.level, wall3m: true, refLevel: state.refLevel, showRef: state.showRef, allFloors: state.allFloors !== false, hideAbove: state.hideAbove, items: state.items };
  }
  // older plans: the separate "vertical stairs" became the straight stairs turned 90° (same place, same direction up)
  function migrateItem(i) {
    if (i.type !== 'stairs-v') return i;
    const cx = i.x + i.w / 2, cy = i.y + i.h / 2;
    return { ...i, type: 'stairs-h', w: i.h, h: i.w, x: cx - i.h / 2, y: cy - i.w / 2, r: normAngle((i.r || 0) - 90), fx: !!i.fy, fy: !!i.fx };
  }

  function load(data) {
    if (!data || !Array.isArray(data.items)) throw new Error('Not a floor plan file');
    state.title = data.title || 'My Floor Plan';
    state.grid = data.grid || 10;
    state.bg = data.bg || '#ffffff';
    state.fillGap = data.fillGap || 10;
    state.wallH = data.wallH || 300;
    state.wallMat2D = data.wallMat2D !== false;
    state.stackWalls = data.stackWalls !== false;
    state.slabT = +data.slabT || 30;
    state.showDims = !!data.showDims;
    $('#btnDims').classList.toggle('on', state.showDims);
    state.aboveGround = data.aboveGround != null ? +data.aboveGround || 0 : null; // null: derived once the items are in
    state.ground = GROUNDS.some(([k]) => k === data.ground) ? data.ground : 'plain';
    state.items = data.items.map(migrateItem).filter((i) => byId[i.type]);
    state.levels = Array.isArray(data.levels) && data.levels.length ? data.levels : [{ id: 'L0', name: 'Ground floor', elev: 0 }];
    if (!levelById('L0')) state.levels.unshift({ id: 'L0', name: 'Ground floor', elev: 0 });
    state.level = levelById(data.level) ? data.level : 'L0';
    if (state.aboveGround == null) state.aboveGround = deriveAboveGround();
    state.workZ = null; // set to the level's floor below, once everything is loaded
    // version 1 plans kept a slab on the level under the floor it carries: it now belongs to that floor's level
    if ((data.version || 1) < 2) {
      for (const i of state.items) {
        if (i.type !== 'slab') continue;
        const L = levelById(i.lvl || 'L0'), up = L && state.levels.filter((l) => l.elev > L.elev).sort((a, b) => a.elev - b.elev)[0];
        if (up) i.lvl = up.id;
      }
    }
    state.refLevel = levelById(data.refLevel) ? data.refLevel : null;
    state.showRef = !!data.showRef;
    state.allFloors = data.allFloors !== false;
    { const t = document.getElementById('tFloors'); if (t) t.checked = state.allFloors; }
    state.hideAbove = data.hideAbove !== false;
    /* The standard wall height became 3.00 m (it was 2.50 m): a plan made before that has its 2.50 m standard, its
       levels' 2.50 m wall heights and its walls / columns of exactly 2.50 m raised to 3.00 m, once. Walls under an
       upper floor still stop at that floor (Plan settings → "Walls meet the level above"). */
    if (!data.wall3m) {
      const OLD = 250, NEW = 300;
      if (state.wallH === OLD) state.wallH = NEW;
      for (const l of state.levels) if (l.wallH === OLD) l.wallH = NEW;
      for (const i of state.items) if (hasHeight(i.type) && (i.wh == null || i.wh === OLD)) i.wh = NEW;
    }
    autoRef();
    applySel([]);
    nextId = state.items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
    $('#planTitle').value = state.title;
  }

  /* ───────────────────────── rendering ───────────────────────── */
  function iconInner(ic, w, h, item) {
    return ic.draw ? ic.draw(w, h, item) : ic.svg;
  }
  function iconViewBox(ic, w, h) {
    return ic.draw ? `0 0 ${w} ${h}` : `0 0 ${ic.w} ${ic.h}`;
  }

  const itemName = (it) => (it.type === 'slab' ? (it.slabType === 'concrete' ? 'Concrete floor slab' : 'Timber floor slab')
    : it.type === 'floor' && it.garden ? 'Garden area' : byId[it.type].name);
  /* Several floor slabs on a level: each gets its own grey on the plan, from light (the lowest) to darker (the
     highest), so they can be told apart. A fill colour chosen in Properties is kept. */
  const SLAB_DEFAULT_FILLS = new Set(['#ece9e4', '#dedbd5']);
  /* Slabs at different heights are told apart by their grey: every slab at the same height (its top, the floor it
     carries) has the same grey, on every level; each other height has its own — the lowest lightest (95 %), higher
     ones darker (down to 55 %). With all slabs at one height they keep their normal colour. */
  function slabGray(it) {
    if (it.fill && !SLAB_DEFAULT_FILLS.has(String(it.fill).toLowerCase())) return null;
    const now = performance.now(), c = slabGray.cache;
    let tops;
    if (c && c.items === state.items && now - c.t < 1000) tops = c.tops;
    else {
      // the distinct slab heights of the plan (to the cm), lowest first
      const zt = (o) => { try { return Math.round(slabInfo(o).top); } catch (e) { return 0; } };
      const all = state.items.filter((o) => o.type === 'slab' && (!o.fill || SLAB_DEFAULT_FILLS.has(String(o.fill).toLowerCase())));
      const map = new Map(all.map((o) => [o.id, zt(o)]));
      tops = { map, levels: [...new Set(map.values())].sort((a, b) => a - b) };
      slabGray.cache = { items: state.items, t: now, tops };
    }
    const n = tops.levels.length;
    if (n < 2 || !tops.map.has(it.id)) return null;
    const k = tops.levels.indexOf(tops.map.get(it.id));
    const light = 95 - (k * Math.min(25, 40 / (n - 1))); // 95 % down to 55 % (two heights: 95 % and 70 %)
    return `hsl(0 0% ${light.toFixed(1)}%)`;
  }
  // a slab on the plan also tells its height (underside) when its level has slabs at more than one height
  function slabDrawInfo(it) {
    try {
      const L = lvlOf(it), b = slabInfo(it).bottom;
      const other = state.items.some((o) => o !== it && o.type === 'slab' && lvlOf(o) === L && Math.abs(slabInfo(o).bottom - b) >= 1);
      return other ? { ...it, slabAt: fmtElev(b) } : it;
    } catch (e) { return it; }
  }
  function itemMarkup(it, forExport = false) {
    const ic = byId[it.type];
    const { w, h } = it;
    const flip = it.fx || it.fy ? `translate(${it.fx ? w : 0} ${it.fy ? h : 0}) scale(${it.fx ? -1 : 1} ${it.fy ? -1 : 1})` : '';
    // walls with a material are hatched in 2D (plaster keeps the classic solid fill)
    const hatch = hasHeight(it.type) && state.wallMat2D && it.wmat ? WALLMATS.pattern2d(it.wmat, it.wcol, `wm-${it.id}`) : '';
    // interior walls (10 cm wiring / insulation linings, it.interior) are drawn mid-gray so they stand out from the walls
    const kfill = hatch ? `url(#wm-${it.id})` : it.interior ? '#5c6168' : '';
    const style = `color:${it.stroke};--fill:${it.fillNone ? 'none' : (it.type === 'slab' && slabGray(it)) || it.fill};opacity:${it.opacity}${kfill ? `;--kfill:${kfill}` : ''}`;
    // a low wall (half-height, up to 1.50 m) is drawn lighter, as plans show walls that do not reach the ceiling
    const low = window.FPWalls.isWall(it) && (it.wh || state.wallH) <= 150;
    const klass = `item${it.locked ? ' locked' : ''}${ic.shapeHit ? ' shape-hit' : ''}${!forExport && !atWorkHeight(it) ? ' off-height' : ''}${low ? ' low-wall' : ''}`;
    const cut = wallModel.cuts.has(it.id) ? ` mask="url(#wallcut-${it.id})"` : '';
    return (
      `<g class="${klass}" data-id="${it.id}" transform="translate(${round(it.x, 2)} ${round(it.y, 2)}) rotate(${it.r} ${w / 2} ${h / 2})" style="${style}"${cut}>` +
      `<g${flip ? ` transform="${flip}"` : ''}><svg width="${w}" height="${h}" viewBox="${iconViewBox(ic, w, h)}" preserveAspectRatio="none" overflow="visible" ` +
      `fill="none" stroke="currentColor" stroke-width="${it.sw}" stroke-linejoin="round" stroke-linecap="round">${hatch}${iconInner(ic, w, h, it.type === 'slab' ? slabDrawInfo(it) : it.type === 'balcony' ? balconyDrawInfo(it) : it)}</svg></g>` +
      faceStripes(it) +
      (forExport || ic.shapeHit ? '' : `<rect class="hit" width="${w}" height="${h}"/>`) +
      `</g>`
    );
  }
  /* A wall whose faces have their own colour (inside / outside, it.faces) shows it on the plan too: a band along each
     such face, a third of the wall thick (at most 6 cm), in the item's own (unrotated) frame. */
  function faceStripes(it) {
    if (!it.faces || !window.FPWalls.isWall(it)) return '';
    let fs;
    try { fs = window.FPWalls.wallFaces(it).faces; } catch (e) { return ''; }
    const rad = (-it.r * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad), cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const loc = ([X, Y]) => { const dx = X - cx, dy = Y - cy; return `${round(dx * c - dy * s + it.w / 2, 2)},${round(dx * s + dy * c + it.h / 2, 2)}`; };
    const bw = Math.min(6, Math.max(2, (it.t || 15) / 3));
    return fs.filter((f) => it.faces[f.key]).map((f) => {
      const o = it.faces[f.key], col = o.wcol || (WALLMATS.MATS[o.wmat] || WALLMATS.MATS.plaster).color;
      const P2 = [f.P[0] - f.out[0] * bw, f.P[1] - f.out[1] * bw], Q2 = [f.Q[0] - f.out[0] * bw, f.Q[1] - f.out[1] * bw];
      return `<polygon class="face-band" points="${[f.P, f.Q, Q2, P2].map(loc).join(' ')}" style="fill:${col}" stroke="none"/>`;
    }).join('');
  }
  function labelMarkup(it) {
    const ic = byId[it.type];
    if (!it.showLabel || ic.ownLabel) return '';
    const txt = it.label || itemName(it);
    return `<text x="${round(it.x + it.w / 2, 2)}" y="${round(it.y + it.h / 2, 2)}">${esc(txt)}</text>`;
  }

  // Walls are drawn cut open where a door/window sits in them (an SVG mask per wall item)
  let wallModel = { cuts: new Map(), hosts: new Map() };
  function cutMasks() {
    let out = '';
    for (const [id, polys] of wallModel.cuts) {
      const it = state.items.find((i) => i.id === id);
      if (!it) continue;
      const rad = (-it.r * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad), cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      const loc = ([X, Y]) => { const dx = X - cx, dy = Y - cy; return `${round(dx * c - dy * s + it.w / 2, 2)},${round(dx * s + dy * c + it.h / 2, 2)}`; };
      out += `<mask id="wallcut-${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">` +
        `<rect x="-100000" y="-100000" width="200000" height="200000" fill="#fff"/>` +
        polys.map((p) => `<polygon points="${p.map(loc).join(' ')}" fill="#000"/>`).join('') + `</mask>`;
    }
    return out;
  }

  /* Walls of every other floor (toolbar "Other floors"): both faces as dashed lines in that level's colour (the colour of
     the Height bar), with the level's name — a reference whatever height is being worked at. The reference level
     chosen in Plan settings is drawn as before, over them. */
  function otherFloorWalls() {
    if (state.allFloors === false) return '';
    const z = state.zoom, W = window.FPWalls, lv = [...state.levels].sort((a, b) => a.elev - b.elev);
    const skip = refShown() ? state.refLevel : null;
    let out = '';
    for (const L of lv) {
      if (L.id === state.level || L.id === skip) continue;
      const walls = state.items.filter((it) => lvlOf(it) === L.id && W.isWall(it));
      if (!walls.length) continue;
      const col = LEVEL_COLOURS[lv.indexOf(L) % LEVEL_COLOURS.length];
      const segs = W.wallSegments(walls).map((s) => {
        const B = [s.A[0] + s.u[0] * s.len, s.A[1] + s.u[1] * s.len], e = s.t / 2;
        const P = (p, k) => `${round(p[0] + s.n[0] * k, 2)},${round(p[1] + s.n[1] * k, 2)}`;
        return `<polygon points="${P(s.A, -e)} ${P(B, -e)} ${P(B, e)} ${P(s.A, e)}"/>`;
      }).join('');
      const b = bbox(walls);
      out += `<g class="floor-ref" style="--lc:${col};stroke-width:${1.2 / z};stroke-dasharray:${6 / z} ${4 / z}">${segs}</g>` +
        `<text class="floor-ref-label" x="${round(b.x, 2)}" y="${round(b.y - 6 / z, 2)}" style="--lc:${col};font-size:${10.5 / z}px">${esc(L.name)} ${fmtElev(floorAbs(L))}</text>`;
    }
    return out;
  }
  // walls of the reference level: faint outlines with dashed centrelines, drawn under the current level
  function refWalls() {
    const others = otherFloorWalls();
    if (!state.showRef || !state.refLevel || state.refLevel === state.level) return others;
    const refItems = state.items.filter((it) => lvlOf(it) === state.refLevel);
    const z = state.zoom;
    // a basement under this level: its outer outline (outer faces of its walls), bold and dashed, with a label
    const refL = levelById(state.refLevel);
    let outline = '';
    if (refL && refL.elev < 0 && refL.elev < curLevel().elev) {
      const walls = refItems.filter((i) => window.FPWalls.isWall(i));
      const b = walls.length ? bbox(walls) : null;
      // traced once per wall layout (the plan redraws on every mouse move while dragging)
      const key = JSON.stringify(walls.map((w) => [w.type, w.x, w.y, w.w, w.h, w.r, w.t, w.fx, w.fy]));
      if (key !== refWalls.key) { refWalls.key = key; refWalls.ring = walls.length ? (wallOutline(walls) || [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]) : null; }
      const ring = refWalls.ring;
      if (ring) {
        const top = ring.reduce((m, q) => (q[1] < m[1] || (q[1] === m[1] && q[0] < m[0]) ? q : m), ring[0]);
        outline = `<polygon class="ref-outline" points="${ring.map((q) => `${round(q[0], 2)},${round(q[1], 2)}`).join(' ')}" style="stroke-width:${2.4 / z};stroke-dasharray:${14 / z} ${7 / z}"/>` +
          `<text class="ref-outline-label" x="${round(top[0], 2)}" y="${round(top[1] - 8 / z, 2)}" style="font-size:${11 / z}px">${esc(refL.name)} outline (${fmtElev(refL.elev)})</text>`;
      }
    }
    // floor openings of the reference level too (dashed outline with a cross), to line stairs up under them
    const holes = refItems.filter((it) => it.type === 'slab-opening').map((op) => {
      const tf = window.FPWalls.toWorld(op), c = [tf([0, 0]), tf([op.w, 0]), tf([op.w, op.h]), tf([0, op.h])];
      const pts = c.map((p) => `${round(p[0], 2)},${round(p[1], 2)}`).join(' ');
      return `<polygon class="ref-hole" points="${pts}" style="stroke-width:${1.4 / z};stroke-dasharray:${8 / z} ${5 / z}"/>` +
        `<path class="ref-hole-x" d="M${c[0]}L${c[2]}M${c[1]}L${c[3]}" style="stroke-width:${1 / z};stroke-dasharray:${8 / z} ${5 / z}"/>`;
    }).join('');
    return others + outline + holes + window.FPWalls.wallSegments(refItems).map((s) => {
      const B = [s.A[0] + s.u[0] * s.len, s.A[1] + s.u[1] * s.len], e = s.t / 2;
      const P = (p, k) => `${round(p[0] + s.n[0] * k, 2)},${round(p[1] + s.n[1] * k, 2)}`;
      // both faces as dashed lines (the usual way of drawing walls of another storey), over a faint fill
      return `<polygon class="ref-wall" points="${P(s.A, -e)} ${P(B, -e)} ${P(B, e)} ${P(s.A, e)}" style="stroke-width:${1.3 / z};stroke-dasharray:${7 / z} ${4 / z}"/>`;
    }).join('');
  }
  /* Outline dimensions (toolbar "Dimensions"): a dimension line along every edge of the building's outline on this
     level — the outer faces of its walls (else of the reference level shown under it, e.g. the basement) — with its
     length in metres. Sizes follow the zoom so they stay readable. */
  function outlineForDims() {
    const W = window.FPWalls;
    let walls = levelItems().filter((i) => W.isWall(i));
    if (!walls.length && refShown()) walls = state.items.filter((i) => lvlOf(i) === state.refLevel && W.isWall(i));
    if (!walls.length) return null;
    const key = JSON.stringify(walls.map((w) => [w.id, w.type, w.x, w.y, w.w, w.h, w.r, w.t, w.fx, w.fy]));
    if (key !== outlineForDims.key) {
      // separate parts of the building (walls that touch or nearly touch belong together) each get their outline
      const boxes = walls.map((w) => bbox([w])), parent = walls.map((_, i) => i);
      const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      const gap = Math.max(10, state.fillGap || 10);
      for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x - gap <= b.x + b.w && b.x - gap <= a.x + a.w && a.y - gap <= b.y + b.h && b.y - gap <= a.y + a.h) parent[find(i)] = find(j);
      }
      const groups = new Map();
      walls.forEach((w, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(w); });
      outlineForDims.key = key;
      outlineForDims.rings = [...groups.values()].map((g) => {
        const b = bbox(g);
        return wallOutline(g) || [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
      });
    }
    return outlineForDims.rings;
  }
  function dimMarkup() {
    if (!state.showDims) return '';
    const rings = outlineForDims();
    if (!rings) return '';
    return rings.map((ring) => dimRing(ring)).join('');
  }
  function dimRing(ring) {
    if (!ring || ring.length < 3) return '';
    const z = state.zoom, off = 34 / z, ext = 6 / z, tick = 5 / z, fs = 11 / z;
    const area = ring.reduce((a, [x, y], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return a + x * y2 - x2 * y; }, 0);
    const sg = area > 0 ? 1 : -1;
    const P = (p) => `${round(p[0], 2)},${round(p[1], 2)}`;
    let out = '';
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 20) return; // too short to dimension
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [u[1] * sg, -u[0] * sg]; // n points outwards
      const A = [a[0] + n[0] * off, a[1] + n[1] * off], B = [b[0] + n[0] * off, b[1] + n[1] * off];
      const e = (p, d) => [p[0] + n[0] * d, p[1] + n[1] * d];
      // extension lines from the corners, the dimension line, slanted end ticks, the length
      out += `<path class="dim-ext" d="M${P(e(a, 4 / z))}L${P(e(a, off + ext))}M${P(e(b, 4 / z))}L${P(e(b, off + ext))}" style="stroke-width:${0.8 / z}"/>`;
      const t = [(u[0] + n[0]) * tick, (u[1] + n[1]) * tick];
      out += `<path class="dim-line" d="M${P(A)}L${P(B)}M${P([A[0] - t[0], A[1] - t[1]])}L${P([A[0] + t[0], A[1] + t[1]])}M${P([B[0] - t[0], B[1] - t[1]])}L${P([B[0] + t[0], B[1] + t[1]])}" style="stroke-width:${1 / z}"/>`;
      let ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180; else if (ang <= -90) ang += 180; // keep the text upright
      const m = [(A[0] + B[0]) / 2 + n[0] * 3 / z, (A[1] + B[1]) / 2 + n[1] * 3 / z];
      // text sits on the outer side of the line
      const up = n[1] * Math.cos((ang * Math.PI) / 180) - n[0] * Math.sin((ang * Math.PI) / 180) < 0;
      out += `<text class="dim-text" x="${round(m[0], 2)}" y="${round(m[1], 2)}" transform="rotate(${round(ang, 2)} ${round(m[0], 2)} ${round(m[1], 2)})" ` +
        `dy="${up ? -2 / z : fs + 1 / z}" style="font-size:${fs}px;stroke-width:${3 / z}px">${(L / 100).toFixed(2)} m</text>`;
    });
    return out;
  }
  const refShown = () => state.showRef && state.refLevel && state.refLevel !== state.level && levelById(state.refLevel);
  const refSegs = () => (refShown() ? window.FPWalls.wallSegments(state.items.filter((it) => lvlOf(it) === state.refLevel)) : []);
  // the reference level stands on this one: its walls must be carried by this level's walls
  const refIsAbove = () => refShown() && levelById(state.refLevel).elev > curLevel().elev;
  /* centrelines of the reference walls, drawn OVER this level so they stay visible where walls sit under them.
     When the reference level stands on this one, each stretch is coloured: carried by a wall here, or not. */
  function refAxes() {
    const segs = refSegs();
    if (!segs.length) return '';
    const z = state.zoom, dash = `stroke-dasharray:${12 / z} ${5 / z} ${2 / z} ${5 / z}`;
    const line = (s, a, b, cls) => {
      const P = (k) => [round(s.A[0] + s.u[0] * k, 2), round(s.A[1] + s.u[1] * k, 2)];
      const [p, q] = [P(a), P(b)];
      const w = (cls === 'free' ? 2.2 : 1.6) / z, xy = `x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"`;
      // a light halo underneath keeps the line readable on top of dark wall fills
      return `<line class="ref-halo" ${xy} style="stroke-width:${w + 2.4 / z}"/>` +
        `<line class="ref-axis ${cls}" ${xy} style="stroke-width:${w};${dash}"/>`;
    };
    if (!refIsAbove()) return segs.map((s) => line(s, 0, s.len, '')).join('');
    return window.FPWalls.axisSupport(segs, levelItems()).map(({ seg, runs }) =>
      runs.map((r) => line(seg, r.from, r.to, r.ok ? 'carried' : 'free')).join('')).join('');
  }
  // totals for the panel: how much of the walls above is carried by walls on this level
  function refSupportTotals() {
    if (!refIsAbove()) return null;
    const res = window.FPWalls.axisSupport(refSegs(), levelItems());
    const total = res.reduce((t, r) => t + r.seg.len, 0), carried = res.reduce((t, r) => t + r.carried, 0);
    return total ? { total, carried, free: total - carried } : null;
  }

  /* Floor slabs are drawn in the order of their height: a higher slab (a mezzanine, a half-level floor) lies over a
     lower one on the plan, so it can be seen and picked even when it was added after the lower one. */
  function slabsByHeight(items) {
    const slabs = items.filter((i) => i.type === 'slab');
    if (slabs.length < 2) return items;
    const z = new Map(slabs.map((s) => { let b = 0; try { b = slabInfo(s).bottom; } catch (e) { /* keep 0 */ } return [s, b]; }));
    const sorted = slabs.map((s, k) => [s, k]).sort((a, b) => z.get(a[0]) - z.get(b[0]) || a[1] - b[1]).map((x) => x[0]);
    let k = 0;
    return items.map((i) => (i.type === 'slab' ? sorted[k++] : i));
  }
  function render() {
    slabGray.cache = null; // slab greys are worked out afresh for each drawing
    syncBalconyDoors(); // balconies and their doors are separate objects
    const items = levelItems();
    wallModel = window.FPWalls.analyze(items);
    $('#cutDefs').innerHTML = cutMasks();
    $('#refLayer').innerHTML = refWalls();
    $('#refAxes').innerHTML = refAxes();
    $('#dimLayer').innerHTML = dimMarkup();
    const drawn = slabsByHeight(items);
    itemsLayer.innerHTML = drawn.map((it) => itemMarkup(it)).join('');
    labelsLayer.innerHTML = drawn.map(labelMarkup).join('');
    $('#stLevel').textContent = `${curLevel().name} · ${fmtElev(floorAbs(curLevel()))}${workRel() ? ` · working height ${fmtElev(state.workZ)}` : ''}`;
    renderLevelTabs();
    renderHeightBar();
    renderOverlay();
    $('#emptyHint').style.display = items.length ? 'none' : '';
    $('#emptyHint p').textContent = state.items.length ? `${curLevel().name} is empty — drag icons from the left panel to design this level`
      : 'Drag icons from the left panel to start your floor plan';
    updateStatus();
    refreshList();
    notify('items');
  }
  const notify = (kind) => { if (!demo.building && window.FP.onChange) window.FP.onChange(kind); };

  function renderView() {
    viewport.setAttribute('transform', `translate(${state.panX} ${state.panY}) scale(${state.zoom})`);
    const z = state.zoom, g = gridCm();
    const minor = $('#gridMinor'), major = $('#gridMajor');
    minor.setAttribute('width', g); minor.setAttribute('height', g);
    minor.querySelector('path').setAttribute('d', `M${g} 0H0V${g}`);
    minor.querySelector('path').setAttribute('stroke-width', 1 / z);
    const M = g * Math.max(1, Math.round((imperial() ? 4 * 12 * IN : 100) / g)); // major lines: every metre / every 4 ft
    major.setAttribute('width', M); major.setAttribute('height', M);
    major.querySelector('rect').setAttribute('width', M); major.querySelector('rect').setAttribute('height', M);
    major.querySelector('path').setAttribute('d', `M${M} 0H0V${M}`);
    major.querySelector('path').setAttribute('stroke-width', 1 / z);
    // hide the fine grid when it would be too dense
    minor.querySelector('path').style.display = g * z < 4 ? 'none' : '';
    $('#grid').style.display = state.showGrid ? '' : 'none';
    $('#bg').style.fill = state.bg;
    wrap.style.background = state.bg;
    $('#zoomLabel').textContent = Math.round(z * 100) + '%';
    $('#refLayer').innerHTML = refWalls(); // line widths follow the zoom
    $('#refAxes').innerHTML = refAxes();
    $('#dimLayer').innerHTML = dimMarkup();
    renderOverlay();
  }

  function renderOverlay() {
    if (isMulti()) return renderMultiOverlay();
    const it = sel();
    if (!it) { overlay.innerHTML = ''; return; }
    const z = state.zoom, s = 9 / z, w = it.w, h = it.h, sw = 1 / z;
    let out = `<g transform="translate(${it.x} ${it.y}) rotate(${it.r} ${w / 2} ${h / 2})">` +
      `<rect class="selbox" x="${-2 / z}" y="${-2 / z}" width="${w + 4 / z}" height="${h + 4 / z}" style="stroke-width:${1.5 / z};stroke-dasharray:${5 / z} ${3 / z}"/>`;
    if (!it.locked) {
      const ry = -30 / z;
      out += `<line class="rotline" x1="${w / 2}" y1="0" x2="${w / 2}" y2="${ry}" style="stroke-width:${sw}"/>` +
        `<circle class="handle rot" data-handle="rot" cx="${w / 2}" cy="${ry}" r="${6 / z}" style="stroke-width:${sw}"/>`;
      for (const [hx, hy] of HANDLES) {
        const cx = ((hx + 1) / 2) * w, cy = ((hy + 1) / 2) * h;
        out += `<rect class="handle" data-handle="${hx},${hy}" x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" ` +
          `style="stroke-width:${sw};cursor:${rotCursor(hx, hy, it.r)}-resize"/>`;
      }
    }
    // an L-shaped hip roof: a diamond at the inner corner of the part left out — drag it to size that part
    if (!it.locked && byId[it.type].roof === 'hip-l') {
      const Ls = window.FP_ROOFS.lShape(w, h, it), [nx, ny] = Ls.reflex, d = 8 / z;
      out += `<path class="handle lcut" data-handle="lcut" d="M${nx} ${ny - d}L${nx + d} ${ny}L${nx} ${ny + d}L${nx - d} ${ny}Z" ` +
        `style="stroke-width:${sw};cursor:move;fill:#f59e0b"><title>Drag to size the part of the roof left out</title></path>`;
    }
    // faces picked in the properties diagram are shown as thick lines along the wall
    const picked = new Set(pickedFaces(it));
    const faceLines = picked.size ? window.FPWalls.wallFaces(it).faces.filter((f) => picked.has(f.key)).map((f) =>
      `<line class="face-pick" x1="${f.P[0]}" y1="${f.P[1]}" x2="${f.Q[0]}" y2="${f.Q[1]}" style="stroke-width:${5 / z}"/>`).join('') : '';
    overlay.innerHTML = out + '</g>' + faceLines;
  }
  // several objects: an outline on each, plus a dashed box around the whole group
  function renderMultiOverlay() {
    const items = sels(), z = state.zoom;
    let out = items.map((it) =>
      `<rect class="selbox" x="${it.x - 2 / z}" y="${it.y - 2 / z}" width="${it.w + 4 / z}" height="${it.h + 4 / z}" ` +
      `transform="rotate(${it.r} ${it.x + it.w / 2} ${it.y + it.h / 2})" style="stroke-width:${1.5 / z};stroke-dasharray:${5 / z} ${3 / z}${it.locked ? ';stroke:#b45309' : ''}"/>`).join('');
    const b = bbox(items), p = 8 / z;
    out += `<rect class="groupbox" x="${b.x - p}" y="${b.y - p}" width="${b.w + 2 * p}" height="${b.h + 2 * p}" style="stroke-width:${1 / z};stroke-dasharray:${2 / z} ${3 / z}"/>`;
    // a turning handle above the group (45° steps), like the one of a single object
    if (items.some((i) => !i.locked)) {
      const cx = b.x + b.w / 2, ry = b.y - p - 30 / z;
      out += `<line class="rotline" x1="${cx}" y1="${b.y - p}" x2="${cx}" y2="${ry}" style="stroke-width:${1 / z}"/>` +
        `<circle class="handle rot" data-handle="grot" cx="${cx}" cy="${ry}" r="${6 / z}" style="stroke-width:${1 / z}"><title>Drag to turn the group (45° steps)</title></circle>`;
    }
    overlay.innerHTML = out;
  }
  // pick the resize cursor closest to the handle's on-screen direction
  function rotCursor(hx, hy, r) {
    const a = ((Math.atan2(hy, hx) * 180) / Math.PI + r + 360) % 180;
    const opts = [[0, 'ew'], [45, 'nwse'], [90, 'ns'], [135, 'nesw'], [180, 'ew']];
    return opts.reduce((b, o) => (Math.abs(o[0] - a) < Math.abs(b[0] - a) ? o : b))[1];
  }

  function updateStatus(p) {
    if (p) $('#stCursor').textContent = imperial() ? `X ${fmtFtIn(p.x)} · Y ${fmtFtIn(p.y)}` : `X ${(p.x / 100).toFixed(2)} · Y ${(p.y / 100).toFixed(2)} m`;
    const it = sel();
    $('#stSel').textContent = isMulti()
      ? `${state.multi.size} objects selected`
      : it
        ? `${itemName(it)} — ${round(it.w / 100, 2)} × ${round(it.h / 100, 2)} m${it.r ? ` · ${round(it.r)}°` : ''}`
        : `${levelItems().length} object${levelItems().length === 1 ? '' : 's'}`;
  }

  function updateButtons() {
    document.querySelector('[data-act="undo"]').disabled = histIdx <= 0;
    document.querySelector('[data-act="redo"]').disabled = histIdx >= hist.length - 1;
    const has = selIds().length > 0;
    for (const a of ['rotate', 'duplicate', 'delete']) document.querySelector(`[data-act="${a}"]`).disabled = !has;
  }

  /* ───────────────────────── palette (left) ───────────────────────── */
  // small square sample of a floor material, for the material picker
  function materialSwatch(key) {
    const ic = byId.floor, m = MATERIALS[key];
    const p = { material: key, fill: m.color, patId: 'sw-' + key, w0: 120, h0: 120 };
    return `<svg viewBox="0 0 120 120" width="100%" height="100%" stroke="none">${ic.draw(120, 120, p)}</svg><span>${esc(m.name)}</span>`;
  }

  function previewSVG(ic, extra = '', item = null) {
    // a catalog picture (balconies): drawn as seen, not as on the plan
    if (ic.thumb && !item) return `<svg viewBox="0 0 120 90" preserveAspectRatio="xMidYMid meet" class="thumb" ${extra}>${ic.thumb()}</svg>`;
    const p = item || { t: 15, label: ic.label || '' };
    // pad tiny icons so they are not blown up to fill the whole tile
    const W = Math.max(ic.w, 70), H = Math.max(ic.h, 70);
    const vb = `${-(W - ic.w) / 2} ${-(H - ic.h) / 2} ${W} ${H}`;
    return `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" ` +
      `stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" ${extra}>${iconInner(ic, ic.w, ic.h, p)}</svg>`;
  }
  function buildPalette() {
    const visible = ICONS.filter((i) => !i.hidden);
    const cats = [...new Set(visible.map((i) => i.cat))];
    $('#palette').innerHTML = cats.map((c) => {
      const list = visible.filter((i) => i.cat === c);
      return `<details class="cat" data-cat="${esc(c)}" open><summary>${esc(c)}<span class="count">${list.length}</span></summary><div class="tiles">` +
        list.map((ic) => `<div class="tile" draggable="true" data-type="${ic.id}" title="${esc(ic.name)}">${previewSVG(ic)}<span>${esc(ic.name)}</span></div>`).join('') +
        `</div></details>`;
    }).join('');
    filterPalette(); // the chosen category / search
  }
  /* Filtering the picker: the category drop-down ("All" or one category) and the search text work together.
     The chosen category is remembered in this browser. */
  const catSel = $('#iconCat');
  {
    const visible = ICONS.filter((i) => !i.hidden), cats = [...new Set(visible.map((i) => i.cat))];
    catSel.innerHTML = `<option value="">All categories (${visible.length})</option>` +
      cats.map((c) => `<option value="${esc(c)}">${esc(c)} (${visible.filter((i) => i.cat === c).length})</option>`).join('');
    let saved = '';
    try { saved = localStorage.getItem('floorplan2027.iconCat') || ''; } catch (e) { /* storage unavailable */ }
    if (cats.includes(saved)) catSel.value = saved;
  }
  function filterPalette() {
    const q = $('#iconSearch').value.trim().toLowerCase(), only = catSel.value;
    document.querySelectorAll('#palette .cat').forEach((cat) => {
      let n = 0;
      if (!only || cat.dataset.cat === only) cat.querySelectorAll('.tile').forEach((t) => {
        const ic = byId[t.dataset.type];
        // within a chosen category the search looks at the icon names only (its own name would match them all)
        const show = !q || ic.name.toLowerCase().includes(q) || (!only && ic.cat.toLowerCase().includes(q));
        t.style.display = show ? '' : 'none';
        if (show) n++;
      });
      cat.style.display = n ? '' : 'none';
      if (q || only) cat.open = true; // a chosen category or a search shows its icons
    });
    $('#palette').scrollTop = 0;
  }
  $('#iconSearch').addEventListener('input', filterPalette);
  catSel.addEventListener('change', () => {
    try { localStorage.setItem('floorplan2027.iconCat', catSel.value); } catch (e) { /* storage unavailable */ }
    filterPalette();
  });
  $('#palette').addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    if (t.dataset.type === 'slab' || t.dataset.type === 'slab-concrete') {
      const kind = t.dataset.type === 'slab' ? 'wood' : 'concrete';
      if (state.tool === 'slab' && state.slabKind !== kind) { state.slabKind = kind; slabToolUI(); return; } // switch kind, stay on
      state.slabKind = kind;
      return setTool('slab');
    }
    if (byId[t.dataset.type].tool) return setTool(byId[t.dataset.type].tool); // e.g. lining a room with interior walls
    const r = svg.getBoundingClientRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    addItem(t.dataset.type, c.x, c.y);
  });
  // right-click an icon: a 3D preview of it, for reference (js/view3d.js)
  $('#palette').addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.tile');
    if (!t || !window.FP3D || !window.FP3D.showIconPreview) return;
    e.preventDefault();
    window.FP3D.showIconPreview(t.dataset.type, t.getBoundingClientRect());
  });
  $('#palette').addEventListener('dragstart', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    e.dataTransfer.setData('text/x-fp-icon', t.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
  });
  wrap.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].some((t) => t === 'text/x-fp-icon' || t === 'text/x-fp-prefab')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    wrap.classList.add('drop');
  });
  wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('drop'); });
  wrap.addEventListener('drop', (e) => {
    wrap.classList.remove('drop');
    const pf = (window.FP_PREFABS || []).find((x) => x.id === e.dataTransfer.getData('text/x-fp-prefab'));
    if (pf) { e.preventDefault(); const p = toWorld(e.clientX, e.clientY); return placePrefab(pf, p.x, p.y); }
    const type = e.dataTransfer.getData('text/x-fp-icon');
    if (!type || !byId[type]) return;
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    if (byId[type].tool === 'lining') return lineRoom(p); // dropped on a room: line that room
    addItem(type, p.x, p.y);
  });
  /* ───────────────────────── prefabs (left panel, "Prefab" tab) ─────────────────────────
   * Ready-made groupings from js/prefabs.js. Placed as ordinary objects sharing a group number (item.grp, item.grpName):
   * a click on one selects the whole group (so it moves, turns and is deleted as one), Alt+click selects one object of it.
   * Objects can be taken out of a group, or added (select the group + the others, then "Group"). */
  const PREFABS = window.FP_PREFABS || [];
  const prefabCat = $('#prefabCat'), prefabShell = $('#prefabShell');
  {
    const cats = [...new Set(PREFABS.map((p) => p.cat))];
    prefabCat.innerHTML = `<option value="">All prefabs (${PREFABS.length})</option>` +
      cats.map((c) => `<option value="${esc(c)}">${esc(c)} (${PREFABS.filter((p) => p.cat === c).length})</option>`).join('');
    try {
      const c = localStorage.getItem('floorplan2027.prefabCat'); if (cats.includes(c)) prefabCat.value = c;
      prefabShell.checked = localStorage.getItem('floorplan2027.prefabShell') !== '0';
    } catch (e) { /* storage unavailable */ }
  }
  const isShell = (type) => window.FPWalls.WALL_TYPES.has(type) || !!byId[type].opening;
  // the objects of a prefab as plan items (not yet in the plan), its top-left at (ox, oy)
  function prefabItems(pf, ox, oy, shell = prefabShell.checked) {
    return pf.items.filter(([type]) => byId[type] && (shell || !isShell(type))).map(([type, cx, cy, r = 0, extra = {}]) => {
      const it = newItem(type, ox + cx, oy + cy);
      Object.assign(it, extra);
      it.x = round(ox + cx - it.w / 2, 2); it.y = round(oy + cy - it.h / 2, 2); it.r = r;
      return it;
    });
  }
  let prefabKey = '';
  function buildPrefabList() {
    const only = prefabCat.value, key = [only, prefabShell.checked].join('|');
    if (key === prefabKey && $('#prefabList').childElementCount) return;
    prefabKey = key;
    const save = nextId;
    let html = '', last = '';
    for (const pf of PREFABS.filter((p) => !only || p.cat === only)) {
      if (pf.cat !== last) { html += `<div class="pf-cat">${esc(pf.cat)}</div>`; last = pf.cat; }
      // preview: the objects drawn as on the plan (temporary ids, never in the plan)
      const items = prefabItems(pf, 0, 0).map((it, i) => ({ ...it, id: -1 - i }));
      const m = 25, n = items.length;
      html += `<button class="pf-card" draggable="true" data-prefab="${pf.id}" title="${esc(pf.note || pf.name)} — drag onto the plan, or click to add it at the centre">` +
        (pf.thumb && window.FP_BALCONY_PIC ? `<svg viewBox="0 0 120 90" preserveAspectRatio="xMidYMid meet" class="pf-pic">${window.FP_BALCONY_PIC(pf.thumb)}</svg>` // a picture (balconies)
          : `<svg viewBox="${-m} ${-m} ${pf.w + 2 * m} ${pf.h + 2 * m}" preserveAspectRatio="xMidYMid meet">${items.map((it) => itemMarkup(it, true)).join('')}</svg>`) +
        `<b>${esc(pf.name)}</b><small>${(pf.w / 100).toFixed(1)} × ${(pf.h / 100).toFixed(1)} m · ${n} object${n === 1 ? '' : 's'}<br>${esc(pf.note || '')}</small></button>`;
    }
    nextId = save; // the previews used no ids of the plan
    $('#prefabList').innerHTML = html || '<p class="note" style="padding:8px">No prefabs.</p>';
  }
  prefabCat.addEventListener('change', () => { try { localStorage.setItem('floorplan2027.prefabCat', prefabCat.value); } catch (e) { /* */ } buildPrefabList(); });
  prefabShell.addEventListener('change', () => { try { localStorage.setItem('floorplan2027.prefabShell', prefabShell.checked ? '1' : '0'); } catch (e) { /* */ } buildPrefabList(); });
  $('#prefabList').addEventListener('click', (e) => {
    const c = e.target.closest('[data-prefab]');
    if (!c) return;
    const pf = PREFABS.find((p) => p.id === c.dataset.prefab), r = svg.getBoundingClientRect();
    const p = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    placePrefab(pf, p.x, p.y);
  });
  // right-click a prefab: a 3D preview of the whole set (js/view3d.js)
  $('#prefabList').addEventListener('contextmenu', (e) => {
    const c = e.target.closest('[data-prefab]');
    if (!c || !window.FP3D || !window.FP3D.showPrefabPreview) return;
    e.preventDefault();
    window.FP3D.showPrefabPreview(c.dataset.prefab, c.getBoundingClientRect());
  });
  $('#prefabList').addEventListener('dragstart', (e) => {
    const c = e.target.closest('[data-prefab]');
    if (!c) return;
    e.dataTransfer.setData('text/x-fp-prefab', c.dataset.prefab);
    e.dataTransfer.effectAllowed = 'copy';
  });
  const nextGrp = () => state.items.reduce((m, i) => Math.max(m, +i.grp || 0), 0) + 1;
  // a prefab centred on (cx, cy) on the current level, as one group; doors and windows are fitted into its walls
  function placePrefab(pf, cx, cy) {
    if (!pf) return;
    ensureWorkLevel(true); // a working height picked in the 3D view: add on the level that holds it
    const items = prefabItems(pf, snapTo(cx - pf.w / 2, snapOn()), snapTo(cy - pf.h / 2, snapOn()));
    // the set goes in at the height chosen in the Height bar (when it is above this level's floor): a balcony's floor,
    // a door's threshold, a wall's foot and the objects all that much higher
    { const c = workRel();
      if (c >= 1) for (const it of items) {
        if (it.type === 'balcony' || isObject(it) || (window.FPWalls.isOpening(it) && !isWindowItem(it))) it.z = round((it.z || 0) + c, 1);
        else if (hasHeight(it.type)) it.wz = round((it.wz || 0) + c, 1);
      } }
    const grp = nextGrp();
    for (const it of items) { it.grp = grp; it.grpName = pf.name; }
    // a balcony set: turned and moved with its balcony to face out from the house wall, and given its sliding door
    const bal = items.find((i) => i.type === 'balcony');
    if (bal) {
      const c0 = [bal.x + bal.w / 2, bal.y + bal.h / 2], r0 = bal.r || 0;
      if (fitBalcony(bal)) {
        const c1 = [bal.x + bal.w / 2, bal.y + bal.h / 2], dr = ((bal.r || 0) - r0) * Math.PI / 180, cs = Math.cos(dr), sn = Math.sin(dr);
        for (const it of items) {
          if (it === bal) continue;
          const vx = it.x + it.w / 2 - c0[0], vy = it.y + it.h / 2 - c0[1];
          const nx = c1[0] + vx * cs - vy * sn, ny = c1[1] + vx * sn + vy * cs;
          it.x = round(nx - it.w / 2, 1); it.y = round(ny - it.h / 2, 1); it.r = normAngle((it.r || 0) + (bal.r || 0) - r0);
        }
      }
      bal.fill = bal.fill || '#e7e2d9';
    }
    state.items.push(...items);
    if (bal) { bal.grp = grp; const door = addBalconyDoor(bal); if (door) items.push(door); } // (the door: an object of its own)
    if (state.align) for (const it of items) if (window.FPWalls.isOpening(it)) autoAlign(it, true);
    applySel(items.map((i) => i.id));
    render(); refreshSelectionUI(); commit();
    $('#stAlign').textContent = '';
    toast(`${pf.name} placed as a group of ${items.length} objects. Drag or turn it as one; Alt+click an object to change just that one.`);
  }
  // the objects grouped with it (on its level), else only itself
  function groupIds(it) {
    if (!it || !it.grp) return it ? [it.id] : [];
    return state.items.filter((i) => i.grp === it.grp && lvlOf(i) === lvlOf(it)).map((i) => i.id);
  }
  function groupSelection() {
    const items = sels();
    if (items.length < 2) return;
    // join the largest group among them (keeping its name), else start a new one
    const counts = new Map();
    for (const i of items) if (i.grp) counts.set(i.grp, (counts.get(i.grp) || 0) + 1);
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    const grp = best ? best[0] : nextGrp();
    const name = (best && (state.items.find((i) => i.grp === grp) || {}).grpName) || 'Group';
    for (const i of items) { i.grp = grp; i.grpName = name; }
    toast(`${items.length} objects are now one group (${name}).`);
  }
  function ungroupSelection() {
    const items = sels();
    for (const i of items) { delete i.grp; delete i.grpName; }
    toast(`Ungrouped ${items.length} objects — each is on its own now.`);
  }
  // Properties: the group of a multiple selection
  function groupSection(items) {
    const grps = new Set(items.map((i) => i.grp || 0)), g = items[0].grp;
    if (grps.size === 1 && g) {
      const all = state.items.filter((i) => i.grp === g && lvlOf(i) === lvlOf(items[0])).length;
      return `
      <section><h3>Prefab group</h3>
        <div class="row"><label>Group</label><span><b>${esc(items[0].grpName || 'Group')}</b> · ${all} object${all === 1 ? '' : 's'}</span></div>
        <div class="btns"><button data-mdo="ungroup" title="Turn it back into separate objects">Ungroup</button></div>
        <p class="note" style="color:var(--muted)">A click selects the whole group, so it moves, turns and is deleted as one. <b>Alt+click</b> an object to change, turn or delete just that one.
          To add objects, Shift+click them with the group selected, then press <b>Group</b>.</p>
      </section>`;
    }
    const any = items.some((i) => i.grp);
    return `
      <section><h3>Group</h3>
        <div class="btns"><button data-mdo="group" title="Tie these objects together: a click then selects all of them">Group these ${items.length}</button>
          ${any ? '<button data-mdo="ungroup">Ungroup</button>' : ''}</div>
        <p class="note" style="color:var(--muted)">${any ? 'Grouping adds the other objects to the largest group among them.' : 'Grouped objects are selected, moved and turned together.'}</p>
      </section>`;
  }

  /* ───────────────────────── object list (left panel, "Objects" tab) ───────────────────────── */
  const GROUP_ORDER = ['Walls & Structure', 'Roofs', 'Doors', 'Windows', 'Floors', 'Stairs', 'Living & Bedroom', 'Kitchen & Bath', 'Tables', 'Garden', 'Vehicles'];
  const collapsedGroups = new Set();
  let listTab = 'icons';
  let listPending = false;

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    listTab = b.dataset.tab;
    document.querySelectorAll('.tabs [data-tab]').forEach((t) => t.classList.toggle('on', t === b));
    $('#viewIcons').hidden = listTab !== 'icons';
    $('#viewPrefab').hidden = listTab !== 'prefab';
    $('#viewObjects').hidden = listTab !== 'objects';
    if (listTab === 'prefab') buildPrefabList();
    if (listTab === 'objects') { buildObjectList(); scrollToSelected(); }
  });
  $('#objSearch').addEventListener('input', () => buildObjectList());

  // coalesce many updates (e.g. while dragging) into one rebuild per frame
  function refreshList() {
    $('#objCount').textContent = levelItems().length;
    if (listTab !== 'objects' || listPending) return;
    listPending = true;
    requestAnimationFrame(() => { listPending = false; buildObjectList(); });
  }

  function objectInfo(it) {
    const ic = byId[it.type];
    const size = `${round(it.w / 100, 2)} × ${round(it.h / 100, 2)} m`;
    if (it.type === 'floor') return `${MATERIALS[it.material] ? MATERIALS[it.material].name : 'Floor'} · ${round(floorArea(it), 2)} m²${it.elev ? ` · FFL ${fmtElev(it.elev)}` : ''}`;
    if (hasHeight(it.type)) return `${WALLMATS.MATS[it.wmat || 'plaster'].name} · ${size} · h ${((it.wh || state.wallH) / 100).toFixed(2)} m`;
    if (ic.stairs) return `${window.FP_STAIRS.stepsOf(it.type, it)} steps · rise ${(stairRise(it) / 100).toFixed(2)} m · ${size}`;
    if (ic.height) return `${round(Math.max(it.w, it.h) / 100, 2)} m long · ${((it.fh || ic.height) / 100).toFixed(2)} m high`;
    return ic.ownLabel ? `${(Math.max(it.w, it.h) / 100).toFixed(2)} m` : size;
  }

  function buildObjectList() {
    const list = $('#objList');
    const q = $('#objSearch').value.trim().toLowerCase();
    const groups = new Map();
    for (const it of levelItems()) {
      const ic = byId[it.type];
      const garden = it.type === 'floor' && it.garden;
      const name = it.label || itemName(it), cat = garden ? 'Garden' : ic.cat;
      const info = objectInfo(it);
      if (q && !`${name} ${ic.name} ${itemName(it)} ${info}`.toLowerCase().includes(q)) continue;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push({ it, ic, name, info });
    }
    if (!levelItems().length) {
      list.innerHTML = `<p class="obj-empty">No objects on ${esc(curLevel().name)} yet.<br>Add icons from the Icons tab.</p>`;
      return;
    }
    if (!groups.size) { list.innerHTML = `<p class="obj-empty">Nothing matches “${esc(q)}”.</p>`; return; }
    const cats = [...groups.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 99) % 99 - (GROUP_ORDER.indexOf(b) + 99) % 99);
    // eye = shown in 3D, crossed-out eye = hidden in 3D
    const eyeIcon = (hidden) => `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/>` +
      `<circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/>${hidden ? '<path d="M4 20L20 4" stroke="currentColor" stroke-width="2.2"/>' : ''}</svg>`;
    const lockIcon = (on) => `<svg viewBox="0 0 24 24" width="14" height="14"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>` +
      `<path d="${on ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-2'}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const selected = new Set(selIds());
    const delIcon = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    list.innerHTML = cats.map((cat) => {
      const rows = groups.get(cat);
      return `<details class="obj-group" data-cat="${esc(cat)}" ${collapsedGroups.has(cat) && !q ? '' : 'open'}>` +
        `<summary>${esc(cat)}<span class="count">${rows.length}</span></summary>` +
        rows.map(({ it, ic, name, info }) =>
          `<div class="obj-row${selected.has(it.id) ? ' on' : ''}${it.hide3d ? ' hidden3d' : ''}" data-id="${it.id}" title="${esc(name)} — #${it.id} (Ctrl/Shift+click to add to the selection)">` +
          `<span class="obj-ic">${previewSVG(ic, `style="color:${it.stroke};--fill:${it.fillNone ? 'none' : it.fill}"`, it.type === 'floor' ? { ...it, patId: 'ol' + it.id } : null)}</span>` +
          `<span class="obj-name"><b>${esc(name)}</b><small>${esc(info)}</small></span>` +
          `<button class="obj-btn eye${it.hide3d ? ' off' : ''}" data-hide3d title="${it.hide3d ? 'Hidden in 3D — click to show' : 'Hide in 3D'}">${eyeIcon(it.hide3d)}</button>` +
          `<button class="obj-btn${it.locked ? ' locked' : ''}" data-lock title="${it.locked ? 'Unlock' : 'Lock'}">${lockIcon(it.locked)}</button>` +
          `<button class="obj-btn del" data-del title="Delete">${delIcon}</button></div>`).join('') +
        `</details>`;
    }).join('');
  }

  function scrollToSelected() {
    const row = $('#objList .obj-row.on');
    if (row && listTab === 'objects') row.scrollIntoView({ block: 'nearest' });
  }

  // remember which groups the user collapsed
  $('#objList').addEventListener('toggle', (e) => {
    const g = e.target.closest('.obj-group');
    if (!g || $('#objSearch').value) return;
    if (g.open) collapsedGroups.delete(g.dataset.cat); else collapsedGroups.add(g.dataset.cat);
  }, true);

  $('#objList').addEventListener('click', (e) => {
    const row = e.target.closest('.obj-row');
    if (!row) return;
    const it = state.items.find((i) => i.id === +row.dataset.id);
    if (!it) return;
    if (e.target.closest('[data-hide3d]')) return setHidden3D([it.id], !it.hide3d);
    if (e.target.closest('[data-lock]')) {
      it.locked = !it.locked;
      render(); if (selIds().includes(it.id)) { buildProps(); renderOverlay(); } commit();
      return;
    }
    if (e.target.closest('[data-del]')) {
      applySel([it.id]);
      del();
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelect(it.id);
    else select(it.id);
  });
  $('#objList').addEventListener('dblclick', (e) => {
    const row = e.target.closest('.obj-row');
    if (row && !e.target.closest('.obj-btn')) focusOn(+row.dataset.id);
  });
  $('#objList').addEventListener('mouseover', (e) => {
    const row = e.target.closest('.obj-row');
    showHover(row ? +row.dataset.id : null);
  });
  $('#objList').addEventListener('mouseleave', () => showHover(null));

  // highlight an object on the plan while its row is hovered
  function showHover(id) {
    const it = id != null && state.items.find((i) => i.id === id);
    const hb = $('#hoverbox');
    if (!it) { hb.innerHTML = ''; return; }
    const z = state.zoom, p = 6 / z;
    hb.innerHTML = `<rect x="${it.x - p}" y="${it.y - p}" width="${it.w + 2 * p}" height="${it.h + 2 * p}" rx="${4 / z}" ` +
      `transform="rotate(${it.r} ${it.x + it.w / 2} ${it.y + it.h / 2})" style="stroke-width:${2 / z};stroke-dasharray:${6 / z} ${4 / z}"/>`;
  }

  // centre the view on an object, zooming so it is comfortably visible
  function focusOn(id) {
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    select(id);
    const r = svg.getBoundingClientRect(), b = bbox([it]);
    const fitZ = Math.min((r.width * 0.5) / Math.max(b.w, 1), (r.height * 0.5) / Math.max(b.h, 1));
    state.zoom = Math.min(4, Math.max(0.1, Math.min(fitZ, Math.max(state.zoom, fitZ * 0.35))));
    state.panX = r.width / 2 - (b.x + b.w / 2) * state.zoom;
    state.panY = r.height / 2 - (b.y + b.h / 2) * state.zoom;
    renderView();
    showHover(id);
  }

  function addItem(type, cx, cy) {
    ensureWorkLevel(true); // a working height picked in the 3D view: add on the level that holds it
    const makes = byId[type].makes; // a picker icon that is a variant of another item type (concrete slab → slab)
    const it = newItem(type, cx, cy);
    if (makes) it.type = makes;
    if (byId[type].preset) Object.assign(it, byId[type].preset); // e.g. an L-stair turning left, a square top step
    it.x = snapMove(it.x);
    it.y = snapMove(it.y);
    if (state.align) autoAlign(it, true);
    $('#stAlign').textContent = '';
    if (isObject(it) && workRel() >= 1) it.z = round(workRel(), 1); // at the working height above the floor
    // doors and openings: their threshold at the working height; windows: their sill there (when above the floor);
    // a sewage hole: its top there
    if (state.workZ != null && isFinite(state.workZ) && window.FPWalls.isOpening(it) && Math.abs(workRel()) >= 1) {
      const ic0 = byId[it.type];
      if (isWindowItem(it)) { if (!(ic0.opening && ic0.opening.top) && workRel() >= 1) { const s0 = it.sill != null ? it.sill : 90, h0 = (it.head != null ? it.head : 210) - s0, tg = zTarget(it, state.workZ); if (tg) { it.sill = round(tg[1], 1); it.head = round(it.sill + h0, 1); } } }
      else { const tg = zTarget(it, state.workZ); if (tg) it[tg[0]] = tg[1]; }
    }
    if (it.type === 'sewage-pit' && Math.abs(workRel()) >= 1) it.z = round(state.workZ - floorUnder(it), 1);
    if (byId[it.type].stairs) {
      /* The height chosen in the Height bar is the top of the stairs; they come down to whatever they stand on (the
         floor, or the outside ground), and the risers are counted to fit. When that height is the floor they stand on,
         they climb to the floor of the level above instead. */
      delete it.z;
      it.autoSteps = true;
      if (!it.under) it.under = 'columns'; // new stairs: hollow, on columns, with a few solid steps at the bottom
      const wz = state.workZ == null ? floorAbs(curLevel()) : state.workZ;
      const startHere = stairHeightMode() === 'start' && wz - stairBottom(it) >= 1; // Settings → Stairs: the Height bar is where they start
      if (startHere) it.z = round(wz - stairBottom(it), 1);
      let bottom = stairBottom(it);
      const sized = () => { if (it.type === 'stairs-l' || it.type === 'stairs-u') fitStairs(it); }; // flights long enough for their steps
      if (!startHere && wz - bottom >= 20) {
        it.topZ = round(wz, 1);
        if (it.type === 'stairs-h') { it.topLanding = true; it.landingD = 120; } // entrance stairs: a landing at the top
      }
      const snapped = snapStairToSlabs(it, true);
      if (snapped) bottom = stairBottom(it);
      it.steps = autoSteps(it);
      sized();
      const rise = stairRise(it), riser = rise / (it.steps + landingRisers(it)), up = stairTarget(it);
      if (startHere && up && rise < 20.5) toast(`Stairs start at ${fmtElev(bottom)} (the Height bar), but the floor of ${up.name} is not above that. Set the top or the total rise in Properties.`, 'error');
      else if (snapped) toast(`Stairs from the top of the floor slab they stand on (${fmtElev(bottom)}) up to ${it.topZ != null ? `the top of the floor slab beside them (${fmtElev(it.topZ)})` : up ? `${up.name} (${fmtElev(bottom + rise)})` : fmtElev(bottom + rise)}: ${it.steps} steps, risers of ${round(riser)} cm. Floor slabs are met on their top surface.`);
      else if (startHere) toast(`Stairs start at ${fmtElev(bottom)} (the Height bar) and climb to ${up ? `${up.name} (${fmtElev(bottom + rise)})` : fmtElev(bottom + rise)}: ${it.steps} steps, risers of ${round(riser)} cm.`);
      else if (it.topZ != null) toast(`Stairs from ${fmtElev(bottom)} (where they stand) up to ${fmtElev(it.topZ)} (the Height bar): ${it.steps} steps, risers of ${round(riser)} cm.`);
      else if (up) toast(`Stairs from ${fmtElev(bottom)} up to ${up.name} (${fmtElev(bottom + rise)}): ${it.steps} steps, risers of ${round(riser)} cm. Pick a higher height in the Height bar to set the top yourself.`);
      else toast(`No top for these stairs: the Height bar is at the floor they stand on (${fmtElev(bottom)}) and there is no level above. Pick the top height in the Height bar, add an upper floor, or type the total rise. Until then they are limited to at most ${MAX_FREE_RISERS} risers: now ${it.steps} steps up to ${fmtElev(bottom + rise)}.`, 'error');
    }
    if (hasHeight(it.type) && Math.abs(workRel()) >= 1) {
      // walls and columns start at the height chosen in the Height bar (their foot, above the outside ground)
      it.wz = round(workRel(), 1);
      $('#stAlign').textContent = `Foot at ${fmtElev(state.workZ)} (the Height bar) — ${(Math.abs(it.wz) / 100).toFixed(2)} m ${it.wz > 0 ? 'above' : 'below'} the ${curLevel().name} floor`;
    }
    if (byId[it.type].roof) {
      const st = byId[it.type].roof;
      Object.assign(it, { pitch: st === 'flat' ? 2 : st === 'shed' || st === 'butterfly' ? 10 : 30, overhang: 40 });
      if (byId[it.type].roofFence && it.roofFence == null) it.roofFence = 50; // fence 0.5 m high
      if (byId[it.type].lCornerDefault && !it.lCorner) it.lCorner = byId[it.type].lCornerDefault; // the left-hand L roof
      // the eaves at exactly the height chosen in the Height bar ("On the walls" in Properties puts it on the walls)
      { if (state.workZ == null || !isFinite(state.workZ)) state.workZ = floorAbs(curLevel());
        it.roofZ = round(state.workZ, 1);
        $('#stAlign').textContent = `Roof eaves at ${fmtElev(it.roofZ)} (the Height bar)`;
      }
      it.roofMat = roofMatOf(it); it.fill = WALLMATS.ROOF_MATS[it.roofMat].color;
      state.items.unshift(it); select(it.id); render(); commit(); return;
    }
    if (it.type === 'balcony') {
      // against the house wall at this level's floor, with a glass sliding door in the wall behind it
      Object.assign(it, { balShape: it.balShape || 'square', balGuard: it.balGuard || 'steel', balRoof: !!it.balRoof, balHooks: !!it.balHooks, balRoofH: it.balRoofH || 260, fill: '#e7e2d9' });
      // its floor at the height chosen in the Height bar (when above this level's floor), else on the floor
      { const c = workRel(); if (c >= 1) it.z = round(c, 1); else delete it.z; }
      fitBalcony(it);
      state.items.push(it);
      const door = addBalconyDoor(it);
      select(it.id); render(); commit();
      toast(door ? 'Balcony with a glass sliding door in the wall behind it. Shape, guard, roof and drying-rod hooks are in Properties.'
        : 'Balcony placed — put its back edge (the door side) against a house wall; "Add sliding door" in Properties puts the door in.');
      return;
    }
    if (it.type === 'pool' && state.workZ != null && isFinite(state.workZ)) {
      // its rim (coping) at the height chosen in the Height bar — on the ground, or raised (a terrace, a roof)
      const zz = state.workZ - floorUnder(it);
      if (Math.abs(zz) >= 1) it.z = round(zz, 1); else delete it.z;
    }
    if (it.type === 'hill') { Object.assign(it, { hillH: 300, hillShape: 'round', hillColor: 'natural' }); state.items.unshift(it); select(it.id); render(); commit(); return; }
    if (it.type === 'slope') { Object.assign(it, { slopeH: 100, blend: 200 }); state.items.unshift(it); select(it.id); render(); commit(); return; }
    if (it.type === 'slab-opening') openingAtWorkZ(it);
    if (it.type === 'slab') {
      it.slabT = state.slabT || 30; it.slabType = type === 'slab-concrete' ? 'concrete' : 'wood'; it.autoFit = false;
      state.items.unshift(it); // slabs lie under everything
      slabAtWorkZ(it);
      if (refuseDoubleSlab(it)) return;
    } else state.items.push(it);
    select(it.id);
    render();
    commit();
  }

  /* ───────────────────────── canvas interaction (centre) ───────────────────────── */
  function toWorld(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return { x: (clientX - r.left - state.panX) / state.zoom, y: (clientY - r.top - state.panY) / state.zoom };
  }

  const select = (id) => setSelection(id == null ? [] : [id]);
  function setSelection(ids) {
    const key = (a) => a.slice().sort((x, y) => x - y).join(',');
    const before = key(selIds());
    applySel(ids);
    state.pinSpan = null; // a selection made by hand replaces a span kept from before
    if (key(selIds()) === before) { if (!ids.length) renderHeightBar(); return; }
    refreshSelectionUI();
  }
  // Shift/Ctrl+click: add an object to the selection, or take it out
  function toggleSelect(id) {
    const cur = selIds();
    setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }
  function refreshSelectionUI() {
    renderOverlay();
    renderHeightBar(); // the selected object's bottom and top in the Height bar
    buildProps();
    updateStatus();
    updateButtons();
    const ids = new Set(selIds());
    $('#objList').querySelectorAll('.obj-row').forEach((r) => r.classList.toggle('on', ids.has(+r.dataset.id)));
    scrollToSelected();
    notify('select');
  }

  svg.addEventListener('pointerdown', (e) => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const p = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || (e.button === 0 && spaceDown)) return startPan(e);
    if (e.button !== 0) return;
    if (state.tool === 'fill') return fillFloorAt(p);
    if (state.tool === 'slab') return addRoomSlab(p, e.shiftKey);
    if (state.tool === 'lining') return lineRoom(p);
    if (state.tool === 'garden') {
      // a click floods an enclosed outdoor area, a drag draws a rectangle (decided on release)
      drag = { mode: 'garden', start: p, moved: false };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    const handle = e.target.closest('[data-handle]');
    if (handle && handle.dataset.handle === 'grot' && isMulti()) {
      // turn the whole selection about its centre
      const group = sels().filter((i) => !i.locked), b = bbox(group);
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      drag = { mode: 'grotate', group: group.map((g) => ({ it: g, o: { ...g } })), c, a0: Math.atan2(p.y - c.y, p.x - c.x), moved: false };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    const it = sel();
    if (handle && it) {
      const hv = handle.dataset.handle;
      drag = hv === 'lcut' ? { mode: 'lcut', orig: { ...it } }
        : hv === 'rot'
        ? { mode: 'rotate', orig: { ...it } }
        : { mode: 'resize', hx: +hv.split(',')[0], hy: +hv.split(',')[1], orig: { ...it } };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    const itemEl = e.target.closest('.item');
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      // Shift/Ctrl: a click toggles the object under the pointer; a drag draws a selection box
      drag = { mode: 'box', start: p, base: selIds(), toggleId: itemEl ? +itemEl.dataset.id : null, moved: false };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (itemEl) {
      let id = +itemEl.dataset.id;
      // clicking again on the object already selected reaches the next one under the pointer (e.g. a floor slab
      // covered by its floor or a garden area) — done on release, so dragging the selected object still moves it
      const under = [...new Set(document.elementsFromPoint(e.clientX, e.clientY)
        .map((el) => el.closest && el.closest('#canvas .item')).filter(Boolean).map((el) => +el.dataset.id))];
      // the selected object lies under the pointer, below others (a roof under the floors, slabs and walls it covers):
      // pressing there takes the selected one, so it can be dragged — not the floor on top of it
      if (!isMulti() && state.selId != null && state.selId !== id && under.includes(state.selId)) id = state.selId;
      const cycle = !isMulti() && state.selId === id && under.length > 1 ? under[(under.indexOf(id) + 1) % under.length] : null;
      // clicking an object that is already part of a multi-selection drags the whole group
      if (!(isMulti() && state.multi.has(id))) {
        const it0 = state.items.find((i) => i.id === id);
        // a prefab group: all of it — but a balcony is picked on its own (so it can be sized and set up), and still
        // takes its door with it when dragged
        if (it0 && it0.grp && !e.altKey && it0.type !== 'balcony' && !doorsBalcony(it0)) applySel(groupIds(it0)), refreshSelectionUI();
        else select(id);
      }
      const it1 = !isMulti() && sel();
      const group = sels().filter((i) => !i.locked); // (a balcony's door follows it — syncBalconyDoors)
      void it1;
      if (group.length) {
        drag = { mode: 'move', group: group.map((it) => ({ it, o: { ...it } })), lead: id, start: p, moved: false };
        svg.setPointerCapture(e.pointerId);
      } else {
        startPan(e); // locked items (e.g. floors) stay put; dragging them pans the view
      }
      if (cycle != null) Object.assign(drag, { cycle, under: under.length });
      return;
    }
    select(null);
    startPan(e);
  });

  function startPan(e) {
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY };
    svg.classList.add('panning');
    svg.setPointerCapture(e.pointerId);
  }

  svg.addEventListener('pointermove', (e) => {
    const p = toWorld(e.clientX, e.clientY);
    updateStatus(p);
    if (!drag) return;
    const snap = snapOn() && !e.altKey;

    if (drag.mode === 'pan') {
      state.panX = drag.px + e.clientX - drag.sx;
      state.panY = drag.py + e.clientY - drag.sy;
      renderView();
      return;
    }
    if (drag.mode === 'garden') {
      const a = drag.start, sx = snapTo(a.x, snap), sy = snapTo(a.y, snap), ex = snapTo(p.x, snap), ey = snapTo(p.y, snap);
      if (!drag.moved && Math.hypot(p.x - a.x, p.y - a.y) * state.zoom < 6) return;
      drag.moved = true;
      drag.rect = { x: Math.min(sx, ex), y: Math.min(sy, ey), w: Math.abs(ex - sx), h: Math.abs(ey - sy) };
      const z = state.zoom, r = drag.rect;
      $('#hoverbox').innerHTML = `<rect class="marquee garden" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" style="stroke-width:${1.5 / z};stroke-dasharray:${6 / z} ${4 / z}"/>` +
        `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" class="marquee-label" style="font-size:${13 / z}px">${round(r.w / 100, 2)} × ${round(r.h / 100, 2)} m</text>`;
      return;
    }
    if (drag.mode === 'box') {
      const a = drag.start;
      drag.rect = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) };
      drag.moved = true;
      const z = state.zoom, r = drag.rect;
      $('#hoverbox').innerHTML = `<rect class="marquee" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" style="stroke-width:${1 / z};stroke-dasharray:${4 / z} ${3 / z}"/>`;
      return;
    }

    if (drag.mode === 'grotate') {
      const a = Math.atan2(p.y - drag.c.y, p.x - drag.c.x), d = Math.round(((a - drag.a0) * 180) / Math.PI / 45) * 45;
      const rad = (d * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
      for (const { it, o } of drag.group) {
        const vx = o.x + o.w / 2 - drag.c.x, vy = o.y + o.h / 2 - drag.c.y;
        it.x = round(drag.c.x + vx * cs - vy * sn - o.w / 2, 2); it.y = round(drag.c.y + vx * sn + vy * cs - o.h / 2, 2);
        it.r = normAngle((o.r || 0) + d);
      }
      drag.moved = drag.moved || d !== 0;
      $('#stAlign').textContent = `Turning the group ${d}°`;
      render(); return;
    }
    if (drag.mode === 'move') {
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * state.zoom < 3) return;
      if (state.moveAxis === 'none') { // moving switched off (neither XY nor Z): the objects stay put
        drag.cycle = null; // (a drag, not a click: the selection stays)
        if (!drag.noMoveTold) { drag.noMoveTold = true; $('#stAlign').textContent = 'Moving is off (XY and Z not selected) — click XY or Z in the corner to move objects'; }
        return;
      }
      if (state.moveAxis === 'z' && drag.group.length === 1) {
        // Z: dragging up raises it, down lowers it (the plan's scale: 1 cm on the plan = 1 cm of height)
        const { it } = drag.group[0];
        if (drag.z0 == null) {
          try { drag.z0 = objectBottom(it); } catch (e) { drag.z0 = NaN; }
          if (!isFinite(drag.z0) || !zTarget(it, drag.z0)) { drag.z0 = NaN; toast(`${itemName(it)} cannot be moved up or down — its height is set by how it is built.`, 'error'); }
        }
        drag.moved = true;
        if (!isFinite(drag.z0)) return;
        const z = snapMove(drag.z0 - dy, snap);
        setItemZ(it, z);
        syncPropFields();
        $('#stAlign').textContent = `${itemName(it)}: bottom at ${fmtElev(objectBottom(it))} (Z) — drag up or down`;
        return;
      }
      drag.moved = true;
      if (drag.group.length === 1) {
        const { it, o } = drag.group[0];
        it.w = o.w; it.h = o.h; it.r = o.r; // auto-align may have changed these on the previous move
        it.x = snapMove(o.x + dx, snap);
        it.y = snapMove(o.y + dy, snap);
        if (state.align && !e.altKey && window.FPWalls.isWall(it)) alignWallFaces(it);
        if (state.align && !e.altKey) autoAlign(it, true, true);
      } else {
        // the object you grabbed snaps to the grid; everything else moves by the same amount
        const lead = drag.group.find((g) => g.it.id === drag.lead) || drag.group[0];
        const ddx = snapMove(lead.o.x + dx, snap) - lead.o.x, ddy = snapMove(lead.o.y + dy, snap) - lead.o.y;
        for (const { it, o } of drag.group) { it.x = round(o.x + ddx, 2); it.y = round(o.y + ddy, 2); }
      }
      render();
      syncPropFields();
      return;
    }

    const it = sel();
    if (!it) return;
    const o = drag.orig;
    if (drag.mode === 'lcut') {
      // the pointer in the roof's own (unrotated) frame; the part left out reaches from there to its corner
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = (-(o.r || 0) * Math.PI) / 180;
      const dx = p.x - cx, dy = p.y - cy, lx = dx * Math.cos(a) - dy * Math.sin(a) + o.w / 2, ly = dx * Math.sin(a) + dy * Math.cos(a) + o.h / 2;
      const c = window.FP_ROOFS.lShape(o.w, o.h, o).corner, st = snap ? moveStep() : 1;
      const q = (v) => Math.round(v / st) * st;
      it.lCutW = round(Math.max(30, Math.min(o.w - 60, q(c[1] === 'r' ? o.w - lx : lx))), 1);
      it.lCutD = round(Math.max(30, Math.min(o.h - 60, q(c[0] === 'b' ? o.h - ly : ly))), 1);
      $('#stAlign').textContent = `Part left out: ${(it.lCutW / 100).toFixed(2)} × ${(it.lCutD / 100).toFixed(2)} m`;
      drag.moved = true;
    } else if (drag.mode === 'rotate') {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      a = Math.round(a / 45) * 45; // orientation: 45° steps
      it.r = normAngle(a);
      drag.moved = true;
    } else if (drag.mode === 'resize') {
      resizeItem(it, o, drag.hx, drag.hy, p, snap, e.shiftKey);
      if (it.type === 'stairs-l' && !!drag.hx !== !!drag.hy) relengthL(it, drag.hx ? 'w' : 'h'); // the other flight takes up the steps
      drag.moved = true;
    }
    render();
    syncPropFields();
  });

  // Doors/windows snap into the nearest wall; walls snap their ends onto other walls.
  // Shows a short note in the status bar when something snapped.
  /* A wall being dragged lines up exactly with the other walls of its level: when one of its faces (or ends) comes
     within a few screen pixels of the line of another wall's face, it moves onto that line — across and along —
     so corners and joins come out flush even where the grid (half a square) does not fall on the faces. */
  function alignWallFaces(it) {
    const W = window.FPWalls;
    if (((it.r || 0) % 90 + 90) % 90) return false;
    const linesOf = (w) => {
      const tf = W.toWorld(w), xs = [], ys = [];
      for (const [x, y, rw, rh] of byId[w.type].barrier(w.w, w.h, w)) {
        const a = tf([x, y]), b = tf([x + rw, y + rh]);
        xs.push(a[0], b[0]); ys.push(a[1], b[1]);
      }
      return { xs, ys };
    };
    const mine = linesOf(it), others = levelItems().filter((o) => o !== it && W.isWall(o) && !(((o.r || 0) % 90 + 90) % 90)).map(linesOf);
    if (!others.length) return false;
    const tol = Math.max(1, 6 / state.zoom); // about 6 screen pixels
    const best = (mineV, key) => {
      let d = null;
      for (const o of others) for (const v of o[key]) for (const m of mineV) { const dd = v - m; if (Math.abs(dd) <= tol && (d == null || Math.abs(dd) < Math.abs(d))) d = dd; }
      return d;
    };
    const dx = best(mine.xs, 'xs'), dy = best(mine.ys, 'ys');
    if (dx) it.x = round(it.x + dx, 2);
    if (dy) it.y = round(it.y + dy, 2);
    return dx != null || dy != null;
  }
  function autoAlign(it, fitWidth, dragging = false) {
    // while dragging, a wall only pulls onto another wall closer than half a grid step, so it can still be moved
    // half a grid square away from (or along) the wall it touches
    const tol = dragging && snapOn() ? Math.max(2, Math.min(15, moveStep() * 0.8)) : 15;
    const W = window.FPWalls;
    const items = levelItems(); // only walls on the same level
    // a wall under the reference level is first centred on its walls' centrelines (they rest on it)
    if (W.isWall(it) && refIsAbove() && W.snapToAxes(it, refSegs(), tol)) {
      $('#stAlign').textContent = `⇔ centred under a ${levelById(state.refLevel).name} wall`;
      return true;
    }
    const done = W.isOpening(it) ? W.alignOpening(it, items, { fitWidth })
      : W.isWall(it) ? W.snapWall(it, items, tol) : false;
    $('#stAlign').textContent = done ? (W.isOpening(it) ? '⇔ fitted into wall' : '⇔ joined to wall') : '';
    return done;
  }

  function endDrag(ev) {
    if (!drag) return;
    // a Z move in the plan is a one-off: the plan goes back to moving across it (XY)
    if (drag.mode === 'move' && drag.z0 != null && state.moveAxis === 'z') setMoveAxis('xy', true);
    // a click (no drag) on the selected object: select the next object under it
    if (drag.cycle != null && !(drag.mode === 'move' ? drag.moved : ev && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 4)) {
      const next = drag.cycle, n = drag.under;
      svg.classList.remove('panning');
      drag = null;
      select(next);
      const it = sel();
      $('#stAlign').textContent = it ? `Selected ${itemName(it)} (#${it.id}) — ${n} objects here; click again for the next one` : '';
      return;
    }
    if ((drag.mode === 'resize' || drag.mode === 'rotate') && drag.moved) {
      const it = sel();
      if (it && it.type === 'balcony') { balconyAfterEdit(it); render(); syncPropFields(); }
      else if (it && doorsBalcony(it)) { syncBalconyDoor(doorsBalcony(it), true); render(); syncPropFields(); }
    }
    if (drag.mode === 'move' && drag.moved && !isMulti()) {
      const it = sel(), bal = it && doorsBalcony(it);
      if (bal) { syncBalconyDoor(bal, true); render(); syncPropFields(); } // a balcony door slides along the balcony's back edge
    }
    if (drag.mode === 'resize' && drag.moved && state.align) {
      const it = sel();
      if (it && window.FPWalls.isOpening(it)) { autoAlign(it, false); render(); syncPropFields(); }
    }
    $('#stAlign').textContent = '';
    if (drag.mode === 'garden') {
      const { moved, rect, start } = drag;
      $('#hoverbox').innerHTML = '';
      drag = null;
      if (!moved) return fillFloorAt(start, true);
      if (rect && rect.w >= 20 && rect.h >= 20) addGardenRect(rect);
      else toast('Drag a larger rectangle (at least 20 × 20 cm).', 'error');
      return;
    }
    if (drag.mode === 'box') {
      // select every object lying completely inside the box (added to what was already selected)
      const r = drag.rect, base = drag.base, toggleId = drag.toggleId;
      $('#hoverbox').innerHTML = '';
      drag = null;
      if (!r || (r.w * state.zoom < 4 && r.h * state.zoom < 4)) {
        if (toggleId != null) toggleSelect(toggleId); // it was a click, not a drag
        return;
      }
      const inside = levelItems().filter((it) => {
        const b = bbox([it]);
        return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
      }).map((i) => i.id);
      setSelection([...base, ...inside]);
      return;
    }
    const changed = drag.mode !== 'pan' && drag.moved, wasL = drag.mode === 'lcut';
    svg.classList.remove('panning');
    drag = null;
    if (changed) commit();
    if (changed && wasL) buildProps();
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // Resize in the item's own (rotated) frame, keeping the opposite edge/corner fixed in place.
  function resizeItem(it, o, hx, hy, p, snap, keepRatio) {
    const rad = (o.r * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const c0 = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
    const dx = p.x - c0.x, dy = p.y - c0.y;
    const v = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }; // pointer in local frame
    const a = { x: (-hx * o.w) / 2, y: (-hy * o.h) / 2 };          // fixed anchor in local frame
    let w = hx ? Math.max(MIN_SIZE, hx * (v.x - a.x)) : o.w;
    let h = hy ? Math.max(MIN_SIZE, hy * (v.y - a.y)) : o.h;
    if (snap) {
      if (hx) w = Math.max(MIN_SIZE, snapMove(w, true) || moveStep()); // half-grid steps, like moving
      if (hy) h = Math.max(MIN_SIZE, snapMove(h, true) || moveStep());
    }
    if (keepRatio && hx && hy) {
      const k = Math.max(w / o.w, h / o.h);
      w = o.w * k; h = o.h * k;
    }
    const cl = { x: hx ? a.x + (hx * w) / 2 : 0, y: hy ? a.y + (hy * h) / 2 : 0 };
    const cx = c0.x + cl.x * cos - cl.y * sin, cy = c0.y + cl.x * sin + cl.y * cos;
    it.w = round(w, 1); it.h = round(h, 1);
    it.x = round(cx - w / 2, 2); it.y = round(cy - h / 2, 2);
  }
  const normAngle = (a) => { a = ((a % 360) + 540) % 360 - 180; return a === -180 ? 180 : a; };

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    // over the selected object: the wheel sizes it (Shift + wheel: its height); elsewhere it zooms
    if (!e.ctrlKey) {
      const g = e.target.closest && e.target.closest('#items [data-id]'), ids = selIds();
      if (g && ids.length === 1 && +g.dataset.id === ids[0] && wheelResize(sel(), e.deltaY < 0 ? 1 : -1, e.shiftKey)) return;
    }
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    zoomAt(state.zoom * k, e.clientX, e.clientY);
  }, { passive: false });

  /* Move axis: dragging the selected object moves it across the plan (XY) or up and down (Z). A small pad of arrow
     symbols in a corner of the plan and of the 3D view shows the two choices; a click picks one (lit up).
     Remembered in this browser. */
  state.moveAxis = 'xy'; // the plan starts (and is back, after the 3D view) on XY
  const axisPads = [];
  const AXIS_SVG = {
    xy: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2.5v19 M2.5 12h19 M12 2.5l-3 3.2 M12 2.5l3 3.2 M12 21.5l-3-3.2 M12 21.5l3-3.2 M2.5 12l3.2-3 M2.5 12l3.2 3 M21.5 12l-3.2-3 M21.5 12l-3.2 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    z: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2.5v19 M12 2.5l-4 4.2 M12 2.5l4 4.2 M12 21.5l-4-4.2 M12 21.5l4-4.2 M6 12h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function mountAxisPad(container) {
    if (!container) return;
    const pad = document.createElement('div');
    pad.className = 'axis-pad';
    pad.setAttribute('role', 'radiogroup');
    pad.setAttribute('aria-label', 'Move direction');
    pad.innerHTML = `<button type="button" data-axis="xy" role="radio" title="Drag moves the selected object across the plan (X and Y) — click again to switch moving off">${AXIS_SVG.xy}<b>XY</b></button>` +
      `<button type="button" data-axis="z" role="radio" title="Drag moves the selected object up and down (Z) — click again to switch moving off">${AXIS_SVG.z}<b>Z</b></button>`;
    pad.addEventListener('pointerdown', (e) => e.stopPropagation());
    // a click on the lit button switches it off: neither XY nor Z — objects cannot be moved by dragging
    pad.addEventListener('click', (e) => { const b = e.target.closest('[data-axis]'); if (b) setMoveAxis(b.dataset.axis === state.moveAxis ? 'none' : b.dataset.axis); });
    container.appendChild(pad);
    axisPads.push(pad);
    paintAxisPads();
  }
  function paintAxisPads() {
    for (const pad of axisPads) pad.querySelectorAll('[data-axis]').forEach((b) => {
      const on = b.dataset.axis === state.moveAxis;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    });
  }
  /* 'xy' · 'z' · 'none' — neither lit: dragging never moves anything (objects can still be selected, resized with
     their handles and edited in the properties; in 3D a drag turns the view) */
  function setMoveAxis(a, quiet = false) {
    state.moveAxis = a === 'z' ? 'z' : a === 'none' ? 'none' : 'xy';
    paintAxisPads();
    for (const pad of axisPads) pad.classList.toggle('off', state.moveAxis === 'none');
    if (quiet) return;
    $('#stAlign').textContent = state.moveAxis === 'z' ? 'Move: up and down (Z) — drag the selected object up or down'
      : state.moveAxis === 'none' ? 'Moving is off — objects stay where they are when dragged. Click XY or Z to move them again.'
      : 'Move: across the plan (X and Y)';
  }
  // set an object's bottom (Position Z, above ground ±0) the way that kind of object keeps it; false when it cannot
  /* Moving up / down keeps the object's size: its height (Size H) is set back to what it was, so a wall whose
     height followed the floor above, a window (sill moved, head kept) or stairs (start moved, top kept) do not
     grow or shrink when only their position changes. */
  function setItemZ(it, z) {
    const tg = it && zTarget(it, z);
    if (!tg) return false;
    let h0 = null;
    try { const b = objectBottom(it), t = objectTop(it); if (isFinite(b) && isFinite(t) && t - b > 0.5) h0 = t - b; } catch (e) { /* not measurable */ }
    applyProp({ dataset: { k: tg[0] }, type: 'number', value: String(round(tg[1], 1)) });
    if (h0 != null) {
      let h1 = null;
      try { h1 = objectTop(it) - objectBottom(it); } catch (e) { /* not measurable */ }
      const th = h1 != null && Math.abs(h1 - h0) > 0.5 && hTarget(it, h0);
      if (th) applyProp({ dataset: { k: th[0] }, type: 'number', value: String(round(th[1], 1)) });
    }
    return true;
  }
  /* Mouse wheel on the selected object (plan and 3D view): bigger / smaller about its centre, about 5 % a notch
     (a straight wall only gets longer / shorter, keeping its thickness); with Shift its height (Size H). The change
     is saved once the wheel stops. Returns true when it was handled. */
  let wheelTimer = 0;
  function wheelResize(it, dir, height = false) {
    if (!it) return false;
    if (it.locked) { toast(`${itemName(it)} is locked${it.autoFit ? ' (it fits the room — set its Area to "Manual" to size it yourself)' : ''}.`, 'error'); return true; }
    if (height) {
      let z, top;
      try { z = objectBottom(it); top = objectTop(it); } catch (e) { return false; }
      if (!isFinite(z) || !isFinite(top)) return false;
      const h = top - z, nh = Math.max(1, round(h + dir * Math.max(1, Math.round(h * 0.05)), 1));
      const tg = hTarget(it, nh);
      if (!tg) { toast(`The height of ${itemName(it)} follows from how it is built — it cannot be set with the wheel.`, 'error'); return true; }
      applyProp({ dataset: { k: tg[0] }, type: 'number', value: String(round(tg[1], 1)) });
    } else {
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      const step = (v) => Math.max(MIN_SIZE, round(v + dir * Math.max(1, Math.round(v * 0.05)), 1));
      if (it.type === 'wall-h' || it.type === 'wall-v') { if (it.w >= it.h) it.w = step(it.w); else it.h = step(it.h); }
      else if (it.poly && it.pw0) { const k = step(it.w) / it.w; it.w = round(it.w * k, 1); it.h = Math.max(MIN_SIZE, round(it.h * k, 1)); }
      else { it.w = step(it.w); it.h = step(it.h); }
      it.x = round(cx - it.w / 2, 2); it.y = round(cy - it.h / 2, 2);
      if (byId[it.type].stairs && isAutoStairs(it)) it.steps = autoSteps(it);
      render();
    }
    syncPropFields();
    $('#stAlign').textContent = `${itemName(it)}: ${height ? 'height' : 'size'} ${height ? fmtLen(round(objectTop(it) - objectBottom(it), 1)) : `${fmtLen(it.w)} × ${fmtLen(it.h)}`}  (mouse wheel${height ? ' + Shift' : ''})`;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { commit(); buildProps(); }, 350);
    return true;
  }
  // move an object to a place on the plan (its top-left corner, cm) — dragged in the 3D view
  function moveItemTo(id, x, y) {
    const it = state.items.find((i) => i.id === id);
    if (!it || it.locked) return false;
    it.x = snapMove(x); it.y = snapMove(y);
    if (state.align && window.FPWalls.isOpening(it)) autoAlign(it, true);
    render(); syncPropFields(); commit(); buildProps();
    return true;
  }
  function zoomAt(z, clientX, clientY) {
    z = Math.min(8, Math.max(0.1, z));
    const r = svg.getBoundingClientRect();
    if (clientX == null) { clientX = r.left + r.width / 2; clientY = r.top + r.height / 2; }
    const w = toWorld(clientX, clientY);
    state.zoom = z;
    state.panX = clientX - r.left - w.x * z;
    state.panY = clientY - r.top - w.y * z;
    renderView();
  }

  function bbox(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      const rad = (it.r * Math.PI) / 180, c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
      const hw = (it.w * c + it.h * s) / 2, hh = (it.w * s + it.h * c) / 2;
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      x0 = Math.min(x0, cx - hw); y0 = Math.min(y0, cy - hh);
      x1 = Math.max(x1, cx + hw); y1 = Math.max(y1, cy + hh);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function fit() {
    const r = svg.getBoundingClientRect();
    // fit the current level (or the whole plan when this level is still empty)
    const its = levelItems().length ? levelItems() : state.items;
    if (!its.length) { state.zoom = 1; state.panX = 60; state.panY = 60; renderView(); return; }
    const b = bbox(its), pad = 60;
    state.zoom = Math.min(4, Math.max(0.1, Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h)));
    state.panX = (r.width - b.w * state.zoom) / 2 - b.x * state.zoom;
    state.panY = (r.height - b.h * state.zoom) / 2 - b.y * state.zoom;
    renderView();
  }

  /* ───────────────────────── automatic floor fill ─────────────────────────
   * Walls, doors and windows are rasterised onto a grid, the clicked cell is flood-filled,
   * and the filled cells are traced back into polygon outlines for a new "floor" object.
   */
  /* Floor slab tool: a click inside the walls makes a slab that fills the whole loop of outer walls round that point,
     however irregular — on under the inner walls, doorways closed — to their inner faces, and follows them when they
     move. Shift+click fills only the one room clicked. Dragging the Floor slab icon onto the plan still places a free
     slab to size by hand. */
  function addRoomSlab(p, oneRoom = false) {
    const sl = newItem('slab', 0, 0);
    const concrete = state.slabKind === 'concrete';
    Object.assign(sl, { slabT: state.slabT || 30, slabType: concrete ? 'concrete' : 'wood', autoFit: oneRoom ? 'inner' : 'loop', seed: [round(p.x, 1), round(p.y, 1)] });
    if (concrete) sl.fill = byId['slab-concrete'].fill;
    const f = slabFit(sl);
    if (!f) {
      toast(!slabWalls(sl).length ? 'There are no walls here yet — drag the Floor slab icon onto the plan for a free slab.'
        : oneRoom ? 'That spot is not inside a closed room (or it is on a wall) — click inside a room. For a free slab, drag the Floor slab icon onto the plan.'
        : 'That spot is not inside a closed loop of walls — check for gaps in the outer walls (doors and windows close their openings). For a free slab, drag the Floor slab icon onto the plan.', 'error');
      return;
    }
    applyFit(sl, f);
    sl.locked = true;
    state.items.unshift(sl); // slabs lie under everything
    slabAtWorkZ(sl);
    if (refuseDoubleSlab(sl)) return;
    select(sl.id);
    render(); commit();
    toast(`${concrete ? 'Concrete' : 'Timber'} floor slab fitted to ${oneRoom ? "the room's inner wall lines" : 'everything within the outer walls'}${sl.poly ? ` (${sl.poly.length} corners)` : ''}: ${round(sl.w / 100, 2)} × ${round(sl.h / 100, 2)} m. Click another area, or Esc to stop.`);
  }

  /* Room lining tool: a click inside a room lines the inner faces of every wall round it with 10 cm interior walls
     (it.interior), leaving doorways and windows open. Each piece is a straight wall along one side of the room's
     outline; at a room corner the piece that ends there stops short by the lining's thickness so the next one, running
     on along the other wall, fills the corner. Stretches already lined by an interior wall are left alone, so clicking
     the room again only fills what is missing. */
  function lineRoom(p) {
    const W = window.FPWalls, T = 10;
    const walls = state.items.filter((i) => lvlOf(i) === state.level && W.isWall(i) && !i.interior);
    const ring = walls.length && roomOutline(walls, [p.x, p.y], false);
    if (!ring) {
      toast(walls.length ? 'That spot is not inside a closed room (or it is on a wall) — click inside a room.' : 'Draw some walls first — the lining runs along the inside of a room.', 'error');
      return;
    }
    const openings = state.items.filter((i) => lvlOf(i) === state.level && W.isOpening(i)).map((i) => W.openingLine(i)).filter(Boolean);
    const lined = W.wallSegments(state.items.filter((i) => lvlOf(i) === state.level && i.interior));
    const n = ring.length, added = [];
    const edge = (k) => {
      const A = ring[k], B = ring[(k + 1) % n], len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
      const u = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
      let nv = [-u[1], u[0]]; // the side facing into the room
      const m = [(A[0] + B[0]) / 2 + nv[0] * 2, (A[1] + B[1]) / 2 + nv[1] * 2];
      if (!pointInRings([ring], m[0], m[1])) nv = [-nv[0], -nv[1]];
      return { A, B, len, u, n: nv };
    };
    // the stretches [from, to] along edge e (cm from its start) that something already takes: openings, linings
    const along = (e, P) => (P[0] - e.A[0]) * e.u[0] + (P[1] - e.A[1]) * e.u[1];
    const off = (e, P) => (P[0] - e.A[0]) * e.n[0] + (P[1] - e.A[1]) * e.n[1];
    for (let k = 0; k < n; k++) {
      const e = edge(k), nx = edge((k + 1) % n);
      // a room corner at its end (the next side turns back across this one): stop short so the next piece fills it
      const end = e.len - (nx.u[0] * e.n[0] + nx.u[1] * e.n[1] < -0.5 ? T : 0);
      if (end < 20) continue;
      const taken = [];
      for (const ln of openings) {
        if (Math.abs(ln.u[0] * e.u[0] + ln.u[1] * e.u[1]) < 0.98 || Math.abs(off(e, ln.mid)) > 40) continue; // not in this wall
        const a = along(e, ln.P0), b = along(e, ln.P1);
        taken.push([Math.min(a, b), Math.max(a, b)]);
      }
      for (const sg of lined) {
        if (Math.abs(sg.u[0] * e.u[0] + sg.u[1] * e.u[1]) < 0.98) continue;
        const mid = [sg.A[0] + sg.u[0] * sg.len / 2, sg.A[1] + sg.u[1] * sg.len / 2], d = off(e, mid);
        if (d < -1 || d > T + sg.t) continue; // not lining this side of the room
        const a = along(e, sg.A), b = along(e, [sg.A[0] + sg.u[0] * sg.len, sg.A[1] + sg.u[1] * sg.len]);
        taken.push([Math.min(a, b), Math.max(a, b)]);
      }
      // what is left of [0, end] once those are taken out
      taken.sort((s1, s2) => s1[0] - s2[0]);
      let from = 0;
      const free = [];
      for (const [a, b] of taken) { if (a >= end) break; if (a > from) free.push([from, a]); from = Math.max(from, b); }
      if (from < end) free.push([from, end]);
      for (const [a, b] of free) {
        if (b - a < 20) continue; // a sliver beside a door frame: not worth a wall
        const it = newItem('wall-int', 0, 0);
        Object.assign(it, byId['wall-int'].preset, { type: 'wall-h', w: round(b - a, 1), h: T });
        const c = [e.A[0] + e.u[0] * (a + b) / 2 + e.n[0] * T / 2, e.A[1] + e.u[1] * (a + b) / 2 + e.n[1] * T / 2];
        Object.assign(it, { x: round(c[0] - it.w / 2, 2), y: round(c[1] - T / 2, 2), r: normAngle(round((Math.atan2(e.u[1], e.u[0]) * 180) / Math.PI, 2)) });
        added.push(it);
      }
    }
    if (!added.length) { toast('This room is already lined (or its walls are all doors and windows).', 'error'); return; }
    state.items.push(...added);
    applySel(added.map((i) => i.id));
    render(); commit();
    toast(`Lined the room with ${added.length} interior wall${added.length === 1 ? '' : 's'} (10 cm), doorways and windows left open. Click another room, or Esc to stop.`);
  }

  // the slab icons light up while the slab tool is on (the one of the construction being placed)
  function slabToolUI() {
    const kind = state.slabKind || 'wood';
    document.querySelectorAll('.tile[data-type="slab"], .tile[data-type="slab-concrete"]').forEach((t) =>
      t.classList.toggle('on', state.tool === 'slab' && (t.dataset.type === 'slab') === (kind === 'wood')));
    if (state.tool === 'slab') toast(`${kind === 'concrete' ? 'Concrete' : 'Timber'} floor slab: click inside the walls to fill the whole area within the outer walls · Shift+click for one room only · drag the icon onto the plan for a free slab · Esc to stop`);
  }
  function setTool(tool) {
    state.tool = state.tool === tool ? null : tool;
    svg.classList.toggle('filling', !!state.tool);
    slabToolUI();
    $('#btnFill').classList.toggle('on', state.tool === 'fill');
    $('#btnGarden').classList.toggle('on', state.tool === 'garden');
    if (state.tool === 'fill') toast('Click inside a room to lay a floor · Esc to stop');
    if (state.tool === 'garden') toast('Click inside an area closed by walls / fences / hedges, or drag a rectangle · Esc to stop');
    document.querySelectorAll('.tile[data-type="room-lining"]').forEach((t) => t.classList.toggle('on', state.tool === 'lining'));
    if (state.tool === 'lining') toast('Interior lining: click inside a room to line its walls with 10 cm interior walls (doorways and windows left open) · Esc to stop');
  }

  /* ── Units: the plan is stored in cm; everything shown and typed is in metres ──
     After the properties panel is drawn, metricize() turns its length fields (value, min, max, step), their "cm" unit
     labels, the length presets and any "… cm" in its text into metres; fields marked data-unit="m" are read back ×100. */
  const LEN_K = new Set(['posZ', 'sizeH', 'x', 'y', 'w', 'h', 't', 'wh', 'sill', 'head', 'winH', 'topGap', 'elev', 'rise', 'fh', 'targetRiser', 'slabT', 'slabZ', 'hillH', 'z', 'overhang', 'slopeH', 'blend', 'poolDepth', 'wz', 'pitDepth', 'pitT', 'pitBase', 'railH', 'topZ', 'stairStart', 'landingD', 'flightW', 'wellW', 'roofZ', 'roofT', 'balRoofH', 'balDepth', 'roofFence', 'chimH', 'lCutW', 'lCutD']);
  const LEN_PLAN = new Set(['wallH', 'levelElev', 'aboveGround', 'levelWallH']);
  const LEN_DO = new Set(['lf-h', 'roof-t', 'well-w', 'flight-w', 'landing-d', 'pit-depth', 'wh', 'fh', 'slab-t', 'slab-z', 'slab-off', 'roof-ov', 'slope-h', 'slope-blend', 'path-w', 'pool-depth', 'hill-h', 'elev', 'win-h', 'target-riser', 'raise']);
  const toM = (cm) => +(cm / 100).toFixed(3);
  const fromM = (el) => {
    const raw = String(el.value).trim();
    if (raw === '') return el.value;
    if (el.dataset.unit === 'm') return String(round(parseFloat(el.value) * 100, 2));
    // feet / inches typed: kept to the nearest 4" (under 2 ft the nearest ½"), as lengths are shown
    if (el.dataset.unit === 'ftin') { const cm = parseFtIn(raw); return isFinite(cm) ? String(round(roundIn(cm / IN) * IN, 2)) : 'NaN'; }
    if (el.dataset.unit === 'in') return String(round(parseFloat(el.value) * IN, 2));                       // a slider in inches
    return el.value;
  };
  // a stored length (cm) as the field shows it
  const dispLen = (cm, el) => (el.dataset.unit === 'm' ? toM(cm) : el.dataset.unit === 'ftin' ? fmtFtIn(cm) : el.dataset.unit === 'in' ? round(cm / IN, 1) : round(cm));
  const metresText = (t) => String(t).replace(/(\d+(?:\.\d+)?)\s?cm\b/g, (m, n) => `${(parseFloat(n) / 100).toFixed(2)} m`);
  function metricize(root) {
    if (imperial()) return imperialize(root);
    for (const el of root.querySelectorAll('input[data-k], input[data-m], input[data-plan]')) {
      const len = el.dataset.k ? LEN_K.has(el.dataset.k) : el.dataset.m ? true : LEN_PLAN.has(el.dataset.plan);
      if (!len || el.dataset.unit === 'm' || (el.type !== 'number' && el.type !== 'range')) continue;
      const v = el.value; // read before the limits change (a slider would clamp it to the new ones)
      for (const a of ['min', 'max', 'step']) if (el.hasAttribute(a) && isFinite(+el.getAttribute(a))) el.setAttribute(a, toM(+el.getAttribute(a)));
      if (v !== '') el.value = toM(+v);
      el.dataset.unit = 'm';
    }
    root.querySelectorAll('.unit, em').forEach((u) => { if (u.textContent.trim() === 'cm') u.textContent = 'm'; });
    for (const b of root.querySelectorAll('button[data-do], button[data-plan-do]')) {
      if (!LEN_DO.has(b.dataset.do || b.dataset.planDo) || b.children.length || b.dataset.metric) continue;
      b.dataset.metric = '1';
      b.textContent = b.textContent.replace(/(\d+(?:\.\d+)?)/, (m, n) => (parseFloat(n) / 100).toFixed(2));
    }
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) if (/\d\s?cm\b/.test(n.nodeValue)) n.nodeValue = metresText(n.nodeValue);
    root.querySelectorAll('[title]').forEach((e) => { if (/\d\s?cm\b/.test(e.title)) e.title = metresText(e.title); });
  }
  /* The imperial version: length fields become feet-and-inches text fields (typed values are read exactly), sliders
     work in inches, length presets and every "… cm" / "… m" in the text show feet and inches (nearest 4"). */
  function imperialize(root) {
    for (const el of root.querySelectorAll('input[data-k], input[data-m], input[data-plan]')) {
      const len = el.dataset.k ? LEN_K.has(el.dataset.k) : el.dataset.m ? true : LEN_PLAN.has(el.dataset.plan);
      if (!len || el.dataset.unit || (el.type !== 'number' && el.type !== 'range')) continue;
      const v = el.value;
      if (el.type === 'range') {
        for (const a of ['min', 'max']) if (el.hasAttribute(a) && isFinite(+el.getAttribute(a))) el.setAttribute(a, round(+el.getAttribute(a) / IN, 1));
        const st = +el.getAttribute('step') || 1;
        el.setAttribute('step', st >= 10 ? 4 : st >= 2 ? 1 : 0.5);
        if (v !== '') el.value = round(+v / IN, 1);
        el.dataset.unit = 'in';
      } else {
        ['min', 'max', 'step'].forEach((a) => el.removeAttribute(a));
        el.type = 'text';
        el.inputMode = 'text';
        el.spellcheck = false;
        el.placeholder = `e.g. 10' 6"`;
        el.title = (el.title ? el.title + ' — ' : '') + 'feet and inches: 10\' 6", 10.5\' or 126"';
        if (v !== '') el.value = fmtFtIn(+v);
        el.dataset.unit = 'ftin';
      }
    }
    root.querySelectorAll('.unit, em').forEach((u) => { if (/^\s*(cm|m)\s*$/.test(u.textContent)) u.textContent = ''; });
    for (const b of root.querySelectorAll('button[data-do], button[data-plan-do]')) {
      if (!LEN_DO.has(b.dataset.do || b.dataset.planDo) || b.children.length || b.dataset.metric) continue;
      b.dataset.metric = '1';
      if (b.dataset.v != null && isFinite(+b.dataset.v) && /^\s*[+−-]?\d/.test(b.textContent)) b.textContent = fmtFtIn(+b.dataset.v, /^\s*\+/.test(b.textContent));
    }
    unitTextIn(root);
    root.querySelectorAll('[title]').forEach((e) => { if (/\d\s?c?m\b/.test(e.title)) e.title = imperialText(e.title); });
  }
  // every metric length written in the text of an element → imperial (when imperial is on)
  function unitTextIn(root) {
    if (!imperial() || !root) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) {
      const p = n.parentNode;
      if (p && (p.closest && p.closest('textarea, [contenteditable], .no-units'))) continue;
      if (/\d\s?(?:c?m\b|m²)/.test(n.nodeValue)) { const t = imperialText(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
    }
  }
  // every time the panel is redrawn
  new MutationObserver(() => metricize(props)).observe(props, { childList: true });
  /* everything else that shows lengths (status bar, Height bar, plan labels and dimensions, level tabs, the object
     list, notes, the 3D bar …): converted as it is drawn while imperial is on */
  new MutationObserver((muts) => {
    if (!imperial()) return;
    for (const m of muts) {
      if (m.type === 'characterData') { if (m.target.parentNode && m.target.parentNode.closest && !m.target.parentNode.closest('#props')) unitTextIn(m.target.parentNode); }
      else for (const n of m.addedNodes) {
        if (n.nodeType === 3) { if (n.parentNode && !(n.parentNode.closest && n.parentNode.closest('#props'))) unitTextIn(n.parentNode); }
        else if (n.nodeType === 1 && !(n.closest && n.closest('#props'))) unitTextIn(n);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  let toastTimer = 0;
  function toast(text, kind = '') {
    if (demo.building) return; // the tools a demo house is built with stay quiet
    const el = $('#toast');
    text = metresText(text);
    if (imperial()) text = imperialText(text);
    el.textContent = text;
    el.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 4500 : 2800);
  }

  // world-space polygons of everything that blocks the floor fill
  function barrierPolys(minT, items = levelItems()) {
    const polys = [];
    for (const it of items) { // by default only this level's walls bound its floors
      const ic = byId[it.type];
      if (!ic.barrier) continue;
      const fn = typeof ic.barrier === 'function';
      const shapes = fn ? ic.barrier(it.w, it.h, it) : ic.barrier;
      const sx = fn ? 1 : it.w / ic.w, sy = fn ? 1 : it.h / ic.h;
      const rad = (it.r * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad), cx = it.w / 2, cy = it.h / 2;
      const tf = ([x, y]) => {
        if (it.fx) x = it.w - x;
        if (it.fy) y = it.h - y;
        const dx = x - cx, dy = y - cy;
        return [it.x + cx + dx * cos - dy * sin, it.y + cy + dx * sin + dy * cos];
      };
      for (const s of shapes) {
        let pts;
        if (Array.isArray(s)) {
          let [x, y, w, h] = [s[0] * sx, s[1] * sy, s[2] * sx, s[3] * sy];
          if (w < minT) { x -= (minT - w) / 2; w = minT; }   // keep thin lines watertight on the grid
          if (h < minT) { y -= (minT - h) / 2; h = minT; }
          pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
        } else {
          pts = s.pts.map(([x, y]) => [x * sx, y * sy]);
        }
        polys.push(pts.map(tf));
      }
    }
    return polys;
  }

  function pointInRings(rings, x, y) {
    let inside = false;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  // is world point p on an existing floor?
  /* No two floors at the same place and elevation. Two rectangles "overlap" when their common part is most (60 %)
     of the smaller one — so a patio drawn on a lawn is still allowed. */
  function overlapShare(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? (w * h) / Math.max(1, Math.min(a.w * a.h, b.w * b.h)) : 0;
  }
  // a slab of the same level already lying at the same height over (most of) slab sl
  function sameSlab(sl) {
    const top = slabInfo(sl).top, b = bbox([sl]);
    return state.items.find((o) => o !== sl && o.type === 'slab' && lvlOf(o) === lvlOf(sl) && Math.abs(slabInfo(o).top - top) < 1 && overlapShare(b, bbox([o])) > 0.6) || null;
  }
  // refuse a just-added slab that doubles one (it is taken out again, the existing one selected); true when refused
  /* ── Several floor slabs on one level, never overlapping ──
     Two slabs of the same level clash when their thicknesses share a height and their outlines overlap by more than
     a sliver (≥ 0.05 m²; slabs that only touch along an edge are fine). Slabs at different heights (a mezzanine over
     a lower slab) may lie over each other. */
  /* A slab set to a height of its own (e.g. a half-level / mezzanine slab given its height in Properties while the
     2nd floor was being designed) belongs to the level whose storey holds it: a slab whose top is well below its
     level's floor, or whose underside is at or above the next level's floor, is moved to that level, so it is shown
     (and stairs can reach it) on the floor it really stands in. The view follows a selected slab. */
  function relevelSlabs() {
    let moved = null;
    for (const sl of state.items) {
      if (sl.type !== 'slab' || !(sl.slabAlign || (typeof sl.slabZ === 'number' && isFinite(sl.slabZ)))) continue;
      const L = levelById(lvlOf(sl));
      if (!L) continue;
      const S = slabInfo(sl), up = levelAbove(L);
      const low = S.top < floorAbs(L) - 20, high = up && S.bottom >= floorAbs(up) - 0.5;
      if (!low && !high) continue;
      const to = levelForZ(S.bottom);
      if (!to || to.id === L.id) continue;
      const bottom = S.bottom;
      sl.lvl = to.id;
      // keep its height: held to the walls round it on the new level, else a free height
      const AW = slabAlignWalls(sl), t = sl.slabT || 30;
      if (AW && bottom >= AW.bottom - 0.5 && bottom <= Math.max(AW.bottom, AW.top - t) + 0.5) { sl.slabAlign = 'bottom'; sl.slabOff = round(Math.max(0, bottom - AW.bottom), 1); delete sl.slabZ; }
      else { delete sl.slabAlign; delete sl.slabOff; sl.slabZ = round(bottom, 1); }
      moved = { sl, from: L, to };
    }
    if (!moved) return false;
    if (selIds().includes(moved.sl.id) && moved.to.id !== state.level) {
      const z = state.workZ; switchLevel(moved.to.id); state.workZ = z; applySel([moved.sl.id]);
    }
    toast(`Slab #${moved.sl.id} (underside ${fmtElev(slabInfo(moved.sl).bottom)}) is within the storey of ${moved.to.name}, so it now belongs to ${moved.to.name} — it is shown there, and stairs on that floor can reach it.`);
    return true;
  }
  function slabsClash(a, b) {
    if (a === b || lvlOf(a) !== lvlOf(b)) return false;
    const A = slabInfo(a), B = slabInfo(b);
    if (Math.min(A.top, B.top) - Math.max(A.bottom, B.bottom) <= 0.5) return false; // different heights
    const ba = bbox([a]), bb = bbox([b]);
    const x0 = Math.max(ba.x, bb.x), x1 = Math.min(ba.x + ba.w, bb.x + bb.w), y0 = Math.max(ba.y, bb.y), y1 = Math.min(ba.y + ba.h, bb.y + bb.h);
    if (x1 - x0 < 2 || y1 - y0 < 2) return false;
    const step = Math.max(2, Math.min(5, Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
    // the overlap must be a real patch, not a strip along a shared wall: at least 0.05 m² and 20 cm across both ways
    // (slabs laid side by side meet on the walls between them — one to the wall's face, one to its middle)
    let n = 0, ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
    for (let y = y0 + step / 2; y < y1; y += step)
      for (let x = x0 + step / 2; x < x1; x += step) if (inSlab(a, x, y) && inSlab(b, x, y)) { n++; ax = Math.min(ax, x); bx = Math.max(bx, x); ay = Math.min(ay, y); by = Math.max(by, y); }
    return n * step * step >= 500 && bx - ax + step >= SLAB_OVERLAP_OK && by - ay + step >= SLAB_OVERLAP_OK;
  }
  const SLAB_OVERLAP_OK = 20; // cm: overlaps narrower than this (a wall's width) are allowed
  // the first slab that slab sl overlaps (null when none); ignoring those in `skip`
  const slabClashWith = (sl, skip = null) => state.items.find((o) => o.type === 'slab' && o !== sl && !(skip && skip.has(o)) && slabsClash(sl, o)) || null;
  /* A slab just added (already in state.items): when it overlaps another one, a hand-placed rectangular slab is cut
     back to the largest free part (at least 30 × 30 cm) next to the slabs it ran into; otherwise it is taken out
     again and the slab in the way selected. Returns true when it was refused. */
  // an unrotated slab whose outline is its whole bounding rectangle
  const plainRectSlab = (o) => !(((o.r || 0) % 90 + 90) % 90) && (!o.poly || (() => {
    const pl = slabPoly(o); let a = 0;
    for (let i = 0; i < pl.length; i++) { const [x1, y1] = pl[i], [x2, y2] = pl[(i + 1) % pl.length]; a += x1 * y2 - x2 * y1; }
    return Math.abs(Math.abs(a / 2) - o.w * o.h) < 0.02 * o.w * o.h;
  })());
  /* A hand-placed slab laid over slabs already there (e.g. a slab that fills the whole room): the new one wins —
     every rectangular slab under it is split into the pieces round it (they become hand-placed slabs), so the floor
     stays covered and the new slab takes its part. Locked hand-placed slabs are left alone. Returns the ids split. */
  function makeRoomForSlab(sl) {
    if (sl.autoFit || sl.poly || ((sl.r || 0) % 180 + 180) % 180) return [];
    const c = { x: sl.x, y: sl.y, w: sl.w, h: sl.h }, split = [];
    for (const o of state.items.slice()) {
      if (o.type !== 'slab' || o === sl || !slabsClash(sl, o) || (o.locked && !o.autoFit) || !plainRectSlab(o)) continue;
      const b = bbox([o]);
      const ix0 = Math.max(b.x, c.x), ix1 = Math.min(b.x + b.w, c.x + c.w), iy0 = Math.max(b.y, c.y), iy1 = Math.min(b.y + b.h, c.y + c.h);
      const pieces = [{ x: b.x, y: b.y, w: ix0 - b.x, h: b.h }, { x: ix1, y: b.y, w: b.x + b.w - ix1, h: b.h },
        { x: ix0, y: b.y, w: ix1 - ix0, h: iy0 - b.y }, { x: ix0, y: iy1, w: ix1 - ix0, h: b.y + b.h - iy1 }].filter((p) => p.w >= 5 && p.h >= 5);
      const at = state.items.indexOf(o), made = pieces.map((p) => {
        const n = JSON.parse(JSON.stringify(o));
        delete n.poly; delete n.pw0; delete n.ph0; delete n.seed;
        return Object.assign(n, { id: nextId++, x: round(p.x, 1), y: round(p.y, 1), w: round(p.w, 1), h: round(p.h, 1), r: 0, fx: false, fy: false, autoFit: false, locked: false });
      });
      state.items.splice(at, 1, ...made);
      split.push(o.id);
    }
    return split;
  }
  function refuseDoubleSlab(sl) {
    if (!slabClashWith(sl)) return false;
    const split = makeRoomForSlab(sl);
    if (split.length && !slabClashWith(sl)) {
      toast(`Slab${split.length > 1 ? 's' : ''} ${split.map((i) => '#' + i).join(', ')} under the new slab ${split.length > 1 ? 'were' : 'was'} split round it, so the new slab covers its own part of the floor (the pieces are now hand-placed slabs — delete any you don't want).`);
      return false;
    }
    const hit = slabClashWith(sl);
    if (!hit) return false;
    const rect = !sl.poly && !(((sl.r || 0) % 180 + 180) % 180);
    if (rect) {
      // cut out every slab in the way (its bounding box), keep the largest piece that is free
      let pieces = [{ x: sl.x, y: sl.y, w: sl.w, h: sl.h }];
      const keep = { x: sl.x, y: sl.y, w: sl.w, h: sl.h };
      for (const o of state.items) {
        if (o.type !== 'slab' || o === sl || !slabsClash(sl, o)) continue;
        const c = bbox([o]), next = [];
        for (const p of pieces) {
          const ix0 = Math.max(p.x, c.x), ix1 = Math.min(p.x + p.w, c.x + c.w), iy0 = Math.max(p.y, c.y), iy1 = Math.min(p.y + p.h, c.y + c.h);
          if (ix1 <= ix0 || iy1 <= iy0) { next.push(p); continue; }
          next.push({ x: p.x, y: p.y, w: ix0 - p.x, h: p.h }, { x: ix1, y: p.y, w: p.x + p.w - ix1, h: p.h },
            { x: ix0, y: p.y, w: ix1 - ix0, h: iy0 - p.y }, { x: ix0, y: iy1, w: ix1 - ix0, h: p.y + p.h - iy1 });
        }
        pieces = next.filter((p) => p.w >= 30 && p.h >= 30);
      }
      pieces.sort((p, q) => q.w * q.h - p.w * p.h);
      for (const p of pieces) {
        Object.assign(sl, { x: round(p.x, 1), y: round(p.y, 1), w: round(p.w, 1), h: round(p.h, 1) });
        if (!slabClashWith(sl)) {
          toast(`Floor slabs cannot overlap — this one was cut back to the free part next to slab #${hit.id}: ${round(sl.w / 100, 2)} × ${round(sl.h / 100, 2)} m.`);
          return false;
        }
      }
      Object.assign(sl, keep);
    }
    state.items = state.items.filter((i) => i !== sl);
    select(hit.id); render();
    toast(`Floor slabs cannot overlap — slab #${hit.id} already covers this place at this height (${fmtElev(slabInfo(hit).bottom)} to ${fmtElev(slabInfo(hit).top)}); it is selected. ${hit.autoFit ? 'It fills the whole room: to lay slabs on only part of the floor, set its Area to "Manual" and make it smaller (or delete it), then place the others beside it.' : 'Make it smaller or move it, then place the new slab beside it — or pick another height in the Height bar.'}`, 'error');
    return true;
  }
  /* Before a change is saved: a slab that was moved, resized or changed so that it now overlaps another slab goes
     back to where it was (a new one, e.g. pasted or duplicated, is taken out). Overlaps that were there before are
     left alone. Returns true when something was undone. */
  function keepSlabsApart() {
    if (!hist[histIdx]) return false;
    const slabs = state.items.filter((i) => i.type === 'slab');
    if (slabs.length < 2) return false;
    let prev;
    try { prev = new Map(JSON.parse(hist[histIdx]).items.filter((i) => i.type === 'slab').map((i) => [i.id, i])); } catch (e) { return false; }
    const changed = slabs.filter((s) => { const o = prev.get(s.id); return !o || JSON.stringify(o) !== JSON.stringify(s); });
    let undone = null;
    for (const s of changed) {
      const hit = slabClashWith(s);
      if (!hit) continue;
      const o = prev.get(s.id), now = JSON.parse(JSON.stringify(s));
      const setTo = (src) => { Object.keys(s).forEach((k) => { if (!(k in src)) delete s[k]; }); Object.assign(s, JSON.parse(JSON.stringify(src))); };
      if (!o) { state.items = state.items.filter((i) => i !== s); undone = { s, hit, gone: true }; continue; }
      setTo(o);
      if (slabClashWith(s)) { setTo(now); continue; } // it overlapped before as well: left as it is
      undone = { s, hit, gone: false };
    }
    if (undone) {
      toast(`Floor slabs cannot overlap — ${undone.gone ? 'the new slab was taken out' : `slab #${undone.s.id} went back to where it was`}: it ran into slab #${undone.hit.id} at the same height.`, 'error');
      refreshSelectionUI();
    }
    return !!undone;
  }
  // the floor at point p on this level (the topmost); only those passing `ok` when given
  function floorAt(p, ok = null) {
    const items = levelItems();
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k];
      if (it.type !== 'floor' || (ok && !ok(it))) continue;
      if (onFloor(it, p)) return it;
    }
    return null;
  }
  // is world point p inside floor it's outline?
  function onFloor(it, p) {
    const rad = (-it.r * Math.PI) / 180, cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const dx = p.x - cx, dy = p.y - cy;
    let lx = dx * Math.cos(rad) - dy * Math.sin(rad) + it.w / 2, ly = dx * Math.sin(rad) + dy * Math.cos(rad) + it.h / 2;
    if (it.fx) lx = it.w - lx;
    if (it.fy) ly = it.h - ly;
    return pointInRings(it.rings, (lx * it.w0) / it.w, (ly * it.h0) / it.h);
  }
  /* How much of floor a lies on floor b (0–1), by their real outlines: sampled on a grid over a. (Their bounding
     rectangles are not enough — a room tucked into the corner of an L-shaped room lies inside the L's rectangle.) */
  function floorShare(a, b) {
    const n = 24, bb = bbox([a]);
    let inA = 0, both = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = { x: bb.x + ((i + 0.5) / n) * bb.w, y: bb.y + ((j + 0.5) / n) * bb.h };
      if (!onFloor(a, p)) continue;
      inA++;
      if (onFloor(b, p)) both++;
    }
    return inA ? both / inA : 0;
  }

  // square (Chebyshev) dilation of a 0/1 grid by R cells
  function dilate(src, nx, ny, R) {
    if (R <= 0) return src.slice();
    const tmp = new Uint8Array(nx * ny), out = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      let c = 0;
      for (let i = 0; i < Math.min(R, nx); i++) c += src[row + i];
      for (let i = 0; i < nx; i++) {
        if (i + R < nx) c += src[row + i + R];
        if (i - R - 1 >= 0) c -= src[row + i - R - 1];
        tmp[row + i] = c > 0 ? 1 : 0;
      }
    }
    for (let i = 0; i < nx; i++) {
      let c = 0;
      for (let j = 0; j < Math.min(R, ny); j++) c += tmp[j * nx + i];
      for (let j = 0; j < ny; j++) {
        if (j + R < ny) c += tmp[(j + R) * nx + i];
        if (j - R - 1 >= 0) c -= tmp[(j - R - 1) * nx + i];
        out[j * nx + i] = c > 0 ? 1 : 0;
      }
    }
    return out;
  }

  // trace the outline(s) of a filled cell region into polygons (grid vertex coordinates)
  function traceRings(fill, nx, ny) {
    const f = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && fill[j * nx + i] === 1;
    const out = new Map(); // "x,y" -> [[x2,y2], ...]
    const add = (x1, y1, x2, y2) => {
      const k = x1 + ',' + y1;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push([x2, y2]);
    };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!f(i, j)) continue;
      if (!f(i, j - 1)) add(i, j, i + 1, j);
      if (!f(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!f(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!f(i - 1, j)) add(i, j + 1, i, j);
    }
    const rings = [];
    for (const [startKey, list] of out) {
      while (list.length) {
        const ring = [startKey.split(',').map(Number)];
        let [x, y] = list.pop();
        let guard = 0;
        while (x + ',' + y !== startKey && guard++ < 1e6) {
          ring.push([x, y]);
          const next = out.get(x + ',' + y);
          if (!next || !next.length) break;
          [x, y] = next.pop();
        }
        if (ring.length >= 4) rings.push(ring);
      }
    }
    return rings;
  }

  // Douglas–Peucker simplification of a closed ring
  function simplifyRing(ring, tol) {
    const dp = (pts) => {
      if (pts.length < 3) return pts;
      const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
      const L = Math.hypot(bx - ax, by - ay) || 1;
      let best = 0, idx = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
        if (d > best) { best = d; idx = i; }
      }
      if (best <= tol) return [pts[0], pts[pts.length - 1]];
      return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
    };
    // split the ring at the vertex farthest from the first one
    let far = 0, fd = -1;
    ring.forEach(([x, y], i) => { const d = Math.hypot(x - ring[0][0], y - ring[0][1]); if (d > fd) { fd = d; far = i; } });
    const a = dp(ring.slice(0, far + 1)), b = dp([...ring.slice(far), ring[0]]);
    return [...a.slice(0, -1), ...b.slice(0, -1)];
  }

  const ringArea = (r) => r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0) / 2;
  // visible floor area in m² (excludes the strip that runs under the walls)
  function floorArea(it) {
    const k = (it.w / it.w0) * (it.h / it.h0);
    if (it.area0) return it.area0 * k;
    return (Math.abs((it.rings || []).reduce((s, r) => s + ringArea(r), 0)) * k) / 10000;
  }

  /* The height (above its level, cm) a new floor / garden area gets: the Height bar's — a floor at the working height,
     a garden area at it when the bar was moved off the floor (pointer at the floor → the outside ground) */
  function fillElev(garden) {
    if (state.workZ == null || !isFinite(state.workZ)) return garden ? 0 : state.lastElev || 0;
    const L = curLevel(), rel = round(state.workZ - L.elev, 1);
    if (garden) return Math.abs(workRel()) >= 1 ? Math.max(0, rel) : 0;
    return rel;
  }
  function fillFloorAt(p, garden = false) {
    const elev = fillElev(garden); // the height the new floor would get (the Height bar)
    const existing = floorAt(p, (f) => Math.abs((f.elev || 0) - elev) < 1);
    if (existing) {
      select(existing.id);
      toast(`This area already has a ${existing.garden ? 'garden area' : 'floor'} at this height (${fmtElev(curLevel().elev + elev)}) — it is selected. A second one is only possible at another height.`, 'error');
      return;
    }

    const items = levelItems().filter((i) => byId[i.type].barrier);
    if (!items.length) {
      toast(garden ? 'Nothing encloses this area — drag a rectangle to draw a garden area.' : 'Draw some walls first — the floor fills the space they enclose.', 'error');
      return;
    }
    const b = bbox(items);
    const cell = Math.max(5, Math.ceil(Math.max(b.w, b.h) / 700));
    const R = Math.max(1, Math.round(state.fillGap / 2 / cell));
    const pad = (R + 3) * cell;
    const x0 = b.x - pad, y0 = b.y - pad;
    const nx = Math.ceil((b.w + 2 * pad) / cell), ny = Math.ceil((b.h + 2 * pad) / cell);
    const ci = Math.floor((p.x - x0) / cell), cj = Math.floor((p.y - y0) / cell);
    if (ci <= 0 || cj <= 0 || ci >= nx - 1 || cj >= ny - 1) {
      toast(garden ? 'That spot is outside every wall and fence — drag a rectangle to draw a garden area there.' : 'That spot is outside the walls — click inside a room.', 'error');
      return;
    }

    // 1. rasterise barriers (cell centres inside a polygon)
    const wall = new Uint8Array(nx * ny);
    for (const poly of barrierPolys(cell * 1.5)) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      const i0 = Math.max(0, Math.floor((minX - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((maxX - x0) / cell));
      const j0 = Math.max(0, Math.floor((minY - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((maxY - y0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (pointInRings([poly], x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell)) wall[j * nx + i] = 1;
      }
    }
    // 2. close small gaps between walls, then flood from the click
    const closed = dilate(wall, nx, ny, R);
    if (wall[cj * nx + ci]) {
      toast(garden ? 'You clicked on a wall or fence — click in the open garden area.' : 'You clicked on a wall — click in the open floor area of a room.', 'error');
      return;
    }
    // a click close to a wall lands in the gap-closing margin: walk to the nearest open cell
    let seed = cj * nx + ci;
    if (closed[seed]) {
      const seen = new Uint8Array(nx * ny), q = [seed];
      seen[seed] = 1; seed = -1;
      for (let h = 0; h < q.length && seed < 0; h++) {
        for (const n of [q[h] - 1, q[h] + 1, q[h] - nx, q[h] + nx]) {
          if (n < 0 || n >= seen.length || seen[n] || wall[n]) continue;
          if (!closed[n]) { seed = n; break; }
          seen[n] = 1; q.push(n);
        }
      }
      if (seed < 0) { toast('This space is narrower than the "Floor fill gap" setting — lower it in Plan settings.', 'error'); return; }
    }
    const region = new Uint8Array(nx * ny);
    const queue = new Int32Array(nx * ny);
    let head = 0, tail = 0, leak = false;
    region[seed] = 1; queue[tail++] = seed;
    while (head < tail) {
      const k = queue[head++], i = k % nx, j = (k - i) / nx;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) { leak = true; break; }
      for (const n of [k - 1, k + 1, k - nx, k + nx]) {
        if (!region[n] && !closed[n]) { region[n] = 1; queue[tail++] = n; }
      }
    }
    if (leak) {
      toast(garden
        ? 'This area isn\'t closed by walls, fences or hedges — drag a rectangle instead to draw a garden area.'
        : `This area isn't closed — check for gaps in the walls (or raise "Floor fill gap" in Plan settings, now ${state.fillGap} cm).`, 'error');
      return;
    }
    // 3. grow back up to the real wall faces (8-way, so corners stay square), then 1 cell under the walls
    let frontier = [];
    for (let k = 0; k < region.length; k++) if (region[k]) frontier.push(k);
    const N8 = [-1, 1, -nx, nx, -nx - 1, -nx + 1, nx - 1, nx + 1];
    for (let step = 0; step <= R; step++) {
      const next = [];
      for (const k of frontier) for (const d of N8) {
        const n = k + d;
        if (n >= 0 && n < region.length && !region[n] && !wall[n]) { region[n] = 1; next.push(n); }
      }
      frontier = next;
    }
    let cells = 0;
    for (let k = 0; k < region.length; k++) cells += region[k];
    const visibleArea = (cells * cell * cell) / 10000; // m², up to the wall faces
    const grown = dilate(region, nx, ny, 1);

    // 4. outline -> polygons in world cm
    let rings = traceRings(grown, nx, ny).map((r) => simplifyRing(r, 0.75).map(([i, j]) => [x0 + i * cell, y0 + j * cell]));
    rings = rings.filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > cell * cell * 2);
    if (!rings.length) { toast('Could not find an area to fill here.', 'error'); return; }
    addFloor(rings, visibleArea, garden);
  }

  /* Create a floor object from world-space outline rings. Garden areas use the garden materials, sit at ground
     level (±0) and go behind everything, so house floors are drawn over them. */
  function addFloor(rings, area, garden) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rings) for (const [x, y] of r) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const w = maxX - minX, h = maxY - minY;
    const last = garden ? state.lastGarden : state.lastFloor;
    const it = newItem('floor', 0, 0);
    Object.assign(it, {
      x: minX, y: minY, w, h, w0: w, h0: h, area0: round(area, 3),
      rings: rings.map((r) => r.map(([x, y]) => [round(x - minX, 1), round(y - minY, 1)])),
      // indoor floors take the level last set, so a storey can be filled room by room; gardens start at ground level
      elev: fillElev(garden), // at the height chosen in the Height bar
      material: last.material,
      fill: last.fill || MATERIALS[last.material].color,
      sw: 1, locked: true,
      ...(garden ? { garden: true } : {}),
    });
    if (garden) {
      // on top of earlier garden areas (a patio over a lawn), but under house floors and everything else
      let i = 0;
      while (state.items[i] && state.items[i].type === 'floor' && state.items[i].garden) i++;
      state.items.splice(i, 0, it);
    } else {
      // floors go behind everything except other floors — but over the slab they lie on (and roofs, hills and slopes,
      // which are put at the very back), so a floor laid after its slab is not hidden under it
      const below = (i) => i.type === 'floor' || i.type === 'slab' || i.type === 'hill' || i.type === 'slope' || !!byId[i.type].roof;
      const firstNonFloor = state.items.findIndex((i) => !below(i));
      state.items.splice(firstNonFloor < 0 ? state.items.length : firstNonFloor, 0, it);
    }
    // filled at a height chosen in the Height bar (split level, stacked rooms …): it keeps that height and does not
    // snap onto the top of a slab under it
    if (!garden && state.workZ != null && isFinite(state.workZ) && Math.abs(workRel()) >= 1) it.ownElev = true;
    // over a basement the surface cannot lie on the ground: a slab is poured over that part first
    const poured = garden ? pourSlabFor(it) : null;
    // once settled (a floor on a slab takes the slab's height), it must not double a floor at the same place and height
    syncSlabs();
    const dup = state.items.find((f) => f !== it && f.type === 'floor' && lvlOf(f) === lvlOf(it) && !!f.garden === !!garden &&
      Math.abs((f.elev || 0) - (it.elev || 0)) < 1 && overlapShare(bbox([it]), bbox([f])) > 0.6 && overlapShare(bbox([f]), bbox([it])) > 0.6 &&
      floorShare(it, f) > 0.6 && floorShare(f, it) > 0.6); // (the rectangles first: quick; then the real outlines)
    if (dup) {
      state.items = state.items.filter((i) => i !== it && i !== poured);
      select(dup.id); render();
      toast(`This area already has a ${garden ? 'garden area' : 'floor'} at this height (${fmtElev(curLevel().elev + (dup.elev || 0))}) — it is selected. A second one is only possible at another height.`, 'error');
      return;
    }
    select(it.id);
    render();
    commit();
    toast(poured
      ? `Garden area added — ${round(floorArea(it), 2)} m² of ${MATERIALS[it.material].name.toLowerCase()}. It lies over the ${gardenBase(it).over.name.toLowerCase()}, so a 30 cm concrete slab (${round(poured.w / 100, 2)} × ${round(poured.h / 100, 2)} m) was poured there first.`
      : garden
      ? `Garden area added — ${round(floorArea(it), 2)} m² of ${MATERIALS[it.material].name.toLowerCase()} on solid ground. Pick its surface on the right.`
      : `Floor added — ${round(floorArea(it), 2)} m²${it.elev ? `, level ${it.elev > 0 ? '+' : ''}${it.elev} cm` : ''}. Set its material and elevation on the right.`);
  }

  /* What a garden area (lawn, concrete, paving …) rests on. Over solid ground it is laid directly; where it lies over
     a basement (the walls of the level below, taken as their outer rectangle) a floor slab has to be poured first.
     Returns { over: the level below or null, rect: the part over it, slab: the slab covering that part or null }. */
  function gardenBase(g) {
    const L = levelById(lvlOf(g)) || curLevel();
    const below = storeyBelow(L), belowIds = new Set(below ? storeyOf(below).filter((l) => l.elev < L.elev).map((l) => l.id) : []);
    // (only walls that enclose the basement: free-standing ones set from the Height bar get no slab poured over them)
    const walls = below ? state.items.filter((i) => belowIds.has(lvlOf(i)) && window.FPWalls.isWall(i) && (below.elev >= 0 || enclosesBasement(i))) : [];
    if (!walls.length) return { over: null, rect: null, slab: null };
    const b = bbox(walls), x0 = Math.max(g.x, b.x), y0 = Math.max(g.y, b.y);
    const x1 = Math.min(g.x + g.w, b.x + b.w), y1 = Math.min(g.y + g.h, b.y + b.h);
    if (x1 - x0 < 10 || y1 - y0 < 10) return { over: null, rect: null, slab: null }; // not over it (or only a sliver)
    const rect = { x: round(x0, 1), y: round(y0, 1), w: round(x1 - x0, 1), h: round(y1 - y0, 1) };
    // a slab on this level that covers the whole part (all four corners, 1 cm tolerance)
    const covers = (sl) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].every(([x, y]) => inSlab(sl, x, y, 1));
    const slab = state.items.find((i) => i.type === 'slab' && lvlOf(i) === L.id && covers(i)) || null;
    return { over: below, rect, slab };
  }
  // pour a concrete slab over the basement part of a garden area (no commit: the caller does it)
  function pourSlabFor(g) {
    const B = gardenBase(g);
    if (!B.rect || B.slab) return null;
    const sl = newItem('slab', 0, 0);
    Object.assign(sl, B.rect, { slabT: state.slabT || 30, slabType: 'concrete', autoFit: false, locked: false, lvl: lvlOf(g), label: 'Slab over ' + B.over.name.toLowerCase() });
    state.items.unshift(sl); // slabs lie under everything
    return sl;
  }

  // "Fill garden" by dragging: a rectangular garden area
  function addGardenRect(r) {
    const ge = fillElev(true), dup = levelItems().find((f) => f.type === 'floor' && f.garden && Math.abs((f.elev || 0) - ge) < 1 && overlapShare(r, bbox([f])) > 0.6 && overlapShare(bbox([f]), r) > 0.6);
    if (dup) {
      select(dup.id);
      return toast('There is already a garden area here at the same height — it is selected. Change its surface instead, or draw a smaller area on it (a patio).', 'error');
    }
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
    addFloor([pts], (r.w * r.h) / 10000, true);
  }

  /* "Fit openings": close gaps between wall ends, then fit every door/window into its wall */
  function alignAll() {
    const W = window.FPWalls;
    let walls = 0, openings = 0, centred = 0;
    const items = levelItems();
    // walls under the reference level are first centred on the centrelines of the walls they carry
    if (refIsAbove()) { const segs = refSegs(); for (const it of items) if (!it.locked && W.snapToAxes(it, segs)) centred++; }
    for (const it of items) if (!it.locked && W.isWall(it) && (W.snapWall(it, items) | W.extendToFaces(it, items))) walls++;
    for (const it of items) if (!it.locked && W.isOpening(it) && W.alignOpening(it, items, { fitWidth: true })) openings++;
    render(); buildProps(); commit();
    const n = items.filter((i) => W.isOpening(i)).length;
    toast(n || walls
      ? `Fitted ${openings} of ${n} door${n === 1 ? '' : 's'}/window${n === 1 ? '' : 's'} into walls${walls ? ` · joined ${walls} wall end${walls === 1 ? '' : 's'}` : ''}${centred ? ` · centred ${centred} wall${centred === 1 ? '' : 's'} under ${levelById(state.refLevel).name}` : ''}.`
      : centred ? `Centred ${centred} wall${centred === 1 ? '' : 's'} under the ${levelById(state.refLevel).name} walls.`
      : 'Nothing to align — add walls with doors or windows first.');
  }

  /* House above ground: the height of the ground floor's finished floor above the outside ground (±0).
     Read from the ground floor's largest indoor floor (else the last value set). Changing it raises / lowers, by
     the same amount: every indoor floor of the ground floor, its floor slabs set to a height of their own, and every
     level above (with all they hold). Basements and garden areas stay where they are; walls, slabs, stairs and the
     walls below follow through the usual sync. */
  const groundLevel = () => [...state.levels].filter((l) => l.elev >= 0 && !l.half).sort((a, b) => a.elev - b.elev)[0] || state.levels[0];
  const houseAboveGround = () => state.aboveGround || 0;
  // plans saved before the setting existed: take it from the ground floor's largest room floor
  function deriveAboveGround() {
    const G = groundLevel();
    const floors = state.items.filter((i) => i.type === 'floor' && !i.garden && lvlOf(i) === G.id);
    if (!floors.length) return 0;
    floors.sort((a, b) => floorArea(b) - floorArea(a));
    return G.elev + (floors[0].elev || 0);
  }
  /* The house's base for the elevation model of the ground floor: its height, inside the outline of the ground
     floor's walls (outer faces). null on other levels or at ±0. The outline is cached until the walls change. */
  let houseOutline = { key: null, ring: null };
  // outline of the ground floor's walls (outer faces), cached until they change; null without walls
  function houseRing() {
    const G = groundLevel();
    const walls = state.items.filter((i) => lvlOf(i) === G.id && window.FPWalls.isWall(i));
    if (!walls.length) return null;
    const key = JSON.stringify(walls.map((w) => [w.type, w.x, w.y, w.w, w.h, w.r, w.t, w.fx, w.fy]));
    if (key !== houseOutline.key) {
      const b = bbox(walls);
      houseOutline = { key, ring: wallOutline(walls) || [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] };
    }
    return houseOutline.ring;
  }
  function houseBase(items) {
    const h = houseAboveGround(), G = groundLevel();
    if (!h || !items.length || lvlOf(items[0]) !== G.id) return null;
    const ring = houseRing();
    return ring ? { e: h - G.elev, rings: [ring] } : null;
  }
  function setHouseAboveGround(v) {
    v = Math.max(-200, Math.min(500, round(+v || 0, 1)));
    const G = groundLevel(), d = round(v - houseAboveGround(), 1);
    if (!d) { state.aboveGround = v; buildProps(); return toast(`The ground floor is already at ${fmtElev(v)}.`); }
    state.aboveGround = v;
    state.lastElev = v - G.elev; // rooms filled from now on start at this height
    let floors = 0, slabs = 0, levels = 0;
    for (const it of state.items) {
      if (lvlOf(it) !== G.id) continue;
      if (it.type === 'floor' && !it.garden) { it.elev = round((it.elev || 0) + d, 1); floors++; }
      if (it.type === 'slab' && typeof it.slabZ === 'number') { it.slabZ = round(it.slabZ + d, 1); slabs++; }
    }
    for (const L of state.levels) if (L.elev > G.elev) { L.elev = round(L.elev + d, 1); levels++; }
    render(); commit(); buildProps(); renderView();
    $('#stLevel').textContent = `${curLevel().name} · ${fmtElev(curLevel().elev)}`;
    toast(`House ${d > 0 ? 'raised' : 'lowered'} by ${Math.abs(d)} cm — ground floor at ${fmtElev(v)}` +
      `${floors ? ` · ${floors} floor${floors === 1 ? '' : 's'}` : ''}${slabs ? ` · ${slabs} slab${slabs === 1 ? '' : 's'}` : ''}` +
      `${levels ? ` · ${levels} upper level${levels === 1 ? '' : 's'} moved with it` : ''} · walls, doors, windows and furniture stand on it. Basement and garden stay in place.`);
  }

  /* "Adjust house": every level, starting from the ground floor (the reference). The floors above it are then
     done going up, each lined up on the one below; the basements going down, each lined up under the one above.
     Per level: walls within 15 cm of a parallel wall of the neighbouring level are centred on it, wall ends are
     joined, doors/windows are fitted into their walls. Then the usual sync runs for the whole house: floor slabs
     fit / snap, walls meet the slabs and the level above, stairs take their rise. */
  function adjustHouse() {
    const W = window.FPWalls;
    const byElev = [...state.levels].sort((a, b) => a.elev - b.elev);
    const g = byElev.findIndex((l) => l.elev >= 0), gi = g < 0 ? byElev.length - 1 : g;
    // ground floor, then up, then down — each with the level it lines up on
    const order = [[byElev[gi], null]];
    for (let i = gi + 1; i < byElev.length; i++) order.push([byElev[i], byElev[i - 1]]);
    for (let i = gi - 1; i >= 0; i--) order.push([byElev[i], byElev[i + 1]]);
    const heightsBefore = new Map(state.items.filter((i) => hasHeight(i.type)).map((i) => [i, i.wh || state.wallH]));
    const report = [];
    let total = 0;
    for (const [L, ref] of order) {
      const items = state.items.filter((i) => lvlOf(i) === L.id);
      if (!items.length) continue;
      let centred = 0, joined = 0, fitted = 0;
      if (ref) {
        const segs = W.wallSegments(state.items.filter((i) => lvlOf(i) === ref.id && W.isWall(i)));
        if (segs.length) for (const it of items) if (!it.locked && W.snapToAxes(it, segs)) centred++;
      }
      // count only what really moved
      const moved = (it, fn) => { const k = JSON.stringify([it.x, it.y, it.w, it.h, it.r]); fn(); return k !== JSON.stringify([it.x, it.y, it.w, it.h, it.r]); };
      for (const it of items) if (!it.locked && W.isWall(it) && moved(it, () => { W.snapWall(it, items); W.extendToFaces(it, items); })) joined++;
      for (const it of items) if (!it.locked && W.isOpening(it) && moved(it, () => W.alignOpening(it, items, { fitWidth: true }))) fitted++;
      const bits = [centred && `${centred} centred ${L.elev < (ref ? ref.elev : 0) ? 'under' : 'over'} ${ref.name}`,
        joined && `${joined} wall end${joined === 1 ? '' : 's'} joined`, fitted && `${fitted} opening${fitted === 1 ? '' : 's'} fitted`].filter(Boolean);
      total += centred + joined + fitted;
      report.push(`${L.name}: ${bits.length ? bits.join(', ') : 'already in line'}`);
    }
    render(); commit(); // commit: slabs, wall heights between storeys and stairs follow
    buildProps(); renderView();
    const heights = [...heightsBefore].filter(([it, h]) => state.items.includes(it) && Math.abs((it.wh || state.wallH) - h) > 0.05).length;
    if (heights) report.push(`${heights} wall height${heights === 1 ? '' : 's'} matched between storeys`);
    toast(total || heights ? `Whole house adjusted from the ground floor — ${report.join(' · ')}.` : 'The whole house is already in line — nothing to adjust.');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 7000); // a longer read
  }

  /* ── New plan dialog: pick the floors (basement, 1st–3rd) and their heights ──
     The 1st floor is the ground-level storey (the ±0 reference level); its finished floor sits "above ground".
     Each storey is clear height + slab thickness above the one below; every floor level can be typed in too. */
  const np = $('#newPlan');
  const npNum = (id) => round((parseFloat($(id).value) || 0) * 100, 1); // typed in m, worked out in cm
  /* Levels chained from the 1st floor: its floor is "above ground"; each floor above starts on the ceiling of the one
     below plus the slab; the basement's ceiling is the 1st floor minus the slab. Ceiling = floor + that floor's clear
     height. A floor level typed by hand is kept, and the floors beyond it chain on from it. Values in cm. */
  const npRow = (n) => np.querySelector(`tr[data-np="${n}"]`);
  const npClearOf = (n) => round((parseFloat(npRow(n).querySelector('[data-np-clear]').value) || 0) * 100, 1);
  function npLevels() {
    const above = npNum('#npAbove'), slab = Math.max(0, npNum('#npSlab')), out = {};
    const floorAt = (n, auto) => { const el = npRow(n).querySelector('[data-np-elev]'); return el.dataset.manual ? round((parseFloat(el.value) || 0) * 100, 1) : auto; };
    out[1] = floorAt(1, above);
    out[2] = floorAt(2, out[1] + npClearOf(1) + slab);
    out[3] = floorAt(3, out[2] + npClearOf(2) + slab);
    out[0] = floorAt(0, out[1] - slab - npClearOf(0));
    return out;
  }
  function npRecalc() {
    const lv = npLevels();
    np.querySelectorAll('tr[data-np]').forEach((tr) => {
      const n = +tr.dataset.np, el = tr.querySelector('[data-np-elev]');
      if (!el.dataset.manual) el.value = (lv[n] / 100).toFixed(2);
      tr.classList.toggle('off', !tr.querySelector('input[type=checkbox]').checked);
      tr.querySelector('[data-np-ceil]').textContent = fmtElev(lv[n] + npClearOf(n));
      // the walls run from the floor level up to the next floor level: ceiling + slab
      tr.querySelector('[data-np-top]').textContent = fmtElev(lv[n] + npClearOf(n) + Math.max(0, npNum('#npSlab')));
    });
  }
  function openNewPlan() {
    $('#npName').value = 'My Floor Plan';
    np.querySelectorAll('[data-np-elev]').forEach((el) => delete el.dataset.manual);
    // defaults: 1st floor 1.00 m above ground, 0.50 m slabs, 3.00 m rooms (2.50 m on the 1st floor: 3.00 m walls)
    $('#npAbove').value = '1.00'; $('#npSlab').value = '0.50'; $('#npClear').value = '3.00';
    for (const [n, c] of [[3, '3.00'], [2, '3.00'], [1, '2.50'], [0, '3.00']]) npRow(n).querySelector('[data-np-clear]').value = c;
    $('#npWarn').hidden = !state.items.length;
    np.hidden = false;
    npRecalc();
    $('#npName').select();
  }
  np.addEventListener('input', (e) => {
    if (e.target.matches('[data-np-elev]')) e.target.dataset.manual = '1'; // typed by hand: keep it
    // the overall clear height sets every floor's
    if (e.target.id === 'npClear') np.querySelectorAll('[data-np-clear]').forEach((el) => { el.value = e.target.value; });
    npRecalc();
  });
  np.addEventListener('change', npRecalc);
  np.querySelector('[data-np-cancel]').addEventListener('click', () => { np.hidden = true; });
  np.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); np.hidden = true; } });
  np.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const clear = Math.max(50, npNum('#npClear')), slab = Math.max(5, npNum('#npSlab')), lv = npLevels();
    const on = (n) => npRow(n).querySelector('input[type=checkbox]').checked, floorOf = (n) => lv[n];
    const names = ['Basement', '1st floor', '2nd floor', '3rd floor'];
    // the 1st floor is the ±0 reference level; its floor height is the house's "above ground"
    // each level's walls: from its floor level to its wall top (its ceiling + the slab above)
    const wallOf = (n) => round(npClearOf(n) + slab, 1);
    // no two levels at the same floor height
    const chosen = [1, 2, 3, 0].filter((n) => n === 1 || on(n));
    const clash = chosen.find((n, i) => chosen.slice(i + 1).some((m) => Math.abs(floorOf(n) - floorOf(m)) < 0.5));
    if (clash != null) return toast(`Two floors are at the same height (${fmtElev(floorOf(clash))}) — give each floor its own floor level.`, 'error');
    const levels = [{ id: 'L0', name: names[1], elev: 0, wallH: wallOf(1) }];
    for (const n of [2, 3]) if (on(n)) levels.push({ id: 'L' + (n - 1), name: names[n], elev: floorOf(n), wallH: wallOf(n) });
    if (on(0)) levels.push({ id: 'LB', name: names[0], elev: floorOf(0), wallH: wallOf(0) });
    state.items = []; applySel([]);
    state.title = $('#npName').value.trim() || 'My Floor Plan'; $('#planTitle').value = state.title;
    state.levels = levels; state.level = 'L0'; state.refLevel = null; state.showRef = false;
    state.wallH = round(clear + slab, 1); // the standard: floor level to wall top (clear height + slab)
    state.slabT = slab;           // new floor slabs start at this thickness
    state.aboveGround = floorOf(1);
    state.lastElev = floorOf(1);  // rooms filled on the 1st floor start at its floor height
    np.hidden = true;
    render(); buildProps(); fit(); commit();
    toast(`New plan: ${levels.map((l) => `${l.name} ${fmtElev(l.id === 'L0' ? floorOf(1) : l.elev)}`).join(' · ')} — slabs ${(slab / 100).toFixed(2)} m; walls up to ${[3, 2, 1, 0].filter(on).map((n) => fmtElev(lv[n] + npClearOf(n) + slab)).join(', ')}.`);
  });

  /* Roofs: the eaves sit on the top of the walls under it or along its edge (its level); without any, on the level's
     standard wall height. Above the outside ground, cm. */
  // a roof's eaves (above ground ±0): set by hand / from the Height bar (it.roofZ), else on top of the walls under it
  function roofBase(it) {
    if (it.roofZ != null && isFinite(it.roofZ)) return it.roofZ;
    const L = levelById(lvlOf(it)) || curLevel();
    const sup = window.FPWalls.slabSupport(it, state.items.filter((i) => lvlOf(i) === L.id));
    return sup.walls.length ? L.elev + Math.max(...sup.walls.map((u) => u.top)) : floorAbs(L) + (L.wallH || state.wallH);
  }
  // a roof's covering: chosen, else the usual one for its style
  const roofMatOf = (it) => (WALLMATS.ROOF_MATS[it.roofMat] ? it.roofMat
    : ({ flat: 'membrane', shed: 'standing-seam', butterfly: 'standing-seam', gambrel: 'shingles', mansard: 'slate', saltbox: 'wood-shakes', clerestory: 'wood-shakes' }[byId[it.type].roof] || 'clay-tiles'));
  const roofPitch = (it) => (it.pitch == null ? (byId[it.type].roof === 'shed' || byId[it.type].roof === 'butterfly' ? 10 : 30) : it.pitch);

  /* ── Working height (height bar) ──
     state.workZ: the height above the outside ground (cm) being designed at, in 0.25 m steps. Picking one in the bar
     switches to the level that holds it (the highest floor at or below it); objects added from then on stand that far
     above their floor (it.z), and on the plan the objects that are not at that height are faded. */
  const floorAbs = (L) => (L.id === groundLevel().id ? L.elev + (state.aboveGround || 0) : L.elev);
  const workRel = () => (state.workZ == null ? 0 : state.workZ - floorAbs(curLevel())); // above the current floor
  // furniture, fittings, garden objects … — things that can stand at a height (not the building shell)
  const isObject = (it) => {
    const ic = byId[it.type];
    return !!ic && !window.FPWalls.isWall(it) && !ic.opening && !ic.stairs && !ic.ownLabel &&
      !ic.roof && !['roof-window', 'chimney', 'balcony', 'floor', 'slab', 'slab-opening', 'hill', 'slope', 'gravel-path', 'pool', 'sewage-pit'].includes(it.type) && !/^column|^pillar/.test(it.type);
  };
  // height of an object (cm): its own setting, else the usual height of that kind of object
  const objectHeight = (it) => it.fh || byId[it.type].height || (window.FPAIExport && window.FPAIExport.heightOf(it.type)) || 75;
  // is it at the working height? (its span above the floor holds it)
  function atWorkHeight(it) {
    if (!isObject(it)) return true;
    const c = workRel(), z0 = it.z || 0, z1 = z0 + objectHeight(it);
    return c >= z0 - 1 && c <= z1;
  }
  let STEP = 25; // rows of the Height bar: 0.25 m (metric) or 1 ft (imperial)
  const LEVEL_COLOURS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#dc2626'];
  let heightBarKey = '';
  function renderHeightBar() {
    STEP = imperial() ? 12 * IN : 25;
    const PER = imperial() ? 2 : 4; // rows between labelled marks: every 1 m (metric) or 2 ft (imperial)
    if (state.workZ == null || !isFinite(state.workZ)) state.workZ = floorAbs(curLevel()); // start on the floor
    const lv = [...state.levels].sort((a, b) => a.elev - b.elev);
    const floors = lv.map((l) => ({ l, f: floorAbs(l) }));
    const top = Math.max(...floors.map((x) => x.f)) + (state.wallH || 300) + STEP;
    const lo = Math.min(0, ...floors.map((x) => x.f)) - STEP;
    const hiS = Math.ceil(top / STEP) * STEP, loS = Math.floor(lo / STEP) * STEP;
    const span = selSpan();
    const key = JSON.stringify([UNITS, hiS, loS, floors.map((x) => [x.l.id, x.l.name, x.f]), state.workZ, state.level, span]);
    if (key === heightBarKey) return;
    heightBarKey = key;
    const colour = (l) => LEVEL_COLOURS[lv.indexOf(l) % LEVEL_COLOURS.length];
    // the level a height belongs to: the highest floor at or below it (else the lowest level)
    const levelAt = (h) => [...floors].reverse().find((x) => x.f <= h + 0.5) || floors[0];
    let rows = '';
    for (let k = Math.round(hiS / STEP); k >= Math.round(loS / STEP); k--) {
      const h = round(k * STEP, 2);
      const L = levelAt(h).l, isFloor = floors.find((x) => Math.abs(x.f - h) < STEP / 2);
      // the row of the working height — or the nearest one, when it is between rows (e.g. an object's bottom)
      const whole = k % PER === 0, half = !imperial() && !whole && k % 2 === 0, on = state.workZ != null && state.workZ - h > -STEP / 2 + 0.01 && state.workZ - h <= STEP / 2 + 0.01;
      // the selected object: its bottom and top rows (the nearest ones) and the rows between
      const near = (z) => z != null && z - h > -STEP / 2 + 0.01 && z - h <= STEP / 2 + 0.01;
      const sBot = span && near(span.bot), sTop = span && span.top != null && span.top - span.bot > 1 && near(span.top);
      const inSpan = span && span.top != null && h >= span.bot - STEP / 2 && h <= span.top + STEP / 2;
      const label = h === 0 ? '±0' : imperial() ? `${h > 0 ? '+' : '−'}${Math.round(Math.abs(h) / IN / 12)}'` : `${h > 0 ? '+' : '−'}${(Math.abs(h) / 100).toFixed(whole ? 1 : 2)}`;
      rows += `<button class="hb-row${whole ? ' whole' : ''}${half ? ' half' : ''}${on ? ' on' : ''}${h === 0 ? ' ground' : ''}${isFloor ? ' floor' : ''}${inSpan ? ' sel-span' : ''}${sBot ? ' sel-bot' : ''}${sTop ? ' sel-top' : ''}" data-hb="${h}" ` +
        `style="--band:${colour(L)}" title="${esc(L.name)} — ${label}${imperial() ? '' : ' m'} above the outside ground${isFloor ? ` (floor of ${esc(isFloor.l.name)})` : ''}">` +
        `<span class="band" style="background:${colour(L)}22"></span>` +
        `${isFloor ? `<span class="lname">${esc(isFloor.l.name)}</span>` : ''}${h === 0 ? '<span class="gname">ground</span>' : ''}` +
        `${sTop ? `<span class="selmark" title="Top of the selected ${esc(span.name)}: ${fmtElev(span.top)}">▲</span>` : sBot ? `<span class="selmark" title="Bottom of the selected ${esc(span.name)}: ${fmtElev(span.bot)}">▼</span>` : ''}` +
        `${whole || on ? label : '·'}</button>`;
    }
    const c = workRel();
    const selHead = span ? `<span class="hb-sel" title="${esc(span.name)}: bottom ${fmtElev(span.bot)}${span.top != null ? `, top ${fmtElev(span.top)}` : ''}">${span.top != null && span.top - span.bot > 1 ? `▲ ${fmtElev(span.top)}<br>` : ''}▼ ${fmtElev(span.bot)}</span>` : '';
    $('#heightBar').innerHTML = `<div class="hb-head"><span class="hb-cap">Height</span><b>${fmtElev(state.workZ == null ? floorAbs(curLevel()) : state.workZ)}</b>${c ? `${c > 0 ? '+' : '−'}${(Math.abs(c) / 100).toFixed(2)} m above floor` : 'on the floor'}${selHead}</div>${rows}`;
    const on = $('#heightBar .hb-row.on');
    if (on && (!renderHeightBar.scrolled || renderHeightBar.follow)) { on.scrollIntoView({ block: 'nearest' }); renderHeightBar.scrolled = true; }
    renderHeightBar.follow = false;
  }
  /* The bottom of an object, above the outside ground ±0 (cm): what it stands on plus how far it is raised. Used by
     the 3D view: picking an object there moves the Height bar to its bottom. */
  /* Balconies: the glass sliding door that goes with one — in the wall along its back edge (the icon's top edge),
     centred, as wide as fits (at most 2.4 m). The two are grouped, so they move together. */
  function addBalconyDoor(bal) {
    // an L-shaped one: in the wall along its longer arm (the bottom strip's back edge)
    const L = bal.balShape === 'L', d = L ? Math.max(60, Math.min(bal.balDepth || 150, bal.w * 0.6, bal.h * 0.6)) : 0;
    const len = L ? bal.w - d : bal.w;
    const tf = window.FPWalls.toWorld(bal), [cx, cy] = tf(L ? [len / 2, bal.h - d - 7.5] : [bal.w / 2, -7.5]);
    const door = newItem('door-sliding', cx, cy);
    door.w = Math.max(80, Math.min(240, len - 60)); door.x = cx - door.w / 2; door.y = cy - door.h / 2;
    door.r = bal.r || 0; door.lvl = bal.lvl;
    if (bal.z) door.z = bal.z; else delete door.z; // its threshold at the balcony's floor
    // (the door is an object of its own — not grouped with the balcony)
    state.items.push(door);
    if (state.align !== false) autoAlign(door, true);
    return window.FPWalls.analyze(levelItems()).hosts.has(door.id) ? door : null;
  }
  /* A balcony dropped near a house wall turns to face out from it: its back edge (the icon's top edge) goes flush
     against the wall's outer face on the side where it was dropped, centred where it was dropped. */
  function fitBalcony(bal) {
    const W = window.FPWalls, walls = levelItems().filter((i) => W.isWall(i)), segs = W.wallSegments(walls);
    if (!segs.length) return false;
    if (bal.balShape === 'L') {
      // wrap the corner of the house (the outline of its walls) nearest to where it was dropped
      const B = bbox(walls), P = [bal.x + bal.w / 2, bal.y + bal.h / 2];
      const corners = [[B.x + B.w, B.y + B.h, 0], [B.x, B.y + B.h, 90], [B.x, B.y, 180], [B.x + B.w, B.y, 270]];
      const [kx, ky, r] = corners.sort((a, b) => Math.hypot(a[0] - P[0], a[1] - P[1]) - Math.hypot(b[0] - P[0], b[1] - P[1]))[0];
      if (Math.hypot(kx - P[0], ky - P[1]) > Math.max(bal.w, bal.h) + 200) return false;
      const d = Math.max(60, Math.min(bal.balDepth || 150, bal.w * 0.6, bal.h * 0.6));
      const v = [bal.w - d - bal.w / 2, bal.h - d - bal.h / 2], a = (r * Math.PI) / 180;
      const rv = [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
      bal.r = r; bal.x = round(kx - rv[0] - bal.w / 2, 1); bal.y = round(ky - rv[1] - bal.h / 2, 1);
      return true;
    }
    const P = [bal.x + bal.w / 2, bal.y + bal.h / 2];
    let best = null;
    for (const sg of segs) {
      const d = [P[0] - sg.A[0], P[1] - sg.A[1]], along = d[0] * sg.u[0] + d[1] * sg.u[1];
      if (along < -bal.w / 2 || along > sg.len + bal.w / 2) continue;
      const nrm = [-sg.u[1], sg.u[0]], off = d[0] * nrm[0] + d[1] * nrm[1];
      if (Math.abs(off) > bal.h + 200) continue;
      if (!best || Math.abs(off) < Math.abs(best.off)) best = { sg, along: Math.min(sg.len - 20, Math.max(20, along)), off, nrm };
    }
    if (!best) return false;
    const { sg, along, nrm } = best, side = best.off >= 0 ? 1 : -1, out = [nrm[0] * side, nrm[1] * side], t = sg.t || 15;
    bal.r = round(normAngle((Math.atan2(-out[0], out[1]) * 180) / Math.PI), 2);
    const back = [sg.A[0] + sg.u[0] * along + out[0] * t / 2, sg.A[1] + sg.u[1] * along + out[1] * t / 2];
    const c = [back[0] + out[0] * bal.h / 2, back[1] + out[1] * bal.h / 2];
    bal.x = round(c[0] - bal.w / 2, 1); bal.y = round(c[1] - bal.h / 2, 1);
    return true;
  }
  /* The three sides of a square balcony (left, front, right as seen from the house): each 'rail' (its guard), 'wall'
     (a full-height wall of its own) or 'none' (open). Left on "Auto" (the default), a side that runs along a house wall
     — the balcony set into a niche, or against a wing of the house — gets no railing: the wall already closes it. */
  function balconySides(bal) {
    const out = { L: 'rail', F: 'rail', R: 'rail' };
    if ((bal.balShape || 'square') !== 'square') return out;
    const W = window.FPWalls, tf = W.toWorld(bal), w = bal.w, h = bal.h;
    let segs = null;
    for (const k of ['L', 'F', 'R']) {
      const m = bal['bal' + k];
      if (m === 'rail' || m === 'wall' || m === 'none') { out[k] = m; continue; }
      segs = segs || W.wallSegments(state.items.filter((i) => lvlOf(i) === lvlOf(bal) && W.isWall(i)));
      const [a, b] = { L: [[0, 0], [0, h]], F: [[0, h], [w, h]], R: [[w, h], [w, 0]] }[k].map(tf);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const along = segs.some((sg) => {
        if (Math.abs(u[0] * sg.u[1] - u[1] * sg.u[0]) > 0.05) return false;                       // not parallel
        const off = Math.abs((a[0] - sg.A[0]) * -sg.u[1] + (a[1] - sg.A[1]) * sg.u[0]);           // gap between the lines
        if (off > (sg.t || 15) / 2 + 35) return false;
        const pa = (a[0] - sg.A[0]) * sg.u[0] + (a[1] - sg.A[1]) * sg.u[1], pb = (b[0] - sg.A[0]) * sg.u[0] + (b[1] - sg.A[1]) * sg.u[1];
        const ov = Math.min(sg.len, Math.max(pa, pb)) - Math.max(0, Math.min(pa, pb));
        return ov >= Math.min(len * 0.4, 80);                                                       // along a good part of it
      });
      out[k] = along ? 'none' : 'rail';
      out['auto' + k] = true;
    }
    return out;
  }
  const balconyDrawInfo = (it) => { const r = balconySides(it); return { ...it, balL: r.L, balF: r.F, balR: r.R }; };
  const balconyDoor = (bal) => bal.grp && state.items.find((i) => i.grp === bal.grp && i !== bal && /^door/.test(i.type));
  // the balcony a door belongs to (a door grouped with a balcony), or null
  const doorsBalcony = (door) => (door && door.grp && /^door/.test(door.type) && state.items.find((i) => i.grp === door.grp && i.type === 'balcony')) || null;
  /* Keep a balcony's door in line with it: on its back edge (in the house wall), no wider than the balcony allows,
     turned like it — where along the edge it sits is kept (the door can be slid along), within the balcony. */
  /* A balcony's door follows the balcony: it sits on the balcony's back edge (in the house wall), turned like it,
     at bal.doorAt cm along that edge (its middle), no wider than the balcony allows. Moving, turning or resizing the
     balcony carries the door along; sliding the door itself along the edge sets bal.doorAt. Run on every render. */
  const balKeys = new Map();
  function balcLine(bal) {
    const L = bal.balShape === 'L', d = L ? Math.max(60, Math.min(bal.balDepth || 150, bal.w * 0.6, bal.h * 0.6)) : 0;
    return { len: L ? bal.w - d : bal.w, ly: L ? bal.h - d - 7.5 : -7.5 };
  }
  function syncBalconyDoor(bal, fromDoor = false) {
    const door = balconyDoor(bal);
    if (!door) return false;
    const { len, ly } = balcLine(bal);
    const dw = len - 60 >= 80 ? Math.max(80, Math.min(door.w, len - 60)) : Math.max(40, len - 20);
    if (fromDoor || bal.doorAt == null) {
      // where the door is now, along the balcony's edge
      const a = ((bal.r || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), bx = bal.x + bal.w / 2, by = bal.y + bal.h / 2;
      const dx = door.x + door.w / 2 - bx, dy = door.y + door.h / 2 - by;
      const lx = dx * c + dy * s + bal.w / 2;
      bal.doorAt = round(isFinite(lx) ? lx : len / 2, 1);
    }
    const lx = Math.min(len - dw / 2 - 10, Math.max(dw / 2 + 10, bal.doorAt));
    const [cx, cy] = window.FPWalls.toWorld(bal)([lx, ly]);
    const nx = round(cx - dw / 2, 2), ny = round(cy - door.h / 2, 2), nr = bal.r || 0;
    if (door.w === round(dw, 1) && Math.abs(door.x - nx) < 0.01 && Math.abs(door.y - ny) < 0.01 && door.r === nr) return false;
    door.w = round(dw, 1); door.x = nx; door.y = ny; door.r = nr;
    return true;
  }
  /* Balconies and their sliding doors are separate objects: a balcony grouped only with its door(s) (as plans saved
     before did) is taken out of that group, so each is picked, moved, turned and sized on its own. */
  function syncBalconyDoors() {
    const groups = new Map();
    for (const i of state.items) if (i.grp != null) (groups.get(i.grp) || groups.set(i.grp, []).get(i.grp)).push(i);
    for (const [, g] of groups) {
      if (!g.some((i) => i.type === 'balcony') || !g.every((i) => i.type === 'balcony' || /^door/.test(i.type))) continue;
      for (const i of g) { delete i.grp; delete i.grpName; }
    }
  }
  // after a balcony is resized, turned or reshaped: back edge flush against the house wall again, its door in line
  function balconyAfterEdit(bal) {
    if (!bal || bal.type !== 'balcony' || !balconyDoor(bal)) return;
    fitBalcony(bal);
    syncBalconyDoor(bal);
  }
  // a balcony's walking surface: its level's floor (+ it.z when raised), above ground ±0
  const balconyFloor = (it) => floorAbs(levelById(lvlOf(it)) || curLevel()) + (it.z || 0);
  function balconySection(it, dis) {
    return `
      <section><h3>Balcony</h3>
        <div class="row"><label>Shape</label><select data-k="balShape" ${dis}>
          <option value="square" ${it.balShape !== 'round' ? 'selected' : ''}>Square</option>
          <option value="round" ${it.balShape === 'round' ? 'selected' : ''}>Semi-circular</option>
          <option value="L" ${it.balShape === 'L' ? 'selected' : ''}>L-shaped (wraps a corner)</option></select></div>
        ${it.balShape === 'L' ? `<div class="row" title="How deep both arms of the L are"><label>Depth</label>
          ${num('balDepth', it.balDepth || 150, 5, `min="60" max="400" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>` : ''}
        <div class="row"><label>Guard</label><select data-k="balGuard" ${dis}>
          <option value="steel" ${(it.balGuard || 'steel') === 'steel' ? 'selected' : ''}>Stainless steel railing</option>
          <option value="concrete" ${it.balGuard === 'concrete' ? 'selected' : ''}>All concrete (solid parapet)</option>
          <option value="low" ${it.balGuard === 'low' ? 'selected' : ''}>Low concrete wall + stainless rail</option></select></div>
        ${(it.balShape || 'square') === 'square' ? `<p class="note" style="margin:8px 0 4px"><b>Sides</b> <span style="color:var(--muted)">(left / right as seen from the house)</span></p>
        ${[['balR', 'Left side'], ['balF', 'Front'], ['balL', 'Right side']].map(([k, n]) => `<div class="row"><label>${n}</label><select data-k="${k}" ${dis}>
          <option value="auto" ${!['rail', 'wall', 'none'].includes(it[k]) ? 'selected' : ''}>Auto — ${balconySides(it)[k[3]] === 'none' ? 'open (a house wall runs along it)' : 'guard'}</option>
          <option value="rail" ${it[k] === 'rail' ? 'selected' : ''}>Guard (as chosen above)</option>
          <option value="wall" ${it[k] === 'wall' ? 'selected' : ''}>Wall (full height)</option>
          <option value="none" ${it[k] === 'none' ? 'selected' : ''}>Open (nothing)</option></select></div>`).join('')}
        <div class="btns"><button data-do="bal-sides" data-v="auto,auto,auto" ${dis} title="Each side gets a guard unless a house wall runs along it">Auto</button>
          <button data-do="bal-sides" data-v="rail,rail,rail" ${dis} title="Guard on all three sides">3 sides open</button>
          <button data-do="bal-sides" data-v="wall,rail,wall" ${dis} title="Walls left and right, guard only at the front (a balcony set in between rooms)">Front only</button>
          <button data-do="bal-sides" data-v="rail,rail,wall" ${dis}>Wall left</button><button data-do="bal-sides" data-v="wall,rail,rail" ${dis}>Wall right</button></div>` : ''}
        <div class="row"><label class="check"><input type="checkbox" data-k="balRoof" ${it.balRoof ? 'checked' : ''} ${dis}/> Roof over the balcony</label></div>
        ${it.balRoof ? `<div class="row" title="Height of the roof's underside above the balcony floor"><label>Roof height</label>
          ${num('balRoofH', it.balRoofH || 260, 5, `min="200" max="450" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>` : ''}
        <div class="row"><label class="check"><input type="checkbox" data-k="balHooks" ${it.balHooks ? 'checked' : ''} ${dis}/> Iron rod hooks (clothes-drying rods)</label></div>
        <div class="btns"><button data-do="bal-door" ${dis} title="Put a glass sliding door in the house wall behind the balcony (a separate object: select it to move, size or delete it)">Add sliding door</button>
          <button data-do="bal-fit" ${dis} title="Turn it to face out from the nearest house wall and put it against that wall">Fit against the nearest wall</button></div>
        <p class="note" style="color:var(--muted)">The balcony and its sliding door are separate objects — each is selected, moved, turned and sized on its own.</p>
        <p class="note" style="color:var(--muted)">Its floor is at ${fmtElev(balconyFloor(it))} (the floor of ${esc((levelById(lvlOf(it)) || curLevel()).name)}); the back edge — the door side — goes against the house wall.</p>
      </section>`;
  }
  // the floor (or ground) under an object's centre, above the outside ground ±0
  function floorUnder(it) {
    const L = levelById(lvlOf(it)) || curLevel();
    return L.elev + window.FPWalls.elevationModel(state.items.filter((i) => lvlOf(i) === L.id)).at(it.x + it.w / 2, it.y + it.h / 2);
  }
  const isWindowItem = (it) => window.FPWalls.isOpening(it) && /^window/.test(it.type);
  /* Position Z (its bottom above ground ±0) → [setting, value] for this kind of object, or null when its bottom is
     set by how it is built (doors stand on the floor, openings cut the slab, …). */
  function zTarget(it, z) {
    const ic = byId[it.type] || {}, L = levelById(lvlOf(it)) || curLevel();
    if (ic.ownLabel) return null;
    if (ic.stairs) return ['stairStart', z];
    if (it.type === 'balcony') return ['z', round(z - floorAbs(L), 1)]; // its floor at that height
    if (it.type === 'pool') return ['z', z + (it.poolDepth || 150) + 8 - floorUnder(it)];
    if (ic.roof) return ['roofZ', z];
    if (it.type === 'slab') return ['slabZ', z];
    if (it.type === 'floor') return ['elev', z - L.elev];
    if (hasHeight(it.type)) return ['wz', z - floorAbs(L)];
    if (it.type === 'sewage-pit') return ['z', round(z - floorUnder(it), 1)];
    if (isWindowItem(it)) return (ic.opening && ic.opening.top) ? null : ['sill', Math.max(0, z - floorUnder(it))];
    if (window.FPWalls.isOpening(it)) { // a door: its threshold raised above the floor beside it (e.g. onto a raised balcony)
      const thr = objectBottom({ ...it, z: 0 });
      return ['z', Math.max(0, round(z - thr, 1))];
    }
    if (isObject(it)) return ['z', z - floorUnder(it)];
    return null;
  }
  // Size H (bottom to top) → [setting, value], or null when it follows from other settings (a roof's pitch, …)
  function hTarget(it, h) {
    const ic = byId[it.type] || {};
    if (ic.ownLabel) return null;
    if (ic.stairs) return ['topZ', stairBottom(it) + h];
    if (it.type === 'slab') return ['slabT', h];
    if (hasHeight(it.type)) return ['wh', h];
    if (it.type === 'hill') return ['hillH', h];
    if (it.type === 'pool') return ['poolDepth', Math.max(60, Math.min(400, h - 13))];
    if (isWindowItem(it)) {
      if (ic.opening && ic.opening.top) return ['winH', h];
      const L = levelById(lvlOf(it)) || curLevel(), sp = window.FPWalls.windowSpan(it, L.wallH || state.wallH);
      return ['head', sp[0] + h];
    }
    if (window.FPWalls.isOpening(it)) return ['head', h];
    if (isObject(it)) return ['fh', h];
    return null;
  }
  function objectBottom(it) {
    const L = levelById(lvlOf(it)) || curLevel(), ic = byId[it.type] || {}, W = window.FPWalls;
    const at = () => W.elevationModel(state.items.filter((i) => lvlOf(i) === L.id)).at(it.x + it.w / 2, it.y + it.h / 2);
    if (ic.stairs) return stairBottom(it);
    if (it.type === 'balcony') return balconyFloor(it); // its walking floor (the height picked in the Height bar)
    if (it.type === 'pool') return floorUnder(it) + (it.z || 0) - (it.poolDepth || 150) - 8; // the basin's floor
    if (ic.roof) return roofBase(it);
    if (it.type === 'slab') return slabInfo(it).bottom;
    if (it.type === 'floor') return L.elev + (it.elev || 0);
    if (hasHeight(it.type)) return it.wz ? floorAbs(L) + it.wz : L.elev + at();
    if (W.isOpening(it)) return L.elev + at() + (/^window/.test(it.type) && W.windowSpan ? W.windowSpan(it, L.wallH || state.wallH)[0] || 0 : (it.z || 0)); // a window: its sill; a door: its threshold (raised by it.z)
    return L.elev + at() + (it.z || 0);
  }
  // the top of an object, above the outside ground ±0 (cm): its bottom plus its height
  function objectTop(it) {
    const L = levelById(lvlOf(it)) || curLevel(), ic = byId[it.type] || {}, W = window.FPWalls, b = objectBottom(it);
    if (ic.stairs) return b + stairRise(it);
    if (it.type === 'balcony') return balconyFloor(it) + (it.balRoof ? (it.balRoofH || 260) + 12 : 105);
    if (it.type === 'pool') return floorUnder(it) + (it.z || 0) + 5; // its coping
    if (it.type === 'slab') return slabInfo(it).top;
    if (it.type === 'floor' || it.type === 'slab-opening') return b;
    if (hasHeight(it.type)) return b + (it.wh || L.wallH || state.wallH);
    if (ic.roof) return b + (it.roofT || 15) + (byId[it.type].roof === 'flat' ? (ic.roofFence ? Math.max(8, it.roofFence == null ? 50 : it.roofFence) : 8) : window.FP_ROOFS.rise(byId[it.type].roof, it.w, it.h, roofPitch(it))); // + its thickness on top
    if (W.isOpening(it)) {
      const at = W.elevationModel(state.items.filter((i) => lvlOf(i) === L.id)).at(it.x + it.w / 2, it.y + it.h / 2);
      return /^window/.test(it.type) && W.windowSpan ? L.elev + at + W.windowSpan(it, L.wallH || state.wallH)[1] : L.elev + at + (it.z || 0) + (it.head != null ? it.head : 210);
    }
    return b + objectHeight(it);
  }
  // the selected object's span in the Height bar: { bot, top } (one object selected), else null
  function selSpan() {
    const ids = selIds();
    if (!ids.length && state.pinSpan) return state.pinSpan; // kept when the Height bar moved to another level
    if (ids.length !== 1) return null;
    const it = state.items.find((i) => i.id === ids[0]);
    if (!it || byId[it.type].ownLabel) return null;
    try {
      const bot = objectBottom(it), top = objectTop(it);
      return isFinite(bot) ? { id: it.id, bot: round(bot, 1), top: top != null && isFinite(top) ? round(top, 1) : null, name: itemName(it) } : null;
    } catch (e) { return null; }
  }
  // the Height bar follows an object picked in the 3D view (its level is already the current one)
  function followBottom(id) {
    const it = id != null && state.items.find((i) => i.id === id);
    if (!it) return;
    let h;
    try { h = round(objectBottom(it), 1); } catch (e) { return; }
    if (!isFinite(h)) return;
    state.workZ = h;
    renderHeightBar.follow = true;
    renderHeightBar();
    const c = workRel(), L = curLevel();
    $('#stAlign').textContent = `Height bar at the bottom of ${itemName(it)}: ${fmtElev(h)}${Math.abs(c) >= 1 ? ` — ${(Math.abs(c) / 100).toFixed(2)} m ${c > 0 ? 'above' : 'below'} the floor of ${L.name}` : ` — on the floor of ${L.name}`}`;
    $('#stLevel').textContent = `${L.name} · ${fmtElev(floorAbs(L))}${Math.abs(c) >= 1 ? ` · working height ${fmtElev(h)}` : ''}`;
  }
  // the level a working height belongs to: the highest floor at or below it (else the lowest level)
  function levelForZ(h) {
    const floors = [...state.levels].map((l) => ({ l, f: floorAbs(l) })).sort((a, b) => a.f - b.f);
    return ([...floors].reverse().find((x) => x.f <= h + 0.5) || floors[0]).l;
  }
  const view3dOpen = () => { const v = document.getElementById('view3d'); return !!v && v.classList.contains('open'); };
  /* Moving the Height-bar pointer only moves the working height: the selected object and its span (the blue bar)
     stay as they are. When the height lies on another storey, that storey becomes the one being designed (its floor
     tab in the top bar lights up), also while the 3D view is open. */
  function setWorkZ(h) {
    const L = levelForZ(h), keep = selSpan();
    state.pendingLevel = false;
    // the floor tabs in the top bar always follow the pointer (in the plan and in the 3D view alike)
    if (L.id !== state.level) {
      switchLevel(L.id);
      keepSpan(keep);
    }
    state.workZ = h;
    render(); refreshSelectionUI();
    if (window.FP3D && window.FP3D.focusHeight) window.FP3D.focusHeight(h); // the 3D view point jumps there too
    const c = h - floorAbs(L);
    $('#stAlign').textContent = `Working height ${fmtElev(h)} — ${c ? `${(Math.abs(c) / 100).toFixed(2)} m ${c > 0 ? 'above' : 'below'} the ${L.name} floor` : `on the ${L.name} floor`}`;
  }
  // after a level switch: the object back on this level is selected again; on another level its span stays shown
  function keepSpan(keep) {
    if (!keep || selIds().length) return;
    const it = keep.id != null && state.items.find((i) => i.id === keep.id);
    if (it && lvlOf(it) === state.level) { applySel([it.id]); state.pinSpan = null; }
    else state.pinSpan = keep;
  }
  // after the 3D view: switch to the level that holds the working height (keeping that height)
  function ensureWorkLevel(force = false) {
    if (!state.pendingLevel || state.workZ == null || (view3dOpen() && !force)) return;
    state.pendingLevel = false;
    const L = levelForZ(state.workZ);
    if (L.id === state.level) return;
    const z = state.workZ, keep = selSpan();
    switchLevel(L.id);
    state.workZ = z;
    keepSpan(keep);
    render(); refreshSelectionUI();
  }
  { const v = document.getElementById('view3d'); if (v) new MutationObserver(() => ensureWorkLevel()).observe(v, { attributes: true, attributeFilter: ['class'] }); }
  // back in the 2D plan: dragging moves objects across the plan (XY) again
  { const v = document.getElementById('view3d');
    if (v) new MutationObserver(() => { if (!v.classList.contains('open') && state.moveAxis === 'z') setMoveAxis('xy', true); }).observe(v, { attributes: true, attributeFilter: ['class'] }); }
  $('#heightBar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hb]');
    if (b) setWorkZ(+b.dataset.hb);
  });

  /* Level tabs in the top bar: one per level, lowest on the left; click to design that level */
  let levelTabsKey = '';
  function renderLevelTabs() {
    const lv = [...state.levels].sort((a, b) => a.elev - b.elev);
    const key = JSON.stringify([state.level, lv.map((l) => [l.id, l.name, l.elev, !!l.half]), state.aboveGround]);
    if (key === levelTabsKey) return;
    levelTabsKey = key;
    const G = groundLevel();
    $('#levelTabs').innerHTML = lv.map((l) => `<button data-tab-level="${l.id}" class="${l.id === state.level ? 'on' : ''}${l.half ? ' half' : ''}" title="Design ${esc(l.name)}">` +
      `${esc(l.name)}<small>${fmtElev(l.id === G.id ? l.elev + (state.aboveGround || 0) : l.elev)}</small></button>` +
      // after a full floor: add the half level above it (a split level halfway up), unless there is one
      (!l.half && !halfAbove(l) ? `<button class="lt-half" data-add-half="${l.id}" title="Add Level ${levelNo(l)}.5 — a split level halfway up from ${esc(l.name)}${lv.some((o) => !o.half && o.elev > l.elev) ? ' to the floor above' : ''}. Doors, windows and everything added on it take its floor height.">+${levelNo(l)}.5</button>` : '')).join('');
  }
  $('#levelTabs').addEventListener('click', (e) => {
    const h = e.target.closest('[data-add-half]');
    if (h) return addHalfLevel(h.dataset.addHalf);
    const b = e.target.closest('[data-tab-level]');
    if (b) switchLevel(b.dataset.tabLevel);
  });

  /* ───────────────────────── item actions ───────────────────────── */
  function del() {
    const gone = new Set(selIds());
    if (!gone.size) return;
    state.items = state.items.filter((i) => !gone.has(i.id));
    applySel([]);
    render(); refreshSelectionUI(); commit();
  }
  // duplicate the selection (or the given objects, e.g. from the clipboard); the copies become the selection
  function duplicate(srcs = sels(), offset = 20) {
    srcs = [].concat(srcs || []).filter(Boolean);
    if (!srcs.length) return [];
    // copies always land on the current level, so walls can be copied from one level and pasted on another
    // copied groups become new groups (not part of the originals)
    const regrp = new Map();
    let g = nextGrp();
    const copies = srcs.map((s) => ({ ...s, id: nextId++, x: s.x + offset, y: s.y + offset, locked: false, lvl: state.level,
      ...(s.grp ? { grp: regrp.get(s.grp) || (regrp.set(s.grp, g++), regrp.get(s.grp)) } : {}) }));
    state.items.push(...copies);
    applySel(copies.map((c) => c.id));
    render(); refreshSelectionUI(); commit();
    return copies;
  }
  function rotateBy(d) {
    if (isMulti()) return rotateGroup(d);
    const it = sel();
    if (!it || it.locked) return;
    // a balcony turns together with its door (the whole group), and stays the one selected
    it.r = normAngle(it.r + d);
    if (state.align && window.FPWalls.isOpening(it)) { autoAlign(it, true); $('#stAlign').textContent = ''; }
    render(); syncPropFields(); commit();
  }
  // turn the whole selection around its common centre, keeping the layout between the objects
  function rotateGroup(d) {
    const items = sels().filter((i) => !i.locked);
    if (!items.length) return;
    const b = bbox(items), gx = b.x + b.w / 2, gy = b.y + b.h / 2;
    const rad = (d * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
    for (const it of items) {
      const cx = it.x + it.w / 2 - gx, cy = it.y + it.h / 2 - gy;
      it.x = round(gx + cx * c - cy * s - it.w / 2, 2);
      it.y = round(gy + cx * s + cy * c - it.h / 2, 2);
      it.r = normAngle(it.r + d);
    }
    render(); buildProps(); commit();
  }
  // move the selection by (dx, dy); locked objects stay put
  function moveSelection(dx, dy) {
    for (const it of sels()) if (!it.locked) { it.x = round(it.x + dx, 2); it.y = round(it.y + dy, 2); }
  }
  function arrange(dir) {
    if (isMulti()) {
      const ids = new Set(selIds());
      const picked = state.items.filter((i) => ids.has(i.id)), rest = state.items.filter((i) => !ids.has(i.id));
      state.items = dir === 'back' || dir === 'backward' ? [...picked, ...rest] : [...rest, ...picked];
      render(); commit();
      return;
    }
    const it = sel();
    if (!it) return;
    const i = state.items.indexOf(it);
    state.items.splice(i, 1);
    if (dir === 'front') state.items.push(it);
    else if (dir === 'back') state.items.unshift(it);
    else if (dir === 'forward') state.items.splice(Math.min(state.items.length, i + 1), 0, it);
    else state.items.splice(Math.max(0, i - 1), 0, it);
    render(); commit();
  }

  /* ───────────────────────── properties panel (right) ───────────────────────── */
  const num = (k, v, step = 1, extra = '') => `<input type="number" data-k="${k}" value="${v}" step="${step}" ${extra}/>`;

  /* ───────────── wall faces ─────────────
     it.faces = { '<piece><p|n>': { wmat, wcol } } overrides the wall's material on single faces (3D view, and a coloured band along that face on the plan). */
  let faceSel = { id: null, keys: new Set() };   // faces picked in the properties diagram
  const pickedFaces = (it) => (faceSel.id === it.id ? [...faceSel.keys] : []);

  // set several faces at once; fn(current) returns the new { wmat, wcol } or null to remove the override
  function setFaces(it, keys, fn) {
    const faces = { ...(it.faces || {}) };
    for (const k of keys) {
      const v = fn(faces[k] || { wmat: it.wmat || 'plaster', wcol: it.wcol || WALLMATS.MATS[it.wmat || 'plaster'].color });
      if (v) faces[k] = v; else delete faces[k];
    }
    if (Object.keys(faces).length) it.faces = faces; else delete it.faces;
  }

  // clickable diagram of the wall's faces, drawn the way the wall sits on the plan
  function faceDiagram(it) {
    const { bodies, faces } = window.FPWalls.wallFaces(it);
    const pts = [...bodies.flat(), ...faces.flatMap((f) => [f.P, f.Q])];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys), bw = Math.max(...xs) - minX || 1, bh = Math.max(...ys) - minY || 1;
    const W = 244, H = 150, pad = 18, k = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    const ox = (W - bw * k) / 2, oy = (H - bh * k) / 2;
    const m = ([x, y]) => [ox + (x - minX) * k, oy + (y - minY) * k];
    const P = (p) => p.map((v) => v.toFixed(1)).join(',');
    const picked = new Set(pickedFaces(it));
    return `<svg class="fd" viewBox="0 0 ${W} ${H}">` +
      bodies.map((b) => `<polygon class="fd-body" points="${b.map((p) => P(m(p))).join(' ')}"/>`).join('') +
      faces.map((f) => {
        const a = m(f.P), b = m(f.Q), off = 5;
        const p1 = [a[0] + f.out[0] * off, a[1] + f.out[1] * off], p2 = [b[0] + f.out[0] * off, b[1] + f.out[1] * off];
        const ov = it.faces && it.faces[f.key];
        const col = ov ? ov.wcol || WALLMATS.MATS[ov.wmat].color : '#c3c8d0';
        const tip = `${f.label}${ov ? ` — ${WALLMATS.MATS[ov.wmat].name}` : ' — wall material'}`;
        return `<g class="fd-face${picked.has(f.key) ? ' sel' : ''}${ov ? ' set' : ''}" data-do="face" data-v="${f.key}"><title>${esc(tip)}</title>` +
          `<line class="fd-hit" x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}"/>` +
          `<line class="fd-line" x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" style="stroke:${col}"/></g>`;
      }).join('') + `</svg>`;
  }

  /* Which faces of a wall look outside the building and which inside: a point just off the middle of each face is
     tested against the outline of all the walls of its level (what they enclose plus the walls). Without a closed
     outline the walls' bounding box is used. Returns [{ ...face, outside }] (see FPWalls.wallFaces). */
  let levelOutline = { key: null, ring: null };
  function facesInOut(it) {
    const { faces } = window.FPWalls.wallFaces(it);
    const walls = state.items.filter((i) => lvlOf(i) === lvlOf(it) && window.FPWalls.isWall(i));
    const key = lvlOf(it) + JSON.stringify(walls.map((w) => [w.type, w.x, w.y, w.w, w.h, w.r, w.t, w.fx, w.fy]));
    if (key !== levelOutline.key) {
      const b = bbox(walls);
      levelOutline = { key, ring: wallOutline(walls) || [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] };
    }
    const ring = levelOutline.ring;
    return faces.map((f) => {
      const mx = (f.P[0] + f.Q[0]) / 2 + f.out[0] * 8, my = (f.P[1] + f.Q[1]) / 2 + f.out[1] * 8;
      return { ...f, outside: ring ? !pointInRings([ring], mx, my) : f.inside === false };
    });
  }
  const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));

  function facesBlock(it) {
    const { faces } = window.FPWalls.wallFaces(it);
    const enclosing = faces.some((f) => f.inside !== null);
    const nSet = Object.keys(it.faces || {}).length, nPicked = pickedFaces(it).length;
    return `<div class="faces">
        <div class="faces-head"><b>Faces</b><span>${nSet ? `${nSet} with their own material` : 'all use the wall material'}</span></div>
        ${faceDiagram(it)}
        <div class="fd-btns">
          ${enclosing ? '' : `<button data-do="faces-all">Both sides</button>`}
          <button data-do="faces-none" ${nPicked ? '' : 'disabled'}>Clear</button>
        </div>
        <p class="fd-hint">${nPicked
          ? `<b>${nPicked} face${nPicked === 1 ? '' : 's'} picked</b> — the material and colour below now apply only to ${nPicked === 1 ? 'it' : 'them'}.`
          : 'Click sides in the diagram to pick faces, then choose a material below. Or paint faces in the 3D view.'}</p>
      </div>`;
  }

  /* ───────────── stairs ───────────── */
  /* Rise of a staircase: its own (it.rise), else from where it starts (its floor + it.z, the height chosen in the Height
     bar when it was added) up to the floor of the level above. With no level above there is nothing to reach: it is
     limited to MAX_FREE_RISERS risers (and the wall height). */
  const MAX_FREE_RISERS = 20;
  const levelAbove = (L) => state.levels.filter((l) => l.elev > L.elev).sort((a, b) => a.elev - b.elev)[0] || null;
  /* Storeys. Levels less than STOREY apart are split levels of one storey, side by side (e.g. two basements 0.5 m
     apart) — not one above the other. Walls stack, slabs rest and floors are carried only between storeys: the
     storey above / below is the nearest level at least STOREY higher / lower. (Stairs still climb to the nearest
     level, so a few steps join split levels.) */
  const STOREY = 150;
  /* Half levels (Level 1.5, 2.5 … — split levels added from the floor tabs) sit halfway between the full floors, beside
     them rather than over them: full floors stack only on full floors and half levels only on half levels, so adding
     a half level never changes how the 1st and 2nd floors' walls and slabs meet. */
  const sameStack = (L) => (l) => !!l.half === !!L.half;
  const storeyAbove = (L) => state.levels.filter(sameStack(L)).filter((l) => l.elev >= L.elev + STOREY).sort((a, b) => a.elev - b.elev)[0] || null;
  const storeyBelow = (L) => state.levels.filter(sameStack(L)).filter((l) => l.elev <= L.elev - STOREY).sort((a, b) => b.elev - a.elev)[0] || null;
  // the levels of the same storey as L (L included)
  const storeyOf = (L) => state.levels.filter(sameStack(L)).filter((l) => Math.abs(l.elev - L.elev) < STOREY);
  const stairTarget = (it) => levelAbove(levelById(lvlOf(it)) || curLevel());
  /* What the Height bar means for new stairs (Settings → Stairs): 'start' — they start at that height (it.z above
     what they stand on) and climb to the level above; 'top' — they climb up to it from what they stand on. */
  const stairHeightMode = () => { try { return localStorage.getItem('floorplan2027.stairHeight') === 'top' ? 'top' : 'start'; } catch (e) { return 'start'; } };
  /* U-shaped stairs: the open well (gap) between the two flights. The flights keep their width; the staircase gets
     wider or narrower about its centre (W = 2 × flight width + gap). */
  function setStairWell(it, g) {
    const fw = it.flightW ? Math.min(it.w / 2, it.flightW) : it.w / 2, cx = it.x + it.w / 2;
    it.flightW = round(fw, 1);
    it.wellW = round(Math.min(300, Math.max(0, g)), 1);
    if (!it.wellW) delete it.wellW;
    it.w = round(2 * it.flightW + (it.wellW || 0), 1); it.x = round(cx - it.w / 2, 2);
  }
  // the floor slabs of the stairs' level under them or within 0.6 m of them, with their tops (lowest first)
  function stairSlabs(it) {
    const b = bbox([it]), m = 60;
    return state.items.filter((o) => o.type === 'slab' && lvlOf(o) === lvlOf(it)).map((o) => {
      const c = bbox([o]);
      if (c.x > b.x + b.w + m || c.x + c.w < b.x - m || c.y > b.y + b.h + m || c.y + c.h < b.y - m) return null;
      return { s: o, top: round(slabInfo(o).top, 1) };
    }).filter(Boolean).sort((p, q) => p.top - q.top);
  }
  /* Stairs meet floor slabs on their walking surface (the top), never their underside: a start that lies within the
     thickness of a slab under the stairs is lifted to its top, and a top that lies within a slab next to them goes
     up to its top. New stairs (placing = true) that would climb to the level above while a higher slab of their own
     level (a mezzanine / half level) lies next to them climb to that slab instead. Returns true when changed. */
  function snapStairToSlabs(it, placing = false) {
    if (it.rise) return false;
    const mine = state.items.filter((o) => o.type === 'slab' && lvlOf(o) === lvlOf(it));
    if (!mine.length) return false;
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    let changed = false;
    // the start: on top of the slab under the stairs' centre whose thickness holds it
    const b = stairBottom(it);
    const under = mine.filter((o) => inSlab(o, cx, cy)).map((o) => slabInfo(o)).filter((S) => b >= S.bottom - 0.5 && b < S.top - 0.5)
      .sort((p, q) => q.top - p.top)[0];
    if (under && (it.topZ == null || it.topZ - under.top >= 20)) { changed = setStairStart(it, round(under.top, 1)) || changed; }
    const start = stairBottom(it);
    const near = stairSlabs(it).filter((x) => !inSlab(x.s, cx, cy));
    if (it.topZ != null) {
      // a top within a slab's thickness: the top of that slab
      const hit = near.map((x) => ({ x, S: slabInfo(x.s) })).find(({ S }) => it.topZ >= S.bottom - 0.5 && it.topZ < S.top - 0.5);
      if (hit && hit.S.top - start >= 20) { it.topZ = round(hit.S.top, 1); changed = true; }
    } else if (placing) {
      const L = levelById(lvlOf(it)), up = L && levelAbove(L), lim = up ? floorAbs(up) - 20 : Infinity;
      const mez = near.filter((x) => x.top >= start + 20 && x.top <= lim)[0];
      if (mez) { it.topZ = round(mez.top, 1); changed = true; }
    }
    if (changed) { it.autoSteps = true; it.steps = autoSteps(it); }
    return changed;
  }
  // what the stairs stand on, without it.z — above ground ±0
  const stairGround = (it) => stairBottom(it) - (it.z || 0);
  // start the stairs at height h (above ground ±0); a top below the new start is dropped (they climb to the level above)
  function setStairStart(it, h) {
    const c = round(h - stairGround(it), 1);
    if (c < 0) return toast(`${fmtElev(h)} is below what the stairs stand on (${fmtElev(stairGround(it))}).`, 'error'), false;
    if (c >= 1) it.z = c; else delete it.z;
    if (it.topZ != null && it.topZ - stairBottom(it) < 20) delete it.topZ;
    if (it.rise == null) it.autoSteps = true;
    if (isAutoStairs(it)) it.steps = autoSteps(it);
    return true;
  }
  // where the stairs stand: the floor (or the outside ground) under their centre, plus it.z — above ground ±0
  function stairBottom(it) {
    const L = levelById(lvlOf(it)) || curLevel();
    const at = window.FPWalls.elevationModel(state.items.filter((i) => lvlOf(i) === L.id)).at(it.x + it.w / 2, it.y + it.h / 2);
    return L.elev + at + (it.z || 0);
  }
  // it.topZ: the top of the stairs (above ground ±0), set from the Height bar — they run down to whatever they stand on
  const stairRise = (it) => it.rise || (it.topZ != null ? Math.max(20, it.topZ - stairBottom(it)) : stairTarget(it) ? Math.max(20, storeyRise(it) - (it.z || 0))
    : Math.min(state.wallH || 300, MAX_FREE_RISERS * (it.targetRiser || DEFAULT_RISER)));
  /* Auto steps: the step count follows the total rise so each riser stays near the target height
     (it.targetRiser, default 17.5 cm). With "fit length", a straight staircase also gets the length for a
     comfortable going (2 × riser + going ≈ 63 cm). Stairs whose step count was typed in stay as they are. */
  const DEFAULT_RISER = 17.5;
  // a landing between two flights (L, U, or a long straight staircase with a landing half way) is one riser more
  const landingRisers = (it) => (it.type === 'stairs-l' || it.type === 'stairs-u' || (it.type === 'stairs-h' && it.midLanding && (it.steps || 10) >= 4) ? 1 : 0);
  const isAutoStairs = (it) => (it.autoSteps != null ? it.autoSteps : it.steps == null);
  const fitsLength = (it) => it.type === 'stairs-h' && (it.fitLength != null ? it.fitLength : true);
  function autoSteps(it) {
    const extra = landingRisers(it); // the landing is one riser
    // round the riser count up, so a riser is never taller than the target
    const cap = it.rise || it.topZ != null || stairTarget(it) ? 60 : MAX_FREE_RISERS - extra; // nothing to reach: at most 20 risers
    return Math.max(2, Math.min(cap, Math.ceil(stairRise(it) / (it.targetRiser || DEFAULT_RISER) - 0.02) - extra));
  }
  /* A new staircase gets steps for its rise and a size that suits them: a straight one its length (see syncStairs),
     an L or U its two flights at a comfortable going (2 × riser + going ≈ 63 cm), at least 90 cm wide each.
     Spiral stairs keep their size. Keeps the centre. */
  /* An L-shaped staircase made longer or shorter on one side (a handle, or L / W in Properties): the other side
     takes up the difference so the same steps still fit at a comfortable going — the staircase becomes a rectangle
     to suit the room. The corner landing stays where it is. side: 'w' or 'h' (the one that was changed). */
  function relengthL(it, side) {
    if (it.type !== 'stairs-l') return;
    const ST = window.FP_STAIRS, n = ST.stepsOf(it.type, it), riser = stairRise(it) / (n + 1);
    const going = Math.max(25, Math.min(32, 63 - 2 * riser)), fw = Math.min(it.flightW || 100, 200);
    const extra = it.topLanding ? (it.landingSquare ? fw : it.landingD || 120) - going : 0;
    const total = n * going + extra;                                                    // tread length both flights need
    const tf0 = window.FPWalls.toWorld(it), corner = tf0([0, 0]);                     // the corner landing (icon frame)
    if (side === 'w') it.h = round(Math.max(fw + going, fw + Math.max(going, total - Math.max(0, it.w - fw))), 1);
    else it.w = round(Math.max(fw + going + Math.max(0, extra), fw + Math.max(going + Math.max(0, extra), total - Math.max(0, it.h - fw))), 1);
    // put the corner landing back where it was
    const tf1 = window.FPWalls.toWorld(it), c1 = tf1([0, 0]);
    it.x = round(it.x + corner[0] - c1[0], 2); it.y = round(it.y + corner[1] - c1[1], 2);
  }
  function fitStairs(it) {
    if (!byId[it.type] || !byId[it.type].stairs) return it;
    it.autoSteps = true;
    it.steps = autoSteps(it);
    const n = it.steps, ST = window.FP_STAIRS, risers = ST.layout(it.type, it.w, it.h, n, it).risers;
    const riser = stairRise(it) / risers, going = Math.max(25, Math.min(32, 63 - 2 * riser));
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, n1 = Math.ceil(n / 2), n2 = n - n1;
    const fw = it.type === 'stairs-l' ? it.flightW || 100 : it.flightW || 95; // width of each flight of an L or U
    const extra = it.topLanding ? (it.landingSquare ? fw : it.landingD || 120) - going : 0; // a top landing lengthens the last flight
    if (it.type === 'stairs-h') it.w = round(it.topLanding && n > 1 ? going * (n - 1) + (it.landingSquare ? it.h : it.landingD || 120) : going * n, 1);
    else if (it.type === 'stairs-l') {
      // lower flight up the left side, then the square corner landing (fw × fw), upper flight along the top
      it.h = round(Math.max(2 * fw, fw + n1 * going), 1);
      it.w = round(Math.max(2 * fw, fw + n2 * going + extra), 1);
    } else if (it.type === 'stairs-u') {
      // two flights side by side, 95 cm wide each, an open well of it.wellW between them, and the turning landing at the far end
      it.w = 2 * fw + (it.wellW || 0);
      const run = Math.max(n1 * going, n2 * going + extra);
      // the turning landing's depth (see stairLayout): the flight width when set (at most 45 % of the length), else 45 % of the width
      const h1 = run + fw; // landing as deep as a flight is wide — unless that is more than 45 % of the length
      it.h = round(Math.max(240, it.flightW ? (0.45 * h1 >= fw ? h1 : run / 0.55) : 0.45 * it.w + run), 1);
    }
    it.x = round(cx - it.w / 2, 2); it.y = round(cy - it.h / 2, 2);
    return it;
  }

  /* Auto-fit floor slabs (it.autoFit): the slab extends to the outer edge of every wall it touches — the walls of
     its own level standing on it and the walls of the level below carrying it — and follows them as they change. */
  /* ── slab outlines traced from the walls ──
     The walls are drawn on a grid aligned with them (wall: 1 per cell, thick: the wall's thickness there), the
     area wanted is flooded, traced, straightened and snapped back onto exact points of the walls. */
  function wallGrid(walls) {
    const b = bbox(walls), size = Math.max(b.w, b.h);
    const cell = size <= 1500 ? 2.5 : size <= 3000 ? 5 : Math.ceil(size / 600);
    const R = Math.max(1, Math.round(state.fillGap / 2 / cell)), pad = (R + 2) * cell;
    const x0 = b.x - pad, y0 = b.y - pad;
    const nx = Math.ceil((b.w + 2 * pad) / cell) + 1, ny = Math.ceil((b.h + 2 * pad) / cell) + 1;
    const segs = window.FPWalls.wallSegments(walls);
    // doors and windows close their opening: a doorway left as a gap between two wall pieces is bridged across, as
    // thick as the wall it sits in, so a slab neither leaks out through it nor runs on into the next room
    const lvls = new Set(walls.map(lvlOf));
    for (const op of state.items) {
      if (!lvls.has(lvlOf(op)) || !window.FPWalls.isOpening(op)) continue;
      const ln = window.FPWalls.openingLine(op);
      if (!ln || ln.len < 1) continue;
      let t = 15, bd = 30;
      for (const sg of segs) {
        if (Math.abs(sg.u[0] * ln.u[0] + sg.u[1] * ln.u[1]) < 0.98) continue;
        const d = Math.abs((ln.mid[0] - sg.A[0]) * sg.n[0] + (ln.mid[1] - sg.A[1]) * sg.n[1]);
        if (d < bd) { bd = d; t = sg.t; }
      }
      // a door hung on a wall face sits on that face: its bridge goes back into the wall, away from where it swings
      const A = ln.ext ? [ln.P0[0] - ln.ext[0] * t / 2, ln.P0[1] - ln.ext[1] * t / 2] : ln.P0;
      segs.push({ id: op.id, A, u: ln.u, n: [-ln.u[1], ln.u[0]], len: ln.len, t, bridge: true });
    }
    const polys = segs.map((sg) => {
      const e = sg.t / 2, B = [sg.A[0] + sg.u[0] * sg.len, sg.A[1] + sg.u[1] * sg.len];
      const P = (p, k) => [p[0] + sg.n[0] * k, p[1] + sg.n[1] * k];
      return [P(sg.A, -e), P(B, -e), P(B, e), P(sg.A, e)];
    });
    const wall = new Uint8Array(nx * ny), thick = new Float32Array(nx * ny).fill(Infinity);
    polys.forEach((poly, si) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      const i0 = Math.max(0, Math.floor((minX - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((maxX - x0) / cell));
      const j0 = Math.max(0, Math.floor((minY - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((maxY - y0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (pointInRings([poly], x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell)) {
          const k = j * nx + i;
          wall[k] = 1; thick[k] = Math.min(thick[k], segs[si].t);
        }
      }
    });
    return { cell, R, x0, y0, nx, ny, wall, thick, segs, polys, closed: dilate(wall, nx, ny, R) };
  }
  // grow a region from its open cells back up to the wall faces (8-way, so corners stay square)
  function growToFaces(G, region, frontier) {
    const { nx, wall, R } = G, N8 = [-1, 1, -nx, nx, -nx - 1, -nx + 1, nx - 1, nx + 1];
    for (let step = 0; step <= R; step++) {
      const next = [];
      for (const k of frontier) for (const d of N8) {
        const n = k + d;
        if (n >= 0 && n < region.length && !region[n] && !wall[n]) { region[n] = 1; next.push(n); }
      }
      frontier = next;
    }
  }
  // traced outline of a region as an exact ring: snapped onto `primary` points first, else `secondary` points
  function ringFromRegion(G, region, primary, secondary) {
    const { cell, x0, y0, nx, ny } = G;
    const snap = ([x, y], reach = cell * 1.6) => {
      let best = null, bd = reach;
      for (const list of [primary, secondary]) {
        for (const c of list) { const d = Math.hypot(c[0] - x, c[1] - y); if (d < bd) { bd = d; best = c; } }
        if (best) break;
      }
      const q = best ? [round(best[0], 1), round(best[1], 1)] : [round(x, 1), round(y, 1)];
      q.s = !!best; // snapped onto an exact point
      return q;
    };
    // (1.5 cells: angled walls trace as steps one cell high, which this straightens)
    const rings = traceRings(region, nx, ny).map((r) => simplifyRing(r, 1.5).map(([i, j]) => [x0 + i * cell, y0 + j * cell]));
    if (!rings.length) return null;
    rings.sort((r1, r2) => Math.abs(ringArea(r2)) - Math.abs(ringArea(r1)));
    // snap, then merge points that ended up (almost) on top of each other
    const ring = [];
    for (const q of rings[0].map((v) => snap(v))) {
      const last = ring[ring.length - 1];
      if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > cell * 1.5) ring.push(q);
    }
    while (ring.length > 3 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) <= cell * 1.5) ring.pop();
    // a short edge with a loose end is grid noise at a junction: replace it by the corner where its neighbours meet
    for (let pass = 0; pass < ring.length && ring.length > 3; pass++) {
      const n = ring.length;
      const k = ring.findIndex((a, i) => { const b2 = ring[(i + 1) % n]; return (!a.s || !b2.s) && Math.hypot(b2[0] - a[0], b2[1] - a[1]) < cell * 8; });
      if (k < 0) break;
      const p0 = ring[(k + n - 1) % n], a = ring[k], b2 = ring[(k + 1) % n], p3 = ring[(k + 2) % n];
      const r = [a[0] - p0[0], a[1] - p0[1]], q2 = [p3[0] - b2[0], p3[1] - b2[1]], den = r[0] * q2[1] - r[1] * q2[0];
      let m = [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2];
      if (Math.abs(den) > 1e-6) {
        const t1 = ((b2[0] - p0[0]) * q2[1] - (b2[1] - p0[1]) * q2[0]) / den, X = [p0[0] + r[0] * t1, p0[1] + r[1] * t1];
        if (Math.hypot(X[0] - m[0], X[1] - m[1]) < cell * 20) m = X;
      }
      const merged = snap(m, cell * 3);
      ring.splice(k, 2, merged);
      if (k === n - 1) ring.shift(); // the pair wrapped round the end of the list
    }
    // drop points that lie on a straight line between their neighbours
    const clean = ring.filter((pt, i) => {
      const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
      return Math.abs((pt[0] - a[0]) * (c[1] - a[1]) - (pt[1] - a[1]) * (c[0] - a[0])) > 1 * Math.hypot(c[0] - a[0], c[1] - a[1]);
    });
    return clean.length >= 3 ? clean : null;
  }
  // points where two lines (given as [a, b] pairs) cross inside both, optionally extended by ext cm at each end
  function crossPoints(lines, ext = () => 0) {
    const out = [];
    for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
      const [a, b2] = lines[i], [c, d] = lines[j];
      const r = [b2[0] - a[0], b2[1] - a[1]], q2 = [d[0] - c[0], d[1] - c[1]], den = r[0] * q2[1] - r[1] * q2[0];
      if (Math.abs(den) < 1e-6) continue;
      const t1 = ((c[0] - a[0]) * q2[1] - (c[1] - a[1]) * q2[0]) / den, t2 = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
      const e1 = ext(i) / (Math.hypot(r[0], r[1]) || 1), e2 = ext(j) / (Math.hypot(q2[0], q2[1]) || 1);
      if (t1 > -e1 + 0.001 && t1 < 1 + e1 - 0.001 && t2 > -e2 + 0.001 && t2 < 1 + e2 - 0.001) out.push([a[0] + r[0] * t1, a[1] + r[1] * t1]);
    }
    return out;
  }

  /* Outer outline of a set of walls (world cm): everything they enclose plus the walls themselves, so L-shapes and
     angled walls come out true. null when the walls do not close a space (then the outer rectangle is used). */
  function wallOutline(walls, inner = false, seed = null) {
    if (!walls.length) return null;
    const G = wallGrid(walls), { cell, x0, y0, nx, ny, wall, closed } = G;
    // the outside: flood in from the border around the walls (small gaps closed), then back up to the wall faces
    const out = new Uint8Array(nx * ny), q = [];
    for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) { const k = j * nx + i; if (!closed[k] && !out[k]) { out[k] = 1; q.push(k); } }
    for (let j = 0; j < ny; j++) for (const i of [0, nx - 1]) { const k = j * nx + i; if (!closed[k] && !out[k]) { out[k] = 1; q.push(k); } }
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % nx;
      for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) {
        if (n >= 0 && n < out.length && !out[n] && !closed[n]) { out[n] = 1; q.push(n); }
      }
    }
    growToFaces(G, out, q.slice());
    const region = new Uint8Array(nx * ny);
    let inside = 0, walled = 0;
    for (let k = 0; k < region.length; k++) { region[k] = out[k] ? 0 : 1; inside += region[k]; walled += wall[k]; }
    if (inside < walled * 1.3) return null; // the walls enclose nothing (open layout)
    if (seed) {
      // only the wall loop round the seed point: its whole inside, on under the inner walls (they are part of it)
      const si = Math.floor((seed[0] - x0) / cell), sj = Math.floor((seed[1] - y0) / cell);
      if (si < 0 || sj < 0 || si >= nx || sj >= ny || !region[sj * nx + si]) return null; // outside every loop
      const keep = new Uint8Array(nx * ny), q = [sj * nx + si];
      keep[q[0]] = 1;
      for (let h = 0; h < q.length; h++) {
        const k = q[h], i = k % nx;
        for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) {
          if (n >= 0 && n < keep.length && region[n] && !keep[n]) { keep[n] = 1; q.push(n); }
        }
      }
      region.set(keep);
    }
    if (inner) {
      // only what lies within the outer walls: the cells of every wall piece with the outside on one side are taken
      // away (inner walls stay, the area runs on under them)
      const isOut = (x, y) => { const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell); return i < 0 || j < 0 || i >= nx || j >= ny || !!out[j * nx + i]; };
      G.segs.forEach((sg, si) => {
        const d = sg.t / 2 + cell * 1.5;
        const outer = [0.2, 0.5, 0.8].some((k) => {
          const x = sg.A[0] + sg.u[0] * sg.len * k, y = sg.A[1] + sg.u[1] * sg.len * k;
          return isOut(x + sg.n[0] * d, y + sg.n[1] * d) || isOut(x - sg.n[0] * d, y - sg.n[1] * d);
        });
        if (!outer) return;
        const poly = G.polys[si];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
        const i0 = Math.max(0, Math.floor((minX - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((maxX - x0) / cell));
        const j0 = Math.max(0, Math.floor((minY - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((maxY - y0) / cell));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          if (pointInRings([poly], x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell)) region[j * nx + i] = 0;
        }
      });
    }
    // snap onto the wall corners, else onto the points where wall faces cross (angled walls meeting)
    const faces = G.polys.flatMap((pl) => pl.map((a, i) => [a, pl[(i + 1) % pl.length]]));
    return ringFromRegion(G, region, G.polys.flat(), crossPoints(faces));
  }

  /* Outline of ONE area enclosed by walls — the room at `seed` (world point) — taken to the CENTRELINES of the walls
     round it, so neighbouring room slabs meet under the middle of the wall between them. null when the point is on
     a wall or the area is not closed. */
  function roomOutline(walls, seed, toCentre = true) {
    if (!walls.length) return null;
    const G = wallGrid(walls), { cell, x0, y0, nx, ny, wall, thick, closed } = G;
    const ci = Math.floor((seed[0] - x0) / cell), cj = Math.floor((seed[1] - y0) / cell);
    if (ci <= 0 || cj <= 0 || ci >= nx - 1 || cj >= ny - 1) return null;
    let s0 = cj * nx + ci;
    if (wall[s0]) return null;
    // a point close to a wall lands in the gap-closing margin: walk to the nearest open cell
    if (closed[s0]) {
      const seen = new Uint8Array(nx * ny), q = [s0];
      seen[s0] = 1; s0 = -1;
      for (let h = 0; h < q.length && s0 < 0; h++) {
        for (const n of [q[h] - 1, q[h] + 1, q[h] - nx, q[h] + nx]) {
          if (n < 0 || n >= seen.length || seen[n] || wall[n]) continue;
          if (!closed[n]) { s0 = n; break; }
          seen[n] = 1; q.push(n);
        }
      }
      if (s0 < 0) return null;
    }
    const region = new Uint8Array(nx * ny), q = [s0];
    region[s0] = 1;
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % nx, j = (k - i) / nx;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) return null; // leaks out: not enclosed
      for (const n of [k - 1, k + 1, k - nx, k + nx]) if (!region[n] && !closed[n]) { region[n] = 1; q.push(n); }
    }
    growToFaces(G, region, q.slice());
    if (!toCentre) {
      // up to the inner faces only: snap onto the wall corners, else where faces cross
      const faces = G.polys.flatMap((pl) => pl.map((a, i) => [a, pl[(i + 1) % pl.length]]));
      return ringFromRegion(G, region, G.polys.flat(), crossPoints(faces));
    }
    // on into the walls round it, up to their centrelines (half the wall's thickness)
    const N8 = [-1, 1, -nx, nx, -nx - 1, -nx + 1, nx - 1, nx + 1];
    let frontier = [];
    for (let k = 0; k < region.length; k++) if (region[k]) frontier.push(k);
    for (let layer = 1; frontier.length && layer < 200; layer++) {
      const next = [];
      for (const k of frontier) for (const d of N8) {
        const n = k + d;
        if (n < 0 || n >= region.length || region[n] || !wall[n]) continue;
        if ((layer - 0.5) * cell <= thick[n] / 2 + 0.01) { region[n] = 1; next.push(n); }
      }
      frontier = next;
    }
    // snap onto the points where wall centrelines meet, else onto their ends
    const axes = G.segs.map((sg) => [sg.A, [sg.A[0] + sg.u[0] * sg.len, sg.A[1] + sg.u[1] * sg.len]]);
    return ringFromRegion(G, region, crossPoints(axes, (i) => G.segs[i].t / 2 + 1), axes.flat());
  }

  /* Outer border of everything below ground (the outer faces of all basement walls, L-shapes and angled walls
     included): the 3D ground surface stops there. World cm ring, or null without basement walls. */
  /* Does this wall of a level below ground enclose the basement? Not when its foot was set (item.wz, from the Height
     bar) at ground level or above: that is a garden wall, which must not open the lawn or get a slab poured over it.
     Walls reaching deeper than the basement floor do belong to it (a lower section of a split-level basement). */
  const enclosesBasement = (w) => {
    const L = levelById(lvlOf(w));
    return !!L && L.elev < 0 && floorAbs(L) + (w.wz || 0) < 0;
  };
  function basementOutline() {
    const ids = new Set(state.levels.filter((l) => l.elev < 0).map((l) => l.id));
    const walls = state.items.filter((i) => ids.has(lvlOf(i)) && window.FPWalls.isWall(i) && enclosesBasement(i));
    if (!walls.length) return null;
    const ring = wallOutline(walls);
    if (ring) return ring;
    const b = bbox(walls);
    return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  }

  /* Where an auto-fit slab goes. it.autoFit === true: the outline of every wall it touches (the walls of its own
     level standing on it and of the level below carrying it); 'room': only the area round it.seed, to the wall
     centrelines. { x, y, w, h, poly } (poly in the slab's own cm, or null for a plain rectangle), or null. */
  function slabWalls(slab) {
    const L = levelById(lvlOf(slab)) || curLevel();
    const below = storeyBelow(L);
    return state.items.filter((i) => window.FPWalls.isWall(i) && (lvlOf(i) === L.id || (below && lvlOf(i) === below.id)));
  }
  function ringFit(ring) {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const bb = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const r = { x: round(bb.x, 1), y: round(bb.y, 1), w: round(bb.w, 1), h: round(bb.h, 1), poly: null };
    // a ring that is just its own rectangle stays a plain rectangle
    if (!(ring.length === 4 && Math.abs(Math.abs(ringArea(ring)) - bb.w * bb.h) < 1)) r.poly = ring.map(([x, y]) => [round(x - r.x, 1), round(y - r.y, 1)]);
    return r;
  }
  function slabFit(slab) {
    const walls = slabWalls(slab);
    if (slab.autoFit === 'room' || slab.autoFit === 'inner') {
      // one room: to the middle of its walls ('room') or to their inner faces ('inner')
      // the room is formed by the walls of the slab's own level (the level below only when it has none yet)
      const own = walls.filter((w) => lvlOf(w) === lvlOf(slab)), bounds = own.length ? own : walls;
      const ring = slab.seed && bounds.length && roomOutline(bounds, slab.seed, slab.autoFit === 'room');
      return ring ? ringFit(ring) : null;
    }
    if (!walls.length) return null;
    // the whole floor: everything within the outer walls of its own level (else of the level below) — only the walls
    // standing at the slab's height: a section 0.5 m deeper (walls set from the Height bar) gets a slab of its own
    const L = levelById(lvlOf(slab)) || curLevel();
    const ref = typeof slab.slabZ === 'number' ? slab.slabZ : floorAbs(L) + (slab.slabAlign === 'bottom' ? slab.slabOff || 0 : 0);
    const atLevel = (w) => Math.abs(floorAbs(L) + (w.wz || 0) - ref) <= 40;
    const ownAll = walls.filter((w) => lvlOf(w) === lvlOf(slab)), ownAt = ownAll.filter(atLevel);
    const own = ownAt.length ? ownAt : ownAll;
    // 'loop': only the wall loop round its seed (the point clicked); true: every loop of the floor
    const loop = slab.autoFit === 'loop';
    const ring = wallOutline(own.length ? own : walls, true, loop ? slab.seed : null);
    if (ring) return ringFit(ring);
    if (loop) return null;
    const bb = bbox(walls);
    return { x: round(bb.x, 1), y: round(bb.y, 1), w: round(bb.w, 1), h: round(bb.h, 1), poly: null };
  }
  // put a fit on a slab (its outline is kept in its own cm, scaled with it if it is resized later)
  function applyFit(sl, f) {
    Object.assign(sl, { x: f.x, y: f.y, w: f.w, h: f.h, r: 0, fx: false, fy: false });
    if (f.poly) Object.assign(sl, { poly: f.poly, pw0: f.w, ph0: f.h });
    else { delete sl.poly; delete sl.pw0; delete sl.ph0; }
  }
  // a slab's outline in its own cm at its current size (null = the full rectangle)
  function slabPoly(sl) {
    if (!sl.poly || !sl.poly.length) return null;
    const kx = sl.w / (sl.pw0 || sl.w), ky = sl.h / (sl.ph0 || sl.h);
    return sl.poly.map(([x, y]) => [x * kx, y * ky]);
  }
  // is world point (x, y) on a slab (inside its outline)?
  function inSlab(sl, x, y, tol = 0) {
    const rad = (sl.r * Math.PI) / 180, dx = x - (sl.x + sl.w / 2), dy = y - (sl.y + sl.h / 2);
    let lx = dx * Math.cos(rad) + dy * Math.sin(rad) + sl.w / 2, ly = -dx * Math.sin(rad) + dy * Math.cos(rad) + sl.h / 2;
    if (sl.fx) lx = sl.w - lx;
    if (sl.fy) ly = sl.h - ly;
    if (lx < -tol || ly < -tol || lx > sl.w + tol || ly > sl.h + tol) return false;
    const poly = slabPoly(sl);
    if (!poly) return true;
    if (pointInRings([poly], lx, ly)) return true;
    // within tol of its edge counts too
    return tol > 0 && poly.some((a, i) => {
      const b2 = poly[(i + 1) % poly.length], ux = b2[0] - a[0], uy = b2[1] - a[1], L2 = ux * ux + uy * uy || 1;
      const k = Math.max(0, Math.min(1, ((lx - a[0]) * ux + (ly - a[1]) * uy) / L2));
      return Math.hypot(a[0] + ux * k - lx, a[1] + uy * k - ly) <= tol;
    });
  }
  function syncSlabs() {
    let changed = false;
    for (const sl of state.items) {
      if (sl.type !== 'slab' || !sl.autoFit) continue;
      const f = slabFit(sl);
      if (!f) continue;
      if (['x', 'y', 'w', 'h'].some((k) => Math.abs(sl[k] - f[k]) > 0.05) || sl.r || sl.fx || sl.fy ||
        JSON.stringify(sl.poly || null) !== JSON.stringify(f.poly) || (f.poly && (sl.pw0 !== f.w || sl.ph0 !== f.h))) {
        applyFit(sl, f);
        changed = true;
      }
      sl.locked = true; // its size comes from the walls
    }
    // floors lying on slabs aligned with walls follow them when the walls change
    for (const sl of state.items) if (sl.type === 'slab' && sl.slabAlign && floorsFollow(sl)) changed = true;
    // manual slabs: edges close to a wall snap onto it; then the walls below meet every slab exactly
    for (const sl of state.items) if (sl.type === 'slab' && !sl.autoFit && sl.snapEdges !== false && snapSlabEdges(sl)) changed = true;
    // interior walls lining a main wall are left out of the slab / storey matching and fill that wall afterwards
    const lining = new Set(state.items.filter((i) => i.interior && interiorHost(i)));
    const controlled = new Set(lining);
    const met = matchWallsToSlabs(controlled, lining) + stackWalls(controlled) + fillInteriorWalls(lining);
    if (met) {
      changed = true;
      $('#stAlign').textContent = `⇔ ${met} wall${met === 1 ? '' : 's'} matched to the level / slab above`;
      clearTimeout(syncSlabs.t); syncSlabs.t = setTimeout(() => { $('#stAlign').textContent = ''; }, 2500);
    }
    return changed;
  }

  /* Edges of a manual (unrotated, rectangular) slab within 25 cm of a wall's face or centreline line up with it, so
     no strip is left between slab and wall and it does not stick out past it. Returns true when it moved. */
  function snapSlabEdges(sl, tol = 25) {
    if (((sl.r % 360) + 360) % 360 || sl.poly) return false;
    const xs = [], ys = [];
    for (const sg of window.FPWalls.wallSegments(slabWalls(sl))) {
      const B = [sg.A[0] + sg.u[0] * sg.len, sg.A[1] + sg.u[1] * sg.len], e = sg.t / 2;
      if (Math.abs(sg.u[1]) < 0.01) {          // runs along x: offers y lines where it overlaps the slab's x span
        if (Math.max(sg.A[0], B[0]) < sl.x - tol || Math.min(sg.A[0], B[0]) > sl.x + sl.w + tol) continue;
        ys.push(sg.A[1] - e, sg.A[1], sg.A[1] + e);
      } else if (Math.abs(sg.u[0]) < 0.01) {   // runs along y: offers x lines
        if (Math.max(sg.A[1], B[1]) < sl.y - tol || Math.min(sg.A[1], B[1]) > sl.y + sl.h + tol) continue;
        xs.push(sg.A[0] - e, sg.A[0], sg.A[0] + e);
      }
    }
    // the nearest line; on a tie the one further out (dir −1 = left/top edge, +1 = right/bottom), covering more wall
    const near = (v, list, dir) => {
      let best = v, bd = tol;
      for (const c of list) {
        const d = Math.abs(c - v);
        if (d < bd - 0.01 || (Math.abs(d - bd) <= 0.01 && (c - best) * dir > 0)) { bd = d; best = c; }
      }
      return round(best, 1);
    };
    const x0 = near(sl.x, xs, -1), x1 = near(sl.x + sl.w, xs, 1), y0 = near(sl.y, ys, -1), y1 = near(sl.y + sl.h, ys, 1);
    if (x1 - x0 < 20 || y1 - y0 < 20) return false;
    if (Math.abs(x0 - sl.x) < 0.05 && Math.abs(x1 - sl.x - sl.w) < 0.05 && Math.abs(y0 - sl.y) < 0.05 && Math.abs(y1 - sl.y - sl.h) < 0.05) return false;
    Object.assign(sl, { x: x0, y: y0, w: round(x1 - x0, 1), h: round(y1 - y0, 1) });
    return true;
  }

  /* Walls of the level below that stand under a slab reach exactly its underside — no gap, no wall running into it.
     The underside is the slab's set height (From ground), else where its top meets this level's floor
     (floor − thickness). Slabs with wallsMeet === false are left alone. Returns how many walls changed. */
  // the slab (with wallsMeet on) that a wall of the level below carries, if any
  function slabOverWall(w, ignoreFree = false) {
    if (w.freeH && !ignoreFree) return null; // its height was set by hand
    return state.items.find((sl) => sl.type === 'slab' && sl.wallsMeet !== false && !sl.slabAlign && slabInfo(sl).walls.some((u) => u.item === w && !u.edge)) || null;
  }
  function matchWallsToSlabs(controlled = new Set(), lining = new Set()) {
    let n = 0;
    for (const sl of state.items) {
      if (sl.type !== 'slab' || sl.wallsMeet === false || sl.slabAlign) continue;
      const S = slabInfo(sl);
      if (!S.below || !S.walls.length) continue;
      const U = (S.manual ? sl.slabZ : S.floor - S.t) - S.below.elev; // underside, relative to the level below
      for (const u of S.walls) {
        if (u.edge) continue; // a wall round the slab's edge carries it but runs on up past it (stackWalls)
        if (u.item.freeH) continue; // its height was set by hand (it.freeH): left as it is
        if (lining.has(u.item)) continue; // an interior wall lining a main wall: it follows that wall (fillInteriorWalls)
        controlled.add(u.item);
        const wh = u.item.wh || state.wallH, base = u.top - wh;
        const want = Math.min(1000, Math.max(20, round(U - base, 1)));
        if (Math.abs(want - wh) > 0.05) { u.item.wh = want; n++; }
      }
    }
    return n;
  }
  /* Storeys stack without overlaps: a wall of one level never reaches into the level above (its top stops at that
     level's base), and a wall that carries walls of the level above reaches up to them exactly. Walls under a floor
     slab are left to the slab (matchWallsToSlabs). Off with the plan setting stackWalls === false.
     Returns { want, carries, above } for wall w, or null when nothing applies. */
  function stackTarget(w, ctx = {}) {
    if (w.freeH && !ctx.ignoreFree) return null; // its height was set by hand (it.freeH): left as it is
    const L = levelById(lvlOf(w)) || curLevel();
    const above = storeyAbove(L);
    if (!above) return null;
    const W = window.FPWalls, mine = ctx.items || state.items.filter((i) => lvlOf(i) === L.id);
    const segs = (ctx.segs || W.wallSegments(mine)).filter((sg) => sg.id === w.id);
    if (!segs.length) return null;
    const em = ctx.em || W.elevationModel(mine);
    const base = Math.max(...segs.map((sg) => em.seg(sg))), wh = w.wh || state.wallH, limit = floorAbs(above) - L.elev; // up to the floor above
    const upSegs = ctx.upSegs || W.wallSegments(state.items.filter((i) => lvlOf(i) === above.id && W.isWall(i)));
    const carries = upSegs.length > 0 && W.axisSupport(upSegs, [w]).some((r) => r.carried > 1);
    if (!carries && base + wh <= limit + 0.05) return null; // free-standing and below the next level: as drawn
    return { want: Math.min(1000, Math.max(20, round(limit - base, 1))), carries, above };
  }
  /* An interior wall (it.interior: a 10 cm lining for wiring / insulation) standing against a main wall fills it: its
     top meets that wall's top, however the main wall got its height (by hand, from a slab or from the level above).
     Returns { host, want } — the main wall it lines (the longest stretch side by side) and the height it needs — or
     null when it lines none, or its height was set by hand. */
  function interiorHost(w, ignoreFree = false) {
    if (!w.interior || (w.freeH && !ignoreFree)) return null;
    const W = window.FPWalls, L = lvlOf(w);
    if (!W.isWall(w)) return null;
    const items = state.items.filter((i) => lvlOf(i) === L), mains = items.filter((i) => W.isWall(i) && !i.interior);
    if (!mains.length) return null;
    const mine = W.wallSegments([w]), em = W.elevationModel(items);
    let host = null, best = 10, top = -Infinity;
    for (const o of W.wallSegments(mains)) {
      const m = mains.find((i) => i.id === o.id);
      for (const s of mine) {
        const k = s.u[0] * o.u[0] + s.u[1] * o.u[1];
        if (Math.abs(k) < 0.98) continue; // not parallel
        if (Math.abs((s.A[0] - o.A[0]) * o.n[0] + (s.A[1] - o.A[1]) * o.n[1]) > (s.t + o.t) / 2 + 5) continue; // not against it
        const a = (s.A[0] - o.A[0]) * o.u[0] + (s.A[1] - o.A[1]) * o.u[1], b = a + s.len * k;
        const ov = Math.min(o.len, Math.max(a, b)) - Math.max(0, Math.min(a, b)); // how far they run side by side
        if (ov < 10) continue;
        top = Math.max(top, em.seg(o) + (m.wh || state.wallH));
        if (ov > best) { best = ov; host = m; }
      }
    }
    if (!host) return null;
    const base = Math.max(...mine.map((s) => em.seg(s)));
    return { host, want: Math.min(1000, Math.max(20, round(top - base, 1))) };
  }
  function fillInteriorWalls(lining) {
    let n = 0;
    for (const w of lining) {
      const f = interiorHost(w);
      if (f && Math.abs(f.want - (w.wh || state.wallH)) > 0.05) { w.wh = f.want; n++; }
    }
    return n;
  }
  function stackWalls(controlled) {
    if (state.stackWalls === false) return 0;
    const W = window.FPWalls;
    let n = 0;
    for (const L of state.levels) {
      const above = storeyAbove(L);
      if (!above) continue;
      const items = state.items.filter((i) => lvlOf(i) === L.id), walls = items.filter((i) => W.isWall(i) && !controlled.has(i));
      if (!walls.length) continue;
      const ctx = { items, segs: W.wallSegments(items), em: W.elevationModel(items),
        upSegs: W.wallSegments(state.items.filter((i) => lvlOf(i) === above.id && W.isWall(i))) };
      for (const w of walls) {
        const t = stackTarget(w, ctx);
        if (t && Math.abs(t.want - (w.wh || state.wallH)) > 0.05) { w.wh = t.want; n++; }
      }
    }
    return n;
  }
  function syncStairs() {
    let changed = false;
    for (const it of state.items) {
      if (!byId[it.type] || !byId[it.type].stairs || it.locked || !isAutoStairs(it)) continue;
      if (it.autoSteps == null) { it.autoSteps = true; changed = true; } // remember it, now that a step count is stored
      const n = autoSteps(it);
      if (it.steps !== n) { it.steps = n; changed = true; }
      if (fitsLength(it)) {
        const mid = it.midLanding && n >= 4 ? 1 : 0, riser = stairRise(it) / (n + mid), going = Math.max(22, Math.min(35, 63 - 2 * riser));
        const LD = it.landingSquare ? it.h : it.landingD || 120; // a square top step is as deep as the stairs are wide
        const top = it.topLanding && n > 1;
        // a top landing replaces the last tread; a landing half way is as deep as the stairs are wide (square)
        const len = round((top ? going * (n - 1) + LD : going * n) + (mid ? it.h : 0), 1);
        if (Math.abs(it.w - len) > 0.5) {
          const cx = it.x + it.w / 2; // keep the staircase centred where it is
          it.w = len; it.x = round(cx - len / 2, 2);
          changed = true;
        }
      }
    }
    return changed;
  }

  /* Default rise of a staircase: from the finished floor it stands on up to the finished floor of the level above
     (e.g. basement −280 → ground floor raised +30 = 310 cm); the wall height when there is no level above. */
  /* A floor slab belongs to the level whose floor it is (the slab between the ground floor and the first floor is
     the first floor's). It rests on the walls of the level below: its underside is that level's ceiling and its top
     should be this level's floor. On the lowest level (or with no walls below it) it is a ground slab right under
     the floor. Elevations are absolute (from the outside ground ±0). */
  function slabInfo(slab) {
    const L = levelById(lvlOf(slab)) || curLevel(), t = slab.slabT || 30;
    const above = storeyAbove(L), below = storeyBelow(L); // (split levels 0.5 m apart do not carry each other)
    const W = window.FPWalls, cx = slab.x + slab.w / 2, cy = slab.y + slab.h / 2;
    const floor = L.elev + W.elevationModel(state.items.filter((i) => lvlOf(i) === L.id)).at(cx, cy);
    const sup = below ? W.slabSupport(slab, state.items.filter((i) => lvlOf(i) === below.id)) : null;
    const walls = sup ? sup.walls : [];
    // slab.slabAlign: 'bottom' / 'top' — flush with the foot / the top of the walls it touches (see slabAlignWalls)
    const al = slab.slabAlign && slabAlignWalls(slab);
    const manual = !!al || (typeof slab.slabZ === 'number' && isFinite(slab.slabZ));
    // a floor slab sits within the walls: by default its top is the finished floor of its level
    // 'bottom' + slab.slabOff: underside that far above the wall foot — kept within the walls' height
    const room = al ? Math.max(0, al.top - al.bottom - t) : 0;
    const off = al ? Math.min(room, Math.max(0, slab.slabOff || 0)) : 0;
    const bottom = al ? (slab.slabAlign === 'top' ? al.top - t : al.bottom + off)
      : typeof slab.slabZ === 'number' && isFinite(slab.slabZ) ? slab.slabZ : floor - t;
    // walls standing under the slab (not the ones round its edge) that stop short of its underside
    const short = (sup ? sup.under : []).filter((u) => below.elev + u.top < bottom - 0.5);
    return { L, above, below, t, floor, bottom, top: bottom + t, walls, short, manual, align: al ? slab.slabAlign : null, alignWalls: al, off,
      gap: Math.round(floor - (bottom + t)) };
  }
  /* A slab being added takes the height chosen in the Height bar as its underside (above the outside ground).
     Within the height of the walls round / under it, it is held to them (a step above their foot, so it follows them);
     elsewhere it keeps that height on its own. */
  function slabAtWorkZ(sl) {
    const z = state.workZ == null || !isFinite(state.workZ) ? floorAbs(levelById(lvlOf(sl)) || curLevel()) : state.workZ;
    const AW = slabAlignWalls(sl), t = sl.slabT || 30;
    if (AW && z >= AW.bottom - 0.5 && z <= Math.max(AW.bottom, AW.top - t) + 0.5) {
      sl.slabAlign = 'bottom'; sl.slabOff = round(Math.max(0, z - AW.bottom), 1); delete sl.slabZ;
    } else { delete sl.slabAlign; sl.slabZ = round(z, 1); }
    floorsFollow(sl);
    $('#stAlign').textContent = `Slab underside at ${fmtElev(z)} (the Height bar) — top at ${fmtElev(z + t)}`;
  }

  /* The walls a slab is aligned with: those of its own level under it or along its edges, else those of the level
     below. Returns their foot and top above the outside ground (cm) and which level they are on, or null. */
  function slabAlignWalls(slab) {
    const W = window.FPWalls, L = levelById(lvlOf(slab)) || curLevel();
    const below = storeyBelow(L);
    for (const lv of [L, below]) {
      if (!lv) continue;
      const items = state.items.filter((i) => lvlOf(i) === lv.id);
      const sup = W.slabSupport(slab, items);
      if (!sup.walls.length) continue;
      // walls rise from their level's base (their foot); their top is base of the floor beside them + height
      return { level: lv, bottom: floorAbs(lv), top: lv.elev + Math.max(...sup.walls.map((u) => u.top)), n: sup.walls.length };
    }
    return null;
  }
  /* The floor slab a floor (from Fill floor) lies on: a slab item of the same level under the floor's centre.
     Floor slabs are separate items placed afterwards; a floor on one is only its finish layer. */
  function slabUnder(fl) {
    const cx = fl.x + fl.w / 2, cy = fl.y + fl.h / 2;
    return state.items.find((s) => s.type === 'slab' && lvlOf(s) === lvlOf(fl) && inSlab(s, cx, cy)) || null;
  }
  // a slab set to a height of its own carries its floors along: they take its top as their finished level
  function floorsFollow(sl) {
    const S = slabInfo(sl);
    if (!S.manual || S.align === 'top') return 0; // a slab flush with the wall tops is a ceiling: floors stay
    let n = 0;
    for (const f of state.items) {
      if (f.type !== 'floor' || f.ownElev || slabUnder(f) !== sl) continue;
      const e = round(S.top - S.L.elev, 1);
      if (f.elev !== e) { f.elev = e; n++; }
    }
    return n;
  }
  /* Floor openings that cut a slab: the ones drawn on its own level (the stairwell in that floor) whose centre lies
     over it. Each slab stands alone — nothing has to be copied to another level. */
  /* A floor opening cuts ONE floor: the slab it was made in (op.oz = that slab's top, above ground ±0, set when it is
     added — the slab nearest the Height bar), never the lower slabs under it on the same level. Older openings
     without op.oz cut the topmost slab under them. */
  const slabsUnder = (op) => state.items.filter((s) => s.type === 'slab' && lvlOf(s) === lvlOf(op) && inSlab(s, op.x + op.w / 2, op.y + op.h / 2));
  function openingZ(op) {
    if (op.oz != null) return op.oz;
    const tops = slabsUnder(op).map((s) => slabInfo(s).top);
    if (tops.length) return Math.max(...tops);
    const L = levelById(lvlOf(op)) || curLevel();
    return L.elev + window.FPWalls.elevationModel(state.items.filter((i) => lvlOf(i) === L.id)).at(op.x + op.w / 2, op.y + op.h / 2);
  }
  function slabOpenings(slab) {
    const L = lvlOf(slab), S = slabInfo(slab);
    return state.items.filter((o) => {
      if (o.type !== 'slab-opening' || lvlOf(o) !== L || !inSlab(slab, o.x + o.w / 2, o.y + o.h / 2)) return false;
      const z = openingZ(o);
      return z >= S.bottom - 1 && z <= S.top + 1;
    });
  }
  // is the opening closed off further down by another slab of its level (one lower than the slab it cuts)?
  const openingClosedBelow = (op) => { const z = openingZ(op); return slabsUnder(op).some((s) => slabInfo(s).top < z - 1); };
  // a new floor opening: it cuts the slab under it nearest the working height (Height bar)
  function openingAtWorkZ(op) {
    const sl = slabsUnder(op);
    if (!sl.length) return;
    const wz = state.workZ == null ? floorAbs(levelById(lvlOf(op)) || curLevel()) : state.workZ;
    const best = sl.map((s) => slabInfo(s)).sort((a, b) => Math.abs(a.top - wz) - Math.abs(b.top - wz))[0];
    op.oz = round(best.top, 1);
  }
  function storeyRise(it) {
    const L = levelById(lvlOf(it)) || curLevel();
    const above = state.levels.filter((l) => l.elev > L.elev).sort((a, b) => a.elev - b.elev)[0];
    if (!above) return state.wallH || 300;
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const here = window.FPWalls.elevationModel(state.items.filter((i) => lvlOf(i) === L.id)).at(cx, cy);
    const upItems = state.items.filter((i) => lvlOf(i) === above.id);
    // the floor right above the stairs, else the highest floor on that level
    let top = window.FPWalls.elevationModel(upItems).at(cx, cy);
    if (!top) top = Math.max(0, ...upItems.filter((i) => i.type === 'floor' && !i.garden).map((f) => f.elev || 0));
    if (!top) top = floorAbs(above) - above.elev; // nothing drawn there yet: the level's floor as in the Height bar
    return Math.round(above.elev + top - (L.elev + here));
  }
  // guard types for floor openings: [railType, name, what it is, little picture], and their usual colours
  const OPENING_RAILS = [
    ['steel', 'Stainless steel', 'posts and rails', '<path d="M3 5h26M3 13h26M3 20h26" stroke="#9aa3ad" stroke-width="1.6" stroke-linecap="round"/><path d="M5 5v16M16 5v16M27 5v16" stroke="#9aa3ad" stroke-width="2.2"/>'],
    ['glass', 'Glass', 'stainless arms + handrail', '<rect x="4" y="7" width="24" height="14" rx="1" fill="#a9d8f2" fill-opacity=".45" stroke="#7fb6d6"/><path d="M3 4h26" stroke="#9aa3ad" stroke-width="2.2" stroke-linecap="round"/><path d="M8 4v4M16 4v4M24 4v4" stroke="#9aa3ad" stroke-width="1.4"/>'],
    ['wire', 'Steel with wire', 'stainless posts, cables', '<path d="M3 4h26" stroke="#9aa3ad" stroke-width="2.2" stroke-linecap="round"/><path d="M5 4v17M27 4v17" stroke="#9aa3ad" stroke-width="2"/><path d="M5 8h22M5 11h22M5 14h22M5 17h22" stroke="#9aa3ad" stroke-width=".6"/>'],
    ['concrete', 'Concrete', 'solid parapet', '<rect x="3" y="5" width="26" height="16" fill="#cfcac2" stroke="#9a968f"/><path d="M2 5h28" stroke="#9a968f" stroke-width="2"/>'],
    ['wood', 'Wood', 'rail and balusters', '<path d="M3 5h26M6 5v16M12 5v16M18 5v16M24 5v16" fill="none" stroke="#a0703f" stroke-width="2.4" stroke-linecap="round"/>'],
  ];
  const OPENING_RAIL_COLOUR = { steel: '#d9dde2', glass: '#d9dde2', wire: '#d9dde2', concrete: '#cfcac2', wood: '#a0703f' };
  // handrail types for stairs: [railStyle, name, what it is, little picture]
  const RAIL_TYPES = [
    ['wood', 'Wood', 'rail and balusters', '<path d="M3 5h26M6 5v16M12 5v16M18 5v16M24 5v16" fill="none" stroke="#a0703f" stroke-width="2.4" stroke-linecap="round"/>'],
    ['metal', 'Stainless steel', 'rail and thin balusters', '<path d="M3 5h26" stroke="#9aa3ad" stroke-width="2.2" stroke-linecap="round"/><path d="M6 5v16M11 5v16M16 5v16M21 5v16M26 5v16" stroke="#9aa3ad" stroke-width="1.1"/>'],
    ['glass', 'Glass', 'panels, steel rail', '<rect x="4" y="7" width="24" height="14" rx="1" fill="#a9d8f2" fill-opacity=".45" stroke="#7fb6d6"/><path d="M3 5h26" stroke="#9aa3ad" stroke-width="2.2" stroke-linecap="round"/>'],
    ['bars', 'Steel bars', 'posts, horizontal bars', '<path d="M3 5h26" stroke="#9aa3ad" stroke-width="2.2" stroke-linecap="round"/><path d="M5 5v16M27 5v16" stroke="#9aa3ad" stroke-width="2"/><path d="M5 9h22M5 13h22M5 17h22" stroke="#9aa3ad" stroke-width="1"/>'],
  ];
  function stairsSection(it, dis) {
    const ST = window.FP_STAIRS, n = ST.stepsOf(it.type, it), lay = ST.layout(it.type, it.w, it.h, n, it);
    const rise = stairRise(it), riser = rise / lay.risers, going = lay.going, rule = 2 * riser + going;
    // rule of thumb: risers 15–19 cm and 2 × riser + going ≈ 60–66 cm feel comfortable
    // going that would make the stride comfortable, and what that means for the length of a straight stair
    const idealGoing = 63 - 2 * riser;
    const fix = rule < 58 ? ` — steps too short; a going of ≈ ${round(idealGoing)} cm needs ${it.type === 'stairs-h' ? `a length of ≈ ${Math.round(idealGoing * n)} cm` : 'a larger staircase'}`
      : ' — steps too deep; make the staircase smaller or add steps';
    const verdict = riser > 19 ? `<b style="color:#b45309">steep</b> — add steps` : riser < 14 ? `<b style="color:#b45309">very shallow</b> — remove steps`
      : rule < 58 || rule > 68 ? `<b style="color:#b45309">uneven stride</b> (2 × riser + going = ${round(rule)} cm)${fix}` : '<b style="color:#15803d">comfortable</b>';
    const landing = lay.risers > n ? ' + landing' : '';
    const auto = isAutoStairs(it), target = it.targetRiser || DEFAULT_RISER, straight = it.type === 'stairs-h';
    const L = levelById(lvlOf(it)) || curLevel(), up = stairTarget(it), z = it.z || 0, start = stairBottom(it);
    const RUNS = [['stairs-h', 'Straight'], ['stairs-l', 'L-shape, turning right'], ['stairs-l:left', 'L-shape, turning left'], ['stairs-u', 'U-shape, left side up'], ['stairs-u:right', 'U-shape, right side up'], ['stairs-spiral', 'Spiral']];
    const uRight = it.type === 'stairs-u' && !!it.fx !== !!it.fy; // mirrored U: the first flight goes up the right side
    const runNow = it.type === 'stairs-l' && it.fx ? 'stairs-l:left' : uRight ? 'stairs-u:right' : it.type;
    const UNDER = [['columns', 'Hollow — on columns, solid bottom steps'], ['solid', 'Solid — filled underneath'], ['closed', 'Closed risers — open underneath'], ['open', 'Open risers — floating treads on stringers'], ['mono', 'Open risers — treads on a central steel spine']];
    const under = it.under || 'solid', turns = it.type === 'stairs-l' || it.type === 'stairs-u';
    return `
      <section><h3>Stair run</h3>
        <div class="row"><label>Run type</label><select data-k="stairRun" ${dis}>
          ${RUNS.map(([v, n]) => `<option value="${v}" ${runNow === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        ${turns ? `<div class="btns"><button data-do="flip-v" ${dis} title="Turn the other way (left / right)">↺↻ ${it.type === 'stairs-u' ? `Go up the ${uRight ? 'left' : 'right'} side instead` : 'Turn the other way'}</button></div>` : ''}
        ${it.type === 'stairs-h' ? `<div class="row" style="margin-top:6px" title="Width of the staircase (its H on the plan)"><label>Flight width</label>
            ${num('flightW', round(it.h), 5, `min="60" max="300" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
          <div class="btns">${[80, 90, 100, 120].map((v) => `<button data-do="flight-w" data-v="${v}" class="${Math.abs(it.h - v) < 0.5 ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
          <p class="note" style="color:var(--muted)">At least 0.80 m for a staircase in a house; 0.90–1.00 m is comfortable.${it.topLanding && it.landingSquare ? ' The square top step follows the width.' : ''}</p>` : ''}
        ${it.type === 'stairs-u' ? (() => {
          // U: both flights the same width; a staircase wider than two flights leaves an open well between them
          const fwNow = it.flightW ? Math.min(it.w / 2, it.flightW) : it.w / 2, well = it.w - 2 * fwNow;
          return `<div class="row" style="margin-top:6px" title="Width of each of the two flights"><label>Flight width</label>
            ${num('flightW', round(fwNow), 5, `min="60" max="200" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
          <div class="btns">${[80, 90, 100, 120].map((v) => `<button data-do="flight-w" data-v="${v}" class="${it.flightW && Math.abs(fwNow - v) < 0.5 ? 'on' : ''}" ${dis}>${v}</button>`).join('')}
            <button data-do="stair-fit" ${dis} title="Size the staircase so its steps are comfortable at this flight width (no well)">Fit size to steps</button></div>
          <div class="row" style="margin-top:6px" title="Open well between the two flights — the staircase gets wider (W = 2 × flight width + gap), about its centre"><label>Gap between</label>
            ${num('wellW', round(Math.max(0, well)), 5, `min="0" max="300" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
          <div class="btns">${[0, 10, 20, 30, 50].map((v) => `<button data-do="well-w" data-v="${v}" class="${Math.abs(Math.max(0, well) - v) < 0.5 ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
          <p class="note" style="color:var(--muted)">${well > 1 ? `An open well of <b>${round(well)} cm</b> between the flights${(it.rail || 'none') === 'none' ? ` — consider a handrail on the ${uRight ? 'left' : 'right'} side (the inner side, round the well)` : ''}.` : 'The flights are side by side, with no gap between them.'}</p>
          ${it.flightW && it.flightW > it.w / 2 + 0.5 ? `<p class="note ground-warn">The staircase is too narrow for ${round(it.flightW)} cm flights — they are ${round(fwNow)} cm. Press "Fit size to steps".</p>` : ''}`;
        })() : ''}
        ${it.type === 'stairs-l' ? (() => {
          const fwNow = Math.min(it.w / 2, it.h / 2, it.flightW || 100);
          return `<div class="row" style="margin-top:6px" title="Width of both flights and of the corner landing (at most half the staircase)"><label>Flight width</label>
            ${num('flightW', round(fwNow), 5, `min="60" max="200" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
          <div class="btns">${[80, 90, 100, 120].map((v) => `<button data-do="flight-w" data-v="${v}" class="${Math.abs(fwNow - v) < 0.5 ? 'on' : ''}" ${dis}>${v}</button>`).join('')}
            <button data-do="stair-fit" ${dis} title="Size the staircase so its steps are comfortable at this flight width">Fit size to steps</button></div>
          ${(it.flightW || 100) > fwNow + 0.5 ? `<p class="note ground-warn">The staircase is too small for ${round(it.flightW || 100)} cm flights — they are ${round(fwNow)} cm. Press "Fit size to steps".</p>` : ''}`;
        })() : ''}
        ${it.type === 'stairs-spiral' ? (() => {
          // how far the spiral turns in all; a turn of more than one circle needs headroom over the steps below
          const T = lay.turn, perTurn = (n * 360) / T, head = riser * perTurn - 5, want = Math.max(22, Math.min(35, 63 - 2 * riser));
          const cur = it.spiralTurn || 360;
          return `<div class="row" style="margin-top:6px" title="How far the stairs turn from bottom to top"><label>Turn</label><span>${T}° · ${(T / 360).toFixed(2).replace(/\.?0+$/, '')} turn${T === 360 ? '' : 's'}</span></div>
          <div class="btns">${[[270, '¾'], [360, '1'], [450, '1¼'], [540, '1½'], [720, '2']].map(([v, t]) => `<button data-do="spiral-turn" data-v="${v}" class="${cur === v ? 'on' : ''}" ${dis} title="${v}°">${t}</button>`).join('')}
            <button data-do="spiral-fit" ${dis} title="Choose the turn that gives steps of ≈ ${round(want)} cm on the walking line">Fit to the steps</button></div>
          <p class="note" style="color:var(--muted)">Steps of <b>${round(lay.going)} cm</b> on the walking line${lay.going < want - 1 ? ` <span style="color:#b45309">(short — turn further or make the stairs larger)</span>` : ''}.
            ${T > 360 ? `Over ${(T / 360).toFixed(1)} turns each step has <b>${round(head)} cm</b> of headroom under the step above it${head < 200 ? ` — <span style="color:#b45309">too low (at least 2.00 m); turn less or add steps</span>` : ''}. The plan shows the lowest turn.` : ''}</p>`;
        })() : ''}
        ${it.type !== 'stairs-spiral' ? `<div class="row" style="margin-top:6px" title="What is under the stairs in the 3D view"><label>Underneath</label><select data-k="under" ${dis}>
          ${UNDER.map(([v, n]) => `<option value="${v}" ${under === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        ${under === 'columns' ? `<div class="row" title="How many of the lowest steps are solid down to the floor (only for a flight that starts on the floor)"><label>Solid steps</label>
          ${num('solidSteps', it.solidSteps == null ? 3 : it.solidSteps, 1, `min="0" max="10" style="flex:none;width:56px" ${dis}`)}<span class="unit">at the bottom</span></div>` : ''}
        <p class="note" style="color:var(--muted)">${under === 'columns' ? 'Hollow underneath: the steps sit on a sloping slab carried by columns (about every 1.5 m), and the landing on posts — only the lowest steps are solid. The space below stays usable.' : under === 'solid' ? 'A solid block down to the floor (a closet or wall beneath).' : under === 'closed' ? 'Each step is a solid block with its riser, on a sloping underside — the space below stays open (storage, a desk …).' : under === 'mono' ? 'Thick open treads on one steel spine down the middle of each flight, with posts under the landing — a light, modern look.' : 'Open treads on two side stringers, with posts under the landing — you can see through the stairs.'}</p>` : ''}
      </section>
${it.type === 'stairs-spiral' ? (() => {
        // spiral: the last step becomes a platform of a part of the turn
        const A = lay.topLandingAngle, want = Math.max(22, Math.min(35, 63 - 2 * riser)), g = lay.going;
        return `
      <section><h3>Landing at the top</h3>
        <div class="row" title="The last step becomes a level platform at the top, a part of the turn wide">
          <label class="check"><input type="checkbox" data-k="topLanding" ${it.topLanding ? 'checked' : ''} ${dis}/> Landing at the top</label></div>
        ${it.topLanding ? `
        <div class="row"><label>Size</label><span>${A ? `${A}° of the turn` : '—'}</span></div>
        <div class="btns">${[[60, '60°'], [90, '¼ turn'], [120, '120°'], [180, '½ turn']].map(([v, t]) => `<button data-do="landing-a" data-v="${v}" class="${(it.landingA || 90) === v ? 'on' : ''}" ${dis}>${t}</button>`).join('')}</div>
        ${A ? `<p class="note" style="color:var(--muted)">A ${A}° platform at the top (${fmtElev(stairBottom(it) + rise)}); the other ${n - 1} steps share the rest of the turn. The handrail runs on round its edge.</p>`
          : `<p class="note ground-warn">Too few steps for a landing — it needs at least three.</p>`}
        ${A && g < want - 1 ? `<p class="note ground-warn">The steps are only ${round(g)} cm deep on the walking line (≈ ${round(want)} cm is comfortable). Choose a smaller landing, or make the stairs larger (about ${round((Math.min(it.w, it.h) * want) / g / 100, 2)} m across).</p>` : ''}` : ''}
      </section>`;
      })() : ''}
${straight ? `
      <section><h3>Landing half way</h3>
        <div class="row" title="For a long straight staircase: a square landing in the middle (as deep as the stairs are wide), splitting it into two flights">
          <label class="check"><input type="checkbox" data-k="midLanding" ${it.midLanding ? 'checked' : ''} ${dis}/> Square landing half way</label></div>
        ${it.midLanding ? (lay.midLanding ? `<p class="note" style="color:var(--muted)">Two flights with a ${round(lay.midLanding / 100, 2)} × ${round(it.h / 100, 2)} m landing between them at ${fmtElev(stairBottom(it) + (Math.ceil(n / 2) + 1) * riser)}; it counts as one riser. Handrails run along its sides.</p>`
          : `<p class="note ground-warn">Too few steps for a landing half way — it needs at least four.</p>`) : ''}
      </section>` : ''}
${straight || it.type === 'stairs-l' || it.type === 'stairs-u' ? `
      <section><h3>Landing at the top</h3>
        <div class="row" title="A level platform at the top of the stairs (e.g. outside the front door); it replaces the last step">
          <label class="check"><input type="checkbox" data-k="topLanding" ${it.topLanding ? 'checked' : ''} ${dis}/> Landing at the top</label></div>
        ${it.topLanding ? `
        <div class="row" title="The top step is a square: as deep as the flight is wide (it stays square when the stairs are resized)">
          <label class="check"><input type="checkbox" data-k="landingSquare" ${it.landingSquare ? 'checked' : ''} ${dis}/> Square top step</label></div>
        ${it.landingSquare ? '' : `<div class="row" title="How deep the landing is, in the walking direction (at least 0.90 m; 1.20–1.50 m in front of a door)"><label>Depth</label>
          ${num('landingD', it.landingD || 120, 5, `min="60" max="400" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[90, 120, 150, 200].map((v) => `<button data-do="landing-d" data-v="${v}" class="${(it.landingD || 120) === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>`}
        ${(() => {
          const t = lay.treads.find((x) => x[5] === 'top');
          // the steps before it: too shallow? An L's upper flight gets half of any extra width; a U's gets the extra
          // length less what its turning landing takes (40 % of it while the landing follows the length)
          const U = it.type === 'stairs-u';
          const mid = lay.treads.findIndex((x) => x[5] === 'landing');
          const fl = lay.treads.filter((x, i) => !x[5] && (straight || i > mid)), g = fl.length ? fl[0][U ? 3 : 2] : 0;
          const want = Math.max(22, Math.min(35, 63 - 2 * riser)), short = g && g < want - 1;
          const gain = straight ? 1 : U ? (it.flightW ? (it.h * 0.45 <= Math.min(it.w / 2, it.flightW) ? 0.55 : 1) : it.h * 0.4 <= it.w * 0.45 ? 0.6 : 1) : 1;
          const more = short ? Math.ceil(((want - g) * fl.length) / gain / 5) * 5 : 0;
          return t ? `<p class="note" style="color:var(--muted)">A ${round(t[2] / 100, 2)} × ${round(t[3] / 100, 2)} m platform at the top (${fmtElev(stairBottom(it) + rise)}), the full width of the ${straight ? 'stairs' : 'upper flight'}. Put its far end against the door; handrails run along its sides.</p>` +
            (short ? `<p class="note ground-warn">The ${fl.length} step${fl.length === 1 ? '' : 's'} before the landing are only ${round(g)} cm deep (≈ ${round(want)} cm is comfortable). Make the staircase about ${more} cm ${straight ? 'longer' : U ? 'longer' : 'wider'} (${U ? 'H' : 'W'} ${round(((U ? it.h : it.w) + more) / 100, 2)} m)${straight ? ', or tick "Fit the length to the steps"' : ''}.</p>` : '')
            : `<p class="note ground-warn">Too few steps in the ${straight ? 'flight' : 'upper flight'} for a landing — it needs at least two.</p>`;
        })()}` : ''}
      </section>` : ''}
      <section><h3>Handrail</h3>
        <div class="row" title="Which side has a handrail, seen walking up the stairs"><label>Handrail</label><select data-k="rail" ${dis}>
          ${(it.type === 'stairs-spiral' ? [['none', 'None'], ['both', 'Outer edge']] : [['none', 'None'], ['left', 'Left side'], ['right', 'Right side'], ['both', 'Both sides']])
            .map(([v, n]) => `<option value="${v}" ${(it.rail || 'none') === v || (it.type === 'stairs-spiral' && v === 'both' && it.rail && it.rail !== 'none') ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <label class="rail-type-lbl">Handrail type</label>
        <div class="rail-types" role="radiogroup" aria-label="Handrail type">${RAIL_TYPES.map(([v, n, sub, ic]) => {
          const on = (it.rail || 'none') !== 'none' && (it.railStyle || 'wood') === v;
          return `<button data-do="rail-style" data-v="${v}" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" ${dis} title="${n}: ${sub}">
            <svg viewBox="0 0 32 24" aria-hidden="true">${ic}</svg><b>${n}</b><small>${sub}</small></button>`;
        }).join('')}</div>
        ${(it.rail || 'none') !== 'none' ? `
        <div class="row" title="Height of the rail above the nosing of the steps (usually 0.85–1.00 m)"><label>Height</label>
          ${num('railH', it.railH || 90, 5, `min="60" max="120" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <p class="note" style="color:var(--muted)">Seen walking up. ${it.type === 'stairs-spiral' ? 'The rail follows the outer edge of the steps.' : 'Landings get a level rail along their open outer edges.'} Shown in the 3D view.</p>` : ''}
      </section>
      <section><h3>Bottom and top</h3>
        <div class="row" title="Where the first step starts, above the outside ground ±0 — at least what the stairs stand on (${fmtElev(start - z)})"><label>Start at</label>
          ${num('stairStart', round(start), 1, `min="-1000" max="3000" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns" style="margin-bottom:7px"><button data-do="stair-start-work" class="${z && state.workZ != null && Math.abs(start - state.workZ) < 0.5 ? 'on' : ''}" ${dis} title="The first step starts at the height chosen in the Height bar">Start at working height (${fmtElev(state.workZ == null ? floorAbs(L) : state.workZ)})</button></div>
        <div class="row" title="Top of the stairs, above the outside ground ±0 — they come down to whatever they stand on"><label>Top at</label>
          ${num('topZ', round(it.topZ != null ? it.topZ : start + rise), 1, `min="-1000" max="3000" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns"><button data-do="stair-top-work" class="${it.topZ != null && state.workZ != null && Math.abs(it.topZ - state.workZ) < 0.5 ? 'on' : ''}" ${dis} title="The top is the height chosen in the Height bar">Top at working height (${fmtElev(state.workZ == null ? floorAbs(L) : state.workZ)})</button>
          ${up ? `<button data-do="stair-top-level" class="${it.topZ == null && !it.rise ? 'on' : ''}" ${dis} title="Climb to the floor of ${esc(up.name)}">Up to ${esc(up.name)}</button>` : ''}</div>
        ${it.rise ? `<p class="note" style="color:var(--muted)">From <b>${fmtElev(start)}</b> up a set rise of ${round(it.rise)} cm to <b>${fmtElev(start + it.rise)}</b>. Clear "Total rise" to use the top again.</p>`
          : it.topZ != null ? `<p class="note" style="color:var(--muted)">From <b>${fmtElev(start)}</b> (the ${start - L.elev < 1 && L.elev === 0 ? 'ground' : 'floor'} they stand on) up to <b>${fmtElev(it.topZ)}</b> — the risers are counted to fit, and recounted when the stairs are moved.</p>`
          : up ? `<p class="note" style="color:var(--muted)">From <b>${fmtElev(start)}</b> up to the floor of <b>${esc(up.name)}</b> at <b>${fmtElev(start + rise)}</b> — the risers are counted to reach it.</p>`
          : `<p class="note ground-warn">No top for these stairs and no level above ${esc(L.name)}. They are limited to ${MAX_FREE_RISERS} risers (up to ${fmtElev(start + rise)}). Set the top, add an upper floor, or type the total rise.</p>`}
        ${z ? `<p class="note" style="color:var(--muted)">The first step starts ${round(z)} cm above the floor. <button data-do="z-floor" ${dis}>Stand on the floor</button></p>` : ''}
        ${(() => {
          // floor slabs of this level under or next to the stairs (e.g. a mezzanine): start on one, or climb up to one
          const near = stairSlabs(it), topNow = start + rise;
          if (!near.length) return '';
          const btn = (doK, v, txt, on, tip) => `<button data-do="${doK}" data-v="${v}" class="${on ? 'on' : ''}" ${dis} title="${tip}">${txt}</button>`;
          const b1 = near.filter((x) => x.top >= start - z - 0.5 && x.top <= topNow - 20).map((x) => btn('stair-start-slab', x.top, `Start on slab #${x.s.id} (${fmtElev(x.top)})`, Math.abs(start - x.top) < 0.5, `The first step starts on top of floor slab #${x.s.id}`));
          const b2 = near.filter((x) => x.top >= start + 20).map((x) => btn('stair-top-slab', x.top, `Up to slab #${x.s.id} (${fmtElev(x.top)})`, it.topZ != null && Math.abs(it.topZ - x.top) < 0.5, `Climb to the top of floor slab #${x.s.id}`));
          return b1.length || b2.length ? `<div class="row" style="margin-top:8px"><label>Floor slabs</label></div><div class="btns">${b1.join('')}${b2.join('')}</div>` : '';
        })()}
      </section>
      <section><h3>Stairs</h3>
        <div class="row" title="Recalculate the number of steps whenever the total rise changes, so each riser stays near the target">
          <label class="check"><input type="checkbox" data-k="autoSteps" ${auto ? 'checked' : ''} ${dis}/> Auto steps</label></div>
        ${auto ? `
        <div class="row" title="Riser height the automatic step count aims for"><label>Target riser</label>
          ${num('targetRiser', target, 0.5, `min="12" max="22" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns" style="margin-bottom:7px">${[16, 17, 17.5, 18, 19].map((v) => `<button data-do="target-riser" data-v="${v}" class="${target === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
        ${straight ? `<div class="row" title="Also set the length of the staircase for a comfortable going (2 × riser + going ≈ 63 cm)">
          <label class="check"><input type="checkbox" data-k="fitLength" ${fitsLength(it) ? 'checked' : ''} ${dis}/> Fit the length to the steps</label></div>` : ''}` : ''}
        <div class="row" title="${auto ? 'Typing a number switches Auto steps off' : ''}"><label>Steps</label>
          <input type="range" data-k="steps" min="2" max="${up || it.rise ? 30 : MAX_FREE_RISERS}" step="1" value="${n}" ${dis}/>
          ${num('steps', n, 1, `min="2" max="${up || it.rise ? 60 : MAX_FREE_RISERS}" style="flex:none;width:56px" ${dis}`)}</div>
        <div class="row" title="Height the stairs climb, floor to floor (empty = up to the level above)"><label>Total rise</label>
          ${num('rise', rise, 5, `min="20" max="1000" style="flex:none;width:72px" ${dis}`)}<span class="unit">cm</span></div>
        <p class="note" style="color:#4b5260">${n} steps${landing} · riser <b>${round(riser)} cm</b> · going <b>${round(going)} cm</b>${straight ? ` · length <b>${round(it.w)} cm</b>` : ''} — ${verdict}
          ${auto ? `<br><span style="color:var(--muted)">Auto: the steps${straight && fitsLength(it) ? ' and length' : ''} follow the rise${it.rise ? '' : ' to the level above'}.</span>` : ''}</p>
        <div class="btns" style="margin-top:6px">
          <button data-do="flip-h" ${dis} title="Reverse the walking direction (mirror)">⇄ Reverse</button>
        </div>
      </section>`;
  }

  /* Properties for several selected objects */
  function buildMultiProps() {
    const items = sels(), b = bbox(items), locked = items.filter((i) => i.locked).length;
    $('#propTitle').textContent = 'Multiple selection';
    const counts = new Map();
    for (const i of items) { const n = byId[i.type].name; counts.set(n, (counts.get(n) || 0) + 1); }
    const summary = [...counts].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(', ');
    const A = (k, title, d) => `<button data-mdo="${k}" title="${title}"><svg viewBox="0 0 24 24" width="18" height="18">` +
      `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>`;
    props.innerHTML = `
      <div class="preview"><div class="multi-ic">${items.length}</div>
        <div><b>${items.length} objects selected</b><small>${esc(summary)}</small></div></div>
      ${floorInfoMulti(items)}
      ${groupSection(items)}

      <section><h3>Position of the group</h3>
        <div class="pair">
          <label class="field"><span>X</span><input type="number" data-m="x" value="${round(b.x)}" step="1"/><em>cm</em></label>
          <label class="field"><span>Y</span><input type="number" data-m="y" value="${round(b.y)}" step="1"/><em>cm</em></label>
        </div>
        <div class="row"><label>Group size</label><span>${round(b.w / 100, 2)} × ${round(b.h / 100, 2)} m</span></div>
        ${locked ? `<p class="note">🔒 ${locked} locked object${locked === 1 ? '' : 's'} will stay in place.</p>` : ''}
      </section>

      <section><h3>Align</h3>
        <div class="align-grid">
          ${A('left', 'Align left edges', 'M4 3v18M8 6h12v5H8zM8 13h7v5H8z')}
          ${A('hcenter', 'Align centres (horizontally)', 'M12 3v18M6 6h12v5H6zM8.5 13h7v5h-7z')}
          ${A('right', 'Align right edges', 'M20 3v18M4 6h12v5H4zM9 13h7v5H9z')}
          ${A('top', 'Align top edges', 'M3 4h18M6 8h5v12H6zM13 8h5v7h-5z')}
          ${A('vmiddle', 'Align middles (vertically)', 'M3 12h18M6 6h5v12H6zM13 8.5h5v7h-5z')}
          ${A('bottom', 'Align bottom edges', 'M3 20h18M6 4h5v12H6zM13 9h5v7h-5z')}
        </div>
        <div class="btns" style="margin-top:6px">
          <button data-mdo="dist-h" ${items.length < 3 ? 'disabled' : ''} title="Equal gaps left to right (3 or more objects)">Distribute ↔</button>
          <button data-mdo="dist-v" ${items.length < 3 ? 'disabled' : ''} title="Equal gaps top to bottom (3 or more objects)">Distribute ↕</button>
        </div>
      </section>

      <section><h3>Rotate as a group</h3>
        <div class="btns"><button data-mdo="rot" data-v="-90">⟲ 90°</button><button data-mdo="rot" data-v="-45">⟲ 45°</button><button data-mdo="rot" data-v="45">⟳ 45°</button><button data-mdo="rot" data-v="90">⟳ 90°</button></div>
        <p class="note" style="color:var(--muted)">Or drag the round handle above the group on the plan.</p>
      </section>

      <section><h3>Arrange</h3>
        <div class="btns"><button data-mdo="front">To front</button><button data-mdo="back">To back</button></div>
        <div class="btns" style="margin-top:6px"><button data-mdo="lock">Lock all</button><button data-mdo="unlock">Unlock all</button></div>
        <div class="btns" style="margin-top:6px"><button data-mdo="hide3d" title="Leave these objects out of the 3D view">Hide in 3D</button><button data-mdo="show3d">Show in 3D</button></div>
        ${levelMoveRow(state.level)}
      </section>

      <section><h3>Selected objects</h3>
        <div class="chips">${items.map((i) => `<button class="chip${i.locked ? ' locked' : ''}" data-mdo="only" data-v="${i.id}" title="Select only this one">${esc(i.label || byId[i.type].name)}</button>`).join('')}</div>
      </section>

      <section class="btns">
        <button data-mdo="dup">Duplicate</button>
        <button data-mdo="del" class="danger">Delete ${items.length}</button>
      </section>`;
  }

  // line the selected objects up against the group's edge or centre (uses each object's rotated outline)
  function alignSelection(mode) {
    const items = sels(), G = bbox(items);
    for (const it of items) {
      if (it.locked) continue;
      const b = bbox([it]);
      if (mode === 'left') it.x += G.x - b.x;
      if (mode === 'hcenter') it.x += G.x + G.w / 2 - (b.x + b.w / 2);
      if (mode === 'right') it.x += G.x + G.w - (b.x + b.w);
      if (mode === 'top') it.y += G.y - b.y;
      if (mode === 'vmiddle') it.y += G.y + G.h / 2 - (b.y + b.h / 2);
      if (mode === 'bottom') it.y += G.y + G.h - (b.y + b.h);
      it.x = round(it.x, 2); it.y = round(it.y, 2);
    }
  }
  // equal gaps between objects; the first and last stay where they are
  function distributeSelection(horizontal) {
    const list = sels().map((it) => ({ it, b: bbox([it]) }));
    if (list.length < 3) return;
    const lo = (e) => (horizontal ? e.b.x : e.b.y), size = (e) => (horizontal ? e.b.w : e.b.h);
    list.sort((a, b) => lo(a) + size(a) / 2 - (lo(b) + size(b) / 2));
    const first = list[0], last = list[list.length - 1];
    const span = lo(last) + size(last) - lo(first);
    const gap = (span - list.reduce((s, e) => s + size(e), 0)) / (list.length - 1);
    let pos = lo(first);
    for (const e of list) {
      if (!e.it.locked) {
        const d = pos - lo(e);
        if (horizontal) e.it.x = round(e.it.x + d, 2); else e.it.y = round(e.it.y + d, 2);
      }
      pos += size(e) + gap;
    }
  }
  function multiAction(k, v) {
    const items = sels();
    switch (k) {
      case 'left': case 'hcenter': case 'right': case 'top': case 'vmiddle': case 'bottom': alignSelection(k); break;
      case 'dist-h': case 'dist-v': distributeSelection(k === 'dist-h'); break;
      case 'rot': return rotateGroup(+v);
      case 'front': case 'back': return arrange(k);
      case 'lock': case 'unlock': items.forEach((i) => { i.locked = k === 'lock'; }); break;
      case 'hide3d': case 'show3d': return setHidden3D(items.map((i) => i.id), k === 'hide3d');
      case 'only': return select(+v);
      case 'group': groupSelection(); break;
      case 'ungroup': ungroupSelection(); break;
      case 'dup': return duplicate();
      case 'del': return del();
    }
    render(); buildProps(); renderOverlay(); commit();
  }
  // typing a new X/Y for the group moves all of it
  function applyMulti(el) {
    metricize(props);
    const v = parseFloat(fromM(el));
    if (!isFinite(v)) return;
    const G = bbox(sels());
    moveSelection(el.dataset.m === 'x' ? v - G.x : 0, el.dataset.m === 'y' ? v - G.y : 0);
    render(); renderOverlay();
  }

  // the panel is converted to metres as soon as it is drawn
  function buildProps() { buildPropsCm(); metricize(props); }
  function buildPropsCm() {
    if (isMulti()) return buildMultiProps();
    const it = sel();
    if (!it) return buildPlanProps();
    const ic = byId[it.type];
    $('#propTitle').textContent = 'Icon properties';
    const dis = it.locked ? 'disabled' : '';
    const isFloor = it.type === 'floor';
    // garden areas offer outdoor surfaces, indoor floors the indoor ones (keeping the current one either way)
    const matKeys = isFloor ? [...new Set([...MATERIAL_SETS[it.garden ? 'garden' : 'indoor'], it.material])].filter((k) => MATERIALS[k]) : [];
    props.innerHTML = `
      <div class="preview">${previewSVG(ic, `style="color:${it.stroke};--fill:${it.fillNone ? 'none' : it.fill}"`, isFloor ? { ...it, patId: 'pv' } : null)}
        <div><b>${esc(itemName(it))}</b><small>${esc(isFloor && it.garden ? 'Garden' : ic.cat)} · #${it.id}</small></div></div>
      ${floorInfo(it)}
${it.grp ? `
      <section><h3>Prefab group</h3>
        <div class="row"><label>Part of</label><span><b>${esc(it.grpName || 'Group')}</b> · ${groupIds(it).length} objects</span></div>
        <div class="btns"><button data-do="grp-all" title="Select the whole group again">Select whole group</button>
          <button data-do="grp-leave" ${dis} title="Take this object out of the group">Remove from group</button></div>
      </section>` : ''}
${isFloor ? `
      <section><h3>${it.garden ? 'Garden surface' : 'Floor'}</h3>
        <div class="row"><label>Material</label><select data-k="material">
          ${matKeys.map((k) => `<option value="${k}" ${k === it.material ? 'selected' : ''}>${esc(MATERIALS[k].name)}</option>`).join('')}
        </select></div>
        <div class="mat-grid">${matKeys.map((k) =>
          `<button data-do="material" data-v="${k}" class="${k === it.material ? 'on' : ''}" title="${esc(MATERIALS[k].name)}">${materialSwatch(k)}</button>`).join('')}</div>
        <div class="row"><label>Colour</label><input type="color" data-k="fill" value="${it.fill}"/>
          <div class="swatches">${(it.garden ? GARDEN_SWATCHES : FLOOR_SWATCHES).map((c) => `<button data-do="fill" data-v="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div></div>
        <div class="row"><label>Area</label><b>${round(floorArea(it), 2)} m²</b></div>
        ${(() => {
          // the slab under it is usually hidden by it on the plan: a way to reach it (to change or delete it)
          const su = slabUnder(it) || (it.garden ? gardenBase(it).slab : null);
          return su ? `<div class="btns"><button data-do="select-slab" data-v="${su.id}" title="Select the floor slab this lies on (it is covered by this on the plan)">Select its floor slab (#${su.id})</button></div>` : '';
        })()}
        ${it.garden ? (() => {
          const B = gardenBase(it);
          if (!B.rect) return `<p class="note" style="color:var(--muted)">Laid directly on solid ground.</p>`;
          const part = `${round(B.rect.w / 100, 2)} × ${round(B.rect.h / 100, 2)} m`;
          return B.slab
            ? `<p class="note" style="color:var(--muted)">Part of it (${part}) lies over the <b>${esc(B.over.name)}</b>, on the floor slab #${B.slab.id}${B.slab.slabType === 'concrete' ? ' (concrete)' : ''}; the rest is on solid ground.</p>`
            : `<p class="note ground-warn">Part of it (${part}) lies over the <b>${esc(B.over.name)}</b> with no floor slab — grass or concrete cannot be laid there until a slab is poured.</p>
              <div class="btns"><button data-do="pour-slab" title="Add a 30 cm concrete slab over the basement part">Pour a slab over the ${esc(B.over.name.toLowerCase())}</button></div>`;
        })() : ''}
      </section>
      <section><h3>${it.garden ? 'Level' : 'Floor level'}</h3>
        <div class="row" title="Finished floor level above the ground (ground = ±0). Doors start at this level in 3D."><label>Elevation</label>
          <input type="range" data-k="elev" min="-100" max="150" step="5" value="${it.elev || 0}"/>
          ${num('elev', it.elev || 0, 1, `min="-300" max="1000" style="flex:none;width:64px"`)}<span class="unit">cm</span></div>
        <div class="btns">${[[0, '±0'], [15, '+15'], [30, '+30'], [45, '+45'], [60, '+60']]
          .map(([v, t]) => `<button data-do="elev" data-v="${v}" class="${(it.elev || 0) === v ? 'on' : ''}">${t}</button>`).join('')}</div>
        <p class="note" style="color:var(--muted)">${it.elev
          ? `Finished floor at <b>${it.elev > 0 ? '+' : '−'}${(Math.abs(it.elev) / 100).toFixed(2)} m</b> above ground. ${it.garden ? 'In 3D the area is a raised block' : slabUnder(it)
            ? `It is the finish layer on the floor slab (#${slabUnder(it).id}), which carries it`
            : 'No floor slab under it yet, so in 3D it stands on a solid base — add a Floor slab (Walls &amp; Structure) to carry it'}; doors in its walls start at this level, windows and furniture sit on it, and walls rise ${Math.abs(it.elev)} cm higher so the room keeps its height.`
          : it.garden ? 'Ground level (±0). Raise it to make a terrace or raised bed.'
          : 'Ground level (±0). Raise the floor, e.g. +30 cm, for a ground floor above the outside ground.'}</p>
      </section>` : ''}

      <section><h3>Label</h3>
        <div class="row"><input type="text" data-k="label" value="${esc(it.label)}" placeholder="${esc(ic.ownLabel ? 'Auto (measured length)' : itemName(it))}" /></div>
        ${ic.ownLabel ? '' : `<div class="row"><label class="check"><input type="checkbox" data-k="showLabel" ${it.showLabel ? 'checked' : ''}/> Show label on plan</label></div>`}
      </section>

      ${(() => {
        /* Every object: Position (X, Y on the plan; Z = its bottom above the outside ground ±0), Size (L along the plan's
           X, W along its Y, H = its height) and Orientation (turned on the plan in 45° steps). */
        let z = null, top = null;
        try { z = objectBottom(it); top = objectTop(it); } catch (e) { /* not measurable */ }
        const zOk = !ic.ownLabel && z != null && isFinite(z), hOk = zOk && top != null && isFinite(top);
        const zSet = zOk && !!zTarget(it, z), hSet = hOk && !!hTarget(it, top - z);
        const ro = (ok) => (ok ? dis : 'disabled title="Set by how it is built (see below)"');
        const ang = ((Math.round(it.r || 0) % 360) + 360) % 360;
        return `<section><h3>Position</h3>
        <div class="pair trio">
          <label class="field"><span>X</span>${num('x', round(it.x), 1, dis)}<em>cm</em></label>
          <label class="field"><span>Y</span>${num('y', round(it.y), 1, dis)}<em>cm</em></label>
          <label class="field" title="Its bottom, above the outside ground ±0"><span>Z</span>${num('posZ', zOk ? round(z, 1) : '', 1, ro(zSet))}<em>cm</em></label>
        </div>
      </section>
      <section><h3>Size</h3>
        <div class="pair trio">
          <label class="field" title="Length (along X on the plan)"><span>L</span>${num('w', round(it.w), 1, `min="${MIN_SIZE}" ${dis}`)}<em>cm</em></label>
          <label class="field" title="Width (along Y on the plan)"><span>W</span>${num('h', round(it.h), 1, `min="${MIN_SIZE}" ${dis}`)}<em>cm</em></label>
          <label class="field" title="Height (bottom to top)"><span>H</span>${num('sizeH', hOk ? round(top - z, 1) : '', 1, `min="1" ${ro(hSet)}`)}<em>cm</em></label>
        </div>
        <div class="btns"><button data-do="reset-size" ${dis}>Reset size</button><button data-do="swap" ${dis}>Swap L ↔ W</button></div>
      </section>
      <section><h3>Orientation</h3>
        <div class="btns orient">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) =>
          `<button data-do="orient" data-v="${a}" class="${ang === a ? 'on' : ''}" ${dis} title="Turn it to ${a}° on the plan">${a}°</button>`).join('')}</div>
        ${ang % 45 ? `<p class="note" style="color:var(--muted)">Now turned ${ang}° — pick a 45° step.</p>` : ''}
      </section>`;
      })()}
      ${ic.thick || hasHeight(it.type) ? `<section><h3>${ic.thick ? 'Wall' : 'Column'}</h3>` : ''}
        ${ic.thick ? `<div class="row"><label>Wall thickness</label>${num('t', it.t, 1, `min="1" ${dis}`)}<span class="unit">cm</span></div>` : ''}
        ${hasHeight(it.type) ? `<div class="row" style="margin-top:4px"><label>Height presets</label></div>
          <div class="btns">${[[90, '90'], [120, '120'], [250, '250'], [300, '300'], [400, '400'], [600, '600']]
            .map(([v, t]) => `<button data-do="wh" data-v="${v}" class="${(it.wh || state.wallH) === v ? 'on' : ''}" ${dis}>${t}</button>`).join('')}</div>
          ${(() => {
            // the foot: how far above (or below) its floor it starts; set from the Height bar when it was added
            const L = levelById(lvlOf(it)) || curLevel(), f = floorAbs(L), wz = it.wz || 0, wr = workRel();
            return `<div class="row" style="margin-top:8px" title="Where it starts, above (+) or below (−) the floor of ${esc(L.name)} — or type Z under Position"><label>Foot</label></div>
            <div class="btns"><button data-do="wz-floor" class="${wz ? '' : 'on'}" ${dis}>On the floor</button>
              <button data-do="wz-work" class="${wz && Math.abs(wz - wr) < 0.5 ? 'on' : ''}" ${dis} title="Start it at the height chosen in the Height bar">At working height (${fmtElev(state.workZ == null ? f : state.workZ)})</button></div>
            <p class="note" style="color:var(--muted)">Runs from <b>${fmtElev(f + wz)}</b> to <b>${fmtElev(f + wz + (it.wh || state.wallH))}</b> above the outside ground.</p>`;
          })()}
          ${(() => {
            if (!window.FPWalls.isWall(it)) return '';
            if (it.freeH) {
              // set by hand: say what the automatic height would be, and offer it back
              const ih0 = interiorHost(it, true);
              const sl0 = !ih0 && slabOverWall(it, true), st0 = !ih0 && !sl0 && state.stackWalls !== false && stackTarget(it, { ignoreFree: true });
              const auto = ih0 ? `fill the main wall it lines (#${ih0.host.id})` : sl0 ?`meet the underside of the floor slab above (#${sl0.id})` : st0 ? `${st0.carries ? 'meet the walls of' : 'stop at the base of'} <b>${esc(st0.above.name)}</b> (${fmtElev(st0.above.elev)})` : '';
              return `<p class="note" style="color:var(--muted)">Height set by you — kept as typed${auto ? `, even where it does not ${auto}` : ''}.</p>` +
                (auto ? `<div class="btns"><button data-do="wh-auto" ${dis} title="Let the height follow the level above / the slab again">Match the level above again</button></div>` : '');
            }
            const ih = interiorHost(it);
            if (ih) return `<p class="note" style="color:var(--muted)">Interior wall: its height follows the main wall it lines (#${ih.host.id}), so it fills that wall from floor to top. Type a height (or pick one above) to set it yourself.</p>`;
            const sl = slabOverWall(it);
            if (sl) return `<p class="note" style="color:var(--muted)">Its height is set by the floor slab above (#${sl.id}), so it meets the slab's underside exactly. Type a height (or pick one above) to set it yourself.</p>`;
            const st = state.stackWalls !== false && stackTarget(it);
            return st ? `<p class="note" style="color:var(--muted)">Its height is set so it ${st.carries ? `meets the walls of <b>${esc(st.above.name)}</b> standing on it` : `stops at the base of <b>${esc(st.above.name)}</b>`}
              (${fmtElev(st.above.elev)}) — no gap or overlap between the storeys. Type a height (or pick one above) to set it yourself.</p>` : '';
          })()}` : ''}
      ${ic.thick || hasHeight(it.type) ? '</section>' : ''}
${ic.stairs ? stairsSection(it, dis) : ''}
${it.type === 'balcony' ? balconySection(it, dis) : ''}
${it.type === 'low-fence' ? `
      <section><h3>Low fence</h3>
        <div class="row"><label>Material</label><select data-k="lfMat" ${dis}>
          <option value="wood" ${(it.lfMat || 'wood') === 'wood' ? 'selected' : ''}>Wood (posts, balusters, handrail)</option>
          <option value="concrete" ${it.lfMat === 'concrete' ? 'selected' : ''}>Concrete (solid low wall)</option>
          <option value="iron" ${it.lfMat === 'iron' ? 'selected' : ''}>Wrought iron (bars and scrolls)</option></select></div>
        <div class="row" title="Height of the fence (Size H)"><label>Height</label>
          ${num('fh', it.fh || 100, 5, `min="60" max="150" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[90, 100, 110].map((v) => `<button data-do="lf-h" data-v="${v}" class="${(it.fh || 100) === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
        <div class="row"><label>Colour</label><input type="color" data-k="lfColor" value="${it.lfColor || { wood: '#a0703f', concrete: '#cfc9bf', iron: '#2f3136' }[it.lfMat || 'wood']}" ${dis}/></div>
        <p class="note" style="color:var(--muted)">For stair landings and the open edge of an upper floor (a duplex gallery). It stands at Z (Position) — set the Height bar to that floor before adding it.</p>
      </section>` : ''}
${it.type === 'slab' ? (() => {
        // the slab is this level's floor; it rests on the walls of the level below (see slabInfo)
        const S = slabInfo(it), { L, below, t } = S, dis = it.locked && !it.autoFit ? 'disabled' : '', wood = (it.slabType || 'wood') !== 'concrete';
        const short = S.short.length ? `<p class="note" style="margin-top:4px"><b>${S.short.length} wall${S.short.length === 1 ? '' : 's'}</b> of ${esc(below.name)} under the slab
          stop${S.short.length === 1 ? 's' : ''} short of it (lowest reaches ${fmtElev(below.elev + Math.min(...S.short.map((u) => u.top)))}), so ${S.short.length === 1 ? 'it does' : 'they do'} not carry it.</p>
          <div class="btns" style="margin-top:4px"><button data-do="slab-extend" ${dis} title="Raise these walls to the underside of the slab">Extend walls to the slab</button></div>` : '';
        const meet = S.walls.length && S.gap ? `<p class="note" style="margin-top:4px">The slab top is ${S.gap > 0 ? `<b>${S.gap} cm below</b>` : `<b>${-S.gap} cm above</b>`}
          the floor of ${esc(L.name)} (${fmtElev(S.floor)}).</p>
          <div class="btns" style="margin-top:4px"><button data-do="slab-meet" ${dis}
            title="Set the walls of ${esc(below.name)} under the slab so its top is the floor of ${esc(L.name)}">Fit ${esc(below.name)} walls so the slab meets the floor</button></div>` : '';
        const nEdge = S.walls.filter((u) => u.edge).length, nUnder = S.walls.length - nEdge;
        const rests = below
          ? `Floor of <b>${esc(L.name)}</b>, set within the walls: ${fmtElev(S.bottom)} to <b>${fmtElev(S.top)}</b>.` +
            (S.walls.length ? ` It bears on ${nEdge ? `${nEdge} wall${nEdge === 1 ? '' : 's'} of ${esc(below.name)} round its edge (they run on up past it)` : ''}${nEdge && nUnder ? ' and ' : ''}${nUnder ? `${nUnder} wall${nUnder === 1 ? '' : 's'} standing under it` : ''}.` : ` No walls of ${esc(below.name)} under or round it yet.`)
          : `Ground slab of <b>${esc(L.name)}</b>, within its walls, right under its floor: ${fmtElev(S.bottom)} to ${fmtElev(S.top)}.`;
        return `
      <section><h3>Floor slab</h3>
        <div class="row"><label>Structure</label><select data-k="slabType" ${dis}>
          <option value="wood" ${wood ? 'selected' : ''}>Wood frame (joists)</option>
          <option value="concrete" ${wood ? '' : 'selected'}>Concrete</option></select></div>
        <div class="row" title="Total thickness of the slab"><label>Thickness</label>
          ${num('slabT', t, 1, `min="5" max="150" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[20, 25, 30, 40].map((v) => `<button data-do="slab-t" data-v="${v}" class="${t === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
        ${(() => {
          // the walls it sits within limit how high or low it can go
          const AW = slabAlignWalls(it), lo = AW ? AW.bottom : -400, hi = AW ? Math.max(AW.bottom, AW.top - t) : 600;
          const presets = [0, 15, 30, 45].map((v) => {
            const fits = !AW || v <= hi - lo;
            return `<button data-do="slab-off" data-v="${v}" class="${S.align === 'bottom' && Math.abs(S.off - v) < 0.5 ? 'on' : ''}" ${dis || (fits ? '' : 'disabled')}
              title="${AW ? (fits ? `Underside ${v} cm above the foot of the walls` : 'Beyond the height of the walls') : 'Needs walls round or under the slab'}">${v ? '+' + v : '±0'}</button>`;
          }).join('');
          return `<div class="row" style="margin-top:8px" title="Height of the slab's underside above the outside ground (±0)${AW ? ' — within the height of its walls' : ''}. Floors lying on it move with it."><label>From ground</label>
            <input type="range" data-k="slabZ" min="${round(lo)}" max="${round(hi)}" step="5" value="${round(S.bottom)}" ${dis}/>
            ${num('slabZ', round(S.bottom), 1, `min="${round(lo)}" max="${round(hi)}" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
          <div class="btns" title="Above the foot of the walls it sits within">${presets}
            <button data-do="slab-align" data-v="top" class="${S.align === 'top' ? 'on' : ''}" ${dis} title="Top flush with the top of the walls it touches">⤒ Wall top</button></div>
          ${AW ? `<p class="note" style="color:var(--muted)">Its walls (${esc(AW.level.name)}) run from <b>${fmtElev(AW.bottom)}</b> to <b>${fmtElev(AW.top)}</b>; the slab stays within them. The steps are above the foot of the walls.</p>` : ''}`;
        })()}
        <p class="note" style="color:var(--muted)">${S.align
          ? `${S.align === 'top' ? 'Flush with the <b>top</b> of' : `<b>${S.off ? `${(S.off / 100).toFixed(2)} m above the foot` : 'On the foot'}</b> of`} ${S.alignWalls.n} wall${S.alignWalls.n === 1 ? '' : 's'} of ${esc(S.alignWalls.level.name)}: ${fmtElev(S.bottom)} to ${fmtElev(S.top)}. It follows the walls when they change${S.align === 'top' ? '' : '; floors lying on it move with it'}.`
          : S.manual ? `Set by hand: underside <b>${fmtElev(S.bottom)}</b>, top at <b>${fmtElev(S.top)}</b>. Floors lying on it follow.`
          : `${S.walls.length ? 'Resting on the walls below' : 'Right under the floor'} — underside ${fmtElev(S.bottom)}. Pick a height, or align it with the bottom or top of its walls.`}</p>
        ${wood ? `<div class="row" style="margin-top:6px"><label class="check"><input type="checkbox" data-k="ceiling" ${it.ceiling !== false ? 'checked' : ''} ${dis}/> Ceiling board underneath</label></div>
        <p class="note" style="color:var(--muted)">Joists 5 cm every 40 cm across the short side, rim joists, 2.5 cm subfloor${it.ceiling !== false ? ', 1.5 cm gypsum ceiling' : ''}; openings are framed with trimmers.</p>` : ''}
        <div class="row" style="margin-top:8px" title="Which area the slab covers"><label>Area</label><select data-k="autoFit">
          <option value="fixed" ${!it.autoFit ? 'selected' : ''}>Manual — move and size it yourself</option>
          <option value="inner" ${it.autoFit === 'inner' ? 'selected' : ''}>Fit the room's inner wall lines (follows them)</option>
          <option value="room" ${it.autoFit === 'room' ? 'selected' : ''}>Fit the room to the middle of its walls (follows them)</option>
          <option value="loop" ${it.autoFit === 'loop' ? 'selected' : ''}>Fill the area within its outer walls (follows them)</option>
          <option value="all" ${it.autoFit === true ? 'selected' : ''}>Fit the whole floor, within the outer walls</option></select></div>
        ${it.autoFit === 'loop' ? `<p class="note" style="color:var(--muted)">Fills the whole area enclosed by the outer walls round it, whatever its shape — on under the inner walls, doorways and windows counted as closed — to the inner faces of the outer walls. It follows them as they change; position and size are locked.</p>`
          : it.autoFit === true ?`<p class="note" style="color:var(--muted)">Fills everything within the outer walls (to their inner faces; inner walls stand on it) and follows them as they change; position and size are locked.</p>`
          : it.autoFit === 'inner' ? `<p class="note" style="color:var(--muted)">Fills the room it was placed in, up to the inner faces of its walls, and follows them as they change; position and size are locked.</p>`
          : it.autoFit === 'room' ? `<p class="note" style="color:var(--muted)">Covers the room under it, to the middle of the walls round it, and follows them as they change; position and size are locked.</p>`
          : `<p class="note" style="color:var(--muted)">Drag the slab to move it and its handles to size it, or type X / Y / W / H above.</p>`}
        <div class="row" style="margin-top:8px" title="Walls of ${below ? esc(below.name) : 'the level below'} under the slab are set to reach its underside exactly">
          <label class="check"><input type="checkbox" data-k="wallsMeet" ${it.wallsMeet !== false ? 'checked' : ''} ${dis}/> Walls below meet the slab (no gaps or overlaps)</label></div>
        ${!it.autoFit ? `<div class="row" title="Edges within 25 cm of a wall's face or centreline line up with it">
          <label class="check"><input type="checkbox" data-k="snapEdges" ${it.snapEdges !== false ? 'checked' : ''} ${dis}/> Snap edges to walls</label></div>` : ''}
        <p class="note" style="color:var(--muted)">${rests}
          ${(() => { const n = slabOpenings(it).length;
            return n ? `<b>${n} floor opening${n === 1 ? '' : 's'}</b> on ${esc(L.name)} cut${n === 1 ? 's' : ''} through it.`
              : `To open a stairwell, draw a floor opening over it on ${esc(L.name)}.`; })()}</p>${short}${meet}
      </section>`;
      })() : ''}
${isObject(it) ? `
      <section><h3>Height</h3>
        <div class="row" title="How high above the floor it stands (0 = on the floor), e.g. wall cabinets, shelves, lamps"><label>Above floor</label>
          ${num('z', it.z || 0, 5, `min="0" max="2000" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns"><button data-do="z-work" ${dis} title="Put it at the working height chosen in the height bar">At working height (${fmtElev(state.workZ == null ? floorAbs(curLevel()) : state.workZ)})</button>
          ${it.z ? `<button data-do="z-floor" ${dis}>On the floor</button>` : ''}</div>
      </section>` : ''}
${ic.roof ? (() => {
        const st = ic.roof, pitch = roofPitch(it), ov = it.overhang == null ? 40 : it.overhang, eaves = roofBase(it);
        const rise = window.FP_ROOFS.rise(st, it.w, it.h, pitch);
        return `
      <section><h3>Roof</h3>
        <div class="row"><label>Style</label><select data-k="roofStyle" ${dis}>
          ${[...window.FP_ROOFS.styles.slice(0, 1), ['flat-fence', 'Flat roof with fence'], ...window.FP_ROOFS.styles.slice(1), ['hip-l', 'L-shaped hip roof (right)'], ['hip-l-left', 'L-shaped hip roof (left)']].map(([v, t]) => { const on = it.type === 'roof-' + v;
            return `<option value="${v}" ${on ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select></div>
        ${st === 'hip-l' ? (() => {
          const Ls = window.FP_ROOFS.lShape(it.w, it.h, it), c = Ls.corner;
          return `<div class="row" style="margin-top:6px" title="Which corner of the rectangle is left out"><label>Corner left out</label>
          <div class="btns" style="margin:0">${[['tl', '◰ Top left'], ['tr', '◳ Top right'], ['bl', '◱ Bottom left'], ['br', '◲ Bottom right']]
            .map(([v, t]) => `<button data-do="l-corner" data-v="${v}" class="${c === v ? 'on' : ''}" ${dis}>${t}</button>`).join('')}</div></div>
        <div class="row" title="Width of the part left out (along W)"><label>Cut width</label>
          <input type="range" data-k="lCutW" min="30" max="${Math.max(30, it.w - 60)}" step="5" value="${round(Ls.cw)}" ${dis}/>
          ${num('lCutW', round(Ls.cw), 5, `min="30" max="${Math.max(30, it.w - 60)}" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="row" title="Depth of the part left out (along H)"><label>Cut depth</label>
          <input type="range" data-k="lCutD" min="30" max="${Math.max(30, it.h - 60)}" step="5" value="${round(Ls.cd)}" ${dis}/>
          ${num('lCutD', round(Ls.cd), 5, `min="30" max="${Math.max(30, it.h - 60)}" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <p class="note" style="color:var(--muted)">Or drag the orange diamond at the inner corner on the plan.</p>`;
        })() : ''}
        ${ic.roofFence ? (() => { const fh = it.roofFence == null ? 50 : it.roofFence, fs = it.fenceStyle || 'rail';
          return `<div class="row" style="margin-top:6px" title="Height of the fence round the roof edge, from the roof surface to its top rail"><label>Fence height</label>
          ${num('roofFence', fh, 5, `min="20" max="200" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[50, 90, 100, 110, 120].map((v) => `<button data-do="roof-fence" data-v="${v}" class="${fh === v ? 'on' : ''}" ${dis}>${(v / 100).toFixed(2)}</button>`).join('')}</div>
        <div class="row" style="margin-top:6px"><label>Fence</label><select data-k="fenceStyle" ${dis}>
          <option value="rail" ${fs === 'rail' ? 'selected' : ''}>Metal railing (bars)</option>
          <option value="glass" ${fs === 'glass' ? 'selected' : ''}>Glass panels</option>
          <option value="solid" ${fs === 'solid' ? 'selected' : ''}>Solid parapet wall</option></select></div>`; })() : ''}
        ${st === 'flat' ? '' : `<div class="row" title="Slope of the roof planes"><label>Pitch</label>
          <input type="range" data-k="pitch" min="5" max="60" step="1" value="${pitch}" ${dis}/>${num('pitch', pitch, 1, `min="1" max="75" style="flex:none;width:52px" ${dis}`)}<span class="unit">°</span></div>
        <div class="btns">${[10, 20, 30, 40, 45].map((v) => `<button data-do="roof-pitch" data-v="${v}" class="${pitch === v ? 'on' : ''}" ${dis}>${v}°</button>`).join('')}</div>`}
        <div class="row" style="margin-top:6px" title="How far the eaves run out past the walls"><label>Overhang</label>
          ${num('overhang', ov, 5, `min="0" max="200" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[0, 20, 40, 60, 80].map((v) => `<button data-do="roof-ov" data-v="${v}" class="${ov === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
        <div class="row" style="margin-top:6px"><label>Covering</label><b>${esc(WALLMATS.ROOF_MATS[roofMatOf(it)].name)}</b></div>
        <div class="mat-grid">${Object.entries(WALLMATS.ROOF_MATS).map(([k, m]) =>
          `<button data-do="roof-mat" data-v="${k}" class="${k === roofMatOf(it) ? 'on' : ''}" title="${esc(m.name)}" ${dis}><img src="${WALLMATS.roofSwatch(k)}" alt=""/><span>${esc(m.name)}</span></button>`).join('')}</div>
        <div class="row"><label>Colour</label><input type="color" data-k="fill" value="${it.fill}" ${dis}/><div class="swatches">${[['#b5532f', 'Terracotta'], ['#8a3b26', 'Dark red'], ['#6b4f3a', 'Brown'], ['#4b5563', 'Slate grey'], ['#2f3640', 'Anthracite'], ['#3f6b4c', 'Green'], ['#9aa3ab', 'Silver'], ['#d6d3cc', 'Light']]
          .map(([c, t]) => `<button data-do="fill" data-v="${c}" style="background:${c}" title="${t}" ${dis}></button>`).join('')}</div></div>
        <div class="row" style="margin-top:6px" title="Height of the eaves (the bottom edge of the roof), above the outside ground ±0"><label>Eaves at</label>
          ${num('roofZ', round(eaves), 5, `min="-1000" max="5000" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns"><button data-do="roof-work" class="${it.roofZ != null && state.workZ != null && Math.abs(it.roofZ - state.workZ) < 0.5 ? 'on' : ''}" ${dis} title="Put the eaves at the height chosen in the Height bar">At working height (${fmtElev(state.workZ == null ? floorAbs(curLevel()) : state.workZ)})</button>
          <button data-do="roof-walls" class="${it.roofZ == null ? 'on' : ''}" ${dis} title="Put the eaves on top of the walls under the roof (and follow them)">On the walls</button></div>
        <div class="row" style="margin-top:6px" title="Thickness of the roof (rafters and covering), 0.10 to 0.20 m"><label>Thickness</label>
          <input type="range" data-k="roofT" min="10" max="20" step="1" value="${it.roofT || 15}" ${dis}/>
          ${num('roofT', it.roofT || 15, 1, `min="10" max="20" style="flex:none;width:56px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[10, 12, 15, 18, 20].map((v) => `<button data-do="roof-t" data-v="${v}" class="${(it.roofT || 15) === v ? 'on' : ''}" ${dis}>${(v / 100).toFixed(2)}</button>`).join('')}</div>
        <div class="row" style="margin-top:6px" title="Gutters under the eaves, with downpipes to the ground"><label>Gutter</label><select data-k="gutter" ${dis}>
          <option value="1" ${it.gutter ? 'selected' : ''}>With gutter</option>
          <option value="" ${it.gutter ? '' : 'selected'}>No gutter</option></select></div>
        ${it.gutter ? `<div class="row"><label>Gutter colour</label><input type="color" data-k="gutterColor" value="${it.gutterColor || '#ecebe7'}" ${dis}/>
          <div class="swatches">${[['#ecebe7', 'White'], ['#8a8f96', 'Grey'], ['#2f3236', 'Anthracite'], ['#6b4a2f', 'Brown'], ['#b8743f', 'Copper'], ['#c7ccd2', 'Zinc']]
            .map(([c, t]) => `<button data-do="gutter-col" data-v="${c}" style="background:${c}" title="${t}" ${dis}></button>`).join('')}</div></div>
          <p class="note" style="color:var(--muted)">${st === 'butterfly' ? 'A box gutter runs along the valley, with downpipes at its ends.' : 'A gutter under every eave, with a downpipe down to the ground at each end.'}</p>` : ''}
        <p class="note" style="color:var(--muted)">Eaves ${it.roofZ != null ? 'set' : 'on the top of the walls'} at <b>${fmtElev(eaves)}</b>${st === 'flat' ? '' : `, ${st === 'butterfly' ? 'outer edges' : 'ridge'} at <b>${fmtElev(eaves + rise)}</b>`}.
          The ridge runs along the width — rotate it or use “Swap W ↔ H” for the other direction. Size it to the outer walls; the overhang is added round it.<br>For a roof over an L-shaped house, use the <b>L-shaped hip roof</b> (Roofs icons) and choose which corner is left out.</p>
      </section>`;
      })() : ''}
${it.type === 'sewage-pit' ? (() => {
        const dep = it.pitDepth || 120, t = it.pitT || 15, bt = it.pitBase || 15, cover = it.pitCover || 'grate';
        const L = levelById(lvlOf(it)) || curLevel(), f = floorAbs(L);
        const iw = Math.max(0, it.w - 2 * t), id = Math.max(0, it.h - 2 * t);
        return `
      <section><h3>Sewage hole</h3>
        <div class="row" title="Clear inside size of the pit (the outline less its walls)"><label>Inside</label><span>${(iw / 100).toFixed(2)} × ${(id / 100).toFixed(2)} m · ${((iw * id * dep) / 1e6).toFixed(2)} m³</span></div>
        <div class="row" title="How deep the pit goes below the floor it is set in"><label>Depth</label>
          ${num('pitDepth', dep, 10, `min="30" max="500" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[80, 100, 120, 150, 200].map((v) => `<button data-do="pit-depth" data-v="${v}" class="${dep === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
        <div class="row" style="margin-top:6px" title="Thickness of the concrete walls"><label>Walls</label>
          ${num('pitT', t, 1, `min="8" max="40" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="row" title="Thickness of the concrete base slab under the pit"><label>Base slab</label>
          ${num('pitBase', bt, 1, `min="8" max="40" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="row"><label>Cover</label><select data-k="pitCover" ${dis}>
          ${[['grate', 'Steel grating'], ['plate', 'Checker plate'], ['open', 'Open']].map(([v, n]) => `<option value="${v}" ${cover === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <p class="note" style="color:var(--muted)">Sunk into the floor of ${esc(L.name)}: the bottom is at <b>${fmtElev(f - dep)}</b>, under a ${bt} cm concrete base slab (${fmtElev(f - dep - bt)}).
          The pump stands at the left end; its discharge pipe leaves through the right wall (the arrow) towards the street sewer — rotate it to point the pipe. Floors and slabs over it are opened.</p>
      </section>`;
      })() : ''}
${it.type === 'pool' ? (() => {
        const dep = it.poolDepth || 150;
        return `
      <section><h3>Swimming pool</h3>
        <div class="row"><label>Water</label><span>${(it.w / 100).toFixed(2)} × ${(it.h / 100).toFixed(2)} m · ${((it.w * it.h * (dep - 12)) / 1e6).toFixed(1)} m³</span></div>
        <div class="row" title="Depth of the basin below the coping"><label>Depth</label>
          ${num('poolDepth', dep, 10, `min="60" max="400" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[120, 150, 180, 220].map((v) => `<button data-do="pool-depth" data-v="${v}" class="${dep === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
        <div class="row" style="margin-top:6px"><label class="check"><input type="checkbox" data-k="poolSteps" ${it.poolSteps !== false ? 'checked' : ''} ${dis}/> Entry steps (left end)</label></div>
        <div class="row"><label class="check"><input type="checkbox" data-k="poolLadder" ${it.poolLadder !== false ? 'checked' : ''} ${dis}/> Ladder (right end)</label></div>
        <div class="row"><label>Water colour</label><div class="swatches">${[['#7cc6e8', 'Pool blue'], ['#5fb3c9', 'Turquoise'], ['#3d8fb8', 'Deep blue'], ['#8fd3c4', 'Lagoon'], ['#6a8f9e', 'Natural']]
          .map(([c, t]) => `<button data-do="fill" data-v="${c}" style="background:${c}" title="${t}" ${dis}></button>`).join('')}</div></div>
        <div class="row" style="margin-top:6px" title="Height of the rim (coping) above the ground under it — 0 = sunk into the ground; higher = a raised pool, e.g. on a terrace"><label>Rim above ground</label>
          ${num('z', round(it.z || 0), 5, `min="-500" max="2000" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns"><button data-do="pool-rim" data-v="ground" class="${!it.z ? 'on' : ''}" ${dis}>In the ground</button>
          <button data-do="pool-rim" data-v="work" ${dis} title="The rim at the height chosen in the Height bar">At working height (${fmtElev(state.workZ == null ? 0 : state.workZ)})</button></div>
        <p class="note" style="color:var(--muted)">Rim at ${fmtElev(floorUnder(it) + (it.z || 0))}. ${(it.z || 0) >= dep ? 'Raised: the basin stands on the ground in a solid surround.' : 'Sunk into the ground'} with tiled walls, water 12 cm below the 30 cm stone coping. The lawn or ground over it is opened, and Fill garden goes round it. Rotate it to turn the steps and ladder.</p>
      </section>`;
      })() : ''}
${it.type === 'gravel-path' ? (() => {
        const lim = it.stepGrade == null ? 10 : it.stepGrade;
        return `
      <section><h3>Gravel path</h3>
        <div class="row" title="Length along the path and its width"><label>Size</label><span>${(it.w / 100).toFixed(2)} m long · ${(it.h / 100).toFixed(2)} m wide</span></div>
        <div class="btns">${[90, 120, 150, 200].map((v) => `<button data-do="path-w" data-v="${v}" class="${Math.round(it.h) === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
        <div class="row" style="margin-top:6px" title="Where the ground along the path is steeper than this, it is laid as steps"><label>Steps from</label>
          ${num('stepGrade', lim, 1, `min="3" max="60" style="flex:none;width:52px" ${dis}`)}<span class="unit">% grade</span></div>
        <div class="btns">${[6, 8, 10, 15].map((v) => `<button data-do="path-grade" data-v="${v}" class="${lim === v ? 'on' : ''}" ${dis}>${v} %</button>`).join('')}</div>
        <p class="note" style="color:var(--muted)">Laid at ground level along its length (rotate it to point it). In 3D it follows the ground; where a hill or slope makes it steeper than ${lim} %, that stretch becomes stone steps of about 15 cm each.</p>
      </section>`;
      })() : ''}
${it.type === 'slope' ? (() => {
        const H = it.slopeH == null ? 100 : it.slopeH, m = it.blend == null ? 200 : it.blend, fl = houseAboveGround();
        const fall = Math.abs(H) / Math.max(1, it.h) * 100;
        return `
      <section><h3>Slope</h3>
        <div class="row" title="Height of the high edge (the bold top edge) above the outside ground (±0); negative slopes down into the ground"><label>High edge</label>
          <input type="range" data-k="slopeH" min="-300" max="500" step="5" value="${H}" ${dis}/>
          ${num('slopeH', H, 5, `min="-1000" max="2000" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[-50, 50, 100, 150].map((v) => `<button data-do="slope-h" data-v="${v}" class="${H === v ? 'on' : ''}" ${dis}>${v > 0 ? '+' + v : '−' + Math.abs(v)}</button>`).join('')}
          ${fl ? `<button data-do="slope-h" data-v="${fl}" data-metric="1" class="${H === fl ? 'on' : ''}" ${dis} title="The ground floor's level — a ramp up to the house">Floor (${fmtElev(fl)})</button>` : ''}</div>
        <div class="row" style="margin-top:6px" title="How wide the two sides blend into the ground around"><label>Side blend</label>
          ${num('blend', m, 10, `min="0" max="1500" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[50, 100, 200, 300].map((v) => `<button data-do="slope-blend" data-v="${v}" class="${m === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
        <p class="note" style="color:var(--muted)">The bold edge is the high edge at <b>${fmtElev(H)}</b>; the surface runs down evenly over ${(it.h / 100).toFixed(2)} m
          (${fall.toFixed(1)} % fall) to the opposite edge, where it meets the ground there. The two sides blend smoothly into the ground around
          — up or down — over ${(m / 100).toFixed(2)} m. Where an edge meets a wall it stops at the wall: the ground beyond keeps its height.
          Rotate it to turn the high edge (use Flip V to swap it with the low edge).</p>
      </section>`;
      })() : ''}
${it.type === 'hill' ? (() => {
        const H = it.hillH == null ? 300 : it.hillH;
        return `
      <section><h3>Hill / slope</h3>
        <div class="row" title="Height at the middle of the ellipse; negative = a hollow"><label>Height</label>
          <input type="range" data-k="hillH" min="-500" max="1500" step="10" value="${H}" ${dis}/>
          ${num('hillH', H, 10, `min="-1000" max="3000" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[-100, 100, 200, 300, 500, 800].map((v) => `<button data-do="hill-h" data-v="${v}" class="${H === v ? 'on' : ''}" ${dis}>${v > 0 ? '+' : '−'}${Math.abs(v)}</button>`).join('')}</div>
        <div class="row"><label>Shape</label><select data-k="hillShape" ${dis}>
          ${[['round', 'Rounded hill'], ['plateau', 'Plateau (flat top)'], ['peak', 'Peak'], ['ramp', 'Even slope']].map(([v, t]) => `<option value="${v}" ${(it.hillShape || 'round') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
        <div class="row"><label>Colouring</label><select data-k="hillColor" ${dis}>
          ${[['natural', 'Natural (lighter towards the top)'], ['earth', 'Earth (grass → soil → stone)'], ['none', 'Plain (shading only)']].map(([v, t]) => `<option value="${v}" ${(it.hillColor || 'natural') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
        <p class="note" style="color:var(--muted)">In 3D the ground rises smoothly from the edge of the ellipse to <b>${H >= 0 ? '+' : '−'}${(Math.abs(H) / 100).toFixed(2)} m</b> in its middle and blends into the ground around it.
          Hills that overlap add up; a negative height makes a hollow. Size and rotate the ellipse like any object — it can cover the whole site.
          Inside the house the ground is cut down to the house's floor; trees and garden objects stand on the slope.</p>
      </section>`;
      })() : ''}
${it.type === 'slab-opening' ? (() => {
        const L = levelById(lvlOf(it)) || curLevel();
        const below = state.levels.filter((l) => l.elev < L.elev).sort((a, b) => b.elev - a.elev)[0];
        const rail = it.rail || '3';
        return `
      <section><h3>Floor opening</h3>
        <div class="row"><label>Railing</label><select data-k="rail" ${dis}>
          ${[['3', '3 sides (open to the stairs)'], ['4', 'All 4 sides'], ['none', 'No railing']].map(([v, t]) => `<option value="${v}" ${v === rail ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
        ${rail !== 'none' ? `<label class="rail-type-lbl">Railing type</label>
        <div class="rail-types" role="radiogroup" aria-label="Railing type">${OPENING_RAILS.map(([v, n, sub, ic]) => {
          const on = (it.railType || 'steel') === v;
          return `<button data-do="op-rail" data-v="${v}" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" ${dis} title="${n}: ${sub}">
            <svg viewBox="0 0 32 24" aria-hidden="true">${ic}</svg><b>${n}</b><small>${sub}</small></button>`;
        }).join('')}</div>
        <div class="row"><label>Colour</label><input type="color" data-k="railColor" value="${it.railColor || OPENING_RAIL_COLOUR[it.railType || 'steel']}" ${dis}/>
          <div class="swatches">${(it.railType === 'concrete' ? [['#cfcac2', 'Light concrete'], ['#9a968f', 'Grey concrete'], ['#f2efe9', 'White render'], ['#5b5f66', 'Anthracite']]
            : it.railType === 'wood' ? [['#a0703f', 'Oak'], ['#6b4a2f', 'Walnut'], ['#d9b98c', 'Ash'], ['#2f2f2f', 'Black stain']]
            : [['#d9dde2', 'Stainless steel'], ['#2f3236', 'Black'], ['#f4f4f2', 'White'], ['#b08d57', 'Brass']])
            .map(([c, t]) => `<button class="sw" data-do="op-rail-col" data-v="${c}" title="${t}" style="background:${c}" ${dis}></button>`).join('')}</div></div>` : ''}
        ${(() => {
          // the slabs under it (several on one level, at different heights): pick the one it cuts
          const sl = slabsUnder(it).map((s) => ({ s, S: slabInfo(s) })).sort((a, b) => b.S.top - a.S.top);
          if (sl.length < 2) return '';
          const z = openingZ(it);
          return `<div class="row" style="margin-top:6px"><label>Cuts the slab</label></div><div class="btns">${sl.map(({ s, S }) =>
            `<button data-do="op-slab" data-v="${round(S.top, 1)}" class="${z >= S.bottom - 1 && z <= S.top + 1 ? 'on' : ''}" ${dis} title="Slab #${s.id}, ${fmtElev(S.bottom)} to ${fmtElev(S.top)}">#${s.id} · top ${fmtElev(S.top)}</button>`).join('')}</div>
            <p class="note" style="color:var(--muted)">Only this slab is opened — the other slabs under it stay closed.</p>`;
        })()}
        <p class="note" style="color:var(--muted)">${below
          ? `Cuts through the floor of ${esc(L.name)}${state.items.some((i) => i.type === 'slab' && slabOpenings(i).includes(it)) ? ' and its floor slab' : ''} down to <b>${esc(below.name)}</b> (${fmtElev(below.elev)}). In 3D the floor here is open. The triangle marks the open stair side. Put the stairs on ${esc(below.name)} under it — they get the right rise automatically; turn on "Show walls of ${esc(L.name)}" there to line them up.`
          : `There is no level below ${esc(L.name)} yet — add a basement in Plan settings for this opening to lead to.`}</p>
      </section>`;
      })() : ''}
${ic.height ? `
      <section><h3>${it.type === 'hedge' ? 'Hedge' : it.type === 'gate' ? 'Gate' : 'Fence'}</h3>
        <div class="row" title="Height above the ground (or the floor it stands on), in the 3D view"><label>Height</label>
          <input type="range" data-k="fh" min="30" max="250" step="5" value="${it.fh || ic.height}" ${dis}/>
          ${num('fh', it.fh || ic.height, 5, `min="20" max="400" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[60, 90, 120, 150, 180].map((v) => `<button data-do="fh" data-v="${v}" class="${(it.fh || ic.height) === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div>
      </section>` : ''}
${it.type === 'window-basement' ? (() => {
        const wallTop = window.FPWalls.hostWallTop(it, levelItems());
        const [s0, s1] = window.FPWalls.windowSpan(it, wallTop);
        const hgt = it.winH != null ? it.winH : 30;
        return `
      <section><h3>Window (3D)</h3>
        <div class="row" title="Height of the window opening"><label>Window height</label>
          ${num('winH', hgt, 5, `min="10" max="120" style="flex:none;width:72px"`)}<span class="unit">cm</span></div>
        <div class="row" title="Wall left above the window, up to the top of the wall"><label>Gap to wall top</label>
          ${num('topGap', it.topGap != null ? it.topGap : 5, 1, `min="0" max="100" style="flex:none;width:72px"`)}<span class="unit">cm</span></div>
        <div class="btns">${[20, 30, 40, 60].map((v) => `<button data-do="win-h" data-v="${v}" class="${hgt === v ? 'on' : ''}">${v} cm</button>`).join('')}</div>
        <p class="note" style="color:var(--muted)">Sits at the top of the wall: from ${round(s0)} to ${round(s1)} cm above the floor on this ${wallTop} cm wall. It moves with the wall height.</p>
        <div class="row" style="margin-top:8px"><label>Frame colour</label><input type="color" data-k="fill" value="${it.fill}"/>
          <div class="swatches">${['#ffffff', '#e8e4dc', '#8b5a3c', '#3f3f46', '#1f2328', '#9aa3ad'].map((c) => `<button data-do="fill" data-v="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div></div>
      </section>`;
      })() : /^(window|bay-window)/.test(it.type) ? `
      <section><h3>Window (3D)</h3>
        <div class="row" title="Height of the bottom of the window above the floor"><label>Sill height</label>
          ${num('sill', it.sill != null ? it.sill : 90, 5, `min="0" max="400" style="flex:none;width:72px"`)}<span class="unit">cm</span></div>
        <div class="row" title="Height of the top of the window above the floor"><label>Top height</label>
          ${num('head', it.head != null ? it.head : 210, 5, `min="20" max="500" style="flex:none;width:72px"`)}<span class="unit">cm</span></div>
        <div class="btns">${[['90,210', 'Standard'], ['40,220', 'Tall'], ['150,210', 'High'], ['0,220', 'Floor-length']]
          .map(([v, t]) => `<button data-do="win-preset" data-v="${v}" class="${`${it.sill != null ? it.sill : 90},${it.head != null ? it.head : 210}` === v ? 'on' : ''}" title="${v.replace(',', '–')} cm">${t}</button>`).join('')}</div>
        <div class="row" style="margin-top:8px"><label>Frame colour</label><input type="color" data-k="fill" value="${it.fill}"/>
          <div class="swatches">${['#ffffff', '#e8e4dc', '#8b5a3c', '#5b3a24', '#3f3f46', '#1f2328', '#9aa3ad', '#2f5d50'].map((c) => `<button data-do="fill" data-v="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div></div>
      </section>` : ''}
${it.type === 'fireplace' ? (() => {
        const fm = it.fpMat || 'brick', lit = it.fpLit !== false, fh = it.fh || 110;
        return `
      <section><h3>Fireplace</h3>
        <div class="row" style="margin-top:2px"><label>Surround</label><select data-k="fpMat" ${dis}>
          ${[['brick', 'Brick'], ['stone', 'Stone'], ['plaster', 'Plaster (painted)'], ['marble', 'Marble (smooth)']].map(([v, t]) => `<option value="${v}" ${v === fm ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="row"><label>Colour</label><input type="color" data-k="fill" value="${it.fill}" ${dis}/>
          <div class="swatches">${[['#a4532f', 'Red brick'], ['#7b3a22', 'Dark brick'], ['#a39b8b', 'Grey stone'], ['#c9b9a0', 'Sandstone'], ['#ece8e1', 'White'], ['#3a3d42', 'Black']]
            .map(([c, t]) => `<button data-do="fill" data-v="${c}" style="background:${c}" title="${t}" ${dis}></button>`).join('')}</div></div>
        <div class="row" style="margin-top:6px" title="Height up to the mantel shelf"><label>Height</label>
          ${num('fh', fh, 5, `min="60" max="250" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="row" style="margin-top:6px"><label>Fire</label><div class="btns" style="margin:0">
          <button data-do="fp-lit" data-v="1" class="${lit ? 'on' : ''}" ${dis}>Lit</button><button data-do="fp-lit" data-v="0" class="${lit ? '' : 'on'}" ${dis}>Out</button></div></div>
        <div class="row" title="Carry the surround on up to the ceiling as a chimney breast"><label>Chimney breast</label><div class="btns" style="margin:0">
          <button data-do="fp-breast" data-v="1" class="${it.fpBreast ? 'on' : ''}" ${dis}>To ceiling</button><button data-do="fp-breast" data-v="0" class="${it.fpBreast ? '' : 'on'}" ${dis}>None</button></div></div>
        <p class="note" style="color:var(--muted)">Put its back (the top edge of the icon) against a wall; the hearth is in front.</p>
      </section>`;
      })() : ''}
${it.type === 'chimney' ? (() => {
        const ch = it.chimH == null ? 100 : it.chimH, cm = it.chimMat || 'brick', pots = it.chimPots == null ? 1 : it.chimPots;
        return `
      <section><h3>Chimney</h3>
        <div class="row" title="How far the chimney rises above the highest point where it comes through the roof"><label>Above roof</label>
          ${num('chimH', ch, 5, `min="20" max="400" style="flex:none;width:64px" ${dis}`)}<span class="unit">cm</span></div>
        <div class="btns">${[60, 80, 100, 150, 200].map((v) => `<button data-do="chim-h" data-v="${v}" class="${ch === v ? 'on' : ''}" ${dis}>${(v / 100).toFixed(2)}</button>`).join('')}</div>
        <div class="row" style="margin-top:6px"><label>Material</label><select data-k="chimMat" ${dis}>
          ${[['brick', 'Brick'], ['stone', 'Stone'], ['plaster', 'Plaster (rendered)']].map(([v, t]) => `<option value="${v}" ${v === cm ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="row"><label>Colour</label><input type="color" data-k="fill" value="${it.fill}" ${dis}/>
          <div class="swatches">${[['#a4532f', 'Red brick'], ['#7b3a22', 'Dark brick'], ['#c9a27a', 'Sand'], ['#a39b8b', 'Grey stone'], ['#e4dfd6', 'White'], ['#4b4f57', 'Anthracite']]
            .map(([c, t]) => `<button data-do="fill" data-v="${c}" style="background:${c}" title="${t}" ${dis}></button>`).join('')}</div></div>
        <div class="row" style="margin-top:6px" title="Clay flue pots on top"><label>Flue pots</label>
          <div class="btns" style="margin:0">${[0, 1, 2, 3].map((v) => `<button data-do="chim-pots" data-v="${v}" class="${pots === v ? 'on' : ''}" ${dis}>${v}</button>`).join('')}</div></div>
        <p class="note" style="color:var(--muted)">Place it over a roof: in 3D it rises through the roof under it. Without a roof it stands on the floor and rises past the top of the walls.</p>
      </section>`;
      })() : ''}
${/^door($|-)|^garage-door$/.test(it.type) ? (() => {
        const canShut = it.type !== 'door-revolving';
        const open = it.doorOpen != null ? !!it.doorOpen : !['door-sliding', 'garage-door'].includes(it.type);
        const fc = it.frameColor || '#f4f4f2', lc = it.leafColor || (it.type === 'garage-door' ? '#d9d6d0' : '#c9a27a');
        return `
      <section><h3>Door (3D)</h3>
        ${canShut ? `<div class="row" title="Show the door open or shut in the 3D view"><label>Door</label>
          <div class="btns" style="margin:0"><button data-do="door-open" data-v="1" class="${open ? 'on' : ''}" ${dis}>Open</button>
          <button data-do="door-open" data-v="0" class="${open ? '' : 'on'}" ${dis}>Closed</button></div></div>` : ''}
        ${it.type === 'door-revolving' ? '' : `<div class="row" style="margin-top:6px" title="Colour of the door frame (jambs and head) round the doorway"><label>Frame colour</label><input type="color" data-k="frameColor" value="${fc}" ${dis}/>
          <div class="swatches">${[['#f4f4f2', 'White'], ['#e8e4dc', 'Cream'], ['#9aa3ad', 'Grey'], ['#3f3f46', 'Anthracite'], ['#1f2328', 'Black'], ['#8b5a3c', 'Oak'], ['#5b3a24', 'Walnut'], ['#2f5d50', 'Green']]
            .map(([c, t]) => `<button data-do="door-frame" data-v="${c}" style="background:${c}" title="${t}" ${dis}></button>`).join('')}</div></div>`}
        ${['door-sliding', 'door-revolving'].includes(it.type) ? '' : `<div class="row" style="margin-top:6px" title="Colour of the door leaf (the door itself)"><label>Door colour</label><input type="color" data-k="${it.type === 'garage-door' ? 'fill' : 'leafColor'}" value="${it.type === 'garage-door' ? it.fill : lc}" ${dis}/>
          <div class="swatches">${[['#c9a27a', 'Light wood'], ['#8b5a3c', 'Oak'], ['#5b3a24', 'Walnut'], ['#f4f4f2', 'White'], ['#9aa3ad', 'Grey'], ['#3f3f46', 'Anthracite'], ['#7a2e2a', 'Red'], ['#2f4f6f', 'Blue']]
            .map(([c, t]) => `<button data-do="${it.type === 'garage-door' ? 'fill' : 'door-leaf'}" data-v="${c}" style="background:${c}" title="${t}" ${dis}></button>`).join('')}</div></div>`}
      </section>`;
      })() : ''}
${hasHeight(it.type) ? (() => {
        const isW = window.FPWalls.isWall(it);
        if (faceSel.id !== it.id) faceSel = { id: it.id, keys: new Set() };
        const picked = isW ? pickedFaces(it) : [];
        // what the picker shows: the first picked face's material, or the wall's own
        const cur = picked.length && it.faces && it.faces[picked[0]] ? it.faces[picked[0]]
          : { wmat: it.wmat || 'plaster', wcol: it.wcol || WALLMATS.MATS[it.wmat || 'plaster'].color };
        const nSet = Object.keys(it.faces || {}).length;
        return `
      <section><h3>Wall material</h3>
        ${isW ? (() => {
          const io = facesInOut(it), outK = io.filter((f) => f.outside).map((f) => f.key), inK = io.filter((f) => !f.outside).map((f) => f.key);
          const tgt = !picked.length ? 'all' : outK.length && sameSet(picked, outK) ? 'out' : inK.length && sameSet(picked, inK) ? 'in' : 'pick';
          return `<div class="row" title="Choose which side of the wall the material and colour below go on"><label>Paint</label>
          <div class="seg-btns">
            <button data-do="paint-side" data-v="all" class="${tgt === 'all' ? 'on' : ''}">Whole wall</button>
            <button data-do="paint-side" data-v="out" class="${tgt === 'out' ? 'on' : ''}" ${outK.length ? '' : 'disabled title="This wall has no face towards the outside"'}>Outside</button>
            <button data-do="paint-side" data-v="in" class="${tgt === 'in' ? 'on' : ''}" ${inK.length ? '' : 'disabled title="This wall has no face towards the inside"'}>Inside</button>
          </div></div>${facesBlock(it)}`;
        })() : ''}
        <div class="mat-target">${(() => {
          if (!picked.length) return 'Applies to the <b>whole wall</b> (both sides)';
          const io = isW ? facesInOut(it) : [], outK = io.filter((f) => f.outside).map((f) => f.key), inK = io.filter((f) => !f.outside).map((f) => f.key);
          return sameSet(picked, outK) ? 'Applies to the <b>outside</b> of this wall' : sameSet(picked, inK) ? 'Applies to the <b>inside</b> of this wall'
            : `Applies to <b>${picked.length} picked face${picked.length === 1 ? '' : 's'}</b>`;
        })()}</div>
        ${[['', 'Walls & finishes'], ['siding', 'Exterior siding']].map(([grp, title]) => `<div class="mat-group">${esc(title)}</div>
        <div class="mat-grid">${Object.entries(WALLMATS.MATS).filter(([, m]) => (m.group || '') === grp).map(([k, m]) =>
          `<button data-do="wmat" data-v="${k}" class="${k === cur.wmat ? 'on' : ''}" title="${esc(m.name)}"><img src="${WALLMATS.swatch(k)}" alt=""/><span>${esc(m.name)}</span></button>`).join('')}</div>`).join('')}
        <div class="row"><label>Colour</label><input type="color" data-k="wcol" value="${cur.wcol || WALLMATS.MATS[cur.wmat].color}"/>
          <div class="swatches">${WALL_SWATCHES.map((c) => `<button data-do="wcol" data-v="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div></div>
        <div class="btns">
          ${picked.length ? (() => {
            const io = isW ? facesInOut(it) : [], outK = io.filter((f) => f.outside).map((f) => f.key), inK = io.filter((f) => !f.outside).map((f) => f.key);
            const side = sameSet(picked, outK) ? 'out' : sameSet(picked, inK) ? 'in' : null;
            return (side ? `<button data-do="wside-all" data-v="${side}" title="Give the ${side === 'out' ? 'outside' : 'inside'} of every wall on this floor this material and colour">Apply to ${side === 'out' ? 'outside' : 'inside'} of all walls</button>` : '') +
              `<button data-do="faces-reset" title="These faces go back to the wall's material">Reset picked faces</button>`;
          })() : `<button data-do="wmat-all" title="Give every wall and column this material and colour">Apply to all walls</button>`}
          ${nSet && !picked.length ? `<button data-do="faces-reset" title="Remove every face override on this wall">Reset all faces</button>` : ''}
        </div>
      </section>`;
      })() : ''}

      <section><h3>Mirror</h3>
        <div class="btns">
          <button data-do="flip-h" class="${it.fx ? 'on' : ''}" ${dis} title="Mirror horizontally">⇋ Flip H</button>
          <button data-do="flip-v" class="${it.fy ? 'on' : ''}" ${dis} title="Mirror vertically">⇵ Flip V</button>
        </div>
      </section>

      <section><h3>Appearance</h3>
        <div class="row"><label>Line colour</label><input type="color" data-k="stroke" value="${it.stroke}"/>
          <div class="swatches">${SWATCHES.map((c) => `<button data-do="stroke" data-v="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div></div>
        ${isFloor ? '' : `<div class="row"><label>Fill colour</label><input type="color" data-k="fill" value="${it.fill}" ${it.fillNone ? 'disabled' : ''}/>
          <div class="swatches">${FILL_SWATCHES.map((c) => `<button data-do="fill" data-v="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div></div>
        <div class="row"><label></label><label class="check"><input type="checkbox" data-k="fillNone" ${it.fillNone ? 'checked' : ''}/> Transparent fill</label></div>`}
        <div class="row"><label>Line width</label><input type="range" data-k="sw" min="0.5" max="6" step="0.25" value="${it.sw}"/><span class="val" data-show="sw">${it.sw}px</span></div>
        <div class="row"><label>Opacity</label><input type="range" data-k="opacity" min="0.1" max="1" step="0.05" value="${it.opacity}"/><span class="val" data-show="opacity">${Math.round(it.opacity * 100)}%</span></div>
      </section>

      <section><h3>Arrange</h3>
        <div class="btns">
          <button data-do="front" title="Bring to front">To front</button>
          <button data-do="forward" title="Bring forward">Forward</button>
          <button data-do="backward" title="Send backward">Backward</button>
          <button data-do="back" title="Send to back">To back</button>
        </div>
        <div class="row" style="margin-top:8px"><label class="check"><input type="checkbox" data-k="locked" ${it.locked ? 'checked' : ''}/> Lock position &amp; size</label></div>
        <div class="row" title="Leave this object out of the 3D view (it stays on the 2D plan and in exports)">
          <label class="check"><input type="checkbox" data-k="hide3d" ${it.hide3d ? 'checked' : ''}/> Hide in 3D view</label></div>
        <div class="row" title="Draw this object nearly transparent in the 3D view, to see what is behind or inside it">
          <label class="check"><input type="checkbox" data-k="see3d" ${it.see3d ? 'checked' : ''} ${it.hide3d ? 'disabled' : ''}/> See-through in 3D view</label></div>
        ${levelMoveRow(lvlOf(it))}
      </section>

      <section class="btns">
        <button data-do="duplicate">Duplicate</button>
        <button data-do="delete" class="danger">Delete</button>
      </section>`;
  }

  /* "Floor" box at the top of the panel: which level an object belongs to and where it sits in height
     (absolute, from the outside ground ±0) — handy when it was picked in the 3D view */
  function floorInfo(it) {
    const L = levelById(lvlOf(it)) || curLevel(), lv = state.items.filter((i) => lvlOf(i) === L.id);
    const above = storeyAbove(L), below = storeyBelow(L);
    const W = window.FPWalls, em = W.elevationModel(lv), here = L.elev + em.at(it.x + it.w / 2, it.y + it.h / 2);
    let where;
    if (it.type === 'slab') {
      const S = slabInfo(it);
      where = `Floor of ${esc(L.name)} · top at <b>${fmtElev(S.top)}</b> · underside ${S.walls.length ? `(ceiling of ${esc(S.below.name)}) ` : ''}at <b>${fmtElev(S.bottom)}</b>`;
    } else if (it.type === 'slab-opening') {
      where = `Opening in the floor of ${esc(L.name)}${below ? ` down to ${esc(below.name)}` : ''}`;
    } else if (W.isWall(it) || /^column|^pillar/.test(it.type)) {
      const h = it.wh || state.wallH || 300;
      where = `Stands on <b>${fmtElev(here)}</b> · top at <b>${fmtElev(here + h)}</b>`;
    } else if (byId[it.type].stairs) {
      where = `From <b>${fmtElev(stairBottom(it))}</b> up ${round(stairRise(it))} cm to <b>${fmtElev(stairBottom(it) + stairRise(it))}</b>${stairTarget(it) && !it.rise && it.topZ == null ? ` (${esc(stairTarget(it).name)})` : ''}`;
    } else if (it.type === 'floor') {
      where = `${it.garden ? 'Surface' : 'Finished floor'} at <b>${fmtElev(L.elev + (it.elev || 0))}</b>`;
    } else where = it.z ? `<b>${(it.z / 100).toFixed(2)} m</b> above the floor — at <b>${fmtElev(here + it.z)}</b>` : `Stands on the floor at <b>${fmtElev(here)}</b>`;
    const flags = [L.id === state.level ? '' : 'not the level being designed', L.hide3d ? 'level hidden in 3D' : '', it.hide3d ? 'object hidden in 3D' : ''].filter(Boolean);
    return `<div class="floor-info" title="The level this object belongs to (choose another under Arrange → Level to move it)">
        <span class="fi-level">${esc(L.name)} <small>floor ${fmtElev(floorAbs(L))}</small></span>
        <span class="fi-where">${where}</span>${flags.length ? `<span class="fi-flags">${flags.join(' · ')}</span>` : ''}</div>`;
  }
  // the levels a multiple selection spans
  function floorInfoMulti(items) {
    const ids = [...new Set(items.map(lvlOf))], ls = ids.map((id) => levelById(id)).filter(Boolean).sort((a, b) => b.elev - a.elev);
    return `<div class="floor-info"><span class="fi-level">${ls.map((l) => `${esc(l.name)} <small>${fmtElev(l.elev)}</small>`).join(', ')}</span>
        <span class="fi-where">${ls.length > 1 ? `Spread over ${ls.length} levels` : `All on this level`}</span></div>`;
  }

  // "Level" dropdown for the selected object(s): choosing another level moves them there
  const levelMoveRow = (current) => state.levels.length < 2 ? '' :
    `<div class="row" style="margin-top:8px" title="Move to another level (keeps the position on the plan)"><label>Level</label>
      <select data-move-level>${[...state.levels].sort((a, b) => b.elev - a.elev).map((l) =>
        `<option value="${l.id}" ${l.id === current ? 'selected' : ''}>${esc(l.name)} (${fmtElev(l.elev)})</option>`).join('')}</select></div>`;

  /* ───────────── hide in 3D ─────────────
     it.hide3d leaves an object out of the 3D view only; it stays on the plan, in the object list and in exports. */
  function setHidden3D(ids, hidden) {
    let n = 0;
    for (const it of state.items) {
      if (!ids.includes(it.id) || !!it.hide3d === hidden) continue;
      if (hidden) it.hide3d = true; else delete it.hide3d;
      n++;
    }
    if (!n) return;
    render(); commit(); buildProps();
    toast(`${n} object${n === 1 ? '' : 's'} ${hidden ? 'hidden in' : 'shown again in'} 3D.`);
  }

  /* ───────────── see-through in 3D ─────────────
     it.see3d draws an object nearly transparent in the 3D view (to look behind or inside it); on the plan it is as usual. */
  function setSeeThrough3D(ids, on) {
    let n = 0;
    for (const it of state.items) {
      if (!ids.includes(it.id) || !!it.see3d === on) continue;
      if (on) it.see3d = true; else delete it.see3d;
      n++;
    }
    if (!n) return;
    render(); commit(); buildProps();
    toast(`${n} object${n === 1 ? '' : 's'} ${on ? 'see-through' : 'solid again'} in 3D.`);
  }

  /* ───────────── levels in 3D ───────────── */
  // which levels the 3D view shows
  const levelShown3D = (l) => !l.hide3d && (!state.hideAbove || l.elev <= curLevel().elev + 0.01);
  function setLevelHidden(id, hidden) {
    const l = levelById(id);
    if (!l || !!l.hide3d === hidden) return;
    if (hidden) l.hide3d = true; else delete l.hide3d;
    commit(); notify('items');
    if (!selIds().length) buildProps();
    toast(`${l.name} ${hidden ? 'hidden in' : 'shown in'} 3D.`);
  }
  // several at once (from the 3D levels menu): shown = ids to show, all others hidden
  function setLevelsShown(shownIds) {
    for (const l of state.levels) { if (shownIds.includes(l.id)) delete l.hide3d; else l.hide3d = true; }
    commit(); notify('items');
    if (!selIds().length) buildProps();
  }
  function setHideAbove(v) {
    state.hideAbove = !!v;
    save(); notify('items');
  }

  /* ───────────── level management ───────────── */
  // the reference level for the current one: the chosen one, else the nearest level above (else below)
  function refFor(L) {
    if (state.refLevel && state.refLevel !== L.id && levelById(state.refLevel)) return state.refLevel;
    const others = state.levels.filter((l) => l.id !== L.id);
    const above = others.filter((l) => l.elev > L.elev).sort((a, b) => a.elev - b.elev)[0];
    return (above || others.sort((a, b) => b.elev - a.elev)[0] || {}).id || null;
  }
  /* A basement shows the walls of the level right above it (the ground floor) as dashed lines, unless that was
     switched off for it (L.refOff). */
  function autoRef() {
    const L = curLevel();
    if (L.refOff) { state.showRef = false; return; } // switched off for this level: stays off when coming back
    if (L.elev < 0) {
      // a basement shows the walls of the level right above it (what it carries)
      const up = state.levels.filter((l) => l.elev > L.elev).sort((a, b) => a.elev - b.elev)[0];
      if (up) { state.refLevel = up.id; state.showRef = true; }
    } else if (L.id === groundLevel().id) {
      // the ground floor shows the basement under it (its walls and outline), once the basement has walls
      const down = state.levels.filter((l) => l.elev < L.elev).sort((a, b) => b.elev - a.elev)[0];
      if (down && state.items.some((i) => lvlOf(i) === down.id && window.FPWalls.isWall(i))) { state.refLevel = down.id; state.showRef = true; }
    }
  }
  function switchLevel(id) {
    if (!levelById(id) || id === state.level) return;
    if (state.tool) setTool(state.tool);
    state.level = id;
    applySel([]);
    // keep a sensible reference level when switching
    if (state.refLevel === id || !levelById(state.refLevel)) state.refLevel = refFor(curLevel());
    autoRef();
    state.workZ = floorAbs(curLevel()); // a new level: design on its floor
    render(); refreshSelectionUI(); buildProps(); save();
    if (levelItems().length) fit();
    if (window.FP3D && window.FP3D.focusHeight) window.FP3D.focusHeight(state.workZ); // the 3D view point goes to that floor
    toast(`Designing ${curLevel().name} (${fmtElev(curLevel().elev)})${state.showRef && state.refLevel ? ` · showing walls of ${levelById(state.refLevel).name}` : ''}`);
  }
  function addLevel(above) {
    const H = (state.wallH || 300) + 30; // storey height: wall height + slab
    const full = state.levels.filter((l) => !l.half); // (half levels sit between the floors: not counted here)
    const ext = full.reduce((m, l) => (above ? Math.max(m, l.elev) : Math.min(m, l.elev)), 0);
    const n = full.filter((l) => (above ? l.elev > 0 : l.elev < 0)).length;
    const name = above ? (n ? `Upper floor ${n + 1}` : 'Upper floor') : n ? `Basement ${n + 1}` : 'Basement';
    const lv = { id: 'L' + Date.now().toString(36), name, elev: above ? ext + H : ext - H };
    const from = state.level;
    state.levels.push(lv);
    state.refLevel = from;      // show the level we came from as the reference …
    state.showRef = true;       // … so the new level can be lined up with it straight away
    commit();
    switchLevel(lv.id);
  }
  /* Floor numbers: the ground floor is 1, the floors above 2, 3 …, the basements 0, −1 … (half levels not counted) */
  function levelNo(L) {
    const full = state.levels.filter((l) => !l.half).sort((a, b) => a.elev - b.elev);
    return full.indexOf(L) - full.indexOf(groundLevel()) + 1;
  }
  const halfAbove = (F) => {
    const full = state.levels.filter((l) => !l.half).sort((a, b) => a.elev - b.elev), up = full[full.indexOf(F) + 1];
    return state.levels.find((l) => l.half && l.elev > floorAbs(F) && (!up || l.elev < floorAbs(up))) || null;
  };
  /* A half level ("Level 1.5"): a split level halfway up from full floor F to the floor above it (above the top floor:
     half a storey up). It is a level of its own — its own tab, its own floor height in the Height bar — so doors,
     windows and everything else added on it take their heights from its floor. */
  function addHalfLevel(fid) {
    const F = levelById(fid);
    if (!F || F.half) return;
    const have = halfAbove(F);
    if (have) { switchLevel(have.id); return; }
    const full = state.levels.filter((l) => !l.half).sort((a, b) => a.elev - b.elev);
    const i = full.indexOf(F), up = full[i + 1], down = full[i - 1];
    const storey = up ? floorAbs(up) - floorAbs(F) : down ? floorAbs(F) - floorAbs(down) : (state.wallH || 300) + 30;
    const elev = round(floorAbs(F) + storey / 2, 1);
    const n = levelNo(F);
    const lv = { id: 'L' + Date.now().toString(36), name: `Level ${n}.5`, elev, wallH: F.wallH || state.wallH || 300, half: true };
    state.levels.push(lv);
    state.refLevel = F.id; state.showRef = true; // the floor below it shows as dashed walls, to line up with
    commit();
    switchLevel(lv.id);
  }
  function deleteLevel() {
    const L = curLevel();
    if (L.id === 'L0') return;
    const n = levelItems().length;
    if (n && !confirm(`Delete ${L.name} and its ${n} object${n === 1 ? '' : 's'}?`)) return;
    state.items = state.items.filter((it) => lvlOf(it) !== L.id);
    state.levels = state.levels.filter((l) => l.id !== L.id);
    state.level = 'L0';
    if (state.refLevel === L.id) state.refLevel = null;
    applySel([]);
    render(); refreshSelectionUI(); commit(); fit();
    toast(`${L.name} deleted.`);
  }
  // move objects to another level (they keep their position on the plan)
  function moveToLevel(ids, id) {
    if (!levelById(id)) return;
    let n = 0;
    for (const it of state.items) if (ids.includes(it.id)) { it.lvl = id; n++; }
    applySel([]);
    render(); refreshSelectionUI(); commit();
    toast(`Moved ${n} object${n === 1 ? '' : 's'} to ${levelById(id).name}.`);
  }

  function buildPlanProps() {
    renderLevelTabs(); // names / heights may just have changed
    $('#propTitle').textContent = 'Plan settings';
    const lvItems = levelItems();
    const b = lvItems.length ? bbox(lvItems) : null;
    const L = curLevel(), others = state.levels.filter((l) => l.id !== L.id);
    props.innerHTML = `
      <section>
        <p class="empty-props">Select an icon on the plan to edit its properties.</p>
      </section>
      <section><h3>Level — ${esc(L.name)}</h3>
        <p class="note" style="color:var(--muted);margin-top:0">Switch floors with the tabs at the top or the height bar on the left.</p>
        <div class="btns" style="margin-bottom:8px">
          <button data-plan-do="level-add-above" title="Add a level above the highest one">+ Upper floor</button>
          <button data-plan-do="level-add-below" title="Add a level below the lowest one">+ Basement</button>
        </div>
        <div class="row"><label>Name</label><input type="text" data-plan="levelName" value="${esc(L.name)}"/></div>
        <div class="row" title="Height of this level's walls, from its floor level to the wall top (= the next floor level). New walls on this level get it."><label>Wall height</label>
          <input type="number" data-plan="levelWallH" value="${L.wallH || state.wallH}" min="20" max="1000" step="5"/><span class="unit">cm</span></div>
        <p class="note" style="color:var(--muted);margin-top:0">Walls run from the floor level <b>${fmtElev(floorAbs(L))}</b> to <b>${fmtElev(floorAbs(L) + (L.wallH || state.wallH))}</b>.</p>
        <div class="row" title="Elevation of this level relative to the ground floor (the ground floor is ±0)"><label>Elevation</label>
          <input type="number" data-plan="levelElev" value="${L.elev}" step="5" ${L.id === 'L0' ? 'disabled title="The ground floor is the ±0 reference"' : ''}/><span class="unit">cm</span></div>
        ${others.length ? `
        <div class="row" style="margin-top:8px"><label class="check"><input type="checkbox" data-plan="showRef" ${state.showRef ? 'checked' : ''}/> Show walls of</label>
          <select data-plan="refLevel">${others.map((l) => `<option value="${l.id}" ${l.id === refFor(L) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
        <p class="note" style="color:var(--muted)">Reference walls are drawn as dashed outlines under this level, their centrelines on top — handy for lining up walls between storeys. Copy (Ctrl+C) on one level and paste (Ctrl+V) on another to reuse walls in the same place.</p>
        ${(() => { const T = refSupportTotals(); if (!T) return '';
          const ref = esc(levelById(state.refLevel).name), pct = Math.round((T.carried / T.total) * 100);
          return `<p class="note ref-support"><span class="lg carried"></span> carried by a wall here &nbsp;<span class="lg free"></span> not carried<br>
            <b>${pct}%</b> of the ${ref} walls (${round(T.carried / 100, 2)} of ${round(T.total / 100, 2)} m) stand on walls of ${esc(L.name)}${T.free > 1
              ? ` — <b>${round(T.free / 100, 2)} m</b> need a wall, beam or column underneath` : ''}. Walls dragged near a centreline snap onto it.</p>`; })()}` : ''}
        ${(() => {
          const up = L.elev < 0 && state.levels.filter((l) => l.elev > L.elev).sort((a, b) => a.elev - b.elev)[0];
          return up ? `<div class="btns" style="margin-top:8px"><button data-plan-do="level-next" data-v="${up.id}" class="primary" title="Go on with ${esc(up.name)} — the ${esc(L.name.toLowerCase())} stays visible under it as a dashed outline">${esc(L.name)} done — design the ${esc(up.name)} ↑</button></div>` : '';
        })()}
        ${L.id !== 'L0' ? `<div class="btns" style="margin-top:8px"><button data-plan-do="level-del" class="danger">Delete ${esc(L.name)}</button></div>` : ''}
      </section>
      ${(() => {
        const h = houseAboveGround(), G = groundLevel(), ups = state.levels.filter((l) => l.elev > G.elev).length;
        return `<section><h3>House</h3>
        <div class="row" title="Height of the ground floor's finished floor above the outside ground (±0)"><label>Above ground</label>
          <input type="number" data-plan="aboveGround" value="${round(h, 1)}" step="5" min="-200" max="500" style="flex:none;width:72px"/><span class="unit">cm</span></div>
        <div class="btns">${[0, 15, 30, 45, 60, 90].map((v) => `<button data-plan-do="raise" data-v="${v}" class="${Math.abs(h - v) < 0.05 ? 'on' : ''}">${v ? '+' + v : '±0'}</button>`).join('')}</div>
        <p class="note" style="color:var(--muted)">The ground floor's finished floor is <b>${fmtElev(h)}</b> above the outside ground. Changing it lifts the whole house:
          the ${esc(G.name.toLowerCase())}'s floors${ups ? ` and the ${ups} level${ups === 1 ? '' : 's'} above` : ''} move together, so room heights stay the same.
          Basement and garden stay in place; walls, slabs and stairs follow.</p>
      </section>`; })()}
      <section><h3>Plan</h3>
        <div class="row"><label>Name</label><input type="text" data-plan="title" value="${esc(state.title)}"/></div>
        <div class="row"><label>Grid size</label><select data-plan="grid">
          ${[5, 10, 20, 25, 50, 100].map((g) => `<option value="${g}" ${g === state.grid ? 'selected' : ''}>${imperial() ? `${IMP_GRID[g]}"` : `${g} cm`}</option>`).join('')}
        </select></div>
        <div class="row"><label>Background</label><input type="color" data-plan="bg" value="${state.bg}"/></div>
        <div class="row" title="When filling a floor, openings narrower than this are treated as closed (e.g. a door gap with no door icon)">
          <label>Floor fill gap</label><select data-plan="fillGap">
          ${[[5, 'Up to 5 cm'], [10, 'Up to 10 cm'], [25, 'Up to 25 cm'], [50, 'Up to 50 cm'], [100, 'Up to 1 m (doorways)']]
            .map(([v, t]) => `<option value="${v}" ${v === state.fillGap ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
        <div class="row" title="Standard height of walls and columns: changing it updates every wall on the standard height (walls with their own height keep it)">
          <label>Wall height</label>${`<input type="number" data-plan="wallH" value="${state.wallH}" min="20" max="1000" step="5"/>`}<span class="unit">cm</span></div>
        ${(() => {
          const own = state.items.filter((it) => hasHeight(it.type) && it.wh != null && it.wh !== state.wallH).length;
          return own ? `<p class="note" style="color:var(--muted);margin:0 0 6px">${own} wall${own === 1 ? '' : 's'}/column${own === 1 ? '' : 's'} with their own height keep it — use the button to give them the standard height too.</p>` : '';
        })()}
        <div class="btns" style="margin-bottom:7px"><button data-plan-do="walls-all" title="Give every wall and column on this level the standard height, including those with their own height">Apply to all walls</button></div>
        <div class="row" title="Draw brick, stone, wood… walls with an architectural hatch in the 2D plan (plaster walls stay solid)">
          <label class="check"><input type="checkbox" data-plan="wallMat2D" ${state.wallMat2D ? 'checked' : ''}/> Show wall materials in 2D</label></div>
        ${state.levels.length > 1 ? `<div class="row" title="A wall never runs up into the level above, and walls carrying the walls above reach them exactly">
          <label class="check"><input type="checkbox" data-plan="stackWalls" ${state.stackWalls !== false ? 'checked' : ''}/> Walls meet the level above (no gaps or overlaps)</label></div>` : ''}
        <div class="row" title="What surrounds the building in the 3D view"><label>3D ground</label><select data-plan="ground">
          ${GROUNDS.map(([k, t]) => `<option value="${k}" ${k === state.ground ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
        <div class="row"><label>Objects</label><span>${lvItems.length} on this level · ${state.items.length} in total</span></div>
        ${b ? `<div class="row"><label>Extent</label><span>${round(b.w / 100, 2)} × ${round(b.h / 100, 2)} m</span></div>` : ''}
      </section>
      <section><h3>Shortcuts</h3>
        <ul class="kbd-list">
          <li><span>Delete</span><kbd>Del</kbd></li>
          <li><span>Duplicate</span><kbd>Ctrl+D</kbd></li>
          <li><span>Copy / paste</span><kbd>Ctrl+C / V</kbd></li>
          <li><span>Add to selection</span><kbd>Shift+click</kbd></li>
          <li><span>Select with a box</span><kbd>Shift+drag</kbd></li>
          <li><span>Select all</span><kbd>Ctrl+A</kbd></li>
          <li><span>Fill floor tool</span><kbd>F</kbd></li>
          <li><span>Rotate 90°</span><kbd>R</kbd></li>
          <li><span>Flip horizontal</span><kbd>H</kbd></li>
          <li><span>Nudge (×10 with Shift)</span><kbd>← ↑ → ↓</kbd></li>
          <li><span>Undo / redo</span><kbd>Ctrl+Z / Y</kbd></li>
          <li><span>Pan</span><kbd>Space+drag</kbd></li>
          <li><span>Deselect</span><kbd>Esc</kbd></li>
        </ul>
      </section>`;
  }

  // keep panel numbers in sync while dragging on the canvas (without rebuilding the panel)
  function syncPropFields() {
    metricize(props);
    if (isMulti()) {
      const G = bbox(sels());
      for (const el of props.querySelectorAll('[data-m]')) if (el !== document.activeElement) { const v = el.dataset.m === 'x' ? G.x : G.y; el.value = dispLen(v, el); }
      return;
    }
    const it = sel();
    if (!it) return;
    { const ang = ((Math.round(it.r || 0) % 360) + 360) % 360;
      props.querySelectorAll('[data-do="orient"]').forEach((b) => b.classList.toggle('on', +b.dataset.v === ang));
      // Position Z and Size H follow the object (they are worked out, not stored)
      let z0, z1; try { z0 = objectBottom(it); z1 = objectTop(it); } catch (e) { /* not measurable */ }
      for (const [k, v] of [['posZ', z0], ['sizeH', z1 != null && z0 != null ? z1 - z0 : null]]) {
        const el = props.querySelector(`[data-k="${k}"]`);
        if (el && el !== document.activeElement && v != null && isFinite(v)) el.value = dispLen(round(v, 1), el);
      } }
    for (const el of props.querySelectorAll('[data-k]')) {
      if (el === document.activeElement) continue;
      const k = el.dataset.k;
      if (['x', 'y', 'w', 'h', 'r'].includes(k)) el.value = k === 'r' ? round(it[k]) : dispLen(it[k], el);
    }
  }

  function applyProp(el) {
    metricize(props);
    const it = sel();
    if (!it) return;
    const k = el.dataset.k;
    let v = el.type === 'checkbox' ? el.checked : fromM(el);
    if (k === 'material') return setMaterial(it, v);
    if (k === 'posZ' || k === 'sizeH') {
      // Position Z / Size H: passed on to the setting that holds them for this kind of object
      const n = parseFloat(v);
      if (!isFinite(n)) return;
      if (k === 'posZ') { setItemZ(it, n); return render(); } // a new position keeps its size
      const tg = hTarget(it, Math.max(1, n));
      if (!tg) return;
      return applyProp({ dataset: { k: tg[0] }, type: 'number', value: String(round(tg[1], 1)) });
    }
    if (k === 'flightW' && it.type === 'stairs-h') {
      // a straight stair's flight width is its H, kept about its centre
      const v2 = parseFloat(v);
      if (!isFinite(v2)) return;
      const cy = it.y + it.h / 2;
      it.h = Math.min(300, Math.max(60, v2)); it.y = round(cy - it.h / 2, 2);
      return render();
    }
    if (k === 'stairRun') {
      // another run type: the icon's own size, centred where the stairs were; the steps follow the rise again.
      // 'stairs-l:left' is the L mirrored (turning left)
      const [t, side] = String(v).split(':'), ic2 = byId[t], cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      if (!ic2 || !ic2.stairs) return;
      if (t === 'stairs-l') it.fx = side === 'left';
      if (t === 'stairs-u') it.fx = (side === 'right') !== !!it.fy; // right side up = mirrored
      if (t === it.type) return render(); // only the turn changed
      it.type = t; it.w = ic2.w; it.h = ic2.h; it.x = round(cx - it.w / 2, 2); it.y = round(cy - it.h / 2, 2);
      if (isAutoStairs(it)) it.steps = autoSteps(it);
      return render();
    }
    if (k === 'rise' && String(v).trim() === '') { delete it.rise; return render(); } // empty = up to the level above again
    if (k === 'wellW' && it.type === 'stairs-u') {
      const g = String(v).trim() === '' ? 0 : parseFloat(v);
      if (!isFinite(g)) return;
      setStairWell(it, g);
      return render();
    }
    if (k === 'stairStart') {
      const h = String(v).trim() === '' ? stairGround(it) : parseFloat(v);
      if (!isFinite(h)) return;
      setStairStart(it, Math.min(3000, h));
      return render();
    }
    if (k === 'topZ') {
      if (String(v).trim() === '') { delete it.topZ; return render(); }
      const t = parseFloat(v);
      if (!isFinite(t)) return;
      it.topZ = round(Math.min(3000, Math.max(stairBottom(it) + 20, t)), 1); delete it.rise; it.autoSteps = true;
      return render();
    }
    if (k === 'wcol' && pickedFaces(it).length) { // colour picker targets the picked faces
      setFaces(it, pickedFaces(it), (f) => ({ ...f, wcol: v }));
      return render();
    }
    if (k === 'see3d') { if (v) it.see3d = true; else delete it.see3d; return render(); }
    if (k === 'lCutW' || k === 'lCutD') {
      const n = parseFloat(v); if (!isFinite(n)) return;
      it[k] = round(Math.max(30, Math.min((k === 'lCutW' ? it.w : it.h) - 60, n)), 1);
      props.querySelectorAll(`[data-k="${k}"]`).forEach((o) => { if (o !== el) o.value = LEN_K.has(k) ? dispLen(it[k], o) : it[k]; });
      return render();
    }
    if (k === 'chimH') { const n = parseFloat(v); if (!isFinite(n)) return; it.chimH = round(Math.min(400, Math.max(20, n)), 1); return render(); }
    if (k === 'roofFence') { const n = parseFloat(v); if (!isFinite(n)) return; it.roofFence = round(Math.min(200, Math.max(20, n)), 1); return render(); }
    if (k === 'roofStyle') { if (byId['roof-' + v]) { it.type = 'roof-' + v; if (byId[it.type].roofFence && it.roofFence == null) it.roofFence = 50; if (v === 'hip-l-left') it.lCorner = 'tl'; if (v === 'hip-l') it.lCorner = 'tr'; } return render(); } // another roof style, same place
    if (it.type === 'slab' && k === 'autoFit') {
      const prev = { autoFit: it.autoFit, seed: it.seed };
      it.autoFit = v === 'all' ? true : v === 'room' || v === 'inner' || v === 'loop' ? v : false;
      // one room / one wall loop: the one under the slab's middle
      if (it.autoFit === 'room' || it.autoFit === 'inner' || it.autoFit === 'loop') it.seed = (() => { const pl = slabPoly(it), tf = window.FPWalls.toWorld(it); if (!pl) return [it.x + it.w / 2, it.y + it.h / 2]; const c = pl.reduce((m, q) => [m[0] + q[0] / pl.length, m[1] + q[1] / pl.length], [0, 0]); return tf(c); })();
      if (!it.autoFit) { it.locked = false; return render(); }
      if (!slabFit(it)) {
        Object.assign(it, prev);
        toast(v === 'loop' ? 'The middle of this slab is not inside a closed loop of walls — place a new slab by clicking inside the walls instead.'
          : v === 'room' || v === 'inner' ? 'The middle of this slab is not inside a closed room — place a new slab by clicking the room instead.' : 'There are no walls to fit the slab to yet.', 'error');
        return buildProps();
      }
      return render();
    }
    if (it.type === 'floor' && k === 'fill') state[it.garden ? 'lastGarden' : 'lastFloor'] = { material: it.material, fill: v };
    if (it.type === 'floor' && k === 'elev' && !it.garden) { state.lastElev = parseFloat(v) || 0; it.ownElev = true; }
    if (['x', 'y', 'w', 'h', 'r', 'sw', 'opacity', 't', 'wh', 'sill', 'head', 'winH', 'topGap', 'elev', 'steps', 'rise', 'fh', 'targetRiser', 'slabT', 'slabZ', 'hillH', 'z', 'pitch', 'overhang', 'slopeH', 'blend', 'stepGrade', 'poolDepth', 'wz', 'pitDepth', 'pitT', 'pitBase', 'railH', 'landingD', 'flightW', 'solidSteps', 'roofZ', 'roofT', 'balRoofH', 'balDepth'].includes(k)) {
      if (k === 'slabZ' && String(v).trim() === '') { delete it.slabZ; delete it.slabAlign; return render(); } // empty = resting on the walls again
      if (k === 'slabZ') {
        const AW = slabAlignWalls(it), z = parseFloat(v);
        if (AW && isFinite(z)) {
          // within the walls: kept between their foot and their top (less the slab), stored as a step above the foot
          const hi = Math.max(AW.bottom, AW.top - (it.slabT || 30));
          it.slabAlign = 'bottom'; it.slabOff = round(Math.min(hi, Math.max(AW.bottom, z)) - AW.bottom, 1); delete it.slabZ;
          floorsFollow(it);
          if (z < AW.bottom - 0.5 || z > hi + 0.5) toast(`Kept within the walls: ${fmtElev(AW.bottom)} to ${fmtElev(hi)} for the underside.`);
          return render();
        }
        delete it.slabAlign; // no walls: a free height
      }
      v = parseFloat(v);
      if (!isFinite(v)) return;
      if (k === 'w' || k === 'h') v = Math.max(MIN_SIZE, v);
      if (k === 'r') v = normAngle(v);
      if (k === 'wh') { v = Math.min(1000, Math.max(20, v)); it.freeH = true; } // a height typed in: kept, not matched to the level above
      if (k === 'steps') {
        v = Math.min(60, Math.max(2, Math.round(v))); it.autoSteps = false; // typed count = manual
        if (byId[it.type].stairs && !it.rise && !stairTarget(it) && v > MAX_FREE_RISERS) { v = MAX_FREE_RISERS; toast(`No level above to reach — limited to ${MAX_FREE_RISERS} risers.`, 'error'); }
      }
      if (k === 'targetRiser') v = Math.min(22, Math.max(12, v));
      if (k === 'rise') v = Math.min(1000, Math.max(20, v));
      if (k === 'fh') v = Math.min(400, Math.max(20, v));
      if (k === 'slabT') v = Math.min(150, Math.max(5, v));
      if (k === 'slabZ') v = Math.min(3000, Math.max(-1000, v));
      if (k === 'wz') { v = Math.min(3000, Math.max(-1000, v)); if (Math.abs(v) < 0.5) { delete it.wz; return render(); } }
      if (k === 'hillH') v = Math.min(3000, Math.max(-1000, v));
      if (k === 'z') v = Math.min(2000, Math.max(0, v));
      if (k === 'pitch') v = Math.min(75, Math.max(1, v));
      if (k === 'overhang') v = Math.min(200, Math.max(0, v));
      if (k === 'slopeH') v = Math.min(2000, Math.max(-1000, v));
      if (k === 'blend') v = Math.min(1500, Math.max(0, v));
      if (k === 'stepGrade') v = Math.min(60, Math.max(3, v));
      if (k === 'poolDepth') v = Math.min(400, Math.max(60, v));
      if (k === 'pitDepth') v = Math.min(500, Math.max(30, v));
      if (k === 'railH') v = Math.min(120, Math.max(60, v));
      if (k === 'solidSteps') v = Math.min(10, Math.max(0, Math.round(v)));
      if (k === 'roofZ') v = Math.min(5000, Math.max(-1000, v));
      if (k === 'roofT') v = Math.min(20, Math.max(10, v));
      if (k === 'landingD') v = Math.min(400, Math.max(60, v));
      if (k === 'flightW') v = Math.min(200, Math.max(60, v));
      if (k === 'balRoofH') v = Math.min(450, Math.max(200, v));
      if (k === 'balDepth') v = Math.min(400, Math.max(60, v));
      if (k === 'pitT' || k === 'pitBase') v = Math.min(40, Math.max(8, v));
    }
    if ((k === 'w' || k === 'h') && it.r) {
      // resize about the centre so rotated items stay put
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      it[k] = v; it.x = cx - it.w / 2; it.y = cy - it.h / 2;
    } else {
      it[k] = v;
    }
    if (it.type === 'balcony' && ['w', 'h', 'r', 'balShape', 'balDepth'].includes(k)) balconyAfterEdit(it);
    if (doorsBalcony(it) && ['w', 'x', 'y'].includes(k)) syncBalconyDoor(doorsBalcony(it), true);
    if ((k === 'w' || k === 'h') && it.type === 'stairs-l') { relengthL(it, k); props.querySelectorAll('[data-k="w"],[data-k="h"]').forEach((o) => { if (o !== el) o.value = dispLen(it[o.dataset.k], o); }); }
    if (it.type === 'slab' && (k === 'slabZ' || k === 'slabT')) floorsFollow(it);
    if (k === 'r' || k === 'wh' || k === 'elev' || k === 'steps' || k === 'fh' || k === 'slabZ' || k === 'hillH') props.querySelectorAll(`[data-k="${k}"]`).forEach((o) => { if (o !== el) o.value = LEN_K.has(k) ? dispLen(v, o) : round(v); });
    const shown = props.querySelector(`[data-show="${k}"]`);
    if (shown) shown.textContent = k === 'opacity' ? Math.round(v * 100) + '%' : v + 'px';
    render();
  }

  // switching material also switches to that material's natural colour (and remembers it for the next fill)
  function setMaterial(it, key) {
    if (!MATERIALS[key]) return;
    it.material = key;
    it.fill = MATERIALS[key].color;
    state[it.garden ? 'lastGarden' : 'lastFloor'] = { material: key, fill: null };
    render();
  }

  props.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.k === 'posZ' || el.dataset.k === 'sizeH') return; // taken when the field is left (they move other settings)
    if (el.dataset.k) applyProp(el);
    else if (el.dataset.m) applyMulti(el);
    else if (el.dataset.plan) applyPlan(el);
  });
  props.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-move-level]')) return moveToLevel(selIds(), el.value);
    if (el.dataset.k) {
      applyProp(el);
      commit(); // before rebuilding the panel: commit also recalculates auto stairs
      if (['posZ', 'sizeH', 'fillNone', 'locked', 'stroke', 'fill', 'material', 'wh', 'wcol', 'sill', 'head', 'winH', 'topGap', 'elev', 'steps', 'rise', 'fh',
        'targetRiser', 'autoSteps', 'fitLength', 'w', 'h', 'hide3d', 'slabT', 'slabType', 'ceiling', 'autoFit', 'slabZ', 'wallsMeet', 'snapEdges', 'hillH', 'hillShape', 'hillColor', 'z', 'see3d', 'roofStyle', 'lCutW', 'lCutD', 'roofFence', 'fenceStyle', 'chimMat', 'fpMat', 'pitch', 'overhang', 'slopeH', 'blend', 'stepGrade', 'poolDepth', 'poolSteps', 'poolLadder', 'wz', 'pitDepth', 'pitT', 'pitBase', 'pitCover', 'stairRun', 'under', 'rail', 'railStyle', 'railH', 'topZ', 'stairStart', 'wellW', 'solidSteps', 'railType', 'roofZ', 'gutter', 'roofT', 'topLanding', 'landingD', 'landingSquare', 'flightW', 'midLanding', 'balShape', 'balGuard', 'balRoof', 'balRoofH', 'balHooks', 'balDepth', 'lfMat', 'lfColor', 'balL', 'balF', 'balR'].includes(el.dataset.k)) buildProps();
    } else if (el.dataset.m) {
      applyMulti(el); buildProps(); commit();
    } else if (el.dataset.plan) {
      applyPlan(el); save();
      // renaming / moving a level, and the standard wall height, are undoable and update the panel
      if (el.dataset.plan === 'levelName' || el.dataset.plan === 'levelElev' || el.dataset.plan === 'levelWallH') { commit(); buildProps(); }
      if (el.dataset.plan === 'aboveGround') setHouseAboveGround(fromM(el));
      if (el.dataset.plan === 'wallH') {
        commit(); buildProps();
        const n = state.items.filter((it) => hasHeight(it.type) && (it.wh == null || it.wh === state.wallH)).length;
        toast(`Standard wall height ${state.wallH} cm — ${n} wall${n === 1 ? '' : 's'}/column${n === 1 ? '' : 's'} use it.`);
      }
    }
  });
  props.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
  });

  function applyPlan(el) {
    metricize(props);
    const k = el.dataset.plan;
    if (k === 'title') { state.title = el.value; $('#planTitle').value = el.value; }
    if (k === 'grid') { state.grid = +el.value; renderView(); }
    if (k === 'bg') { state.bg = el.value; renderView(); }
    if (k === 'fillGap') state.fillGap = +el.value;
    if (k === 'wallMat2D') { state.wallMat2D = el.checked; render(); }
    if (k === 'stackWalls') { state.stackWalls = el.checked; commit(); render(); }
    if (k === 'ground') { state.ground = el.value; notify('items'); }
    // levels
    if (k === 'levelName') { curLevel().name = el.value || 'Level'; $('#stLevel').textContent = `${curLevel().name} · ${fmtElev(curLevel().elev)}`; }
    if (k === 'levelElev' && state.level !== 'L0') {
      const v = parseFloat(fromM(el));
      const twin = isFinite(v) && state.levels.find((l) => l.id !== state.level && Math.abs(l.elev - v) < 0.5);
      if (twin) { if (el.dataset.warned !== String(v)) { el.dataset.warned = String(v); toast(`${twin.name} is already at ${fmtElev(v)} — two levels cannot share an elevation.`, 'error'); } return; }
      if (isFinite(v)) { curLevel().elev = Math.max(-5000, Math.min(10000, v)); $('#stLevel').textContent = `${curLevel().name} · ${fmtElev(curLevel().elev)}`; notify('items'); }
    }
    if (k === 'showRef' || k === 'refLevel') {
      if (k === 'showRef') {
        state.showRef = el.checked;
        // remember a basement's choice, so switching back to it does not turn the walls on again
        if (curLevel().elev < 0 || curLevel().id === groundLevel().id) { if (el.checked) delete curLevel().refOff; else curLevel().refOff = true; }
      }
      const pick = props.querySelector('[data-plan="refLevel"]');
      state.refLevel = pick ? pick.value : refFor(curLevel());
      $('#refLayer').innerHTML = refWalls();
      $('#refAxes').innerHTML = refAxes();
    }
    if (k === 'levelWallH') {
      // this level's wall height: its walls still on the old height follow
      const v = Math.min(1000, parseFloat(fromM(el))), L = curLevel(), old = L.wallH || state.wallH;
      if (isFinite(v) && v >= 20 && v !== old) {
        for (const it of state.items) if (lvlOf(it) === L.id && hasHeight(it.type) && (it.wh || state.wallH) === old) it.wh = v;
        L.wallH = v;
        render();
      }
    }
    if (k === 'wallH') {
      // the standard wall height: every wall / column still on the standard height follows it (live in 3D);
      // walls given their own height keep it
      const v = Math.min(1000, parseFloat(fromM(el)));
      if (isFinite(v) && v >= 20 && v !== state.wallH) {
        const old = state.wallH;
        for (const it of state.items) if (hasHeight(it.type) && it.wh === old) it.wh = v;
        state.wallH = v;
        render();
      }
    }
  }

  props.addEventListener('click', (e) => {
    const mb = e.target.closest('[data-mdo]');
    if (mb) return multiAction(mb.dataset.mdo, mb.dataset.v);
    const ld = e.target.closest('[data-plan-do^="level-"]');
    if (ld) {
      const a = ld.dataset.planDo;
      if (a === 'level-add-above' || a === 'level-add-below') return addLevel(a === 'level-add-above');
      if (a === 'level-del') return deleteLevel();
      if (a === 'level-next') { switchLevel(ld.dataset.v); return fit(); }
    }
    const pb = e.target.closest('[data-plan-do]');
    if (pb && pb.dataset.planDo === 'raise') return setHouseAboveGround(pb.dataset.v);
    if (pb && pb.dataset.planDo === 'walls-all') {
      let n = 0;
      for (const it of levelItems()) if (hasHeight(it.type) && !it.locked) { it.wh = state.wallH; n++; }
      render(); commit();
      toast(n ? `Set ${n} wall${n === 1 ? '' : 's'}/column${n === 1 ? '' : 's'} to ${state.wallH} cm.` : 'There are no walls to change yet.');
      return;
    }
    const b = e.target.closest('[data-do]');
    if (!b) return;
    const it = sel();
    if (!it) return;
    const ic = byId[it.type];
    switch (b.dataset.do) {
      case 'grp-all': return setSelection(groupIds(it));
      case 'select-slab': return select(+b.dataset.v);
      case 'grp-leave': delete it.grp; delete it.grpName; toast('Taken out of the group — it is on its own now.'); break;
      case 'orient': {
        const a = normAngle(+b.dataset.v);
        if (Math.abs(normAngle(a - (it.r || 0))) < 0.01) return;
        rotateBy(normAngle(a - (it.r || 0)));
        return buildProps();
      }
      case 'rot-90': return rotateBy(-90);
      case 'rot+90': return rotateBy(90);
      case 'flip-h': it.fx = !it.fx; break;
      case 'flip-v': it.fy = !it.fy; break;
      case 'reset-size': { const cx = it.x + it.w / 2, cy = it.y + it.h / 2; it.w = ic.w; it.h = ic.h; it.x = cx - it.w / 2; it.y = cy - it.h / 2; break; }
      case 'swap': { const cx = it.x + it.w / 2, cy = it.y + it.h / 2; [it.w, it.h] = [it.h, it.w]; it.x = cx - it.w / 2; it.y = cy - it.h / 2; break; }
      case 'stroke': it.stroke = b.dataset.v; break;
      case 'fill':
        it.fill = b.dataset.v; it.fillNone = false;
        if (it.type === 'floor') state[it.garden ? 'lastGarden' : 'lastFloor'] = { material: it.material, fill: it.fill };
        break;
      case 'material': setMaterial(it, b.dataset.v); break;
      case 'wh': it.wh = +b.dataset.v; it.freeH = true; break;
      case 'wh-auto': delete it.freeH; break; // match the level above / the slab again
      case 'win-preset': [it.sill, it.head] = b.dataset.v.split(',').map(Number); break;
      case 'win-h': it.winH = +b.dataset.v; break;
      case 'fh': it.fh = +b.dataset.v; break;
      case 'slab-t': it.slabT = +b.dataset.v; floorsFollow(it); break;
      case 'hill-h': it.hillH = +b.dataset.v; break;
      case 'roof-pitch': it.pitch = +b.dataset.v; break;
      case 'slope-h': it.slopeH = +b.dataset.v; break;
      case 'path-w': { const c = [it.x + it.w / 2, it.y + it.h / 2]; it.h = +b.dataset.v; it.x = c[0] - it.w / 2; it.y = c[1] - it.h / 2; break; } // width, about its middle
      case 'path-grade': it.stepGrade = +b.dataset.v; break;
      case 'pool-depth': it.poolDepth = +b.dataset.v; break;
      case 'pit-depth': it.pitDepth = +b.dataset.v; break;
      case 'slope-blend': it.blend = +b.dataset.v; break;
      case 'roof-mat': it.roofMat = b.dataset.v; it.fill = WALLMATS.ROOF_MATS[b.dataset.v].color; break; // its natural colour
      case 'roof-ov': it.overhang = +b.dataset.v; break;
      case 'fp-lit': it.fpLit = b.dataset.v === '1'; break;
      case 'fp-breast': it.fpBreast = b.dataset.v === '1'; break;
      case 'chim-h': it.chimH = +b.dataset.v; break;
      case 'chim-pots': it.chimPots = +b.dataset.v; break;
      case 'door-open': it.doorOpen = b.dataset.v === '1'; break;
      case 'door-frame': it.frameColor = b.dataset.v; break;
      case 'door-leaf': it.leafColor = b.dataset.v; break;
      case 'l-corner': it.lCorner = b.dataset.v; break;
      case 'roof-fence': it.roofFence = +b.dataset.v; break;
      case 'roof-work': it.roofZ = round(state.workZ == null ? floorAbs(levelById(lvlOf(it)) || curLevel()) : state.workZ, 1); break;
      case 'roof-walls': delete it.roofZ; break;
      case 'gutter-col': it.gutterColor = b.dataset.v; break;
      case 'roof-t': it.roofT = +b.dataset.v; break;
      case 'z-work': { const c = workRel(); if (c > 0) it.z = round(c, 1); else delete it.z; break; }
      case 'wz-work': { const c = workRel(); if (Math.abs(c) >= 1) it.wz = round(c, 1); else delete it.wz; break; }
      case 'wz-floor': delete it.wz; break;
      case 'z-floor': delete it.z; break;
      case 'stair-top-work': {
        const wz = state.workZ == null ? floorAbs(levelById(lvlOf(it)) || curLevel()) : state.workZ;
        if (wz - stairBottom(it) < 20) { toast(`The Height bar (${fmtElev(wz)}) is not above where the stairs stand (${fmtElev(stairBottom(it))}). Pick a higher height first.`, 'error'); return; }
        it.topZ = round(wz, 1); delete it.rise; it.autoSteps = true; snapStairToSlabs(it); break;
      }
      case 'landing-d': it.landingD = +b.dataset.v; break;
      case 'flight-w':
        if (it.type === 'stairs-h') { const cy = it.y + it.h / 2; it.h = +b.dataset.v; it.y = round(cy - it.h / 2, 2); break; } // straight: its width
        it.flightW = +b.dataset.v; fitStairs(it); break; // narrower / wider flights: the size follows
      case 'stair-fit': fitStairs(it); break;
      case 'landing-a': it.landingA = +b.dataset.v; break;
      case 'spiral-turn': it.spiralTurn = +b.dataset.v; break;
      case 'spiral-fit': {
        // the turn that gives a comfortable going on the walking line (60 % of the radius), in steps of 45°
        const ST = window.FP_STAIRS, n = ST.stepsOf(it.type, it), riser = stairRise(it) / n, want = Math.max(22, Math.min(35, 63 - 2 * riser));
        const R = (0.6 * Math.min(it.w, it.h)) / 2, A = it.topLanding ? (it.landingA || 90) : 0;
        const deg = ((want * (A ? n - 1 : n)) / R) * (180 / Math.PI) + A;
        it.spiralTurn = Math.min(1440, Math.max(270, Math.ceil(deg / 45) * 45));
        toast(`Turn set to ${it.spiralTurn}° (${(it.spiralTurn / 360).toFixed(2).replace(/\.?0+$/, '')} turns) for steps of about ${round(want)} cm.`);
        break;
      }
      case 'well-w': setStairWell(it, +b.dataset.v); break;
      case 'op-slab': it.oz = +b.dataset.v; break; // the floor opening cuts this slab
      case 'op-rail': if (it.railType !== b.dataset.v) delete it.railColor; it.railType = b.dataset.v; break; // another guard: its usual colour
      case 'op-rail-col': it.railColor = b.dataset.v; break;
      case 'rail-style': it.railStyle = b.dataset.v; if ((it.rail || 'none') === 'none') it.rail = 'both'; break; // a type picked: rails on both sides if there were none
      case 'stair-start-work': {
        const wz = state.workZ == null ? floorAbs(levelById(lvlOf(it)) || curLevel()) : state.workZ;
        if (!setStairStart(it, wz)) return;
        snapStairToSlabs(it);
        break;
      }
      case 'stair-top-level': delete it.topZ; delete it.rise; it.autoSteps = true; break;
      case 'lf-h': it.fh = +b.dataset.v; break;
      case 'pool-rim': {
        const zz = b.dataset.v === 'work' && state.workZ != null ? state.workZ - floorUnder(it) : 0;
        if (Math.abs(zz) >= 1) it.z = round(zz, 1); else delete it.z;
        break;
      }
      case 'bal-sides': { const [l, f, r] = b.dataset.v.split(','); Object.assign(it, { balL: l, balF: f, balR: r }); for (const k of ['balL', 'balF', 'balR']) if (it[k] === 'auto') delete it[k]; break; }
      case 'bal-fit': {
        // the balcony, then its group (door, furniture) moved and turned the same way
        const grpItems = it.grp ? state.items.filter((o) => o !== it && o.grp === it.grp && lvlOf(o) === lvlOf(it)) : [];
        const c0 = [it.x + it.w / 2, it.y + it.h / 2], r0 = it.r || 0;
        if (!fitBalcony(it)) { toast('No house wall near this balcony — move it next to a wall first.', 'error'); return; }
        const c1 = [it.x + it.w / 2, it.y + it.h / 2], dr = ((it.r || 0) - r0) * Math.PI / 180, cs = Math.cos(dr), sn = Math.sin(dr);
        for (const o of grpItems) {
          const vx = o.x + o.w / 2 - c0[0], vy = o.y + o.h / 2 - c0[1];
          o.x = round(c1[0] + vx * cs - vy * sn - o.w / 2, 1); o.y = round(c1[1] + vx * sn + vy * cs - o.h / 2, 1); o.r = normAngle((o.r || 0) + (it.r || 0) - r0);
          if (window.FPWalls.isOpening(o)) autoAlign(o, true);
        }
        break;
      }
      case 'bal-door': if (!addBalconyDoor(it)) toast('The door is in, but no house wall runs along the balcony\'s back edge — move the balcony against a wall.', 'error'); break;
      case 'stair-start-slab': if (!setStairStart(it, +b.dataset.v)) return; break;
      case 'stair-top-slab': {
        const v = +b.dataset.v;
        if (v - stairBottom(it) < 20) { toast(`Slab top ${fmtElev(v)} is not above where the stairs start (${fmtElev(stairBottom(it))}).`, 'error'); return; }
        it.topZ = round(v, 1); delete it.rise; it.autoSteps = true; break;
      }
      case 'slab-off': {
        // the underside a step above the foot of the walls it sits within — never beyond the walls' height
        const AW = slabAlignWalls(it);
        if (!AW) { toast('No walls round or under this slab — move it onto or between walls first, or type a height.', 'error'); return; }
        const want = +b.dataset.v, room = Math.max(0, AW.top - AW.bottom - (it.slabT || 30));
        it.slabAlign = 'bottom'; it.slabOff = Math.min(room, want); delete it.slabZ;
        const n = floorsFollow(it), S = slabInfo(it);
        toast(`Slab underside ${want ? `${(it.slabOff / 100).toFixed(2)} m above` : 'on'} the foot of the walls of ${AW.level.name}: ${fmtElev(S.bottom)} to ${fmtElev(S.top)}` +
          `${want > room ? ' (limited by the wall height)' : ''}${n ? ` · ${n} floor${n === 1 ? '' : 's'} on it moved along` : ''}.`);
        break;
      }
      case 'slab-align': {
        const prev = it.slabAlign;
        it.slabAlign = b.dataset.v;
        const S = slabInfo(it);
        if (!S.align) { if (prev) it.slabAlign = prev; else delete it.slabAlign; toast('No walls touch this slab — move it onto or between walls first.', 'error'); return; }
        delete it.slabZ;
        const n = floorsFollow(it);
        toast(`Slab ${S.align === 'top' ? 'top' : 'underside'} aligned with the ${S.align} of the walls of ${S.alignWalls.level.name}: ${fmtElev(S.bottom)} to ${fmtElev(S.top)}${n ? ` · ${n} floor${n === 1 ? '' : 's'} on it moved along` : ''}.`);
        break;
      }
      case 'slab-extend': case 'slab-meet': {
        // walls of the level below get the height that reaches the slab's underside (extend), or that puts the
        // slab's top on this level's floor (meet)
        const S = slabInfo(it);
        if (!S.below) return;
        const meet = b.dataset.do === 'slab-meet', target = (meet ? S.floor - S.t : S.bottom) - S.below.elev;
        const list = meet ? S.walls : S.short;
        for (const u of list) {
          const base = u.top - (u.item.wh || state.wallH);
          u.item.wh = Math.min(1000, Math.max(20, round(target - base, 1)));
        }
        toast(`${list.length} wall${list.length === 1 ? '' : 's'} of ${S.below.name} now reach${list.length === 1 ? 'es' : ''} the slab underside at ${fmtElev(S.below.elev + target)}.`);
        break;
      }
      case 'pour-slab': {
        const sl = pourSlabFor(it);
        if (sl) toast(`Poured a 30 cm concrete slab (${round(sl.w / 100, 2)} × ${round(sl.h / 100, 2)} m) over the ${gardenBase(it).over.name.toLowerCase()} under this garden area.`);
        break;
      }
      case 'slab-fit': {
        // outer edge of every wall it touches (this level and the one below); rotation reset
        const fr = slabFit(it);
        if (!fr) { toast('There are no walls to fit the slab to.', 'error'); return; }
        applyFit(it, fr);
        toast(`Slab fitted to the walls: ${fr.poly ? `${fr.poly.length}-corner outline, ` : ''}${round(fr.w / 100, 2)} × ${round(fr.h / 100, 2)} m.`);
        break;
      }
      case 'elev': it.elev = +b.dataset.v; if (!it.garden) { state.lastElev = it.elev; it.ownElev = true; } break;
      // target riser preset (auto steps recalculates on commit)
      case 'target-riser': it.targetRiser = +b.dataset.v; it.autoSteps = true; break;
      case 'wmat': {
        const v = b.dataset.v, picked = pickedFaces(it);
        if (picked.length) setFaces(it, picked, () => ({ wmat: v, wcol: WALLMATS.MATS[v].color }));
        else { it.wmat = v; it.wcol = WALLMATS.MATS[v].color; }
        break;
      }
      case 'wcol': {
        const picked = pickedFaces(it);
        if (picked.length) setFaces(it, picked, (f) => ({ ...f, wcol: b.dataset.v }));
        else { it.wcol = b.dataset.v; if (!it.wmat) it.wmat = 'plaster'; }
        break;
      }
      // picking faces in the diagram (selection only — nothing changes on the plan)
      case 'face': {
        const k = b.dataset.v;
        if (faceSel.keys.has(k)) faceSel.keys.delete(k); else faceSel.keys.add(k);
        buildProps(); renderOverlay();
        return;
      }
      case 'faces-inside': case 'faces-outside': case 'faces-all': case 'faces-none': {
        const want = b.dataset.do;
        const all = window.FPWalls.wallFaces(it).faces;
        faceSel.keys = new Set(want === 'faces-none' ? [] : all
          .filter((f) => want === 'faces-all' || (facesInOut(it).find((x) => x.key === f.key) || {}).outside === (want === 'faces-outside')).map((f) => f.key));
        buildProps(); renderOverlay();
        return;
      }
      case 'paint-side': {
        const v = b.dataset.v, io = facesInOut(it);
        faceSel = { id: it.id, keys: new Set(v === 'all' ? [] : io.filter((f) => f.outside === (v === 'out')).map((f) => f.key)) };
        buildProps(); renderOverlay();
        return;
      }
      case 'wside-all': {
        // the outside (or inside) faces of every wall on this floor get the picked faces' material and colour
        const io = facesInOut(it), src = it.faces && it.faces[pickedFaces(it)[0]];
        const mat = src || { wmat: it.wmat || 'plaster', wcol: it.wcol || WALLMATS.MATS[it.wmat || 'plaster'].color };
        let n = 0;
        for (const o of levelItems()) {
          if (o === it || o.locked || !window.FPWalls.isWall(o)) continue;
          const keys = facesInOut(o).filter((f) => f.outside === (b.dataset.v === 'out')).map((f) => f.key);
          if (!keys.length) continue;
          setFaces(o, keys, () => ({ ...mat })); n++;
        }
        void io;
        toast(n ? `${WALLMATS.MATS[mat.wmat].name} on the ${b.dataset.v === 'out' ? 'outside' : 'inside'} of ${n} more wall${n === 1 ? '' : 's'}.` : 'There are no other walls to change.');
        break;
      }
      case 'faces-reset': {
        const picked = pickedFaces(it);
        if (picked.length) setFaces(it, picked, () => null); else delete it.faces;
        toast(picked.length ? `${picked.length} face${picked.length === 1 ? '' : 's'} back to the wall's material.` : 'All faces use the wall material again.');
        break;
      }
      case 'wmat-all': {
        let n = 0;
        for (const o of levelItems()) {
          if (o === it || o.locked || !hasHeight(o.type)) continue;
          o.wmat = it.wmat || 'plaster'; o.wcol = it.wcol; n++;
        }
        toast(n ? `Applied ${WALLMATS.MATS[it.wmat || 'plaster'].name} to ${n} more wall${n === 1 ? '' : 's'}.` : 'There are no other walls to change.');
        break;
      }
      case 'front': case 'back': case 'forward': case 'backward': return arrange(b.dataset.do);
      case 'duplicate': return duplicate();
      case 'delete': return del();
    }
    render(); commit(); buildProps();
  });

  /* ───────────────────────── toolbar & file actions ───────────────────────── */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'undo': return undo();
      case 'redo': return redo();
      case 'zoom-in': return zoomAt(state.zoom * 1.25);
      case 'zoom-out': return zoomAt(state.zoom / 1.25);
      case 'zoom-reset': return zoomAt(1);
      case 'fit': return fit();
      case 'fill': return setTool('fill');
      case 'garden': return setTool('garden');
      case 'align-all': return alignAll();
      case 'adjust-house': return adjustHouse();
      case 'dims':
        state.showDims = !state.showDims;
        $('#btnDims').classList.toggle('on', state.showDims);
        $('#dimLayer').innerHTML = dimMarkup();
        save();
        if (state.showDims && !outlineForDims()) toast('Draw some walls first — the dimensions follow the outline of the walls.');
        return;
      case 'rotate': return rotateBy(90);
      case 'duplicate': return duplicate();
      case 'delete': return del();
      case 'new': return openNewPlan();
      case 'open': return $('#fileInput').click();
      case 'save': return download(`${fileName()}.json`, new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' }));
      case 'export-svg': return exportSVG();
      case 'export-png': return exportPNG();
      // a web page of the house in 3D to look round and walk through (js/sim3d.js, built by the 3D view)
      case 'export-3d':
        if (!state.items.length) return toast('The plan is empty — add some walls first.', 'error');
        if (window.FP3D && window.FP3D.exportSimulator) { toast('Making the 3D simulator…'); return window.FP3D.exportSimulator(); }
        return toast('The 3D view is not available.', 'error');
    }
  });

  $('#fileInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      load(JSON.parse(await f.text()));
      render(); buildProps(); renderView(); fit(); commit();
    } catch (err) {
      alert('Could not open this file: ' + err.message);
    }
  });

  $('#planTitle').addEventListener('input', (e) => { state.title = e.target.value; save(); });
  $('#tGrid').addEventListener('change', (e) => {
    state.showGrid = e.target.checked; renderView();
    // no grid shown: no snapping to it either (Snap is greyed out until the grid is back)
    $('#tSnap').disabled = !state.showGrid; $('#tSnap').closest('label').style.opacity = state.showGrid ? '' : '.45';
    toast(state.showGrid ? `Grid on${state.snap ? ' — objects snap to half a grid square (' + fmtLen(moveStep()) + ')' : ''}.` : 'Grid off — objects move freely (no snapping); walls still line up with the faces of other walls.');
  });
  $('#tSnap').addEventListener('change', (e) => { state.snap = e.target.checked; });
  if (state.showGrid === false) { $('#tSnap').disabled = true; $('#tSnap').closest('label').style.opacity = '.45'; }
  $('#tAlign').addEventListener('change', (e) => { state.align = e.target.checked; });
  // toolbar help: hovering over Grid, Other floors, Dimensions, Snap or Align shows a small bubble explaining it
  { const pop = $('#helpPop'); let cur = null, timer = 0;
    const show = (b) => {
      pop.innerHTML = `<b>${esc(b.dataset.helpTitle || '')}</b>${esc(b.dataset.help)}`;
      pop.hidden = false;
      const r = b.getBoundingClientRect(), w = Math.min(280, window.innerWidth - 16);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
      pop.style.top = (r.bottom + 8) + 'px';
    };
    const hide = () => { clearTimeout(timer); pop.hidden = true; cur = null; };
    document.addEventListener('mouseover', (e) => {
      const b = e.target.closest('[data-help]');
      if (b === cur) return;
      hide();
      if (b) { cur = b; timer = setTimeout(() => show(b), 250); }
    });
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    window.addEventListener('resize', hide);
  }
  // "Tidy up ▾" menu (its items are data-act buttons run by the toolbar handler)
  { const wrap = $('#tidyWrap'), btn = $('#btnTidy'), menu = $('#tidyMenu');
    if (wrap) {
      const set = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
      btn.addEventListener('click', (e) => { e.stopPropagation(); set(menu.hidden); });
      menu.addEventListener('click', () => setTimeout(() => set(false), 0));
      document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('#tidyWrap')) set(false); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) set(false); });
    } }
  $('#tFloors').addEventListener('change', (e) => { state.allFloors = e.target.checked; $('#refLayer').innerHTML = refWalls(); save(); });
  // the level chip in the status bar opens the level list (plan settings)
  $('#stLevel').addEventListener('click', () => { select(null); buildProps(); props.querySelector('.levels')?.scrollIntoView({ block: 'nearest' }); });

  const fileName = () => (state.title || 'floor-plan').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-') || 'floor-plan';
  // drawings of a multi-level plan carry the level name, e.g. "House-Basement.svg"
  const levelFileName = () => state.levels.length > 1
    ? `${fileName()}-${curLevel().name.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-')}` : fileName();
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const EXPORT_CSS =
    '.b{fill:var(--fill,#fff)}.k{fill:var(--kfill,currentColor)}.tx{fill:currentColor;stroke:none;font-family:Arial,Helvetica,sans-serif}' +
    '.item *{vector-effect:non-scaling-stroke}' +
    '.lbl{font-family:Arial,Helvetica,sans-serif;font-size:12px;fill:#333;text-anchor:middle;dominant-baseline:middle;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}';

  function buildExportSVG() {
    // SVG/PNG export the level being designed
    const items = levelItems();
    if (!items.length) { alert(`${curLevel().name} is empty — add some icons first.`); return null; }
    const b = bbox(items), pad = 30;
    const x = Math.floor(b.x - pad), y = Math.floor(b.y - pad), w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
    const labels = items.map(labelMarkup).join('').replace(/<text /g, '<text class="lbl" ');
    const body = items.map((it) => itemMarkup(it, true)).join('');
    const title = state.levels.length > 1 ? `${state.title} — ${curLevel().name}` : state.title;
    return {
      w, h,
      text: `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">` +
        `<title>${esc(title)}</title><style>${EXPORT_CSS}</style><defs>${cutMasks()}</defs>` +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${state.bg}"/>${body}${labels}</svg>`,
    };
  }
  function exportSVG() {
    const out = buildExportSVG();
    if (out) download(`${levelFileName()}.svg`, new Blob([out.text], { type: 'image/svg+xml' }));
  }
  function exportPNG() {
    const out = buildExportSVG();
    if (!out) return;
    const scale = 2;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([out.text], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = out.w * scale; c.height = out.h * scale;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => download(`${levelFileName()}.png`, blob), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('PNG export failed in this browser — try Export SVG instead.'); };
    img.src = url;
  }

  /* ───────────────────────── keyboard ───────────────────────── */
  document.addEventListener('keydown', (e) => {
    const typing = !!(e.target.closest && e.target.closest('input, textarea, select'));
    if (e.code === 'Space' && !typing) { spaceDown = true; svg.classList.add('space'); e.preventDefault(); return; }
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    const it = sel();
    const any = selIds().length > 0;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); return undo(); }
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); return redo(); }
    if (mod && k === 's') { e.preventDefault(); return document.querySelector('[data-act="save"]').click(); }
    if (mod && k === 'a') { e.preventDefault(); return setSelection(levelItems().map((i) => i.id)); }
    if (mod && k === 'd') { e.preventDefault(); return duplicate(); }
    if (mod && k === 'c' && any) { clipboard = sels().map((i) => ({ ...i })); return; }
    if (mod && k === 'v' && clipboard) {
      e.preventDefault();
      // pasting on another level keeps the exact position (e.g. basement walls under the ground-floor walls)
      const other = clipboard.some((c) => lvlOf(c) !== state.level);
      clipboard = duplicate(clipboard, other ? 0 : 20).map((i) => ({ ...i }));
      return;
    }
    if (k === 'escape') return state.tool ? setTool(state.tool) : select(null);
    if (k === 'f' && !mod) return setTool('fill');
    if (k === 'g' && !mod) return setTool('garden');
    if (!any) return;
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); return del(); }
    if (k === 'r' && !mod) return rotateBy(e.shiftKey ? -90 : 90);
    if (k === 'h' && !mod && it && !it.locked) { it.fx = !it.fx; render(); buildProps(); return commit(); }
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (arrows[k]) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      moveSelection(arrows[k][0] * step, arrows[k][1] * step);
      render(); syncPropFields(); renderOverlay(); commit();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; svg.classList.remove('space'); }
  });

  /* ───────────────────────── demo houses (top bar → Demo) ─────────────────────────
     A sample house from js/demo.js is built with the app's own tools (slab fill, room lining, floor fill, doors and
     windows fitted into their walls …), step by step, and the plan is kept after each step. Previous / Next / Play then
     show those steps; the objects a step adds appear one by one and stay selected, so it is clear what was built.
     Your own plan is set aside (not saved over) and comes back on Exit — or "Keep this house" makes the demo your plan. */
  // one step of a house (see js/demo.js for the ops)
  function demoOp(op) {
    const W = window.FPWalls;
    const wall = (x1, y1, x2, y2, t, ext = 0) => {
      const L = Math.hypot(x2 - x1, y2 - y1) || 1, len = L + 2 * ext, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const it = newItem('wall-h', cx, cy);
      Object.assign(it, { w: round(len, 1), h: t, t, x: round(cx - len / 2, 2), y: round(cy - t / 2, 2),
        r: normAngle(round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI, 2)) });
      state.items.push(it);
    };
    if (op.op === 'loop') op.pts.forEach((a, i) => { const b = op.pts[(i + 1) % op.pts.length]; wall(a[0], a[1], b[0], b[1], op.t, op.t / 2); });
    if (op.op === 'walls') op.list.forEach(([x1, y1, x2, y2]) => wall(x1, y1, x2, y2, op.t));
    if (op.op === 'slab') { state.slabKind = op.kind || 'concrete'; addRoomSlab({ x: op.at[0], y: op.at[1] }); }
    if (op.op === 'lining') op.at.forEach(([x, y]) => lineRoom({ x, y }));
    if (op.op === 'floor') op.at.forEach(([x, y, m]) => { state.lastFloor = { material: m || 'wood', fill: null }; fillFloorAt({ x, y }); });
    if (op.op === 'place') {
      for (const [type, x, y, r = 0, extra = {}] of op.list) {
        const ic = byId[type];
        if (!ic) continue;
        const it = newItem(type, x, y);
        if (ic.makes) it.type = ic.makes;
        if (ic.preset) Object.assign(it, ic.preset);
        Object.assign(it, extra, { r });
        it.x = round(x - it.w / 2, 2); it.y = round(y - it.h / 2, 2);
        if (ic.opening) {
          // its opening on the point given, then fitted into the wall there
          const ln = W.openingLine(it);
          if (ln) { it.x = round(it.x + x - ln.mid[0], 2); it.y = round(it.y + y - ln.mid[1], 2); }
          W.alignOpening(it, levelItems(), { fitWidth: false });
        }
        state.items.push(it);
      }
    }
    // design another storey from here on (its floor becomes the working height)
    if (op.op === 'level' && levelById(op.id)) { state.level = op.id; state.workZ = floorAbs(curLevel()); autoRef(); }
    // added the way the picker adds them (stairs climbing to the level above, a balcony with its door, a stairwell
    // cut in the slab …), then turned / sized as given, keeping the centre
    if (op.op === 'add') {
      for (const [type, x, y, r, extra = {}] of op.list) {
        if (!byId[type]) continue;
        const n0 = nextId;
        addItem(type, x, y);
        const it = state.items.find((i) => i.id === n0);
        if (!it) continue;
        // a stairwell over the stairs of the storey below: exactly their size (it.matchStairs)
        if (extra.matchStairs) {
          const L = curLevel(), below = storeyBelow(L);
          const st = below && state.items.find((i) => byId[i.type].stairs && lvlOf(i) === below.id && Math.abs(i.x + i.w / 2 - x) < 60 && Math.abs(i.y + i.h / 2 - y) < 120);
          if (st) Object.assign(it, { w: st.w, h: st.h, r: st.r || 0, x: st.x, y: st.y });
          const { matchStairs, ...rest } = extra; void matchStairs;
          Object.assign(it, rest);
          continue;
        }
        if (r != null || Object.keys(extra).length) {
          Object.assign(it, extra);
          if (r != null) it.r = r;
          if (byId[it.type].stairs) fitStairs(it);
          it.x = round(x - it.w / 2, 2); it.y = round(y - it.h / 2, 2);
          if (it.type === 'balcony') { fitBalcony(it); syncBalconyDoors(); }
        }
      }
    }
    if (op.op === 'roof') {
      const it = newItem(op.type, 0, 0), st = byId[op.type].roof;
      Object.assign(it, { x: op.x, y: op.y, w: op.w, h: op.h, r: op.r || 0, pitch: st === 'flat' ? 2 : st === 'shed' || st === 'butterfly' ? 10 : 30, overhang: 40 });
      if (op.pitch != null && st !== 'flat') it.pitch = op.pitch;
      if (op.roofMat && WALLMATS.ROOF_MATS[op.roofMat]) it.roofMat = op.roofMat;
      if (byId[op.type].roofFence && it.roofFence == null) it.roofFence = 50;
      it.roofMat = roofMatOf(it); it.fill = op.color || WALLMATS.ROOF_MATS[it.roofMat].color; // no roofZ: the eaves sit on the walls
      state.items.unshift(it); // roofs lie under everything on the plan
    }
    // the outside (or inside) faces of every wall of this storey in one material and colour
    if (op.op === 'paint') {
      for (const w of levelItems().filter((i) => window.FPWalls.isWall(i))) {
        const keys = facesInOut(w).filter((f) => f.outside === (op.side === 'out')).map((f) => f.key);
        if (keys.length) setFaces(w, keys, () => ({ wmat: op.wmat || 'plaster', wcol: op.wcol || WALLMATS.MATS[op.wmat || 'plaster'].color }));
      }
    }
  }
  function demoStart(house, onEdit = null) {
    clearTimeout(demo.anim); clearTimeout(demo.play); demo.play = 0;
    demo.onEdit = onEdit; // a house made by the House Building Wizard: "Change answers" goes back to it
    if (state.tool) setTool(state.tool);
    if (!demo.active) { demo.saved = serialize(); demo.hist = { hist, histIdx }; demo.prefs = { lastFloor: state.lastFloor, slabKind: state.slabKind }; }
    demo.active = true; demo.building = true;
    try {
      // its storeys (levels, wall height, slab thickness) as the house gives them; the 3D view shows the whole house
      load({ app: 'floorplan2027', version: 2, wall3m: true, title: `Demo — ${house.name}`, ground: house.ground || 'grass', items: [],
        levels: house.levels ? JSON.parse(JSON.stringify(house.levels)) : undefined, wallH: house.wallH, slabT: house.slabT, aboveGround: house.aboveGround || 0, hideAbove: false });
      state.workZ = floorAbs(curLevel());
      hist = []; histIdx = -1;
      // after each step: the plan, and the storey it was working on (the one shown on the plan for that step)
      const snaps = [JSON.stringify({ items: [], level: state.level })];
      for (const st of house.steps) { st.ops.forEach(demoOp); commit(); snaps.push(JSON.stringify({ items: state.items, level: state.level })); }
      demo.snaps = snaps;
    } catch (err) {
      demo.building = false;
      demoExit();
      toast(`Could not build the demo house: ${err.message}`, 'error');
      return;
    }
    demo.building = false;
    Object.assign(state, demo.prefs);
    demo.house = house;
    $('#demoPick').hidden = true;
    $('#demoBar').hidden = false;
    // frame the finished house, then start on the first step
    state.items = JSON.parse(demo.snaps[demo.snaps.length - 1]).items;
    demo.k = 0; demoBarUI(); // (the bar at its full height before measuring the room above it)
    render(); demoFrame();
    demoShow(0, true);
  }
  // zoom to the whole finished house in the part of the plan above the step bar
  function demoFrame() {
    const r = svg.getBoundingClientRect(), bar = $('#demoBar').getBoundingClientRect();
    const b = bbox(state.items), pad = 40, h = Math.max(120, bar.top - r.top - pad * 2 - 30); // (30: a longer step text)
    state.zoom = Math.min(4, Math.max(0.1, Math.min((r.width - pad * 2) / b.w, h / b.h)));
    state.panX = r.width / 2 - (b.x + b.w / 2) * state.zoom;
    state.panY = pad + h / 2 - (b.y + b.h / 2) * state.zoom;
    renderView();
  }
  // show step k (0 = the first): the plan as it was after that step; animate = its new objects appear one by one
  function demoShow(k, animate = false) {
    const n = demo.house.steps.length;
    k = Math.max(0, Math.min(n - 1, k));
    clearTimeout(demo.anim);
    demo.k = k;
    const S0 = JSON.parse(demo.snaps[k]), S1 = JSON.parse(demo.snaps[k + 1]), before = S0.items, after = S1.items;
    // the storey this step was built on
    if (state.level !== S1.level && levelById(S1.level)) { state.level = S1.level; state.workZ = floorAbs(curLevel()); autoRef(); }
    const had = new Set(before.map((i) => i.id)), added = after.filter((i) => !had.has(i.id) && lvlOf(i) === state.level);
    const shown = new Set(animate ? before.map((i) => i.id) : after.map((i) => i.id));
    // (objects added on other storeys in the same step appear at once)
    if (animate) after.forEach((i) => { if (!had.has(i.id) && lvlOf(i) !== state.level) shown.add(i.id); });
    let i = 0;
    const tick = () => {
      if (animate && i < added.length) shown.add(added[i++].id);
      state.items = after.filter((o) => shown.has(o.id)); // objects already there take their state after the step
      applySel(i >= added.length || !animate ? added.map((o) => o.id) : []);
      render(); refreshSelectionUI(); buildProps();
      if (animate && i < added.length) demo.anim = setTimeout(tick, Math.max(90, Math.min(400, 2000 / added.length)));
      else demoAfterStep();
    };
    tick();
    demoBarUI();
  }
  // a step finished drawing: Play goes on to the next one after a pause
  function demoAfterStep() {
    if (!demo.play) return;
    if (demo.k >= demo.house.steps.length - 1) { demoPlay(false); return; }
    demo.play = setTimeout(() => { if (demo.play) demoShow(demo.k + 1, true); }, 2600);
  }
  function demoPlay(on) {
    clearTimeout(demo.play);
    demo.play = on ? -1 : 0; // -1: playing, waiting for the step on screen to finish
    if (on) {
      if (demo.k >= demo.house.steps.length - 1) demoShow(0, true); // from the end: start again
      else demoShow(demo.k + 1, true);
    }
    demoBarUI();
  }
  function demoBarUI() {
    const h = demo.house, n = h.steps.length, st = h.steps[demo.k];
    $('#demoStep').textContent = `${h.name} · step ${demo.k + 1} of ${n}`;
    $('#demoTitle').textContent = st.title;
    $('#demoText').textContent = st.text;
    $('#demoDots').innerHTML = h.steps.map((s, i) =>
      `<button type="button" data-demo-step="${i}" class="${i === demo.k ? 'on' : i < demo.k ? 'done' : ''}" title="${esc(s.title)}" aria-label="Step ${i + 1}: ${esc(s.title)}">${i + 1}</button>`).join('');
    $('#demoBar [data-demo="prev"]').disabled = demo.k === 0;
    $('#demoBar [data-demo="next"]').disabled = demo.k >= n - 1;
    $('#demoPlayBtn').textContent = demo.play ? '❚❚ Pause' : demo.k >= n - 1 ? '↺ Replay' : '▶ Play';
    $('#demoBar [data-demo="edit"]').hidden = !demo.onEdit;
    $('#demoBar [data-demo="other"]').hidden = !!demo.onEdit;
  }
  // leave the demo: your own plan (and its undo history) comes back as it was
  function demoExit() {
    clearTimeout(demo.anim); clearTimeout(demo.play); demo.play = 0;
    if (!demo.active) return;
    try { load(demo.saved); } catch (e) { /* (the plan set aside is always one the app wrote) */ }
    if (demo.hist) { hist = demo.hist.hist; histIdx = demo.hist.histIdx; }
    if (demo.prefs) Object.assign(state, demo.prefs);
    demo.active = false; demo.house = null;
    $('#demoBar').hidden = true;
    render(); buildProps(); renderView(); fit(); updateButtons();
  }
  // keep the finished demo house as your plan (it replaces the plan that was open)
  function demoKeep() {
    let had = false;
    try { had = !!(demo.saved && demo.saved.items && demo.saved.items.length); } catch (e) { /* none */ }
    if (had && !confirm('Keep this demo house as your plan? It replaces the plan you had open — save that one first (File → Save) if you want it.')) return;
    clearTimeout(demo.anim); clearTimeout(demo.play); demo.play = 0;
    const house = demo.house;
    state.items = JSON.parse(demo.snaps[demo.snaps.length - 1]).items;
    state.title = house.name; $('#planTitle').value = state.title;
    demo.active = false; demo.house = null;
    $('#demoBar').hidden = true;
    hist = []; histIdx = -1;
    applySel([]); render(); buildProps(); fit(); commit();
    toast(`"${house.name}" is now your plan — every object can be changed.`);
  }
  // the picker: one card per house, with its outline drawn from the first step
  function openDemoPicker() {
    const houses = window.FP_DEMOS || [];
    $('#demoList').innerHTML = houses.map((h) => {
      const pts = (h.steps[0].ops.find((o) => o.op === 'loop') || { pts: [] }).pts;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), s = 72 / Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0, 1);
      const d = pts.length ? 'M' + pts.map(([x, y]) => `${round(8 + (x - x0) * s, 1)} ${round(8 + (y - y0) * s, 1)}`).join('L') + 'Z' : '';
      // a 3D picture of the finished house (h.thumb); the outline drawing stands in when there is none
      const outline = `<svg class="demo-outline" viewBox="0 0 88 88" width="72" height="72" aria-hidden="true"${h.thumb ? ' hidden' : ''}><path d="${d}" fill="var(--accent-soft)" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>`;
      return `<button type="button" class="demo-card" data-demo-house="${esc(h.id)}">
        ${h.thumb ? `<img class="demo-thumb" src="${esc(h.thumb)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">` : ''}${outline}
        <span><b>${esc(h.name)}</b><small>${esc(h.size)}</small><span class="demo-blurb">${esc(h.blurb)}</span><span class="demo-n">${h.steps.length} construction steps</span></span></button>`;
    }).join('');
    $('#demoPick').hidden = false;
    const first = $('#demoList .demo-card');
    if (first) first.focus();
  }
  $('#btnDemo').addEventListener('click', openDemoPicker);  $('#demoPick').addEventListener('click', (e) => {
    const card = e.target.closest('[data-demo-house]');
    if (card) { const h = (window.FP_DEMOS || []).find((x) => x.id === card.dataset.demoHouse); if (h) demoStart(h); return; }
    if (e.target.closest('[data-demo-cancel]') || e.target === e.currentTarget) $('#demoPick').hidden = true;
  });
  $('#demoPick').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); $('#demoPick').hidden = true; } });
  $('#demoBar').addEventListener('click', (e) => {
    if (!demo.house) return;
    const dot = e.target.closest('[data-demo-step]');
    if (dot) { demoPlay(false); return demoShow(+dot.dataset.demoStep, +dot.dataset.demoStep === demo.k + 1); }
    const b = e.target.closest('[data-demo]');
    if (!b) return;
    const a = b.dataset.demo;
    if (a === 'next') { demoPlay(false); demoShow(demo.k + 1, true); }
    if (a === 'prev') { demoPlay(false); demoShow(demo.k - 1); }
    if (a === 'play') demoPlay(!demo.play);
    if (a === 'keep') demoKeep();
    if (a === 'exit') demoExit();
    if (a === 'other') { demoPlay(false); openDemoPicker(); }
    if (a === 'edit' && demo.onEdit) { demoPlay(false); demo.onEdit(); }
  });

  /* ───────────────────────── API for the 3D view ───────────────────────── */
  window.FP = {
    byId, iconInner, iconViewBox, bbox,
    // House Building Wizard (js/wizard.js): build a house description step by step, as the demo houses are;
    // onEdit is called by its "Change answers" button
    demoBuild: (house, onEdit) => demoStart(house, onEdit),
    items: () => state.items,
    selectedId: () => state.selId,
    selectedIds: () => selIds(),
    // levels: [{ id, name, elev }] (elev relative to the ground floor), the one being designed, and an object's level
    levels: () => state.levels,
    currentLevel: () => curLevel(),
    storeyRise: (it) => storeyRise(it),
    // a prefab's objects as they would be placed (temporary ids, not in the plan), centred on 0,0, for the 3D preview
    prefabPreviewItems: (id) => {
      const pf = (window.FP_PREFABS || []).find((p) => p.id === id), save = nextId;
      if (!pf) return [];
      const items = prefabItems(pf, -pf.w / 2, -pf.h / 2).map((it, i) => ({ ...it, id: -100 - i }));
      nextId = save;
      return items;
    },
    stairRise: (it) => stairRise(it),
    // a level's finished floor relative to the level (the ground floor: the house's height above ground)
    floorRel: (id) => { const L = levelById(id); return L ? floorAbs(L) - L.elev : 0; },
    fitStairs: (it) => fitStairs(it),
    slabOpenings: (slab) => slabOpenings(slab),
    openingZ: (op) => openingZ(op),
    openingClosedBelow: (op) => openingClosedBelow(op),
    slabInfo: (slab) => slabInfo(slab),
    balconySides: (it) => balconySides(it),
    moveAxis: () => state.moveAxis,
    moveStep: () => (snapOn() ? moveStep() : 1), // the step (cm) a drag moves an object by
    mountAxisPad: (el) => mountAxisPad(el),
    raiseItem: (id, dz) => { const it = state.items.find((i) => i.id === id); if (!it || it.locked) return false; let z0; try { z0 = objectBottom(it); } catch (e) { return false; }
      if (!isFinite(z0) || !setItemZ(it, snapMove(z0 + dz))) { toast(`${itemName(it)} cannot be moved up or down — its height is set by how it is built.`, 'error'); return false; }
      render(); commit(); buildProps(); return true; },
    canRaise: (id) => { const it = state.items.find((i) => i.id === id); try { return !!(it && zTarget(it, objectBottom(it))); } catch (e) { return false; } },
    wheelResize: (id, dir, height) => wheelResize(state.items.find((i) => i.id === id), dir, height),
    moveItemTo: (id, x, y) => moveItemTo(id, x, y),
    slabGray: (slab) => slabGray(slab), // its grey on the plan when its level has several slabs (else null)
    slabUnder: (fl) => slabUnder(fl),
    slabPoly: (sl) => slabPoly(sl),
    basementOutline: () => basementOutline(),
    houseBase: (items) => houseBase(items),
    roofBase: (it) => roofBase(it),
    houseRing: () => houseRing(),
    objectBottom: (it) => objectBottom(it), zTarget: (it, z) => zTarget(it, z),
    groundLevelId: () => groundLevel().id,
    houseAboveGround: () => houseAboveGround(),
    gardenBase: (g) => gardenBase(g),
    // hide / show objects in 3D (ids; true = hide), and how many are hidden
    setHidden3D: (ids, hidden) => setHidden3D(ids, hidden),
    hiddenCount: () => state.items.filter((i) => i.hide3d).length,
    setSeeThrough3D: (ids, on) => setSeeThrough3D(ids, on),
    seeThroughCount: () => state.items.filter((i) => i.see3d).length,
    levelOf: (it) => lvlOf(it),
    // levels in 3D: is a level shown, hide/show one or set the shown ones, and "hide levels above the current one"
    levelShown3D: (l) => levelShown3D(l),
    esc: (s) => esc(s),
    setLevelHidden: (id, hidden) => setLevelHidden(id, hidden),
    setLevelsShown: (ids) => setLevelsShown(ids),
    hideAbove: () => state.hideAbove,
    setHideAbove: (v) => setHideAbove(v),
    toggleSelect: (id) => {
      const it = state.items.find((i) => i.id === id);
      if (it && lvlOf(it) !== state.level) { switchLevel(lvlOf(it)); select(id); return followBottom(id); }
      toggleSelect(id);
      followBottom(id);
    },
    toast: (text, kind) => toast(text, kind),
    plan: () => ({ title: state.title, wallH: state.wallH, fillGap: state.fillGap, ground: state.ground }),
    grounds: GROUNDS,
    setGround: (v) => {
      if (!GROUNDS.some(([k]) => k === v) || state.ground === v) return;
      state.ground = v;
      save(); notify('items');
      if (!selIds().length) buildProps();
    },
    floorArea: (it) => floorArea(it),
    download: (name, blob) => download(name, blob),
    fileName: () => fileName(),
    // give one face of a wall its own material (val = { wmat, wcol }), or null to go back to the wall's material
    setFace: (id, key, val) => {
      const it = state.items.find((i) => i.id === id);
      if (!it) return;
      setFaces(it, [key], () => val);
      render(); if (selIds().includes(id)) buildProps(); commit();
      const label = window.FPWalls.faceLabel(it, key);
      toast(val ? `Painted ${it.label || byId[it.type].name} · ${label} — ${WALLMATS.MATS[val.wmat].name}` : `${label} reset to the wall's material`);
    },
    // picking an object of another level (in 3D) switches to that level first
    select: (id) => {
      const it = id != null && state.items.find((i) => i.id === id);
      if (it && lvlOf(it) !== state.level) switchLevel(lvlOf(it));
      select(id);
      followBottom(id); // the Height bar moves to the bottom of the picked object
    },
    onChange: null,
    // Settings → Units: 'metric' | 'imperial' (everything is redrawn in the new units)
    units: () => UNITS,
    setUnits: (u) => {
      UNITS = u === 'imperial' ? 'imperial' : 'metric';
      try { localStorage.setItem('floorplan2027.units', UNITS); } catch (e) { /* storage unavailable */ }
      heightBarKey = ''; levelTabsKey = '';
      renderView(); render(); buildProps(); refreshSelectionUI(); updateStatus();
      unitTextIn(document.body);
      notify('items');
    },
    fmtLen: (cm) => fmtLen(cm),
    fmtElev: (cm) => fmtElev(cm),
  };

  /* A program error is shown (and kept in this browser's log, last 20) instead of the screen silently stopping; the
     plan itself is saved after every change, so nothing is lost. */
  const logError = (msg) => {
    try { const log = JSON.parse(localStorage.getItem('floorplan2027.errors') || '[]'); log.push({ t: new Date().toISOString(), msg: String(msg).slice(0, 300) }); localStorage.setItem('floorplan2027.errors', JSON.stringify(log.slice(-20))); } catch (e) { /* storage full */ }
    try { toast('Something went wrong (' + String(msg).slice(0, 120) + ') — your plan is saved; carry on, or reload the page if the screen looks wrong.', 'error'); } catch (e) { /* toast not ready */ }
  };
  window.addEventListener('error', (e) => { if (e && e.message && !/ResizeObserver/.test(e.message)) logError(e.message + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '')); });
  window.addEventListener('unhandledrejection', (e) => logError(e && e.reason && (e.reason.message || e.reason)));

  /* ───────────────────────── boot ───────────────────────── */
  mountAxisPad(wrap);
  buildPalette();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) load(saved);
  } catch (e) { /* ignore broken autosave */ }
  render();
  buildProps();
  renderView();
  if (state.items.length) fit();
  commit();
  updateButtons();
  window.addEventListener('resize', renderOverlay);

  /* Split lines between the side panels and the drawing: drag to set a panel's width (180 px … half the window),
     double-click for its standard width. The icon grid / properties reflow to the width. Remembered in this browser.
     side: +1 = the line is on the panel's right edge (icon panel), −1 = on its left edge (properties panel). */
  function splitter(split, panel, cssVar, key, side) {
    const layout = document.querySelector('.layout');
    const clampW = (w) => Math.round(Math.min(Math.max(180, window.innerWidth * 0.5), Math.max(180, w)));
    const setW = (w) => { if (w) layout.style.setProperty(cssVar, clampW(w) + 'px'); else layout.style.removeProperty(cssVar); };
    try { const w = +localStorage.getItem(key); if (w) setW(w); } catch (e) { /* storage unavailable */ }
    let start = null;
    // followed on the whole window while dragging (the pointer soon leaves the thin line)
    const move = (e) => {
      if (!start) return;
      setW(start.w + side * (e.clientX - start.x));
      window.dispatchEvent(new Event('resize')); // the plan and the 3D view follow the new size
    };
    const end = () => {
      if (!start) return;
      start = null; split.classList.remove('dragging'); document.body.classList.remove('resizing');
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      try { localStorage.setItem(key, String(Math.round(panel.getBoundingClientRect().width))); } catch (e) { /* storage unavailable */ }
    };
    split.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, w: panel.getBoundingClientRect().width };
      split.classList.add('dragging'); document.body.classList.add('resizing');
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
      e.preventDefault();
    });
    split.addEventListener('dblclick', () => {
      setW(0);
      try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
      window.dispatchEvent(new Event('resize'));
    });
  }
  splitter($('#splitLeft'), document.querySelector('.panel.left'), '--left-w', 'floorplan2027.leftWidth', 1);
  splitter($('#splitRight'), document.querySelector('.panel.right'), '--right-w', 'floorplan2027.rightWidth', -1);
})();
