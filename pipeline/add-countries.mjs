// Adds the Mediterranean country packs to site/data/index.json (ready-made areas and city labels).
// A country is only added when its pack file exists.   node pipeline/add-countries.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'site', 'data', 'index.json');
const index = JSON.parse(fs.readFileSync(file, 'utf8'));
const P = (name, lat, lon) => ({ name, lat, lon });
const A = (id, name, box) => ({ id, name, box }); // box = [south, west, north, east]

const extra = [
  { id: 'morocco', name: 'Morocco', presets: [A('rif', 'Rif mountains (Chefchaouen and Tetouan)', [34.7, -5.9, 35.6, -4.0]), A('middle-atlas', 'Middle Atlas (Ifrane and Khenifra)', [32.6, -6.0, 33.9, -4.6]), A('gharb', 'Gharb plain (Kenitra)', [34.0, -6.8, 34.9, -5.7])],
    places: [P('Rabat', 34.02, -6.84), P('Casablanca', 33.57, -7.59), P('Fes', 34.03, -5.0), P('Tangier', 35.76, -5.83), P('Tetouan', 35.57, -5.37), P('Chefchaouen', 35.17, -5.27), P('Marrakech', 31.63, -8.0), P('Agadir', 30.42, -9.6), P('Oujda', 34.68, -1.9)] },
  { id: 'portugal', name: 'Portugal', presets: [A('central', 'Central Portugal (Coimbra and Pedrogao Grande)', [39.6, -8.7, 40.6, -7.4]), A('north', 'Northern Portugal (Braga and Vila Real)', [41.2, -8.7, 42.0, -7.0]), A('algarve', 'Algarve and Monchique', [37.0, -9.0, 37.5, -7.4])],
    places: [P('Lisbon', 38.72, -9.14), P('Porto', 41.15, -8.61), P('Coimbra', 40.21, -8.43), P('Braga', 41.55, -8.42), P('Viseu', 40.66, -7.91), P('Evora', 38.57, -7.91), P('Faro', 37.02, -7.93)] },
  { id: 'spain', name: 'Spain', presets: [A('galicia', 'Galicia', [41.8, -9.3, 43.8, -6.7]), A('zamora', 'Zamora and Sierra de la Culebra', [41.6, -6.9, 42.3, -5.6]), A('valencia', 'Valencia region', [38.6, -1.6, 40.6, 0.3]), A('andalusia-west', 'Western Andalusia (Huelva and Seville)', [36.9, -7.5, 38.2, -5.0])],
    places: [P('Madrid', 40.42, -3.7), P('Barcelona', 41.39, 2.17), P('Valencia', 39.47, -0.38), P('Seville', 37.39, -5.98), P('Zaragoza', 41.65, -0.89), P('Malaga', 36.72, -4.42), P('Bilbao', 43.26, -2.93), P('A Coruna', 43.36, -8.41), P('Vigo', 42.24, -8.72), P('Zamora', 41.5, -5.74)] },
  { id: 'italy', name: 'Italy', presets: [A('sicily', 'Sicily', [36.6, 12.3, 38.4, 15.7]), A('sardinia', 'Sardinia', [38.8, 8.1, 41.3, 9.9]), A('calabria', 'Calabria', [37.9, 15.6, 40.2, 17.3])],
    places: [P('Rome', 41.9, 12.5), P('Milan', 45.46, 9.19), P('Turin', 45.07, 7.69), P('Florence', 43.77, 11.26), P('Naples', 40.85, 14.27), P('Bari', 41.12, 16.87), P('Reggio Calabria', 38.11, 15.65), P('Palermo', 38.12, 13.36), P('Catania', 37.5, 15.09), P('Cagliari', 39.22, 9.12)] },
  { id: 'greece', name: 'Greece', presets: [A('attica-evia', 'Attica and Evia', [37.6, 23.0, 39.1, 24.7]), A('peloponnese', 'Peloponnese', [36.4, 21.1, 38.4, 23.3]), A('evros', 'Evros and Rhodope (Dadia forest)', [40.7, 25.0, 41.8, 26.7]), A('rhodes', 'Rhodes', [35.85, 27.65, 36.5, 28.3])],
    places: [P('Athens', 37.98, 23.73), P('Thessaloniki', 40.64, 22.94), P('Larissa', 39.64, 22.42), P('Patras', 38.25, 21.73), P('Chalkida', 38.46, 23.6), P('Kalamata', 37.04, 22.11), P('Alexandroupoli', 40.85, 25.87), P('Heraklion', 35.34, 25.13), P('Rhodes', 36.43, 28.22)] },
  { id: 'turkey', name: 'Turkey', presets: [A('antalya-mugla', 'Antalya and Mugla coast', [36.2, 27.3, 37.6, 32.2]), A('izmir-manisa', 'Izmir and Manisa', [37.9, 26.2, 39.4, 28.6]), A('hatay-adana', 'Hatay and Adana', [36.0, 35.0, 37.6, 36.9]), A('southeast', 'Southeast farmland (Sanliurfa and Diyarbakir)', [36.7, 38.0, 38.3, 41.2])],
    places: [P('Ankara', 39.93, 32.86), P('Istanbul', 41.01, 28.98), P('Bursa', 40.19, 29.06), P('Izmir', 38.42, 27.14), P('Mugla', 37.22, 28.36), P('Antalya', 36.9, 30.7), P('Adana', 37.0, 35.32), P('Sanliurfa', 37.16, 38.79), P('Diyarbakir', 37.91, 40.24), P('Trabzon', 41.0, 39.72)] },
  { id: 'lebanon', name: 'Lebanon', presets: [A('mount-lebanon', 'Mount Lebanon and Chouf', [33.5, 35.3, 34.2, 36.0]), A('akkar', 'Akkar and the north', [34.3, 35.8, 34.7, 36.5])],
    places: [P('Beirut', 33.89, 35.5), P('Tripoli', 34.44, 35.84), P('Sidon', 33.56, 35.37), P('Tyre', 33.27, 35.2), P('Zahle', 33.85, 35.9), P('Baalbek', 34.0, 36.21)] },
  { id: 'syria', name: 'Syria', presets: [A('latakia', 'Latakia coast mountains', [35.2, 35.7, 36.0, 36.4]), A('ghab', 'Al-Ghab plain and Hama', [35.0, 36.1, 35.9, 36.9]), A('jazira', 'Jazira farmland (Hasakah)', [36.2, 39.8, 37.2, 42.3])],
    places: [P('Damascus', 33.51, 36.29), P('Aleppo', 36.2, 37.16), P('Homs', 34.73, 36.72), P('Hama', 35.13, 36.75), P('Latakia', 35.52, 35.78), P('Tartus', 34.89, 35.89), P('Raqqa', 35.95, 39.01), P('Hasakah', 36.5, 40.75), P('Deir ez-Zor', 35.33, 40.14)] },
  { id: 'cyprus', name: 'Cyprus', presets: [A('troodos', 'Troodos and the Limassol hills', [34.6, 32.4, 35.1, 33.4])],
    places: [P('Nicosia', 35.17, 33.36), P('Limassol', 34.68, 33.04), P('Larnaca', 34.92, 33.63), P('Paphos', 34.77, 32.42), P('Famagusta', 35.12, 33.94), P('Kyrenia', 35.34, 33.32)] },
];

let added = 0;
for (const c of extra) {
  const pack = `${c.id}.json`;
  if (!fs.existsSync(path.join(ROOT, 'site', 'data', pack))) { console.log('skip (no pack yet):', c.name); continue; }
  const entry = { id: c.id, name: c.name, file: pack, presets: c.presets, places: c.places };
  const i = index.countries.findIndex((x) => x.id === c.id);
  if (i >= 0) index.countries[i] = entry; else { index.countries.push(entry); added++; }
}
// Libya (the home story) stays first, the rest in alphabetical order
const first = index.countries.filter((c) => c.id === 'libya');
const rest = index.countries.filter((c) => c.id !== 'libya').sort((p, q) => p.name.localeCompare(q.name));
index.countries = [...first, ...rest];
fs.writeFileSync(file, JSON.stringify(index, null, 1));
console.log(`index.json: ${index.countries.length} countries (${added} new):`, index.countries.map((c) => c.name).join(', '));
