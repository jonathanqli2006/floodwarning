#!/usr/bin/env python3
"""
Optional: extract one or all SIENA zips to data/ (for offline use).

By default the dashboard uses server.py and does NOT bulk-download.
Use --date 2025-12-01 to pull a single day only.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from siena_lib import (
    discover_zip_dir,
    extract_rgb_tif_from_zip,
    list_date_zips,
    load_drive_config,
    repo_root,
    resolve_siena_dir,
)


def update_index_json(index_path: Path, dates: list[str]) -> None:
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
    index["dates"] = sorted(set(dates))
    index.pop("files", None)
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    root = repo_root()
    parser = argparse.ArgumentParser(description="Extract SIENA zips to data/ (optional)")
    parser.add_argument("--source", type=Path, help="SIENA folder with YYYY-MM-DD.zip files")
    parser.add_argument("--date", help="Only extract this date (YYYY-MM-DD)")
    parser.add_argument("--all", action="store_true", help="Extract every date (downloads all zips)")
    parser.add_argument("--data-dir", type=Path, default=root / "data")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.all and args.date:
        parser.error("Use --date or --all, not both")

    config = load_drive_config()
    try:
        siena_dir = resolve_siena_dir(config, args.source)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 1

    pairs = list_date_zips(siena_dir)
    if args.date:
        pairs = [(d, z) for d, z in pairs if d == args.date]
        if not pairs:
            print(f"No zip for {args.date}", file=sys.stderr)
            return 1

    if not args.all and not args.date:
        print(
            "Nothing to do. Pick one:\n"
            "  python scripts/sync_siena.py --date 2025-12-01   (one day)\n"
            "  python scripts/sync_siena.py --all               (every day)\n"
            "Or use lazy loading:  python server.py",
            file=sys.stderr,
        )
        return 1

    synced: list[str] = []
    for date_str, zip_path in pairs:
        dest = args.data_dir / f"{date_str}.tif"
        print(f"{date_str} <- {zip_path.name}")
        if args.dry_run:
            synced.append(date_str)
            continue
        extract_rgb_tif_from_zip(zip_path, date_str, dest)
        print(f"  -> {dest}")
        synced.append(date_str)

    if not args.dry_run and synced:
        update_index_json(args.data_dir / "index.json", synced)

    print(f"\n{len(synced)} date(s){' (dry run)' if args.dry_run else ''}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
