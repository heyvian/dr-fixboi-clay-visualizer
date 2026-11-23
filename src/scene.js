import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

export function createViewer(container, axes) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10_000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

  scene.add(new THREE.HemisphereLight('#ffddfa', '#341649', 2.05));
  const light = (color, strength, x, y, z) => {
    const source = new THREE.DirectionalLight(color, strength);
    source.position.set(x, y, z);
    scene.add(source);
  };
  light('#fff0df', 2.65, -4, 7, 4);
  light('#e6bbff', 2.0, 5, 5, -5);
  light('#f6abd9', 0.52, 4, 2, 5);

  const grid = floorGrid();
  const shadow = floorShadow();
  scene.add(grid, shadow);
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.77,
    side: THREE.DoubleSide,
  });
  const clay = new THREE.Mesh(new THREE.BufferGeometry(), material);
  clay.visible = false;
  scene.add(clay);
  let shouldDraw = false;

  function render() {
    if (shouldDraw) return;
    shouldDraw = true;
    requestAnimationFrame(() => {
      shouldDraw = false;
      renderer.render(scene, camera);
      drawAxes(axes, camera);
    });
  }

  function reset() {
    if (!clay.visible) return;
    const sphere = clay.geometry.boundingSphere;
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = sphere.radius / Math.sin(Math.min(vertical, horizontal)) * 1.08;
    controls.target.copy(sphere.center);
    camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(0.52, 0.4, 1).normalize(), distance);
    controls.minDistance = sphere.radius * 0.65;
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
    shadow.scale.set(Math.max(size.x * 1.13, totalSize * 0.4), Math.max(size.z * 1.13, totalSize * 0.4), 1);
    if (fit) reset();
    render();
    return [size.x, size.z, size.y];
  }

  function zoom(amount) {
    if (!clay.visible) return;
    const direction = camera.position.clone().sub(controls.target);
    const next = THREE.MathUtils.clamp(direction.length() * amount, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(direction.setLength(next));
    controls.update();
  }

  return { setMesh, zoom, reset };
}
