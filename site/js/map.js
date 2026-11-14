// Leaflet map: NASA GIBS basemap, fire cell layer (canvas), area drawing tools.
/* global L */
import { FLAG } from './harmonize.js';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

/** Canvas layer that draws grid cells as dots. Far cheaper than thousands of markers. */
const CellLayer = L.Layer.extend({
  initialize(draw) { this._draw = draw; },
  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'leaflet-layer');
    this._canvas.style.pointerEvents = 'none';
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on('moveend zoomend resize', this.redraw, this);
    this.redraw();
  },
  onRemove(map) {
    this._canvas.remove();
    map.off('moveend zoomend resize', this.redraw, this);
  },
  redraw() {
    if (!this._map) return;
    const map = this._map;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const c = this._canvas;
    c.width = size.x * dpr;
    c.height = size.y * dpr;
    c.style.width = size.x + 'px';
    c.style.height = size.y + 'px';
    L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    this._draw(ctx, map, size);
  },
});

export function createMap(el, { onArea, onDrawState }) {
  // On phones a one-finger drag must scroll the page, not trap it inside the map:
  // there the map moves with two fingers (pinch) and with the + / - buttons.
  const touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const map = L.map(el, { zoomSnap: 0.25, worldCopyJump: true, attributionControl: true, doubleClickZoom: true, fadeAnimation: false, dragging: !touch });
  // The page scrolls past the map: only zoom with the wheel after the map has been clicked.
  map.scrollWheelZoom.disable();
  map.on('click', () => map.scrollWheelZoom.enable());
  map.getContainer().addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer(`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`, {
    maxNativeZoom: 8, maxZoom: 13, attribution: 'Imagery: NASA GIBS / Blue Marble',
  }).addTo(map);
  // Place names come from our own short list per country (data/index.json): the NASA GIBS label
  // layer returns broken tiles for parts of North Africa.
  const placeLayer = L.layerGroup().addTo(map);
  function setPlaces(places) {
    placeLayer.clearLayers();
    for (const p of places || []) {
      L.marker([p.lat, p.lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'place', html: `<span></span>${p.name}`, iconSize: null }) }).addTo(placeLayer);
    }
  }

  let P = null;
  let idx = [];            // record indices inside the area
  let selMonth = -1;       // highlighted month index
  let showStatic = false;

  const dot = (ctx, map, lat, lon, r) => {
    const p = map.latLngToContainerPoint([lat, lon]);
    ctx.moveTo(p.x + r, p.y);
    ctx.arc(p.x, p.y, r, 0, 6.2832);
  };
  const layer = new CellLayer((ctx, m, size) => {
    if (!P) return;
    const z = m.getZoom();
    const r = Math.max(1.6, Math.min(7, 0.9 * Math.pow(2, z - 7.5)));
    const b = m.getBounds().pad(0.05);
    const half = 0.5 / P.res;
    const vis = (lat, lon) => lat >= b.getSouth() && lat <= b.getNorth() && lon >= b.getWest() && lon <= b.getEast();
    if (showStatic) {
      ctx.beginPath();
      for (const s of P.staticCells) { const la = s[0] / P.res + half, lo = s[1] / P.res + half; if (vis(la, lo)) dot(ctx, m, la, lo, r); }
      for (const s of P.persistentCells) { const la = s[0] / P.res + half, lo = s[1] / P.res + half; if (vis(la, lo)) dot(ctx, m, la, lo, r); }
      ctx.fillStyle = 'rgba(96, 196, 255, 0.75)';
      ctx.fill();
    }
    // all fires in the pack: faint; inside the area: solid; selected month: bright
    const inArea = new Uint8Array(P.n);
    for (const i of idx) inArea[i] = 1;
    for (const pass of [0, 1, 2]) {
      ctx.beginPath();
      for (let i = 0; i < P.n; i++) {
        const sel = inArea[i] && P.mi[i] === selMonth;
        const kind = sel ? 2 : inArea[i] ? 1 : 0;
        if (kind !== pass) continue;
        const la = P.a[i] / P.res + half, lo = P.b[i] / P.res + half;
        if (vis(la, lo)) dot(ctx, m, la, lo, pass === 2 ? r + 1.5 : r);
      }
      if (pass === 0) { ctx.fillStyle = 'rgba(240, 138, 60, 0.28)'; ctx.fill(); }
      if (pass === 1) { ctx.fillStyle = 'rgba(255, 122, 26, 0.85)'; ctx.fill(); }
      if (pass === 2) { ctx.fillStyle = '#fff3b0'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#7a2a00'; ctx.stroke(); }
    }
  });
  layer.addTo(map);

  // ---- area outline ----
  let outline = null;
  const outlineStyle = { color: '#ffffff', weight: 2, fill: true, fillColor: '#ffffff', fillOpacity: 0.04, dashArray: '6 5', interactive: false };
  function showArea(area, fit = true) {
    if (outline) { outline.remove(); outline = null; }
    if (area.type === 'box') outline = L.rectangle([[area.box[0], area.box[1]], [area.box[2], area.box[3]]], outlineStyle).addTo(map);
    if (area.type === 'poly') outline = L.polygon(area.ring, outlineStyle).addTo(map);
    if (fit) {
      if (outline) map.fitBounds(outline.getBounds().pad(0.35), { animate: false });
      else if (P) map.fitBounds(packBounds(P), { animate: false });
    }
  }
  function packBounds(pack) {
    let s = 90, n = -90, w = 180, e = -180;
    const all = [pack.staticCells, pack.persistentCells];
    for (let i = 0; i < pack.n; i++) { const la = pack.a[i] / pack.res, lo = pack.b[i] / pack.res; if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; }
    for (const arr of all) for (const c of arr) { const la = c[0] / pack.res, lo = c[1] / pack.res; if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; }
    return [[s, w], [n, e]];
  }

  // ---- drawing tools (click based, so they also work with touch) ----
  let mode = null;
  let pts = [];
  let preview = null;
  const previewStyle = { color: '#f08a3c', weight: 2, fillOpacity: 0.08, interactive: false };
  function stopDraw(silent) {
    mode = null; pts = [];
    if (preview) { preview.remove(); preview = null; }
    map.doubleClickZoom.enable();
    map.getContainer().classList.remove('drawing');
    if (!silent) onDrawState(null);
  }
  function startDraw(kind) {
    stopDraw(true);
    mode = kind;
    map.doubleClickZoom.disable();
    map.getContainer().classList.add('drawing');
    onDrawState(kind === 'rect' ? 'Click one corner of your area' : 'Click the corners of your area one by one');
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  function finishPoly() {
    if (pts.length < 3) return;
    const ring = pts.map((p) => [r2(p.lat), r2(p.lng)]);
    stopDraw();
    onArea({ type: 'poly', ring, name: 'Custom polygon' });
  }
  map.on('click', (ev) => {
    if (!mode) return;
    // a second click on the same spot (the two clicks of a double-click) is not a new corner
    if (pts.length && map.latLngToContainerPoint(pts[pts.length - 1]).distanceTo(ev.containerPoint) < 6) return;
    if (mode === 'rect') {
      pts.push(ev.latlng);
      if (pts.length === 1) onDrawState('Now click the opposite corner');
      if (pts.length === 2) {
        const [p, q] = pts;
        const box = [r2(Math.min(p.lat, q.lat)), r2(Math.min(p.lng, q.lng)), r2(Math.max(p.lat, q.lat)), r2(Math.max(p.lng, q.lng))];
        stopDraw();
        if (box[2] > box[0] && box[3] > box[1]) onArea({ type: 'box', box, name: 'Custom rectangle' });
      }
    } else if (mode === 'poly') {
      if (pts.length >= 3) {
        const first = map.latLngToContainerPoint(pts[0]);
        if (first.distanceTo(ev.containerPoint) < 14) { finishPoly(); return; }
      }
      pts.push(ev.latlng);
      onDrawState(pts.length < 3 ? `Point ${pts.length} placed. Keep clicking` : 'Click the first point again (or double-click) to finish');
    }
  });
  map.on('dblclick', () => { if (mode === 'poly') finishPoly(); });
  map.on('mousemove', (ev) => {
    if (!mode || !pts.length) return;
    if (preview) preview.remove();
    preview = mode === 'rect'
      ? L.rectangle([pts[0], ev.latlng], previewStyle).addTo(map)
      : L.polygon([...pts, ev.latlng], previewStyle).addTo(map);
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && mode) stopDraw(); });

  return {
    map,
    setPack(pack, places) { P = pack; idx = []; selMonth = -1; setPlaces(places); layer.redraw(); },
    setArea(area, indices, fit = true) { idx = indices; showArea(area, fit); layer.redraw(); },
    setMonth(m) { selMonth = m; layer.redraw(); },
    setShowStatic(v) { showStatic = v; layer.redraw(); },
    startDraw,
    stopDraw,
    get drawing() { return mode; },
  };
}

export const sensorNames = (f) => [f & FLAG.TERRA ? 'Terra' : '', f & FLAG.AQUA ? 'Aqua' : '', f & FLAG.VIIRS ? 'VIIRS' : ''].filter(Boolean).join('+');
