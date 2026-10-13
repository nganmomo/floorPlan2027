/* Floor Plan 2027 — wall model
 * Works out which wall every door/window sits in ("host" wall), so that:
 *   - 2D: openings snap onto walls (angle, line, thickness, gap width) and walls are drawn cut open behind them
 *   - 3D: walls are cut at openings and the parts above/below are rebuilt at the host wall's thickness
 * Also snaps wall ends together so corners close without gaps.
 * All coordinates are world centimetres.
 */
(function () {
  'use strict';

  const byId = Object.fromEntries(window.FP_ICONS.map((i) => [i.id, i]));
  const WALL_TYPES = new Set(['wall-h', 'wall-v', 'corner-tl', 'corner-tr', 'corner-br', 'corner-bl', 'wall-u', 'room']);
  const DEG = Math.PI / 180;

  // tolerances: STRICT decides what counts as "in the wall" for drawing/3D, LOOSE is the 2D snapping reach
  const STRICT = { ang: 5, perp: 5, along: 5 };
  const LOOSE = { ang: 25, perp: 45, along: 30 };

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

  // local icon point (before flip) -> world, for an item
  function toWorld(it) {
    const rad = it.r * DEG, c = Math.cos(rad), s = Math.sin(rad), cx = it.w / 2, cy = it.h / 2;
    return ([x, y]) => {
      if (it.fx) x = it.w - x;
      if (it.fy) y = it.h - y;
      const dx = x - cx, dy = y - cy;
      return [it.x + cx + dx * c - dy * s, it.y + cy + dx * s + dy * c];
    };
  }

  const isWall = (it) => WALL_TYPES.has(it.type);
  const isOpening = (it) => !!(byId[it.type] && byId[it.type].opening);

  /* Each straight wall piece as a centreline segment: { id, A, u, n, len, t } */
  function wallSegments(items) {
    const segs = [];
    for (const it of items) {
      if (!isWall(it)) continue;
      const tf = toWorld(it);
      byId[it.type].barrier(it.w, it.h, it).forEach((rect, segIdx) => {
        const g = segGeometry(it, rect, tf);
        if (g.len < 1) return;
        segs.push({ id: it.id, segIdx, A: g.A, u: g.u, n: g.n, len: g.len, t: g.t, sideSign: g.sideSign, cuts: [] });
      });
    }
    return segs;
  }

  /* One straight wall piece of an item: its centreline (local and world) and how its two faces are named.
   * Faces are keyed by the piece index + 'p' / 'n' = the side along the piece's local normal (+ / −),
   * so a face keeps its material when the wall is moved or rotated. */
  function segGeometry(it, [x, y, w, h], tf = toWorld(it)) {
    const horiz = w >= h;
    const Al = horiz ? [x, y + h / 2] : [x + w / 2, y], Bl = horiz ? [x + w, y + h / 2] : [x + w / 2, y + h];
    const nl = horiz ? [0, 1] : [-1, 0]; // local normal of the piece
    const A = tf(Al), B = tf(Bl);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const u = [(B[0] - A[0]) / len, (B[1] - A[1]) / len], n = [-u[1], u[0]];
    // +1 when the world normal points to the local 'p' side (flipping the item mirrors it)
    const sideSign = dot(sub(tf([Al[0] + nl[0], Al[1] + nl[1]]), A), n) > 0 ? 1 : -1;
    const t = horiz ? h : w;
    // rooms, U-walls and corners have an inside: the side facing the item's centre
    const enclosing = it.type !== 'wall-h' && it.type !== 'wall-v';
    const rc = [x + w / 2, y + h / 2], c = [it.w / 2, it.h / 2];
    const insideKey = enclosing ? (dot(sub(c, rc), nl) > 0 ? 'p' : 'n') : null;
    const segName = enclosing ? (horiz ? (rc[1] < c[1] ? 'Top wall' : 'Bottom wall') : (rc[0] < c[0] ? 'Left wall' : 'Right wall')) : 'Wall';
    const sideName = (key) => {
      if (insideKey) return key === insideKey ? 'Inside' : 'Outside';
      const s = key === 'p' ? 1 : -1, d = [nl[0] * s, nl[1] * s];
      return d[1] > 0 ? 'Bottom side' : d[1] < 0 ? 'Top side' : d[0] < 0 ? 'Left side' : 'Right side';
    };
    return { A, B, u, n, len, t, Al, Bl, nl, sideSign, insideKey, segName, sideName, tf };
  }

  /* Every face of a wall item, for the face picker: key, label, its line in world space and outward direction */
  function wallFaces(it) {
    if (!isWall(it)) return { bodies: [], faces: [] };
    const tf = toWorld(it), bodies = [], faces = [];
    byId[it.type].barrier(it.w, it.h, it).forEach((rect, segIdx) => {
      const [x, y, w, h] = rect;
      const g = segGeometry(it, rect, tf);
      bodies.push([tf([x, y]), tf([x + w, y]), tf([x + w, y + h]), tf([x, y + h])]);
      for (const key of ['p', 'n']) {
        const s = key === 'p' ? 1 : -1, o = [g.nl[0] * s * g.t / 2, g.nl[1] * s * g.t / 2];
        const P = tf([g.Al[0] + o[0], g.Al[1] + o[1]]), Q = tf([g.Bl[0] + o[0], g.Bl[1] + o[1]]);
        const M = tf([g.Al[0] + g.nl[0] * s, g.Al[1] + g.nl[1] * s]);
        const out = sub(M, g.A), ol = Math.hypot(out[0], out[1]) || 1;
        faces.push({ key: segIdx + key, segIdx, side: key, inside: g.insideKey ? key === g.insideKey : null,
          label: `${g.segName} · ${g.sideName(key)}`, P, Q, out: [out[0] / ol, out[1] / ol] });
      }
    });
    return { bodies, faces };
  }
  // key of the face on world side s (+1 = along the segment's world normal) of a segment
  const faceKey = (seg, s) => seg.segIdx + (s * seg.sideSign > 0 ? 'p' : 'n');
  function faceLabel(it, key) {
    const f = wallFaces(it).faces.find((x) => x.key === key);
    return f ? f.label : key;
  }

  /* The line along which an opening sits in its wall: endpoints P0/P1 and, for doors hung on a wall face,
     the direction the door swings into (ext). */
  function openingLine(it) {
    const ic = byId[it.type], o = ic.opening;
    if (!o) return null;
    const ly = o.y * (it.h / ic.h);
    const tf = toWorld(it);
    const P0 = tf([0, ly]), P1 = tf([it.w, ly]);
    const len = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]) || 1;
    let ext = null;
    if (o.mode === 'face') {
      const a = tf([it.w / 2, ly]), b = tf([it.w / 2, ly + o.dir]);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      ext = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    }
    return { P0, P1, mid: [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2], u: [(P1[0] - P0[0]) / len, (P1[1] - P0[1]) / len], len, o, ext };
  }

  const parallel = (u, v, angDeg) => Math.abs(cross(u, v)) <= Math.sin(angDeg * DEG) && true;
  const sameLine = (s, seg) => parallel(s.u, seg.u, 1) && Math.abs(cross(seg.u, sub(s.A, seg.A))) < 1;

  // Where on the wall the opening's line should sit: 0 = centreline, ±t/2 = a wall face
  function targetOffset(line, seg) {
    if (!line.ext) return 0;
    return (Math.sign(dot(line.ext, seg.n)) || 1) * (seg.t / 2);
  }

  /* Best host wall segment for an opening line, or null */
  function findHost(line, segs, tol) {
    let best = null;
    for (const seg of segs) {
      if (!parallel(line.u, seg.u, tol.ang)) continue;
      const d = cross(seg.u, sub(line.mid, seg.A)); // signed distance of the opening line from the centreline
      const target = targetOffset(line, seg);
      const err = Math.abs(d - target);
      if (err > seg.t / 2 + tol.perp) continue;
      const a = dot(sub(line.P0, seg.A), seg.u), b = dot(sub(line.P1, seg.A), seg.u);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (hi < -tol.along || lo > seg.len + tol.along) continue;
      const outside = Math.max(0, -hi, lo - seg.len);
      const score = err + outside * 0.5;
      if (!best || score < best.score) best = { seg, lo, hi, d, target, err, score };
    }
    return best;
  }

  /* Analyse the whole plan: host walls for openings and the cut intervals on walls.
     Returns { segs, hosts: Map(openingId -> host), cuts: Map(wallItemId -> [world polygons]) } */
  function analyze(items) {
    const segs = wallSegments(items);
    const hosts = new Map(), cuts = new Map();
    for (const it of items) {
      const line = openingLine(it);
      if (!line) continue;
      const h = findHost(line, segs, STRICT);
      if (!h) continue;
      hosts.set(it.id, h);
      for (const s of segs) {
        if (!sameLine(s, h.seg)) continue;
        const a = dot(sub(line.P0, s.A), s.u), b = dot(sub(line.P1, s.A), s.u);
        const lo = Math.max(0, Math.min(a, b)), hi = Math.min(s.len, Math.max(a, b));
        if (hi - lo < 0.5) continue;
        s.cuts.push([lo, hi, it.id]); // the opening's id, so the 3D view knows how tall the hole is
        const e = s.t / 2 + 0.6;
        const P = (k, off) => [s.A[0] + s.u[0] * k + s.n[0] * off, s.A[1] + s.u[1] * k + s.n[1] * off];
        if (!cuts.has(s.id)) cuts.set(s.id, []);
        cuts.get(s.id).push([P(lo, -e), P(hi, -e), P(hi, e), P(lo, e)]);
      }
    }
    return { segs, hosts, cuts };
  }

  // the remaining solid pieces of [0, len] after removing cut intervals
  function solidPieces(len, cutList) {
    const cs = cutList.slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    let pos = 0;
    for (const [a, b] of cs) {
      if (a > pos + 0.5) out.push([pos, a]);
      pos = Math.max(pos, b);
    }
    if (len > pos + 0.5) out.push([pos, len]);
    return out;
  }

  const normAngle = (a) => { a = ((a % 360) + 540) % 360 - 180; return a === -180 ? 180 : a; };
  const angDiff = (a, b) => Math.abs(normAngle(a - b));

  /* Snap an opening onto the nearest wall: angle, line, thickness and (optionally) width to fill a gap.
     Mutates the item. Returns true when it snapped. */
  function alignOpening(it, items, opts = {}) {
    const ic = byId[it.type], o = ic && ic.opening;
    if (!o) return false;
    const segs = wallSegments(items.filter((i) => i !== it));
    if (!segs.length) return false;

    // try the current orientation first, then a quarter turn either way
    let best = null;
    for (const [dr, penalty] of [[0, 0], [90, 20], [-90, 20]]) {
      const tmp = { ...it, r: normAngle(it.r + dr) };
      const h = findHost(openingLine(tmp), segs, LOOSE);
      if (h && (!best || h.score + penalty < best.score)) best = { ...h, score: h.score + penalty, r: tmp.r };
    }
    if (!best) return false;
    const seg = best.seg;

    // 1. angle: the wall direction (or its reverse) closest to the item's orientation
    const th = Math.atan2(seg.u[1], seg.u[0]) / DEG;
    it.r = round2(angDiff(th, best.r) <= 90 ? normAngle(th) : normAngle(th + 180));

    // 2. thickness: thin openings (windows, sliding doors...) take the wall's thickness
    if (o.fit) it.h = round2(seg.t);

    // 3. position along the wall, and width to fill a matching gap between wall pieces
    const line = openingLine(it);
    const a = dot(sub(line.P0, seg.A), seg.u), b = dot(sub(line.P1, seg.A), seg.u);
    let sc = (a + b) / 2, w = it.w;
    const intervals = segs.filter((s) => sameLine(s, seg)).map((s) => {
      const s0 = dot(sub(s.A, seg.A), seg.u), s1 = s0 + s.len * Math.sign(dot(s.u, seg.u));
      return [Math.min(s0, s1), Math.max(s0, s1)];
    });
    const insideWall = intervals.some(([p, q]) => sc > p + 1 && sc < q - 1);
    if (!insideWall) {
      const left = Math.max(-Infinity, ...intervals.filter(([, q]) => q <= sc + 1).map(([, q]) => q));
      const right = Math.min(Infinity, ...intervals.filter(([p]) => p >= sc - 1).map(([p]) => p));
      const tolW = Math.max(30, w * 0.35);
      if (isFinite(left) && isFinite(right) && opts.fitWidth !== false && Math.abs(right - left - w) <= tolW) {
        w = right - left; sc = (left + right) / 2;                       // fill the gap exactly
      } else if (isFinite(left) && Math.abs(sc - w / 2 - left) <= 30) {
        sc = left + w / 2;                                               // butt against the wall end on the left
      } else if (isFinite(right) && Math.abs(sc + w / 2 - right) <= 30) {
        sc = right - w / 2;                                              // ... or on the right
      }
    }
    it.w = round2(Math.max(5, w));

    // 4. place the opening line on the wall centreline (or on the face a door swings from)
    const target = targetOffset(openingLine(it), seg);
    const L = [seg.A[0] + seg.u[0] * sc + seg.n[0] * target, seg.A[1] + seg.u[1] * sc + seg.n[1] * target];
    const q = toWorld({ ...it, x: 0, y: 0 })([it.w / 2, o.y * (it.h / ic.h)]);
    it.x = round2(L[0] - q[0]);
    it.y = round2(L[1] - q[1]);
    return true;
  }
  const round2 = (v) => Math.round(v * 100) / 100;

  /* Snap a wall so one of its corners meets a corner of another wall (closes small gaps at joints).
     Mutates the item. Returns true when it snapped. */
  function snapWall(it, items, tol = 15) {
    if (!isWall(it)) return false;
    const rects = (w) => {
      const tf = toWorld(w);
      return byId[w.type].barrier(w.w, w.h, w).map(([x, y, rw, rh]) => [tf([x, y]), tf([x + rw, y]), tf([x + rw, y + rh]), tf([x, y + rh])]);
    };
    const edges = (rs) => rs.flatMap((r) => r.map((p, i) => [p, r[(i + 1) % 4]]));
    // total length of edges two walls share (flush contact), after shifting `mine` by (dx, dy)
    const contact = (mine, theirs, dx, dy) => {
      let sum = 0;
      for (const [a0, a1] of mine) {
        const p = [a0[0] + dx, a0[1] + dy], q = [a1[0] + dx, a1[1] + dy];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 0.5) continue;
        const u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
        for (const [b0, b1] of theirs) {
          if (Math.abs(cross(u, sub(b0, p))) > 0.5 || Math.abs(cross(u, sub(b1, p))) > 0.5) continue;
          const s0 = dot(sub(b0, p), u), s1 = dot(sub(b1, p), u);
          sum += Math.max(0, Math.min(L, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1)));
        }
      }
      return sum;
    };
    const mineR = rects(it), mineE = edges(mineR), mine = mineR.flat();
    const others = items.filter((o) => o !== it && isWall(o)).map((o) => rects(o));
    const othersE = edges(others.flat());
    if (contact(mineE, othersE, 0, 0) > 0.5) return false; // already joined flush
    let best = null;
    for (const c of others.flat(2)) for (const m of mine) {
      const d = Math.hypot(c[0] - m[0], c[1] - m[1]);
      if (d < 0.01 || d > tol) continue;
      const dx = c[0] - m[0], dy = c[1] - m[1];
      const k = contact(mineE, othersE, dx, dy);
      // prefer joins where the walls share an edge, then the smallest move
      if (!best || k > best.k + 0.5 || (Math.abs(k - best.k) <= 0.5 && d < best.d)) best = { d, k, dx, dy };
    }
    if (!best) return false;
    it.x = round2(it.x + best.dx);
    it.y = round2(it.y + best.dy);
    return true;
  }

  /* Sill and top height (cm above the floor) of a window in a wall of height wallTop.
     Windows that hang from the top of the wall (basement windows) keep their place when the wall height changes. */
  function windowSpan(it, wallTop = 300) {
    const o = byId[it.type] && byId[it.type].opening;
    if (o && o.top) {
      const height = it.winH != null ? it.winH : 30, gap = it.topGap != null ? it.topGap : 5;
      const head = Math.max(10, wallTop - gap);
      return [Math.max(0, head - height), head];
    }
    const sill = Math.max(0, Math.min(it.sill != null ? it.sill : 90, wallTop - 20));
    return [sill, Math.max(sill + 20, Math.min(it.head != null ? it.head : 210, wallTop))];
  }
  // height of the wall a door/window sits in (the plan's standard wall height when not set / not in a wall)
  function hostWallTop(it, items, model = analyze(items)) {
    const h = model.hosts.get(it.id);
    const wall = h && items.find((i) => i.id === h.seg.id);
    const std = (window.FP && window.FP.plan && window.FP.plan().wallH) || 300;
    return (wall && wall.wh) || std;
  }

  /* Floor levels. Ground = 0; a floor object can be raised (it.elev, cm). Returns helpers that give
   *   at(x, y)      finished floor level at a plan point (highest floor there, 0 on bare ground)
   *   seg(s)        level a wall piece stands at: the highest floor on either side of it
   *   opening(it)   threshold level of a door/window: the highest floor on either side of it */
  function elevationModel(items, model = analyze(items)) {
    const floors = items.filter((i) => i.type === 'floor' && i.rings).map((f) => {
      const tf = toWorld(f), kx = f.w / (f.w0 || f.w), ky = f.h / (f.h0 || f.h);
      return { e: f.elev || 0, rings: f.rings.map((r) => r.map(([x, y]) => tf([x * kx, y * ky]))) };
    });
    const inside = (rings, x, y) => {
      let c = false;
      for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    // the house's own height above ground (Plan settings → House): inside the ground floor's outline, where no floor
    // is drawn, everything stands at that height; outside it (garden) stays at the ground
    const base = window.FP && window.FP.houseBase ? window.FP.houseBase(items) : null;
    const at = (x, y) => {
      let best = null;
      for (const f of floors) if (inside(f.rings, x, y)) best = best == null ? f.e : Math.max(best, f.e);
      if (best != null) return best;
      return base && inside(base.rings, x, y) ? base.e : 0;
    };
    const bothSides = (P, n, d) => Math.max(at(P[0] + n[0] * d, P[1] + n[1] * d), at(P[0] - n[0] * d, P[1] - n[1] * d));
    // a wall's own foot (item.wz, cm, set from the Height bar): that far above / below its level's finished floor —
    // exactly the height chosen, inside or outside the house, whatever floors lie beside it
    const wz = new Map(items.filter((i) => i.wz).map((i) => [i.id, i.wz]));
    const lvFloor = window.FP && window.FP.floorRel && items.length ? window.FP.floorRel(items[0].lvl) : 0;
    const seg = (s) => {
      if (wz.has(s.id)) return lvFloor + wz.get(s.id);
      let m = -Infinity;
      for (let k = 0.05; k < 1; k += 0.1) m = Math.max(m, bothSides([s.A[0] + s.u[0] * s.len * k, s.A[1] + s.u[1] * s.len * k], s.n, s.t / 2 + 20));
      return isFinite(m) ? m : 0;
    };
    const opening = (it) => {
      const line = openingLine(it), h = model.hosts.get(it.id);
      if (line && h) return wz.has(h.seg.id) ? lvFloor + wz.get(h.seg.id) : bothSides(line.mid, h.seg.n, h.seg.t / 2 + 20); // in a wall with its own foot: on that foot
      const c = line ? line.mid : [it.x + it.w / 2, it.y + it.h / 2];
      return at(c[0], c[1]);
    };
    return { at, seg, opening, raised: floors.some((f) => f.e) || !!base };
  }

  /* A floor slab rests on top of the walls of its level (it is that level's ceiling and the floor of the level above).
   * Returns heights relative to the level: bottom = top of the tallest wall under the slab, plus the walls
   * supporting it and those that stop short of it. */
  function slabSupport(slab, items, model = analyze(items)) {
    const em = elevationModel(items, model);
    const std = (window.FP && window.FP.plan && window.FP.plan().wallH) || 300;
    const tf = toWorld(slab), own = window.FP && window.FP.slabPoly ? window.FP.slabPoly(slab) : null;
    const poly = (own || [[0, 0], [slab.w, 0], [slab.w, slab.h], [0, slab.h]]).map(tf);
    const inPoly = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const under = [];
    for (const s of model.segs) {
      // a wall piece supports the slab when part of it lies under the slab
      const pts = [0.02, 0.25, 0.5, 0.75, 0.98].map((k) => [s.A[0] + s.u[0] * s.len * k, s.A[1] + s.u[1] * s.len * k]);
      // under the slab, or running along its edge (a slab fitted inside a room bears on the walls round it)
      const nearEdge = ([x, y]) => poly.some((a, i) => {
        const b = poly[(i + 1) % poly.length], ux = b[0] - a[0], uy = b[1] - a[1], L2 = ux * ux + uy * uy || 1;
        const k = Math.max(0, Math.min(1, ((x - a[0]) * ux + (y - a[1]) * uy) / L2));
        return Math.hypot(a[0] + ux * k - x, a[1] + uy * k - y) <= s.t / 2 + 2;
      });
      if (!pts.some(([x, y]) => inPoly(x, y) || nearEdge([x, y]))) continue;
      // edge: the wall runs along the slab's edge (the slab sits within it); else it stands under the slab
      const inside = pts.some(([x, y]) => inPoly(x, y) && !nearEdge([x, y]));
      const wall = items.find((i) => i.id === s.id);
      if (!wall) continue;
      const have = under.find((u) => u.item === wall);
      if (have) { if (inside) have.edge = false; continue; }
      under.push({ item: wall, top: em.seg(s) + (wall.wh || std), edge: !inside });
    }
    const floor = em.at(slab.x + slab.w / 2, slab.y + slab.h / 2);
    const bearing = under.filter((u) => !u.edge);
    const bottom = (bearing.length ? Math.max(...bearing.map((u) => u.top)) : under.length ? Math.max(...under.map((u) => u.top)) : floor + std);
    return { bottom, floor, walls: under, under: bearing, short: bearing.filter((u) => u.top < bottom - 0.5) };
  }

  /* How much of each wall centreline of the level above (refSegs) runs over a wall of this level (items):
     returns per segment the [from, to] stretches along it (cm from its start A) that are carried / not carried. */
  function axisSupport(refSegs, items) {
    const mine = wallSegments(items), STEP = 5;
    const carried = (x, y) => mine.some((m) => {
      const d = sub([x, y], m.A), along = dot(d, m.u), across = Math.abs(dot(d, m.n));
      return along >= -0.5 && along <= m.len + 0.5 && across <= m.t / 2 + 0.5;
    });
    return refSegs.map((s) => {
      const n = Math.max(1, Math.ceil(s.len / STEP)), runs = [];
      for (let i = 0; i < n; i++) {
        const a = (s.len * i) / n, b = (s.len * (i + 1)) / n, mid = (a + b) / 2;
        const ok = carried(s.A[0] + s.u[0] * mid, s.A[1] + s.u[1] * mid);
        const last = runs[runs.length - 1];
        if (last && last.ok === ok) last.to = b; else runs.push({ from: a, to: b, ok });
      }
      return { seg: s, runs, carried: runs.filter((r) => r.ok).reduce((t, r) => t + r.to - r.from, 0) };
    });
  }

  /* Centre a wall on the nearest parallel centreline of the level above (refSegs), within tol cm: it is moved across
     its length only (once for each of two perpendicular directions, so a room can line up on both axes).
     Returns true when it moved. */
  function snapToAxes(it, refSegs, tol = 15) {
    if (!isWall(it) || !refSegs.length) return false;
    const picks = [];  // best shift per direction family
    for (const m of wallSegments([it])) {
      for (const r of refSegs) {
        if (Math.abs(cross(m.u, r.u)) > 0.05) continue;                 // not parallel (≈3°)
        const d = dot(sub(r.A, m.A), m.n);                                // axis-to-axis distance
        if (Math.abs(d) > tol) continue;
        // they must overlap along their length
        const r0 = dot(sub(r.A, m.A), m.u), r1 = r0 + dot(r.u, m.u) * r.len;
        if (Math.min(m.len, Math.max(r0, r1)) - Math.max(0, Math.min(r0, r1)) < 1) continue;
        const fam = Math.abs(m.n[0]) >= Math.abs(m.n[1]) ? 0 : 1;
        if (!picks[fam] || Math.abs(d) < Math.abs(picks[fam].d)) picks[fam] = { d, n: m.n };
      }
    }
    let moved = false;
    for (const pk of picks) {
      if (!pk || Math.abs(pk.d) < 0.05) continue;
      it.x = Math.round((it.x + pk.n[0] * pk.d) * 100) / 100;
      it.y = Math.round((it.y + pk.n[1] * pk.d) * 100) / 100;
      moved = true;
    }
    return moved;
  }

  /* T-junctions: a straight wall (wall-h / wall-v) whose end stops short of the face of a crossing wall — or runs
     past it into the wall, up to tol cm either way — is lengthened / shortened to end exactly on that face.
     Returns true when it changed. */
  function extendToFaces(it, items, tol = 15) {
    if (it.type !== 'wall-h' && it.type !== 'wall-v') return false;
    const [me] = wallSegments([it]);
    if (!me) return false;
    const others = wallSegments(items.filter((o) => o !== it && isWall(o)));
    const B = [me.A[0] + me.u[0] * me.len, me.A[1] + me.u[1] * me.len];
    let changed = false;
    for (const [E, dir, sign] of [[B, me.u, 1], [me.A, [-me.u[0], -me.u[1]], -1]]) {
      let best = null;
      for (const o of others) {
        const k = dot(dir, o.n);
        if (Math.abs(k) < 0.995) continue;                       // only walls crossing at a right angle
        const along = dot(sub(E, o.A), o.u);
        if (along < -0.5 || along > o.len + 0.5) continue;       // the end must point at this wall
        const toAxis = dot(sub(o.A, E), o.n) / k;                // distance along dir to its centreline
        const toFace = toAxis - o.t / 2;                          // … and to the near face
        if (toAxis <= -0.5 || Math.abs(toFace) > tol || Math.abs(toFace) < 0.05) continue;
        if (!best || Math.abs(toFace) < Math.abs(best)) best = toFace;
      }
      if (best == null) continue;
      // lengthen the wall by `best` at this end (its middle moves half of that along the wall)
      const horiz = it.w >= it.h, c = [it.x + it.w / 2 + dir[0] * best / 2, it.y + it.h / 2 + dir[1] * best / 2];
      if (horiz) it.w = Math.round((it.w + best) * 100) / 100; else it.h = Math.round((it.h + best) * 100) / 100;
      it.x = Math.round((c[0] - it.w / 2) * 100) / 100;
      it.y = Math.round((c[1] - it.h / 2) * 100) / 100;
      changed = true;
      void sign;
    }
    return changed;
  }

  window.FPWalls = { extendToFaces, axisSupport, snapToAxes, windowSpan, hostWallTop, elevationModel, slabSupport, WALL_TYPES, isWall, isOpening, wallSegments, openingLine, analyze, solidPieces, alignOpening, snapWall, toWorld,
    wallFaces, faceKey, faceLabel };
})();
