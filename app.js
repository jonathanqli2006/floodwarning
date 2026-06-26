/* global L, parseGeoraster, GeoRasterLayer */

const STATUS = document.getElementById("status");
const LEGEND = document.getElementById("legend");
const DATE_INPUT = document.getElementById("dateInput");
const DATE_HELP = document.getElementById("dateHelp");

const CLASSES = {
  1: { color: "rgba(0, 92, 230, 0.7)", label: "Pre-event Water" },
  3: { color: "rgba(219, 0, 0, 0.8)", label: "Flood Inundation" },
};

const MANIFEST_URL = "https://floodtrace-cogs.s3.us-east-2.amazonaws.com/manifest.json";
const ZOOM_THRESHOLD = 7; // below this zoom, show outlines only; at/above, load actual data

// ---- Benchmarking ----
// Logs timing + scene counts to the console every time updateLayers runs,
// so different ZOOM_THRESHOLD values can be compared. Change ZOOM_THRESHOLD
// above, reload, and repeat the same zoom/pan actions to compare numbers.
const BENCHMARK = {
  enabled: true,
  log: [], // { timestamp, zoom, threshold, visibleCount, newlyLoaded, msElapsed, mode }
};

function benchmarkStart() {
  return performance.now();
}

function benchmarkEnd(startTime, info) {
  if (!BENCHMARK.enabled) return;
  const msElapsed = performance.now() - startTime;
  const entry = { timestamp: new Date().toISOString(), msElapsed: Math.round(msElapsed), ...info };
  BENCHMARK.log.push(entry);
  console.log(
    `[benchmark] zoom=${entry.zoom} threshold=${entry.threshold} mode=${entry.mode} ` +
    `visible=${entry.visibleCount} newlyLoaded=${entry.newlyLoaded} time=${entry.msElapsed}ms`
  );
}

// Call this in the browser console (window.printBenchmarkSummary()) to get
// an average load time per scene and a quick table of all recorded events.
window.printBenchmarkSummary = function () {
  if (BENCHMARK.log.length === 0) {
    console.log("No benchmark data yet — zoom/pan the map first.");
    return;
  }
  console.table(BENCHMARK.log);
  const dataEvents = BENCHMARK.log.filter((e) => e.mode === "data" && e.newlyLoaded > 0);
  if (dataEvents.length > 0) {
    const avgPerScene =
      dataEvents.reduce((sum, e) => sum + e.msElapsed / e.newlyLoaded, 0) / dataEvents.length;
    console.log(`Average load time per newly-loaded scene: ${avgPerScene.toFixed(1)}ms`);
  }
};

window.clearBenchmark = function () {
  BENCHMARK.log = [];
  console.log("Benchmark log cleared.");
};

function setStatus(text) {
  STATUS.textContent = text;
}

function renderLegend() {
  LEGEND.innerHTML = "";
  Object.entries(CLASSES).forEach(([val, cls]) => {
    const row = document.createElement("div");
    row.className = "legendItem";

    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = cls.color;

    const text = document.createElement("div");
    text.className = "legendText";
    text.textContent = cls.label;

    row.appendChild(swatch);
    row.appendChild(text);
    LEGEND.appendChild(row);
  });

  // Add outline indicator to legend
  const row = document.createElement("div");
  row.className = "legendItem";
  const swatch = document.createElement("div");
  swatch.className = "swatch";
  swatch.style.background = "transparent";
  swatch.style.border = "2px solid #4a90d9";
  const text = document.createElement("div");
  text.className = "legendText";
  text.textContent = "Scene coverage (zoom in to load)";
  row.appendChild(swatch);
  row.appendChild(text);
  LEGEND.appendChild(row);
}

// Parse capture datetime from filename
// e.g. ..._20251201T133201_20251201T133226_... -> start/end times
function parseSceneTime(filename) {
  const match = filename.match(/(\d{8}T\d{6})_(\d{8}T\d{6})/);
  if (!match) return null;

  const parseTimestamp = (ts) => {
    const year = ts.slice(0, 4);
    const month = ts.slice(4, 6);
    const day = ts.slice(6, 8);
    const hour = ts.slice(9, 11);
    const min = ts.slice(11, 13);
    const sec = ts.slice(13, 15);
    return `${year}-${month}-${day} ${hour}:${min}:${sec} UTC`;
  };

  return {
    start: parseTimestamp(match[1]),
    end: parseTimestamp(match[2]),
  };
}

// Map — start zoomed out (CONUS-style overview), fitBounds will adjust once manifest loads
const map = L.map("map", { zoomControl: true }).setView([45, -100], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

let allScenes = [];
let availableDates = []; // sorted list of unique date strings present in manifest
let selectedDate = null; // currently selected date string, or null = show all dates
const outlineLayers = new Map(); // filename -> L.rectangle
const dataLayers = new Map(); // filename -> GeoRasterLayer
let outlineGroup = L.layerGroup().addTo(map);
let dataGroup = L.layerGroup().addTo(map);

function boundsToLatLngBounds(bounds) {
  // bounds = [west, south, east, north]
  return L.latLngBounds([bounds[1], bounds[0]], [bounds[3], bounds[2]]);
}

function popupHtml(scene) {
  const time = parseSceneTime(scene.filename);
  const timeHtml = time
    ? `<div><b>Pass start:</b> ${time.start}</div><div><b>Pass end:</b> ${time.end}</div>`
    : "";
  return `
    <div style="font-size:13px; line-height:1.5; max-width:260px;">
      <div style="font-weight:700; margin-bottom:4px;">${scene.date}</div>
      ${timeHtml}
      <div style="margin-top:6px; word-break:break-all; font-size:11px; color:#666;">
        ${scene.filename}
      </div>
    </div>
  `;
}

function addOutline(scene) {
  if (outlineLayers.has(scene.filename)) return;
  const llBounds = boundsToLatLngBounds(scene.bounds);
  const rect = L.rectangle(llBounds, {
    color: "#4a90d9",
    weight: 1.5,
    fillColor: "#4a90d9",
    fillOpacity: 0.05,
  });
  rect.bindPopup(popupHtml(scene));
  outlineLayers.set(scene.filename, rect);
  outlineGroup.addLayer(rect);
}

async function addData(scene) {
  if (dataLayers.has(scene.filename)) return;
  // mark as loading so we don't double-fetch
  dataLayers.set(scene.filename, "loading");

  try {
    const response = await fetch(scene.url);
    const arrayBuffer = await response.arrayBuffer();
    const georaster = await parseGeoraster(arrayBuffer);

    const layer = new GeoRasterLayer({
      georaster,
      opacity: 0.75,
      pixelValuesToColorFn: (values) => {
        const val = values[0];
        if (val === 1) return "rgba(0, 92, 230, 0.7)";
        if (val === 3) return "rgba(219, 0, 0, 0.8)";
        return null;
      },
      resolution: 256,
    });

    layer.bindPopup(popupHtml(scene));
    dataLayers.set(scene.filename, layer);
    if (map.getZoom() >= ZOOM_THRESHOLD) {
      dataGroup.addLayer(layer);
    }
  } catch (e) {
    console.error(`Failed to load ${scene.filename}:`, e);
    dataLayers.delete(scene.filename);
  }
}

function removeData(filename) {
  const layer = dataLayers.get(filename);
  if (layer && layer !== "loading") {
    dataGroup.removeLayer(layer);
  }
  dataLayers.delete(filename);
}

function getVisibleScenes() {
  const mapBounds = map.getBounds();
  return allScenes.filter((scene) => {
    if (selectedDate && scene.date !== selectedDate) return false;
    const sceneBounds = boundsToLatLngBounds(scene.bounds);
    return mapBounds.intersects(sceneBounds);
  });
}

function getScenesForDate(dateStr) {
  return allScenes.filter((s) => s.date === dateStr);
}

async function selectDate(dateStr) {
  selectedDate = dateStr || null;

  // Clear everything currently shown - we're switching context
  outlineGroup.clearLayers();
  dataGroup.clearLayers();
  outlineLayers.clear();
  for (const filename of Array.from(dataLayers.keys())) {
    dataLayers.delete(filename);
  }

  const scenesForDate = selectedDate ? getScenesForDate(selectedDate) : allScenes;

  if (scenesForDate.length === 0) {
    setStatus(selectedDate ? `No scenes found for ${selectedDate}.` : "No scenes available.");
    return;
  }

  // Fit map to this date's scene bounds
  const allBounds = scenesForDate.map((s) => boundsToLatLngBounds(s.bounds));
  let combined = allBounds[0];
  allBounds.forEach((b) => (combined = combined.extend(b)));
  map.fitBounds(combined, { padding: [20, 20] });

  await updateLayers();
}

async function updateLayers() {
  const startTime = benchmarkStart();
  const zoom = map.getZoom();
  const visible = getVisibleScenes();
  const visibleFilenames = new Set(visible.map((s) => s.filename));

  if (zoom < ZOOM_THRESHOLD) {
    // Show outlines only, hide data layers
    outlineGroup.clearLayers();
    visible.forEach((scene) => {
      const rect = outlineLayers.get(scene.filename) || (() => {
        addOutline(scene);
        return outlineLayers.get(scene.filename);
      })();
      outlineGroup.addLayer(rect);
    });
    dataGroup.clearLayers();
    setStatus(`Zoomed out — showing ${visible.length} scene outline(s). Zoom in to load data.`);
    benchmarkEnd(startTime, {
      zoom,
      threshold: ZOOM_THRESHOLD,
      mode: "outline",
      visibleCount: visible.length,
      newlyLoaded: 0,
    });
  } else {
    // Show actual data for visible scenes, outlines hidden
    outlineGroup.clearLayers();

    // Remove data layers no longer visible
    for (const filename of Array.from(dataLayers.keys())) {
      if (!visibleFilenames.has(filename)) {
        removeData(filename);
      }
    }

    const toLoad = visible.filter((scene) => !dataLayers.has(scene.filename));

    // Add data layers for newly visible scenes
    setStatus(`Loading ${visible.length} scene(s)...`);
    await Promise.all(toLoad.map((scene) => addData(scene)));
    setStatus(`Showing ${dataLayers.size} scene(s) at current zoom.`);
    benchmarkEnd(startTime, {
      zoom,
      threshold: ZOOM_THRESHOLD,
      mode: "data",
      visibleCount: visible.length,
      newlyLoaded: toLoad.length,
    });
  }
}

let updateTimer = null;
function scheduleUpdate() {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(updateLayers, 250);
}

async function init() {
  renderLegend();
  setStatus("Loading manifest...");

  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    allScenes = manifest.scenes || [];
    setStatus(`Loaded manifest: ${allScenes.length} scene(s) available.`);

    // Build sorted list of unique available dates
    availableDates = Array.from(new Set(allScenes.map((s) => s.date))).sort();

    if (availableDates.length > 0 && DATE_INPUT) {
      DATE_INPUT.min = availableDates[0];
      DATE_INPUT.max = availableDates[availableDates.length - 1];
      if (DATE_HELP) {
        DATE_HELP.textContent = `Available: ${availableDates[0]} → ${availableDates[availableDates.length - 1]} (${availableDates.length} date${availableDates.length === 1 ? "" : "s"})`;
      }

      // Default to the most recent available date
      const defaultDate = availableDates[availableDates.length - 1];
      DATE_INPUT.value = defaultDate;

      DATE_INPUT.addEventListener("change", () => {
        const v = DATE_INPUT.value;
        if (!v) {
          selectDate(null);
          return;
        }
        if (!availableDates.includes(v)) {
          setStatus(`No data for ${v}. Pick a highlighted/available date.`);
          return;
        }
        selectDate(v);
      });
    }

    map.on("moveend zoomend", scheduleUpdate);

    // Initial view: most recent date if available, otherwise all scenes
    if (availableDates.length > 0) {
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