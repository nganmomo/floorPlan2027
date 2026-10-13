/* Floor Plan 2027 — 3D simulator file (File → 3D simulator)
 * window.FP_SIM_HTML(data) makes a standalone web page of the house: the 3D scene as the 3D view builds it
 * (three.js JSON, textures included) and a small viewer to look round it — orbit, top view, and walking through the
 * rooms at eye height (walls stop you, doors let you through). Three.js comes from the same CDN as the app's 3D view,
 * so the page needs an internet connection when it opens; everything else is inside the file.
 *
 * data: { title, scene (Object3D.toJSON), view: { target, camera }, sun: { cx, cz, SS, overhead },
 *         levels: [{ name, y (its floor), start: [x, z] (its largest room) }], names: { id: name },
 *         solid: [ids of walls / windows / columns / railings], start: [x, z] (in front of the house, facing it) }
 * The viewer below never runs in the app: its source is written into the page.
 */
(function () {
  'use strict';

  function viewer() {
    var D = JSON.parse(document.getElementById('sim-data').textContent);
    var $ = function (s) { return document.querySelector(s); };
    var msg = $('#msg');
    if (!window.THREE || !THREE.OrbitControls) { msg.textContent = 'This 3D simulator needs an internet connection to load its 3D engine (three.js). Connect, then reload the page.'; return; }
    var T = THREE;
    var host = $('#view');
    var renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    var camera = new T.PerspectiveCamera(45, 1, 5, 200000);
    var controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    var scene = null, sun = null, solids = [], mode = 'orbit';
    var linear = !!renderer.extensions.get('OES_texture_float_linear');

    // stacked roofs: the part of a roof inside another roof is not drawn (as in the app's 3D view)
    function roofCut(mat) {
      var cuts = mat.userData && mat.userData.roofCut;
      if (!cuts || !cuts.length) return;
      var maps = cuts.map(function (c) {
        var bin = atob(c.heights), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var h = new Float32Array(bytes.buffer), data = new Float32Array(c.N * c.N * 4);
        for (var k = 0; k < h.length; k++) { data[k * 4] = h[k]; data[k * 4 + 3] = 1; }
        var tex = new T.DataTexture(data, c.N, c.N, T.RGBAFormat, T.FloatType);
        tex.magFilter = tex.minFilter = linear ? T.LinearFilter : T.NearestFilter;
        tex.needsUpdate = true;
        return { tex: tex, rect: new T.Vector4().fromArray(c.rect), base: c.base, full: c.full };
      });
      mat.onBeforeCompile = function (sh) {
        var decl = 'varying vec3 vRcW;\n', test = '';
        maps.forEach(function (h, k) {
          sh.uniforms['uRcT' + k] = { value: h.tex }; sh.uniforms['uRcR' + k] = { value: h.rect };
          sh.uniforms['uRcB' + k] = { value: h.base }; sh.uniforms['uRcF' + k] = { value: h.full };
          decl += 'uniform sampler2D uRcT' + k + ';\nuniform vec4 uRcR' + k + ';\nuniform float uRcB' + k + ';\nuniform float uRcF' + k + ';\n';
          test += '{ vec4 r = uRcR' + k + '; if (vRcW.x > r.x && vRcW.x < r.z && vRcW.z > r.y && vRcW.z < r.w) {\n' +
            ' float h = texture2D(uRcT' + k + ', vec2((vRcW.x - r.x) / (r.z - r.x), (vRcW.z - r.y) / (r.w - r.y))).r;\n' +
            ' if (h > -1e5 && (vRcW.y < h - 1.0 || uRcF' + k + ' > 0.5) && vRcW.y > uRcB' + k + ' + 0.5) discard; } }\n';
        });
        sh.vertexShader = 'varying vec3 vRcW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vRcW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = decl + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + test);
      };
      mat.customProgramCacheKey = function () { return 'roofcut' + maps.length + mat.uuid; };
      mat.needsUpdate = true;
    }

    function placeSun() {
      if (!sun) return;
      var s = D.sun;
      if (s.overhead) sun.position.set(s.cx + 0.01, s.SS * 2, s.cz + 0.01);
      else sun.position.set(s.cx - s.SS * 0.6, s.SS * 1.4, s.cz + s.SS * 0.5);
      sun.target.position.set(s.cx, 0, s.cz);
      sun.intensity = s.overhead ? 0.6 : 0.45;
      var sc = sun.shadow.camera;
      sc.left = sc.bottom = -s.SS; sc.right = sc.top = s.SS; sc.near = 1; sc.far = s.SS * 5;
      sc.updateProjectionMatrix();
      sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      $('#sun').classList.toggle('on', !!s.overhead);
    }

    new T.ObjectLoader().parse(D.scene, function (obj) {
      scene = obj;
      var solidIds = {};
      (D.solid || []).forEach(function (id) { solidIds[id] = 1; });
      var hide = [];
      scene.traverse(function (o) {
        if (o.isDirectionalLight) { sun = o; sun.castShadow = true; }
        if (o.isSprite) hide.push(o); // (the editor's floor name tags)
        if (o.material) [].concat(o.material).forEach(roofCut);
        if (o.isMesh && solidIds[o.userData.id]) {
          solids.push(o);
          // a wall is solid from both sides (some faces of extruded or mirrored parts point inwards)
          [].concat(o.material).forEach(function (m) { m.side = T.DoubleSide; });
        }
      });
      hide.forEach(function (o) { o.visible = false; });
      if (sun) scene.add(sun.target);
      placeSun();
      msg.textContent = '';
      setMode('orbit');
      resize();
      loop();
    });

    // ── views ──
    var walk = { yaw: 0, pitch: 0, floor: 0, keys: {}, last: 0 };
    var EYE = 165;
    function setMode(m) {
      mode = m;
      document.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
      $('#lvWrap').hidden = m !== 'walk' || D.levels.length < 2;
      controls.enabled = m !== 'walk';
      if (m === 'orbit') {
        controls.maxPolarAngle = Math.PI / 2 - 0.03;
        controls.target.fromArray(D.view.target); camera.position.fromArray(D.view.camera); controls.update();
        help('Drag to turn · right-drag to pan · scroll to zoom · click a thing to see what it is');
      } else if (m === 'top') {
        controls.target.fromArray(D.view.target);
        var d = camera.position.distanceTo(controls.target) || 3000;
        camera.position.set(D.view.target[0], D.view.target[1] + Math.max(d, 1500) * 1.1, D.view.target[2] + 1); controls.update();
        help('Seen from above · drag to turn · scroll to zoom');
      } else {
        // in front of the house, facing it (a floor picked from the list puts you in its largest room)
        walk.floor = 0; lv.value = '0';
        camera.position.set(D.start[0], (D.levels[0] ? D.levels[0].y : 0) + EYE, D.start[1]);
        walk.yaw = 0; walk.pitch = 0; applyLook();
        help('Walk: W A S D or the arrow keys · drag to look round · Shift to hurry · walls stop you, doors let you through');
      }
    }
    function help(t) { $('#help').textContent = t; }
    function applyLook() {
      var dir = new T.Vector3(Math.sin(walk.yaw) * Math.cos(walk.pitch), Math.sin(walk.pitch), -Math.cos(walk.yaw) * Math.cos(walk.pitch));
      camera.lookAt(camera.position.clone().add(dir));
    }
    document.querySelectorAll('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });
    var lv = $('#lv');
    D.levels.forEach(function (l, i) { var o = document.createElement('option'); o.value = i; o.textContent = l.name; lv.appendChild(o); });
    lv.addEventListener('change', function () {
      var L = D.levels[+lv.value];
      walk.floor = +lv.value;
      camera.position.set(L.start[0], L.y + EYE, L.start[1]); applyLook();
      lv.blur();
    });
    $('#sun').addEventListener('click', function () { D.sun.overhead = !D.sun.overhead; placeSun(); });

    // walking: drag to look, keys to move; a wall (or window) ahead stops you
    var drag = null, down = null;
    renderer.domElement.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY };
      if (mode !== 'walk') return;
      drag = { x: e.clientX, y: e.clientY, yaw: walk.yaw, pitch: walk.pitch };
      renderer.domElement.setPointerCapture(e.pointerId);
    });
    renderer.domElement.addEventListener('pointermove', function (e) {
      if (!drag) return;
      walk.yaw = drag.yaw + (e.clientX - drag.x) * 0.005;
      walk.pitch = Math.max(-1.2, Math.min(1.2, drag.pitch - (e.clientY - drag.y) * 0.005));
      applyLook();
    });
    renderer.domElement.addEventListener('pointerup', function (e) {
      drag = null;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) info(e);
      down = null;
    });
    renderer.domElement.addEventListener('wheel', function (e) {
      if (mode !== 'walk') return;
      e.preventDefault();
      step(e.deltaY < 0 ? 60 : -60, 0);
    }, { passive: false });
    var KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
    window.addEventListener('keydown', function (e) { if (KEYS[e.code] && mode === 'walk' && e.target.tagName !== 'SELECT') { walk.keys[KEYS[e.code]] = true; e.preventDefault(); } walk.keys.fast = e.shiftKey; });
    window.addEventListener('keyup', function (e) { if (KEYS[e.code]) walk.keys[KEYS[e.code]] = false; walk.keys.fast = e.shiftKey; });
    var ray = new T.Raycaster();
    function blocked(from, dir, dist) {
      for (var hgt = -110; hgt <= 0; hgt += 55) { // knee, waist and eye height
        ray.set(new T.Vector3(from.x, from.y + hgt, from.z), dir);
        ray.far = dist + 30;
        if (ray.intersectObjects(solids, false).length) return true;
      }
      return false;
    }
    // move forward (f) and sideways (s), cm
    function step(f, s) {
      var fw = new T.Vector3(Math.sin(walk.yaw), 0, -Math.cos(walk.yaw)), rt = new T.Vector3(Math.cos(walk.yaw), 0, Math.sin(walk.yaw));
      var mv = fw.multiplyScalar(f).add(rt.multiplyScalar(s));
      var len = mv.length();
      if (len < 0.01) return;
      // slide along a wall: try the whole move, then each direction on its own
      var tries = [mv, new T.Vector3(mv.x, 0, 0), new T.Vector3(0, 0, mv.z)];
      for (var i = 0; i < tries.length; i++) {
        var v = tries[i], l = v.length();
        if (l < 0.01) continue;
        if (!blocked(camera.position, v.clone().normalize(), l)) { camera.position.add(v); return; }
      }
    }

    // click: what is it?
    var names = D.names || {};
    function info(e) {
      if (!scene) return;
      var r = renderer.domElement.getBoundingClientRect(), rc = new T.Raycaster();
      rc.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
      var hit = rc.intersectObjects(scene.children, true).find(function (h) { return h.object.visible && names[h.object.userData.id]; });
      var box = $('#info');
      if (!hit) { box.hidden = true; return; }
      box.textContent = names[hit.object.userData.id];
      box.style.left = (e.clientX - r.left + 12) + 'px'; box.style.top = (e.clientY - r.top + 12) + 'px';
      box.hidden = false;
      clearTimeout(info.t); info.t = setTimeout(function () { box.hidden = true; }, 2500);
    }

    function resize() {
      var w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    function loop(t) {
      requestAnimationFrame(loop);
      var dt = Math.min(0.1, ((t || 0) - (walk.last || t || 0)) / 1000); walk.last = t;
      if (mode === 'walk') {
        var sp = (walk.keys.fast ? 500 : 250) * dt, k = walk.keys;
        step(((k.f ? 1 : 0) - (k.b ? 1 : 0)) * sp, ((k.r ? 1 : 0) - (k.l ? 1 : 0)) * sp);
      } else controls.update();
      if (scene) renderer.render(scene, camera);
    }
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  window.FP_SIM_HTML = function (data, urls) {
    // (</script> inside the data must not end its script element)
    const json = JSON.stringify(data).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)} — 3D simulator</title>
<style>
  :root { --bg: #dce8f2; --panel: rgba(255,255,255,.94); --text: #1f2328; --muted: #6b7280; --accent: #2563eb; --border: #d6dbe2; }
  @media (prefers-color-scheme: dark) { :root { --panel: rgba(24,27,33,.92); --text: #e6e8eb; --muted: #9aa1ac; --accent: #5b8cff; --border: #2c313a; } }
  html, body { margin: 0; height: 100%; background: var(--bg); font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text); overflow: hidden; }
  #view { position: fixed; inset: 0; }
  #view canvas { display: block; width: 100%; height: 100%; touch-action: none; }
  .bar { position: fixed; top: 10px; left: 10px; right: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; pointer-events: none; }
  .bar > * { pointer-events: auto; }
  .title { background: var(--panel); border: 1px solid var(--border); border-radius: 9px; padding: 6px 12px; font-weight: 650; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .seg { display: inline-flex; background: var(--panel); border: 1px solid var(--border); border-radius: 9px; overflow: hidden; }
  button, select { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--border); border-radius: 9px; padding: 6px 11px; cursor: pointer; }
  .seg button { border: 0; border-radius: 0; background: transparent; }
  .seg button + button { border-left: 1px solid var(--border); }
  button.on { background: var(--accent); color: #fff; }
  #help { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); max-width: calc(100% - 24px); background: var(--panel); border: 1px solid var(--border);
    border-radius: 9px; padding: 6px 12px; color: var(--muted); text-align: center; }
  #info { position: fixed; background: #1f2328; color: #fff; border-radius: 7px; padding: 4px 9px; pointer-events: none; font-weight: 600; }
  #info[hidden], #lvWrap[hidden] { display: none; }
  #msg { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; color: var(--muted); font-size: 15px; pointer-events: none; }
</style>
</head>
<body>
<div id="view"></div>
<div class="bar">
  <span class="title">${esc(data.title)}</span>
  <span class="seg" role="group" aria-label="View">
    <button type="button" data-mode="orbit" title="Look round the house from outside">Look round</button>
    <button type="button" data-mode="top" title="Seen from above">Top</button>
    <button type="button" data-mode="walk" title="Walk through the rooms at eye height">Walk through</button>
  </span>
  <label id="lvWrap" hidden><select id="lv" aria-label="Floor to walk on"></select></label>
  <button type="button" id="sun" title="Light straight from above (shadows right under each object) or the usual slanted sun">Light from above</button>
</div>
<div id="help"></div>
<div id="info" hidden></div>
<div id="msg">Loading the 3D house…</div>
<script src="${urls.three}"></script>
<script src="${urls.orbit}"></script>
<script type="application/json" id="sim-data">${json}</script>
<script>
(${viewer.toString()})();
</script>
</body>
</html>
`;
  };
})();
