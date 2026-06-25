# floodwarning

A lightweight static web dashboard for viewing time-sliced flood risk data on an interactive world map.

## Which setup should I use?

| Approach | Data on your PC? | Best for |
|----------|------------------|----------|
| **Cloud storage** (recommended) | No — browser loads `.tif` from a URL | Teams, production, no Drive sync |
| **Lazy Drive** (`server.py`) | Only the day you view (small cache) | Quick testing while data stays in Drive |
| **Bulk sync** | Yes — all days | Offline work only |

**About “a database”:** GeoTIFF maps are large binary grids. They are normally stored in **object storage** (S3, Google Cloud Storage, Supabase Storage, Azure Blob), not in Postgres/MySQL. A database can hold *metadata* (dates, labels, file URLs); the `.tif` files live in a bucket. Your browser fetches only the day you pick (~1 MB per scene).

---

## Cloud storage (no local download)

### One-time setup (you or your team)

1. Extract RGB `.tif` from each zip (run once on any machine with access to Drive):
   ```bash
   python scripts/sync_siena.py --date 2025-12-01
   ```
2. Upload each `data/YYYY-MM-DD.tif` to a public bucket folder, e.g. `siena/`.
3. Add a `manifest.json` listing dates (see `data/manifest.example.json`).
4. Enable **CORS** on the bucket so the browser can `fetch()` the files.

**Free / easy hosts:** [Supabase Storage](https://supabase.com/docs/guides/storage), [Cloudflare R2](https://developers.cloudflare.com/r2/), AWS S3, Google Cloud Storage.

### Configure the dashboard

Copy `data/index.remote.example.json` → `data/index.json` and set:

```json
{
  "storage": "remote",
  "remoteBaseUrl": "https://YOUR_PROJECT.supabase.co/storage/v1/object/public/siena/",
  "remoteManifestUrl": "https://YOUR_PROJECT.supabase.co/storage/v1/object/public/siena/manifest.json",
  "dates": ["2025-12-01"]
}
```

Run any static server (no `server.py` needed):

```bash
python -m http.server 5173
```

The map loads `https://…/siena/2025-12-01.tif` when you pick that date — nothing stored on your laptop.

**Supabase CORS** (Dashboard → Storage → bucket → Configuration): allow `GET` from `http://localhost:5173` and your production site.

---

## Quick start — lazy Google Drive (no bulk download)

You do **not** need to download every zip. The server lists dates from your Drive folder, then opens **only the zip for the day you pick**.

### 1. Shared with me → shortcut (one-time)

1. [Google Drive](https://drive.google.com) → **Shared with me** → **SIENA**
2. Right-click → **Organize** → **Add shortcut to Drive** → **My Drive**
3. Install [Google Drive for desktop](https://www.google.com/drive/download/)
4. In Drive settings, prefer **Stream files** (not “Mirror entire drive”) so zips stay in the cloud until needed

### 2. Point the app at the folder

Copy `drive.config.example.json` → `drive.config.json`:

```json
{
  "localSienaFolder": "C:\\Users\\jonql\\Google Drive\\My Drive\\SIENA"
}
```

### 3. Run the lazy server + map

```bash
python server.py
```

Open `http://localhost:5173` — pick a date; only that day’s zip is read (~one GeoTIFF per click).

- Small disk cache: last **3** days viewed (`data/.cache/`)
- Change cache: `python server.py --max-cache 1`

### Optional: save one day offline

```bash
python scripts/sync_siena.py --date 2025-12-01
```

### Optional: download everything (not recommended)

```bash
python scripts/sync_siena.py --all
```

### Zip layout

```
SIENA/2025-12-01.zip → …/SIENA_2classes_RGB_….tif  (only files with "RGB" in the name)
```

## GeoTIFF setup (recommended)

**Simple naming** — one file per day:

- `data/2026-06-01.tif`

**Or keep long Sentinel filenames** — map dates to files in `data/index.json` (already configured for the Siena scene):

1. Copy your file into `data/`:

   `SIENA_2classes_RGB_S1C_IW_GRDH_1SDV_20251201T040956_20251201T041021_005253_00A6D4_8E71_sigma0_vv_30m.tif`

2. `data/index.json` already lists `2025-12-01` with:
   - **Class 1** → pixel value `1` (blue)
   - **Class 2** → pixel value `3` (red)
   - **NoData** → pixel value `255` (transparent)

Rename class labels in `index.json` → `raster.classes` if you know what each class means (e.g. flood vs non-flood).

**Continuous risk rasters** (0–100 scale):

```json
{
  "format": "geotiff",
  "dates": ["2026-06-01"],
  "raster": {
    "mode": "continuous",
    "band": 0,
    "min": 0,
    "max": 100,
    "nodata": [-9999]
  }
}
```

**Categorical rasters** (integer class codes):

```json
{
  "raster": {
    "mode": "categorical",
    "nodata": [255],
    "classes": [
      { "value": 1, "label": "Class 1", "color": "#1fa2ff" },
      { "value": 3, "label": "Class 2", "color": "#d62828" }
    ]
  }
}
```

### Inspect your `.tif` values

Cursor cannot preview GeoTIFF, but this script prints bounds, CRS, and suggested `min`/`max`:

```bash
pip install rasterio numpy
python scripts/inspect_geotiff.py path/to/your/file.tif
```

Paste the suggested `raster` block into `data/index.json`.

### Large files

Very large global rasters may load slowly in the browser. If needed, clip or downsample with GDAL:

```bash
gdalwarp -t_srs EPSG:4326 -tr 0.1 0.1 input.tif data/2026-06-01.tif
```

## GeoJSON (optional)

Set `"format": "geojson"` and use `data/YYYY-MM-DD.geojson` with `properties.risk` (0–1) per feature.

## Legend / colors

Edit `app.js`:

- `RISK_BREAKS` — bucket thresholds (0–1)
- `RISK_COLORS` — colors for each bucket
