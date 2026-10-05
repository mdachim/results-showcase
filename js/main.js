/* ==========================================================================
   main.js — site-wide behaviour: mobile navigation, reveal-on-scroll,
   animated counters and chart animation triggers.
   Loaded on every page (after data-loader.js where data is needed).
   ========================================================================== */

(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- mobile navigation toggle ---- */
  var toggle = document.getElementById("nav-toggle");
  var nav = document.querySelector("nav.site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    // Close the menu when a link is chosen
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---- reveal on scroll (elements marked with data-reveal) ---- */
  function initReveals() {
    var revealEls = document.querySelectorAll("[data-reveal]:not(.in)");
    if ("IntersectionObserver" in window && !reduced) {
      var ro = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("in"); ro.unobserve(e.target); }
        });
      }, { threshold: 0.18, rootMargin: "0px 0px -6% 0px" });
      revealEls.forEach(function (el) { ro.observe(el); });
    } else {
      revealEls.forEach(function (el) { el.classList.add("in"); });
    }
  }

  /* ---- chart animation triggers (elements marked with data-anim) ---- */
  function initAnims() {
    var animEls = document.querySelectorAll("[data-anim]:not(.in)");
    function fire(el) {
      el.classList.add("in");
      // House-fill figures store their value in data-fill (0..1)
      el.querySelectorAll(".hf").forEach(function (r) {
        var v = parseFloat(r.getAttribute("data-fill") || "0");
        r.style.transform = "scaleY(" + (v * 0.84) + ")"; // interior spans y=8..92 of 100
      });
    }
    if ("IntersectionObserver" in window && !reduced) {
      var ao = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { fire(e.target); ao.unobserve(e.target); }
        });
      }, { threshold: 0.3 });
      animEls.forEach(function (el) { ao.observe(el); });
    } else {
      animEls.forEach(fire);
    }
  }

  /* ---- animated counters (.count with data-target) ---- */
  function initCounters() {
    var counters = document.querySelectorAll(".count[data-target]");
    function run(el) {
      var target = parseInt(el.getAttribute("data-target"), 10);
      if (isNaN(target)) return;
      if (reduced) { el.textContent = target.toLocaleString("en-US"); return; }
      var dur = 1400, t0 = null;
      function step(ts) {
        if (!t0) t0 = ts;
        var p = Math.min((ts - t0) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString("en-US");
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    if ("IntersectionObserver" in window) {
      var co = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { run(e.target); co.unobserve(e.target); }
        });
      }, { threshold: 0.6 });
      counters.forEach(function (el) { co.observe(el); });
    } else {
      counters.forEach(run);
    }
  }

  function initAll() { initReveals(); initAnims(); initCounters(); }
  initAll();

  /* Pages that inject content after loading CSVs call this to (re)bind
     observers on the newly created elements. */
  window.CoS = window.CoS || {};
  window.CoS.refreshMotion = initAll;
  window.CoS.reducedMotion = reduced;

  /* ---- footer year ---- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
