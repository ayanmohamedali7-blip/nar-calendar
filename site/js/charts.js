// SVG rendering: burning calendar + supporting charts. No dependencies.
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const C = { viirs: '#d95926', modis: '#3987e5', ink: '#eef0f2', ink2: '#b6bcc6', ink3: '#808896', line: '#2c313a', surface: '#171a1f', zero: '#1d2127' };

// Sequential ramp for a dark surface: near zero recedes into the surface, high values glow.
// Lightness rises monotonically, so it stays readable with colour-vision deficiency and in greyscale.
const RAMP = ['#33241d', '#5a2a16', '#8f3a12', '#c4500f', '#ea7317', '#f9a03a', '#fdc86f', '#fff0c2'];
// Diverging: blue = fewer fires than normal, red = more, neutral grey in the middle.
const DIV_LOW = ['#383835', '#2f4f7a', '#2f6fc0', '#5598e7', '#9ec5f4'];
const DIV_HIGH = ['#383835', '#7a3530', '#b8423d', '#e66767', '#ffb3a8'];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function mix(stops, t) {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  const f = t - i;
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}
// Estimates below half a cell-day are drawn as "no fire", like an observed zero.
export const fireColor = (v, vmax) => (v >= 0.5 ? mix(RAMP, Math.sqrt(Math.min(v, vmax) / vmax)) : C.zero);
export const anomalyColor = (p) => (p >= 0.5 ? mix(DIV_HIGH, (p - 0.5) * 2) : mix(DIV_LOW, (0.5 - p) * 2));
export const rampCss = (stops = RAMP) => `linear-gradient(90deg, ${stops.join(',')})`;
export const divCss = () => `linear-gradient(90deg, ${[...DIV_LOW].reverse().concat(DIV_HIGH.slice(1)).join(',')})`;

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function fmt(v) {
  if (!Number.isFinite(v)) return 'n/a';
  if (v >= 100) return Math.round(v).toLocaleString('en-US');
  if (v >= 10 || Number.isInteger(v)) return String(Math.round(v));
  const t = (Math.round(v * 10) / 10).toFixed(1);
  return t === '0.0' ? '0' : t;
}
export const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const row = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
const tip = (html) => `data-tip="${esc(html)}"`;

/** "the 3rd highest of 26 years", "the joint highest of 26 years"; empty for months without fire. */
export function rankPhrase(D, m) {
  if (!(D.H[m] >= 0.5)) return '';
  const r = 1 + D.rankAbove[m];
  return `the ${D.rankTie[m] ? 'joint ' : ''}${r === 1 ? '' : ordinal(r) + ' '}highest of ${D.clim.count[m % 12]} years`;
}

function niceMax(v) {
  if (!(v > 4)) return 4; // counts: never label an axis with fractions of a cell-day
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3.2, 4, 6, 8, 10]) if (m * p >= v) return m * p; // all divide cleanly by 4 ticks
  return 10 * p;
}
const ticks = (max, n = 4) => Array.from({ length: n + 1 }, (_, i) => (max * i) / n);

// ------------------------------------------------------------------ calendar
export function renderCalendar(el, D, { mode, selMonth }) {
  const { H, N, years, clim, pct, src } = D;
  const W = 1040;
  const left = 132;
  const right = 236;
  const top = 26;
  const rh = 21;
  const gap = 2;
  const cw = (W - left - right) / 12;
  const rows = years.length;
  const medY = top + rows * rh + 12;
  const HGT = medY + rh + 8;
  const vmax = D.vmax;
  const maxYear = Math.max(...years.map((y) => y.hi || y.total), 1);
  const bx = W - right + 18;
  const bw = right - 18 - 62;
  let s = `<svg viewBox="0 0 ${W} ${HGT}" role="img" aria-label="Burning calendar: fire activity for every month since 2000">`;
  s += `<defs><pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${C.surface}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${C.line}" stroke-width="2"/></pattern></defs>`;
  for (let c = 0; c < 12; c++) s += `<text class="axis" x="${left + c * cw + cw / 2}" y="${top - 9}" text-anchor="middle">${MONTHS[c]}</text>`;
  s += `<text class="axis" x="${bx}" y="${top - 9}">Year total</text>`;

  // era brackets
  const firstViirs = years.findIndex((y) => y.year >= 2012);
  const bracket = (r0, r1, color, l1, l2) => {
    const y0 = top + r0 * rh;
    const y1 = top + r1 * rh - gap;
    const mid = (y0 + y1) / 2;
    return `<path d="M12 ${y0} H7 V${y1} H12" fill="none" stroke="${color}" stroke-width="2"/><text class="lbl" x="18" y="${mid - 2}">${l1}</text><text class="axis" x="18" y="${mid + 12}">${l2}</text>`;
  };
  if (firstViirs > 0) s += bracket(0, firstViirs, C.modis, 'MODIS', 'converted');
  s += bracket(Math.max(0, firstViirs), rows, C.viirs, 'VIIRS', 'observed');

  years.forEach((Y, r) => {
    const y = top + r * rh;
    s += `<text class="lbl" x="${left - 10}" y="${y + rh / 2 + 3}" text-anchor="end">${Y.year}</text>`;
    for (let c = 0; c < 12; c++) {
      const m = (Y.year - 2000) * 12 + c;
      const x = left + c * cw;
      if (m >= N || !Number.isFinite(H[m])) { s += `<rect x="${x}" y="${y}" width="${cw - gap}" height="${rh - gap}" rx="3" fill="url(#nodata)"><title>No satellite fire data yet</title></rect>`; continue; }
      const v = H[m];
      const fill = mode === 'anomaly' ? anomalyColor(pct[m]) : fireColor(v, vmax);
      const est = src[m] !== 'VIIRS';
      const rank = rankPhrase(D, m);
      const outage = D.gapDays[m] > 0 ? ` Satellite outage: ${D.gapDays[m]} days missing, count scaled to a full month.` : '';
      const html = `<b>${MONTHS_LONG[c]} ${Y.year}</b>`
        + row(est ? 'Estimated activity' : 'Fire activity', `${fmt(v)} cell-days`)
        + (est ? row('Likely range', `${fmt(D.lo[m])} to ${fmt(D.hi[m])}`) : '')
        + row(`Normal for ${MONTHS[c]}`, fmt(clim.med[c]))
        + (rank ? row('Rank', rank.replace(/^the /, '').replace(/ years$/, '')) : '')
        + row('MODIS saw', fmt(D.M[m]))
        + (m >= 144 ? row('VIIRS saw', fmt(D.V[m])) : '')
        + `<div style="margin-top:3px;color:#808896">${est ? (src[m] === 'Terra' ? 'From MODIS Terra only, converted' : 'From MODIS, converted to VIIRS units') : 'VIIRS observation'}.${outage} Click to show on the map.</div>`;
      s += `<rect class="cell${m === selMonth ? ' sel' : ''}" data-m="${m}" x="${x}" y="${y}" width="${cw - gap}" height="${rh - gap}" rx="3" fill="${fill}" ${tip(html)}/>`;
    }
    // year total bar
    if (Y.months > 0) {
      const w = Math.max(1, (Y.total / maxYear) * bw);
      const col = Y.observed ? C.viirs : C.modis;
      const yc = y + (rh - gap) / 2;
      const html = `<b>${Y.year}${Y.months < 12 ? ` (${Y.months} months)` : ''}</b>` + row('Harmonized total', `${fmt(Y.total)} cell-days`)
        + (Y.observed ? '' : row('Likely range', `${fmt(Y.lo)} to ${fmt(Y.hi)}`)) + row('MODIS saw', fmt(Y.modis)) + (Y.year >= 2012 ? row('VIIRS saw', fmt(Y.viirs)) : '');
      s += `<g ${tip(html)}><rect x="${bx}" y="${y}" width="${bw + 60}" height="${rh - gap}" fill="transparent"/><path d="M${bx} ${y + 3} h${Math.max(0, w - 3)} a3 3 0 0 1 3 3 v${rh - gap - 12} a3 3 0 0 1 -3 3 h-${Math.max(0, w - 3)} z" fill="${col}"/>`;
      if (!Y.observed && Y.hi > Y.lo) s += `<line x1="${bx + (Y.lo / maxYear) * bw}" x2="${bx + (Y.hi / maxYear) * bw}" y1="${yc}" y2="${yc}" stroke="${C.ink}" stroke-width="1.5"/>`;
      s += `<text class="val" x="${bx + Math.max(w, Y.observed ? 0 : (Y.hi / maxYear) * bw) + 6}" y="${yc + 4}">${fmt(Y.total)}${Y.months < 12 ? '*' : ''}</text></g>`;
    }
  });
  // median row
  s += `<text class="lbl" x="${left - 10}" y="${medY + rh / 2 + 3}" text-anchor="end">Normal (median)</text>`;
  for (let c = 0; c < 12; c++) {
    const v = clim.med[c];
    s += `<rect x="${left + c * cw}" y="${medY}" width="${cw - gap}" height="${rh - gap}" rx="3" fill="${fireColor(v, vmax)}" ${tip(`<b>Normal ${MONTHS_LONG[c]}</b>` + row('Median', `${fmt(v)} cell-days`) + row('Middle half of years', `${fmt(clim.q1[c])} to ${fmt(clim.q3[c])}`))}/>`;
    s += `<text x="${left + c * cw + (cw - gap) / 2}" y="${medY + rh / 2 + 3}" text-anchor="middle" style="font-size:11px;fill:${v / vmax > 0.25 ? '#1a0f06' : C.ink2}">${fmt(v)}</text>`;
  }
  s += '</svg>';
  const legend = mode === 'anomaly'
    ? `<span>Fewer fires than normal<span class="ramp" style="background:${divCss()}"></span>More than normal</span><span>Each month is ranked against the same month in all other years.</span>`
    : `<span>0<span class="ramp" style="background:${rampCss()}"></span>${fmt(vmax)}+ burning cell-days per month</span>`;
  el.innerHTML = s + `<div class="legend">${legend}<span><span class="sw" style="background:${C.modis}"></span>Estimated from MODIS (line = likely range)</span><span><span class="sw" style="background:${C.viirs}"></span>Observed by VIIRS</span>${years[0].months < 12 ? '<span>* incomplete year</span>' : ''}</div>`;
}

// ------------------------------------------------------------------ line chart: three records
export function renderRecords(el, D) {
  const W = 620, HGT = 300, l = 44, r = 96, t = 14, b = 30;
  const ys = D.years.filter((y) => y.months === 12);
  const max = niceMax(Math.max(...ys.map((y) => Math.max(y.hi || 0, y.total, y.viirs, y.modis))));
  const x = (yr) => l + ((yr - ys[0].year) / (ys[ys.length - 1].year - ys[0].year)) * (W - l - r);
  const y = (v) => t + (1 - v / max) * (HGT - t - b);
  let s = `<svg viewBox="0 0 ${W} ${HGT}" role="img" aria-label="Yearly fire activity: raw MODIS, raw VIIRS and the harmonized record">`;
  for (const tk of ticks(max)) s += `<line class="grid" x1="${l}" x2="${W - r}" y1="${y(tk)}" y2="${y(tk)}"/><text class="axis" x="${l - 8}" y="${y(tk) + 4}" text-anchor="end">${fmt(tk)}</text>`;
  for (const Y of ys) if (Y.year % 5 === 0) s += `<text class="axis" x="${x(Y.year)}" y="${HGT - 9}" text-anchor="middle">${Y.year}</text>`;
  // likely range of the estimated years
  const est = ys.filter((Y) => !Y.observed);
  if (est.length > 1) s += `<path d="M${est.map((Y) => `${x(Y.year)} ${y(Y.hi)}`).join(' L')} L${[...est].reverse().map((Y) => `${x(Y.year)} ${y(Y.lo)}`).join(' L')} Z" fill="${C.ink}" opacity="0.12"/>`;
  const path = (arr, f) => 'M' + arr.map((Y) => `${x(Y.year)} ${y(f(Y))}`).join(' L');
  const vi = ys.filter((Y) => Y.year >= 2012);
  s += `<path d="${path(ys, (Y) => Y.total)}" fill="none" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/>`;
  s += `<path d="${path(ys, (Y) => Y.modis)}" fill="none" stroke="${C.modis}" stroke-width="2" stroke-linejoin="round"/>`;
  if (vi.length) s += `<path d="${path(vi, (Y) => Y.viirs)}" fill="none" stroke="${C.viirs}" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>`;
  const last = ys[ys.length - 1];
  const labels = [{ v: last.total, txt: 'Harmonized', col: C.ink }, { v: last.modis, txt: 'MODIS raw', col: C.modis }];
  labels.sort((p, q) => q.v - p.v);
  let prevY = -99;
  for (const L of labels) { let yy = y(L.v) + 4; if (yy - prevY < 14) yy = prevY + 14; prevY = yy; s += `<text x="${W - r + 8}" y="${yy}" style="font-size:12px;fill:${C.ink}"><tspan fill="${L.col}">● </tspan>${L.txt}</text>`; }
  for (const Y of ys) {
    const html = `<b>${Y.year}</b>` + row('Harmonized', fmt(Y.total)) + (Y.observed ? '' : row('Likely range', `${fmt(Y.lo)} to ${fmt(Y.hi)}`)) + row('MODIS raw', fmt(Y.modis)) + (Y.year >= 2012 ? row('VIIRS raw', fmt(Y.viirs)) : '');
    const step = (W - l - r) / (ys.length - 1);
    s += `<rect class="hit" x="${x(Y.year) - step / 2}" y="${t}" width="${step}" height="${HGT - t - b}" fill="transparent" ${tip(html)}/><circle class="mark" cx="${x(Y.year)}" cy="${y(Y.total)}" r="3.5" fill="${C.ink}" stroke="${C.surface}" stroke-width="2" pointer-events="none"/>`;
  }
  s += '</svg>';
  el.innerHTML = s + `<div class="legend"><span><span class="sw" style="background:${C.ink}"></span>Harmonized record (shade = likely range)</span><span><span class="sw" style="background:${C.modis}"></span>MODIS as delivered</span><span><span class="sw" style="background:${C.viirs}"></span>VIIRS as delivered (dashed, on top of the harmonized line from 2012)</span></div>`;
}

// ------------------------------------------------------------------ season profile
export function renderSeason(el, D, year) {
  const W = 620, HGT = 300, l = 44, r = 12, t = 14, b = 30;
  const { clim, H } = D;
  const yv = Array.from({ length: 12 }, (_, c) => H[(year - 2000) * 12 + c]);
  const max = niceMax(Math.max(...clim.q3, ...yv.filter(Number.isFinite), 1));
  const bw = (W - l - r) / 12;
  const y = (v) => t + (1 - v / max) * (HGT - t - b);
  let s = `<svg viewBox="0 0 ${W} ${HGT}" role="img" aria-label="Normal fire season by calendar month, compared with ${year}">`;
  for (const tk of ticks(max)) s += `<line class="grid" x1="${l}" x2="${W - r}" y1="${y(tk)}" y2="${y(tk)}"/><text class="axis" x="${l - 8}" y="${y(tk) + 4}" text-anchor="end">${fmt(tk)}</text>`;
  for (let c = 0; c < 12; c++) {
    const x0 = l + c * bw + bw * 0.2;
    const w = bw * 0.6;
    const h = Math.max(0, y(0) - y(clim.med[c]));
    const cx = x0 + w / 2;
    const html = `<b>${MONTHS_LONG[c]}</b>` + row('Normal (median)', fmt(clim.med[c])) + row('Middle half of years', `${fmt(clim.q1[c])} to ${fmt(clim.q3[c])}`) + (Number.isFinite(yv[c]) ? row(String(year), fmt(yv[c])) : '');
    s += `<g ${tip(html)}><rect x="${l + c * bw}" y="${t}" width="${bw}" height="${HGT - t - b}" fill="transparent"/>`;
    if (h > 0.5) s += `<path d="M${x0} ${y(0)} v-${Math.max(0, h - 4)} a4 4 0 0 1 4 -4 h${w - 8} a4 4 0 0 1 4 4 v${Math.max(0, h - 4)} z" fill="${C.viirs}"/>`;
    s += `<line x1="${cx}" x2="${cx}" y1="${y(clim.q1[c])}" y2="${y(clim.q3[c])}" stroke="${C.ink2}" stroke-width="1.5"/>`;
    if (Number.isFinite(yv[c])) s += `<circle cx="${cx}" cy="${y(Math.min(yv[c], max))}" r="5" fill="${C.ink}" stroke="${C.surface}" stroke-width="2"/>`;
    s += `</g><text class="axis" x="${cx}" y="${HGT - 9}" text-anchor="middle">${MONTHS[c]}</text>`;
  }
  s += '</svg>';
  el.innerHTML = s + `<div class="legend"><span><span class="sw" style="background:${C.viirs}"></span>Normal month (median of all years; line = middle half of years)</span><span><span class="dot" style="background:${C.ink};color:${C.ink}"></span>${year}</span></div>`;
}

// ------------------------------------------------------------------ validation
export function renderValidation(el, D) {
  const W = 620, HGT = 300, l = 44, r = 12, t = 14, b = 30;
  const ys = D.cv.years;
  const max = niceMax(Math.max(...ys.map((q) => Math.max(q.observed, q.predicted)), 1));
  const bw = (W - l - r) / ys.length;
  const y = (v) => t + (1 - v / max) * (HGT - t - b);
  let s = `<svg viewBox="0 0 ${W} ${HGT}" role="img" aria-label="Validation: VIIRS yearly totals observed, against totals predicted from MODIS alone">`;
  for (const tk of ticks(max)) s += `<line class="grid" x1="${l}" x2="${W - r}" y1="${y(tk)}" y2="${y(tk)}"/><text class="axis" x="${l - 8}" y="${y(tk) + 4}" text-anchor="end">${fmt(tk)}</text>`;
  ys.forEach((q, i) => {
    const x0 = l + i * bw + bw * 0.2;
    const w = bw * 0.6;
    const h = Math.max(0, y(0) - y(q.observed));
    const cx = x0 + w / 2;
    const err = q.observed > 0 ? `${q.predicted >= q.observed ? '+' : ''}${Math.round((100 * (q.predicted - q.observed)) / q.observed)} %` : 'n/a';
    const html = `<b>${q.year}</b>` + row('VIIRS observed', fmt(q.observed)) + row('Predicted from MODIS', fmt(q.predicted)) + row('Miss', err) + row('MODIS raw count', fmt(q.modisRaw));
    s += `<g ${tip(html)}><rect x="${l + i * bw}" y="${t}" width="${bw}" height="${HGT - t - b}" fill="transparent"/>`;
    if (h > 0.5) s += `<path d="M${x0} ${y(0)} v-${Math.max(0, h - 4)} a4 4 0 0 1 4 -4 h${w - 8} a4 4 0 0 1 4 4 v${Math.max(0, h - 4)} z" fill="${C.viirs}"/>`;
    s += `<circle cx="${cx}" cy="${y(q.predicted)}" r="5" fill="${C.modis}" stroke="${C.surface}" stroke-width="2"/></g>`;
    s += `<text class="axis" x="${cx}" y="${HGT - 9}" text-anchor="middle">'${String(q.year).slice(2)}</text>`;
  });
  s += '</svg>';
  el.innerHTML = s + `<div class="legend"><span><span class="sw" style="background:${C.viirs}"></span>What VIIRS really saw</span><span><span class="dot" style="background:${C.modis};color:${C.modis}"></span>What our method predicts from MODIS alone, with that year hidden</span></div>`;
}

// ------------------------------------------------------------------ filter funnel
export function renderFunnel(el, steps) {
  const W = 620, rhh = 40, l = 196, r = 150, t = 6;
  const HGT = t + steps.length * rhh + 4;
  const max = steps[0].value;
  let s = `<svg viewBox="0 0 ${W} ${HGT}" role="img" aria-label="How many hot spots survive each filter">`;
  steps.forEach((st, i) => {
    const y = t + i * rhh;
    const w = Math.max(2, (st.value / max) * (W - l - r));
    const html = `<b>${st.label}</b>` + row('Detections left', st.value.toLocaleString('en-US')) + row('Share of all hot spots', `${((100 * st.value) / max).toFixed(1)} %`) + `<div style="margin-top:3px;color:#808896">${st.help}</div>`;
    s += `<g ${tip(html)}><rect x="0" y="${y}" width="${W}" height="${rhh}" fill="transparent"/><text class="lbl" x="${l - 10}" y="${y + rhh / 2 + 1}" text-anchor="end">${st.label}</text>`;
    s += `<path d="M${l} ${y + 8} h${Math.max(0, w - 4)} a4 4 0 0 1 4 4 v${rhh - 24} a4 4 0 0 1 -4 4 h-${Math.max(0, w - 4)} z" fill="${i === steps.length - 1 ? C.viirs : '#6b4a3a'}"/>`;
    s += `<text class="val" x="${l + w + 8}" y="${y + rhh / 2 + 1}">${st.value.toLocaleString('en-US')} <tspan fill="${C.ink3}">(${((100 * st.value) / max).toFixed(st.value / max < 0.1 ? 1 : 0)} %)</tspan></text></g>`;
  });
  s += '</svg>';
  el.innerHTML = s;
}
