import { CanvasTexture, Group, Mesh, MeshPhysicalMaterial, SRGBColorSpace } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { setStudioSurface, studioNoise } from './studio-materials.js';

const rulerLength = 314;
const rulerWidth = 31;
const scaleLength = 300;

function rulerMarkings() {
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 512;
  const ink = canvas.getContext('2d');
  ink.scale(canvas.width / rulerLength, canvas.height / rulerWidth);
  ink.strokeStyle = '#161a1b';
  ink.fillStyle = '#161a1b';
  ink.font = '3.35px sans-serif';
  ink.textAlign = 'center';
  const margin = (rulerLength - scaleLength) / 2;
  for (let mm = 0; mm <= scaleLength; mm++) {
    const x = margin + mm;
    const centimeter = mm % 10 === 0;
    const height = centimeter ? 6 : (mm % 5 === 0 ? 4.35 : 2.7);
    ink.lineWidth = centimeter ? 0.22 : 0.14;
    ink.beginPath();
    ink.moveTo(x, 0.9);
    ink.lineTo(x, 0.9 + height);
    ink.stroke();
    if (centimeter) ink.fillText(String(mm / 10), x, 11.2);
  }
  ink.font = '2.7px sans-serif';
  ink.textAlign = 'left';
  ink.fillText('cm', margin, 19);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

const wear = `
uniform sampler2D uRulerMarks;

float claySmear(vec2 offset, vec2 scale, float textureNoise) {
  vec2 streak = vec2(offset.x + 1.6 * offset.y, offset.y) / scale;
  return (1.0 - smoothstep(0.21, 1.1, length(streak) + (textureNoise - 0.5) * 0.65))
    * smoothstep(0.10, 0.78, textureNoise);
}

float thumbprint(vec2 point, float textureNoise) {
  vec2 offset = point - vec2(56.5, 3.5);
  vec2 printPoint = vec2(0.93 * offset.x + 0.37 * offset.y, -0.37 * offset.x + 0.93 * offset.y);
  float radius = length(printPoint * vec2(1.05, 0.78));
  float angle = atan(printPoint.y, printPoint.x + 0.0001);
  float phase = radius * 1.49 + angle / 6.2831853 + 0.17 * sin(printPoint.y * 0.46);
  float ridge = smoothstep(0.21, 0.85, 0.5 + 0.5 * cos(6.2831853 * phase));
  float pressure = 1.0 - smoothstep(5.1, 9.3, radius + textureNoise * 1.45);
  float transfer = smoothstep(0.16, 0.58, textureNoise + 0.13 * sin(angle * 2.0 + radius * 0.4));
  return pressure * transfer * mix(0.39, ridge, visibleDetail(point * 1.49));
}
`;

export function createStudioRuler() {
  const ruler = new Group();
  const metal = new MeshPhysicalMaterial({ color: '#a3a7a8', metalness: 0.74, roughness: 0.64, anisotropy: 0.25 });
  setStudioSurface(metal, 'worn ruler', studioNoise + wear, {
    color_fragment: `
      vec2 rulerPoint = vPropPosition.xz;
      float face = smoothstep(0.28, 0.44, vPropPosition.y);
      vec2 scaleUV = vec2(0.5 + rulerPoint.x / ${rulerLength.toFixed(1)}, 0.5 - rulerPoint.y / ${rulerWidth.toFixed(1)});
      float engraving = texture2D(uRulerMarks, scaleUV).a * face;
      vec2 brushPoint = vec2(rulerPoint.x * 0.074, rulerPoint.y * 10.8);
      float brushing = (studioNoise(brushPoint) - 0.5) * visibleDetail(brushPoint);
      vec2 scratchPoint = vec2(rulerPoint.x * 0.031, rulerPoint.y * 2.3 + rulerPoint.x * 0.024);
      float scratches = smoothstep(0.75, 0.96, studioNoise(scratchPoint)) * visibleDetail(scratchPoint);
      float clayGrain = studioNoise(rulerPoint * vec2(0.17, 0.48) + 18.0);
      float broadStreak = claySmear(rulerPoint - vec2(-88.0, 4.4), vec2(32.0, 8.8), clayGrain);
      float wipedEnd = claySmear(rulerPoint - vec2(113.0, -2.0), vec2(23.0, 9.1), clayGrain);
      float fingerSmudges = claySmear(rulerPoint - vec2(-13.0, 4.6), vec2(18.5, 6.2), clayGrain);
      float dust = studioNoise(rulerPoint * 1.34);
      float printDeposit = thumbprint(rulerPoint, clayGrain);
      float clayCoverage = face * max(0.84 * printDeposit, max(0.76 * broadStreak, 0.59 * max(wipedEnd, fingerSmudges)));
      float crumbs = smoothstep(0.77, 0.95, dust) * max(0.12, clayCoverage);
      diffuseColor.rgb *= 1.0 + 0.19 * brushing - 0.35 * scratches;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.024, 0.026, 0.028), engraving * 0.92);
      vec3 slipColor = mix(vec3(0.21, 0.13, 0.08), vec3(0.45, 0.30, 0.18), dust);
      diffuseColor.rgb = mix(diffuseColor.rgb, slipColor, min(0.94, clayCoverage + crumbs * face * 0.68));
      float rulerBump = 0.009 * brushing - 0.018 * scratches + (clayCoverage + crumbs) * 0.033;
    `,
    roughnessmap_fragment: 'roughnessFactor = mix(roughnessFactor + 0.05 * brushing + 0.10 * scratches, 0.92, max(engraving * 0.48, clayCoverage));',
    metalnessmap_fragment: 'metalnessFactor *= 1.0 - max(engraving * 0.92, clayCoverage);',
    normal_fragment_maps: 'normal = surfaceBumpNormal(-vViewPosition, normal, rulerBump, faceDirection);',
  }, { uRulerMarks: { value: rulerMarkings() } });

  const strip = new Mesh(new RoundedBoxGeometry(rulerLength, 1, rulerWidth, 2, 0.37), metal);
  strip.position.y = 1.7;
  const cork = new MeshPhysicalMaterial({ color: '#886640', roughness: 0.96 });
  setStudioSurface(cork, 'cork backing', studioNoise, {
    color_fragment: `
      vec2 corkPoint = vPropPosition.xz + vec2(0.72, 1.16) * vPropPosition.y;
      float granules = studioNoise(corkPoint * 1.61);
      float binder = studioNoise(corkPoint * 4.33 + 75.3);
      diffuseColor.rgb *= mix(0.56, 1.38, granules) + 0.16 * binder;
      float corkBump = 0.16 * granules + 0.07 * binder;
    `,
    normal_fragment_maps: 'normal = surfaceBumpNormal(-vViewPosition, normal, corkBump, faceDirection);',
  });
  const backing = new Mesh(new RoundedBoxGeometry(rulerLength - 2.8, 1.23, rulerWidth - 2.8, 2, 0.5), cork);
  backing.position.y = 0.615;
  ruler.add(backing, strip);
  ruler.rotation.y = 0.36;
  return ruler;
}
