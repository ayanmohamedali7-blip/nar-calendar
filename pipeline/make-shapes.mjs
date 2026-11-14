// Extract country outlines for clipping API downloads to one country.
// Source: Natural Earth 1:10m Admin 0 countries (public domain, naturalearthdata.com).
//   node pipeline/make-shapes.mjs <path-to-ne_10m_admin_0_countries.geojson> Libya Algeria Egypt Tunisia
// Writes pipeline/country-shapes.json  { Country: { bbox:[w,s,e,n], polygons:[ [ring, hole...], ... ] } }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [src, ...names] = process.argv.slice(2);
const gj = JSON.parse(fs.readFileSync(src, 'utf8'));
const file = path.join(ROOT, 'pipeline', 'country-shapes.json');
const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const r4 = (v) => Math.round(v * 1e4) / 1e4;
for (const name of names) {
  const f = gj.features.find((x) => x.properties.ADMIN === name || x.properties.NAME === name);
  if (!f) { console.error('not found:', name); continue; }
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let w = 180, s = 90, e = -180, n = -90;
  const polygons = polys.map((rings) => rings.map((ring) => ring.map(([x, y]) => {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
    return [r4(x), r4(y)];
  })));
  out[name] = { bbox: [r4(w - 0.05), r4(s - 0.05), r4(e + 0.05), r4(n + 0.05)], polygons };
  console.log(name, 'polygons', polygons.length, 'points', polygons.flat(2).length, 'bbox', out[name].bbox.join(','));
}
fs.writeFileSync(file, JSON.stringify(out));
console.log('wrote', file, (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
