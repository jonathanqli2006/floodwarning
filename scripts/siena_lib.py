"""Shared SIENA zip → RGB GeoTIFF helpers."""

from __future__ import annotations

import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

ZIP_DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.zip$", re.IGNORECASE)
RGB_MARKERS = ("RGB",)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def load_drive_config(config_path: Path | None = None) -> dict:
    if config_path is None:
        config_path = repo_root() / "drive.config.json"
    if not config_path.exists():
        return {}
    return json.loads(config_path.read_text(encoding="utf-8"))


def guess_siena_folders() -> list[Path]:
    home = Path.home()
    roots = [
        home / "Google Drive",
        home / "Google Drive" / "My Drive",
        home / "My Drive",
        Path("G:/My Drive"),
        Path("G:/Shared drives"),
    ]
    found: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        if not root.exists():
            continue
        for name in ("SIENA", "Siena", "siena"):
            candidate = root / name
            key = str(candidate).lower()
            if candidate.is_dir() and key not in seen:
                seen.add(key)
                found.append(candidate)
        try:
            for match in root.rglob("SIENA"):
                if match.is_dir() and any(ZIP_DATE_RE.match(p.name) for p in match.glob("*.zip")):
                    key = str(match).lower()
                    if key not in seen:
                        seen.add(key)
                        found.append(match)
        except OSError:
            pass
    return found


def resolve_siena_dir(config: dict | None = None, explicit: Path | None = None) -> Path:
    if explicit is not None:
        return discover_zip_dir(explicit)
    config = config or load_drive_config()
    if config.get("localSienaFolder"):
        return discover_zip_dir(Path(config["localSienaFolder"]))
    guesses = guess_siena_folders()
    if len(guesses) == 1:
        return discover_zip_dir(guesses[0])
    if len(guesses) > 1:
        raise FileNotFoundError(
            "Multiple SIENA folders found. Set localSienaFolder in drive.config.json:\n"
            + "\n".join(f"  {g}" for g in guesses)
        )
    raise FileNotFoundError(
        "SIENA folder not found. Add a Drive shortcut (Shared with me) and set "
        "localSienaFolder in drive.config.json."
    )


def discover_zip_dir(source: Path) -> Path:
    if any(ZIP_DATE_RE.match(p.name) for p in source.glob("*.zip")):
        return source
    siena = source / "SIENA"
    if siena.is_dir() and any(ZIP_DATE_RE.match(p.name) for p in siena.glob("*.zip")):
        return siena
    raise FileNotFoundError(
        f"No YYYY-MM-DD.zip files in {source} (or {source / 'SIENA'})"
    )


def list_date_zips(siena_dir: Path) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    for zp in sorted(siena_dir.glob("*.zip")):
        m = ZIP_DATE_RE.match(zp.name)
        if m:
            out.append((m.group(1), zp))
    return out


def list_available_dates(siena_dir: Path) -> list[str]:
    """Date strings only — reads zip filenames, does not open archives."""
    return [d for d, _ in list_date_zips(siena_dir)]


def find_rgb_tif(search_root: Path) -> Path | None:
    candidates: list[Path] = []
    for tif in search_root.rglob("*.tif"):
        if not any(m in tif.name.upper() for m in RGB_MARKERS):
            continue
        candidates.append(tif)

    if not candidates:
        return None

    def sort_key(p: Path) -> tuple:
        n = p.name.upper()
        return (
            0 if "SIENA_2CLASSES_RGB" in n else 1,
            0 if n.startswith("SIENA_") else 1,
            len(n),
            n,
        )

    candidates.sort(key=sort_key)
    return candidates[0]


def extract_rgb_tif_from_zip(zip_path: Path, date_str: str, dest: Path) -> Path:
    """Extract RGB .tif from one zip. Only this zip is read from disk/Drive."""
    with tempfile.TemporaryDirectory(prefix=f"siena_{date_str}_") as tmp:
        tmp_path = Path(tmp)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp_path)
        tif = find_rgb_tif(tmp_path)
        if tif is None:
            raise FileNotFoundError(f"No *RGB*.tif in {zip_path.name}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(tif, dest)
        return dest


def zip_path_for_date(siena_dir: Path, date_str: str) -> Path:
    path = siena_dir / f"{date_str}.zip"
    if not path.exists():
        raise FileNotFoundError(f"Missing {path.name} in {siena_dir}")
    return path
