/*
 * Demo houses (top bar → Demo): sample houses the app builds step by step, in the order a house is built, so the
 * construction process can be followed with Previous / Next (js/app.js, "demo").
 *
 * Each house: { id, name, blurb, size, ground, thumb, levels?, steps: [{ title, text, ops: [...] }] }.
 * thumb: a 3D picture of the finished house for the picker (img/demo/…; made from the 3D view). levels: its storeys,
 * as a new plan has them ({ id, name, elev, wallH }, 'L0' the ground storey) — one storey when left out.
 * Lengths in cm; walls are given by their centrelines. The ops a step runs, in order:
 *   { op: 'loop', pts: [[x, y], ...], t }       outer walls round a closed outline (corners closed)
 *   { op: 'walls', list: [[x1, y1, x2, y2]], t } straight walls (partitions end on the centreline of the wall they meet)
 *   { op: 'slab', at: [x, y], kind }             floor slab filling the whole area within the outer walls round a point
 *   { op: 'place', list: [[type, x, y, r, extra]] } icons centred on (x, y), turned r°; doors and windows sit with their
 *                                                opening on (x, y) and are fitted into the wall there
 *   { op: 'lining', at: [[x, y], ...] }          10 cm interior walls lining every wall of the room round each point
 *   { op: 'floor', at: [[x, y, material], ...] } a floor laid in the room round each point
 *   { op: 'roof', type, x, y, w, h, r }          a roof over that rectangle (the outer faces of the walls), on the walls
 *   { op: 'level', id }                          go on building on another storey (the plan then shows that storey)
 *   { op: 'add', list: [[type, x, y, r, extra]] } added as from the picker — stairs climbing to the storey above, a
 *                                                stairwell cut in the slab, a balcony with its door — centred on (x, y)
 */
(function () {
  window.FP_DEMOS = [
    {
      // two storeys round a central stair hall: U-shaped stairs, a stairwell in the upper slab with a railing, a walkway
      // beside it to every upper room, a balcony, two bathrooms, a hip roof, a pool, a gravel path and a car
      id: 'family-house',
      name: 'Two-storey family house',
      blurb: 'The complete house: living and dining room, kitchen, utility room and shower room downstairs; U-shaped stairs up to two bedrooms, a bathroom and a balcony; a hip roof, a pool, a path and a parking place.',
      size: '12.2 × 9.2 m · 2 storeys · 9 rooms',
      ground: 'trees',
      thumb: 'img/demo/family-house.jpg',
      wallH: 300, slabT: 30,
      levels: [{ id: 'L0', name: 'Ground floor', elev: 0, wallH: 300 }, { id: 'L1', name: 'Upper floor', elev: 300, wallH: 280 }],
      steps: [
        { title: 'Ground floor: outer walls', text: 'The outline is set out and the ground-floor outer walls go up: 20 cm thick, closed at every corner.',
          ops: [{ op: 'loop', t: 20, pts: [[0, 0], [1200, 0], [1200, 900], [0, 900]] }] },
        { title: 'Ground slab', text: 'A concrete slab is poured inside the outer walls — one click fills the whole area they enclose.',
          ops: [{ op: 'slab', at: [225, 450], kind: 'concrete' }] },
        { title: 'Ground floor: inner walls', text: 'Partitions make a living room open to the dining area, a central stair hall, the kitchen, a utility room and a shower room.',
          ops: [{ op: 'walls', t: 10, list: [[450, 400, 450, 900], [450, 400, 800, 400], [800, 0, 800, 900], [800, 450, 1200, 450], [1000, 450, 1000, 900]] }] },
        { title: 'Ground floor: doors', text: 'The front door opens into the stair hall; doors lead to the living room, dining area, kitchen, utility and shower room; a wide sliding door opens the living room onto the garden.',
          ops: [{ op: 'place', list: [['door', 520, 900, 180], ['door', 450, 650, 90], ['door', 520, 400, 0], ['door', 800, 200, 90], ['door', 800, 860, 90], ['door', 1000, 700, 90],
            ['door-sliding', 225, 0, 0, { w: 220 }]] }] },
        { title: 'Ground floor: windows', text: 'Windows on every side: wide ones for living, dining and kitchen, small ones for the utility and shower room.',
          ops: [{ op: 'place', list: [['window', 625, 0, 0, { w: 160 }], ['window', 1000, 0, 0, { w: 180 }], ['window', 0, 250, 90, { w: 160 }], ['window', 0, 650, 90, { w: 160 }],
            ['window', 225, 900, 0, { w: 180 }], ['window', 900, 900, 0, { w: 100 }], ['window', 1100, 900, 0, { w: 60 }], ['window', 1200, 225, 90, { w: 120 }], ['window', 1200, 675, 90, { w: 80 }]] }] },
        { title: 'Stairs', text: 'U-shaped stairs are built in the hall. Their steps are worked out from the storey height: about 17 cm risers up to the upper floor.',
          ops: [{ op: 'add', list: [['stairs-u', 690, 650]] }] },
        { title: 'Upper floor slab', text: 'The upper floor slab is laid on the ground-floor walls (they are trimmed to meet it), and a stairwell is cut out over the stairs, with a railing round it.',
          ops: [{ op: 'level', id: 'L1' }, { op: 'slab', at: [225, 250], kind: 'concrete' }, { op: 'add', list: [['slab-opening', 690, 650, 0, { w: 190, h: 353, rail: '3' }]] }] },
        { title: 'Upper floor: walls', text: 'The upper outer walls stand on the ones below. Partitions make a main bedroom, a bathroom and a large children\'s room round a landing.',
          ops: [{ op: 'loop', t: 20, pts: [[0, 0], [1200, 0], [1200, 900], [0, 900]] }, { op: 'walls', t: 10, list: [[450, 0, 450, 900], [0, 500, 450, 500], [800, 0, 800, 900]] }] },
        { title: 'Upper floor: doors, windows and balcony', text: 'Doors open from the landing beside the stairwell into every room; windows go in, and a balcony with a glass sliding door is hung off the children\'s room.',
          ops: [{ op: 'place', list: [['door', 450, 250, 90], ['door', 450, 700, 90], ['door', 800, 250, 90],
            ['window', 225, 0, 0, { w: 160 }], ['window', 625, 0, 0, { w: 120 }], ['window', 0, 250, 90, { w: 140 }], ['window', 0, 700, 90, { w: 80 }],
            ['window', 225, 900, 0, { w: 100 }], ['window', 520, 900, 0, { w: 80 }], ['window', 1000, 900, 0, { w: 160 }], ['window', 1200, 450, 90, { w: 160 }]] },
            { op: 'add', list: [['balcony', 1000, -80]] }] },
        { title: 'Roof', text: 'A hip roof covers the house. Its eaves sit on the upper walls, 40 cm beyond them all round.',
          ops: [{ op: 'roof', type: 'roof-hip', x: -10, y: -10, w: 1220, h: 920 }] },
        { title: 'Ground floor: finishes and fittings', text: 'Floors are laid — wood in the living and dining room, stone in the hall, tiles in the kitchen, utility and shower room — and the kitchen and shower room are fitted out.',
          ops: [{ op: 'level', id: 'L0' }, { op: 'floor', at: [[225, 450, 'wood'], [520, 850, 'stone'], [1000, 225, 'tile'], [900, 675, 'tile'], [1100, 675, 'tile']] },
            { op: 'place', list: [['sink', 1000, 52, 0], ['stove', 880, 52, 0], ['fridge', 1150, 57, 0], ['washer', 850, 855, 180],
              ['toilet', 1160, 560, 90], ['washbasin', 1165, 700, 90], ['shower', 1145, 845, 0]] }] },
        { title: 'Ground floor: furniture', text: 'The living room gets a sofa and armchair, the dining area a table for six.',
          ops: [{ op: 'place', list: [['sofa', 60, 520, 90], ['armchair', 280, 380, 0], ['plant', 40, 860, 0], ['table-rect6', 625, 200, 0], ['plant', 765, 40, 0]] }] },
        { title: 'Upper floor: finishes and furniture', text: 'Upstairs: wood floors on the landing and in the main bedroom, carpet in the children\'s room, tiles in the bathroom — then beds, a bathtub, a toilet and a washbasin.',
          ops: [{ op: 'level', id: 'L1' }, { op: 'floor', at: [[225, 250, 'wood'], [225, 700, 'tile'], [520, 200, 'wood'], [1000, 450, 'carpet']] },
            { op: 'place', list: [['bed-double', 130, 250, -90], ['plant', 410, 40, 0], ['bathtub', 225, 850, 0], ['toilet', 45, 580, -90], ['washbasin', 40, 690, -90],
              ['bed-single', 1110, 200, 90], ['bed-single', 1110, 650, 90], ['plant', 840, 860, 0]] }] },
        { title: 'Garden', text: 'Finally the plot: a pool with sun loungers behind the house, a gravel path to the front door, a parking place and trees. The house is complete — open the 3D view (Whole house) to look round it.',
          ops: [{ op: 'level', id: 'L0' }, { op: 'place', list: [['pool', 600, -420, 0, { w: 700, h: 300 }], ['lounger', 160, -420, 0], ['lounger', 1060, -420, 0], ['parasol', 1060, -620, 0],
            ['gravel-path', 520, 1150, 90, { w: 400, h: 120 }], ['car', 950, 1180, 0], ['tree', -300, 100, 0], ['tree', 1500, 300, 0], ['tree-conifer', -250, 800, 0],
            ['bush', 1350, 800, 0], ['flowerbed', 250, 1050, 0]] }] },
      ],
    },
    {
      id: 'cottage',
      name: 'Garden cottage',
      blurb: 'A 10 × 7 m single-storey cottage: living room with kitchen, a bedroom and a bathroom under a gable roof.',
      size: '10.2 × 7.2 m · 1 storey · 3 rooms',
      ground: 'grass',
      thumb: 'img/demo/cottage.jpg',
      steps: [
        { title: 'Outer walls', text: 'The outline of the house is set out and the outer walls go up: 20 cm thick, 3.00 m high, closed at every corner.',
          ops: [{ op: 'loop', t: 20, pts: [[0, 0], [1000, 0], [1000, 700], [0, 700]] }] },
        { title: 'Floor slab', text: 'A concrete slab is poured inside the outer walls. One click inside the walls fills the whole area they enclose.',
          ops: [{ op: 'slab', at: [300, 350], kind: 'concrete' }] },
        { title: 'Inner walls', text: 'Partition walls (10 cm) divide the house into a living room with kitchen, a bedroom and a bathroom.',
          ops: [{ op: 'walls', t: 10, list: [[600, 0, 600, 700], [600, 350, 1000, 350]] }] },
        { title: 'Doors', text: 'The front door and two inner doors are set into the walls. The walls are cut open where each door stands.',
          ops: [{ op: 'place', list: [['door', 300, 700, 180], ['door', 600, 200, 90], ['door', 600, 520, 90]] }] },
        { title: 'Windows', text: 'Windows let in light on every side: wide ones for the living room, a smaller one for the bathroom.',
          ops: [{ op: 'place', list: [['window', 300, 0, 0, { w: 160 }], ['window', 800, 0, 0, { w: 120 }], ['window', 480, 700, 0, { w: 100 }],
            ['window', 0, 350, 90, { w: 140 }], ['window', 1000, 175, 90, { w: 100 }], ['window', 1000, 540, 90, { w: 60 }]] }] },
        { title: 'Service linings', text: 'The bedroom and the living room are lined with 10 cm interior walls (drawn grey): room for wiring and insulation. Doors and windows stay open.',
          ops: [{ op: 'lining', at: [[800, 175], [300, 350]] }] },
        { title: 'Floors', text: 'Floor finishes are laid room by room: wood in the living room, carpet in the bedroom, tiles in the bathroom.',
          ops: [{ op: 'floor', at: [[300, 350, 'wood'], [800, 175, 'carpet'], [800, 525, 'tile']] }] },
        { title: 'Roof', text: 'A gable roof covers the house. It sits on top of the walls, with 40 cm eaves all round.',
          ops: [{ op: 'roof', type: 'roof-gable', x: -10, y: -10, w: 1020, h: 720 }] },
        { title: 'Kitchen and bathroom', text: 'Fixtures are installed: sink, cooktop and fridge in the kitchen; shower, toilet and washbasin in the bathroom.',
          ops: [{ op: 'place', list: [['sink', 300, 52, 0], ['stove', 420, 52, 0], ['fridge', 540, 57, 0],
            ['shower', 940, 635, 0], ['toilet', 690, 645, 180], ['washbasin', 820, 660, 180]] }] },
        { title: 'Furniture', text: 'The rooms are furnished: a sofa and a dining table in the living room, a double bed in the bedroom.',
          ops: [{ op: 'place', list: [['sofa', 75, 430, 90], ['table-sq4', 400, 300, 0], ['plant', 45, 655, 0], ['bed-double', 820, 160, 0], ['plant', 965, 310, 0]] }] },
        { title: 'Garden', text: 'Finally the garden: trees and bushes round the house. The cottage is complete — open the 3D view to walk round it.',
          ops: [{ op: 'place', list: [['tree', 1300, 100, 0], ['tree', -300, 450, 0], ['bush', 1150, 650, 0], ['bush', -120, 820, 0], ['flowerbed', 300, 830, 0]] }] },
      ],
    },
    {
      id: 'l-house',
      name: 'L-shaped family house',
      blurb: 'An L-shaped bungalow: living room, kitchen and bathroom in the main wing, two bedrooms in the side wing. Two roofs stacked together form the L.',
      size: '12.2 × 13.2 m · 1 storey · 5 rooms',
      ground: 'trees',
      thumb: 'img/demo/l-house.jpg',
      steps: [
        { title: 'Outer walls', text: 'The L-shaped outline is set out and the outer walls go up: 20 cm thick, 3.00 m high.',
          ops: [{ op: 'loop', t: 20, pts: [[0, 0], [1200, 0], [1200, 600], [600, 600], [600, 1300], [0, 1300]] }] },
        { title: 'Floor slab', text: 'One slab is poured for the whole L. A single click inside the walls fills the irregular outline completely.',
          ops: [{ op: 'slab', at: [300, 300], kind: 'concrete' }] },
        { title: 'Inner walls', text: 'Partitions divide the main wing into living room, kitchen and bathroom, and the side wing into two bedrooms.',
          ops: [{ op: 'walls', t: 10, list: [[600, 0, 600, 600], [950, 0, 950, 600], [0, 600, 600, 600], [0, 950, 600, 950]] }] },
        { title: 'Doors', text: 'The front door, a back door from the kitchen and the doors between the rooms are set into the walls.',
          ops: [{ op: 'place', list: [['door', 300, 0, 0], ['door', 775, 600, 180], ['door', 600, 450, 90], ['door', 950, 450, 90], ['door', 450, 600, 0], ['door', 450, 950, 0]] }] },
        { title: 'Windows', text: 'Windows on every outside wall: wide ones for the living room and bedrooms, a small one for the bathroom.',
          ops: [{ op: 'place', list: [['window', 120, 0, 0, { w: 120 }], ['window', 480, 0, 0, { w: 120 }], ['window', 775, 0, 0, { w: 140 }], ['window', 1075, 0, 0, { w: 80 }],
            ['window', 1200, 300, 90, { w: 140 }], ['window', 0, 300, 90, { w: 140 }], ['window', 0, 775, 90, { w: 140 }], ['window', 0, 1125, 90, { w: 140 }],
            ['window', 300, 1300, 0, { w: 160 }], ['window', 600, 775, 90, { w: 120 }], ['window', 600, 1125, 90, { w: 120 }]] }] },
        { title: 'Service linings', text: 'Both bedrooms are lined with 10 cm interior walls (grey) for wiring and insulation; their height follows the walls they line.',
          ops: [{ op: 'lining', at: [[300, 775], [300, 1125]] }] },
        { title: 'Floors', text: 'Floors are laid: wood in the living room and second bedroom, tiles in the kitchen and bathroom, carpet in the main bedroom.',
          ops: [{ op: 'floor', at: [[300, 300, 'wood'], [775, 300, 'tile'], [1075, 300, 'tile'], [300, 775, 'carpet'], [300, 1125, 'wood']] }] },
        { title: 'Main roof', text: 'A hip roof covers the main wing, resting on its walls.',
          ops: [{ op: 'roof', type: 'roof-hip', x: -10, y: -10, w: 1220, h: 620 }] },
        { title: 'Wing roof (stacked)', text: 'A gable roof over the side wing runs into the main roof. Where the two overlap, the lower roof is cut back to the main roof\'s slopes, so they meet in a clean valley.',
          ops: [{ op: 'roof', type: 'roof-gable', x: -210, y: 490, w: 1020, h: 620, r: 90 }] },
        { title: 'Kitchen and bathroom', text: 'Fixtures go in: sink, cooktop and fridge in the kitchen; bathtub, toilet and washbasin in the bathroom.',
          ops: [{ op: 'place', list: [['sink', 775, 52, 0], ['stove', 680, 52, 0], ['fridge', 895, 57, 0], ['table-sq2', 775, 330, 90],
            ['bathtub', 1080, 548, 0], ['toilet', 1150, 120, 90], ['washbasin', 1160, 250, 90]] }] },
        { title: 'Furniture', text: 'The rooms are furnished: sofa and dining table in the living room, a double bed and a single bed in the bedrooms.',
          ops: [{ op: 'place', list: [['sofa', 190, 470, 0], ['table-round4', 420, 220, 0], ['plant', 560, 45, 0],
            ['bed-double', 130, 775, -90], ['bed-single', 125, 1125, -90], ['plant', 550, 1245, 0]] }] },
        { title: 'Garden', text: 'Trees and bushes complete the plot. The house is finished — open the 3D view to see both roofs meet.',
          ops: [{ op: 'place', list: [['tree', 1000, 1000, 0], ['tree', 1450, 250, 0], ['bush', 800, 760, 0], ['bush', -140, 1000, 0], ['flowerbed', 900, 1250, 0]] }] },
      ],
    },
  ];
})();
