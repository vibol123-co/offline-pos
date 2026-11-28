// Builder notes overlay. Open a mockup with ?notes (e.g. new-order.html?notes) to see
// which real element each part restyles (purple) and which parts are optional extras (pink).
(function () {
  if (!/[?&]notes\b/.test(location.search)) return;
  document.body.classList.add("show-notes");
  document.querySelectorAll("[data-map], [data-build]").forEach(function (el) {
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    // Custom element so component rules like ".seg span" never style the tag.
    var tag = document.createElement("map-tag");
    var optional = el.getAttribute("data-build") === "optional";
    tag.className = "map-tag" + (optional ? " opt" : "");
    tag.textContent = (optional ? "OPTIONAL" + (el.dataset.map ? " · " : "") : "") + (el.dataset.map || "");
    el.appendChild(tag);
  });
  var legend = document.createElement("div");
  legend.className = "notes-legend";
  legend.innerHTML = '<span><i style="background:#6d28d9"></i>Existing element: restyle only (keep id / name)</span>' +
    '<span><i style="background:#db2777"></i>Optional display-only extra: needs owner approval</span>';
  document.body.appendChild(legend);
})();
