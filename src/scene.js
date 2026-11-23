import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createClayMaterial } from './clay-material.js';
import { createCanvasMaterial } from './canvas-material.js';
import { drawDimensions } from './dimensions.js';

const sceneColors = {
  clay: '#ed619e',
  softClay: '#b03e86',
  grid: '#625085',
};

function floorGrid() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { interval: { value: 10 }, tint: { value: new THREE.Color(sceneColors.grid) } },
    vertexShader: `
      varying vec2 gridPosition;
      void main() {
        gridPosition = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 gridPosition;
      uniform float interval;
      uniform vec3 tint;
      void main() {
        vec2 grid = gridPosition / interval;
        vec2 line = abs(fract(grid - 0.5) - 0.5) / max(fwidth(grid), 0.001);
        float ink = 1.0 - min(min(line.x, line.y), 1.0);
        float fade = 1.0 - smoothstep(7.0, 25.0, length(grid));
        gl_FragColor = vec4(tint, ink * fade * 0.75);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.04;
  return mesh;
}

function floorShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 63);
  gradient.addColorStop(0, 'rgba(6, 0, 15, 0.96)');
  gradient.addColorStop(0.45, 'rgba(6, 0, 15, 0.82)');
  gradient.addColorStop(1, 'rgba(6, 0, 15, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  return shadow;
}

function drawAxes(canvas, camera) {
  const context = canvas.getContext('2d');
  const orientation = camera.quaternion.clone().invert();
  const basis = [
    { axis: 'X', color: '#ff75b2', direction: new THREE.Vector3(1, 0, 0) },
    { axis: 'Y', color: '#cfed91', direction: new THREE.Vector3(0, 0, -1) },
    { axis: 'Z', color: '#bfb0ff', direction: new THREE.Vector3(0, 1, 0) },
  ];
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(2, 2);
  context.translate(35, 33);
  context.font = 'bold 11px monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const { axis, color, direction } of basis) {
    direction.applyQuaternion(orientation);
    const x = direction.x * 19;
    const y = -direction.y * 19;
    context.strokeStyle = context.fillStyle = color;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(x, y);
    context.stroke();
    context.fillText(axis, x * 1.49, y * 1.49);
  }
  context.restore();
}

export function createViewer(container, axes, drafting) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10_000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  let pixelRatio = Math.min(window.devicePixelRatio, 1.25);
  let renderQuality = 'fast';
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '3D model. Use the arrow keys to orbit and the camera buttons to zoom.');
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minPolarAngle = 0.04;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.rotateSpeed = 0.82;

  const ambient = new THREE.HemisphereLight('#ffddfa', '#341649', 2.05);
  scene.add(ambient);
  const light = (color, strength, x, y, z) => {
    const source = new THREE.DirectionalLight(color, strength);
    source.position.set(x, y, z);
    scene.add(source);
    return source;
  };
  const key = light('#fff0df', 2.65, -4, 7, 4);
  const rim = light('#e6bbff', 2.0, 5, 5, -5);
  const fill = light('#f6abd9', 0.52, 4, 2, 5);
  const keyDirection = key.position.clone().normalize();
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0001;
  key.shadow.radius = 5;
  scene.add(key.target);

  const grid = floorGrid();
  const shadow = floorShadow();
  scene.add(grid, shadow);
  const previewMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.77,
    side: THREE.DoubleSide,
  });
  const clay = new THREE.Mesh(new THREE.BufferGeometry(), previewMaterial);
  let clayMaterial;
  let studioEnvironment;
  let studioFloor;
  clay.visible = false;
  scene.add(clay);
  const draftingBounds = new THREE.Box3();
  let shouldDraw = false;

  function render() {
    if (shouldDraw) return;
    shouldDraw = true;
    requestAnimationFrame(() => {
      shouldDraw = false;
      renderer.render(scene, camera);
      drawAxes(axes, camera);
      if (!drafting.hidden && clay.visible) {
        draftingBounds.copy(clay.geometry.boundingBox).applyMatrix4(clay.matrixWorld);
        drawDimensions(drafting, camera, draftingBounds, container.clientWidth, container.clientHeight);
      }
    });
  }

  function reset() {
    if (!clay.visible) return;
    const sphere = clay.geometry.boundingSphere;
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const radius = sphere.radius * clay.scale.x;
    const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.08;
    controls.target.copy(sphere.center).multiplyScalar(clay.scale.x);
    camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(0.52, 0.4, 1).normalize(), distance);
    controls.minDistance = radius * 0.65;
    controls.maxDistance = distance * 4;
    camera.near = Math.max(distance / 5_000, 0.0001);
    camera.far = distance * 25;
    camera.updateProjectionMatrix();
    controls.update();
    render();
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = container;
    if (!width || !height) return;
    const oldAspect = camera.aspect;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    drafting.width = Math.round(width * pixelRatio);
    drafting.height = Math.round(height * pixelRatio);
    if (Math.min(oldAspect, camera.aspect) < 1 && Math.abs(oldAspect - camera.aspect) > 0.1) reset();
    render();
  }

  camera.position.set(4, 8, 12);
  controls.update();
  controls.addEventListener('change', render);
  new ResizeObserver(resize).observe(container);
  resize();

  container.addEventListener('keydown', (event) => {
    const keys = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.10], ArrowDown: [0, 0.10] };
    if (!Object.hasOwn(keys, event.key)) return;
    const [turn, tilt] = keys[event.key];
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += turn;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + tilt, controls.minPolarAngle, controls.maxPolarAngle);
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    controls.update();
    event.preventDefault();
  });

  function setMesh(mesh, fit) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    const { min } = geometry.boundingBox;
    const colors = new Float32Array(mesh.positions.length);
    const base = new THREE.Color(sceneColors.softClay);
    const top = new THREE.Color(sceneColors.clay);
    const color = new THREE.Color();
    for (let i = 0; i < colors.length; i += 3) {
      const height = (mesh.positions[i + 1] - min.y) / (size.y || 1);
      color.copy(base).lerp(top, 0.50 + 0.50 * height).toArray(colors, i);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    clay.geometry.dispose();
    clay.geometry = geometry;
    clay.visible = true;
    const totalSize = Math.max(size.x, size.y, size.z);
    const spacing = 10 ** Math.floor(Math.log10(totalSize));
    grid.material.uniforms.interval.value = spacing;
    // Shader grid coordinates use unscaled plane units.
    grid.geometry.dispose();
    grid.geometry = new THREE.PlaneGeometry(spacing * 64, spacing * 64);
    grid.position.y = -totalSize * 0.0004;
    shadow.position.y = grid.position.y / 2;
    updateShadow(size);
    if (fit) reset();
    render();
    return [size.x, size.z, size.y];
  }

  function updateShadow(size) {
    const scale = clay.scale.x;
    const extent = Math.max(size.x, size.y, size.z) * scale;
    shadow.scale.set(Math.max(size.x * scale * 1.13, extent * 0.4), Math.max(size.z * scale * 1.13, extent * 0.4), 1);
    if (!renderer.shadowMap.enabled) return;

    const floorWidth = extent * 9;
    studioFloor.scale.set(floorWidth, floorWidth, 1);
    studioFloor.position.y = -extent * 0.00035;
    key.target.position.set(0, size.y * scale * 0.38, 0);
    key.position.copy(key.target.position).addScaledVector(keyDirection, extent * 3);
    const camera = key.shadow.camera;
    const range = extent * 1.35;
    camera.left = camera.bottom = -range;
    camera.right = camera.top = range;
    camera.near = extent;
    camera.far = extent * 5;
    camera.updateProjectionMatrix();
    key.shadow.normalBias = extent * 0.0012;
    renderer.shadowMap.needsUpdate = true;
  }

  function setScale(scale) {
    clay.scale.setScalar(scale);
    if (clay.visible) updateShadow(clay.geometry.boundingBox.getSize(new THREE.Vector3()));
    render();
  }

  function setDrafting(visible) {
    drafting.hidden = !visible;
    camera.zoom = visible ? 0.85 : 1;
    camera.updateProjectionMatrix();
    render();
  }

  function setQuality(quality) {
    if (quality === renderQuality) return;
    renderQuality = quality;
    const accurate = quality === 'accurate';
    pixelRatio = accurate ? Math.min(window.devicePixelRatio * 1.35, 2) : Math.min(window.devicePixelRatio, 1.25);
    renderer.setPixelRatio(pixelRatio);

    const resolution = accurate ? 2048 : 1024;
    key.shadow.map?.dispose();
    key.shadow.map = null;
    key.shadow.mapSize.set(resolution, resolution);
    key.shadow.radius = accurate ? 10 : 5;
    renderer.shadowMap.needsUpdate = true;
    resize();
  }

  function zoom(amount) {
    if (!clay.visible) return;
    const direction = camera.position.clone().sub(controls.target);
    const next = THREE.MathUtils.clamp(direction.length() * amount, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(direction.setLength(next));
    controls.update();
  }

  function setAppearance(finish) {
    if (finish) {
      clayMaterial ??= createClayMaterial();
      if (!studioEnvironment) {
        const room = new RoomEnvironment();
        const pmrem = new THREE.PMREMGenerator(renderer);
        studioEnvironment = pmrem.fromScene(room, 0.04);
        pmrem.dispose();
        room.dispose();
        studioFloor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createCanvasMaterial());
        studioFloor.rotation.x = -Math.PI / 2;
        studioFloor.receiveShadow = true;
        scene.add(studioFloor);
      }
      clayMaterial.update(finish);
    }

    const active = Boolean(finish);
    clay.material = active ? clayMaterial.material : previewMaterial;
    scene.environment = active ? studioEnvironment.texture : null;
    scene.environmentIntensity = 0.58;
    renderer.toneMapping = active ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    ambient.color.set(active ? '#f7f5f2' : '#ffddfa');
    ambient.groundColor.set(active ? '#a69c92' : '#341649');
    ambient.intensity = active ? 0.66 : 2.05;
    key.color.set(active ? '#fff9ee' : '#fff0df');
    key.intensity = active ? 2.3 : 2.65;
    rim.color.set(active ? '#f7f5f2' : '#e6bbff');
    rim.intensity = active ? 0.64 : 2.0;
    fill.color.set(active ? '#f4f1ec' : '#f6abd9');
    fill.intensity = active ? 0.33 : 0.52;
    grid.visible = !active;
    shadow.visible = !active;
    if (studioFloor) studioFloor.visible = active;
    renderer.shadowMap.enabled = active;
    key.castShadow = active;
    clay.castShadow = clay.receiveShadow = active;
    if (active && clay.visible) updateShadow(clay.geometry.boundingBox.getSize(new THREE.Vector3()));
    if (!active) {
      key.position.set(-4, 7, 4);
      key.target.position.set(0, 0, 0);
    }
    render();
  }

  return { setMesh, setAppearance, setScale, setDrafting, setQuality, zoom, reset };
}
