// Download the NASA FIRMS yearly country archives (no key needed).
//   node pipeline/download.mjs Libya
// Country names follow the FIRMS file names, for example Libya, Tunisia, Algeria, Egypt, Greece.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const country = process.argv[2];
if (!country) { console.error('usage: node pipeline/download.mjs <CountryName>'); process.exit(1); }
const BASE = 'https://firms.modaps.eosdis.nasa.gov/data/country';
const LAST_YEAR = 2025; // newest complete year in the archive when this was written
const dir = path.join(ROOT, 'raw', country);
fs.mkdirSync(dir, { recursive: true });

const jobs = [];
for (let y = 2000; y <= LAST_YEAR; y++) jobs.push(['modis', y]);
for (let y = 2012; y <= LAST_YEAR; y++) jobs.push(['viirs-snpp', y]);

let ok = 0;
for (const [sensor, y] of jobs) {
  const name = `${sensor}_${y}_${country}.csv`;
  const file = path.join(dir, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) { ok++; continue; }
  const res = await fetch(`${BASE}/${sensor}/${y}/${name}`);
  if (!res.ok) { console.warn(`missing ${name} (HTTP ${res.status})`); continue; }
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  ok++;
  console.log('saved', name);
}
console.log(`${ok} of ${jobs.length} files in ${dir}`);
