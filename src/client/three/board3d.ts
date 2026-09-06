// Puts the island, pieces, idol, fireballs, jewel, and animations together.
import * as THREE from 'three';
import {
  BRIDGE_DEFS, CAVE, FIREBALL, FIREBALLS, JEWEL_REST, PIT, ROUTE, RUIN, SPACE, CAVE_PREFIX,
} from './boardRefs.ts';
import type { GameView, LogEvent, PlayerId } from '../../engine/index.ts';
import {
  dieRotationFor, makeBridge, makeDie, makeFireball, makeHighlight, makeIdol, makeJewel, makePiece, makeToken,
} from './models.ts';
import { BOARD_SCALE, WORLD_H, WORLD_W, createTerrainGeometry, heightAt, paintBoardTexture, paintLabels, surfacePoint } from './terrain.ts';
import { BOARD_H, BOARD_W } from '../../engine/board.ts';
import type { SceneApp } from './scene.ts';
import { duckMusic, sfx } from '../audio.ts';

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
  private view: GameView | null = null;
  private animating = false;
  private t = 0;
  private idolTargetRot = FACING_ROT.S;
  private bobbing: THREE.Object3D[] = [];
  onPickPath: ((path: string[]) => void) | null = null;
  private choiceMap = new Map<THREE.Mesh, string[][]>();

  constructor(private app: SceneApp) {
    const terrain = new THREE.Mesh(createTerrainGeometry(app.quality === 'high' ? 240 : 160, app.quality === 'high' ? 174 : 116), new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.02 }));
    const tex = new THREE.CanvasTexture(paintBoardTexture(app.quality === 'high' ? 2 : 1.5));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, app.renderer.capabilities.getMaxAnisotropy());
    (terrain.material as THREE.MeshStandardMaterial).map = tex;
    terrain.receiveShadow = true;
    terrain.castShadow = false;
    this.group.add(terrain);

    // labels overlay (toggle)
    const lgeo = createTerrainGeometry(120, 87);
    const ltex = new THREE.CanvasTexture(paintLabels(2));
    ltex.colorSpace = THREE.SRGBColorSpace;
    this.labelMesh = new THREE.Mesh(lgeo, new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.labelMesh.position.y = 0.04;
    this.labelMesh.visible = false;
    this.group.add(this.labelMesh);

    // the plastic tray under the island
    const tray = new THREE.Mesh(new THREE.BoxGeometry(WORLD_W + 1.2, 0.5, WORLD_H + 1.2), new THREE.MeshStandardMaterial({ color: 0x142a6e, roughness: 0.6 }));
    tray.position.y = -0.3;
    tray.receiveShadow = true;
    this.group.add(tray);
    const table = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x2b1a12, roughness: 0.95 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.56;
    table.receiveShadow = true;
    this.group.add(table);

    // idol on Vul-Kar Point, set back so a piece standing on the point is not inside it
    const vk = surfacePoint(SPACE.VKP.x, SPACE.VKP.y - 30);
    this.idol.position.copy(vk);
    this.idol.rotation.y = this.idolTargetRot;
    this.idol.scale.setScalar(0.62);
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

  // ---------------------------------------------------------------------------
  private fireballHome(id: string): THREE.Vector3 {
    const f = FIREBALL[id as keyof typeof FIREBALL];
    if (id === 'V') {
      const p = this.idol.position.clone();
      p.y += 0.45;
      return p;
    }
    return surfacePoint(f.x, f.y, 0.2);
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
    return surfacePoint(s.x, s.y, lift);
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
      }
      const lp = this.locationPoint(view, p.id);
      g.position.copy(lp.pos);
      g.rotation.set(lp.lying ? Math.PI / 2 : 0, g.rotation.y, 0);
      g.scale.setScalar(lp.sunk ? 0.62 : 1);
    }
    this.syncJewel(view);
    this.syncTokens(view);
    this.idolTargetRot = FACING_ROT[view.vulkarFacing] ?? Math.PI;
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
    // eye glow pulse
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
    const start = performance.now();
    const knocked = new Set<PlayerId>();
    await new Promise<void>((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / ms);
        const p = curve.getPoint(k);
        ball.position.copy(p);
        ball.rotation.x += 0.35;
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
    await sleep(fast ? 100 : 500);
    ball.visible = route.fireball !== 'V';
    ball.position.copy(home);
  }
}
