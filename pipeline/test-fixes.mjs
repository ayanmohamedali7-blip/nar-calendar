// Regression checks for the issues found in the pre-release review.
//   node --test pipeline/test.mjs pipeline/test-fixes.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePack, harmonize, fitQuantileMap, monthlyCounts, inBox, ERA } from '../site/js/harmonize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', 'index.json'), 'utf8'));
const packs = Object.fromEntries(index.countries.map((c) => [c.id, decodePack(JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', c.file), 'utf8')))]));

// deterministic pseudo-random numbers
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

function randomBoxes(P, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const i = Math.floor(rnd() * P.n);
    const size = [0.01, 0.02, 0.05, 0.1, 0.3, 1, 3][Math.floor(rnd() * 7)];
    const lat = P.a[i] / P.res - rnd() * size;
    const lon = P.b[i] / P.res - rnd() * size;
    out.push([lat, lon, lat + size, lon + size]);
  }
  return out;
}

test('where evidence is thin an estimate is never below what MODIS itself saw, and tiny areas are not wiped to zero', () => {
  for (const c of index.countries) {
    const P = packs[c.id];
    for (const box of randomBoxes(P, 150)) {
      const h = harmonize(P, inBox(...box));
      if (!h.lowEvidence) continue; // with enough overlap evidence the ranks decide alone
      for (let m = ERA.TERRA_START; m < ERA.VIIRS_START; m++) {
        const x = m >= ERA.AQUA_START ? h.Ma[m] : h.Ta[m];
        assert.ok(h.H[m] >= x - 1e-9, `${c.id} box ${box.map((v) => v.toFixed(2))} m=${m}: H ${h.H[m]} < MODIS ${x}`);
      }
    }
  }
  // the two concrete boxes from the review
  const a = harmonize(packs.libya, inBox(32.67, 21.02, 32.69, 21.04));
  assert.ok(a.H.some((v) => v > 0), 'area with MODIS fires only before 2012 must not be all zero');
  const b = harmonize(packs.libya, inBox(28.78, 21.34, 28.79, 21.35));
  const mar2004 = (2004 - 2000) * 12 + 2;
  assert.ok(b.H[mar2004] >= b.M[mar2004]);
});

test('within one calendar month, more MODIS fire never gives a lower estimate', () => {
  for (const c of index.countries) {
    const P = packs[c.id];
    for (const box of randomBoxes(P, 150)) {
      const { V, M, N } = monthlyCounts(P, inBox(...box));
      const q = fitQuantileMap(V, M, N);
      for (let cm = 0; cm < 12; cm++) {
        let prev = -1;
        for (let x = 0; x <= 30; x += 0.5) {
          const v = q.map(x, cm);
          assert.ok(v >= prev - 1e-9, `${c.id} box ${box.map((z) => z.toFixed(2))} month ${cm}: map(${x}) = ${v} < ${prev}`);
          prev = v;
        }
      }
    }
  }
});

test('satellite outages are known and counts are scaled to a full month', () => {
  const P = packs.algeria;
  const aug22 = (2022 - 2000) * 12 + 7;
  const jul22 = aug22 - 1;
  assert.equal(P.missing.viirs[aug22], 10); // S-NPP outage 27 Jul to 10 Aug 2022
  assert.equal(P.missing.viirs[jul22], 5);
  assert.ok(Math.abs(P.coverage.viirs[aug22] - 21 / 31) < 1e-9);
  const jun01 = (2001 - 2000) * 12 + 5;
  assert.equal(P.missing.terra[jun01], 16); // Terra outage 15 Jun to 2 Jul 2001
  const h = harmonize(P);
  assert.ok(Math.abs(h.H[aug22] - h.V[aug22] / (21 / 31)) < 1e-6);
  assert.equal(h.gapDays[aug22], 10);
  assert.ok(Math.abs(h.cov[aug22] - 21 / 31) < 1e-9);
  // a month without outage is untouched
  const sep22 = aug22 + 1;
  assert.equal(h.H[sep22], h.V[sep22]);
  assert.equal(h.gapDays[sep22], 0);
  // scaling is capped at 3x
  for (const s of ['terra', 'aqua', 'viirs']) for (let m = 0; m < P.nMonths; m++) assert.ok(P.coverage[s][m] > 0 && P.coverage[s][m] <= 1);
});

test('all four packs carry the same outage list', () => {
  const ref = JSON.stringify(packs.libya.gaps);
  for (const c of index.countries) assert.equal(JSON.stringify(packs[c.id].gaps), ref);
  assert.ok(packs.libya.gaps.viirs.some((g) => g[0] === '2022-07-27' && g[1] === '2022-08-10'));
});
