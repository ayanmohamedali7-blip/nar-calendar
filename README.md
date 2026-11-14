# Nar Calendar

**One fire record from two generations of NASA satellites, 2000 to today.**

Team **Sawissi Lab** (Libya) · NASA Space Apps Challenge 2026 · Challenge: *Harmonization of MODIS and VIIRS Hot Spots*

*Nar* (نار) is the Arabic word for fire.

Draw any area on the map (or type its coordinates) and Nar Calendar shows:

- a **burning calendar**: fire activity for every month since November 2000, in one consistent unit;
- how each month compares with what is **normal** for that month (median of all years);
- the **fire season**, the most active years and months;
- how far the older, MODIS-based years can be **trusted**, measured rather than assumed;
- **CSV downloads** of everything.

Country packs so far: **Libya**, where the story started (the forests of Jebel Akhdar, the Green Mountain), **Algeria**, **Egypt** and **Tunisia**. Any other country is two commands away (see "Run it").

The record matches events people remember: the Kabylie fires of August 2021 and Algeria's 2012 season stand out, and so does the autumn rice-straw burning of the Nile Delta. Validation of yearly totals (each year hidden, then predicted from MODIS alone): Algeria misses by 7 %, the Nile Delta by 9 %, Libya by 17 %, Jebel Akhdar by 26 %.

## The problem

MODIS (Terra, Aqua) has mapped active fire since November 2000 with 1 km pixels. VIIRS (Suomi NPP) started in January 2012 with 375 m pixels and sees many small fires that MODIS misses. Put side by side, the two records show a jump in 2012 that never happened on the ground. In our Libya data VIIRS reports about nine times more burning cells than MODIS, and the ratio is not constant: it is about 3 in forest (Jebel Akhdar) and about 13 on farmland (Jefara plain). One conversion factor cannot work.

## Method

All steps are in `pipeline/build-data.mjs` (data) and `site/js/harmonize.js` (statistics). The statistics run in the browser for the exact area the user draws.

1. **Keep only real fires.** From the FIRMS archive we keep `type = 0` (presumed vegetation fire) and drop low-confidence detections (MODIS < 30 %, VIIRS `l`).
2. **Static-source mask.** Every 0.01° cell that FIRMS ever labelled as a static source (type 1, 2, 3) is masked together with its neighbours (2 cells for VIIRS, 3 for MODIS). In Libya most "type 0" detections sit right next to oil-field gas flares.
3. **Persistence mask.** Places with heat on 15 or more distinct days spread over 8 or more calendar months are not seasonal fires (industry, dumps, unlabelled flares) and are removed.
   In Libya these three steps keep **1.8 %** of 684,010 hot spots; in Algeria 10 %, in Egypt 12 %, in Tunisia 37 %.
4. **One unit.** Both sensors are placed on the same 0.01° grid (about 1 km). A cell with at least one detection on a day is one **burning cell-day**, whatever the pixel size.
5. **Satellite outages.** A satellite that is down for ten days makes a month look quiet. `pipeline/find-gaps.mjs` finds every day on which a sensor delivered no detection of any kind across three flare-rich countries (gas flares burn daily, so such a day is an outage: for example S-NPP from 27 July to 10 August 2022, Terra from 15 June to 2 July 2001). Monthly counts are scaled to a full month by the share of days observed, never by more than 3 times, and the app marks those months.
6. **Quantile mapping** on the overlap (February 2012 to December 2025). The monthly MODIS counts and the monthly VIIRS counts of the area are each sorted; a MODIS value is converted to the VIIRS value with the same rank. Months where MODIS saw nothing get the mean of the matching VIIRS ranks, modulated by season. Before July 2002 only Terra was flying, so that period has its own mapping. Two guards keep small areas sane: an estimate is never below the MODIS count itself, and more MODIS fire never gives a lower estimate.
7. **Harmonized series** (VIIRS-equivalent burning cell-days): mapped MODIS before February 2012, VIIRS as observed afterwards.
8. **Leave-one-year-out validation.** Each overlap year is hidden, the mapping is fitted on the others, and the hidden year is predicted from MODIS alone. The app shows the result for the selected area and uses the errors as the "likely range" of the older years.

### Why quantile mapping

`node pipeline/model-test.mjs libya` compares three methods (leave-one-year-out, yearly totals):

| Area | Single factor | Baseline + slope | **Quantile mapping** |
|---|---|---|---|
| Libya | miss 29 %, spread 1.44 | miss 17 %, spread 0.23 | **miss 17 %, spread 0.64** |
| Jebel Akhdar | miss 39 %, spread 2.05 | miss 21 %, spread 0.65 | **miss 26 %, spread 1.06** |
| Tripoli and Jefara | miss 63 %, spread 2.62 | miss 19 %, spread 0.59 | **miss 21 %, spread 1.04** |
| Murzuq and Sabha | miss 26 %, spread 1.77 | miss 16 %, spread 0.37 | **miss 19 %, spread 1.07** |

*miss* = mean absolute error as a share of the observed total; *spread* = variability of the predictions relative to reality (1 is ideal). A single factor exaggerates every MODIS peak. Least squares has low error but flattens the record, so no early year could ever look abnormal. Quantile mapping is nearly as accurate and keeps realistic ups and downs, which is what a calendar of anomalies needs. It is not better everywhere: for Egypt as a whole and for two Tunisian areas the monthly factors do as well or better, and the app says so for the area on screen instead of claiming an improvement.

### Limits

- Satellites miss fires under cloud and between overpasses.
- A month in which MODIS saw nothing receives the typical small-fire level of such months in 2012 to 2025; this assumes the earlier years were similar.
- A single early month is a rough estimate. Yearly totals and the shape of the season are more reliable.
- Areas where MODIS saw very few fires are flagged in the app, and areas with too few fires since 2012 show no accuracy figure at all.
- The app counts one country at a time: an area that crosses a border only includes the fires of the country selected at the top.
- The archive files end in December 2025. Near-real-time months of 2026 need the FIRMS API.

## Data

- **NASA FIRMS** active fire archive, yearly country files (public, no key):
  MODIS Collection 6.1 (Terra + Aqua, 1 km), 2000 to 2025, and VIIRS S-NPP 375 m, 2012 to 2025.
  `https://firms.modaps.eosdis.nasa.gov/data/country/`
- **NASA GIBS** Blue Marble Shaded Relief and Bathymetry (basemap tiles).

We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).

## Run it

Requires Node.js 20 or newer. No packages to install.

```bash
node pipeline/download.mjs Libya     # about 50 MB of FIRMS CSV files into raw/
node pipeline/find-gaps.mjs          # satellite outage days (needs Algeria, Libya, Egypt in raw/)
node pipeline/build-data.mjs Libya   # writes site/data/libya.json
node pipeline/validate.mjs libya     # prints the validation for the ready-made areas
node --test pipeline/test.mjs pipeline/test-fixes.mjs   # 18 checks, including a recount from the raw files
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

[Leaflet](https://leafletjs.com) 1.9.4 (BSD 2-Clause), included in `site/vendor/leaflet`.

## License

MIT, see `LICENSE`. Not an official NASA product.
