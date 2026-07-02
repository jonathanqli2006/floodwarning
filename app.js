/* global L, parseGeoraster, GeoRasterLayer */

const STATUS      = document.getElementById("status");
const LEGEND      = document.getElementById("legend");
const SCALE_LINE  = document.getElementById("scaleBarLine");
const SCALE_LABEL = document.getElementById("scaleBarLabel");
const CAL_GRID    = document.getElementById("calGrid");
const CAL_MONTH   = document.getElementById("calMonthLabel");
const CAL_PREV    = document.getElementById("calPrev");
const CAL_NEXT    = document.getElementById("calNext");
const CAL_SELECTED = document.getElementById("calSelected");

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
  BENCHMARK.log.push({ timestamp: new Date().toISOString(), msElapsed: ms, ...info });
  console.log(`[benchmark] zoom=${info.zoom} mode=${info.mode} visible=${info.visibleCount} newlyLoaded=${info.newlyLoaded} time=${ms}ms`);
}
window.printBenchmarkSummary = () => {
  if (!BENCHMARK.log.length) { console.log("No data yet."); return; }
  console.table(BENCHMARK.log);
};
window.clearBenchmark = () => { BENCHMARK.log = []; };

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
    ${t ? `<div class="popup-row"><b>Pass start</b> ${t.start}</div>
           <div class="popup-row"><b>Pass end&nbsp;</b> ${t.end}</div>` : ""}
    <div class="popup-filename">${scene.filename}</div>
  `;
}

function renderLegend() {
  LEGEND.innerHTML = "";
  Object.entries(CLASSES).forEach(([, cls]) => {
    const row = document.createElement("div"); row.className = "legendItem";
    const sw  = document.createElement("div"); sw.className  = "swatch";
    sw.style.background = cls.color;
    const lbl = document.createElement("div"); lbl.className = "legendText";
    lbl.textContent = cls.label;
    row.append(sw, lbl); LEGEND.appendChild(row);
  });
  const row = document.createElement("div"); row.className = "legendItem";
  const sw  = document.createElement("div"); sw.className  = "swatch";
  sw.style.cssText = "background:transparent;border:1.5px solid rgba(0,212,255,0.5)";
  const lbl = document.createElement("div"); lbl.className = "legendText";
  lbl.style.color = "#5a7090"; lbl.textContent = "Scene outline (zoom in to load)";
  row.append(sw, lbl); LEGEND.appendChild(row);
}

// ── Calendar ──────────────────────────────────────────────────────────────────
const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];
const DAY_HEADERS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let availableDatesSet = new Set();
let selectedDate = null;

function renderCalendar() {
  CAL_MONTH.textContent = `${MONTH_NAMES[calMonth]} ${calYear}`;
  CAL_GRID.innerHTML = "";

  // Day headers
  DAY_HEADERS.forEach(d => {
    const h = document.createElement("div"); h.className = "cal-day-header";
    h.textContent = d; CAL_GRID.appendChild(h);
  });

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    const e = document.createElement("div"); e.className = "cal-day empty";
    CAL_GRID.appendChild(e);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const cell = document.createElement("div");
    cell.className = "cal-day";
    cell.textContent = d;

    if (availableDatesSet.has(dateStr)) {
      cell.classList.add("has-data");
      cell.addEventListener("click", () => pickDate(dateStr));
    }
    if (dateStr === selectedDate) cell.classList.add("selected");
    CAL_GRID.appendChild(cell);
  }
}

function pickDate(dateStr) {
  selectedDate = dateStr;
  CAL_SELECTED.textContent = dateStr;
  renderCalendar(); // re-render to update selected highlight
  selectDate(dateStr);
}

CAL_PREV.addEventListener("click", () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});

CAL_NEXT.addEventListener("click", () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

// ── Scale bar ─────────────────────────────────────────────────────────────────
function updateScaleBar() {
  const lat  = map.getCenter().lat;
  const zoom = map.getZoom();
  const mpp  = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
  const maxM = mpp * 120;
  const steps = [1,2,5,10,20,50,100,200,500,1000,2000,5000,10000,20000,50000,100000,200000,500000];
  let dist = steps[0];
  for (const s of steps) { if (s <= maxM) dist = s; else break; }
  SCALE_LINE.style.width  = `${Math.round(dist / mpp)}px`;
  SCALE_LABEL.textContent = dist >= 1000 ? `${dist/1000} km` : `${dist} m`;
}

// ── Map ───────────────────────────────────────────────────────────────────────
const map = L.map("map", { 
  zoomControl: true,
  minZoom: 3,        // prevents zooming out so far the world repeats
  maxBoundsViscosity: 1.0,
}).setView([45, -100], 4);

// Lock the map to one instance of the world
map.setMaxBounds([[-90, -180], [90, 180]]);

// CartoDB Dark Matter — free, no API key required, dark minimal basemap
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  minZoom: 3,
  noWrap: true,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
}).addTo(map);

map.on("moveend zoomend", updateScaleBar);

let allScenes    = [];
const outlineLayers  = new Map();
const dataLayers     = new Map();
const georasterCache = new Map();
const outlineGroup   = L.layerGroup().addTo(map);
const dataGroup      = L.layerGroup().addTo(map);

function boundsToLatLng(b) {
  return L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
}

// ── Layers ────────────────────────────────────────────────────────────────────
function addOutline(scene) {
  if (outlineLayers.has(scene.filename)) return;
  const rect = L.rectangle(boundsToLatLng(scene.bounds), {
    color: "rgba(0,212,255,0.6)", weight: 1,
    fillColor: "rgba(0,212,255,0.03)", fillOpacity: 1,
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
      gr = await parseGeoraster(await (await fetch(scene.url)).arrayBuffer());
      georasterCache.set(scene.filename, gr);
    }
    const layer = new GeoRasterLayer({
      georaster: gr, opacity: 0.85,
      pixelValuesToColorFn: v => {
        if (v[0] === 1) return "rgba(74,158,255,0.75)";
        if (v[0] === 3) return "rgba(255,59,59,0.85)";
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

function removeData(fn) {
  const l = dataLayers.get(fn);
  if (l && l !== "loading") dataGroup.removeLayer(l);
  dataLayers.delete(fn);
}

function getVisibleScenes() {
  const mb = map.getBounds();
  return allScenes.filter(s => {
    if (selectedDate && s.date !== selectedDate) return false;
    return mb.intersects(boundsToLatLng(s.bounds));
  });
}

async function selectDate(dateStr) {
  selectedDate = dateStr || null;
  outlineGroup.clearLayers(); dataGroup.clearLayers();
  outlineLayers.clear(); dataLayers.clear();

  const scenes = selectedDate ? allScenes.filter(s => s.date === selectedDate) : allScenes;
  if (!scenes.length) { setStatus(selectedDate ? `No scenes for ${selectedDate}.` : "No scenes."); return; }

  let combined = boundsToLatLng(scenes[0].bounds);
  scenes.forEach(s => (combined = combined.extend(boundsToLatLng(s.bounds))));
  map.fitBounds(combined, { padding: [20, 20] });
  await updateLayers();
}

async function updateLayers() {
  const t0 = benchmarkStart();
  const zoom = map.getZoom();
  const visible = getVisibleScenes();
  const visSet = new Set(visible.map(s => s.filename));

  if (zoom < ZOOM_THRESHOLD) {
    outlineGroup.clearLayers();
    visible.forEach(scene => {
      const r = outlineLayers.get(scene.filename) || (() => { addOutline(scene); return outlineLayers.get(scene.filename); })();
      outlineGroup.addLayer(r);
    });
    dataGroup.clearLayers(); dataLayers.clear();
    setStatus(`${visible.length} scene outline${visible.length !== 1 ? "s" : ""} — zoom in to load data`);
    benchmarkEnd(t0, { zoom, mode: "outline", visibleCount: visible.length, newlyLoaded: 0 });
  } else {
    outlineGroup.clearLayers();
    for (const fn of Array.from(dataLayers.keys())) { if (!visSet.has(fn)) removeData(fn); }
    const toLoad = visible.filter(s => !dataLayers.has(s.filename));
    setStatus(`Loading ${toLoad.length} scene${toLoad.length !== 1 ? "s" : ""}…`);
    await Promise.all(toLoad.map(addData));
    setStatus(`${dataLayers.size} scene${dataLayers.size !== 1 ? "s" : ""} loaded`);
    benchmarkEnd(t0, { zoom, mode: "data", visibleCount: visible.length, newlyLoaded: toLoad.length });
  }
}

let updateTimer = null;
function scheduleUpdate() { clearTimeout(updateTimer); updateTimer = setTimeout(updateLayers, 250); }

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

    const dates = Array.from(new Set(allScenes.map(s => s.date))).sort();
    availableDatesSet = new Set(dates);

    // Navigate calendar to most recent date's month
    if (dates.length) {
      const latest = dates[dates.length - 1];
      const [y, m] = latest.split("-").map(Number);
      calYear  = y;
      calMonth = m - 1;
    }
    renderCalendar();

    map.on("moveend zoomend", scheduleUpdate);

    if (dates.length) {
      const latest = dates[dates.length - 1];
      selectedDate = latest;
      CAL_SELECTED.textContent = latest;
      renderCalendar();
      await selectDate(latest);
    } else {
      await selectDate(null);
    }
  } catch (e) {
    setStatus("Failed to load manifest: " + e.message);
    console.error(e);
  }
}

init();