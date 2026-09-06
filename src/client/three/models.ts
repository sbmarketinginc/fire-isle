// 3D models for the game pieces, built from primitives so the game needs no binary assets.
import * as THREE from 'three';

const black = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.35, metalness: 0.15 });

export function makePiece(color: string): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.55, metalness: 0.05 });
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
  const idolMat = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.3, metalness: 0.35 });
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 1.7, 9), idolMat);
  head.position.y = 0.85;
  g.add(head);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.28, 0.7), idolMat);
  brow.position.set(0, 1.35, -0.25);
  brow.rotation.x = -0.15;
  g.add(brow);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.75, 0.55), idolMat);
  snout.position.set(0, 0.62, -0.5);
  g.add(snout);
  // mouth cavity
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x3a0606, roughness: 0.8, emissive: 0x2a0000 });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.5), mouthMat);
  mouth.position.set(0, 0.6, -0.62);
  g.add(mouth);
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xf1ead6, roughness: 0.4 });
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 6), toothMat);
    t.position.set(-0.27 + i * 0.18, 0.78, -0.86);
    t.rotation.x = Math.PI;
    g.add(t);
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), toothMat);
    b.position.set(-0.2 + i * 0.13, 0.42, -0.86);
    g.add(b);
  }
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xff8c00, emissiveIntensity: 0.9 });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), eyeMat);
    e.position.set(sx * 0.27, 1.18, -0.6);
    g.add(e);
  }
  for (const sx of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.85, 8), idolMat);
    horn.position.set(sx * 0.42, 1.95, -0.05);
    horn.rotation.z = -sx * 0.45;
    horn.rotation.x = -0.15;
    g.add(horn);
  }
  const chin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.5), idolMat);
  chin.position.set(0, 0.18, -0.5);
  g.add(chin);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
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
  const geo = new THREE.RingGeometry(0.16, 0.26, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 5;
  return m;
}
