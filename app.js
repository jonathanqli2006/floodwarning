/* global L, parseGeoraster, GeoRasterLayer */

const STATUS = document.getElementById("status");
const DATE_INPUT = document.getElementById("dateInput");
const DATE_HELP = document.getElementById("dateHelp");
const LEGEND = document.getElementById("legend");
const TITLE_EL = document.querySelector(".title");
const SUBTITLE_EL = document.querySelector(".subtitle");

// Continuous (0–1 risk) legend — used when raster.mode !== "categorical"
const RISK_BREAKS = [0.0, 0.1, 0.3, 0.6, 0.8, 1.0];
const RISK_COLORS = ["#0b3cde", "#1fa2ff", "#ffd166", "#f77f00", "#d62828"];
const RISK_LABELS = ["Minimal", "Low", "Moderate", "High", "Severe"];

const DEFAULT_RASTER = {
  mode: "continuous",
  band: 0,
  min: 0,
  max: 1,
  nodata: [-9999, -3.402823466e38],
  classes: [],
};

let dataIndex = null;
let rasterConfig = { ...DEFAULT_RASTER };
let classColorByValue = new Map();

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function bucketForRisk(risk) {
  const r = clamp01(risk);
  for (let i = 0; i < RISK_BREAKS.length - 1; i++) {
    const a = RISK_BREAKS[i];
    const b = RISK_BREAKS[i + 1];
    const isLast = i === RISK_BREAKS.length - 2;
    if ((r >= a && r < b) || (isLast && r === b)) return i;
  }
  return RISK_BREAKS.length - 2;
}

function colorForRisk(risk) {
  return RISK_COLORS[bucketForRisk(risk)];
}

function rangeLabel(i) {
  const a = RISK_BREAKS[i];
  const b = RISK_BREAKS[i + 1];
  const left = Math.round(a * 100);
  const right = Math.round(b * 100);
  return `${RISK_LABELS[i]} (${left}–${right}%)`;
}

function isCategorical() {
  return rasterConfig.mode === "categorical";
}

function rebuildClassLookup() {
  classColorByValue = new Map();
  for (const c of rasterConfig.classes ?? []) {
    classColorByValue.set(Number(c.value), c.color);
  }
}

function colorForClassValue(value) {
  const key = Number(value);
  if (classColorByValue.has(key)) return classColorByValue.get(key);
  return "#888888";
}

function labelForClassValue(value) {
  const key = Number(value);
  const match = (rasterConfig.classes ?? []).find((c) => Number(c.value) === key);
  return match?.label ?? `Value ${key}`;
}

function renderLegend() {
  LEGEND.innerHTML = "";

  if (isCategorical()) {
    for (const c of rasterConfig.classes ?? []) {
      const row = document.createElement("div");
      row.className = "legendItem";

      const swatch = document.createElement("div");
      swatch.className = "swatch";
      swatch.style.background = c.color;

      const text = document.createElement("div");
      text.className = "legendText";
      text.textContent = `${c.label} (pixel ${c.value})`;

      row.appendChild(swatch);
      row.appendChild(text);
      LEGEND.appendChild(row);
    }

    const masked = document.createElement("div");
    masked.className = "legendItem";
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = "transparent";
    swatch.style.borderStyle = "dashed";
    const text = document.createElement("div");
    text.className = "legendText";
    text.textContent = `NoData (pixel ${(rasterConfig.nodata ?? [255]).join(", ")})`;
    masked.appendChild(swatch);
    masked.appendChild(text);
    LEGEND.appendChild(masked);
    return;
  }

  for (let i = 0; i < RISK_COLORS.length; i++) {
    const row = document.createElement("div");
    row.className = "legendItem";

    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = RISK_COLORS[i];

    const text = document.createElement("div");
    text.className = "legendText";
    text.textContent = rangeLabel(i);

    row.appendChild(swatch);
    row.appendChild(text);
    LEGEND.appendChild(row);
  }
}

function setStatus(text) {
  STATUS.textContent = text;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isNodata(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return true;
  const list = rasterConfig.nodata ?? DEFAULT_RASTER.nodata;
  return list.some((n) => value === n || Math.abs(value - n) < 1e-6);
}

function valueToRisk(value) {
  const min = rasterConfig.min ?? DEFAULT_RASTER.min;
  const max = rasterConfig.max ?? DEFAULT_RASTER.max;
  if (max === min) return 0;
  return clamp01((value - min) / (max - min));
}

function colorForPixelValue(value) {
  if (isCategorical()) {
    if (!classColorByValue.has(Number(value))) return null;
    return hexToRgba(colorForClassValue(value), 0.78);
  }
  return hexToRgba(colorForRisk(valueToRisk(value)), 0.72);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

async function fetchArrayBuffer(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.arrayBuffer();
}

const map = L.map("map", { zoomControl: true, worldCopyJump: true }).setView([43.32, 11.33], 8);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

let overlayLayer = null;

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function featurePopupHtml(props) {
  const name = props?.name ? String(props.name) : "Flood feature";
  const risk = clamp01(props?.risk);
  const pct = Math.round(risk * 100);
  return `<div style="font-weight:800;margin-bottom:6px">${escapeHtml(
    name
  )}</div><div>Risk: <b>${pct}%</b></div>`;
}

function geoJsonStyle(feature) {
  const risk = clamp01(feature?.properties?.risk);
  return {
    color: "#0b1020",
    weight: 1,
    opacity: 0.6,
    fillColor: colorForRisk(risk),
    fillOpacity: 0.55,
  };
}

function pointToLayer(_feature, latlng) {
  return L.circleMarker(latlng, {
    radius: 7,
    color: "#0b1020",
    weight: 1,
    opacity: 0.8,
    fillOpacity: 0.8,
  });
}

function onEachFeature(feature, layer) {
  layer.bindPopup(featurePopupHtml(feature?.properties));
}

function clearOverlay() {
  if (!overlayLayer) return;
  map.removeLayer(overlayLayer);
  overlayLayer = null;
}

function fitGeoraster(georaster) {
  const bounds = [
    [georaster.ymin, georaster.xmin],
    [georaster.ymax, georaster.xmax],
  ];
  map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
}

function setGeoJsonOverlay(geojson) {
  clearOverlay();
  overlayLayer = L.geoJSON(geojson, {
    style: geoJsonStyle,
    pointToLayer,
    onEachFeature,
  }).addTo(map);

  try {
    const bounds = overlayLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
  } catch {
    // ignore bounds errors
  }
}

async function setGeotiffOverlay(arrayBuffer) {
  if (typeof parseGeoraster !== "function" || typeof GeoRasterLayer !== "function") {
    throw new Error("GeoTIFF libraries failed to load");
  }

  const georaster = await parseGeoraster(arrayBuffer);
  clearOverlay();

  overlayLayer = new GeoRasterLayer({
    georaster,
    opacity: 0.85,
    resolution: 256,
    pixelValuesToColorFn(values) {
      const band = rasterConfig.band ?? 0;
      const value = values?.[band];
      if (isNodata(value)) return null;
      return colorForPixelValue(value);
    },
  });

  overlayLayer.addTo(map);
  fitGeoraster(georaster);
  return georaster;
}

function preferredFormat() {
  const f = dataIndex?.format;
  if (f === "geojson" || f === "geotiff") return f;
  return "geotiff";
}

function isRemoteStorage() {
  return dataIndex?.storage === "remote" && Boolean(dataIndex?.remoteBaseUrl);
}

function tifUrlForDate(dateStr) {
  if (isRemoteStorage()) {
    const base = String(dataIndex.remoteBaseUrl).replace(/\/?$/, "/");
    const name = dataIndex?.files?.[dateStr] ?? `${dateStr}.tif`;
    return base + name.split("/").map(encodeURIComponent).join("/");
  }
  const filename = dataIndex?.files?.[dateStr] ?? `${dateStr}.tif`;
  return `data/${filename.split("/").map(encodeURIComponent).join("/")}`;
}

async function loadDate(dateStr) {
  const format = preferredFormat();
  setStatus(
    isRemoteStorage()
      ? `Loading ${dateStr} from cloud…`
      : `Loading ${dateStr}… (first view may wait for Drive)`
  );

  if (format === "geotiff") {
    const url = tifUrlForDate(dateStr);
    const buffer = await fetchArrayBuffer(url);
    const georaster = await setGeotiffOverlay(buffer);
    const w = georaster.width;
    const h = georaster.height;
    const mode = isCategorical() ? "2-class" : "continuous";
    setStatus(`Showing ${dateStr} — ${mode} raster (${w}×${h} px)`);
    return;
  }

  const geojson = await fetchJson(`data/${dateStr}.geojson`);
  setGeoJsonOverlay(geojson);
  setStatus(`Showing ${dateStr}. Features: ${geojson?.features?.length ?? 0}`);
}

function applyRasterConfig(index) {
  rasterConfig = { ...DEFAULT_RASTER, ...(index?.raster ?? {}) };
  if (!Array.isArray(rasterConfig.nodata)) {
    rasterConfig.nodata = [rasterConfig.nodata];
  }
  rebuildClassLookup();
  renderLegend();

  if (index?.title && TITLE_EL) TITLE_EL.textContent = index.title;
  if (SUBTITLE_EL) {
    SUBTITLE_EL.textContent = isCategorical()
      ? "Sentinel-1 SAR classification — pick a date"
      : "Select a date to view risk";
  }
}

async function loadAvailableDates(index) {
  if (index?.storage === "remote" && index?.remoteManifestUrl) {
    try {
      const manifest = await fetchJson(index.remoteManifestUrl);
      if (Array.isArray(manifest?.dates) && manifest.dates.length > 0) {
        return { dates: [...manifest.dates], lazy: false, remote: true };
      }
    } catch {
      // fall back to index.json dates
    }
  }

  try {
    const api = await fetchJson("/api/dates");
    if (Array.isArray(api?.dates) && api.dates.length > 0) {
      return { dates: [...api.dates], lazy: Boolean(api.lazy), remote: false };
    }
  } catch {
    // static server or no SIENA folder — use index.json only
  }
  const fromIndex = Array.isArray(index?.dates) ? [...index.dates] : [];
  return { dates: fromIndex, lazy: false, remote: isRemoteStorage() };
}

async function init() {
  let index;
  try {
    index = await fetchJson("data/index.json");
  } catch {
    setStatus("Missing data/index.json");
    DATE_HELP.textContent = "Run: python server.py";
    return;
  }

  dataIndex = index;
  applyRasterConfig(index);

  const { dates: rawDates, lazy, remote } = await loadAvailableDates(index);
  const dates = rawDates;
  if (dates.length === 0) {
    setStatus("No dates found");
    DATE_HELP.textContent = remote
      ? "Check data/index.json remoteBaseUrl and dates"
      : "Run: python server.py (with Drive SIENA shortcut)";
    return;
  }

  dates.sort();
  const min = dates[0];
  const max = dates[dates.length - 1];

  DATE_INPUT.min = min;
  DATE_INPUT.max = max;

  const today = fmtDate(new Date());
  const defaultDate = dates.includes(today) ? today : max;
  DATE_INPUT.value = defaultDate;

  DATE_HELP.textContent = remote
    ? `Available: ${min} → ${max} (streamed from cloud, nothing on your PC)`
    : lazy
      ? `Available: ${min} → ${max} (loads one day at a time from Drive)`
      : `Available: ${min} → ${max}`;

  DATE_INPUT.addEventListener("change", async () => {
    const v = DATE_INPUT.value;
    if (!dates.includes(v)) {
      clearOverlay();
      setStatus(`No data for ${v}. Pick a listed date.`);
      return;
    }
    try {
      await loadDate(v);
    } catch {
      clearOverlay();
      setStatus(`Failed to load ${v}. Is server.py running?`);
    }
  });

  try {
    await loadDate(defaultDate);
  } catch {
    clearOverlay();
    setStatus(`Failed to load ${defaultDate}. Run: python server.py`);
  }
}

init();
