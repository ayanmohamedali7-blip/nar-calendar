// Experiment behind the choice of method: three ways to convert MODIS counts to VIIRS units,
// scored by leave-one-year-out validation on the overlap years.
//   A  single factor      V = k_c * M               (seasonal ratio)
//   B  baseline + slope   V = alpha_c + beta * M    (least squares; lowest error, but flattens the record)
//   Q  quantile mapping   V = F_V^-1( F_M(M) )      (used by the app: low error AND realistic spread)
// "spread" = standard deviation of the predictions / standard deviation of the observations (1 = realistic).
//   node pipeline/model-test.mjs libya
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePack, harmonize, fitRatio, fitQuantileMap, inBox, ERA } from '../site/js/harmonize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2] || 'libya';
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', 'index.json'), 'utf8'));
const meta = index.countries.find((c) => c.id === id);
const P = decodePack(JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', meta.file), 'utf8')));

// Model B, kept only for this comparison.
function fitB(V, X, N, skipYear) {
  const sv = new Float64Array(12);
  const sx = new Float64Array(12);
  const n = new Float64Array(12);
  const use = (m) => Math.floor(m / 12) + 2000 !== skipYear;
  for (let m = ERA.VIIRS_START; m < N; m++) if (use(m)) { sv[m % 12] += V[m]; sx[m % 12] += X[m]; n[m % 12]++; }
  let sxy = 0;
  let sxx = 0;
  for (let m = ERA.VIIRS_START; m < N; m++) if (use(m)) { const c = m % 12; sxy += (X[m] - sx[c] / n[c]) * (V[m] - sv[c] / n[c]); sxx += (X[m] - sx[c] / n[c]) ** 2; }
  const beta = Math.max(0, sxx > 0 ? sxy / sxx : 0);
  return { beta, alpha: Array.from({ length: 12 }, (_, c) => Math.max(0, sv[c] / n[c] - (beta * sx[c]) / n[c])) };
}

function stats(pairs) {
  const n = pairs.length;
  const mo = pairs.reduce((s, p) => s + p[0], 0) / n;
  const mp = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0, sae = 0, so = 0;
  for (const [o, p] of pairs) { sxy += (o - mo) * (p - mp); sxx += (o - mo) ** 2; syy += (p - mp) ** 2; sae += Math.abs(o - p); so += o; }
  return { r: sxy / Math.sqrt(sxx * syy), miss: sae / so, spread: Math.sqrt(syy / sxx) };
}
const show = (tag, y, m) => console.log(`  ${tag}  yearly: miss ${(100 * y.miss).toFixed(0)}%  r=${y.r.toFixed(2)}  spread=${y.spread.toFixed(2)}   | monthly: miss ${(100 * m.miss).toFixed(0)}%  r=${m.r.toFixed(2)}  spread=${m.spread.toFixed(2)}`);

for (const a of [{ name: 'Whole country', box: null }, ...meta.presets]) {
  const h = harmonize(P, a.box ? inBox(...a.box) : null); // outage-adjusted counts, as in the app
  const V = h.Va, M = h.Ma, N = h.N;
  const res = { A: [[], []], B: [[], []], Q: [[], []] };
  for (let y = 2012; (y - 2000) * 12 < N; y++) {
    const ratio = fitRatio(V, M, N, y);
    const b = fitB(V, M, N, y);
    const q = fitQuantileMap(V, M, N, y);
    const sum = { o: 0, A: 0, B: 0, Q: 0 };
    for (let c = 0; c < 12; c++) {
      const m = (y - 2000) * 12 + c;
      if (m < ERA.VIIRS_START) continue;
      const p = { A: ratio.k[c] * M[m], B: b.alpha[c] + b.beta * M[m], Q: q.map(M[m], c) };
      sum.o += V[m];
      for (const k of 'ABQ') { sum[k] += p[k]; res[k][1].push([V[m], p[k]]); }
    }
    for (const k of 'ABQ') res[k][0].push([sum.o, sum[k]]);
  }
  console.log(`\n${a.name}`);
  show('A single factor    ', stats(res.A[0]), stats(res.A[1]));
  show('B baseline + slope ', stats(res.B[0]), stats(res.B[1]));
  show('Q quantile mapping ', stats(res.Q[0]), stats(res.Q[1]));
}
