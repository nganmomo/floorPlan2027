/*
 * Floor plan icon library (SVG).
 * Units are centimetres: 1 SVG unit = 1 cm at 100% zoom.
 *
 * Each icon has:
 *   id, name, cat      identity and palette category
 *   w, h               default size (cm)
 *   svg                static inner SVG drawn in a "0 0 w h" viewBox (scaled when resized)
 *   draw(w, h, item)   OR a function that redraws the icon at its real size (walls, dimensions)
 *
 * CSS classes used inside icons:
 *   .b   body fill  -> uses the item's "fill" colour
 *   .k   solid fill -> uses the item's line colour (walls, columns, arrowheads)
 *   .tx  text
 */
(function () {
  const cls = (c) => (c ? ` class="${c}"` : '');
  const rect = (x, y, w, h, c = 'b', a = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${cls(c)} ${a}/>`;
  const line = (x1, y1, x2, y2, a = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${a}/>`;
  const circ = (cx, cy, r, c = 'b', a = '') => `<circle cx="${cx}" cy="${cy}" r="${r}"${cls(c)} ${a}/>`;
  const ell = (cx, cy, rx, ry, c = 'b', a = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${cls(c)} ${a}/>`;
  const path = (d, c = '', a = '') => `<path d="${d}"${cls(c)} ${a}/>`;
  const g = (t, inner) => `<g transform="${t}">${inner}</g>`;
  const text = (x, y, s, size = 11, a = '') =>
    `<text x="${x}" y="${y}" class="tx" text-anchor="middle" font-size="${size}" ${a}>${esc(s)}</text>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const DASH = 'stroke-dasharray="4 3"';

  // A dining chair seen from above, centred on (cx, cy). Rotation 0 = backrest at the top.
  const chair = (cx, cy, r = 0) =>
    g(`translate(${cx} ${cy}) rotate(${r})`, rect(-17, -13, 34, 30, 'b', 'rx="5"') + rect(-18, -19, 36, 8, 'b', 'rx="3"'));

  // Arrow pointing in the direction of travel (for stairs)
  const arrow = (x1, y1, x2, y2) => {
    const a = Math.atan2(y2 - y1, x2 - x1), s = 8;
    const p1 = [x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)];
    const p2 = [x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45)];
    return line(x1, y1, x2, y2) + path(`M${x2} ${y2}L${p1[0].toFixed(1)} ${p1[1].toFixed(1)}L${p2[0].toFixed(1)} ${p2[1].toFixed(1)}Z`, 'k');
  };
  // Table + chairs icon. `table` and `chairs` are kept as data so the 3D view can build them too.
  // table: {x, y, w, h, round?, rx?}; chairs: [[cx, cy, rotation], ...]
  const tableIcon = (id, name, w, h, table, chairs) => ({
    id, name, cat: 'Tables', w, h, table, chairs,
    svg: chairs.map((c) => chair(...c)).join('') +
      (table.round
        ? ell(table.x + table.w / 2, table.y + table.h / 2, table.w / 2, table.h / 2)
        : rect(table.x, table.y, table.w, table.h, 'b', table.rx ? `rx="${table.rx}"` : '')),
  });
  const sides = (xs, top, bottom) => xs.flatMap((x) => [[x, top, 0], [x, bottom, 180]]);
  // outlines for plants: a bumpy circle (tree crowns, bushes) and a star (conifers, parasols)
  const fx1 = (v) => v.toFixed(1);
  function scallop(cx, cy, r, n, depth = 0.12) {
    let d = '';
    for (let i = 0; i < n; i++) {
      const a0 = (i * 2 * Math.PI) / n, a1 = ((i + 1) * 2 * Math.PI) / n, am = (a0 + a1) / 2, ro = r * (1 + depth * 1.6);
      if (!i) d += `M${fx1(cx + r * Math.cos(a0))} ${fx1(cy + r * Math.sin(a0))}`;
      d += `Q${fx1(cx + ro * Math.cos(am))} ${fx1(cy + ro * Math.sin(am))} ${fx1(cx + r * Math.cos(a1))} ${fx1(cy + r * Math.sin(a1))}`;
    }
    return d + 'Z';
  }
  function star(cx, cy, ro, ri, n) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n - Math.PI / 2, r = i % 2 ? ri : ro;
      pts.push(`${fx1(cx + r * Math.cos(a))} ${fx1(cy + r * Math.sin(a))}`);
    }
    return `M${pts.join('L')}Z`;
  }

  /* ───────────── Stairs ─────────────
   * stairLayout() places the treads for a given number of steps; the 2D icon, the 3D model and the
   * properties panel all use it. Treads: [x, y, w, h, level] (level 1 = first step up).
   * L- and U-shaped stairs have a landing between two flights; it counts as one extra riser. */
  const STAIR_STEPS = { 'stairs-h': 10, 'stairs-l': 8, 'stairs-u': 14, 'stairs-spiral': 12 };
  const stepsOf = (type, p) => Math.max(2, Math.min(60, Math.round((p && p.steps) || STAIR_STEPS[type] || 10)));
  // a straight or L-shaped staircase can end in a landing at the top (p.topLanding, p.landingD deep): the last step
  // becomes a level platform at the top height, e.g. outside the front door of entrance stairs.
  // w = the length its flight has for steps and landing
  // p.landingSquare: as deep as the flight is wide (width), so the top step is a square
  const topLandingOf = (type, p, w, width) => ((type === 'stairs-h' || type === 'stairs-l' || type === 'stairs-u') && p && p.topLanding
    ? Math.min(Math.max(30, p.landingSquare && width ? width : p.landingD || 120), w * 0.8) : 0);
  /* Spiral stairs: the angles (radians, clockwise from the top) where each step starts, n + 1 values (the last closes
     the turn). With a top landing (p.topLanding) the last step is a platform of p.landingA degrees (default 90), and
     the other steps share the rest of the turn. b.landing = its angle (0 without one). */
  // the total turn of a spiral staircase (radians): p.spiralTurn degrees, 180 … 1440 (four turns), default one turn
  const spiralTurn = (p) => (Math.min(1440, Math.max(180, (p && p.spiralTurn) || 360)) * Math.PI) / 180;
  function spiralAngles(n, p) {
    const T = spiralTurn(p);
    const A = p && p.topLanding && n >= 3 ? Math.min(T / 2, (Math.min(180, Math.max(45, p.landingA || 90)) * Math.PI) / 180) : 0;
    const s = A ? (T - A) / (n - 1) : T / n, b = [];
    for (let k = 0; k < n; k++) b.push(-Math.PI / 2 + k * s);
    b.push(-Math.PI / 2 + T);
    b.landing = A;
    b.turn = T;
    return b;
  }
  // width of the flights of an L-shaped staircase
  const lFlightW = (w, h, p) => Math.min(w / 2, h / 2, (p && p.flightW) || 100);
  function stairLayout(type, w, h, n, p) {
    if (type === 'stairs-l') {
      // both flights fw wide (p.flightW, default 1 m, at most half the staircase): the lower one up the left side,
      // a square corner landing, the upper one along the top
      // the steps are shared out by the room each flight has (a long side gets more of them, so the treads stay
      // about the same on both flights when the staircase is a rectangle)
      const fw = lFlightW(w, h, p), LDg = topLandingOf(type, p, w - fw, fw), A1 = Math.max(1, h - fw), A2 = Math.max(1, w - fw - (LDg ? LDg : 0));
      const n1 = Math.max(1, Math.min(n - 1, Math.round((n * A1) / (A1 + A2 + (LDg ? (A2 / Math.max(1, n)) : 0))))), n2 = n - n1, d1 = (h - fw) / n1;
      const treads = [];
      for (let k = 0; k < n1; k++) treads.push([0, h - (k + 1) * d1, fw, d1, k + 1]);
      treads.push([0, 0, fw, fw, n1 + 1, 'landing']);
      // the second flight runs right from the corner landing; with a top landing its last step is the landing
      const LD = n2 >= 2 ? topLandingOf(type, p, w - fw, fw) : 0;
      const d2 = (w - fw - LD) / (LD ? n2 - 1 : n2);
      for (let k = 0; k < (LD ? n2 - 1 : n2); k++) treads.push([fw + k * d2, 0, d2, fw, n1 + 2 + k]);
      if (LD) treads.push([w - LD, 0, LD, fw, n1 + 1 + n2, 'top']);
      return { treads, risers: n + 1, going: Math.min(d1, d2), ...(LD ? { topLanding: LD } : {}) };
    }
    if (type === 'stairs-u') {
      // two flights side by side, fw wide each (p.flightW; without it, half the width each). A staircase wider than
      // two flights leaves an open well between them. The turning landing runs across the far end: fw deep when the
      // flight width is set, else (older stairs) 40 % of the length / 45 % of the width
      const n1 = Math.ceil(n / 2), n2 = n - n1, fw = p && p.flightW ? Math.min(w / 2, p.flightW) : w / 2;
      const L = p && p.flightW ? Math.min(h * 0.45, fw) : Math.min(h * 0.4, w * 0.45), d1 = (h - L) / n1, x2 = w - fw;
      const treads = [];
      for (let k = 0; k < n1; k++) treads.push([0, h - (k + 1) * d1, fw, d1, k + 1]);
      treads.push([0, 0, w, L, n1 + 1, 'landing']);
      // the second flight comes back down the icon (+y); with a top landing its last step is the landing
      // (t[6] = 'y': walked along +y, so its sides are its left / right edges)
      const LD = n2 >= 2 ? topLandingOf(type, p, h - L, fw) : 0;
      const d2 = (h - L - LD) / (LD ? n2 - 1 : n2);
      for (let k = 0; k < (LD ? n2 - 1 : n2); k++) treads.push([x2, L + k * d2, fw, d2, n1 + 2 + k]);
      if (LD) treads.push([x2, h - LD, fw, LD, n1 + 1 + n2, 'top', 'y']);
      return { treads, risers: n + 1, going: Math.min(d1, d2), landingDepth: L, flightW: fw,
        ...(x2 - fw > 1 ? { well: [fw, x2, L] } : {}), ...(LD ? { topLanding: LD } : {}) };
    }
    if (type === 'stairs-spiral') {
      // walking line at 60 % of the radius; a top landing takes its share of the turn (see spiralAngles)
      const b = spiralAngles(n, p), A = b.landing;
      return { treads: [], risers: n, going: ((b.turn - A) * 0.6 * Math.min(w, h) / 2) / (A ? n - 1 : n), turn: Math.round((b.turn * 180) / Math.PI),
        ...(A ? { topLandingAngle: Math.round((A * 180) / Math.PI) } : {}) };
    }
    if (type === 'stairs-h' && p && p.midLanding && n >= 4) {
      /* a long straight staircase with a square landing half way (p.midLanding): two flights, the landing as deep as
         the stairs are wide (at most 40 % of the length); the landing is one extra riser, like the turn of an L.
         t[7] = 'mid': its rails follow the stair's sides, like a top landing. */
      const n1 = Math.ceil(n / 2), n2 = n - n1;
      const LM = Math.min(h, w * 0.4), LD2 = n2 >= 2 ? topLandingOf(type, p, w - LM, h) : 0;
      const d = (w - LM - LD2) / (n1 + (LD2 ? n2 - 1 : n2));
      const treads = [];
      for (let k = 0; k < n1; k++) treads.push([k * d, 0, d, h, k + 1]);
      treads.push([n1 * d, 0, LM, h, n1 + 1, 'landing', undefined, 'mid']);
      const x2 = n1 * d + LM;
      for (let k = 0; k < (LD2 ? n2 - 1 : n2); k++) treads.push([x2 + k * d, 0, d, h, n1 + 2 + k]);
      if (LD2) treads.push([w - LD2, 0, LD2, h, n1 + 1 + n2, 'top']);
      return { treads, risers: n + 1, going: d, midLanding: LM, ...(LD2 ? { topLanding: LD2 } : {}) };
    }
    const LD = topLandingOf(type, p, w, h);
    if (LD && n > 1) {
      // n − 1 steps, then the landing at the top (it is the n-th riser's tread)
      const d = (w - LD) / (n - 1), treads = Array.from({ length: n - 1 }, (_, k) => [k * d, 0, d, h, k + 1]);
      treads.push([w - LD, 0, LD, h, n, 'top']);
      return { treads, risers: n, going: d, topLanding: LD };
    }
    const d = w / n; // straight: up from left to right in the icon's own frame
    return { treads: Array.from({ length: n }, (_, k) => [k * d, 0, d, h, k + 1]), risers: n, going: d };
  }
  /* Handrails on the plan (p.rail: 'left' | 'right' | 'both', seen walking up; same sides as in the 3D view): a line
     along each railed side of every flight, set in 4 cm from the edge, and along the open outer edges of landings, with
     posts at the ends. Returns [[x1, y1, x2, y2]] segments and [x, y] post points in the icon's frame. */
  function stairRails(type, w, h, p) {
    const segs = [], posts = [], side = (p && p.rail) || 'none', inset = 4;
    if (side === 'none' || type === 'stairs-spiral') return { segs, posts };
    const lay = stairLayout(type, w, h, stepsOf(type, p), p), mirrored = !!p.fx !== !!p.fy;
    const flights = [];
    let cur = null;
    for (const t of lay.treads) {
      if (t[5]) { cur = null; continue; } // a landing (mid-flight or at the top)
      if (!cur) flights.push((cur = []));
      cur.push(t);
    }
    for (const fl of flights) {
      const f = fl[0], l = fl[fl.length - 1], c = (t) => [t[0] + t[2] / 2, t[1] + t[3] / 2];
      let [ux, uy] = fl.length > 1 ? [c(l)[0] - c(f)[0], c(l)[1] - c(f)[1]] : f[2] < f[3] ? [1, 0] : [0, 1];
      const alongX = Math.abs(ux) > Math.abs(uy);
      const lo = alongX ? f[1] + inset : f[0] + inset, hi = alongX ? f[1] + f[3] - inset : f[0] + f[2] - inset;
      const leftIsLo = alongX ? ux > 0 : uy < 0; // walking +x the left is −y; walking +y the left is +x
      const lats = [];
      if (side === 'both' || (side === 'left') !== mirrored) lats.push(leftIsLo ? lo : hi);
      if (side === 'both' || (side === 'right') !== mirrored) lats.push(leftIsLo ? hi : lo);
      const a = alongX ? Math.min(f[0], l[0]) : Math.min(f[1], l[1]);
      const b = alongX ? Math.max(f[0] + f[2], l[0] + l[2]) : Math.max(f[1] + f[3], l[1] + l[3]);
      for (const lat of lats) {
        segs.push(alongX ? [a, lat, b, lat] : [lat, a, lat, b]);
        posts.push(alongX ? [a, lat] : [lat, a], alongX ? [b, lat] : [lat, b]);
      }
    }
    const onEdge = (v, lim) => Math.abs(v) < 0.5 || Math.abs(v - lim) < 0.5;
    const wantL = side === 'both' || (side === 'left') !== mirrored, wantR = side === 'both' || (side === 'right') !== mirrored;
    for (const [x0, y0, tw, th, , kind, dir, mid] of lay.treads.filter((t) => t[5])) {
      for (const [ax, ay, bx, by] of [[x0, y0, x0 + tw, y0], [x0, y0 + th, x0 + tw, y0 + th], [x0, y0, x0, y0 + th], [x0 + tw, y0, x0 + tw, y0 + th]]) {
        // the top landing: its two sides (left = top edge walking +x); the far end is the door, left open
        // walking +y (U-shape) the left is the right-hand edge (+x)
        const topSide = dir === 'y' ? ax === bx && ((ax === x0 + tw && wantL) || (ax === x0 && wantR)) : ay === by && ((ay === y0 && wantL) || (ay === y0 + th && wantR));
        if (kind === 'top' || mid === 'mid' ? !topSide : !(ax === bx ? onEdge(ax, w) : onEdge(ay, h))) continue;
        const ix = ax === bx ? (ax < w / 2 ? inset : -inset) : 0, iy = ay === by ? (ay < h / 2 ? inset : -inset) : 0;
        segs.push([ax + ix, ay + iy, bx + ix, by + iy]);
        posts.push([ax + ix, ay + iy], [bx + ix, by + iy]);
      }
    }
    // a U with an open well: the turning landing's edge over the well is railed on the inner (right-hand) side
    if (lay.well && wantR) {
      const [a, b, y] = lay.well;
      segs.push([a, y - inset, b, y - inset]);
      posts.push([a, y - inset], [b, y - inset]);
    }
    return { segs, posts };
  }
  // the rail as drawn: a heavy line (wood / metal) or a thin double line (glass), posts as small squares / dots
  function railMarkup(segs, posts, style) {
    const f = (v) => +v.toFixed(1);
    let g = '';
    for (const [x1, y1, x2, y2] of segs) {
      if (style === 'glass') {
        const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * 1.6, ny = (dx / L) * 1.6;
        g += `<line x1="${f(x1 + nx)}" y1="${f(y1 + ny)}" x2="${f(x2 + nx)}" y2="${f(y2 + ny)}" stroke-width="1"/><line x1="${f(x1 - nx)}" y1="${f(y1 - ny)}" x2="${f(x2 - nx)}" y2="${f(y2 - ny)}" stroke-width="1"/>`;
      } else g += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke-width="${style === 'metal' || style === 'bars' ? 2 : 3}" stroke-linecap="round"/>`;
    }
    const seen = new Set();
    for (const [x, y] of posts) {
      const k = `${Math.round(x)},${Math.round(y)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      g += style === 'wood' || !style ? `<rect x="${f(x - 3)}" y="${f(y - 3)}" width="6" height="6" class="k" stroke="none"/>` : `<circle cx="${f(x)}" cy="${f(y)}" r="2.6" class="k" stroke="none"/>`;
    }
    return g ? `<g class="stair-rail">${g}</g>` : '';
  }
  function drawStairs(type, w, h, p) {
    const { treads } = stairLayout(type, w, h, stepsOf(type, p), p);
    const { segs, posts } = stairRails(type, w, h, p);
    const top = treads.find((t) => t[5] === 'top');
    return treads.map(([x, y, tw, th]) => rect(+x.toFixed(2), +y.toFixed(2), +tw.toFixed(2), +th.toFixed(2))).join('') +
      (top ? (() => {
        // kept upright on the plan: undo the item's turn and mirroring about the label's centre
        const cx = +(top[0] + top[2] / 2).toFixed(1), cy = +(top[1] + top[3] / 2).toFixed(1), r = (p && p.r) || 0;
        const up = `transform="translate(${cx} ${cy}) scale(${p && p.fx ? -1 : 1} ${p && p.fy ? -1 : 1}) rotate(${-r}) translate(${-cx} ${-cy})"`;
        return text(cx, cy + 4, 'LANDING', Math.max(7, Math.min(12, Math.min(top[2], top[3]) / 7)), `fill-opacity=".55" font-weight="bold" ${up}`);
      })() : '') +
      railMarkup(segs, posts, p && p.railStyle);
  }

  const range = (from, to, step) => { const r = []; for (let v = from; v <= to + 1e-6; v += step) r.push(+v.toFixed(2)); return r; };
  const thick = (w, h, p) => Math.max(1, Math.min(p.t || 15, w / 2, h / 2));

  /* ── Roofs ── [style, picker name, default colour] */
  const ROOF_STYLES = [
    ['flat', 'Flat roof', '#9ca3af'], ['shed', 'Shed roof', '#4b5563'], ['gable', 'Gable roof (open)', '#a5452f'],
    ['box-gable', 'Box gable roof', '#a5452f'], ['saltbox', 'Saltbox roof', '#6b4f3a'],
    ['clerestory', 'Saltbox roof with clerestory windows', '#6b4f3a'], ['hip', 'Hip roof', '#a5452f'],
    ['gambrel', 'Gambrel roof', '#4b5563'], ['mansard', 'Mansard roof', '#374151'], ['butterfly', 'Butterfly roof', '#3f6b4c'],
  ];
  const ROOF_LABEL = { flat: 'FLAT ROOF', shed: 'SHED ROOF', gable: 'GABLE ROOF', 'box-gable': 'BOX GABLE', saltbox: 'SALTBOX', clerestory: 'CLERESTORY',
    hip: 'HIP ROOF', gambrel: 'GAMBREL', mansard: 'MANSARD', butterfly: 'BUTTERFLY' };
  // how far the roof rises above its eaves (cm) for a style, footprint W × D (ridge along W) and pitch (°)
  function roofRise(style, W, D, pitch) {
    const k = Math.tan(((pitch || 30) * Math.PI) / 180), k65 = Math.tan((65 * Math.PI) / 180), m = Math.min(W, D);
    if (style === 'hip-l') return (k * Math.min(W, D)) / 2;
    return { flat: 20, shed: k * D, gable: (k * D) / 2, 'box-gable': (k * D) / 2, saltbox: k * 0.35 * D, clerestory: k * 0.35 * D + 50, hip: (k * m) / 2,
      gambrel: k65 * 0.22 * D + k * 0.28 * D, mansard: k65 * 0.2 * m + k * 0.3 * m, butterfly: (k * D) / 2 }[style] || 0;
  }
  /* L-shaped hip roof: the outline (W × D less the corner p.lCorner, p.lCutW × p.lCutD) and the two rectangles —
     arms — whose hip roofs make it up: A runs the full width, B the full depth. */
  function lRoofShape(W, D, p) {
    const c = (p && p.lCorner) || (p && p.type === 'roof-hip-l-left' ? 'tl' : 'tr'), top = c[0] === 't', right = c[1] === 'r';
    const cw = Math.max(30, Math.min(W - 60, p && p.lCutW != null ? p.lCutW : W / 2));
    const cd = Math.max(30, Math.min(D - 60, p && p.lCutD != null ? p.lCutD : D / 2));
    const A = { x0: 0, x1: W, y0: top ? cd : 0, y1: top ? D : D - cd };
    const B = { x0: right ? 0 : cw, x1: right ? W - cw : W, y0: 0, y1: D };
    // the outline, clockwise on the plan (y down), starting at the top-left
    const nx = right ? W - cw : cw, ny = top ? cd : D - cd;
    let pts;
    if (c === 'tr') pts = [[0, 0], [nx, 0], [nx, ny], [W, ny], [W, D], [0, D]];
    else if (c === 'tl') pts = [[nx, 0], [W, 0], [W, D], [0, D], [0, ny], [nx, ny]];
    else if (c === 'br') pts = [[0, 0], [W, 0], [W, ny], [nx, ny], [nx, D], [0, D]];
    else pts = [[0, 0], [W, 0], [W, D], [nx, D], [nx, ny], [0, ny]];
    return { A, B, pts, reflex: [nx, ny], cw, cd, corner: c };
  }
  // the outline grown by ov on every side (an orthogonal polygon: each corner moves out along both edge normals)
  function growOrtho(pts, ov) {
    const n = pts.length, area = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * p[1], 0), sg = area > 0 ? 1 : -1;
    const nor = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [(sg * dy) / l, (-sg * dx) / l]; };
    return pts.map((p, i) => { const n1 = nor(pts[(i - 1 + n) % n], p), n2 = nor(p, pts[(i + 1) % n]); return [p[0] + (n1[0] + n2[0]) * ov, p[1] + (n1[1] + n2[1]) * ov]; });
  }
  // the hip roof's own symbol with the part left out cut away (and a dashed line where it was cut)
  function roofSymbolL(w, h, p) {
    const L = lRoofShape(w, h, p), [nx, ny] = L.reflex, ov = p.overhang == null ? 40 : p.overhang, big = Math.max(w, h) + 2 * ov + 50;
    const sx = L.corner[1] === 'r' ? 1 : -1, sy = L.corner[0] === 'b' ? 1 : -1;
    // the kept area: everything except the quarter beyond (nx, ny) towards the corner
    const X = (v) => nx + sx * v, Y = (v) => ny + sy * v;
    const keep = [[X(-big), Y(-big)], [X(big), Y(-big)], [X(big), Y(0)], [X(0), Y(0)], [X(0), Y(big)], [X(-big), Y(big)]];
    const id = `lcut-${L.corner}-${Math.round(w)}-${Math.round(h)}-${Math.round(L.cw)}-${Math.round(L.cd)}-${Math.round(ov)}`;
    return `<defs><clipPath id="${id}"><polygon points="${keep.map((q) => q.join(',')).join(' ')}"/></clipPath></defs>` +
      `<g clip-path="url(#${id})">${roofSymbol('hip', w, h, p)}</g>` +
      `<path d="M${X(0)} ${Y(Math.max(ov, 0) + (sy > 0 ? h - ny : ny))}L${X(0)} ${Y(0)}L${X(Math.max(ov, 0) + (sx > 0 ? w - nx : nx))} ${Y(0)}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  }
  // plan symbol: dashed eaves outline (with the overhang), the walls' outline, ridge / hips / breaks, an arrow downhill
  function roofSymbol(style, w, h, p, fence = false) {
    const ov = p.overhang == null ? 40 : p.overhang, c = 'stroke="currentColor"';
    const L = (x1, y1, x2, y2, a = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${c} ${a}/>`;
    const arrow = (x, y, dx, dy) => { const n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n, a = 9;
      return L(x, y, x + dx, y + dy, 'stroke-width="1.2"') + `<path d="M${x + dx} ${y + dy}l${-ux * a - uy * a * 0.5} ${-uy * a + ux * a * 0.5}M${x + dx} ${y + dy}l${-ux * a + uy * a * 0.5} ${-uy * a - ux * a * 0.5}" fill="none" ${c} stroke-width="1.2"/>`; };
    let g = `<rect x="${-ov}" y="${-ov}" width="${w + 2 * ov}" height="${h + 2 * ov}" fill="none" ${c} stroke-dasharray="10 6" stroke-opacity=".7"/>` +
      `<rect width="${w}" height="${h}" fill="currentColor" fill-opacity=".05" ${c} stroke-opacity=".35"/>`;
    const m = Math.min(w, h) / 2, sw = 'stroke-width="2"';
    if (style === 'flat') g += arrow(w * 0.3, h * 0.5, -w * 0.12, 0) + arrow(w * 0.7, h * 0.5, w * 0.12, 0);
    else if (style === 'shed') g += arrow(w / 2, h * 0.25, 0, h * 0.5);
    else if (style === 'gable' || style === 'box-gable') {
      g += L(-ov, h / 2, w + ov, h / 2, sw) + arrow(w / 2, h * 0.4, 0, -h * 0.25) + arrow(w / 2, h * 0.6, 0, h * 0.25);
      if (style === 'box-gable') g += `<rect x="${-ov}" y="${-ov}" width="${ov}" height="${h + 2 * ov}" fill="currentColor" fill-opacity=".15" ${c}/><rect x="${w}" y="${-ov}" width="${ov}" height="${h + 2 * ov}" fill="currentColor" fill-opacity=".15" ${c}/>`;
    } else if (style === 'clerestory') {
      // the saltbox ridge with a step: the long front slope starts 0.5 m higher, a band of upright windows (the middle
      // 60 %) between the two
      const y = h * 0.35;
      g += L(-ov, y - 4, w + ov, y - 4, sw) + L(-ov, y + 4, w + ov, y + 4) +
        `<rect x="${w * 0.2}" y="${y - 4}" width="${w * 0.6}" height="8" fill="#9fcbe4" fill-opacity=".6" stroke="none"/>` +
        [1, 2, 3, 4].map((i) => L(w * (0.2 + 0.12 * i), y - 4, w * (0.2 + 0.12 * i), y + 4)).join('') +
        arrow(w / 2, y - 10, 0, -h * 0.17) + arrow(w / 2, y + 12, 0, h * 0.4);
    } else if (style === 'saltbox') g += L(-ov, h * 0.35, w + ov, h * 0.35, sw) + arrow(w / 2, h * 0.3, 0, -h * 0.2) + arrow(w / 2, h * 0.45, 0, h * 0.4);
    else if (style === 'hip') {
      const r = w >= h ? [m, h / 2, w - m, h / 2] : [w / 2, m, w / 2, h - m];
      g += L(r[0], r[1], r[2], r[3], sw) + L(-ov, -ov, r[0], r[1]) + L(-ov, h + ov, r[0], r[1]) + L(w + ov, -ov, r[2], r[3]) + L(w + ov, h + ov, r[2], r[3]);
    } else if (style === 'gambrel') g += L(-ov, h / 2, w + ov, h / 2, sw) + L(-ov, h * 0.22, w + ov, h * 0.22, 'stroke-dasharray="6 4"') + L(-ov, h * 0.78, w + ov, h * 0.78, 'stroke-dasharray="6 4"');
    else if (style === 'mansard') {
      const b = Math.min(w, h) * 0.2;
      g += `<rect x="${b}" y="${b}" width="${w - 2 * b}" height="${h - 2 * b}" fill="none" ${c} stroke-dasharray="6 4"/>` +
        L(-ov, -ov, b, b) + L(w + ov, -ov, w - b, b) + L(-ov, h + ov, b, h - b) + L(w + ov, h + ov, w - b, h - b);
    } else if (style === 'butterfly') g += L(-ov, h / 2, w + ov, h / 2, 'stroke-width="2" stroke-dasharray="12 5"') + arrow(w / 2, h * 0.15, 0, h * 0.25) + arrow(w / 2, h * 0.85, 0, -h * 0.25);
    if (fence) {
      // the fence along the roof's outer edge: a solid line with a post every ~1.2 m
      const fh = p.roofFence == null ? 50 : p.roofFence, X0 = -ov + 3, Y0 = -ov + 3, X1 = w + ov - 3, Y1 = h + ov - 3;
      g += `<rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${Y1 - Y0}" fill="none" ${c} stroke-width="2.5"/>`;
      const nx = Math.max(1, Math.round((X1 - X0) / 120)), ny = Math.max(1, Math.round((Y1 - Y0) / 120));
      for (let i = 0; i <= nx; i++) { const x = X0 + ((X1 - X0) * i) / nx; g += `<rect x="${x - 3}" y="${Y0 - 3}" width="6" height="6" fill="currentColor"/><rect x="${x - 3}" y="${Y1 - 3}" width="6" height="6" fill="currentColor"/>`; }
      for (let i = 1; i < ny; i++) { const y = Y0 + ((Y1 - Y0) * i) / ny; g += `<rect x="${X0 - 3}" y="${y - 3}" width="6" height="6" fill="currentColor"/><rect x="${X1 - 3}" y="${y - 3}" width="6" height="6" fill="currentColor"/>`; }
      const fs2 = Math.max(9, Math.min(13, w / 28));
      g += text(w / 2, h / 2 + 5 + fs2 * 1.5 + (p.roofMat ? fs2 * 1.2 : 0), `FENCE ${(fh / 100).toFixed(2)} m`, fs2, 'fill-opacity=".55"');
    }
    const fs = Math.max(10, Math.min(16, w / 22)), RM = window.FP_WALLMATS && window.FP_WALLMATS.ROOF_MATS, mat = RM && RM[p.roofMat];
    return g + text(w / 2, h / 2 + (style === 'flat' ? 5 : -10), `${ROOF_LABEL[style]}${style === 'flat' ? '' : ` ${p.pitch == null ? (style === 'shed' || style === 'butterfly' ? 10 : 30) : p.pitch}°`}`, fs, 'fill-opacity=".6" font-weight="bold"') +
      (mat ? text(w / 2, h / 2 + (style === 'flat' ? 5 : -10) + fs * 1.3, mat.name.toUpperCase(), fs * 0.75, 'fill-opacity=".5"') : '');
  }


  /* ───────────── Balconies ───────────── */
  // an L-shaped balcony wraps a house corner: the house sits in the top-left block, the balcony is the strip along
  // the bottom and the strip up the right side, both d deep (p.balDepth)
  const balDepthOf = (w, h, p) => Math.max(60, Math.min((p && p.balDepth) || 150, w * 0.6, h * 0.6));
  // the plan: the slab outline (the back edge against the wall), the guard round its open edges, a dashed roof, hooks
  function balconyDraw(w, h, p) {
    const shape = (p && p.balShape) || 'square', round = shape === 'round', L = shape === 'L';
    const guard = (p && p.balGuard) || 'steel', i = guard === 'steel' ? 5 : 7, d = L ? balDepthOf(w, h, p) : 0;
    const outline = L ? `M0 ${h - d}H${w - d}V0H${w}V${h}H0Z` : round ? `M0 0H${w}A${w / 2} ${h} 0 0 1 0 0Z` : `M0 0H${w}V${h}H0Z`;
    const railAt = (k) => (L ? `M${k} ${h - d}V${h - k}H${w - k}V${k}H${w - d}` : round ? `M${k} 0A${w / 2 - k} ${h - k} 0 0 0 ${w - k} 0` : `M${k} 0V${h - k}H${w - k}V0`);
    let out = path(outline, 'b');
    const modeOf = (k) => (shape === 'square' && p && ['rail', 'wall', 'none'].includes(p['bal' + k]) ? p['bal' + k] : 'rail');
    if (shape === 'square' && ['L', 'F', 'R'].some((k) => modeOf(k) !== 'rail')) {
      // each side on its own: a guard line, a solid wall, or open
      const side = (k, kk) => ({ L: `M${kk} 0V${h - kk}`, F: `M${kk} ${h - kk}H${w - kk}`, R: `M${w - kk} ${h - kk}V0` }[k]);
      for (const k of ['L', 'F', 'R']) {
        const m = modeOf(k);
        if (m === 'rail') { out += path(side(k, i), '', 'fill="none" stroke-width="2"'); if (guard !== 'steel') out += path(side(k, i * 2), '', 'fill="none"'); }
        if (m === 'wall') out += k === 'F' ? rect(0, h - 15, w, 15, 'k') : rect(k === 'L' ? 0 : w - 15, 0, 15, h, 'k');
      }
    } else {
      out += path(railAt(i), '', 'fill="none" stroke-width="2"');
      if (guard !== 'steel') out += path(railAt(i * 2), '', 'fill="none"');                       // a parapet: two lines
    }
    if (p && p.balRoof) out += path(L ? `M-10 ${h - d}H${w - d}V-10H${w + 10}V${h + 10}H-10Z` : round ? `M-10 0H${w + 10}A${w / 2 + 10} ${h + 10} 0 0 1 -10 0Z` : `M-10 0H${w + 10}V${h + 10}H-10Z`, '', 'fill="none" stroke-dasharray="8 5" stroke-opacity=".7"');
    if (p && p.balHooks) {
      const yF = h + 4, xs = [w * 0.25, w * 0.75];
      for (const x of xs) out += line(x, round ? h * Math.sqrt(1 - ((x - w / 2) / (w / 2)) ** 2) - 6 : h - 6, x, yF + 30, 'stroke-width="1.5"');
      for (const dd of [12, 22, 32]) out += line(w * 0.2, yF + dd - 4, w * 0.8, yF + dd - 4, 'stroke-width="1"');
    }
    // the glass sliding door in the wall behind
    const dy = L ? h - d : 0, dw = L ? w - d : w;
    out += line(dw * 0.2, dy - 3, dw * 0.52, dy - 3, 'stroke-width="2"') + line(dw * 0.48, dy + 3, dw * 0.8, dy + 3, 'stroke-width="2"');
    return out + text(L ? (w - d) / 2 : w / 2, L ? h - d / 2 + 4 : h * (round ? 0.42 : 0.55), 'BALCONY', Math.max(9, Math.min(14, w / 18)), 'fill-opacity=".5" font-weight="bold"');
  }
  /* A picture of a balcony seen from the garden (catalog and prefab cards), 120 × 90: the house wall with its glass
     sliding door, the slab, things standing on it, the guard, and optionally a roof and drying rods.
     o: { shape: 'square' | 'round' | 'L', guard: 'steel' | 'concrete' | 'low', roof, hooks, furn: [...] } */
  function balconyPic(o) {
    const shape = o.shape || 'square', guard = o.guard || 'steel', L = shape === 'L', round = shape === 'round';
    const wall = '#ece4d6', conc = '#c9c3b8', concD = '#a9a297', steel = '#8b97a5', glass = '#b9dcef', sky = '#dbeaf5';
    const X1 = L ? 84 : 120; // where the house wall ends (an L wraps its corner)
    let s = `<rect x="0" y="0" width="120" height="90" fill="${sky}" stroke="none"/><rect x="0" y="0" width="${X1}" height="90" fill="${wall}" stroke="none"/>`;
    if (L) s += `<path d="M${X1} 0L104 8V90H${X1}Z" fill="#d9cfbe" stroke="none"/><path d="M88 22h11v24h-11z" fill="${glass}" stroke="#4b5563" stroke-width="1"/>`;
    const dx = L ? 14 : 34;
    s += `<rect x="${dx}" y="14" width="52" height="50" fill="${glass}" stroke="#4b5563" stroke-width="1.6"/>` +
      `<line x1="${dx + 26}" y1="14" x2="${dx + 26}" y2="64" stroke="#4b5563" stroke-width="1.4"/>` +
      `<path d="M${dx + 4} 20l8-4M${dx + 30} 22l8-4" stroke="#fff" stroke-width="1.6" stroke-opacity=".8"/>` +
      `<path d="M${dx + 20} 40h3M${dx + 29} 40h3" stroke="#374151" stroke-width="1.6"/>`;
    if (o.roof) s += `<rect x="0" y="2" width="120" height="7" fill="${conc}" stroke="${concD}" stroke-width="1"/><rect x="2" y="9" width="116" height="3" fill="#000" fill-opacity=".12" stroke="none"/>`;
    // the slab (seen a little from above) and its edge
    s += round
      ? `<path d="M8 64H112C112 78 90 86 60 86S8 78 8 64Z" fill="${conc}" stroke="${concD}" stroke-width="1"/><path d="M8 64C8 74 30 80 60 80S112 74 112 64" fill="none" stroke="${concD}" stroke-width="1"/>`
      : L ? `<path d="M10 64H${X1}L104 52H112L118 72H4Z" fill="${conc}" stroke="${concD}" stroke-width="1"/><rect x="4" y="72" width="114" height="6" fill="${concD}" stroke="none"/>`
        : `<path d="M10 64H110L116 72H4Z" fill="${conc}" stroke="${concD}" stroke-width="1"/><rect x="4" y="72" width="112" height="6" fill="${concD}" stroke="none"/>`;
    // things on the balcony (behind the guard)
    const wood = '#a0703f', cush = '#e8d9b8', leaf = '#6b9e5a', leafD = '#4f7d43', pot = '#b5651d';
    const chairAt = (x, f) => `<path d="M${x} 50v18M${x} 58h${8 * f}v10M${x + 8 * f} 58v10" stroke="${wood}" stroke-width="1.6" fill="none"/>`;
    const plantAt = (x, y = 70, k = 1) => `<path d="M${x - 5 * k} ${y - 8 * k}h${10 * k}l-2 ${8 * k}h${-6 * k}z" fill="${pot}" stroke="none"/>` +
      `<circle cx="${x - 3 * k}" cy="${y - 13 * k}" r="${5 * k}" fill="${leaf}"/><circle cx="${x + 3 * k}" cy="${y - 15 * k}" r="${5 * k}" fill="${leafD}"/><circle cx="${x}" cy="${y - 19 * k}" r="${4.5 * k}" fill="${leaf}"/>`;
    for (const f of o.furn || []) {
      if (f === 'bistro') s += `<ellipse cx="60" cy="56" rx="11" ry="3" fill="${wood}"/><path d="M60 58v10M55 69h10" stroke="${wood}" stroke-width="1.6"/>` + chairAt(40, 1) + chairAt(80, -1);
      if (f === 'dining') s += `<path d="M60 18v40" stroke="#6b7280" stroke-width="1.2"/><path d="M34 26Q60 8 86 26Z" fill="#e07a5f" stroke="none"/>` +
        `<rect x="44" y="54" width="32" height="3" fill="${wood}"/><path d="M47 57v11M73 57v11" stroke="${wood}" stroke-width="1.6"/>` + chairAt(30, 1) + chairAt(90, -1);
      if (f === 'lounge') s += `<path d="M20 66h40l8-10" stroke="${wood}" stroke-width="2" fill="none"/><path d="M21 63h38l7-9" stroke="${cush}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M24 66v4M56 66v4" stroke="${wood}" stroke-width="1.6"/>` + plantAt(96);
      if (f === 'sofa') s += `<rect x="30" y="52" width="46" height="16" rx="3" fill="#7d8fa6"/><rect x="30" y="58" width="46" height="10" rx="2" fill="#93a6bd"/><path d="M33 68v3M73 68v3" stroke="#4b5563" stroke-width="1.6"/><rect x="84" y="60" width="12" height="2.5" fill="${wood}"/><path d="M90 62v8" stroke="${wood}" stroke-width="1.4"/>`;
      if (f === 'plants') s += plantAt(14, 70, 0.9) + plantAt(106, 70, 0.9);
    }
    const top = 44, base = round ? 76 : 72;
    if (guard === 'concrete') {
      s += round
        ? `<path d="M8 ${top + 2}C8 ${top + 14} 30 ${top + 20} 60 ${top + 20}S112 ${top + 14} 112 ${top + 2}V64C112 78 90 86 60 86S8 78 8 64Z" fill="${conc}" stroke="${concD}" stroke-width="1"/>`
        : `<rect x="4" y="${top}" width="${L ? 114 : 112}" height="${78 - top}" fill="${conc}" stroke="${concD}" stroke-width="1"/><rect x="2" y="${top - 2}" width="${L ? 118 : 116}" height="4" fill="${concD}" stroke="none"/>`;
    } else if (guard === 'low') {
      s += `<rect x="4" y="58" width="112" height="20" fill="${conc}" stroke="${concD}" stroke-width="1"/><rect x="2" y="56" width="116" height="3" fill="${concD}" stroke="none"/>`;
      for (const x of [8, 34, 60, 86, 112]) s += `<line x1="${x}" y1="56" x2="${x}" y2="${top}" stroke="${steel}" stroke-width="1.8"/>`;
      s += `<line x1="4" y1="${top}" x2="116" y2="${top}" stroke="${steel}" stroke-width="2.6" stroke-linecap="round"/><line x1="4" y1="${top + 6}" x2="116" y2="${top + 6}" stroke="${steel}" stroke-width="1.2"/>`;
    } else if (round) {
      const cur = (y) => `M8 ${y}C8 ${y + 12} 30 ${y + 18} 60 ${y + 18}S112 ${y + 12} 112 ${y}`;
      for (const [x, dd] of [[8, 0], [24, 10], [42, 15], [60, 18], [78, 15], [96, 10], [112, 0]]) s += `<line x1="${x}" y1="${top + dd}" x2="${x}" y2="${64 + dd * 0.9}" stroke="${steel}" stroke-width="1.8"/>`;
      s += `<path d="${cur(top)}" fill="none" stroke="${steel}" stroke-width="2.6"/><path d="${cur(top + 10)}" fill="none" stroke="${steel}" stroke-width="1.2"/><path d="${cur(top + 18)}" fill="none" stroke="${steel}" stroke-width="1.2"/>`;
    } else {
      for (const x of [6, 33, 60, 87, 114]) s += `<line x1="${x}" y1="${top}" x2="${x}" y2="${base}" stroke="${steel}" stroke-width="1.8"/>`;
      s += `<line x1="4" y1="${top}" x2="116" y2="${top}" stroke="${steel}" stroke-width="2.6" stroke-linecap="round"/>` +
        `<line x1="4" y1="${top + 10}" x2="116" y2="${top + 10}" stroke="${steel}" stroke-width="1.2"/><line x1="4" y1="${top + 20}" x2="116" y2="${top + 20}" stroke="${steel}" stroke-width="1.2"/>`;
    }
    if (o.sides === 'front') s += `<path d="M0 0H10V80H0Z M110 0H120V80H110Z" fill="#ddd3c3" stroke="#bfb3a1" stroke-width="1"/>`; // walls each side
    if (L && guard !== 'concrete') s += `<path d="M112 ${top}L104 ${top - 8}V52" stroke="${steel}" stroke-width="2" fill="none"/>`; // the side arm's rail going back
    if (o.hooks) s += `<path d="M30 ${top - 2}v-6h66v6M30 ${top - 8}l-6-4M96 ${top - 8}l6-4" stroke="#4b5058" stroke-width="1.4" fill="none"/>` +
      `<path d="M22 ${top - 13}h82M24 ${top - 10}h78" stroke="#4b5058" stroke-width="1.2"/>`;
    return s;
  }
  const balconyThumb = (shape, guard) => balconyPic({ shape, guard });
  window.FP_BALCONY_PIC = balconyPic;

  /* ───────────── Low fences (about 1 m): stair and landing guards, the gallery of a duplex's upper floor ───────────── */
  const LF_COLORS = { wood: '#a0703f', concrete: '#cfc9bf', iron: '#2f3136' };
  function lowFenceDraw(w, h, p) {
    const m = (p && p.lfMat) || 'wood';
    if (m === 'concrete') return rect(0, 0, w, h, 'b', `style="fill:${(p && p.lfColor) || LF_COLORS.concrete}"`) + line(0, h / 2, w, h / 2, 'stroke-dasharray="6 4" stroke-opacity=".5"');
    const n = Math.max(1, Math.round(w / (m === 'iron' ? 150 : 120))), ps = Math.min(m === 'iron' ? 5 : 8, h);
    let g = rect(0, h / 2 - 1.5, w, 3, 'b');
    for (let i = 0; i <= n; i++) { const x = Math.min(w - ps, Math.max(0, (w * i) / n - ps / 2)); g += rect(+x.toFixed(1), (h - ps) / 2, ps, ps, 'k'); }
    const gap = m === 'iron' ? 11 : 12;
    for (let x = gap; x < w - gap / 2; x += gap) g += m === 'iron' ? circ(+x.toFixed(1), h / 2, 0.9, 'k') : line(+x.toFixed(1), h / 2 - 2.5, +x.toFixed(1), h / 2 + 2.5);
    return g;
  }
  // the picture in the catalog: a stretch of the fence seen from the side, on a floor
  function lowFencePic(m) {
    const bg = '#f1ece3', floor = '#d8cfc0', c = LF_COLORS[m];
    let s = `<rect x="0" y="0" width="120" height="90" fill="${bg}" stroke="none"/><rect x="0" y="72" width="120" height="18" fill="${floor}" stroke="none"/>`;
    if (m === 'concrete') return s + `<rect x="8" y="26" width="104" height="46" fill="${c}" stroke="#a9a297" stroke-width="1"/><rect x="5" y="22" width="110" height="5" fill="#b9b2a6" stroke="none"/>`;
    if (m === 'wood') {
      s += `<rect x="6" y="66" width="108" height="4" fill="#8a5d33"/>`;
      for (let x = 15; x < 108; x += 8) s += `<rect x="${x}" y="30" width="3.2" height="36" fill="${c}"/>`;
      for (const x of [6, 57, 108]) s += `<rect x="${x}" y="24" width="7" height="48" fill="#8a5d33"/>`;
      return s + `<rect x="3" y="21" width="114" height="6" rx="2" fill="#7b5230"/>`;
    }
    // wrought iron: bars, a band of scrolls under the top rail, finials on the posts
    for (let x = 14; x < 108; x += 7) s += `<line x1="${x}" y1="30" x2="${x}" y2="70" stroke="${c}" stroke-width="1.4"/>`;
    for (let x = 17.5; x < 106; x += 14) s += `<circle cx="${x}" cy="35" r="3.2" fill="none" stroke="${c}" stroke-width="1.2"/>`;
    s += `<line x1="6" y1="28" x2="114" y2="28" stroke="${c}" stroke-width="3"/><line x1="6" y1="42" x2="114" y2="42" stroke="${c}" stroke-width="1.6"/><line x1="6" y1="68" x2="114" y2="68" stroke="${c}" stroke-width="2.2"/>`;
    for (const x of [8, 60, 112]) s += `<line x1="${x}" y1="24" x2="${x}" y2="72" stroke="${c}" stroke-width="3.2"/><circle cx="${x}" cy="22" r="2.6" fill="${c}"/>`;
    return s;
  }
  const ICONS = [
    /* ───────────── Walls & Structure ───────────── */
    { id: 'wall-h', name: 'Wall', cat: 'Walls & Structure', w: 300, h: 15,
      draw: (w, h) => rect(0, 0, w, h, 'k') },
    { id: 'wall-v', name: 'Wall (vertical)', cat: 'Walls & Structure', hidden: true, // (= Wall turned 90°; kept for older plans)
      w: 15, h: 300,
      draw: (w, h) => rect(0, 0, w, h, 'k') },
    { id: 'corner-tl', name: 'Corner (L-shape)', cat: 'Walls & Structure', w: 150, h: 150, thick: true, shapeHit: true,
      draw: (w, h, p) => { const t = thick(w, h, p); return path(`M0 0H${w}V${t}H${t}V${h}H0Z`, 'k'); } },
    { id: 'corner-tr', name: 'Corner (top-right)', cat: 'Walls & Structure', hidden: true, // (= Corner turned; kept for older plans)
      w: 150, h: 150, thick: true, shapeHit: true,
      draw: (w, h, p) => { const t = thick(w, h, p); return path(`M0 0H${w}V${h}H${w - t}V${t}H0Z`, 'k'); } },
    { id: 'corner-br', name: 'Corner (bottom-right)', cat: 'Walls & Structure', hidden: true, // (= Corner turned; kept for older plans)
      w: 150, h: 150, thick: true, shapeHit: true,
      draw: (w, h, p) => { const t = thick(w, h, p); return path(`M${w} 0V${h}H0V${h - t}H${w - t}V0Z`, 'k'); } },
    { id: 'corner-bl', name: 'Corner (bottom-left)', cat: 'Walls & Structure', hidden: true, // (= Corner turned; kept for older plans)
      w: 150, h: 150, thick: true, shapeHit: true,
      draw: (w, h, p) => { const t = thick(w, h, p); return path(`M0 0H${t}V${h - t}H${w}V${h}H0Z`, 'k'); } },
    { id: 'wall-u', name: 'Wall (U-shape)', cat: 'Walls & Structure', w: 300, h: 200, thick: true, shapeHit: true,
      draw: (w, h, p) => { const t = thick(w, h, p); return path(`M0 ${h}V0H${w}V${h}H${w - t}V${t}H${t}V${h}Z`, 'k'); } },
    { id: 'room', name: 'Room', cat: 'Walls & Structure', w: 400, h: 300, thick: true, shapeHit: true,
      draw: (w, h, p) => { const t = thick(w, h, p); return path(`M0 0H${w}V${h}H0Z M${t} ${t}V${h - t}H${w - t}V${t}Z`, 'k', 'fill-rule="evenodd"'); } },
    /* Half-height walls (1.20 m, kept at that height — not stretched to the floor above): a low partition, a kitchen
       pass-through, a knee wall round a stairwell or terrace. The same wall kinds as above, drawn lighter in the picker. */
    { id: 'wall-half', name: 'Half-height wall', cat: 'Walls & Structure', w: 300, h: 10, makes: 'wall-h', preset: { wh: 120, freeH: true, t: 10 },
      draw: (w, h) => rect(0, 0, w, h, 'k', 'fill-opacity=".45"') },
    { id: 'corner-half', name: 'Half-height corner (L-shape)', cat: 'Walls & Structure', w: 150, h: 150, thick: true, shapeHit: true, makes: 'corner-tl', preset: { wh: 120, freeH: true, t: 10 },
      draw: (w, h, p) => { const t = thick(w, h, { ...p, t: p.t || 10 }); return path(`M0 0H${w}V${t}H${t}V${h}H0Z`, 'k', 'fill-opacity=".45"'); } },
    { id: 'wall-u-half', name: 'Half-height U-shape', cat: 'Walls & Structure', w: 300, h: 200, thick: true, shapeHit: true, makes: 'wall-u', preset: { wh: 120, freeH: true, t: 10 },
      draw: (w, h, p) => { const t = thick(w, h, { ...p, t: p.t || 10 }); return path(`M0 ${h}V0H${w}V${h}H${w - t}V${t}H${t}V${h}Z`, 'k', 'fill-opacity=".45"'); } },
    { id: 'room-half', name: 'Half-height enclosure', cat: 'Walls & Structure', w: 400, h: 300, thick: true, shapeHit: true, makes: 'room', preset: { wh: 120, freeH: true, t: 10 },
      draw: (w, h, p) => { const t = thick(w, h, { ...p, t: p.t || 10 }); return path(`M0 0H${w}V${h}H0Z M${t} ${t}V${h - t}H${w - t}V${t}Z`, 'k', 'fill-rule="evenodd" fill-opacity=".45"'); } },
    /* Interior walls (10 cm, full height): a thin inner lining or partition — a service cavity for electrical wiring,
       or a layer of thermal insulation in front of an outer wall. Ordinary walls / corners, only thinner, marked
       it.interior so the plan draws them mid-gray (the same gray here in the picker). */
    { id: 'wall-int', name: 'Interior wall (I-shape, 10 cm)', cat: 'Walls & Structure', w: 300, h: 10, makes: 'wall-h', preset: { t: 10, interior: true },
      draw: (w, h) => rect(0, 0, w, h, 'k', 'style="fill:#5c6168"') },
    { id: 'corner-int', name: 'Interior wall (L-shape, 10 cm)', cat: 'Walls & Structure', w: 150, h: 150, thick: true, shapeHit: true, makes: 'corner-tl', preset: { t: 10, interior: true },
      draw: (w, h, p) => { const t = thick(w, h, { ...p, t: p.t || 10 }); return path(`M0 0H${w}V${t}H${t}V${h}H0Z`, 'k', 'style="fill:#5c6168"'); } },
    // a tool, not an object: click the icon, then click a room to line all its walls with interior walls (lineRoom)
    { id: 'room-lining', name: 'Line a room with interior walls (click a room)', cat: 'Walls & Structure', w: 150, h: 150, tool: 'lining',
      makes: 'room', preset: { t: 10, interior: true },
      draw: (w, h) => path(`M0 0H${w}V${h}H0Z M15 15V${h - 15}H${w - 15}V15Z`, 'k', 'fill-rule="evenodd"') +
        path(`M15 15H${w - 15}V${h - 15}H15Z M25 25V${h - 25}H${w - 25}V25Z`, 'k', 'fill-rule="evenodd" style="fill:#5c6168"') +
        path(`M${w / 2 - 20} ${h - 15}h40v-10h-40z`, '', 'fill="#ffffff" stroke="none"') },
    { id: 'column', name: 'Column', cat: 'Walls & Structure', w: 30, h: 30,
      draw: (w, h) => rect(0, 0, w, h, 'k') },
    { id: 'column-round', name: 'Column (round)', cat: 'Walls & Structure', w: 30, h: 30,
      draw: (w, h) => ell(w / 2, h / 2, w / 2, h / 2, 'k') },
    // structural floor slab of this level: top = the level's floor, underside = ceiling of the level below.
    // Drawn with the usual diagonal hatch; thickness = item.slabT (default 30 cm)
    // floor slabs: one item type ('slab'), built as timber (joists) or concrete (it.slabType); two icons in the picker
    { id: 'slab', name: 'Timber floor slab', cat: 'Walls & Structure', w: 400, h: 400, fill: '#ece9e4', draw: (w, h, p) => slabDraw(w, h, p) },
    { id: 'slab-concrete', name: 'Concrete floor slab', cat: 'Walls & Structure', w: 400, h: 400, fill: '#dedbd5', makes: 'slab',
      draw: (w, h, p) => slabDraw(w, h, { ...p, slabType: 'concrete' }) },
    { id: 'pillar', name: 'Pillar (hollow)', cat: 'Walls & Structure', w: 40, h: 40,
      svg: rect(0, 0, 40, 40) + line(0, 0, 40, 40) + line(40, 0, 0, 40) },
    { id: 'dim-h', name: 'Dimension', cat: 'Walls & Structure', w: 200, h: 30, ownLabel: true,
      draw: (w, h, p) => {
        const y = h * 0.65, a = Math.min(8, w / 4);
        return line(0, 0, 0, h) + line(w, 0, w, h) + line(0, y, w, y) +
          path(`M0 ${y}l${a} -3v6z`, 'k') + path(`M${w} ${y}l${-a} -3v6z`, 'k') +
          text(w / 2, y - 4, p.label || `${(w / 100).toFixed(2)} m`);
      } },
    { id: 'dim-v', name: 'Dimension (vertical)', cat: 'Walls & Structure', hidden: true, // (= the horizontal one turned 90°; kept for older plans)
      w: 30, h: 200, ownLabel: true,
      draw: (w, h, p) => {
        const x = w * 0.65, a = Math.min(8, h / 4);
        return line(0, 0, w, 0) + line(0, h, w, h) + line(x, 0, x, h) +
          path(`M${x} 0l-3 ${a}h6z`, 'k') + path(`M${x} ${h}l-3 ${-a}h6z`, 'k') +
          text(0, 0, p.label || `${(h / 100).toFixed(2)} m`, 11, `transform="translate(${x - 4} ${h / 2}) rotate(-90)"`);
      } },
    { id: 'dim-h-label', name: 'Dimension with label', cat: 'Walls & Structure', w: 200, h: 30, ownLabel: true, label: 'Label',
      draw: (w, h, p) => {
        const y = h * 0.65, a = Math.min(8, w / 4), t = p.label || `${(w / 100).toFixed(2)} m`;
        const tw = Math.min(w - 2 * a, t.length * 6.5 + 8);
        return line(0, 0, 0, h) + line(w, 0, w, h) +
          line(0, y, (w - tw) / 2, y) + line((w + tw) / 2, y, w, y) +
          path(`M0 ${y}l${a} -3v6z`, 'k') + path(`M${w} ${y}l${-a} -3v6z`, 'k') +
          text(w / 2, y + 4, t);
      } },
    { id: 'dim-v-label', name: 'Dimension label (vert.)', cat: 'Walls & Structure', hidden: true, // (= the horizontal one turned 90°; kept for older plans)
      w: 30, h: 200, ownLabel: true, label: 'Label',
      draw: (w, h, p) => {
        const x = w * 0.5, a = Math.min(8, h / 4), t = p.label || `${(h / 100).toFixed(2)} m`;
        const tl = Math.min(h - 2 * a, t.length * 6.5 + 8);
        return line(0, 0, w, 0) + line(0, h, w, h) +
          line(x, 0, x, (h - tl) / 2) + line(x, (h + tl) / 2, x, h) +
          path(`M${x} 0l-3 ${a}h6z`, 'k') + path(`M${x} ${h}l-3 ${-a}h6z`, 'k') +
          text(0, 0, t, 11, `transform="translate(${x + 4} ${h / 2}) rotate(-90)"`);
      } },

    /* ───────────── Roofs ─────────────
     * The rectangle is the outline of the walls it covers (the eaves overhang it by item.overhang); the ridge runs
     * along its width (rotate / swap W ↔ H for the other way). Plan symbol: outline, ridge / hip / valley lines. */
    ...ROOF_STYLES.map(([style, name, fill]) => ({ id: 'roof-' + style, name, cat: 'Roofs', w: 400, h: 300, fill, roof: style,
      draw: (w, h, p) => roofSymbol(style, w, h, p) })),
    // a flat roof with a fence (railing) round its edge — a roof terrace; the fence 0.5 m high unless set (p.roofFence)
    { id: 'roof-flat-fence', name: 'Flat roof with fence', cat: 'Roofs', w: 400, h: 300, fill: '#9ca3af', roof: 'flat', roofFence: true,
      draw: (w, h, p) => roofSymbol('flat', w, h, p, true) },
    // an L-shaped hip roof: a hip roof over a rectangle with one corner left out (p.lCorner: 'tr' / 'tl' / 'br' / 'bl',
    // the part left out p.lCutW × p.lCutD) — two hip roofs meeting in a valley, built as one roof
    { id: 'roof-hip-l', name: 'L-shaped hip roof (right)', cat: 'Roofs', w: 500, h: 400, fill: '#a5452f', roof: 'hip-l',
      draw: (w, h, p) => roofSymbolL(w, h, p) },
    // the same with the corner on the left left out (its default corner: top left)
    { id: 'roof-hip-l-left', name: 'L-shaped hip roof (left)', cat: 'Roofs', w: 500, h: 400, fill: '#a5452f', roof: 'hip-l', lCornerDefault: 'tl',
      draw: (w, h, p) => roofSymbolL(w, h, { ...p, lCorner: (p && p.lCorner) || 'tl' }) },
    // a chimney: placed over a roof it rises through it in 3D, standing 1 m above the roof unless set (p.chimH)
    { id: 'chimney', name: 'Chimney', cat: 'Roofs', w: 60, h: 60, fill: '#a4532f',
      draw: (w, h) => {
        const t = Math.max(6, Math.min(w, h) * 0.2);
        return rect(0, 0, w, h) + `<path d="${Array.from({ length: 6 }, (_, i) => `M0 ${(h * (i + 1)) / 7}H${w}`).join('')}" stroke-opacity=".35"/>` +
          rect(t, t, w - 2 * t, h - 2 * t, 'k', 'fill-opacity=".85"');
      } },

    /* ───────────── Windows (and railings) · Doors (and openings) — two categories in the icon list ───────────── */
    { id: 'window', name: 'Window', cat: 'Windows', w: 100, h: 15,
      svg: rect(0, 0, 100, 15) + line(0, 5, 100, 5) + line(0, 10, 100, 10) },
    { id: 'window-sill', name: 'Window (with sill)', cat: 'Windows', w: 100, h: 15,
      svg: rect(0, 0, 100, 15) + line(0, 7.5, 100, 7.5) + rect(0, 0, 8, 15, 'k') + rect(92, 0, 8, 15, 'k') },
    { id: 'window-casement', name: 'Window (casement)', cat: 'Windows', w: 100, h: 60,
      svg: rect(0, 45, 100, 15) + line(0, 52.5, 100, 52.5) + line(0, 45, 35, 5) + line(100, 45, 65, 5) +
        path('M35 5A50 50 0 0 1 50 45', '', DASH) + path('M65 5A50 50 0 0 0 50 45', '', DASH) },
    // arched window: round (or segmental, when wide) head; the dashed arc is the arch overhead
    { id: 'window-arched', name: 'Arched window', cat: 'Windows', w: 100, h: 15,
      svg: rect(0, 0, 100, 15) + line(0, 7.5, 100, 7.5) + path('M3 13Q50 -8 97 13', '', DASH) },
    // small window high up in the wall (top-hung / hopper); the arrows mean "at the top of the wall"
    { id: 'window-basement', name: 'Basement window', cat: 'Windows', w: 80, h: 15,
      svg: rect(0, 0, 80, 15) + line(0, 7.5, 80, 7.5, DASH) + path('M5 12L10 3L15 12Z', 'k') + path('M65 12L70 3L75 12Z', 'k') +
        line(25, 4, 55, 4) },
    // a roof window (skylight): placed over a roof, it lies on the roof's slope in 3D
    { id: 'roof-window', name: 'Roof window (skylight)', cat: 'Windows', w: 78, h: 98,
      svg: rect(0, 0, 78, 98) + rect(8, 8, 62, 82) + line(8, 8, 70, 90, DASH) + line(70, 8, 8, 90, DASH) + path('M31 22L39 12L47 22Z', 'k') },
    { id: 'railing', name: 'Railing / balcony', cat: 'Windows', w: 100, h: 20,
      svg: line(0, 2, 100, 2) + [0, 32, 64, 96].map((x) => rect(x, 0, 4, 16, 'k')).join('') },
    { id: 'bay-window', name: 'Bay window', cat: 'Windows', w: 140, h: 45,
      svg: path('M0 0H25L40 40H100L115 0H140') + path('M0 6H21L35 34H105L119 6H140') },
    { id: 'bay-window-round', name: 'Bow window', cat: 'Windows', w: 140, h: 45,
      svg: path('M0 0H20C35 58 105 58 120 0H140') + path('M0 6H25C38 46 102 46 115 6H140') },
    { id: 'door', name: 'Door (right)', cat: 'Doors', w: 90, h: 90,
      svg: rect(0, 0, 4, 90) + path('M0 0A90 90 0 0 1 90 90') },
    { id: 'door-arched', name: 'Arched door', cat: 'Doors', w: 90, h: 90,
      svg: rect(0, 0, 4, 90) + path('M0 0A90 90 0 0 1 90 90') + path('M6 88Q47 64 88 88', '', DASH) },
    { id: 'door-left', name: 'Door (left)', cat: 'Doors', w: 90, h: 90,
      svg: rect(86, 0, 4, 90) + path('M90 0A90 90 0 0 0 0 90') },
    { id: 'door-double', name: 'Double door', cat: 'Doors', w: 160, h: 80,
      svg: rect(0, 0, 4, 80) + path('M0 0A80 80 0 0 1 80 80') + rect(156, 0, 4, 80) + path('M160 0A80 80 0 0 0 80 80') },
    { id: 'door-double-arched', name: 'Arched double door', cat: 'Doors', w: 160, h: 80,
      svg: rect(0, 0, 4, 80) + path('M0 0A80 80 0 0 1 80 80') + rect(156, 0, 4, 80) + path('M160 0A80 80 0 0 0 80 80') +
        path('M6 78Q80 52 154 78', '', DASH) },
    { id: 'door-double-uneven', name: 'Double door (uneven)', cat: 'Doors', w: 120, h: 80,
      svg: rect(0, 0, 4, 80) + path('M0 0A80 80 0 0 1 80 80') + rect(116, 40, 4, 40) + path('M120 40A40 40 0 0 0 80 80') },
    { id: 'door-double-acting', name: 'Double-acting door', cat: 'Doors', w: 100, h: 100,
      svg: rect(0, 0, 4, 50) + path('M0 0A50 50 0 0 1 50 50') + rect(96, 50, 4, 50) + path('M50 50A50 50 0 0 0 100 100') },
    { id: 'door-swing', name: 'Swing door (2-way)', cat: 'Doors', w: 90, h: 180,
      svg: rect(0, 90, 4, 90) + path('M0 180A90 90 0 0 0 90 90') + path('M0 0A90 90 0 0 1 90 90', '', DASH) },
    { id: 'door-revolving', name: 'Revolving door', cat: 'Doors', w: 100, h: 100,
      svg: circ(50, 50, 48) + line(50, 2, 50, 98) + line(2, 50, 98, 50) + rect(0, 46, 6, 8, 'k') + rect(94, 46, 6, 8, 'k') },
    { id: 'door-sliding', name: 'Sliding door', cat: 'Doors', w: 100, h: 15,
      svg: rect(0, 0, 4, 15, 'k') + rect(96, 0, 4, 15, 'k') + rect(4, 3, 52, 4) + rect(44, 8, 52, 4) },
    { id: 'door-pocket', name: 'Pocket door', cat: 'Doors', w: 140, h: 15,
      svg: rect(0, 0, 4, 15, 'k') + rect(136, 0, 4, 15, 'k') + rect(4, 5.5, 66, 4, '', DASH) + rect(70, 5.5, 66, 4) },
    { id: 'door-bifold', name: 'Bi-fold door', cat: 'Doors', w: 100, h: 40,
      svg: path('M0 40L25 8L50 40') + path('M50 40L75 8L100 40') + rect(0, 38, 4, 4, 'k') + rect(96, 38, 4, 4, 'k') },
    { id: 'door-accordion', name: 'Accordion door', cat: 'Doors', w: 100, h: 20,
      svg: rect(0, 0, 4, 20, 'k') + rect(96, 0, 4, 20, 'k') + path('M4 10L12 2L22 18L32 2L42 18L52 2L62 18L72 2L82 18L92 2L96 10') },
    { id: 'opening', name: 'Opening', cat: 'Doors', w: 100, h: 15,
      svg: rect(0, 0, 6, 15, 'k') + rect(94, 0, 6, 15, 'k') + line(6, 7.5, 94, 7.5, DASH) },
    { id: 'garage-door', name: 'Garage door', cat: 'Doors', w: 240, h: 20,
      svg: rect(0, 0, 8, 20, 'k') + rect(232, 0, 8, 20, 'k') + rect(8, 6, 224, 8) + range(38, 208, 30).map((x) => line(x, 6, x, 14)).join('') },

    /* ───────────── Stairs ───────────── */
    // Stairs redraw their treads for the chosen number of steps (item.steps). One straight staircase covers
    // every direction: rotate it. The arrow points up the stairs.
    { id: 'stairs-h', name: 'Stairs (straight)', cat: 'Stairs', w: 240, h: 90, stairs: true,
      draw: (w, h, p) => drawStairs('stairs-h', w, h, p) + arrow(8, h / 2, w - 10, h / 2) },
    { id: 'stairs-l', name: 'Stairs (L-shape, right)', cat: 'Stairs', w: 180, h: 180, stairs: true,
      draw: (w, h, p) => { const c = lFlightW(w, h, p) / 2; return drawStairs('stairs-l', w, h, p) + line(c, h - 8, c, c) + arrow(c, c, w - 10, c); } },
    // picker variants (makes / preset): they place an ordinary staircase with these settings
    { id: 'stairs-l-left', name: 'Stairs (L-shape, left)', cat: 'Stairs', w: 180, h: 180, makes: 'stairs-l', preset: { fx: true },
      draw: (w, h, p) => { const c = lFlightW(w, h, p) / 2; return `<g transform="translate(${w} 0) scale(-1 1)">${drawStairs('stairs-l', w, h, p) + line(c, h - 8, c, c) + arrow(c, c, w - 10, c)}</g>`; } },
    /* low fences, 1 m high (Properties: material, height, colour); placed at the height chosen in the Height bar */
    { id: 'low-fence', name: 'Low fence', cat: 'Low fences', w: 200, h: 10, height: 100, hidden: true, draw: (w, h, p) => lowFenceDraw(w, h, p) },
    { id: 'low-fence-wood', name: 'Low fence, wood', cat: 'Low fences', w: 200, h: 10, height: 100, makes: 'low-fence', preset: { lfMat: 'wood' },
      thumb: () => lowFencePic('wood'), draw: (w, h, p) => lowFenceDraw(w, h, { ...p, lfMat: 'wood' }) },
    { id: 'low-fence-concrete', name: 'Low fence, concrete', cat: 'Low fences', w: 200, h: 12, height: 100, makes: 'low-fence', preset: { lfMat: 'concrete', h: 12 },
      thumb: () => lowFencePic('concrete'), draw: (w, h, p) => lowFenceDraw(w, h, { ...p, lfMat: 'concrete' }) },
    { id: 'low-fence-iron', name: 'Low fence, wrought iron', cat: 'Low fences', w: 200, h: 6, height: 100, makes: 'low-fence', preset: { lfMat: 'iron', h: 6 },
      thumb: () => lowFencePic('iron'), draw: (w, h, p) => lowFenceDraw(w, h, { ...p, lfMat: 'iron' }) },
    /* ── Balconies: a concrete slab projecting from the house wall, with its guard, a glass sliding door in the wall
       behind it, and options (Properties): shape (square / semi-circular), guard, a roof over it, clothes-drying rod
       hooks. The back edge (y = 0 on the icon) goes against the wall. One item type; the catalog entries are presets. */
    { id: 'balcony', name: 'Balcony', cat: 'Balconies', w: 300, h: 150, hidden: true, shapeHit: true, draw: (w, h, p) => balconyDraw(w, h, p) },
    { id: 'balcony-square', name: 'Square balcony, stainless railing', cat: 'Balconies', w: 300, h: 150, makes: 'balcony',
      preset: { balShape: 'square', balGuard: 'steel' }, thumb: () => balconyThumb('square', 'steel'),
      draw: (w, h, p) => balconyDraw(w, h, { ...p, balShape: 'square', balGuard: 'steel' }) },
    { id: 'balcony-round', name: 'Semi-circular balcony', cat: 'Balconies', w: 300, h: 150, makes: 'balcony',
      preset: { balShape: 'round', balGuard: 'steel' }, thumb: () => balconyThumb('round', 'steel'),
      draw: (w, h, p) => balconyDraw(w, h, { ...p, balShape: 'round', balGuard: 'steel' }) },
    { id: 'balcony-concrete', name: 'All-concrete balcony', cat: 'Balconies', w: 300, h: 150, makes: 'balcony',
      preset: { balShape: 'square', balGuard: 'concrete' }, thumb: () => balconyThumb('square', 'concrete'),
      draw: (w, h, p) => balconyDraw(w, h, { ...p, balShape: 'square', balGuard: 'concrete' }) },
    { id: 'balcony-recessed', name: 'Recessed balcony (front railing only)', cat: 'Balconies', w: 300, h: 150, makes: 'balcony',
      preset: { balShape: 'square', balGuard: 'steel', balL: 'wall', balF: 'rail', balR: 'wall' }, thumb: () => balconyPic({ shape: 'square', guard: 'steel', sides: 'front' }),
      draw: (w, h, p) => balconyDraw(w, h, { ...p, balShape: 'square', balGuard: 'steel', balL: 'wall', balF: 'rail', balR: 'wall' }) },
    { id: 'balcony-l', name: 'L-shaped corner balcony', cat: 'Balconies', w: 450, h: 300, makes: 'balcony',
      preset: { balShape: 'L', balGuard: 'steel', balDepth: 150 }, thumb: () => balconyThumb('L', 'steel'),
      draw: (w, h, p) => balconyDraw(w, h, { ...p, balShape: 'L', balGuard: 'steel', balDepth: 150 }) },
    { id: 'balcony-low', name: 'Low concrete wall, stainless rail', cat: 'Balconies', w: 300, h: 150, makes: 'balcony',
      preset: { balShape: 'square', balGuard: 'low' }, thumb: () => balconyThumb('square', 'low'),
      draw: (w, h, p) => balconyDraw(w, h, { ...p, balShape: 'square', balGuard: 'low' }) },
    { id: 'stairs-mid', name: 'Stairs (long, landing half way)', cat: 'Stairs', w: 420, h: 90, makes: 'stairs-h', preset: { midLanding: true },
      draw: (w, h, p) => { const L = Math.min(h, w * 0.4), x1 = (w - L) / 2; return drawStairs('stairs-h', w, h, { steps: 14, ...p, midLanding: true }) +
        arrow(8, h / 2, x1 - 4, h / 2) + arrow(x1 + L + 4, h / 2, w - 10, h / 2); } },
    { id: 'stairs-sq', name: 'Stairs (square top step)', cat: 'Stairs', w: 240, h: 90, makes: 'stairs-h', preset: { topLanding: true, landingSquare: true },
      draw: (w, h, p) => drawStairs('stairs-h', w, h, { steps: 8, ...p, topLanding: true, landingSquare: true }) + arrow(8, h / 2, w - h - 6, h / 2) },
    { id: 'stairs-u', name: 'Stairs (U-shape)', cat: 'Stairs', w: 200, h: 240, stairs: true,
      draw: (w, h, p) => {
        const lay = stairLayout('stairs-u', w, h, stepsOf('stairs-u', p), p), L = lay.landingDepth, c = lay.flightW / 2;
        return drawStairs('stairs-u', w, h, p) + path(`M${c} ${h - 8}V${L / 2}H${w - c}`) + arrow(w - c, L / 2, w - c, h - 10);
      } },
    // picker variant: a modern open U — thick treads on a central steel spine, metal rails with horizontal bars both
    // sides, a small open well between the flights
    { id: 'stairs-u-open', name: 'Stairs (U-shape, open, bar railing)', cat: 'Stairs', w: 210, h: 240, makes: 'stairs-u',
      preset: { under: 'mono', rail: 'both', railStyle: 'bars', flightW: 95, wellW: 20 },
      draw: (w, h, p) => {
        const q = { flightW: 95, wellW: 20, rail: 'both', railStyle: 'bars', ...p };
        const lay = stairLayout('stairs-u', w, h, stepsOf('stairs-u', q), q), L = lay.landingDepth, c = lay.flightW / 2;
        return drawStairs('stairs-u', w, h, q) + path(`M${c} ${h - 8}V${L / 2}H${w - c}`) + arrow(w - c, L / 2, w - c, h - 10);
      } },
    // picker variant: the U mirrored — up the right-hand flight, down the left
    { id: 'stairs-u-right', name: 'Stairs (U-shape, right side up)', cat: 'Stairs', w: 200, h: 240, makes: 'stairs-u', preset: { fx: true },
      draw: (w, h, p) => {
        const lay = stairLayout('stairs-u', w, h, stepsOf('stairs-u', p), p), L = lay.landingDepth, c = lay.flightW / 2;
        return `<g transform="translate(${w} 0) scale(-1 1)">${drawStairs('stairs-u', w, h, p) + path(`M${c} ${h - 8}V${L / 2}H${w - c}`) + arrow(w - c, L / 2, w - c, h - 10)}</g>`;
      } },
    // a hole in the floor slab of this level (a stairwell / void connecting it with the level below).
    // Standard plan symbol: dashed outline with a cross; the small triangle marks the open (stair) side.
    { id: 'slab-opening', name: 'Floor opening (stairwell)', cat: 'Stairs', w: 120, h: 260,
      draw: (w, h) => rect(0, 0, w, h, '', 'fill="#ffffff" fill-opacity=".55" stroke-dasharray="8 5"') + line(0, 0, w, h, DASH) + line(w, 0, 0, h, DASH) +
        path(`M${w / 2 - 9} ${h - 4}l9 -12l9 12z`, 'k') + text(w / 2, h / 2 - 6, 'OPENING', 11, 'font-weight="bold" fill-opacity=".6"') },
    { id: 'stairs-spiral', name: 'Spiral stairs', cat: 'Stairs', w: 160, h: 160, stairs: true,
      draw: (w, h, p) => {
        const n = stepsOf('stairs-spiral', p), rx = w / 2, ry = h / 2, ra = 0.62, b = spiralAngles(n, p);
        let s = ell(rx, ry, rx, ry);
        if (b.landing) {
          // the top landing: a shaded pie slice, labelled (kept upright like the other landings)
          const a0 = b[n - 1], a1 = b[n], P = (a, k) => `${(rx + rx * k * Math.cos(a)).toFixed(1)} ${(ry + ry * k * Math.sin(a)).toFixed(1)}`;
          s += `<path d="M${P(a0, 0.13)}L${P(a0, 1)}A${rx} ${ry} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${P(a1, 1)}L${P(a1, 0.13)}Z" fill="currentColor" fill-opacity=".08" stroke="none"/>`;
          const am = (a0 + a1) / 2, cx = +(rx + rx * 0.6 * Math.cos(am)).toFixed(1), cy = +(ry + ry * 0.6 * Math.sin(am)).toFixed(1), r = (p && p.r) || 0;
          s += text(cx, cy + 3, 'LANDING', Math.max(6, Math.min(10, w / 16)), `fill-opacity=".55" font-weight="bold" transform="translate(${cx} ${cy}) scale(${p.fx ? -1 : 1} ${p.fy ? -1 : 1}) rotate(${-r}) translate(${-cx} ${-cy})"`);
        }
        // more than one turn: the steps overlap on the plan, so only the lowest turn is drawn (as cut at ~1.2 m)
        for (let k = 0; k < n; k++) {
          if (b[k] - b[0] > Math.PI * 2 - 1e-6) break;
          const a = b[k], c = Math.cos(a), si = Math.sin(a);
          s += line((rx + rx * 0.13 * c).toFixed(1), (ry + ry * 0.13 * si).toFixed(1), (rx + rx * c).toFixed(1), (ry + ry * si).toFixed(1));
        }
        if (b.turn > Math.PI * 2 + 0.01) {
          const turns = b.turn / (Math.PI * 2), t = Math.abs(turns - Math.round(turns)) < 0.01 ? String(Math.round(turns)) : turns.toFixed(2).replace(/0$/, '');
          const cx = rx, cy = +(ry + ry * 0.32).toFixed(1), r = (p && p.r) || 0;
          s += text(cx, cy, `${t} TURNS`, Math.max(6, Math.min(10, w / 16)), `fill-opacity=".55" font-weight="bold" transform="translate(${cx} ${cy}) scale(${p.fx ? -1 : 1} ${p.fy ? -1 : 1}) rotate(${-r}) translate(${-cx} ${-cy})"`);
        }
        const e = (211 * Math.PI) / 180, E = [rx + rx * ra * Math.cos(e), ry + ry * ra * Math.sin(e)];
        const tg = [-Math.sin(e), Math.cos(e)];
        if (p && p.rail && p.rail !== 'none') s += `<g class="stair-rail">${p.railStyle === 'glass'
          ? `<ellipse cx="${rx}" cy="${ry}" rx="${rx - 2.4}" ry="${ry - 2.4}" fill="none" stroke-width="1"/><ellipse cx="${rx}" cy="${ry}" rx="${rx - 5.6}" ry="${ry - 5.6}" fill="none" stroke-width="1"/>`
          : `<ellipse cx="${rx}" cy="${ry}" rx="${rx - 4}" ry="${ry - 4}" fill="none" stroke-width="${p.railStyle === 'metal' || p.railStyle === 'bars' ? 2 : 3}"/>`}</g>`;
        return s + ell(rx, ry, rx * 0.13, ry * 0.13) + path(`M${rx} ${ry - ry * ra}A${rx * ra} ${ry * ra} 0 1 1 ${E[0].toFixed(1)} ${E[1].toFixed(1)}`) +
          arrow(E[0] - tg[0] * 6, E[1] - tg[1] * 6, E[0], E[1]);
      } },

    /* ───────────── Living & Bedroom ───────────── */
    { id: 'bed-double', name: 'Double bed', cat: 'Living & Bedroom', w: 160, h: 200,
      svg: rect(0, 0, 160, 200, 'b', 'rx="3"') + rect(0, 0, 160, 8) + rect(12, 14, 62, 30, 'b', 'rx="7"') + rect(86, 14, 62, 30, 'b', 'rx="7"') +
        line(0, 56, 160, 56) + line(0, 66, 160, 66) },
    { id: 'bed-single', name: 'Single bed', cat: 'Living & Bedroom', w: 90, h: 200,
      svg: rect(0, 0, 90, 200, 'b', 'rx="3"') + rect(0, 0, 90, 8) + rect(14, 14, 62, 30, 'b', 'rx="7"') + line(0, 56, 90, 56) + line(0, 66, 90, 66) },
    { id: 'sofa', name: 'Sofa (3-seat)', cat: 'Living & Bedroom', w: 200, h: 90,
      svg: rect(0, 0, 200, 90, 'b', 'rx="6"') + rect(0, 0, 200, 22, 'b', 'rx="6"') + rect(0, 0, 20, 90, 'b', 'rx="6"') + rect(180, 0, 20, 90, 'b', 'rx="6"') +
        line(73, 22, 73, 90) + line(127, 22, 127, 90) },
    { id: 'loveseat', name: 'Sofa (2-seat)', cat: 'Living & Bedroom', w: 150, h: 90,
      svg: rect(0, 0, 150, 90, 'b', 'rx="6"') + rect(0, 0, 150, 22, 'b', 'rx="6"') + rect(0, 0, 20, 90, 'b', 'rx="6"') + rect(130, 0, 20, 90, 'b', 'rx="6"') +
        line(75, 22, 75, 90) },
    { id: 'armchair', name: 'Armchair', cat: 'Living & Bedroom', w: 85, h: 85,
      svg: rect(0, 0, 85, 85, 'b', 'rx="6"') + rect(0, 0, 85, 20, 'b', 'rx="6"') + rect(0, 0, 16, 85, 'b', 'rx="6"') + rect(69, 0, 16, 85, 'b', 'rx="6"') },
    { id: 'tub-chair', name: 'Tub chair', cat: 'Living & Bedroom', w: 80, h: 80,
      svg: path('M8 34Q8 4 40 4Q72 4 72 34L68 70Q40 80 12 70Z', 'b') + rect(18, 30, 44, 38, 'b', 'rx="10"') },
    { id: 'lounge-chair', name: 'Lounge chair', cat: 'Living & Bedroom', w: 80, h: 85,
      svg: path('M6 30H74L80 85H0Z', 'b') + rect(10, 0, 60, 30, 'b', 'rx="3"') + range(20, 60, 10).map((x) => line(x, 4, x, 26)).join('') },
    { id: 'chair', name: 'Chair', cat: 'Living & Bedroom', w: 45, h: 45,
      svg: rect(3, 8, 39, 35, 'b', 'rx="6"') + path('M2 12Q22.5 -4 43 12', 'b') + path('M2 12Q22.5 4 43 12') },
    { id: 'office-chair', name: 'Office chair', cat: 'Living & Bedroom', w: 60, h: 60,
      svg: range(0, 288, 72).map((a) => {
          const r = ((a - 90) * Math.PI) / 180;
          return line(30, 32, (30 + 28 * Math.cos(r)).toFixed(1), (32 + 28 * Math.sin(r)).toFixed(1)) + circ((30 + 28 * Math.cos(r)).toFixed(1), (32 + 28 * Math.sin(r)).toFixed(1), 2.5);
        }).join('') + rect(10, 14, 40, 38, 'b', 'rx="9"') + rect(8, 4, 44, 11, 'b', 'rx="5"') },
    { id: 'desk', name: 'Desk', cat: 'Living & Bedroom', w: 140, h: 70,
      svg: rect(0, 0, 140, 70) + rect(95, 4, 40, 62, 'b') + range(25, 50, 20).map((y) => line(95, y, 135, y)).join('') },
    { id: 'desk-computer', name: 'Desk with computer', cat: 'Living & Bedroom', w: 140, h: 110,
      table: { x: 0, y: 0, w: 140, h: 70 }, chairs: [[70, 88, 180]],
      svg: rect(0, 0, 140, 70) + rect(45, 8, 50, 7, 'k') + line(70, 15, 70, 22) + rect(42, 34, 56, 14, 'b', 'rx="2"') +
        range(50, 90, 8).map((x) => line(x, 34, x, 48)).join('') + rect(104, 36, 9, 13, 'b', 'rx="4"') + chair(70, 88, 180) },
    { id: 'desk-corner', name: 'Corner desk', cat: 'Living & Bedroom', w: 140, h: 140,
      svg: path('M0 0H140V60H100L60 100V140H0Z') + path('M18 52L52 18', '', 'stroke-width="5"') },
    { id: 'desk-l', name: 'L-shaped desk', cat: 'Living & Bedroom', w: 160, h: 140,
      svg: path('M0 0H160V60H60V140H0Z') },
    { id: 'tv', name: 'TV', cat: 'Living & Bedroom', w: 120, h: 20,
      svg: rect(0, 2, 120, 6, 'k') + path('M45 8L40 18H80L75 8', 'b') },
    { id: 'tv-stand', name: 'TV stand', cat: 'Living & Bedroom', w: 160, h: 45,
      svg: rect(0, 0, 160, 45) + rect(20, 4, 120, 5, 'k') + line(53, 18, 53, 45) + line(107, 18, 107, 45) + line(0, 18, 160, 18) },
    { id: 'storage', name: 'Wardrobe / storage', cat: 'Living & Bedroom', w: 100, h: 60,
      svg: rect(0, 0, 100, 60) + line(0, 0, 100, 60) + line(100, 0, 0, 60) },
    { id: 'bookshelf', name: 'Bookshelf', cat: 'Living & Bedroom', w: 120, h: 35,
      svg: rect(0, 0, 120, 35) + range(10, 110, 6).map((x, i) => line(x, 4 + (i % 3) * 2, x, 31)).join('') },
    { id: 'fireplace', name: 'Fireplace', cat: 'Living & Bedroom', w: 120, h: 70,
      svg: rect(0, 0, 120, 70) + path('M15 0L30 45H90L105 0', 'b') + range(36, 84, 8).map((x) => line(x, 8, x, 40)).join('') + rect(0, 55, 120, 15) },
    { id: 'radiator', name: 'Radiator', cat: 'Living & Bedroom', w: 100, h: 18,
      svg: rect(0, 0, 100, 18) + range(6, 94, 6).map((x) => line(x, 0, x, 18)).join('') },
    { id: 'piano', name: 'Upright piano', cat: 'Living & Bedroom', w: 150, h: 60,
      svg: rect(0, 0, 150, 40) + rect(0, 40, 150, 20) + range(7, 143, 7).map((x) => line(x, 40, x, 60)).join('') +
        range(5, 145, 7).filter((_, i) => i % 7 !== 2 && i % 7 !== 6).map((x) => rect(x, 40, 4, 11, 'k')).join('') },
    { id: 'grand-piano', name: 'Grand piano', cat: 'Living & Bedroom', w: 150, h: 180,
      svg: path('M0 0H100C110 60 150 85 150 135C150 165 130 180 100 180H25Q0 180 0 155Z', 'b') + rect(0, 0, 100, 16) +
        range(6, 94, 6).map((x) => line(x, 0, x, 16)).join('') + rect(30, 26, 40, 8, 'b', 'rx="2"') },
    { id: 'plant', name: 'Plant', cat: 'Living & Bedroom', w: 70, h: 70,
      svg: range(0, 300, 60).map((a) => ell(35, 18, 9, 17, 'b', `transform="rotate(${a} 35 35)"`)).join('') +
        range(30, 330, 60).map((a) => ell(35, 22, 6, 13, 'b', `transform="rotate(${a} 35 35)"`)).join('') + circ(35, 35, 7) },
    { id: 'rug', name: 'Rug', cat: 'Living & Bedroom', w: 200, h: 140,
      svg: rect(0, 0, 200, 140) + rect(10, 10, 180, 120, '', DASH) },
    { id: 'ceiling-fan', name: 'Ceiling fan', cat: 'Living & Bedroom', w: 90, h: 90,
      svg: circ(45, 45, 43, '', DASH) + range(0, 270, 90).map((a) => ell(45, 20, 7, 20, 'b', `transform="rotate(${a} 45 45)"`)).join('') + circ(45, 45, 9) },

    /* ───────────── Kitchen & Bath ───────────── */
    { id: 'stove', name: 'Cooktop (4)', cat: 'Kitchen & Bath', w: 60, h: 60,
      svg: rect(0, 0, 60, 60) + [[16, 16, 9], [44, 16, 7], [16, 44, 7], [44, 44, 9]].map(([x, y, r]) => circ(x, y, r) + circ(x, y, 2.5, 'k')).join('') },
    { id: 'range', name: 'Range (5 burners)', cat: 'Kitchen & Bath', w: 90, h: 60,
      svg: rect(0, 0, 90, 60) + [[16, 16], [74, 16], [16, 44], [74, 44]].map(([x, y]) => circ(x, y, 8) + circ(x, y, 2.5, 'k')).join('') +
        rect(36, 14, 18, 32, 'b', 'rx="3"') + circ(45, 30, 6) },
    { id: 'fridge', name: 'Refrigerator', cat: 'Kitchen & Bath', w: 70, h: 70,
      svg: rect(0, 0, 70, 70, 'b', 'rx="6"') + line(0, 58, 70, 58) + line(35, 58, 35, 70) },
    { id: 'dishwasher', name: 'Dishwasher', cat: 'Kitchen & Bath', w: 60, h: 60,
      svg: rect(0, 0, 60, 60) + rect(6, 6, 48, 40, 'b', 'rx="3"') + line(6, 52, 54, 52) + text(30, 30, 'DW', 12) },
    { id: 'washer', name: 'Washing machine', cat: 'Kitchen & Bath', w: 60, h: 60,
      svg: rect(0, 0, 60, 60, 'b', 'rx="4"') + line(0, 10, 60, 10) + circ(30, 35, 19) + circ(30, 35, 4) + circ(50, 5, 2, 'k') },
    { id: 'sink', name: 'Kitchen sink', cat: 'Kitchen & Bath', w: 80, h: 60,
      svg: rect(0, 0, 80, 60) + rect(10, 14, 60, 38, 'b', 'rx="8"') + circ(40, 33, 3) + rect(37, 3, 6, 12, 'k', 'rx="2"') },
    { id: 'sink-double', name: 'Double sink', cat: 'Kitchen & Bath', w: 120, h: 60,
      svg: rect(0, 0, 120, 60) + rect(8, 14, 49, 38, 'b', 'rx="7"') + rect(63, 14, 49, 38, 'b', 'rx="7"') + circ(32, 33, 3) + circ(88, 33, 3) +
        rect(57, 3, 6, 12, 'k', 'rx="2"') },
    { id: 'washbasin', name: 'Washbasin', cat: 'Kitchen & Bath', w: 60, h: 45,
      svg: path('M0 0H60V20Q60 45 30 45Q0 45 0 20Z', 'b') + ell(30, 23, 20, 15) + circ(30, 25, 2.5) + rect(27, 2, 6, 10, 'k', 'rx="2"') },
    { id: 'toilet', name: 'Toilet', cat: 'Kitchen & Bath', w: 45, h: 70,
      svg: rect(0, 0, 45, 18, 'b', 'rx="3"') + ell(22.5, 45, 18, 24) + ell(22.5, 47, 11, 16) },
    { id: 'bathtub', name: 'Bathtub', cat: 'Kitchen & Bath', w: 170, h: 75,
      svg: rect(0, 0, 170, 75, 'b', 'rx="4"') + rect(8, 8, 154, 59, 'b', 'rx="26"') + circ(24, 37.5, 3.5) },
    { id: 'shower', name: 'Shower', cat: 'Kitchen & Bath', w: 90, h: 90,
      svg: rect(0, 0, 90, 90) + rect(6, 6, 78, 78, 'b', 'rx="6"') + line(6, 6, 84, 84, DASH) + line(84, 6, 6, 84, DASH) + circ(45, 45, 4) },
    { id: 'counter', name: 'Counter', cat: 'Kitchen & Bath', w: 180, h: 60,
      svg: rect(0, 0, 180, 60) + line(0, 54, 180, 54) },

    /* ───────────── Tables ───────────── */
    tableIcon('table-sq2', 'Table, 2 chairs', 90, 150, { x: 5, y: 35, w: 80, h: 80 }, sides([45], 18, 132)),
    tableIcon('table-sq4', 'Square table, 4 chairs', 150, 150, { x: 35, y: 35, w: 80, h: 80 },
      [...sides([75], 18, 132), [18, 75, -90], [132, 75, 90]]),
    tableIcon('table-round4', 'Round table, 4 chairs', 150, 150, { x: 31, y: 31, w: 88, h: 88, round: true },
      [...sides([75], 18, 132), [18, 75, -90], [132, 75, 90]]),
    tableIcon('table-oval4', 'Oval table, 4 chairs', 200, 130, { x: 30, y: 29, w: 140, h: 72, round: true },
      [...sides([100], 18, 112), [18, 65, -90], [182, 65, 90]]),
    tableIcon('table-rect6', 'Table, 6 chairs', 220, 150, { x: 35, y: 35, w: 150, h: 80 },
      [...sides([80, 140], 18, 132), [18, 75, -90], [202, 75, 90]]),
    tableIcon('table-oval6', 'Oval table, 6 chairs', 260, 140, { x: 30, y: 30, w: 200, h: 80, round: true },
      [...sides([100, 160], 18, 122), [18, 70, -90], [242, 70, 90]]),
    tableIcon('table-long8', 'Table, 8 chairs', 280, 150, { x: 35, y: 35, w: 210, h: 80 },
      [...sides([80, 140, 200], 18, 132), [18, 75, -90], [262, 75, 90]]),
    tableIcon('table-conf', 'Conference table', 400, 150, { x: 35, y: 35, w: 330, h: 80, rx: 30 },
      [...sides([80, 140, 200, 260, 320], 18, 132), [18, 75, -90], [382, 75, 90]]),

    /* ───────────── Garden ─────────────
     * `fill` = default fill colour for new items (plants green, water blue …) */
    // hill / hollow: an ellipse of terrain (item.hillH cm at its middle, back to the ground at its edge); it shapes the
    // 3D ground. Drawn with a height gradient and contour lines; it can be made as large as the whole site.
    { id: 'hill', name: 'Hill / slope', cat: 'Garden', w: 1200, h: 900, shapeHit: true,
      draw: (w, h, p) => {
        const id = `hillg-${p.patId || p.id || 'x'}`, H = p.hillH == null ? 300 : p.hillH, up = H >= 0;
        const [c0, c1] = up ? ['#9cc26a', '#e9f2d8'] : ['#7fb3c9', '#e3f0f5'];   // middle → edge
        const rx = w / 2, ry = h / 2, sw = 1; // the plan draws strokes at a fixed screen width (px), whatever the size
        const contours = [0.8, 0.6, 0.4, 0.2].map((k) => ell(rx, ry, rx * k, ry * k, '', `fill="none" stroke="${up ? '#5f7f3a' : '#3f7088'}" stroke-opacity=".45" stroke-width="${sw}" stroke-dasharray="${sw * 6} ${sw * 4}"`)).join('');
        return `<defs><radialGradient id="${id}"><stop offset="0" stop-color="${c0}" stop-opacity=".85"/><stop offset="1" stop-color="${c1}" stop-opacity=".35"/></radialGradient></defs>` +
          ell(rx, ry, rx, ry, '', `fill="url(#${id})" stroke="${up ? '#5f7f3a' : '#3f7088'}" stroke-width="${sw * 1.5}" stroke-dasharray="${sw * 10} ${sw * 6}"`) + contours +
          text(rx, ry + Math.min(60, h / 12) / 3, `${up ? 'HILL +' : 'HOLLOW −'}${(Math.abs(H) / 100).toFixed(2)} m`, Math.max(12, Math.min(60, w / 14)), `fill-opacity=".6" font-weight="bold"`);
      } },
    // sloped surface: the top edge (bold) is the high edge at item.slopeH; the surface runs down to the opposite edge,
    // the two sides blend into the ground around over item.blend cm; never across a wall
    { id: 'slope', name: 'Slope (ramp)', cat: 'Garden', w: 400, h: 600, shapeHit: true,
      draw: (w, h, p) => {
        const id = `slopeg-${p.patId || p.id || 'x'}`, H = p.slopeH == null ? 100 : p.slopeH, up = H >= 0, m = p.blend == null ? 200 : p.blend;
        const [c0, c1] = up ? ['#9cc26a', '#eef5e2'] : ['#7fb3c9', '#e9f3f7'];
        const fs = Math.max(12, Math.min(40, w / 12)), ax = w / 2;
        // contour lines across the slope, every quarter of its fall
        const contours = [0.25, 0.5, 0.75].map((k) => `<line x1="0" y1="${h * k}" x2="${w}" y2="${h * k}" stroke="${up ? '#5f7f3a' : '#3f7088'}" stroke-opacity=".45" stroke-dasharray="6 4"/>`).join('');
        return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c0}" stop-opacity=".9"/><stop offset="1" stop-color="${c1}" stop-opacity=".4"/></linearGradient></defs>` +
          `<rect x="${-m}" y="0" width="${w + 2 * m}" height="${h}" fill="none" stroke="${up ? '#5f7f3a' : '#3f7088'}" stroke-opacity=".3" stroke-dasharray="3 5"/>` +
          `<rect width="${w}" height="${h}" fill="url(#${id})" stroke="${up ? '#5f7f3a' : '#3f7088'}" stroke-dasharray="10 6"/>` + contours +
          `<line x1="0" y1="0" x2="${w}" y2="0" stroke="${up ? '#3d5a22' : '#24566b'}" stroke-width="4"/>` +
          `<path d="M${ax} ${h * 0.2}V${h * 0.8}M${ax - 12} ${h * 0.8 - 16}L${ax} ${h * 0.8}L${ax + 12} ${h * 0.8 - 16}" fill="none" stroke="currentColor" stroke-width="2.5"/>` +
          text(ax, fs * 1.4, `${H >= 0 ? '+' : '−'}${(Math.abs(H) / 100).toFixed(2)} m`, fs, 'fill-opacity=".7" font-weight="bold"') +
          text(ax, h - fs * 0.6, 'SLOPE', fs * 0.8, 'fill-opacity=".5" font-weight="bold"');
      } },
    // gravel path: length along w, width h; in 3D it follows the ground and turns into steps where it gets steep
    { id: 'gravel-path', name: 'Gravel path', cat: 'Garden', w: 500, h: 120, fill: '#cfc8bb',
      draw: (w, h, p) => {
        let dots = '';
        let seed = 7;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < Math.min(400, (w * h) / 220); i++) dots += `<circle cx="${(rnd() * w).toFixed(1)}" cy="${(4 + rnd() * (h - 8)).toFixed(1)}" r="${(0.8 + rnd() * 1.6).toFixed(1)}" fill="currentColor" fill-opacity=".35"/>`;
        return rect(0, 0, w, h, 'b') + dots + line(0, 0, w, 0, 'stroke-width="2.5"') + line(0, h, w, h, 'stroke-width="2.5"') +
          `<path d="M${w * 0.42} ${h / 2}H${w * 0.58}M${w * 0.58 - 8} ${h / 2 - 6}L${w * 0.58} ${h / 2}L${w * 0.58 - 8} ${h / 2 + 6}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-opacity=".6"/>` +
          text(w / 2, h / 2 - Math.max(9, h / 6), 'GRAVEL PATH', Math.max(9, Math.min(14, h / 6)), 'fill-opacity=".55" font-weight="bold"');
      } },
    // boundaries have an adjustable height (item.fh, cm); `height` is the default
    { id: 'fence', name: 'Wooden fence', cat: 'Garden', w: 200, h: 10, height: 110,
      svg: rect(0, 3, 200, 4) + range(0, 192, 96).map((x) => rect(x, 0, 8, 10, 'k')).join('') + range(12, 188, 12).map((x) => line(x, 3, x, 7)).join('') },
    { id: 'fence-metal', name: 'Metal fence', cat: 'Garden', w: 200, h: 8, height: 120,
      svg: line(0, 4, 200, 4) + range(0, 194, 97).map((x) => rect(x, 1, 6, 6, 'k')).join('') + range(10, 190, 10).map((x) => circ(x, 4, 1.2, 'k')).join('') },
    // precast concrete fence: panels slotted between concrete posts (about every 2 m)
    { id: 'fence-concrete', name: 'Concrete fence', cat: 'Garden', w: 200, h: 15, height: 180, fill: '#c9c6bf',
      draw: (w, h) => {
        const n = Math.max(1, Math.round(w / 200)), pw = Math.min(14, w / 4);
        let g = rect(0, h * 0.3, w, h * 0.4, 'b');
        for (let i = 0; i <= n; i++) { const x = Math.min(w - pw, Math.max(0, (w * i) / n - pw / 2)); g += rect(+x.toFixed(1), 0, pw, h, 'k'); }
        return g;
      } },
    // brick fence: a one-brick wall with piers about every 2.5 m (and at the ends), hatched like brickwork on plans
    { id: 'fence-brick', name: 'Brick fence', cat: 'Garden', w: 250, h: 36, height: 150, fill: '#a4532f',
      draw: (w, h) => {
        const n = Math.max(1, Math.round(w / 250)), pw = Math.min(h, w / 3), t = h * 0.64, y0 = (h - t) / 2;
        let g = rect(0, +y0.toFixed(1), w, +t.toFixed(1), 'b');
        for (let x = -t; x < w; x += 8) g += `<line x1="${Math.max(0, x).toFixed(1)}" y1="${(y0 + t - Math.max(0, -x)).toFixed(1)}" x2="${Math.min(w, x + t).toFixed(1)}" y2="${(y0 + Math.max(0, x + t - w)).toFixed(1)}" stroke="currentColor" stroke-opacity=".45" stroke-width=".8"/>`;
        for (let i = 0; i <= n; i++) { const x = Math.min(w - pw, Math.max(0, (w * i) / n - pw / 2)); g += rect(+x.toFixed(1), 0, +pw.toFixed(1), h, 'b', 'stroke-width="1.8"'); }
        return g;
      } },
    // stone wall: a dry-stone garden wall drawn as random-coursed stones (two rows, joints at irregular spacing)
    { id: 'fence-stone', name: 'Stone wall', cat: 'Garden', w: 250, h: 40, height: 100, fill: '#a39b8b',
      draw: (w, h) => {
        let seed = 11;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        let g = rect(0, 0, w, h, 'b', 'stroke-width="1.6"');
        // a wavy joint along the middle, then vertical joints at random spacing in each row
        let d = `M0 ${(h / 2).toFixed(1)}`;
        for (let x = 15; x < w; x += 15) d += `L${Math.min(w, x).toFixed(1)} ${(h / 2 + (rnd() - 0.5) * h * 0.25).toFixed(1)}`;
        g += `<path d="${d}" fill="none" stroke="currentColor" stroke-opacity=".6" stroke-width=".9"/>`;
        for (const [y0, y1] of [[0, h / 2], [h / 2, h]]) {
          for (let x = 8 + rnd() * 18; x < w - 6; x += 16 + rnd() * 22) {
            const tilt = (rnd() - 0.5) * 6;
            g += `<line x1="${x.toFixed(1)}" y1="${(y0 + 1).toFixed(1)}" x2="${(x + tilt).toFixed(1)}" y2="${(y1 - 1).toFixed(1)}" stroke="currentColor" stroke-opacity=".6" stroke-width=".9"/>`;
          }
        }
        return g;
      } },
    // plastic (PVC / vinyl) fence: white pickets on rails, square posts with caps
    { id: 'fence-plastic', name: 'Plastic fence', cat: 'Garden', w: 200, h: 10, height: 120, fill: '#f4f4f0',
      draw: (w, h) => {
        const n = Math.max(1, Math.round(w / 180));
        let g = rect(0, h * 0.35, w, h * 0.3, 'b');
        for (let x = 12; x < w - 8; x += 15) g += rect(+x.toFixed(1), h * 0.2, 9, h * 0.6, 'b');
        for (let i = 0; i <= n; i++) { const x = Math.min(w - h, Math.max(0, (w * i) / n - h / 2)); g += rect(+x.toFixed(1), 0, h, h, 'b', 'stroke-width="1.6"'); }
        return g;
      } },
    { id: 'hedge', name: 'Hedge', cat: 'Garden', w: 200, h: 60, fill: '#d9efc9', height: 160,
      svg: path(`M0 30${range(0, 180, 20).map((x) => `Q${x + 10} ${x % 40 ? -6 : 0} ${x + 20} 4`).join('')}Q216 30 200 56${range(20, 200, 20).reverse().map((x) => `Q${x - 10} ${x % 40 ? 66 : 60} ${x - 20} 56`).join('')}Q-16 30 0 30Z`, 'b') +
        range(20, 180, 40).map((x) => circ(x, 30, 9) + circ(x + 20, 26, 7)).join('') },
    { id: 'gate', name: 'Garden gate', cat: 'Garden', w: 100, h: 100, height: 130,
      svg: rect(0, 92, 6, 8, 'k') + rect(94, 92, 6, 8, 'k') + rect(4, 2, 4, 90) + path('M8 2A92 92 0 0 1 96 94', '', DASH) },
    { id: 'tree', name: 'Tree', cat: 'Garden', w: 300, h: 300, fill: '#d9efc9',
      svg: path(scallop(150, 150, 140, 12), 'b') + range(0, 330, 30).map((a) => {
          const r = (a * Math.PI) / 180;
          return line(150 + 15 * Math.cos(r), 150 + 15 * Math.sin(r), (150 + 95 * Math.cos(r)).toFixed(1), (150 + 95 * Math.sin(r)).toFixed(1));
        }).join('') + circ(150, 150, 14, 'k') },
    { id: 'tree-conifer', name: 'Conifer', cat: 'Garden', w: 200, h: 200, fill: '#cfe8c4',
      svg: path(star(100, 100, 98, 78, 16), 'b') + range(0, 337.5, 22.5).map((a) => {
          const r = (a * Math.PI) / 180;
          return line(100, 100, (100 + 92 * Math.cos(r)).toFixed(1), (100 + 92 * Math.sin(r)).toFixed(1));
        }).join('') + circ(100, 100, 8, 'k') },
    { id: 'palm', name: 'Palm tree', cat: 'Garden', w: 250, h: 250, fill: '#d9efc9',
      svg: range(0, 300, 60).map((a) => ell(125, 60, 18, 62, 'b', `transform="rotate(${a} 125 125)"`) + line(125, 125, 125, 10, `transform="rotate(${a} 125 125)"`)).join('') + circ(125, 125, 12, 'k') },
    { id: 'bush', name: 'Bush', cat: 'Garden', w: 100, h: 100, fill: '#d9efc9',
      svg: path(scallop(50, 50, 44, 9, 0.18), 'b') + circ(40, 44, 10) + circ(60, 58, 8) },
    { id: 'flowerbed', name: 'Flower bed', cat: 'Garden', w: 200, h: 80, fill: '#f1e4d4',
      svg: rect(0, 0, 200, 80, 'b', 'rx="12"') + [[25, 22], [60, 50], [95, 25], [130, 55], [165, 28], [45, 62], [115, 40], [180, 60], [80, 12]]
        .map(([x, y]) => range(0, 288, 72).map((a) => circ((x + 6 * Math.cos((a * Math.PI) / 180)).toFixed(1), (y + 6 * Math.sin((a * Math.PI) / 180)).toFixed(1), 3.5)).join('') + circ(x, y, 2, 'k')).join('') },
    { id: 'planter', name: 'Planter box', cat: 'Garden', w: 120, h: 40,
      svg: rect(0, 0, 120, 40) + rect(5, 5, 110, 30) + range(18, 102, 21).map((x) => circ(x, 20, 9) + circ(x + 6, 14, 5)).join('') },
    { ...tableIcon('garden-table', 'Patio table, 4 chairs', 180, 180, { x: 45, y: 45, w: 90, h: 90, round: true },
      [...sides([90], 20, 160), [20, 90, -90], [160, 90, 90]]), cat: 'Garden' },
    { id: 'bench', name: 'Garden bench', cat: 'Garden', w: 150, h: 60,
      svg: rect(0, 0, 150, 60) + rect(0, 0, 150, 12, 'b') + range(22, 52, 10).map((y) => line(4, y, 146, y)).join('') + rect(0, 0, 6, 60, 'k') + rect(144, 0, 6, 60, 'k') },
    { id: 'lounger', name: 'Sun lounger', cat: 'Garden', w: 70, h: 190, fill: '#fef3c7',
      svg: rect(0, 0, 70, 190, 'b', 'rx="6"') + rect(5, 5, 60, 60, 'b', 'rx="5"') + range(80, 180, 10).map((y) => line(5, y, 65, y)).join('') + line(5, 70, 65, 70) },
    { id: 'parasol', name: 'Parasol', cat: 'Garden', w: 250, h: 250, fill: '#f3e2c0',
      svg: path(star(125, 125, 124, 116, 8), 'b') + range(0, 315, 45).map((a) => {
          const r = (a * Math.PI) / 180;
          return line(125, 125, (125 + 120 * Math.cos(r)).toFixed(1), (125 + 120 * Math.sin(r)).toFixed(1));
        }).join('') + circ(125, 125, 6, 'k') },
    { id: 'bbq', name: 'Barbecue', cat: 'Garden', w: 70, h: 70,
      svg: circ(35, 35, 33) + circ(35, 35, 26) + range(17, 53, 6).map((y) => line(14, y, 56, y)).join('') },
    { id: 'slide', name: "Children's slide", cat: 'Garden', w: 60, h: 320, fill: '#fde68a',
      svg: rect(0, 0, 60, 60) + range(12, 48, 12).map((y) => line(0, y, 60, y)).join('') + rect(0, 60, 60, 50, 'b') +
        path('M8 110V300Q8 320 30 320Q52 320 52 300V110Z', 'b') + line(30, 118, 30, 300, DASH) },
    { id: 'swing', name: 'Swing set', cat: 'Garden', w: 320, h: 160,
      svg: rect(0, 76, 320, 8, 'k') + line(8, 80, 0, 8) + line(8, 80, 0, 152) + line(312, 80, 320, 8) + line(312, 80, 320, 152) +
        rect(70, 70, 60, 20, 'b', 'rx="3"') + rect(190, 70, 60, 20, 'b', 'rx="3"') + path('M80 90Q100 130 120 90', '', DASH) + path('M200 90Q220 130 240 90', '', DASH) },
    { id: 'sandbox', name: 'Sandbox', cat: 'Garden', w: 200, h: 200, fill: '#f5e6b8',
      svg: rect(0, 0, 200, 200) + rect(12, 12, 176, 176, 'b') + [[50, 60], [120, 40], [90, 110], [150, 140], [60, 150], [140, 90], [30, 110]].map(([x, y]) => circ(x, y, 1.6, 'k')).join('') },
    { id: 'trampoline', name: 'Trampoline', cat: 'Garden', w: 300, h: 300,
      svg: circ(150, 150, 148) + circ(150, 150, 122, 'b') + range(0, 345, 15).map((a) => {
          const r = (a * Math.PI) / 180;
          return line((150 + 122 * Math.cos(r)).toFixed(1), (150 + 122 * Math.sin(r)).toFixed(1), (150 + 146 * Math.cos(r)).toFixed(1), (150 + 146 * Math.sin(r)).toFixed(1));
        }).join('') },
    // swimming pool: the rectangle is the water; stone coping (30 cm) round it; ladder on the right, steps on the left
    /* sewage hole (pump sump): a rectangular concrete pit sunk below the basement floor — concrete walls (pitT) and base
       slab, a submersible pump, and the discharge pipe that leaves through the wall on the right (+x) towards the
       street sewer. Its depth below the floor is it.pitDepth. */
    { id: 'sewage-pit', name: 'Sewage hole (pump sump)', cat: 'Walls & Structure', w: 110, h: 110, fill: '#bdbab3',
      draw: (w, h, p) => {
        const t = Math.max(5, Math.min(p.pitT || 15, w / 3, h / 3)), sw = 'stroke="currentColor"';
        const cover = p.pitCover || 'grate';
        let g = `<rect width="${w}" height="${h}" fill="var(--fill)" ${sw} stroke-width="1.6"/>` +
          `<rect x="${t}" y="${t}" width="${w - 2 * t}" height="${h - 2 * t}" fill="#f4f3f0" ${sw} stroke-width="1.2"/>`;
        // concrete hatch in the walls
        const band = [[0, 0, w, t], [0, h - t, w, t], [0, t, t, h - 2 * t], [w - t, t, t, h - 2 * t]];
        for (const [x, y, bw, bh] of band) for (let k = 4; k < bw + bh; k += 8) {
          const x1 = x + Math.min(k, bw), y1 = y + Math.max(0, k - bw), x2 = x + Math.max(0, k - bh), y2 = y + Math.min(k, bh);
          g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-opacity=".3" stroke-width=".8"/>`;
        }
        // pump in the far-left corner, pipe running right through the wall and out (to the sewer)
        const r = Math.min(14, (w - 2 * t) / 5, (h - 2 * t) / 4), px = t + r + 6, py = h / 2;
        g += `<circle cx="${px}" cy="${py}" r="${r}" fill="#fff" ${sw} stroke-width="1.4"/><text x="${px}" y="${py + 4}" font-size="${Math.max(7, r * 0.9)}" text-anchor="middle" fill="currentColor" font-family="system-ui, sans-serif" font-weight="bold">P</text>`;
        g += `<path d="M${px + r} ${py}H${w + 18}" fill="none" stroke="#c2410c" stroke-width="4" stroke-linecap="round"/>` +
          `<path d="M${w + 10} ${py - 6}L${w + 20} ${py}L${w + 10} ${py + 6}" fill="none" stroke="#c2410c" stroke-width="2"/>`;
        if (cover === 'grate') for (let x = t + 8; x < w - t; x += 8) g += `<line x1="${x}" y1="${t}" x2="${x}" y2="${h - t}" stroke="currentColor" stroke-opacity=".35" stroke-width=".8"/>`;
        if (cover === 'plate') g += `<line x1="${t}" y1="${t}" x2="${w - t}" y2="${h - t}" ${sw} stroke-width=".8" stroke-opacity=".5"/><line x1="${w - t}" y1="${t}" x2="${t}" y2="${h - t}" ${sw} stroke-width=".8" stroke-opacity=".5"/>`;
        return g + text(w / 2, h - t - 5, 'SUMP', Math.max(8, Math.min(13, w / 9)), 'fill-opacity=".65" font-weight="bold"');
      } },
    { id: 'pool', name: 'Swimming pool', cat: 'Garden', w: 800, h: 400, fill: '#7cc6e8',
      draw: (w, h, p) => {
        const c = 30, sw = 'stroke="currentColor"';
        let g = `<rect x="${-c}" y="${-c}" width="${w + 2 * c}" height="${h + 2 * c}" fill="#e9e4d8" ${sw} stroke-width="1.2"/>` +
          `<rect width="${w}" height="${h}" fill="var(--fill)" ${sw} stroke-width="1.6"/>`;
        // ripples
        for (let y = h * 0.25; y < h * 0.9; y += h * 0.25) g += `<path d="M${w * 0.25} ${y}q${w * 0.05} -8 ${w * 0.1} 0t${w * 0.1} 0t${w * 0.1} 0" fill="none" stroke="#2f7fae" stroke-opacity=".55" stroke-width="1.4"/>`;
        // entry steps at the left end: three treads
        if (p.poolSteps !== false) for (let k = 1; k <= 3; k++) g += `<line x1="${k * 30}" y1="0" x2="${k * 30}" y2="${Math.min(h, 160)}" ${sw} stroke-width="1"/>`;
        // ladder at the right end
        if (p.poolLadder !== false) g += `<rect x="${w - 14}" y="${h / 2 - 25}" width="18" height="50" fill="none" ${sw} stroke-width="1.5"/><line x1="${w - 14}" y1="${h / 2 - 8}" x2="${w + 4}" y2="${h / 2 - 8}" ${sw}/><line x1="${w - 14}" y1="${h / 2 + 8}" x2="${w + 4}" y2="${h / 2 + 8}" ${sw}/>`;
        return g + text(w / 2, h / 2 + 5, `POOL ${(w / 100).toFixed(1)} × ${(h / 100).toFixed(1)} m`, Math.max(10, Math.min(18, w / 24)), 'fill-opacity=".6" font-weight="bold"');
      } },
    { id: 'pond', name: 'Pond', cat: 'Garden', w: 250, h: 180, fill: '#bfe3f7',
      svg: path('M30 40C70 -5 180 5 225 50C260 95 215 170 140 172C60 176 -10 140 8 95C14 70 18 55 30 40Z', 'b') +
        path('M60 80q25 -10 50 0t50 0') + path('M80 115q25 -10 50 0t50 0') },
    { id: 'shed', name: 'Garden shed', cat: 'Garden', w: 250, h: 200,
      svg: rect(0, 0, 250, 200) + line(0, 100, 250, 100) + range(20, 230, 20).map((x) => line(x, 0, x, 100) + line(x, 100, x, 200)).join('') + rect(100, 194, 50, 6, 'k') },
    // car seen from above, front at the top (y = 0): body, bonnet and boot lines, windscreen and rear window, mirrors, wheels
    { id: 'car', name: 'Car', cat: 'Vehicles', w: 180, h: 450, fill: '#9fb4c8',
      svg: rect(4, 70, 14, 64, 'k', 'rx="5"') + rect(162, 70, 14, 64, 'k', 'rx="5"') + rect(4, 330, 14, 64, 'k', 'rx="5"') + rect(162, 330, 14, 64, 'k', 'rx="5"') +
        path('M30 8Q90 -4 150 8Q172 14 172 60V400Q172 438 150 444Q90 454 30 444Q8 438 8 400V60Q8 14 30 8Z', 'b') +
        path('M36 150Q90 128 144 150L134 196Q90 186 46 196Z', '', 'fill="#d6e6f2"') +
        rect(46, 196, 88, 140, 'b', 'rx="6"') +
        path('M46 336Q90 346 134 336L142 372Q90 388 38 372Z', '', 'fill="#d6e6f2"') +
        path('M40 60Q90 48 140 60', '', 'stroke-opacity=".5"') + line(90, 20, 90, 140, 'stroke-opacity=".35"') +
        path('M0 172L8 160V186Z', 'k') + path('M180 172L172 160V186Z', 'k') +
        rect(22, 12, 26, 8, '', 'fill="#fff7cc" rx="3"') + rect(132, 12, 26, 8, '', 'fill="#fff7cc" rx="3"') +
        rect(22, 436, 26, 7, '', 'fill="#e05252" rx="3"') + rect(132, 436, 26, 7, '', 'fill="#e05252" rx="3"') },
    { id: 'stepping-stones', name: 'Stepping stones', cat: 'Garden', w: 60, h: 300,
      svg: [[30, 25], [26, 85], [32, 145], [28, 205], [31, 268]].map(([x, y], i) => ell(x, y, 26 - (i % 2) * 3, 20 + (i % 2) * 2)).join('') },
  ];

  /* ───────────── Floor barriers ─────────────
   * Shapes that stop the automatic floor fill. Walls block with their full body; doors and windows block
   * only along the wall line they sit in, so a floor still runs under a door's swing.
   * Arrays are [x, y, w, h] rects (or {pts}) in icon units; functions return rects at real size.
   */
  const wallRects = (rects) => (w, h, p) => rects(w, h, thick(w, h, p));
  /* Floor slab on the plan: its outline (auto-fitted ones keep their own, scaled to the current size), dashed edge,
     and a pattern telling the construction — timber: joist lines across the short side; concrete: stipple. */
  function slabDraw(w, h, p) {
    const id = `slabpat-${p.patId || p.id || 'x'}`, t = p.slabT || (p.slabType === 'concrete' ? 30 : 30);
    const concrete = p.slabType === 'concrete';
    const kx = w / (p.pw0 || w), ky = h / (p.ph0 || h);
    const d = p.poly && p.poly.length > 2 ? 'M' + p.poly.map(([x, y]) => `${+(x * kx).toFixed(1)} ${+(y * ky).toFixed(1)}`).join('L') + 'Z' : `M0 0H${w}V${h}H0Z`;
    const joistsAcross = w <= h; // joists span the short side
    const pat = concrete
      ? `<pattern id="${id}" patternUnits="userSpaceOnUse" width="24" height="24">` +
        `<circle cx="4" cy="5" r="1.3" fill="currentColor" fill-opacity=".35"/><circle cx="15" cy="9" r="0.9" fill="currentColor" fill-opacity=".35"/>` +
        `<circle cx="9" cy="18" r="1.1" fill="currentColor" fill-opacity=".35"/><path d="M18 17l2.6 4.2h-5.2z" fill="currentColor" fill-opacity=".3"/>` +
        `<path d="M3 13l2 3.2H1z" fill="currentColor" fill-opacity=".3"/></pattern>`
      : `<pattern id="${id}" patternUnits="userSpaceOnUse" width="40" height="40">` +
        (joistsAcross ? `<line x1="0" y1="20" x2="40" y2="20" stroke="currentColor" stroke-width="1.2" stroke-opacity=".38"/>`
          : `<line x1="20" y1="0" x2="20" y2="40" stroke="currentColor" stroke-width="1.2" stroke-opacity=".38"/>`) + `</pattern>`;
    return `<defs>${pat}</defs>` + path(d, 'b') + path(d, '', `fill="url(#${id})" stroke="none"`) +
      path(d, '', 'fill="none" stroke-dasharray="14 6"') +
      text(w / 2, h / 2 + 5, `${concrete ? 'CONCRETE' : 'TIMBER'} SLAB  t = ${(t / 100).toFixed(2)} m${p.slabAt ? `  ·  at ${p.slabAt}` : ''}`, Math.max(10, Math.min(16, w / 20)), 'fill-opacity=".55" font-weight="bold"');
  }

  const BARRIERS = {
    'wall-h': (w, h) => [[0, 0, w, h]],
    'wall-v': (w, h) => [[0, 0, w, h]],
    column: (w, h) => [[0, 0, w, h]],
    'column-round': (w, h) => [[0, 0, w, h]],
    pillar: [[0, 0, 40, 40]],
    'corner-tl': wallRects((w, h, t) => [[0, 0, w, t], [0, 0, t, h]]),
    pool: (w, h) => [[-30, -30, w + 60, h + 60]],
    'corner-tr': wallRects((w, h, t) => [[0, 0, w, t], [w - t, 0, t, h]]),
    'corner-br': wallRects((w, h, t) => [[0, h - t, w, t], [w - t, 0, t, h]]),
    'corner-bl': wallRects((w, h, t) => [[0, h - t, w, t], [0, 0, t, h]]),
    'wall-u': wallRects((w, h, t) => [[0, 0, w, t], [0, 0, t, h], [w - t, 0, t, h]]),
    room: wallRects((w, h, t) => [[0, 0, w, t], [0, h - t, w, t], [0, 0, t, h], [w - t, 0, t, h]]),
    window: [[0, 0, 100, 15]],
    'window-sill': [[0, 0, 100, 15]],
    'window-casement': [[0, 45, 100, 15]],
    'window-basement': [[0, 0, 80, 15]],
    'window-arched': [[0, 0, 100, 15]],
    railing: [[0, 0, 100, 4]],
    'bay-window': [{ pts: [[0, 0], [25, 0], [40, 40], [100, 40], [115, 0], [140, 0], [140, 6], [119, 6], [105, 34], [35, 34], [21, 6], [0, 6]] }],
    'bay-window-round': [{ pts: [[0, 0], [20, 0], [35, 25], [55, 40], [70, 43], [85, 40], [105, 25], [120, 0], [140, 0],
      [140, 6], [115, 6], [102, 22], [85, 33], [70, 36], [55, 33], [38, 22], [25, 6], [0, 6]] }],
    door: [[0, 86, 90, 4]],
    'door-left': [[0, 86, 90, 4]],
    'door-arched': [[0, 86, 90, 4]],
    'door-double': [[0, 76, 160, 4]],
    'door-double-arched': [[0, 76, 160, 4]],
    'door-double-uneven': [[0, 76, 120, 4]],
    'door-double-acting': [[0, 48, 100, 4]],
    'door-swing': [[0, 88, 90, 4]],
    'door-revolving': [[0, 46, 100, 8]],
    'door-sliding': [[0, 0, 100, 15]],
    'door-pocket': [[0, 0, 140, 15]],
    'door-bifold': [[0, 36, 100, 4]],
    'door-accordion': [[0, 0, 100, 20]],
    opening: [[0, 0, 100, 15]],
    'garage-door': [[0, 0, 240, 20]],
    // garden boundaries close off outdoor areas for "Fill garden"
    fence: [[0, 0, 200, 10]],
    'fence-metal': [[0, 0, 200, 8]],
    'fence-concrete': [[0, 0, 200, 15]],
    'fence-plastic': [[0, 0, 200, 10]],
    'fence-brick': [[0, 0, 250, 36]],
    'fence-stone': [[0, 0, 250, 40]],
    hedge: [[0, 0, 200, 60]],
    gate: [[0, 92, 100, 8]],
  };
  ICONS.forEach((ic) => { if (BARRIERS[ic.id]) ic.barrier = BARRIERS[ic.id]; });

  /* ───────────── Openings: how doors/windows sit in a wall ─────────────
   * y       the line (icon units) that lies in the wall
   * mode    'center' = on the wall centreline, 'face' = on the wall face the door swings from
   * dir     for 'face': which way (local ±y) the door swings
   * fit     the icon's thickness is the wall: it takes the wall's thickness when aligned
   * profile what fills the wall around it in 3D (window = sill + glass + lintel, door = lintel)
   */
  const OPENINGS = {
    window: { y: 7.5, mode: 'center', fit: true, profile: 'window' },
    'window-sill': { y: 7.5, mode: 'center', fit: true, profile: 'window' },
    'window-casement': { y: 52.5, mode: 'center', profile: 'window' },
    'window-basement': { y: 7.5, mode: 'center', fit: true, profile: 'window', top: true },
    'window-arched': { y: 7.5, mode: 'center', fit: true, profile: 'window', arch: true },
    door: { y: 90, mode: 'face', dir: -1, profile: 'door' },
    'door-left': { y: 90, mode: 'face', dir: -1, profile: 'door' },
    'door-arched': { y: 90, mode: 'face', dir: -1, profile: 'door', arch: true },
    'door-double': { y: 80, mode: 'face', dir: -1, profile: 'door' },
    'door-double-arched': { y: 80, mode: 'face', dir: -1, profile: 'door', arch: true },
    'door-double-uneven': { y: 80, mode: 'face', dir: -1, profile: 'door' },
    'door-bifold': { y: 40, mode: 'face', dir: -1, profile: 'door' },
    'door-double-acting': { y: 50, mode: 'center', profile: 'door' },
    'door-swing': { y: 90, mode: 'center', profile: 'door' },
    'door-revolving': { y: 50, mode: 'center', profile: 'revolving' },
    'door-sliding': { y: 7.5, mode: 'center', fit: true, profile: 'door' },
    'door-pocket': { y: 7.5, mode: 'center', fit: true, profile: 'door' },
    'door-accordion': { y: 10, mode: 'center', fit: true, profile: 'door' },
    opening: { y: 7.5, mode: 'center', fit: true, profile: 'door' },
    'garage-door': { y: 10, mode: 'center', fit: true, profile: 'garage' },
  };
  ICONS.forEach((ic) => { if (OPENINGS[ic.id]) ic.opening = OPENINGS[ic.id]; });

  /* ───────────── Floor materials (SVG patterns, sizes in cm) ───────────── */
  const shade = (hex, k) => {
    const n = parseInt(String(hex).slice(1), 16) || 0;
    const f = (v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  };
  const st = (c, w = 1, o = 1) => `fill="none" stroke="${c}" stroke-width="${w}"${o < 1 ? ` stroke-opacity="${o}"` : ''}`;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const speckles = Array.from({ length: 28 }, () => [rnd() * 50, rnd() * 50, 0.4 + rnd() * 0.9]);
  const grains = Array.from({ length: 30 }, () => [rnd() * 50, rnd() * 50, 0.5 + rnd() * 0.9]); // positions for gravel, sand …

  const MATERIALS = {
    solid: { name: 'Solid colour', color: '#efe9df' },
    wood: { name: 'Wood planks', color: '#c8a27a', size: [120, 60],
      pattern: (d, l) => `<path d="M0 0H120M0 15H120M0 30H120M0 45H120M0 0V15M60 15V30M30 30V45M90 45V60" ${st(d)}/>` +
        `<path d="M10 7H50M70 22H110M40 38H80M5 52H45M75 9H105M95 54H115" ${st(l, 1, 0.8)}/>` },
    parquet: { name: 'Parquet', color: '#b88a5c', size: [40, 40],
      pattern: (d) => `<path d="M0 0H40M0 20H40M0 0V40M20 0V40M0 6.7H20M0 13.3H20M26.7 0V20M33.3 0V20M6.7 20V40M13.3 20V40M20 26.7H40M20 33.3H40" ${st(d, 0.8)}/>` },
    tile: { name: 'Ceramic tile 30×30', color: '#e8e4dc', size: [30, 30],
      pattern: (d) => `<path d="M0 0H30M0 0V30" ${st(d, 1.2)}/>` },
    'tile-large': { name: 'Large tile 60×60', color: '#d6d1c7', size: [60, 60],
      pattern: (d, l) => `<path d="M0 0H60M0 0V60" ${st(d, 1.2)}/><path d="M8 52L52 8" ${st(l, 1, 0.5)}/>` },
    checker: { name: 'Checkerboard', color: '#f2f0eb', size: [60, 60],
      pattern: (d) => `<rect width="30" height="30" fill="${shade(d, -0.55)}"/><rect x="30" y="30" width="30" height="30" fill="${shade(d, -0.55)}"/>` },
    marble: { name: 'Marble', color: '#f1efea', size: [120, 120],
      pattern: (d) => `<path d="M0 30C30 20 50 60 80 50S110 70 120 60M20 120C40 90 70 100 90 80S115 85 120 90M60 0C65 15 55 25 70 40" ${st(d, 1, 0.45)}/>` +
        `<path d="M0 0H120M0 0V120M60 0V120M0 60H120" ${st(d, 0.8, 0.5)}/>` },
    carpet: { name: 'Carpet', color: '#8796ab', size: [8, 8],
      pattern: (d) => `<circle cx="2" cy="2" r="0.9" fill="${d}" fill-opacity=".35"/><circle cx="6" cy="6" r="0.9" fill="${d}" fill-opacity=".35"/>` },
    concrete: { name: 'Concrete', color: '#bdbab4', size: [50, 50],
      pattern: (d, l) => speckles.map(([x, y, r], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${i % 3 ? d : l}" fill-opacity=".45"/>`).join('') },
    stone: { name: 'Stone slabs', color: '#b1aa9e', size: [100, 100],
      pattern: (d) => `<path d="M0 0H100M0 0V100M0 35L30 30L45 0M30 30L40 65L0 70M45 0L60 40L100 45M40 65L60 40M40 65L55 100M60 40L80 75L100 70M80 75L75 100" ${st(d, 1.5)}/>` },
    grass: { name: 'Grass / lawn', color: '#7fb069', size: [16, 16],
      pattern: (d) => `<path d="M2 14l1-4M7 9l-1-4M12 15l1-5M10 5l1-3M4 4l-1-3M14 8l-1-3" ${st(d, 1, 0.6)}/>` },
    // garden surfaces
    'brick-pavers': { name: 'Brick pavers', color: '#b5523b', size: [40, 20],
      pattern: (d) => `<path d="M0 0H40M0 10H40M0 20H40M0 0V10M20 0V10M10 10V20M30 10V20" ${st(d, 1.2)}/>` },
    herringbone: { name: 'Herringbone bricks', color: '#a8563d', size: [40, 40],
      pattern: (d) => `<path d="M0 10L10 0M0 30L30 0M10 40L40 10M30 40L40 30M0 10L30 40M10 0L40 30M0 30L10 40M30 0L40 10" ${st(d, 1.2)}/>` },
    cobblestone: { name: 'Cobblestone', color: '#8f8a82', size: [30, 30],
      pattern: (d, l) => [[1, 1], [16, 1], [8.5, 16], [-6.5, 16], [23.5, 16]].map(([x, y], i) =>
        `<rect x="${x}" y="${y}" width="13" height="13" rx="4" fill="${i % 2 ? l : shade(l, -0.12)}" fill-opacity=".55" ${st(d, 1.1)}/>`).join('') },
    gravel: { name: 'Gravel', color: '#b5ad9f', size: [20, 20],
      pattern: (d, l) => grains.map(([x, y, r], i) => `<circle cx="${(x * 0.4).toFixed(1)}" cy="${(y * 0.4).toFixed(1)}" r="${(r * 1.1).toFixed(2)}" fill="${i % 2 ? d : l}" fill-opacity=".7"/>`).join('') },
    decking: { name: 'Wood decking', color: '#a57a52', size: [60, 15],
      pattern: (d, l) => `<path d="M0 0H60M0 15H60M30 0V15" ${st(d, 1.5)}/><path d="M4 5H26M34 9H56M8 11H22" ${st(l, 0.8, 0.7)}/>` },
    mulch: { name: 'Bark mulch', color: '#6b4630', size: [24, 24],
      pattern: (d, l) => grains.slice(0, 18).map(([x, y], i) => `<path d="M${(x * 0.48).toFixed(1)} ${(y * 0.48).toFixed(1)}l${i % 3 ? 3 : -2} ${i % 2 ? 1.5 : -1}" ${st(i % 2 ? d : l, 1.4, 0.8)}/>`).join('') },
    sand: { name: 'Sand', color: '#e3cf9c', size: [20, 20],
      pattern: (d) => grains.slice(0, 14).map(([x, y]) => `<circle cx="${(x * 0.4).toFixed(1)}" cy="${(y * 0.4).toFixed(1)}" r="0.45" fill="${d}" fill-opacity=".5"/>`).join('') },
    soil: { name: 'Soil', color: '#6a4b35', size: [20, 20],
      pattern: (d, l) => grains.slice(0, 20).map(([x, y, r], i) => `<circle cx="${(x * 0.4).toFixed(1)}" cy="${(y * 0.4).toFixed(1)}" r="${(r * 0.8).toFixed(2)}" fill="${i % 2 ? d : l}" fill-opacity=".55"/>`).join('') },
  };
  // which materials each kind of floor offers (indoor floors vs. garden areas)
  const INDOOR_MATERIALS = ['solid', 'wood', 'parquet', 'tile', 'tile-large', 'checker', 'marble', 'carpet', 'concrete', 'stone', 'grass'];
  const GARDEN_MATERIALS = ['grass', 'brick-pavers', 'herringbone', 'cobblestone', 'concrete', 'stone', 'tile-large', 'gravel', 'decking', 'mulch', 'sand', 'soil'];

  // The floor object created by the "Fill floor" tool. Its outline is stored on the item:
  // rings (polygons in cm, relative to the item's top-left) at the original size w0 × h0.
  ICONS.push({
    id: 'floor', name: 'Floor', cat: 'Floors', w: 100, h: 100, hidden: true, shapeHit: true,
    draw: (w, h, p) => {
      const m = MATERIALS[p.material] || MATERIALS.solid;
      const c = p.fill || m.color;
      const sx = w / (p.w0 || w), sy = h / (p.h0 || h);
      const rings = p.rings || [[[0, 0], [w, 0], [w, h], [0, h]]];
      const d = rings.map((r) => 'M' + r.map(([x, y]) => `${+(x * sx).toFixed(1)} ${+(y * sy).toFixed(1)}`).join('L') + 'Z').join('');
      let fill = c, defs = '';
      if (m.pattern) {
        const id = `fpfloor-${p.patId || p.id || 'x'}`;
        const [pw, ph] = m.size;
        defs = `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="${pw}" height="${ph}">` +
          `<rect width="${pw}" height="${ph}" fill="${c}" stroke="none"/>${m.pattern(shade(c, -0.3), shade(c, 0.3))}</pattern></defs>`;
        fill = `url(#${id})`;
      }
      // level marker (finished floor level above ground ±0) for raised or sunken floors
      let mark = '';
      if (p.elev) {
        const xs = rings[0].map(([x]) => x * sx), ys = rings[0].map(([, y]) => y * sy);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const txt = `FFL ${p.elev > 0 ? '+' : '−'}${(Math.abs(p.elev) / 100).toFixed(2)}`;
        mark = `<g class="ffl"><rect x="${cx - 38}" y="${cy - 11}" width="76" height="22" rx="4" fill="#ffffff" fill-opacity=".85" stroke="currentColor" stroke-width="1"/>` +
          `<path d="M${cx - 30} ${cy + 5}l5 -9l5 9z" class="k" stroke="none"/>` + text(cx + 6, cy + 5, txt, 12) + `</g>`;
      }
      return `${defs}<path d="${d}" fill="${fill}" fill-rule="evenodd"/>${mark}`;
    },
  });

  window.FP_STAIRS = { layout: stairLayout, stepsOf, spiralAngles, spiralTurn, defaults: STAIR_STEPS };
  window.FP_MATERIALS = MATERIALS;
  window.FP_MATERIAL_SETS = { indoor: INDOOR_MATERIALS, garden: GARDEN_MATERIALS };
  window.FP_ROOFS = { styles: ROOF_STYLES, rise: roofRise, lShape: lRoofShape, grow: growOrtho };
  window.FP_ICONS = ICONS;
  window.FP_ESC = esc;
})();
