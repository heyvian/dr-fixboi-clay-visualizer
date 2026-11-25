import * as THREE from 'three';

export const vicColors = ['#799b93', '#f5c451', '#ff743f', '#f73564'];

export function createVicDisplay() {
  const uniforms = {
    motion: { value: null },
    sections: { value: null },
    atlas: { value: new THREE.Vector3(1, 1, 1) },
    phase: { value: -1 },
    holding: { value: new THREE.Color(vicColors[0]) },
    mild: { value: new THREE.Color(vicColors[1]) },
    high: { value: new THREE.Color(vicColors[2]) },
    severe: { value: new THREE.Color(vicColors[3]) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform sampler2D motion;
      uniform sampler2D sections;
      uniform vec3 atlas;
      uniform float phase;
      attribute float vicNode;
      attribute vec3 vicCenter;
      attribute float agreement;
      varying float vAgreement;
      varying float vPresent;
      varying vec3 vNormal;
      vec2 atlasUV(float frame) {
        vec2 pixel = vec2(mod(vicNode, atlas.x), floor(vicNode / atlas.x) + frame * atlas.y);
        return (pixel + 0.5) / vec2(atlas.x, atlas.z);
      }
      void main() {
        vec3 point = position;
        vPresent = 1.0;
        if (phase >= 0.0) {
          float frame = floor(phase);
          vec2 uvA = atlasUV(frame);
          vec2 uvB = atlasUV(min(frame + 1.0, atlas.z / atlas.y - 1.0));
          vec4 a = texture2D(motion, uvA);
          vec4 b = texture2D(motion, uvB);
          vec2 section = mix(texture2D(sections, uvA).rg, texture2D(sections, uvB).rg, fract(phase));
          float areaScale = sqrt(max(0.01, section.x * 255.0 / 127.0));
          float flatten = max(0.1, section.y);
          point = vicCenter + (point - vicCenter) * vec3(areaScale / flatten, areaScale * flatten, areaScale / flatten);
          point += mix(a.xyz, b.xyz, fract(phase));
          vPresent = a.a;
        }
        vAgreement = agreement;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 holding;
      uniform vec3 mild;
      uniform vec3 high;
      uniform vec3 severe;
      varying float vAgreement;
      varying float vPresent;
      varying vec3 vNormal;
      void main() {
        if (vPresent < 0.995) discard;
        float risk = clamp(vAgreement, 0.0, 1.0);
        vec3 color = mix(holding, mild, smoothstep(0.0, 0.14, risk));
        color = mix(color, high, smoothstep(0.38, 0.69, risk));
        color = mix(color, severe, smoothstep(0.69, 0.96, risk));
        vec3 viewNormal = normalize(vNormal);
        if (!gl_FrontFacing) viewNormal *= -1.0;
        float light = 0.63 + 0.37 * max(0.0, dot(viewNormal, vec3(-0.45, 0.59, 0.67)));
        gl_FragColor = vec4(color * light, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.visible = false;
  mesh.frustumCulled = false;
  let analysis;
  let source;
  let lastFrame = -2;
  let texture;
  let sectionsTexture;

  function setMesh(geometry, result) {
    mesh.visible = false;
    mesh.geometry.dispose();
    texture?.dispose();
    sectionsTexture?.dispose();
    texture = undefined;
    sectionsTexture = undefined;
    uniforms.motion.value = null;
    uniforms.sections.value = null;
    uniforms.phase.value = -1;
    lastFrame = -2;
    analysis = result;
    source = geometry;
    const display = new THREE.BufferGeometry();
    mesh.geometry = display;
    if (!result) return;
    display.setAttribute('position', geometry.getAttribute('position'));
    display.setAttribute('normal', geometry.getAttribute('normal'));
    display.setAttribute('vicNode', new THREE.BufferAttribute(result.nodeIds, 1));
    const count = result.votes.length;
    const agreement = Float32Array.from(result.nodeIds, id => result.votes[id] / result.totalCases);
    display.setAttribute('agreement', new THREE.BufferAttribute(agreement, 1));
    display.setIndex(new THREE.BufferAttribute(geometry.index.array.slice(), 1).setUsage(THREE.DynamicDrawUsage));
    if (!result.trajectory) return;
    const centers = new Float32Array(result.nodeIds.length * 3);
    for (let i = 0; i < result.nodeIds.length; i++) {
      const offset = result.nodeIds[i] * 3;
      centers[i * 3] = result.centers[offset];
      centers[i * 3 + 1] = result.centers[offset + 1];
      centers[i * 3 + 2] = result.centers[offset + 2];
    }
    display.setAttribute('vicCenter', new THREE.BufferAttribute(centers, 3));
    const width = Math.min(count, 1024);
    const rows = Math.ceil(count / width);
    const height = rows * result.frames;
    texture = packTexture(result.trajectory, 4, THREE.RGBAFormat, THREE.FloatType);
    sectionsTexture = packTexture(result.sections, 2, THREE.RGFormat, THREE.UnsignedByteType);
    uniforms.motion.value = texture;
    uniforms.sections.value = sectionsTexture;
    uniforms.atlas.value.set(width, rows, height);

    function packTexture(values, stride, format, type) {
      let data = values;
      if (count !== width * rows) {
        data = new values.constructor(width * height * stride);
        for (let i = 0; i < result.frames; i++) {
          data.set(values.subarray(i * count * stride, (i + 1) * count * stride), i * width * rows * stride);
        }
      }
      const frameTexture = new THREE.DataTexture(data, width, height, format, type);
      frameTexture.needsUpdate = true;
      return frameTexture;
    }
  }

  function show(mode, progress = 0) {
    mesh.visible = Boolean(analysis && mode);
    if (!mesh.visible) return;
    const phase = mode === 'demo' && texture ? progress * (analysis.frames - 1) : -1;
    uniforms.phase.value = phase;
    const frame = Math.floor(phase);
    if (frame === lastFrame || !analysis.cuts.length) return;
    const { cuts, stripLength } = analysis;
    const target = mesh.geometry.index;
    const original = source.index.array;
    for (let i = 0; i < cuts.length; i += 2) {
      const start = cuts[i];
      const at = cuts[i + 1];
      if (frame >= at && lastFrame < at) target.array.fill(original[start], start, start + stripLength);
      else if (frame < at && lastFrame >= at) target.array.set(original.subarray(start, start + stripLength), start);
    }
    target.needsUpdate = true;
    lastFrame = frame;
  }

  return { mesh, setMesh, show };
}
