/* global L, parseGeoraster, GeoRasterLayer */

const STATUS    = document.getElementById("status");
const LEGEND    = document.getElementById("legend");
const DATE_INPUT = document.getElementById("dateInput");
const DATE_HELP  = document.getElementById("dateHelp");
const SCALE_LINE  = document.getElementById("scaleBarLine");
const SCALE_LABEL = document.getElementById("scaleBarLabel");

const CLASSES = {
  1: { color: "rgba(74, 158, 255, 0.75)",  label: "Pre-event Water" },
  3: { color: "rgba(255, 59, 59, 0.85)",   label: "Flood Inundation" },
};

const MANIFEST_URL   = "https://floodtrace-cogs.s3.us-east-2.amazonaws.com/manifest.json";
const ZOOM_THRESHOLD = 7;

// ── Benchmarking ──────────────────────────────────────────────────────────────
const BENCHMARK = { enabled: true, log: [] };

function benchmarkStart() { return performance.now(); }

function benchmarkEnd(t0, info) {
  if (!BENCHMARK.enabled) return;
  const ms = Math.round(performance.now() - t0);
  const entry = { timestamp: new Date().toISOString(), msElapsed: ms, ...info };
  BENCHMARK.log.push(entry);
  console.log(`[benchmark] zoom=${entry.zoom} threshold=${ZOOM_THRESHOLD} mode=${entry.mode} visible=${entry.visibleCount} newlyLoaded=${entry.newlyLoaded} time=${ms}ms`);
}

window.printBenchmarkSummary = () => {
  if (!BENCHMARK.log.length) { console.log("No data yet."); return; }
  console.table(BENCHMARK.log);
  const data = BENCHMARK.log.filter(e => e.mode === "data" && e.newlyLoaded > 0);
  if (data.length) {
    const avg = data.reduce((s, e) => s + e.msElapsed / e.newlyLoaded, 0) / data.length;
    console.log(`Avg ms per scene: ${avg.toFixed(1)}`);
  }
};
window.clearBenchmark = () => { BENCHMARK.log = []; console.log("Cleared."); };

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(text) { STATUS.textContent = text; }

function parseSceneTime(filename) {
  const m = filename.match(/(\d{8}T\d{6})_(\d{8}T\d{6})/);
  if (!m) return null;
  const fmt = ts =>
    `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}:${ts.slice(13,15)} UTC`;
  return { start: fmt(m[1]), end: fmt(m[2]) };
}

function popupHtml(scene) {
  const t = parseSceneTime(scene.filename);
  return `
    <div class="popup-date">${scene.date}</div>
    ${t ? `
      <div class="popup-row"><b>Pass start</b> ${t.start}</div>
      <div class="popup-row"><b>Pass end&nbsp;</b> ${t.end}</div>
    ` : ""}
    <div class="popup-filename">${scene.filename}</div>
  `;
}

function renderLegend() {
  LEGEND.innerHTML = "";
  Object.entries(CLASSES).forEach(([, cls]) => {
    const row   = document.createElement("div");  row.className = "legendItem";
    const sw    = document.createElement("div");  sw.className  = "swatch";
    sw.style.background = cls.color;
    const label = document.createElement("div");  label.className = "legendText";
    label.textContent = cls.label;
    row.appendChild(sw); row.appendChild(label); LEGEND.appendChild(row);
  });
  // outline entry
  const row = document.createElement("div"); row.className = "legendItem";
  const sw  = document.createElement("div"); sw.className  = "swatch";
  sw.style.background = "transparent";
  sw.style.border     = "1.5px solid rgba(0,212,255,0.5)";
  const label = document.createElement("div"); label.className = "legendText";
  label.style.color = "#5a7090";
  label.textContent = "Scene outline (zoom in to load)";
  row.appendChild(sw); row.appendChild(label); LEGEND.appendChild(row);
}

// ── Scale bar ─────────────────────────────────────────────────────────────────
// Computes a round-number distance label for the current zoom / latitude.
function updateScaleBar() {
  const center  = map.getCenter();
  const zoom    = map.getZoom();
  const latRad  = center.lat * Math.PI / 180;
  // metres per pixel at this zoom & latitude
  const mpp     = (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);

  // Pick the largest round number that fits in ~120px
  const maxPx   = 120;
  const maxM    = mpp * maxPx;

  const steps   = [1,2,5,10,20,50,100,200,500,1000,2000,5000,10000,20000,50000,100000,200000,500000];
  let dist      = steps[0];
  for (const s of steps) { if (s <= maxM) dist = s; else break; }

  const px      = dist / mpp;
  const label   = dist >= 1000 ? `${dist/1000} km` : `${dist} m`;

  SCALE_LINE.style.width  = `${Math.round(px)}px`;
  SCALE_LABEL.textContent = label;
}

// ── Map ───────────────────────────────────────────────────────────────────────
const map = L.map("map", { zoomControl: true, attributionControl: true }).setView([45, -100], 4);

// Dark minimal basemap — Stadia Alidade Smooth Dark
// Falls back to CartoDB Dark Matter if Stadia is unavailable
L.tileLayer("https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

map.on("moveend zoomend", updateScaleBar);

let allScenes     = [];
let availableDates = [];
let selectedDate  = null;

const outlineLayers  = new Map();
const dataLayers     = new Map();
const georasterCache = new Map();
let outlineGroup     = L.layerGroup().addTo(map);
let dataGroup        = L.layerGroup().addTo(map);

function boundsToLatLng(bounds) {
  return L.latLngBounds([bounds[1], bounds[0]], [bounds[3], bounds[2]]);
}

// ── Layer management ──────────────────────────────────────────────────────────
function addOutline(scene) {
  if (outlineLayers.has(scene.filename)) return;
  const rect = L.rectangle(boundsToLatLng(scene.bounds), {
    color:       "rgba(0,212,255,0.6)",
    weight:      1,
    fillColor:   "rgba(0,212,255,0.03)",
    fillOpacity: 1,
  });
  rect.bindPopup(popupHtml(scene));
  outlineLayers.set(scene.filename, rect);
  outlineGroup.addLayer(rect);
}

async function addData(scene) {
  if (dataLayers.has(scene.filename)) return;
  dataLayers.set(scene.filename, "loading");
  try {
    let gr = georasterCache.get(scene.filename);
    if (!gr) {
      const buf = await (await fetch(scene.url)).arrayBuffer();
      gr = await parseGeoraster(buf);
      georasterCache.set(scene.filename, gr);
    }
    const layer = new GeoRasterLayer({
      georaster: gr,
      opacity: 0.85,
      pixelValuesToColorFn: vals => {
        if (vals[0] === 1) return "rgba(74,158,255,0.75)";
        if (vals[0] === 3) return "rgba(255,59,59,0.85)";
        return null;
      },
      resolution: 128,
    });
    layer.bindPopup(popupHtml(scene));
    dataLayers.set(scene.filename, layer);
    if (map.getZoom() >= ZOOM_THRESHOLD) dataGroup.addLayer(layer);
  } catch (e) {
    console.error(`Failed: ${scene.filename}`, e);
    dataLayers.delete(scene.filename);
  }
}

function removeData(filename) {
  const l = dataLayers.get(filename);
  if (l && l !== "loading") dataGroup.removeLayer(l);
  dataLayers.delete(filename);
}

function getVisibleScenes() {
  const mb = map.getBounds();
  return allScenes.filter(s => {
    if (selectedDate && s.date !== selectedDate) return false;
    return mb.intersects(boundsToLatLng(s.bounds));
  });
}

function getScenesForDate(d) { return allScenes.filter(s => s.date === d); }

async function selectDate(dateStr) {
  selectedDate = dateStr || null;
  outlineGroup.clearLayers();
  dataGroup.clearLayers();
  outlineLayers.clear();
  dataLayers.clear();

  const scenes = selectedDate ? getScenesForDate(selectedDate) : allScenes;
  if (!scenes.length) {
    setStatus(selectedDate ? `No scenes for ${selectedDate}.` : "No scenes available.");
    return;
  }

  let combined = boundsToLatLng(scenes[0].bounds);
  scenes.forEach(s => (combined = combined.extend(boundsToLatLng(s.bounds))));
  map.fitBounds(combined, { padding: [20, 20] });

  await updateLayers();
}

async function updateLayers() {
  const t0      = benchmarkStart();
  const zoom    = map.getZoom();
  const visible = getVisibleScenes();
  const visSet  = new Set(visible.map(s => s.filename));

  if (zoom < ZOOM_THRESHOLD) {
    outlineGroup.clearLayers();
    visible.forEach(scene => {
      const r = outlineLayers.get(scene.filename) || (() => { addOutline(scene); return outlineLayers.get(scene.filename); })();
      outlineGroup.addLayer(r);
    });
    dataGroup.clearLayers();
    dataLayers.clear();
    setStatus(`${visible.length} scene outline${visible.length !== 1 ? "s" : ""} — zoom in to load data`);
    benchmarkEnd(t0, { zoom, mode: "outline", visibleCount: visible.length, newlyLoaded: 0 });
  } else {
    outlineGroup.clearLayers();
    for (const fn of Array.from(dataLayers.keys())) {
      if (!visSet.has(fn)) removeData(fn);
    }
    const toLoad = visible.filter(s => !dataLayers.has(s.filename));
    setStatus(`Loading ${toLoad.length} scene${toLoad.length !== 1 ? "s" : ""}…`);
    await Promise.all(toLoad.map(addData));
    setStatus(`${dataLayers.size} scene${dataLayers.size !== 1 ? "s" : ""} loaded`);
    benchmarkEnd(t0, { zoom, mode: "data", visibleCount: visible.length, newlyLoaded: toLoad.length });
  }
}

let updateTimer = null;
function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(updateLayers, 250);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  renderLegend();
  updateScaleBar();
  setStatus("Loading manifest…");

  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    allScenes = manifest.scenes || [];

    availableDates = Array.from(new Set(allScenes.map(s => s.date))).sort();

    if (availableDates.length && DATE_INPUT) {
      DATE_INPUT.min   = availableDates[0];
      DATE_INPUT.max   = availableDates[availableDates.length - 1];
      if (DATE_HELP) {
        DATE_HELP.textContent = `${availableDates[0]}  →  ${availableDates[availableDates.length - 1]}  ·  ${availableDates.length} date${availableDates.length !== 1 ? "s" : ""}`;
      }
      const defaultDate = availableDates[availableDates.length - 1];
      DATE_INPUT.value = defaultDate;
      DATE_INPUT.addEventListener("change", () => {
        const v = DATE_INPUT.value;
        if (!v) { selectDate(null); return; }
        if (!availableDates.includes(v)) { setStatus(`No data for ${v}.`); return; }
        selectDate(v);
      });
    }

    map.on("moveend zoomend", scheduleUpdate);

    if (availableDates.length) {
      await selectDate(availableDates[availableDates.length - 1]);
    } else {
      await selectDate(null);
    }
  } catch (e) {
    setStatus("Failed to load manifest: " + e.message);
    console.error(e);
  }
}

init();