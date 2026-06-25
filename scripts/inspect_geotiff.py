#!/usr/bin/env python3
"""Print GeoTIFF metadata to configure data/index.json (min, max, nodata)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect a flood-risk GeoTIFF")
    parser.add_argument("path", type=Path, help="Path to .tif / .tiff file")
    args = parser.parse_args()

    path = args.path
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        return 1

    try:
        import rasterio
        import numpy as np
    except ImportError:
        print("Install rasterio first:  pip install rasterio numpy", file=sys.stderr)
        return 1

    with rasterio.open(path) as src:
        print(f"File: {path}")
        print(f"CRS: {src.crs}")
        print(f"Bounds: {src.bounds}")
        print(f"Size: {src.width} x {src.height}")
        print(f"Bands: {src.count}")
        print(f"Dtype: {src.dtypes}")
        print(f"NoData (tag): {src.nodata}")

        band = src.read(1, masked=True)
        valid = band.compressed()
        if valid.size == 0:
            print("No valid pixels found.")
            return 0

        print(f"Valid pixels: {valid.size}")
        print(f"Min: {float(valid.min())}")
        print(f"Max: {float(valid.max())}")
        print(f"Mean: {float(valid.mean())}")

        print("\nSuggested data/index.json raster section:")
        nodata = src.nodata
        nodata_list = [nodata] if nodata is not None else [-9999]
        print(
            "  \"raster\": {"
            f"\n    \"band\": 0,"
            f"\n    \"min\": {float(valid.min())},"
            f"\n    \"max\": {float(valid.max())},"
            f"\n    \"nodata\": {nodata_list}"
            "\n  }"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
