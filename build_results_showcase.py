"""Regenerate data/results_showcase.json from data/results_showcase.xlsx.

Usage (from the repository root):
    python build_results_showcase.py

The website reads the JSON at runtime; the Excel file is the human-editable
master (not published — see .gitignore). Run this after editing the Excel
file, then commit and push the JSON. Requires openpyxl: pip install openpyxl

Photos: the Excel Before/After Photo columns are ignored entirely — the
website only ever shows photos placed in assets/photos/<project_id>/. Any
image there whose filename contains "before" / "after" (there can be more
than one of each — the project page lets you flip through the pairs) fills
before_photo/after_photo; every other image in that folder (no before/after
in its name — e.g. plain event/documentation photos) is collected into a
separate "photos" gallery field. A project with nothing in its folder
simply shows no photo. See assets/photos/README.md.
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

try:
    from openpyxl import load_workbook
except ImportError:
    sys.exit("openpyxl is not installed. Run:  pip install openpyxl")

XLSX = "data/results_showcase.xlsx"
JSON_OUT = "data/results_showcase.json"
SHEET = "Results Showcase"
PHOTOS_DIR = Path("assets/photos")
PHOTO_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")

# Row fields, in order, matched to the Excel columns A..U
COLS = ["project_id", "project_type", "project_name", "district", "municipality", "address",
        "latitude", "longitude", "facility_type", "ownership", "scope_of_works",
        "impact", "implementation_modality", "total_investment_usd",
        "funding_source", "status", "start_date", "completion_date",
        "before_photo", "after_photo", "remarks"]

# "photos" isn't an Excel column — it's computed entirely from the
# assets/photos/<project_id>/ folder and appended to each record. Every
# field is kept as a string (matching the old CSV output exactly), so the
# website's JS needs no changes regardless of which format feeds it.
OUT_FIELDS = COLS + ["photos"]

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

STATUS_MAP = {"ongoing": "In progress", "in progress": "In progress",
              "completed": "Completed", "planned": "Planned"}


def clean(value, col):
    """Normalise a cell value for the CSV."""
    if value is None:
        return ""
    # Dates typed as real Excel dates -> "Mar 2024"
    if isinstance(value, (dt.datetime, dt.date)):
        return f"{MONTHS[value.month - 1]} {value.year}"
    text = re.sub(r"\s+", " ", str(value)).strip()
    if col == "status":
        return STATUS_MAP.get(text.lower(), text)
    if col in ("latitude", "longitude"):
        try:
            return f"{float(text):.6f}"
        except ValueError:
            return ""
    if col == "total_investment_usd":
        try:
            return f"{float(text):.2f}"
        except ValueError:
            return ""
    if col in ("before_photo", "after_photo"):
        # These are populated entirely from assets/photos/ in main() below —
        # whatever's in Excel here is ignored.
        return ""
    return text


def list_photos(project_id):
    """All image files directly inside assets/photos/<project_id>/, sorted."""
    folder = PHOTOS_DIR / project_id
    if not folder.is_dir():
        return []
    return sorted(
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in PHOTO_EXTS
    )


def find_local_photos(files, side):
    """All files whose name contains "before"/"after" (case-insensitive),
    in order — e.g. matches before.jpg, PCP_28_before.jpg, before_1.png,
    before_2.png alike. A project can have several before/after shots."""
    return [f.as_posix() for f in files if side in f.stem.lower()]


def find_local_gallery(files):
    """Every photo that isn't a before/after shot — plain documentation
    photos (event photos, single "how it looks" shots, etc.)."""
    return [f.as_posix() for f in files
            if "before" not in f.stem.lower() and "after" not in f.stem.lower()]


def main():
    wb = load_workbook(XLSX, read_only=True, data_only=True)
    if SHEET not in wb.sheetnames:
        sys.exit(f'Sheet "{SHEET}" not found in {XLSX}')
    ws = wb[SHEET]

    rows_out = []
    photos_found = 0
    galleries_found = 0
    for row in ws.iter_rows(min_row=2, max_col=len(COLS), values_only=True):
        record = {col: clean(val, col) for col, val in zip(COLS, row)}
        if not record["project_name"]:
            continue  # skip empty rows

        pid = record["project_id"]
        files = list_photos(pid) if pid else []

        before_list = find_local_photos(files, "before")
        after_list = find_local_photos(files, "after")
        record["before_photo"] = "|".join(before_list)
        record["after_photo"] = "|".join(after_list)
        photos_found += len(before_list) + len(after_list)

        gallery = find_local_gallery(files)
        record["photos"] = "|".join(gallery)
        if gallery:
            galleries_found += 1

        rows_out.append({field: record[field] for field in OUT_FIELDS})

    with open(JSON_OUT, "w", encoding="utf-8") as f:
        json.dump(rows_out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print(f"Wrote {len(rows_out)} projects to {JSON_OUT} "
          f"({photos_found} before/after photo(s), {galleries_found} project(s) with a photo gallery, "
          f"auto-detected from {PHOTOS_DIR}/)")


if __name__ == "__main__":
    main()
