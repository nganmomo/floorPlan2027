/* Floor Plan 2027 — 3D view
 * Builds a Three.js scene from the 2D plan. Units stay in centimetres.
 * Plan x -> 3D x, plan y -> 3D z, height -> 3D y.
 * Three.js is loaded from a CDN the first time the 3D view is opened.
 */
(function () {
  'use strict';

  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const ORBIT_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';
  const WALL_H = 300;      // full wall height (cm)
  const CUT_H = 110;       // wall height in "cut walls" mode
  const DOOR_H = 210;      // door / window head height
  const SILL_H = 90;       // window sill height
  const DEFAULT_STROKE = '#1f2328';

  const FP = window.FP;
  const $ = (s) => document.querySelector(s);
  const panel = $('#view3d');
  const host = $('#v3dHost');
  const msg = $('#v3dMsg');
  const btn = $('#btn3d');

  let T = null;            // THREE namespace once loaded
  let loading = null;
  let renderer, scene, camera, controls, root, sun, floor, grid;
  let contextLost = false;
  let PV = null; // the icon picker's 3D preview (see showIconPreview)
  const maxAniso = () => { const r = renderer || (PV && PV.r); return r ? r.capabilities.getMaxAnisotropy() : 1; };
  let isOpen = false;
  let raf = 0;
  let wallMode = 'full';
  let rebuildTimer = 0;
  const texCache = new Map(); // svg markup -> { tex, used }

  /* ───────────────────────── loading ───────────────────────── */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadThree() {
    if (!loading) {
      loading = (window.THREE ? Promise.resolve() : loadScript(THREE_URL))
        .then(() => (window.THREE.OrbitControls ? null : loadScript(ORBIT_URL)))
        .then(() => { T = window.THREE; });
      loading.catch(() => { loading = null; });
    }
    return loading;
  }

  /* ───────────────────────── open / close ───────────────────────── */
  async function open() {
    isOpen = true;
    panel.classList.add('open');
    btn.classList.add('on');
    showMsg('Loading 3D engine…');
    try {
      await loadThree();
    } catch (e) {
      showMsg('The 3D view needs an internet connection the first time it loads (Three.js is fetched from a CDN).');
      return;
    }
    if (!isOpen) return;
    if (!renderer) init();
    resize();
    rebuild();
    setView('persp');
    loop();
  }
  function close() {
    if (paint) setPaint(false);
    isOpen = false;
    panel.classList.remove('open');
    btn.classList.remove('on');
    cancelAnimationFrame(raf);
  }
  function showMsg(text) {
    msg.textContent = text || '';
    msg.classList.toggle('show', !!text);
  }

  btn.addEventListener('click', () => (isOpen ? close() : open()));
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v3d]');
    if (!b) return;
    const a = b.dataset.v3d;
    if (a === 'close') return close();
    if (a === 'paint') return setPaint(!paint);
    if (a === 'hide-sel') {
      const ids = FP.selectedIds();
      if (!ids.length) return FP.toast('Click objects in 3D to select them (Shift+click for several), then hide them.', 'error');
      FP.setHidden3D(ids, true);
      FP.select(null);
      return;
    }
    if (a === 'see-sel') {
      const ids = FP.selectedIds();
      if (!ids.length) return FP.toast('Click objects in 3D to select them (Shift+click for several), then make them see-through.', 'error');
      // all already see-through → back to solid; otherwise see-through
      const sel = FP.items().filter((i) => ids.includes(i.id));
      return FP.setSeeThrough3D(ids, !sel.every((i) => i.see3d));
    }
    if (a === 'sun') {
      sunOverhead = !sunOverhead;
      try { localStorage.setItem('floorplan2027.sunOverhead', sunOverhead ? '1' : '0'); } catch (e) { /* storage unavailable */ }
      placeSun();
      FP.toast(sunOverhead ? 'Light from above: each object\'s shadow falls straight under it, marking its place on the floor.' : 'Light back to the usual slanted sun.');
      return;
    }
    if (a === 'show-all') {
      FP.setSeeThrough3D(FP.items().filter((i) => i.see3d).map((i) => i.id), false);
      return FP.setHidden3D(FP.items().filter((i) => i.hide3d).map((i) => i.id), false);
    }
    if (a === 'persp' || a === 'top' || a === 'eye') {
      setView(a);
      panel.querySelectorAll('[data-v3d=persp],[data-v3d=top],[data-v3d=eye]').forEach((x) => x.classList.toggle('on', x === b));
    }
    if (a === 'walls-full' || a === 'walls-cut') {
      wallMode = a === 'walls-cut' ? 'cut' : 'full';
      panel.querySelectorAll('[data-v3d^=walls]').forEach((x) => x.classList.toggle('on', x === b));
      rebuild();
    }
  });
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea, select');
    if (isOpen && e.key === 'Escape' && !typing) {
      e.stopImmediatePropagation();
      if (paint) setPaint(false); else close();
    }
  }, true);

  // live update while the 3D view is open
  FP.onChange = (kind) => {
    if (!isOpen || !renderer) return;
    if (kind === 'select') return highlight();
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, 120);
  };

  /* ───────────────────────── scene setup ───────────────────────── */
  function init() {
    renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    /* The graphics card can drop the 3D view's drawing context (low graphics memory, a driver reset, the computer
       waking from sleep …): the 3D picture then goes black. Instead of staying black, the view waits for it to come
       back and rebuilds itself; the plan is not affected (it is saved all the time). */
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      contextLost = true;
      cancelAnimationFrame(raf);
      showMsg('The 3D view lost its graphics context (graphics memory or the driver) — restoring it…');
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      contextLost = false;
      // every texture was lost with the context: make them again
      [texCache, roofTexCache, wallTexCache, groundTexCache].forEach((c) => { c.forEach((v) => { const t = v && v.tex ? v.tex : v; if (t && t.dispose) t.dispose(); }); c.clear(); });
      if (typeof poolTileTex !== 'undefined' && poolTileTex) { poolTileTex.dispose(); poolTileTex = null; }
      showMsg('');
      if (isOpen) { rebuild(); loop(); }
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    scene = new T.Scene();
    scene.background = new T.Color('#1a1d23');
    camera = new T.PerspectiveCamera(45, 1, 5, 200000);
    controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.screenSpacePanning = true;

    scene.add(new T.HemisphereLight(0xffffff, 0xb9b3a8, 0.6));
    sun = new T.DirectionalLight(0xffffff, 0.45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);

    root = new T.Group();
    scene.add(root);

    new ResizeObserver(resize).observe(host);
    if (FP.mountAxisPad) FP.mountAxisPad(host); // the XY / Z move arrows, in the corner

    // click (without dragging) selects the object in the editor
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });

    /* The selected object can be handled with the mouse: press the left button on it and drag to slide it over the
       surface it stands on (it keeps its height above that floor); the mouse wheel on it makes it bigger / smaller
       (Shift + wheel: its height). Elsewhere the mouse still turns, pans and zooms the view. */
    let move = null;
    const selOne = () => { const ids = FP.selectedIds(); return ids.length === 1 ? FP.items().find((i) => i.id === ids[0]) : null; };
    const rayAt = (e) => {
      const r = renderer.domElement.getBoundingClientRect(), ray = new T.Raycaster();
      ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
      return ray;
    };
    host.addEventListener('pointerdown', (e) => {
      if (paint || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.target !== renderer.domElement) return;
      if (FP.moveAxis() === 'none') return; // moving switched off: a drag turns the view
      const it = selOne();
      if (!it) return;
      const hit = pick(e);
      if (!hit || hit.object.userData.id !== it.id) return;
      if (it.locked) { FP.toast(`${it.label || FP.byId[it.type].name} is locked — unlock it to move it${it.autoFit ? ' (or set its Area to "Manual")' : ''}.`, 'error'); return; }
      e.stopPropagation(); e.preventDefault();
      down = null; // not a click
      const parts = [];
      root.traverse((o) => { if (o.userData.id === it.id && !(o.parent && o.parent.userData.id === it.id)) parts.push({ o, p: o.position.clone() }); });
      const zMode = FP.moveAxis() === 'z';
      if (zMode && !FP.canRaise(it.id)) { FP.toast(`${it.label || FP.byId[it.type].name} cannot be moved up or down — its height is set by how it is built.`, 'error'); return; }
      // XY: slides on a level plane through the grabbed point; Z: up and down on an upright plane facing the camera
      let plane;
      if (zMode) {
        const n = new T.Vector3(); camera.getWorldDirection(n); n.y = 0;
        if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
        plane = new T.Plane().setFromNormalAndCoplanarPoint(n.normalize(), hit.point);
      } else plane = new T.Plane(new T.Vector3(0, 1, 0), -hit.point.y);
      move = { id: it.id, x0: it.x, y0: it.y, plane, z: zMode, start: hit.point.clone(), parts, dx: 0, dz: 0, dy: 0, pid: e.pointerId };
      controls.enabled = false;
      host.classList.add('moving');
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }, true);
    host.addEventListener('pointermove', (e) => {
      if (!move) return;
      const p = new T.Vector3();
      if (!rayAt(e).ray.intersectPlane(move.plane, p)) return;
      if (move.z) {
        const st = FP.moveStep ? FP.moveStep() : 1;
        move.dy = Math.round((p.y - move.start.y) / st) * st;
        for (const q of move.parts) q.o.position.set(q.p.x, q.p.y + move.dy, q.p.z);
        hint.textContent = `Moving ${move.dy >= 0 ? 'up' : 'down'} ${(Math.abs(move.dy) / 100).toFixed(2)} m (Z) — release to place it`;
        return;
      }
      const st = FP.moveStep ? FP.moveStep() : 1; // half a grid square a step (Snap on)
      move.dx = Math.round((p.x - move.start.x) / st) * st; move.dz = Math.round((p.z - move.start.z) / st) * st;
      for (const q of move.parts) q.o.position.set(q.p.x + move.dx, q.p.y, q.p.z + move.dz);
      hint.textContent = `Moving: ${(move.dx / 100).toFixed(2)} m across, ${(move.dz / 100).toFixed(2)} m down the plan — release to place it`;
    }, true);
    const endMove = () => {
      if (!move) return;
      const m = move; move = null;
      controls.enabled = true;
      host.classList.remove('moving');
      hint.textContent = hintText;
      if (m.z) { if (m.dy && !FP.raiseItem(m.id, m.dy)) rebuild(); }
      else if (m.dx || m.dz) FP.moveItemTo(m.id, m.x0 + m.dx, m.y0 + m.dz);
    };
    host.addEventListener('pointerup', endMove, true);
    host.addEventListener('pointercancel', endMove, true);
    host.addEventListener('wheel', (e) => {
      if (paint || move || e.ctrlKey || e.target !== renderer.domElement) return;
      const it = selOne();
      if (!it) return;
      const hit = pick(e);
      if (!hit || hit.object.userData.id !== it.id) return;
      e.preventDefault(); e.stopPropagation();
      FP.wheelResize(it.id, e.deltaY < 0 ? 1 : -1, e.shiftKey);
    }, { capture: true, passive: false });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const hit = pick(e);
      if (paint) return paintAt(hit);
      if (hit && (e.shiftKey || e.ctrlKey || e.metaKey)) FP.toggleSelect(hit.object.userData.id);
      else FP.select(hit ? hit.object.userData.id : null);
    });
  }

  // first object under the pointer
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
    /* Every face counts, seen from either side: the sides of extruded profiles and of mirrored objects (a negative
       scale turns their faces inside out for the ray) would otherwise let the ray pass straight through them. */
    const mats = new Map();
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && !mats.has(m)) mats.set(m, m.side);
    });
    mats.forEach((side, m) => { m.side = T.DoubleSide; });
    let hits;
    try { hits = ray.intersectObjects(root.children, true); } finally { mats.forEach((side, m) => { m.side = side; }); }
    // only what is drawn: not hidden objects or levels (the ray would hit them all the same), not invisible helpers
    const shown = (o) => { for (let q = o; q; q = q.parent) if (q.visible === false) return false; return true; };
    const solid = (h) => { const m = Array.isArray(h.object.material) ? h.object.material[h.face ? h.face.materialIndex : 0] : h.object.material;
      return !m || m.visible !== false && !(m.transparent && m.opacity < 0.05); };
    return hits.find((h) => h.object.isMesh && h.object.userData.id != null && !h.object.userData.noPick && shown(h.object) && solid(h)) || null;
  }

  /* ───────────────────────── paint wall faces ───────────────────────── */
  let paint = null; // { wmat, wcol, erase } while painting
  const paintBox = $('#v3dPaint'), paintMats = $('#v3dPaintMats'), paintCol = $('#v3dPaintCol');
  const hint = panel.querySelector('.v3d-hint'), hintText = hint.textContent;

  function setPaint(on) {
    paint = on ? paint || { wmat: 'brick', wcol: WM.MATS.brick.color, erase: false } : null;
    panel.querySelector('[data-v3d=paint]').classList.toggle('on', !!paint);
    paintBox.hidden = !paint;
    host.classList.toggle('painting', !!paint);
    hint.textContent = paint ? '🖌 Click the side of a wall to paint it · Esc to stop painting' : hintText;
    if (paint) drawPaintBox();
  }
  function drawPaintBox() {
    paintMats.innerHTML = Object.entries(WM.MATS).map(([k, m]) =>
      `<button data-pmat="${k}" class="${!paint.erase && paint.wmat === k ? 'on' : ''}" title="${m.name}"><img src="${WM.swatch(k)}" alt=""/><span>${m.name}</span></button>`).join('') +
      `<button data-pmat="erase" class="erase${paint.erase ? ' on' : ''}" title="Remove a face's own material (it goes back to the wall's material)"><span>Reset to wall</span></button>`;
    paintCol.value = paint.wcol;
    paintCol.disabled = paint.erase;
  }
  paintMats.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pmat]');
    if (!b) return;
    if (b.dataset.pmat === 'erase') paint.erase = true;
    else { paint.erase = false; paint.wmat = b.dataset.pmat; paint.wcol = WM.MATS[paint.wmat].color; }
    drawPaintBox();
  });
  paintCol.addEventListener('input', () => { paint.wcol = paintCol.value; });

  // the wall face under a raycast hit: { id, key } or null (only the two long sides of a wall can be painted)
  function faceOf(hit) {
    const wf = hit && hit.object.userData.wallFace;
    if (!wf || !hit.face) return null;
    const mi = hit.face.materialIndex;
    if (mi !== 4 && mi !== 5) return { id: wf.id, key: null };
    return { id: wf.id, key: window.FPWalls.faceKey(wf.seg, mi === 4 ? 1 : -1) };
  }
  function paintAt(hit) {
    const f = faceOf(hit);
    if (!f) return FP.toast('Only walls can be painted — click the side of a wall.', 'error');
    if (!f.key) return FP.toast('Click one of the two sides of the wall (not its top or end).', 'error');
    FP.setFace(f.id, f.key, paint.erase ? null : { wmat: paint.wmat, wcol: paint.wcol });
  }
  // show which face is under the pointer while painting
  let hoverRaf = 0;
  host.addEventListener('pointermove', (e) => {
    if (!paint || hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const f = faceOf(pick(e));
      const it = f && FP.items().find((i) => i.id === f.id);
      hint.textContent = it && f.key
        ? `🖌 ${it.label || FP.byId[it.type].name} · ${window.FPWalls.faceLabel(it, f.key)}`
        : '🖌 Click the side of a wall to paint it · Esc to stop painting';
    });
  });

  function resize() {
    if (!renderer) return;
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function loop() {
    cancelAnimationFrame(raf);
    const tick = () => {
      if (!isOpen || contextLost) return;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  // plan extent: the level being designed (or everything when it is empty); cy = that level's elevation
  /* Floors mode: 'level' = the level being designed (+ the Levels menu), 'all' = every floor at its real height,
     'exploded' = every floor, pulled apart by EXPLODE_GAP so each storey can be looked into */
  let floorsMode = 'level';
  const EXPLODE_GAP = 260;
  const shownLevels = () => [...FP.levels()]
    .filter((l) => (floorsMode === 'level' ? FP.levelShown3D(l) : !l.hide3d))
    .sort((a, b) => a.elev - b.elev);
  // height a level is drawn at (exploded: lifted a little more for each floor below it)
  const levelY = (L, shown = shownLevels()) => L.elev + (floorsMode === 'exploded' ? Math.max(0, shown.indexOf(L)) * EXPLODE_GAP : 0);

  function extent() {
    const cur = FP.currentLevel();
    const all = FP.items().filter((i) => !FP.byId[i.type].ownLabel);
    if (floorsMode !== 'level') {
      // the whole building: centre on its full height
      const shown = shownLevels(), wallH = FP.plan().wallH || WALL_H;
      const ys = shown.map((l) => levelY(l, shown));
      const lo = ys.length ? Math.min(...ys) : 0, hi = ys.length ? Math.max(...ys) + wallH : wallH;
      const b = all.length ? FP.bbox(all) : { x: -200, y: -200, w: 400, h: 400 };
      return { cx: b.x + b.w / 2, cy: (lo + hi) / 2, cz: b.y + b.h / 2, S: Math.max(b.w, b.h, (hi - lo) * 1.3, 300), b };
    }
    const mine = all.filter((i) => FP.levelOf(i) === cur.id);
    const items = mine.length ? mine : all;
    const b = items.length ? FP.bbox(items) : { x: -200, y: -200, w: 400, h: 400 };
    // tall walls need the camera further back (and looking a little higher)
    const tallest = Math.max(stdWallH(), ...items.filter((i) => i.wh || i.wz).map((i) => (i.wh || stdWallH()) + Math.max(0, i.wz || 0))); // a raised foot lifts the top
    return { cx: b.x + b.w / 2, cy: cur.elev + tallest * 0.3, cz: b.y + b.h / 2, S: Math.max(b.w, b.h, 300, tallest * 1.4), b };
  }

  // floating name tag of a floor ("Basement −2.80 m")
  function levelTag(text, x, y, z, size = 42) {
    const cv = document.createElement('canvas'), c = cv.getContext('2d');
    c.font = 'bold 40px system-ui, sans-serif';
    cv.width = Math.ceil(c.measureText(text).width) + 48; cv.height = 72;
    c.font = 'bold 40px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.92)'; c.strokeStyle = '#a5b4fc'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(14, 2); c.arcTo(cv.width - 2, 2, cv.width - 2, 70, 14); c.arcTo(cv.width - 2, 70, 2, 70, 14);
    c.arcTo(2, 70, 2, 2, 14); c.arcTo(2, 2, cv.width - 2, 2, 14); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#3730a3'; c.textBaseline = 'middle'; c.fillText(text, 24, 38);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(cv), depthTest: false, transparent: true }));
    sp.scale.set((cv.width / cv.height) * size, size, 1);
    sp.position.set(x, y, z);
    sp.renderOrder = 10;
    return sp;
  }

  const EYE_H = 200; // eye-level view: 2 m above the floor
  function setView(mode) {
    if (!camera) return;
    let { cx, cy, cz, S } = extent();
    if (floorsMode !== 'level') S *= floorsMode === 'exploded' ? 1.45 : 1.3; // the whole building (its height is in S), tags included
    else if ((FP.plan().ground || 'plain') !== 'plain' && cy >= 0) S *= 1.7; // step back to show the surroundings
    controls.maxPolarAngle = Math.PI / 2 - 0.03; // (not below the horizon)
    if (mode === 'eye') {
      /* Eye level: standing 2 m above the floor of the level being designed, looking straight ahead at the plan's
         middle — orbiting keeps that height; the view may tilt up (to see eaves, ceilings and the underside of
         stairs and roofs) */
      const cur = FP.currentLevel(), eye = levelY(cur) + (FP.floorRel ? FP.floorRel(cur.id) : 0) + EYE_H;
      const { b } = extent(), d = Math.max(b.w, b.h, 300) * 0.9 + 300;
      controls.maxPolarAngle = Math.PI * 0.85;
      controls.target.set(cx, eye, cz);
      camera.position.set(cx - d * 0.55, eye, cz + d * 0.85);
      controls.update();
      return;
    }
    controls.target.set(cx, cy, cz); // look at the level being designed
    if (mode === 'top') camera.position.set(cx, cy + S * 1.35, cz + 1);
    else camera.position.set(cx - S * 0.45, cy + S * 0.85, cz + S * 0.95);
    controls.update();
  }

  /* The Height-bar pointer moved: the view point (what the camera orbits around) jumps to that height at once. The
     camera moves up or down with it, so the viewing angle and distance stay the same. */
  function focusHeight(z) {
    if (!isOpen || !camera || !controls || !isFinite(z)) return;
    let y = z;
    if (floorsMode === 'exploded') {
      // drawn pulled apart: add the lift of the floor that holds this height
      const shown = shownLevels(), rel = (l) => l.elev + (FP.floorRel ? FP.floorRel(l.id) : 0);
      const L = [...shown].reverse().find((l) => rel(l) <= z + 0.5) || shown[0];
      if (L) y = z + levelY(L, shown) - L.elev;
    }
    const dy = y - controls.target.y;
    if (Math.abs(dy) < 0.01) return;
    controls.target.y += dy;
    camera.position.y += dy;
    controls.update();
  }
  window.FP3D = Object.assign(window.FP3D || {}, { focusHeight, viewPoint: () => controls && camera ? { target: controls.target.toArray(), camera: camera.position.toArray() } : null });

  /* ───────────────────────── build ───────────────────────── */
  function disposeTree(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach((m) => { if (m.isSpriteMaterial && m.map) m.map.dispose(); m.dispose(); });
    });
  }

  let roofCutTex = []; // height maps of the last roof trimming (freed on the next rebuild)
  function rebuild() {
    if (!renderer || contextLost) return;
    roofCutTex.forEach((t) => t.dispose()); roofCutTex = [];
    disposeTree(root);
    root.clear();
    if (floor) { scene.remove(floor); disposeTree(floor); floor = null; }
    if (grid) { scene.remove(grid); disposeTree(grid); grid = null; }
    texCache.forEach((v) => (v.used = false));

    const items = FP.items();
    TERR = makeTerrain();
    const groundId = FP.groundLevelId(), houseRing = TERR ? FP.houseRing() : null;
    // height above each floor where everything is sliced: only in "cut walls" mode (full walls = no limit)
    const wh = wallMode === 'cut' ? CUT_H : Infinity;
    // levels are stacked at their elevations; which ones show is set per level (and "hide levels above")
    const cur = FP.currentLevel(), shown = shownLevels();
    if (FP.levels().length < 2) floorsMode = 'level';
    for (const L of shown) {
      const lvItems = items.filter((it) => FP.levelOf(it) === L.id);
      if (!lvItems.length) continue;
      const lg = new T.Group();
      lg.position.y = levelY(L, shown);
      root.add(lg);
      // walls, openings and floor levels are worked out per level
      const model = window.FPWalls.analyze(lvItems);
      EL = window.FPWalls.elevationModel(lvItems, model);
      // each opening's outline carries the height of the slab it cuts (.z), so only the floor on that slab opens
      SLAB_HOLES = lvItems.filter((it) => it.type === 'slab-opening').map((op) => { const o = openingOutline(op); o.z = FP.openingZ ? FP.openingZ(op) : null; return o; })
        .concat(lvItems.filter((it) => (it.type === 'pool' || it.type === 'sewage-pit') && !it.hide3d).map(openingOutline)); // a pool / sump opens the floors / lawns over it
      LV_ITEMS = lvItems; LV_MODEL = model; // slabs rest on the walls of their level
      for (const it of lvItems) {
        if (it.hide3d) continue; // hidden in 3D (still on the plan)
        const host = model.hosts.get(it.id);
        const g = window.FPWalls.isWall(it) ? buildWall(it, model, wh) : buildItem(it, wh, host);
        // furniture, doors etc. stand on the finished floor; floors and columns place themselves
        if (g && (it.type === 'roof-window' || it.type === 'chimney')) g.position.y = 0; // it sits on the roof itself (its heights are worked out)
        else if (g && !window.FPWalls.isWall(it) && it.type !== 'floor' && it.type !== 'slab' && it.type !== 'gravel-path' && !FP.byId[it.type].roof && !/^column|^pillar/.test(it.type)) {
          g.position.y = baseOf(it) + (it.z || 0); // it.z: set higher than the floor (wall cabinets, shelves …)
          // a floor opening's railing stands on the slab the opening cuts (not on a lower floor under it)
          if (it.type === 'slab-opening' && FP.openingZ) g.position.y = FP.openingZ(it) - L.elev;
          // outdoors on the ground floor: on the slope of the terrain
          const cx0 = it.x + it.w / 2, cz0 = it.y + it.h / 2;
          if (TERR && L.id === groundId && it.type !== 'slab-opening' && !(houseRing && insidePoly(houseRing, cx0, cz0))) g.position.y += TERR.H(cx0, cz0);
        }
        if (g && it.type === 'slab') shadeSlab(g, it);
        // a balcony: its floor is the floor of its level (outside the house the ground would be lower)
        if (g && it.type === 'balcony') g.position.y = (FP.floorRel ? FP.floorRel(L.id) : 0) + (it.z || 0);
        if (g && it.see3d) seeThrough(g);
        if (g) lg.add(g);
        // the wall part around a door/window belongs to its wall: a hidden wall takes it along
        const hostWall = host && lvItems.find((i) => i.id === host.seg.id), wallHidden = !!(hostWall && hostWall.hide3d);
        // (a window in a hidden wall keeps its frame and glass)
        if ((host && (!wallHidden || WINDOW_TYPES.has(it.type))) || (!host && WINDOW_TYPES.has(it.type))) {
          const f = host ? buildFill(it, host, wh, wallHidden) : buildFreeWindow(it, wh);
          f.traverse((o) => { o.userData.id = it.id; });
          if (it.see3d || (hostWall && hostWall.see3d)) seeThrough(f); // see-through with its wall
          lg.add(f);
        }
      }
    }
    const whole = floorsMode !== 'level';
    // designing below ground: leave the ground surface out so the level is visible
    const underground = !whole && cur.elev < 0;
    // floor openings on the ground floor above a basement also cut through the ground surface
    const levels = FP.levels(), lowest = Math.min(...levels.map((l) => l.elev));
    const groundLevel = Math.min(...levels.filter((l) => l.elev >= 0).map((l) => l.elev));
    // (not an opening that a lower slab of its level closes off: no light through to the ground there)
    let groundHoles = lowest < 0 && floorsMode !== 'exploded' ? items.filter((it) => it.type === 'slab-opening' && !(FP.openingClosedBelow && FP.openingClosedBelow(it)) &&
      (levels.find((l) => l.id === FP.levelOf(it)) || {}).elev === groundLevel && (whole || groundLevel <= cur.elev)).map(openingOutline) : [];
    // the ground surface (lawn, street, paving …) stops at the outer border of the basement: what lies over the
    // basement is the building's own floor / slabs (or a garden area on a slab poured over it)
    const basement = lowest < 0 && floorsMode !== 'exploded' ? FP.basementOutline() : null;
    if (basement) {
      // floor openings inside the basement border are already open
      groundHoles = [basement, ...groundHoles.filter((h) => {
        const c = h.reduce((m, q) => [m[0] + q[0] / h.length, m[1] + q[1] / h.length], [0, 0]);
        return !insidePoly(basement, c[0], c[1]);
      })];
    }
    // pools on the ground floor open the ground surface (their coping covers the edge)
    if (!underground || whole) {
      const gl = FP.groundLevelId();
      // (a pool raised clear of the ground — on a terrace — leaves the ground whole)
      for (const pl of items.filter((it) => (it.type === 'pool' || it.type === 'sewage-pit') && !it.hide3d && FP.levelOf(it) === gl && !(it.type === 'pool' && (it.z || 0) >= (it.poolDepth || 150) + 8))) {
        const ring = openingOutline(pl), c = ring.reduce((m, q) => [m[0] + q[0] / 4, m[1] + q[1] / 4], [0, 0]);
        if (!basement || !insidePoly(basement, c[0], c[1])) groundHoles.push(ring);
      }
    }
    const basementShown = whole && shown.some((l) => l.elev < 0);
    // drop textures no longer used
    texCache.forEach((v, k) => { if (!v.used) { v.tex.dispose(); texCache.delete(k); } });

    // floor, grid and sun sized to the plan
    const { cx, cz, S, b } = extent();
    const kind = FP.plan().ground || 'plain';
    // yard, street and trees are laid out round the building AND the basement, so none of them end up over it
    let gb = b;
    if (basement) {
      const xs = basement.map((q) => q[0]).concat([b.x, b.x + b.w]), zs = basement.map((q) => q[1]).concat([b.y, b.y + b.h]);
      gb = { x: Math.min(...xs), y: Math.min(...zs), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...zs) - Math.min(...zs) };
    }
    if (TERR) {
      const t = TERR.box, X0 = Math.min(gb.x, t.x), Z0 = Math.min(gb.y, t.y);
      gb = { x: X0, y: Z0, w: Math.max(gb.x + gb.w, t.x + t.w) - X0, h: Math.max(gb.y + gb.h, t.y + t.h) - Z0 };
    }
    const gr = buildGround(underground ? 'plain' : kind, gb, groundHoles);
    floor = gr.group;
    if (underground) floor.visible = false;
    // whole building with a basement: the ground turns see-through so the basement shows below it
    if (basementShown) {
      floor.traverse((o) => {
        if (!o.isMesh || o.userData.veg || o.isInstancedMesh || o.geometry.type === 'ConeGeometry' || o.geometry.type === 'SphereGeometry' || o.geometry.type === 'CylinderGeometry') return;
        for (const m of [].concat(o.material)) { m.transparent = true; m.opacity = 0.8; m.depthWrite = false; }
        o.renderOrder = 5;
      });
    }
    scene.add(floor);
    // floor name tags
    if (whole && shown.length > 1) {
      const fmt = (e) => (e ? `${e > 0 ? '+' : '−'}${(Math.abs(e) / 100).toFixed(2)} m` : '±0.00 m');
      // beside the building's front-left corner, half-way up each floor, sized to the building
      const tagH = Math.max(40, S * 0.05), wallH = FP.plan().wallH || WALL_H;
      const hag = FP.houseAboveGround(), gl = [...FP.levels()].filter((l) => l.elev >= 0).sort((a, c) => a.elev - c.elev)[0];
      // the ground floor also says how high its finished floor is above the outside ground
      for (const L of shown) root.add(levelTag(`${L.name}  ${fmt(L.elev)}${L === gl && Math.abs(hag - L.elev) > 0.5 ? ` · floor ${fmt(hag)}` : ''}`, b.x - tagH * 2.5, levelY(L, shown) + wallH * 0.5, b.y + b.h + 40, tagH));
    }
    // no grid lines across a stairwell, or through a basement shown with all floors
    if ((kind === 'plain' && !groundHoles.length && !basementShown && !TERR) || underground) {
      const fw = b.w + 300, fh = b.h + 300, gs = Math.ceil(Math.max(fw, fh) / 100) * 100;
      grid = underground ? new T.GridHelper(gs, gs / 100, 0xddd7cc, 0xe8e3da) : new T.GridHelper(gs, gs / 100, 0x5f9a3e, 0x6ea94c); // on the lawn: darker green lines
      // below ground the grid lies on the floor of the lowest level shown (a split level 0.5 m lower included), so it
      // never cuts through a basement as a stray layer
      const gridY = underground ? Math.min(cur.elev, ...shown.map((l) => levelY(l, shown))) : 0;
      grid.position.set(cx, gridY - 0.3, cz);
      scene.add(grid);
    }
    scene.background.set(underground ? '#1a1d23' : '#dce8f2'); // a touch of sky outdoors
    groundSelect.value = kind;

    // shadows must reach the trees and the road too
    const SS = Math.max(S, gr.half);
    sunAt = { cx, cz, SS };
    placeSun();

    cutRoofOverlaps();
    showMsg(items.length ? '' : 'Your plan is empty — add some icons in the 2D view.');
    highlight();
  }

  /* Overlapping roofs (a cross gable, a wing meeting the main roof …): the part of a roof that lies inside another roof
     is not drawn, so the two meet in a clean valley instead of poking through each other. Each roof's top surface is
     sampled from above into a height map; the other roofs' materials then drop every point that is below that surface
     and above that roof's lowest edge, within its outline. */
  // a roof's height map (its top surface, one height per cell) as base64 float32, made once per map
  function heightsB64(h) {
    if (!h.b64) {
      const f = new Float32Array(h.N * h.N);
      for (let k = 0; k < f.length; k++) f[k] = h.data[k * 4];
      const bytes = new Uint8Array(f.buffer);
      let s = '';
      for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
      h.b64 = btoa(s);
    }
    return h.b64;
  }
  function cutRoofOverlaps() {
    const roofIds = new Set(FP.items().filter((i) => FP.byId[i.type] && FP.byId[i.type].roof && !i.hide3d).map((i) => i.id));
    if (roofIds.size < 2) return;
    root.updateMatrixWorld(true);
    const parts = new Map(); // roof id → its top-level objects
    root.traverse((o) => {
      const id = o.userData.id;
      if (id == null || !roofIds.has(id) || (o.parent && o.parent.userData.id === id)) return;
      let shown = true; for (let q = o; q; q = q.parent) if (q.visible === false) shown = false;
      if (shown) (parts.get(id) || parts.set(id, []).get(id)).push(o);
    });
    if (parts.size < 2) return;
    const box = new Map();
    parts.forEach((objs, id) => { const b = new T.Box3(); objs.forEach((o) => b.expandByObject(o)); if (!b.isEmpty()) box.set(id, b); });
    const overl = (a, b) => a.min.x < b.max.x && a.max.x > b.min.x && a.min.z < b.max.z && a.max.z > b.min.z && a.min.y < b.max.y && a.max.y > b.min.y;
    const linear = !!(renderer && renderer.extensions && renderer.extensions.get('OES_texture_float_linear'));
    const maps = new Map(); // roof id → { tex, rect, base } (made when first needed)
    const heightMap = (id) => {
      if (maps.has(id)) return maps.get(id);
      const b = box.get(id), sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
      const N = Math.max(16, Math.min(128, Math.ceil(Math.max(sx, sz) / 6)));
      const data = new Float32Array(N * N * 4), ray = new T.Raycaster(), meshes = [];
      parts.get(id).forEach((o) => o.traverse((m) => { if (m.isMesh && !(m.material && m.material.transparent)) meshes.push(m); }));
      const down = new T.Vector3(0, -1, 0), from = new T.Vector3();
      let low = Infinity; // the lowest point of its top surface: the eaves (under an overhang nothing is cut)
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        from.set(b.min.x + ((i + 0.5) / N) * sx, b.max.y + 20, b.min.z + ((j + 0.5) / N) * sz);
        ray.set(from, down);
        const hit = ray.intersectObjects(meshes, false)[0];
        const k = (j * N + i) * 4;
        data[k] = hit ? hit.point.y : -1e6; data[k + 3] = 1;
        if (hit && hit.point.y < low) low = hit.point.y;
      }
      const tex = new T.DataTexture(data, N, N, T.RGBAFormat, T.FloatType);
      tex.magFilter = tex.minFilter = linear ? T.LinearFilter : T.NearestFilter;
      tex.needsUpdate = true;
      roofCutTex.push(tex);
      const m = { tex, rect: new T.Vector4(b.min.x, b.min.z, b.max.x, b.max.z), base: isFinite(low) ? low - 2 : b.min.y, N, data };
      maps.set(id, m);
      return m;
    };
    parts.forEach((objs, id) => {
      const a = box.get(id);
      if (!a) return;
      // Roofs stacked to make an irregular roof: wherever one roof runs in under another one's planes, that part of it
      // is cut away, so the lower roof ends cleanly in a valley against the higher one. Only what lies UNDER another
      // roof's top surface goes: a roof's ridge or top that still rises above the other roof is never cut off,
      // whichever roof was added first. (Each pair trims each other this way; the higher roof only loses bits that
      // are buried inside the lower one, e.g. its eaves where they run into the lower roof.) The roofs that overlap
      // it the most come first (a material takes at most 4).
      const ov = (b) => Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)) * Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
      const others = [...box.keys()].filter((o) => o !== id && overl(a, box.get(o)))
        .sort((o1, o2) => ov(box.get(o2)) - ov(box.get(o1))).slice(0, 4)
        .map((o) => ({ ...heightMap(o), full: 0 }));
      if (!others.length) return;
      const n = others.length, done = new Map();
      const patch = (mat) => {
        if (!mat || done.has(mat)) return done.get(mat) || mat;
        const c = mat.clone();
        c.onBeforeCompile = (sh) => {
          others.forEach((h, k) => { sh.uniforms['uRcT' + k] = { value: h.tex }; sh.uniforms['uRcR' + k] = { value: h.rect }; sh.uniforms['uRcB' + k] = { value: h.base }; sh.uniforms['uRcF' + k] = { value: h.full }; });
          sh.vertexShader = 'varying vec3 vRcW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vRcW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
          let decl = 'varying vec3 vRcW;\n', test = '';
          for (let k = 0; k < n; k++) {
            decl += `uniform sampler2D uRcT${k};\nuniform vec4 uRcR${k};\nuniform float uRcB${k};\nuniform float uRcF${k};\n`;
            test += `{ vec4 r = uRcR${k}; if (vRcW.x > r.x && vRcW.x < r.z && vRcW.z > r.y && vRcW.z < r.w) {
              float h = texture2D(uRcT${k}, vec2((vRcW.x - r.x) / (r.z - r.x), (vRcW.z - r.y) / (r.w - r.y))).r;
              if (h > -1e5 && (vRcW.y < h - 1.0 || uRcF${k} > 0.5) && vRcW.y > uRcB${k} + 0.5) discard; } }\n`;
          }
          sh.fragmentShader = decl + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + test);
        };
        c.customProgramCacheKey = () => 'roofcut' + n + others.map((h) => h.full).join('');
        // the same trimming for the 3D simulator file (File → 3D simulator), which rebuilds it from this
        c.userData.roofCut = others.map((h) => ({ N: h.N, heights: heightsB64(h), rect: h.rect.toArray(), base: h.base, full: h.full }));
        done.set(mat, c);
        return c;
      };
      objs.forEach((o) => o.traverse((m) => { if (m.material) m.material = Array.isArray(m.material) ? m.material.map(patch) : patch(m.material); }));
    });
  }

  /* The sun: slanted (the usual view) or straight overhead — then every object's shadow falls right under it, so its
     place on the floor is easy to see (the "Light from above" switch; remembered in this browser). */
  let sunAt = null;
  let sunOverhead = (() => { try { return localStorage.getItem('floorplan2027.sunOverhead') === '1'; } catch (e) { return false; } })();
  function placeSun() {
    if (!sun || !sunAt) return;
    const { cx, cz, SS } = sunAt;
    if (sunOverhead) sun.position.set(cx + 0.01, SS * 2, cz + 0.01);
    else sun.position.set(cx - SS * 0.6, SS * 1.4, cz + SS * 0.5);
    sun.target.position.set(cx, 0, cz);
    sun.intensity = sunOverhead ? 0.6 : 0.45;
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -SS; sc.right = sc.top = SS;
    sc.near = 1; sc.far = SS * 5;
    sc.updateProjectionMatrix();
    const b = panel.querySelector('[data-v3d=sun]');
    if (b) { b.classList.toggle('on', sunOverhead); b.setAttribute('aria-pressed', String(sunOverhead)); }
  }
  /* Levels menu: a checkbox per level (highest first), quick "All" / "Only current", and "hide levels above" */
  const lvWrap = $('#v3dLevelsWrap'), lvMenu = $('#v3dLevels'), lvBtn = panel.querySelector('[data-v3d=levels]');
  // Floors switch: This floor / Whole house / Exploded
  const floorsSeg = $('#v3dFloors');
  floorsSeg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-floors]');
    if (!b || b.dataset.floors === floorsMode) return;
    floorsMode = b.dataset.floors;
    floorsSeg.querySelectorAll('[data-floors]').forEach((x) => x.classList.toggle('on', x === b));
    rebuild();
    setView(panel.querySelector('[data-v3d=top].on') ? 'top' : panel.querySelector('[data-v3d=eye].on') ? 'eye' : 'persp');
  });

  function updateLevelsMenu() {
    const levels = [...FP.levels()].sort((a, b) => b.elev - a.elev), cur = FP.currentLevel();
    lvWrap.hidden = levels.length < 2;
    floorsSeg.hidden = levels.length < 2;
    floorsSeg.querySelectorAll('[data-floors]').forEach((x) => x.classList.toggle('on', x.dataset.floors === floorsMode));
    if (levels.length < 2) return;
    const shown = shownLevels().length;
    $('#v3dLevelsLabel').textContent = `Levels ${shown}/${levels.length}`;
    const fmt = (e) => (e ? `${e > 0 ? '+' : '−'}${(Math.abs(e) / 100).toFixed(2)} m` : '±0.00 m');
    lvMenu.innerHTML = levels.map((l) => {
      const above = floorsMode === 'level' && FP.hideAbove() && l.elev > cur.elev + 0.01;
      return `<label class="${l.id === cur.id ? 'cur' : ''}" title="${above ? 'Above the level being designed — untick “Hide levels above” below to show it' : ''}">` +
        `<input type="checkbox" data-lv="${l.id}" ${!l.hide3d ? 'checked' : ''} ${above ? 'disabled' : ''}/><b>${FP.esc(l.name)}</b><span>${fmt(l.elev)}</span></label>`;
    }).join('') +
      `<div class="sep-line"></div><div class="quick"><button data-lv-all>Tick all</button><button data-lv-only>Only this floor</button></div>` +
      (floorsMode === 'level'
        ? `<div class="sep-line"></div><label class="opt"><input type="checkbox" data-lv-above ${FP.hideAbove() ? 'checked' : ''}/> Hide levels above the one being designed</label>`
        : `<div class="sep-line"></div><label class="opt" style="cursor:default">Showing ${floorsMode === 'all' ? 'the whole house' : 'the house pulled apart'} — untick a floor to leave it out.</label>`);
  }
  const setLvMenu = (open) => { lvMenu.hidden = !open; lvBtn.setAttribute('aria-expanded', String(open)); if (open) updateLevelsMenu(); };
  lvBtn.addEventListener('click', (e) => { e.stopPropagation(); setLvMenu(lvMenu.hidden); });
  lvMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-lv-all]')) { FP.setHideAbove(false); FP.setLevelsShown(FP.levels().map((l) => l.id)); }
    if (e.target.closest('[data-lv-only]')) FP.setLevelsShown([FP.currentLevel().id]);
    if (e.target.closest('[data-lv-all],[data-lv-only]')) setTimeout(updateLevelsMenu, 0);
  });
  lvMenu.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.lv) FP.setLevelHidden(t.dataset.lv, !t.checked);
    if (t.hasAttribute('data-lv-above')) FP.setHideAbove(t.checked);
    setTimeout(updateLevelsMenu, 0);
  });
  document.addEventListener('click', (e) => { if (!lvMenu.hidden && !e.target.closest('#v3dLevelsWrap')) setLvMenu(false); });

  // toolbar state: "Hide selected" needs a selection, "Show all (N)" appears when something is hidden
  function updateHideButtons() {
    updateLevelsMenu();
    const n = FP.hiddenCount(), see = FP.seeThroughCount(), btnAll = $('#v3dShowAll');
    btnAll.hidden = !n && !see;
    btnAll.textContent = `Show all (${[n && `${n} hidden`, see && `${see} see-through`].filter(Boolean).join(', ')})`;
    panel.querySelector('[data-v3d=hide-sel]').disabled = !FP.selectedIds().length;
    const seeBtn = panel.querySelector('[data-v3d=see-sel]'), selIt = FP.items().filter((i) => FP.selectedIds().includes(i.id));
    seeBtn.disabled = !selIt.length;
    seeBtn.classList.toggle('on', selIt.length > 0 && selIt.every((i) => i.see3d));
  }

  /* See-through: every material of the object becomes nearly transparent (its own copy — materials can be shared),
     without writing depth, so what is behind or inside it shows; it casts no shadow then. */
  function seeThrough(obj) {
    obj.traverse((o) => {
      if (!o.material) return;
      const mats = [].concat(o.material).map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = Math.min(c.opacity == null ? 1 : c.opacity, o.isLineSegments || o.isLine ? 0.18 : 0.2);
        c.depthWrite = false;
        return c;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
      o.castShadow = false;
      o.renderOrder = 3;
    });
  }

  function highlight() {
    updateHideButtons();
    const ids = new Set(FP.selectedIds());
    root.traverse((o) => {
      if (!o.isMesh || !o.material || o.userData.isTop) return;
      const on = ids.has(o.userData.id);
      for (const m of [].concat(o.material)) {
        if (!m.emissive) continue;
        m.emissive.set(on ? 0x1d4ed8 : 0x000000);
        m.emissiveIntensity = on ? 0.35 : 0;
      }
    });
  }

  /* Roof covering texture: one seamless repeat of the material in its colour (shared) */
  const roofTexCache = new Map();
  const roofDefaultMat = (style) => ({ flat: 'membrane', shed: 'standing-seam', butterfly: 'standing-seam', gambrel: 'shingles', mansard: 'slate', saltbox: 'wood-shakes', clerestory: 'wood-shakes' }[style] || 'clay-tiles');
  function roofTexture(id, color) {
    const key = id + '|' + color;
    if (!roofTexCache.has(key)) {
      const tile = WM.ROOF_MATS[id].tile;
      const tex = new T.CanvasTexture(WM.paintRoof(id, color, Math.min(8, 512 / Math.max(...tile))));
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.anisotropy = maxAniso();
      roofTexCache.set(key, tex);
    }
    return roofTexCache.get(key);
  }

  /* Wall material texture (one seamless repeat), shared by every wall using the same material + colour */
  const WM = window.FP_WALLMATS;
  const wallTexCache = new Map();
  const WALL_ROUGH = { plaster: 0.95, brick: 0.9, stone: 0.85, 'wood-slats': 0.7, 'wood-boards': 0.7, 'wood-frame': 0.8, concrete: 0.9, tiles: 0.35 };
  function wallTexture(id, color) {
    const key = id + '|' + color;
    if (!wallTexCache.has(key)) {
      const tile = WM.MATS[id].tile;
      const tex = new T.CanvasTexture(WM.paint(id, color, Math.min(8, 512 / Math.max(...tile))));
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.anisotropy = maxAniso();
      wallTexCache.set(key, tex);
    }
    return wallTexCache.get(key);
  }
  // UVs in centimetres / tile size, so a material keeps its real scale on any wall piece.
  // `off` shifts the box's local coordinates so neighbouring pieces line up seamlessly.
  // `tile` may be a function of the vertex index (boxes with a different material on each face)
  function planarUV(geo, tile, off = [0, 0, 0]) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    const tileOf = typeof tile === 'function' ? tile : () => tile;
    for (let i = 0; i < pos.count; i++) {
      const tl = tileOf(i);
      const x = pos.getX(i) + off[0], y = pos.getY(i) + off[1], z = pos.getZ(i) + off[2];
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
      const [u, v] = ny > 0.7 ? [x, z] : nx > nz ? [z, y] : [x, y];
      uv.setXY(i, u / tl[0], v / tl[1]);
    }
    uv.needsUpdate = true;
  }

  function materials(it) {
    const fill = it.fillNone ? '#f1f1f1' : it.fill;
    const customStroke = it.stroke.toLowerCase() !== DEFAULT_STROKE;
    const op = it.opacity < 1 ? { transparent: true, opacity: it.opacity } : {};
    const std = (color, extra = {}) => new T.MeshStandardMaterial({ color, roughness: 0.8, ...op, ...extra });
    const wm = WM.MATS[it.wmat] ? it.wmat : 'plaster';
    const wcol = it.wcol || (it.wmat ? WM.MATS[wm].color : customStroke ? it.stroke : WM.MATS.plaster.color);
    const wallMat = (id, color) => {
      const m = std('#ffffff', { roughness: WALL_ROUGH[id] != null ? WALL_ROUGH[id] : (WM.MATS[id].rough != null ? WM.MATS[id].rough : 0.85), map: wallTexture(id, color) });
      m.userData.tile = WM.MATS[id].tile;
      return m;
    };
    const wall = wallMat(wm, wcol);
    // material for one face of a wall piece: its own override, or the wall's main material
    const faceCache = new Map();
    const face = (seg, s) => {
      const f = it.faces && it.faces[window.FPWalls.faceKey(seg, s)];
      if (!f || !WM.MATS[f.wmat]) return wall;
      const k = f.wmat + '|' + (f.wcol || '');
      if (!faceCache.has(k)) faceCache.set(k, wallMat(f.wmat, f.wcol || WM.MATS[f.wmat].color));
      return faceCache.get(k);
    };
    return {
      face,
      body: std(fill),
      wall,
      glass: new T.MeshStandardMaterial({ color: '#a9d8f2', transparent: true, opacity: 0.35 * it.opacity, roughness: 0.05, metalness: 0.1, depthWrite: false }),
      // clear glass of glazed doors: very light, barely tinted, lit evenly so it never turns grey
      glassClear: new T.MeshStandardMaterial({ color: '#e8f6ff', emissive: '#bfe3f7', emissiveIntensity: 0.35, transparent: true, opacity: 0.16 * it.opacity, roughness: 0.05, metalness: 0, depthWrite: false, side: T.DoubleSide }),
      wood: std(it.leafColor || '#c9a27a'), // (a door's leaf: its own colour when set)
      slab: std(it.fillNone || it.fill === '#ffffff' || it.fill === '#ece9e4' ? '#d9d6d0' : it.fill, { roughness: 0.9 }), // concrete slab
      osb: std('#c9a66b', { roughness: 0.85 }),     // subfloor sheathing of a timber floor
      gypsum: std('#f1efea', { roughness: 0.95 }),  // ceiling board
      // garden
      timber: std('#a87b50', { roughness: 0.9 }),
      leaf: std('#4c8a3c', { roughness: 0.95 }),
      water: new T.MeshStandardMaterial({ color: '#3d9ad6', transparent: true, opacity: 0.8 * it.opacity, roughness: 0.08, metalness: 0.1 }),
      sand: std('#e6d29c', { roughness: 1 }),
      soil: std('#5a3f2c', { roughness: 1 }),
      roof: std('#7a3b22', { roughness: 0.8 }),
      pad: std('#2f6fd6', { roughness: 0.7 }),
      // window frames take the item's fill colour (white by default, e.g. brown for wooden frames)
      frame: std(it.frameColor || (it.fillNone ? '#f4f4f2' : it.fill), { roughness: 0.45 }),
      stone: std('#d9d3c7', { roughness: 0.7 }),
      dark: std('#2b2f36', { roughness: 0.4 }),
      metal: std('#b9bfc7', { roughness: 0.35, metalness: 0.5 }),
      steel: std('#d9dde2', { roughness: 0.22, metalness: 0.85 }), // brushed stainless steel (handrails)
      green: std('#5d9e57'),
      edge: new T.LineBasicMaterial({ color: customStroke ? it.stroke : '#4b4f57', transparent: true, opacity: 0.45 * it.opacity }),
      wallEdge: new T.LineBasicMaterial({ color: '#9b9486', transparent: true, opacity: it.opacity }),
    };
  }

  /* A box laid along a wall segment, from a to b (cm along the segment), in world space */
  // `mat` may be an array of 6 box materials (+x, −x, top, bottom, +n side, −n side); `face` marks a paintable wall piece
  /* Outline of a wall box that hides the seams where a wall is split around an opening:
     vertical edges only at real wall ends, top/bottom outlines only where asked. */
  // m.start / m.end: true = a real wall end (full height), [za, zb] = the side of an opening (only that height range)
  function wallOutline(L, H, th, m, base) {
    const x0 = -L / 2, x1 = L / 2, y0 = -H / 2, y1 = H / 2, z0 = -th / 2, z1 = th / 2, p = [];
    const seg = (a, b) => p.push(...a, ...b);
    for (const y of [m.top ? y1 : null, m.bottom ? y0 : null]) {
      if (y == null) continue;
      seg([x0, y, z0], [x1, y, z0]); seg([x0, y, z1], [x1, y, z1]);
      if (m.start === true) seg([x0, y, z0], [x0, y, z1]);
      if (m.end === true) seg([x1, y, z0], [x1, y, z1]);
    }
    for (const [x, on] of [[x0, m.start], [x1, m.end]]) {
      if (!on) continue;
      const ya = on === true ? y0 : Math.max(y0, on[0] - base - H / 2), yb = on === true ? y1 : Math.min(y1, on[1] - base - H / 2);
      if (yb - ya < 0.5) continue;
      seg([x, ya, z0], [x, yb, z0]); seg([x, ya, z1], [x, yb, z1]);
      if (on !== true) { seg([x, ya, z0], [x, ya, z1]); seg([x, yb, z0], [x, yb, z1]); } // sill / head lines across the reveal
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    return g;
  }

  function segBox(s, a, b, z0, z1, mat, edgeMat, thick = s.t, face = null, off = 0, edges = null) {
    const grp = new T.Group();
    const L = b - a, H = z1 - z0;
    if (L <= 0.1 || H <= 0.1) return grp;
    const geo = new T.BoxGeometry(L, H, thick);
    const mid = (a + b) / 2;
    const tileOf = Array.isArray(mat) ? (i) => mat[Math.floor(i / 4)].userData.tile : mat.userData.tile;
    if (Array.isArray(mat) || mat.userData.tile) planarUV(geo, tileOf, [mid, z0 + H / 2, 0]);
    // `off` shifts the box sideways (along the segment's normal), e.g. a window frame set into the wall
    grp.position.set(s.A[0] + s.u[0] * mid + s.n[0] * off, z0 + H / 2, s.A[1] + s.u[1] * mid + s.n[1] * off);
    grp.rotation.y = -Math.atan2(s.u[1], s.u[0]); // local +z = the segment's world normal
    const m = new T.Mesh(geo, mat);
    if (face) m.userData.wallFace = face;
    m.castShadow = !(Array.isArray(mat) ? mat[0] : mat).transparent;
    m.receiveShadow = true;
    grp.add(m);
    if (edgeMat) grp.add(new T.LineSegments(edges ? wallOutline(L, H, thick, edges, z0) : new T.EdgesGeometry(geo, 30), edgeMat));
    return grp;
  }

  // Walls are built from their centreline segments, with door/window openings cut out
  /* ───────────── ground / surroundings ─────────────
   * Textures are painted on canvases (one seamless repeat of `tile` cm) and repeated at real scale. */
  const groundSelect = $('#v3dGround');
  groundSelect.innerHTML = FP.grounds.map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
  groundSelect.addEventListener('change', () => {
    const wasPlain = (FP.plan().ground || 'plain') === 'plain';
    FP.setGround(groundSelect.value);
    // switching between plain and outdoor ground reframes the view once the scene is rebuilt
    if (wasPlain !== (groundSelect.value === 'plain')) setTimeout(() => setView('persp'), 200);
  });

  const GROUND_TEX = {
    grass: { tile: 150, paint(c, n, r) {
      c.fillStyle = '#4f9a2f'; c.fillRect(0, 0, n, n);
      const greens = ['#3f8a25', '#5fae3a', '#72c046', '#357a1f', '#4c9e2c', '#86cc55', '#2f6e1c'];
      c.lineWidth = 1.4;
      for (let i = 0; i < 18000; i++) {
        const x = r() * n, y = r() * n, l = 3 + r() * 6, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
        c.strokeStyle = greens[(r() * greens.length) | 0];
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
      }
    } },
    brush: { tile: 160, paint(c, n, r) {
      c.fillStyle = '#4a4a2c'; c.fillRect(0, 0, n, n);
      const tones = ['#3d4a25', '#5a6a32', '#6b5a36', '#2f3a1e', '#7a6a3e', '#4f6a2c', '#86753f'];
      for (let i = 0; i < 6500; i++) {
        c.fillStyle = tones[(r() * tones.length) | 0];
        c.globalAlpha = 0.55 + r() * 0.45;
        c.beginPath(); c.ellipse(r() * n, r() * n, 1.2 + r() * 3.2, 0.8 + r() * 1.8, r() * 3, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
    } },
    gravel: { tile: 80, paint(c, n, r) {
      c.fillStyle = '#b5ad9f'; c.fillRect(0, 0, n, n);
      const tones = ['#9c9486', '#cfc8bb', '#a89f90', '#e0dace', '#8b8476'];
      for (let i = 0; i < 7000; i++) {
        c.fillStyle = tones[(r() * tones.length) | 0];
        c.beginPath(); c.ellipse(r() * n, r() * n, 1 + r() * 2.6, 1 + r() * 2, r() * 3, 0, Math.PI * 2); c.fill();
      }
    } },
    paving: { tile: 200, paint(c, n, r) {
      c.fillStyle = '#9d988f'; c.fillRect(0, 0, n, n); // joints
      const k = 4, s = n / k;
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
        const v = 196 + ((r() * 18) | 0);
        c.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
        c.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      }
      c.globalAlpha = 0.08;
      for (let i = 0; i < 3000; i++) { c.fillStyle = r() > 0.5 ? '#000' : '#fff'; c.fillRect(r() * n, r() * n, 2, 2); }
      c.globalAlpha = 1;
    } },
    sidewalk: { tile: 150, paint(c, n, r) {
      c.fillStyle = '#a7a298'; c.fillRect(0, 0, n, n);
      const k = 2, s = n / k;
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
        const v = 188 + ((r() * 14) | 0);
        c.fillStyle = `rgb(${v},${v - 3},${v - 8})`; c.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      }
    } },
    asphalt: { tile: 150, paint(c, n, r) {
      c.fillStyle = '#4b4e53'; c.fillRect(0, 0, n, n);
      for (let i = 0; i < 14000; i++) {
        c.fillStyle = r() > 0.5 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.18)';
        c.fillRect(r() * n, r() * n, 1.5, 1.5);
      }
    } },
  };
  const groundTexCache = new Map();
  function groundTexture(kind) {
    if (!groundTexCache.has(kind)) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 512;
      let seed = kind.length * 977 + 7;
      GROUND_TEX[kind].paint(cv.getContext('2d'), 512, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
      const tex = new T.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.anisotropy = maxAniso();
      groundTexCache.set(kind, tex);
    }
    return groundTexCache.get(kind);
  }
  // a flat textured rectangle on the ground, centred at (x, z), at height y
  function groundRect(kind, w, d, x, z, y = -0.5) {
    const geo = new T.PlaneGeometry(w, d), uv = geo.attributes.uv, tile = GROUND_TEX[kind].tile;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile);
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ map: groundTexture(kind), roughness: 1 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    return m;
  }
  /* Timber-frame floor over any outline (pts, in the slab's own cm): subfloor sheathing on top, joists (5 cm, every
     40 cm) spanning the short side and cut to the outline, rim joists along every edge, trimmers round openings, and
     an optional ceiling board underneath (it.ceiling, default on). */
  function timberFloor(it, pts, z0, t, holes, m) {
    const g = new T.Group(), sub = 2.5, ceil = it.ceiling === false ? 0 : 1.5, jh = Math.max(4, t - sub - ceil), jz = z0 + ceil + jh / 2;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
    // a flat board with the openings cut out
    const board = (z, h, mat) => {
      const shape = new T.Shape(pts.map(([x, y]) => new T.Vector2(x, -y)));
      for (const hl of holes) shape.holes.push(new T.Path(hl.map(([x, y]) => new T.Vector2(x, -y))));
      const geo = new T.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2); geo.translate(0, z, 0);
      const mesh = new T.Mesh(geo, mat);
      mesh.add(new T.LineSegments(new T.EdgesGeometry(geo, 30), new T.LineBasicMaterial({ color: '#3a3d42', transparent: true, opacity: 0.35 })));
      return mesh;
    };
    g.add(board(z0 + t - sub, sub, m.osb));
    if (ceil) g.add(board(z0, ceil, m.gypsum));
    // joists span the shorter side of the outline; each is cut to the outline, and holes interrupt them
    const spanX = X1 - X0 <= Y1 - Y0;
    const boxes = holes.map((hl) => {
      const hx = hl.map((p) => p[0]), hy = hl.map((p) => p[1]);
      return { x0: Math.min(...hx), x1: Math.max(...hx), y0: Math.min(...hy), y1: Math.max(...hy) };
    });
    // stretches of the line (run coordinate = pos) inside the outline, in span coordinates
    const inside = (pos) => {
      const cuts = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const ra = spanX ? a[1] : a[0], rb = spanX ? b[1] : b[0], sa = spanX ? a[0] : a[1], sb = spanX ? b[0] : b[1];
        if ((ra - pos) * (rb - pos) < 0) cuts.push(sa + ((pos - ra) / (rb - ra)) * (sb - sa));
      }
      cuts.sort((p, q) => p - q);
      const out = [];
      for (let i = 0; i + 1 < cuts.length; i += 2) out.push([cuts[i], cuts[i + 1]]);
      return out;
    };
    const joist = (a, b, pos) => {
      if (b - a < 2) return;
      g.add(spanX ? box(b - a, jh, 5, (a + b) / 2, jz, pos, m.timber) : box(5, jh, b - a, pos, jz, (a + b) / 2, m.timber));
    };
    const r0 = spanX ? Y0 : X0, r1 = spanX ? Y1 : X1;
    for (let pos = r0 + 40; pos < r1 - 20; pos += 40) {   // (the rim joists cover the ends)
      let parts = inside(pos).map(([a, b]) => [a + 5, b - 5]);   // up to the rim joists
      for (const hb of boxes) {
        const [lo, hi] = spanX ? [hb.y0, hb.y1] : [hb.x0, hb.x1];   // the hole along the run
        const [c0, c1] = spanX ? [hb.x0, hb.x1] : [hb.y0, hb.y1];   // the hole across the span
        if (pos < lo - 2.5 || pos > hi + 2.5) continue;
        parts = parts.flatMap(([a, b]) => [[a, Math.min(b, c0)], [Math.max(a, c1), b]]).filter(([a, b]) => b - a > 1);
      }
      for (const [a, b] of parts) joist(a, b, pos);
    }
    // rim joists along every edge of the outline, set just inside it
    const area = pts.reduce((sum, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return sum + x * y2 - x2 * y; }, 0);
    const sgn = area > 0 ? 1 : -1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy * sgn, ny = ux * sgn;  // inward normal
      const rim = box(L, jh, 5, (a[0] + b[0]) / 2 + nx * 2.5, jz, (a[1] + b[1]) / 2 + ny * 2.5, m.timber);
      rim.rotation.y = -Math.atan2(uy, ux);
      g.add(rim);
    }
    // trimmers framing each opening
    for (const hb of boxes) {
      g.add(box(hb.x1 - hb.x0 + 10, jh, 5, (hb.x0 + hb.x1) / 2, jz, hb.y0 - 2.5, m.timber), box(hb.x1 - hb.x0 + 10, jh, 5, (hb.x0 + hb.x1) / 2, jz, hb.y1 + 2.5, m.timber));
      g.add(box(5, jh, hb.y1 - hb.y0, hb.x0 - 2.5, jz, (hb.y0 + hb.y1) / 2, m.timber), box(5, jh, hb.y1 - hb.y0, hb.x1 + 2.5, jz, (hb.y0 + hb.y1) / 2, m.timber));
    }
    return g;
  }

  /* ── Roofs ──
     Built in the roof's own frame: x along its width (the ridge), plan y across it (3D z); the eaves are on the walls'
     top (z0) at the wall line and run out by the overhang, dropping with the pitch. Gable ends are walled. */
  /* The fence round a flat roof (a roof terrace): along the closed ring `ring` ([x, y] corners, on the upstand), its
     foot at zb, its top rail it.roofFence (default 50 cm) above the roof surface zs. it.fenceStyle: 'rail' — metal
     posts, top and bottom rails and upright bars every 11 cm; 'glass' — posts, a top rail and glass panels; 'solid' —
     a rendered parapet wall with a coping. */
  function roofFence(it, ring, zb, zs) {
    const g = new T.Group(), fh = Math.max(20, Math.min(200, it.roofFence == null ? 50 : it.roofFence)), top = zs + fh;
    const st = it.fenceStyle || 'rail';
    const metal = new T.MeshStandardMaterial({ color: '#3b4148', metalness: 0.6, roughness: 0.35 });
    const glassM = new T.MeshStandardMaterial({ color: '#bfe3f2', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false, side: T.DoubleSide });
    const wallM = new T.MeshStandardMaterial({ color: '#e9e3d8', roughness: 0.95 });
    const capM = new T.MeshStandardMaterial({ color: '#cfc8bb', roughness: 0.85 });
    const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
    // a box running from (x1, y1) to (x2, y2) on the plan (x along the plan, y = depth), t thick, from za to zt high
    const run = (x1, y1, x2, y2, t, za, zt, m) => {
      const L = Math.hypot(x2 - x1, y2 - y1), b = sh(new T.Mesh(new T.BoxGeometry(L, zt - za, t), m));
      b.position.set((x1 + x2) / 2, (za + zt) / 2, (y1 + y2) / 2); b.rotation.y = -Math.atan2(y2 - y1, x2 - x1); return b;
    };
    const posts = [], bars = [];
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length], L = Math.hypot(x2 - x1, y2 - y1);
      if (L < 1) continue;
      if (st === 'solid') {
        g.add(run(x1, y1, x2, y2, 15, zb, top - 4, wallM), run(x1, y1, x2, y2, 21, top - 4, top, capM));
        continue;
      }
      const n = Math.max(1, Math.ceil(L / 150));
      for (let k = 0; k < n; k++) posts.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
      g.add(run(x1, y1, x2, y2, 5, top - 4, top, metal)); // the top rail
      if (st === 'glass') g.add(run(x1, y1, x2, y2, 1.2, zb + 6, top - 6, glassM));
      else {
        g.add(run(x1, y1, x2, y2, 3, zb + 6, zb + 9, metal)); // the bottom rail
        const m = Math.max(1, Math.round(L / 11));
        for (let k = 1; k < m; k++) bars.push([x1 + ((x2 - x1) * k) / m, y1 + ((y2 - y1) * k) / m]);
      }
    }
    if (posts.length) {
      const pm = new T.InstancedMesh(new T.BoxGeometry(5, top - zb, 5), metal, posts.length), d = new T.Object3D();
      posts.forEach(([x, y], i) => { d.position.set(x, (zb + top) / 2, y); d.updateMatrix(); pm.setMatrixAt(i, d.matrix); });
      pm.castShadow = true; g.add(pm);
    }
    if (bars.length) {
      const bm = new T.InstancedMesh(new T.CylinderGeometry(0.9, 0.9, top - 4 - (zb + 9), 6), metal, bars.length), d = new T.Object3D();
      bars.forEach(([x, y], i) => { d.position.set(x, (zb + 9 + top - 4) / 2, y); d.updateMatrix(); bm.setMatrixAt(i, d.matrix); });
      bm.castShadow = true; g.add(bm);
    }
    return g;
  }

  function buildRoof(it, W, D, z0) {
    const style = FP.byId[it.type].roof, ov = it.overhang == null ? 40 : it.overhang;
    const pitch = it.pitch == null ? (style === 'shed' || style === 'butterfly' ? 10 : 30) : it.pitch;
    const k = Math.tan((pitch * Math.PI) / 180), k65 = Math.tan((65 * Math.PI) / 180);
    const g = new T.Group();
    // the covering: a texture painted in its colour, laid along each roof plane (courses along the eaves)
    const RM = WM.ROOF_MATS, mid = RM[it.roofMat] ? it.roofMat : roofDefaultMat(style), rm = RM[mid];
    const roofTex = roofTexture(mid, it.fill || rm.color);
    const roofM = new T.MeshStandardMaterial({ map: roofTex, roughness: rm.rough, metalness: rm.metal, side: T.DoubleSide });
    roofM.userData.tile = rm.tile;
    const wallM = new T.MeshStandardMaterial({ color: '#efe9df', roughness: 0.95, side: T.DoubleSide });
    const trimM = new T.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.8 });
    const edgeM = new T.LineBasicMaterial({ color: '#2b2f36', transparent: true, opacity: 0.45 });
    // the roof's thickness: 10 … 20 cm (it.roofT, default 15); its underside light timber, its edge the trim colour
    const RT = Math.min(20, Math.max(10, it.roofT || 15));
    const soffitM = new T.MeshStandardMaterial({ color: '#e7dfd1', roughness: 0.9, side: T.DoubleSide });
    const fasciaM = new T.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.8, side: T.DoubleSide });
    // a flat polygon from points [x, height, y] (fan-triangulated; the points go round its edge)
    /* a hip roof with a corner taken out (style 'hip-l'): every plane is cut along the two lines of the part left out
       (notch = { nx, ny, sx, sy }: the part where sx·(x − nx) > 0 and sy·(y − ny) > 0 is removed) */
    let notch = null;
    const clipHalf = (pts, keep) => { // Sutherland–Hodgman: keep(p) ≥ 0 stays; points [x, z, y]
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], fa = keep(a), fb = keep(b);
        if (fa >= 0) out.push(a);
        if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      }
      return out;
    };
    const face = (pts, mat) => {
      if (notch) {
        const n = notch; notch = null;
        const p1 = clipHalf(pts, (p) => -n.sx * (p[0] - n.nx));                                     // beside the part left out
        const p2 = clipHalf(clipHalf(pts, (p) => n.sx * (p[0] - n.nx)), (p) => -n.sy * (p[2] - n.ny)); // in front of it
        for (const q of [p1, p2]) if (q.length >= 3 && Math.abs(T.ShapeUtils.area(q.map(([x, , y]) => new T.Vector2(x, y)))) > 1) face(q, mat);
        notch = n;
        return;
      }
      // a roof plane's thickness goes ON TOP: the plane drawn is its underside (resting on the walls); the covering
      // is laid the thickness higher
      const thick = mat === roofM && RT > 0 && style !== 'flat', base = pts;
      if (thick) pts = pts.map(([x, z, y]) => [x, z + RT, y]);
      // roof windows on this plane: holes cut through it (covering, underside and the lining of each hole)
      const holes = mat === roofM ? holesIn(base) : [];
      const pos = holes.length ? tris(pts, holes) : [];
      if (!holes.length) for (let i = 1; i + 1 < pts.length; i++) pos.push(...pts[0], ...pts[i], ...pts[i + 1]);
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      if (mat.map && mat.userData.tile) {
        // u along the plane's level direction (the eaves), v down its slope — in tile repeats
        const [tw, th] = mat.userData.tile, n = geo.attributes.normal;
        const nx = n.getX(0), ny = n.getY(0), nz = n.getZ(0);
        let d = [nx * ny, ny * ny - 1, nz * ny], dl = Math.hypot(...d);
        let e;
        if (dl < 1e-3) { d = [0, 0, 1]; e = [1, 0, 0]; } // level (flat roof): plan axes
        else { d = d.map((v) => v / dl); e = [d[1] * nz - d[2] * ny, d[2] * nx - d[0] * nz, d[0] * ny - d[1] * nx]; const el = Math.hypot(...e) || 1; e = e.map((v) => v / el); }
        const uv = [];
        for (let i = 0; i < pos.length; i += 3) uv.push((pos[i] * e[0] + pos[i + 1] * e[1] + pos[i + 2] * e[2]) / tw, (pos[i] * d[0] + pos[i + 1] * d[1] + pos[i + 2] * d[2]) / th);
        geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      }
      const mesh = new T.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.add(new T.LineSegments(new T.EdgesGeometry(geo, 1), edgeM));
      g.add(mesh);
      // a roof plane has its thickness (it.roofT): its underside (the soffit) the thickness lower, closed round the edge
      if (thick) { // (a flat roof's deck is its thickness)
        if (holes.length) plainPos(tris(base, holes), soffitM);  // the underside, with the same holes
        else plain(base.slice().reverse(), soffitM);            // the underside, where the plane was
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          plain([a, [a[0], a[1] - RT, a[2]], [b[0], b[1] - RT, b[2]], b], fasciaM);
        }
      }
      // the lining of each hole: from the covering down through the roof's thickness (a flat roof: through its deck)
      const lining = thick ? RT : style === 'flat' ? RT + 0.2 : 0;
      if (lining) for (const h of holes) {
        const zt = planeOf(pts);
        for (let i = 0; i < h.length; i++) {
          const [ax, ay] = h[i], [bx, by] = h[(i + 1) % h.length], za = zt(ax, ay), zb = zt(bx, by);
          plain([[ax, za, ay], [ax, za - lining, ay], [bx, zb - lining, by], [bx, zb, by]], fasciaM);
        }
      }
    };
    /* ── roof windows cut through the roof ──
       The roof windows standing on THIS roof (it is the topmost roof under their middle), as outlines in the roof's
       own frame, set in 3 cm from their frame so the curb covers the cut edge. */
    const winHoles = FP.items().filter((w) => w.type === 'roof-window' && !w.hide3d).filter((w) => {
      const c = window.FPWalls.toWorld(w)([w.w / 2, w.h / 2]);
      let best = null, bz = -Infinity;
      for (const rf of FP.items()) {
        if (!FP.byId[rf.type] || !FP.byId[rf.type].roof || rf.hide3d) continue;
        const z = roofTopAt(rf, c[0], c[1]);
        if (z != null && z > bz) { bz = z; best = rf; }
      }
      return best && best.id === it.id;
    }).map((w) => { const tf = window.FPWalls.toWorld(w), e = Math.min(3, w.w / 4, w.h / 4);
      return [[e, e], [w.w - e, e], [w.w - e, w.h - e], [e, w.h - e]].map((p) => toLocal(it, tf(p))); });
    // the holes lying wholly inside a roof plane (its points [x, z, y]), as [x, y] outlines
    function holesIn(poly) {
      if (!winHoles.length) return [];
      const ring = poly.map(([x, , y]) => [x, y]);
      return winHoles.filter((h) => h.every(([x, y]) => insidePoly(ring, x, y)));
    }
    // the height of a (non-vertical) plane through points [x, z, y], as a function of plan x, y
    function planeOf(pts) {
      const [a] = pts;
      let b = null, c = null;
      for (let i = 1; i < pts.length && !c; i++) for (let j = i + 1; j < pts.length && !c; j++) {
        const u = [pts[i][0] - a[0], pts[i][2] - a[2]], v = [pts[j][0] - a[0], pts[j][2] - a[2]];
        if (Math.abs(u[0] * v[1] - u[1] * v[0]) > 1) { b = pts[i]; c = pts[j]; }
      }
      if (!c) return () => a[1];
      const ux = b[0] - a[0], uy = b[2] - a[2], uz = b[1] - a[1], vx = c[0] - a[0], vy = c[2] - a[2], vz = c[1] - a[1], det = ux * vy - uy * vx;
      const gx = (uz * vy - vz * uy) / det, gy = (ux * vz - vx * uz) / det;
      return (x, y) => a[1] + gx * (x - a[0]) + gy * (y - a[2]);
    }
    // triangles (flat positions) of a plane polygon [x, z, y] with holes [x, y] cut out
    function tris(pts, holes) {
      const zt = planeOf(pts), V = (x, y) => new T.Vector2(x, y);
      const contour = pts.map(([x, , y]) => V(x, y)), hs = holes.map((h) => h.map(([x, y]) => V(x, y)));
      const all = contour.concat(...hs), pos = [];
      for (const f of T.ShapeUtils.triangulateShape(contour, hs)) for (const k of f) { const p = all[k]; pos.push(p.x, zt(p.x, p.y), p.y); }
      return pos;
    }
    function plainPos(pos, mat) {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const mesh = new T.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
    }
    // an untextured flat polygon (the underside and the edges of a roof plane)
    function plain(pts, mat) {
      const pos = [];
      for (let i = 1; i + 1 < pts.length; i++) pos.push(...pts[0], ...pts[i], ...pts[i + 1]);
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const mesh = new T.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
    }
    const X0 = -ov, X1 = W + ov, Y0 = -ov, Y1 = D + ov, he = z0 - k * ov; // eave edge, lower than the wall top by the overhang
    // steep (65°) slopes run out only a little past the walls, or their eaves would hang far down the walls
    const ovS = Math.min(ov, 12), SX0 = -ovS, SX1 = W + ovS, SY0 = -ovS, SY1 = D + ovS;
    const P = (x, z, y) => [x, z, y];
    // eave lines for the gutters: [x1, y1, x2, y2, height, outward x, outward y] (each runs along x or along y)
    const eaves = [];
    if (style === 'flat') {
      // a flat roof: a deck as thick as the roof, the covering on it, an upstand round the edge
      const deckM = new T.MeshStandardMaterial({ color: '#8b9097', roughness: 0.9 });
      const ft = RT + 0.2, up = RT + 8;
      const deckHoles = holesIn([[X0, 0, Y0], [X1, 0, Y0], [X1, 0, Y1], [X0, 0, Y1]]);
      if (!deckHoles.length) g.add(box(W + 2 * ov, RT, D + 2 * ov, W / 2, z0 + RT / 2, D / 2, deckM));
      else {
        // the deck with the roof windows' holes through it
        const sh = new T.Shape([[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]].map(([x, y]) => new T.Vector2(x, -y)));
        for (const h of deckHoles) sh.holes.push(new T.Path(h.map(([x, y]) => new T.Vector2(x, -y))));
        const geo = new T.ExtrudeGeometry(sh, { depth: RT, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); geo.translate(0, z0, 0);
        const m = new T.Mesh(geo, deckM); m.castShadow = true; m.receiveShadow = true; g.add(m);
      }
      face([P(X0, z0 + ft, Y1), P(X1, z0 + ft, Y1), P(X1, z0 + ft, Y0), P(X0, z0 + ft, Y0)], roofM); // the covering on the deck
      g.add(box(W + 2 * ov + 4, up, 4, W / 2, z0 + up / 2, Y0 - 2, trimM), box(W + 2 * ov + 4, up, 4, W / 2, z0 + up / 2, Y1 + 2, trimM),
        box(4, up, D + 2 * ov, X0 - 2, z0 + up / 2, D / 2, trimM), box(4, up, D + 2 * ov, X1 + 2, z0 + up / 2, D / 2, trimM));
      eaves.push([X0 - 4, Y1 + 4, X1 + 4, Y1 + 4, z0 + 4, 0, 1], [X0 - 4, Y0 - 4, X1 + 4, Y0 - 4, z0 + 4, 0, -1]);
      if (FP.byId[it.type].roofFence) g.add(roofFence(it, [[X0 - 2, Y0 - 2], [X1 + 2, Y0 - 2], [X1 + 2, Y1 + 2], [X0 - 2, Y1 + 2]], z0 + up, z0 + ft));
    } else if (style === 'shed') {
      // high at the back (y = 0), low at the front (y = D)
      const h = (y) => z0 + k * (D - y);
      face([P(X0, h(Y0), Y0), P(X1, h(Y0), Y0), P(X1, h(Y1), Y1), P(X0, h(Y1), Y1)], roofM);
      eaves.push([X0, Y1, X1, Y1, h(Y1), 0, 1]);
      for (const x of [0, W]) face([P(x, z0, 0), P(x, h(0), 0), P(x, z0, D)], wallM);
      face([P(0, z0, 0), P(W, z0, 0), P(W, h(0), 0), P(0, h(0), 0)], wallM);
    } else if (style === 'gable' || style === 'box-gable' || style === 'saltbox') {
      // ridge at yr; front slope to y = D, back slope to y = 0 (a saltbox, as on the plan: the ridge 35 % in from the
      // back — a short steep slope at the back, the long low slope at the front)
      const yr = style === 'saltbox' ? D * 0.35 : D / 2, zr = z0 + k * yr;
      const kb = (zr - z0) / yr, kf = (zr - z0) / (D - yr);
      const hb = z0 - kb * ov, hf = z0 - kf * ov;
      face([P(X0, hb, Y0), P(X1, hb, Y0), P(X1, zr, yr), P(X0, zr, yr)], roofM);
      face([P(X0, zr, yr), P(X1, zr, yr), P(X1, hf, Y1), P(X0, hf, Y1)], roofM);
      eaves.push([X0, Y0, X1, Y0, hb, 0, -1], [X0, Y1, X1, Y1, hf, 0, 1]);
      if (style === 'box-gable') {
        // the gable ends brought out flush with the roof edge, boxed underneath
        for (const x of [X0, X1]) face([P(x, hb, Y0), P(x, zr, yr), P(x, hf, Y1)], wallM);
        g.add(box(ov, 14, D + 2 * ov, X0 / 2, Math.min(hb, hf) - 7, D / 2, trimM), box(ov, 14, D + 2 * ov, W + ov / 2, Math.min(hb, hf) - 7, D / 2, trimM));
      } else for (const x of [0, W]) face([P(x, z0, 0), P(x, zr, yr), P(x, z0, D)], wallM);
    } else if (style === 'clerestory') {
      /* Saltbox with clerestory windows: the short back slope rises to the ridge line (35 % in from the back); the long
         front slope starts 0.5 m higher there (and reaches 20 cm back over it, shading the glass), and the upright
         band between the two is glazed along the middle 60 % — the rest is solid, carrying the upper slope. */
      const STEP = 50, yr = D * 0.35, zr = z0 + k * yr, zt = zr + STEP, kf = (zt - z0) / (D - yr), lip = 20;
      const hb = z0 - k * ov, hf = z0 - kf * ov;
      face([P(X0, hb, Y0), P(X1, hb, Y0), P(X1, zr, yr), P(X0, zr, yr)], roofM);
      face([P(X0, zt + kf * lip, yr - lip), P(X1, zt + kf * lip, yr - lip), P(X1, hf, Y1), P(X0, hf, Y1)], roofM);
      eaves.push([X0, Y0, X1, Y0, hb, 0, -1], [X0, Y1, X1, Y1, hf, 0, 1]);
      for (const x of [0, W]) face([P(x, z0, 0), P(x, zr, yr), P(x, zt, yr), P(x, z0, D)], wallM);  // the gable ends
      // the clerestory: from the top of the back slope up to the underside of the front slope, along the wall line
      const b0 = zr + (RT || 0), b1 = zt, bh = b1 - b0, TH = 12; // (TH: its thickness)
      if (bh > 4) {
        const glassM = new T.MeshStandardMaterial({ color: '#9fcbe4', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.45, side: T.DoubleSide });
        const frameM = new T.MeshStandardMaterial({ color: '#3b3f45', roughness: 0.45, metalness: 0.5 });
        const solid = (a, c) => { if (c - a > 0.5) g.add(box(c - a, bh, TH, (a + c) / 2, b0 + bh / 2, yr, wallM)); };
        const g0 = W * 0.2, g1 = W * 0.8, n = Math.max(1, Math.round((g1 - g0) / 120)), post = 8;
        solid(0, g0); solid(g1, W);                                                     // solid ends (60 % glazed in the middle)
        for (let i = 0; i < n; i++) {
          const a = g0 + ((g1 - g0) * i) / n, c = g0 + ((g1 - g0) * (i + 1)) / n;
          g.add(box(c - a, bh - 6, 1.5, (a + c) / 2, b0 + bh / 2, yr, glassM, null, false)); // a pane
          if (i) g.add(box(post, bh, TH, a, b0 + bh / 2, yr, frameM));                     // a post between panes
        }
        g.add(box(g1 - g0, 3, TH, (g0 + g1) / 2, b0 + 1.5, yr, frameM), box(g1 - g0, 3, TH, (g0 + g1) / 2, b1 - 1.5, yr, frameM)); // sill and head
      }
    } else if (style === 'hip' || style === 'hip-l' || style === 'mansard') {
      // hip over a rectangle [a..b] × [c..d] from height zb (eaves) — the mansard adds a steep lower band first
      const hip = (a, b, c, d, zb, e, kk) => {
        const w = b - a, dd = d - c, m = Math.min(w, dd) / 2, zr = zb + kk * m;
        const r = w >= dd ? [[a + m, c + dd / 2], [b - m, c + dd / 2]] : [[a + w / 2, c + m], [a + w / 2, d - m]];
        const [p1, p2] = r, E = (x, y) => P(x, zb - kk * e, y), A0 = a - e, B0 = b + e, C0 = c - e, D0 = d + e;
        if (w >= dd) {
          face([E(A0, D0), E(B0, D0), P(p2[0], zr, p2[1]), P(p1[0], zr, p1[1])], roofM);
          face([E(B0, C0), E(A0, C0), P(p1[0], zr, p1[1]), P(p2[0], zr, p2[1])], roofM);
          face([E(A0, C0), E(A0, D0), P(p1[0], zr, p1[1])], roofM);
          face([E(B0, D0), E(B0, C0), P(p2[0], zr, p2[1])], roofM);
        } else {
          face([E(A0, C0), E(A0, D0), P(p2[0], zr, p2[1]), P(p1[0], zr, p1[1])], roofM);
          face([E(B0, D0), E(B0, C0), P(p1[0], zr, p1[1]), P(p2[0], zr, p2[1])], roofM);
          face([E(B0, C0), E(A0, C0), P(p1[0], zr, p1[1])], roofM);
          face([E(A0, D0), E(B0, D0), P(p2[0], zr, p2[1])], roofM);
        }
      };
      if (style === 'hip-l') {
        // the ordinary hip roof over the whole rectangle, with one corner part simply taken away (another building
        // stands there): the planes are cut straight along the two lines of that part
        const Ls = window.FP_ROOFS.lShape(W, D, it), [nx, ny] = Ls.reflex;
        notch = { nx, ny, sx: Ls.corner[1] === 'r' ? 1 : -1, sy: Ls.corner[0] === 'b' ? 1 : -1 };
        hip(0, W, 0, D, z0, ov, k);
        const he2 = z0 - k * ov, n = notch;
        notch = null;
        // the eaves (gutters) outside the part left out: an eave on the side of that part keeps only its other end
        for (const e of [[X0, Y0, X1, Y0, he2, 0, -1], [X0, Y1, X1, Y1, he2, 0, 1], [X0, Y0, X0, Y1, he2, -1, 0], [X1, Y0, X1, Y1, he2, 1, 0]]) {
          if (e[1] === e[3]) { // along x
            if (n.sy * (e[1] - n.ny) <= 0) { eaves.push(e); continue; }
            const a = n.sx > 0 ? e[0] : n.nx, c = n.sx > 0 ? n.nx : e[2];
            if (c - a > 1) eaves.push([a, e[1], c, e[3], e[4], e[5], e[6]]);
          } else {             // along y
            if (n.sx * (e[0] - n.nx) <= 0) { eaves.push(e); continue; }
            const a = n.sy > 0 ? e[1] : n.ny, c = n.sy > 0 ? n.ny : e[3];
            if (c - a > 1) eaves.push([e[0], a, e[2], c, e[4], e[5], e[6]]);
          }
        }
      } else if (style === 'hip') {
        hip(0, W, 0, D, z0, ov, k);
        const he2 = z0 - k * ov;
        eaves.push([X0, Y0, X1, Y0, he2, 0, -1], [X0, Y1, X1, Y1, he2, 0, 1], [X0, Y0, X0, Y1, he2, -1, 0], [X1, Y0, X1, Y1, he2, 1, 0]);
      } else {
        const b = Math.min(W, D) * 0.2, zb = z0 + k65 * b, hl = z0 - k65 * ovS;
        const o = [[SX0, SY0], [SX1, SY0], [SX1, SY1], [SX0, SY1]], i = [[b, b], [W - b, b], [W - b, D - b], [b, D - b]];
        eaves.push([SX0, SY0, SX1, SY0, hl, 0, -1], [SX0, SY1, SX1, SY1, hl, 0, 1], [SX0, SY0, SX0, SY1, hl, -1, 0], [SX1, SY0, SX1, SY1, hl, 1, 0]);
        for (let n = 0; n < 4; n++) face([P(o[n][0], hl, o[n][1]), P(o[(n + 1) % 4][0], hl, o[(n + 1) % 4][1]), P(i[(n + 1) % 4][0], zb, i[(n + 1) % 4][1]), P(i[n][0], zb, i[n][1])], roofM);
        hip(b, W - b, b, D - b, zb, 0, Math.tan((Math.min(pitch, 25) * Math.PI) / 180)); // a low hip on top
      }
    } else if (style === 'gambrel') {
      // steep lower slopes to a break line, shallow upper ones to the ridge; walled gable ends
      const yb = D * 0.22, zb = z0 + k65 * yb, zr = zb + k * (D / 2 - yb), hl = z0 - k65 * ovS;
      face([P(X0, hl, SY0), P(X1, hl, SY0), P(X1, zb, yb), P(X0, zb, yb)], roofM);
      face([P(X0, zb, yb), P(X1, zb, yb), P(X1, zr, D / 2), P(X0, zr, D / 2)], roofM);
      face([P(X0, zr, D / 2), P(X1, zr, D / 2), P(X1, zb, D - yb), P(X0, zb, D - yb)], roofM);
      face([P(X0, zb, D - yb), P(X1, zb, D - yb), P(X1, hl, SY1), P(X0, hl, SY1)], roofM);
      eaves.push([X0, SY0, X1, SY0, hl, 0, -1], [X0, SY1, X1, SY1, hl, 0, 1]);
      for (const x of [0, W]) face([P(x, z0, 0), P(x, zb, yb), P(x, zr, D / 2), P(x, zb, D - yb), P(x, z0, D)], wallM);
    } else if (style === 'butterfly') {
      // a V: high at both eaves, the valley along the middle
      const zh = z0 + (k * D) / 2, hh = zh + k * ov;
      face([P(X0, hh, Y0), P(X1, hh, Y0), P(X1, z0, D / 2), P(X0, z0, D / 2)], roofM);
      face([P(X0, z0, D / 2), P(X1, z0, D / 2), P(X1, hh, Y1), P(X0, hh, Y1)], roofM);
      for (const x of [0, W]) { face([P(x, z0, 0), P(x, zh, 0), P(x, z0, D / 2)], wallM); face([P(x, z0, D / 2), P(x, zh, D), P(x, z0, D)], wallM); }
      for (const y of [0, D]) face([P(0, z0, y), P(W, z0, y), P(W, zh, y), P(0, zh, y)], wallM);
      eaves.push([X0, D / 2, X1, D / 2, z0 + 2, 0, 0]); // a box gutter in the valley
    }
    if (it.gutter) buildGutters(g, it, eaves, z0, style === 'flat' ? 0 : 5 - RT); // just under the top of the roof edge (the thickness is above the eaves)
    return g;
  }

  /* Roof gutters (it.gutter): a gutter channel under every eave edge and a downpipe at each end of it, running down to
     the outside ground. it.gutterColor colours them (white PVC by default). */
  function buildGutters(g, it, eaves, z0, drop = 0) {
    const col = it.gutterColor || '#ecebe7';
    const M = new T.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: /^#b0|^#b8|^#9c|^#c7/.test(col) ? 0.6 : 0.15 });
    const lv = FP.levels().find((l) => l.id === FP.levelOf(it)) || { elev: 0 };
    const ground = -lv.elev - 5;                         // the outside ground (±0), in the level's frame
    const GW = 12, GH = 10, T2 = 1.2;                    // channel width and depth, wall thickness
    const posts = new Map();
    for (const [x1, y1, x2, y2, h, nx, ny] of eaves) {
      const alongX = Math.abs(y2 - y1) < 0.01, len = Math.abs(alongX ? x2 - x1 : y2 - y1) + 4;
      const cx = (x1 + x2) / 2 + nx * (GW / 2 - 2), cy = (y1 + y2) / 2 + ny * (GW / 2 - 2), top = h - drop + 2, bot = top - GH;
      const B = (w, hh, d, x, y, z) => { const b = box(w, hh, d, x, y, z, M, null, false); b.castShadow = true; g.add(b); };
      if (alongX) {
        B(len, T2, GW, cx, bot + T2 / 2, cy);                       // the bottom
        B(len, GH, T2, cx, bot + GH / 2, cy - GW / 2);              // the two sides
        B(len, GH, T2, cx, bot + GH / 2, cy + GW / 2);
        for (const ex of [x1, x2]) B(T2, GH, GW, ex + (ex === x1 ? -2 : 2), bot + GH / 2, cy);  // end caps
      } else {
        B(GW, T2, len, cx, bot + T2 / 2, cy);
        B(T2, GH, len, cx - GW / 2, bot + GH / 2, cy);
        B(T2, GH, len, cx + GW / 2, bot + GH / 2, cy);
        for (const ey of [y1, y2]) B(GW, GH, T2, cx, bot + GH / 2, ey + (ey === y1 ? -2 : 2));
      }
      // downpipes at both ends (one per corner), set in a little from the ends
      for (const t of [0.04, 0.96]) {
        const px = alongX ? x1 + (x2 - x1) * t : cx, py = alongX ? cy : y1 + (y2 - y1) * t;
        const key = `${Math.round(px / 40)},${Math.round(py / 40)}`;
        if (posts.has(key)) continue;
        posts.set(key, true);
        const pipe = cyl(4, 4, bot - ground, px, (bot + ground) / 2, py, M, null, 12);
        pipe.castShadow = true; g.add(pipe);
        g.add(cyl(4, 4, 6, px, ground + 3, py + (alongX ? 0 : 0), M, null, 12)); // the shoe at the bottom
      }
    }
  }

  /* Gravel path along the item's length (x = 0 … w, width y = 0 … h), in its own frame. The ground under its middle
     line is sampled every 10 cm: where it is level enough the path is a gravel strip lying on the ground (both edges
     follow it); where the grade passes it.stepGrade % (default 10) it becomes stone steps of about 15 cm, each one
     standing on the ground below it. Heights are above the outside ground (the level is the ground floor). */
  function buildGravelPath(it) {
    const g = new T.Group(), W = it.w, D = it.h, tf = window.FPWalls.toWorld(it);
    const Hat = (lx, ly) => { if (!TERR) return 0; const [x, z] = tf([lx, ly]); return TERR.H(x, z); };
    const STEP = 10, n = Math.max(2, Math.ceil(W / STEP)), ds = W / n;
    const s = [], hc = [];
    for (let i = 0; i <= n; i++) { s.push(i * ds); hc.push(Hat(i * ds, D / 2)); }
    // steep where the grade over ~60 cm passes the limit
    const lim = (it.stepGrade == null ? 10 : it.stepGrade) / 100, win = Math.max(1, Math.round(30 / ds));
    const steep = s.map((_, i) => { const a = Math.max(0, i - win), b = Math.min(n, i + win); return Math.abs(hc[b] - hc[a]) / (s[b] - s[a] || 1) > lim; });
    // runs of the same kind
    const runs = [];
    for (let i = 0; i < n; i++) {
      const k = steep[i] || steep[i + 1];
      if (runs.length && runs[runs.length - 1].steep === k) runs[runs.length - 1].b = i + 1;
      else runs.push({ steep: k, a: i, b: i + 1 });
    }
    const gravelTex = groundTexture('gravel');
    const gravelM = new T.MeshStandardMaterial({ map: gravelTex, roughness: 1 });
    const edgeM = new T.MeshStandardMaterial({ color: '#7d766b', roughness: 0.95 });
    const stoneM = new T.MeshStandardMaterial({ color: '#a39b8f', roughness: 0.9 });
    let steps = 0;
    for (const r of runs) {
      if (!r.steep) {
        // a strip lying on the ground: both edges follow it, 2 cm above it
        const pos = [], uv = [], idx = [];
        for (let i = r.a; i <= r.b; i++) {
          const yL = Hat(s[i], 0) + 2, yR = Hat(s[i], D) + 2;
          pos.push(s[i], yL, 0, s[i], yR, D); uv.push(s[i] / 80, 0, s[i] / 80, D / 80);
          if (i > r.a) { const k = (i - r.a) * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
        }
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx); geo.computeVertexNormals();
        const m = new T.Mesh(geo, gravelM); m.receiveShadow = true; g.add(m);
        // low edging stones along both sides
        for (let i = r.a; i < r.b; i += 3) {
          const j = Math.min(r.b, i + 3), mid = (s[i] + s[j]) / 2, len = s[j] - s[i];
          for (const y of [2, D - 2]) g.add(box(len, 8, 5, mid, (Hat(s[i], y) + Hat(s[j], y)) / 2 + 3, y, edgeM, null, false));
        }
      } else {
        // steps: about 15 cm risers; each tread level, standing on the ground under it
        const h0 = hc[r.a], h1 = hc[r.b], rise = h1 - h0, nSteps = Math.max(1, Math.round(Math.abs(rise) / 15)), L = (s[r.b] - s[r.a]) / nSteps;
        for (let k = 0; k < nSteps; k++) {
          const xa = s[r.a] + k * L, xb = xa + L;
          // going up: each tread is the height reached at its far end; going down: at its near end
          const top = rise >= 0 ? h0 + ((k + 1) * rise) / nSteps : h0 + (k * rise) / nSteps;
          const low = Math.min(Hat(xa, D / 2), Hat(xb, D / 2), Hat(xa, 0), Hat(xb, D), top) - 8;
          const st = box(L + 2, top + 3 - low, D, (xa + xb) / 2, (top + 3 + low) / 2, D / 2, stoneM);
          st.castShadow = true; st.receiveShadow = true; g.add(st);
          steps++;
        }
      }
    }
    g.userData.steps = steps;
    return g;
  }

  /* Swimming pool in its own frame (water area 0 … w × 0 … h, the ground at y = 0): a tiled basin it.poolDepth deep,
     water 12 cm below the rim, 30 cm stone coping round it, entry steps at the left end, a ladder at the right. */
  let poolTileTex = null;
  /* Hide what lies below the ground outside a hole (x0..x1, z0..z1 in the group's own frame, at ground level):
     every fragment under the ground is kept only if the line of sight to it passes through the hole, so a pool or pit
     shows its inside when you look down into it, while its body under the lawn never shows — also through a ground
     made see-through to show a basement. Works for the perspective and the flat (orthographic) views. */
  function groundCut(g, x0, z0, x1, z1) {
    const U = { uInv: { value: new T.Matrix4() }, uCam: { value: new T.Vector3() }, uDir: { value: new T.Vector3() },
      uOrtho: { value: 0 }, uAbove: { value: 1 }, uG: { value: 0 }, uCut: { value: new T.Vector4(x0, z0, x1, z1) } };
    const v = new T.Vector3();
    const update = (renderer, scene, camera) => {
      U.uInv.value.copy(g.matrixWorld).invert();
      const wp = new T.Vector3().setFromMatrixPosition(g.matrixWorld);
      const gw = TERR ? TERR.H(wp.x + (x0 + x1) / 2, wp.z + (z0 + z1) / 2) : 0;
      U.uG.value = v.set(wp.x, gw, wp.z).applyMatrix4(U.uInv.value).y;
      U.uCam.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(U.uInv.value);
      camera.getWorldDirection(v); U.uDir.value.copy(v).transformDirection(U.uInv.value);
      U.uOrtho.value = camera.isOrthographicCamera ? 1 : 0;
      U.uAbove.value = camera.isOrthographicCamera ? 1 : (U.uCam.value.y > U.uG.value ? 1 : 0);
    };
    g.traverse((o) => {
      if (!o.isMesh && !o.isLine) return; // (box edge lines too)
      o.onBeforeRender = update;
      for (const m of [].concat(o.material)) {
        if (m.userData.gcut) continue;
        m.userData.gcut = true;
        m.onBeforeCompile = (sh) => {
          Object.assign(sh.uniforms, U);
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGcW;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvGcW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vGcW; uniform mat4 uInv; uniform vec3 uCam; uniform vec3 uDir; uniform float uOrtho; uniform float uAbove; uniform float uG; uniform vec4 uCut;`)
            .replace('void main() {', `void main() {
  { vec3 p = (uInv * vec4(vGcW, 1.0)).xyz;
    if (uAbove > 0.5 && p.y < uG - 0.5) {
      vec3 d = uOrtho > 0.5 ? uDir : p - uCam;
      if (d.y < -1e-4) { vec2 h = p.xz + (uG - p.y) * d.xz / d.y;
        if (h.x < uCut.x || h.x > uCut.z || h.y < uCut.y || h.y > uCut.w) discard; } } }`);
        };
        m.customProgramCacheKey = () => 'gcut';
      }
    });
  }

  function buildPool(it) {
    const g = new T.Group(), W = it.w, D = it.h, dep = it.poolDepth || 150, c = 30, wl = -12;
    if (!poolTileTex) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const x = cv.getContext('2d');
      x.fillStyle = '#5ab4dc'; x.fillRect(0, 0, 64, 64);
      x.fillStyle = '#e8f6fc'; x.fillRect(0, 0, 64, 3); x.fillRect(0, 0, 3, 64); // grout
      poolTileTex = new T.CanvasTexture(cv); poolTileTex.wrapS = poolTileTex.wrapT = T.RepeatWrapping;
    }
    // tiles at 12.5 cm: UVs scaled to the size of each basin face
    const tileM = (u, v) => { const t = poolTileTex.clone(); t.needsUpdate = true; t.repeat.set(u / 12.5, v / 12.5); return new T.MeshStandardMaterial({ map: t, roughness: 0.35 }); };
    const copeM = new T.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.85 });
    const metalM = new T.MeshStandardMaterial({ color: '#d9dee3', metalness: 0.85, roughness: 0.25 });
    const add = (m) => { m.receiveShadow = true; m.castShadow = true; g.add(m); return m; };
    // basin: floor and four walls (8 cm), down to the depth
    add(box(W, 8, D, W / 2, -dep - 4, D / 2, tileM(W, D), null, false));
    add(box(W, dep, 8, W / 2, -dep / 2, -4, tileM(W, dep), null, false));
    add(box(W, dep, 8, W / 2, -dep / 2, D + 4, tileM(W, dep), null, false));
    add(box(8, dep, D + 16, -4, -dep / 2, D / 2, tileM(D, dep), null, false));
    add(box(8, dep, D + 16, W + 4, -dep / 2, D / 2, tileM(D, dep), null, false));
    // raised above the ground: a solid rendered surround under the coping, down to the ground
    const lift = Math.min(dep + 8, Math.max(0, it.z || 0));
    if (lift > 1) {
      const shellM = new T.MeshStandardMaterial({ color: '#d8d2c6', roughness: 0.9 });
      add(box(W + 2 * c, lift, c, W / 2, -lift / 2, -c / 2, shellM)); add(box(W + 2 * c, lift, c, W / 2, -lift / 2, D + c / 2, shellM));
      add(box(c, lift, D, -c / 2, -lift / 2, D / 2, shellM)); add(box(c, lift, D, W + c / 2, -lift / 2, D / 2, shellM));
    }
    // stone coping round the rim
    add(box(W + 2 * c, 5, c, W / 2, 2.5, -c / 2, copeM)); add(box(W + 2 * c, 5, c, W / 2, 2.5, D + c / 2, copeM));
    add(box(c, 5, D, -c / 2, 2.5, D / 2, copeM)); add(box(c, 5, D, W + c / 2, 2.5, D / 2, copeM));
    // entry steps at the left end: three treads, each 30 cm deep, down to the floor
    if (it.poolSteps !== false) {
      const sd = Math.min(D, 160), risers = 4;
      for (let k = 1; k < risers; k++) {
        const top = -(dep * k) / risers;
        add(box(30, top + dep, sd, (k - 0.5) * 30, (top - dep) / 2, sd / 2, tileM(30, sd), null, false));
      }
    }
    // a stainless ladder at the right end: two curved rails and three rungs
    if (it.poolLadder !== false) {
      const lx = W - 18;
      for (const z of [D / 2 - 25, D / 2 + 25]) {
        const rail = add(new T.Mesh(new T.CylinderGeometry(2.2, 2.2, dep * 0.7 + 90, 10), metalM)); rail.position.set(lx, (90 - dep * 0.7) / 2, z);
        const bend = add(new T.Mesh(new T.TorusGeometry(18, 2.2, 8, 16, Math.PI), metalM)); bend.position.set(lx + 18, 90, z);
      }
      for (let k = 1; k <= 3; k++) { const rung = add(new T.Mesh(new T.CylinderGeometry(1.8, 1.8, 50, 8), metalM)); rung.rotation.x = Math.PI / 2; rung.position.set(lx - 1, -k * 28, D / 2); }
    }
    // water: clear, a little glossy
    const water = new T.Mesh(new T.PlaneGeometry(W, D), new T.MeshStandardMaterial({ color: it.fill || '#7cc6e8', transparent: true, opacity: 0.62, roughness: 0.05, metalness: 0.1, depthWrite: false }));
    water.rotation.x = -Math.PI / 2; water.position.set(W / 2, wl, D / 2); water.renderOrder = 4;
    g.add(water);
    groundCut(g, 0, 0, W, D);
    return g;
  }

  /* Sewage hole (pump sump) in the item's frame (x along w, z along h, y up from the floor it is set in):
     concrete walls (pitT) and base slab (pitBase) round a pit pitDepth deep below the floor, a submersible pump at
     the bottom near the left end, its discharge riser with a check valve, and the pipe leaving through the right
     wall (+x) towards the street sewer. Cover: 'grate' (steel grating), 'plate' (checker plate) or 'open'. */
  function buildSewagePit(it) {
    const g = new T.Group(), W = it.w, D = it.h, dep = it.pitDepth || 120;
    const t = Math.max(5, Math.min(it.pitT || 15, W / 3, D / 3)), bt = it.pitBase || 15;
    const iw = W - 2 * t, id = D - 2 * t;
    const conc = new T.MeshStandardMaterial({ color: it.fill || '#bdbab3', roughness: 0.95 });
    const steel = new T.MeshStandardMaterial({ color: '#7b828a', metalness: 0.7, roughness: 0.45 });
    const pump = new T.MeshStandardMaterial({ color: '#2b5f9e', metalness: 0.3, roughness: 0.5 });
    const pipe = new T.MeshStandardMaterial({ color: '#c2410c', roughness: 0.6 }); // PVC sewer pipe
    const water = new T.MeshStandardMaterial({ color: '#4a5a4f', transparent: true, opacity: 0.75, roughness: 0.1, depthWrite: false });
    const add = (m) => { m.castShadow = !m.material.transparent; m.receiveShadow = true; g.add(m); return m; };
    // concrete walls up to the floor, base slab under the pit
    add(box(W, dep + bt, t, W / 2, -(dep + bt) / 2, t / 2, conc));
    add(box(W, dep + bt, t, W / 2, -(dep + bt) / 2, D - t / 2, conc));
    add(box(t, dep + bt, id, t / 2, -(dep + bt) / 2, D / 2, conc));
    add(box(t, dep + bt, id, W - t / 2, -(dep + bt) / 2, D / 2, conc));
    add(box(iw, bt, id, W / 2, -dep - bt / 2, D / 2, conc));
    // a little standing water
    const wl = Math.min(dep * 0.25, 25);
    const wm = new T.Mesh(new T.PlaneGeometry(iw, id), water); wm.rotation.x = -Math.PI / 2; wm.position.set(W / 2, -dep + wl, D / 2); wm.renderOrder = 4; g.add(wm);
    // submersible pump on the floor of the pit, near the left end
    const r = Math.max(6, Math.min(12, iw / 5, id / 4)), px = t + r + 4, pz = D / 2, ph = Math.min(40, dep * 0.45);
    const body = add(new T.Mesh(new T.CylinderGeometry(r, r, ph, 18), pump)); body.position.set(px, -dep + ph / 2, pz);
    const cap = add(new T.Mesh(new T.CylinderGeometry(r * 0.6, r, 6, 18), pump)); cap.position.set(px, -dep + ph + 3, pz);
    // discharge: riser from the pump to 30 cm under the floor, a bend, then out through the right wall
    const pr = 3.2, yOut = -Math.min(30, dep * 0.4), rise = yOut - (-dep + ph + 6);
    if (rise > 2) { const up = add(new T.Mesh(new T.CylinderGeometry(pr, pr, rise, 12), pipe)); up.position.set(px, -dep + ph + 6 + rise / 2, pz); }
    const valve = add(new T.Mesh(new T.BoxGeometry(10, 8, 9), steel)); valve.position.set(px, -dep + ph + 6 + Math.max(4, rise * 0.4), pz); // check valve
    const elbow = add(new T.Mesh(new T.SphereGeometry(pr * 1.3, 12, 8), pipe)); elbow.position.set(px, yOut, pz);
    const run = W - px + 60; // 60 cm beyond the pit, on its way to the sewer
    const out = add(new T.Mesh(new T.CylinderGeometry(pr, pr, run, 12), pipe)); out.rotation.z = Math.PI / 2; out.position.set(px + run / 2, yOut, pz);
    // cover at floor level
    const cover = it.pitCover || 'grate';
    if (cover === 'plate') add(box(iw + 4, 1.2, id + 4, W / 2, 0.6, D / 2, steel));
    else if (cover === 'grate') {
      add(box(iw + 4, 3, 3, W / 2, -1.5, t - 1.5, steel, null, false)); add(box(iw + 4, 3, 3, W / 2, -1.5, D - t + 1.5, steel, null, false));
      for (let x = t + 3; x <= W - t - 1; x += 4) add(box(0.8, 3, id, x, -1.5, D / 2, steel, null, false));
      for (const z of [D / 2 - id / 4, D / 2 + id / 4]) add(box(iw, 1, 1, W / 2, -2.5, z, steel, null, false));
    }
    return g;
  }

  // open or shut: it.doorOpen, else how each kind is drawn by default (sliding and garage doors shut, the others open)
  const DOOR_SHUT_DEFAULT = new Set(['door-sliding', 'garage-door']);
  const doorIsOpen = (it) => (it.doorOpen != null ? !!it.doorOpen : !DOOR_SHUT_DEFAULT.has(it.type));
  /* Shut arched door leaves in the doorway plane: the round head spans 0 … W (along x), the leaves cover the ranges
     `parts` ([x0, x1] each), 4 cm thick from y0, up to the crown H. */
  function closedArchLeaf(parts, W, y0, H, m) {
    const ar = archOf(0, W, H, H * 0.45), curve = archCurve(ar);
    const zAt = (x) => { for (let i = 1; i < curve.length; i++) { const [xa, za] = curve[i - 1], [xb, zb] = curve[i]; if (x >= xa - 1e-6 && x <= xb + 1e-6) return za + ((zb - za) * (x - xa)) / (xb - xa || 1); } return ar.spring; };
    const g = new T.Group();
    for (const [a, b] of parts) {
      const a1 = a + 0.3, b1 = b - 0.3;
      const pts = [[a1, 0], [b1, 0], [b1, zAt(b1)], ...curve.filter(([x]) => x > a1 && x < b1).reverse(), [a1, zAt(a1)]];
      const geo = new T.ExtrudeGeometry(new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y))), { depth: 4, bevelEnabled: false, curveSegments: 1 });
      geo.translate(0, 0, y0);
      g.add(new T.Mesh(geo, m.wood), new T.LineSegments(new T.EdgesGeometry(geo, 30), m.edge));
    }
    return g;
  }
  /* An open door leaf with a round top: thickness th along x (x0 … x0 + th), width w along y (0 … w), crown at height H.
     half: one leaf of a pair — it carries half the arch, low at the hinge (y = w, by the wall) and highest at its free edge (y = 0). */
  function archedLeaf(th, w, H, m, x0 = 0, half = false) {
    let pts;
    if (half) {
      const ar = archOf(-w, w, H, H * 0.45);
      pts = [[0, 0], [w, 0], [w, ar.spring], ...archCurve(ar).reverse().filter(([x]) => x > 0 && x < w), [0, H]];
    } else {
      const ar = archOf(0, w, H, H * 0.45);
      pts = [[0, 0], [w, 0], [w, ar.spring], ...archCurve(ar).reverse(), [0, ar.spring]];
    }
    const geo = new T.ExtrudeGeometry(new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y))), { depth: th, bevelEnabled: false, curveSegments: 1 });
    geo.rotateY(-Math.PI / 2); // shape x -> along y of the item, extruded along −x
    geo.translate(x0 + th, 0, 0);
    const g = new T.Group(), mesh = new T.Mesh(geo, m.wood);
    g.add(mesh);
    g.add(new T.LineSegments(new T.EdgesGeometry(geo, 30), m.edge));
    return g;
  }

  /* A car in the item's frame (x across 0 … W, z along 0 … L, front at z = 0), modelled at 180 × 450 cm and scaled to
     the item: painted lower body and roof (the item's colour), glass cabin, black tyres with silver rims, lights. */
  function buildCar(W, L, m) {
    const g = new T.Group(), BW = 180;
    const side = (pts, width, mat, x0) => {
      // a side profile (z along the car, y up), extruded across the car from x0
      const geo = new T.ExtrudeGeometry(new T.Shape(pts.map(([z, y]) => new T.Vector2(z, y))), { depth: width, bevelEnabled: false, curveSegments: 6 });
      geo.rotateY(-Math.PI / 2); // profile x -> along the car (z), extruded along -x
      geo.translate(x0 + width, 0, 0);
      const mesh = new T.Mesh(geo, mat);
      mesh.castShadow = !mat.transparent;
      g.add(mesh);
      if (!mat.transparent) g.add(new T.LineSegments(new T.EdgesGeometry(geo, 35), m.edge));
      return mesh;
    };
    // lower body: bumpers, bonnet, waist line, boot
    side([[4, 24], [0, 40], [2, 70], [30, 86], [120, 98], [380, 100], [430, 96], [448, 82], [450, 50], [446, 24]], BW - 8, m.body, 4);
    // cabin: windscreen, side windows and rear window as glass, roof in the body colour
    side([[124, 98], [196, 140], [322, 142], [392, 100]], BW - 34, m.glass, 17);
    side([[192, 138], [198, 147], [320, 148], [326, 139]], BW - 30, m.body, 15);
    // pillars between the windows
    for (const z of [258]) g.add(box(BW - 30, 44, 8, BW / 2, 120, z, m.body, null, false));
    // wheels: tyres and rims
    for (const z of [102, 362]) for (const x of [14, BW - 14]) {
      g.add(cyl(32, 32, 22, x, 32, z, m.dark, [0, 0, Math.PI / 2], 20));
      g.add(cyl(19, 19, 23, x, 32, z, m.metal, [0, 0, Math.PI / 2], 14));
    }
    // mirrors, lights
    for (const x of [0, BW - 12]) g.add(box(12, 9, 14, x + 6, 104, 168, m.body, null, false));
    const head = new T.MeshStandardMaterial({ color: '#fff6d5', emissive: '#3a3420', roughness: 0.2 });
    const tail = new T.MeshStandardMaterial({ color: '#d93636', emissive: '#3a0a0a', roughness: 0.3 });
    for (const x of [35, BW - 35]) { g.add(box(32, 10, 3, x, 72, 1.5, head, null, false)); g.add(box(32, 9, 3, x, 84, 448.5, tail, null, false)); }
    g.add(box(BW - 70, 14, 3, BW / 2, 50, 0.5, m.dark, null, false)); // grille
    g.scale.set(W / BW, 1, L / 450);
    return g;
  }

  /* Handrails for stairs (it.rail: 'left' | 'right' | 'both' — seen walking up; it.railStyle: 'wood' | 'metal' | 'glass';
     it.railH: height above the nosing line, default 90 cm). In the item's frame (x along w, z along h). Each flight gets a
     sloping rail on the chosen side(s) with a baluster (or a glass panel) on every tread and newel posts at its ends;
     a landing gets level rails along its open outer edges. */
  // bars: round metal posts every ~1 m with horizontal bars (rods) between them, parallel to the rail
  const RAIL = { wood: { r: 3.2, post: 3, newel: 9 }, metal: { r: 2.2, post: 1.2, newel: 4 }, glass: { r: 2.4, post: 0, newel: 4 }, bars: { r: 2.4, post: 2.4, newel: 2.8 } };
  const BARS = 4; // horizontal bars under the rail
  function railKit(it, m) {
    const style = RAIL[it.railStyle] ? it.railStyle : 'wood', st = RAIL[style], g = new T.Group(), H = it.railH || 90;
    const steel = m.steel || m.metal; // metal, glass and bar rails are stainless steel
    const railM = style === 'wood' ? m.wood : steel, postM = style === 'wood' ? m.wood : steel;
    const add = (o) => { o.castShadow = !o.material.transparent; g.add(o); return o; };
    // a round bar between two points
    const rod = (a, b, r, mat) => {
      const A = new T.Vector3(...a), B = new T.Vector3(...b), d = new T.Vector3().subVectors(B, A), L = d.length();
      if (L < 0.5) return null;
      const c = new T.Mesh(new T.CylinderGeometry(r, r, L, 10), mat);
      c.position.copy(A).addScaledVector(d, 0.5);
      c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
      return add(c);
    };
    const post = (x, y0, z, top, newel = false) => {
      const w = newel ? st.newel : st.post;
      if (w <= 0) return;
      if (style === 'wood') add(box(w, top - y0, w, x, (y0 + top) / 2, z, postM, null, false));
      else rod([x, y0, z], [x, top, z], w / 2 + (newel ? 0.5 : 0.3), postM);
    };
    return { g, style, st, H, railM, add, rod, post };
  }
  function buildStairRails(it, lay, riser, W, Hh, m) {
    const K = railKit(it, m), { g, style, st, H } = K, side = it.rail || 'none', inset = 4;
    const mirrored = !!it.fx !== !!it.fy; // a mirrored staircase swaps what is left and right
    // flights: runs of treads between landings
    const flights = [];
    let cur = null;
    for (const t of lay.treads) {
      if (t[5]) { cur = null; continue; } // a landing (mid-flight or at the top)
      if (!cur) flights.push((cur = []));
      cur.push(t);
    }
    const onEdge = (v, lim) => Math.abs(v) < 0.5 || Math.abs(v - lim) < 0.5;
    for (const fl of flights) {
      const f = fl[0], l = fl[fl.length - 1];
      const c = (t) => [t[0] + t[2] / 2, t[1] + t[3] / 2];
      // walking direction: from the first tread to the last (a single tread: across its short side)
      let [ux, uy] = fl.length > 1 ? [c(l)[0] - c(f)[0], c(l)[1] - c(f)[1]] : f[2] < f[3] ? [1, 0] : [0, 1];
      const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const alongX = Math.abs(ux) > Math.abs(uy);
      // the two sides of the flight (lateral coordinate), and which is on the walker's left: left = (uy, −ux)
      const lo = alongX ? f[1] + inset : f[0] + inset, hi = alongX ? f[1] + f[3] - inset : f[0] + f[2] - inset;
      const leftIsLo = alongX ? ux > 0 : uy < 0; // walking +x the left is −y (lo); walking +y the left is +x (hi)
      const sides = [];
      const wantLeft = side === 'both' || (side === 'left') !== mirrored, wantRight = side === 'both' || (side === 'right') !== mirrored;
      if (wantLeft) sides.push(leftIsLo ? lo : hi);
      if (wantRight) sides.push(leftIsLo ? hi : lo);
      // the run coordinate along the flight, of a tread's start / centre / end
      const run0 = (t) => (alongX ? (ux > 0 ? t[0] : t[0] + t[2]) : (uy > 0 ? t[1] : t[1] + t[3]));
      const runC = (t) => (alongX ? t[0] + t[2] / 2 : t[1] + t[3] / 2);
      const P = (run, lat, y) => (alongX ? [run, y, lat] : [lat, y, run]);
      const top = (t) => t[4] * riser;
      for (const lat of sides) {
        // nosing line: through the tread centres; the rail runs from the first tread's start to the last tread's end
        const a = runC(f), b = runC(l), ya = top(f) + H, yb = top(l) + H;
        const slope = fl.length > 1 ? (yb - ya) / (b - a) : 0;
        const r0 = run0(f), r1 = alongX ? (ux > 0 ? l[0] + l[2] : l[0]) : (uy > 0 ? l[1] + l[3] : l[1]);
        K.rod(P(r0, lat, ya + slope * (r0 - a)), P(r1, lat, ya + slope * (r1 - a)), st.r, K.railM);
        if (style === 'bars') {
          // horizontal bars, evenly spaced between the rail and the nosing line, posts about every metre
          const gap = (H - 12) / (BARS + 1);
          for (let j = 1; j <= BARS; j++) K.rod(P(r0, lat, ya + slope * (r0 - a) - j * gap), P(r1, lat, ya + slope * (r1 - a) - j * gap), 0.8, K.railM);
          const every = Math.max(2, Math.round(100 / Math.max(15, Math.abs(r1 - r0) / fl.length)));
          fl.forEach((t, i) => { if (i > 0 && i < fl.length - 1 && i % every === 0) { const rc = runC(t), q = P(rc, lat, 0); K.post(q[0], top(t), q[2], ya + slope * (rc - a)); } });
        } else for (const t of fl) {
          const rc = runC(t), yTop = ya + slope * (rc - a);
          if (style === 'glass') {
            const len = alongX ? t[2] : t[3];
            const panel = box(alongX ? len : 1.2, yTop - top(t) - 6, alongX ? 1.2 : len, ...P(rc, lat, (yTop + top(t)) / 2 - 3), m.glass, null, false);
            g.add(panel);
          } else { const q = P(rc, lat, 0); K.post(q[0], top(t), q[2], yTop); }
        }
        // newel posts at both ends
        const pA = P(r0, lat, 0), pB = P(r1, lat, 0);
        K.post(pA[0], top(f) - riser, pA[2], ya + slope * (r0 - a) + 4, true);
        K.post(pB[0], top(l), pB[2], ya + slope * (r1 - a) + 4, true);
      }
    }
    // landings: level rails along the open outer edges (those on the outline of the staircase)
    const wantL = side === 'both' || (side === 'left') !== mirrored, wantR = side === 'both' || (side === 'right') !== mirrored;
    if (side !== 'none') for (const t of lay.treads.filter((t) => t[5])) {
      const y = t[4] * riser + H, base = t[4] * riser, [x0, z0, w, h] = t;
      // the top landing: rails along its two sides (left = the near edge walking +x); the far end, the door, stays open
      const edges = [[[x0, z0], [x0 + w, z0]], [[x0, z0 + h], [x0 + w, z0 + h]], [[x0, z0], [x0, z0 + h]], [[x0 + w, z0], [x0 + w, z0 + h]]]
        .filter(([[ax, az], [bx, bz]]) => (t[5] === 'top' || t[7] === 'mid'
          ? (t[6] === 'y' ? ax === bx && ((ax === x0 + w && wantL) || (ax === x0 && wantR)) : az === bz && ((az === z0 && wantL) || (az === z0 + h && wantR)))
          : ax === bx ? onEdge(ax, W) : onEdge(az, Hh)));
      // a U with an open well: the turning landing's edge over the well, on the inner (right-hand) side
      if (t[5] === 'landing' && lay.well && wantR) edges.push([[lay.well[0], lay.well[2] - 2 * inset], [lay.well[1], lay.well[2] - 2 * inset]]);
      for (const [[ax, az], [bx, bz]] of edges) {
        // pulled in from the outline
        const ix = ax === bx ? (ax < W / 2 ? inset : -inset) : 0, iz = az === bz ? (az < Hh / 2 ? inset : -inset) : 0;
        const A = [ax + ix, y, az + iz], B = [bx + ix, y, bz + iz];
        K.rod(A, B, st.r, K.railM);
        const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / (style === 'bars' ? 100 : 12)));
        if (style === 'bars') for (let j = 1; j <= BARS; j++) { const dy = j * ((H - 12) / (BARS + 1)); K.rod([A[0], y - dy, A[2]], [B[0], y - dy, B[2]], 0.8, K.railM); }
        for (let k = 0; k <= n; k++) {
          const px = A[0] + ((B[0] - A[0]) * k) / n, pz = A[2] + ((B[2] - A[2]) * k) / n;
          if (style === 'glass') { if (k < n) g.add(box(ax === bx ? 1.2 : L / n, H - 6, ax === bx ? L / n : 1.2, px + (ax === bx ? 0 : (B[0] - A[0]) / n / 2), base + (H - 6) / 2, pz + (ax === bx ? (B[2] - A[2]) / n / 2 : 0), m.glass, null, false)); }
          else K.post(px, base, pz, y, k === 0 || k === n);
        }
      }
    }
    return g;
  }
  // spiral stairs: one rail round the outside, a baluster on every step
  function buildSpiralRail(it, n, riser, cx, cy, rad, m) {
    const K = railKit(it, m), { g, style, st, H } = K, r = rad - 3, b = window.FP_STAIRS.spiralAngles(n, it);
    const at = (a, y) => [cx + r * Math.cos(a), y, cy + r * Math.sin(a)];
    // rail points: the middle of every step; along a top landing, level points round its edge
    const pts = [];
    for (let k = 0; k < n; k++) {
      const top = (k + 1) * riser;
      if (b.landing && k === n - 1) {
        const m2 = Math.max(2, Math.round((b[n] - b[k]) / 0.25));
        for (let j = 0; j <= m2; j++) pts.push({ a: b[k] + ((b[n] - b[k]) * j) / m2, top, newel: j === m2 });
      } else pts.push({ a: (b[k] + b[k + 1]) / 2, top, newel: k === 0 });
    }
    pts.forEach((q, i) => {
      const p = at(q.a, q.top + H);
      if (i < pts.length - 1) K.rod(p, at(pts[i + 1].a, pts[i + 1].top + H), st.r, K.railM);
      if (style === 'glass') K.rod(at(q.a, q.top), p, 1, m.metal);
      else K.post(p[0], q.top, p[2], q.top + H, q.newel);
    });
    return g;
  }

  /* Straight / L / U stairs in the item's frame (x along w, z along h, y up). Each flight is one piece, made from its
   * side profile and extruded across its width:
   *   solid  — the stepped block down to the floor;
   *   closed — the steps on a sloping underside (a waist ~15 cm thick), open beneath;
   *   open   — no risers: tread boards on two sloping side stringers;
   *   mono   — no risers: thick tread boards on one central steel spine (a mono-stringer);
   *   columns — hollow: the steps on a sloping waist slab carried by columns, open beneath; only the lowest few steps
   *            (it.solidSteps, default 3) of a flight that starts on the floor are solid down to the floor.
   * Every step gets a wooden tread board with a 2.5 cm nosing over the riser below; landings a board on a slab (solid:
   * down to the floor; otherwise on four posts). The body is the item's colour, the treads wood. */
  function buildStairBody(it, lay, riser, m) {
    const g = new T.Group(), under = it.under || 'solid';
    // the body in the item's colour; the default white reads as light plaster, so the steps keep their shape
    const fill = (it.fill || '#ffffff').toLowerCase();
    if (fill === '#ffffff' || fill === '#fff') m = { ...m, body: new T.MeshStandardMaterial({ color: '#ddd7cc', roughness: 0.9 }) };
    const openRisers = under === 'open' || under === 'mono';
    const BOARD = openRisers ? 5 : 3, NOSE = openRisers ? 0 : 2.5, WAIST = 15;
    const add = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
    // clip a polygon to y >= 0 (nothing below the floor)
    const clip = (pts) => {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const A = pts[i], B = pts[(i + 1) % pts.length], ia = A[1] >= 0, ib = B[1] >= 0;
        if (ia) out.push(A);
        if (ia !== ib) { const t = A[1] / (A[1] - B[1]); out.push([A[0] + (B[0] - A[0]) * t, 0]); }
      }
      // no repeated corners (they break the triangulation)
      return out.filter((q, i) => { const r = out[(i + out.length - 1) % out.length]; return Math.abs(q[0] - r[0]) > 0.01 || Math.abs(q[1] - r[1]) > 0.01; });
    };
    // a side profile (u along the walk, v up) extruded across the flight, placed in the item's frame
    const profile = (pts, fl, mat) => {
      pts = clip(pts);
      if (pts.length < 3) return;
      const geo = new T.ExtrudeGeometry(new T.Shape(pts.map(([u, v]) => new T.Vector2(u, v))), { depth: fl.width, bevelEnabled: false });
      if (fl.alongX) {
        if (fl.dir > 0) geo.translate(fl.r0, 0, fl.lo);
        else { geo.rotateY(Math.PI); geo.translate(fl.r0, 0, fl.lo + fl.width); }
      } else if (fl.dir > 0) { geo.rotateY(-Math.PI / 2); geo.translate(fl.lo + fl.width, 0, fl.r0); }
      else { geo.rotateY(Math.PI / 2); geo.translate(fl.lo, 0, fl.r0); }
      add(new T.Mesh(geo, mat));
    };
    // the flights: runs of steps between landings, with their direction and extent
    const flights = [];
    let cur = null;
    for (const t of lay.treads) {
      if (t[5]) { cur = null; continue; }
      if (!cur) flights.push((cur = []));
      cur.push(t);
    }
    for (const fl of flights) {
      const f = fl[0], l = fl[fl.length - 1];
      const dx = l[0] - f[0], dy = l[1] - f[1];
      const alongX = fl.length > 1 ? Math.abs(dx) >= Math.abs(dy) : f[2] < f[3];
      const dir = fl.length > 1 ? Math.sign(alongX ? dx : dy) || 1 : 1;
      const g0 = alongX ? f[2] : f[3], n = fl.length;
      const F = { alongX, dir, width: alongX ? f[3] : f[2], lo: alongX ? f[1] : f[0], r0: alongX ? (dir > 0 ? f[0] : f[0] + f[2]) : (dir > 0 ? f[1] : f[1] + f[3]) };
      const top = (k) => fl[k][4] * riser, base = top(0) - riser, L = n * g0;
      // the stepped top line: up a riser, along a going, ... (u from the foot of the flight)
      const steps = [];
      for (let k = 0; k < n; k++) steps.push([k * g0, top(k) - BOARD], [(k + 1) * g0, top(k) - BOARD]);
      if (under === 'solid') profile([[0, 0], ...steps, [L, 0]], F, m.body);
      // closed: the underside runs parallel to the pitch, WAIST below the inner corners of the steps
      else if (under === 'closed') profile([[0, base - WAIST], [0, base], ...steps, [L, top(n - 1) - BOARD - WAIST]], F, m.body);
      else if (under === 'columns') {
        profile([[0, base - WAIST], [0, base], ...steps, [L, top(n - 1) - BOARD - WAIST]], F, m.body);
        // the lowest steps solid down to the floor (only where the flight starts on the floor)
        const K = base < 1 ? Math.min(n, Math.max(0, it.solidSteps == null ? 3 : it.solidSteps)) : 0;
        if (K) profile([[0, 0], ...steps.slice(0, 2 * K), [K * g0, 0]], F, m.body);
        // columns under the waist: pairs set in from the sides, at most 1.5 m apart, from the solid part to the top
        const under0 = (u) => base - WAIST + (u / L) * (top(n - 1) - BOARD - base);
        const C = 12, inset = Math.min(10, F.width / 4), u0 = Math.max(K * g0 + C, 30), u1 = L - C / 2 - 4;
        if (u1 > u0) {
          const cnt = Math.max(1, Math.ceil((u1 - u0) / 150)), us = [];
          for (let i = 0; i <= cnt; i++) us.push(u0 + ((u1 - u0) * i) / cnt);
          for (const u of us) {
            const hgt = under0(u);
            if (hgt < 25) continue; // low enough to sit on the solid part / floor
            for (const lat of [inset + C / 2, F.width - inset - C / 2]) {
              const run = F.r0 + F.dir * u, side = F.lo + lat;
              add(box(C, hgt, C, alongX ? run : side, hgt / 2, alongX ? side : run, m.body, null, false));
            }
          }
        }
      }
      else {
        // two stringers along the sides (mono: one wide steel spine down the middle): their top edge through the
        // back of each tread's underside
        const mono = under === 'mono', line = (u) => top(0) - BOARD + ((u - g0) * riser) / g0, S = mono ? 14 : 5, D = mono ? 20 : 24;
        for (const off of mono ? [(F.width - S) / 2] : [0, F.width - S]) {
          const Fs = { ...F, lo: F.lo + off, width: S };
          profile([[0, line(0)], [L, line(L)], [L, line(L) - D], [0, line(0) - D]], Fs, m.dark);
        }
      }
      // tread boards with a nosing over the riser below
      for (let k = 0; k < n; k++) {
        const t = fl[k], y0 = top(k) - BOARD;
        let [x, z, w, h] = t;
        if (alongX) { if (dir > 0) { x -= NOSE; } w += NOSE; } else { if (dir > 0) { z -= NOSE; } h += NOSE; }
        add(box(w, BOARD, h, x + w / 2, y0 + BOARD / 2, z + h / 2, m.wood, null, false));
      }
    }
    // landings (mid-flight and at the top): a board on a slab, solid down to the floor or on posts
    for (const t of lay.treads.filter((x) => x[5])) {
      const [x, z, w, h, level] = t, topY = level * riser, slab = under === 'solid' ? topY - BOARD : openRisers ? 8 : 18;
      add(box(w, BOARD, h, x + w / 2, topY - BOARD / 2, z + h / 2, m.wood, null, false));
      add(box(w, slab, h, x + w / 2, topY - BOARD - slab / 2, z + h / 2, m.body, null, false));
      if (under !== 'solid') {
        const p = 8;
        for (const [px, pz] of [[x + p / 2, z + p / 2], [x + w - p / 2, z + p / 2], [x + p / 2, z + h - p / 2], [x + w - p / 2, z + h - p / 2]]) {
          const ph = topY - BOARD - slab;
          if (ph > 1) add(box(p, ph, p, px, ph / 2, pz, openRisers ? m.metal : m.body, null, false));
        }
      }
    }
    return g;
  }

  /* small builders for custom objects */
  const custom = (z1, build) => ({ shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0: 0, z1, build });
  function box(w, h, d, x, y, z, mat, rot = null, edges = true) {
    const geo = new T.BoxGeometry(Math.max(0.5, w), Math.max(0.5, h), Math.max(0.5, d)), m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (edges && !mat.transparent) m.add(new T.LineSegments(new T.EdgesGeometry(geo, 30), new T.LineBasicMaterial({ color: '#3a3d42', transparent: true, opacity: 0.35 })));
    return m;
  }
  function cyl(rt, rb, h, x, y, z, mat, rot = null, seg = 16) {
    const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    return m;
  }
  function sph(r, x, y, z, mat, scale = null) {
    const m = new T.Mesh(new T.SphereGeometry(r, 14, 10), mat);
    m.position.set(x, y, z);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    return m;
  }

  function tree(x, z, rnd, conifer) {
    const g = new T.Group(), s = 0.8 + rnd() * 0.5;
    const trunk = new T.Mesh(new T.CylinderGeometry(8 * s, 13 * s, 220 * s, 8), new T.MeshStandardMaterial({ color: '#6b4a2e', roughness: 1 }));
    trunk.position.y = 110 * s;
    g.add(trunk);
    const leaf = new T.MeshStandardMaterial({ color: ['#3f7a35', '#4c8a3c', '#5b9442', '#356b2f'][(rnd() * 4) | 0], roughness: 0.95 });
    if (conifer) {
      for (const [r, h, y] of [[130, 260, 280], [100, 210, 400], [65, 160, 500]]) {
        const c = new T.Mesh(new T.ConeGeometry(r * s, h * s, 10), leaf);
        c.position.y = y * s; g.add(c);
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const b = new T.Mesh(new T.SphereGeometry((95 + rnd() * 60) * s, 12, 9), leaf);
        b.position.set((rnd() - 0.5) * 120 * s, (290 + rnd() * 110) * s, (rnd() - 0.5) * 120 * s);
        g.add(b);
      }
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(x, 0, z);
    return g;
  }

  /* Ground around the plan bounds b. Returns { group, half } (half = half the ground size, for shadows). */
  // the ground as a flat shape with holes (floor openings above a basement); tile = texture repeat in cm
  function groundWithHoles(x0, z0, x1, z1, holes, mat, tile) {
    const shape = new T.Shape([new T.Vector2(x0, -z0), new T.Vector2(x1, -z0), new T.Vector2(x1, -z1), new T.Vector2(x0, -z1)]);
    for (const h of holes) shape.holes.push(new T.Path(h.map(([x, y]) => new T.Vector2(x, -y))));
    const geo = new T.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    if (tile) {
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
    }
    const m = new T.Mesh(geo, mat);
    m.position.y = -0.5;
    m.receiveShadow = true;
    return m;
  }

  /* Terrain from the hills on the plan: H(x, z) = the ground height there (cm), mode(x, z) = the colouring of the
     hill that shapes it most. Hills add up; inside the house's outline the ground is cut down to its floor. */
  let TERR = null;
  const HILL_SHAPE = {
    round: (d) => (1 + Math.cos(Math.PI * d)) / 2,                                   // smooth all the way
    plateau: (d) => (d < 0.45 ? 1 : (1 + Math.cos((Math.PI * (d - 0.45)) / 0.55)) / 2), // flat top, smooth flanks
    peak: (d) => (1 - d) * (1 - d),                                                    // pointed top, soft foot
    ramp: (d) => { const k = 1 - d, v = k < 0.2 ? (k * k) / 0.4 : k <= 0.8 ? k - 0.1 : 0.7 + (k - 0.8) - ((k - 0.8) ** 2) / 0.4; return v / 0.8; }, // even slope, rounded foot and top
  };
  function makeTerrain() {
    const hills = FP.items().filter((i) => i.type === 'hill' && !i.hide3d && (i.hillH || 0) !== 0).map((it) => {
      const rad = (it.r * Math.PI) / 180;
      return { it, cx: it.x + it.w / 2, cy: it.y + it.h / 2, rx: it.w / 2, ry: it.h / 2, c: Math.cos(rad), s: Math.sin(rad),
        H: it.hillH, f: HILL_SHAPE[it.hillShape] || HILL_SHAPE.round, mode: it.hillColor || 'natural' };
    });
    // slopes: a high edge (local top, y = 0) at slopeH, falling evenly to the opposite edge where they meet the ground;
    // their sides blend into it over `blend` cm — but not across a wall of the ground floor
    const slopes = FP.items().filter((i) => i.type === 'slope' && !i.hide3d).map((it) => ({ it, w: it.w, h: it.h, H: it.slopeH == null ? 100 : it.slopeH,
      m: Math.max(1, it.blend == null ? 200 : it.blend), tf: window.FPWalls.toWorld(it) }));
    if (!hills.length && !slopes.length) return null;
    const ring = FP.houseRing(), floor = FP.houseAboveGround();
    const gid = FP.groundLevelId(), wallSegs = slopes.length
      ? window.FPWalls.wallSegments(FP.items().filter((i) => FP.levelOf(i) === gid && window.FPWalls.isWall(i))) : [];
    // is world point (x, z) on (or right against) a wall?
    const atWall = (x, z) => wallSegs.some((sg) => {
      const dx = x - sg.A[0], dz = z - sg.A[1], along = dx * sg.u[0] + dz * sg.u[1];
      return along >= -sg.t / 2 && along <= sg.len + sg.t / 2 && Math.abs(dx * sg.n[0] + dz * sg.n[1]) <= sg.t / 2 + 8;
    });
    const part = (h, x, z) => {
      const dx = x - h.cx, dz = z - h.cy, lx = dx * h.c + dz * h.s, lz = -dx * h.s + dz * h.c;
      const d = Math.hypot(lx / h.rx, lz / h.ry);
      return d >= 1 ? 0 : h.H * Math.max(0, h.f(d));
    };
    const H = (x, z) => {
      let y = 0;
      for (const h of hills) y += part(h, x, z);
      for (const sl of slopes) {
        const [lx, ly] = toLocal(sl.it, [x, z]);
        if (ly < 0 || ly > sl.h) continue;              // beyond the high edge: untouched; beyond the low edge it has met the ground
        const v = ly / sl.h, S = sl.H * (1 - v) + y * v; // the slope surface over the ground under it
        if (lx >= 0 && lx <= sl.w) { y = S; continue; }
        const d = lx < 0 ? -lx : lx - sl.w;
        if (d >= sl.m) continue;
        // a wall along this side: the slope stops at it, the ground beyond keeps its height
        const edge = sl.tf([lx < 0 ? 0 : sl.w, ly]);
        if (atWall(edge[0], edge[1]) || atWall(x, z)) continue;
        const t = 1 - d / sl.m;
        y += t * t * (3 - 2 * t) * (S - y);              // smooth blend into the ground round it
      }
      if (ring && y > floor && insidePoly(ring, x, z)) y = floor;  // dug in under the house
      return y;
    };
    const mode = (x, z) => {
      let best = null, bv = 0;
      for (const h of hills) { const v = Math.abs(part(h, x, z)); if (v > bv) { bv = v; best = h; } }
      return best ? best.mode : 'natural';
    };
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const h of hills) { const R = Math.max(h.rx, h.ry); x0 = Math.min(x0, h.cx - R); z0 = Math.min(z0, h.cy - R); x1 = Math.max(x1, h.cx + R); z1 = Math.max(z1, h.cy + R); }
    for (const sl of slopes) for (const [lx, ly] of [[-sl.m, 0], [sl.w + sl.m, 0], [sl.w + sl.m, sl.h], [-sl.m, sl.h]]) {
      const [X, Z] = sl.tf([lx, ly]); x0 = Math.min(x0, X); z0 = Math.min(z0, Z); x1 = Math.max(x1, X); z1 = Math.max(z1, Z);
    }
    return { H, mode, box: { x: x0, y: z0, w: x1 - x0, h: z1 - z0 } };
  }
  // colour (a multiplier on the ground texture) at height h for a colouring mode
  function hillTint(h, mode) {
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
    if (mode === 'none') return [1, 1, 1];
    if (h < 0) return mix([1, 1, 1], [0.72, 0.84, 0.78], -h / 250);                       // hollows: darker, cooler
    if (mode === 'earth') {
      const low = mix([1, 1, 1], [1.08, 0.82, 0.56], h / 280);                              // grass → soil
      return mix(low, [1.32, 1.28, 1.22], (h - 320) / 380);                                  // → light stone
    }
    return mix([1, 1, 1], [1.22, 1.16, 0.84], h / 450);                                       // natural: sunlit, drier
  }
  /* The ground as a fine grid lifted onto the terrain: texture, a height tint and slope shading; cells whose middle
     lies in a hole (basement, floor openings) are left out. */
  function terrainGround(x0, z0, x1, z1, holes, mat, tile) {
    const W = x1 - x0, D = z1 - z0, cell = Math.max(15, Math.min(100, Math.max(W, D) / 260));
    const nx = Math.ceil(W / cell), nz = Math.ceil(D / cell), cw = W / nx, cd = D / nz;
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2), col = new Float32Array((nx + 1) * (nz + 1) * 3);
    for (let j = 0, v = 0; j <= nz; j++) for (let i = 0; i <= nx; i++, v++) {
      const x = x0 + i * cw, z = z0 + j * cd, h = TERR.H(x, z), c = hillTint(h, TERR.mode(x, z));
      pos.set([x, h - 0.5, z], v * 3); uv.set([x / tile, z / tile], v * 2); col.set(c, v * 3);
    }
    const idx = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const mx = x0 + (i + 0.5) * cw, mz = z0 + (j + 0.5) * cd;
      if (holes.some((hl) => insidePoly(hl, mx, mz))) continue;
      const a = j * (nx + 1) + i, b2 = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b2, b2, c, d);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // slope shading on top of the light: steeper ground a little darker
    const nrm = geo.attributes.normal;
    for (let v = 0; v < nrm.count; v++) {
      // darker with steepness (tan of the slope) — so even a gentle ramp reads clearly against level ground
      const ny = Math.max(0.05, nrm.getY(v)), steep = Math.sqrt(Math.max(0, 1 - ny * ny)) / ny, k = 1 - Math.min(0.42, steep * 1.4);
      col[v * 3] *= k; col[v * 3 + 1] *= k; col[v * 3 + 2] *= k;
    }
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    mat.vertexColors = true;
    const m = new T.Mesh(geo, mat);
    m.receiveShadow = true; m.castShadow = true;
    return m;
  }

  /* Brush / jungle: dense low undergrowth over the site, kept clear of the house (keep = [x0, z0, x1, z1]).
     Instanced, so thousands of plants stay light: shrub blobs, grass and reed clumps, fern fronds, and a few palms. */
  /* Short lawn grass: tufts of 4–6 thin blades (6–22 cm) scattered over x0..x1 × z0..z1 at `per` tufts per m²,
     kept off the building (keep rectangle) and out of any ground hole (pools, basement). One instanced mesh. */
  function lawnTufts(x0, z0, x1, z1, keep, holes, rnd, per) {
    const area = Math.max(0, ((x1 - x0) * (z1 - z0)) / 10000);
    const n = Math.min(9000, Math.round(area * per)), blades = 5;
    const geo = new T.ConeGeometry(1.1, 1, 3); geo.translate(0, 0.5, 0);
    const m = new T.InstancedMesh(geo, new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), Math.max(1, n * blades));
    m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(Math.max(1, n * blades) * 3).fill(1), 3);
    m.count = 0; m.receiveShadow = true; m.userData.veg = true;
    const dummy = new T.Object3D(), col = new T.Color();
    const tones = ['#3f8f24', '#4fa22e', '#5cb238', '#6cc044', '#36801f', '#7fcf52'];
    const Hh = (x, z) => (TERR ? TERR.H(x, z) : 0);
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (x > keep[0] - 10 && x < keep[2] + 10 && z > keep[1] - 10 && z < keep[3] + 10) continue;
      if (holes.some((h) => insidePoly(h, x, z))) continue;
      const h = 6 + rnd() * 16, y = Hh(x, z) - 0.5, tone = tones[(rnd() * tones.length) | 0];
      for (let j = 0; j < blades; j++) {
        dummy.position.set(x + (rnd() - 0.5) * 7, y, z + (rnd() - 0.5) * 7);
        dummy.scale.set(1, h * (0.6 + rnd() * 0.4), 1);
        dummy.rotation.set((rnd() - 0.5) * 0.8, rnd() * 6, (rnd() - 0.5) * 0.8); dummy.updateMatrix();
        m.setMatrixAt(m.count, dummy.matrix); m.setColorAt(m.count, col.set(tone)); m.count++;
      }
    }
    m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    return m;
  }

  function brushCover(x0, z0, x1, z1, keep, rnd) {
    const grp = new T.Group(), dummy = new T.Object3D(), col = new T.Color();
    const area = ((x1 - x0) * (z1 - z0)) / 10000; // m²
    const Hh = (x, z) => (TERR ? TERR.H(x, z) : 0);
    const spot = () => {
      for (let t = 0; t < 25; t++) {
        const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
        if (!(x > keep[0] && x < keep[2] && z > keep[1] && z < keep[3])) return [x, z];
      }
      return null;
    };
    const inst = (geo, mat, max) => {
      const m = new T.InstancedMesh(geo, mat, max);
      // colour per plant: the buffer is made for all of them up front (setColorAt would size it to the current count)
      m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
      m.count = 0; m.castShadow = true; m.receiveShadow = true; m.userData.veg = true; grp.add(m); return m;
    };
    const put = (m, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0, colour = null) => {
      dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(rx, ry, rz); dummy.updateMatrix();
      m.setMatrixAt(m.count, dummy.matrix);
      if (colour) m.setColorAt(m.count, col.set(colour));
      m.count++;
    };
    const leafy = (c) => new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true, ...c });
    const greens = ['#2f5d27', '#3d6b2c', '#4c7a31', '#5b8a36', '#356329', '#6b8f3a', '#46702e'];
    // shrubs: clusters of 2–4 rounded blobs, 0.4–1.2 m high
    const nShrub = Math.min(1400, Math.round(area * 0.45));
    const blobs = inst(new T.IcosahedronGeometry(1, 1), leafy(), nShrub * 4);
    for (let i = 0; i < nShrub; i++) {
      const p = spot(); if (!p) continue;
      const s = 30 + rnd() * 50, parts = 2 + ((rnd() * 3) | 0), tone = greens[(rnd() * greens.length) | 0];
      for (let j = 0; j < parts && blobs.count < nShrub * 4; j++) {
        const r = s * (0.5 + rnd() * 0.5), x = p[0] + (rnd() - 0.5) * s, z = p[1] + (rnd() - 0.5) * s;
        put(blobs, x, Hh(x, z) + r * 0.55, z, r, r * (0.75 + rnd() * 0.45), r, rnd() * 6, 0, 0, tone);
      }
    }
    // tall grass and reed clumps: bundles of thin blades leaning out
    const nTuft = Math.min(2200, Math.round(area * 0.9));
    const bladeGeo = new T.ConeGeometry(2.2, 1, 3); bladeGeo.translate(0, 0.5, 0);
    const blades = inst(bladeGeo, leafy(), nTuft * 5);
    const grassTones = ['#6f8f3a', '#86a246', '#5d7d31', '#9aa955', '#7a8f3f'];
    for (let i = 0; i < nTuft; i++) {
      const p = spot(); if (!p) continue;
      const h = 35 + rnd() * 75, y = Hh(p[0], p[1]), tone = grassTones[(rnd() * grassTones.length) | 0];
      for (let j = 0; j < 5; j++) put(blades, p[0] + (rnd() - 0.5) * 10, y - 2, p[1] + (rnd() - 0.5) * 10, 1, h * (0.6 + rnd() * 0.4), 1, rnd() * 6, (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.7, tone);
    }
    // ferns: fronds fanning out from the ground
    const nFern = Math.min(700, Math.round(area * 0.25));
    const frondGeo = new T.ConeGeometry(1, 1, 3); frondGeo.translate(0, 0.5, 0);
    const fronds = inst(frondGeo, leafy({ side: T.DoubleSide }), nFern * 7);
    for (let i = 0; i < nFern; i++) {
      const p = spot(); if (!p) continue;
      const L = 40 + rnd() * 45, y = Hh(p[0], p[1]), tone = ['#3f7a2e', '#4f8a34', '#2f6a28'][(rnd() * 3) | 0];
      for (let j = 0; j < 7; j++) {
        const a = (j / 7) * Math.PI * 2 + rnd() * 0.4;
        dummy.position.set(p[0], y, p[1]); dummy.scale.set(9, L, 1.5); dummy.rotation.set(0, 0, 0);
        dummy.rotateY(a); dummy.rotateX(0.95 + rnd() * 0.35); dummy.updateMatrix();
        fronds.setMatrixAt(fronds.count, dummy.matrix); fronds.setColorAt(fronds.count, col.set(tone)); fronds.count++;
      }
    }
    // a few small palms: a leaning trunk and a crown of fronds
    const nPalm = Math.min(14, Math.max(3, Math.round(area / 90)));
    const trunkM = new T.MeshStandardMaterial({ color: '#6b5236', roughness: 1 }), palmM = leafy({ color: '#3f7a2e', side: T.DoubleSide });
    for (let i = 0; i < nPalm; i++) {
      const p = spot(); if (!p) continue;
      const h = 220 + rnd() * 200, y = Hh(p[0], p[1]), lean = (rnd() - 0.5) * 0.25;
      const palm = new T.Group(); palm.position.set(p[0], y, p[1]); palm.rotation.set(lean, rnd() * 6, -lean);
      const trunk = new T.Mesh(new T.CylinderGeometry(6, 10, h, 7), trunkM); trunk.position.y = h / 2; trunk.castShadow = true;
      palm.add(trunk);
      for (let j = 0; j < 8; j++) {
        const f = new T.Mesh(frondGeo, palmM); f.castShadow = true;
        f.position.y = h; f.scale.set(14, 120 + rnd() * 50, 2); f.rotation.set(0, 0, 0); f.rotateY((j / 8) * Math.PI * 2); f.rotateX(1.25 + rnd() * 0.3);
        palm.add(f);
      }
      grp.add(palm);
    }
    for (const m of grp.children) if (m.isInstancedMesh) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    return grp;
  }

  function buildGround(kind, b, holes = []) {
    const g = new T.Group();
    const cx = b.x + b.w / 2;
    if (kind === 'plain') {
      const x0 = b.x - 400, x1 = b.x + b.w + 400, z0 = b.y - 400, z1 = b.y + b.h + 400;
      // a fresh green lawn round the building, with short grass growing on it
      const mat = new T.MeshStandardMaterial({ color: '#7dbb55', roughness: 1, side: T.DoubleSide });
      g.add(TERR ? terrainGround(x0, z0, x1, z1, holes, mat, 100) : groundWithHoles(x0, z0, x1, z1, holes, mat));
      let sd = 777; const rp = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      g.add(lawnTufts(x0, z0, x1, z1, [b.x, b.y, b.x + b.w, b.y + b.h], holes, rp, 2.2));
      return { group: g, half: 0 };
    }
    const street = kind === 'street' || kind === 'street-trees';
    const M = 1000;                                   // ground reaching 10 m beyond the building
    const yard = 300, walk = 200, curb = 15, road = 700, verge = 400;
    const south = street ? yard + walk + curb + road + verge : M;
    const x0 = b.x - M, x1 = b.x + b.w + M, z0 = b.y - M, z1 = b.y + b.h + south, W = x1 - x0;
    const base = kind === 'paving' || kind === 'gravel' || kind === 'brush' ? kind : 'grass';
    g.add(TERR ? terrainGround(x0, z0, x1, z1, holes, new T.MeshStandardMaterial({ map: groundTexture(base), roughness: 1, side: T.DoubleSide }), GROUND_TEX[base].tile)
      : holes.length
      ? groundWithHoles(x0, z0, x1, z1, holes, new T.MeshStandardMaterial({ map: groundTexture(base), roughness: 1, side: T.DoubleSide }), GROUND_TEX[base].tile)
      : groundRect(base, W, z1 - z0, cx, (z0 + z1) / 2));

    let seed = 4242;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const keepOut = [b.x - 250, b.y - 250, b.x + b.w + 250, b.y + b.h + 250]; // no trees right next to the house

    if (street) {
      const zw = b.y + b.h + yard, zc = zw + walk, zr = zc + curb;   // sidewalk, curb, road start (going south)
      g.add(groundRect('sidewalk', W, walk, cx, zw + walk / 2, -0.3));
      const curbM = new T.Mesh(new T.BoxGeometry(W, 14, curb), new T.MeshStandardMaterial({ color: '#c9c5bd', roughness: 0.9 }));
      curbM.position.set(cx, 6, zc + curb / 2); curbM.castShadow = curbM.receiveShadow = true;
      g.add(curbM);
      g.add(groundRect('asphalt', W, road, cx, zr + road / 2, -0.3));
      // dashed centre line and solid edge lines
      const paint = new T.MeshStandardMaterial({ color: '#f2f0e6', roughness: 0.8 });
      const stripe = (w, d, x, z) => { const s = new T.Mesh(new T.PlaneGeometry(w, d), paint); s.rotation.x = -Math.PI / 2; s.position.set(x, -0.2, z); s.receiveShadow = true; g.add(s); };
      for (let x = x0 + 150; x < x1 - 300; x += 600) stripe(300, 12, x + 150, zr + road / 2);
      stripe(W, 10, cx, zr + 30); stripe(W, 10, cx, zr + road - 30);
      // a path from the house to the sidewalk
      g.add(groundRect('sidewalk', 150, yard, cx, b.y + b.h + yard / 2, -0.35));
      if (kind === 'street-trees') {
        for (let x = x0 + 300; x < x1 - 200; x += 800) if (Math.abs(x - cx) > 200) g.add(tree(x, zw + walk - 40, rnd, false));
      }
    }
    // short grass tufts all over the lawn (thickest near the house, where you look most)
    if (base === 'grass') {
      const lz1 = street ? b.y + b.h + yard : z1;
      g.add(lawnTufts(b.x - 600, b.y - 600, b.x + b.w + 600, Math.min(lz1, b.y + b.h + 600), [b.x, b.y, b.x + b.w, b.y + b.h], holes, rnd, 2.2));
      g.add(lawnTufts(x0, z0, x1, lz1, [b.x - 600, b.y - 600, b.x + b.w + 600, b.y + b.h + 600], holes, rnd, 0.5));
    }
    if (kind === 'brush') g.add(brushCover(x0, z0, x1, z1, [b.x - 150, b.y - 150, b.x + b.w + 150, b.y + b.h + 150], rnd));
    if (kind === 'trees' || kind === 'street-trees') {
      // scatter trees around the house, keeping some space between them
      const zMax = street ? b.y + b.h + yard - 120 : z1 - 150;
      const want = kind === 'trees' ? Math.round(Math.min(40, Math.max(12, (W * (z1 - z0)) / 900000))) : 10;
      const placed = [];
      for (let tries = 0; tries < want * 40 && placed.length < want; tries++) {
        const x = x0 + 150 + rnd() * (W - 300), z = z0 + 150 + rnd() * (zMax - z0 - 150);
        if (x > keepOut[0] && x < keepOut[2] && z > keepOut[1] && z < keepOut[3]) continue;
        if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 380)) continue;
        placed.push([x, z]);
        const t = tree(x, z, rnd, rnd() < 0.3);
        if (TERR) t.position.y = TERR.H(x, z) - 2;
        g.add(t);
      }
    }
    return { group: g, half: Math.max(W, z1 - z0) / 2 };
  }

  // wall / column height: its own setting, else the plan's standard wall height
  const stdWallH = () => FP.plan().wallH || WALL_H;

  /* The top of a roof (its covering, above ground ±0) at world point (X, Y) of the plan, or null when the point is
     not under it — the same planes buildRoof draws, plus the roof's thickness. */
  function roofTopAt(rf, X, Y) {
    const style = FP.byId[rf.type].roof, ov = rf.overhang == null ? 40 : rf.overhang;
    const pitch = rf.pitch == null ? (style === 'shed' || style === 'butterfly' ? 10 : 30) : rf.pitch;
    const k = Math.tan((pitch * Math.PI) / 180), k65 = Math.tan((65 * Math.PI) / 180);
    const W = rf.w, D = rf.h, [x, y] = toLocal(rf, [X, Y]);
    if (x < -ov - 1 || x > W + ov + 1 || y < -ov - 1 || y > D + ov + 1) return null;
    const z0 = FP.roofBase(rf), RT = Math.min(20, Math.max(10, rf.roofT || 15));
    let z;
    switch (style) {
      case 'flat': return z0 + RT + 0.2;
      case 'shed': z = z0 + k * (D - y); break;
      case 'gable': case 'box-gable': case 'saltbox': {
        const yr = style === 'saltbox' ? D * 0.35 : D / 2, zr = z0 + k * yr;
        z = y <= yr ? z0 + ((zr - z0) / yr) * y : zr - ((zr - z0) / (D - yr)) * (y - yr);
        break;
      }
      case 'clerestory': {
        const yr = D * 0.35, zr = z0 + k * yr, zt = zr + 50, kf = (zt - z0) / (D - yr);
        z = y >= yr - 20 ? zt - kf * (y - yr) : z0 + k * y; // the upper (front) slope reaches 20 cm back over the step
        break;
      }
      case 'hip': z = z0 + k * Math.min(x, W - x, y, D - y); break;
      case 'hip-l': {
        // the hip roof, except over the part left out
        const Ls = window.FP_ROOFS.lShape(W, D, rf), [nx, ny] = Ls.reflex, sx = Ls.corner[1] === 'r' ? 1 : -1, sy = Ls.corner[0] === 'b' ? 1 : -1;
        if (sx * (x - nx) > 0 && sy * (y - ny) > 0) return null;
        z = z0 + k * Math.min(x, W - x, y, D - y);
        break;
      }
      case 'mansard': {
        const b = Math.min(W, D) * 0.2, d = Math.min(x, W - x, y, D - y), k2 = Math.tan((Math.min(pitch, 25) * Math.PI) / 180);
        z = d < b ? z0 + k65 * d : z0 + k65 * b + k2 * (d - b);
        break;
      }
      case 'gambrel': { const yb = D * 0.22, dy = Math.min(y, D - y); z = dy < yb ? z0 + k65 * dy : z0 + k65 * yb + k * (dy - yb); break; }
      case 'butterfly': z = z0 + k * Math.abs(y - D / 2); break;
      default: return null;
    }
    return z + RT;
  }
  /* Roof window (skylight): an aluminium frame with glass, lying on the covering of the roof under it and following
     its slope (each corner at the roof's height there). Without a roof over it, it lies flat at the top of the walls of
     its level. In the item's own frame, heights from its level's base. */
  /* Chimney: a stack (brick, stone or plaster: it.chimMat) rising through the roof under it, from below the covering
     to it.chimH (default 1 m) above the highest point where it meets the roof, with a concrete cap and clay flue pots
     (it.chimPots, default 1). Without a roof over it, it stands on its level's floor and rises past the top of the
     walls. In the item's own frame, heights from its level's base. */
  /* Fireplace in the item's frame (x along w, z along h, y up; the back against the wall at z = 0, the hearth in front):
     a surround (brick, stone, plaster or marble: it.fpMat, coloured it.fill) with an arched-top firebox opening, a
     sooty firebox with logs and — when lit (it.fpLit, default on) — glowing flames and embers, a timber mantel shelf,
     a stone hearth slab, and optionally a chimney breast up to the ceiling (it.fpBreast). Height it.fh (default 110). */
  function buildFireplace(it, m) {
    const g = new T.Group(), W = it.w, D = it.h, bd = Math.max(20, D * (55 / 70)), H = Math.max(60, Math.min(250, it.fh || 110));
    const mid = it.fpMat === 'marble' ? null : WM.MATS[it.fpMat] ? it.fpMat : 'brick';
    const col = it.fill && it.fill !== '#ffffff' ? it.fill : mid ? WM.MATS[mid].color : '#ece8e1';
    const surM = mid ? new T.MeshStandardMaterial({ map: wallTexture(mid, col), roughness: 0.9 }) : new T.MeshStandardMaterial({ color: col, roughness: 0.25, metalness: 0.05 });
    if (mid) surM.userData.tile = WM.MATS[mid].tile;
    const sootM = new T.MeshStandardMaterial({ color: '#1d1b1a', roughness: 0.95 });
    const hearthM = new T.MeshStandardMaterial({ color: '#5d5a55', roughness: 0.6 });
    const mantelM = new T.MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.7 });
    const logM = new T.MeshStandardMaterial({ color: '#5a3b22', roughness: 1 });
    const add = (o) => { o.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } }); g.add(o); return o; };
    const blk = (w, h, d, x, y, z, mat) => {
      const geo = new T.BoxGeometry(Math.max(0.5, w), Math.max(0.5, h), Math.max(0.5, d)); geo.translate(x, y, z);
      if (mat.userData.tile) planarUV(geo, mat.userData.tile);
      const mesh = new T.Mesh(geo, mat); add(mesh);
      g.add(new T.LineSegments(new T.EdgesGeometry(geo, 30), m.edge));
      return mesh;
    };
    // the firebox opening: half the width (40–90 cm), up to 55 % of the height, with a rounded top
    const ow = Math.max(30, Math.min(W - 30, Math.max(40, Math.min(90, W * 0.5)))), oh = Math.max(35, Math.min(H - 25, H * 0.55));
    const ox0 = (W - ow) / 2, ox1 = ox0 + ow, hearthT = 6;
    const fd = Math.max(15, bd - 12);                       // how deep the firebox goes in
    // surround: two piers, the panel above the opening, and the back
    blk(ox0, H, bd, ox0 / 2, H / 2, bd / 2, surM);
    blk(W - ox1, H, bd, (ox1 + W) / 2, H / 2, bd / 2, surM);
    blk(ow, H - oh, bd, W / 2, oh + (H - oh) / 2, bd / 2, surM);
    blk(ow, oh, bd - fd, W / 2, oh / 2, (bd - fd) / 2, surM);
    // rounded head of the opening (a shallow arch filling the top corners), in the surround
    const ar = archOf(ox0, ox1, oh, Math.min(ow * 0.25, 18)), curve = archCurve(ar);
    const sp = new T.Shape([[ox0, ar.spring], ...curve, [ox1, ar.spring], [ox1, oh + 0.5], [ox0, oh + 0.5]].map(([x, y]) => new T.Vector2(x, y)));
    const sg = new T.ExtrudeGeometry(sp, { depth: fd, bevelEnabled: false, curveSegments: 1 }); sg.translate(0, 0, bd - fd);
    if (surM.userData.tile) planarUV(sg, surM.userData.tile);
    add(new T.Mesh(sg, surM));
    // the sooty firebox lining (back and sides), its floor at the hearth
    blk(ow, oh, 2, W / 2, oh / 2, bd - fd + 1, sootM);
    blk(2, oh, fd, ox0 + 1, oh / 2, bd - fd / 2, sootM); blk(2, oh, fd, ox1 - 1, oh / 2, bd - fd / 2, sootM);
    blk(ow, 2, fd, W / 2, hearthT - 1, bd - fd / 2, sootM);
    // hearth slab in front (and under the firebox), a mantel shelf on top
    blk(W + 10, hearthT, D - bd + fd, W / 2, hearthT / 2, bd - fd + (D - bd + fd) / 2, hearthM);
    blk(W + 16, 6, bd + 10, W / 2, H + 3, (bd + 10) / 2, mantelM);
    // logs on a grate, and — when lit — flames and a warm glow
    const lr = Math.min(6, ow / 12), lz = bd - fd / 2;
    for (const [dx, dy, ry] of [[-0.18, 0, 0.25], [0.18, 0, -0.2], [0, 1.6, 0.05]]) {
      const lg = new T.Mesh(new T.CylinderGeometry(lr, lr, ow * 0.55, 10), logM);
      lg.rotation.set(0, ry, Math.PI / 2); lg.position.set(W / 2 + dx * ow * 0.5, hearthT + lr + dy * lr, lz); add(lg);
    }
    if (it.fpLit !== false) {
      const flameM = new T.MeshBasicMaterial({ color: '#ff9a2e', transparent: true, opacity: 0.85 });
      const coreM = new T.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.9 });
      const n = Math.max(3, Math.round(ow / 15));
      for (let i = 0; i < n; i++) {
        const x = ox0 + ow * (0.2 + (0.6 * (i + 0.5)) / n), h = oh * (0.28 + 0.18 * Math.abs(Math.sin(i * 2.3)));
        const f = new T.Mesh(new T.ConeGeometry(lr * 1.1, h, 8), flameM); f.position.set(x, hearthT + lr * 2 + h / 2, lz); g.add(f);
        const c = new T.Mesh(new T.ConeGeometry(lr * 0.6, h * 0.6, 8), coreM); c.position.set(x, hearthT + lr * 2 + h * 0.3, lz + 1); g.add(c);
      }
      const glow = new T.PointLight('#ff8a3d', 0.9, 350, 2); glow.position.set(W / 2, hearthT + oh * 0.35, bd + 10); g.add(glow);
    }
    // chimney breast: the surround carried on up to the ceiling, a little narrower than the mantel
    if (it.fpBreast) {
      const top = (FP.plan().wallH || WALL_H), bw = Math.max(ow + 20, W - 20);
      if (top > H + 6) blk(bw, top - H - 6, bd - 5, W / 2, H + 6 + (top - H - 6) / 2, (bd - 5) / 2, surM);
    }
    return g;
  }
  function buildChimney(it) {
    const g = new T.Group(), W = it.w, D = it.h, tf = window.FPWalls.toWorld(it);
    const L = FP.levels().find((l) => l.id === FP.levelOf(it)) || { id: 'L0', elev: 0 };
    const c = tf([W / 2, D / 2]);
    let roof = null, best = -Infinity;
    for (const rf of FP.items()) {
      if (!FP.byId[rf.type] || !FP.byId[rf.type].roof || rf.hide3d) continue;
      const z = roofTopAt(rf, c[0], c[1]);
      if (z != null && z > best) { best = z; roof = rf; }
    }
    const floor = L.elev + (FP.floorRel ? FP.floorRel(L.id) : 0), wallTop = floor + stdWallH();
    let bot, meet;
    if (roof) {
      const hs = [[0, 0], [W, 0], [W, D], [0, D], [W / 2, D / 2]].map(([x, y]) => { const p = tf([x, y]), z = roofTopAt(roof, p[0], p[1]); return z == null ? best : z; });
      bot = Math.min(...hs) - 40; meet = Math.max(...hs);
    } else { bot = floor; meet = wallTop; }
    const top = meet + Math.max(20, Math.min(400, it.chimH == null ? 100 : it.chimH));
    const mid = WM.MATS[it.chimMat] ? it.chimMat : 'brick', col = it.fill || WM.MATS[mid].color;
    const shaftM = new T.MeshStandardMaterial({ map: wallTexture(mid, col), roughness: 0.9 });
    const capM = new T.MeshStandardMaterial({ color: '#bdb8ae', roughness: 0.85 });
    const potM = new T.MeshStandardMaterial({ color: '#b5653a', roughness: 0.8 });
    const y0 = bot - L.elev, y1 = top - L.elev;
    const geo = new T.BoxGeometry(W, y1 - y0, D);
    geo.translate(W / 2, (y0 + y1) / 2, D / 2);
    planarUV(geo, WM.MATS[mid].tile);
    const shaft = new T.Mesh(geo, shaftM); shaft.castShadow = shaft.receiveShadow = true;
    g.add(shaft, new T.LineSegments(new T.EdgesGeometry(geo, 30), new T.LineBasicMaterial({ color: '#3a3d42', transparent: true, opacity: 0.35 })));
    g.add(box(W + 8, 6, D + 8, W / 2, y1 + 3, D / 2, capM));                       // the cap, overhanging 4 cm
    const n = Math.max(0, Math.min(3, it.chimPots == null ? 1 : it.chimPots)), r = Math.max(5, Math.min(W / (2 * Math.max(1, n)) - 3, D / 2 - 4, 12));
    for (let i = 0; i < n; i++) {
      const x = (W * (i + 0.5)) / n;
      const pot = cyl(r * 0.8, r, 30, x, y1 + 6 + 15, D / 2, potM, null, 20); pot.castShadow = true;
      g.add(pot);
    }
    return g;
  }
  function buildRoofWindow(it) {
    const g = new T.Group(), W = it.w, D = it.h, tf = window.FPWalls.toWorld(it);
    const L = FP.levels().find((l) => l.id === FP.levelOf(it)) || { id: 'L0', elev: 0 };
    const c = tf([W / 2, D / 2]);
    let roof = null, best = -Infinity;
    for (const rf of FP.items()) {
      if (!FP.byId[rf.type] || !FP.byId[rf.type].roof || rf.hide3d) continue;
      const z = roofTopAt(rf, c[0], c[1]);
      if (z != null && z > best) { best = z; roof = rf; }
    }
    const flat = L.elev + (FP.floorRel ? FP.floorRel(L.id) : 0) + stdWallH();
    /* the window is one flat panel lying in the roof plane at its middle (the tangent plane there): on a ridge, a hip
       or a break of slope it keeps the slope of the side its middle is on, instead of bending over the change */
    const at = (lx, ly) => { const p = tf([lx, ly]), z = roof ? roofTopAt(roof, p[0], p[1]) : null; return z == null ? (roof ? best : flat) : z; };
    const e = 2, cx = W / 2, cy = D / 2, hc = at(cx, cy);
    // slope of the plane under the middle: one-sided differences that stay on the side of the middle (not across a ridge)
    const slope = (dx, dy) => { const f = at(cx + dx * e, cy + dy * e), b = at(cx - dx * e, cy - dy * e); return Math.abs(f - hc) <= Math.abs(b - hc) ? (f - hc) / e : (hc - b) / e; };
    const gx = slope(1, 0), gy = slope(0, 1);
    const H = (lx, ly) => hc + gx * (lx - cx) + gy * (ly - cy) - L.elev;
    const frameM = new T.MeshStandardMaterial({ color: it.fill && it.fill !== '#ffffff' ? it.fill : '#3b3f45', roughness: 0.4, metalness: 0.6, side: T.DoubleSide });
    const glassM = new T.MeshStandardMaterial({ color: '#9fcbe4', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55, side: T.DoubleSide });
    const quad = (pts, mat) => {
      const pos = [...pts[0], ...pts[1], ...pts[2], ...pts[0], ...pts[2], ...pts[3]];
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const m = new T.Mesh(geo, mat); m.castShadow = !mat.transparent; m.receiveShadow = true; g.add(m);
    };
    const P = (lx, ly, up) => [lx, H(lx, ly) + up, ly];
    const out = [[0, 0], [W, 0], [W, D], [0, D]], inset = Math.min(8, W / 4, D / 4);
    const inn = [[inset, inset], [W - inset, inset], [W - inset, D - inset], [inset, D - inset]];
    const UP = 9; // the frame stands 9 cm proud of the covering
    for (let i = 0; i < 4; i++) {
      const [a, b] = [out[i], out[(i + 1) % 4]], [ai, bi] = [inn[i], inn[(i + 1) % 4]];
      quad([P(a[0], a[1], -3), P(b[0], b[1], -3), P(b[0], b[1], UP), P(a[0], a[1], UP)], frameM);       // the curb sides
      quad([P(a[0], a[1], UP), P(b[0], b[1], UP), P(bi[0], bi[1], UP), P(ai[0], ai[1], UP)], frameM);  // the frame on top
    }
    quad(inn.map(([x, y]) => P(x, y, UP - 1.5)), glassM);                                               // the glass
    return g;
  }
  const wallHeight = (it) => it.wh || stdWallH();

  // total height a staircase climbs: its own setting, else the plan's wall height
  const stairRise = (it) => (FP.stairRise ? FP.stairRise(it) : it.rise || FP.storeyRise(it));

  /* Floor openings (stairwells): world outlines of the 'slab-opening' items on the level being built */
  let SLAB_HOLES = [];
  let LV_ITEMS = [], LV_MODEL = null; // the level being built (its items and wall model)
  const openingOutline = (op) => { const tf = window.FPWalls.toWorld(op); return [tf([0, 0]), tf([op.w, 0]), tf([op.w, op.h]), tf([0, op.h])]; };
  // world point -> an item's own (unrotated, unflipped) coordinates
  function toLocal(it, [X, Y]) {
    const rad = (it.r * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad), dx = X - (it.x + it.w / 2), dy = Y - (it.y + it.h / 2);
    let x = dx * c + dy * s + it.w / 2, y = -dx * s + dy * c + it.h / 2;
    if (it.fx) x = it.w - x;
    if (it.fy) y = it.h - y;
    return [x, y];
  }
  function insidePoly(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /* Floor levels (ground = 0): set on every rebuild */
  let EL = { at: () => 0, seg: () => 0, opening: () => 0 };
  // level an object stands on: doors/windows use their threshold, everything else the floor under its centre
  /* Several floor slabs on a level: each is tinted with its own grey (the same as on the plan: the lowest lightest,
     higher ones darker), so slabs at different heights can be told apart in 3D too. */
  function shadeSlab(g, it) {
    const grey = FP.slabGray && FP.slabGray(it);
    if (!grey) return;
    const m = /([\d.]+)%\)\s*$/.exec(grey), L = m ? +m[1] / 100 : 1;
    const f = Math.max(0.5, Math.min(1, L / 0.95)); // 95 % → 1.0 … 55 % → 0.58
    const done = new Map();
    g.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const tint = (mat) => {
        if (!mat || !mat.color) return mat;
        if (done.has(mat)) return done.get(mat);
        const c = mat.clone();
        const grey3 = new T.Color(L, L, L);
        c.color.lerp(grey3, 0.5).multiplyScalar(f);
        done.set(mat, c);
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material);
    });
  }
  const baseOf = (it) => (FP.byId[it.type].opening ? EL.opening(it) : EL.at(it.x + it.w / 2, it.y + it.h / 2));

  function buildWall(it, model, wh) {
    const mats = materials(it), g = new T.Group();
    for (const s of model.segs) {
      if (s.id !== it.id) continue;
      // a wall stands on the ground and rises to (floor level beside it) + its height, so rooms keep their height
      const base = EL.seg(s), top = base + Math.min(wallHeight(it), wh);
      const sideMats = wallSideMats(mats, s);
      // height range of the opening that cuts the wall at position x (to outline its sides only)
      const openingAt = (x) => {
        const c = s.cuts.find((k) => Math.abs(k[0] - x) < 0.6 || Math.abs(k[1] - x) < 0.6);
        const op = c && FP.items().find((i) => i.id === c[2]);
        if (!op) return false;
        const ob = EL.opening(op), arch = FP.byId[op.type].opening.arch;
        if (WINDOW_TYPES.has(op.type)) {
          const [z0, z1] = window.FPWalls.windowSpan(op, base + wallHeight(it) - ob).map((z) => z + ob);
          // an arch: the jamb is outlined only up to where the curve starts
          return arch ? [z0, archOf(c[0], c[1], z1, (z1 - z0) * 0.5).spring] : [z0, z1];
        }
        if (arch) return [ob, ob + archOf(c[0], c[1], DOOR_H, DOOR_H * 0.45).spring];
        const prof = FP.byId[op.type].opening.profile;
        return [ob, ob + (prof === 'garage' ? 220 : prof === 'revolving' ? 232 : DOOR_H)];
      };
      for (const [a, b] of window.FPWalls.solidPieces(s.len, s.cuts)) {
        // the end of a piece is a real wall end only where no opening continues it
        const edges = { top: true, bottom: true, start: a <= 0.5 || openingAt(a), end: b >= s.len - 0.5 || openingAt(b) };
        g.add(segBox(s, a, b, base, top, sideMats, mats.wallEdge, s.t, { id: it.id, seg: s }, 0, edges)); // from the floor level up
      }
    }
    g.traverse((o) => { o.userData.id = it.id; });
    return g;
  }

  // box materials for a wall piece: ends/top/bottom use the main material, the two long sides their own
  const wallSideMats = (mats, s) => [mats.wall, mats.wall, mats.wall, mats.wall, mats.face(s, 1), mats.face(s, -1)];

  /* ───────────── windows: each window icon has its own 3D model ─────────────
   * Built along a wall segment `s` between lo and hi (cm along it): the wall below the sill and above the top,
   * a frame, and then the glazing that matches the icon. */
  const WINDOW_TYPES = new Set(['window', 'window-sill', 'window-casement', 'window-basement', 'window-arched']);

  /* Arches. An arch over an opening lo…hi whose crown is at `head`: semicircular when the opening is narrow,
     segmental (flatter) when it is wide. Points are [cm along the segment, height]. */
  function archOf(lo, hi, head, maxRise) {
    const half = (hi - lo) / 2, rise = Math.max(1, Math.min(half, maxRise)), R = (half * half + rise * rise) / (2 * rise);
    return { cx: (lo + hi) / 2, half, rise, R, yc: head - R, spring: head - rise };
  }
  // points on the arch's circle (radius R − inset) between the two verticals x = cx ± (half − inset), left to right
  function archCurve(ar, inset = 0, n = 24) {
    const r = ar.R - inset, h = Math.max(0.1, ar.half - inset), a0 = Math.acos(Math.min(1, -h / r)), a1 = Math.acos(Math.min(1, h / r)), pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([ar.cx + r * Math.cos(a), ar.yc + r * Math.sin(a)]); }
    return pts;
  }
  /* A flat shape in a wall segment's plane (x = cm along s, y = height), extruded `depth` across the wall around `off`.
     mat: one material, or [face, sides]; heights above zMax are cut off (the "cut walls" view). */
  function segExtrude(s, pts, depth, off, mat, edgeMat = null, zMax = Infinity) {
    const grp = new T.Group();
    const P = pts.map(([x, y]) => new T.Vector2(x, Math.min(y, zMax)));
    if (Math.abs(T.ShapeUtils.area(P)) < 1) return grp;
    const geo = new T.ExtrudeGeometry(new T.Shape(P), { depth, bevelEnabled: false, curveSegments: 1 });
    geo.translate(0, 0, off - depth / 2);
    const mats = Array.isArray(mat) ? mat : [mat, mat];
    if (mats.some((m) => m.userData.tile)) {
      // wall textures at real scale, like the wall pieces around them
      const mi = new Array(geo.attributes.position.count).fill(0);
      for (const g of geo.groups) for (let i = g.start; i < g.start + g.count; i++) mi[i] = g.materialIndex;
      planarUV(geo, (i) => mats[mi[i]].userData.tile || [100, 100]);
    }
    grp.position.set(s.A[0], 0, s.A[1]);
    grp.rotation.y = -Math.atan2(s.u[1], s.u[0]); // local x = along the segment, local +z = its normal
    const m = new T.Mesh(geo, mats);
    m.castShadow = !mats[0].transparent; m.receiveShadow = true;
    grp.add(m);
    if (edgeMat) grp.add(new T.LineSegments(new T.EdgesGeometry(geo, 30), edgeMat));
    return grp;
  }
  // the wall filling the two corners between an arch and the square opening around it (wm = the wall's box materials)
  function archSpandrels(s, ar, lo, hi, head, wm, face, zMax) {
    if (!Array.isArray(wm)) wm = [wm, wm, wm, wm, wm, wm]; // one material for all faces (a window standing on its own)
    const g = new T.Group(), arc = archCurve(ar), k = arc.length >> 1, t = s.t;
    const left = [[lo, ar.spring], ...arc.slice(0, k + 1), [ar.cx, head], [lo, head]];
    const right = [...arc.slice(k), [hi, ar.spring], [hi, head], [ar.cx, head]];
    for (const pts of [left, right]) {
      // two halves so each side of the wall keeps its own finish
      for (const [side, fm] of [[1, wm[4]], [-1, wm[5]]]) {
        const part = segExtrude(s, pts, t / 2, (side * t) / 4, [fm, wm[0]], null, zMax);
        if (face) part.traverse((o) => { if (o.isMesh) o.userData.wallFace = face; });
        g.add(part);
      }
    }
    return g;
  }

  // wallTop: top of the wall above ground; base: finished floor level the window's heights are measured from
  function buildWindow(it, s, lo, hi, wallTop, wh, wallMat, face, wallEdge, base = 0) {
    const g = new T.Group(), mats = materials(it);
    const top = Math.min(wallTop, base + wh);
    const [s0, h0] = window.FPWalls.windowSpan(it, wallTop - base);
    const sill = base + s0, head = base + h0;
    // wall below the sill and above the window (at the wall's own thickness and face materials);
    // outlined only along the opening and the wall top, so no seams show on the wall
    // (no wall material = the wall is hidden in 3D: only the window itself is built)
    if (wallMat) {
      g.add(segBox(s, lo, hi, base, Math.min(sill, top), wallMat, wallEdge, s.t, face, 0, { top: true, bottom: true }));
      if (head < top) g.add(segBox(s, lo, hi, head, top, wallMat, wallEdge, s.t, face, 0, { top: true, bottom: it.type !== 'window-arched' }));
    }
    if (sill >= top) return g;

    const zh = Math.min(head, top), cutTop = zh < head;  // "cut walls" mode may slice through the window
    const fw = 5, fd = Math.min(9, s.t), F = mats.frame, E = mats.edge;
    const box = (a, b, z0, z1, m, depth = fd, off = 0, edge = E) => g.add(segBox(s, a, b, z0, z1, m, edge, depth, null, off));
    if (it.type === 'window-arched') {
      // arched window: straight jambs up to the springing line, then a curved frame; a fanlight above a transom
      const ar = archOf(lo, hi, head, (head - sill) * 0.5), sp = ar.spring;
      if (wallMat) g.add(archSpandrels(s, ar, lo, hi, head, wallMat, face, top));
      const outer = archCurve(ar), inner = archCurve(ar, fw);
      box(lo, lo + fw, sill, Math.min(sp, zh), F); box(hi - fw, hi, sill, Math.min(sp, zh), F);
      box(lo, hi, sill, sill + fw, F);
      if (zh > sp - fw) g.add(segExtrude(s, [...outer, ...inner.slice().reverse()], fd, 0, F, E, zh)); // the curved frame
      const a = lo + fw, b = hi - fw, z0 = sill + fw, mid = (a + b) / 2;
      g.add(segExtrude(s, [[a, z0], [b, z0], ...inner.slice().reverse()], 1.5, 0, mats.glass, null, zh));
      // transom at the springing line and a mullion up the middle
      if (sp - 1.5 < zh && sp - 1.5 > z0) box(a, b, sp - 1.5, Math.min(sp + 1.5, zh), F, fd - 2);
      box(mid - 2, mid + 2, z0, Math.min(zh, head - fw), F, fd - 2);
      return g;
    }
    // outer frame
    box(lo, lo + fw, sill, zh, F); box(hi - fw, hi, sill, zh, F);
    box(lo, hi, sill, sill + fw, F);
    if (!cutTop) box(lo, hi, zh - fw, zh, F);
    const a = lo + fw, b = hi - fw, z0 = sill + fw, z1 = cutTop ? zh : zh - fw, mid = (a + b) / 2;

    if (it.type === 'window') {
      // fixed double window: two panes split by a mullion
      box(a, b, z0, z1, mats.glass, 1.5, 0, null);
      box(mid - 2.5, mid + 2.5, z0, z1, F, fd - 2);
    } else if (it.type === 'window-sill') {
      // four panes (cross muntins) and a stone sill that sticks out on both sides
      box(a, b, z0, z1, mats.glass, 1.5, 0, null);
      box(mid - 1.5, mid + 1.5, z0, z1, F, 4);
      if (!cutTop) box(a, b, (z0 + z1) / 2 - 1.5, (z0 + z1) / 2 + 1.5, F, 4);
      box(lo - 6, hi + 6, sill - 4, sill, mats.stone, s.t + 12);
    } else if (it.type === 'window-casement') {
      // two sashes swung open 35°, towards the side the icon's sashes point
      const ic = FP.byId[it.type], sy = it.h / ic.h, tf = window.FPWalls.toWorld(it);
      const p1 = tf([it.w / 2, 52.5 * sy]), p2 = tf([it.w / 2, 10 * sy]);
      const side = Math.sign((p2[0] - p1[0]) * s.n[0] + (p2[1] - p1[1]) * s.n[1]) || 1;
      const w = (b - a) / 2;
      g.add(sash(s, a, +1, w, z0, z1, side, mats));
      g.add(sash(s, b, -1, w, z0, z1, side, mats));
    } else if (it.type === 'window-basement') {
      // basement window: one pane, hinged at the bottom and tipped open at the top (towards the arrows of the icon)
      const tf = window.FPWalls.toWorld(it), sy = it.h / FP.byId[it.type].h;
      const p1 = tf([it.w / 2, 7.5 * sy]), p2 = tf([it.w / 2, 0]);
      const side = Math.sign((p2[0] - p1[0]) * s.n[0] + (p2[1] - p1[1]) * s.n[1]) || 1;
      g.add(hopper(s, a, b, z0, z1, side, mats));
    }
    return g;
  }

  // a sash hinged along its bottom edge, tilted open by `angle`
  function hopper(s, a, b, z0, z1, side, mats, angle = 20) {
    const outer = new T.Group(), mid = (a + b) / 2, w = b - a, H = z1 - z0;
    outer.position.set(s.A[0] + s.u[0] * mid, z0, s.A[1] + s.u[1] * mid);
    outer.rotation.y = -Math.atan2(s.u[1], s.u[0]);
    const inner = new T.Group();
    inner.rotation.x = (side * angle * Math.PI) / 180; // the top edge moves towards that side of the wall
    outer.add(inner);
    const part = (bw, bh, bd, x, y, m, edge = true) => {
      const geo = new T.BoxGeometry(bw, bh, bd), mesh = new T.Mesh(geo, m);
      mesh.position.set(x, y, 0);
      mesh.castShadow = !m.transparent;
      inner.add(mesh);
      if (edge) { const l = new T.LineSegments(new T.EdgesGeometry(geo, 30), mats.edge); l.position.copy(mesh.position); inner.add(l); }
    };
    part(w - 6, Math.max(1, H - 6), 1.2, 0, H / 2, mats.glass, false);
    part(w, 3, 4, 0, H - 1.5, mats.frame);
    part(w, 3, 4, 0, 1.5, mats.frame);
    part(3, H, 4, -w / 2 + 1.5, H / 2, mats.frame);
    part(3, H, 4, w / 2 - 1.5, H / 2, mats.frame);
    part(12, 2, 3, 0, H - 4, mats.metal); // handle
    return outer;
  }

  // one opening sash, hinged at `hinge` (cm along the segment), extending in direction dir (+1 / −1)
  function sash(s, hinge, dir, w, z0, z1, side, mats, angle = 35) {
    const outer = new T.Group();
    outer.position.set(s.A[0] + s.u[0] * hinge, 0, s.A[1] + s.u[1] * hinge);
    outer.rotation.y = -Math.atan2(s.u[1], s.u[0]);
    const inner = new T.Group();
    inner.rotation.y = (-dir * side * angle * Math.PI) / 180; // swing towards the chosen side of the wall
    outer.add(inner);
    const H = z1 - z0, part = (bw, bh, bd, x, y, m, edge = true) => {
      const geo = new T.BoxGeometry(bw, bh, bd);
      const mesh = new T.Mesh(geo, m);
      mesh.position.set(x, y, 0);
      mesh.castShadow = !m.transparent;
      inner.add(mesh);
      if (edge) { const l = new T.LineSegments(new T.EdgesGeometry(geo, 30), mats.edge); l.position.copy(mesh.position); inner.add(l); }
    };
    part(w - 6, H - 6, 1.2, (dir * w) / 2, z0 + H / 2, mats.glass, false);
    part(w, 3, 4, (dir * w) / 2, z1 - 1.5, mats.frame);
    part(w, 3, 4, (dir * w) / 2, z0 + 1.5, mats.frame);
    part(3, H, 4, dir * 1.5, z0 + H / 2, mats.frame);
    part(3, H, 4, dir * (w - 1.5), z0 + H / 2, mats.frame);
    return outer;
  }

  // a window that is not in any wall still gets its model, along its own line and thickness
  function buildFreeWindow(it, wh) {
    const line = window.FPWalls.openingLine(it), ic = FP.byId[it.type];
    const t = ic.opening.fit ? it.h : 15 * (it.h / ic.h);
    const s = { A: line.P0, u: line.u, n: [-line.u[1], line.u[0]], len: line.len, t };
    const mats = materials(it), base = EL.opening(it);
    return buildWindow(it, s, 0, line.len, base + stdWallH(), wh, mats.wall, null, mats.wallEdge, base);
  }

  // What fills the host wall around an opening: always at the host wall's exact line and thickness
  const PROFILES = {
    door: [[DOOR_H, WALL_H, 'wall']],
    garage: [[220, WALL_H, 'wall']],
    revolving: [[232, WALL_H, 'wall']],
  };
  function buildFill(it, host, wh, noWall = false) {
    const g = new T.Group();
    const wall = FP.items().find((i) => i.id === host.seg.id);
    const mats = materials(wall || it);
    // heights above ground: the wall stands on its floor level, the opening on its threshold (the finished floor),
    // a door raised by it.z (e.g. onto a raised balcony) that much higher — the wall continues under it
    const base = EL.opening(it) + (WINDOW_TYPES.has(it.type) ? 0 : (it.z || 0));
    const wallTop = EL.seg(host.seg) + (wall ? wallHeight(wall) : stdWallH()), top = Math.min(wallTop, base + wh);
    const wm = wallSideMats(mats, host.seg), face = wall ? { id: wall.id, seg: host.seg } : null;
    if (WINDOW_TYPES.has(it.type)) return buildWindow(it, host.seg, host.lo, host.hi, wallTop, wh, noWall ? null : wm, face, mats.wallEdge, base);
    // the threshold higher than the wall's foot: the wall continues under the door up to it
    const foot = EL.seg(host.seg);
    if (base > foot + 0.5) g.add(segBox(host.seg, host.lo, host.hi, foot, Math.min(base, top), wm, mats.wallEdge, host.seg.t, face, 0, { top: true, bottom: true }));
    const op = FP.byId[it.type].opening;
    if (op.arch) {
      // arched door: the wall fills the corners above the round head (the wall above DOOR_H comes from the profile)
      const lo = host.lo, hi = host.hi, head = base + DOOR_H, ar = archOf(lo, hi, head, DOOR_H * 0.45);
      if (!noWall && ar.spring < top) g.add(archSpandrels(host.seg, ar, lo, hi, head, wm, face, top));
    }
    for (const [z0, z1, mat, th] of PROFILES[op.profile] || []) {
      const za = base + z0;
      if (za >= top) continue;
      // the part above the opening runs up to the host wall's own top; nothing pokes above a low wall
      const zTop = Math.min(z1 === WALL_H ? wallTop : base + z1, top);
      const m = mat === 'wall' ? wm : mats[mat];
      g.add(segBox(host.seg, host.lo, host.hi, za, zTop, m, mat === 'glass' ? null : mats.wallEdge, th || host.seg.t,
        mat === 'wall' ? face : null, 0, mat === 'wall' ? { top: true, bottom: !op.arch } : null));
    }
    // a door frame round the doorway: two jambs and a head, 6 cm wide, standing 1 cm proud of both wall faces, in the
    // door's frame colour (white unless set); an arched door's jambs stop where the arch begins
    if (DOOR_FRAMED.has(it.type)) {
      const fw = 6, d = host.seg.t + 2, lo = host.lo, hi = host.hi;
      const fm = new T.MeshStandardMaterial({ color: it.frameColor || '#f4f4f2', roughness: 0.45 });
      const head = base + (op.profile === 'garage' ? 220 : DOOR_H);
      const jTop = Math.min(top, op.arch ? archOf(lo, hi, base + DOOR_H, DOOR_H * 0.45).spring : head);
      if (jTop > base + 1) g.add(segBox(host.seg, lo, lo + fw, base, jTop, fm, mats.edge, d), segBox(host.seg, hi - fw, hi, base, jTop, fm, mats.edge, d));
      if (!op.arch && head <= top) g.add(segBox(host.seg, lo, hi, head - fw, head, fm, mats.edge, d));
    }
    return g;
  }
  const DOOR_FRAMED = new Set(['door', 'door-left', 'door-arched', 'door-double', 'door-double-arched', 'door-double-uneven', 'door-double-acting',
    'door-swing', 'door-sliding', 'door-pocket', 'door-bifold', 'door-accordion', 'garage-door']);

  function buildItem(it, wh, host) {
    const ic = FP.byId[it.type];
    if (!ic) return null;
    let parts = spec(it, ic);
    if (host && parts) parts = parts.filter((p) => !p.host);
    if (!parts || !parts.length) return null;
    // "cut walls": slice everything at the cut height, like an architectural section
    parts = parts.filter((p) => p.z0 < wh).map((p) => (p.z1 > wh ? { ...p, z1: wh } : p));

    const g = new T.Group();
    g.position.set(it.x + it.w / 2, 0, it.y + it.h / 2);
    g.rotation.y = (-it.r * Math.PI) / 180;
    g.scale.set(it.fx ? -1 : 1, 1, it.fy ? -1 : 1);
    const inner = new T.Group();
    inner.position.set(-it.w / 2, 0, -it.h / 2);
    g.add(inner);

    const mats = materials(it);
    const tex = parts.some((p) => p.top || p.shape === 'decal') ? texture(it) : null;
    for (const p of parts) buildPart(p, inner, mats, tex, it);
    g.traverse((o) => { o.userData.id = it.id; });
    return g;
  }

  // Map a top surface's UVs onto the matching area of the item's icon texture
  function planUV(geo, it) {
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / it.w, 1 - pos.getZ(i) / it.h);
    uv.needsUpdate = true;
  }

  function shapeOf(p) {
    const shape = new T.Shape(p.pts.map(([x, y]) => new T.Vector2(x, -y)));
    for (const h of p.holes || []) shape.holes.push(new T.Path(h.map(([x, y]) => new T.Vector2(x, -y))));
    return shape;
  }

  function buildPart(p, parent, mats, tex, it) {
    // custom-built objects (trees, slide, swing …) in the item's local frame: x along the plan, y up, z down the plan
    if (p.shape === 'custom') {
      const o = p.build(mats);
      o.traverse((m) => { if (m.isMesh) { m.castShadow = !m.material.transparent; m.receiveShadow = true; } });
      parent.add(o);
      return;
    }
    const H = Math.max(0.5, p.z1 - p.z0);
    const cx = p.x + p.w / 2, cz = p.y + p.h / 2;

    if (p.shape !== 'decal') {
      let geo;
      if (p.shape === 'cyl') {
        geo = new T.CylinderGeometry(1, 1, 1, 40);
        geo.scale(p.w / 2, H, p.h / 2);
        geo.translate(cx, p.z0 + H / 2, cz);
      } else if (p.shape === 'sphere') {
        geo = new T.SphereGeometry(1, 24, 16);
        geo.scale(p.w / 2, H / 2, p.h / 2);
        geo.translate(cx, p.z0 + H / 2, cz);
      } else if (p.shape === 'poly') {
        geo = new T.ExtrudeGeometry(shapeOf(p), { depth: H, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, p.z0, 0);
      } else {
        geo = new T.BoxGeometry(p.w, H, p.h);
        geo.translate(cx, p.z0 + H / 2, cz);
      }
      const mat = mats[p.mat || 'body'];
      if (mat.userData.tile) planarUV(geo, mat.userData.tile);
      const mesh = new T.Mesh(geo, mat);
      mesh.castShadow = !String(p.mat).startsWith('glass');
      mesh.receiveShadow = true;
      parent.add(mesh);
      if (!String(p.mat).startsWith('glass') && p.shape !== 'sphere') {
        parent.add(new T.LineSegments(new T.EdgesGeometry(geo, 30), p.mat === 'wall' ? mats.wallEdge : mats.edge));
      }
    }

    // textured top (or floor decal) showing the original 2D icon
    if ((p.top || p.shape === 'decal') && tex) {
      let geo;
      if (p.shape === 'cyl') {
        geo = new T.CircleGeometry(1, 40);
        geo.rotateX(-Math.PI / 2);
        geo.scale(p.w / 2, 1, p.h / 2);
        geo.translate(cx, 0, cz);
      } else if (p.shape === 'poly') {
        geo = new T.ShapeGeometry(shapeOf(p));
        geo.rotateX(-Math.PI / 2);
      } else {
        geo = new T.PlaneGeometry(p.w, p.h);
        geo.rotateX(-Math.PI / 2);
        geo.translate(cx, 0, cz);
      }
      geo.translate(0, (p.shape === 'decal' ? p.z0 : p.z1) + 0.3, 0);
      planUV(geo, it);
      const m = new T.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.25, roughness: 0.9, side: T.DoubleSide, opacity: it.opacity });
      const top = new T.Mesh(geo, m);
      top.userData.isTop = true;
      top.receiveShadow = true;
      parent.add(top);
    }
  }

  /* The item's 2D icon rendered to a canvas, used on top surfaces */
  function texture(it) {
    const ic = FP.byId[it.type];
    const s = Math.min(5, 1024 / Math.max(it.w, it.h));
    const W = Math.max(2, Math.round(it.w * s)), H = Math.max(2, Math.round(it.h * s));
    const fill = it.fillNone ? 'none' : it.fill;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${it.w} ${it.h}" preserveAspectRatio="none">` +
      `<style>.b{fill:${fill}}.k{fill:${it.stroke}}.tx{fill:${it.stroke};stroke:none;font-family:Arial,sans-serif}*{vector-effect:non-scaling-stroke}</style>` +
      `<svg width="${it.w}" height="${it.h}" viewBox="${FP.iconViewBox(ic, it.w, it.h)}" preserveAspectRatio="none" overflow="visible" ` +
      `fill="none" stroke="${it.stroke}" stroke-width="${Math.max(1.5, it.sw * 1.6)}" stroke-linejoin="round" stroke-linecap="round">` +
      `${FP.iconInner(ic, it.w, it.h, it.type === 'floor' ? { ...it, elev: 0 } : it)}</svg></svg>`; // no level marker on the 3D floor
    const cached = texCache.get(svg);
    if (cached) { cached.used = true; return cached.tex; }

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const tex = new T.CanvasTexture(canvas);
    tex.anisotropy = maxAniso();
    const img = new Image();
    img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0, W, H); tex.needsUpdate = true; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    texCache.set(svg, { tex, used: true });
    return tex;
  }

  /* ───────────────────────── geometry per icon ─────────────────────────
   * Returns parts in the item's local plan coordinates (cm, origin top-left):
   *   { shape: 'box'|'cyl'|'poly'|'sphere'|'decal', x, y, w, h | pts, z0, z1, mat, top }
   */
  const cubic = (p0, p1, p2, p3, n = 12) => Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n, u = 1 - t;
    return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
  });
  const quad = (p0, p1, p2, n = 10) => Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n, u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
  });

  const BLOCKS = { // simple full-footprint boxes: [height, material]
    'tv-stand': [50], storage: [200], bookshelf: [190, 'wood'], radiator: [60, 'metal'], stove: [90], range: [90],
    fridge: [180], dishwasher: [85], washer: [85], sink: [90], 'sink-double': [90], counter: [90], bathtub: [55],
    shower: [6], rug: [1], desk: [75], 'tub-chair': [72],
  };

  function spec(it, ic) {
    const sx = ic.draw ? 1 : it.w / ic.w, sy = ic.draw ? 1 : it.h / ic.h;
    const R = (x, y, w, h, z0, z1, mat = 'body', o = {}) => ({ shape: 'box', x: x * sx, y: y * sy, w: w * sx, h: h * sy, z0, z1, mat, ...o });
    const C = (x, y, w, h, z0, z1, mat = 'body', o = {}) => ({ ...R(x, y, w, h, z0, z1, mat, o), shape: 'cyl' });
    const P = (pts, z0, z1, mat = 'body', o = {}) => ({ shape: 'poly', pts: pts.map(([x, y]) => [x * sx, y * sy]), z0, z1, mat, ...o });
    const decal = (z = 0.5) => ({ shape: 'decal', x: 0, y: 0, w: it.w, h: it.h, z0: z, z1: z });
    const W = it.w, Hh = it.h, t = Math.max(1, Math.min(it.t || 15, W / 2, Hh / 2));
    const wallR = (x, y, w, h) => ({ shape: 'box', x, y, w, h, z0: 0, z1: WALL_H, mat: 'wall' });
    // host: true = this part stands in for the wall; dropped when the opening sits in a real wall,
    // which then provides the sill/lintel at its own thickness instead (see buildFill)
    const H = { host: true };
    const win = (x, y, w, h) => [R(x, y, w, h, 0, SILL_H, 'wall', H), R(x, y, w, h, SILL_H, DOOR_H, 'glass', H), R(x, y, w, h, DOOR_H, WALL_H, 'wall', H)];
    const jamb = (x, y, w, h) => R(x, y, w, h, 0, WALL_H, 'wall', H);
    const lintel = (x, y, w, h, z0 = DOOR_H) => R(x, y, w, h, z0, WALL_H, 'wall', H);
    const leaf = (x, y, w, h, z1 = DOOR_H - 5) => R(x, y, w, h, 0, z1, 'wood');
    // a door shut: its leaf (4 cm) lies in the doorway from x0 to x1 — just inside the wall face for a door hung on a
    // face, in the middle of the wall for one hung on the centreline
    const shut = !doorIsOpen(it), op0 = ic.opening;
    const closedY = op0 ? (op0.mode === 'face' ? op0.y * sy + (op0.dir < 0 ? 1 : -5) : op0.y * sy - 2) : 0;
    const closed = (x0, x1) => ({ ...R(x0, 0, x1 - x0, 1, 0, DOOR_H - 5, 'wood'), y: closedY, h: 4 });
    const chairParts = (cx, cy, rot) => {
      const rr = ([x, y, w, h]) => (rot === 90 ? [-(y + h), x, h, w] : rot === 180 ? [-(x + w), -(y + h), w, h] : rot === -90 ? [y, -(x + w), h, w] : [x, y, w, h]);
      const s = rr([-17, -13, 34, 30]), b = rr([-18, -19, 36, 8]);
      return [R(cx + s[0], cy + s[1], s[2], s[3], 0, 45, 'body', { top: true }), R(cx + b[0], cy + b[1], b[2], b[3], 0, 88, 'body', { top: true })];
    };
    const tableParts = (tb) => {
      if (tb.round) {
        const cx = tb.x + tb.w / 2, cy = tb.y + tb.h / 2;
        return [C(tb.x, tb.y, tb.w, tb.h, 71, 75, 'body', { top: true }), C(cx - 5, cy - 5, 10, 10, 0, 71, 'metal'), C(cx - 22, cy - 22, 44, 44, 0, 2, 'metal')];
      }
      const lg = 5, i = 3;
      return [R(tb.x, tb.y, tb.w, tb.h, 71, 75, 'body', { top: true }),
        ...[[tb.x + i, tb.y + i], [tb.x + tb.w - i - lg, tb.y + i], [tb.x + i, tb.y + tb.h - i - lg], [tb.x + tb.w - i - lg, tb.y + tb.h - i - lg]]
          .map(([x, y]) => R(x, y, lg, lg, 0, 71, 'body'))];
    };
    const steps = (list, rise) => list.map(([x, y, w, h], k) => R(x, y, w, h, 0, (k + 1) * rise, 'body'));

    if (ic.table) {
      const extra = it.type === 'desk-computer' ? [R(45, 8, 50, 4, 75, 115, 'dark'), R(65, 10, 10, 6, 75, 80, 'dark')] : [];
      return [...tableParts(ic.table), ...ic.chairs.flatMap((c) => chairParts(...c)), ...extra];
    }
    if (BLOCKS[it.type]) {
      const [h, mat = 'body'] = BLOCKS[it.type];
      return [R(0, 0, ic.w, ic.h, 0, h, mat, { top: true })];
    }

    // roofs: eaves on the top of the walls under them (see FP.roofBase), relative to the level
    if (ic.roof) {
      const z0 = FP.roofBase(it) - (FP.levels().find((l) => l.id === FP.levelOf(it)) || { elev: 0 }).elev;
      return [{ shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0, z1: z0 + 2000, build: () => buildRoof(it, W, Hh, z0) }];
    }
    switch (it.type) {
      /* floor from the fill tool: largest ring is the outline, the others are holes (columns, islands) */
      case 'floor': {
        const fx = it.w / it.w0, fy = it.h / it.h0;
        const rings = (it.rings || []).map((r) => r.map(([x, y]) => [x * fx, y * fy]));
        if (!rings.length) return [];
        const area = (r) => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0));
        rings.sort((a, b) => area(b) - area(a));
        // floor openings on this level that lie on this floor become holes in it — only the floor at the height of
        // the slab the opening cuts (a lower floor under it on the same level stays closed)
        const fAbs = ((FP.levels().find((l) => l.id === FP.levelOf(it)) || { elev: 0 }).elev) + (it.elev || 0);
        for (const hole of SLAB_HOLES) {
          if (hole.z != null && Math.abs(hole.z - fAbs) > 30) continue;
          const loc = hole.map((p) => toLocal(it, p));
          const cx2 = loc.reduce((s, p) => s + p[0], 0) / 4, cy2 = loc.reduce((s, p) => s + p[1], 0) / 4;
          if (insidePoly(rings[0], cx2, cy2)) rings.push(loc);
        }
        // floor slabs are separate items: a floor lying on one is only its finish layer; a raised floor without one
        // stands on a solid base from the ground up (sides in stone/concrete)
        const e = it.elev || 0, onSlab = FP.slabUnder(it);
        // garden areas at ground level are thinner, so house floors (1.5 cm) always show on top where they overlap
        // stacked garden areas (a patio on a lawn) step up a fraction so they never flicker, staying under 1.5
        const gOrder = it.garden ? FP.items().filter((i) => i.type === 'floor' && i.garden).indexOf(it) : 0;
        const flat = it.garden ? Math.min(1.4, 0.5 + 0.12 * gOrder) : 1.5;
        const [z0, z1, mat] = onSlab ? [e, e + flat, 'body'] : e > 1.5 ? [0, e, 'stone'] : e < 0 ? [e - flat, e, 'body'] : [0, flat, 'body'];
        return [{ shape: 'poly', pts: rings[0], holes: rings.slice(1), z0, z1, mat, top: true }];
      }

      /* walls & structure */
      // columns stand on the ground and rise to (floor level) + their height, like walls
      // a foot offset (it.wz) lifts the whole post; without one it stands from the level's base up
      case 'wall-h': case 'wall-v': case 'column': { const f = EL.at(it.x + W / 2, it.y + Hh / 2), z0 = it.wz ? f + it.wz : 0;
        return [{ ...wallR(0, 0, W, Hh), z0, z1: wallHeight(it) + f + (it.wz || 0) }]; }
      case 'column-round': { const f = EL.at(it.x + W / 2, it.y + Hh / 2), z0 = it.wz ? f + it.wz : 0;
        return [{ ...wallR(0, 0, W, Hh), shape: 'cyl', z0, z1: wallHeight(it) + f + (it.wz || 0) }]; }
      case 'pillar': { const f = EL.at(it.x + W / 2, it.y + Hh / 2), z0 = it.wz ? f + it.wz : 0;
        return [R(0, 0, 40, 40, z0, wallHeight(it) + f + (it.wz || 0), 'wall', { top: true })]; }
      case 'corner-tl': return [wallR(0, 0, W, t), wallR(0, t, t, Hh - t)];
      case 'corner-tr': return [wallR(0, 0, W, t), wallR(W - t, t, t, Hh - t)];
      case 'corner-br': return [wallR(0, Hh - t, W, t), wallR(W - t, 0, t, Hh - t)];
      case 'corner-bl': return [wallR(0, Hh - t, W, t), wallR(0, 0, t, Hh - t)];
      case 'wall-u': return [wallR(0, 0, W, t), wallR(0, t, t, Hh - t), wallR(W - t, t, t, Hh - t)];
      case 'room': return [wallR(0, 0, W, t), wallR(0, Hh - t, W, t), wallR(0, t, t, Hh - 2 * t), wallR(W - t, t, t, Hh - 2 * t)];
      case 'dim-h': case 'dim-v': case 'dim-h-label': case 'dim-v-label': case 'hill': case 'slope': return [];
      // gravel path: laid on the ground along its length; steep stretches become steps
      case 'gravel-path': return [{ shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0: 0, z1: 400, build: () => buildGravelPath(it) }];

      /* windows */
      // floor slab: the floor structure of its level, resting on the walls of the level below (its underside is
      // their ceiling). Wood frame (default) or concrete; floor openings on its level cut through it.
      case 'slab': {
        const S = FP.slabInfo(it), t = S.t, z0 = S.bottom - S.L.elev; // relative to its level
        // its own openings: the stairwells drawn on its level (see FP.slabOpenings)
        const holes = FP.slabOpenings(it).map((op) => openingOutline(op).map((p) => toLocal(it, p)));
        // its outline: auto-fitted to the walls (L-shapes, angled walls), else the rectangle
        const pts = FP.slabPoly(it) || [[0, 0], [W, 0], [W, Hh], [0, Hh]];
        // a sewage hole on its level sinks through it
        for (const pit of LV_ITEMS.filter((o) => o.type === 'sewage-pit' && !o.hide3d)) {
          const loc = openingOutline(pit).map((p) => toLocal(it, p)), c = loc.reduce((m, q) => [m[0] + q[0] / 4, m[1] + q[1] / 4], [0, 0]);
          if (insidePoly(pts, c[0], c[1])) holes.push(loc);
        }
        if ((it.slabType || 'wood') === 'concrete') {
          return [{ shape: 'poly', pts, holes, z0, z1: z0 + t, mat: 'slab' }];
        }
        return [{ shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0, z1: z0 + t, build: (m) => timberFloor(it, pts, z0, t, holes, m) }];
      }
      // floor opening: the hole is cut from the floors; here only its guard railing (it.rail: '3' | '4' | 'none')
      /* balcony: a 15 cm concrete slab (its top = the floor of its level), square or semi-circular, the guard round
         its open edges (stainless railing · all-concrete parapet · low concrete wall with a stainless rail on top),
         optionally a concrete roof over it and steel clothes-drying rods on brackets in front. The back edge (z = 0)
         is against the house wall; the glass sliding door is its own item in that wall. */
      case 'balcony': {
        const round = it.balShape === 'round', Lsh = it.balShape === 'L', guard = ['steel', 'concrete', 'low'].includes(it.balGuard) ? it.balGuard : 'steel';
        const dL = Lsh ? Math.max(60, Math.min(it.balDepth || 150, W * 0.6, Hh * 0.6)) : 0; // an L: the depth of both arms
        const roofH = it.balRoofH || 260;
        return [custom(it.balRoof ? roofH + 12 : 110, () => {
          const g = new T.Group(), Hr = 105, T_SLAB = 15;
          const conc = new T.MeshStandardMaterial({ color: '#cfc9bf', roughness: 0.92 });
          const concTop = new T.MeshStandardMaterial({ color: '#d9d4cb', roughness: 0.9 });
          const steel = new T.MeshStandardMaterial({ color: '#e3e7ec', roughness: 0.3, metalness: 0.45 });
          const iron = new T.MeshStandardMaterial({ color: '#4b5058', roughness: 0.5, metalness: 0.7 });
          // the outline, back edge first: [x, z] points of the open edge (from the wall round to the wall), inset by `ins`
          const edge = (ins) => {
            if (Lsh) return [[ins, Hh - dL], [ins, Hh - ins], [W - ins, Hh - ins], [W - ins, ins], [W - dL, ins]];
            if (!round) return [[ins, 0], [ins, Hh - ins], [W - ins, Hh - ins], [W - ins, 0]];
            const a = W / 2 - ins, b = Hh - ins, pts = [], n = 28;
            for (let k = 0; k <= n; k++) { const t = Math.PI - (Math.PI * k) / n; pts.push([W / 2 + a * Math.cos(t), b * Math.sin(t)]); }
            return pts;
          };
          const slabShape = (grow) => {
            if (Lsh) {
              const g0 = grow, sh = new T.Shape();
              [[-g0, Hh - dL], [W - dL, Hh - dL], [W - dL, -g0], [W + g0, -g0], [W + g0, Hh + g0], [-g0, Hh + g0]].forEach(([x, z], k) => (k ? sh.lineTo(x, z) : sh.moveTo(x, z)));
              sh.closePath();
              return sh;
            }
            const pts = edge(-grow), sh = new T.Shape();
            sh.moveTo(pts[0][0], 0); for (const [x, z] of pts) sh.lineTo(x, z); sh.lineTo(pts[pts.length - 1][0], 0); sh.closePath();
            return sh;
          };
          const slab = (grow, y0, t, mat) => {
            const geo = new T.ExtrudeGeometry(slabShape(grow), { depth: t, bevelEnabled: false, curveSegments: 24 });
            geo.rotateX(Math.PI / 2); // shape (x, z) → plan; extruded downwards
            const m = new T.Mesh(geo, mat); m.position.y = y0; g.add(m); return m;
          };
          slab(0, 0, T_SLAB, conc);
          const rod = (a, b, r, mat) => {
            const A = new T.Vector3(...a), B = new T.Vector3(...b), d = new T.Vector3().subVectors(B, A), L = d.length();
            if (L < 0.5) return;
            const c = new T.Mesh(new T.CylinderGeometry(r, r, L, 10), mat);
            c.position.copy(A).addScaledVector(d, 0.5); c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); g.add(c);
          };
          // a straight piece of wall along a segment of the edge
          const wallSeg = ([x1, z1], [x2, z2], y0, h, t, mat) => {
            const L = Math.hypot(x2 - x1, z2 - z1);
            if (L < 0.5) return;
            const b = box(L + (round ? 1.5 : t), h, t, (x1 + x2) / 2, y0 + h / 2, (z1 + z2) / 2, mat, null, !round);
            b.rotation.y = -Math.atan2(z2 - z1, x2 - x1); g.add(b);
          };
          /* a square balcony's three sides (left, front, right — seen from the house): each a guard ('rail'), a solid
             wall to the height of the storey ('wall', e.g. a balcony set in between rooms) or nothing ('none') */
          const sq = !round && !Lsh, RS = sq && FP.balconySides ? FP.balconySides(it) : null;
          const sideMode = (k) => (RS ? RS[k] : 'rail'); // 'Auto' sides along a house wall have no railing
          const sidePts = (k, ins) => ({ L: [[ins, 0], [ins, Hh - ins]], F: [[ins, Hh - ins], [W - ins, Hh - ins]], R: [[W - ins, Hh - ins], [W - ins, 0]] }[k]);
          // the runs of guard: the whole open edge, or (square) the consecutive railed sides
          const guardRuns = (ins) => {
            if (!sq || ['L', 'F', 'R'].every((k) => sideMode(k) === 'rail')) return [edge(ins)];
            const runs = []; let cur = null;
            for (const k of ['L', 'F', 'R']) {
              if (sideMode(k) !== 'rail') { cur = null; continue; }
              const [a, b] = sidePts(k, ins);
              if (cur) cur.push(b); else runs.push((cur = [a, b]));
            }
            return runs;
          };
          const plaster = new T.MeshStandardMaterial({ color: '#ece6dc', roughness: 0.95 });
          for (const k of ['L', 'F', 'R']) if (sideMode(k) === 'wall') {
            const [a, b] = sidePts(k, 7.5), hW = it.balRoof ? roofH + 12 : 270;
            wallSeg(a, b, -T_SLAB, hW + T_SLAB, 15, plaster);
          }
          const parapet = (h, t) => guardRuns(t / 2).forEach((pts) => {
            for (let k = 0; k < pts.length - 1; k++) { wallSeg(pts[k], pts[k + 1], 0, h, t, conc); wallSeg(pts[k], pts[k + 1], h, 4, t + 4, concTop); }
          });
          // posts every metre or so along the edge, a round handrail on top and rails between
          const railing = (y0) => guardRuns(guard === 'steel' ? 4 : 7).forEach((pts) => {
            let run = 0;
            const lens = pts.slice(1).map((p, k) => Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1])), total = lens.reduce((a, b) => a + b, 0);
            const nPost = Math.max(2, Math.round(total / 100)), step = total / nPost;
            let next = 0;
            for (let k = 0; k < pts.length - 1; k++) {
              const [x1, z1] = pts[k], [x2, z2] = pts[k + 1], L = lens[k];
              while (next <= run + L + 0.01) {
                const f = L ? (next - run) / L : 0, x = x1 + (x2 - x1) * f, z = z1 + (z2 - z1) * f;
                rod([x, y0, z], [x, Hr, z], 2, steel);
                next += step;
              }
              run += L;
              rod([x1, Hr, z1], [x2, Hr, z2], 2.5, steel);
              for (const y of guard === 'low' ? [(y0 + Hr) / 2] : [Hr / 2, 12]) rod([x1, y, z1], [x2, y, z2], 1.4, steel);
            }
          });
          if (guard === 'concrete') parapet(Hr - 4, 12);
          else if (guard === 'low') { parapet(46, 14); railing(50); }
          else railing(0);
          if (it.balRoof) {
            slab(10, roofH + 12, 12, conc);                                         // a concrete canopy, 12 cm thick
            const fascia = edge(-10);
            for (let k = 0; k < fascia.length - 1; k++) wallSeg(fascia[k], fascia[k + 1], roofH - 6, 6, 3, concTop); // a small drip edge
          }
          if (it.balHooks) {
            // two steel brackets on the guard at the front, carrying three drying rods in front of it
            const yR = Hr + 6, front = (x) => (round ? Math.max(0, Hh * Math.sqrt(Math.max(0, 1 - ((x - W / 2) / (W / 2)) ** 2))) : Hh);
            const xs = [W * 0.25, W * 0.75], zF = Math.max(front(xs[0]), front(xs[1]));
            for (const x of xs) {
              const z0 = front(x) - 6;
              rod([x, Hr, z0], [x, yR, z0], 1.6, iron);
              rod([x, yR, z0], [x, yR, zF + 48], 1.6, iron);
              for (const d of [16, 32, 48]) rod([x, yR, zF + d], [x, yR + 6, zF + d], 1.2, iron);   // the hooks
            }
            for (const d of [16, 32, 48]) rod([W * 0.18, yR + 6, zF + d], [W * 0.82, yR + 6, zF + d], 1.3, iron);
          }
          return g;
        })];
      }
      /* low fence (about 1 m): along the item's length, it.lfMat 'wood' (posts, balusters, handrail) · 'concrete'
         (a solid low wall with a coping) · 'iron' (wrought iron: bars, a band of scrolls, finials); it.lfColor */
      case 'low-fence': {
        const mat = ['wood', 'concrete', 'iron'].includes(it.lfMat) ? it.lfMat : 'wood', Hr = it.fh || 100;
        return [custom(Hr + 4, () => {
          const g = new T.Group(), zc = Hh / 2;
          const col = it.lfColor || { wood: '#a0703f', concrete: '#cfc9bf', iron: '#2f3136' }[mat];
          const M = new T.MeshStandardMaterial(mat === 'iron' ? { color: col, roughness: 0.45, metalness: 0.6 } : { color: col, roughness: mat === 'wood' ? 0.7 : 0.95 });
          const add = (o) => (g.add(o), o);
          if (mat === 'concrete') {
            const t = Math.min(Hh, 14);
            add(box(W, Hr - 4, t, W / 2, (Hr - 4) / 2, zc, M));
            add(box(W + 2, 4, t + 4, W / 2, Hr - 2, zc, new T.MeshStandardMaterial({ color: '#bdb6aa', roughness: 0.9 })));
            return g;
          }
          const iron = mat === 'iron', ps = iron ? 4 : 8, n = Math.max(1, Math.round(W / (iron ? 150 : 120)));
          for (let i = 0; i <= n; i++) {
            const x = Math.min(W - ps / 2, Math.max(ps / 2, (W * i) / n));
            add(box(ps, Hr, ps, x, Hr / 2, zc, M, null, !iron));
            if (iron) add(sph(2.6, x, Hr + 2, zc, M));                                         // a finial
          }
          if (iron) {
            add(box(W, 3, 3.5, W / 2, Hr - 1.5, zc, M, null, false));                          // top rail
            add(box(W, 2, 2.5, W / 2, Hr - 16, zc, M, null, false));                           // under the scrolls
            add(box(W, 2.5, 3, W / 2, 8, zc, M, null, false));                                 // bottom rail
            for (let x = 11; x < W - 5; x += 11) add(cyl(0.8, 0.8, Hr - 10, x, (Hr - 10) / 2 + 8, zc, M, null, 8));
            for (let x = 16.5; x < W - 8; x += 22) {                                         // scrolls: rings between the rails
              const ring = new T.Mesh(new T.TorusGeometry(4.5, 0.6, 6, 20), M);
              ring.position.set(x, Hr - 9, zc); add(ring);
            }
          } else {
            add(box(W + 4, 6, Math.max(9, ps + 2), W / 2, Hr - 3, zc, M));                   // handrail
            add(box(W, 5, 5, W / 2, 6, zc, M));                                               // bottom rail
            for (let x = 12; x < W - 6; x += 12) add(box(3.5, Hr - 15, 3.5, x, 8.5 + (Hr - 15) / 2, zc, M, null, false));
          }
          return g;
        })];
      }
      case 'slab-opening': {
        const mode = it.rail || '3';
        if (mode === 'none') return [];
        /* its guard (it.railType): 'steel' stainless posts and rails (default) · 'glass' glass panels, a stainless
           handrail held by stainless arms · 'wire' stainless posts and handrail with tensioned wires · 'concrete' a
           solid parapet · 'wood' posts, balusters and a wooden handrail. it.railColor tints it. It stands on the slab,
           just outside the edge of the hole. */
        const type = ['steel', 'glass', 'wire', 'concrete', 'wood'].includes(it.railType) ? it.railType : 'steel';
        return [custom(105, (m) => {
          const g = new T.Group(), Hr = 100;
          const DEF = { steel: '#d9dde2', glass: '#d9dde2', wire: '#d9dde2', concrete: '#cfcac2', wood: '#a0703f' };
          const col = it.railColor || DEF[type];
          const metal = new T.MeshStandardMaterial({ color: col, roughness: 0.22, metalness: 0.85 });
          const solid = new T.MeshStandardMaterial({ color: col, roughness: type === 'wood' ? 0.7 : 0.95 });
          const fr = type === 'concrete' || type === 'wood' ? solid : metal;
          const glassM = new T.MeshStandardMaterial({ color: '#bfe3f5', transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, depthWrite: false, side: T.DoubleSide });
          const rod = (a, b, r, mat) => {
            const A = new T.Vector3(...a), B = new T.Vector3(...b), d = new T.Vector3().subVectors(B, A), L = d.length();
            if (L < 0.5) return;
            const c = new T.Mesh(new T.CylinderGeometry(r, r, L, 12), mat);
            c.position.copy(A).addScaledVector(d, 0.5);
            c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
            g.add(c);
          };
          // the bottom edge (y = h, where the icon's triangle is) stays open for the stairs
          const edges = [[0, 0, W, 0], [W, 0, W, Hh], [0, Hh, 0, 0]];
          if (mode === '4') edges.push([W, Hh, 0, Hh]);
          for (const [x1, z1, x2, z2] of edges) {
            const L = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(z2 - z1, x2 - x1);
            const ux = (x2 - x1) / L, uz = (z2 - z1) / L, nx = uz, nz = -ux;           // along the edge · outwards (onto the slab)
            const off = type === 'concrete' ? 6 : 3;                                    // set back from the edge of the hole
            const P = (t, y, o = off) => [x1 + ux * t + nx * o, y, z1 + uz * t + nz * o];
            const piece = (len, h, d, t, y, o, mat) => { const b = box(len, h, d, ...P(t, y, o), mat, null, mat !== glassM && type !== 'glass'); b.rotation.y = -ang; g.add(b); return b; };
            if (type === 'concrete') {
              piece(L + 24, Hr, 12, L / 2, Hr / 2, off, fr);                            // a solid parapet, 12 cm thick
              piece(L + 28, 4, 16, L / 2, Hr + 2, off, fr);                             // its coping
              continue;
            }
            const n = Math.max(1, Math.ceil(L / (type === 'glass' ? 120 : 100)));
            if (type === 'glass') {
              // glass panels in a stainless shoe, a round handrail on short arms in front of the glass
              piece(L, 8, 7, L / 2, 4, off, metal);
              piece(L - 2, Hr - 14, 1.6, L / 2, 8 + (Hr - 14) / 2, off, glassM);
              for (let i = 0; i <= n; i++) {
                const t = Math.min(L - 4, Math.max(4, (L * i) / n));
                rod(P(t, Hr - 10, off), P(t, Hr - 10, off + 7), 1.2, metal);               // an arm off the glass
                rod(P(t, Hr - 10, off + 7), P(t, Hr - 3, off + 7), 1.2, metal);
              }
              rod(P(-2, Hr - 1, off + 7), P(L + 2, Hr - 1, off + 7), 2.4, metal);       // the handrail
              continue;
            }
            // steel, wire and wood: posts, a handrail and the infill between
            for (let i = 0; i <= n; i++) {
              const t = (L * i) / n;
              if (type === 'wood') piece(6, Hr, 6, t, Hr / 2, off, fr);
              else rod(P(t, 0), P(t, Hr), type === 'wire' ? 2.2 : 2, metal);
            }
            if (type === 'wood') piece(L + 6, 5, 8, L / 2, Hr + 2.5, off, fr);
            else rod(P(-2, Hr), P(L + 2, Hr), 2.5, metal);
            if (type === 'wire') for (let k = 1; k <= 9; k++) rod(P(0, 6 + k * 9), P(L, 6 + k * 9), 0.3, metal);   // wires about 9 cm apart
            else if (type === 'steel') for (const y of [Hr / 2, 10]) rod(P(0, y), P(L, y), 1.5, metal);
            else { piece(L, 4, 6, L / 2, 8, off, fr); const nb = Math.max(2, Math.round(L / 11)); for (let i = 1; i < nb; i++) piece(2.5, Hr - 12, 2.5, (L * i) / nb, 8 + (Hr - 12) / 2, off, fr); }
          }
          return g;
        })];
      }
      // straight windows are built by buildWindow (in the wall, or along their own line)
      case 'window': case 'window-sill': case 'window-casement': case 'window-basement': case 'window-arched': return [];
      // roof window: laid on the roof under it, following its slope (see buildRoofWindow)
      case 'roof-window': return [{ shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0: 0, z1: 400, build: () => buildRoofWindow(it) }];
      case 'chimney': return [{ shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0: 0, z1: 2000, build: () => buildChimney(it) }];
      case 'railing': return [...[0, 32, 64, 96].map((x) => R(x, 0, 4, 4, 0, 100, 'metal')), R(0, 0, 100, 4, 96, 102, 'metal')];
      case 'bay-window': case 'bay-window-round': {
        const outer = it.type === 'bay-window'
          ? [[0, 0], [25, 0], [40, 40], [100, 40], [115, 0], [140, 0]]
          : [[0, 0], [20, 0], ...cubic([20, 0], [35, 58], [105, 58], [120, 0]), [140, 0]];
        const innerL = it.type === 'bay-window'
          ? [[0, 6], [21, 6], [35, 34], [105, 34], [119, 6], [140, 6]]
          : [[0, 6], [25, 6], ...cubic([25, 6], [38, 46], [102, 46], [115, 6]), [140, 6]];
        const pts = [...outer, ...innerL.reverse()];
        const [sill, head] = window.FPWalls.windowSpan(it, WALL_H);
        // frame posts at the corners of a bay, and every few points along a bow
        const posts = outer.slice(1, -1).filter((_, i, a) => it.type === 'bay-window' || i % 3 === 0 || i === a.length - 1);
        return [P(pts, 0, sill, 'wall'), P(pts, sill, head, 'glass'), P(pts, head, WALL_H, 'wall'),
          ...posts.map(([x, y]) => R(x - 2.5, y - 4, 5, 5, sill, head, 'frame'))];
      }

      /* doors: swing shown on the floor, leaves standing open — or shut in the doorway (it.doorOpen false, see doorIsOpen) */
      case 'door': return shut ? [decal(), closed(0, 90)] : [decal(), leaf(0, 0, 4, 90)];
      case 'door-left': return shut ? [decal(), closed(0, 90)] : [decal(), leaf(86, 0, 4, 90)];
      case 'door-arched': return [decal(), { shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0: 0, z1: DOOR_H, build: (m) =>
        shut ? closedArchLeaf([[0, 90 * sx]], 90 * sx, closedY, DOOR_H - 5, m) : archedLeaf(4 * sx, 90 * sy, DOOR_H - 5, m) }];
      case 'door-double': return shut ? [decal(), closed(0, 80), closed(80, 160)] : [decal(), leaf(0, 0, 4, 80), leaf(156, 0, 4, 80)];
      case 'door-double-arched': return [decal(), { shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0: 0, z1: DOOR_H, build: (m) => {
        if (shut) return closedArchLeaf([[0, 80 * sx], [80 * sx, 160 * sx]], 160 * sx, closedY, DOOR_H - 5, m);
        const g = new T.Group();
        g.add(archedLeaf(4 * sx, 80 * sy, DOOR_H - 5, m, 0, true), archedLeaf(4 * sx, 80 * sy, DOOR_H - 5, m, 156 * sx, true));
        return g;
      } }];
      case 'door-double-uneven': return shut ? [decal(), closed(0, 80), closed(80, 120)] : [decal(), leaf(0, 0, 4, 80), leaf(116, 40, 4, 40)];
      case 'door-double-acting': return shut ? [decal(), closed(0, 50), closed(50, 100)] : [decal(), leaf(0, 0, 4, 50), leaf(96, 50, 4, 50)];
      case 'door-swing': return shut ? [decal(), closed(0, 90)] : [decal(), leaf(0, 90, 4, 90)];
      case 'door-revolving':
        return [decal(), C(2, 2, 96, 96, 0, 220, 'glass'), R(48, 4, 4, 92, 0, 215, 'glass'), R(4, 48, 92, 4, 0, 215, 'glass'),
          C(0, 0, 100, 100, 220, 232, 'metal'), jamb(0, 46, 6, 8), jamb(94, 46, 6, 8)];
      case 'door-sliding': {
        // two glass panels in slim aluminium frames on their own tracks; clear glass, so the room behind shows through
        const panel = (x0, y) => [R(x0, y, 3, 3, 0, DOOR_H, 'frame'), R(x0 + 49, y, 3, 3, 0, DOOR_H, 'frame'),
          R(x0 + 3, y, 46, 3, 0, 5, 'frame'), R(x0 + 3, y, 46, 3, DOOR_H - 5, DOOR_H, 'frame'),
          R(x0 + 3, y + 1.2, 46, 0.6, 5, DOOR_H - 5, 'glassClear')];
        return [jamb(0, 0, 4, 15), jamb(96, 0, 4, 15), lintel(4, 0, 92, 15), ...panel(4, 4), ...panel(shut ? 44 : 8, 8)];
      }
      case 'door-pocket': return [jamb(0, 0, 4, 15), jamb(136, 0, 4, 15), lintel(4, 0, 132, 15), leaf(shut ? 4 : 70, 5.5, 66, 4, DOOR_H)];
      case 'door-bifold': return shut ? [decal(), ...[[0, 25], [25, 50], [50, 75], [75, 100]].map(([a, b]) => closed(a + 0.3, b - 0.3))]
        : [decal(), ...[[0, 40, 25, 8], [50, 40, 25, 8], [50, 40, 75, 8], [100, 40, 75, 8]].map(([x1, y1, x2, y2]) => {
        const a = Math.atan2(y2 - y1, x2 - x1);
        const nx = Math.sin(a) * 2, ny = -Math.cos(a) * 2;
        return P([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], 0, DOOR_H - 5, 'wood');
      })];
      case 'door-accordion': return [decal(), jamb(0, 0, 4, 20), jamb(96, 0, 4, 20), lintel(4, 0, 92, 20),
        ...(shut ? Array.from({ length: 12 }, (_, i) => { const a = 4 + (92 * i) / 12, b = 4 + (92 * (i + 1)) / 12, y0 = i % 2 ? 7 : 11, y1 = i % 2 ? 11 : 7;
          return P([[a, y0 - 0.8], [b, y1 - 0.8], [b, y1 + 0.8], [a, y0 + 0.8]], 0, DOOR_H - 5, 'wood'); }) : [])];
      case 'opening': return [jamb(0, 0, 6, 15), jamb(94, 0, 6, 15), lintel(6, 0, 88, 15)];
      case 'garage-door': return [jamb(0, 0, 8, 20), jamb(232, 0, 8, 20), lintel(8, 0, 224, 20, 220), shut ? R(8, 6, 224, 8, 0, 220, 'body') : R(8, 6, 224, 8, 204, 220, 'body')];

      /* stairs */
      // stairs: the number of steps and the total rise come from the item (see FP_STAIRS.layout)
      case 'stairs-h': case 'stairs-l': case 'stairs-u': {
        const ST = window.FP_STAIRS, lay = ST.layout(it.type, W, Hh, ST.stepsOf(it.type, it), it);
        const riser = stairRise(it) / lay.risers;
        const rails = (it.rail || 'none') !== 'none' ? [custom(stairRise(it) + 100, (m) => buildStairRails(it, lay, riser, W, Hh, m))] : [];
        return [custom(stairRise(it) + 10, (m) => buildStairBody(it, lay, riser, m)), ...rails];
      }
      case 'stairs-spiral': {
        const n = window.FP_STAIRS.stepsOf(it.type, it), rise = stairRise(it), riser = rise / n;
        const cx = W / 2, cy = Hh / 2, rad = Math.min(W, Hh) / 2 - 2;
        const out = [C(cx - 10, cy - 10, 20, 20, 0, rise + 10, 'metal')], b = window.FP_STAIRS.spiralAngles(n, it);
        for (let k = 0; k < n; k++) {
          // each step a wedge between its angles; a top landing is the last, wider and a little thicker
          const a0 = b[k], a1 = b[k + 1], land = b.landing && k === n - 1, seg = land ? 18 : 6;
          const arc = Array.from({ length: seg + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / seg; return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; });
          out.push(P([[cx, cy], ...arc], (k + 1) * riser - (land ? 8 : 5), (k + 1) * riser, 'body'));
        }
        if ((it.rail || 'none') !== 'none') out.push(custom(rise + 100, (m) => buildSpiralRail(it, n, riser, cx, cy, rad, m)));
        return out;
      }

      /* living & bedroom */
      case 'bed-double': case 'bed-single': {
        const bw = ic.w;
        return [R(0, 8, bw, 192, 0, 30), R(2, 8, bw - 4, 190, 30, 55, 'body', { top: true }), R(0, 0, bw, 8, 0, 100, 'wood')];
      }
      case 'sofa': case 'loveseat': case 'armchair': {
        const sw = ic.w, sh = ic.h, arm = it.type === 'armchair' ? 16 : 20, back = it.type === 'armchair' ? 20 : 22;
        return [R(arm, back, sw - 2 * arm, sh - back, 0, 42, 'body', { top: true }), R(0, 0, sw, back, 0, 80, 'body', { top: true }),
          R(0, back, arm, sh - back, 0, 60, 'body', { top: true }), R(sw - arm, back, arm, sh - back, 0, 60, 'body', { top: true })];
      }
      case 'lounge-chair': return [P([[6, 30], [74, 30], [80, 85], [0, 85]], 0, 38, 'body'), R(10, 0, 60, 30, 0, 80, 'body', { top: true })];
      case 'chair': return [R(3, 8, 39, 35, 0, 45, 'body', { top: true }), R(2, 0, 41, 10, 0, 88, 'body', { top: true })];
      case 'office-chair': return [C(26, 28, 8, 8, 0, 45, 'metal'), C(4, 6, 52, 52, 0, 4, 'dark'), R(10, 14, 40, 38, 45, 52, 'body', { top: true }), R(8, 4, 44, 11, 45, 100, 'body', { top: true })];
      case 'desk-corner': case 'desk-l': {
        const pts = it.type === 'desk-l' ? [[0, 0], [160, 0], [160, 60], [60, 60], [60, 140], [0, 140]]
          : [[0, 0], [140, 0], [140, 60], [100, 60], [60, 100], [60, 140], [0, 140]];
        const xr = it.type === 'desk-l' ? 160 : 140;
        return [P(pts, 71, 75, 'body', { top: true }),
          ...[[2, 2], [xr - 7, 2], [xr - 7, 53], [2, 133], [53, 133]].map(([x, y]) => R(x, y, 5, 5, 0, 71))];
      }
      case 'tv': return [R(0, 2, 120, 6, 80, 150, 'dark'), R(40, 8, 40, 10, 0, 80, 'body')];
      case 'fireplace': return [{ shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0: 0, z1: 300, build: (m) => buildFireplace(it, m) }];
      case 'piano': return [R(0, 0, 150, 40, 0, 125, 'body', { top: true }), R(0, 40, 150, 20, 0, 75, 'body', { top: true })];
      case 'grand-piano': {
        const pts = [[0, 0], [100, 0], ...cubic([100, 0], [110, 60], [150, 85], [150, 135]),
          ...cubic([150, 135], [150, 165], [130, 180], [100, 180]), [25, 180], ...quad([25, 180], [0, 180], [0, 155])];
        return [P(pts, 62, 100, 'body', { top: true }), ...[[5, 20], [130, 130], [20, 165]].map(([x, y]) => R(x, y, 7, 7, 0, 62, 'dark'))];
      }
      case 'plant': return [C(20, 20, 30, 30, 0, 35, 'body'), { ...R(3, 3, 64, 64, 30, 100, 'green'), shape: 'sphere' }];

      /* garden — x along the item, z across it (both cm, from the top-left corner), y up */
      case 'fence': case 'fence-metal': {
        const metal = it.type === 'fence-metal', Hf = it.fh || ic.height, zc = Hh / 2;
        return [custom(Hf, (m) => {
          const g = new T.Group(), M = metal ? m.dark : m.timber;
          const posts = Math.max(2, Math.round(W / (metal ? 200 : 180)) + 1);
          for (let i = 0; i < posts; i++) g.add(box(metal ? 6 : 8, Hf + 8, metal ? 6 : 8, 3 + ((W - 6) * i) / (posts - 1), (Hf + 8) / 2, zc, M));
          // rails: near the bottom and the top, plus a middle one on tall fences
          const rails = metal ? [12, Hf - 6] : [Math.min(30, Hf * 0.27), Hf * 0.77];
          if (Hf > 150) rails.push(Hf * 0.5);
          for (const y of rails) g.add(box(W, metal ? 4 : 7, 3, W / 2, y, zc + (metal ? 0 : 3), M));
          for (let x = 12; x < W - 6; x += 12) g.add(box(metal ? 2 : 8, metal ? Hf - 14 : Hf, 2, x, metal ? Hf / 2 : Hf / 2, zc - (metal ? 0 : 1), M));
          return g;
        })];
      }
      // precast concrete fence: 30 cm panels stacked between posts, a capping on top
      case 'fence-concrete': {
        const Hf = it.fh || ic.height, zc = Hh / 2;
        return [custom(Hf + 6, (m) => {
          const g = new T.Group(), n = Math.max(1, Math.round(W / 200)), pw = Math.min(14, W / 4), pd = Math.max(12, Hh);
          for (let i = 0; i <= n; i++) {
            const x = Math.min(W - pw / 2, Math.max(pw / 2, (W * i) / n));
            g.add(box(pw, Hf + 6, pd, x, (Hf + 6) / 2, zc, m.body));
          }
          const rows = Math.max(1, Math.round(Hf / 30)), ph = Hf / rows;
          for (let i = 0; i < n; i++) {
            const x0 = (W * i) / n + pw / 2, x1 = (W * (i + 1)) / n - pw / 2;
            for (let r = 0; r < rows; r++) g.add(box(x1 - x0, ph - 0.8, 5, (x0 + x1) / 2, r * ph + ph / 2, zc, m.body));
          }
          g.add(box(W, 4, 8, W / 2, Hf + 2, zc, m.body)); // capping
          return g;
        })];
      }
      // brick fence: brick wall and piers (the brick texture at real scale, in the item's colour), stone coping on top
      case 'fence-brick': {
        const Hf = it.fh || ic.height, zc = Hh / 2;
        return [custom(Hf + 12, (m) => {
          const g = new T.Group(), n = Math.max(1, Math.round(W / 250)), pw = Math.min(Hh, W / 3), t = Hh * 0.64;
          const brick = new T.MeshStandardMaterial({ color: '#ffffff', map: wallTexture('brick', it.fill || '#a4532f'), roughness: 0.9 });
          const cope = new T.MeshStandardMaterial({ color: '#d9d4c7', roughness: 0.8 });
          const bricks = (w, h, d, x, y, z) => {
            const geo = new T.BoxGeometry(w, h, d);
            planarUV(geo, WM.MATS.brick.tile, [x, y, z]); // courses line up along the whole fence
            const mesh = new T.Mesh(geo, brick);
            mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
            g.add(mesh);
          };
          bricks(W, Hf, t, W / 2, Hf / 2, zc);
          g.add(box(W, 4, t + 6, W / 2, Hf + 2, zc, cope)); // coping along the wall
          for (let i = 0; i <= n; i++) {
            const x = Math.min(W - pw / 2, Math.max(pw / 2, (W * i) / n));
            bricks(pw, Hf + 8, Hh, x, (Hf + 8) / 2, zc);
            g.add(box(pw + 6, 5, Hh + 6, x, Hf + 10.5, zc, cope)); // pier cap
          }
          return g;
        })];
      }
      // stone wall: a battered (tapering) wall in the stone texture, topped with a row of rough cope stones
      case 'fence-stone': {
        const Hf = it.fh || ic.height, zc = Hh / 2;
        return [custom(Hf + 14, (m) => {
          const g = new T.Group(), col = it.fill || '#a39b8b';
          const stone = new T.MeshStandardMaterial({ color: '#ffffff', map: wallTexture('stone', col), roughness: 0.95 });
          // cross-section: full thickness at the foot, 75 % at the top (a 1:8-ish batter on both faces)
          const b = Hh / 2, t = (Hh * 0.75) / 2, body = Hf - 6;
          const shape = new T.Shape([new T.Vector2(-b, 0), new T.Vector2(b, 0), new T.Vector2(t, body), new T.Vector2(-t, body)]);
          const geo = new T.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
          geo.rotateY(Math.PI / 2); // the profile across the wall (z), extruded along it (x)
          geo.translate(0, 0, zc);
          planarUV(geo, WM.MATS.stone.tile);
          const wall = new T.Mesh(geo, stone);
          wall.castShadow = true; wall.receiveShadow = true;
          g.add(wall);
          // cope stones: irregular blocks set on edge along the top
          let seed = 7 + Math.round(W);
          const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
          const capM = new T.MeshStandardMaterial({ color: WM.shade ? WM.shade(col, -0.08) : col, roughness: 0.95 });
          for (let x = 0; x < W - 2;) {
            const len = Math.min(W - x, 14 + rnd() * 16), hh = 9 + rnd() * 7;
            const c = box(len - 1, hh, t * 2 + 4, x + len / 2, body + hh / 2, zc, capM, [0, 0, (rnd() - 0.5) * 0.12], false);
            c.castShadow = true;
            g.add(c);
            x += len;
          }
          return g;
        })];
      }
      // plastic (vinyl) fence: square posts with caps, two rails, wide pickets with gaps
      case 'fence-plastic': {
        const Hf = it.fh || ic.height, zc = Hh / 2;
        return [custom(Hf + 6, (m) => {
          const g = new T.Group(), n = Math.max(1, Math.round(W / 180)), ps = Math.min(10, W / 4);
          for (let i = 0; i <= n; i++) {
            const x = Math.min(W - ps / 2, Math.max(ps / 2, (W * i) / n));
            g.add(box(ps, Hf + 4, ps, x, (Hf + 4) / 2, zc, m.body));
            g.add(box(ps + 3, 3, ps + 3, x, Hf + 5, zc, m.body)); // post cap
          }
          for (const y of [Math.min(25, Hf * 0.22), Hf * 0.75]) g.add(box(W, 8, 4, W / 2, y, zc + 2, m.body));
          for (let x = 12; x < W - 8; x += 15) g.add(box(9, Hf - 8, 2, x + 4.5, (Hf - 8) / 2 + 2, zc - 1, m.body));
          return g;
        })];
      }
      case 'hedge': {
        const Hg = it.fh || ic.height;
        return [custom(Hg, (m) => {
          const g = new T.Group(), body = Math.max(10, Hg - 10);
          g.add(box(W, body, Hh, W / 2, body / 2, Hh / 2, m.leaf, null, false));
          for (let x = Hh / 2; x < W; x += Math.max(30, Hh * 0.7)) g.add(sph(Hh * 0.55, x, body - 5, Hh / 2, m.leaf, [1, Math.min(0.45, 20 / Hh), 1]));
          return g;
        })];
      }
      case 'gate': {
        const Hgt = it.fh || ic.height; // posts at full height, the leaf a little lower
        return [R(0, 92, 6, 8, 0, Hgt, 'timber'), R(94, 92, 6, 8, 0, Hgt, 'timber'), R(4, 2, 4, 90, 5, Math.max(20, Hgt - 20), 'timber')];
      }
      case 'tree': case 'tree-conifer': {
        const conifer = it.type === 'tree-conifer';
        return [custom(500, () => {
          let seed = it.id * 7919 + 13;
          const t = tree(W / 2, Hh / 2, () => ((seed = (seed * 16807) % 2147483647) / 2147483647), conifer);
          t.scale.setScalar(Math.min(W, Hh) / (conifer ? 260 : 300));
          return t;
        })];
      }
      case 'palm': return [custom(480, (m) => {
        const g = new T.Group(), k = Math.min(W, Hh) / 250;
        g.add(cyl(10 * k, 16 * k, 440 * k, W / 2, 220 * k, Hh / 2, m.timber, [0, 0, 0.06]));
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2, f = sph(1, W / 2 + Math.cos(a) * 75 * k, 432 * k, Hh / 2 + Math.sin(a) * 75 * k, m.leaf, [100 * k, 6 * k, 22 * k]);
          f.rotation.set(0, -a, -0.35);
          g.add(f);
        }
        return g;
      })];
      case 'bush': return [custom(90, (m) => {
        const g = new T.Group(), s = Math.min(W, Hh) / 2;
        for (const [dx, dz, r, y] of [[-0.3, -0.1, 0.72, 0.62], [0.32, 0.12, 0.66, 0.58], [0, 0.25, 0.6, 0.85], [0.05, -0.3, 0.55, 0.9]]) {
          g.add(sph(s * r, W / 2 + dx * s, s * y, Hh / 2 + dz * s, m.leaf));
        }
        return g;
      })];
      case 'flowerbed': return [R(0, 0, 200, 80, 0, 18, 'soil'), custom(40, (m) => {
        const g = new T.Group(), sx2 = W / 200, sz2 = Hh / 80;
        const colours = ['#e11d48', '#f59e0b', '#8b5cf6', '#f472b6', '#ffffff', '#facc15'];
        [[25, 22], [60, 50], [95, 25], [130, 55], [165, 28], [45, 62], [115, 40], [180, 60], [80, 12]].forEach(([x, z], i) => {
          g.add(sph(10, x * sx2, 24, z * sz2, m.leaf));
          g.add(sph(6, x * sx2, 33, z * sz2, new T.MeshStandardMaterial({ color: colours[i % colours.length], roughness: 0.8 })));
        });
        return g;
      })];
      case 'planter': return [R(0, 0, 120, 40, 0, 45, 'timber'), R(5, 5, 110, 30, 44, 46, 'soil'), custom(70, (m) => {
        const g = new T.Group();
        for (let x = 18; x < 110; x += 21) g.add(sph(12 * (W / 120), x * (W / 120), 52, Hh / 2, m.leaf));
        return g;
      })];
      case 'bench': return [R(6, 12, 138, 40, 40, 45, 'timber'), R(6, 0, 138, 6, 50, 90, 'timber'),
        R(0, 0, 6, 60, 0, 66, 'dark'), R(144, 0, 6, 60, 0, 66, 'dark')];
      case 'lounger': return [custom(90, (m) => {
        const g = new T.Group(), hinge = 65 * (Hh / 190), a = 0.7, back = 70;
        for (const [x, z] of [[6, 10], [W - 6, 10], [6, Hh - 10], [W - 6, Hh - 10]]) g.add(box(4, 30, 4, x, 15, z, m.dark));
        g.add(box(W, 6, Hh - hinge, W / 2, 33, (hinge + Hh) / 2, m.body));
        const b = box(W - 4, 6, back, W / 2, 33 + Math.sin(a) * back / 2, hinge - Math.cos(a) * back / 2, m.body);
        b.rotation.x = a;
        g.add(b);
        return g;
      })];
      case 'parasol': return [custom(260, (m) => {
        const g = new T.Group();
        g.add(cyl(25, 25, 6, W / 2, 3, Hh / 2, m.dark));
        g.add(cyl(2.5, 2.5, 250, W / 2, 125, Hh / 2, m.metal));
        g.add(cyl(0.1, Math.min(W, Hh) / 2 - 2, 55, W / 2, 222, Hh / 2, m.body, null, 8));
        return g;
      })];
      case 'bbq': return [custom(95, (m) => {
        const g = new T.Group(), r = Math.min(W, Hh) / 2;
        for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; g.add(cyl(1.5, 1.5, 78, W / 2 + Math.cos(a) * r * 0.6, 39, Hh / 2 + Math.sin(a) * r * 0.6, m.dark, [Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15])); }
        g.add(sph(r, W / 2, 80, Hh / 2, m.dark, [1, 0.75, 1]));
        return g;
      })];
      case 'slide': return [custom(230, (m) => {
        const g = new T.Group(), sy2 = Hh / 320, Hp = 150, low = 30;
        // ladder
        for (const x of [4, W - 4]) g.add(box(4, Hp + 75, 4, x, (Hp + 75) / 2, 25 * sy2, m.metal));
        for (let y = 25; y < Hp; y += 25) g.add(box(W - 8, 3, 3, W / 2, y, 25 * sy2, m.metal));
        // platform with guard rails
        g.add(box(W, 6, 50 * sy2, W / 2, Hp, 85 * sy2, m.timber));
        for (const x of [4, W - 4]) { g.add(box(4, 70, 4, x, Hp + 35, 110 * sy2, m.metal)); g.add(box(3, 3, 85 * sy2, x, Hp + 68, 68 * sy2, m.metal)); }
        // sloping chute with low side walls
        const L = (320 - 110) * sy2, drop = Hp - low, len = Math.hypot(L, drop), ang = Math.atan2(drop, L), zc = 110 * sy2 + L / 2, yc = (Hp + low) / 2;
        for (const [w, h, x, dy] of [[W - 16, 3, W / 2, 0], [3, 18, 9, 8], [3, 18, W - 9, 8]]) {
          const c = box(w, h, len, x, yc + dy, zc, m.body);
          c.rotation.x = ang;
          g.add(c);
        }
        for (const x of [9, W - 9]) g.add(box(4, low, 4, x, low / 2, Hh - 10, m.metal));
        return g;
      })];
      case 'swing': return [custom(230, (m) => {
        const g = new T.Group(), Hs = 220, spread = Hh * 0.45, sx2 = W / 320;
        g.add(cyl(6, 6, W, W / 2, Hs, Hh / 2, m.timber, [0, 0, Math.PI / 2]));
        const leg = Math.hypot(Hs, spread), ang = Math.atan2(spread, Hs);
        for (const x of [8, W - 8]) for (const s of [-1, 1]) g.add(cyl(5, 6, leg, x, Hs / 2, Hh / 2 + (s * spread) / 2, m.timber, [s * ang, 0, 0]));
        for (const cx of [100 * sx2, 220 * sx2]) {
          g.add(box(60 * sx2, 4, 20, cx, 45, Hh / 2, m.body));
          for (const dx of [-25 * sx2, 25 * sx2]) g.add(cyl(0.8, 0.8, Hs - 45, cx + dx, (Hs + 45) / 2, Hh / 2, m.dark));
        }
        return g;
      })];
      case 'sandbox': return [R(0, 0, 200, 12, 0, 25, 'timber'), R(0, 188, 200, 12, 0, 25, 'timber'), R(0, 12, 12, 176, 0, 25, 'timber'),
        R(188, 12, 12, 176, 0, 25, 'timber'), R(12, 12, 176, 176, 0, 14, 'sand')];
      case 'trampoline': return [custom(100, (m) => {
        const g = new T.Group(), r = Math.min(W, Hh) / 2;
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.add(cyl(2.5, 2.5, 86, W / 2 + Math.cos(a) * (r - 8), 43, Hh / 2 + Math.sin(a) * (r - 8), m.metal)); }
        const pad = new T.Mesh(new T.TorusGeometry(r - 12, 9, 8, 48), m.pad);
        pad.rotation.x = Math.PI / 2; pad.position.set(W / 2, 88, Hh / 2);
        g.add(pad);
        g.add(cyl(r - 20, r - 20, 1, W / 2, 86, Hh / 2, m.dark, null, 48));
        return g;
      })];
      case 'pond': return [C(0, 0, 250, 180, 0, 5, 'stone'), C(12, 10, 226, 160, 0, 6, 'water')];
      case 'pool': return [{ shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0: 0, z1: 120, build: () => buildPool(it) }];
      case 'sewage-pit': return [{ shape: 'custom', x: 0, y: 0, w: 0, h: 0, z0: 0, z1: 10, build: () => buildSewagePit(it) }];
      case 'shed': return [R(0, 0, 250, 200, 0, 200, 'timber'), R(100, 196, 50, 6, 0, 185, 'dark'), custom(280, (m) => {
        const ov = 15, rise = 75, shape = new T.Shape([new T.Vector2(ov, 200), new T.Vector2(-(Hh + ov), 200), new T.Vector2(-Hh / 2, 200 + rise)]);
        const geo = new T.ExtrudeGeometry(shape, { depth: W + 2 * ov, bevelEnabled: false });
        geo.rotateY(Math.PI / 2); // extrusion runs along x, the shape across the item
        geo.translate(-ov, 0, 0);
        const roof = new T.Mesh(geo, m.roof);
        const g = new T.Group();
        g.add(roof, new T.LineSegments(new T.EdgesGeometry(geo, 30), m.edge));
        return g;
      })];
      case 'car': return [custom(150, (m) => buildCar(W, Hh, m))];
      case 'stepping-stones': return [[30, 25], [26, 85], [32, 145], [28, 205], [31, 268]].map(([x, y], i) => {
        const rx = 26 - (i % 2) * 3, ry = 20 + (i % 2) * 2;
        return C(x - rx, y - ry, rx * 2, ry * 2, 0, 4, 'stone');
      });
      case 'ceiling-fan': return [C(41, 41, 8, 8, 225, WALL_H, 'metal'), decal(225)];

      /* kitchen & bath */
      case 'washbasin': return [P([[0, 0], [60, 0], [60, 20], ...quad([60, 20], [60, 45], [30, 45]), ...quad([30, 45], [0, 45], [0, 20])], 70, 85, 'body', { top: true }),
        R(25, 0, 10, 15, 0, 70)];
      case 'toilet': return [R(0, 0, 45, 18, 0, 80, 'body', { top: true }), C(4.5, 21, 36, 48, 0, 40, 'body', { top: true })];
    }
    // anything else: a block with the icon on top
    return [R(0, 0, ic.w, ic.h, 0, 75, 'body', { top: true })];
  }

  /* ───────────── icon preview: right-click an icon in the picker to see it in 3D ─────────────
   * A small card next to the icon with the object built exactly as in the 3D view (same builders, standard size and
   * settings), turning slowly; drag to turn it, scroll to zoom. Esc, a click elsewhere or another right-click closes it. */
  function previewItem(type) {
    const ic = FP.byId[type], real = ic.makes || type, ric = FP.byId[real];
    const it = { id: -9, type: real, x: -ic.w / 2, y: -ic.h / 2, w: ic.w, h: ic.h, r: 0, fx: false, fy: false, stroke: '#1f2328', fill: ic.fill || ric.fill || '#ffffff',
      fillNone: false, sw: 1.5, opacity: 1, label: '', showLabel: false, t: 15, lvl: FP.currentLevel().id, ...(ic.preset || {}) };
    if (window.FPWalls.WALL_TYPES.has(real) || /^column|^pillar/.test(real)) it.wh = FP.plan().wallH || 300;
    if (real === 'slab') Object.assign(it, { slabT: 30, slabType: type === 'slab-concrete' ? 'concrete' : 'wood', autoFit: false });
    if (ric.roof) Object.assign(it, { pitch: ric.roof === 'flat' ? 2 : ric.roof === 'shed' || ric.roof === 'butterfly' ? 10 : 30, overhang: 40 });
    if (real === 'hill') Object.assign(it, { hillH: 300 });
    if (ric.stairs && FP.fitStairs) { it.x = 0; it.y = 0; FP.fitStairs(it); it.x = -it.w / 2; it.y = -it.h / 2; } // steps and size as when placed
    return it;
  }
  function buildPreviewObject(it) {
    // build on flat ground, outside of any level (the builders read these while they work)
    const saved = [EL, LV_ITEMS, LV_MODEL, SLAB_HOLES];
    EL = { at: () => 0, seg: () => 0, opening: () => 0 }; LV_ITEMS = [it]; LV_MODEL = null; SLAB_HOLES = [];
    try {
      const W = window.FPWalls;
      if (W.isWall(it)) return buildWall(it, W.analyze([it]), Infinity);
      if (WINDOW_TYPES.has(it.type)) return buildFreeWindow(it, Infinity);
      const g = buildItem(it, Infinity, null);
      if (g && (it.z || 0)) g.position.y += it.z;
      return g;
    } finally { [EL, LV_ITEMS, LV_MODEL, SLAB_HOLES] = saved; }
  }
  function previewUI() {
    if (PV) return PV;
    const card = document.createElement('div');
    card.className = 'icon-preview'; card.hidden = true;
    card.innerHTML = '<div class="ip-head"><b></b><button class="ip-close" title="Close (Esc)">×</button></div><div class="ip-view"></div><p class="ip-note"></p>';
    document.body.appendChild(card);
    const r = new T.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true;
    card.querySelector('.ip-view').appendChild(r.domElement);
    const sc = new T.Scene(), cam = new T.PerspectiveCamera(32, 1, 1, 50000);
    sc.add(new T.HemisphereLight('#ffffff', '#b8b2a6', 0.75));
    const key = new T.DirectionalLight('#ffffff', 0.75);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    sc.add(key, key.target);
    const spin = new T.Group(); sc.add(spin);
    const disc = new T.Mesh(new T.CircleGeometry(1, 48), new T.MeshStandardMaterial({ color: '#eceae5', roughness: 1 }));
    disc.rotation.x = -Math.PI / 2; disc.receiveShadow = true; sc.add(disc);
    PV = { card, r, sc, cam, key, spin, disc, obj: null, raf: 0, angle: 0.6, auto: true, dist: 1, size: 1, centre: new T.Vector3(), type: null };
    // drag to turn, scroll to zoom
    let drag = null;
    r.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, a: PV.angle }; PV.auto = false; r.domElement.setPointerCapture(e.pointerId); });
    r.domElement.addEventListener('pointermove', (e) => { if (drag) PV.angle = drag.a + (e.clientX - drag.x) * 0.012; });
    r.domElement.addEventListener('pointerup', () => { drag = null; });
    r.domElement.addEventListener('wheel', (e) => { e.preventDefault(); PV.dist = Math.min(4, Math.max(0.45, PV.dist * (e.deltaY > 0 ? 1.12 : 0.9))); }, { passive: false });
    card.querySelector('.ip-close').addEventListener('click', hideIconPreview);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !card.hidden) hideIconPreview(); });
    document.addEventListener('pointerdown', (e) => { if (!card.hidden && !card.contains(e.target)) hideIconPreview(); }, true);
    window.addEventListener('resize', hideIconPreview);
    return PV;
  }
  function clearPreview() {
    if (!PV || !PV.obj) return;
    PV.spin.remove(PV.obj);
    PV.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    PV.obj = null;
  }
  function hideIconPreview() {
    if (!PV || PV.card.hidden) return;
    PV.card.hidden = true;
    cancelAnimationFrame(PV.raf);
    clearPreview();
    PV.type = null;
  }
  // type: a picker icon; at: the tile's screen rectangle (the card opens beside it)
  // a prefab's objects built together as one level: its walls get their door / window openings
  function buildGroupObject(items) {
    const saved = [EL, LV_ITEMS, LV_MODEL, SLAB_HOLES];
    const W = window.FPWalls, model = W.analyze(items), g = new T.Group();
    EL = { at: () => 0, seg: () => 0, opening: () => 0 }; LV_ITEMS = items; LV_MODEL = model; SLAB_HOLES = [];
    try {
      for (const it of items) {
        const host = model.hosts.get(it.id);
        let o = null;
        try { o = W.isWall(it) ? buildWall(it, model, Infinity) : buildItem(it, Infinity, host); } catch (err) { console.warn('preview', it.type, err); }
        if (o && !W.isWall(it) && (it.z || 0)) o.position.y += it.z;
        if (o) g.add(o);
        if (host || WINDOW_TYPES.has(it.type)) {
          try { g.add(host ? buildFill(it, host, Infinity) : buildFreeWindow(it, Infinity)); } catch (err) { console.warn('preview', it.type, err); }
        }
      }
    } finally { [EL, LV_ITEMS, LV_MODEL, SLAB_HOLES] = saved; }
    return g;
  }
  /* The preview card: title, a builder for the 3D object, the footprint (cm) for the note, what to say when there is
     nothing to show, the screen rectangle to open beside, and how steeply to look down (prefabs: into the rooms). */
  function showPreview(title, build, w, h, emptyNote, at, look = 0.55) {
    // three.js is loaded the first time any 3D is needed
    if (!T) { loadThree().then(() => showPreview(title, build, w, h, emptyNote, at, look)).catch(() => alert('The 3D library could not be loaded (no internet connection?).')); return; }
    const ui = previewUI();
    clearPreview();
    ui.card.querySelector('.ip-head b').textContent = title;
    let obj = null, note = '';
    try { obj = build(); } catch (err) { console.warn('preview', err); }
    const box3 = obj ? new T.Box3().setFromObject(obj) : null;
    if (!obj || !box3 || box3.isEmpty()) {
      obj = null;
      note = emptyNote;
    } else {
      // stand it on the disc, centred, and frame it
      const c = box3.getCenter(new T.Vector3()), sz = box3.getSize(new T.Vector3());
      obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= Math.min(0, box3.min.y);
      ui.spin.add(obj);
      ui.obj = obj;
      ui.size = Math.max(sz.x, sz.y * 1.2, sz.z, 40);
      ui.centre.set(0, Math.max(sz.y / 2, 10) * (look > 0.8 ? 0.4 : 1), 0);
      const R = Math.max(sz.x, sz.z) * 0.75 + 30;
      ui.disc.scale.set(R, R, 1);
      ui.key.position.set(ui.size, ui.size * 1.6, ui.size * 0.8); ui.key.target.position.set(0, 0, 0);
      const sh = ui.key.shadow.camera; sh.left = sh.bottom = -ui.size; sh.right = sh.top = ui.size; sh.far = ui.size * 6; sh.updateProjectionMatrix();
      note = `${(w / 100).toFixed(2)} × ${(h / 100).toFixed(2)} m${sz.y > 1 ? ` · ${(sz.y / 100).toFixed(2)} m high` : ''} — drag to turn, scroll to zoom`;
    }
    ui.card.querySelector('.ip-note').textContent = note;
    ui.card.querySelector('.ip-view').style.display = obj ? '' : 'none';
    // place the card beside the tile, kept on screen
    ui.card.hidden = false;
    const cw = 300, ch = obj ? 300 : 90;
    let x = at.right + 10, y = at.top + at.height / 2 - ch / 2;
    if (x + cw > window.innerWidth - 8) x = Math.max(8, at.left - cw - 10);
    y = Math.max(8, Math.min(window.innerHeight - ch - 8, y));
    Object.assign(ui.card.style, { left: `${x}px`, top: `${y}px`, width: `${cw}px` });
    if (!obj) return;
    ui.r.setSize(cw - 16, 230, false);
    ui.cam.aspect = (cw - 16) / 230; ui.cam.updateProjectionMatrix();
    ui.angle = 0.6; ui.auto = true; ui.dist = 1;
    cancelAnimationFrame(ui.raf);
    const tick = () => {
      if (ui.card.hidden) return;
      if (ui.auto) ui.angle += 0.006;
      ui.spin.rotation.y = ui.angle;
      const d = ui.size * (look > 0.8 ? 1.7 : 2.5) * ui.dist;
      ui.cam.position.set(0, ui.centre.y + d * look, d);
      ui.cam.lookAt(ui.centre);
      ui.r.render(ui.sc, ui.cam);
      ui.raf = requestAnimationFrame(tick);
    };
    tick();
  }
  // type: a picker icon; at: the tile's screen rectangle (the card opens beside it)
  function showIconPreview(type, at) {
    const ic = FP.byId[type];
    if (!ic) return;
    const it = previewItem(type); // (stairs: sized for their steps)
    showPreview(ic.name, () => (T ? buildPreviewObject(it) : null), it.w, it.h,
      /hill|slope/.test(type) ? 'Shapes the ground itself — see it in the 3D view with the ground shown.' : 'No 3D model of its own (it is drawn on the plan only).', at);
  }
  // a prefab from the Prefab tab: all its objects, with or without the walls as the tab is set; seen from higher up
  function showPrefabPreview(id, at) {
    const pf = (window.FP_PREFABS || []).find((p) => p.id === id);
    if (!pf || !FP.prefabPreviewItems) return;
    showPreview(pf.name, () => buildGroupObject(FP.prefabPreviewItems(id)), pf.w, pf.h, 'Nothing to show in 3D.', at, 1.05);
  }
  window.FP3D = Object.assign(window.FP3D || {}, { showIconPreview, showPrefabPreview, hideIconPreview });

  /* ───────────────────────── 3D simulator file (File → 3D simulator) ─────────────────────────
     The whole house as this view builds it (every floor, full walls, nothing highlighted), written into a standalone
     web page with a viewer to look round it and walk through it (js/sim3d.js). The view is opened for a moment when it
     is not open already. */
  async function exportSimulator() {
    if (!window.FP_SIM_HTML) return;
    const wasOpen = isOpen;
    if (!wasOpen) await open();
    if (!renderer || contextLost || !T) { FP.toast('The 3D view could not start (it needs an internet connection the first time), so there is nothing to export.', 'error'); return; }
    const keep = { floorsMode, wallMode };
    let html = null;
    try {
      floorsMode = FP.levels().length > 1 ? 'all' : 'level'; wallMode = 'full';
      rebuild();
      // no selection tint in the file
      root.traverse((o) => { if (o.isMesh && o.material) for (const m of [].concat(o.material)) if (m.emissive) { m.emissive.set(0x000000); m.emissiveIntensity = 0; } });
      scene.updateMatrixWorld(true);
      // the view to start from: the whole house from the front left, as the 3D view's perspective
      let { cx, cy, cz, S, b } = extent();
      S *= 1.7; // (a little further back than the 3D view: the whole plot)
      const shown = shownLevels(), items = FP.items();
      // each floor: its height, and where walking on it starts (the middle of its largest room)
      const levels = shown.map((L) => {
        const rooms = items.filter((i) => i.type === 'floor' && !i.garden && FP.levelOf(i) === L.id).sort((p, q) => q.w * q.h - p.w * p.h);
        const r = rooms[0] || b;
        return { name: L.name, y: levelY(L, shown) + (FP.floorRel ? FP.floorRel(L.id) : 0), start: [r.x + r.w / 2, r.y + r.h / 2] };
      });
      // what each thing is called (a click on it in the simulator says so), and what you cannot walk through
      const names = {}, solid = [];
      for (const it of items) {
        const ic = FP.byId[it.type];
        if (!ic) continue;
        names[it.id] = it.label || (it.type === 'floor' ? (it.garden ? 'Garden area' : 'Floor') : it.type === 'slab' ? 'Floor slab' : ic.name);
        if (window.FPWalls.isWall(it) || WINDOW_TYPES.has(it.type) || /^column|^pillar|railing|fence|hedge/.test(it.type)) solid.push(it.id);
      }
      // outline edges (EdgesGeometry) cannot be read back from the file as they are: written as plain line geometry
      const swapped = [];
      scene.traverse((o) => {
        if (!o.geometry || (o.geometry.type !== 'EdgesGeometry' && o.geometry.type !== 'WireframeGeometry')) return;
        const g = new T.BufferGeometry();
        for (const k of Object.keys(o.geometry.attributes)) g.setAttribute(k, o.geometry.attributes[k]);
        swapped.push([o, o.geometry]);
        o.geometry = g;
      });
      let sceneJSON;
      try { sceneJSON = scene.toJSON(); } finally { swapped.forEach(([o, geo]) => { o.geometry = geo; }); }
      const data = {
        title: FP.plan().title || 'Floor plan',
        scene: sceneJSON,
        view: { target: [cx, cy, cz], camera: [cx - S * 0.45, cy + S * 0.85, cz + S * 0.95] },
        sun: Object.assign({ overhead: sunOverhead }, sunAt || { cx, cz, SS: S }),
        // walking starts 4 m in front of the house (the bottom edge of its walls on the plan), facing it
        levels, names, solid, start: (() => { const w = items.filter((i) => window.FPWalls.isWall(i)), hb = w.length ? FP.bbox(w) : b; return [hb.x + hb.w / 2, hb.y + hb.h + 400]; })(),
      };
      html = window.FP_SIM_HTML(data, { three: THREE_URL, orbit: ORBIT_URL });
    } catch (err) {
      console.error(err);
      FP.toast(`Could not make the 3D simulator: ${err.message}`, 'error');
    } finally {
      floorsMode = keep.floorsMode; wallMode = keep.wallMode;
      rebuild(); // (with the selection shown again)
      if (!wasOpen) close();
    }
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    FP.download(`${FP.fileName()}-3d-simulator.html`, blob);
    FP.toast(`3D simulator saved (${(blob.size / 1048576).toFixed(1)} MB) — open the .html file in a browser to look round and walk through the house. It needs an internet connection to load its 3D engine.`);
  }
  window.FP3D.exportSimulator = exportSimulator;
})();
