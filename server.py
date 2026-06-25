#!/usr/bin/env python3
"""
Dashboard server with on-demand SIENA loading.

- Lists dates from your Drive shortcut folder (filenames only — no zip download).
- When you pick a date in the browser, opens ONLY that day's zip and serves the RGB .tif.
- Optional small cache (default: last 3 days viewed).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

# Allow importing scripts/siena_lib.py
sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
from siena_lib import (  # noqa: E402
    extract_rgb_tif_from_zip,
    list_available_dates,
    list_date_zips,
    load_drive_config,
    repo_root,
    resolve_siena_dir,
    zip_path_for_date,
)

DATE_TIF_RE = re.compile(r"^/data/(\d{4}-\d{2}-\d{2})\.tif$")
CACHE_LOCK = threading.Lock()


class DashboardHandler(SimpleHTTPRequestHandler):
    siena_dir: Path
    cache_dir: Path
    max_cache: int
    index_path: Path

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(repo_root()), **kwargs)

    def log_message(self, format: str, *args) -> None:
        if args and str(args[0]).startswith("GET /data/"):
            print(f"[load] {args[0]}")
        elif args and str(args[0]).startswith("GET /api/"):
            pass
        else:
            super().log_message(format, *args)

    def do_GET(self) -> None:
        path = unquote(self.path.split("?", 1)[0])
        if path == "/api/dates":
            self._send_json(self._api_dates())
            return
        m = DATE_TIF_RE.match(path)
        if m:
            self._send_tif(m.group(1))
            return
        super().do_GET()

    def _api_dates(self) -> dict:
        dates = list_available_dates(self.siena_dir)
        return {
            "dates": dates,
            "source": str(self.siena_dir),
            "lazy": True,
            "message": "Only the date you select is downloaded from Drive.",
        }

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_tif(self, date_str: str) -> None:
        cached = self.cache_dir / f"{date_str}.tif"
        try:
            with CACHE_LOCK:
                if not cached.exists():
                    zip_path = zip_path_for_date(self.siena_dir, date_str)
                    print(f"Extracting {zip_path.name} (only this zip is pulled from Drive)…")
                    extract_rgb_tif_from_zip(zip_path, date_str, cached)
                    self._trim_cache(keep=date_str)
                data = cached.read_bytes()
        except FileNotFoundError as e:
            self._send_json({"error": str(e)}, status=404)
            return
        except zipfile.BadZipFile:
            self._send_json({"error": f"Corrupt zip for {date_str}"}, status=500)
            return

        self.send_response(200)
        self.send_header("Content-Type", "image/tiff")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        self.wfile.write(data)

    def _trim_cache(self, keep: str) -> None:
        if self.max_cache <= 0:
            for f in self.cache_dir.glob("*.tif"):
                if f.stem != keep:
                    f.unlink(missing_ok=True)
            return
        files = sorted(
            self.cache_dir.glob("*.tif"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for f in files[self.max_cache :]:
            if f.stem != keep:
                f.unlink(missing_ok=True)


def refresh_index_dates(dates: list[str], index_path: Path) -> None:
    if index_path.exists():
        index = json.loads(index_path.read_text(encoding="utf-8"))
    else:
        index = {
            "format": "geotiff",
            "title": "Siena SAR classification",
            "raster": {
                "mode": "categorical",
                "band": 0,
                "nodata": [255],
                "classes": [
                    {"value": 1, "label": "Class 1 (dominant)", "color": "#1fa2ff"},
                    {"value": 3, "label": "Class 2 (minority)", "color": "#d62828"},
                ],
            },
        }
    index["dates"] = sorted(dates)
    index.pop("files", None)
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    root = repo_root()
    parser = argparse.ArgumentParser(description="Flood dashboard with lazy Drive loading")
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--source", type=Path, help="Path to SIENA folder (zip files)")
    parser.add_argument("--cache-dir", type=Path, default=root / "data" / ".cache")
    parser.add_argument(
        "--max-cache",
        type=int,
        default=3,
        help="Keep at most N extracted .tif files on disk (0 = only current)",
    )
    args = parser.parse_args()

    config = load_drive_config()
    try:
        siena_dir = resolve_siena_dir(config, args.source)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        print("\nSetup: Shared with me → SIENA → Add shortcut to Drive", file=sys.stderr)
        print("Then set drive.config.json → localSienaFolder", file=sys.stderr)
        return 1

    dates = list_available_dates(siena_dir)
    if not dates:
        print(f"No YYYY-MM-DD.zip files in {siena_dir}", file=sys.stderr)
        return 1

    index_path = root / "data" / "index.json"
    refresh_index_dates(dates, index_path)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    pairs = list_date_zips(siena_dir)
    print(f"SIENA folder: {siena_dir}")
    print(f"Dates available: {len(dates)} ({dates[0]} … {dates[-1]})")
    print(f"Lazy load: only opens the zip for the date you pick in the map.")
    print(f"Disk cache: up to {args.max_cache} day(s) in {args.cache_dir}")
    print(f"\n  http://localhost:{args.port}\n")

    handler = type(
        "Handler",
        (DashboardHandler,),
        {
            "siena_dir": siena_dir,
            "cache_dir": args.cache_dir,
            "max_cache": args.max_cache,
            "index_path": index_path,
        },
    )

    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
