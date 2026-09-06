// Animated sea around the island: gentle waves, sun glints, and foam along the shore.
import * as THREE from 'three';
import { BOARD_H, BOARD_W } from '../../engine/board.ts';
import { WORLD_H, WORLD_W, shoreMaskCanvas } from './terrain.ts';

const vert = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vWave;
  void main() {
    vUv = uv;
    vec3 p = position;
    float w = sin(p.x * 1.7 + uTime * 1.1) * 0.02 + sin(p.z * 2.3 - uTime * 0.9) * 0.015 + sin((p.x + p.z) * 3.1 + uTime * 1.7) * 0.008;
    p.y += w;
    vWave = w;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform sampler2D uShore;   // 1 on land, fades to 0 out at sea
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSun;
  uniform vec3 uCamera;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vWave;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  void main() {
    float shore = texture2D(uShore, vUv).r;
    // analytic wave normal from the same sines used in the vertex shader
    float dx = cos(vWorld.x * 1.7 + uTime * 1.1) * 0.034 + cos((vWorld.x + vWorld.z) * 3.1 + uTime * 1.7) * 0.025;
    float dz = -cos(vWorld.z * 2.3 - uTime * 0.9) * 0.035 + cos((vWorld.x + vWorld.z) * 3.1 + uTime * 1.7) * 0.025;
    vec3 n = normalize(vec3(-dx * 6.0, 1.0, -dz * 6.0));
    vec3 view = normalize(uCamera - vWorld);
    vec3 h = normalize(normalize(uSun) + view);
    float spec = pow(max(dot(n, h), 0.0), 140.0);
    float fresnel = pow(1.0 - max(dot(n, view), 0.0), 3.0);
    // colour: deep far out, turquoise over the shelf
    float depthT = smoothstep(0.0, 0.85, shore);
    vec3 col = mix(uDeep, uShallow, depthT);
    // caustic-like shimmer over the shallows
    float shimmer = noise(vWorld.xz * 2.2 + uTime * 0.25) * noise(vWorld.xz * 3.7 - uTime * 0.2);
    col += shimmer * 0.18 * depthT;
    // foam band hugging the shore, animated
    float foamNoise = noise(vWorld.xz * 6.0 + vec2(uTime * 0.6, -uTime * 0.4));
    float foam = smoothstep(0.62, 0.9, shore + foamNoise * 0.12) * (1.0 - smoothstep(0.93, 1.0, shore));
    foam += smoothstep(0.55, 0.62, shore + vWave * 4.0) * 0.25 * foamNoise;
    col = mix(col, vec3(0.95, 0.98, 1.0), clamp(foam, 0.0, 1.0) * 0.9);
    col += vec3(1.0, 0.95, 0.85) * spec * 0.9 + vec3(0.55, 0.7, 1.0) * fresnel * 0.25;
    float alpha = mix(0.86, 0.6, depthT) + foam * 0.3;
    // fade out where the plane would poke through the beach so the sand shows
    alpha *= 1.0 - smoothstep(0.96, 1.0, shore);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function makeWater(quality: 'high' | 'low'): { mesh: THREE.Mesh; update: (t: number, camera: THREE.Camera) => void } {
  const shoreTex = new THREE.CanvasTexture(shoreMaskCanvas(256));
  shoreTex.colorSpace = THREE.NoColorSpace;
  shoreTex.flipY = false;
  const geo = new THREE.PlaneGeometry(WORLD_W + 1.2, WORLD_H + 1.2, quality === 'high' ? 96 : 48, quality === 'high' ? 70 : 36);
  geo.rotateX(-Math.PI / 2);
  // uv: map the padded plane onto the board texture space
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i) / 0.02 + BOARD_W / 2;
    const z = pos.getZ(i) / 0.02 + BOARD_H / 2;
    uv.setXY(i, x / BOARD_W, z / BOARD_H);
  }
  uv.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uShore: { value: shoreTex },
      uDeep: { value: new THREE.Color(0x0d2f7a) },
      uShallow: { value: new THREE.Color(0x2fa2c9) },
      uSun: { value: new THREE.Vector3(-9, 18, 10) },
      uCamera: { value: new THREE.Vector3() },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.0;
  mesh.renderOrder = 1;
  return {
    mesh,
    update: (t, camera) => {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uCamera.value.copy(camera.position);
    },
  };
}
