# Project photos

One folder per project, named after its `Project ID` (the ID column in
`data/results_showcase.xlsx`, e.g. `RAC_2_3`, `PCP_DI_27`):

```
assets/photos/
  RAC_2_3/
    before.jpg
    after.jpg
  PCP_DI_19/
    PCP_DI_19_before_1.png   <- more than one before/after shot is fine —
    PCP_DI_19_before_2.png      the project page lets you step through the
    PCP_DI_19_after_1.png       pairs (1st before pairs with 1st after, etc.)
    PCP_DI_19_after_2.png
  CSI_2025_11/
    CSI_2025_11_1.jpg        <- no "before"/"after" in the name -> treated
    CSI_2025_11_2.jpg           as a plain photo gallery (e.g. event/
    CSI_2025_11_3.jpg           documentation photos, no comparison implied)
```

- **Before/after**: any filename containing `before` or `after`
  (case-insensitive, anywhere in the name — `PCP_28_before.jpg`,
  `before_1.png` all match) is picked up for that side. A project can have
  several before/after shots; they're paired up in filename order (1st
  before + 1st after = pair 1, 2nd + 2nd = pair 2, ...) and the project page
  shows prev/next controls to step through them, each pair still using the
  before/after comparison slider.
- **Plain photos**: any other image in the folder is collected into a
  gallery shown on the project page instead of (not in addition to) the
  before/after comparison. Use this for projects that don't have a
  before/after — event photos, a single "how it looks now" shot, etc.
- Allowed extensions: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.avif`.
- Keep folder/file names lowercase with no spaces (the Project ID already
  is) — extra `_1`/`_2` suffixes or the project ID as a prefix are fine.

`build_results_showcase.py` automatically picks up photos placed here — you
don't need to edit the Excel file's Before/After Photo columns at all. Just
drop the file(s) in the right folder and run the build script (or push; if
you'd rather wire this into a GitHub Action later, it's the same script).

**The Excel Before/After Photo cells are ignored entirely** — the site only
ever shows what's in this folder. Most of those cells hold private
SharePoint preview links that can't be embedded on the site anyway (they'd
just show a locked "open photos" button), so there's no reason to keep using
them once a real photo is checked in here. A project with nothing in its
folder simply shows no before/after photo.

## Folders already created

`TODO.csv` in this folder lists every project that currently has a photo
reference in Excel (109 of them) — one row per project, with the folder path
and the original before/after source text (mostly SharePoint breadcrumbs) so
you know what to go find. Its `needs_before`/`needs_after` columns are a
snapshot from when it was generated, not auto-updating — delete a row (or the
whole file) once you've dropped a photo in, or regenerate it later if the
Excel data changes.
