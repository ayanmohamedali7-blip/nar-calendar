# Nar Calendar

**One fire record from two generations of NASA satellites, 2000 to today.**

**Live app: https://nar.vorelq.com**

Team **Sawissi Lab** (Libya) · NASA Space Apps Challenge 2026 · Challenge: *Harmonization of MODIS and VIIRS Hot Spots*

*Nar* (نار) is the Arabic word for fire.

Draw any area on the map (or type its coordinates) and Nar Calendar shows:

- a **burning calendar**: fire activity for every month since November 2000, in one consistent unit;
- how each month compares with what is **normal** for that month (median of all years);
- the **fire season**, the most active years and months;
- how far the older, MODIS-based years can be **trusted**, measured rather than assumed;
- the **long-term trend** (Theil-Sen slope with the Mann-Kendall test), so a real change is told apart from ups and downs;
- any **range of years** you choose: the normal, the ranks, the trend and the downloads all follow it;
- **downloads**: the monthly series and every fire cell as CSV, and the calendar itself as a PNG image.

Country packs: **Libya**, where the story started (the forests of Jebel Akhdar, the Green Mountain), and twelve more around the Mediterranean: Algeria, Cyprus, Egypt, Greece, Italy, Lebanon, Morocco, Portugal, Spain, Syria, Tunisia and Turkey. Any other country is three commands away (see "Run it").

The record matches events people remember: the Kabylie fires of August 2021 and Algeria's 2012 season stand out, and so does the autumn rice-straw burning of the Nile Delta. Validation of yearly totals (each year hidden, then predicted from MODIS alone), whole countries: Italy misses by 5 %, Spain 6 %, Algeria 7 %, Portugal 7 %, Greece 8 %, Turkey 9 %, Morocco 10 %, Syria 10 %, Lebanon 13 %, Tunisia 15 %, Libya 19 %, Egypt 28 %, Cyprus 30 %.

## The problem

MODIS (Terra, Aqua) has mapped active fire since November 2000 with 1 km pixels. VIIRS (Suomi NPP) started in January 2012 with 375 m pixels and sees many small fires that MODIS misses. Put side by side, the two records show a jump in 2012 that never happened on the ground. In our Libya data VIIRS reports about nine times more burning cells than MODIS, and the ratio is not constant: it is about 3 in forest (Jebel Akhdar) and about 13 on farmland (Jefara plain). One conversion factor cannot work.

## Method

All steps are in `pipeline/build-data.mjs` (data) and `site/js/harmonize.js` (statistics). The statistics run in the browser for the exact area the user draws.

1. **Keep only real fires.** From the FIRMS archive we keep `type = 0` (presumed vegetation fire) and drop low-confidence detections (MODIS < 30 %, VIIRS `l`).
2. **Static-source mask.** Every 0.01° cell that FIRMS ever labelled as a static source (type 1, 2, 3) is masked together with its neighbours (2 cells for VIIRS, 3 for MODIS). In Libya most "type 0" detections sit right next to oil-field gas flares.
3. **Persistence mask.** Places with heat on 15 or more distinct days spread over 8 or more calendar months are not seasonal fires (industry, dumps, unlabelled flares) and are removed.
   In Libya these three steps keep **1.7 %** of 737,948 hot spots; in Algeria 10 %, in Egypt 12 %, in Tunisia 38 %.
4. **One unit.** Both sensors are placed on the same 0.01° grid (about 1 km). A cell with at least one detection on a day is one **burning cell-day**, whatever the pixel size.
5. **Satellite outages.** A satellite that is down for ten days makes a month look quiet. `pipeline/find-gaps.mjs` finds every day on which a sensor delivered no detection of any kind across three flare-rich countries (gas flares burn daily, so such a day is an outage: for example S-NPP from 27 July to 10 August 2022, Terra from 15 June to 2 July 2001). Monthly counts are scaled to a full month by the share of days observed, never by more than 3 times, and the app marks those months.
6. **Quantile mapping** on the overlap (February 2012 to October 2026). The monthly MODIS counts and the monthly VIIRS counts of the area are each sorted; a MODIS value is converted to the VIIRS value with the same rank. Months where MODIS saw nothing get the mean of the matching VIIRS ranks, modulated by season. Before July 2002 only Terra was flying, so that period has its own mapping. Two guards keep small areas sane: an estimate is never below the MODIS count itself, and more MODIS fire never gives a lower estimate.
7. **Harmonized series** (VIIRS-equivalent burning cell-days): mapped MODIS before February 2012, VIIRS as observed afterwards.
8. **Continuation on NOAA-20.** Suomi NPP stopped delivering data on 2 November 2026. The same instrument flies on NOAA-20 (in FIRMS since April 2018). Its detections pass the same filters and are converted to Suomi NPP units with the same two methods, cross-validated on the years both flew (each year of 2018 to 2026 hidden and predicted from NOAA-20 alone). Between two copies of one instrument the plain monthly factor is the default. Typical miss of a yearly total for whole countries: Algeria 3 %, Egypt 3 %, Morocco 5 %, Tunisia 8 %, Libya 10 %, Lebanon 10 %; the factor itself is 0.94 to 1.01. NOAA-20 already supplies the eight months since 2018 in which Suomi NPP was down for three days or more (for example August 2022, 10 days), and the app shows the month in progress from NOAA-20 alone. The MODIS and Suomi NPP record is not changed by this step (a test checks it).
8. **Leave-one-year-out validation.** Each overlap year is hidden, the mapping is fitted on the others, and the hidden year is predicted from MODIS alone. The app shows the result for the selected area and uses the errors as the "likely range" of the older years.

### Why quantile mapping

`node pipeline/model-test.mjs libya` compares three methods (leave-one-year-out, yearly totals):

| Area | Single factor | Baseline + slope | **Quantile mapping** |
|---|---|---|---|
| Libya | miss 30 %, spread 1.53 | miss 17 %, spread 0.28 | **miss 19 %, spread 0.68** |
| Jebel Akhdar | miss 40 %, spread 2.05 | miss 22 %, spread 0.66 | **miss 25 %, spread 1.06** |
| Tripoli and Jefara | miss 64 %, spread 2.71 | miss 18 %, spread 0.60 | **miss 21 %, spread 1.06** |
| Murzuq and Sabha | miss 27 %, spread 1.55 | miss 18 %, spread 0.33 | **miss 20 %, spread 0.94** |

*miss* = mean absolute error as a share of the observed total; *spread* = variability of the predictions relative to reality (1 is ideal). A single factor exaggerates every MODIS peak. Least squares has low error but flattens the record, so no early year could ever look abnormal. Quantile mapping is nearly as accurate and keeps realistic ups and downs, which is what a calendar of anomalies needs. It is not better everywhere. With thirteen countries the pattern is clear: where MODIS misses most fires (small farm fires, North Africa) rank matching wins by a wide margin, and where large forest fires dominate (Galicia, northern Portugal, Attica) plain monthly factors are sometimes better. So the app cross-validates **both** methods on the area the user draws and uses the one that predicts the hidden years best, with rank matching as the default. The summary card names the method that was used and the error of the other one.

### Limits

- Satellites miss fires under cloud and between overpasses.
- A month in which MODIS saw nothing receives the typical small-fire level of such months in 2012 to 2026; this assumes the earlier years were similar.
- A single early month is a rough estimate. Yearly totals and the shape of the season are more reliable.
- Areas where MODIS saw very few fires are flagged in the app, and areas with too few fires since 2012 show no accuracy figure at all.
- The app counts one country at a time: an area that crosses a border only includes the fires of the country selected at the top.
- The record ends with October 2026, the last complete month before Suomi NPP stopped delivering data (2 November 2026). The months from August 2026 come from near-real-time data, which FIRMS has not labelled by source type yet: they only pass our own masks, a few new gas flares may slip through, and the app marks them as preliminary.
- NOAA-20 is joined for the countries whose NOAA-20 download is complete; the others show the record without the NOAA-20 card until then. NOAA-21 is the next step.

## Data

- **NASA FIRMS** active fire archive, yearly country files (public, no key):
  MODIS Collection 6.1 (Terra + Aqua, 1 km), 2000 to 2025, and VIIRS S-NPP 375 m, 2012 to 2025.
- **NASA FIRMS API** (free MAP_KEY) for January to October 2026: standard-processing data as far as it exists, near-real-time data after that, clipped to each country.
  `https://firms.modaps.eosdis.nasa.gov/data/country/`
- **NASA FIRMS API**, VIIRS NOAA-20 375 m (standard product from 1 April 2018, near-real-time after 31 July 2026), clipped to each country.
- **NASA GIBS** Blue Marble Shaded Relief and Bathymetry (basemap tiles).

We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).

## Run it

Requires Node.js 20 or newer. No packages to install.

```bash
node pipeline/download.mjs Libya     # about 50 MB of FIRMS CSV files into raw/
node pipeline/download-latest.mjs 2026-10-31 Libya   # months not yet in the archive (needs a free FIRMS MAP_KEY, see the file header)
node pipeline/find-gaps.mjs 2026-10-31   # satellite outage days (needs Algeria, Libya, Egypt in raw/)
node pipeline/build-data.mjs Libya 2026-10-31   # writes site/data/libya.json
node pipeline/validate.mjs libya     # prints the validation for the ready-made areas
node pipeline/download-noaa20.mjs 2026-11-13 Libya   # VIIRS on NOAA-20, 2018 to today (same MAP_KEY); then run find-gaps and build-data again
node --test pipeline/test.mjs pipeline/test-fixes.mjs pipeline/test-noaa20.mjs   # 36 checks, including a recount from the raw files for every country
node pipeline/serve.mjs              # http://127.0.0.1:8765/
```

`site/` is a static website: any static host can serve it. To add a country, download and build it, then add it to `site/data/index.json`.

### CSV columns

`*_monthly.csv`: `year, month, harmonized_cell_days, likely_low, likely_high, source` (`VIIRS_observed`, `MODIS_converted`, `MODIS_Terra_converted`), `modis_cell_days, viirs_cell_days` (raw counts), `sensor_coverage` (share of the days of the month observed; below 1 means an outage and a scaled count), `median_same_month, percentile_rank` (0 to 1 against the same calendar month of other years).

`*_fire-cell-days.csv`: `date, lat_center, lon_center, sensors, night_detection, max_frp_mw`.

## Use of AI

- The idea (a harmonized burning calendar) comes from the challenge statement; the team chose the challenge and the Jebel Akhdar story.
- The code in this repository was written with the help of an AI coding assistant (Claude, by Anthropic), directed and reviewed by the team.
- No AI-generated images or video are used. The map imagery is real NASA satellite imagery.

## Third-party software

[Leaflet](https://leafletjs.com) 1.9.4 (BSD 2-Clause), included in `site/vendor/leaflet`. Country outlines used to clip API downloads: [Natural Earth](https://www.naturalearthdata.com) 1:10m (public domain).

## License

MIT, see `LICENSE`. Not an official NASA product.
