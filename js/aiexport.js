/* Floor Plan 2027 — "Export for AI"
 * Writes one Markdown file that people can read and programs can parse:
 *   - an overview, one section per room, tables of walls / doors & windows / objects
 *   - a ready-to-use rendering prompt
 *   - the complete scene as JSON in a fenced ```json block (format "floorplan2027.scene", version 1)
 * Units: centimetres. Plan coordinates: x to the right, y down the plan, z up; the top of the plan is taken as north.
 */
(function () {
  'use strict';

  const FP = window.FP, W = window.FPWalls, WM = window.FP_WALLMATS, FM = window.FP_MATERIALS;
  const DOOR_H = 210, SILL_H = 90, HEAD_H = 210;
  const r1 = (v) => Math.round(v * 10) / 10;
  const pt = (p) => [r1(p[0]), r1(p[1])];
  const m2 = (cm) => `${(Math.round(cm) / 100).toFixed(2).replace(/\.?0+$/, '')} m`;

  /* What every icon is, for the description: [typical height cm, description, material hint] */
  const OBJECTS = {
    'bed-double': [55, 'double bed with a 100 cm headboard, mattress, duvet and two pillows', 'wooden or upholstered frame, fabric bedding'],
    'bed-single': [55, 'single bed with headboard, mattress and pillow', 'wooden frame, fabric bedding'],
    sofa: [80, 'three-seat sofa with backrest and arms', 'upholstery fabric'],
    loveseat: [80, 'two-seat sofa', 'upholstery fabric'],
    armchair: [80, 'armchair', 'upholstery fabric'],
    'tub-chair': [72, 'round tub chair', 'upholstery'],
    'lounge-chair': [80, 'lounge chair', 'fabric and wood'],
    chair: [88, 'chair (seat height 45 cm)', 'wood'],
    'office-chair': [100, 'office swivel chair on a five-star base', 'mesh and plastic, metal base'],
    desk: [75, 'desk with a drawer unit', 'wood'],
    'desk-computer': [75, 'desk with a monitor, keyboard and office chair', 'wood, electronics'],
    'desk-corner': [75, 'corner desk', 'wood'],
    'desk-l': [75, 'L-shaped desk', 'wood'],
    tv: [150, 'flat-screen TV on a stand (screen from 80 to 150 cm)', 'black glass and plastic'],
    'tv-stand': [50, 'low TV cabinet', 'wood'],
    storage: [200, 'wardrobe / storage cabinet', 'wood'],
    bookshelf: [190, 'bookshelf filled with books', 'wood'],
    fireplace: [110, 'fireplace with a hearth', 'stone or brick'],
    radiator: [60, 'wall radiator', 'painted metal'],
    piano: [125, 'upright piano', 'polished wood'],
    'grand-piano': [100, 'grand piano', 'glossy black lacquer'],
    plant: [100, 'large potted plant', 'ceramic pot, green foliage'],
    rug: [1, 'rug', 'textile'],
    'ceiling-fan': [25, 'ceiling fan (hangs from the ceiling)', 'metal and wooden blades'],
    stove: [90, 'cooktop with 4 burners', 'stainless steel / glass ceramic'],
    range: [90, 'cooking range with 5 burners', 'stainless steel'],
    fridge: [180, 'refrigerator', 'stainless steel'],
    dishwasher: [85, 'dishwasher', 'stainless steel'],
    washer: [85, 'front-loading washing machine', 'white enamel'],
    sink: [90, 'kitchen sink in a base cabinet', 'stainless steel sink, countertop'],
    'sink-double': [90, 'double kitchen sink in a base cabinet', 'stainless steel sink, countertop'],
    counter: [90, 'kitchen counter with base cabinets', 'countertop over cabinets'],
    washbasin: [85, 'washbasin', 'white ceramic'],
    toilet: [80, 'toilet with cistern', 'white ceramic'],
    bathtub: [55, 'bathtub', 'white acrylic'],
    shower: [6, 'shower tray (walk-in shower area)', 'ceramic, glass screen'],
    'stairs-h': [250, 'straight staircase', 'wood or concrete'],
    'stairs-l': [250, 'L-shaped staircase with a corner landing', 'wood or concrete'],
    'stairs-u': [250, 'U-shaped (half-turn) staircase with a landing', 'wood or concrete'],
    'stairs-spiral': [250, 'spiral staircase around a central pole', 'metal and wood'],
    'slab-opening': [0, 'opening in the floor slab (stairwell / void)', 'open void with a metal guard railing'],
    slab: [30, 'floor structure', 'timber joists with OSB subfloor'],
    'gravel-path': [3, 'gravel garden path with low edging stones, laid on the ground; where the ground is steep it turns into stone steps of about 15 cm', 'fine light-grey gravel, stone edging and stone steps'],
    // garden
    fence: [110, 'wooden picket fence with posts and two rails', 'painted or natural timber'],
    'fence-metal': [120, 'metal bar fence with posts', 'powder-coated anthracite steel'],
    'fence-concrete': [180, 'precast concrete panel fence: stacked panels between concrete posts, with a capping', 'grey precast concrete'],
    'fence-brick': [150, 'brick garden wall, one brick thick, with brick piers about every 2.5 m and a stone coping', 'red facing brick, light stone coping'],
    'fence-stone': [100, 'dry-stone garden wall, slightly tapering towards the top, with rough cope stones set on edge along the top', 'natural grey-brown fieldstone'],
    'fence-plastic': [120, 'plastic (PVC / vinyl) picket fence with square capped posts and two rails', 'white PVC'],
    hedge: [160, 'trimmed green hedge', 'dense evergreen foliage'],
    gate: [130, 'wooden garden gate between two posts', 'timber'],
    tree: [500, 'deciduous tree with a broad leafy crown', 'bark trunk, green leaves'],
    'tree-conifer': [500, 'conifer tree (fir/spruce)', 'dark green needles'],
    palm: [480, 'palm tree with long fronds', 'fibrous trunk, green fronds'],
    bush: [90, 'rounded shrub', 'green foliage'],
    flowerbed: [35, 'flower bed with colourful flowers', 'soil, mixed flowers (red, yellow, purple, pink, white)'],
    planter: [55, 'raised planter box with plants', 'timber box, green plants'],
    'garden-table': [75, 'round patio table with 4 chairs', 'weatherproof garden furniture'],
    bench: [90, 'garden bench with backrest', 'timber slats, black metal frame'],
    lounger: [60, 'sun lounger with adjustable backrest and cushion', 'cushion fabric, metal frame'],
    parasol: [260, 'garden parasol on a stand', 'fabric canopy, metal pole'],
    bbq: [95, 'kettle barbecue on three legs', 'black enamel steel'],
    slide: [225, "children's slide with ladder and platform (150 cm)", 'coloured plastic chute, metal ladder, wooden platform'],
    swing: [220, "children's swing set with two seats on an A-frame", 'timber frame, ropes, plastic seats'],
    sandbox: [25, "children's sandbox", 'timber frame, sand'],
    trampoline: [90, 'round garden trampoline', 'black mat, blue safety padding, metal legs'],
    pond: [6, 'garden pond with a stone edge', 'water, natural stones'],
    'sewage-pit': [3, 'rectangular sewage / sump pit sunk into the basement floor, with concrete walls and a concrete base slab; a submersible pump discharges through a pipe in the wall to the street sewer', 'cast concrete, steel grating cover, orange PVC discharge pipe'],
    pool: [5, 'in-ground swimming pool with light stone coping, tiled blue basin, entry steps and a stainless ladder', 'clear blue water, light stone coping, blue mosaic tiles'],
    car: [150, 'passenger car (hatchback / sedan), parked', 'metallic paint, tinted glass, black tyres with alloy rims'],
    shed: [275, 'wooden garden shed with a pitched roof and door', 'timber cladding, dark red roof'],
    'stepping-stones': [4, 'stepping-stone path', 'natural stone'],
    column: [null, 'square structural column', 'wall material'],
    'column-round': [null, 'round structural column', 'wall material'],
    pillar: [null, 'square pillar', 'wall material'],
  };
  const OPENINGS = {
    door: 'single hinged door', 'door-left': 'single hinged door', 'door-double': 'double hinged door',
    'door-double-uneven': 'double door with unequal leaves', 'door-double-acting': 'double-acting (swing both ways) door',
    'door-swing': 'two-way swing door', 'door-revolving': 'revolving glass door', 'door-sliding': 'sliding glass door',
    'door-pocket': 'pocket sliding door (slides into the wall)', 'door-bifold': 'bi-fold door', 'door-accordion': 'accordion folding door',
    opening: 'open doorway without a door', 'garage-door': 'sectional garage door',
    window: 'fixed double window with a central mullion', 'window-sill': 'four-pane window with a projecting stone sill',
    'window-casement': 'casement window with two sashes opening',
    'window-arched': 'arched window with a round (or segmental) head, a transom at the springing line and a central mullion', 'door-arched': 'door with a round-arched head and a matching arched leaf', 'door-double-arched': 'double door under a round arch, each leaf carrying half of the arch',
    'window-basement': 'small basement window high in the wall, top-hung pane tilted open', 'bay-window': 'angled bay window projecting from the wall',
    'bay-window-round': 'curved bow window projecting from the wall', railing: 'balcony railing, 100 cm high',
  };
  const isWindow = (t) => /^(window|bay-window)/.test(t);
  // what surrounds the building (3D ground setting)
  const SITES = {
    plain: 'neutral plain ground (no specific surroundings)',
    grass: 'a mown lawn all around the building',
    trees: 'a lawn with scattered deciduous and conifer trees around the building',
    street: 'a lawn front yard, a paved sidewalk with a curb and a two-lane asphalt street with dashed centre line along the south side',
    'street-trees': 'a lawn front yard, a tree-lined paved sidewalk with a curb and a two-lane asphalt street along the south side, plus trees around the house',
    paving: 'a paved plaza of large concrete slabs around the building',
    gravel: 'a gravel surface around the building',
    brush: 'wild, dense low brush and jungle undergrowth all around the building: shrubs, ferns, tall grass clumps and a few small palms on dark leaf-littered soil, cleared close to the house',
  };

  // compass direction of a plan vector (top of the plan = north)
  function compass([dx, dy]) {
    const a = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = north, clockwise
    return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((a + 360) % 360) / 45) % 8];
  }
  const tidyColour = (c) => (c || '').toLowerCase();
  const elevText = (e) => (e ? `${e > 0 ? '+' : '−'}${(Math.abs(e) / 100).toFixed(2)} m` : '±0.00 m');

  /* ───────────── build the scene ───────────── */
  // everything on one level (heights here are relative to that level; buildScene shifts them)
  function buildLevel(items) {
    const plan = FP.plan(), byId = FP.byId;
    const name = (it) => it.label || (it.type === 'slab' ? (it.slabType === 'concrete' ? 'Concrete floor slab' : 'Timber floor slab') : byId[it.type].name);

    // rooms come from indoor floor objects, outdoor areas from garden ones: world outlines for hit testing
    const shapeOf = (f) => {
      const tf = W.toWorld(f), kx = f.w / f.w0, ky = f.h / f.h0;
      return { f, rings: f.rings.map((r) => r.map(([x, y]) => tf([x * kx, y * ky]))) };
    };
    const roomShapes = items.filter((i) => i.type === 'floor' && !i.garden).map(shapeOf);
    const gardenShapes = items.filter((i) => i.type === 'floor' && i.garden).map(shapeOf);
    const inRings = (rings, x, y) => {
      let inside = false;
      for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const roomAt = (x, y) => { const r = roomShapes.find((s) => inRings(s.rings, x, y)); return r ? 'room-' + r.f.id : null; };
    // the garden area on top at a point (later ones in the drawing order lie on top)
    const outdoorAt = (x, y) => { const r = [...gardenShapes].reverse().find((s) => inRings(s.rings, x, y)); return r ? 'garden-' + r.f.id : null; };
    const centre = (it) => [it.x + it.w / 2, it.y + it.h / 2];

    // walls
    const model = W.analyze(items);
    const EL = W.elevationModel(items, model); // floor levels above ground (±0)
    const walls = [];
    for (const it of items.filter((i) => W.isWall(i))) {
      const main = { id: it.wmat || 'plaster', name: WM.MATS[it.wmat || 'plaster'].name, colour: tidyColour(it.wcol || WM.MATS[it.wmat || 'plaster'].color) };
      const faces = W.wallFaces(it).faces;
      for (const seg of model.segs.filter((s) => s.id === it.id)) {
        const B = [seg.A[0] + seg.u[0] * seg.len, seg.A[1] + seg.u[1] * seg.len];
        walls.push({
          id: `wall-${it.id}-${seg.segIdx}`, itemId: it.id, name: `${name(it)}${faces.length > 2 ? ' · ' + faces.find((f) => f.segIdx === seg.segIdx).label.split(' · ')[0] : ''}`,
          start: pt(seg.A), end: pt(B), length: r1(seg.len), thickness: r1(seg.t), height: it.wh || plan.wallH || 300,
          // the wall stands on the ground and rises to (floor level beside it) + height
          baseElevation: r1(EL.seg(seg)), topElevation: r1(EL.seg(seg) + (it.wh || plan.wallH || 300)), // from its floor level
          direction: compass(seg.u) + '–' + compass([-seg.u[0], -seg.u[1]]),
          material: main,
          faces: faces.filter((f) => f.segIdx === seg.segIdx).map((f) => {
            const ov = it.faces && it.faces[f.key];
            const mat = ov ? { id: ov.wmat, name: WM.MATS[ov.wmat].name, colour: tidyColour(ov.wcol || WM.MATS[ov.wmat].color) } : main;
            // a long wall can face several rooms: look a little in front of the face at points all along it
            const hits = new Map();
            for (let k = 0.05; k < 1; k += 0.1) {
              const p = [seg.A[0] + seg.u[0] * seg.len * k + f.out[0] * (seg.t / 2 + 25), seg.A[1] + seg.u[1] * seg.len * k + f.out[1] * (seg.t / 2 + 25)];
              const rm = roomAt(p[0], p[1]);
              if (rm) hits.set(rm, (hits.get(rm) || 0) + 1);
            }
            const rooms = [...hits].sort((a, b) => b[1] - a[1]).map(([rm]) => rm);
            return { key: f.key, label: f.label.split(' · ')[1], facing: compass(f.out), normal: [r1(f.out[0]), r1(f.out[1])],
              room: rooms[0] || null, rooms, material: mat, customMaterial: !!ov };
          }),
          openings: [],
        });
      }
    }
    const wallBySeg = (seg) => walls.find((w) => w.id === `wall-${seg.id}-${seg.segIdx}`);

    // doors and windows
    const openings = [];
    for (const it of items) {
      const ic = byId[it.type];
      if (!OPENINGS[it.type]) continue;
      const line = ic.opening ? W.openingLine(it) : null;
      const host = model.hosts.get(it.id);
      const win = isWindow(it.type);
      const o = {
        id: `${win ? 'window' : it.type === 'railing' ? 'railing' : 'door'}-${it.id}`, itemId: it.id,
        kind: win ? 'window' : it.type === 'railing' ? 'railing' : 'door', type: it.type, name: name(it), description: OPENINGS[it.type],
        center: pt(line ? line.mid : centre(it)), width: r1(line ? line.len : it.w), rotation: r1(it.r),
        floorLevel: r1(EL.opening(it)), // threshold / reference level above ground; heights below are measured from it
      };
      if (win) {
        // same heights as the 3D view (basement windows hang from the top of their wall)
        const host2 = model.hosts.get(it.id), wall = host2 && items.find((i) => i.id === host2.seg.id);
        const wallTopAbs = (host2 ? EL.seg(host2.seg) : o.floorLevel) + ((wall && wall.wh) || plan.wallH || 300);
        [o.sillHeight, o.topHeight] = W.windowSpan(it, wallTopAbs - o.floorLevel).map(r1);
        o.sillElevation = r1(o.floorLevel + o.sillHeight); // above ground
        o.height = r1(o.topHeight - o.sillHeight);
        o.frameColour = tidyColour(it.fill);
        o.glazing = { window: '2 panes', 'window-sill': '4 panes', 'window-casement': '2 opening sashes', 'window-basement': '1 top-hung pane', 'window-arched': 'fanlight over 2 panes' }[it.type] || 'multi-pane';
        if (ic.opening && ic.opening.top) o.placement = `top of the wall, ${it.topGap != null ? it.topGap : 5} cm below the wall top`;
      } else if (it.type !== 'railing') {
        o.height = it.type === 'garage-door' ? 220 : it.type === 'opening' ? DOOR_H : DOOR_H;
        o.colour = tidyColour(it.fill);
        if (line && line.ext) {
          const p = [line.mid[0] + line.ext[0] * 60, line.mid[1] + line.ext[1] * 60];
          o.swingsInto = roomAt(p[0], p[1]);
          o.swingDirection = compass(line.ext);
        }
      } else {
        o.height = 100;
      }
      if (host) {
        const w = wallBySeg(host.seg);
        if (w) {
          o.wall = w.id;
          o.positionAlongWall = { from: r1(host.lo), to: r1(host.hi) };
          w.openings.push(o.id);
        }
        // rooms on both sides of the opening
        const n = host.seg.n, d = host.seg.t / 2 + 40, c = line.mid;
        o.connects = [roomAt(c[0] + n[0] * d, c[1] + n[1] * d), roomAt(c[0] - n[0] * d, c[1] - n[1] * d)].filter(Boolean);
      }
      openings.push(o);
    }

    // furniture, fixtures, stairs, columns
    const objects = [];
    for (const it of items) {
      const ic = byId[it.type];
      if (W.isWall(it) || it.type === 'floor' || OPENINGS[it.type] || ic.ownLabel || it.type === 'hill' || it.type === 'slope') continue; // hills / slopes: site.terrain
      const info = OBJECTS[it.type];
      let desc = info ? info[1] : ic.name.toLowerCase(), height = info ? info[0] : 75, mat = info ? info[2] : null;
      if (ic.table) {
        const seats = ic.chairs.length - (it.type === 'desk-computer' ? 1 : 0);
        if (!info) desc = `${ic.table.round ? 'round/oval' : 'rectangular'} dining table with ${seats} chairs`;
        height = 75; mat = mat || 'wood table, wooden chairs';
      }
      if (height == null) height = it.wh || plan.wallH || 300; // columns
      if (ic.height) height = it.fh || ic.height;              // fences, hedge, gate: their set height
      let stairs = null;
      if (ic.stairs) {
        const ST = window.FP_STAIRS, n = ST.stepsOf(it.type, it), lay = ST.layout(it.type, it.w, it.h, n, it);
        const rise = FP.stairRise ? FP.stairRise(it) : it.rise || FP.storeyRise(it);
        height = rise;
        stairs = { steps: n, risers: lay.risers, totalRise: rise, riserHeight: r1(rise / lay.risers), going: r1(lay.going),
          landing: lay.risers > n, ...(lay.turn ? { turnDegrees: lay.turn } : {}), topLanding: lay.topLanding ? { depth: r1(lay.topLanding), width: r1(lay.treads.find((t) => t[5] === 'top')[3]) } : lay.topLandingAngle ? { angle: lay.topLandingAngle } : undefined, startAboveFloor: r1(it.z || 0),
          handrail: (it.rail || 'none') === 'none' ? 'none' : `${it.rail === 'both' ? 'both sides' : it.rail + ' side (walking up)'}, ${{ wood: 'wood rail and balusters', metal: 'stainless steel rail and balusters', glass: 'glass panels with a stainless steel rail', bars: 'stainless steel posts with horizontal bar infill' }[it.railStyle || 'wood']}, ${it.railH || 90} cm high`, underneath: { solid: 'solid, filled down to the floor', closed: 'closed risers on a sloping underside, open space beneath', open: 'open risers, floating treads on side stringers', mono: 'open risers, thick wooden treads on a central steel mono-stringer', columns: `hollow underneath: steps on a sloping waist slab carried by columns, the lowest ${it.solidSteps == null ? 3 : it.solidSteps} steps solid` }[it.under || 'solid'] || 'solid', upDirection: it.type === 'stairs-h' ? compass([Math.cos((it.r * Math.PI) / 180) * (it.fx ? -1 : 1), Math.sin((it.r * Math.PI) / 180) * (it.fx ? -1 : 1)]) : undefined };
        desc = `${desc}, ${n} steps of ${stairs.riserHeight} cm rising ${rise} cm`;
      }
      const c = centre(it);
      const ob = {
        id: `obj-${it.id}`, itemId: it.id, type: it.type, category: ic.cat, name: name(it), description: desc,
        center: pt(c), size: { width: r1(it.w), depth: r1(it.h), height }, rotation: r1(it.r),
        colour: tidyColour(it.fillNone ? '' : it.fill) || null, materialHint: mat, room: roomAt(c[0], c[1]),
        baseElevation: /^column|pillar/.test(it.type) ? 0 : r1(EL.at(c[0], c[1]) + (it.z || 0)), // on the finished floor, or it.z above it
      };
      if (it.type === 'ceiling-fan') ob.mountedAt = 'ceiling';
      if (it.type === 'slab') {
        // the floor structure of its level, resting on the walls of the level below (elevations made absolute by buildScene)
        const S = FP.slabInfo(it), t = S.t, wood = (it.slabType || 'wood') !== 'concrete', rel = (v) => r1(v - S.L.elev);
        const lname = S.L.name.toLowerCase();
        ob.size.height = t;
        ob.materialHint = wood ? 'timber joists with OSB subfloor' + (it.ceiling !== false ? ' and gypsum-board ceiling' : '') : 'reinforced concrete';
        ob.slab = { construction: wood ? 'wood-frame' : 'concrete', thickness: t, floorOf: S.L.id, undersideRelative: rel(S.bottom), topRelative: rel(S.top),
          restsOn: S.walls.length ? S.below.id : 'ground',
          outline: (() => { const pl = FP.slabPoly(it); if (!pl) return null; const tf = W.toWorld(it); return pl.map((q) => pt(tf(q))); })(), supportedByWallItems: S.walls.map((u) => u.item.id), openings: FP.slabOpenings(it).map((o) => `obj-${o.id}`) };
        if (wood) Object.assign(ob.slab, { joists: { width: 5, spacing: 40, depth: r1(t - 2.5 - (it.ceiling !== false ? 1.5 : 0)), span: it.w <= it.h ? 'x' : 'y' },
          subfloor: { material: 'OSB', thickness: 2.5 }, ceilingBoard: it.ceiling !== false ? { material: 'gypsum', thickness: 1.5 } : null });
        ob.baseElevation = rel(S.bottom);
        ob.description = `${wood ? 'wood-frame floor structure (timber joists every 40 cm, OSB subfloor' + (it.ceiling !== false ? ', gypsum ceiling' : '') + ')'
          : 'reinforced-concrete floor slab'}, ${t} cm thick — the floor of the ${lname}` +
          (S.walls.length ? `, set within the walls (not over them) and bearing on the walls of the ${S.below.name.toLowerCase()}` : ', set within the walls on the ground under it');
      }
      if (ic.roof) {
        // roof: eaves on the wall tops, rise from the style and pitch (elevations made absolute by buildScene)
        const st = ic.roof, pitch = it.pitch == null ? (st === 'shed' || st === 'butterfly' ? 10 : 30) : it.pitch;
        const ov = it.overhang == null ? 40 : it.overhang, lv = FP.levels().find((l) => l.id === FP.levelOf(it)) || { elev: 0 };
        const eaves = FP.roofBase(it) - lv.elev, rise = window.FP_ROOFS.rise(st, it.w, it.h, pitch);
        ob.roof = { style: st, pitch: st === 'flat' ? null : pitch, overhang: ov, eavesRelative: r1(eaves), ridgeRelative: r1(eaves + rise),
          ridgeDirection: compass([Math.cos((it.r * Math.PI) / 180), Math.sin((it.r * Math.PI) / 180)]) };
        ob.baseElevation = r1(eaves); ob.size.height = r1(rise);
        const RM = window.FP_WALLMATS.ROOF_MATS, rmat = RM[it.roofMat] ? it.roofMat : null;
        ob.materialHint = rmat ? `${RM[rmat].name.toLowerCase()}, colour ${tidyColour(it.fill) || RM[rmat].color}` : 'roofing';
        ob.roof.covering = rmat;
        ob.description = `${byId[it.type].name.toLowerCase()}${st === 'flat' ? '' : `, ${pitch}° pitch`}, ${r1(ov)} cm overhang, covering ${r1(it.w / 100)} × ${r1(it.h / 100)} m, eaves on the wall tops`;
        if (ic.roofFence) {
          const fh = it.roofFence == null ? 50 : it.roofFence, fs = { rail: 'metal railing with upright bars', glass: 'glass-panel railing', solid: 'solid rendered parapet wall' }[it.fenceStyle || 'rail'];
          ob.roof.fence = { height: r1(fh), style: it.fenceStyle || 'rail' };
          ob.description += `, with a ${r1(fh / 100)} m high ${fs} round its edge (a roof terrace)`;
        }
      }
      if (it.type === 'slab-opening') {
        // which levels the void connects, and its railing
        const lv = FP.levels(), mine = lv.find((l) => l.id === FP.levelOf(it)) || { elev: 0, name: 'this level' };
        const below = lv.filter((l) => l.elev < mine.elev).sort((a, b) => b.elev - a.elev)[0];
        const rail = it.rail || '3';
        ob.connects = { from: below ? below.id : null, to: mine.id };
        ob.railing = rail === 'none' ? 'none' : `${rail} sides, 100 cm`;
        ob.description = `opening in the floor slab of the ${mine.name.toLowerCase()} connecting it with ${below ? `the ${below.name.toLowerCase()} below` : 'the level below'}` +
          `${rail === 'none' ? '' : `, guarded by a metal railing on ${rail} sides (open on the stair side)`}`;
        ob.size.height = 0;
      }
      if (!ob.room) ob.outdoorArea = outdoorAt(c[0], c[1]);
      if (stairs) ob.stairs = stairs;
      if (/^column|pillar/.test(it.type)) ob.material = { id: it.wmat || 'plaster', name: WM.MATS[it.wmat || 'plaster'].name, colour: tidyColour(it.wcol || WM.MATS[it.wmat || 'plaster'].color) };
      objects.push(ob);
    }

    // rooms: name them from what is inside (unless the floor has a label)
    const rooms = roomShapes.map(({ f, rings }) => {
      const id = 'room-' + f.id;
      const inside = objects.filter((o) => o.room === id).map((o) => o.type);
      const has = (...t) => t.some((x) => inside.includes(x));
      const guess = has('toilet', 'bathtub', 'shower', 'washbasin') ? 'Bathroom'
        : has('stove', 'range', 'fridge', 'sink', 'sink-double', 'dishwasher') ? 'Kitchen'
          : has('bed-double', 'bed-single') ? 'Bedroom'
            : has('sofa', 'loveseat', 'tv', 'tv-stand', 'armchair', 'fireplace') ? 'Living room'
              : inside.some((t) => t.startsWith('table-')) ? 'Dining room'
                : has('desk', 'desk-computer', 'desk-corner', 'desk-l', 'office-chair') ? 'Office'
                  : has('stairs-h', 'stairs-l', 'stairs-u', 'stairs-spiral') ? 'Hall / stairs' : 'Room';
      const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
      const mat = FM[f.material] || FM.solid;
      return {
        id, itemId: f.id, name: f.label || guess, nameGuessed: !f.label,
        floor: { material: f.material || 'solid', materialName: mat.name, colour: tidyColour(f.fill || mat.color) },
        elevation: f.elev || 0, // finished floor level above the ground (±0)
        floorSlab: FP.slabUnder(f) ? `obj-${FP.slabUnder(f).id}` : null, // the floor slab carrying it
        area: r1(FP.floorArea(f) * 100) / 100,
        bounds: { x: r1(Math.min(...xs)), y: r1(Math.min(...ys)), width: r1(Math.max(...xs) - Math.min(...xs)), depth: r1(Math.max(...ys) - Math.min(...ys)) },
        outline: rings[0].map(pt), holes: rings.slice(1).map((r) => r.map(pt)),
        ceilingHeight: plan.wallH || 300,
      };
    });
    // number repeated names: Bedroom, Bedroom 2 …
    const seen = {};
    for (const r of rooms) { seen[r.name] = (seen[r.name] || 0) + 1; if (seen[r.name] > 1) r.name += ' ' + seen[r.name]; }

    // garden areas: outdoor surfaces (lawn, paving, decking …)
    const outdoorAreas = gardenShapes.map(({ f, rings }) => {
      const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
      const mat = FM[f.material] || FM.grass;
      return {
        id: 'garden-' + f.id, itemId: f.id, name: f.label || `${mat.name} area`,
        surface: { material: f.material, materialName: mat.name, colour: tidyColour(f.fill || mat.color) },
        area: r1(FP.floorArea(f) * 100) / 100, elevation: f.elev || 0,
        // laid directly on solid ground, or (partly) on a slab poured over a basement
        base: (() => { const B = FP.gardenBase(f); return B.rect ? { over: B.over.id, part: { width: B.rect.w, depth: B.rect.h }, slab: B.slab ? `obj-${B.slab.id}` : null } : 'solid ground'; })(),
        bounds: { x: r1(Math.min(...xs)), y: r1(Math.min(...ys)), width: r1(Math.max(...xs) - Math.min(...xs)), depth: r1(Math.max(...ys) - Math.min(...ys)) },
        outline: rings[0].map(pt), holes: rings.slice(1).map((r) => r.map(pt)),
      };
    });

    const annotations = items.filter((i) => byId[i.type].ownLabel).map((i) => ({
      id: `dim-${i.id}`, type: 'dimension', text: i.label || `${Math.round(Math.max(i.w, i.h))} cm`, center: pt(centre(i)),
    }));

    return { rooms, outdoorAreas, walls, openings, objects, annotations };
  }

  /* The whole plan: every level, with all elevations made absolute (level elevation + heights on that level). */
  function buildScene() {
    const plan = FP.plan(), byId = FP.byId;
    const levels = [...FP.levels()].sort((a, b) => a.elev - b.elev);
    const acc = { rooms: [], outdoorAreas: [], walls: [], openings: [], objects: [], annotations: [] };
    const levelInfo = [];
    for (const L of levels) {
      const items = FP.items().filter((it) => FP.levelOf(it) === L.id);
      const p = buildLevel(items), e = L.elev, add = (v) => r1((v || 0) + e);
      for (const r of p.rooms) { r.level = L.id; r.elevation = add(r.elevation); }
      for (const a of p.outdoorAreas) { a.level = L.id; a.elevation = add(a.elevation); }
      for (const w of p.walls) { w.level = L.id; w.baseElevation = add(w.baseElevation); w.topElevation = add(w.topElevation); }
      for (const o of p.openings) { o.level = L.id; o.floorLevel = add(o.floorLevel); if (o.sillElevation != null) o.sillElevation = add(o.sillElevation); }
      for (const o of p.objects) { o.level = L.id; o.baseElevation = add(o.baseElevation); }
      for (const a of p.annotations) a.level = L.id;
      for (const k of Object.keys(acc)) acc[k].push(...p[k]);
      levelInfo.push({ id: L.id, name: L.name, elevation: L.elev, rooms: p.rooms.length, objects: items.length });
    }
    // the same room name on several levels gets the level name added
    if (levels.length > 1) {
      const counts = {};
      for (const r of acc.rooms) counts[r.name] = (counts[r.name] || 0) + 1;
      for (const r of acc.rooms) if (counts[r.name] > 1) r.name += ` (${levelInfo.find((l) => l.id === r.level).name})`;
    }
    const { rooms, outdoorAreas, walls, openings, objects, annotations } = acc;
    const all = FP.items().filter((i) => !byId[i.type].ownLabel);
    const b = all.length ? FP.bbox(all) : { x: 0, y: 0, w: 0, h: 0 };
    return {
      format: 'floorplan2027.scene', version: 1, generator: 'Floor Plan 2027', generated: new Date().toISOString(),
      title: plan.title,
      units: { length: 'cm', area: 'm²', angle: 'degrees' },
      coordinateSystem: {
        origin: 'plan origin (0,0)', x: 'to the right on the plan (east)', y: 'down the plan (south)',
        z: 'height above the outside ground level (±0). Elevations are absolute; sill/top/door heights are measured from the finished floor (floorLevel)',
        north: 'top of the plan (assumed)', rotation: 'degrees clockwise seen from above; 0 = as drawn on the plan',
        sizes: 'width = along the object\'s own x axis, depth = along its own y axis, height = z',
      },
      extent: { x: r1(b.x), y: r1(b.y), width: r1(b.w), depth: r1(b.h) },
      defaults: { wallHeight: plan.wallH || 300, doorHeight: DOOR_H, windowSill: SILL_H, windowTop: HEAD_H },
      site: { ground: plan.ground || 'plain', description: SITES[plan.ground || 'plain'],
        // terrain: elliptical hills / hollows shaping the ground (heights in cm at their middle, smooth to ±0 at the edge)
        terrain: FP.items().filter((i) => i.type === 'hill' && (i.hillH || 0) !== 0).map((h) => ({
          id: `hill-${h.id}`, kind: h.hillH > 0 ? 'hill' : 'hollow', center: pt([h.x + h.w / 2, h.y + h.h / 2]),
          size: { width: r1(h.w), depth: r1(h.h) }, rotation: r1(h.r), height: r1(h.hillH), profile: h.hillShape || 'round',
          description: `${h.hillH > 0 ? 'grassy hill' : 'hollow'} ${r1(Math.abs(h.hillH) / 100)} m ${h.hillH > 0 ? 'high' : 'deep'}, ${r1(h.w / 100)} × ${r1(h.h / 100)} m elliptical footprint, ${({ round: 'rounded', plateau: 'flat-topped', peak: 'peaked', ramp: 'evenly sloped' })[h.hillShape || 'round']}, blending smoothly into the surrounding ground` }))
          .concat(FP.items().filter((i) => i.type === 'slope').map((sl) => {
            const H = sl.slopeH == null ? 100 : sl.slopeH, m = sl.blend == null ? 200 : sl.blend, tf = W.toWorld(sl);
            return { id: `slope-${sl.id}`, kind: 'slope', center: pt([sl.x + sl.w / 2, sl.y + sl.h / 2]), size: { width: r1(sl.w), length: r1(sl.h) },
              rotation: r1(sl.r), highEdge: [pt(tf([0, 0])), pt(tf([sl.w, 0]))], highEdgeHeight: r1(H), sideBlend: r1(m),
              description: `sloped ground ${r1(sl.w / 100)} m wide, falling evenly over ${r1(sl.h / 100)} m from ${r1(H / 100)} m at its high edge to the ground at its low edge; its sides blend smoothly into the surrounding ground over ${r1(m / 100)} m, and it stops sharply where it meets a wall` };
          })) },
      summary: {
        levels: levelInfo.length,
        rooms: rooms.length, totalFloorArea: r1(rooms.reduce((s, r) => s + r.area, 0) * 100) / 100,
        wallPieces: walls.length, doors: openings.filter((o) => o.kind === 'door').length,
        windows: openings.filter((o) => o.kind === 'window').length, objects: objects.length,
        outdoorAreas: outdoorAreas.length, outdoorArea: r1(outdoorAreas.reduce((s, a) => s + a.area, 0) * 100) / 100,
      },
      // storeys, lowest first; elevation = relative to the ground floor (±0)
      levels: levelInfo,
      rooms, outdoorAreas, walls, openings, objects, annotations,
    };
  }

  /* ───────────── Markdown ───────────── */
  const cell = (v) => String(v == null || v === '' ? '—' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const table = (head, rows) => rows.length
    ? `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')}\n`
    : '_None._\n';
  const matText = (m) => `${m.name.toLowerCase()} (${m.colour})`;

  function prompt(scene) {
    const parts = [];
    const S = scene.summary;
    parts.push(`Photorealistic 3D architectural visualisation of "${scene.title}", a floor plan of about ${m2(scene.extent.width)} × ${m2(scene.extent.depth)}` +
      (S.rooms ? ` with ${S.rooms} room${S.rooms === 1 ? '' : 's'} (${S.totalFloorArea} m² of floor)` : '') +
      `, ceiling height ${m2(scene.defaults.wallHeight)}.`);
    if (scene.levels.length > 1) {
      parts.push(`The building has ${scene.levels.length} levels: ${scene.levels.map((l) => `${l.name.toLowerCase()} at ${elevText(l.elevation)}`).join(', ')}` +
        `${scene.levels.some((l) => l.elevation < 0) ? ' (the basement is below ground)' : ''}.`);
    }
    for (const r of scene.rooms) {
      const facing = scene.walls.flatMap((w) => w.faces.filter((f) => f.rooms.includes(r.id)).map((f) => f.material));
      const wallMats = [...new Set(facing.map(matText))];
      const things = scene.objects.filter((o) => o.room === r.id).map((o) => o.description.split(' (')[0]);
      const wins = scene.openings.filter((o) => o.kind === 'window' && (o.connects || []).includes(r.id));
      parts.push(`The ${r.name.toLowerCase()} (${m2(r.bounds.width)} × ${m2(r.bounds.depth)}) has a ${r.floor.materialName.toLowerCase()} floor in ${r.floor.colour}` +
        (r.elevation > 0 ? ` raised ${r.elevation} cm above the outside ground (doors start at the raised floor level)` : '') +
        (wallMats.length ? `, walls finished in ${wallMats.join(' and ')}` : '') +
        (things.length ? `, and contains ${[...new Set(things)].join(', ')}` : '') +
        (wins.length ? `; daylight enters through ${wins.length} window${wins.length === 1 ? '' : 's'} (${[...new Set(wins.map((w) => w.description))].join(', ')})` : '') + '.');
    }
    const ext = [...new Set(scene.walls.flatMap((w) => w.faces.filter((f) => !f.rooms.length).map((f) => matText(f.material))))];
    if (ext.length) parts.push(`Exterior wall finish: ${ext.join(', ')}.`);
    if (scene.outdoorAreas && scene.outdoorAreas.length) {
      parts.push(`Garden surfaces: ${scene.outdoorAreas.map((a) => {
        const things = scene.objects.filter((o) => o.outdoorArea === a.id).map((o) => o.description.split(' (')[0].split(',')[0]);
        return `${a.surface.materialName.toLowerCase()} (${a.area} m²${things.length ? ` with ${[...new Set(things)].join(', ')}` : ''})`;
      }).join('; ')}.`);
    }
    if (scene.site && scene.site.ground !== 'plain') parts.push(`Surroundings: ${scene.site.description}.`);
    parts.push('Keep every dimension, position and material exactly as listed in the scene data. Soft natural daylight, realistic materials and shadows, eye-level or three-quarter aerial view, no text or labels in the image.');
    return parts.join(' ');
  }

  function toMarkdown(scene) {
    const roomName = (id) => (scene.rooms.find((r) => r.id === id) || {}).name || (id ? id : 'outside');
    const S = scene.summary;
    let md = `# ${scene.title} — 3D scene description\n\n`;
    md += `Generated by ${scene.generator} on ${new Date(scene.generated).toLocaleString()}. ` +
      `All lengths are in **centimetres** unless marked (m = metres). Plan coordinates: x to the right (east), y down the plan (south), z up; the top of the plan is taken as **north**. ` +
      `The complete data is in the JSON block at the end of this file (format \`${scene.format}\`, version ${scene.version}).\n\n`;

    md += `## Overview\n\n`;
    md += `- **Footprint:** ${m2(scene.extent.width)} × ${m2(scene.extent.depth)}\n`;
    if (scene.levels.length > 1) md += `- **Levels:** ${scene.levels.map((l) => `${l.name} (${elevText(l.elevation)}, ${l.objects} objects)`).join(' · ')}\n`;
    md += `- **Rooms:** ${S.rooms}${S.rooms ? ` — total floor area ${S.totalFloorArea} m²` : ' (no floors laid — use “Fill floor” to define rooms)'}\n`;
    md += `- **Walls:** ${S.wallPieces} straight pieces, default height ${scene.defaults.wallHeight} cm\n`;
    md += `- **Doors:** ${S.doors} · **Windows:** ${S.windows} · **Furniture & objects:** ${S.objects}\n`;
    if (S.outdoorAreas) md += `- **Outdoor areas:** ${S.outdoorAreas} (${S.outdoorArea} m²): ${scene.outdoorAreas.map((a) => `${a.surface.materialName.toLowerCase()} ${a.area} m²`).join(', ')}\n`;
    md += `- **Surroundings:** ${scene.site.description}\n\n`;

    const multi = scene.levels.length > 1, levelName = (id) => (scene.levels.find((l) => l.id === id) || {}).name || '';
    for (const r of scene.rooms) {
      md += `## ${r.name}${multi && !r.name.includes(levelName(r.level)) ? ` — ${levelName(r.level)}` : ''}\n\n`;
      md += `- **Size:** ${m2(r.bounds.width)} × ${m2(r.bounds.depth)} (bounding box), floor area **${r.area} m²**, ceiling ${r.ceilingHeight} cm\n`;
      md += `- **Floor:** ${r.floor.materialName}, colour ${r.floor.colour}\n`;
      md += `- **Floor level:** ${r.elevation ? `${r.elevation > 0 ? '+' : ''}${r.elevation} cm above the outside ground (${r.floorSlab ? `finish on floor slab ${r.floorSlab}` : 'raised solid base'})` : '±0 (ground level)'}\n`;
      const faces = scene.walls.flatMap((w) => w.faces.filter((f) => f.rooms.includes(r.id)).map((f) => ({ w, f })));
      if (faces.length) {
        md += `- **Walls:**\n`;
        for (const { w, f } of faces) {
          // the face looks into the room, so the wall stands on the opposite side
          const side = compass([-f.normal[0], -f.normal[1]]);
          md += `  - ${side} wall (${w.name}, ${m2(w.length)} long, ${w.thickness} cm thick, ${w.height} cm high): ${f.material.name}, ${f.material.colour}` +
            `${w.openings.length ? ` — openings: ${w.openings.join(', ')}` : ''}\n`;
        }
      }
      const ops = scene.openings.filter((o) => (o.connects || []).includes(r.id) || o.swingsInto === r.id);
      for (const o of ops) {
        md += `- **${o.kind === 'window' ? 'Window' : 'Door'} ${o.id}:** ${o.description}, ${o.width} cm wide` +
          (o.kind === 'window' ? `, from ${o.sillHeight} to ${o.topHeight} cm above the floor, ${o.frameColour} frame` : `, ${o.height} cm high`) +
          (o.kind === 'door' && o.floorLevel ? `, threshold at ${o.floorLevel > 0 ? '+' : ''}${o.floorLevel} cm (finished floor level)` : '') +
          (o.connects && o.connects.length > 1 ? ` — connects ${o.connects.map(roomName).join(' and ')}` : o.kind === 'door' && o.connects && o.connects.length === 1 ? ' — leads outside' : '') + '\n';
      }
      const objs = scene.objects.filter((o) => o.room === r.id);
      if (objs.length) {
        md += `- **Furniture & objects:**\n`;
        for (const o of objs) {
          md += `  - ${o.name}: ${o.description}; ${o.size.width} × ${o.size.depth} × ${o.size.height} cm` +
            `${o.rotation ? `, rotated ${o.rotation}°` : ''}${o.colour && o.colour !== '#ffffff' ? `, colour ${o.colour}` : ''}${o.materialHint ? ` (${o.materialHint})` : ''}` +
            ` at (${o.center[0]}, ${o.center[1]})\n`;
        }
      }
      md += '\n';
    }

    if (scene.outdoorAreas.length) {
      md += `## Outdoor areas\n\n`;
      for (const a of scene.outdoorAreas) {
        const objs = scene.objects.filter((o) => o.outdoorArea === a.id);
        md += `- **${a.name}:** ${a.surface.materialName}, colour ${a.surface.colour}, ${a.area} m² ` +
          `(${m2(a.bounds.width)} × ${m2(a.bounds.depth)})${a.elevation ? `, raised ${a.elevation} cm` : ''}` +
          `${objs.length ? ` — with ${objs.map((o) => `${o.name} (${o.description.split(' (')[0]})`).join(', ')}` : ''}\n`;
      }
      md += '\n';
    }
    const loose = scene.objects.filter((o) => !o.room && !o.outdoorArea);
    if (scene.rooms.length && loose.length) md += `## Outside the rooms\n\n${loose.map((o) => `- ${o.name}: ${o.description} at (${o.center[0]}, ${o.center[1]})`).join('\n')}\n\n`;

    md += `## Walls\n\nEach wall piece is a straight box from *start* to *end* (centreline). Faces are listed with the direction they face and the room they look into.\n\n`;
    md += table(['Wall', 'Start → end (cm)', 'Length', 'Thick.', 'Height', 'Faces (facing: material → room)', 'Openings'],
      scene.walls.map((w) => [w.id + ' · ' + w.name + (multi ? ` · ${levelName(w.level)}` : ''), `(${w.start}) → (${w.end})`, w.length, w.thickness, w.height,
        w.faces.map((f) => `${f.label}/${f.facing}: ${f.material.name} ${f.material.colour} → ${f.rooms.length ? f.rooms.map(roomName).join(' + ') : 'outside'}`).join('; '),
        w.openings.join(', ')]));

    md += `\n## Doors and windows\n\n`;
    md += table(['Id', 'Type', 'Width', 'Height', 'Floor level', 'Sill / top', 'Centre (x, y)', 'Wall', 'Details'],
      scene.openings.map((o) => [o.id, o.description, o.width, o.height, `${o.floorLevel > 0 ? '+' : ''}${o.floorLevel}`, o.kind === 'window' ? `${o.sillHeight} / ${o.topHeight}` : '—',
        `(${o.center})`, o.wall || 'free-standing',
        [o.frameColour ? `frame ${o.frameColour}` : '', o.swingDirection ? `swings ${o.swingDirection}${o.swingsInto ? ' into ' + roomName(o.swingsInto) : ''}` : '',
          o.connects && o.connects.length ? `connects ${o.connects.map(roomName).join(' ↔ ')}` : ''].filter(Boolean).join('; ')]));

    md += `\n## Furniture and objects\n\n`;
    md += table(['Id', 'Object', 'W × D × H (cm)', 'Centre (x, y)', 'Rotation', 'Colour', 'Materials', 'Room'],
      scene.objects.map((o) => [o.id, `${o.name} — ${o.description}`, `${o.size.width} × ${o.size.depth} × ${o.size.height}`, `(${o.center})`,
        `${o.rotation}°`, o.colour, o.material ? `${o.material.name} ${o.material.colour}` : o.materialHint, roomName(o.room)]));

    md += `\n## Rendering prompt\n\nCopy this into an image or 3D generator, together with the data below:\n\n> ${prompt(scene)}\n\n`;
    md += `## Machine-readable data\n\nThe same scene as JSON (all lengths in cm). Programs can parse the block below directly.\n\n`;
    md += '```json\n' + JSON.stringify(withPrompt(scene), null, 2) + '\n```\n';
    return md;
  }

  // the data written to both files: the scene plus the ready-made prompt, so .md and .json carry the same JSON
  const withPrompt = (scene) => ({ ...scene, renderingPrompt: prompt(scene) });

  // format: 'md' = readable Markdown with the JSON inside, 'json' = the scene data only
  function exportForAI(format = 'md') {
    if (!FP.items().length) return FP.toast('The plan is empty — add walls, floors and furniture first.', 'error');
    const scene = buildScene();
    if (format === 'json') {
      FP.download(`${FP.fileName()}-scene.json`, new Blob([JSON.stringify(withPrompt(scene), null, 2)], { type: 'application/json;charset=utf-8' }));
    } else {
      FP.download(`${FP.fileName()}-scene.md`, new Blob([toMarkdown(scene)], { type: 'text/markdown;charset=utf-8' }));
    }
    FP.toast(`Exported ${format === 'json' ? 'JSON' : 'Markdown'}: ${scene.summary.rooms} room${scene.summary.rooms === 1 ? '' : 's'}, ` +
      `${scene.summary.wallPieces} walls, ${scene.summary.doors + scene.summary.windows} doors/windows and ${scene.summary.objects} objects.`);
  }

  // the File drop-down in the top bar: New / Open / Save / Export SVG / Export PNG / Export for AI
  // (data-act items are run by app.js's click handler; data-ai items are run here)
  const btn = document.getElementById('btnFile'), menu = document.getElementById('fileMenu');
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const setMenu = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) items()[0].focus(); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setMenu(true); } });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[role="menuitem"]');
    if (!b) return;
    setMenu(false);
    if (b.dataset.ai) exportForAI(b.dataset.ai);
  });
  menu.addEventListener('keydown', (e) => {
    const list = items(), i = list.indexOf(document.activeElement);
    let n = -1;
    if (e.key === 'ArrowDown') n = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') n = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    else if (e.key === 'Tab') { setMenu(false); return; }
    if (n < 0) return;
    e.preventDefault(); list[n].focus();
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('#fileMenuWrap')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopImmediatePropagation(); setMenu(false); btn.focus(); } }, true);
  window.FPAIExport = { buildScene, toMarkdown, prompt, exportForAI, heightOf: (type) => (OBJECTS[type] && OBJECTS[type][0]) || null };
})();
