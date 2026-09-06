import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneApp {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  clock = new THREE.Clock();
  private frameCbs = new Set<(dt: number, t: number) => void>();
  private focusTarget: THREE.Vector3 | null = null;
  private focusDistance: number | null = null;
  quality: 'high' | 'low';

  constructor(public canvas: HTMLCanvasElement) {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    this.quality = isMobile ? 'low' : 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x0d0620);
    this.scene.fog = new THREE.Fog(0x0d0620, 40, 90);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.camera.position.set(0, 16, 17);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = 1.32;
    this.controls.minPolarAngle = 0.15;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 60;
    this.controls.target.set(0, 1, 0.5);
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.screenSpacePanning = false;

    const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x4a3a2a, 1.25);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.6);
    sun.position.set(-9, 18, 10);
    sun.castShadow = this.quality === 'high';
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffa060, 0.5);
    fill.position.set(12, 6, -8);
    this.scene.add(fill);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  onFrame(cb: (dt: number, t: number) => void) {
    this.frameCbs.add(cb);
    return () => this.frameCbs.delete(cb);
  }

  start() {
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      if (this.focusTarget) {
        this.controls.target.lerp(this.focusTarget, 1 - Math.pow(0.001, dt));
        if (this.focusDistance !== null) {
          const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
          const d = dir.length();
          const nd = THREE.MathUtils.lerp(d, this.focusDistance, 1 - Math.pow(0.01, dt));
          this.camera.position.copy(this.controls.target).add(dir.normalize().multiplyScalar(nd));
        }
        if (this.controls.target.distanceTo(this.focusTarget) < 0.02) {
          this.focusTarget = null;
          this.focusDistance = null;
        }
      }
      for (const cb of this.frameCbs) cb(dt, t);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  focusOn(target: THREE.Vector3, distance?: number) {
    this.focusTarget = target.clone();
    this.focusDistance = distance ?? null;
  }

  overview() {
    // portrait phones need to pull back further to fit the island's width
    const aspect = Math.min(1.2, Math.max(0.4, this.camera.aspect));
    this.focusOn(new THREE.Vector3(0, 1, 0.5), Math.min(55, 24 / aspect));
  }

  /** Raycast helper for taps. */
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(objects, true);
    return hits[0] ?? null;
  }
}
