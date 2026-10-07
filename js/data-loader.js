/* ==========================================================================
   data-loader.js — shared helpers for loading the JSON data files.
   The website reads /data/*.json at runtime — each one an array of row
   objects with the same field names as its Excel master. The .xlsx files
   are the human-editable masters (not published — see .gitignore); each
   has a matching build_*.py script that regenerates the JSON from it.
   See README.md for the update workflow.
   ========================================================================== */

/**
 * Fetch and parse a JSON data file. Relative URLs keep the site working
 * when GitHub Pages serves it from a project sub-path. Rejects with a
 * helpful message when opened via file:// (see README).
 */
function loadJSON(url) {
  // "no-cache" makes the browser check with the server every time (cheap
  // when unchanged), so a republished JSON shows up without a hard refresh.
  return fetch(url, { cache: "no-cache" }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " while loading " + url);
    return res.json();
  }).catch(function (err) {
    if (location.protocol === "file:") {
      throw new Error(
        "Data files cannot be loaded when the page is opened directly from disk (file://). " +
        "Start a small local server instead — e.g. run “python -m http.server” in the project " +
        "folder, or use the VS Code Live Server extension. See README.md."
      );
    }
    throw err;
  });
}

/** Group an array of row objects by a column value, preserving display_order. */
function groupRows(rows, column) {
  var groups = {};
  rows.forEach(function (r) {
    var key = r[column] || "";
    (groups[key] = groups[key] || []).push(r);
  });
  Object.keys(groups).forEach(function (k) {
    groups[k].sort(function (a, b) {
      return (parseFloat(a.display_order) || 0) - (parseFloat(b.display_order) || 0);
    });
  });
  return groups;
}

/** Escape a string for safe insertion into innerHTML. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** City accent colours (must match the CSS custom properties). */
var CITY_COLORS = {
  "Comrat":   { c: "var(--comrat)",   ink: "var(--comrat-ink)" },
  "Bălți":    { c: "var(--balti)",    ink: "var(--balti-ink)" },
  "Chișinău": { c: "var(--chisinau)", ink: "var(--chisinau-ink)" },
  "Cahul":    { c: "var(--cahul)",    ink: "var(--cahul-ink)" }
};
var CITY_ORDER = ["Comrat", "Bălți", "Chișinău", "Cahul"];

function cityColor(city)    { return (CITY_COLORS[city] || { c: "var(--blue)" }).c; }
function cityInkColor(city) { return (CITY_COLORS[city] || { ink: "var(--blue-deep)" }).ink; }

/** Show a data-status element in its error state. */
function showDataError(el, err) {
  if (!el) return;
  el.hidden = false;
  el.classList.add("error");
  el.textContent = "Could not load the data file. " + (err && err.message ? err.message : "");
}
