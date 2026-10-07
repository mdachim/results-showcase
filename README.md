# Results Showcase - Moldova

A standalone map and project portfolio of UNHCR-funded communal infrastructure projects across Moldova.

## Structure

- `index.html` — the page
- `css/styles.css`, `js/` — styling and scripts
- `data/results_showcase.json` — the project data the page reads (published)
- `assets/map/moldova_admin_data.js` — Moldova administrative boundaries for the map
- `assets/photos/<Project ID>/` — project photos (see `assets/photos/README.md`)
- `build_results_showcase.py` — regenerates the JSON from the Excel master

## Updating the data

1. Edit the master `data/results_showcase.xlsx` (kept locally, gitignored — place your copy in `data/`).
2. Run `python build_results_showcase.py` (requires `pip install openpyxl`).
3. Commit and push `data/results_showcase.json` (and any new photos under `assets/photos/`).

## Running locally

The page loads its data with JavaScript, so serve it rather than opening the file directly:

```text
python -m http.server 8000
```

then open `http://localhost:8000`.
