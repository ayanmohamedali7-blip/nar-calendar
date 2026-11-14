// MODIS + VIIRS harmonization core. Pure functions, no DOM: used by the web app and by
// the Node validation script (pipeline/validate.mjs).
//
// Unit: "burning cell-day" = one 0.01 deg grid cell with at least one fire detection on one day.
// Target unit of the harmonized series: VIIRS-equivalent burning cell-days per month.

export const FLAG = { TERRA: 1, AQUA: 2, VIIRS: 4, NIGHT: 8 };
const DAY_MS = 86400000;
const EPOCH = Date.UTC(2000, 0, 1);

// First month (index from Jan 2000) in which each sensor gives a full month of fire data.
export const ERA = {
  TERRA_START: 10, // Nov 2000 (start of the MODIS/Terra active-fire archive)
  AQUA_START: 30, // Jul 2002 (Aqua fire data begins 4 Jul 2002)
  VIIRS_START: 145, // Feb 2012 (S-NPP VIIRS 375 m data begins 20 Jan 2012; January is partial)
};
export const PRIOR_STRENGTH = 20; // shrinkage weight of the ratio baseline, in MODIS cell-days
export const SEASON_PRIOR = 2; // shrinkage of the season weights, in months
export const MIN_COVERAGE = 1 / 3; // outage scaling never multiplies a count by more than 3
export const MIN_LOCAL_MODIS = 30; // with fewer MODIS cell-days in the overlap the mapping is flagged as weak

/** Decode a country pack (see pipeline/build-data.mjs) into typed arrays. */
export function decodePack(pack) {
  const n = pack.n;
  const day = new Int32Array(n);
  const a = Int32Array.from(pack.a);
  const b = Int32Array.from(pack.b);
  const f = Uint8Array.from(pack.f);
  const frp = Uint16Array.from(pack.frp);
  const mi = new Int16Array(n); // month index since Jan 2000
  let d = 0;
  for (let i = 0; i < n; i++) {
    d += pack.dd[i];
    day[i] = d;
    const t = new Date(EPOCH + d * DAY_MS);
    mi[i] = (t.getUTCFullYear() - 2000) * 12 + t.getUTCMonth();
  }
  const lastYear = Math.max(pack.years.modis[1], pack.years.viirs[1]);
  // The record ends with the last COMPLETE month. `through` is the last day covered by the data
  // (packs built from yearly archives only end on 31 December).
  let nMonths = (lastYear - 2000 + 1) * 12;
  if (pack.through) {
    const t = new Date(pack.through + 'T00:00:00Z');
    const next = new Date(t.getTime() + DAY_MS);
    const complete = next.getUTCDate() === 1; // `through` is the last day of its month
    nMonths = (t.getUTCFullYear() - 2000) * 12 + t.getUTCMonth() + (complete ? 1 : 0);
  }
  // Sensor outages (pipeline/find-gaps.mjs): share of the days of each month a sensor observed.
  const coverage = { terra: new Float64Array(nMonths).fill(1), aqua: new Float64Array(nMonths).fill(1), viirs: new Float64Array(nMonths).fill(1) };
  const missing = { terra: new Int16Array(nMonths), aqua: new Int16Array(nMonths), viirs: new Int16Array(nMonths) };
  for (const s of Object.keys(coverage)) {
    for (const [from, to] of (pack.gaps && pack.gaps[s]) || []) {
      for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += DAY_MS) {
        const dt = new Date(t);
        const m = (dt.getUTCFullYear() - 2000) * 12 + dt.getUTCMonth();
        if (m >= 0 && m < nMonths) missing[s][m]++;
      }
    }
    for (let m = 0; m < nMonths; m++) {
      const days = new Date(Date.UTC(2000 + Math.floor(m / 12), (m % 12) + 1, 0)).getUTCDate();
      coverage[s][m] = 1 - missing[s][m] / days;
    }
  }
  // first month built from near-real-time detections (no FIRMS type label yet)
  const prelimFrom = pack.preliminaryFrom ? (+pack.preliminaryFrom.slice(0, 4) - 2000) * 12 + (+pack.preliminaryFrom.slice(5, 7) - 1) : Infinity;
  return { ...pack, day, a, b, f, frp, mi, nMonths, lastYear, coverage, missing, prelimFrom };
}

export const dayToISO = (d) => new Date(EPOCH + d * DAY_MS).toISOString().slice(0, 10);

/** Monthly burning cell-day counts inside an area. `inside(lat, lon)` is a predicate (null = whole pack). */
export function monthlyCounts(P, inside) {
  const N = P.nMonths;
  const V = new Float64Array(N);
  const M = new Float64Array(N);
  const T = new Float64Array(N);
  const idx = [];
  const half = 0.5 / P.res;
  for (let i = 0; i < P.n; i++) {
    if (inside && !inside(P.a[i] / P.res + half, P.b[i] / P.res + half)) continue;
    idx.push(i);
    const m = P.mi[i];
    const f = P.f[i];
    if (f & FLAG.VIIRS) V[m]++;
    if (f & (FLAG.TERRA | FLAG.AQUA)) M[m]++;
    if (f & FLAG.TERRA) T[m]++;
  }
  return { V, M, T, idx, N };
}

const overlapMonth = (m, skipYear) => skipYear === null || Math.floor(m / 12) + 2000 !== skipYear;

/**
 * Calibration by QUANTILE MAPPING, fitted on the overlap period (both sensors flying).
 *
 * The monthly MODIS counts and the monthly VIIRS counts of the same months are each sorted.
 * A MODIS value is converted to the VIIRS value that holds the same rank: the 10th busiest
 * MODIS month becomes the 10th busiest VIIRS month. Tied MODIS values (many months are 0)
 * take the mean of the VIIRS values that share those ranks (for the lowest block this mean is
 * modulated by season, see below); values between two known points
 * are interpolated; values above the largest MODIS month are scaled proportionally.
 *
 * Why this and not a single factor: VIIRS (375 m) sees many small fires that MODIS (1 km)
 * never sees, so VIIRS/MODIS is not constant. Quantile mapping keeps what MODIS does know
 * (which months were busy, which were quiet) and gives the result the spread of real VIIRS data.
 * `skipYear` leaves one overlap year out (cross-validation).
 */
export function fitQuantileMap(V, X, N, skipYear = null) {
  const xs = [];
  const vs = [];
  for (let m = ERA.VIIRS_START; m < N; m++) {
    if (!overlapMonth(m, skipYear)) continue;
    xs.push(X[m]);
    vs.push(V[m]);
  }
  xs.sort((p, q) => p - q);
  vs.sort((p, q) => p - q);
  const table = []; // [MODIS value, VIIRS-equivalent value]
  for (let i = 0; i < xs.length; ) {
    let j = i;
    let sum = 0;
    while (j < xs.length && xs[j] === xs[i]) sum += vs[j++];
    table.push([xs[i], sum / (j - i)]);
    i = j;
  }
  // Season weights for the lowest block (usually "MODIS saw nothing"): a quiet MODIS month in the
  // fire season hides more small fires than a quiet MODIS month in winter. The weights average
  // to about 1 over that block, so the VIIRS distribution is preserved.
  const w = new Float64Array(12).fill(1);
  if (table.length) {
    const sum = new Float64Array(12);
    const cnt = new Float64Array(12);
    let S = 0;
    let C = 0;
    for (let m = ERA.VIIRS_START; m < N; m++) {
      if (!overlapMonth(m, skipYear) || X[m] > table[0][0]) continue;
      sum[m % 12] += V[m];
      cnt[m % 12]++;
      S += V[m];
      C++;
    }
    const mean = C ? S / C : 0;
    if (mean > 0) for (let c = 0; c < 12; c++) w[c] = (sum[c] + SEASON_PRIOR * mean) / (cnt[c] + SEASON_PRIOR) / mean;
  }
  // value of the lowest block in calendar month c; the season weight must not lift
  // "MODIS saw nothing" above the next level of the table
  const lowest = (c) => {
    const v = table[0][1] * (c === null ? 1 : w[c]);
    return table.length > 1 ? Math.min(v, table[1][1]) : v;
  };
  const lookup = (x) => {
    for (let i = 1; i < table.length; i++) {
      if (x <= table[i][0]) {
        const [x0, v0] = table[i - 1];
        const [x1, v1] = table[i];
        return v0 + ((v1 - v0) * (x - x0)) / (x1 - x0);
      }
    }
    const [xl, vl] = table[table.length - 1];
    return xl > 0 ? (vl * x) / xl : vl;
  };
  // Guards:
  //  - more MODIS fire never gives a lower estimate than "MODIS saw nothing" in the same month;
  //  - where the overlap holds too few MODIS fires to learn a mapping (tiny areas), the result is
  //    never below the MODIS count itself. With enough evidence the ranks decide alone, otherwise
  //    this floor would push the totals up.
  const weak = xs.reduce((sum, v) => sum + v, 0) < MIN_LOCAL_MODIS;
  const floor = (x) => (weak ? x : 0);
  const map = (x, c = null) => {
    if (!table.length) return x;
    if (x <= table[0][0]) return Math.max(floor(x), lowest(c));
    return Math.max(floor(x), lowest(c), lookup(x));
  };
  return { map, table, seasonWeights: w };
}

/** Baseline for comparison only: one VIIRS/MODIS factor per calendar month (shrunk ratio of sums). */
export function fitRatio(V, X, N, skipYear = null) {
  const sv = new Float64Array(12);
  const sx = new Float64Array(12);
  let SV = 0;
  let SX = 0;
  for (let m = ERA.VIIRS_START; m < N; m++) {
    if (!overlapMonth(m, skipYear)) continue;
    sv[m % 12] += V[m];
    sx[m % 12] += X[m];
    SV += V[m];
    SX += X[m];
  }
  const ratio = SX > 0 ? SV / SX : 0;
  const k = new Float64Array(12);
  for (let c = 0; c < 12; c++) k[c] = (sv[c] + PRIOR_STRENGTH * ratio) / (sx[c] + PRIOR_STRENGTH);
  return { k, ratio, SV, SX };
}

const quantile = (sorted, p) => {
  if (!sorted.length) return NaN;
  const x = p * (sorted.length - 1);
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
};

/** A conversion factor never turns a MODIS count into something smaller than itself. */
const ratioMap = (fit) => (x, c) => Math.max(x, fit.k[c] * x);

/**
 * Leave-one-year-out check of BOTH conversion methods: each overlap year is hidden in turn, the
 * methods are fitted on the other years and have to predict the hidden year's VIIRS counts from
 * MODIS alone.
 *   quantile = rank matching (fitQuantileMap)      ratio = one factor per calendar month (fitRatio)
 */
export function crossValidate(V, X, N) {
  const years = [];
  const resid = { quantile: [], ratio: [] }; // monthly observed - predicted
  const absY = { quantile: 0, ratio: 0 };
  const absM = { quantile: 0, ratio: 0 };
  let sumObs = 0;
  const firstYear = 2000 + Math.floor(ERA.VIIRS_START / 12);
  for (let y = firstYear; (y - 2000) * 12 < N; y++) {
    const q = fitQuantileMap(V, X, N, y);
    const r = ratioMap(fitRatio(V, X, N, y));
    let obs = 0;
    let raw = 0;
    const pred = { quantile: 0, ratio: 0 };
    for (let c = 0; c < 12; c++) {
      const m = (y - 2000) * 12 + c;
      if (m >= N) break;
      if (m < ERA.VIIRS_START) continue; // partial first VIIRS month
      const p = { quantile: q.map(X[m], c), ratio: r(X[m], c) };
      obs += V[m];
      raw += X[m];
      for (const k of ['quantile', 'ratio']) {
        pred[k] += p[k];
        resid[k].push(V[m] - p[k]);
        absM[k] += Math.abs(V[m] - p[k]);
      }
    }
    years.push({ year: y, observed: obs, quantile: pred.quantile, ratio: pred.ratio, modisRaw: raw });
    absY.quantile += Math.abs(obs - pred.quantile);
    absY.ratio += Math.abs(obs - pred.ratio);
    sumObs += obs;
  }
  const result = { years, n: years.length };
  for (const k of ['quantile', 'ratio']) {
    resid[k].sort((p, q) => p - q);
    const rel = years.filter((r) => r[k] > 0).map((r) => r.observed / r[k]).sort((p, q) => p - q);
    result[k] = {
      yearlyError: sumObs > 0 ? absY[k] / sumObs : NaN, // weighted absolute % error of yearly totals
      monthlyError: sumObs > 0 ? absM[k] / sumObs : NaN,
      monthBand: [quantile(resid[k], 0.1), quantile(resid[k], 0.9)], // additive 80 % band for one month
      yearBand: [quantile(rel, 0.1), quantile(rel, 0.9)], // multiplicative 80 % band for one year
    };
  }
  return result;
}

/**
 * Build the harmonized monthly series for an area, in VIIRS-equivalent burning cell-days.
 *   Feb 2012 ->        : VIIRS as observed
 *   Jul 2002 - Jan 2012: MODIS Terra+Aqua, converted to VIIRS units
 *   Nov 2000 - Jun 2002: MODIS Terra alone (Aqua not yet launched), with its own conversion
 *
 * METHOD SELECTION. No single conversion is best everywhere. Where MODIS misses most fires (small
 * farm fires, North Africa) rank matching wins clearly; where large forest fires dominate
 * (Iberia, Turkey) plain monthly factors are sometimes better. So both are cross-validated on
 * the area itself and the one that predicts the hidden years best is used. Rank matching is the
 * default: the factors need a clear lead (one percentage point) and enough MODIS fires.
 */
export function harmonize(P, inside = null) {
  const c = monthlyCounts(P, inside);
  const { N } = c;
  // Sensor outages: a month in which a satellite was down for some days would look quieter than
  // it was. Counts are scaled to a full month by the share of days observed (at most 3x).
  // V, M, T stay the raw counts; Va, Ma, Ta are the outage-adjusted ones used below.
  const cov = new Float64Array(N).fill(1); // coverage of the sensor(s) behind H
  const gapDays = new Int16Array(N);
  const Va = new Float64Array(N);
  const Ma = new Float64Array(N);
  const Ta = new Float64Array(N);
  const cv_ = P.coverage;
  for (let m = 0; m < N; m++) {
    const cV = cv_ ? cv_.viirs[m] : 1;
    const cT = cv_ ? cv_.terra[m] : 1;
    const cM = cv_ ? (m >= ERA.AQUA_START ? (cv_.terra[m] + cv_.aqua[m]) / 2 : cv_.terra[m]) : 1;
    Va[m] = c.V[m] / Math.max(cV, MIN_COVERAGE);
    Ma[m] = c.M[m] / Math.max(cM, MIN_COVERAGE);
    Ta[m] = c.T[m] / Math.max(cT, MIN_COVERAGE);
    cov[m] = m >= ERA.VIIRS_START ? cV : m >= ERA.AQUA_START ? cM : cT;
    if (P.missing) gapDays[m] = m >= ERA.VIIRS_START ? P.missing.viirs[m] : m >= ERA.AQUA_START ? Math.max(P.missing.terra[m], P.missing.aqua[m]) : P.missing.terra[m];
  }
  const V = Va;
  const M = Ma;
  const T = Ta;
  const qm = fitQuantileMap(V, M, N);
  const qt = fitQuantileMap(V, T, N);
  const overlap = fitRatio(V, M, N);
  const overlapT = fitRatio(V, T, N);
  const cvBoth = crossValidate(V, M, N);
  const cvTBoth = crossValidate(V, T, N);
  // too few MODIS fires in the overlap = the conversion rests on very little evidence
  const lowEvidence = !(overlap.SX >= MIN_LOCAL_MODIS);
  const eq = cvBoth.quantile.yearlyError;
  const er = cvBoth.ratio.yearlyError;
  const method = !lowEvidence && Number.isFinite(er) && Number.isFinite(eq) && er < eq - 0.01 ? 'ratio' : 'quantile';
  const other = method === 'ratio' ? 'quantile' : 'ratio';
  const convM = method === 'ratio' ? ratioMap(overlap) : qm.map;
  const convT = method === 'ratio' ? ratioMap(overlapT) : qt.map;
  // the app reads the chosen method's numbers from cv.*; the other method is kept for comparison
  const cv = { ...cvBoth[method], n: cvBoth.n, method, otherError: cvBoth[other].yearlyError,
    years: cvBoth.years.map((y) => ({ year: y.year, observed: y.observed, predicted: y[method], otherPredicted: y[other], modisRaw: y.modisRaw })) };
  const cvT = cvTBoth[method];
  const H = new Float64Array(N).fill(NaN);
  const lo = new Float64Array(N).fill(NaN);
  const hi = new Float64Array(N).fill(NaN);
  const src = new Array(N).fill('none');
  const band = (m, v, bd) => {
    lo[m] = Math.max(0, v + (Number.isFinite(bd[0]) ? bd[0] : 0));
    hi[m] = Math.max(v, v + (Number.isFinite(bd[1]) ? bd[1] : 0));
  };
  for (let m = ERA.TERRA_START; m < N; m++) {
    if (m >= ERA.VIIRS_START) {
      H[m] = V[m];
      lo[m] = hi[m] = V[m];
      src[m] = 'VIIRS';
    } else if (m >= ERA.AQUA_START) {
      H[m] = convM(M[m], m % 12);
      band(m, H[m], cv.monthBand);
      src[m] = 'MODIS';
    } else {
      H[m] = convT(T[m], m % 12);
      band(m, H[m], cvT.monthBand);
      src[m] = 'Terra';
    }
  }
  return { ...c, Va, Ma, Ta, cov, gapDays, prelimFrom: P.prelimFrom ?? Infinity, H, lo, hi, src, qm, qt, overlap, method, cv, cvT, cvBoth, lowEvidence };
}

/** Per calendar month: median and quartiles of the harmonized series. */
export function climatology(H, N) {
  const med = new Float64Array(12);
  const q1 = new Float64Array(12);
  const q3 = new Float64Array(12);
  const count = new Int32Array(12);
  for (let c = 0; c < 12; c++) {
    const z = [];
    for (let m = c; m < N; m += 12) if (Number.isFinite(H[m])) z.push(H[m]);
    z.sort((p, q) => p - q);
    count[c] = z.length;
    med[c] = quantile(z, 0.5);
    q1[c] = quantile(z, 0.25);
    q3[c] = quantile(z, 0.75);
  }
  return { med, q1, q3, count };
}

/** Rank of one month against the same calendar month in all other years (0..1). */
export function percentileOf(H, m) {
  let below = 0;
  let n = 0;
  for (let j = m % 12; j < H.length; j += 12) {
    if (j === m || !Number.isFinite(H[j])) continue;
    n++;
    if (H[j] < H[m]) below++;
    else if (H[j] === H[m]) below += 0.5;
  }
  return n ? below / n : NaN;
}

/**
 * Trend of a yearly series: Theil-Sen slope (median of all pairwise slopes, robust to single
 * extreme years) and the Mann-Kendall test with tie correction (is the direction more than chance?).
 */
export function trend(values) {
  const n = values.length;
  if (n < 8) return null;
  const slopes = [];
  let S = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      slopes.push((values[j] - values[i]) / (j - i));
      S += Math.sign(values[j] - values[i]);
    }
  }
  slopes.sort((p, q) => p - q);
  const slope = quantile(slopes, 0.5);
  const ties = new Map();
  for (const v of values) ties.set(v, (ties.get(v) || 0) + 1);
  let varS = (n * (n - 1) * (2 * n + 5)) / 18;
  for (const t of ties.values()) if (t > 1) varS -= (t * (t - 1) * (2 * t + 5)) / 18;
  const z = varS > 0 ? (S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0) : 0;
  // two-sided p-value from the normal distribution (Abramowitz-Stegun 7.1.26)
  const x = Math.abs(z) / Math.SQRT2;
  const k = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * k - 1.453152027) * k + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k) * Math.exp(-x * x);
  const p = 1 - erf;
  const med = quantile([...values].sort((p1, q1) => p1 - q1), 0.5);
  return { n, slope, perDecade: med > 0 ? (slope * 10) / med : NaN, p, z };
}

// ---- geometry helpers ----
export const inBox = (s, w, n, e) => (lat, lon) => lat >= s && lat <= n && lon >= w && lon <= e;

/** ring: [[lat, lon], ...] */
export function inPolygon(ring) {
  let s = 90;
  let n = -90;
  let w = 180;
  let e = -180;
  for (const [la, lo] of ring) {
    s = Math.min(s, la);
    n = Math.max(n, la);
    w = Math.min(w, lo);
    e = Math.max(e, lo);
  }
  return (lat, lon) => {
    if (lat < s || lat > n || lon < w || lon > e) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i];
      const [yj, xj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}
