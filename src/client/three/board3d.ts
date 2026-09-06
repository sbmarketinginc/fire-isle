// Puts the island, pieces, idol, fireballs, jewel, and animations together.
import * as THREE from 'three';
import {
  BRIDGE_DEFS, CAVE, FIREBALL, FIREBALLS, JEWEL_REST, PIT, ROUTE, RUIN, SPACE, CAVE_PREFIX,
} from './boardRefs.ts';
import type { GameView, LogEvent, PlayerId } from '../../engine/index.ts';
import {
  dieRotationFor, makeBridge, makeBushes, makeDie, makeFireball, makeHighlight, makeIdol, makeJewel, makeLandmarks, makeNameplate, makePalms, makePiece, makeRocks, makeToken, makeTrail, makeTurnRing,
} from './models.ts';
import { BOARD_SCALE, WORLD_H, WORLD_W, createTerrainGeometry, heightAt, paintBoardTexture, paintLabels, paintNormalMap, shoreDistance, surfacePoint } from './terrain.ts';
import { makeWater } from './water.ts';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ADJ, SPACES } from '../../engine/board.ts';
import { BOARD_H, BOARD_W } from '../../engine/board.ts';
import type { SceneApp } from './scene.ts';
import { duckMusic, sfx } from '../audio.ts';

/** Dark polished wood with a soft vignette for the tabletop the board sits on. */
function woodTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(1024, 1024);
  for (let j = 0; j < 1024; j++) {
    for (let i = 0; i < 1024; i++) {
      const grain = Math.sin(i * 0.11 + Math.sin(j * 0.013) * 6 + Math.sin(i * 0.031 + j * 0.017) * 2.5) * 0.5 + 0.5;
      const fine = Math.sin(i * 0.9 + j * 0.05) * 0.5 + 0.5;
      const dx = i / 1024 - 0.5;
      const dy = j / 1024 - 0.5;
      const vignette = 1 - Math.min(1, Math.hypot(dx, dy) * 1.9) * 0.75;
      const base = 0.55 + grain * 0.3 + fine * 0.08;
      const k = (j * 1024 + i) * 4;
      img.data[k] = Math.round(72 * base * vignette);
      img.data[k + 1] = Math.round(44 * base * vignette);
      img.data[k + 2] = Math.round(30 * base * vignette);
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const FACING_ROT: Record<string, number> = { S: Math.PI, SW: (3 * Math.PI) / 4, E: -Math.PI / 2, W: Math.PI / 2, NE: -Math.PI / 4 };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

export class Board3D {
  group = new THREE.Group();
  pieces = new Map<PlayerId, THREE.Group>();
  idol = makeIdol();
  jewel = makeJewel();
  fireballs = new Map<string, THREE.Mesh>();
  tokens: THREE.Mesh[] = [];
  die = makeDie();
  highlights: THREE.Mesh[] = [];
  labelMesh: THREE.Mesh;
  private trail: THREE.Mesh[] = [];
  private embers: { points: THREE.Points; update: (dt: number) => void } | null = null;
  private plates = new Map<PlayerId, THREE.Sprite>();
  private turnRing: THREE.Mesh | null = null;
  private turnRingFor: PlayerId | null = null;
  private view: GameView | null = null;
  private animating = false;
  private t = 0;
  private idolTargetRot = FACING_ROT.S;
  private bobbing: THREE.Object3D[] = [];
  onPickPath: ((path: string[]) => void) | null = null;
  private choiceMap = new Map<THREE.Mesh, string[][]>();

  constructor(private app: SceneApp) {
    const terrainMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02 });
    const terrain = new THREE.Mesh(createTerrainGeometry(app.quality === 'high' ? 240 : 160, app.quality === 'high' ? 174 : 116), terrainMat);
    const tex = new THREE.CanvasTexture(paintBoardTexture(app.quality === 'high' ? 2 : 1.5));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, app.renderer.capabilities.getMaxAnisotropy());
    terrainMat.map = tex;
    const nrm = new THREE.CanvasTexture(paintNormalMap(app.quality === 'high' ? 1024 : 512));
    nrm.colorSpace = THREE.NoColorSpace;
    terrainMat.normalMap = nrm;
    terrainMat.normalScale.set(0.85, 0.85);
    terrain.receiveShadow = true;
    terrain.castShadow = false;
    this.group.add(terrain);

    // the sea
    const water = makeWater(app.quality);
    this.group.add(water.mesh);
    app.onFrame((_dt, t) => water.update(t, app.camera));

    // palm trees in the jungle, away from the trails
    this.group.add(makePalms(this.palmSpots()));

    // raised trail stones standing proud of the terrain
    this.group.add(this.makeStones());

    // landmarks in real geometry: the pier, the Ruin, cave mouths, smolder pits, the stump, marble sockets
    this.group.add(makeLandmarks());

    // undergrowth in the jungle and boulders on the slopes
    this.group.add(makeBushes(this.propSpots(0.42, 1.45, 21, 0.62, 140)));
    this.group.add(makeRocks(this.propSpots(1.7, 3.6, 24, 0.5, 70)));

    // the summit glows: a lava ring under the idol and a warm light in its mouth
    const lava = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.95, 32), new THREE.MeshStandardMaterial({ color: 0xff5a10, emissive: 0xff4a00, emissiveIntensity: 1.2, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    lava.rotation.x = -Math.PI / 2;
    lava.position.copy(this.idol.position).add(new THREE.Vector3(0, 0.03, 0));
    this.group.add(lava);
    const mouthLight = new THREE.PointLight(0xff7a2a, 2.2, 7, 1.8);
    mouthLight.position.set(0, 0.7, -0.8);
    this.idol.add(mouthLight);

    // embers drifting up from Vul-Kar's crater
    this.embers = this.makeEmbers();
    this.group.add(this.embers.points);
    app.onFrame((dt) => this.embers?.update(dt));

    // labels overlay (toggle)
    const lgeo = createTerrainGeometry(120, 87);
    const ltex = new THREE.CanvasTexture(paintLabels(2));
    ltex.colorSpace = THREE.SRGBColorSpace;
    this.labelMesh = new THREE.Mesh(lgeo, new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.labelMesh.position.y = 0.04;
    this.labelMesh.visible = false;
    this.group.add(this.labelMesh);

    // the moulded plastic tray under the island
    const tray = new THREE.Mesh(new RoundedBoxGeometry(WORLD_W + 1.2, 0.5, WORLD_H + 1.2, 3, 0.16), new THREE.MeshPhysicalMaterial({ color: 0x142a6e, roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.4 }));
    tray.position.y = -0.3;
    tray.receiveShadow = true;
    this.group.add(tray);
    const table = new THREE.Mesh(new THREE.CircleGeometry(48, 64), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.62, metalness: 0.05 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.56;
    table.receiveShadow = true;
    this.group.add(table);

    // idol on Vul-Kar Point, set back so a piece standing on the point is not inside it
    const vk = surfacePoint(SPACE.VKP.x, SPACE.VKP.y - 30);
    this.idol.position.copy(vk);
    this.idol.rotation.y = this.idolTargetRot;
    this.idol.scale.setScalar(0.5);
    this.group.add(this.idol);

    // bridges
    for (const b of BRIDGE_DEFS) {
      const a = surfacePoint(SPACE[b.from].x, SPACE[b.from].y, 0.02);
      const c = surfacePoint(SPACE[b.to].x, SPACE[b.to].y, 0.02);
      this.group.add(makeBridge(a, c));
    }

    // fireballs at home
    for (const f of FIREBALLS) {
      const m = makeFireball();
      m.position.copy(this.fireballHome(f.id));
      if (f.id === 'V') m.visible = false;
      this.fireballs.set(f.id, m);
      this.group.add(m);
    }

    // tokens in the Ruin
    for (let i = 0; i < 4; i++) {
      const t = makeToken();
      this.tokens.push(t);
      this.group.add(t);
    }

    this.jewel.position.copy(surfacePoint(JEWEL_REST.x, JEWEL_REST.y, 0.28));
    this.group.add(this.jewel);
    this.bobbing.push(this.jewel);

    this.die.position.set(-9.5, 0.55, 6.5);
    this.die.visible = false;
    this.group.add(this.die);

    app.scene.add(this.group);
    app.onFrame((dt, t) => this.frame(dt, t));
    this.setupPicking();
  }

  /** One instanced mesh of rounded stones, one per trail space, tinted per space type. */
  private makeStones(): THREE.InstancedMesh {
    const stones = SPACES.filter((sp) => !sp.bridge && sp.special !== 'water' && sp.special !== 'start' && sp.special !== 'vulkar' && sp.special !== 'dock');
    const geo = new RoundedBoxGeometry(0.5, 0.09, 0.36, 3, 0.05);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.0 });
    const mesh = new THREE.InstancedMesh(geo, mat, stones.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const light = new THREE.Color(0x8c9aa6);
    const dark = new THREE.Color(0x2a343e);
    const beach = new THREE.Color(0xb3bbc0);
    const chip = new THREE.Color(0xa6b2bc);
    stones.forEach((sp, i) => {
      const nb = ADJ[sp.id].map((id) => SPACE[id]).filter((n) => !n.bridge);
      let ang = 0;
      if (nb.length >= 2) ang = Math.atan2(nb[1].y - nb[0].y, nb[1].x - nb[0].x);
      else if (nb.length === 1) ang = Math.atan2(nb[0].y - sp.y, nb[0].x - sp.x);
      const p = surfacePoint(sp.x, sp.y, 0.03);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
      const sc = sp.special === 'beach' ? 1.35 : sp.special === 'witchlordStep' ? 1.15 : 1;
      m.compose(p, q, new THREE.Vector3(sc, 1, sc));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, sp.dark ? dark : sp.special === 'beach' ? beach : sp.rockChip ? chip : light);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Glowing embers rising from the idol's mouth and crater. */
  private makeEmbers(): { points: THREE.Points; update: (dt: number) => void } {
    const N = this.app.quality === 'high' ? 90 : 45;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const age = new Float32Array(N);
    const life = new Float32Array(N);
    const vel = new Float32Array(N * 3);
    const origin = this.idol.position.clone().add(new THREE.Vector3(0, 0.55, -0.3));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,200,120,0.8)');
    g.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.PointsMaterial({ size: 0.22, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    const reset = (i: number) => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.25;
      pos[i * 3] = origin.x + Math.cos(a) * r;
      pos[i * 3 + 1] = origin.y;
      pos[i * 3 + 2] = origin.z + Math.sin(a) * r;
      vel[i * 3] = (Math.random() - 0.5) * 0.25;
      vel[i * 3 + 1] = 0.45 + Math.random() * 0.5;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.25 - 0.15;
      age[i] = 0;
      life[i] = 1.8 + Math.random() * 1.6;
    };
    for (let i = 0; i < N; i++) {
      reset(i);
      age[i] = Math.random() * life[i];
    }
    const update = (dt: number) => {
      for (let i = 0; i < N; i++) {
        age[i] += dt;
        if (age[i] > life[i]) reset(i);
        const k = age[i] / life[i];
        pos[i * 3] += (vel[i * 3] + Math.sin(age[i] * 3 + i) * 0.12) * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const glow = 1 - k;
        col[i * 3] = glow;
        col[i * 3 + 1] = glow * (0.45 - k * 0.3);
        col[i * 3 + 2] = glow * 0.08;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    };
    return { points, update };
  }

  /** Deterministic prop positions on ground between two heights, clear of trails and features. */
  private propSpots(hMin: number, hMax: number, clearance: number, keep: number, max: number): { x: number; y: number; z: number; scale: number }[] {
    const out: { x: number; y: number; z: number; scale: number }[] = [];
    const hash = (a: number, b: number) => {
      const v = Math.sin(a * 12.9898 + b * 78.233 + hMin * 3.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const keepOut = [
      { x: SPACE.VKP.x, y: SPACE.VKP.y, r: 70 }, { x: SPACE.DMP.x, y: SPACE.DMP.y, r: 50 }, { x: RUIN.x, y: RUIN.y, r: 45 },
      ...Object.values(CAVE).map((c) => ({ x: c.x, y: c.y, r: 30 })), ...Object.values(PIT).map((q) => ({ x: q.x, y: q.y, r: 30 })),
      ...FIREBALLS.map((f) => ({ x: f.x, y: f.y, r: 26 })),
    ];
    for (let gy = 36; gy < 720 && out.length < max; gy += 18) {
      for (let gx = 50; gx < 990 && out.length < max; gx += 18) {
        const x = gx + (hash(gx, gy) - 0.5) * 16;
        const y = gy + (hash(gy, gx) - 0.5) * 16;
        if (shoreDistance(x, y) < 16) continue;
        const h = heightAt(x, y);
        if (h < hMin || h > hMax) continue;
        if (keepOut.some((k) => Math.hypot(k.x - x, k.y - y) < k.r)) continue;
        let near = Infinity;
        for (const sp of Object.values(SPACE)) near = Math.min(near, Math.hypot(sp.x - x, sp.y - y));
        if (near < clearance) continue;
        if (hash(x, y) < keep) continue;
        const p = surfacePoint(x, y, 0);
        out.push({ x: p.x, y: p.y, z: p.z, scale: 0.6 + hash(y, x) * 0.7 });
      }
    }
    return out;
  }

  /** Deterministic palm positions on jungle ground clear of every trail and feature. */
  private palmSpots(): { x: number; y: number; z: number; scale: number; lean: number }[] {
    const out: { x: number; y: number; z: number; scale: number; lean: number }[] = [];
    const hash = (a: number, b: number) => {
      const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    const keepOut: { x: number; y: number; r: number }[] = [
      { x: SPACE.VKP.x, y: SPACE.VKP.y, r: 150 }, { x: SPACE.DMP.x, y: SPACE.DMP.y, r: 55 }, { x: RUIN.x, y: RUIN.y, r: 45 },
      ...Object.values(CAVE).map((c) => ({ x: c.x, y: c.y, r: 34 })), ...Object.values(PIT).map((p) => ({ x: p.x, y: p.y, r: 34 })),
      ...FIREBALLS.map((f) => ({ x: f.x, y: f.y, r: 30 })),
    ];
    for (let gy = 40; gy < 720 && out.length < 48; gy += 26) {
      for (let gx = 60; gx < 980 && out.length < 48; gx += 26) {
        const x = gx + (hash(gx, gy) - 0.5) * 22;
        const y = gy + (hash(gy, gx) - 0.5) * 22;
        if (shoreDistance(x, y) < 22) continue;
        const h = heightAt(x, y);
        if (h < 0.5 || h > 1.55) continue;
        if (keepOut.some((k) => Math.hypot(k.x - x, k.y - y) < k.r)) continue;
        let near = Infinity;
        for (const sp of Object.values(SPACE)) near = Math.min(near, Math.hypot(sp.x - x, sp.y - y));
        if (near < 27) continue;
        if (hash(x, y) < 0.45) continue; // thin the grid out
        const p = surfacePoint(x, y, -0.02);
        out.push({ x: p.x, y: p.y, z: p.z, scale: 0.55 + hash(y, x) * 0.4, lean: hash(x + 1, y + 1) * Math.PI * 2 });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  private fireballHome(id: string): THREE.Vector3 {
    const f = FIREBALL[id as keyof typeof FIREBALL];
    if (id === 'V') {
      const p = this.idol.position.clone();
      p.y += 0.45;
      return p;
    }
    return surfacePoint(f.x, f.y, 0.17);
  }

  overview() {
    this.app.overview();
  }

  spacePoint(id: string, lift = 0): THREE.Vector3 {
    const s = SPACE[id];
    if (s.bridge) {
      // stand on the bridge deck, not on the gorge floor below it
      const def = BRIDGE_DEFS.find((b) => b.id === id)!;
      const a = surfacePoint(SPACE[def.from].x, SPACE[def.from].y, 0.02);
      const c = surfacePoint(SPACE[def.to].x, SPACE[def.to].y, 0.02);
      const p = surfacePoint(s.x, s.y, 0);
      p.y = Math.max(a.y, c.y) + 0.12 + 0.03 + lift;
      return p;
    }
    const onStone = s.special !== 'water' && s.special !== 'start' && s.special !== 'vulkar' && s.special !== 'dock';
    const extra = onStone ? 0.085 : s.special === 'start' ? 0.26 : s.special === 'dock' ? 0.16 : 0;
    return surfacePoint(s.x, s.y, lift + extra);
  }

  private locationPoint(view: GameView, pid: PlayerId): { pos: THREE.Vector3; lying: boolean; sunk: boolean } {
    const p = view.players[pid];
    const loc = p.loc;
    if (loc.kind === 'space') {
      const others = view.players.filter((o) => o.loc.kind === 'space' && o.loc.id === loc.id);
      const idx = others.findIndex((o) => o.id === pid);
      const pos = this.spacePoint(loc.id, 0.02);
      if (others.length > 1) {
        // fan the pieces evenly around the space so none hides behind another
        const r = SPACE[loc.id].special === 'start' ? 0.34 : 0.24;
        const a = (idx / others.length) * Math.PI * 2 + Math.PI / 4;
        pos.add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      return { pos, lying: false, sunk: false };
    }
    if (loc.kind === 'cave') {
      // stand at the cave mouth, half-size, so the piece stays visible from above
      const c = CAVE[loc.n];
      return { pos: surfacePoint(c.x, c.y, 0.02), lying: false, sunk: true };
    }
    if (loc.kind === 'pit') {
      const pit = PIT[loc.pit];
      const others = view.players.filter((o) => o.loc.kind === 'pit' && o.loc.pit === loc.pit);
      const idx = others.findIndex((o) => o.id === pid);
      const pos = surfacePoint(pit.x, pit.y, 0.02).add(new THREE.Vector3(Math.cos(idx * 2.4) * 0.2 * (others.length > 1 ? 1 : 0), 0, Math.sin(idx * 2.4) * 0.2 * (others.length > 1 ? 1 : 0)));
      return { pos, lying: loc.down, sunk: false };
    }
    const others = view.players.filter((o) => o.loc.kind === 'water');
    const idx = others.findIndex((o) => o.id === pid);
    const wp = surfacePoint(SPACE.W.x + idx * 12, SPACE.W.y + idx * 8, 0.04); // afloat in the water penalty area
    return { pos: wp, lying: false, sunk: false };
  }

  /** Synchronise every object with the view (no animation). */
  setView(view: GameView) {
    this.view = view;
    for (const p of view.players) {
      let g = this.pieces.get(p.id);
      if (!g) {
        g = makePiece(p.color);
        this.pieces.set(p.id, g);
        this.group.add(g);
        const plate = makeNameplate(p.name, p.color);
        this.plates.set(p.id, plate);
        this.group.add(plate);
      }
      const lp = this.locationPoint(view, p.id);
      g.position.copy(lp.pos);
      g.rotation.set(lp.lying ? Math.PI / 2 : 0, g.rotation.y, 0);
      g.scale.setScalar(lp.sunk ? 0.62 : 1);
    }
    this.syncJewel(view);
    this.syncTokens(view);
    this.idolTargetRot = FACING_ROT[view.vulkarFacing] ?? Math.PI;
    // ring under the active player's piece
    if (!this.turnRing || this.turnRingFor !== view.active) {
      if (this.turnRing) this.group.remove(this.turnRing);
      this.turnRing = makeTurnRing(view.players[view.active].color);
      this.turnRingFor = view.active;
      this.group.add(this.turnRing);
    }
    this.turnRing.visible = view.phase !== 'gameOver';
  }

  private syncJewel(view: GameView) {
    const j = view.jewel;
    if (j.kind === 'vulkar') {
      this.jewel.position.copy(surfacePoint(JEWEL_REST.x, JEWEL_REST.y, 0.28));
      this.jewel.visible = true;
    } else if (j.kind === 'space') {
      this.jewel.position.copy(this.spacePoint(j.id, 0.3));
      this.jewel.visible = true;
    } else {
      const g = this.pieces.get(j.player);
      if (g) {
        this.jewel.position.copy(g.position).add(new THREE.Vector3(0, 0.92, 0));
        this.jewel.visible = true;
      }
    }
  }

  private syncTokens(view: GameView) {
    let i = 0;
    for (const p of view.players) {
      if (p.hasToken) {
        const g = this.pieces.get(p.id)!;
        const t = this.tokens[i++];
        t.visible = true;
        t.position.copy(g.position).add(new THREE.Vector3(0.24, 0.03, 0.2));
      }
    }
    for (let k = 0; k < view.tokensInRuin && i < 4; k++, i++) {
      const t = this.tokens[i];
      t.visible = true;
      t.position.copy(surfacePoint(RUIN.x, RUIN.y, 0.02 + k * 0.07));
    }
    for (; i < 4; i++) this.tokens[i].visible = false;
  }

  // ---------------------------------------------------------------------------
  private frame(dt: number, t: number) {
    this.t = t;
    // idol turns to face its target route
    const d = this.idolTargetRot - this.idol.rotation.y;
    const dd = Math.atan2(Math.sin(d), Math.cos(d));
    this.idol.rotation.y += dd * Math.min(1, dt * 3);
    // jewel bob & spin
    this.jewel.rotation.y += dt * 1.2;
    if (this.view?.jewel.kind === 'player' && !this.animating) {
      const g = this.pieces.get(this.view.jewel.player);
      if (g) this.jewel.position.copy(g.position).add(new THREE.Vector3(0, 0.92 + Math.sin(t * 3) * 0.03, 0));
    }
    // nameplates follow their pieces; the turn ring pulses under the active piece
    for (const [pid, plate] of this.plates) {
      const g = this.pieces.get(pid);
      if (!g) continue;
      const carrying = this.view?.jewel.kind === 'player' && this.view.jewel.player === pid;
      plate.position.copy(g.position).add(new THREE.Vector3(0, (carrying ? 1.3 : 1.05) * g.scale.x + 0.1, 0));
      plate.visible = this.view?.players[pid].loc.kind !== 'pit' || !(this.view.players[pid].loc as { down?: boolean }).down;
    }
    if (this.turnRing && this.view) {
      const g = this.pieces.get(this.view.active);
      if (g) {
        this.turnRing.position.copy(g.position).add(new THREE.Vector3(0, 0.02, 0));
        const k = 1 + 0.1 * Math.sin(t * 4);
        this.turnRing.scale.set(k, 1, k);
        (this.turnRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 4);
      }
    }
    for (const h of this.highlights) {
      const m = h.material as THREE.MeshBasicMaterial;
      m.opacity = 0.65 + 0.35 * Math.sin(t * 5 + h.position.x);
      h.scale.setScalar(1 + 0.08 * Math.sin(t * 5 + h.position.x));
    }
  }

  // ---------------------------------------------------------------------------
  // Choices (highlighted spaces)
  // ---------------------------------------------------------------------------

  showChoices(paths: string[][], frame = false) {
    this.clearChoices();
    const byEnd = new Map<string, string[][]>();
    for (const p of paths) {
      const end = p[p.length - 1];
      if (!byEnd.has(end)) byEnd.set(end, []);
      byEnd.get(end)!.push(p);
    }
    for (const [end, ps] of byEnd) {
      const h = makeHighlight(end.startsWith(CAVE_PREFIX) ? 0x9be7ff : 0xffd54a);
      if (end.startsWith(CAVE_PREFIX)) {
        const c = CAVE[Number(end.slice(CAVE_PREFIX.length)) as keyof typeof CAVE];
        h.position.copy(surfacePoint(c.x, c.y, 0.12));
      } else {
        h.position.copy(this.spacePoint(end, 0.08));
      }
      this.highlights.push(h);
      this.choiceMap.set(h, ps);
      this.group.add(h);
    }
    if (frame && this.highlights.length) {
      // frame the camera on the piece and every reachable space
      const box = new THREE.Box3();
      for (const h of this.highlights) box.expandByPoint(h.position);
      if (this.view) {
        const g = this.pieces.get(this.view.active);
        if (g) box.expandByPoint(g.position);
      }
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.z, 2.5);
      const aspect = Math.min(1, this.app.camera.aspect);
      this.app.focusOn(center, THREE.MathUtils.clamp((span * 1.6) / aspect + 4, 7, 40));
    }
  }

  clearChoices() {
    for (const h of this.highlights) this.group.remove(h);
    this.highlights = [];
    this.choiceMap.clear();
  }

  private setupPicking() {
    const canvas = this.app.canvas;
    let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved > 12 || dt > 1000 || this.highlights.length === 0) return;
      const hit = this.app.pick(e.clientX, e.clientY, this.highlights);
      if (hit) {
        const ps = this.choiceMap.get(hit.object as THREE.Mesh);
        if (ps && this.onPickPath) this.onPickPath(ps[0]);
        return;
      }
      // tolerant pick: nearest highlight within a screen radius
      let best: { h: THREE.Mesh; d: number } | null = null;
      const rect = canvas.getBoundingClientRect();
      for (const h of this.highlights) {
        const v = h.position.clone().project(this.app.camera);
        const sx = rect.left + ((v.x + 1) / 2) * rect.width;
        const sy = rect.top + ((1 - v.y) / 2) * rect.height;
        const d = Math.hypot(sx - e.clientX, sy - e.clientY);
        if (d < 36 && (!best || d < best.d)) best = { h, d };
      }
      if (best) {
        const ps = this.choiceMap.get(best.h);
        if (ps && this.onPickPath) this.onPickPath(ps[0]);
      }
    });
  }

  choicesFor(end: string): string[][] {
    for (const [h, ps] of this.choiceMap) if (ps[0][ps[0].length - 1] === end) return ps;
    return [];
  }

  // ---------------------------------------------------------------------------
  // Animations driven by log events
  // ---------------------------------------------------------------------------

  async playEvents(events: LogEvent[], finalView: GameView, fast = false) {
    this.animating = true;
    try {
      for (const e of events) {
        switch (e.type) {
          case 'roll':
          case 'caveRoll':
            await this.animateDie(Number((e.data as { raw?: number; value?: number })?.raw ?? (e.data as { value?: number })?.value ?? 1), fast);
            break;
          case 'move':
            await this.animateMove(e.player!, (e.data as { path: string[] }).path, finalView, fast);
            break;
          case 'movedBack':
            await this.animateMove(e.player!, (e.data as { path: string[] }).path, finalView, fast);
            break;
          case 'fireball':
            await this.animateFireball((e.data as { route: string }).route, fast);
            break;
          case 'fireballed':
            sfx.hit();
            await this.animateKnock(e.player!, finalView, fast);
            break;
          case 'caveMove':
          case 'caveEnter':
            sfx.cave();
            await this.animateCave(e.player!, finalView, fast);
            break;
          case 'capture':
          case 'stolen':
          case 'jewelPicked':
            sfx.jewel();
            break;
          case 'cardPlayed':
            sfx.card();
            break;
          case 'win':
            sfx.win();
            break;
        }
      }
    } finally {
      this.animating = false;
      this.setView(finalView);
    }
  }

  private async animateDie(value: number, fast: boolean) {
    const die = this.die;
    // place the die in front of the camera's view of the board
    const cam = this.app.camera;
    const target = this.app.controls.target.clone();
    const toCam = new THREE.Vector3().subVectors(cam.position, target).setY(0).normalize();
    const pos = target.clone().add(toCam.multiplyScalar(Math.min(5, cam.position.distanceTo(target) * 0.35)));
    pos.y = Math.max(heightAt(pos.x / BOARD_SCALE + BOARD_W / 2, pos.z / BOARD_SCALE + BOARD_H / 2), 0) + 0.6;
    die.position.copy(pos);
    die.visible = true;
    sfx.dice();
    const dur = fast ? 250 : 800;
    const start = performance.now();
    const spin = new THREE.Vector3(Math.random() * 12 + 8, Math.random() * 12 + 8, Math.random() * 12 + 8);
    await new Promise<void>((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / dur);
        die.rotation.x += spin.x * 0.016 * (1 - k);
        die.rotation.y += spin.y * 0.016 * (1 - k);
        die.rotation.z += spin.z * 0.016 * (1 - k);
        die.position.y = pos.y + Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 0.6;
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
    const rot = dieRotationFor(value);
    die.rotation.copy(rot);
    die.position.y = pos.y;
    await sleep(fast ? 200 : 700);
    die.visible = false;
  }

  private async tween(obj: THREE.Object3D, to: THREE.Vector3, ms: number, arc = 0.35) {
    const from = obj.position.clone();
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / ms);
        const e = ease(k);
        obj.position.lerpVectors(from, to, e);
        obj.position.y += Math.sin(k * Math.PI) * arc;
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
  }

  private async animateMove(pid: PlayerId, path: string[], finalView: GameView, fast: boolean) {
    const g = this.pieces.get(pid);
    if (!g) return;
    g.rotation.set(0, g.rotation.y, 0);
    g.scale.setScalar(1);
    const spaces = path.filter((s) => !s.startsWith(CAVE_PREFIX));
    const startPos = g.position.clone();
    this.app.focusOn(startPos, undefined);
    for (const id of spaces) {
      const to = this.spacePoint(id, 0.02);
      g.rotation.y = Math.atan2(to.x - g.position.x, to.z - g.position.z);
      sfx.step();
      await this.tween(g, to, fast ? 90 : 320, 0.3);
      this.app.focusOn(to.clone());
    }
    if (this.view && finalView.jewel.kind === 'player' && finalView.jewel.player === pid) {
      this.jewel.position.copy(g.position).add(new THREE.Vector3(0, 0.92, 0));
    }
    this.view = finalView;
  }

  private async animateCave(pid: PlayerId, finalView: GameView, fast: boolean) {
    const g = this.pieces.get(pid);
    if (!g) return;
    const lp = this.locationPoint(finalView, pid);
    this.app.focusOn(lp.pos.clone(), 9);
    const above = lp.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    await this.tween(g, above, fast ? 80 : 350, 0.1);
    await this.tween(g, lp.pos, fast ? 80 : 350, 0);
    g.scale.setScalar(0.62);
  }

  private async animateKnock(pid: PlayerId, finalView: GameView, fast: boolean) {
    const g = this.pieces.get(pid);
    if (!g) return;
    // topple
    const start = performance.now();
    const ms = fast ? 120 : 350;
    await new Promise<void>((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / ms);
        g.rotation.x = (Math.PI / 2) * ease(k);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
    await sleep(fast ? 100 : 400);
    const lp = this.locationPoint(finalView, pid);
    if (finalView.players[pid].loc.kind === 'water') sfx.splash();
    await this.tween(g, lp.pos, fast ? 150 : 600, 1.2);
    g.rotation.x = lp.lying ? Math.PI / 2 : 0;
  }

  private async animateFireball(routeId: string, fast: boolean) {
    const route = ROUTE[routeId];
    if (!route) return;
    const ball = this.fireballs.get(route.fireball)!;
    const pts: THREE.Vector3[] = [];
    const home = this.fireballHome(route.fireball);
    if (route.fireball === 'V') {
      // wait for the idol to face the trailway, then emerge from the mouth
      this.idolTargetRot = FACING_ROT[route.facing ?? 'S'];
      await sleep(fast ? 100 : 700);
      const mouth = new THREE.Vector3(0, 0.5, -0.9).applyEuler(new THREE.Euler(0, this.idolTargetRot, 0)).multiplyScalar(0.62).add(this.idol.position);
      pts.push(mouth);
    } else {
      pts.push(home.clone());
    }
    for (const l of route.lead ?? []) pts.push(surfacePoint(l.x, l.y, 0.2));
    for (const id of route.spaces) pts.push(this.spacePoint(id, 0.2));
    // overshoot a little past the last space
    const last = pts[pts.length - 1].clone();
    const prev = pts[pts.length - 2] ?? last;
    pts.push(last.clone().add(new THREE.Vector3().subVectors(last, prev).setLength(0.6)));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
    const len = curve.getLength();
    const ms = fast ? Math.max(300, len * 60) : Math.max(900, len * 260);
    ball.visible = true;
    ball.position.copy(pts[0]);
    this.app.focusOn(curve.getPoint(0.5), Math.max(9, len * 0.9));
    duckMusic(ms + 800);
    sfx.fireball();
    // heat: a travelling light and a fading trail behind the marble
    const glow = new THREE.PointLight(0xff6a1a, 3.2, 5.5, 1.6);
    ball.add(glow);
    const mat = ball.material as THREE.MeshStandardMaterial;
    const baseEmissive = mat.emissiveIntensity;
    mat.emissiveIntensity = 1.6;
    if (!this.trail.length) {
      this.trail = makeTrail(12);
      for (const t of this.trail) this.group.add(t);
    }
    const history: THREE.Vector3[] = [];
    const start = performance.now();
    const knocked = new Set<PlayerId>();
    await new Promise<void>((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / ms);
        const p = curve.getPoint(k);
        ball.position.copy(p);
        ball.rotation.x += 0.35;
        history.unshift(p.clone());
        if (history.length > this.trail.length * 3) history.pop();
        this.trail.forEach((t, i) => {
          const h = history[i * 3];
          t.visible = !!h;
          if (h) t.position.copy(h);
        });
        // knock over any piece the ball passes
        if (this.view) {
          for (const pl of this.view.players) {
            const g = this.pieces.get(pl.id);
            if (!g || knocked.has(pl.id)) continue;
            if (pl.loc.kind === 'space' && route.spaces.includes(pl.loc.id) && g.position.distanceTo(p) < 0.45 && !SPACE[pl.loc.id].safe) {
              knocked.add(pl.id);
              g.rotation.x = Math.PI / 2;
            }
          }
        }
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
    ball.remove(glow);
    mat.emissiveIntensity = baseEmissive;
    for (const t of this.trail) t.visible = false;
    await sleep(fast ? 100 : 500);
    ball.visible = route.fireball !== 'V';
    ball.position.copy(home);
  }
}
