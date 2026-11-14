// Find sensor outages: days on which a satellite delivered no detection of ANY type (fires, gas
// flares, industry) in several flare-rich countries at once. Gas flares burn every day, so a day
// without a single hot spot across these countries means the instrument was not observing.
//   node pipeline/find-gaps.mjs [data-through YYYY-MM-DD]   -> writes pipeline/sensor-gaps.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE = ['Algeria', 'Libya', 'Egypt']; // thousands of static sources between them
const START = { terra: '2000-11-01', aqua: '2002-07-04', viirs: '2012-01-20' };
const END = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(process.argv[2] || '') ? process.argv[2] : '2025-12-31'; // last day covered by the raw files

const seen = { terra: new Set(), aqua: new Set(), viirs: new Set() };
for (const country of REFERENCE) {
  const dir = path.join(ROOT, 'raw', country);
  for (const f of fs.readdirSync(dir)) {
    if (!/^(modis|viirs-snpp)_d{4}_.*.csv$/.test(f)) continue; // NOAA-20 files are handled separately
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
    const head = lines[0].split(',');
    const iDate = head.indexOf('acq_date');
    const iSat = head.indexOf('satellite');
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      if (c.length < head.length) continue;
      const sensor = f.startsWith('viirs') ? 'viirs' : c[iSat] === 'Terra' ? 'terra' : 'aqua';
      seen[sensor].add(c[iDate]);
    }
  }
}

const out = { reference: REFERENCE, note: 'Inclusive ISO date ranges without any detection in the reference countries.', gaps: {} };
for (const s of Object.keys(seen)) {
  const gaps = [];
  let run = null;
  for (let t = Date.parse(START[s] + 'T00:00:00Z'); t <= Date.parse(END + 'T00:00:00Z'); t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (!seen[s].has(iso)) {
      if (run) run[1] = iso;
      else gaps.push((run = [iso, iso]));
    } else run = null;
  }
  out.gaps[s] = gaps;
  const days = gaps.reduce((n, g) => n + (Date.parse(g[1]) - Date.parse(g[0])) / 86400000 + 1, 0);
  console.log(s, gaps.length, 'gaps,', days, 'days:', gaps.map((g) => (g[0] === g[1] ? g[0] : g.join('..'))).join('  '));
}
fs.writeFileSync(path.join(ROOT, 'pipeline', 'sensor-gaps.json'), JSON.stringify(out, null, 1));
