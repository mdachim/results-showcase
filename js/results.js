/* ==========================================================================
   results.js (v2) — loads data/results_showcase.json and renders the Results
   Showcase in two modes:
     · OVERVIEW — Moldova map + filterable photo-led project tiles
     · PROJECT PAGE — one project at a time (#project=ID), photographs up
       front, a uniform field record, and the map docked in the sidebar.
   The single Leaflet map element is moved between the two layouts.
   Map tiles: free CARTO/OpenStreetMap — no API key required.
   Requires: data-loader.js, main.js, Leaflet. See SETUP_RESULTS_SHOWCASE.md.
   ========================================================================== */

(function () {
  "use strict";

  var statusEl = document.getElementById("data-status");
  var grid = document.getElementById("rs-grid");
  var countEl = document.getElementById("result-count");
  var mapEl = document.getElementById("rs-map");
  var overviewEl = document.getElementById("rs-overview");
  var detailEl = document.getElementById("rs-detail");
  var detailMain = document.getElementById("detail-main");
  var detailLoc = document.getElementById("detail-loc");
  if (!grid || !mapEl || !detailEl) return;

  /* Project-type accent colours: [bar/tint colour, AAA-contrast ink colour]
     Taken from the UNHCR Data Visualization Guidelines' 5-category palette
     (Blue / Yellow / Green / Cyan / Red) with the matching AAA text colours. */
  var TYPE_COLORS = {
    "PCP": ["var(--blue)",   "#05568B"],
    "CSI": ["var(--yellow)", "#684D0B"],
    "CSC": ["var(--green)",  "#1F5741"],
    "RAC": ["var(--cyan)",   "#0B5269"],
    "REF": ["var(--red)",    "#683229"]
  };
  var TYPE_FALLBACK = ["var(--grey)", "#4D4D4D"];
  function typeColor(t) { return TYPE_COLORS[t] || TYPE_FALLBACK; }

  function statusClass(st) {
    return "st-" + (st || "planned").toLowerCase().replace(/[^a-z]+/g, "-");
  }
  function money(v) {
    var n = parseFloat(v);
    if (isNaN(n) || n <= 0) return "";
    return "USD " + Math.round(n).toLocaleString("en-US");
  }
  function orDash(v) { return v ? esc(v) : "—"; }

  /* ---------------- state ---------------- */
  var projects = [];
  var byId = {};
  var shownList = [];        // current filtered+sorted list (drives prev/next)
  var map, markerLayer;
  var markers = {};          // coordKey -> Leaflet marker
  var selectedKey = null;
  var adminApi = null; // set by initAdminLayers()
  var openId = null;         // project currently open on its own page

  var controls = {
    q:        document.getElementById("f-search"),
    type:     document.getElementById("f-type"),
    district: document.getElementById("f-district"),
    muni:     document.getElementById("f-municipality"),
    facility: document.getElementById("f-facility"),
    status:   document.getElementById("f-status"),
    reset:    document.getElementById("f-reset")
  };

  function fillSelect(select, values, allLabel, keep) {
    if (!select) return;
    var current = keep ? select.value : "";
    select.innerHTML = '<option value="">' + allLabel + "</option>" +
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + "</option>"; }).join("");
    if (current && values.indexOf(current) !== -1) select.value = current;
  }

  function currentFilters() {
    return {
      q:        controls.q        ? controls.q.value.trim() : "",
      type:     controls.type     ? controls.type.value : "",
      district: controls.district ? controls.district.value : "",
      muni:     controls.muni     ? controls.muni.value : "",
      facility: controls.facility ? controls.facility.value : "",
      status:   controls.status   ? controls.status.value : ""
    };
  }

  /* District names in the data are spelled inconsistently (Hancesti/Hincesti,
     Soroca/Soroca district, Gagauzia/UTA Gagauzia…), so districts are
     compared by their ADM1 p-code, which is also what the map uses. */
  var DISTRICT_ALIAS = { balti: "MD002", chisinau: "MD010", gagauzia: "MD037", utagagauzia: "MD037",
    transnistria: "MD035", sorocadistrict: "MD030", hancesti: "MD020", hincesti: "MD020",
    stefanvoda: "MD031", aneniinoi: "MD001" };
  var RAION_CODES = null; // normalised raion name -> p-code, filled by initAdminLayers()
  function normName(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  }
  function districtCode(name) {
    var k = normName(name);
    if (!k) return null;
    return DISTRICT_ALIAS[k] || (RAION_CODES && RAION_CODES[k]) || null;
  }

  function matches(p, f) {
    if (f.type && p.project_type !== f.type) return false;
    if (f.district && p.district !== f.district &&
        !(districtCode(f.district) && districtCode(p.district) === districtCode(f.district))) return false;
    if (f.muni && p.municipality !== f.muni) return false;
    if (f.facility && p.facility_type !== f.facility) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.q) {
      var hay = (p.project_name + " " + p.project_id + " " + p.project_type + " " + p.district + " " + p.municipality + " " +
                 p.address + " " + p.facility_type + " " + p.ownership + " " + p.scope_of_works + " " +
                 p.impact + " " + p.funding_source + " " + p.implementation_modality).toLowerCase();
      var terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) {
        if (hay.indexOf(terms[i]) === -1) return false;
      }
    }
    return true;
  }

  /* ---------------- lightbox ---------------- */
  /* One shared full-screen viewer for every clickable photo on the project
     page (single photos and the plain-photo gallery — the before/after
     slider has its own drag-to-compare interaction and isn't wrapped in
     this, to avoid the two gestures fighting over a click). Images that
     share a data-lb-group open together, so prev/next moves within that set. */
  var lb = null, lbList = [], lbIdx = 0;

  function buildLightbox() {
    var div = document.createElement("div");
    div.className = "lb-overlay";
    div.hidden = true;
    div.innerHTML =
      '<button type="button" class="lb-btn lb-close" aria-label="Close">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      "</button>" +
      '<button type="button" class="lb-btn lb-prev" aria-label="Previous photo">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      "</button>" +
      '<figure class="lb-figure"><img class="lb-img" alt="Project photo"><figcaption class="lb-count"></figcaption></figure>' +
      '<button type="button" class="lb-btn lb-next" aria-label="Next photo">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>' +
      "</button>";
    document.body.appendChild(div);
    div.querySelector(".lb-close").addEventListener("click", closeLightbox);
    div.querySelector(".lb-prev").addEventListener("click", function () { lbStep(-1); });
    div.querySelector(".lb-next").addEventListener("click", function () { lbStep(1); });
    div.addEventListener("click", function (e) { if (e.target === div) closeLightbox(); });
    document.addEventListener("keydown", function (e) {
      if (!lb || lb.hidden) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") lbStep(-1);
      if (e.key === "ArrowRight") lbStep(1);
    });
    return div;
  }

  function lbShow(i) {
    lbIdx = (i + lbList.length) % lbList.length;
    var multi = lbList.length > 1;
    lb.querySelector(".lb-img").src = lbList[lbIdx];
    lb.querySelector(".lb-count").textContent = multi ? (lbIdx + 1) + " / " + lbList.length : "";
    lb.querySelector(".lb-prev").hidden = !multi;
    lb.querySelector(".lb-next").hidden = !multi;
  }
  function lbStep(delta) { lbShow(lbIdx + delta); }

  function openLightbox(urls, startIdx) {
    if (!lb) lb = buildLightbox();
    lbList = urls;
    lbShow(startIdx || 0);
    lb.hidden = false;
    document.body.classList.add("lb-open");
  }
  function closeLightbox() {
    if (lb) { lb.hidden = true; document.body.classList.remove("lb-open"); }
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-lb]") : null;
    if (!el) return;
    e.preventDefault();
    var group = el.closest("[data-lb-group]");
    var urls = group ?
      Array.prototype.map.call(group.querySelectorAll("[data-lb]"), function (a) { return a.getAttribute("data-lb"); }) :
      [el.getAttribute("data-lb")];
    openLightbox(urls, urls.indexOf(el.getAttribute("data-lb")));
  });

  /* ---------------- photos ---------------- */
  /* Every project shows the same photo module: Before + After, as an
     interactive comparison slider when both exist, or whichever single
     side it has. A project can have several before/after shots
     (before_photo/after_photo are "|"-joined lists) — photoState tracks
     which pair is on screen so the viewer can step through them. Projects
     with no photos at all render nothing — no placeholder box. */
  function photoList(field) { return field ? field.split("|").filter(Boolean) : []; }

  var photoState = { before: [], after: [], idx: 0 };

  function photoModule(p) {
    var b = p.before_photo, a = p.after_photo;
    if (b && a) {
      return '<div class="ba" data-ba>' +
        '<div class="ba-frame">' +
          '<img class="ba-after" src="' + esc(a) + '" alt="After works" loading="lazy">' +
          '<div class="ba-before-clip"><img class="ba-before" src="' + esc(b) + '" alt="Before works" loading="lazy"></div>' +
          '<div class="ba-handle" aria-hidden="true"></div>' +
          '<span class="ba-tag l">Before</span><span class="ba-tag r">After</span>' +
        "</div>" +
        '<input type="range" class="ba-range" min="0" max="100" value="50" aria-label="Compare before and after photos">' +
      "</div>";
    }
    if (b || a) {
      var url = b || a, label = b ? "Before" : "After";
      return '<a class="ph-single" href="' + esc(url) + '" data-lb="' + esc(url) + '">' +
        '<img src="' + esc(url) + '" alt="' + esc(label) + ' photo" loading="lazy">' +
        '<span class="ph-cap">' + esc(label) + "</span></a>";
    }
    return "";
  }

  /* Plain documentation photos (an event, a finished site — no before/after
     comparison). Shown instead of the before/after module when a project
     has no before/after photos but does have a folder gallery. */
  function photoGallery(p) {
    var urls = p.photos ? p.photos.split("|").filter(Boolean) : [];
    if (!urls.length) return "";
    return '<div class="rs-gallery" data-lb-group>' +
      urls.map(function (u) {
        return '<a class="rs-gallery-item" href="' + esc(u) + '" data-lb="' + esc(u) + '">' +
          '<img src="' + esc(u) + '" alt="Project photo" loading="lazy"></a>';
      }).join("") +
    "</div>";
  }

  var PH_PREV_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  var PH_NEXT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  /* Renders the before/after pair currently selected in photoState, plus
     prev/next controls when there's more than one pair to step through. */
  function renderPhotoPane() {
    var total = Math.max(photoState.before.length, photoState.after.length, 1);
    if (photoState.idx >= total) photoState.idx = 0;
    var pair = { before_photo: photoState.before[photoState.idx] || "",
                 after_photo: photoState.after[photoState.idx] || "" };
    var nav = total > 1 ?
      '<div class="ph-nav">' +
        '<button type="button" class="step-btn" id="ph-prev" aria-label="Previous photo pair">' + PH_PREV_ICON + "</button>" +
        '<span class="step-count">' + (photoState.idx + 1) + " / " + total + "</span>" +
        '<button type="button" class="step-btn" id="ph-next" aria-label="Next photo pair">' + PH_NEXT_ICON + "</button>" +
      "</div>" : "";
    return photoModule(pair) + nav;
  }

  function wirePhotoNav(container) {
    var total = Math.max(photoState.before.length, photoState.after.length, 1);
    if (total <= 1) return;
    var prev = container.querySelector("#ph-prev"), next = container.querySelector("#ph-next");
    if (prev) prev.addEventListener("click", function () {
      photoState.idx = (photoState.idx - 1 + total) % total;
      container.innerHTML = renderPhotoPane();
      wirePhotoNav(container);
    });
    if (next) next.addEventListener("click", function () {
      photoState.idx = (photoState.idx + 1) % total;
      container.innerHTML = renderPhotoPane();
      wirePhotoNav(container);
    });
  }

  /* Returns the markup to embed in detailMain.innerHTML. When there's a
     before/after pair, it's just an empty slot — renderDetail fills it via
     renderPhotoPane() once the element actually exists in the DOM (needed
     for the prev/next pair buttons to attach their click handlers). A
     project with no photos at all contributes nothing. */
  function photoSection(p) {
    photoState = { before: photoList(p.before_photo), after: photoList(p.after_photo), idx: 0 };
    if (photoState.before.length || photoState.after.length) return '<div id="detail-photo"></div>';
    return photoGallery(p); // "" when there's no gallery either
  }

  /* ---------------- overview table, grouped by district ---------------- */
  var CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  function renderRow(p) {
    var col = typeColor(p.project_type);
    return "<tr>" +
      '<td class="rc-type">' +
        (p.project_type ? '<span class="type-chip" style="background:' + col[0] + '">' + esc(p.project_type) + "</span>" : "") +
      "</td>" +
      '<td class="rc-name"><a href="#project=' + encodeURIComponent(p.project_id) + '">' + esc(p.project_name) + "</a></td>" +
      "<td>" + orDash(p.facility_type) + "</td>" +
      "<td>" + orDash(p.municipality) + "</td>" +
      '<td><span class="mchip status ' + statusClass(p.status) + '">' + orDash(p.status) + "</span></td>" +
      '<td class="rc-inv">' + (money(p.total_investment_usd) || "—") + "</td>" +
    "</tr>";
  }

  function renderGroup(district, list) {
    var total = list.reduce(function (s, p) { return s + p._inv; }, 0);
    return '<details class="rs-dgroup" open>' +
      "<summary>" + CHEV +
        '<span class="dg-name">' + esc(district || "District not recorded") + "</span>" +
        '<span class="dg-meta">' + list.length + (list.length === 1 ? " project" : " projects") +
          (total ? " · " + money(total) : "") + "</span>" +
      "</summary>" +
      '<div class="rs-table-scroll"><table class="rs-table">' +
        "<thead><tr><th></th><th>Project</th><th>Facility type</th><th>Municipality</th><th>Status</th><th>Investment</th></tr></thead>" +
        "<tbody>" + list.map(renderRow).join("") + "</tbody>" +
      "</table></div>" +
    "</details>";
  }

  function renderTable(list) {
    var groups = {};
    list.forEach(function (p) {
      var d = p.district || "";
      (groups[d] = groups[d] || []).push(p);
    });
    var names = Object.keys(groups).sort(function (a, b) {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
    return names.map(function (d) { return renderGroup(d, groups[d]); }).join("");
  }

  /* ---------------- project page ---------------- */
  /* Every project renders the exact same record, in the same order —
     empty values show as an em-dash so the structure never changes. */
  function renderDetail(p) {
    var col = typeColor(p.project_type);
    var facts = [
      ["Project ID", p.project_id],
      ["Type of project", p.project_type],
      ["Facility type", p.facility_type],
      ["Status", p.status],
      ["Ownership", p.ownership],
      ["Implementation modality", p.implementation_modality],
      ["Total investment", money(p.total_investment_usd)],
      ["Funding source", p.funding_source],
      ["Project start", p.start_date],
      ["Project completion", p.completion_date]
    ];
    detailMain.innerHTML =
      '<div class="detail-head" style="--sc:' + col[0] + ";--sci:" + col[1] + '">' +
        '<div class="meta-chips">' +
          (p.project_type ? '<span class="mchip type">' + esc(p.project_type) + "</span>" : "") +
          '<span class="mchip sector">' + esc(p.facility_type) + "</span>" +
          '<span class="mchip status ' + statusClass(p.status) + '">' + esc(p.status) + "</span>" +
        "</div>" +
        "<h1>" + esc(p.project_name) + "</h1>" +
        '<p class="detail-sub">' + esc(p.municipality || p.district) + " · " + esc(p.district) +
          (p.address ? " · " + esc(p.address) : "") + "</p>" +
      "</div>" +
      photoSection(p) +
      '<div class="detail-facts">' +
        facts.map(function (f) {
          return '<div class="dfact"><span class="k">' + esc(f[0]) + '</span><span class="v">' + orDash(f[1]) + "</span></div>";
        }).join("") +
      "</div>" +
      '<div class="detail-prose">' +
        "<h2>Scope of works</h2>" +
        "<p>" + (p.scope_of_works ? esc(p.scope_of_works) : "Not yet documented — add it in the master Excel file.") + "</p>" +
        "<h2>Impact</h2>" +
        "<p>" + (p.impact ? esc(p.impact) : "Not yet documented — add it in the master Excel file.") + "</p>" +
        (p.remarks ? "<h2>Remarks</h2><p>" + esc(p.remarks) + "</p>" : "") +
      "</div>";

    var photoEl = document.getElementById("detail-photo");
    if (photoEl) {
      photoEl.innerHTML = renderPhotoPane();
      wirePhotoNav(photoEl);
    }

    detailLoc.innerHTML =
      '<span class="k">Location</span>' +
      '<b>' + esc(p.municipality || p.district) + "</b>" +
      '<span class="v">' + orDash(p.address) + "</span>" +
      (p._lat != null ?
        '<a class="gmaps" href="https://www.openstreetmap.org/?mlat=' + p._lat + "&mlon=" + p._lon + "#map=16/" + p._lat + "/" + p._lon + '" target="_blank" rel="noopener">Open in OpenStreetMap ↗</a>' :
        '<span class="v">Coordinates not yet recorded</span>');
  }

  /* ---------------- admin boundaries (vector basemap, no tile API) ---------------- */
  /* Ported from assets/map/moldova_map.html: raion/locality/commune
     boundaries plus rivers and water bodies, drawn straight from embedded
     GeoJSON (window.MOLDOVA_ADMIN, loaded by its own <script> tag) instead
     of raster map tiles. More detail is swapped in automatically as you
     zoom in — no API key, no tile requests. Project pins (markerPane,
     z-index 600) always render above these boundaries (overlayPane,
     z-index 400) regardless of draw order, so nothing extra is needed to
     keep pins on top. */
  function initAdminLayers(lmap, onRaionClick) {
    var G = window.MOLDOVA_ADMIN;
    if (!G) return null; // data file failed to load — the map still works, just blank background
    RAION_CODES = {};
    (G.ADM1_1.features || []).forEach(function (f) { RAION_CODES[normName(f.properties.Raion_name)] = f.properties.ADM1_PCODE; });

    /* Thin lines, light fills — per the UNHCR Data Visualization Guidelines
       (keep the palette small, use the brand Grey/Blue tones). Raions use
       the brand Grey (the most prominent layer, neutral so it doesn't
       compete with the blue project pins); communes — the lightest/most
       optional layer — use the lighter blue instead. */
    /* Boundary hierarchy by line weight: raions (ADM1) thickest, communes
       (ADM2) medium, localities (ADM2) thinnest. Rivers use a saturated
       solid blue so they can't be mistaken for the pale locality lines. */
    var s1 = { color: "#8C8C8C", weight: 1.2, fillColor: "#0072BC", fillOpacity: .07 };  // ADM1 raions with projects — grey line, light blue tint
    var s2 = { color: "#8FC1E1", weight: .5, fillColor: "#8FC1E1", fillOpacity: .06, dashArray: "1 3" }; // ADM2 localities — pale blue, hairline dotted
    var s3 = { color: "#0072BC", weight: .7, fillColor: "#0072BC", fillOpacity: .04 };  // ADM2 communes — blue, medium
    var RIVER = "#0B3C8C", WATER_FILL = "#2F6FD0";
    // raion selection: highlighted raion keeps a bold outline, the rest are veiled
    var selRaion = null;
    var s1Sel = { color: "#0B3C8C", weight: 2.4, fillColor: "#FFC740", fillOpacity: .1 };
    var s1Dim = { color: "#CFCFCF", weight: .8, fillColor: "#FFFFFF", fillOpacity: .6 };
    var s1Off = { color: "#D6D6D2", weight: .8, fillColor: "#FFFFFF", fillOpacity: 0 };  // raion with no projects: neutral, no tint
    // raions that have projects under the current filters (set by setActive); null = not known yet
    var active = null;
    function isActive(f) { return !active || !!active[f.properties.ADM1_PCODE]; }
    var s1Style = function (f) {
      var on = isActive(f);
      var st = selRaion ? (f.properties.ADM1_PCODE === selRaion ? s1Sel : s1Dim) : on ? s1 : s1Off;
      // raions without projects are not clickable: plain cursor instead of the pointer
      return Object.assign({}, st, { className: on ? "am-go" : "am-nogo" });
    };
    var t1 = function (p) { return "<b>" + esc(p.Raion_name) + "</b><br>ADM1 · " + esc(p.ADM1_PCODE) + " · " + esc(p.ADM1_TYPE); };
    var t2 = function (p) { return "<b>" + esc(p.Denumire) + "</b><br>" + esc(p.Raion_name) + " · " + esc(p.ADM2_PCODE); };
    var t3 = function (p) { return "<b>" + esc(p.nm_ro) + "</b><br>" + esc(p.lau2_type) + " · code " + esc(p.lau2_codst); };
    var A1 = [G.ADM1_0, G.ADM1_1], A2 = [G.ADM2_0, G.ADM2_1, G.ADM2_2], A3 = [G.COM_0, G.COM_1];

    var infoEl = document.createElement("div");
    infoEl.className = "am-info";

    var cache = {};
    function layerFor(key, data, st, tooltip, onClick, canClick) {
      if (!cache[key]) {
        cache[key] = L.geoJSON(data, {
          style: function (f) { return typeof st === "function" ? st(f) : st; },
          onEachFeature: function (f, l) {
            var live = function () { return !canClick || canClick(f); };
            l.on("mouseover", function () {
              if (live()) l.setStyle({ weight: 2, color: "#FFC740", fillOpacity: .3 }); // Yellow accent
              infoEl.innerHTML = tooltip(f.properties);
              infoEl.hidden = false;
            });
            l.on("mouseout", function () { l.setStyle(typeof st === "function" ? st(f) : st); infoEl.hidden = true; });
            l.on("click", function () {
              if (!live()) return;
              if (onClick) onClick(f);
              lmap.fitBounds(l.getBounds(), { maxZoom: 14, padding: [40, 40] });
            });
          }
        });
      }
      return cache[key];
    }
    function riverLayer(d, w, c) {
      return L.geoJSON(d, {
        style: { color: c || RIVER, weight: w, opacity: .9 },
        onEachFeature: function (f, l) { if (f.properties.name) l.bindTooltip(f.properties.name, { sticky: true }); }
      });
    }
    function waterLayer(d) {
      return L.geoJSON(d, {
        style: { color: RIVER, weight: .6, fillColor: WATER_FILL, fillOpacity: .55 },
        onEachFeature: function (f, l) {
          var p = f.properties;
          l.bindTooltip((p.name || "unnamed") + " · " + p.water, { sticky: true });
        }
      });
    }
    var RV = [riverLayer(G.RIV_A, 2.2), riverLayer(G.RIV_B, 1.1), riverLayer(G.RIV_C, .8, "#2F6FD0")];
    var WT = [waterLayer(G.WAT_0), waterLayer(G.WAT_1), waterLayer(G.WAT_2)];

    // default state: raions + communes on, localities/rivers/water off
    var toggles = { raions: true, localities: false, communes: true, rivers: false, water: false };
    var cur = { 1: null, 2: null, 3: null };
    function setLayer(i, l) {
      if (cur[i] === l) return;
      if (cur[i]) lmap.removeLayer(cur[i]);
      cur[i] = l;
      if (l) l.addTo(lmap);
    }

    var statusEl = document.createElement("div");
    statusEl.className = "am-status";

    function refresh() {
      var z = lmap.getZoom();
      setLayer(1, toggles.raions ? layerFor("a1_" + (z >= 10 ? 1 : 0), A1[z >= 10 ? 1 : 0], s1Style, t1, onRaionClick, isActive) : null);
      var i2 = z >= 13 ? 2 : z >= 11 ? 1 : 0, i3 = z >= 12 ? 1 : 0;
      setLayer(2, toggles.localities && z >= 8.5 ? layerFor("a2_" + i2, A2[i2], s2, t2) : null);
      setLayer(3, toggles.communes && z >= 9 ? layerFor("c_" + i3, A3[i3], s3, t3) : null);

      // line weights grow with zoom: delicate on the full-country view, firmer
      // up close — raions always stay the heaviest of the boundary lines
      s1.weight = z < 8 ? 1 : z < 10 ? 1.4 : 2;
      s3.weight = z < 10 ? .6 : 1;
      if (cur[1]) { cur[1].setStyle(s1Style); cur[1].bringToFront(); }
      if (cur[3]) cur[3].setStyle(s3);

      var vr = [true, z >= 10, z >= 12], vw = [true, z >= 10, z >= 12];
      RV.forEach(function (l, i) { lmap.removeLayer(l); if (toggles.rivers && vr[i]) l.addTo(lmap); });
      WT.forEach(function (l, i) { lmap.removeLayer(l); if (toggles.water && vw[i]) l.addTo(lmap); });
      RV.forEach(function (l) { if (lmap.hasLayer(l)) l.bringToFront(); });

      var tier = i2 === 0 ? "low" : i2 === 1 ? "medium" : "full";
      statusEl.textContent = "Zoom " + z + " · locality detail: " + tier + (z < 8.5 ? " (shows from zoom 9)" : "");
    }

    /* search index: raions, localities, communes — built once from the
       detailed layers so results stay stable regardless of zoom tier */
    var idx = [];
    [[A1[1], function (p) { return p.Raion_name; }, "Raion"],
     [A2[0], function (p) { return p.Denumire + " (" + p.Raion_name + ")"; }, "Locality"],
     [A3[0], function (p) { return p.nm_ro + " (" + p.lau2_type + ")"; }, "Commune"]].forEach(function (entry) {
      var data = entry[0], name = entry[1], kind = entry[2];
      (data.features || []).forEach(function (f) { idx.push({ kind: kind, name: name(f.properties), feature: f }); });
    });

    var ctl = L.control({ position: "topright" });
    ctl.onAdd = function () {
      var div = L.DomUtil.create("div", "am-panel collapsed");
      div.innerHTML =
        '<button type="button" class="am-head">' +
          '<b class="am-title">Moldova admin units</b>' +
          '<svg class="am-chev" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
        "</button>" +
        '<div class="am-body">' +
          [["raions", "ADM1 – raions"], ["localities", "ADM2 – localities"], ["communes", "ADM2 – communes"],
           ["rivers", "Rivers &amp; streams"], ["water", "Water bodies"]].map(function (row) {
            var key = row[0], label = row[1];
            return '<label><input type="checkbox" data-am="' + key + '"' + (toggles[key] ? " checked" : "") + "> " + label + "</label>";
          }).join("") +
          '<hr><input type="search" class="am-search" placeholder="Search raion / locality / commune">' +
          '<div class="am-results"></div>' +
        "</div>";
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      div.querySelector(".am-head").addEventListener("click", function () {
        div.classList.toggle("collapsed");
      });

      div.querySelectorAll("input[type=checkbox]").forEach(function (box) {
        box.addEventListener("change", function () { toggles[box.getAttribute("data-am")] = box.checked; refresh(); });
      });
      var searchBox = div.querySelector(".am-search"), resultsEl = div.querySelector(".am-results");
      searchBox.addEventListener("input", function (e) {
        var v = e.target.value.trim().toLowerCase();
        resultsEl.innerHTML = "";
        if (v.length < 2) return;
        var norm = function (s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
        idx.filter(function (x) { return norm(x.name).indexOf(norm(v)) !== -1; }).slice(0, 30).forEach(function (x) {
          var row = document.createElement("div");
          row.textContent = x.name + " · " + x.kind;
          row.addEventListener("click", function () {
            lmap.fitBounds(L.geoJSON(x.feature).getBounds(), { maxZoom: 14, padding: [40, 40] });
            if (x.kind === "Commune") { toggles.communes = true; div.querySelector('[data-am="communes"]').checked = true; }
            refresh();
          });
          resultsEl.appendChild(row);
        });
      });
      return div;
    };
    ctl.addTo(lmap);

    var infoCtl = L.control({ position: "bottomleft" });
    infoCtl.onAdd = function () { infoEl.hidden = true; return infoEl; };
    infoCtl.addTo(lmap);

    var statusCtl = L.control({ position: "bottomright" });
    statusCtl.onAdd = function () { return statusEl; };
    statusCtl.addTo(lmap);

    /* highlight the raion containing a point (lat/lon), dim the others;
       call with no args to clear */
    function inRing(x, y, ring) {
      var c = false;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    }
    function inPoly(x, y, poly) {
      if (!inRing(x, y, poly[0])) return false;
      for (var h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) return false;
      return true;
    }
    // raions with no projects are never highlighted (unless force, for an opened project)
    function highlightRaion(code, force) {
      selRaion = code && (force || !active || active[code]) ? code : null;
      if (cur[1]) cur[1].setStyle(s1Style);
    }
    function setActive(codes) {
      active = codes;
      if (cur[1]) cur[1].setStyle(s1Style);
    }
    function highlightRaionAt(lat, lon) {
      var code = null;
      if (lat != null && lon != null) {
        (A1[1].features || []).some(function (f) {
          var g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
          if (polys.some(function (pl) { return inPoly(lon, lat, pl); })) { code = f.properties.ADM1_PCODE; return true; }
          return false;
        });
      }
      highlightRaion(code, true);
    }

    lmap.on("zoomend", refresh);
    refresh();
    return {
      highlightRaionAt: highlightRaionAt, highlightRaion: highlightRaion, setActive: setActive,
      raions: (A1[1].features || []).map(function (f) { return { code: f.properties.ADM1_PCODE, name: f.properties.Raion_name }; })
    };
  }

  /* ---------------- map ---------------- */
  function coordKey(p) { return p._lat.toFixed(5) + "," + p._lon.toFixed(5); }

  /* fixed bubble size: every project site reads the same; the badge shows the count */
  function pinSize() { return 18; }

  function markerHtml(group, selected) {
    var col = typeColor(group[0].project_type)[0];
    var badge = group.length > 1 ? '<span class="n">' + group.length + "</span>" : "";
    return '<div class="rs-pin' + (selected ? " sel" : "") + '" style="--pin-c:' + col + ";--pin-d:" + pinSize() + 'px">' + badge + "</div>";
  }

  function popupHtml(group) {
    return '<div class="rs-pop">' + group.map(function (p) {
      return '<div class="pp">' +
        "<b>" + esc(p.project_name) + "</b>" +
        '<span class="pm">' + esc(p.project_type) + " · " + esc(p.facility_type) + " · " + esc(p.status) +
          (money(p.total_investment_usd) ? " · " + money(p.total_investment_usd) : "") + "</span>" +
        '<a href="#project=' + encodeURIComponent(p.project_id) + '" class="pl">Open project →</a>' +
      "</div>";
    }).join("") + "</div>";
  }

  /* Bubbles are clustered by screen distance, so the full-country view stays
     readable and more, smaller bubbles split out as you zoom in. Sites that
     fall in the same grid cell merge into one bubble showing the project
     count; clicking it zooms in. Clustering is off while a project page is
     open (the selected pin must stay individually addressable). */
  var CLUSTER_PX = 46, CLUSTER_MAX_ZOOM = 12;
  var lastList = null;

  function clusterHtml(members) {
    var types = {};
    members.forEach(function (p) { types[p.project_type] = true; });
    var one = Object.keys(types).length === 1;
    var col = one ? typeColor(members[0].project_type)[0] : "#5B6B7F";
    return '<div class="rs-pin cl" style="--pin-c:' + col + '"><span class="cn">' + members.length + "</span></div>";
  }

  function drawMarkers(list) {
    lastList = list;
    markerLayer.clearLayers();
    markers = {};
    var groups = {};
    list.forEach(function (p) {
      if (p._lat == null) return;
      var k = coordKey(p);
      (groups[k] = groups[k] || []).push(p);
    });
    var bounds = [], keys = Object.keys(groups);
    keys.forEach(function (k) { bounds.push([groups[k][0]._lat, groups[k][0]._lon]); });

    var z = map.getZoom();
    var cells = {};
    keys.forEach(function (k) {
      var g = groups[k], cell = k;
      if (!openId && z < CLUSTER_MAX_ZOOM) {
        var pt = map.project([g[0]._lat, g[0]._lon], z);
        cell = "c" + Math.floor(pt.x / CLUSTER_PX) + "_" + Math.floor(pt.y / CLUSTER_PX);
      }
      (cells[cell] = cells[cell] || []).push(k);
    });

    Object.keys(cells).forEach(function (ck) {
      var ks = cells[ck];
      if (ks.length === 1) {
        var k = ks[0], g = groups[k], d = pinSize();
        var icon = L.divIcon({ className: "rs-di", html: markerHtml(g, k === selectedKey),
                               iconSize: [d + 8, d + 8], iconAnchor: [(d + 8) / 2, (d + 8) / 2], popupAnchor: [0, -d / 2] });
        var m = L.marker([g[0]._lat, g[0]._lon], { icon: icon, title: g[0].project_name });
        m.on("click", function () {
          if (g.length === 1) { location.hash = "project=" + encodeURIComponent(g[0].project_id); }
          else { m.bindPopup(popupHtml(g), { maxWidth: 300 }).openPopup(); }
        });
        m.addTo(markerLayer);
        markers[k] = m;
        return;
      }
      // merged bubble: centre on the project-weighted mean position
      var members = [], lat = 0, lon = 0, pts = [];
      ks.forEach(function (k) {
        groups[k].forEach(function (p) { members.push(p); lat += p._lat; lon += p._lon; });
        pts.push([groups[k][0]._lat, groups[k][0]._lon]);
      });
      var cm = L.marker([lat / members.length, lon / members.length], {
        icon: L.divIcon({ className: "rs-di", html: clusterHtml(members), iconSize: [34, 34], iconAnchor: [17, 17] }),
        title: members.length + " projects"
      });
      cm.on("click", function () { map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 }); });
      cm.addTo(markerLayer);
    });
    return bounds;
  }

  function setSelectedPin(k) {
    if (selectedKey && markers[selectedKey]) {
      var prev = markers[selectedKey].getElement();
      if (prev) { var d = prev.querySelector(".rs-pin"); if (d) d.classList.remove("sel"); }
    }
    selectedKey = k;
    if (k && markers[k]) {
      var el = markers[k].getElement();
      if (el) { var pin = el.querySelector(".rs-pin"); if (pin) pin.classList.add("sel"); }
    }
  }

  function dockMap(slotId, height) {
    var slot = document.getElementById(slotId);
    if (slot && mapEl.parentElement !== slot) slot.appendChild(mapEl);
    mapEl.style.height = height + "px";
    if (map) map.invalidateSize();
  }

  /* District filter lists every raion: spellings found in the data first
     (one per raion), then the raions that have no projects yet */
  function districtOptions(names) {
    var seen = {}, out = [];
    names.forEach(function (d) {
      var c = districtCode(d);
      if (c && seen[c]) return;
      if (c) seen[c] = true;
      out.push(d);
    });
    if (adminApi) adminApi.raions.forEach(function (r) { if (!seen[r.code]) out.push(r.name); });
    return out.sort(function (a, b) { return normName(a) < normName(b) ? -1 : 1; });
  }

  /* clicking a raion on the map sets the District filter to match */
  function selectDistrictFromMap(feature) {
    if (!controls.district || openId) return;
    var code = feature.properties.ADM1_PCODE, val = "";
    Array.prototype.forEach.call(controls.district.options, function (o) {
      if (!val && o.value && districtCode(o.value) === code) val = o.value;
    });
    controls.district.value = val;
    if (controls.muni) controls.muni.value = "";
    render();
  }

  /* ---------------- overview render ---------------- */
  function render() {
    var f = currentFilters();
    shownList = projects.filter(function (p) { return matches(p, f); });

    if (countEl) countEl.textContent = shownList.length + " of " + projects.length + " projects shown";
    grid.innerHTML = shownList.length ? renderTable(shownList) :
      '<div class="empty-state"><b>No projects match the current filters.</b><br>Try clearing a filter or using a broader search term.</div>';

    var bounds = drawMarkers(shownList);
    if (!openId && adminApi) {
      // a raion is "active" when it has projects under every filter except District/Municipality
      var codes = {}, rest = Object.assign({}, f, { district: "", muni: "" });
      projects.forEach(function (p) { var c = districtCode(p.district); if (c && matches(p, rest)) codes[c] = true; });
      adminApi.setActive(codes);
      adminApi.highlightRaion(districtCode(f.district));
    }
    if (!openId && bounds.length) {
      map.fitBounds(bounds, { padding: [34, 34], maxZoom: bounds.length === 1 ? 13 : 9 });
    }

    // municipality options follow the selected district
    var pool = f.district ? projects.filter(function (p) { return p.district === f.district; }) : projects;
    var munis = {};
    pool.forEach(function (p) { if (p.municipality) munis[p.municipality] = true; });
    fillSelect(controls.muni, Object.keys(munis).sort(), "All municipalities", true);
  }

  /* ---------------- routing (overview <-> project page) ---------------- */
  function idFromHash() {
    var m = location.hash.match(/^#project=(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function openProject(id) {
    var p = byId[id];
    if (!p) { closeProject(); return; }
    openId = id;
    overviewEl.hidden = true;
    detailEl.hidden = false;
    renderDetail(p);

    // prev/next within the current filtered list (fall back to all projects)
    var list = shownList.length ? shownList : projects;
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].project_id === id) { idx = i; break; }
    var countLbl = document.getElementById("detail-count");
    if (countLbl) countLbl.textContent = idx >= 0 ? (idx + 1) + " / " + list.length : "";
    detailEl.dataset.prev = idx > 0 ? list[idx - 1].project_id : "";
    detailEl.dataset.next = (idx >= 0 && idx < list.length - 1) ? list[idx + 1].project_id : "";
    var pb = document.getElementById("detail-prev"), nb = document.getElementById("detail-next");
    if (pb) pb.disabled = !detailEl.dataset.prev;
    if (nb) nb.disabled = !detailEl.dataset.next;

    dockMap("map-slot-detail", 340);
    if (p._lat != null) {
      if (!markers[p._key]) drawMarkers(shownList.length ? shownList : projects);
      setSelectedPin(p._key);
      if (adminApi) adminApi.highlightRaionAt(p._lat, p._lon);
      map.setView([p._lat, p._lon], 13, { animate: !window.CoS.reducedMotion });
    }
    window.scrollTo({ top: 0, behavior: "auto" });
    if (window.CoS && window.CoS.refreshMotion) window.CoS.refreshMotion();
  }

  function closeProject() {
    if (location.hash) {
      // keep the URL clean without re-triggering hashchange loops
      history.replaceState(null, "", location.pathname + location.search);
    }
    openId = null;
    detailEl.hidden = true;
    overviewEl.hidden = false;
    setSelectedPin(null);
    if (adminApi) adminApi.highlightRaionAt();
    dockMap("map-slot-overview", 520);
    render();
  }

  function route() {
    var id = idFromHash();
    if (id) openProject(id);
    else if (openId) closeProject();
  }

  window.addEventListener("hashchange", route);
  document.getElementById("detail-back").addEventListener("click", function () { closeProject(); });
  document.getElementById("detail-prev").addEventListener("click", function () {
    if (detailEl.dataset.prev) location.hash = "project=" + encodeURIComponent(detailEl.dataset.prev);
  });
  document.getElementById("detail-next").addEventListener("click", function () {
    if (detailEl.dataset.next) location.hash = "project=" + encodeURIComponent(detailEl.dataset.next);
  });
  document.addEventListener("keydown", function (e) {
    if (detailEl.hidden) return;
    if (e.key === "Escape") closeProject();
    if (e.key === "ArrowLeft" && detailEl.dataset.prev) location.hash = "project=" + encodeURIComponent(detailEl.dataset.prev);
    if (e.key === "ArrowRight" && detailEl.dataset.next) location.hash = "project=" + encodeURIComponent(detailEl.dataset.next);
  });

  /* before/after slider (works in both layouts) */
  document.addEventListener("input", function (e) {
    var range = e.target.closest ? e.target.closest(".ba-range") : null;
    if (!range) return;
    var frame = range.closest(".ba").querySelector(".ba-frame");
    frame.style.setProperty("--ba", range.value + "%");
  });

  /* ---------------- boot ---------------- */
  loadJSON("data/results_showcase.json").then(function (rows) {
    projects = rows.filter(function (r) { return r.project_name; });
    projects.forEach(function (p) {
      var la = parseFloat(p.latitude), lo = parseFloat(p.longitude);
      var ok = !isNaN(la) && !isNaN(lo) && la > 44 && la < 50 && lo > 26 && lo < 31;
      p._lat = ok ? la : null;
      p._lon = ok ? lo : null;
      p._key = ok ? coordKey(p) : "";
      p._inv = parseFloat(p.total_investment_usd) || 0;
      byId[p.project_id] = p;
    });
    projects.sort(function (a, b) { return b._inv - a._inv || a.project_name.localeCompare(b.project_name); });

    /* headline stats */
    var stats = document.getElementById("rs-stats");
    if (stats) {
      var districts = {};
      var inv = 0, done = 0;
      projects.forEach(function (p) {
        if (p.district) districts[p.district] = true;
        inv += p._inv;
        if (p.status === "Completed") done++;
      });
      document.getElementById("st-projects").setAttribute("data-target", projects.length);
      document.getElementById("st-districts").setAttribute("data-target", Object.keys(districts).length);
      document.getElementById("st-investment").setAttribute("data-target", Math.round(inv));
      document.getElementById("st-completed").setAttribute("data-target", done);
      stats.hidden = false;
    }

    /* map — vector admin boundaries instead of raster tiles, see initAdminLayers() */
    map = L.map(mapEl, { scrollWheelZoom: false, center: [47.1, 28.6], zoom: 7, zoomSnap: .5, minZoom: 6, maxZoom: 18 });
    adminApi = initAdminLayers(map, selectDistrictFromMap);
    markerLayer = L.layerGroup().addTo(map);
    map.on("zoomend", function () { if (lastList) drawMarkers(lastList); });

    /* filters */
    function uniq(key) {
      var set = {};
      projects.forEach(function (p) { if (p[key]) set[p[key]] = true; });
      return Object.keys(set).sort();
    }
    var types = uniq("project_type");
    fillSelect(controls.type, types, "All types");
    fillSelect(controls.district, districtOptions(uniq("district")), "All districts");
    fillSelect(controls.muni, uniq("municipality"), "All municipalities");
    fillSelect(controls.facility, uniq("facility_type"), "All facility types");
    fillSelect(controls.status, uniq("status"), "All statuses");

    /* map/tile pins and accents are coloured by project type — one dot per
       type actually present in the data, plus the multi-project pin hint */
    var typeLegend = document.getElementById("rs-type-legend");
    if (typeLegend) {
      typeLegend.innerHTML = types.map(function (t) {
        return '<span><i class="dot" style="background:' + typeColor(t)[0] + '"></i>' + esc(t) + "</span>";
      }).join("") +
      '<span class="hint">Pins with a number group several projects at one site — click a pin to open a project</span>';
    }

    ["type", "district", "muni", "facility", "status"].forEach(function (k) {
      if (controls[k]) controls[k].addEventListener("change", function () {
        if (k === "district" && controls.muni) controls.muni.value = "";
        render();
      });
    });
    if (controls.q) controls.q.addEventListener("input", render);
    if (controls.reset) controls.reset.addEventListener("click", function () {
      if (controls.q) controls.q.value = "";
      ["type", "district", "muni", "facility", "status"].forEach(function (k) { if (controls[k]) controls[k].value = ""; });
      render();
    });

    if (statusEl) statusEl.hidden = true;
    render();
    route(); // honour a #project=… link on first load
    if (window.CoS && window.CoS.refreshMotion) window.CoS.refreshMotion();
  }).catch(function (err) {
    showDataError(statusEl, err);
  });
})();
