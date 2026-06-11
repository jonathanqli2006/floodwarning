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

let overlayLayer = null;

function clearOverlay() {
  if (!overlayLayer) return;
  map.removeLayer(overlayLayer);
  overlayLayer = null;
}

async function loadCOG(url) {
  clearOverlay();
  setStatus("Loading COG...");

  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const georaster = await parseGeoraster(arrayBuffer);

    overlayLayer = new GeoRasterLayer({
      georaster,
      opacity: 0.7,
      pixelValuesToColorFn: (values) => {
        const val = values[0];
        if (val === 1) return "rgba(0, 92, 230, 0.7)";
        if (val === 3) return "rgba(219, 0, 0, 0.8)";
        return null;
      },
      resolution: 256,
    });

    overlayLayer.addTo(map);
    map.fitBounds(overlayLayer.getBounds());
    setStatus("Loaded.");
  } catch (e) {
    setStatus("Failed to load COG: " + e.message);
    console.error(e);
  }
}

async function init() {
  renderLegend();
  const cogUrl = "https://floodtrace-cogs.s3.us-east-2.amazonaws.com/test_cog.tif";
  await loadCOG(cogUrl);
}

init();