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

  const tiff = await GeoTIFF.fromUrl(url);
  const image = await tiff.getImage();
  const data = await image.readRasters();

  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  const pixels = data[0];

  for (let i = 0; i < pixels.length; i++) {
    const val = pixels[i];
    const idx = i * 4;
    const cls = CLASSES[val];
    if (cls) {
      imageData.data[idx]     = cls.color[0];
      imageData.data[idx + 1] = cls.color[1];
      imageData.data[idx + 2] = cls.color[2];
      imageData.data[idx + 3] = cls.alpha;
    } else {
      imageData.data[idx + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
  overlayLayer = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 1 }).addTo(map);
  map.fitBounds(bounds);
  setStatus("Loaded.");
}

async function init() {
  renderLegend();

  // Replace this URL with your actual S3 object URL once uploaded
  const cogUrl = "https://floodtrace-cogs.s3.us-east-2.amazonaws.com/cogs/test_cog.tif";

  try {
    await loadCOG(cogUrl);
  } catch (e) {
    setStatus("Failed to load COG: " + e.message);
  }
}

init();