// Checks for the NOAA-20 continuation of the record.
//   node --test pipeline/test.mjs pipeline/test-fixes.mjs pipeline/test-noaa20.mjs
// A pack carries NOAA-20 only when its download is complete, so every check runs on the packs
// that have it; the raw-file check is skipped when raw/ is not present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePack, harmonize, monthlyCounts, inBox, ERA, NOAA20_FILL_DAYS } from '../site/js/harmonize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', 'index.json'), 'utf8'));
const raw = Object.fromEntries(index.countries.map((c) => [c.id, JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', c.file), 'utf8'))]));
const packs = Object.fromEntries(index.countries.map((c) => [c.id, decodePack(raw[c.id])]));
const withN20 = index.countries.filter((c) => packs[c.id].n20);
const EPOCH = Date.UTC(2000, 0, 1);
const iso = (d) => new Date(EPOCH + d * 86400000).toISOString().slice(0, 10);

test('at least the home country carries the NOAA-20 record', () => {
  assert.ok(packs.libya.n20, 'Libya has no NOAA-20 record');
  assert.ok(withN20.length >= 1);
});

test('NOAA-20 list is well formed: sorted, inside its dates, no duplicate cell-day', () => {
  for (const c of withN20) {
    const q = packs[c.id].n20;
    // 'from' is the first day with any NOAA-20 detection: a small country can have none on 1 April
    assert.ok(q.from >= '2018-04-01' && q.from <= '2018-04-07', c.id + ' from ' + q.from);
    assert.ok(q.through >= '2026-11-01', `${c.id} through ${q.through}`);
    const seen = new Set();
    for (let i = 0; i < q.n; i++) {
      if (i) assert.ok(q.day[i] >= q.day[i - 1], `${c.id} not sorted at ${i}`);
      const d = iso(q.day[i]);
      assert.ok(d >= q.from && d <= q.through, `${c.id} date ${d}`);
      const key = q.day[i] + ':' + q.a[i] + ':' + q.b[i];
      assert.ok(!seen.has(key), `${c.id} duplicate ${key}`);
      seen.add(key);
      assert.equal(q.mi[i], (+d.slice(0, 4) - 2000) * 12 + (+d.slice(5, 7) - 1));
    }
  }
});

test('adding NOAA-20 leaves the MODIS and S-NPP record untouched', () => {
  for (const c of withN20) {
    const P = packs[c.id];
    const with_ = harmonize(P);
    const without = harmonize({ ...P, n20: null });
    assert.equal(without.bridge, null);
    assert.deepEqual([...with_.V], [...without.V]);
    assert.deepEqual([...with_.M], [...without.M]);
    assert.deepEqual([...with_.Va], [...without.Va]);
    assert.equal(with_.method, without.method);
    assert.equal(with_.cv.yearlyError, without.cv.yearlyError);
    // only the months NOAA-20 supplies may differ
    for (let m = 0; m < P.nMonths; m++) {
      if (with_.sat[m] === 'NOAA-20') continue;
      assert.ok(Object.is(with_.H[m], without.H[m]), `${c.id} m=${m}`);
    }
  }
});

test('NOAA-20 supplies exactly the months in which S-NPP was down for days', () => {
  for (const c of withN20) {
    const P = packs[c.id];
    for (const a of [{ box: null }, ...c.presets]) {
      const h = harmonize(P, a.box ? inBox(...a.box) : null);
      assert.ok(h.bridge, c.id);
      let filled = 0;
      for (let m = 0; m < h.N; m++) {
        const should = !h.bridge.weak && m >= ERA.NOAA20_START && P.missing.viirs[m] >= NOAA20_FILL_DAYS && P.coverage.noaa20[m] > P.coverage.viirs[m];
        assert.equal(h.sat[m] === 'NOAA-20', should, `${c.id} ${a.name || 'country'} m=${m}`);
        if (should) {
          filled++;
          assert.equal(h.src[m], 'VIIRS');
          assert.ok(Math.abs(h.H[m] - h.bridge.map(h.Na[m], m % 12)) < 1e-9);
          assert.ok(h.lo[m] <= h.H[m] + 1e-9 && h.hi[m] >= h.H[m] - 1e-9);
        }
        if (m < ERA.VIIRS_START) assert.equal(h.sat[m], '');
      }
      assert.equal(h.bridge.filled, filled);
      // August 2022: S-NPP was out for 10 days, NOAA-20 for none
      if (!h.bridge.weak) assert.equal(h.sat[(2022 - 2000) * 12 + 7], 'NOAA-20');
    }
  }
});

test('the two VIIRS agree: whole countries within a quarter, factor close to one', () => {
  for (const c of withN20) {
    const b = harmonize(packs[c.id]).bridge;
    assert.ok(!b.weak, c.id);
    assert.ok(Number.isFinite(b.yearlyError) && b.yearlyError < 0.25, `${c.id} bridge error ${b.yearlyError}`);
    assert.ok(b.ratio > 0.7 && b.ratio < 1.3, `${c.id} factor ${b.ratio}`);
    assert.equal(b.years[0].year, 2018);
    assert.equal(b.n, b.years.length);
  }
});

test('an area without fires gives a weak bridge and no NOAA-20 month', () => {
  const P = packs.libya;
  const h = harmonize(P, inBox(22.0, 24.0, 22.2, 24.2)); // open desert
  assert.ok(h.bridge && h.bridge.weak);
  assert.ok(h.sat.every((s) => s !== 'NOAA-20'));
  for (let m = ERA.TERRA_START; m < h.N; m++) assert.ok(Number.isFinite(h.H[m]));
});

test('month in progress: counted from NOAA-20 alone, after the record ends', () => {
  for (const c of withN20) {
    const P = packs[c.id];
    const h = harmonize(P);
    assert.ok(h.now, c.id);
    assert.equal(h.now.from, iso(P.n20.tailFrom));
    assert.equal(h.now.from.slice(8), '01');
    assert.equal(h.now.to, P.n20.through);
    let n = 0;
    for (let i = 0; i < P.n20.n; i++) if (P.n20.mi[i] >= P.nMonths) n++;
    assert.equal(h.now.noaa20, n);
    assert.equal(monthlyCounts(P, null).tail, n);
    // nothing of the month in progress leaks into the monthly record
    assert.equal(h.Nn.length, P.nMonths);
  }
});

test('every NOAA-20 cell-day in the pack exists in the raw FIRMS files (not low confidence, not a static source type)', (t) => {
  const dir = path.join(ROOT, 'raw', 'Libya');
  if (!fs.existsSync(dir) || !fs.readdirSync(dir).some((f) => f.startsWith('viirs-noaa20_'))) return t.skip('raw NOAA-20 files not present');
  const ok = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('viirs-noaa20_') || !f.endsWith('.csv')) continue;
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    const head = lines[0].trim().split(',');
    const iLat = head.indexOf('latitude'), iLon = head.indexOf('longitude'), iDate = head.indexOf('acq_date'), iConf = head.indexOf('confidence'), iType = head.indexOf('type');
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].trim().split(',');
      if (c.length < head.length) continue;
      if (c[iConf] === 'l') continue;
      if (c[iType] !== '' && c[iType] !== '0') continue;
      ok.add(c[iDate] + ':' + Math.floor(+c[iLat] * 100) + ':' + Math.floor(+c[iLon] * 100));
    }
  }
  const q = packs.libya.n20;
  for (let i = 0; i < q.n; i++) assert.ok(ok.has(iso(q.day[i]) + ':' + q.a[i] + ':' + q.b[i]), `not in raw: ${iso(q.day[i])} ${q.a[i]} ${q.b[i]}`);
  assert.ok(q.n < ok.size, 'the masks removed nothing?');
});
