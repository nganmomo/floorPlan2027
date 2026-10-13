/*
 * House Building Wizard (top bar → Wizard)
 * Asks a few questions — size, storeys, rooms, wall colours, roof, floor finishes, extras — and designs a house from
 * the answers with fixed layout rules (no AI needed: every answer is a choice the rules turn into walls and rooms).
 * The house is then built step by step with the demo player (js/app.js "demo houses"), in the format of js/demo.js;
 * "Change answers" there comes back here with every answer kept, and any step can be changed at any time.
 *
 * Layout rules (cm, walls by their centrelines; outer walls 20 cm, partitions 10 cm; the front — entrance — is the
 * bottom edge of the plan):
 *   one storey   back row: living room (+ kitchen, or one open-plan room); front row: bedrooms, the entrance hall and
 *                the bathrooms side by side, each with a door into the back row
 *   2–3 storeys  a 3.6 m stair hall through the middle of every storey (U-shaped stairs on its right, a walkway on its
 *                left); ground floor: living room on the left, kitchen and shower room on the right; upper storeys:
 *                four rooms (bedrooms, bathrooms, a study) round the landing, a stairwell over the stairs below
 */
(function () {
  'use strict';
  const FP = window.FP, WM = window.FP_WALLMATS, MATS = window.FP_MATERIALS, esc = window.FP_ESC;
  if (!FP || !FP.demoBuild) return;
  const $ = (s, r = document) => r.querySelector(s);
  const r10 = (v) => Math.round(v / 10) * 10;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const DEFAULTS = {
    name: 'My house', ground: 'grass',
    w: 12, d: 9, floors: 2, storeyH: 3,
    bedrooms: 3, baths: 2, kitchen: 'separate',
    wallMat: 'plaster', wallColor: '#e4dfd6', inColor: '#f4f1ec',
    roof: 'gable', pitch: 30, roofMat: 'clay-tiles', roofColor: '',
    flLiving: 'wood', flBed: 'carpet', flWet: 'tile',
    balcony: true, linings: false, furniture: true, trees: true, pool: false, car: true,
  };
  let A = { ...DEFAULTS };
  try { const s = JSON.parse(localStorage.getItem('floorplan2027.wizard') || 'null'); if (s) A = { ...DEFAULTS, ...s }; } catch (e) { /* none kept */ }
  const remember = () => { try { localStorage.setItem('floorplan2027.wizard', JSON.stringify(A)); } catch (e) { /* storage unavailable */ } };

  /* ───────────────────────── the design: answers → rooms and building steps ───────────────────────── */
  function design(a) {
    const n = clamp(+a.floors || 1, 1, 3), H = r10(clamp(+a.storeyH || 3, 2.6, 3.6) * 100);
    let W = r10(clamp(+a.w || 12, 6, 20) * 100), D = r10(clamp(+a.d || 9, 6, 15) * 100);
    const notes = [];
    if (n > 1 && W < 1000) { W = 1000; notes.push('Width set to 10 m — a house with stairs needs room for the stair hall in the middle.'); }
    if (n > 1 && D < 700) { D = 700; notes.push('Depth set to 7 m — the stairs need that much room.'); }
    const names = n === 1 ? ['Ground floor'] : n === 2 ? ['Ground floor', 'Upper floor'] : ['Ground floor', 'First floor', 'Second floor'];
    const levels = names.map((name, i) => ({ id: 'L' + i, name, elev: i * H, wallH: H }));
    // per storey: rooms, partitions, doors, windows, things added like from the picker
    const LV = levels.map(() => ({ rooms: [], walls: [], doors: [], windows: [], adds: [] }));
    const room = (i, name, kind, x, y, w, h) => { const r = { lvl: i, name, kind, x, y, w, h, cx: x + w / 2, cy: y + h / 2 }; LV[i].rooms.push(r); return r; };
    const win = (i, x, y, r, w) => LV[i].windows.push(['window', r10(x), r10(y), r, { w }]);
    let beds = 0, baths = 0, frontDoorX = W / 2, stairs = null;

    if (n === 1) {
      const a1 = r10(D * 0.55); // depth of the back row
      if (a.kitchen === 'separate') {
        const kx = r10(W * 0.62);
        room(0, 'Living room', 'living', 0, 0, kx, a1);
        room(0, 'Kitchen', 'kitchen', kx, 0, W - kx, a1);
        LV[0].walls.push([kx, 0, kx, a1]);
        LV[0].doors.push(['door', kx, r10(a1 * 0.7), 90]);
        win(0, kx / 3, 0, 0, 160); win(0, (kx * 2) / 3, 0, 0, 160); win(0, (kx + W) / 2, 0, 0, 140); win(0, W, a1 / 2, 90, 120);
      } else {
        room(0, 'Living room & kitchen', 'living-kitchen', 0, 0, W, a1);
        win(0, W / 4, 0, 0, 160); win(0, W / 2, 0, 0, 160); win(0, (W * 3) / 4, 0, 0, 140); win(0, W, a1 / 2, 90, 120);
      }
      win(0, 0, a1 / 2, 90, 160);
      LV[0].walls.push([0, a1, W, a1]);
      // the front row: bedrooms, the hall and the bathrooms
      const HALL = 220, BATH = 250, BED = 280;
      let nb = clamp(+a.baths || 1, 1, 2);
      const fit = (b) => Math.floor((W - HALL - b * BATH) / BED);
      let nbed = Math.max(1, Math.min(+a.bedrooms || 1, fit(nb)));
      if (nbed < a.bedrooms && nb > 1) { nb = 1; nbed = Math.max(1, Math.min(+a.bedrooms || 1, fit(1))); }
      const left = Math.ceil(nbed / 2), order = [...Array(left).fill('bed'), 'hall', ...Array(nb).fill('bath'), ...Array(nbed - left).fill('bed')];
      const bedW = r10((W - HALL - nb * BATH) / nbed);
      let x = 0;
      order.forEach((kind, k) => {
        const w = k === order.length - 1 ? W - x : kind === 'bed' ? bedW : kind === 'hall' ? HALL : BATH;
        const leftSide = x + w / 2 < W / 2;
        if (k) LV[0].walls.push([x, a1, x, D]);
        if (kind === 'hall') {
          room(0, 'Entrance hall', 'hall', x, a1, w, D - a1);
          frontDoorX = x + w / 2;
          LV[0].doors.push(['door', r10(x + w / 2), D, 180], ['door', r10(x + w / 2), a1, 0]);
        } else {
          const r = kind === 'bed' ? room(0, beds++ ? `Bedroom ${beds}` : 'Main bedroom', 'bed', x, a1, w, D - a1) : room(0, baths++ ? `Bathroom ${baths}` : 'Bathroom', 'bath', x, a1, w, D - a1);
          LV[0].doors.push(['door', r10(leftSide ? x + w - 60 : x + 60), a1, 0]);
          win(0, r.cx, D, 0, kind === 'bed' ? 120 : 60);
          if (k === 0) win(0, 0, r.cy, 90, kind === 'bed' ? 120 : 60);
          if (k === order.length - 1) win(0, W, r.cy, 90, kind === 'bed' ? 120 : 60);
        }
        x += w;
      });
    } else {
      const HW = 360, h0 = r10((W - HW) / 2), h1 = h0 + HW, mid = r10(D / 2);
      const yN = r10(clamp((mid - 190) / 2, 60, mid - 240)), yS = D - yN; // doors on the right of the hall: clear of the stairs
      stairs = [h1 - 100, mid];
      frontDoorX = h0 + 85;
      // ground floor
      room(0, 'Living room', 'living', 0, 0, h0, D);
      room(0, 'Hall & stairs', 'hall', h0, 0, HW, D);
      room(0, 'Kitchen', 'kitchen', h1, 0, W - h1, mid);
      const wc = room(0, +a.baths > 1 ? 'Shower room' : 'Bathroom', 'bath', h1, mid, W - h1, D - mid); baths++;
      void wc;
      LV[0].walls.push([h0, 0, h0, D], [h1, 0, h1, D], [h1, mid, W, mid]);
      LV[0].doors.push(['door', r10(frontDoorX), D, 180], ['door', h0, mid, 90], ['door', h1, yN, 90], ['door', h1, yS, 90], ['door-sliding', r10(h0 / 2), 0, 0, { w: Math.min(240, r10(h0 * 0.45)) }]);
      win(0, 0, D / 4, 90, 160); win(0, 0, (D * 3) / 4, 90, 160); win(0, h0 / 2, D, 0, 160);
      win(0, (h1 + W) / 2, 0, 0, 140); win(0, W, mid / 2, 90, 120); win(0, W, (mid + D) / 2, 90, 60); win(0, h0 + 90, 0, 0, 80);
      LV[0].adds.push(['stairs-u', stairs[0], stairs[1]]);
      // upper storeys: four rooms round the landing
      let upBaths = Math.max(0, (+a.baths || 1) - 1), toBed = +a.bedrooms || 1;
      for (let i = 1; i < n; i++) {
        room(i, 'Landing', 'hall', h0, 0, HW, D);
        LV[i].walls.push([h0, 0, h0, D], [h1, 0, h1, D], [0, mid, h0, mid], [h1, mid, W, mid]);
        const slots = { LN: [0, 0, h0, mid, [h0, r10(mid / 2)]], LS: [0, mid, h0, D - mid, [h0, r10((mid + D) / 2)]], RN: [h1, 0, W - h1, mid, [h1, yN]], RS: [h1, mid, W - h1, D - mid, [h1, yS]] };
        const kind = {};
        for (const s of ['RS', 'LS']) if (upBaths > 0) { kind[s] = 'bath'; upBaths--; }
        for (const s of ['LN', 'RN', 'LS', 'RS']) if (!kind[s] && toBed > 0) { kind[s] = 'bed'; toBed--; }
        for (const s of ['LN', 'RN', 'LS', 'RS']) {
          const [x, y, w, h, door] = slots[s], k = kind[s] || 'study';
          const r = room(i, k === 'bed' ? (beds++ ? `Bedroom ${beds}` : 'Main bedroom') : k === 'bath' ? (baths++ ? `Bathroom ${baths}` : 'Bathroom') : 'Study', k, x, y, w, h);
          LV[i].doors.push(['door', door[0], door[1], 90]);
          const front = y > 0, sideX = x === 0 ? 0 : W;
          const balconyHere = a.balcony && i === 1 && s === 'LN';
          if (!(front === false && balconyHere)) win(i, r.cx, front ? D : 0, 0, k === 'bath' ? 60 : 140);
          if (k !== 'bath') win(i, sideX, r.cy, 90, 120);
        }
        win(i, h0 + 90, 0, 0, 80);
        if (i < n - 1) LV[i].adds.push(['stairs-u', stairs[0], stairs[1]]);
        if (a.balcony && i === 1) LV[i].adds.push(['balcony', r10(h0 / 2), -80]);
      }
      if (toBed > 0 || upBaths > 0) notes.push(`${toBed > 0 ? `${toBed} bedroom${toBed === 1 ? '' : 's'}` : ''}${toBed > 0 && upBaths > 0 ? ' and ' : ''}${upBaths > 0 ? `${upBaths} bathroom${upBaths === 1 ? '' : 's'}` : ''} did not fit — add a storey for more rooms.`);
    }
    if (n === 1 && beds < a.bedrooms) notes.push(`${beds} bedroom${beds === 1 ? '' : 's'} fit on one storey ${W / 100} m wide — make the house wider, or give it two storeys, for more.`);
    if (n === 1 && baths < a.baths) notes.push(`${baths} bathroom fits beside the bedrooms — make the house wider for a second one.`);
    const rooms = LV.flatMap((l) => l.rooms);

    /* ── the building steps (ops as in js/demo.js) ── */
    const steps = [], loop = [[0, 0], [W, 0], [W, D], [0, D]];
    const paint = [{ op: 'paint', side: 'out', wmat: a.wallMat, wcol: a.wallColor }, { op: 'paint', side: 'in', wmat: 'plaster', wcol: a.inColor }];
    const floorOf = (r) => (r.kind === 'bath' || r.kind === 'kitchen' ? a.flWet : r.kind === 'bed' ? a.flBed : r.kind === 'hall' ? (r.lvl ? a.flLiving : 'stone') : a.flLiving);
    const nm = (i) => (n === 1 ? '' : `${levels[i].name}: `);
    const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
    steps.push({ title: `${nm(0)}Outer walls`, text: `The ${W / 100} × ${D / 100} m outline is set out and the outer walls go up: 20 cm thick, ${(H / 100).toFixed(2)} m high.`,
      ops: [{ op: 'loop', t: 20, pts: loop }] });
    steps.push({ title: 'Ground slab', text: 'A concrete slab is poured inside the outer walls.', ops: [{ op: 'slab', at: [W / 4, D / 4], kind: 'concrete' }] });
    steps.push({ title: `${nm(0)}Inner walls`, text: `Partitions make the rooms: ${LV[0].rooms.map((r) => lc(r.name)).join(', ')}. The walls get their colours, outside and in.`,
      ops: [{ op: 'walls', t: 10, list: LV[0].walls }, ...paint] });
    steps.push({ title: `${nm(0)}Doors and windows`, text: 'The front door, the inner doors and the windows are set into the walls.',
      ops: [{ op: 'place', list: [...LV[0].doors, ...LV[0].windows] }] });
    if (n > 1) steps.push({ title: 'Stairs', text: 'U-shaped stairs go up in the stair hall; their steps are worked out from the storey height.', ops: [{ op: 'add', list: LV[0].adds }] });
    for (let i = 1; i < n; i++) {
      steps.push({ title: `${levels[i].name}: floor slab`, text: `The ${lc(levels[i].name)} slab is laid on the walls below, with a stairwell and railing over the stairs.`,
        ops: [{ op: 'level', id: levels[i].id }, { op: 'slab', at: [W / 4, D / 4], kind: 'concrete' },
          { op: 'add', list: [['slab-opening', stairs[0], stairs[1], 0, { matchStairs: true, rail: '3' }]] }] });
      steps.push({ title: `${levels[i].name}: walls`, text: `The walls go up: ${LV[i].rooms.map((r) => lc(r.name)).join(', ')}.`,
        ops: [{ op: 'loop', t: 20, pts: loop }, { op: 'walls', t: 10, list: LV[i].walls }, ...paint] });
      steps.push({ title: `${levels[i].name}: doors and windows`, text: `Doors from the landing into every room, and the windows${LV[i].adds.some((x) => x[0] === 'balcony') ? ' — and a balcony with a glass sliding door' : ''}${LV[i].adds.some((x) => x[0] === 'stairs-u') ? '; stairs on up to the next storey' : ''}.`,
        ops: [{ op: 'place', list: [...LV[i].doors, ...LV[i].windows] }, ...(LV[i].adds.length ? [{ op: 'add', list: LV[i].adds }] : [])] });
    }
    // the roof: its ridge along the longer side
    const roofType = 'roof-' + a.roof, along = W >= D;
    const ro = along ? { x: -10, y: -10, w: W + 20, h: D + 20, r: 0 } : { x: W / 2 - (D + 20) / 2, y: D / 2 - (W + 20) / 2, w: D + 20, h: W + 20, r: 90 };
    steps.push({ title: 'Roof', text: `A ${lc((FP.byId[roofType] || { name: 'roof' }).name)} covers the house${a.roof === 'flat' ? '' : ` (${a.pitch}°)`}, in ${lc((WM.ROOF_MATS[a.roofMat] || { name: 'tiles' }).name)}. It rests on the walls of the top storey.`,
      ops: [{ op: 'level', id: levels[n - 1].id }, { op: 'roof', type: roofType, ...ro, pitch: +a.pitch, roofMat: a.roofMat, color: a.roofColor || undefined }] });
    // finishes, fittings and furniture, storey by storey
    for (let i = 0; i < n; i++) {
      const rs = LV[i].rooms, ops = [{ op: 'level', id: levels[i].id }];
      if (a.linings && rs.some((r) => r.kind === 'bed')) ops.push({ op: 'lining', at: rs.filter((r) => r.kind === 'bed').map((r) => [r.cx, r.cy]) });
      ops.push({ op: 'floor', at: rs.map((r) => [r.cx, r.cy + (r.kind === 'hall' && n > 1 ? r.h * 0.4 : 0), floorOf(r)]) });
      if (a.furniture) ops.push({ op: 'place', list: rs.flatMap((r) => furnish(r, D, i, a)) });
      steps.push({ title: `${nm(i)}${a.furniture ? 'Floors and furniture' : 'Floors'}`.replace(/^./, (c) => c.toUpperCase()),
        text: `${a.linings ? 'The bedrooms get 10 cm service linings; then ' : ''}${a.linings ? 'f' : 'F'}loors are laid${a.furniture ? ' and the rooms are fitted out and furnished' : ''}: ${rs.map((r) => `${lc(r.name)} (${lc((MATS[floorOf(r)] || { name: '' }).name)})`).join(', ')}.`,
        ops });
    }
    // the plot
    const garden = [];
    if (a.trees) garden.push(['tree', -300, D * 0.3, 0], ['tree', W + 320, D * 0.65, 0], ['tree-conifer', -260, D + 150, 0], ['bush', W + 160, D + 140, 0], ['flowerbed', r10(W * 0.22), D + 120, 0]);
    if (a.pool) garden.push(['pool', r10(W / 2), -360, 0, { w: r10(Math.min(800, W * 0.6)), h: 300 }], ['lounger', r10(W / 2 - Math.min(400, W * 0.3) - 110), -360, 0], ['lounger', r10(W / 2 + Math.min(400, W * 0.3) + 110), -360, 0]);
    if (a.car) garden.push(['gravel-path', r10(frontDoorX), D + 210, 90, { w: 400, h: 120 }], ['car', W - 140, D + 330, 0]);
    if (garden.length) steps.push({ title: 'Garden', text: `Finally the plot: ${[a.trees && 'trees and flowers', a.pool && 'a pool with sun loungers', a.car && 'a path to the front door and a parking place'].filter(Boolean).join(', ')}. The house is complete — open the 3D view to look round it.`,
      ops: [{ op: 'level', id: 'L0' }, { op: 'place', list: garden }] });
    else steps[steps.length - 1].text += ' The house is complete — open the 3D view to look round it.';

    const house = {
      id: 'wizard', name: a.name || 'My house', ground: a.ground, wallH: H, slabT: 30, levels, steps,
      blurb: '', size: `${W / 100} × ${D / 100} m · ${n} storey${n === 1 ? '' : 's'}`,
    };
    return { house, rooms, notes, W, D, H, n, levels, LV, frontDoorX, stairs };
  }

  // the furniture of one room (centred, against an outer wall where it can be)
  function furnish(r, D, lvl, a) {
    const { x, y, w, h, cx, cy } = r, back = y < 1, front = y + h > D - 1, out = [];
    const bedY = (len) => (back ? [y + 15 + len / 2, 0] : [y + h - 15 - len / 2, 180]);
    if (r.kind === 'living' || r.kind === 'living-kitchen') {
      out.push(['sofa', x + 60, r10(cy + (r.kind === 'living-kitchen' ? 20 : 0)), 90]);
      out.push([w >= 520 ? 'table-rect6' : 'table-sq4', r10(x + w * (r.kind === 'living-kitchen' ? 0.45 : 0.62)), r10(back ? y + Math.min(h * 0.35, 200) : cy), 0]);
      out.push(['plant', x + 40, y + 40, 0]);
      if (r.kind === 'living-kitchen') out.push(['sink', r10(x + w - 250), y + 52, 0], ['stove', r10(x + w - 150), y + 52, 0], ['fridge', x + w - 55, y + 57, 0]);
    } else if (r.kind === 'kitchen') {
      out.push(['sink', r10(cx), y + 52, 0], ['stove', r10(cx - 100), y + 52, 0]);
      if (w >= 300) out.push(['fridge', x + w - 55, y + 57, 0]);
      if (h >= 380) out.push(['table-sq2', r10(cx), r10(cy + 60), 90]);
    } else if (r.kind === 'bed') {
      const dbl = /Main/.test(r.name), [by, rot] = bedY(200);
      out.push([dbl ? 'bed-double' : 'bed-single', r10(cx), r10(by), rot]);
      out.push(['plant', x + w - 40, back ? y + 40 : y + h - 40, 0]);
    } else if (r.kind === 'bath') {
      out.push(['shower', x + w - 60, front ? y + h - 60 : y + 60, 0]);
      out.push(['toilet', x + w - 38, r10(front ? y + h - 190 : y + 190), 90]);
      if (h >= 400) out.push(['washbasin', x + w - 35, r10(front ? y + h - 300 : y + 300), 90]);
    } else if (r.kind === 'study') {
      out.push(['desk', r10(cx), back ? y + 50 : y + h - 50, back ? 0 : 180], ['bookshelf', x + 30, r10(cy), 90]);
    }
    void lvl; void a;
    return out.filter((p) => FP.byId[p[0]]);
  }

  /* ───────────────────────── the questions ───────────────────────── */
  const roofStyles = () => Object.values(FP.byId).filter((ic) => ic.cat === 'Roofs' && ic.roof && !ic.hidden && ic.roof !== 'hip-l' && !ic.roofFence)
    .map((ic) => [ic.roof, ic.name]);
  const swatches = (key, list) => `<div class="wz-swatches">${list.map((c) => `<button type="button" data-set="${key}" data-v="${c}" class="${String(A[key]).toLowerCase() === c ? 'on' : ''}" style="background:${c}" title="${c}" aria-label="Colour ${c}"></button>`).join('')}
    <label class="wz-color" title="Any colour"><input type="color" data-a="${key}" value="${A[key] || '#ffffff'}"/> Other…</label></div>`;
  const choice = (key, opts) => `<div class="wz-choices">${opts.map(([v, label, sub]) => `<button type="button" data-set="${key}" data-v="${esc(String(v))}" class="${String(A[key]) === String(v) ? 'on' : ''}"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`).join('')}</div>`;
  const slider = (key, label, min, max, step, unit) => `<label class="wz-slider"><span>${label}</span>
    <input type="range" data-a="${key}" min="${min}" max="${max}" step="${step}" value="${A[key]}"/>
    <input type="number" data-a="${key}" min="${min}" max="${max}" step="${step}" value="${A[key]}"/><em>${unit}</em></label>`;
  const check = (key, label, sub) => `<label class="wz-check"><input type="checkbox" data-a="${key}" ${A[key] ? 'checked' : ''}/><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span></label>`;
  const matBtns = (key, entries, swatchOf) => `<div class="wz-mats">${entries.map(([id, m]) => `<button type="button" data-set="${key}" data-v="${id}" class="${A[key] === id ? 'on' : ''}" title="${esc(m.name)}">
    <img src="${swatchOf(id)}" alt=""/><span>${esc(m.name)}</span></button>`).join('')}</div>`;
  const matName = (tbl, id) => (tbl[id] ? tbl[id].name : id);

  const STEPS = [
    { id: 'start', title: 'Your house', sum: () => `${A.name}`,
      body: () => `<p class="wz-lead">Answer a few questions and the house is designed and built for you, step by step. Every answer can be changed later — click any step on the left.</p>
        <label class="wz-field"><span>Name</span><input type="text" data-a="name" value="${esc(A.name)}" maxlength="60"/></label>
        <h4>Surroundings</h4>${choice('ground', [['grass', 'Lawn'], ['trees', 'Lawn with trees'], ['street', 'Street'], ['street-trees', 'Street with trees'], ['paving', 'Paved'], ['gravel', 'Gravel']])}` },
    { id: 'size', title: 'Size', sum: () => `${A.w} × ${A.d} m · ${Math.round(A.w * A.d)} m²`,
      body: () => `<p class="wz-lead">How big is the house on the ground? (Outside measurements.)</p>
        ${slider('w', 'Width (front)', 6, 20, 0.5, 'm')}${slider('d', 'Depth', 6, 15, 0.5, 'm')}
        <h4>Quick sizes</h4>${choice('size', [['8x7', 'Small', '8 × 7 m'], ['12x9', 'Family', '12 × 9 m'], ['15x10', 'Large', '15 × 10 m'], ['18x12', 'Villa', '18 × 12 m']])}` },
    { id: 'floors', title: 'Storeys', sum: () => `${A.floors} storey${A.floors > 1 ? 's' : ''} · ${(+A.storeyH).toFixed(2)} m`,
      body: () => `<p class="wz-lead">How many storeys, and how high is each one (floor to floor)?</p>
        ${choice('floors', [[1, 'One storey', 'a bungalow'], [2, 'Two storeys', 'with U-shaped stairs'], [3, 'Three storeys', 'stairs on every floor']])}
        ${choice('storeyH', [[2.8, '2.80 m', 'compact'], [3, '3.00 m', 'usual'], [3.3, '3.30 m', 'airy']])}
        <p class="wz-note">Two or three storeys need at least 10 × 7 m: a stair hall runs through the middle of the house.</p>` },
    { id: 'rooms', title: 'Rooms', sum: () => `${A.bedrooms} bedroom${A.bedrooms > 1 ? 's' : ''} · ${A.baths} bath${A.baths > 1 ? 's' : ''}${A.floors === 1 ? ` · kitchen ${A.kitchen === 'open' ? 'open-plan' : 'separate'}` : ''}`,
      body: () => `<p class="wz-lead">Which rooms does the house need?</p>
        <h4>Bedrooms</h4>${choice('bedrooms', [1, 2, 3, 4, 5, 6].map((v) => [v, String(v)]))}
        <h4>Bathrooms</h4>${choice('baths', [[1, '1'], [2, '2'], [3, '3']])}
        ${A.floors === 1 ? `<h4>Kitchen</h4>${choice('kitchen', [['separate', 'Separate kitchen'], ['open', 'Open-plan', 'one room with the living room']])}` : '<p class="wz-note">With stairs the kitchen and a shower room are on the ground floor; bedrooms and further bathrooms upstairs.</p>'}` },
    { id: 'walls', title: 'Walls & colours', sum: () => `${matName(WM.MATS, A.wallMat)} · ${A.wallColor}`,
      body: () => `<p class="wz-lead">What do the walls look like?</p>
        <h4>Outside walls</h4>${matBtns('wallMat', Object.entries(WM.MATS), (id) => WM.swatch(id))}
        <h4>Outside colour</h4>${swatches('wallColor', ['#e4dfd6', '#ffffff', '#f2e3c6', '#d9c3a5', '#a4532f', '#7a3b22', '#9aa3ab', '#5f5a52'])}
        <h4>Inside colour</h4>${swatches('inColor', ['#f4f1ec', '#ffffff', '#eef1f4', '#f3ead8', '#e6efe4', '#e9e1ea'])}` },
    { id: 'roof', title: 'Roof', sum: () => `${(roofStyles().find(([s]) => s === A.roof) || ['', A.roof])[1]} · ${matName(WM.ROOF_MATS, A.roofMat)}`,
      body: () => `<p class="wz-lead">Which roof?</p>
        <div class="wz-roofs">${roofStyles().map(([s, name]) => `<button type="button" data-set="roof" data-v="${s}" class="${A.roof === s ? 'on' : ''}"><svg viewBox="0 0 120 60" aria-hidden="true">${roofSketch(s, 10, 50, 100, 30)}<rect x="22" y="50" width="76" height="9" fill="currentColor" opacity=".25"/></svg><span>${esc(name)}</span></button>`).join('')}</div>
        ${A.roof === 'flat' ? '' : `<h4>Pitch</h4>${choice('pitch', [[15, '15°'], [25, '25°'], [30, '30°'], [35, '35°'], [45, '45°']])}`}
        <h4>Covering</h4>${matBtns('roofMat', Object.entries(WM.ROOF_MATS), (id) => WM.roofSwatch(id))}
        <h4>Colour</h4>${swatches('roofColor', ['', '#b5532f', '#7a3b22', '#3f3f46', '#4b5563', '#3f6b4c', '#8a6a4f'].filter(Boolean))}
        <p class="wz-note">${A.roofColor ? `<button type="button" class="wz-link" data-set="roofColor" data-v="">Use the covering's own colour</button>` : 'Now in the covering\'s own colour.'}</p>` },
    { id: 'finish', title: 'Floors', sum: () => `${matName(MATS, A.flLiving)} · ${matName(MATS, A.flBed)} · ${matName(MATS, A.flWet)}`,
      body: () => {
        const indoor = Object.entries(MATS).filter(([id]) => !['grass', 'gravel', 'sand', 'soil', 'mulch', 'water', 'asphalt'].includes(id));
        const pick = (key) => `<div class="wz-mats small">${indoor.map(([id, m]) => `<button type="button" data-set="${key}" data-v="${id}" class="${A[key] === id ? 'on' : ''}" title="${esc(m.name)}"><i style="background:${m.color}"></i><span>${esc(m.name)}</span></button>`).join('')}</div>`;
        return `<p class="wz-lead">Floor finishes, room by room.</p><h4>Living room${A.floors > 1 ? ', landing and study' : ''}</h4>${pick('flLiving')}<h4>Bedrooms</h4>${pick('flBed')}<h4>Kitchen and bathrooms</h4>${pick('flWet')}`;
      } },
    { id: 'extras', title: 'Extras', sum: () => [A.furniture && 'furniture', A.balcony && A.floors > 1 && 'balcony', A.linings && 'linings', A.trees && 'trees', A.pool && 'pool', A.car && 'parking'].filter(Boolean).join(' · ') || 'none',
      body: () => `<p class="wz-lead">What else?</p>
        ${check('furniture', 'Furniture and fittings', 'kitchen, bathroom fittings, beds, sofa, tables')}
        ${A.floors > 1 ? check('balcony', 'Balcony', 'off the main bedroom, with a glass sliding door') : ''}
        ${check('linings', 'Service linings in the bedrooms', '10 cm interior walls for wiring and insulation')}
        ${check('trees', 'Trees and flowers')}${check('pool', 'Swimming pool', 'behind the house')}${check('car', 'Path and parking place', 'a gravel path to the front door and a car')}` },
    { id: 'build', title: 'Build', sum: () => 'review and build',
      body: () => {
        const d = design(A);
        return `<p class="wz-lead">Ready. The house is built on the plan step by step — use <b>Next</b> and <b>Previous</b> (or <b>Play</b>) to follow it; <b>Keep this house</b> makes it your plan, and <b>✎ Change answers</b> brings you back here.</p>
          <ul class="wz-summary">${STEPS.slice(0, -1).map((s, k) => `<li><button type="button" data-go="${k}">${esc(s.title)}</button><span>${esc(s.sum())}</span></li>`).join('')}</ul>
          <p class="wz-note">${d.house.steps.length} construction steps · ${d.rooms.filter((r) => r.kind !== 'hall').length} rooms. Your own plan is kept aside until you choose “Keep this house”.</p>`;
      } },
  ];

  /* ───────────────────────── preview: front view and the plan of each storey ───────────────────────── */
  function roofSketch(style, x, y, w, h) {
    // a small front view of a roof over the wall top x..x+w at y (h: its height)
    const L = x, R = x + w, T = y - h, m = x + w / 2;
    const fill = 'fill="currentColor"';
    switch (style) {
      case 'flat': return `<rect x="${L - 2}" y="${y - 5}" width="${w + 4}" height="5" ${fill}/>`;
      case 'shed': return `<path d="M${L - 4} ${y}L${R + 4} ${y - h * 0.6}L${R + 4} ${y - h * 0.6 + 5}L${L - 4} ${y + 5}Z" ${fill}/>`;
      case 'hip': return `<path d="M${L - 4} ${y}L${L + w * 0.25} ${T}L${R - w * 0.25} ${T}L${R + 4} ${y}Z" ${fill}/>`;
      case 'mansard': return `<path d="M${L - 3} ${y}L${L + 6} ${y - h * 0.65}L${L + w * 0.3} ${T}L${R - w * 0.3} ${T}L${R - 6} ${y - h * 0.65}L${R + 3} ${y}Z" ${fill}/>`;
      case 'gambrel': return `<path d="M${L - 3} ${y}L${L + 8} ${y - h * 0.6}L${m} ${T}L${R - 8} ${y - h * 0.6}L${R + 3} ${y}Z" ${fill}/>`;
      case 'butterfly': return `<path d="M${L - 4} ${y - h * 0.5}L${m} ${y - 4}L${R + 4} ${y - h * 0.5}L${R + 4} ${y - h * 0.5 + 5}L${m} ${y + 1}L${L - 4} ${y - h * 0.5 + 5}Z" ${fill}/>`;
      case 'saltbox': case 'clerestory': return `<path d="M${L - 4} ${y}L${L + w * 0.62} ${T}L${R + 4} ${y - h * 0.35}L${R + 4} ${y}Z" ${fill}/>`;
      default: return `<path d="M${L - 4} ${y}L${m} ${T}L${R + 4} ${y}Z" ${fill}/>`; // gable, box gable: the gable end
    }
  }
  function preview() {
    const d = design(A), { W, D, H, n, LV } = d;
    // front view (the street side), 1 px = S cm
    const S = 300 / Math.max(W, 900), wallH = n * H, rise = A.roof === 'flat' ? 30 : Math.tan((A.pitch * Math.PI) / 180) * Math.min(W, D) / 2;
    const vw = 340, vh = 40 + (wallH + rise) * S + 20, gx = (vw - W * S) / 2, gy = vh - 18;
    let front = `<rect x="0" y="${gy}" width="${vw}" height="18" fill="${A.ground === 'paving' || A.ground === 'gravel' ? '#cfc8bb' : '#7fb069'}"/>`;
    front += `<rect x="${gx}" y="${gy - wallH * S}" width="${W * S}" height="${wallH * S}" fill="${A.wallColor}" stroke="#00000030"/>`;
    // the roof seen from the front: its long side when the ridge runs along the width, else its gable end
    const along = W >= D, style = A.roof;
    const sideOn = along && !['flat', 'butterfly', 'shed'].includes(style) && style !== 'gable' && style !== 'box-gable' ? style : along && (style === 'gable' || style === 'box-gable') ? 'band' : style;
    front += `<g style="color:${A.roofColor || (WM.ROOF_MATS[A.roofMat] || { color: '#a5452f' }).color}">${sideOn === 'band'
      ? `<rect x="${gx - 6}" y="${gy - wallH * S - rise * S}" width="${W * S + 12}" height="${rise * S + 3}" fill="currentColor"/>`
      : roofSketch(sideOn, gx, gy - wallH * S, W * S, rise * S)}</g>`;
    for (let i = 0; i < n; i++) {
      const fy = gy - i * H * S;
      for (const wd of LV[i].windows.concat(LV[i].doors)) {
        if (Math.abs(wd[2] - D) > 1 || wd[3] === 90) continue; // on the front wall only
        const door = /door/.test(wd[0]), ww = (wd[4] && wd[4].w) || (door ? 90 : 100), x = gx + (wd[1] - ww / 2) * S;
        front += door ? `<rect x="${x}" y="${fy - 210 * S}" width="${ww * S}" height="${210 * S}" fill="#7a5a3c"/>`
          : `<rect x="${x}" y="${fy - 210 * S}" width="${ww * S}" height="${120 * S}" fill="#a9d8f2" stroke="#ffffff" stroke-width="1.5"/>`;
      }
      if (i) front += `<line x1="${gx}" y1="${fy}" x2="${gx + W * S}" y2="${fy}" stroke="#00000022"/>`;
    }
    const svgFront = `<svg class="wz-front" viewBox="0 0 ${vw} ${vh}" role="img" aria-label="Front view">${front}</svg>`;
    // the plans
    const P = 150 / Math.max(W, D);
    const plans = LV.map((l, i) => {
      const rects = l.rooms.map((r) => `<rect x="${r.x * P}" y="${r.y * P}" width="${r.w * P}" height="${r.h * P}" class="wz-room ${r.kind}"/>` +
        (r.w * P > 34 ? `<text x="${r.cx * P}" y="${r.cy * P}" class="wz-rname">${esc(r.kind === 'hall' ? (i ? 'Landing' : 'Hall') : r.name.replace(/^Main bedroom$/, 'Bedroom 1').replace('Living room & kitchen', 'Living+kitchen'))}</text>` : '')).join('');
      const st = d.stairs && i < n - 1 ? `<rect x="${(d.stairs[0] - 95) * P}" y="${(d.stairs[1] - 170) * P}" width="${190 * P}" height="${340 * P}" class="wz-stairs"/>` : '';
      return `<figure><svg viewBox="-4 -4 ${W * P + 8} ${D * P + 8}" width="${W * P + 8}" height="${D * P + 8}"><rect x="0" y="0" width="${W * P}" height="${D * P}" class="wz-outline"/>${rects}${st}</svg><figcaption>${esc(d.levels[i].name)}</figcaption></figure>`;
    }).join('');
    $('#wzPreview').innerHTML = `${svgFront}<div class="wz-plans">${plans}</div>${d.notes.length ? `<ul class="wz-notes">${d.notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}`;
  }

  /* ───────────────────────── the dialog ───────────────────────── */
  let cur = 0;
  function mount() {
    if ($('#wizard')) return;
    const el = document.createElement('div');
    el.id = 'wizard'; el.className = 'modal'; el.hidden = true;
    el.innerHTML = `<div class="modal-box wz-box" role="dialog" aria-labelledby="wzTitle">
      <div class="wz-head"><h2 id="wzTitle">House Building Wizard</h2><button type="button" class="wz-x" data-wz="close" aria-label="Close" title="Close (Esc)">×</button></div>
      <div class="wz-main">
        <nav class="wz-nav" id="wzNav" aria-label="Steps"></nav>
        <section class="wz-body"><h3 id="wzStepTitle"></h3><div id="wzStep"></div></section>
        <aside class="wz-preview" id="wzPreview" aria-label="Preview"></aside>
      </div>
      <div class="wz-foot"><button type="button" data-wz="back">◀ Back</button><span class="wz-count" id="wzCount"></span>
        <button type="button" data-wz="build" class="wz-build-now" title="Build the house with the answers so far">Build now</button>
        <button type="button" data-wz="next" class="primary">Next ▶</button></div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  }
  function render() {
    $('#wzNav').innerHTML = STEPS.map((s, k) => `<button type="button" data-go="${k}" class="${k === cur ? 'on' : ''}" ${k === cur ? 'aria-current="step"' : ''}>
      <i>${k + 1}</i><span><b>${esc(s.title)}</b><small>${esc(s.sum())}</small></span></button>`).join('');
    $('#wzStepTitle').textContent = `${cur + 1}. ${STEPS[cur].title}`;
    $('#wzStep').innerHTML = STEPS[cur].body();
    $('#wzCount').textContent = `Step ${cur + 1} of ${STEPS.length}`;
    const last = cur === STEPS.length - 1;
    $('#wizard [data-wz="back"]').disabled = cur === 0;
    $('#wizard [data-wz="next"]').textContent = last ? '🏠 Build the house' : 'Next ▶';
    $('#wizard [data-wz="build"]').hidden = last;
    preview();
  }
  // a changed answer: the summaries on the left and the preview follow (the step itself only when it changes shape)
  function changed(redrawStep) {
    remember();
    if (redrawStep) { const sc = $('#wzStep').scrollTop; $('#wzStep').innerHTML = STEPS[cur].body(); $('#wzStep').scrollTop = sc; }
    $('#wzNav').querySelectorAll('[data-go]').forEach((b) => { const s = STEPS[+b.dataset.go]; b.querySelector('small').textContent = s.sum(); });
    preview();
  }
  function setAnswer(key, v) {
    if (key === 'size') { const [w, d] = v.split('x').map(Number); A.w = w; A.d = d; return changed(true); }
    const num = ['w', 'd', 'floors', 'storeyH', 'bedrooms', 'baths', 'pitch'];
    A[key] = num.includes(key) ? +v : v;
    if (key === 'floors' && A.floors > 1) { A.w = Math.max(A.w, 10); A.d = Math.max(A.d, 7); }
    if (key === 'roofMat') A.roofColor = '';
    changed(true);
  }
  function onClick(e) {
    const go = e.target.closest('[data-go]');
    if (go) { cur = +go.dataset.go; return render(); }
    const set = e.target.closest('[data-set]');
    if (set) return setAnswer(set.dataset.set, set.dataset.v);
    const b = e.target.closest('[data-wz]');
    if (!b) { if (e.target.id === 'wizard') close(); return; }
    const a = b.dataset.wz;
    if (a === 'close') close();
    if (a === 'back' && cur > 0) { cur--; render(); }
    if (a === 'next') { if (cur < STEPS.length - 1) { cur++; render(); } else build(); }
    if (a === 'build') build();
  }
  function onInput(e) {
    const t = e.target, key = t.dataset && t.dataset.a;
    if (!key) return;
    if (t.type === 'checkbox') { A[key] = t.checked; return changed(false); }
    if (t.type === 'range' || t.type === 'number') {
      const v = parseFloat(t.value);
      if (!isFinite(v)) return;
      A[key] = clamp(v, +t.min, +t.max);
      // the slider and the number field show the same
      $('#wzStep').querySelectorAll(`[data-a="${key}"]`).forEach((o) => { if (o !== t) o.value = A[key]; });
      return changed(false);
    }
    A[key] = t.value;
    changed(t.type === 'color' && e.type === 'change');
  }
  function open(at = 0) {
    mount();
    cur = at;
    $('#wizard').hidden = false;
    render();
    const f = $('#wizard [data-wz="next"]'); if (f) f.focus();
  }
  function close() { const w = $('#wizard'); if (w) w.hidden = true; }
  function build() {
    const d = design(A);
    close();
    FP.demoBuild(d.house, () => open(STEPS.length - 1));
  }

  const btn = $('#btnWizard');
  if (btn) btn.addEventListener('click', () => open(0));
  window.FP_WIZARD = { open, design: () => design(A) };
})();
