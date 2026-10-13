/* Floor Plan 2027 — wall materials
 * Each material has:
 *   name, color   display name and natural colour
 *   tile          size in cm of one repeat of the 3D texture
 *   paint(ctx, s, color, rnd)   draws one seamless repeat on a canvas (s = pixels per cm)
 *   hatch(color, dark)          2D plan pattern { size: [w, h], svg } (null = plain wall fill)
 */
(function () {
  'use strict';

  const shade = (hex, k) => {
    const n = parseInt(String(hex).slice(1), 16) || 0;
    const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  };
  const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const line = (d, c, w = 1) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}"/>`;

  // fine grain lines inside a board, running along it
  function grain(ctx, s, x, y, w, h, color, rnd, vertical) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s * 0.15);
    ctx.globalAlpha = 0.25;
    const n = Math.round((vertical ? w : h) / 2.2);
    for (let i = 0; i < n; i++) {
      const p = (vertical ? x : y) + rnd() * (vertical ? w : h);
      ctx.beginPath();
      if (vertical) { ctx.moveTo(p * s, y * s); ctx.lineTo((p + (rnd() - 0.5)) * s, (y + h) * s); }
      else { ctx.moveTo(x * s, p * s); ctx.lineTo((x + w) * s, (p + (rnd() - 0.5)) * s); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function speckle(ctx, s, W, H, color, n, alpha, rnd) {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i++) ctx.fillRect(rnd() * W * s, rnd() * H * s, Math.max(1, s * 0.4), Math.max(1, s * 0.4));
    ctx.globalAlpha = 1;
  }

  const MATS = {
    plaster: {
      name: 'Plaster (painted)', color: '#e4dfd6', tile: [100, 100],
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = c; ctx.fillRect(0, 0, 100 * s, 100 * s);
        speckle(ctx, s, 100, 100, shade(c, -0.25), 900, 0.06, rnd);
      },
      hatch: null,
    },
    brick: {
      name: 'Brick', color: '#a4532f', tile: [50, 32],
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = shade(c, 0.55); ctx.fillRect(0, 0, 50 * s, 32 * s); // mortar
        const tones = [0, 1, 2, 3].map(() => [0, 1].map(() => shade(c, (rnd() - 0.5) * 0.3)));
        for (let r = 0; r < 4; r++) {
          const off = r % 2 ? 12.5 : 0;
          for (let x = off - 25; x < 50; x += 25) {
            const k = (((Math.round((x - off) / 25)) % 2) + 2) % 2; // same brick on both sides of the seam
            ctx.fillStyle = tones[r][k];
            ctx.fillRect((x + 0.5) * s, (r * 8 + 0.5) * s, 24 * s, 7 * s);
          }
        }
        speckle(ctx, s, 50, 32, shade(c, -0.4), 300, 0.12, rnd);
      },
      hatch: (c, d) => ({ size: [8, 8], svg: line('M-2 2L2 -2M0 8L8 0M6 10L10 6', d, 0.9) }),
    },
    stone: {
      name: 'Stone', color: '#a39b8b', tile: [90, 90],
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = shade(c, -0.35); ctx.fillRect(0, 0, 90 * s, 90 * s); // joints
        let y = 0;
        while (y < 90) {
          let h = [16, 20, 24, 28][Math.floor(rnd() * 4)];
          if (90 - y - h < 14) h = 90 - y;
          const widths = [];
          let sum = 0;
          while (sum < 90) { let w = 18 + Math.round(rnd() * 26); if (90 - sum - w < 16) w = 90 - sum; widths.push(w); sum += w; }
          const off = rnd() * 90;
          let x = off;
          for (const w of widths) {
            ctx.fillStyle = shade(c, (rnd() - 0.5) * 0.35);
            for (const dx of [0, -90]) ctx.fillRect((x + dx + 0.8) * s, (y + 0.8) * s, (w - 1.6) * s, (h - 1.6) * s);
            x += w;
          }
          y += h;
        }
        speckle(ctx, s, 90, 90, shade(c, -0.45), 700, 0.15, rnd);
        speckle(ctx, s, 90, 90, shade(c, 0.5), 500, 0.15, rnd);
      },
      hatch: (c, d) => ({ size: [12, 12], svg: line('M0 12L12 0M0 0L12 12', d, 0.8) }),
    },
    'wood-slats': {
      name: 'Wood slats', color: '#b07d4f', tile: [44, 100],
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = shade(c, -0.65); ctx.fillRect(0, 0, 44 * s, 100 * s); // shadow gaps
        for (let k = 0; k < 4; k++) {
          const x = k * 11 + 0.5, tone = shade(c, (rnd() - 0.5) * 0.25);
          ctx.fillStyle = tone; ctx.fillRect(x * s, 0, 10 * s, 100 * s);
          grain(ctx, s, x, 0, 10, 100, shade(tone, -0.4), rnd, true);
        }
      },
      hatch: (c, d) => ({ size: [6, 6], svg: line('M3 0V6', d, 0.8) }),
    },
    'wood-boards': {
      name: 'Wood boards', color: '#c49a6c', tile: [120, 60],
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = shade(c, -0.55); ctx.fillRect(0, 0, 120 * s, 60 * s);
        for (let r = 0; r < 4; r++) {
          const y = r * 15 + 0.5, tone = shade(c, (rnd() - 0.5) * 0.22);
          ctx.fillStyle = tone; ctx.fillRect(0, y * s, 120 * s, 14 * s);
          grain(ctx, s, 0, y, 120, 14, shade(tone, -0.4), rnd, false);
          ctx.fillStyle = shade(c, -0.55);
          ctx.fillRect(((r * 37 + 20) % 120) * s, y * s, Math.max(1, s * 0.6), 14 * s); // board joint
        }
      },
      hatch: (c, d) => ({ size: [6, 6], svg: line('M0 3H6', d, 0.8) }),
    },
    'wood-frame': {
      // timber stud wall seen open: sheathing (OSB) with studs every 40 cm
      name: 'Wood frame (studs)', color: '#d4b483', tile: [40, 60],
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = shade(c, 0.12); ctx.fillRect(0, 0, 40 * s, 60 * s);
        // OSB flakes
        for (let i = 0; i < 260; i++) {
          ctx.fillStyle = shade(c, (rnd() - 0.5) * 0.35);
          ctx.globalAlpha = 0.45;
          ctx.fillRect(rnd() * 40 * s, rnd() * 60 * s, (2 + rnd() * 4) * s, (0.6 + rnd()) * s);
        }
        ctx.globalAlpha = 1;
        // the stud (4.5 cm) with its edges
        const tone = shade(c, -0.18);
        ctx.fillStyle = tone; ctx.fillRect(17.75 * s, 0, 4.5 * s, 60 * s);
        ctx.fillStyle = shade(tone, -0.35);
        ctx.fillRect(17.75 * s, 0, Math.max(1, 0.3 * s), 60 * s); ctx.fillRect(21.95 * s, 0, Math.max(1, 0.3 * s), 60 * s);
        grain(ctx, s, 18, 0, 4, 60, shade(tone, -0.3), rnd, true);
      },
      // plan symbol of a timber-frame wall: cross hatch
      hatch: (c, d) => ({ size: [10, 10], svg: line('M0 0L10 10M10 0L0 10', d, 0.8) }),
    },
    concrete: {
      name: 'Concrete', color: '#a9a7a2', tile: [120, 60],
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = c; ctx.fillRect(0, 0, 120 * s, 60 * s);
        speckle(ctx, s, 120, 60, shade(c, -0.35), 1400, 0.12, rnd);
        speckle(ctx, s, 120, 60, shade(c, 0.4), 900, 0.12, rnd);
        ctx.fillStyle = shade(c, -0.35);
        ctx.fillRect(0, 0, 120 * s, Math.max(1, s * 0.4)); ctx.fillRect(0, 0, Math.max(1, s * 0.4), 60 * s); // panel joints
        ctx.fillStyle = shade(c, -0.55);
        for (const [x, y] of [[20, 15], [60, 15], [100, 15], [20, 45], [60, 45], [100, 45]]) {
          ctx.beginPath(); ctx.arc(x * s, y * s, 1.2 * s, 0, Math.PI * 2); ctx.fill();
        }
      },
      hatch: (c, d) => ({ size: [10, 10], svg: `<circle cx="2" cy="3" r="0.7" fill="${d}"/><circle cx="7" cy="7" r="0.5" fill="${d}"/><path d="M6 1l1.5 2.5h-3z" fill="${d}"/>` }),
    },
    /* ── exterior siding (group 'siding'); x runs along the wall, y down it ── */
    'lap-siding': {
      name: 'Vinyl lap siding', color: '#e6e3da', tile: [100, 20], group: 'siding', rough: 0.55,
      paint(ctx, s, c) {
        // two 10 cm laps: each catches light at its top and is in shadow under the lap above
        for (let r = 0; r < 2; r++) {
          const y = r * 10, g = ctx.createLinearGradient(0, y * s, 0, (y + 10) * s);
          g.addColorStop(0, shade(c, -0.22)); g.addColorStop(0.12, shade(c, 0.08)); g.addColorStop(1, shade(c, -0.06));
          ctx.fillStyle = g; ctx.fillRect(0, y * s, 100 * s, 10 * s);
          ctx.fillStyle = shade(c, -0.45); ctx.fillRect(0, y * s, 100 * s, Math.max(1, 0.35 * s));
        }
      },
      hatch: (c, d) => ({ size: [8, 8], svg: line('M0 2H8M0 6H8', d, 0.5) }),
    },
    clapboard: {
      name: 'Wood clapboard', color: '#cfc6b4', tile: [120, 30], group: 'siding', rough: 0.75,
      paint(ctx, s, c, rnd) {
        for (let r = 0; r < 2; r++) {
          const y = r * 15, tone = shade(c, (rnd() - 0.5) * 0.08), g = ctx.createLinearGradient(0, y * s, 0, (y + 15) * s);
          g.addColorStop(0, shade(tone, -0.3)); g.addColorStop(0.1, shade(tone, 0.06)); g.addColorStop(1, shade(tone, -0.08));
          ctx.fillStyle = g; ctx.fillRect(0, y * s, 120 * s, 15 * s);
          grain(ctx, s, 0, y + 1.5, 120, 13, shade(tone, -0.18), rnd, false);
          ctx.fillStyle = shade(c, -0.5); ctx.fillRect(0, y * s, 120 * s, Math.max(1, 0.5 * s));
          ctx.fillStyle = shade(c, -0.35); ctx.fillRect(((r * 53 + 31) % 120) * s, y * s, Math.max(1, 0.4 * s), 15 * s); // a butt joint
        }
      },
      hatch: (c, d) => ({ size: [8, 8], svg: line('M0 1H8M0 5H8', d, 0.6) }),
    },
    'board-batten': {
      name: 'Board and batten', color: '#7f8b7b', tile: [40, 100], group: 'siding', rough: 0.8,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = c; ctx.fillRect(0, 0, 40 * s, 100 * s);
        grain(ctx, s, 0, 0, 40, 100, shade(c, -0.15), rnd, true);
        // the batten over the joint: raised, lit on one side, shadow on the other
        ctx.fillStyle = shade(c, 0.12); ctx.fillRect(0, 0, 6 * s, 100 * s);
        ctx.fillStyle = shade(c, 0.3); ctx.fillRect(0, 0, Math.max(1, 0.6 * s), 100 * s);
        ctx.fillStyle = shade(c, -0.4); ctx.fillRect(6 * s, 0, Math.max(1, 1.2 * s), 100 * s);
      },
      hatch: (c, d) => ({ size: [8, 8], svg: line('M2 0V8', d, 0.9) }),
    },
    'cedar-shingles': {
      name: 'Cedar shingles', color: '#a7774d', tile: [60, 36], group: 'siding', rough: 0.9,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = shade(c, -0.55); ctx.fillRect(0, 0, 60 * s, 36 * s);
        for (let r = 0; r < 2; r++) {
          const y = r * 18, widths = r ? [11, 14, 9, 13, 13] : [14, 10, 12, 15, 9];
          let x = r ? -4 : 0;
          for (const w of widths.concat(widths)) {
            if (x >= 60) break;
            const tone = shade(c, (rnd() - 0.5) * 0.3);
            for (const dx of [0, -60]) { ctx.fillStyle = tone; ctx.fillRect((x + dx + 0.4) * s, y * s, (w - 0.8) * s, 17.6 * s); }
            grain(ctx, s, Math.max(0, x + 0.4), y, Math.min(w - 0.8, 60 - x), 17.6, shade(tone, -0.3), rnd, true);
            x += w;
          }
          ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, y * s, 60 * s, 1.6 * s);
        }
      },
      hatch: (c, d) => ({ size: [8, 8], svg: line('M0 4H8M4 0V4', d, 0.6) }),
    },
    'fiber-cement': {
      name: 'Fiber-cement panels', color: '#6f7479', tile: [120, 60], group: 'siding', rough: 0.85,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = c; ctx.fillRect(0, 0, 120 * s, 60 * s);
        speckle(ctx, s, 120, 60, shade(c, 0.2), 500, 0.08, rnd);
        // the open joints between panels
        ctx.fillStyle = shade(c, -0.6);
        ctx.fillRect(0, 0, 120 * s, Math.max(1, 0.8 * s)); ctx.fillRect(0, 0, Math.max(1, 0.8 * s), 60 * s);
        ctx.fillStyle = shade(c, 0.25); ctx.fillRect(0, 0.8 * s, 120 * s, Math.max(1, 0.3 * s));
      },
      hatch: (c, d) => ({ size: [10, 10], svg: line('M0 0H10M0 0V10', d, 0.6) }),
    },
    stucco: {
      name: 'Stucco', color: '#e3d6bf', tile: [80, 80], group: 'siding', rough: 1,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = c; ctx.fillRect(0, 0, 80 * s, 80 * s);
        speckle(ctx, s, 80, 80, shade(c, -0.25), 2600, 0.18, rnd);
        speckle(ctx, s, 80, 80, shade(c, 0.3), 1800, 0.2, rnd);
      },
      hatch: (c, d) => ({ size: [6, 6], svg: `<circle cx="1.5" cy="1.5" r=".5" fill="${d}"/><circle cx="4.5" cy="4" r=".4" fill="${d}"/>` }),
    },
    'metal-siding': {
      name: 'Metal siding', color: '#5d6b75', tile: [30, 100], group: 'siding', rough: 0.4,
      paint(ctx, s, c) {
        // trapezoid ribs: a lit face, the flat, a shaded face
        const g = ctx.createLinearGradient(0, 0, 30 * s, 0);
        g.addColorStop(0, shade(c, -0.35)); g.addColorStop(0.08, shade(c, 0.3)); g.addColorStop(0.2, shade(c, 0.12));
        g.addColorStop(0.28, shade(c, -0.25)); g.addColorStop(0.36, shade(c, 0.02)); g.addColorStop(1, shade(c, -0.05));
        ctx.fillStyle = g; ctx.fillRect(0, 0, 30 * s, 100 * s);
      },
      hatch: (c, d) => ({ size: [6, 6], svg: line('M1 0V6M3 0V6', d, 0.5) }),
    },
    'log-siding': {
      name: 'Log siding', color: '#9a6a3f', tile: [100, 30], group: 'siding', rough: 0.85,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = shade(c, -0.6); ctx.fillRect(0, 0, 100 * s, 30 * s);
        for (let r = 0; r < 2; r++) {
          const y = r * 15, tone = shade(c, (rnd() - 0.5) * 0.15), g = ctx.createLinearGradient(0, y * s, 0, (y + 15) * s);
          g.addColorStop(0, shade(tone, -0.45)); g.addColorStop(0.35, shade(tone, 0.15)); g.addColorStop(0.7, tone); g.addColorStop(1, shade(tone, -0.5));
          ctx.fillStyle = g; ctx.fillRect(0, (y + 0.4) * s, 100 * s, 14.2 * s);
          grain(ctx, s, 0, y + 2, 100, 11, shade(tone, -0.25), rnd, false);
        }
      },
      hatch: (c, d) => ({ size: [8, 8], svg: line('M0 2Q4 0 8 2M0 6Q4 4 8 6', d, 0.6) }),
    },
    tiles: {
      name: 'Tiles', color: '#f2f2ef', tile: [20, 20],
      paint(ctx, s, c) {
        ctx.fillStyle = shade(c, -0.18); ctx.fillRect(0, 0, 20 * s, 20 * s); // grout
        const g = ctx.createLinearGradient(0, 0, 20 * s, 20 * s);
        g.addColorStop(0, shade(c, 0.15)); g.addColorStop(1, shade(c, -0.05));
        ctx.fillStyle = g; ctx.fillRect(0.4 * s, 0.4 * s, 19.2 * s, 19.2 * s);
      },
      hatch: (c, d) => ({ size: [6, 6], svg: line('M0 0H6M0 0V6', d, 0.7) }),
    },
  };

  /* Roof coverings. Painted the same way; in the texture, x runs along the eaves and y down the slope
     (tile courses are horizontal, metal seams vertical). rough / metal: the 3D surface. */
  const ROOF_MATS = {
    'clay-tiles': {
      name: 'Clay tiles', color: '#b5532f', tile: [30, 40], rough: 0.65, metal: 0,
      paint(ctx, s, c, rnd) {
        // a barrel tile: rounded across, the course above throws a shadow on its top
        const g = ctx.createLinearGradient(0, 0, 30 * s, 0);
        g.addColorStop(0, shade(c, -0.45)); g.addColorStop(0.18, shade(c, -0.05)); g.addColorStop(0.5, shade(c, 0.18));
        g.addColorStop(0.82, shade(c, -0.05)); g.addColorStop(1, shade(c, -0.45));
        ctx.fillStyle = g; ctx.fillRect(0, 0, 30 * s, 40 * s);
        const sh = ctx.createLinearGradient(0, 0, 0, 6 * s);
        sh.addColorStop(0, 'rgba(0,0,0,.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh; ctx.fillRect(0, 0, 30 * s, 6 * s);
        speckle(ctx, s, 30, 40, shade(c, -0.35), 140, 0.12, rnd);
      },
    },
    'concrete-tiles': {
      name: 'Concrete tiles', color: '#6e6a66', tile: [33, 34], rough: 0.85, metal: 0,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = c; ctx.fillRect(0, 0, 33 * s, 34 * s);
        // two low rolls per tile, the joint at its side, the course shadow at its top
        for (const x of [8, 24]) {
          const g = ctx.createLinearGradient((x - 6) * s, 0, (x + 6) * s, 0);
          g.addColorStop(0, shade(c, -0.12)); g.addColorStop(0.5, shade(c, 0.12)); g.addColorStop(1, shade(c, -0.12));
          ctx.fillStyle = g; ctx.fillRect((x - 6) * s, 0, 12 * s, 34 * s);
        }
        ctx.fillStyle = shade(c, -0.5); ctx.fillRect(0, 0, Math.max(1, 0.6 * s), 34 * s);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, 33 * s, 3 * s);
        speckle(ctx, s, 33, 34, shade(c, 0.3), 160, 0.12, rnd);
      },
    },
    slate: {
      name: 'Slate', color: '#4b5563', tile: [40, 50], rough: 0.55, metal: 0,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = shade(c, -0.55); ctx.fillRect(0, 0, 40 * s, 50 * s);
        for (let r = 0; r < 2; r++) {
          const off = r ? 10 : 0, y = r * 25;
          for (let x = off - 20; x < 40; x += 20) {
            ctx.fillStyle = shade(c, (rnd() - 0.5) * 0.35);
            ctx.fillRect((x + 0.5) * s, (y + 0.5) * s, 19 * s, 24 * s);
            ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect((x + 0.5) * s, (y + 0.5) * s, 19 * s, 2 * s);
          }
        }
        speckle(ctx, s, 40, 50, shade(c, 0.4), 220, 0.1, rnd);
      },
    },
    shingles: {
      name: 'Asphalt shingles', color: '#5b4a3f', tile: [100, 34], rough: 0.95, metal: 0,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = shade(c, -0.5); ctx.fillRect(0, 0, 100 * s, 34 * s);
        for (let r = 0; r < 2; r++) {
          const off = r ? 100 / 6 : 0, y = r * 17;
          for (let x = off - 100 / 3; x < 100; x += 100 / 3) {
            ctx.fillStyle = shade(c, (rnd() - 0.5) * 0.3);
            ctx.fillRect((x + 0.6) * s, y * s, (100 / 3 - 1.2) * s, 16.4 * s);
          }
          ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, y * s, 100 * s, 1.5 * s);
        }
        speckle(ctx, s, 100, 34, shade(c, 0.45), 900, 0.18, rnd);
        speckle(ctx, s, 100, 34, shade(c, -0.6), 700, 0.18, rnd);
      },
    },
    'wood-shakes': {
      name: 'Wood shakes', color: '#8a6a48', tile: [60, 40], rough: 0.9, metal: 0,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = shade(c, -0.55); ctx.fillRect(0, 0, 60 * s, 40 * s);
        for (let r = 0; r < 2; r++) {
          const y = r * 20, widths = r ? [12, 9, 14, 11, 14] : [9, 15, 10, 13, 13];
          let x = 0;
          for (const w of widths) {
            const tone = shade(c, (rnd() - 0.5) * 0.35);
            ctx.fillStyle = tone; ctx.fillRect((x + 0.4) * s, y * s, (w - 0.8) * s, 19.5 * s);
            grain(ctx, s, x + 0.4, y, w - 0.8, 19.5, shade(tone, -0.35), rnd, true);
            x += w;
          }
          ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fillRect(0, y * s, 60 * s, 1.8 * s);
        }
      },
    },
    'standing-seam': {
      name: 'Standing-seam metal', color: '#3f4a55', tile: [50, 100], rough: 0.35, metal: 0.55,
      paint(ctx, s, c) {
        const g = ctx.createLinearGradient(0, 0, 50 * s, 0);
        g.addColorStop(0, shade(c, 0.05)); g.addColorStop(0.5, shade(c, -0.04)); g.addColorStop(1, shade(c, 0.05));
        ctx.fillStyle = g; ctx.fillRect(0, 0, 50 * s, 100 * s);
        // the raised seam: a bright ridge with a shadow beside it
        ctx.fillStyle = shade(c, 0.45); ctx.fillRect(0, 0, Math.max(1, 1.2 * s), 100 * s);
        ctx.fillStyle = shade(c, -0.45); ctx.fillRect(1.2 * s, 0, Math.max(1, 1.4 * s), 100 * s);
      },
    },
    corrugated: {
      name: 'Corrugated metal', color: '#9aa3ab', tile: [8, 60], rough: 0.4, metal: 0.6,
      paint(ctx, s, c) {
        const g = ctx.createLinearGradient(0, 0, 8 * s, 0);
        g.addColorStop(0, shade(c, -0.35)); g.addColorStop(0.3, shade(c, 0.25)); g.addColorStop(0.55, shade(c, 0.05)); g.addColorStop(1, shade(c, -0.35));
        ctx.fillStyle = g; ctx.fillRect(0, 0, 8 * s, 60 * s);
      },
    },
    'green-roof': {
      name: 'Green roof (sedum)', color: '#5f8a3e', tile: [100, 100], rough: 1, metal: 0,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = c; ctx.fillRect(0, 0, 100 * s, 100 * s);
        for (const [col, n] of [[shade(c, 0.35), 900], [shade(c, -0.35), 900], ['#b7a33c', 120], ['#c46a9a', 60]]) {
          ctx.fillStyle = col;
          for (let i = 0; i < n; i++) { ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(rnd() * 100 * s, rnd() * 100 * s, (0.6 + rnd() * 1.6) * s, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.globalAlpha = 1;
      },
    },
    membrane: {
      name: 'Membrane', color: '#9ca3af', tile: [200, 100], rough: 0.8, metal: 0,
      paint(ctx, s, c, rnd) {
        ctx.fillStyle = c; ctx.fillRect(0, 0, 200 * s, 100 * s);
        speckle(ctx, s, 200, 100, shade(c, -0.2), 600, 0.08, rnd);
        ctx.fillStyle = shade(c, -0.25); ctx.fillRect(0, 0, 200 * s, Math.max(1, 0.5 * s)); // the welded laps
        ctx.fillStyle = shade(c, 0.2); ctx.fillRect(0, 0.6 * s, 200 * s, Math.max(1, 0.4 * s));
      },
    },
  };
  function paintRoof(id, color, pxPerCm) {
    const m = ROOF_MATS[id] || ROOF_MATS['clay-tiles'];
    color = color || m.color;
    const key = `roof|${id}|${color}|${pxPerCm}`;
    if (canvasCache.has(key)) return canvasCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(m.tile[0] * pxPerCm));
    cv.height = Math.max(2, Math.round(m.tile[1] * pxPerCm));
    m.paint(cv.getContext('2d'), pxPerCm, color, rng(id.length * 7919 + 101));
    canvasCache.set(key, cv);
    return cv;
  }
  function roofSwatch(id) {
    const key = 'roof|' + id;
    if (swatchCache.has(key)) return swatchCache.get(key);
    const m = ROOF_MATS[id], src = paintRoof(id, m.color, Math.max(1, Math.min(3, 96 / Math.max(...m.tile) * 1.5)));
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = ctx.createPattern(src, 'repeat');
    ctx.fillRect(0, 0, 96, 96);
    const url = cv.toDataURL('image/png');
    swatchCache.set(key, url);
    return url;
  }

  // one seamless repeat of a material, painted on a canvas
  const canvasCache = new Map();
  function paint(id, color, pxPerCm) {
    const m = MATS[id] || MATS.plaster;
    color = color || m.color;
    const key = `${id}|${color}|${pxPerCm}`;
    if (canvasCache.has(key)) return canvasCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = Math.round(m.tile[0] * pxPerCm);
    cv.height = Math.round(m.tile[1] * pxPerCm);
    m.paint(cv.getContext('2d'), pxPerCm, color, rng(id.length * 7919 + 13));
    canvasCache.set(key, cv);
    return cv;
  }

  // small square preview image for the material picker
  const swatchCache = new Map();
  function swatch(id) {
    if (swatchCache.has(id)) return swatchCache.get(id);
    const m = MATS[id], src = paint(id, m.color, 3);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = ctx.createPattern(src, 'repeat');
    ctx.fillRect(0, 0, 96, 96);
    const url = cv.toDataURL('image/png');
    swatchCache.set(id, url);
    return url;
  }

  // 2D plan hatch for a wall: <defs> markup for an SVG pattern, or '' for a plain fill
  function pattern2d(id, color, patId) {
    const m = MATS[id];
    if (!m || !m.hatch) return '';
    const c = color || m.color;
    const { size: [w, h], svg } = m.hatch(c, shade(c, -0.5));
    return `<defs><pattern id="${patId}" patternUnits="userSpaceOnUse" width="${w}" height="${h}">` +
      `<rect width="${w}" height="${h}" fill="${c}" stroke="none"/>${svg}</pattern></defs>`;
  }

  window.FP_WALLMATS = { MATS, paint, swatch, pattern2d, shade, ROOF_MATS, paintRoof, roofSwatch };
})();
