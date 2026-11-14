// Prints the harmonization check for the ready-made areas of a country:
//   node pipeline/validate.mjs libya
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePack, harmonize, inBox } from '../site/js/harmonize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2] || 'libya';
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', 'index.json'), 'utf8'));
const meta = index.countries.find((c) => c.id === id);
const P = decodePack(JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', meta.file), 'utf8')));
const areas = [{ name: 'Whole country', box: null }, ...meta.presets];
const pc = (x) => (Number.isFinite(x) ? (100 * x).toFixed(0) + '%' : 'NA');
const f = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'NA');
for (const a of areas) {
  const h = harmonize(P, a.box ? inBox(...a.box) : null);
  console.log(`\n== ${a.name}: ${h.idx.length} cell-days; overlap VIIRS ${h.overlap.SV} / MODIS ${h.overlap.SX} (plain ratio ${f(h.overlap.ratio)})${h.lowEvidence ? '  LOW EVIDENCE' : ''}`);
  console.log('   mapping MODIS->VIIRS  ' + h.qm.table.slice(0, 7).map((t) => `${t[0]}->${t[1].toFixed(1)}`).join('  ') + (h.qm.table.length > 7 ? '  ...' : ''));
  console.log(`   leave-one-year-out: yearly miss ${pc(h.cv.yearlyError)} (single factor ${pc(h.cv.yearlyErrorRatio)}), monthly miss ${pc(h.cv.monthlyError)}, year band x${h.cv.yearBand.map(f).join('..')}, month band ${h.cv.monthBand.map(f).join('..')}`);
  console.log('   obs/pred  ' + h.cv.years.map((y) => `${String(y.year).slice(2)}:${y.observed}/${y.predicted.toFixed(0)}`).join(' '));
  const yr = {};
  for (let m = 0; m < h.N; m++) if (Number.isFinite(h.H[m])) yr[2000 + Math.floor(m / 12)] = (yr[2000 + Math.floor(m / 12)] || 0) + h.H[m];
  console.log('   harmonized ' + Object.entries(yr).map(([y, v]) => y.slice(2) + ':' + v.toFixed(0)).join(' '));
}
