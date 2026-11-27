import * as THREE from 'three';
import { writeRingCap } from './bead-mesh.js';
import { depositedIndexCount } from './toolpath.js';

export const vicColors = ['#799b93', '#f5c451', '#ff743f', '#f73564'];

export function createVicDisplay() {
  const uniforms = {
    motion: { value: null },
    sections: { value: null },
    atlas: { value: new THREE.Vector3(1, 1, 1) },
    phase: { value: -1 },
    frameCount: { value: 1 },
    timedDraw: { value: false },
    diameter: { value: 4 },
    wet: { value: new THREE.Color('#777163') },
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
      uniform float frameCount;
      uniform bool timedDraw;
      uniform float diameter;
      attribute float vicNode;
      attribute vec3 vicCenter;
      attribute vec3 vicTangent;
      attribute float agreement;
      attribute float releaseFrame;
      varying float vAgreement;
      varying float vPresent;
      varying vec3 vNormal;
      varying vec3 vViewPoint;
      varying vec3 vLocal;
      varying float vHeight;
      varying float vReleased;
      vec2 atlasUV(float frame) {
        float index = vicNode + frame * atlas.y;
        vec2 pixel = vec2(mod(index, atlas.x), floor(index / atlas.x));
        return (pixel + 0.5) / vec2(atlas.x, atlas.z);
      }
      vec3 decodeTangent(vec2 packedDirection) {
        if (packedDirection == vec2(0.0)) return vicTangent;
        vec2 unfolded = (packedDirection * 255.0 - 128.0) / 127.0;
        vec3 direction = vec3(unfolded, 1.0 - abs(unfolded.x) - abs(unfolded.y));
        direction.xy -= max(0.0, -direction.z) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), direction.xy));
        return normalize(direction);
      }
      vec3 followTangent(vec3 vector, vec3 tangent) {
        float alignment = dot(vicTangent, tangent);
        if (alignment < -0.999) {
          vec3 side = abs(vicTangent.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 axis = normalize(cross(vicTangent, side));
          return 2.0 * axis * dot(vector, axis) - vector;
        }
        vec3 axis = cross(vicTangent, tangent);
        vec3 turn = cross(axis, vector);
        return vector + turn + cross(axis, turn) / (1.0 + alignment);
      }
      void main() {
        vec3 point = position;
        vec3 surfaceNormal = normal;
        vPresent = 1.0;
        vReleased = 0.0;
        if (phase >= 0.0) {
          float frame = floor(phase);
          vec2 uvA = atlasUV(frame);
          vec2 uvB = atlasUV(min(frame + 1.0, frameCount - 1.0));
          vec4 a = texture2D(motion, uvA);
          vec4 b = texture2D(motion, uvB);
          vec4 first = texture2D(sections, uvA);
          vec4 next = texture2D(sections, uvB);
          vec2 before = mix(vec2(127.0 / 255.0, 1.0), first.rg, a.a);
          float animate = fract(phase) * a.a * b.a;
          if (releaseFrame > frame && releaseFrame <= frame + 1.0) animate = 0.0;
          vec2 section = mix(before, next.rg, animate);
          float areaScale = sqrt(max(0.01, section.x * 255.0 / 127.0));
          float flatten = max(0.1, section.y);
          vec3 stretch = vec3(areaScale / flatten, areaScale * flatten, areaScale / flatten);
          vec3 local = (point - vicCenter) * stretch;
          surfaceNormal = normal / stretch;
          if (first.ba != vec2(0.0) || next.ba != vec2(0.0)) {
            vec3 tangent = mix(decodeTangent(first.ba), decodeTangent(next.ba), animate);
            if (length(tangent) > 0.01) {
              tangent = normalize(tangent);
              vec3 pivot = vec3(0.0, diameter * 0.33 * stretch.y, 0.0);
              local = pivot + followTangent(local - pivot, tangent);
              surfaceNormal = followTangent(surfaceNormal, tangent);
            }
          }
          point = vicCenter + local + mix(a.xyz, b.xyz, animate);
          point.y = max(0.0, point.y);
          vPresent = timedDraw ? 1.0 : a.a;
          vReleased = step(0.5, releaseFrame) * step(releaseFrame, phase);
        }
        vAgreement = agreement;
        vNormal = normalize(normalMatrix * surfaceNormal);
        vLocal = position;
        vHeight = point.y;
        vViewPoint = (modelViewMatrix * vec4(point, 1.0)).xyz;
        gl_Position = projectionMatrix * vec4(vViewPoint, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 holding;
      uniform vec3 mild;
      uniform vec3 high;
      uniform vec3 severe;
      uniform float phase;
      uniform float diameter;
      uniform vec3 wet;
      varying float vAgreement;
      varying float vPresent;
      varying vec3 vNormal;
      varying vec3 vViewPoint;
      varying vec3 vLocal;
      varying float vHeight;
      varying float vReleased;
      float grain(vec3 point) {
        vec3 cell = floor(point);
        vec3 u = fract(point);
        u = u * u * (3.0 - 2.0 * u);
        vec4 offsets = vec4(0.0, 1.0, 71.0, 72.0);
        float seed = dot(cell, vec3(1.0, 71.0, 153.0));
        vec4 front = fract(sin(seed + offsets) * 723.573);
        vec4 back = fract(sin(seed + 153.0 + offsets) * 723.573);
        vec4 layer = mix(front, back, u.z);
        return mix(mix(layer.x, layer.y, u.x), mix(layer.z, layer.w, u.x), u.y);
      }
      void main() {
        if (vPresent < 0.995) discard;
        float risk = clamp(vAgreement, 0.0, 1.0);
        vec3 color = mix(holding, mild, smoothstep(0.0, 0.14, risk));
        color = mix(color, high, smoothstep(0.38, 0.69, risk));
        color = mix(color, severe, smoothstep(0.69, 0.96, risk));
        vec3 viewNormal = normalize(vNormal);
        if (!gl_FrontFacing) viewNormal *= -1.0;
        float light = 0.63 + 0.37 * max(0.0, dot(viewNormal, vec3(-0.45, 0.59, 0.67)));
        if (phase >= 0.0) {
          vec3 surface = normalize(cross(dFdx(vViewPoint), dFdy(vViewPoint)));
          float alignment = dot(surface, viewNormal);
          vec3 normal = normalize(mix(surface, viewNormal, 0.67 * smoothstep(0.25, 0.85, alignment)));
          vec3 key = normalize(mat3(viewMatrix) * vec3(-0.58, 0.81, 0.52));
          vec3 fill = normalize(mat3(viewMatrix) * vec3(0.6, 0.35, -0.7));
          float textureScale = max(0.15, diameter * 0.33);
          vec3 local = vLocal / textureScale;
          float footprint = max(length(dFdx(local)), length(dFdy(local)));
          float pores = (grain(local * 3.9) - 0.5) * (1.0 - smoothstep(0.19, 0.62, footprint));
          float mottling = grain(local * 0.55) - 0.5;
          float lambert = max(0.0, dot(normal, key));
          float bounce = max(0.0, dot(normal, fill));
          float sheen = pow(max(0.0, dot(normal, normalize(key + normalize(-vViewPoint)))), 21.0);
          float contact = mix(0.73, 1.0, smoothstep(0.0, diameter * 1.3, vHeight));
          vec3 clay = wet * (1.0 + 0.17 * mottling + 0.27 * pores);
          clay *= mix(vec3(1.0), vec3(0.91, 0.80, 0.69), vReleased);
          color = clay * (0.46 + 0.78 * lambert + 0.27 * bounce) * contact + 0.072 * sheen;
          light = 1.0;
        }
        gl_FragColor = vec4(color * light, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.visible = false;
  mesh.frustumCulled = false;
  let analysis;
  let source;
  let toolpath;
  let lastFrame = -2;
  let texture;
  let sectionsTexture;

  function setMesh(geometry, result, replay) {
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
    toolpath = replay;
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
    const tangents = new Float32Array(centers.length);
    for (let i = 0; i < result.nodeIds.length; i++) {
      const offset = result.nodeIds[i] * 3;
      centers[i * 3] = result.centers[offset];
      centers[i * 3 + 1] = result.centers[offset + 1];
      centers[i * 3 + 2] = result.centers[offset + 2];
      tangents[i * 3] = result.tangents[offset];
      tangents[i * 3 + 1] = result.tangents[offset + 1];
      tangents[i * 3 + 2] = result.tangents[offset + 2];
    }
    display.setAttribute('vicCenter', new THREE.BufferAttribute(centers, 3));
    display.setAttribute('vicTangent', new THREE.BufferAttribute(tangents, 3));
    display.setAttribute('releaseFrame', new THREE.BufferAttribute(Float32Array.from(result.nodeIds, id => result.failure[id]), 1));
    const width = Math.min(count, 2048);
    const height = Math.ceil(count * result.frames / width);
    texture = packTexture(result.trajectory, 4, THREE.RGBAFormat, THREE.FloatType);
    sectionsTexture = packTexture(result.sections, 4, THREE.RGBAFormat, THREE.UnsignedByteType);
    uniforms.motion.value = texture;
    uniforms.sections.value = sectionsTexture;
    uniforms.atlas.value.set(width, count, height);
    uniforms.frameCount.value = result.frames;
    uniforms.timedDraw.value = Boolean(toolpath);
    uniforms.diameter.value = result.diameter;

    function packTexture(values, stride, format, type) {
      let data = values;
      if (values.length !== width * height * stride) {
        data = new values.constructor(width * height * stride);
        data.set(values);
      }
      const frameTexture = new THREE.DataTexture(data, width, height, format, type);
      frameTexture.needsUpdate = true;
      return frameTexture;
    }
  }

  function show(mode, progress = 0) {
    mesh.visible = Boolean(analysis && mode);
    if (!mesh.visible) return;
    const phase = texture && (mode === 'demo' || mode === 'settled')
      ? (mode === 'settled' ? 1 : progress) * (analysis.frames - 1) : -1;
    uniforms.phase.value = phase;
    const frame = Math.floor(phase);
    let nozzleTime;
    if (phase >= 0 && toolpath) {
      const buildFrame = Math.min(frame, analysis.buildFrames);
      const from = analysis.times[buildFrame];
      const to = analysis.times[Math.min(buildFrame + 1, analysis.buildFrames)];
      const seconds = from + (to - from) * (phase - frame) - toolpath.start;
      mesh.geometry.setDrawRange(0, depositedIndexCount(toolpath, seconds));
      if (frame < analysis.buildFrames) nozzleTime = seconds;
    } else mesh.geometry.setDrawRange(0, source.index.count);
    if (frame === lastFrame || !analysis.cuts.length) return nozzleTime;
    const { cuts, stripLength } = analysis;
    const target = mesh.geometry.index;
    const original = source.index.array;
    for (let i = 0; i < cuts.length; i += 2) {
      const start = cuts[i];
      const at = cuts[i + 1];
      if (frame >= at && lastFrame < at) {
        const before = original[start];
        const after = original[start + 2];
        const sides = stripLength / 6;
        target.array.fill(before, start, start + stripLength);
        const next = writeRingCap(target.array, start, before, sides, false);
        writeRingCap(target.array, next, after, sides, true);
      }
      else if (frame < at && lastFrame >= at) target.array.set(original.subarray(start, start + stripLength), start);
    }
    target.needsUpdate = true;
    lastFrame = frame;
    return nozzleTime;
  }

  return { mesh, setMesh, show, setColor(color) { uniforms.wet.value.set(color); } };
}
