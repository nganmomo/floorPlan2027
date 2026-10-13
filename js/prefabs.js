/* Prefabs: ready-made groupings of objects (a garage, a kitchen, a bathroom …) placed in one go from the "Prefab" tab.
 * Once placed they are ordinary objects tied together as a group (item.grp): a click selects the whole group, so it moves
 * and turns as one; Alt+click picks one object of it, and objects can be added to or taken out of the group.
 *
 * Each prefab: { id, name, cat, w, h, note, items } — w × h is its outline (cm). An item is
 * [type, cx, cy, r = 0, extra = {}]: cx, cy = the centre of the object in the prefab, r = its turn in degrees,
 * extra = its own size (w, h) or settings (label …). Furniture icons have their back at the top, so r = 180 puts the
 * back at the bottom, 90 on the right and −90 on the left. Walls, doors and windows are the shell (optional on placing).
 */
(function () {
  const PREFABS = [
    {
      id: 'garage-single', name: 'Garage (single)', cat: 'Garage', w: 360, h: 600,
      note: 'A car, sectional door, side door, workbench and shelving',
      items: [
        ['room', 180, 300, 0, { w: 360, h: 600 }],
        ['garage-door', 180, 592.5],
        ['door', 100, 60, 180],
        ['window', 352.5, 300, 90],
        ['storage', 280, 45, 0, { label: 'Storage cabinet' }],
        ['bookshelf', 32.5, 200, -90, { label: 'Shelving' }],
        ['bookshelf', 32.5, 330, -90, { label: 'Shelving' }],
        ['desk', 50, 480, -90, { label: 'Workbench' }],
        ['car', 180, 330],
      ],
    },
    {
      id: 'garage-double', name: 'Garage (double)', cat: 'Garage', w: 600, h: 600,
      note: 'Two cars, two sectional doors, side door, workbench and storage',
      items: [
        ['room', 300, 300, 0, { w: 600, h: 600 }],
        ['garage-door', 160, 592.5],
        ['garage-door', 440, 592.5],
        ['door', 100, 60, 180],
        ['window', 592.5, 300, 90],
        ['storage', 300, 45, 0, { label: 'Storage cabinet' }],
        ['storage', 400, 45, 0, { label: 'Storage cabinet' }],
        ['bookshelf', 32.5, 200, -90, { label: 'Shelving' }],
        ['bookshelf', 32.5, 330, -90, { label: 'Shelving' }],
        ['desk', 50, 480, -90, { label: 'Workbench' }],
        ['car', 175, 330],
        ['car', 430, 330, 0, { fill: '#c9cdd2' }],
      ],
    },
    {
      id: 'kitchen-l', name: 'Kitchen (L-shaped)', cat: 'Kitchen', w: 420, h: 300,
      note: 'Fridge, worktops, sink, dishwasher, range and a table for four',
      items: [
        ['room', 210, 150, 0, { w: 420, h: 300 }],
        ['fridge', 50, 50],
        ['counter', 175, 45],
        ['sink', 305, 45],
        ['dishwasher', 375, 45],
        ['range', 375, 120, 90],
        ['counter', 375, 225, 90, { w: 120 }],
        ['window', 305, 7.5, 0, { w: 80 }],
        ['door', 60, 230, 90],
        ['table-sq4', 200, 195],
      ],
    },
    {
      id: 'dining', name: 'Dining room', cat: 'Kitchen', w: 440, h: 320,
      note: 'Table for six, sideboard and a plant',
      items: [
        ['room', 220, 160, 0, { w: 440, h: 320 }],
        ['table-rect6', 200, 165],
        ['storage', 200, 37.5, 0, { w: 160, h: 45, label: 'Sideboard' }],
        ['plant', 385, 55],
        ['window', 432.5, 160, 90],
        ['door', 375, 260],
      ],
    },
    {
      id: 'bathroom', name: 'Bathroom', cat: 'Bathroom', w: 250, h: 300,
      note: 'Bathtub, toilet, washbasin and washing machine',
      items: [
        ['room', 125, 150, 0, { w: 250, h: 300 }],
        ['bathtub', 100, 52.5],
        ['toilet', 200, 150, 90],
        ['washbasin', 212.5, 230, 90],
        ['washer', 45, 150, -90],
        ['window', 205, 7.5, 0, { w: 60 }],
        ['door', 65, 240],
      ],
    },
    {
      id: 'shower-room', name: 'Shower room', cat: 'Bathroom', w: 220, h: 240,
      note: 'Walk-in shower, toilet and washbasin',
      items: [
        ['room', 110, 120, 0, { w: 220, h: 240 }],
        ['shower', 60, 60],
        ['toilet', 170, 60, 90],
        ['washbasin', 182.5, 140, 90],
        ['window', 150, 7.5, 0, { w: 60 }],
        ['door', 65, 180],
      ],
    },
    {
      id: 'living', name: 'Living room', cat: 'Living & bedroom', w: 500, h: 400,
      note: 'Sofa, two armchairs, rug, TV on a stand, bookshelf and a plant',
      items: [
        ['room', 250, 200, 0, { w: 500, h: 400 }],
        ['tv-stand', 250, 37.5],
        ['tv', 250, 25],
        ['rug', 250, 200],
        ['sofa', 250, 340, 180],
        ['armchair', 70, 190, -90],
        ['armchair', 430, 190, 90],
        ['bookshelf', 32.5, 320, -90],
        ['plant', 445, 60],
        ['window', 110, 7.5],
        ['window', 390, 7.5],
        ['door', 440, 330, -90],
      ],
    },
    {
      id: 'bedroom', name: 'Bedroom (double)', cat: 'Living & bedroom', w: 400, h: 400,
      note: 'Double bed, two nightstands, wardrobes and a desk',
      items: [
        ['room', 200, 200, 0, { w: 400, h: 400 }],
        ['bed-double', 220, 115],
        ['storage', 115, 35, 0, { w: 45, h: 40, label: 'Nightstand' }],
        ['storage', 325, 35, 0, { w: 45, h: 40, label: 'Nightstand' }],
        ['storage', 230, 355, 180, { label: 'Wardrobe' }],
        ['storage', 330, 355, 180, { label: 'Wardrobe' }],
        ['desk', 50, 220, -90],
        ['office-chair', 108, 220],
        ['window', 392.5, 200, 90],
        ['door', 65, 340],
      ],
    },
    {
      id: 'kids-room', name: 'Children\'s room', cat: 'Living & bedroom', w: 340, h: 360,
      note: 'Single bed, desk, wardrobe, bookshelf and a rug',
      items: [
        ['room', 170, 180, 0, { w: 340, h: 360 }],
        ['bed-single', 60, 115],
        ['storage', 145, 35, 0, { w: 45, h: 40, label: 'Nightstand' }],
        ['desk', 255, 50],
        ['office-chair', 255, 115],
        ['storage', 275, 315, 180, { label: 'Wardrobe' }],
        ['bookshelf', 307.5, 200, 90],
        ['rug', 200, 225, 0, { w: 150, h: 100 }],
        ['window', 255, 7.5],
        ['door', 65, 300],
      ],
    },
    {
      id: 'office', name: 'Home office', cat: 'Living & bedroom', w: 300, h: 300,
      note: 'Corner desk, office chair, bookshelf and a reading chair',
      items: [
        ['room', 150, 150, 0, { w: 300, h: 300 }],
        ['desk-corner', 85, 85],
        ['office-chair', 110, 110],
        ['bookshelf', 220, 32.5],
        ['armchair', 70, 240, -90],
        ['window', 7.5, 160, 90],
        ['door', 240, 240],
      ],
    },
    /* Balconies: the balcony (its back edge at the top, against the house wall) furnished. Placed against a wall it
       turns to face out from it and gets its glass sliding door, like a balcony from the icons. */
    {
      id: 'bal-bistro', name: 'Balcony with bistro set', cat: 'Balconies', w: 300, h: 150,
      note: 'Square balcony, stainless railing, a small table with two chairs and a plant',
      thumb: { shape: 'square', guard: 'steel', furn: ['bistro', 'plants'] },
      items: [
        ['balcony', 150, 75, 0, { w: 300, h: 150, balShape: 'square', balGuard: 'steel' }],
        ['table-sq2', 150, 80, 90],
        ['plant', 30, 120, 0, { w: 40, h: 40 }],
        ['plant', 270, 120, 0, { w: 40, h: 40 }],
      ],
    },
    {
      id: 'bal-lounge', name: 'Covered lounge balcony', cat: 'Balconies', w: 400, h: 180,
      note: 'Low concrete wall with stainless rail, a roof, a sun lounger, lounge chair and plants',
      thumb: { shape: 'square', guard: 'low', roof: true, furn: ['lounge'] },
      items: [
        ['balcony', 200, 90, 0, { w: 400, h: 180, balShape: 'square', balGuard: 'low', balRoof: true, balRoofH: 260 }],
        ['lounger', 130, 110, 90],
        ['lounge-chair', 300, 95, 180],
        ['plant', 370, 145, 0, { w: 45, h: 45 }],
        ['plant', 30, 40, 0, { w: 40, h: 40 }],
      ],
    },
    {
      id: 'bal-dining', name: 'Dining balcony', cat: 'Balconies', w: 420, h: 240,
      note: 'Large all-concrete balcony with a patio table for four under a parasol',
      thumb: { shape: 'square', guard: 'concrete', furn: ['dining'] },
      items: [
        ['balcony', 210, 120, 0, { w: 420, h: 240, balShape: 'square', balGuard: 'concrete' }],
        ['garden-table', 210, 125],
        ['parasol', 210, 125, 0, { w: 200, h: 200 }],
        ['plant', 30, 210, 0, { w: 40, h: 40 }],
        ['plant', 390, 210, 0, { w: 40, h: 40 }],
      ],
    },
    {
      id: 'bal-corner', name: 'L-shaped corner balcony with sofa', cat: 'Balconies', w: 500, h: 350,
      note: 'Wraps a house corner: a 2-seat sofa, tub chair and plants; stainless railing',
      thumb: { shape: 'L', guard: 'steel', furn: ['sofa', 'plants'] },
      items: [
        ['balcony', 250, 175, 0, { w: 500, h: 350, balShape: 'L', balGuard: 'steel', balDepth: 160 }],
        ['loveseat', 170, 295, 180],
        ['tub-chair', 420, 285, -90],
        ['plant', 420, 40, 0, { w: 45, h: 45 }],
        ['plant', 30, 315, 0, { w: 40, h: 40 }],
      ],
    },
    {
      id: 'bal-laundry', name: 'Laundry balcony', cat: 'Balconies', w: 300, h: 150,
      note: 'Covered square balcony with iron rod hooks for drying clothes and a washing machine',
      thumb: { shape: 'square', guard: 'steel', roof: true, hooks: true, furn: [] },
      items: [
        ['balcony', 150, 75, 0, { w: 300, h: 150, balShape: 'square', balGuard: 'steel', balRoof: true, balHooks: true, balRoofH: 250 }],
        ['washer', 45, 40],
      ],
    },
    {
      id: 'bal-round-garden', name: 'Semi-circular garden balcony', cat: 'Balconies', w: 360, h: 180,
      note: 'Semi-circular balcony, stainless railing, a bench and potted plants',
      thumb: { shape: 'round', guard: 'steel', furn: ['plants'] },
      items: [
        ['balcony', 180, 90, 0, { w: 360, h: 180, balShape: 'round', balGuard: 'steel' }],
        ['bench', 180, 55],
        ['plant', 70, 40, 0, { w: 40, h: 40 }],
        ['plant', 290, 40, 0, { w: 40, h: 40 }],
        ['plant', 180, 140, 0, { w: 45, h: 45 }],
      ],
    },
  ];
  window.FP_PREFABS = PREFABS;
})();
