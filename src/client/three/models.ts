// 3D models for the game pieces, built from primitives so the game needs no binary assets.
import * as THREE from 'three';
import { CAVES, FIREBALLS, PITS, RUIN, SPACE } from '../../engine/board.ts';
import { surfacePoint } from './terrain.ts';

const black = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.35, metalness: 0.15 });

let shadowTex: THREE.CanvasTexture | null = null;
function shadowTexture(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

export function makePiece(color: string): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: 0.38, metalness: 0.02, clearcoat: 0.55, clearcoatRoughness: 0.35 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.36), mat);
  base.position.y = 0.03;
  g.add(base);
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.26, 10), mat);
  legL.position.set(-0.07, 0.19, 0.02);
  const legR = legL.clone();
  legR.position.set(0.07, 0.19, -0.05);
  legR.rotation.x = 0.35;
  g.add(legL, legR);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.28, 12), mat);
  torso.position.y = 0.45;
  g.add(torso);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.09), mat);
  pack.position.set(0, 0.47, -0.13);
  g.add(pack);
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 8), mat);
  armL.position.set(-0.15, 0.45, 0.02);
  armL.rotation.z = 0.35;
  const armR = armL.clone();
  armR.position.set(0.15, 0.47, 0.06);
  armR.rotation.z = -0.5;
  armR.rotation.x = -0.9;
  g.add(armL, armR);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 12), mat);
  head.position.y = 0.67;
  g.add(head);
  // a face: two eyes under the brim, so the explorer has a front
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1010, roughness: 0.4 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eyeMat);
    eye.position.set(sx * 0.03, 0.675, 0.078);
    g.add(eye);
  }
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.7 }));
  belt.position.y = 0.33;
  g.add(belt);
  // soft contact shadow so the piece sits on the ground even without shadow maps
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  shadow.renderOrder = 2;
  g.add(shadow);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.07, 14), mat);
  hat.position.y = 0.73;
  g.add(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.018, 16), mat);
  brim.position.y = 0.705;
  g.add(brim);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  g.userData.color = color;
  return g;
}

/** Vul-Kar: the fireball-breathing idol. The mouth opens toward -Z of the group. */
export function makeIdol(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.28, metalness: 0.42 });
  const rock = new THREE.MeshStandardMaterial({ color: 0x2b2438, roughness: 0.92 });
  // carved pedestal
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.12, 0.36, 14), rock);
  base.position.y = 0.18;
  g.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 8, 28), rock);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.36;
  g.add(ring);
  // head: lathe silhouette, wide jaw, domed crown
  const profile = [
    [0.0, 0.36], [0.58, 0.36], [0.74, 0.55], [0.8, 0.95], [0.77, 1.35], [0.7, 1.72], [0.6, 1.98], [0.45, 2.16], [0.22, 2.26], [0.0, 2.28],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const head = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), stone);
  g.add(head);
  // heavy brow arching over the eyes
  const brow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.14, 10, 22, Math.PI), stone);
  brow.position.set(0, 1.52, -0.58);
  brow.rotation.x = Math.PI / 2 - 0.35;
  g.add(brow);
  // cheeks and nose ridge
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), stone);
    cheek.position.set(sx * 0.5, 0.98, -0.42);
    cheek.scale.set(1, 0.8, 0.8);
    g.add(cheek);
  }
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.32), stone);
  nose.position.set(0, 1.12, -0.72);
  nose.rotation.x = -0.35;
  g.add(nose);
  // eyes: glowing embers set deep under the brow
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xff7a00, emissiveIntensity: 1.6 });
  g.userData.eyeMat = eyeMat;
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1a0500, roughness: 0.6 });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), eyeMat);
    e.position.set(sx * 0.27, 1.34, -0.64);
    g.add(e);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), pupilMat);
    pupil.position.set(sx * 0.27, 1.34, -0.73);
    g.add(pupil);
  }
  // mouth: a dark, ember-lit cavity with fangs
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x3a0606, roughness: 0.85, emissive: 0x6a1200, emissiveIntensity: 0.8 });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.5, 0.55), mouthMat);
  mouth.position.set(0, 0.72, -0.62);
  g.add(mouth);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.07, 8, 20, Math.PI), stone);
  lip.position.set(0, 0.5, -0.86);
  lip.rotation.z = Math.PI;
  g.add(lip);
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xf1ead6, roughness: 0.4 });
  for (let i = 0; i < 5; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.2, 6), toothMat);
    t.position.set(-0.3 + i * 0.15, 0.9, -0.88);
    t.rotation.x = Math.PI;
    g.add(t);
  }
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 6), toothMat);
    b.position.set(-0.22 + i * 0.147, 0.54, -0.88);
    g.add(b);
  }
  // curved horns built from tapering segments along an arc
  for (const sx of [-1, 1]) {
    const from = new THREE.Vector3(sx * 0.42, 2.05, 0.02);
    const ctrl = new THREE.Vector3(sx * 0.95, 2.55, -0.1);
    const to = new THREE.Vector3(sx * 0.95, 3.15, -0.45);
    const curve = new THREE.QuadraticBezierCurve3(from, ctrl, to);
    const segs = 7;
    for (let i = 0; i < segs; i++) {
      const a = curve.getPoint(i / segs);
      const b = curve.getPoint((i + 1) / segs);
      const r0 = 0.17 * (1 - i / segs) + 0.03;
      const r1 = 0.17 * (1 - (i + 1) / segs) + 0.03;
      const len = a.distanceTo(b) * 1.15;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 8), stone);
      seg.position.copy(a).lerp(b, 0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(seg);
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

/** A clump of palm trees as two instanced meshes (trunks and fronds). */
export function makePalms(spots: { x: number; y: number; z: number; scale: number; lean: number }[]): THREE.Group {
  const g = new THREE.Group();
  if (!spots.length) return g;
  const trunkGeo = new THREE.CylinderGeometry(0.04, 0.075, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const leaf = new THREE.Shape();
  leaf.moveTo(0, 0);
  leaf.quadraticCurveTo(0.2, 0.35, 0.03, 0.95);
  leaf.quadraticCurveTo(-0.2, 0.35, 0, 0);
  const frondGeo = new THREE.ShapeGeometry(leaf, 8);
  frondGeo.rotateX(-Math.PI / 2 + 0.75); // droop outward and down
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.65, side: THREE.DoubleSide });
  const FRONDS = 9;
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, spots.length * FRONDS);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach((sp, i) => {
    const lean = new THREE.Vector3(Math.cos(sp.lean) * 0.18, 1, Math.sin(sp.lean) * 0.18).normalize();
    q.setFromUnitVectors(up, lean);
    m.compose(new THREE.Vector3(sp.x, sp.y, sp.z), q, new THREE.Vector3(sp.scale, sp.scale, sp.scale));
    trunks.setMatrixAt(i, m);
    const top = new THREE.Vector3(sp.x, sp.y, sp.z).add(lean.clone().multiplyScalar(sp.scale));
    for (let f = 0; f < FRONDS; f++) {
      const a = (f / FRONDS) * Math.PI * 2 + sp.lean;
      const rot = new THREE.Quaternion().setFromAxisAngle(up, a);
      m.compose(top, rot, new THREE.Vector3(sp.scale * 0.9, sp.scale * 0.9, sp.scale * 0.9));
      fronds.setMatrixAt(i * FRONDS + f, m);
    }
  });
  trunks.castShadow = true;
  fronds.castShadow = true;
  g.add(trunks, fronds);
  return g;
}

/** Pool of small glowing spheres used as a fireball's trail. */
export function makeTrail(n = 10): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const k = 1 - i / n;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.07 - i * 0.004, 1, 0.55), transparent: true, opacity: 0.55 * k, depthWrite: false });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.16 * k + 0.03, 10, 8), mat);
    m.visible = false;
    m.renderOrder = 6;
    out.push(m);
  }
  return out;
}

export function makeJewel(): THREE.Mesh {
  const geo = new THREE.OctahedronGeometry(0.2, 0);
  geo.scale(1, 1.35, 1);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xff1f2a,
    emissive: 0x5a0008,
    emissiveIntensity: 0.6,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.9,
    clearcoat: 1,
  });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

export function makeFireball(): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color: 0xd11a10, emissive: 0x5a0500, emissiveIntensity: 0.5, roughness: 0.15, metalness: 0.05 });
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.19, 22, 18), mat);
  m.castShadow = true;
  return m;
}

export function makeToken(): THREE.Mesh {
  const shape = new THREE.Shape();
  const R = 0.2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    if (i === 0) shape.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    else shape.lineTo(Math.cos(a) * R, Math.sin(a) * R);
  }
  shape.closePath();
  const hole = new THREE.Path();
  const r = 0.09;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    if (i === 0) hole.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else hole.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, black);
  m.castShadow = true;
  return m;
}

/** A rickety black plank bridge spanning two points (world coordinates). */
export function makeBridge(a: THREE.Vector3, b: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const top = Math.max(a.y, b.y) + 0.12;
  g.position.copy(mid);
  g.position.y = top;
  g.rotation.y = Math.atan2(dir.x, dir.z);
  const railGeo = new THREE.BoxGeometry(0.05, 0.05, len + 0.2);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, black);
    rail.position.set(sx * 0.17, 0, 0);
    g.add(rail);
  }
  const n = Math.max(4, Math.round(len / 0.22));
  for (let i = 0; i < n; i++) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.46, 6), black);
    rung.rotation.z = Math.PI / 2;
    rung.position.set(0, 0.02, -len / 2 + 0.1 + (i * (len - 0.2)) / (n - 1));
    rung.rotation.y = (i % 2 ? 1 : -1) * 0.08;
    g.add(rung);
  }
  // legs down to the ground at each end
  for (const [z, y] of [[-len / 2, a.y], [len / 2, b.y]] as [number, number][]) {
    const h = Math.max(0.15, top - y + 0.1);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, h, 6), black);
      leg.position.set(sx * 0.14, -h / 2, z * 0.92);
      leg.rotation.x = z < 0 ? 0.25 : -0.25;
      g.add(leg);
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

function pipTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f7f4ec';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#111';
  const pos: Record<number, [number, number][]> = {
    1: [[64, 64]],
    2: [[36, 36], [92, 92]],
    3: [[36, 36], [64, 64], [92, 92]],
    4: [[36, 36], [92, 36], [36, 92], [92, 92]],
    5: [[36, 36], [92, 36], [64, 64], [36, 92], [92, 92]],
    6: [[36, 32], [92, 32], [36, 64], [92, 64], [36, 96], [92, 96]],
  };
  for (const [x, y] of pos[n]) {
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A die whose faces are arranged so `orientDie(value)` shows the value on top. */
export function makeDie(): THREE.Mesh {
  // face order for BoxGeometry: +x, -x, +y, -y, +z, -z
  const faces = [3, 4, 1, 6, 2, 5];
  const mats = faces.map((n) => new THREE.MeshStandardMaterial({ map: pipTexture(n), roughness: 0.4 }));
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mats);
  m.castShadow = true;
  return m;
}

export function dieRotationFor(value: number): THREE.Euler {
  switch (value) {
    case 1: return new THREE.Euler(0, 0, 0); // +y up
    case 6: return new THREE.Euler(Math.PI, 0, 0);
    case 3: return new THREE.Euler(0, 0, Math.PI / 2); // +x -> up
    case 4: return new THREE.Euler(0, 0, -Math.PI / 2);
    case 2: return new THREE.Euler(-Math.PI / 2, 0, 0); // +z -> up
    case 5: return new THREE.Euler(Math.PI / 2, 0, 0);
  }
  return new THREE.Euler();
}

export function makeHighlight(color = 0xffd54a): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.2, 0.34, 28);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 5;
  // dark outline so the ring reads against light trail stones
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.42, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a0a2a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  rim.renderOrder = 4;
  m.add(rim);
  return m;
}


/** Physical landmarks: the pier, the Ruin, cave mouths, smolder pits, Dead Man's stump, marble sockets. */
export function makeLandmarks(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4f28, roughness: 0.85 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x4a2e14, roughness: 0.9 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xb59a62, roughness: 0.95 });
  const hole = new THREE.MeshStandardMaterial({ color: 0x05040a, roughness: 1 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x1c1830, roughness: 0.95 });

  // The Dock: a plank pier on posts reaching out over the water
  {
    const dock = surfacePoint(SPACE.DOCK.x, SPACE.DOCK.y, 0);
    const shore = surfacePoint(SPACE.DR10.x, SPACE.DR10.y, 0);
    const dir = new THREE.Vector3().subVectors(dock, shore).setY(0);
    const len = dir.length() + 0.9;
    const yaw = Math.atan2(dir.x, dir.z);
    const pier = new THREE.Group();
    pier.position.copy(shore).add(dir.clone().setLength(len / 2 - 0.3));
    pier.position.y = Math.max(shore.y, 0) + 0.14;
    pier.rotation.y = yaw;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, len), wood);
    pier.add(deck);
    for (let i = 0; i < Math.floor(len / 0.14); i++) {
      const gap = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.012, 0.025), darkWood);
      gap.position.set(0, 0.03, -len / 2 + 0.1 + i * 0.14);
      pier.add(gap);
    }
    for (let i = 0; i < 4; i++) {
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.5, 7), darkWood);
        post.position.set(sx * 0.27, -0.2, -len / 2 + 0.2 + (i * (len - 0.4)) / 3);
        pier.add(post);
      }
    }
    // a mooring post with a lantern-like knob at the seaward end
    const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 7), darkWood);
    bollard.position.set(0.22, 0.16, len / 2 - 0.15);
    pier.add(bollard);
    g.add(pier);
  }

  // The Ruin: broken stone walls around the token altar
  {
    const c = surfacePoint(RUIN.x, RUIN.y, 0);
    const ruin = new THREE.Group();
    ruin.position.copy(c);
    const wallSpecs: [number, number, number, number, number][] = [
      [-0.5, 0, 0.08, 0.9, 0.34], [0.5, 0, 0.08, 0.9, 0.26], [0, -0.42, 0.9, 0.08, 0.3], [-0.32, 0.42, 0.34, 0.08, 0.28], [0.34, 0.42, 0.3, 0.08, 0.2],
    ];
    for (const [x, z, w, d, h] of wallSpecs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone);
      wall.position.set(x, h / 2 + 0.02, z);
      ruin.add(wall);
      // a few tumbled blocks
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), stone);
      block.position.set(x * 1.3 + 0.1, 0.05, z * 1.3 - 0.05);
      block.rotation.y = x + z;
      ruin.add(block);
    }
    const altar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 6), stone);
    altar.position.y = 0.05;
    ruin.add(altar);
    g.add(ruin);
  }

  // Cave mouths: a dark recess with a stone rim
  for (const cave of CAVES) {
    const p = surfacePoint(cave.x, cave.y, 0.015);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), hole);
    disc.rotation.x = -Math.PI / 2;
    disc.position.copy(p);
    g.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 8, 20), rim);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(p).add(new THREE.Vector3(0, 0.02, 0));
    g.add(ring);
    // the number, cut into a small plaque beside the mouth
    const plaque = numberPlaque(String(cave.n));
    plaque.position.copy(p).add(new THREE.Vector3(0.42, 0.05, 0.25));
    g.add(plaque);
  }

  // Smolder pits: a crater rim with a glowing ember bed
  const ember = new THREE.MeshStandardMaterial({ color: 0xff4a10, emissive: 0xff5a10, emissiveIntensity: 1.4, roughness: 0.9 });
  for (const pit of PITS) {
    const p = surfacePoint(pit.x, pit.y, 0.02);
    const bed = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), ember);
    bed.rotation.x = -Math.PI / 2;
    bed.position.copy(p);
    g.add(bed);
    const crater = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.07, 8, 22), rim);
    crater.rotation.x = -Math.PI / 2;
    crater.position.copy(p).add(new THREE.Vector3(0, 0.03, 0));
    crater.scale.set(1, 0.8, 1);
    g.add(crater);
    const plaque = numberPlaque(pit.id);
    plaque.position.copy(p).add(new THREE.Vector3(0, 0.05, 0.5));
    g.add(plaque);
  }

  // Dead Man's Plateau: a great tree stump
  {
    const p = surfacePoint(SPACE.DMP.x, SPACE.DMP.y, 0);
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.74, 0.26, 18), new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 }));
    stump.position.copy(p).add(new THREE.Vector3(0, 0.13, 0));
    g.add(stump);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.62, 18), new THREE.MeshStandardMaterial({ map: ringsTexture(), roughness: 0.8 }));
    top.rotation.x = -Math.PI / 2;
    top.position.copy(p).add(new THREE.Vector3(0, 0.265, 0));
    g.add(top);
    // a few roots
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.5, 6), darkWood);
      root.position.copy(p).add(new THREE.Vector3(Math.cos(a) * 0.75, 0.05, Math.sin(a) * 0.75));
      root.rotation.z = Math.PI / 2 + 0.3;
      root.rotation.y = -a;
      g.add(root);
    }
  }

  // Marble sockets at the four fireball homes
  for (const f of FIREBALLS) {
    if (f.id === 'V') continue;
    const p = surfacePoint(f.x, f.y, 0.01);
    const socket = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 18), rim);
    socket.rotation.x = -Math.PI / 2;
    socket.position.copy(p);
    g.add(socket);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff6a10, emissiveIntensity: 0.9 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.copy(p).add(new THREE.Vector3(0, -0.005, 0));
    g.add(glow);
  }

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

function ringsTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c08a4a';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(90,50,20,0.7)';
  for (let r = 10; r < 128; r += 9) {
    ctx.lineWidth = 1 + (r % 3);
    ctx.beginPath();
    ctx.ellipse(128, 128, r, r * 0.92, 0.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(60,30,10,0.8)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(128, 128);
  ctx.lineTo(210, 60);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function numberPlaque(text: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#efe6c8';
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a1608';
  ctx.font = 'bold 40px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
  m.rotation.x = -Math.PI / 2;
  return m;
}


/** Low ferns and bushes as one instanced mesh. */
export function makeBushes(spots: { x: number; y: number; z: number; scale: number }[]): THREE.InstancedMesh {
  const geo = new THREE.IcosahedronGeometry(0.17, 1);
  geo.scale(1.2, 0.65, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2f6f2e, roughness: 0.9, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  spots.forEach((sp, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sp.x * 7.3 + sp.z * 3.1);
    m.compose(new THREE.Vector3(sp.x, sp.y + 0.05 * sp.scale, sp.z), q, new THREE.Vector3(sp.scale, sp.scale, sp.scale));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHSL(0.3 + ((sp.x * 13.7) % 1) * 0.06, 0.5, 0.28 + ((sp.z * 9.1) % 1) * 0.12));
  });
  mesh.count = spots.length;
  mesh.castShadow = true;
  return mesh;
}

/** Scattered boulders for the rocky slopes. */
export function makeRocks(spots: { x: number; y: number; z: number; scale: number }[]): THREE.InstancedMesh {
  const geo = new THREE.IcosahedronGeometry(0.14, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a7290, roughness: 0.85, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach((sp, i) => {
    q.setFromEuler(new THREE.Euler(sp.x * 3.1, sp.z * 5.7, sp.x + sp.z));
    m.compose(new THREE.Vector3(sp.x, sp.y + 0.04 * sp.scale, sp.z), q, new THREE.Vector3(sp.scale * 1.3, sp.scale * 0.8, sp.scale));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = spots.length;
  mesh.castShadow = true;
  return mesh;
}

/** A name pill that always faces the camera, floated above a piece. */
export function makeNameplate(name: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const size = 40;
  ctx.font = `bold ${size}px Helvetica, Arial, sans-serif`;
  const w = Math.ceil(ctx.measureText(name).width) + 54;
  c.width = w;
  c.height = 64;
  const ctx2 = c.getContext('2d')!;
  ctx2.font = `bold ${size}px Helvetica, Arial, sans-serif`;
  ctx2.fillStyle = 'rgba(12,6,24,0.78)';
  ctx2.beginPath();
  ctx2.roundRect(0, 0, w, 64, 32);
  ctx2.fill();
  ctx2.fillStyle = color;
  ctx2.beginPath();
  ctx2.arc(30, 32, 16, 0, Math.PI * 2);
  ctx2.fill();
  ctx2.fillStyle = '#fff3d6';
  ctx2.textBaseline = 'middle';
  ctx2.fillText(name, 54, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set((w / 64) * 0.32, 0.32, 1);
  sp.renderOrder = 9;
  return sp;
}

/** Pulsing ring under the piece whose turn it is. */
export function makeTurnRing(color: string): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.28, 0.4, 32);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 3;
  return m;
}


/** Expanding ring used as a fireball impact flash. */
export function makeImpactRing(): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.12, 0.3, 28);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const m = new THREE.Mesh(geo, mat);
  m.visible = false;
  m.renderOrder = 7;
  return m;
}
