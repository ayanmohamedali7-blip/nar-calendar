// Download VIIRS NOAA-20 detections through the FIRMS API (the yearly country archives do not
// carry NOAA-20). NOAA-20 is the satellite that continues the VIIRS record after Suomi NPP
// stopped delivering data on 2 November 2026.
//   node pipeline/download-noaa20.mjs 2026-11-13 Libya Algeria ...
// Writes raw/<Country>/viirs-noaa20_<Y>_<Country>.csv (one file per year, archive format).
// Years that are already complete on disk are skipped, so the script can be re-run.
// Key: FIRMS_MAP_KEY or the file named by FIRMS_KEY_FILE (see download-latest.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [END, ...countries] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(END || '') || !countries.length) { console.error('usage: node pipeline/download-noaa20.mjs <last-date YYYY-MM-DD> <Country> ...'); process.exit(1); }
const keyFile = process.env.FIRMS_KEY_FILE || path.join(os.homedir(), '.nasa-secrets', 'firms_map_key.txt');
const KEY = (process.env.FIRMS_MAP_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!/^[0-9a-f]{32}$/i.test(KEY)) { console.error('No FIRMS MAP_KEY found (set FIRMS_MAP_KEY or FIRMS_KEY_FILE).'); process.exit(1); }
const API = 'https://firms.modaps.eosdis.nasa.gov';
const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline', 'country-shapes.json'), 'utf8'));
const safe = (s) => String(s).split(KEY).join('[key]');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const HEAD = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type';

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (res.ok && !/^(Invalid|Exceeded|Error)/i.test(text.trim())) return text;
      if (/exceed/i.test(text)) { await sleep(60000); continue; }
      throw new Error(safe(text.slice(0, 120)));
    } catch (err) {
      if (i === tries - 1) throw new Error(safe(err.message));
      await sleep(4000 * (i + 1));
    }
  }
  throw new Error('no answer');
}
async function waitForQuota() {
  for (;;) {
    const s = JSON.parse(await get(`${API}/mapserver/mapkey_status/?MAP_KEY=${KEY}`));
    if (s.current_transactions < s.transaction_limit * 0.8) return;
    await sleep(45000);
  }
}
function insideCountry(shape, lon, lat) {
  const [w, s, e, n] = shape.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return false;
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return shape.polygons.some((rings) => inRing(rings[0]) && !rings.slice(1).some(inRing));
}

const avail = Object.fromEntries((await get(`${API}/api/data_availability/csv/${KEY}/all`)).trim().split(/\r?\n/).slice(1).map((l) => { const [id, min, max] = l.split(','); return [id, { min, max }]; }));
const SP = 'VIIRS_NOAA20_SP';
const NRT = 'VIIRS_NOAA20_NRT';
const spMin = Date.parse(avail[SP].min + 'T00:00:00Z');
const spMax = Date.parse(avail[SP].max + 'T00:00:00Z');
const end = Math.min(Date.parse(END + 'T00:00:00Z'), Date.parse(avail[NRT].max + 'T00:00:00Z'));
const cols = HEAD.split(',');
let calls = 0;

for (const country of countries) {
  const shape = shapes[country];
  if (!shape) { console.error('no outline for', country); continue; }
  const box = shape.bbox.join(',');
  const dir = path.join(ROOT, 'raw', country);
  fs.mkdirSync(dir, { recursive: true });
  for (let year = new Date(spMin).getUTCFullYear(); year <= new Date(end).getUTCFullYear(); year++) {
    const out = path.join(dir, `viirs-noaa20_${year}_${country}.csv`);
    const marker = out + '.done'; // written only when the whole year (or the part up to END) is on disk
    const yEnd = Math.min(end, Date.parse(`${year}-12-31T00:00:00Z`));
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === iso(yEnd)) continue;
    const rows = new Set();
    for (let t = Math.max(spMin, Date.parse(`${year}-01-01T00:00:00Z`)); t <= yEnd; ) {
      const source = t <= spMax ? SP : NRT;
      const limit = source === SP ? Math.min(spMax, yEnd) : yEnd;
      const days = Math.min(5, Math.round((limit - t) / DAY) + 1);
      if (calls % 20 === 0) await waitForQuota();
      const text = await get(`${API}/api/area/csv/${KEY}/${source}/${box}/${days}/${iso(t)}`);
      calls++;
      const lines = text.trim().split(/\r?\n/);
      const h = lines[0].split(',');
      const ix = cols.map((c) => h.indexOf(c));
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(',');
        if (c.length < h.length) continue;
        if (!insideCountry(shape, +c[ix[1]], +c[ix[0]])) continue;
        rows.add(ix.map((k) => (k < 0 ? '' : c[k])).join(','));
      }
      t += days * DAY;
    }
    const sorted = [...rows].sort((p, q) => { const a = p.split(','), b = q.split(','); return a[5] < b[5] ? -1 : a[5] > b[5] ? 1 : +a[6] - +b[6]; });
    fs.writeFileSync(out, HEAD + '\n' + sorted.join('\n') + '\n');
    fs.writeFileSync(marker, iso(yEnd) + '\n');
    console.log(`${country} NOAA-20 ${year}: ${sorted.length} detections (to ${iso(yEnd)})`);
  }
}
console.log('done,', calls, 'API calls');
