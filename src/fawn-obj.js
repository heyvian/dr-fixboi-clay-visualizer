import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'three/addons/libs/fflate.module.js';
import { bakeClayTextures, clayTileMillimeters } from './fawn-textures.js';

const uvAxes = [[1, 2], [2, 0], [0, 1]];

function projection(points, a, b, c) {
  const ax = a * 3, bx = b * 3, cx = c * 3;
  const ux = points[bx] - points[ax], uy = points[bx + 1] - points[ax + 1], uz = points[bx + 2] - points[ax + 2];
  const vx = points[cx] - points[ax], vy = points[cx + 1] - points[ax + 1], vz = points[cx + 2] - points[ax + 2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  // Select the most face-on projection. Flip U on back faces to keep its tangent right-handed.
  if (Math.abs(x) >= Math.max(Math.abs(y), Math.abs(z))) return x < 0 ? 1 : 0;
  if (Math.abs(y) >= Math.abs(z)) return y < 0 ? 3 : 2;
  return z < 0 ? 5 : 4;
}

function writeObj(entry, geometry, scale) {
  const points = geometry.getAttribute('position').array;
  const indices = geometry.index.array;
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal').array;
  const textureScale = clayTileMillimeters * scale;
  const uvIndices = new Uint32Array(2 * points.length);
  let uvCount = 0;
  let text = '# FAWN clay model, millimeters, Z up\nmtllib clay.mtl\no Clay\n';

  function line(value) {
    text += value + '\n';
    if (text.length >= 64 * 1024) {
      entry.push(strToU8(text));
      text = '';
    }
  }

  for (let i = 0; i < points.length; i += 3) {
    line('v ' + points[i].toFixed(6) + ' ' + points[i + 1].toFixed(6) + ' ' + points[i + 2].toFixed(6));
  }
  for (let i = 0; i < normals.length; i += 3) {
    line('vn ' + normals[i].toFixed(6) + ' ' + normals[i + 1].toFixed(6) + ' ' + normals[i + 2].toFixed(6));
  }
  // Cache the corner UVs; a geometry vertex can belong to more than one projection.
  for (let i = 0; i < indices.length; i += 3) {
    const side = projection(points, indices[i], indices[i + 1], indices[i + 2]);
    const [u, v] = uvAxes[side >> 1];
    const sign = side % 2 ? -1 : 1;
    for (let j = i; j < i + 3; j++) {
      const vertex = indices[j];
      const key = vertex * 6 + side;
      if (uvIndices[key]) continue;
      uvIndices[key] = ++uvCount;
      const offset = vertex * 3;
      line('vt ' + (points[offset + u] * sign / textureScale).toFixed(7) + ' ' +
        (points[offset + v] / textureScale).toFixed(7));
    }
  }
  line('usemtl Clay');
  line('s 1');
  for (let i = 0; i < indices.length; i += 3) {
    const side = projection(points, indices[i], indices[i + 1], indices[i + 2]);
    let face = 'f';
    for (let j = i; j < i + 3; j++) {
      const vertex = indices[j];
      face += ' ' + (vertex + 1) + '/' + uvIndices[vertex * 6 + side] + '/' + (vertex + 1);
    }
    line(face);
  }
  entry.push(strToU8(text), true);
}

function clayMtl(roughness) {
  return `newmtl Clay
Ka 0 0 0
Kd 1 1 1
Ks 0.04 0.04 0.04
Ns ${(2 / roughness ** 4 - 2).toFixed(3)}
Ni 1.48
illum 2
Pr ${roughness}
Pm 0
map_Kd clay-color.png
map_Pr clay-roughness.png
norm clay-normal.png
map_Bump clay-normal.png
# Alternate height map: clay-bump.png
`;
}

export function exportTexturedObj(geometry, finish, scale) {
  const textures = bakeClayTextures(finish);
  const parts = [];
  const zip = new Zip((error, data) => {
    if (error) throw error;
    parts.push(data);
  });
  const obj = new ZipDeflate('clay.obj', { level: 3 });
  zip.add(obj);
  writeObj(obj, geometry, scale);
  for (const [name, data] of Object.entries({ 'clay.mtl': strToU8(clayMtl(finish.roughness)), ...textures })) {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(data, true);
  }
  zip.end();
  return new Blob(parts, { type: 'application/zip' });
}
