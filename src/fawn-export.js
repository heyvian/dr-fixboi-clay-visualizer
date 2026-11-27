import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { exportTexturedObj } from './fawn-obj.js';

function printCoordinates(positions, scale) {
  let bottom = Infinity;
  for (let i = 1; i < positions.length; i += 3) bottom = Math.min(bottom, positions[i]);
  const points = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    // Convert the viewer's Y-up coordinates to printer coordinates and seat the base on Z0.
    points[i] = positions[i] * scale;
    points[i + 1] = -positions[i + 2] * scale;
    points[i + 2] = (positions[i + 1] - bottom) * scale;
    if (!Number.isFinite(points[i] + points[i + 1] + points[i + 2])) {
      throw new Error('This preview contains invalid coordinates.');
    }
  }
  return points;
}

const stepHeader = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('FAWN tessellated clay model'),'2;1');
FILE_NAME('fawn.step','${new Date().toISOString().slice(0, 19)}',(''),(''),'FAWN','FAWN','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF. {1 0 10303 442 1 1 4}'));
ENDSEC;
DATA;
#1=APPLICATION_PROTOCOL_DEFINITION('international standard','ap242_managed_model_based_3d_engineering',2013,#2);
#2=APPLICATION_CONTEXT('Managed model based 3d engineering');
#3=SHAPE_DEFINITION_REPRESENTATION(#4,#10);
#4=PRODUCT_DEFINITION_SHAPE('','',#5);
#5=PRODUCT_DEFINITION('design','',#6,#9);
#6=PRODUCT_DEFINITION_FORMATION('','',#7);
#7=PRODUCT('FAWN','Clay model','',(#8));
#8=PRODUCT_CONTEXT('',#2,'mechanical');
#9=PRODUCT_DEFINITION_CONTEXT('part definition',#2,'design');
#10=TESSELLATED_SHAPE_REPRESENTATION('',(#17),#11);
#11=(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#15))
GLOBAL_UNIT_ASSIGNED_CONTEXT((#12,#13,#14)) REPRESENTATION_CONTEXT('','3D'));
#12=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));
#13=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.));
#14=(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT());
#15=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#12,'distance_accuracy_value','');
`;

function addTriples(parts, values, serialize) {
  let chunk = '';
  for (let i = 0; i < values.length; i += 3) {
    if (i) chunk += ',\n';
    chunk += '(' + serialize(values[i]) + ',' + serialize(values[i + 1]) + ',' + serialize(values[i + 2]) + ')';
    if (chunk.length >= 64 * 1024) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
}

function exportStep(points, indices) {
  const count = points.length / 3;
  const parts = [stepHeader, "#16=COORDINATES_LIST(''," + count + ',(\n'];
  // STEP real values require the decimal point, even if all decimal places are zero.
  addTriples(parts, points, value => value.toFixed(6).replace(/0+$/, ''));
  parts.push("\n));\n#17=TRIANGULATED_SURFACE_SET('',#16," + count + ',(),(),(\n');
  addTriples(parts, indices, index => index + 1);
  parts.push('\n));\nENDSEC;\nEND-ISO-10303-21;\n');
  return new Blob(parts, { type: 'model/step' });
}

export function exportClayModel({ positions, indices, format, scale, finish }) {
  if (!positions.length || !indices.length || !Number.isFinite(scale) || scale <= 0) {
    throw new Error('A generated clay model is required to export.');
  }
  const points = printCoordinates(positions, scale);
  if (format === 'step') return exportStep(points, indices);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(points, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  if (format === 'obj') return exportTexturedObj(geometry, finish, scale);
  const data = new STLExporter().parse(new Mesh(geometry), { binary: true });
  return new Blob([data], { type: 'model/stl' });
}
