/* global L, parseGeoraster, GeoRasterLayer */

const STATUS = document.getElementById("status");
const LEGEND = document.getElementById("legend");

const CLASSES = {
  1: { color: "rgba(0, 92, 230, 0.7)", label: "Pre-event Water" },
  3: { color: "rgba(219, 0, 0, 0.8)", label: "Flood Inundation" },
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
}

// Map — centered on Alberta/Saskatchewan where the data is
const map = L.map("map", { zoomControl: true }).setView([50.4, -109.7], 8);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

let allScenes = [];
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
    setStatus("Failed to load COG: " + e.message);
    console.error(e);
  }
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

    // Fit map to all scene bounds
    if (allScenes.length > 0) {
      const allBounds = allScenes.map((s) => boundsToLatLngBounds(s.bounds));
      let combined = allBounds[0];
      allBounds.forEach((b) => (combined = combined.extend(b)));
      map.fitBounds(combined, { padding: [20, 20] });
    }

    map.on("moveend zoomend", scheduleUpdate);
    await updateLayers();
  } catch (e) {
    setStatus("Failed to load manifest: " + e.message);
    console.error(e);
  }
}

init();