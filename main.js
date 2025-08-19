// DRV — lightweight, chill driving experience

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GUI } from "https://unpkg.com/lil-gui@0.19.2/dist/lil-gui.esm.js";

// -----------------------------
// Globals
// -----------------------------
const canvas = document.getElementById("c");
const loaderEl = document.getElementById("loader");
const loaderFill = document.getElementById("loader-fill");
const loaderPct = document.getElementById("loader-pct");
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 3.2, 6);

// Smooth follow camera rig
const cameraRig = new THREE.Object3D();
scene.add(cameraRig);
cameraRig.add(camera);

// Controls (for debug; can toggle)
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enabled = false;
orbitControls.enableDamping = true;

// Lighting
const hemi = new THREE.HemisphereLight(0xbdd3ff, 0x202018, 0.6);
scene.add(hemi);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(5, 10, 2);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
scene.add(dirLight);

// Environment state
const params = {
  timeOfDay: 18,
  fogDensity: 0.012,
  clouds: 0.3,
  roadCurviness: 0.7,
  terrainRoughness: 0.5,
  speedLimitKph: 110,
  ambient: 0.6,
  headlights: true,
  freeLook: false,
  ui: true,
};

// GUI
const gui = new GUI({ touchStyles: true });
gui.title("DRV — Environment");
gui.add(params, "timeOfDay", 0, 24, 0.1).name("Time of Day");
gui.add(params, "fogDensity", 0, 0.05, 0.001).name("Fog");
gui.add(params, "clouds", 0, 1, 0.01).name("Clouds");
gui.add(params, "roadCurviness", 0, 1, 0.01).name("Curviness");
gui.add(params, "terrainRoughness", 0, 1, 0.01).name("Roughness").onFinishChange(() => {
  regenerateTerrain();
  refreshAllSegmentsAfterTerrainChange();
});
gui.add(params, "speedLimitKph", 40, 180, 1).name("Speed Limit");
gui.add(params, "ambient", 0, 1, 0.01).name("Ambient");
gui.add(params, "headlights").name("Headlights");
gui.add(params, "freeLook").name("Free Look").onChange(v => { orbitControls.enabled = v; });

// Toggle GUI with G
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "g") {
    params.ui = !params.ui;
    gui.domElement.style.display = params.ui ? "" : "none";
  }
});

// Fog setup
scene.fog = new THREE.FogExp2(0x0a0d12, params.fogDensity);

// Ground/terrain
const groundSize = 400;
const groundSegments = 200;
const groundGeom = new THREE.PlaneGeometry(groundSize, groundSize, groundSegments, groundSegments);
groundGeom.rotateX(-Math.PI / 2);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x11181f, roughness: 1, metalness: 0 });
const ground = new THREE.Mesh(groundGeom, groundMat);
ground.receiveShadow = true;
scene.add(ground);

// Procedural terrain function (simple fractal noise)
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = s * 16807 % 2147483647) / 2147483647;
}
const rand = seededRandom(42);
function noise2(x, y) {
  // Simple value noise using deterministic hashing
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}
function fbm(x, y, octaves = 4, falloff = 0.5) {
  let value = 0;
  let amp = 0.5;
  let freq = 1.0;
  for (let i = 0; i < octaves; i++) {
    value += amp * noise2(x * freq, y * freq);
    freq *= 2.0;
    amp *= falloff;
  }
  return value;
}

function regenerateTerrain() {
  const pos = groundGeom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = (fbm(x * 0.01, z * 0.01, 5, 0.55) - 0.5) * 6 * params.terrainRoughness;
    pos.setY(i, h);
  }
  pos.needsUpdate = true;
  groundGeom.computeVertexNormals();
}

// Procedural road as a ribbon mesh that extends forward; we recycle segments
const roadWidth = 4;
const segmentLength = 6;
const numSegments = 120; // visible
const roadGroup = new THREE.Group();
scene.add(roadGroup);

const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.9, metalness: 0.0 });

const laneLineMaterial = new THREE.MeshBasicMaterial({ color: 0xf5f7fa });
const laneLineWidth = 0.08;

function createQuad(w, l, material) {
  const geom = new THREE.PlaneGeometry(w, l, 1, 1);
  geom.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geom, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

const roadSegments = [];
const laneSegments = [];
for (let i = 0; i < numSegments; i++) {
  const road = createQuad(roadWidth, segmentLength, roadMaterial);
  road.position.z = -i * segmentLength;
  road.position.y = sampleTerrainHeight(0, road.position.z) + 0.001;
  road.rotation.y = 0;
  roadGroup.add(road);
  roadSegments.push(road);

  const centerLine = createQuad(laneLineWidth, segmentLength * 0.9, laneLineMaterial);
  centerLine.position.z = road.position.z - segmentLength * 0.05;
  centerLine.position.y = road.position.y + 0.009;
  centerLine.rotation.y = 0;
  roadGroup.add(centerLine);
  laneSegments.push(centerLine);
}

// Car (simple capsule-ish body)
const car = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 3.2), new THREE.MeshStandardMaterial({ color: 0xff5533, metalness: 0.3, roughness: 0.6 }));
body.castShadow = true;
body.receiveShadow = true;
body.position.y = 0.5;
car.add(body);

// Headlights
const headlights = new THREE.SpotLight(0xffffff, 2.2, 40, Math.PI / 8, 0.3, 1.2);
headlights.position.set(0, 0.3, 1.4);
headlights.target.position.set(0, 0.0, -5);
headlights.castShadow = true;
car.add(headlights);
car.add(headlights.target);

// Taillights (emissive quads)
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff1b1b });
const tailLeft = createQuad(0.08, 0.12, tailMat);
tailLeft.rotation.x = 0; // already horizontal
tailLeft.position.set(-0.5, 0.28, -1.55);
const tailRight = tailLeft.clone();
tailRight.position.x = 0.5;
car.add(tailLeft, tailRight);

scene.add(car);

// Vehicle dynamics (very simplified)
const input = { fwd: 0, steer: 0 };
const keys = new Set();
window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === "r") resetCar();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function sampleInputs() {
  const forwardKeys = ["w", "arrowup"];
  const backKeys = ["s", "arrowdown"];
  const leftKeys = ["a", "arrowleft"];
  const rightKeys = ["d", "arrowright"];
  const f = forwardKeys.some(k => keys.has(k)) ? 1 : 0;
  const b = backKeys.some(k => keys.has(k)) ? 1 : 0;
  const l = leftKeys.some(k => keys.has(k)) ? 1 : 0;
  const r = rightKeys.some(k => keys.has(k)) ? 1 : 0;
  input.fwd = f - b;
  input.steer = r - l;
}

let velocity = 0; // m/s
let heading = 0; // radians
const maxAcceleration = 8.0; // m/s^2
const braking = 10.0;
const drag = 0.015;
const corneringGrip = 1.8; // radians per second of steer
const speedLimitMs = () => params.speedLimitKph / 3.6;

function resetCar() {
  velocity = 0;
  heading = 0;
  car.position.set(0, 0, 0);
  roadCursor = new THREE.Vector2(0, 0);
  roadDir = new THREE.Vector2(0, -1);
  segmentIndex = 0;
  for (let i = 0; i < numSegments; i++) {
    const z = -i * segmentLength;
    const y = sampleTerrainHeight(0, z) + 0.001;
    roadSegments[i].position.set(0, y, z);
    roadSegments[i].rotation.y = 0;
    laneSegments[i].position.set(0, y + 0.009, z - segmentLength * 0.05);
    laneSegments[i].rotation.y = 0;
  }
  refreshAllSegmentsAfterTerrainChange();
}

// Road generator state
let roadCursor = new THREE.Vector2(0, 0);
let roadDir = new THREE.Vector2(0, -1);
let segmentIndex = 0;

function advanceRoad() {
  // Recycle first segment to end, move forward with curvature noise
  const firstRoad = roadSegments.shift();
  const firstLane = laneSegments.shift();
  const lastRoad = roadSegments[roadSegments.length - 1];
  const lastLane = laneSegments[laneSegments.length - 1];

  segmentIndex++;
  // Curvature: vary heading by noise
  const t = segmentIndex * 0.05;
  const curvature = (fbm(t, 0.0, 3, 0.65) - 0.5) * params.roadCurviness * 0.6;
  const rot = curvature;
  roadDir.rotateAround(new THREE.Vector2(0, 0), rot);
  roadDir.normalize();
  roadCursor.addScaledVector(roadDir, segmentLength);

  const targetX = roadCursor.x;
  const targetZ = roadCursor.y;
  let targetY = sampleTerrainHeight(targetX, targetZ) + 0.001;
  // Smooth vertical transitions versus previous segment
  const prevY = lastRoad ? lastRoad.position.y : targetY;
  targetY = THREE.MathUtils.lerp(prevY, targetY, 0.35);

  // Align segment yaw to path direction
  const yaw = Math.atan2(roadDir.x, -roadDir.y);

  firstRoad.position.set(targetX, targetY, targetZ);
  firstRoad.rotation.y = yaw;
  firstLane.position.set(targetX, targetY + 0.009, targetZ - segmentLength * 0.05);
  firstLane.rotation.y = yaw;

  roadSegments.push(firstRoad);
  laneSegments.push(firstLane);

  // Gently flatten terrain under this segment to avoid z-fighting and bumps
  flattenTerrainUnderSegment(targetX, targetZ, targetY, yaw);
}

// Day/Night sky color interpolation
function updateEnvironment(dt) {
  const t = params.timeOfDay; // 0..24
  const dayColor = new THREE.Color(0x87b5ff);
  const duskColor = new THREE.Color(0x1b2b44);
  const nightColor = new THREE.Color(0x06070a);
  let sky;
  if (t >= 6 && t < 18) {
    const u = (t - 6) / 12; // 0 at 6, 1 at 18
    sky = duskColor.clone().lerp(dayColor, Math.sin(u * Math.PI));
  } else if (t >= 18 && t < 24) {
    const u = (t - 18) / 6;
    sky = nightColor.clone().lerp(duskColor, Math.cos(u * Math.PI * 0.5));
  } else {
    const u = t / 6; // 0..1 for 0..6
    sky = nightColor.clone().lerp(duskColor, Math.sin(u * Math.PI * 0.5));
  }
  scene.background = sky;
  scene.fog.color.copy(sky);
  scene.fog.density = params.fogDensity;
  hemi.intensity = params.ambient;
  dirLight.intensity = THREE.MathUtils.lerp(0.2, 1.2, Math.max(0, Math.cos(((t - 12) / 12) * Math.PI)));
  dirLight.position.set(20 * Math.cos((t / 24) * Math.PI * 2), 15, 20 * Math.sin((t / 24) * Math.PI * 2));
  headlights.visible = params.headlights && (t < 6 || t > 18);
}

// Resize
function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", onResize);

// Camera follow spring
const desiredCamOffset = new THREE.Vector3(0, 2.2, 6);
const camVel = new THREE.Vector3();
const camStiffness = 6;
const camDamping = 0.85;

// Animation loop
let lastTime = performance.now();
let distanceTraveled = 0;
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  sampleInputs();

  // Physics update
  const targetSpeed = speedLimitMs() * Math.max(0.3, Math.min(1.0, Math.abs(input.fwd)));
  const accel = input.fwd > 0 ? maxAcceleration : (input.fwd < 0 ? -maxAcceleration * 0.7 : 0);
  velocity += accel * dt;
  // Drag & soft speed limit
  velocity -= velocity * drag * dt * 60;
  if (Math.abs(velocity) > targetSpeed) {
    const sign = Math.sign(velocity);
    velocity += (targetSpeed - Math.abs(velocity)) * 0.5 * sign;
  }
  // Braking when opposite input
  if (input.fwd === 0 && Math.abs(velocity) > 0.01) {
    const sign = Math.sign(velocity);
    velocity -= braking * dt * sign;
  }

  // Steering
  const steerRate = corneringGrip * input.steer * (0.5 + 0.5 * Math.min(1, Math.abs(velocity) / speedLimitMs()));
  heading += steerRate * dt;

  // Move car
  const dx = Math.sin(heading) * velocity * dt;
  const dz = Math.cos(heading) * velocity * dt;
  car.position.x += dx;
  car.position.z -= dz;
  car.rotation.y = heading;
  headlights.target.position.set(Math.sin(heading) * 10, 0, -Math.cos(heading) * 10);

  // Keep car near nearest road segment center by subtle attractor
  let nearest = roadSegments[0];
  let bestDz = Infinity;
  for (let i = 0; i < roadSegments.length; i++) {
    const dzAbs = Math.abs(roadSegments[i].position.z - car.position.z);
    if (dzAbs < bestDz) { bestDz = dzAbs; nearest = roadSegments[i]; }
  }
  const nearestRoadX = nearest.position.x;
  const off = car.position.x - nearestRoadX;
  car.position.x += THREE.MathUtils.clamp(-off * 0.6, -1.0, 1.0) * dt;

  // Terrain height sampling for car y
  const carY = sampleTerrainHeight(car.position.x, car.position.z) + 0.5;
  car.position.y += (carY - car.position.y) * 0.2;

  // Advance road as we move forward
  distanceTraveled += Math.abs(velocity * dt);
  while (roadSegments[0].position.z - car.position.z > segmentLength) {
    advanceRoad();
  }

  // Camera follow
  const behind = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading).multiplyScalar(desiredCamOffset.z);
  const up = new THREE.Vector3(0, 1, 0).multiplyScalar(desiredCamOffset.y);
  const right = new THREE.Vector3(1, 0, 0).multiplyScalar(desiredCamOffset.x);
  const desiredPos = new THREE.Vector3().copy(car.position).add(behind).add(up).add(right);
  const toTarget = new THREE.Vector3().subVectors(desiredPos, cameraRig.position);
  camVel.addScaledVector(toTarget, camStiffness * dt);
  camVel.multiplyScalar(Math.pow(camDamping, dt * 60));
  cameraRig.position.addScaledVector(camVel, dt);
  camera.lookAt(car.position.x, car.position.y + 0.3, car.position.z);

  orbitControls.update();
  updateEnvironment(dt);
  renderer.render(scene, camera);
}

function sampleTerrainHeight(x, z) {
  // Map world coordinate to our ground plane coordinates
  return (fbm(x * 0.01, z * 0.01, 5, 0.55) - 0.5) * 6 * params.terrainRoughness;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function flattenTerrainUnderSegment(cx, cz, cy, yaw) {
  const pos = groundGeom.attributes.position;
  const halfL = segmentLength * 0.65; // overlap slightly to stitch
  const halfW = roadWidth * 0.7;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  // forward unit vector in XZ and right vector
  const fwdX = Math.sin(yaw), fwdZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vz = pos.getZ(i);
    const dx = vx - cx;
    const dz = vz - cz;
    const u = dx * fwdX + dz * fwdZ;    // along segment
    const v = dx * rightX + dz * rightZ; // lateral from center
    const wu = 1 - smoothstep(0, halfL, Math.abs(u));
    const wv = 1 - smoothstep(0, halfW, Math.abs(v));
    const w = wu * wv;
    if (w > 0) {
      const currentY = pos.getY(i);
      const target = cy - 0.002; // tiny offset below road
      const blended = currentY * (1 - w) + target * w;
      pos.setY(i, blended);
    }
  }
  pos.needsUpdate = true;
  groundGeom.computeVertexNormals();
}

function refreshAllSegmentsAfterTerrainChange() {
  for (let i = 0; i < roadSegments.length; i++) {
    const seg = roadSegments[i];
    const lane = laneSegments[i];
    const y = sampleTerrainHeight(seg.position.x, seg.position.z) + 0.001;
    seg.position.y = i === 0 ? y : THREE.MathUtils.lerp(roadSegments[i - 1].position.y, y, 0.35);
    lane.position.y = seg.position.y + 0.009;
    // apply flattening in current yaw
    flattenTerrainUnderSegment(seg.position.x, seg.position.z, seg.position.y, seg.rotation.y || 0);
  }
}

// Simple staged loader progress
let bootProgress = 0;
function setProgress(p) {
  bootProgress = Math.max(0, Math.min(1, p));
  if (loaderFill) loaderFill.style.width = `${Math.floor(bootProgress * 100)}%`;
  if (loaderPct) loaderPct.textContent = `${Math.floor(bootProgress * 100)}%`;
}

setProgress(0.1);
regenerateTerrain();
setProgress(0.3);
// simulate a couple of road advances to initialize positions
for (let i = 0; i < 10; i++) advanceRoad();
refreshAllSegmentsAfterTerrainChange();
setProgress(0.6);
onResize();
setProgress(0.8);
// first render to warm up
renderer.render(scene, camera);
setProgress(1);
setTimeout(() => { if (loaderEl) loaderEl.style.display = "none"; }, 150);
tick();


