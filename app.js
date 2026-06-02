/* global L */

const STATUS = document.getElementById("status");
const DATE_INPUT = document.getElementById("dateInput");
const DATE_HELP = document.getElementById("dateHelp");
const LEGEND = document.getElementById("legend");

// Buckets are [0..1] risk fractions; adjust for your data.
const RISK_BREAKS = [0.0, 0.1, 0.3, 0.6, 0.8, 1.0];
const RISK_COLORS = ["#0b3cde", "#1fa2ff", "#ffd166", "#f77f00", "#d62828"];
const RISK_LABELS = ["Minimal", "Low", "Moderate", "High", "Severe"];

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function bucketForRisk(risk) {
  const r = clamp01(risk);
  // 5 labels/colors implies 6 breaks
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

function renderLegend() {
  LEGEND.innerHTML = "";
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

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

// Map
const map = L.map("map", { zoomControl: true }).setView([38.9, -77.03], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

let overlayLayer = null;

function featurePopupHtml(props) {
  const name = props?.name ? String(props.name) : "Flood feature";
  const risk = clamp01(props?.risk);
  const pct = Math.round(risk * 100);
  return `<div style="font-weight:800;margin-bottom:6px">${escapeHtml(
    name
  )}</div><div>Risk: <b>${pct}%</b></div>`;
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function setOverlay(geojson) {
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
    // ignore bounds errors for non-polygon layers
  }
}

async function loadDate(dateStr) {
  setStatus(`Loading ${dateStr}…`);
  const geojson = await fetchJson(`data/${dateStr}.geojson`);
  setOverlay(geojson);
  setStatus(`Showing ${dateStr}. Features: ${geojson?.features?.length ?? 0}`);
}

async function init() {
  renderLegend();

  let index;
  try {
    index = await fetchJson("data/index.json");
  } catch (e) {
    setStatus(`Missing data/index.json. Add it to list available dates.`);
    DATE_HELP.textContent = "Expected: data/index.json listing available dates.";
    return;
  }

  const dates = Array.isArray(index?.dates) ? index.dates : [];
  if (dates.length === 0) {
    setStatus("No dates in data/index.json");
    DATE_HELP.textContent = "Add dates like 2026-06-01 and matching GeoJSON files.";
    return;
  }

  // Sort ISO dates ascending
  dates.sort();
  const min = dates[0];
  const max = dates[dates.length - 1];

  DATE_INPUT.min = min;
  DATE_INPUT.max = max;

  const today = fmtDate(new Date());
  const defaultDate = dates.includes(today) ? today : max;
  DATE_INPUT.value = defaultDate;

  DATE_HELP.textContent = `Available: ${min} → ${max}`;

  DATE_INPUT.addEventListener("change", async () => {
    const v = DATE_INPUT.value;
    if (!dates.includes(v)) {
      clearOverlay();
      setStatus(`No data for ${v}. Pick a listed date.`);
      return;
    }
    try {
      await loadDate(v);
    } catch (e) {
      clearOverlay();
      setStatus(`Failed to load ${v}.geojson`);
    }
  });

  try {
    await loadDate(defaultDate);
  } catch (e) {
    clearOverlay();
    setStatus(`Failed to load ${defaultDate}.geojson`);
  }
}

init();

