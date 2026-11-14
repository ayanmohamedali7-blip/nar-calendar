// Automated checks:  node --test pipeline/test.mjs
// The "recount" tests read the raw FIRMS CSVs again with separate, deliberately simple code and
// compare the result with the published packs. They are skipped when raw/ is not present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodePack, monthlyCounts, harmonize, fitQuantileMap, crossValidate, climatology, percentileOf,
  inBox, inPolygon, dayToISO, ERA, FLAG,
} from '../site/js/harmonize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', 'index.json'), 'utf8'));
const loadPack = (meta) => decodePack(JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', meta.file), 'utf8')));
const packs = Object.fromEntries(index.countries.map((c) => [c.id, loadPack(c)]));

// ---------------------------------------------------------------- synthetic data helpers
function fakePack(records, lastYear = 2025) {
  // records: [isoDate, lat, lon, flags]
  const epoch = Date.UTC(2000, 0, 1);
  const list = records.map(([iso, lat, lon, f]) => ({ d: Math.round((Date.parse(iso + 'T00:00:00Z') - epoch) / 86400000), a: Math.floor(lat * 100), b: Math.floor(lon * 100), f }))
    .sort((x, y) => x.d - y.d);
  let prev = 0;
  return decodePack({
    n: list.length, res: 100, years: { modis: [2000, lastYear], viirs: [2012, lastYear] },
    dd: list.map((o) => { const v = o.d - prev; prev = o.d; return v; }),
    a: list.map((o) => o.a), b: list.map((o) => o.b), f: list.map((o) => o.f), frp: list.map(() => 1),
    staticCells: [], persistentCells: [], funnel: {},
  });
}

test('month index and dates are UTC and exact', () => {
  const P = fakePack([['2000-11-01', 10.005, 20.005, 1], ['2012-01-31', 10.005, 20.005, 4], ['2012-02-01', 10.005, 20.005, 4], ['2025-12-31', 10.005, 20.005, 6]]);
  assert.deepEqual([...P.mi], [10, 144, 145, 311]);
  assert.equal(dayToISO(P.day[0]), '2000-11-01');
  assert.equal(dayToISO(P.day[3]), '2025-12-31');
  assert.equal(P.nMonths, 312);
  assert.equal(ERA.TERRA_START, 10);
  assert.equal(ERA.AQUA_START, 30);
  assert.equal(ERA.VIIRS_START, 145);
});

test('monthly counts split sensors correctly', () => {
  const P = fakePack([
    ['2015-06-10', 10.005, 20.005, FLAG.TERRA],
    ['2015-06-10', 10.015, 20.005, FLAG.AQUA | FLAG.VIIRS],
    ['2015-06-11', 10.005, 20.005, FLAG.VIIRS],
    ['2015-07-01', 50.005, 20.005, FLAG.VIIRS], // outside the box below
  ]);
  const c = monthlyCounts(P, inBox(9, 19, 11, 21));
  const m = (2015 - 2000) * 12 + 5;
  assert.equal(c.M[m], 2);
  assert.equal(c.T[m], 1);
  assert.equal(c.V[m], 2);
  assert.equal(c.V[m + 1], 0);
  assert.equal(c.idx.length, 3);
});

test('negative longitudes and latitudes land in the right cell', () => {
  const P = fakePack([['2015-06-10', 34.995, -1.005, 4], ['2015-06-10', -0.005, -0.005, 4]]);
  assert.equal(monthlyCounts(P, inBox(34.99, -1.01, 35.0, -1.0)).idx.length, 1);
  assert.equal(monthlyCounts(P, inBox(-0.01, -0.01, 0, 0)).idx.length, 1);
  assert.equal(monthlyCounts(P, inBox(0, 0, 1, 1)).idx.length, 0);
});

test('polygon test agrees with the box test for a rectangle', () => {
  const box = [32.0, 20.5, 33.0, 23.2];
  const a = monthlyCounts(packs.libya, inBox(...box)).idx.length;
  const b = monthlyCounts(packs.libya, inPolygon([[32.0, 20.5], [32.0, 23.2], [33.0, 23.2], [33.0, 20.5]])).idx.length;
  assert.ok(a > 1000);
  assert.equal(a, b);
});

test('quantile map: monotone, exact on a perfect relation, proportional above the range', () => {
  const N = 312;
  const X = new Float64Array(N);
  const V = new Float64Array(N);
  for (let m = ERA.VIIRS_START; m < N; m++) { X[m] = m % 7; V[m] = 3 * (m % 7); }
  const q = fitQuantileMap(V, X, N);
  for (let x = 0; x <= 6; x++) assert.ok(Math.abs(q.map(x, 0) - 3 * x) < 1e-9, `map(${x})`);
  assert.ok(Math.abs(q.map(12, 0) - 36) < 1e-9);
  assert.ok(Math.abs(q.map(2.5, 0) - 7.5) < 1e-9);
  let prev = -1;
  for (let x = 0; x <= 20; x += 0.5) { const v = q.map(x, 3); assert.ok(v >= prev - 1e-9); prev = v; }
});

test('quantile map keeps the VIIRS total of the overlap (real packs, ready-made areas)', () => {
  for (const c of index.countries) {
    const P = packs[c.id];
    for (const a of [{ name: 'country', box: null }, ...c.presets]) {
      const { V, M, N } = monthlyCounts(P, a.box ? inBox(...a.box) : null);
      const q = fitQuantileMap(V, M, N);
      let sv = 0;
      let sp = 0;
      for (let m = ERA.VIIRS_START; m < N; m++) { sv += V[m]; sp += q.map(M[m], m % 12); }
      assert.ok(Math.abs(sp - sv) / sv < 0.03, `${c.id}/${a.name}: mapped ${sp.toFixed(0)} vs VIIRS ${sv}`);
    }
  }
});

test('harmonized series: eras, bands, no NaN where data exist', () => {
  for (const c of index.countries) {
    const P = packs[c.id];
    for (const a of [{ box: null }, ...c.presets]) {
      const h = harmonize(P, a.box ? inBox(...a.box) : null);
      for (let m = 0; m < h.N; m++) {
        if (m < ERA.TERRA_START) { assert.ok(Number.isNaN(h.H[m])); continue; }
        assert.ok(Number.isFinite(h.H[m]) && h.H[m] >= 0, `${c.id} m=${m}`);
        assert.ok(h.lo[m] <= h.H[m] + 1e-9 && h.hi[m] >= h.H[m] - 1e-9, `${c.id} band m=${m}`);
        if (m >= ERA.VIIRS_START) { assert.equal(h.H[m], h.Va[m]); assert.ok(h.Va[m] >= h.V[m]); assert.equal(h.src[m], "VIIRS"); }
      }
      assert.equal(h.src[ERA.TERRA_START], 'Terra');
      assert.equal(h.src[ERA.AQUA_START], 'MODIS');
      assert.equal(h.cv.years.length, 14);
      assert.equal(h.cv.years[0].year, 2012);
      assert.ok(Number.isFinite(h.cv.yearlyError));
    }
  }
});

test('degenerate areas do not produce NaN or throw', () => {
  const sea = harmonize(packs.libya, inBox(34.5, 17, 35.5, 18)); // open sea: no fires at all
  assert.equal(sea.idx.length, 0);
  for (let m = ERA.TERRA_START; m < sea.N; m++) assert.equal(sea.H[m], 0);
  assert.ok(sea.lowEvidence);
  const clim = climatology(sea.H, sea.N);
  assert.ok([...clim.med].every((v) => v === 0));
  // VIIRS fires but no MODIS fire at all
  const P = fakePack([['2015-06-10', 10.005, 20.005, 4], ['2016-06-10', 10.005, 20.005, 4], ['2019-08-02', 10.005, 20.005, 4]]);
  const h = harmonize(P);
  for (let m = ERA.TERRA_START; m < h.N; m++) assert.ok(Number.isFinite(h.H[m]) && Number.isFinite(h.lo[m]) && Number.isFinite(h.hi[m]));
  assert.ok(h.lowEvidence);
  const cv = crossValidate(h.V, h.M, h.N);
  assert.ok(cv.years.every((y) => Number.isFinite(y.predicted)));
});

test('climatology and percentile rank', () => {
  const N = 48;
  const H = new Float64Array(N).fill(NaN);
  for (let y = 0; y < 4; y++) H[y * 12 + 5] = [1, 5, 3, 9][y]; // four Junes
  const c = climatology(H, N);
  assert.equal(c.med[5], 4);
  assert.equal(c.count[5], 4);
  assert.ok(Number.isNaN(c.med[0]));
  assert.equal(percentileOf(H, 3 * 12 + 5), 1); // 9 is above the three others
  assert.equal(percentileOf(H, 5), 0);
});

// ---------------------------------------------------------------- pack integrity
test('packs are well formed', () => {
  for (const c of index.countries) {
    const P = packs[c.id];
    assert.equal(P.a.length, P.n);
    assert.equal(P.f.length, P.n);
    for (let i = 0; i < P.n; i++) {
      if (i) assert.ok(P.day[i] >= P.day[i - 1], 'sorted by day');
      assert.ok(P.f[i] & 7, 'at least one sensor flag');
      if (P.f[i] & FLAG.VIIRS) assert.ok(P.mi[i] >= 144, 'no VIIRS before 2012');
      assert.ok(P.mi[i] >= ERA.TERRA_START && P.mi[i] < P.nMonths);
    }
    for (const p of c.presets) {
      assert.ok(p.box[2] > p.box[0] && p.box[3] > p.box[1]);
      assert.ok(monthlyCounts(P, inBox(...p.box)).idx.length > 100, `${c.id}/${p.id} has fires`);
    }
  }
});

// ---------------------------------------------------------------- independent recount from raw CSV
function recount(country) {
  const dir = path.join(ROOT, 'raw', country);
  if (!fs.existsSync(dir)) return null;
  const det = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv')) continue;
    const viirs = f.startsWith('viirs');
    const [head, ...lines] = fs.readFileSync(path.join(dir, f), 'utf8').trim().split(/\r?\n/);
    const col = head.split(',');
    const iLat = col.indexOf('latitude'), iLon = col.indexOf('longitude'), iDate = col.indexOf('acq_date'), iSat = col.indexOf('satellite'), iConf = col.indexOf('confidence'), iType = col.indexOf('type');
    for (const line of lines) {
      const c = line.split(',');
      det.push({ cy: Math.floor(Number(c[iLat]) * 100), cx: Math.floor(Number(c[iLon]) * 100), date: c[iDate], viirs, terra: c[iSat] === 'Terra', type: c[iType], lowConf: viirs ? c[iConf] === 'l' : Number(c[iConf]) < 30 });
    }
  }
  const id = (y, x) => `${y}:${x}`;
  const staticSet = new Set(det.filter((d) => d.type !== '0').map((d) => id(d.cy, d.cx)));
  const near = (d) => { const r = d.viirs ? 2 : 3; for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (staticSet.has(id(d.cy + i, d.cx + j))) return true; return false; };
  let fires = det.filter((d) => d.type === '0' && !d.lowConf && !near(d));
  const byCell = new Map();
  for (const d of fires) { const k = id(d.cy, d.cx); if (!byCell.has(k)) byCell.set(k, new Set()); byCell.get(k).add(d.date); }
  const persistent = new Set();
  for (const k of byCell.keys()) {
    const [y, x] = k.split(':').map(Number);
    const days = new Set();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const dd of byCell.get(id(y + i, x + j)) || []) days.add(dd);
    const months = new Set([...days].map((dd) => dd.slice(5, 7)));
    if (days.size >= 15 && months.size >= 8) persistent.add(k);
  }
  fires = fires.filter((d) => !persistent.has(id(d.cy, d.cx)));
  return (box) => {
    const V = new Map(), M = new Map(), T = new Map();
    const add = (map, d) => { const ym = d.date.slice(0, 7); if (!map.has(ym)) map.set(ym, new Set()); map.get(ym).add(`${d.date}|${d.cy}|${d.cx}`); };
    for (const d of fires) {
      const lat = d.cy / 100 + 0.005, lon = d.cx / 100 + 0.005;
      if (box && !(lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3])) continue;
      if (d.viirs) add(V, d); else { add(M, d); if (d.terra) add(T, d); }
    }
    return { V, M, T, total: fires.length };
  };
}

for (const c of index.countries) {
  test(`recount from raw FIRMS files matches the pack: ${c.name}`, { skip: !fs.existsSync(path.join(ROOT, 'raw', c.name)) && 'raw data not downloaded' }, () => {
    const count = recount(c.name);
    const P = packs[c.id];
    for (const a of [{ name: 'country', box: null }, ...c.presets]) {
      const want = count(a.box);
      const got = monthlyCounts(P, a.box ? inBox(...a.box) : null);
      let checked = 0;
      for (let m = 0; m < got.N; m++) {
        const ym = `${2000 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
        assert.equal(got.V[m], want.V.get(ym)?.size || 0, `${c.id}/${a.name} VIIRS ${ym}`);
        assert.equal(got.M[m], want.M.get(ym)?.size || 0, `${c.id}/${a.name} MODIS ${ym}`);
        assert.equal(got.T[m], want.T.get(ym)?.size || 0, `${c.id}/${a.name} Terra ${ym}`);
        checked++;
      }
      assert.equal(checked, P.nMonths);
    }
  });
}
