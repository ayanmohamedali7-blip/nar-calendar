// Download the months that are not yet in the yearly FIRMS archive files, through the FIRMS API.
//   node pipeline/download-latest.mjs 2026-10-31 Libya Algeria Egypt Tunisia
// Needs a free FIRMS MAP_KEY: environment variable FIRMS_MAP_KEY, or a text file named by
// FIRMS_KEY_FILE (default: ~/.nasa-secrets/firms_map_key.txt). The key is never printed or stored
// in this repository.
//
// The API serves areas (boxes), 5 days per call. Each call is clipped to the country outline
// (pipeline/country-shapes.json) so the result matches the yearly country archives. "SP"
// (standard processing, with the FIRMS type column) is used as far as it exists, "NRT"
// (near real time, no type column) after that. Output: raw/<Country>/modis_<Y>_<Country>.csv
// and viirs-snpp_<Y>_<Country>.csv in the archive format.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [END, ...countries] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(END || '') || !countries.length) { console.error('usage: node pipeline/download-latest.mjs <last-date YYYY-MM-DD> <Country> ...'); process.exit(1); }
const YEAR = +END.slice(0, 4);
const keyFile = process.env.FIRMS_KEY_FILE || path.join(os.homedir(), '.nasa-secrets', 'firms_map_key.txt');
const KEY = (process.env.FIRMS_MAP_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!/^[0-9a-f]{32}$/i.test(KEY)) { console.error('No FIRMS MAP_KEY found (set FIRMS_MAP_KEY or FIRMS_KEY_FILE).'); process.exit(1); }
const API = 'https://firms.modaps.eosdis.nasa.gov';
const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline', 'country-shapes.json'), 'utf8'));
const safe = (s) => String(s).split(KEY).join('[key]');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (res.ok && !/^(Invalid|Exceeded|Error)/i.test(text.trim())) return text;
      if (/exceed/i.test(text)) { console.log('  rate limit reached, waiting 60 s'); await sleep(60000); continue; }
      throw new Error(safe(text.slice(0, 120)));
    } catch (err) {
      if (i === tries - 1) throw new Error(safe(err.message));
      await sleep(3000 * (i + 1));
    }
  }
  throw new Error('no answer');
}

async function waitForQuota() {
  for (;;) {
    const s = JSON.parse(await get(`${API}/mapserver/mapkey_status/?MAP_KEY=${KEY}`));
    if (s.current_transactions < s.transaction_limit * 0.8) return;
    console.log(`  ${s.current_transactions} of ${s.transaction_limit} transactions used in this window, waiting 45 s`);
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

// which source covers which dates
const avail = Object.fromEntries((await get(`${API}/api/data_availability/csv/${KEY}/all`)).trim().split(/\r?\n/).slice(1).map((l) => { const [id, min, max] = l.split(','); return [id, { min, max }]; }));
const SENSORS = [
  { file: 'modis', sp: 'MODIS_SP', nrt: 'MODIS_NRT', head: 'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type' },
  { file: 'viirs-snpp', sp: 'VIIRS_SNPP_SP', nrt: 'VIIRS_SNPP_NRT', head: 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type' },
];

for (const country of countries) {
  const shape = shapes[country];
  if (!shape) { console.error('no outline for', country, '(run pipeline/make-shapes.mjs)'); continue; }
  const box = shape.bbox.join(',');
  for (const S of SENSORS) {
    const cols = S.head.split(',');
    const rows = new Set();
    const start = Date.parse(`${YEAR}-01-01T00:00:00Z`);
    const end = Math.min(Date.parse(END + 'T00:00:00Z'), Date.parse(avail[S.nrt].max + 'T00:00:00Z'));
    const spMax = Date.parse(avail[S.sp].max + 'T00:00:00Z');
    let calls = 0;
    for (let t = start; t <= end; ) {
      const source = t <= spMax ? S.sp : S.nrt;
      const limit = source === S.sp ? Math.min(spMax, end) : end;
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
        rows.add(ix.map((k) => (k < 0 ? '' : c[k])).join(','));  // NRT has no type column: left empty
      }
      t += days * DAY;
    }
    const sorted = [...rows].sort((p, q) => { const a = p.split(','), b = q.split(','); return a[5] < b[5] ? -1 : a[5] > b[5] ? 1 : +a[6] - +b[6]; });
    const dir = path.join(ROOT, 'raw', country);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${S.file}_${YEAR}_${country}.csv`);
    fs.writeFileSync(out, S.head + '\n' + sorted.join('\n') + '\n');
    console.log(`${country} ${S.file} ${YEAR}: ${sorted.length} detections in ${calls} calls (SP to ${iso(Math.min(spMax, end))}, NRT after) -> ${path.basename(out)}`);
  }
}
