# floodwarning

A lightweight static web dashboard for viewing time-sliced flood risk data on an interactive map.

## Quick start

- Open `index.html` in a browser (or serve this folder with any static server).
- Use the date picker to switch days.

## Data format (drop-in)

Put one GeoJSON file per date in `data/`:

- `data/2026-06-01.geojson`
- `data/2026-06-02.geojson`

and list which dates exist in `data/index.json`.

### GeoJSON requirements

Each feature should be a polygon/multipolygon (or point/line if you prefer) with:

- `properties.risk` as a number 0–1 (used for coloring)
- optional `properties.name` (shown in popup)

Example is included in `data/2026-06-01.geojson`.

## Customizing the legend/colors

Edit `app.js`:

- `RISK_BREAKS` controls bucket thresholds
- `RISK_COLORS` controls the colors for each bucket