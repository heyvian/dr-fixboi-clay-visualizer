import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createClayMaterial } from './clay-material.js';
import { createCanvasMaterial } from './canvas-material.js';
import { drawDimensions } from './dimensions.js';
import { createOriginGuide } from './origin-guide.js';
import { depositedIndexCount, nozzlePosition } from './toolpath.js';
import { createStudioProps } from './studio-props.js';
import { createVicDisplay } from './vic-display.js';

const sceneColors = {
  clay: '#ed619e',
  softClay: '#b03e86',
  grid: '#625085',
};

const studioKeyIntensity = 2.3;
const softboxSamples = [
  [-0.133, -0.044, 0.215],
  [-0.049, 0.092, 0.145],
  [0.071, -0.093, 0.18],
  [0.117, 0.039, 0.15],
];
const softboxCenterWeight = 1 - softboxSamples.reduce((sum, sample) => sum + sample[2], 0);

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
  const studioBackdrop = new THREE.Color('#817970');
  const studioFog = new THREE.Fog(studioBackdrop);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10_000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  let pixelRatio = Math.min(window.devicePixelRatio, 1.25);
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
  const rimDirection = rim.position.clone().normalize();
  const studioRimDirection = new THREE.Vector3(1.8, 5.8, -6.3).normalize();
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0001;
  key.shadow.radius = 5;
  rim.shadow.mapSize.set(1024, 1024);
  rim.shadow.bias = key.shadow.bias;
  rim.shadow.radius = 16;
  scene.add(key.target, rim.target);
  const keySamples = [];
  const studioAccents = [];

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
  const nozzleMarker = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.08, 1, 12),
    new THREE.MeshBasicMaterial({ color: '#dbff83', toneMapped: false }));
  nozzleMarker.visible = false;
  clay.add(nozzleMarker);
  const vicDisplay = createVicDisplay();
  const originGuide = createOriginGuide();
  let vicMode;
  let hasMesh = false;
  let raisedHeight = 0;
  let toolpathReplay;
  let toolpathMotion;
  let toolpathActive = false;
  const printedDepth = new THREE.Mesh(clay.geometry, new THREE.MeshBasicMaterial({
    transparent: true, colorWrite: false,
  }));
  const printedGhost = new THREE.Mesh(clay.geometry, new THREE.MeshBasicMaterial({
    color: '#9ce8ff', transparent: true, opacity: 0.2, depthWrite: false, depthFunc: THREE.EqualDepth, toneMapped: false,
  }));
  // Resolve the front surface first so overlapping beads receive one ghost layer.
  printedDepth.renderOrder = 2;
  printedGhost.renderOrder = 3;
  printedDepth.visible = printedGhost.visible = false;
  const studioTiers = new Map();
  let studioFloor;
  let studioProps;
  const studioBounds = new THREE.Box3();
  clay.visible = false;
  scene.add(clay, printedDepth, printedGhost, vicDisplay.mesh, originGuide.group);
  const draftingBounds = new THREE.Box3();
  let shouldDraw = false;
  let draftingEnabled = false;
  let comparing = false;

  function render() {
    if (shouldDraw) return;
    shouldDraw = true;
    requestAnimationFrame(() => {
      shouldDraw = false;
      camera.updateMatrixWorld();
      const { clientWidth: width, clientHeight: height } = container;
      const showingVic = vicDisplay.mesh.visible;
      originGuide.update(camera, comparing || showingVic ? 1 : clay.scale.x,
        showingVic && vicMode === 'demo', studioFloor?.visible);
      renderer.render(scene, camera);
      drawAxes(axes, camera);
      if (!drafting.hidden && clay.visible) {
        draftingBounds.copy(clay.geometry.boundingBox).applyMatrix4(clay.matrixWorld);
        const printedBounds = comparing ? clay.geometry.boundingBox : undefined;
        drawDimensions(drafting, camera, draftingBounds, width, height, printedBounds);
      }
    });
  }

  function frame(center, direction, radius, distance) {
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.minDistance = radius * 0.65;
    controls.maxDistance = distance * 4;
    camera.near = Math.max(distance / 5_000, 0.0001);
    camera.far = distance * 25;
    camera.updateProjectionMatrix();
    sizeStudioFloor();
    controls.update();
    render();
  }

  function reset() {
    if (!hasMesh) return;
    controls.enablePan = false;
    const sphere = clay.geometry.boundingSphere;
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const showPrinted = comparing || vicDisplay.mesh.visible;
    const scale = showPrinted ? 1 : clay.scale.x;
    const center = sphere.center.clone().multiplyScalar(scale);
    const lift = showPrinted ? 0 : clay.position.y;
    center.y += lift;
    let radius = sphere.radius * scale;
    const clearance = Math.max(0, clay.geometry.boundingBox.min.y * scale + lift) / 2;
    center.y -= clearance;
    radius += clearance;
    if (vicMode === 'demo' && container.clientWidth < 480) {
      center.y -= radius * 0.22;
      radius *= 1.06;
    }
    let distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.08;
    const showGuide = vicMode !== 'demo' && originGuide.hasMark;
    const direction = new THREE.Vector3(0.52, showGuide ? 0.63 : 0.4, 1).normalize();
    const guidePoints = showGuide ? originGuide.getFramePoints(scale, direction) : [];
    if (guidePoints.length) {
      const right = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
      const up = direction.clone().cross(right);
      const width = Math.tan(horizontal) * 0.86;
      const height = Math.tan(vertical) * 0.76;
      for (const point of guidePoints) {
        point.sub(center);
        const setback = Math.max(Math.abs(point.dot(right)) / width, Math.abs(point.dot(up)) / height);
        distance = Math.max(distance, point.dot(direction) + setback);
      }
    }
    frame(center, direction, radius, distance);
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
    if ((vicMode === 'demo' || Math.min(oldAspect, camera.aspect) < 1) && Math.abs(oldAspect - camera.aspect) > 0.1) reset();
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

  function setMesh(mesh, fit, placementOrigin, estimatedGap = 0, motion) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    toolpathReplay = mesh.replay;
    if (fit) toolpathMotion = motion;
    toolpathActive = false;
    nozzleMarker.visible = false;
    const markerHeight = Math.max(toolpathReplay?.diameter * 1.5 || 0, Math.max(size.x, size.y, size.z) * 0.048);
    nozzleMarker.scale.set(markerHeight * 0.64, markerHeight, markerHeight * 0.64);
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

    vicDisplay.setMesh(geometry, mesh.analysis);
    // Use the placed clay's underside for the readout. A nominally seated
    // toolpath can have small gaps in the generated curved bead profile.
    raisedHeight = estimatedGap && Number.isFinite(min.y) ? Math.max(0, min.y) : 0;
    clay.position.y = raisedHeight * (1 - clay.scale.x);
    originGuide.setMesh(mesh, placementOrigin, raisedHeight);
    clay.geometry.dispose();
    clay.geometry = printedGhost.geometry = printedDepth.geometry = geometry;
    hasMesh = true;
    updateMeshVisibility();
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
    return { dimensions: [size.x, size.z, size.y], raisedHeight };
  }

  function updateShadow(size) {
    const scale = clay.scale.x;
    const extent = Math.max(size.x, size.y, size.z) * scale;
    shadow.scale.set(Math.max(size.x * scale * 1.13, extent * 0.4), Math.max(size.z * scale * 1.13, extent * 0.4), 1);
    if (!renderer.shadowMap.enabled) return;

    studioFloor.position.y = -extent * 0.00035;
    studioBounds.copy(clay.geometry.boundingBox);
    const layoutScale = comparing ? 1 : scale;
    studioBounds.min.multiplyScalar(layoutScale);
    studioBounds.max.multiplyScalar(layoutScale);
    if (!comparing) studioBounds.translate(clay.position);
    studioProps.placeBeside(studioBounds, studioFloor.position.y, size.z * layoutScale);
    const shadowExtent = Math.max(extent, studioBounds.getSize(new THREE.Vector3()).length() / 2);
    const range = shadowExtent * 1.35;
    const center = studioBounds.getCenter(new THREE.Vector3());
    const shadowLights = [{ source: key, direction: keyDirection }, { source: rim, direction: studioRimDirection }, ...keySamples];
    for (const { source, direction } of shadowLights) {
      if (!source.castShadow || !source.visible) continue;
      source.target.position.copy(center);
      source.position.copy(center).addScaledVector(direction, shadowExtent * 3);
      const camera = source.shadow.camera;
      camera.left = camera.bottom = -range;
      camera.right = camera.top = range;
      camera.near = shadowExtent;
      camera.far = shadowExtent * 5;
      camera.updateProjectionMatrix();
      source.shadow.normalBias = Math.min(shadowExtent * 0.0012, Math.max(0.08, extent * 0.003));
    }
    renderer.shadowMap.needsUpdate = true;
  }

  function setScale(scale) {
    if (clay.scale.x === scale) return;
    clay.scale.setScalar(scale);
    clay.position.y = raisedHeight * (1 - scale);
    if (hasMesh) updateShadow(clay.geometry.boundingBox.getSize(new THREE.Vector3()));
    render();
  }

  function sizeStudioFloor() {
    if (!studioFloor) return;
    const width = camera.far * 3;
    studioFloor.scale.set(width, width, 1);
    studioFog.near = camera.far * 0.26;
    studioFog.far = camera.far * 0.72;
  }

  function updateDraftingView() {
    const vicVisible = vicDisplay.mesh.visible;
    drafting.hidden = vicVisible || toolpathActive || !(draftingEnabled || comparing);
    camera.zoom = vicVisible ? 1 : comparing ? 0.72 : (draftingEnabled ? 0.85 : 1);
    camera.updateProjectionMatrix();
    render();
  }

  function setDrafting(visible) {
    draftingEnabled = visible;
    updateDraftingView();
  }

  function setComparison(active) {
    const changed = comparing !== active;
    comparing = active;
    updateMeshVisibility();
    if (changed && studioProps?.group.visible && hasMesh) updateShadow(clay.geometry.boundingBox.getSize(new THREE.Vector3()));
    updateDraftingView();
  }

  function updateMeshVisibility() {
    clay.visible = hasMesh && !vicDisplay.mesh.visible;
    printedDepth.visible = printedGhost.visible = comparing && clay.visible && !toolpathActive;
  }

  function setToolpathTime(seconds) {
    if (!toolpathReplay) return;
    const active = seconds !== undefined;
    if (toolpathActive !== active) {
      toolpathActive = active;
      updateMeshVisibility();
      updateDraftingView();
    }
    const count = active ? depositedIndexCount(toolpathReplay, seconds) : Infinity;
    if (clay.geometry.drawRange.count !== count) {
      clay.geometry.setDrawRange(0, count);
      renderer.shadowMap.needsUpdate = true;
    }
    shadow.visible = !renderer.shadowMap.enabled && count > 0;
    nozzleMarker.visible = active && Boolean(toolpathMotion) && seconds < toolpathReplay.duration;
    if (nozzleMarker.visible) {
      const { start, origin, nozzleLift } = toolpathReplay;
      const [x, y, z] = nozzlePosition(toolpathMotion, start + seconds);
      nozzleMarker.position.set(x - origin[0], Math.max(0, z - origin[2] + nozzleLift) + nozzleMarker.scale.y / 2, origin[1] - y);
    }
    render();
  }

  function setVicView(mode, progress = 0) {
    const wasVisible = vicDisplay.mesh.visible;
    vicMode = mode;
    vicDisplay.show(mode, progress);
    if (wasVisible !== vicDisplay.mesh.visible) {
      updateMeshVisibility();
      renderer.shadowMap.needsUpdate = true;
      updateDraftingView();
    }
    render();
  }

  function focusVic(spot) {
    if (!vicDisplay.mesh.visible) return;
    controls.enablePan = true;
    const center = new THREE.Vector3(spot.x, spot.z, -spot.y);
    const { radius, center: middle } = clay.geometry.boundingSphere;
    const direction = center.clone().sub(middle).setY(0);
    if (direction.lengthSq() < 0.001) direction.set(0.52, 0, 1);
    direction.normalize().setY(0.34).normalize();
    const view = Math.min(1, camera.aspect) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    frame(center, direction, radius * 0.5, radius * 0.62 / view);
  }

  function zoom(amount) {
    if (!hasMesh) return;
    const direction = camera.position.clone().sub(controls.target);
    const next = THREE.MathUtils.clamp(direction.length() * amount, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(direction.setLength(next));
    controls.update();
  }

  function getStudioTier(high) {
    if (!studioTiers.has(high)) {
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const environment = pmrem.fromScene(room, high ? 0.025 : 0.04, 0.1, 100, { size: high ? 512 : 256 });
      pmrem.dispose();
      room.dispose();
      studioTiers.set(high, { environment, clay: createClayMaterial(high), canvas: createCanvasMaterial(high, originGuide.uniforms) });
    }
    return studioTiers.get(high);
  }

  function configureRenderQuality(high) {
    const resolution = high ? 2048 : 1024;
    if (key.shadow.mapSize.x !== resolution) {
      key.shadow.map?.dispose();
      key.shadow.map = null;
      key.shadow.mapSize.set(resolution, resolution);
    }
    key.shadow.radius = high ? 8 : 5;
    // A broad, weak rim shadow crosses the key shadow at an angle.
    rim.castShadow = high;
    if (!high) {
      rim.shadow.map?.dispose();
      rim.shadow.map = null;
      rim.target.position.set(0, 0, 0);
      rim.position.copy(rimDirection);
    }

    // Unevenly spaced and weighted samples approximate the softbox's varying brightness.
    if (high && !keySamples.length) {
      const horizontal = new THREE.Vector3(0, 1, 0).cross(keyDirection).normalize();
      const vertical = keyDirection.clone().cross(horizontal);
      for (const [x, y, weight] of softboxSamples) {
        const source = light('#fff9ee', studioKeyIntensity * weight, 0, 0, 0);
        source.target = key.target;
        source.shadow.mapSize.set(1024, 1024);
        source.shadow.radius = 5;
        source.shadow.bias = key.shadow.bias;
        const direction = keyDirection.clone().addScaledVector(horizontal, x).addScaledVector(vertical, y).normalize();
        keySamples.push({ source, direction });
      }
      studioAccents.push(
        light('#e5f0ff', 0.30, -4, 5, -7),
        light('#ffebd6', 0.24, 7, 1.1, 0),
      );
    }
    for (const source of studioAccents) source.visible = high;
    for (const { source } of keySamples) {
      source.visible = source.castShadow = high;
      if (!high && source.shadow.map) {
        source.shadow.map.dispose();
        source.shadow.map = null;
      }
    }
  }

  function setAppearance(finish, quality, wetClayColor) {
    vicDisplay.setColor(wetClayColor);
    const active = Boolean(finish);
    const high = active && quality === 'high';
    const studio = active ? getStudioTier(high) : undefined;
    if (studio) {
      studio.clay.update(finish);
      if (!studioFloor) {
        studioFloor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), studio.canvas);
        studioFloor.rotation.x = -Math.PI / 2;
        studioFloor.receiveShadow = true;
        scene.add(studioFloor);
        studioProps = createStudioProps();
        scene.add(studioProps.group);
        sizeStudioFloor();
      }
      studioFloor.material = studio.canvas;
    }
    configureRenderQuality(high);
    clay.material = studio?.clay.material ?? previewMaterial;
    scene.background = active ? studioBackdrop : null;
    scene.fog = active ? studioFog : null;
    scene.environment = studio?.environment.texture ?? null;
    scene.environmentIntensity = 0.58;
    renderer.toneMapping = active ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    ambient.color.set(active ? '#f7f5f2' : '#ffddfa');
    ambient.groundColor.set(active ? '#a69c92' : '#341649');
    ambient.intensity = active ? 0.66 : 2.05;
    key.color.set(active ? '#fff9ee' : '#fff0df');
    key.intensity = active ? studioKeyIntensity * (high ? softboxCenterWeight : 1) : 2.65;
    rim.color.set(high ? '#e7efff' : (active ? '#f7f5f2' : '#e6bbff'));
    rim.intensity = high ? 0.56 : (active ? 0.64 : 2.0);
    fill.color.set(active ? '#f4f1ec' : '#f6abd9');
    fill.intensity = active ? 0.33 : 0.52;
    grid.visible = !active;
    shadow.visible = !active && clay.geometry.drawRange.count > 0;
    if (studioFloor) studioFloor.visible = studioProps.group.visible = active;
    renderer.shadowMap.enabled = active;
    key.castShadow = active;
    clay.castShadow = clay.receiveShadow = active;
    if (active && hasMesh) updateShadow(clay.geometry.boundingBox.getSize(new THREE.Vector3()));
    if (!active) {
      key.position.set(-4, 7, 4);
      key.target.position.set(0, 0, 0);
    }
    const ratio = high ? Math.min(window.devicePixelRatio * 1.65, 2.5) : Math.min(window.devicePixelRatio, 1.25);
    if (ratio !== pixelRatio) {
      pixelRatio = ratio;
      renderer.setPixelRatio(pixelRatio);
      resize();
    } else {
      render();
    }
  }

  function clearPlacement() {
    originGuide.setMesh();
    render();
  }

  return { setMesh, clearPlacement, setAppearance, setScale, setDrafting, setComparison, setToolpathTime, setVicView, focusVic, zoom, reset };
}
