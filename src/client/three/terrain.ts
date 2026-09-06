// Procedural island terrain and board texture for Fire Isle.
// The relief is modelled after the vacuum-formed 1986 board: a central massif topped by
// Vul-Kar Point, a white-water gorge below Chasm Peak, the crater ringed by Blister Run,
// Great Sway Bluff falling to the water in the west, sand beaches all round.
import * as THREE from 'three';
import {
  BOARD_H, BOARD_W, CAVES, FIREBALLS, PITS, RUIN, SPACE, SPACES, ADJ,
} from '../../engine/board.ts';

export const BOARD_SCALE = 0.02; // world units per board pixel
export const WORLD_W = BOARD_W * BOARD_SCALE;
export const WORLD_H = BOARD_H * BOARD_SCALE;

export function toWorld(x: number, y: number): [number, number] {
  return [(x - BOARD_W / 2) * BOARD_SCALE, (y - BOARD_H / 2) * BOARD_SCALE];
}

// ---------------------------------------------------------------------------
// Shoreline and relief
// ---------------------------------------------------------------------------

const SHORE: [number, number][] = [
  [205, 48], [330, 34], [450, 56], [560, 42], [660, 46], [760, 30], [860, 44], [940, 84], [988, 150],
  [992, 260], [978, 360], [992, 470], [962, 585], [900, 645], [800, 690], [700, 702], [600, 690],
  [500, 704], [400, 690], [300, 700], [200, 652], [112, 604], [70, 522], [56, 420], [78, 342],
  [62, 262], [82, 172], [132, 92],
];

function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToPoly(x: number, y: number, poly: [number, number][]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j];
    const [x2, y2] = poly[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    const px = x1 + t * dx - x;
    const py = y1 + t * dy - y;
    const d = px * px + py * py;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

interface Bump { x: number; y: number; sx: number; sy: number; h: number; rot?: number }

const BUMPS: Bump[] = [
  // central massif and Vul-Kar Point
  { x: 540, y: 335, sx: 105, sy: 95, h: 4.1 },
  { x: 610, y: 260, sx: 70, sy: 60, h: 1.4 },
  { x: 470, y: 380, sx: 60, sy: 60, h: 0.9 },
  // Chasm Peak and the islet of cave 4
  { x: 355, y: 275, sx: 42, sy: 55, h: 3.1 },
  { x: 480, y: 268, sx: 28, sy: 24, h: 1.3 },
  // Great Sway Bluff
  { x: 175, y: 250, sx: 55, sy: 48, h: 2.3 },
  // northern ridge carrying the Low Road / High Road
  { x: 260, y: 150, sx: 80, sy: 55, h: 1.5 },
  { x: 400, y: 150, sx: 95, sy: 55, h: 1.75 },
  { x: 560, y: 160, sx: 85, sy: 55, h: 1.9 },
  { x: 700, y: 150, sx: 75, sy: 50, h: 1.6 },
  // Thunder Alley ridge
  { x: 872, y: 300, sx: 60, sy: 90, h: 1.5 },
  { x: 862, y: 450, sx: 55, sy: 70, h: 1.3 },
  // Blister Run crater rim
  { x: 640, y: 470, sx: 85, sy: 75, h: 2.1 },
  { x: 600, y: 435, sx: 38, sy: 32, h: 0.8 },
  // southern slope under Witchlord Trail
  { x: 600, y: 545, sx: 110, sy: 55, h: 1.0 },
  // Dead Man's Plateau stump
  { x: 300, y: 580, sx: 40, sy: 34, h: 1.35 },
  // west-coast cliffs by Dock Run and the Viper Pass ridge
  { x: 135, y: 450, sx: 45, sy: 110, h: 1.7 },
  { x: 225, y: 455, sx: 45, sy: 80, h: 1.4 },
  // The Ruin
  { x: 876, y: 570, sx: 34, sy: 30, h: 0.9 },
];
const DIPS: Bump[] = [
  { x: 640, y: 472, sx: 30, sy: 26, h: 1.6 }, // crater hole
  { x: 430, y: 300, sx: 55, sy: 40, h: 1.2, rot: -0.5 }, // white-water gorge
  { x: 395, y: 245, sx: 40, sy: 28, h: 0.9, rot: -0.7 },
];

function gauss(b: Bump, x: number, y: number): number {
  let dx = x - b.x;
  let dy = y - b.y;
  if (b.rot) {
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    dx = rx;
    dy = ry;
  }
  return b.h * Math.exp(-((dx * dx) / (2 * b.sx * b.sx) + (dy * dy) / (2 * b.sy * b.sy)));
}

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbm(x: number, y: number, oct = 4): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x * f, y * f);
    amp *= 0.5;
    f *= 2.1;
  }
  return v;
}

const FIELD_W = 512;
const FIELD_H = 372;
let field: Float32Array | null = null;
let shoreField: Float32Array | null = null; // signed distance to shore (positive inside)

function buildField() {
  field = new Float32Array(FIELD_W * FIELD_H);
  shoreField = new Float32Array(FIELD_W * FIELD_H);
  const sx = BOARD_W / FIELD_W;
  const sy = BOARD_H / FIELD_H;
  for (let j = 0; j < FIELD_H; j++) {
    for (let i = 0; i < FIELD_W; i++) {
      const x = (i + 0.5) * sx;
      const y = (j + 0.5) * sy;
      const inside = pointInPoly(x, y, SHORE);
      const d = distToPoly(x, y, SHORE) * (inside ? 1 : -1);
      shoreField[j * FIELD_W + i] = d;
      let h = 0;
      if (d > -30) {
        // beach shelf rising from the water
        const shelf = THREE.MathUtils.smoothstep(d, -12, 40) * 0.55;
        let relief = 0;
        for (const b of BUMPS) relief += gauss(b, x, y);
        for (const b of DIPS) relief -= gauss(b, x, y);
        relief *= THREE.MathUtils.smoothstep(d, 0, 70);
        h = shelf + Math.max(relief, -0.35) + (fbm(x * 0.02, y * 0.02, 3) - 0.5) * 0.18 * THREE.MathUtils.smoothstep(d, 5, 60);
        h = Math.max(h, -0.02);
      } else {
        h = -0.05;
      }
      field[j * FIELD_W + i] = h;
    }
  }
  // flatten a landing around every trail space so pieces stand level
  for (const s of SPACES) {
    if (s.special === 'water') continue;
    const r = s.special === 'start' ? 34 : s.special === 'vulkar' ? 46 : s.special === 'beach' ? 24 : 16;
    const hc = sampleRaw(s.x, s.y);
    const i0 = Math.max(0, Math.floor((s.x - r * 1.6) / sx));
    const i1 = Math.min(FIELD_W - 1, Math.ceil((s.x + r * 1.6) / sx));
    const j0 = Math.max(0, Math.floor((s.y - r * 1.6) / sy));
    const j1 = Math.min(FIELD_H - 1, Math.ceil((s.y + r * 1.6) / sy));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * sx;
        const y = (j + 0.5) * sy;
        const dd = Math.hypot(x - s.x, y - s.y) / r;
        if (dd > 1.6) continue;
        const w = 1 - THREE.MathUtils.smoothstep(dd, 0.75, 1.6);
        const k = j * FIELD_W + i;
        field[k] = field[k] * (1 - w) + (hc - 0.03) * w;
      }
    }
  }
  // gentle grooves along the trails
  for (const a of SPACES) {
    for (const bId of ADJ[a.id]) {
      const b = SPACE[bId];
      if (a.id > bId || a.bridge || b.bridge || a.special === 'water' || b.special === 'water') continue;
      const n = 6;
      for (let t = 0; t <= n; t++) {
        const x = a.x + ((b.x - a.x) * t) / n;
        const y = a.y + ((b.y - a.y) * t) / n;
        carve(x, y, 9, 0.04);
      }
    }
  }
}

function carve(x: number, y: number, r: number, depth: number) {
  if (!field) return;
  const sx = BOARD_W / FIELD_W;
  const sy = BOARD_H / FIELD_H;
  const i0 = Math.max(0, Math.floor((x - r) / sx));
  const i1 = Math.min(FIELD_W - 1, Math.ceil((x + r) / sx));
  const j0 = Math.max(0, Math.floor((y - r) / sy));
  const j1 = Math.min(FIELD_H - 1, Math.ceil((y + r) / sy));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const px = (i + 0.5) * sx;
      const py = (j + 0.5) * sy;
      const dd = Math.hypot(px - x, py - y) / r;
      if (dd > 1) continue;
      field[j * FIELD_W + i] -= depth * (1 - dd * dd);
    }
  }
}

function sampleRaw(x: number, y: number): number {
  if (!field) buildField();
  const fx = (x / BOARD_W) * FIELD_W - 0.5;
  const fy = (y / BOARD_H) * FIELD_H - 0.5;
  const i = Math.max(0, Math.min(FIELD_W - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(FIELD_H - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - i));
  const ty = Math.max(0, Math.min(1, fy - j));
  const f = field!;
  const a = f[j * FIELD_W + i];
  const b = f[j * FIELD_W + i + 1];
  const c = f[(j + 1) * FIELD_W + i];
  const d = f[(j + 1) * FIELD_W + i + 1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Terrain height (world Y) at board pixel coordinates. */
export function heightAt(x: number, y: number): number {
  return sampleRaw(x, y);
}

export function shoreDistance(x: number, y: number): number {
  if (!shoreField) buildField();
  const i = Math.max(0, Math.min(FIELD_W - 1, Math.round((x / BOARD_W) * FIELD_W - 0.5)));
  const j = Math.max(0, Math.min(FIELD_H - 1, Math.round((y / BOARD_H) * FIELD_H - 0.5)));
  return shoreField![j * FIELD_W + i];
}

/** World position (x, y, z) on the terrain surface for a board point. */
export function surfacePoint(x: number, y: number, lift = 0): THREE.Vector3 {
  const [wx, wz] = toWorld(x, y);
  return new THREE.Vector3(wx, Math.max(heightAt(x, y), 0) + lift, wz);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function createTerrainGeometry(segX = 240, segY = 174): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(WORLD_W, WORLD_H, segX, segY);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wz = pos.getZ(i);
    const x = wx / BOARD_SCALE + BOARD_W / 2;
    const y = wz / BOARD_SCALE + BOARD_H / 2;
    pos.setY(i, heightAt(x, y));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Texture
// ---------------------------------------------------------------------------

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const C = {
  deep: [14, 44, 120] as [number, number, number],
  shallow: [46, 118, 210] as [number, number, number],
  foam: [235, 245, 255] as [number, number, number],
  sand: [236, 206, 120] as [number, number, number],
  sandDark: [205, 165, 84] as [number, number, number],
  jungle: [58, 122, 60] as [number, number, number],
  jungleLight: [118, 168, 74] as [number, number, number],
  rock: [104, 98, 140] as [number, number, number],
  rockDark: [66, 60, 98] as [number, number, number],
  rockLight: [160, 150, 200] as [number, number, number],
  cliff: [186, 118, 58] as [number, number, number],
  cliffDark: [110, 62, 34] as [number, number, number],
};

export function paintBoardTexture(scale = 2): HTMLCanvasElement {
  const W = BOARD_W * scale;
  const H = BOARD_H * scale;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const dx = 1.5;
  for (let j = 0; j < H; j++) {
    const y = (j + 0.5) / scale;
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) / scale;
      const d = shoreDistance(x, y);
      const h = heightAt(x, y);
      let col: [number, number, number];
      if (d < 0) {
        const t = THREE.MathUtils.smoothstep(-d, 0, 90);
        col = lerpColor(C.shallow, C.deep, t);
        // foam streaks and surf lines close to the shore
        const streak = fbm(x * 0.05 + 3, y * 0.05, 3);
        const surf = Math.max(0, 1 - Math.abs((-d - 6 - streak * 6) / 5));
        const ripple = Math.max(0, Math.sin((-d) * 0.35 + streak * 8) * 0.5 + 0.5) * THREE.MathUtils.smoothstep(-d, 4, 50) * (1 - THREE.MathUtils.smoothstep(-d, 40, 120)) * 0.35;
        col = lerpColor(col, C.foam, surf * 0.85 + ripple * 0.5);
      } else {
        const n = fbm(x * 0.035, y * 0.035, 4);
        const n2 = fbm(x * 0.12 + 9, y * 0.12 + 5, 3);
        // slope shading from the height field
        const gx = heightAt(x + dx, y) - heightAt(x - dx, y);
        const gy = heightAt(x, y + dx) - heightAt(x, y - dx);
        const slope = Math.hypot(gx, gy) / (2 * dx) * BOARD_SCALE * 40;
        const light = THREE.MathUtils.clamp(0.95 + (gx * 0.7 - gy * 0.9) * 7, 0.7, 1.3);
        const sandT = THREE.MathUtils.smoothstep(h, 0.38, 0.82);
        let sand = lerpColor(C.sand, C.sandDark, n2 * 0.7);
        let jungle = lerpColor(C.jungle, C.jungleLight, n);
        let rock = lerpColor(C.rockDark, C.rockLight, THREE.MathUtils.clamp(n * 0.9 + 0.2, 0, 1));
        col = lerpColor(sand, jungle, sandT);
        const rockT = THREE.MathUtils.smoothstep(h, 1.35, 2.3) * 0.85 + THREE.MathUtils.smoothstep(slope, 0.9, 2.2) * 0.5;
        // the summit keeps a darker, volcanic tone
        rock = lerpColor(rock, C.rockDark, THREE.MathUtils.smoothstep(h, 2.6, 3.9) * 0.55);
        col = lerpColor(col, rock, THREE.MathUtils.clamp(rockT, 0, 1));
        // orange cliffs on the west coast and along the south-west shore
        const cliffT = (x < 250 && y > 380 ? 1 : 0) * THREE.MathUtils.smoothstep(h, 0.45, 1.2) + (y > 600 && x < 420 ? 0.6 : 0) * THREE.MathUtils.smoothstep(h, 0.4, 1.0);
        col = lerpColor(col, lerpColor(C.cliff, C.cliffDark, n2), THREE.MathUtils.clamp(cliffT, 0, 1) * 0.9);
        // white water in the gorge below Chasm Peak
        const gorge = gauss({ x: 430, y: 300, sx: 60, sy: 42, h: 1, rot: -0.5 }, x, y) + gauss({ x: 395, y: 245, sx: 40, sy: 26, h: 1, rot: -0.7 }, x, y);
        if (gorge > 0.35) {
          const foam = THREE.MathUtils.clamp((gorge - 0.35) * 2.2, 0, 1) * (0.5 + 0.5 * fbm(x * 0.08, y * 0.08, 3));
          col = lerpColor(col, lerpColor(C.shallow, C.foam, foam), THREE.MathUtils.clamp((gorge - 0.35) * 2, 0, 1));
        }
        col = [col[0] * light, col[1] * light, col[2] * light];
      }
      const k = (j * W + i) * 4;
      data[k] = col[0];
      data[k + 1] = col[1];
      data[k + 2] = col[2];
      data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  drawFeatures(ctx, scale);
  return canvas;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawFeatures(ctx: CanvasRenderingContext2D, s: number) {
  ctx.save();
  ctx.scale(s, s);
  ctx.lineJoin = 'round';

  // Dead Man's Plateau: a great tree stump
  {
    const g = ctx.createRadialGradient(300, 580, 4, 300, 580, 34);
    g.addColorStop(0, '#b8743c');
    g.addColorStop(0.7, '#8a4f26');
    g.addColorStop(1, '#5a3218');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(300, 580, 34, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,10,0.6)';
    ctx.lineWidth = 1;
    for (let r = 6; r < 30; r += 5) {
      ctx.beginPath();
      ctx.ellipse(300, 580, r, r * 0.88, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Vul-Kar Point
  {
    const g = ctx.createRadialGradient(540, 350, 6, 540, 350, 46);
    g.addColorStop(0, '#2c2a44');
    g.addColorStop(1, '#1a1830');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(540, 350, 46, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0d0c18';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // trail connections (subtle) then spaces
  ctx.strokeStyle = 'rgba(40,45,60,0.35)';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  for (const a of SPACES) {
    for (const bId of ADJ[a.id]) {
      const b = SPACE[bId];
      if (a.id > bId || a.bridge || b.bridge || a.special === 'water' || b.special === 'water') continue;
      if (a.special === 'start' || b.special === 'start' || a.special === 'vulkar' || b.special === 'vulkar') continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  for (const sp of SPACES) {
    if (sp.bridge || sp.special === 'water' || sp.special === 'start' || sp.special === 'vulkar') continue;
    if (sp.special === 'dock') continue;
    // orientation along the trail
    const nb = ADJ[sp.id].map((id) => SPACE[id]).filter((n) => !n.bridge);
    let ang = 0;
    if (nb.length >= 2) ang = Math.atan2(nb[1].y - nb[0].y, nb[1].x - nb[0].x);
    else if (nb.length === 1) ang = Math.atan2(nb[0].y - sp.y, nb[0].x - sp.x);
    const w = sp.special === 'beach' ? 36 : sp.special === 'witchlordStep' ? 26 : 26;
    const h = sp.special === 'beach' ? 30 : 19;
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(ang);
    roundedRect(ctx, -w / 2, -h / 2, w, h, 6);
    ctx.fillStyle = sp.dark ? '#33404c' : sp.safe && sp.trail !== 'GG' && sp.trail !== 'GSB' && sp.trail !== 'CP' && sp.trail !== 'C6' && sp.trail !== 'HR' ? '#aeb9c4' : '#9fb0bd';
    if (sp.special === 'beach') ctx.fillStyle = '#c9d0d3';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1c2530';
    ctx.stroke();
    if (sp.rockChip) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 9; i++) {
        const px = -w / 2 + 4 + ((i * 7.3) % (w - 8));
        const py = -h / 2 + 3 + ((i * 5.1) % (h - 6));
        ctx.beginPath();
        ctx.arc(px, py, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // caves
  for (const c of CAVES) {
    const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, 16);
    g.addColorStop(0, '#05040a');
    g.addColorStop(0.75, '#141225');
    g.addColorStop(1, 'rgba(30,26,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 17, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2f2ff';
    ctx.font = 'bold 13px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(c.n), c.x + 20, c.y + 8);
  }

  // smolder pits
  for (const p of PITS) {
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 20);
    g.addColorStop(0, '#ffb347');
    g.addColorStop(0.35, '#d24a1c');
    g.addColorStop(0.8, '#5a1c0e');
    g.addColorStop(1, 'rgba(60,20,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 21, 17, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,180,0.9)';
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 6 + ((i * 37) % 9);
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.8, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe9c0';
    ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.id, p.x, p.y + 30);
  }

  // fireball resting places (flame markers)
  for (const f of FIREBALLS) {
    if (f.id === 'V') continue;
    ctx.save();
    ctx.translate(f.x, f.y);
    for (let i = 0; i < 5; i++) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(10, -6, 22, -2);
      ctx.quadraticCurveTo(10, 2, 0, 0);
      ctx.fillStyle = i % 2 ? '#ff6a1a' : '#ffcc33';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#4a1010';
    ctx.fill();
    ctx.restore();
  }
  // lava streaks marking Vul-Kar's rollways
  ctx.strokeStyle = 'rgba(255,90,20,0.75)';
  ctx.lineWidth = 3;
  ctx.setLineDash([9, 7]);
  const streaks: [number, number][][] = [
    [[520, 385], [470, 400], [462, 460], [478, 505]],
    [[500, 365], [450, 375], [400, 360], [332, 335]],
    [[580, 320], [600, 300], [640, 262], [668, 258]],
    [[315, 200], [360, 215], [400, 190]],
    [[668, 258], [640, 210], [640, 150]],
  ];
  for (const st of streaks) {
    ctx.beginPath();
    ctx.moveTo(st[0][0], st[0][1]);
    for (const [x, y] of st.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // The Ruin
  {
    ctx.fillStyle = '#c7a45c';
    roundedRect(ctx, RUIN.x - 26, RUIN.y - 22, 52, 44, 4);
    ctx.fill();
    ctx.strokeStyle = '#6b4c22';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(80,60,30,0.5)';
    ctx.lineWidth = 1;
    for (let i = -18; i < 18; i += 9) {
      ctx.beginPath();
      ctx.moveTo(RUIN.x - 26, RUIN.y + i);
      ctx.lineTo(RUIN.x + 26, RUIN.y + i);
      ctx.stroke();
    }
    ctx.fillStyle = '#5a5fa8';
    ctx.beginPath();
    ctx.arc(RUIN.x, RUIN.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2a10';
    ctx.font = 'bold 9px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('THE RUIN', RUIN.x, RUIN.y + 32);
  }

  // The Dock: wooden pier
  {
    ctx.save();
    ctx.translate(110, 358);
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(-30, -14, 52, 28);
    ctx.strokeStyle = '#3d2610';
    ctx.lineWidth = 1.5;
    for (let i = -28; i < 22; i += 5) {
      ctx.beginPath();
      ctx.moveTo(i, -14);
      ctx.lineTo(i, 14);
      ctx.stroke();
    }
    ctx.strokeStyle = '#5a3a18';
    ctx.lineWidth = 3;
    ctx.strokeRect(-30, -14, 52, 28);
    ctx.fillStyle = '#fff3c4';
    ctx.font = 'bold 9px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('THE DOCK', -4, 26);
    ctx.restore();
  }

  // water penalty area marker
  {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(95, 300, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 9px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('W', 95, 303);
  }

  // skeleton on Skeleton Head Beach and shipwreck
  ctx.strokeStyle = 'rgba(70,55,35,0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(905, 95, 5, 0, Math.PI * 2);
  ctx.moveTo(905, 100);
  ctx.lineTo(905, 116);
  ctx.moveTo(896, 106);
  ctx.lineTo(914, 106);
  ctx.moveTo(905, 116);
  ctx.lineTo(898, 126);
  ctx.moveTo(905, 116);
  ctx.lineTo(912, 126);
  ctx.stroke();

  // title
  ctx.save();
  ctx.translate(640, 690);
  ctx.rotate(-0.04);
  ctx.font = 'italic bold 30px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#3b1a55';
  ctx.strokeText('FIRE ISLE', 0, 0);
  const grad = ctx.createLinearGradient(0, -24, 0, 6);
  grad.addColorStop(0, '#ffe66d');
  grad.addColorStop(0.55, '#ff9a1f');
  grad.addColorStop(1, '#e8412a');
  ctx.fillStyle = grad;
  ctx.fillText('FIRE ISLE', 0, 0);
  ctx.font = 'bold 8px Helvetica, Arial, sans-serif';
  ctx.fillStyle = '#fff5d6';
  ctx.fillText('THE DIMENSIONAL ADVENTURE GAME OF PITFALLS AND PERILS', 0, 14);
  ctx.restore();

  ctx.restore();
}

/** Paint trail names as a separate overlay canvas (optional map labels). */
export function paintLabels(scale = 2): HTMLCanvasElement {
  const W = BOARD_W * scale;
  const H = BOARD_H * scale;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const labels: [string, number, number, number][] = [
    ["DEAD MAN'S PLATEAU", 300, 626, 0], ['WITCHLORD TRAIL', 560, 612, 0.02], ['WITCHLORD STEP', 846, 560, 0],
    ['THUNDER ALLEY', 930, 330, -Math.PI / 2], ['SKELETON HEAD BEACH', 800, 74, 0], ['LOW ROAD', 470, 72, 0],
    ['HIGH ROAD', 420, 182, 0.05], ['GRIM GULLY', 150, 118, -0.6], ['FIREFLASH CHUTE', 700, 320, -1.2],
    ['VUL-KAR POINT', 540, 400, 0], ['BLISTER RUN', 790, 420, -1.35], ['GREAT SWAY BLUFF', 150, 320, 0],
    ['CHASM PEAK', 400, 262, 0.7], ['VIPER PASS', 205, 372, -0.6], ['DOCK RUN', 108, 470, -Math.PI / 2],
  ];
  ctx.font = 'bold 12px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [t, x, y, r] of labels) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,10,40,0.85)';
    ctx.strokeText(t, 0, 0);
    ctx.fillStyle = '#fff1c9';
    ctx.fillText(t, 0, 0);
    ctx.restore();
  }
  return canvas;
}
