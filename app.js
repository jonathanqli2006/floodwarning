/* global L, GeoTIFF */

const STATUS = document.getElementById("status");
const DATE_INPUT = document.getElementById("dateInput");
const DATE_HELP = document.getElementById("dateHelp");
const LEGEND = document.getElementById("legend");

const CLASSES = {
  1: { color: [0, 92, 230], label: "Pre-event Water", alpha: 180 },
  3: { color: [219, 0, 0], label: "Flood Inundation", alpha: 200 },
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
    swatch.style.background = `rgb(${cls.color.join(",")})`;

    const text = document.createElement("div");
    text.className = "legendText";
    text.textContent = cls.label;

    row.appendChild(swatch);
    row.appendChild(text);
    LEGEND.appendChild(row);
  });
}

// Map
const map = L.map("map", { zoomControl: true }).setView([38.9, -77.03], 6);

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
      return null; // transparent for nodata
    },
    resolution: 256,
  });

  overlayLayer.addTo(map);
  map.fitBounds(overlayLayer.getBounds());
  setStatus("Loaded.");
}

async function init() {
  renderLegend();

  // Replace this URL with your actual S3 object URL once uploaded
  const cogUrl = "https://floodtrace-cogs.s3.us-east-2.amazonaws.com/test_cog.tif";  
  try {
    await loadCOG(cogUrl);
  } catch (e) {
    setStatus("Failed to load COG: " + e.message);
  }
}

init();