// Nar Calendar: application wiring (state, summary cards, tables, downloads).
import { decodePack, harmonize, climatology, percentileOf, inBox, inPolygon, dayToISO, ERA, FLAG } from './harmonize.js';
import { createMap, sensorNames } from './map.js';
import { renderCalendar, renderRecords, renderSeason, renderValidation, renderFunnel, rankPhrase, MONTHS, MONTHS_LONG, fmt, esc } from './charts.js';

const $ = (id) => document.getElementById(id);
const state = { index: null, country: null, P: null, countryFit: null, area: null, D: null, selMonth: -1, calMode: 'activity' };
let mapApi;
let lastHash = '';

// ---------------------------------------------------------------- derived numbers
function derive(P, res) {
  const { H, lo, hi, V, M, N, src, cv } = res;
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
  for (let y = 2000; y <= P.lastYear; y++) {
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
  return { ...res, clim, pct, rankAbove, rankTie, vmax, years, total: finite.reduce((s, v) => s + v, 0) };
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
  const m = state.selMonth >= 0 ? state.selMonth : D.N - 1;
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
  const gap = D.gapDays[m] > 0 && !est ? ` The satellite was out for ${D.gapDays[m]} days this month, so the count is scaled up to a full month.` : '';
  h += `<div class="stat"><div class="k">${state.selMonth >= 0 ? 'Selected month' : 'Latest month on record'} · ${MONTHS_LONG[c]} ${2000 + Math.floor(m / 12)}</div>
    <div class="v">${fmt(v)} <small>${cellDays(v)}${est ? ' (estimated)' : ''}</small></div>
    <div class="d">${badge}</div>
    <div class="d">A normal ${MONTHS_LONG[c]} here has ${fmt(med)}.${rank ? ` This one is ${rank}.` : ''}${gap}${prelim}</div></div>`;
  const season = seasonText([...D.clim.med]);
  const full = D.years.filter((y) => y.months === 12);
  const top = [...full].sort((p, q) => q.total - p.total)[0];
  h += `<div class="stat-row"><div class="stat"><div class="k">Fire season</div><div class="v" style="font-size:19px">${season ? season.range : 'No clear season'}</div><div class="d">${season ? `Peak in ${season.peak}` : 'Fires are too rare here'}</div></div>
    <div class="stat"><div class="k">Most active year</div><div class="v" style="font-size:19px">${top.year}</div><div class="d">${fmt(top.total)} cell-days${top.observed ? '' : ' (estimated)'}</div></div></div>`;
  const e = D.cv.yearlyError;
  const er = D.cv.yearlyErrorRatio;
  if (D.overlap.SV < 30 || !Number.isFinite(e)) {
    // too few fires since 2012 to measure anything
    h += `<div class="stat"><div class="k">How reliable are the years before 2012?</div><div class="v" style="font-size:19px">Too few fires to measure</div>
      <div class="d">This area has only ${fmt(D.overlap.SV)} burning cell-days since 2012. Treat the years before 2012 as a rough guide, or draw a larger area.</div></div>`;
  } else {
    const base = !Number.isFinite(er) ? '' : er > e + 0.005 ? ` Plain monthly conversion factors would miss by ±${Math.round(100 * er)} %.` : er < e - 0.005 ? ` Here plain monthly conversion factors do better (±${Math.round(100 * er)} %), so read the older years with extra care.` : ` Here plain monthly conversion factors do about as well (±${Math.round(100 * er)} %).`;
    h += `<div class="stat"><div class="k">How reliable are the years before 2012?</div><div class="v">±${Math.round(100 * e)} % <small>typical miss of a yearly total</small></div>
      <div class="d">Measured by hiding each year of 2012 to ${P.lastYear} and predicting it from MODIS alone.${base}${D.lowEvidence ? ' MODIS saw very few fires here, so treat the years before 2012 as a rough guide only.' : ''}</div></div>`;
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
    h += `<tr class="rowlink" data-m="${m}"><td>${MONTHS_LONG[m % 12]} ${2000 + Math.floor(m / 12)}</td><td class="num">${fmt(D.H[m])}</td><td class="num">${fmt(med)}</td><td class="num">${med > 0 ? (D.H[m] / med).toFixed(1) + '×' : 'n/a'}</td><td>${D.src[m] === 'VIIRS' ? 'VIIRS observed' : 'MODIS, converted'}</td></tr>`;
  }
  $('table-months').innerHTML = rows.length ? h + '</tbody></table><p class="note" style="margin-top:8px">Click a row to see that month on the map.</p>' : '<p class="sub">No fire months in this area.</p>';
}

function renderAll() {
  const { D, P, area } = state;
  renderSummary();
  const has = D.idx.length > 0;
  for (const id of ['calendar-card']) $(id).style.display = has ? '' : 'none';
  document.querySelectorAll('main > .grid2').forEach((el) => { el.style.display = has ? '' : 'none'; });
  if (!has) return;
  $('cal-sub').textContent = `${area.name}: fire activity for every month from November 2000 to ${MONTHS_LONG[(P.nMonths - 1) % 12]} ${2000 + Math.floor((P.nMonths - 1) / 12)}, in one unit. Hover a month for details, click it to see its fires on the map.`;
  renderCalendar($('calendar'), D, { mode: state.calMode, selMonth: state.selMonth });
  $('year-sub').textContent = 'MODIS alone under-counts small fires and VIIRS only starts in 2012. The harmonized record joins both in VIIRS units.';
  renderRecords($('chart-years'), D);
  const year = state.selMonth >= 0 ? 2000 + Math.floor(state.selMonth / 12) : P.lastYear;
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
  state.D = derive(P, inside ? harmonize(P, inside) : state.countryFit);
  mapApi.setArea(area, state.D.idx, fit);
  mapApi.setMonth(state.selMonth);
  const preset = $('preset');
  preset.value = area.presetId || (area.type === 'country' ? '__country' : '__custom');
  if (area.type === 'box') for (const [k, i] of [['s', 0], ['w', 1], ['n', 2], ['e', 3]]) $('coords').elements[k].value = area.box[i];
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
  $('map-legend').innerHTML = `<span><i style="background:#ff7a1a"></i>Fires in your area, 2000 to ${state.P.lastYear}</span><span><i style="background:rgba(240,138,60,.4)"></i>Fires elsewhere</span>`
    + (m >= 0 ? `<span><i style="background:#fff3b0;border:1px solid #7a2a00"></i>${MONTHS[m % 12]} ${2000 + Math.floor(m / 12)}</span>` : '')
    + ($('chk-static').checked ? '<span><i style="background:#60c4ff"></i>Removed: gas flares, industry</span>' : '');
}

function writeHash() {
  const a = state.area;
  const parts = [`c=${state.country.id}`];
  if (a.presetId) parts.push(`area=${a.presetId}`);
  else if (a.type === 'box') parts.push(`box=${a.box.join(',')}`);
  else if (a.type === 'poly') parts.push(`poly=${a.ring.map((p) => p.join(',')).join(';')}`);
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
  if (initial.month >= ERA.TERRA_START && initial.month < state.P.nMonths) state.selMonth = initial.month;
  setArea(area, { keepMonth: true });
  renderLegend();
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
  const lines = ['year,month,harmonized_cell_days,likely_low,likely_high,source,modis_cell_days,viirs_cell_days,sensor_coverage,median_same_month,percentile_rank'];
  for (let m = 0; m < D.N; m++) {
    if (!Number.isFinite(D.H[m])) continue;
    const src = D.src[m] === 'VIIRS' ? (m >= D.prelimFrom ? 'VIIRS_observed_preliminary' : 'VIIRS_observed') : D.src[m] === 'Terra' ? 'MODIS_Terra_converted' : 'MODIS_converted';
    lines.push([2000 + Math.floor(m / 12), (m % 12) + 1, r(D.H[m]), r(D.lo[m]), r(D.hi[m]), src, D.M[m], m >= 144 ? D.V[m] : '', r(D.cov[m]), r(D.clim.med[m % 12]), r(D.pct[m])].join(','));
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
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    state.calMode = b.dataset.mode;
    document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    renderCalendar($('calendar'), state.D, { mode: state.calMode, selMonth: state.selMonth });
  }));
  $('calendar').addEventListener('click', (ev) => { const c = ev.target.closest('.cell'); if (c) selectMonth(+c.dataset.m); });
  $('table-months').addEventListener('click', (ev) => { const r = ev.target.closest('tr[data-m]'); if (r) { selectMonth(+r.dataset.m); $('map').scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
  $('dl-monthly').addEventListener('click', () => download(`nar-calendar_${slug()}_monthly.csv`, monthlyCsv()));
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
