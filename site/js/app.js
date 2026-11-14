// Nar Calendar: application wiring (state, summary cards, tables, downloads).
import { decodePack, harmonize, climatology, percentileOf, trend, inBox, inPolygon, dayToISO, ERA, FLAG } from './harmonize.js';
import { createMap, sensorNames } from './map.js';
import { renderCalendar, renderRecords, renderSeason, renderValidation, renderFunnel, rankPhrase, MONTHS, MONTHS_LONG, fmt, esc } from './charts.js';

const $ = (id) => document.getElementById(id);
const state = { index: null, country: null, P: null, countryFit: null, area: null, res: null, range: [2000, 2100], D: null, selMonth: -1, calMode: 'activity' };
let mapApi;
let lastHash = '';

// ---------------------------------------------------------------- derived numbers
// `range` = [first year, last year] chosen by the user: every statistic (normal, ranks, trend,
// tables, downloads) is computed inside it. The MODIS-to-VIIRS mapping itself always uses the
// whole overlap period.
function derive(P, res, range) {
  const { lo, hi, V, M, N, src, cv } = res;
  const [y0, y1] = range;
  const inRange = (m) => { const y = 2000 + Math.floor(m / 12); return y >= y0 && y <= y1; };
  const H = Float64Array.from(res.H, (v, m) => (inRange(m) ? v : NaN));
  const clim = climatology(H, N);
  const pct = new Float64Array(N).fill(NaN);
  const rankAbove = new Int16Array(N);
  const rankTie = new Uint8Array(N); // another year has exactly the same value
  const finite = [];
  for (let m = 0; m < N; m++) {
    if (!Number.isFinite(H[m])) continue;
    finite.push(H[m]);
    pct[m] = percentileOf(H, m);
    for (let j = m % 12; j < N; j += 12) {
      if (j === m || !Number.isFinite(H[j])) continue;
      if (H[j] > H[m]) rankAbove[m]++;
      else if (H[j] === H[m]) rankTie[m] = 1;
    }
  }
  finite.sort((p, q) => p - q);
  const vmax = Math.max(3, finite[Math.floor(0.98 * (finite.length - 1))] || 0);
  const yb = cv.yearBand.every(Number.isFinite) ? cv.yearBand : [1, 1];
  const years = [];
  for (let y = Math.max(2000, y0); y <= Math.min(P.lastYear, y1); y++) {
    const Y = { year: y, total: 0, modelled: 0, months: 0, modis: 0, viirs: 0 };
    for (let c = 0; c < 12; c++) {
      const m = (y - 2000) * 12 + c;
      if (!Number.isFinite(H[m])) continue;
      Y.months++;
      Y.total += H[m];
      Y.modis += M[m];
      Y.viirs += V[m];
      if (src[m] !== 'VIIRS') Y.modelled += H[m];
    }
    Y.observed = Y.modelled < 0.5 * Y.total || Y.total === 0 ? y >= 2012 : false;
    Y.lo = Y.total - Y.modelled + Y.modelled * Math.min(1, yb[0]);
    Y.hi = Y.total - Y.modelled + Y.modelled * Math.max(1, yb[1]);
    years.push(Y);
  }
  const idx = res.idx.filter((i) => inRange(P.mi[i]));
  let lastM = -1;
  for (let m = N - 1; m >= 0 && lastM < 0; m--) if (Number.isFinite(H[m])) lastM = m;
  const firstM = H.findIndex(Number.isFinite);
  const full = years.filter((y) => y.months === 12);
  return { ...res, H, idx, clim, pct, rankAbove, rankTie, vmax, years, firstM, lastM, range: [Math.max(2000, y0), Math.min(P.lastYear, y1)], trend: trend(full.map((y) => y.total)), trendYears: full.length ? [full[0].year, full[full.length - 1].year] : null, total: finite.reduce((s, v) => s + v, 0) };
}

const cellDays = (v) => (fmt(v) === '1' ? 'burning cell-day' : 'burning cell-days');
const degLat = (v) => `${Math.abs(v)}° ${v < 0 ? 'S' : 'N'}`;
const degLon = (v) => `${Math.abs(v)}° ${v < 0 ? 'W' : 'E'}`;

function seasonText(med) {
  const max = Math.max(...med);
  if (!(max > 0)) return null;
  const peak = med.indexOf(max);
  const on = (c) => med[((c % 12) + 12) % 12] >= 0.5 * max;
  let a = peak;
  let b = peak;
  while (b - a < 11 && on(a - 1)) a--;
  while (b - a < 11 && on(b + 1)) b++;
  const name = (c) => MONTHS_LONG[((c % 12) + 12) % 12];
  return { peak: MONTHS_LONG[peak], range: b - a >= 11 ? 'All year' : a === b ? name(a) : `${name(a)} to ${name(b)}` };
}

// ---------------------------------------------------------------- rendering
function renderSummary() {
  const { D, area, P } = state;
  const box = area.type === 'box' ? area.box : null;
  const where = area.type === 'country' ? 'Whole country' : box ? `${degLat(box[0])} to ${degLat(box[2])}, ${degLon(box[1])} to ${degLon(box[3])}` : `Polygon with ${area.ring.length} corners`;
  let h = `<div><div class="area-name">${esc(area.name)}</div><div class="area-meta">${where} · ${D.idx.length.toLocaleString('en-US')} burning cell-days on record in ${esc(state.country.name)}</div></div>`;
  if (!D.idx.length) {
    const others = state.index.countries.filter((c) => c.id !== state.country.id).map((c) => c.name).join(', ');
    $('summary').innerHTML = h + `<div class="empty">No vegetation fire has been detected in this area since 2000 inside ${esc(state.country.name)}. This page counts one country at a time: if your area lies in ${esc(others)}, choose that country at the top. Otherwise try a larger area or one of the ready-made areas.</div>`;
    return;
  }
  const m = state.selMonth >= 0 ? state.selMonth : D.lastM;
  const c = m % 12;
  const v = D.H[m];
  const med = D.clim.med[c];
  const est = D.src[m] !== 'VIIRS';
  let badge;
  if (med > 0) {
    const d = Math.round((100 * (v - med)) / med);
    // less than one cell-day away from normal is not an anomaly, whatever the percentage
    badge = Math.abs(d) < 15 || Math.abs(v - med) < 1 ?'<span class="badge flat">● Close to normal</span>' : d > 0 ? `<span class="badge up">▲ ${d.toLocaleString('en-US')} % above normal</span>` : `<span class="badge down">▼ ${-d} % below normal</span>`;
  } else badge = v >= 1 ? '<span class="badge up">▲ Fire in a month that is normally quiet</span>' : '<span class="badge flat">● Quiet, as normal</span>';
  const rank = rankPhrase(D, m);
  const prelim = m >= D.prelimFrom ? ' Preliminary: this month comes from near-real-time data that FIRMS has not labelled yet, so a few gas flares may still be counted.' : '';
  const viaN20 = D.sat && D.sat[m] === 'NOAA-20';
  const gap = viaN20 ? ` Suomi NPP was out for ${P.missing.viirs[m]} days this month, so this month comes from the same instrument on NOAA-20, converted to the same unit.`
    : D.gapDays[m] > 0 && !est ? ` The satellite was out for ${D.gapDays[m]} days this month, so the count is scaled up to a full month.` : '';
  h += `<div class="stat"><div class="k">${state.selMonth >= 0 ? 'Selected month' : D.lastM === D.N - 1 ? 'Latest month on record' : 'Last month of your period'} · ${MONTHS_LONG[c]} ${2000 + Math.floor(m / 12)}</div>
    <div class="v">${fmt(v)} <small>${cellDays(v)}${est ? ' (estimated)' : ''}</small></div>
    <div class="d">${badge}</div>
    <div class="d">A normal ${MONTHS_LONG[c]} here has ${fmt(med)}.${rank ? ` This one is ${rank}.` : ''}${gap}${prelim}</div></div>`;
  const season = seasonText([...D.clim.med]);
  const full = D.years.filter((y) => y.months === 12);
  const top = [...full].sort((p, q) => q.total - p.total)[0];
  h += `<div class="stat-row"><div class="stat"><div class="k">Fire season</div><div class="v" style="font-size:19px">${season ? season.range : 'No clear season'}</div><div class="d">${season ? `Peak in ${season.peak}` : 'Fires are too rare here'}</div></div>
    <div class="stat"><div class="k">Most active year</div><div class="v" style="font-size:19px">${top.year}</div><div class="d">${fmt(top.total)} cell-days${top.observed ? '' : ' (estimated)'}</div></div></div>`;
  const e = D.cv.yearlyError;
  const er = D.cv.otherError;
  const names = { quantile: 'rank matching', ratio: 'monthly conversion factors' };
  if (D.overlap.SV < 30 || !Number.isFinite(e)) {
    // too few fires since 2012 to measure anything
    h += `<div class="stat"><div class="k">How reliable are the years before 2012?</div><div class="v" style="font-size:19px">Too few fires to measure</div>
      <div class="d">This area has only ${fmt(D.overlap.SV)} burning cell-days since 2012. Treat the years before 2012 as a rough guide, or draw a larger area.</div></div>`;
  } else {
    const otherName = names[D.cv.method === 'ratio' ? 'quantile' : 'ratio'];
    const base = ` Method used here: ${names[D.cv.method]}${!Number.isFinite(er) ? '' : `, because it predicted the hidden years best (${otherName}: ±${Math.round(100 * er)} %)`}.`;
    h += `<div class="stat"><div class="k">How reliable are the years before 2012?</div><div class="v">±${Math.round(100 * e)} % <small>typical miss of a yearly total</small></div>
      <div class="d">Measured by hiding each year of 2012 to ${P.lastYear} and predicting it from MODIS alone.${base}${D.lowEvidence ? ' MODIS saw very few fires here, so treat the years before 2012 as a rough guide only.' : ''}</div></div>`;
  }
  // The record after Suomi NPP: the same instrument on NOAA-20, tested against the years both flew.
  const B = D.bridge;
  if (B) {
    const filled = B.filled ? ` NOAA-20 already supplies ${B.filled === 1 ? 'the one month' : `the ${B.filled} months`} in which Suomi NPP was down for three days or more.` : '';
    let soFar = '';
    if (D.now && D.lastM === D.N - 1) {
      const d0 = +D.now.from.slice(8, 10);
      const d1 = +D.now.to.slice(8, 10);
      const mm = +D.now.to.slice(5, 7) - 1;
      soFar = ` ${d0} to ${d1} ${MONTHS_LONG[mm]} ${D.now.to.slice(0, 4)}, seen by NOAA-20 alone: ${fmt(D.now.noaa20)} ${cellDays(D.now.noaa20)} so far (a normal full ${MONTHS_LONG[mm]} has ${fmt(D.clim.med[mm])}).`;
    }
    const intro = 'Suomi NPP stopped delivering data on 2 November 2026. The same instrument flies on NOAA-20.';
    if (B.weak || !Number.isFinite(B.yearlyError)) {
      h += `<div class="stat"><div class="k">After Suomi NPP · the record continues on NOAA-20</div><div class="v" style="font-size:19px">Too few fires to test here</div>
        <div class="d">${intro} This area has too few fires since 2018 to measure how closely the two agree; draw a larger area to see the test.${soFar}</div></div>`;
    } else {
      h += `<div class="stat"><div class="k">After Suomi NPP · the record continues on NOAA-20</div><div class="v">±${Math.round(100 * B.yearlyError)} % <small>typical miss of a yearly total</small></div>
        <div class="d">${intro} Tested by hiding each year of 2018 to ${P.lastYear} and predicting what Suomi NPP counted from NOAA-20 alone.${filled}${soFar}</div></div>`;
    }
  }
  const T = D.trend;
  if (T) {
    // slope per year, in cell-days and as a share of a typical (median) year
    const py = Math.round(10 * T.perDecade);
    const clear = T.p < 0.05 && Math.abs(T.slope) > 0;
    const amount = `${fmt(Math.abs(T.slope))} cell-days per year${Number.isFinite(py) && py !== 0 ? ` (${Math.abs(py)} % of a typical year)` : ''}`;
    const word = !clear ? '● No clear trend' : T.slope > 0 ? `▲ Rising by ${amount}` : `▼ Falling by ${amount}`;
    h += `<div class="stat"><div class="k">Long-term trend · ${D.trendYears[0]} to ${D.trendYears[1]}</div><div class="v" style="font-size:19px">${word}</div>
      <div class="d">${clear ? 'The direction is unlikely to be chance' : 'Ups and downs, but no direction that stands out from chance'} (Mann-Kendall test, p ${T.p < 0.001 ? '< 0.001' : '= ' + T.p.toFixed(2)}; Theil-Sen slope over ${T.n} complete years).</div></div>`;
  }
  $('summary').innerHTML = h;
}

function renderTables() {
  const { D } = state;
  const rows = [];
  for (let m = 0; m < D.N; m++) if (Number.isFinite(D.H[m]) && D.H[m] > 0) rows.push(m);
  rows.sort((p, q) => D.H[q] - D.H[p]);
  let h = '<table><thead><tr><th>Month</th><th class="num">Activity</th><th class="num">Normal</th><th class="num">Times normal</th><th>Source</th></tr></thead><tbody>';
  for (const m of rows.slice(0, 10)) {
    const med = D.clim.med[m % 12];
    h += `<tr class="rowlink" data-m="${m}"><td>${MONTHS_LONG[m % 12]} ${2000 + Math.floor(m / 12)}</td><td class="num">${fmt(D.H[m])}</td><td class="num">${fmt(med)}</td><td class="num">${med > 0 ? (D.H[m] / med).toFixed(1) + '×' : 'n/a'}</td><td>${D.src[m] === 'VIIRS' ? (D.sat && D.sat[m] === 'NOAA-20' ? 'VIIRS on NOAA-20' : 'VIIRS observed') : 'MODIS, converted'}</td></tr>`;
  }
  $('table-months').innerHTML = rows.length ? h + '</tbody></table><p class="note" style="margin-top:8px">Click a row to see that month on the map.</p>' : '<p class="sub">No fire months in this area.</p>';
}

function renderAll() {
  const { D, P, area } = state;
  renderSummary();
  const has = D.idx.length > 0;
  for (const id of ['calendar-card', 'ai-card']) $(id).style.display = has ? '' : 'none';
  resetAI();
  document.querySelectorAll('main > .grid2').forEach((el) => { el.style.display = has ? '' : 'none'; });
  if (!has) return;
  const ml = (m) => `${MONTHS_LONG[m % 12]} ${2000 + Math.floor(m / 12)}`;
  $('cal-sub').textContent = `${area.name}: fire activity for every month from ${ml(D.firstM)} to ${ml(D.lastM)}, in one unit. Hover a month for details, click it to see its fires on the map.`;
  renderCalendar($('calendar'), D, { mode: state.calMode, selMonth: state.selMonth });
  $('year-sub').textContent = 'MODIS alone under-counts small fires and VIIRS only starts in 2012. The harmonized record joins both in VIIRS units.';
  renderRecords($('chart-years'), D);
  const year = 2000 + Math.floor((state.selMonth >= 0 ? state.selMonth : D.lastM) / 12);
  $('season-sub').textContent = `When fire normally happens here, and how ${year} compared. Click any month in the calendar to change the year.`;
  renderSeason($('chart-season'), D, year);
  const e = D.cv.yearlyError;
  $('valid-sub').textContent = `Each year from 2012 to ${P.lastYear} was hidden, then predicted from MODIS alone. The closer the dots sit to the bar tops, the more the older years can be trusted${Number.isFinite(e) ? ` (typical miss ±${Math.round(100 * e)} %)` : ''}.`;
  renderValidation($('chart-valid'), D);
  renderTables();
}

function renderFunnelCard() {
  const P = state.P;
  const t = { raw: 0, type0: 0, conf: 0, mask: 0, kept: 0 };
  for (const y of Object.values(P.funnel)) for (const s of Object.values(y)) for (const k in t) t[k] += s[k];
  const share = ((100 * t.kept) / t.raw).toFixed(1);
  $('funnel-sub').textContent = `${P.country}, both sensors, 2000 to ${P.lastYear}: ${share} % of ${t.raw.toLocaleString('en-US')} satellite hot spots pass our fire filters. The rest are static heat sources such as gas flares and industry, and low-confidence detections. Tick "Show removed gas flares" above the map to see them.`;
  renderFunnel($('chart-funnel'), [
    { label: 'All satellite hot spots', value: t.raw, help: 'Every MODIS and VIIRS detection in the FIRMS archive.' },
    { label: 'Not labelled as static', value: t.type0, help: 'FIRMS type 0 (presumed vegetation fire). Types 1 to 3 are volcanoes, static land sources and offshore sources. The newest months have no label yet and pass this step.' },
    { label: 'Confident detections', value: t.conf, help: 'Low-confidence detections removed (MODIS under 30 %, VIIRS "low").' },
    { label: 'Away from flares and industry', value: t.mask, help: 'Removed: detections within 2 to 3 km of a cell that FIRMS ever flagged as a static source.' },
    { label: 'Not hot all year: real fires', value: t.kept, help: 'Removed: places with heat on 15 or more days spread over 8 or more calendar months.' },
  ]);
}

// ---------------------------------------------------------------- area + state
function setArea(area, { fit = true, keepMonth = false } = {}) {
  const P = state.P;
  const inside = area.type === 'box' ? inBox(...area.box) : area.type === 'poly' ? inPolygon(area.ring) : null;
  state.area = area;
  if (!keepMonth) state.selMonth = -1;
  state.res = inside ? harmonize(P, inside) : state.countryFit;
  state.D = derive(P, state.res, state.range);
  mapApi.setArea(area, state.D.idx, fit);
  mapApi.setMonth(state.selMonth);
  const preset = $('preset');
  preset.value = area.presetId || (area.type === 'country' ? '__country' : '__custom');
  if (area.type === 'box') for (const [k, i] of [['s', 0], ['w', 1], ['n', 2], ['e', 3]]) $('coords').elements[k].value = area.box[i];
  renderAll();
  renderLegend();
  writeHash();
}

function setRange(y0, y1) {
  if (y0 > y1) [y0, y1] = [y1, y0];
  state.range = [y0, y1];
  $('y0').value = y0;
  $('y1').value = y1;
  const sy = 2000 + Math.floor(state.selMonth / 12);
  if (state.selMonth >= 0 && (sy < y0 || sy > y1)) state.selMonth = -1;
  state.D = derive(state.P, state.res, state.range);
  mapApi.setArea(state.area, state.D.idx, false);
  mapApi.setMonth(state.selMonth);
  renderAll();
  renderLegend();
  writeHash();
}

function selectMonth(m) {
  state.selMonth = m === state.selMonth ? -1 : m;
  mapApi.setMonth(state.selMonth);
  renderAll();
  renderLegend();
  writeHash();
}

function renderLegend() {
  const m = state.selMonth;
  $('map-legend').innerHTML = `<span><i style="background:#ff7a1a"></i>Fires in your area, ${state.D.range[0]} to ${state.D.range[1]}</span><span><i style="background:rgba(240,138,60,.4)"></i>Fires elsewhere</span>`
    + (m >= 0 ? `<span><i style="background:#fff3b0;border:1px solid #7a2a00"></i>${MONTHS[m % 12]} ${2000 + Math.floor(m / 12)}</span>` : '')
    + ($('chk-static').checked ? '<span><i style="background:#60c4ff"></i>Removed: gas flares, industry</span>' : '');
}

function writeHash() {
  const a = state.area;
  const parts = [`c=${state.country.id}`];
  if (a.presetId) parts.push(`area=${a.presetId}`);
  else if (a.type === 'box') parts.push(`box=${a.box.join(',')}`);
  else if (a.type === 'poly') parts.push(`poly=${a.ring.map((p) => p.join(',')).join(';')}`);
  if (state.D.range[0] > 2000 || state.D.range[1] < state.P.lastYear) parts.push(`y=${state.D.range[0]}-${state.D.range[1]}`);
  if (state.selMonth >= 0) parts.push(`m=${2000 + Math.floor(state.selMonth / 12)}-${String((state.selMonth % 12) + 1).padStart(2, '0')}`);
  lastHash = '#' + parts.join('&');
  history.replaceState(null, '', lastHash);
}

/** Is this hash one of ours (as opposed to an in-page anchor such as #method)? */
const isStateHash = (h) => /^#(c|box|poly|area|m)=/.test(h);

function readHash() {
  let raw = location.hash.slice(1);
  try { raw = decodeURIComponent(raw); } catch { /* keep the raw text */ }
  const q = Object.fromEntries(raw.split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)]; }));
  const out = { country: q.c, month: -1, area: null };
  // strict numbers only: "" and "abc" are rejected, coordinates must be on the globe
  const num = (s) => s.split(',').map((t) => (/^-?\d+(\.\d+)?$/.test(t.trim()) ? Number(t) : NaN));
  const okLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
  const okLon = (v) => Number.isFinite(v) && v >= -180 && v <= 180;
  if (q.box) {
    const b = num(q.box);
    if (b.length === 4 && okLat(b[0]) && okLat(b[2]) && okLon(b[1]) && okLon(b[3]) && b[2] > b[0] && b[3] > b[1]) out.area = { type: 'box', box: b, name: 'Custom rectangle' };
  }
  if (q.poly) {
    const ring = q.poly.split(';').map(num);
    if (ring.length >= 3 && ring.length <= 200 && ring.every((p) => p.length === 2 && okLat(p[0]) && okLon(p[1]))) out.area = { type: 'poly', ring, name: 'Custom polygon' };
  }
  if (q.area) out.presetId = q.area;
  if (q.y && /^(20\d\d)-(20\d\d)$/.test(q.y)) out.range = q.y.split('-').map(Number).sort((p, r) => p - r);
  if (q.m && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.m)) out.month = (+q.m.slice(0, 4) - 2000) * 12 + (+q.m.slice(5) - 1);
  return out;
}

const presetArea = (p) => ({ type: 'box', box: p.box, name: p.name, presetId: p.id });

async function loadCountry(id, initial = {}) {
  const meta = state.index.countries.find((c) => c.id === id) || state.index.countries[0];
  let pack;
  try {
    const res = await fetch(`data/${meta.file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pack = await res.json();
  } catch (err) {
    console.error(err);
    if (state.country) $('country').value = state.country.id; // stay on the country that is loaded
    $('dl-note').textContent = `The data for ${meta.name} could not be loaded. Check your connection and try again.`;
    if (!state.country) throw err;
    return;
  }
  state.country = meta;
  $('country').value = meta.id;
  state.selMonth = -1;
  state.P = decodePack(pack);
  state.countryFit = harmonize(state.P);
  const ys = [];
  for (let y = 2000; y <= state.P.lastYear; y++) ys.push(`<option value="${y}">${y}</option>`);
  $('y0').innerHTML = ys.join('');
  $('y1').innerHTML = ys.join('');
  const r = initial.range && initial.range[0] <= state.P.lastYear ? [Math.max(2000, initial.range[0]), Math.min(state.P.lastYear, initial.range[1])] : [2000, state.P.lastYear];
  state.range = r;
  $('y0').value = r[0];
  $('y1').value = r[1];
  mapApi.setPack(state.P, meta.places);
  const preset = $('preset');
  preset.innerHTML = meta.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
    + `<option value="__country">Whole country: ${esc(meta.name)}</option><option value="__custom" hidden>Custom area</option>`;
  renderFunnelCard();
  let area = initial.area;
  if (!area) {
    const p = meta.presets.find((x) => x.id === initial.presetId) || (initial.presetId === '__country' ? null : meta.presets[0]);
    area = p ? presetArea(p) : { type: 'country', name: meta.name, presetId: '__country' };
  }
  if (initial.month >= ERA.TERRA_START && initial.month < state.P.nMonths && 2000 + Math.floor(initial.month / 12) >= state.range[0] && 2000 + Math.floor(initial.month / 12) <= state.range[1]) state.selMonth = initial.month;
  setArea(area, { keepMonth: true });
  renderLegend();
}

// ---------------------------------------------------------------- AI analyst
// The model (worker/index.js -> Cloudflare Workers AI) only words the numbers below. If it is
// not reachable, the same facts are turned into a plain automatic summary, so the card always
// answers.
const ai = { lang: 'en', busy: false };

function buildFacts() {
  const { D, P, area, country } = state;
  const label = (m) => `${MONTHS_LONG[m % 12]} ${2000 + Math.floor(m / 12)}`;
  // whole numbers for the model: a count like 365.33 reads badly in a briefing
  const whole = (v) => (Number.isFinite(v) ? Math.round(v) : v);
  const monthFacts = (m) => ({ month: label(m), cellDays: whole(D.H[m]), normalForThatMonth: whole(D.clim.med[m % 12]), rankFromTop: 1 + D.rankAbove[m], yearsCompared: D.clim.count[m % 12], estimatedFromMODIS: D.src[m] !== 'VIIRS', satelliteOutageDays: D.gapDays[m] });
  const full = D.years.filter((y) => y.months === 12);
  const byTotal = [...full].sort((p, q) => q.total - p.total);
  const months = [];
  for (let m = 0; m < D.N; m++) if (Number.isFinite(D.H[m]) && D.H[m] > 0) months.push(m);
  months.sort((p, q) => D.H[q] - D.H[p]);
  const season = seasonText([...D.clim.med]);
  const t = { raw: 0, kept: 0 };
  for (const y of Object.values(P.funnel)) for (const s of Object.values(y)) { t.raw += s.raw; t.kept += s.kept; }
  const T = D.trend;
  return {
    area: area.name,
    country: country.name,
    years: `${D.range[0]} to ${D.range[1]}`,
    unit: 'burning cell-days (one 1 km cell with fire on one day)',
    latestMonth: monthFacts(D.lastM),
    selectedMonth: state.selMonth >= 0 ? monthFacts(state.selMonth) : null,
    fireSeason: season ? { months: season.range, peak: season.peak } : null,
    normalByMonth: Object.fromEntries(MONTHS.map((n, c) => [n, whole(D.clim.med[c])])),
    mostActiveYears: byTotal.slice(0, 3).map((y) => ({ year: y.year, cellDays: whole(y.total), estimatedFromMODIS: !y.observed })),
    quietestYear: byTotal.length ? { year: byTotal[byTotal.length - 1].year, cellDays: whole(byTotal[byTotal.length - 1].total) } : null,
    mostActiveMonths: months.slice(0, 5).map((m) => ({ month: label(m), cellDays: whole(D.H[m]) })),
    yearlyTotals: Object.fromEntries(full.map((y) => ['y' + y.year, whole(y.total)])),
    trend: T ? { direction: T.p < 0.05 ? (T.slope > 0 ? 'rising' : 'falling') : 'no clear trend', cellDaysPerYear: Math.round(T.slope), pValue: Math.round(T.p * 1000) / 1000, completeYears: T.n } : null,
    reliabilityOfYearsBefore2012: Number.isFinite(D.cv.yearlyError) && D.overlap.SV >= 30 ? { typicalMissOfAYearlyTotalPercent: Math.round(100 * D.cv.yearlyError), method: D.cv.method === 'ratio' ? 'monthly conversion factors' : 'rank matching' } : 'too few fires to measure',
    shareOfCountryHotSpotsRemovedAsNotFirePercent: t.raw ? Math.round(1000 * (1 - t.kept / t.raw)) / 10 : null,
    preliminary: D.lastM >= D.prelimFrom,
    continuationOnNOAA20: D.bridge ? {
      why: 'Suomi NPP stopped delivering data on 2 November 2026; NOAA-20 carries the same instrument',
      typicalMissOfAYearlyTotalPercent: D.bridge.weak || !Number.isFinite(D.bridge.yearlyError) ? 'too few fires to measure' : Math.round(100 * D.bridge.yearlyError),
      testedOnYears: `2018 to ${P.lastYear}`,
      monthsTakenFromNOAA20DuringSuomiNPPOutages: D.bridge.filled,
      monthInProgress: D.now && D.lastM === D.N - 1 ? { days: `${D.now.from} to ${D.now.to}`, cellDaysSoFarSeenByNOAA20: D.now.noaa20 } : null,
    } : null,
  };
}

/** Plain summary made by code alone: shown when the AI model cannot be reached. */
function automaticSummary(f, lang) {
  const n = (v) => fmt(v);
  const L = f.latestMonth;
  const cmp = L.normalForThatMonth > 0 ? Math.round((100 * (L.cellDays - L.normalForThatMonth)) / L.normalForThatMonth) : null;
  const top = f.mostActiveYears[0];
  if (lang === 'ar') {
    return [
      `المنطقة: ${f.area}، ${f.country}، السنوات ${f.years}.`,
      f.fireSeason ? `موسم الحرائق المعتاد: ${f.fireSeason.months}، والذروة في ${f.fireSeason.peak}.` : 'الحرائق نادرة هنا ولا يظهر موسم واضح.',
      `آخر شهر (${L.month}): ${n(L.cellDays)} خلية-يوم محترقة، والمعتاد لهذا الشهر ${n(L.normalForThatMonth)}${cmp === null ? '' : cmp > 15 ? ` (أعلى من المعتاد بـ ${cmp}%)` : cmp < -15 ? ` (أقل من المعتاد بـ ${-cmp}%)` : ' (قريب من المعتاد)'}.`,
      top ? `أكثر سنة نشاطا: ${top.year} بـ ${n(top.cellDays)} خلية-يوم${top.estimatedFromMODIS ? ' (تقدير من القمر القديم)' : ''}.` : '',
      f.trend ? (f.trend.direction === 'no clear trend' ? 'لا يوجد اتجاه واضح على المدى الطويل.' : `الاتجاه على المدى الطويل: ${f.trend.direction === 'rising' ? 'في ارتفاع' : 'في انخفاض'}.`) : '',
      typeof f.reliabilityOfYearsBefore2012 === 'object' ? `دقة السنوات قبل 2012: الخطأ المعتاد في المجموع السنوي حوالي ${f.reliabilityOfYearsBefore2012.typicalMissOfAYearlyTotalPercent}%.` : '',
    ].filter(Boolean).join(' ');
  }
  return [
    `${f.area}, ${f.country}, ${f.years}.`,
    f.fireSeason ? `The usual fire season runs ${f.fireSeason.months}, with a peak in ${f.fireSeason.peak}.` : 'Fires are rare here and no clear season shows.',
    `The latest month (${L.month}) had ${n(L.cellDays)} burning cell-days; a normal one has ${n(L.normalForThatMonth)}${cmp === null ? '' : cmp > 15 ? ` (${cmp} % above normal)` : cmp < -15 ? ` (${-cmp} % below normal)` : ' (close to normal)'}.`,
    top ? `The most active year was ${top.year} with ${n(top.cellDays)} cell-days${top.estimatedFromMODIS ? ' (estimated from MODIS)' : ''}.` : '',
    f.trend ? (f.trend.direction === 'no clear trend' ? 'There is no clear long-term trend.' : `The long-term trend is ${f.trend.direction}.`) : '',
    typeof f.reliabilityOfYearsBefore2012 === 'object' ? `Years before 2012 are estimates with a typical miss of about ${f.reliabilityOfYearsBefore2012.typicalMissOfAYearlyTotalPercent} % for a yearly total.` : '',
  ].filter(Boolean).join(' ');
}

function resetAI() {
  const out = $('ai-out');
  if (!out || ai.busy) return;
  out.className = 'ai-out muted';
  out.textContent = ai.lang === 'ar' ? 'اضغط "Explain this area" للحصول على شرح مبسط لهذه المنطقة.' : 'Press "Explain this area" for a plain-language briefing of the selected area and years.';
}

async function askAI(question = '') {
  if (ai.busy || !state.D || !state.D.idx.length) return;
  ai.busy = true;
  const out = $('ai-out');
  const facts = buildFacts();
  $('ai-go').disabled = true;
  out.className = 'ai-out muted';
  out.textContent = ai.lang === 'ar' ? 'جاري التحليل…' : 'Reading the numbers…';
  let text = '';
  let source = '';
  try {
    const res = await fetch('api/brief', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: ai.lang, question, facts }) });
    const data = await res.json();
    if (res.ok && data.text) { text = data.text; source = ai.lang === 'ar' ? 'نص مولّد بالذكاء الاصطناعي من أرقام هذه الصفحة' : 'AI-generated from the numbers on this page'; }
  } catch { /* fall through to the automatic summary */ }
  if (!text) {
    text = automaticSummary(facts, ai.lang);
    source = ai.lang === 'ar' ? 'ملخص آلي (نموذج الذكاء الاصطناعي غير متاح الآن)' : 'Automatic summary (the AI model is not reachable right now)';
  }
  out.className = 'ai-out';
  out.textContent = text;
  const tag = document.createElement('span');
  tag.className = 'tagline';
  tag.textContent = `${source} · ${facts.area}, ${facts.years}`;
  out.appendChild(tag);
  $('ai-go').disabled = false;
  ai.busy = false;
}

function initAI() {
  document.querySelectorAll('#ai-card .seg button').forEach((b) => b.addEventListener('click', () => {
    ai.lang = b.dataset.lang;
    document.querySelectorAll('#ai-card .seg button').forEach((x) => x.classList.toggle('on', x === b));
    resetAI();
  }));
  $('ai-go').addEventListener('click', () => askAI());
  $('ai-ask').addEventListener('submit', (ev) => { ev.preventDefault(); const q = $('ai-q').value.trim(); if (q) askAI(q); });
}

// ---------------------------------------------------------------- downloads
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = () => `${state.country.id}_${state.area.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

function monthlyCsv() {
  const D = state.D;
  const r = (v) => (Number.isFinite(v) ? (Math.round(v * 100) / 100).toString() : '');
  const lines = ['year,month,harmonized_cell_days,likely_low,likely_high,source,modis_cell_days,viirs_cell_days,sensor_coverage,median_same_month,percentile_rank,noaa20_cell_days'];
  for (let m = 0; m < D.N; m++) {
    if (!Number.isFinite(D.H[m])) continue;
    const n20 = D.sat && D.sat[m] === 'NOAA-20';
    const src = D.src[m] === 'VIIRS' ? (n20 ? 'VIIRS_NOAA20_converted' : 'VIIRS_observed') + (m >= D.prelimFrom ? '_preliminary' : '') : D.src[m] === 'Terra' ? 'MODIS_Terra_converted' : 'MODIS_converted';
    lines.push([2000 + Math.floor(m / 12), (m % 12) + 1, r(D.H[m]), r(D.lo[m]), r(D.hi[m]), src, D.M[m], m >= 144 ? D.V[m] : '', r(D.cov[m]), r(D.clim.med[m % 12]), r(D.pct[m]), D.bridge && m >= ERA.NOAA20_START ? D.Nn[m] : ''].join(','));
  }
  return lines.join('\n') + '\n';
}
function cellsCsv() {
  const { P, D } = state;
  const half = 0.5 / P.res;
  const lines = ['date,lat_center,lon_center,sensors,night_detection,max_frp_mw'];
  for (const i of D.idx) lines.push([dayToISO(P.day[i]), (P.a[i] / P.res + half).toFixed(3), (P.b[i] / P.res + half).toFixed(3), sensorNames(P.f[i]), P.f[i] & FLAG.NIGHT ? 1 : 0, P.frp[i]].join(','));
  return lines.join('\n') + '\n';
}

/** The calendar as a PNG image (title, calendar, credit), ready for a report or a slide. */
function calendarPng() {
  const svg = document.querySelector('#calendar svg');
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const top = 64;
  const bottom = 46;
  const W = vb.width;
  const HT = vb.height + top + bottom;
  const D = state.D;
  const title = `${state.area.name}, ${state.country.name}: burning calendar ${D.range[0]} to ${D.range[1]}`;
  const what = state.calMode === 'anomaly' ? 'Colour: each month ranked against the same month of the other years (blue = fewer fires than normal, red = more)' : `Colour: harmonized burning cell-days per month (dark = none, bright = ${fmt(D.vmax)} or more)`;
  const css = 'text{font-family:Segoe UI,Arial,sans-serif;fill:#b6bcc6}.axis{fill:#808896;font-size:11.5px}.lbl{fill:#b6bcc6;font-size:12px}.val{fill:#eef0f2;font-size:12px}';
  const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${HT}" width="${W * 2}" height="${HT * 2}"><style>${css}</style><rect width="${W}" height="${HT}" fill="#171a1f"/>`
    + `<text x="18" y="30" style="font-size:19px;font-weight:600;fill:#eef0f2">${esc(title)}</text><text x="18" y="50" style="font-size:12px;fill:#b6bcc6">${esc(what)}</text>`
    + `<g transform="translate(0,${top})">${svg.innerHTML}</g>`
    + `<text x="18" y="${HT - 16}" style="font-size:11.5px;fill:#808896">Nar Calendar (nar.vorelq.com) · harmonized MODIS + VIIRS S-NPP active fires · data: NASA FIRMS · blue bars = estimated from MODIS, orange bars = observed by VIIRS</text></svg>`;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = W * 2;
    c.height = HT * 2;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nar-calendar_${slug()}_${D.range[0]}-${D.range[1]}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
}

// ---------------------------------------------------------------- tooltip
function initTooltip() {
  const tip = $('tip');
  let timer = 0;
  const hide = () => { tip.hidden = true; clearTimeout(timer); };
  const show = (ev) => {
    const t = ev.target.closest && ev.target.closest('[data-tip]');
    if (!t) { hide(); return; }
    tip.innerHTML = t.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth;
    const hh = tip.offsetHeight;
    let x = ev.clientX + 14;
    let y = ev.clientY + 14;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
    if (y + hh > innerHeight - 8) y = ev.clientY - hh - 14;
    tip.style.left = Math.max(4, x) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
    clearTimeout(timer);
    if (ev.pointerType !== 'mouse') timer = setTimeout(hide, 5000); // a finger does not "leave": time out instead
  };
  document.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') show(ev); });
  document.addEventListener('pointerdown', show);
  // never leave the box hanging over other content
  window.addEventListener('scroll', hide, { passive: true, capture: true });
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
  document.documentElement.addEventListener('pointerleave', hide);
}

// ---------------------------------------------------------------- start
async function main() {
  state.index = await (await fetch('data/index.json')).json();
  $('country').innerHTML = state.index.countries.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  mapApi = createMap($('map'), {
    onArea: (area) => setArea(area, { fit: false }),
    onDrawState: (msg) => {
      $('draw-hint').hidden = !msg;
      $('draw-hint').textContent = msg || '';
      $('btn-rect').classList.toggle('on', mapApi && mapApi.drawing === 'rect');
      $('btn-poly').classList.toggle('on', mapApi && mapApi.drawing === 'poly');
    },
  });
  mapApi.map.setView([28, 17], 5);
  initTooltip();

  $('country').addEventListener('change', (ev) => { loadCountry(ev.target.value).catch((err) => console.error(err)); });
  $('preset').addEventListener('change', (ev) => {
    const v = ev.target.value;
    if (v === '__country') setArea({ type: 'country', name: state.country.name, presetId: '__country' });
    else { const p = state.country.presets.find((x) => x.id === v); if (p) setArea(presetArea(p)); }
  });
  const toggleDraw = (kind) => () => { if (mapApi.drawing === kind) mapApi.stopDraw(); else { mapApi.startDraw(kind); $('btn-rect').classList.toggle('on', kind === 'rect'); $('btn-poly').classList.toggle('on', kind === 'poly'); } };
  $('btn-rect').addEventListener('click', toggleDraw('rect'));
  $('btn-poly').addEventListener('click', toggleDraw('poly'));
  $('btn-coords').addEventListener('click', () => {
    const f = $('coords');
    f.hidden = !f.hidden;
    $('btn-coords').setAttribute('aria-expanded', String(!f.hidden));
    mapApi.map.invalidateSize();
  });
  $('coords').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target.elements;
    const box = [+f.s.value, +f.w.value, +f.n.value, +f.e.value];
    if (!(box[2] > box[0] && box[3] > box[1])) { f.n.setCustomValidity('North must be greater than South, and East greater than West.'); f.n.reportValidity(); f.n.setCustomValidity(''); return; }
    setArea({ type: 'box', box, name: 'Custom rectangle' });
  });
  $('chk-static').addEventListener('change', (ev) => { mapApi.setShowStatic(ev.target.checked); renderLegend(); });
  document.querySelectorAll('#calendar-card .seg button').forEach((b) => b.addEventListener('click', () => {
    state.calMode = b.dataset.mode;
    document.querySelectorAll('#calendar-card .seg button').forEach((x) => x.classList.toggle('on', x === b));
    renderCalendar($('calendar'), state.D, { mode: state.calMode, selMonth: state.selMonth });
  }));
  $('calendar').addEventListener('click', (ev) => { const c = ev.target.closest('.cell'); if (c) selectMonth(+c.dataset.m); });
  $('table-months').addEventListener('click', (ev) => { const r = ev.target.closest('tr[data-m]'); if (r) { selectMonth(+r.dataset.m); $('map').scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
  $('dl-monthly').addEventListener('click', () => download(`nar-calendar_${slug()}_monthly.csv`, monthlyCsv()));
  initAI();
  $('y0').addEventListener('change', () => setRange(+$('y0').value, +$('y1').value));
  $('y1').addEventListener('change', () => setRange(+$('y0').value, +$('y1').value));
  $('dl-png').addEventListener('click', () => calendarPng());
  $('dl-cells').addEventListener('click', () => download(`nar-calendar_${slug()}_fire-cell-days.csv`, cellsCsv()));
  $('copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); $('dl-note').textContent = 'Link copied. Anyone who opens it sees this exact area.'; } catch { $('dl-note').textContent = location.href; }
  });
  $('dl-note').textContent = 'Unit: burning cell-days (0.01° cells, about 1 km). Columns are explained in the project README.';

  const init = readHash();
  await loadCountry(init.country || state.index.countries[0].id, init);
  // a pasted or edited link on the open page
  window.addEventListener('hashchange', () => {
    if (location.hash === lastHash) return;
    if (!isStateHash(location.hash)) { history.replaceState(null, '', lastHash); return; } // an in-page anchor, not an area
    const h = readHash();
    loadCountry(h.country || state.country.id, h);
  });
  // in-page links scroll without touching the area stored in the address
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (ev) => {
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (!target) return;
    ev.preventDefault();
    target.scrollIntoView({ behavior: 'smooth' });
  }));
}

main().catch((err) => {
  console.error(err);
  $('summary').innerHTML = '<div class="empty">The fire data could not be loaded. Please reload the page.</div>';
});
