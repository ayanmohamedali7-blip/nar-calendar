// Build a harmonization-ready "country pack" from raw FIRMS archive CSVs.
//
//   node pipeline/build-data.mjs <CountryName>
//
// Input : raw/<Country>/modis_<Y>_<Country>.csv, viirs-snpp_<Y>_<Country>.csv
//         (NASA FIRMS yearly country archives, MODIS C6.1 + VIIRS S-NPP 375 m)
// Output: site/data/<country>.json
//
// Steps (all documented in README "Method"):
//   1. keep FIRMS type 0 (presumed vegetation fire); type 1/2/3 = volcano / static land source / offshore
//   2. drop low-confidence detections (MODIS < 30 %, VIIRS "l")
//   3. static-source mask: every 0.01 deg cell that ever held a type 1/2/3 detection, dilated
//      (2 cells for VIIRS, 3 for MODIS because the MODIS footprint is larger)
//   4. persistence mask: cells whose 3x3 neighbourhood shows fire on >= 15 distinct days spread
//      over >= 8 different calendar months (year-round heat = industry, flares, dumps; not seasonal fire)
//   5. collapse to "burning cell-days": one record per 0.01 deg cell and day, with sensor flags
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const country = process.argv[2];
// last day covered by the data; default = 31 December of the newest yearly file
const throughArg = process.argv[3];
if (!country || (throughArg && !/^\d{4}-\d{2}-\d{2}$/.test(throughArg))) { console.error('usage: node pipeline/build-data.mjs <CountryName> [data-through YYYY-MM-DD]'); process.exit(1); }
const RAW = path.join(ROOT, 'raw', country);
const OUT = path.join(ROOT, 'site', 'data');
const RES = 100;                 // cells per degree (0.01 deg ~ 1.1 km)
const DILATE = { M: 3, V: 2 };
const PERSIST_DAYS = 15, PERSIST_MONTHS = 8;
const EPOCH = Date.UTC(2000, 0, 1);
const dayIndex = (s) => Math.round((Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) - EPOCH) / 86400000);
const K = (a, b) => (a + 9000) * 36000 + (b + 18000);

const rows = [];
const yearsBySensor = { M: new Set(), V: new Set() };
const untypedFrom = { M: null, V: null }; // first date of near-real-time rows (no FIRMS type)
for (const f of fs.readdirSync(RAW).sort()) {
  const m = /^(modis|viirs-snpp)_(\d{4})_/.exec(f);
  if (!m) continue;
  const sensor = m[1] === 'modis' ? 'M' : 'V';
  yearsBySensor[sensor].add(+m[2]);
  const lines = fs.readFileSync(path.join(RAW, f), 'utf8').split(/\r?\n/);
  const head = lines[0].split(',');
  const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < head.length) continue;
    const lat = +c[ix.latitude], lon = +c[ix.longitude];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (throughArg && c[ix.acq_date] > throughArg) continue;
    const conf = c[ix.confidence];
    if ((ix.type === undefined || c[ix.type] === '') && (!untypedFrom[sensor] || c[ix.acq_date] < untypedFrom[sensor])) untypedFrom[sensor] = c[ix.acq_date];
    rows.push({
      a: Math.floor(lat * RES), b: Math.floor(lon * RES),
      day: dayIndex(c[ix.acq_date]), month: +c[ix.acq_date].slice(5, 7), year: +c[ix.acq_date].slice(0, 4),
      // near-real-time rows (downloaded through the API) carry no type yet: they are treated as
      // candidates and have to pass the static-source and persistence masks like everything else
      sensor, sat: c[ix.satellite], type: ix.type === undefined || c[ix.type] === '' ? 0 : +c[ix.type],
      low: sensor === 'M' ? +conf < 30 : conf === 'l',
      night: c[ix.daynight] === 'N', frp: +c[ix.frp] || 0,
    });
  }
}

// --- filter funnel statistics (per year, per sensor) ---
const funnel = {};
const bump = (r, step) => { const k = r.year; funnel[k] ??= {}; funnel[k][r.sensor] ??= { raw: 0, type0: 0, conf: 0, mask: 0, kept: 0 }; funnel[k][r.sensor][step]++; };

// step 3 mask source: every cell with a non-vegetation FIRMS type
const staticCells = new Map();   // key -> {a,b,n}
for (const r of rows) {
  bump(r, 'raw');
  if (r.type !== 0) { const k = K(r.a, r.b); const s = staticCells.get(k) || { a: r.a, b: r.b, n: 0 }; s.n++; staticCells.set(k, s); }
}
const nearStatic = (r) => { const d = DILATE[r.sensor]; for (let i = -d; i <= d; i++) for (let j = -d; j <= d; j++) if (staticCells.has(K(r.a + i, r.b + j))) return true; return false; };

let kept = [];
for (const r of rows) {
  if (r.type !== 0) continue; bump(r, 'type0');
  if (r.low) continue; bump(r, 'conf');
  if (nearStatic(r)) continue; bump(r, 'mask');
  kept.push(r);
}

// step 4 persistence mask
const cellDays = new Map();
for (const r of kept) { const k = K(r.a, r.b); let s = cellDays.get(k); if (!s) cellDays.set(k, s = { a: r.a, b: r.b, days: new Map() }); s.days.set(r.day, r.month); }
const persistent = new Map();
for (const [k, c] of cellDays) {
  const days = new Set(), months = new Set();
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const n = cellDays.get(K(c.a + i, c.b + j)); if (!n) continue;
    for (const [d, m] of n.days) { days.add(d); months.add(m); }
  }
  if (days.size >= PERSIST_DAYS && months.size >= PERSIST_MONTHS) persistent.set(k, { a: c.a, b: c.b, n: days.size, months: months.size });
}
kept = kept.filter((r) => { if (persistent.has(K(r.a, r.b))) return false; bump(r, 'kept'); return true; });

// step 5 burning cell-days. flags: 1 Terra, 2 Aqua, 4 VIIRS S-NPP, 8 any night detection
const recs = new Map();
for (const r of kept) {
  const k = r.day * 1e10 + K(r.a, r.b);
  let o = recs.get(k); if (!o) recs.set(k, o = { d: r.day, a: r.a, b: r.b, f: 0, frp: 0 });
  o.f |= r.sensor === 'V' ? 4 : (r.sat === 'Terra' ? 1 : 2);
  if (r.night) o.f |= 8;
  if (r.frp > o.frp) o.frp = r.frp;
}
const list = [...recs.values()].sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b);
let prev = 0;
const pack = {
  country,
  source: 'NASA FIRMS archive: MODIS Collection 6.1 (Terra+Aqua, 1 km) and VIIRS S-NPP 375 m, yearly country files',
  built: new Date().toISOString().slice(0, 10),
  res: RES, epoch: '2000-01-01',
  years: { modis: [Math.min(...yearsBySensor.M), Math.max(...yearsBySensor.M)], viirs: [Math.min(...yearsBySensor.V), Math.max(...yearsBySensor.V)] },
  preliminaryFrom: untypedFrom.V, // VIIRS months from here on are near-real-time data
  through: throughArg || `${Math.max(...yearsBySensor.M, ...yearsBySensor.V)}-12-31`,
  rules: { dilate: DILATE, persistDays: PERSIST_DAYS, persistMonths: PERSIST_MONTHS, minConfModis: 30 },
  funnel,
  // satellite outages (inclusive ISO date ranges), from pipeline/find-gaps.mjs
  gaps: fs.existsSync(path.join(ROOT, 'pipeline', 'sensor-gaps.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline', 'sensor-gaps.json'), 'utf8')).gaps : { terra: [], aqua: [], viirs: [] },
  n: list.length,
  dd: list.map((o) => { const v = o.d - prev; prev = o.d; return v; }),   // delta-encoded day index
  a: list.map((o) => o.a), b: list.map((o) => o.b), f: list.map((o) => o.f),
  frp: list.map((o) => Math.round(o.frp)),
  staticCells: [...staticCells.values()].map((s) => [s.a, s.b, s.n]),
  persistentCells: [...persistent.values()].map((s) => [s.a, s.b, s.n]),
};
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, country.toLowerCase().replace(/[^a-z]+/g, '-') + '.json');
fs.writeFileSync(file, JSON.stringify(pack));

const tot = { M: { raw: 0, type0: 0, conf: 0, mask: 0, kept: 0 }, V: { raw: 0, type0: 0, conf: 0, mask: 0, kept: 0 } };
for (const y of Object.values(funnel)) for (const s of ['M', 'V']) if (y[s]) for (const k in tot[s]) tot[s][k] += y[s][k];
console.log(country, 'detections funnel', JSON.stringify(tot));
console.log('static cells', staticCells.size, 'persistent cells', persistent.size, 'cell-days', list.length,
  'MODIS', list.filter((o) => o.f & 3).length, 'VIIRS', list.filter((o) => o.f & 4).length, 'both', list.filter((o) => (o.f & 3) && (o.f & 4)).length);
console.log('persistent sample', [...persistent.values()].sort((x, y) => y.n - x.n).slice(0, 8).map((p) => `${p.a / 100},${p.b / 100} d=${p.n} m=${p.months}`).join(' | '));
console.log('wrote', file, (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
