/* ============================================================================================================
 * ARCHIVO 17 · MAPA GIS (Leaflet + mapas base de ArcGIS)
 *   - SedMarker: dibuja cada SED con el ícono de triángulo con ruedas (en canvas, rápido para miles de SED).
 *   - initMap(): crea el mapa, las capas y la leyenda; refreshMap(): pinta todas las SED por color.
 *   - drawNode(): dibuja el nodo analizado: aledañas, distancias, elipses de cada iteración,
 *     áreas de servicio, error de cadena (línea roja punteada) y tramos por hurto.
 *   - popupHtml(): ventana al hacer clic en una SED (botones Analizar y Street View).
 * ========================================================================================================== */
"use strict";

let map,
  layerAll,
  layerNode,
  layerTram,
  colorMode = "crit";
L.Canvas.include({
  _updateSed(layer) {
    if (!this._drawing || layer._empty()) return;
    const p = layer._point,
      ctx = this._ctx,
      r = Math.max(Math.round(layer._radius), 2),
      o = layer.options;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x + r, p.y + 0.55 * r);
    ctx.lineTo(p.x - r, p.y + 0.55 * r);
    ctx.closePath();
    this._fillStroke(ctx, layer);
    const wr = Math.max(1.2, 0.3 * r),
      wy = p.y + 0.55 * r + wr + 0.5;
    ctx.beginPath();
    ctx.moveTo(p.x - 0.45 * r + wr, wy);
    ctx.arc(p.x - 0.45 * r, wy, wr, 0, 2 * Math.PI);
    ctx.moveTo(p.x + 0.45 * r + wr, wy);
    ctx.arc(p.x + 0.45 * r, wy, wr, 0, 2 * Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = Math.max(1, o.weight);
    ctx.strokeStyle = o.color;
    ctx.stroke();
  }
});

/**
 * Marcador de SED para el mapa: triángulo con dos ruedas, dibujado en canvas (rápido para miles de SED).
 */
const SedMarker = L.CircleMarker.extend({
  _updatePath() {
    this._renderer._updateSed(this);
  },
  _updateBounds() {
    const r = this._radius * 1.5,
      w = this._clickTolerance(),
      q = [r + w, r + w];
    this._pxBounds = new L.Bounds(this._point.subtract(q), this._point.add(q));
  }
});

/**
 * Capa de mapa base de ArcGIS (calles, satélite, topográfico o gris).
 */
const esri = s =>
  L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`, {
    maxZoom: 19,
    attribution: "Tiles © Esri"
  });

/**
 * Crea el mapa Leaflet, las capas (todas las SED, nodo, tramos), el selector de color y la leyenda.
 */
function initMap() {
  map = L.map("map", {preferCanvas: true}).setView([-11.6, -77.2], 9);
  const base = {
    "ArcGIS Calles": esri("World_Street_Map"),
    "ArcGIS Satélite": esri("World_Imagery"),
    "ArcGIS Topográfico": esri("World_Topo_Map"),
    "ArcGIS Gris": esri("Canvas/World_Light_Gray_Base")
  };
  base["ArcGIS Calles"].addTo(map);
  layerAll = L.layerGroup().addTo(map);
  layerTram = L.layerGroup();
  layerNode = L.layerGroup().addTo(map);
  L.control.layers(base, {"Todas las SED": layerAll, "Nodo e iteraciones": layerNode, "Tramos por hurto": layerTram}).addTo(map);
  const lg = L.control({position: "bottomright"});
  lg.onAdd = () => {
    const d = L.DomUtil.create("div", "legend");
    d.id = "legend";
    return d;
  };
  lg.addTo(map);
  const cm = L.control({position: "topright"});
  cm.onAdd = () => {
    const d = L.DomUtil.create("div", "legend");
    d.innerHTML = `<b>Color de las SED</b><br><label><input type="radio" name="cm" value="crit" checked> criticidad IA</label><br><label><input type="radio" name="cm" value="loss"> % pérdida</label><br><label><input type="radio" name="cm" value="alim"> alimentador</label>`;
    L.DomEvent.disableClickPropagation(d);
    d.querySelectorAll("input").forEach(
      i =>
        (i.onchange = () => {
          colorMode = i.value;
          refreshMap();
          if (CUR) drawNode(CUR, true);
        })
    );
    return d;
  };
  cm.addTo(map);
  const expand = L.control({position: "topleft"});
  expand.onAdd = () => {
    const button = L.DomUtil.create("button", "map-expand");
    button.type = "button";
    button.textContent = "Expandir mapa";
    button.title = "Expandir mapa";
    button.setAttribute("aria-label", "Expandir mapa");
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.on(button, "click", () => {
      setMapExpanded(!document.querySelector(".layout").classList.contains("map-expanded"));
    });
    return button;
  };
  expand.addTo(map);
  map.on("zoomend", () => {
    const z = map.getZoom();
    layerAll.eachLayer(m => m.setRadius && m.setRadius(rad(z, m.options.crit)));
  });
}

/** Alterna el mapa entre su panel lateral y la pantalla completa. */
function setMapExpanded(expanded) {
  const button = document.querySelector(".map-expand");
  document.querySelector(".layout").classList.toggle("map-expanded", expanded);
  button.textContent = expanded ? "Volver al análisis" : "Expandir mapa";
  button.title = expanded ? "Volver al análisis" : "Expandir mapa";
  button.setAttribute("aria-label", button.title);
  setTimeout(() => map.invalidateSize({pan: false}), 60);
}

/**
 * Tamaño del ícono según el zoom y si la SED es crítica.
 */
const rad = (z, c) => (z >= 16 ? 8 : z >= 14 ? 6 : 4.5) * (c === 2 ? 1.45 : c ? 1.2 : 0.8);

/**
 * Encuadra el mapa para ver todas las SED analizadas.
 */
function fitAll() {
  if (!map || !DB) return;
  const pts = [...DB.LITE.values()].filter(r => ok(r.t.lat)).map(r => [r.t.lat, r.t.lon]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.05), {animate: false});
}

/**
 * Color según el % de pérdida.
 */
const lossColor = x =>
  !ok(x) ? "#9e9e9e" : x < 0.1 ? "#2e7d32" : x < 0.2 ? "#9ccc65" : x < 0.3 ? "#fdd835" : x < 0.45 ? "#fb8c00" : "#d50000";

/**
 * Color fijo por texto (cada alimentador tiene su color).
 */
const hashColor = s => {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360},65%,45%)`;
};

/**
 * Color de una SED según el modo elegido: criticidad IA, % de pérdida o alimentador.
 */
const sedColor = sed => {
  const s = DB.S.get(sed),
    lt = DB.LITE.get(sed),
    g = DB.G.get(sed);
  return colorMode === "alim"
    ? hashColor(g ? g.alim : "")
    : colorMode === "loss"
      ? lossColor(s && ok(s.pct) ? s.pct : null)
      : CCOL[lt && lt.ia ? lt.ia.clase : "Sin balance"];
};

/**
 * Vuelve a pintar todas las SED en el mapa (las críticas encima).
 */
function refreshMap() {
  if (!map || !DB) return;
  layerAll.clearLayers();
  const z = map.getZoom();
  const list = [...DB.G.values()].sort((a, b) => {
    const ca = DB.LITE.get(a.sed),
      cb = DB.LITE.get(b.sed);
    return (ca && ca.ia ? ca.ia.score : -1) - (cb && cb.ia ? cb.ia.score : -1);
  });
  for (const g of list) {
    const lt = DB.LITE.get(g.sed),
      has = !!(lt && lt.ts),
      crit = has && lt.ia && lt.ia.clase === "Crítica" ? 2 : has ? 1 : 0;
    const m = new SedMarker([g.lat, g.lon], {
      radius: rad(z, crit),
      crit,
      color: crit === 2 ? "#5d0000" : "#222",
      weight: crit === 2 ? 1.6 : has ? 0.9 : 0.5,
      fillColor: sedColor(g.sed),
      fillOpacity: has ? 0.95 : 0.35
    });
    m.bindPopup(() => popupHtml(g));
    m.addTo(layerAll);
  }
  legend();
}

/**
 * Contenido de la ventana al hacer clic en una SED del mapa.
 */
function popupHtml(g) {
  const s = DB.S.get(g.sed),
    lt = DB.LITE.get(g.sed);
  return (
    `<b>${g.sed}</b> · ${esc(g.alim)} · ${esc(g.dist)}<br>${esc(g.tipo)}<br>kVA ${fmt(g.kva, 0)} · clientes guía ${fmt(g.cli, 0)}<br>` +
    (s && ok(s.pct)
      ? `E. dist ${fmt(s.dist)} MWh · E. fact. val. ${fmt(s.fv)} MWh<br>Pérdida ${fmt(s.perd)} MWh (${pctf(s.pct)}) · PNT ${fmt(s.pnt)} MWh${lt && lt.ia ? `<br>Criticidad IA: <b>${lt.ia.clase}</b> (${fmt(100 * lt.ia.score, 0)}) · Excel: ${esc(s.crit) || "-"}` : ""}`
      : "<i>Sin balance en los archivos</i>") +
    `<br><button class="btn" style="margin-top:6px;padding:4px 10px" onclick="run('${g.sed}')">Analizar</button> <button class="btn sec" style="margin-top:6px;padding:4px 10px" onclick="openSV(${g.lat},${g.lon},'${g.sed}')">📷 Street View</button>`
  );
}

/**
 * Actualiza la leyenda del mapa.
 */
function legend() {
  const d = $("#legend");
  if (!d) return;
  const tri = c =>
    `<svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align:-2px;margin-right:6px"><polygon points="7,1 13,9 1,9" fill="${c}" stroke="#222"/><circle cx="4.3" cy="11.3" r="1.8" fill="#fff" stroke="#222"/><circle cx="9.7" cy="11.3" r="1.8" fill="#fff" stroke="#222"/></svg>`;
  const top =
    colorMode === "crit"
      ? `<b>SED · criticidad IA</b><br>` +
        Object.entries(CCOL)
          .map(([t, c]) => tri(c) + t)
          .join("<br>")
      : colorMode === "loss"
        ? `<b>SED · % pérdida</b><br>` +
          [
            ["<10%", "#2e7d32"],
            ["10-20%", "#9ccc65"],
            ["20-30%", "#fdd835"],
            ["30-45%", "#fb8c00"],
            [">45%", "#d50000"],
            ["sin balance", "#9e9e9e"]
          ]
            .map(([t, c]) => tri(c) + t)
            .join("<br>")
        : `<b>SED · color = alimentador</b>`;
  d.innerHTML =
    top +
    `<br><b>Iteraciones</b><br><span style="font-size:11px">elipse de color = par objetivo + aledaño<br>punteada = aledaño sin balance<br>círculo verde = área de servicio estimada</span><br><b>Tramos (capa "Tramos por hurto")</b><br>` +
    [
      ["≥ 15", "#b71c1c"],
      ["5 – 15", "#e53935"],
      ["1 – 5", "#fb8c00"],
      ["< 1", "#fdd835"]
    ]
      .map(([t, c]) => `<i style="background:${c}"></i>${t} MWh/mes`)
      .join("<br>");
}

/**
 * Envolvente convexa de un conjunto de puntos (algoritmo de la cadena monótona).
 */
function hull(pts) {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const cr = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lo = [],
    up = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/**
 * Elipse alrededor de un par de SED (objetivo + aledaña) para mostrar cada iteración en el mapa.
 */
function ellipse(a, b, i) {
  // elipse alrededor del par (a, b) en metros, como en el croquis de iteraciones
  if (!ok(a.lat) || !ok(b.lat) || hav(a.lat, a.lon, b.lat, b.lon) > 3000) return null;
  const lat0 = (a.lat + b.lat) / 2,
    lon0 = (a.lon + b.lon) / 2,
    kx = 111320 * Math.cos((lat0 * Math.PI) / 180),
    ky = 110540;
  const dx = (b.lon - a.lon) * kx,
    dy = (b.lat - a.lat) * ky,
    d = Math.hypot(dx, dy),
    th = Math.atan2(dy, dx),
    A = d / 2 + 45,
    Bm = 26 + 7 * (i % 4);
  const pts = [];
  for (let k = 0; k < 60; k++) {
    const u = (2 * Math.PI * k) / 60,
      ex = A * Math.cos(u),
      ey = Bm * Math.sin(u);
    pts.push([lat0 + (ex * Math.sin(th) + ey * Math.cos(th)) / ky, lon0 + (ex * Math.cos(th) - ey * Math.sin(th)) / kx]);
  }
  const off = Bm + 22,
    lab = [lat0 + (0.25 * d * Math.sin(th) + off * Math.cos(th)) / ky, lon0 + (0.25 * d * Math.cos(th) - off * Math.sin(th)) / kx];
  return {pts, lab};
}

/**
 * Dibuja en el mapa el nodo analizado: aledañas con distancia, elipses de iteración, áreas de servicio,
 * radio usado, candidatas no incluidas, error de cadena y tramos por hurto.
 */
function drawNode(R, keepView) {
  if (!map) return;
  layerNode.clearLayers();
  layerTram.clearLayers();
  const t = R.t;
  if (t.sinCoord) return;
  const pts = [[t.lat, t.lon]];
  L.circle([t.lat, t.lon], {radius: R.p.R, color: "#3a57a7", weight: 1, dashArray: "4 4", fill: false}).addTo(layerNode);
  R.rows.forEach(r => {
    if (ok(r.lat))
      L.circle([r.lat, r.lon], {
        radius: srvR(r.cli || r.cliRef),
        color: "#5fa64a",
        weight: 1,
        dashArray: "3 5",
        fillColor: "#5fa64a",
        fillOpacity: 0.06,
        interactive: false
      }).addTo(layerNode);
  });
  if (R.nb.Rused > R.p.R + 1)
    L.circle([t.lat, t.lon], {radius: R.nb.Rused, color: "#f8a400", weight: 1.5, dashArray: "2 6", fill: false})
      .bindTooltip(`Radio ampliado ${fmt(R.nb.Rused, 0)} m`)
      .addTo(layerNode);
  R.rows.slice(1).forEach(r => pts.push([r.lat, r.lon]));
  R.nb.cand
    .filter(c => !c.sel)
    .forEach(c =>
      new SedMarker([c.g.lat, c.g.lon], {radius: 8, color: "#3a57a7", weight: 2, fillColor: "#ffffff", fillOpacity: 0.6})
        .bindTooltip(`${c.g.sed} (no incluida) · ${fmt(c.d, 0)} m · P ${pctf(c.prob, 0)}`)
        .addTo(layerNode)
    );
  // líneas entre SED del nodo con su distancia (gris punteado)
  R.T.forEach(x =>
    L.polyline(x.latlngs, {color: "#8a8a8a", weight: 2.5, dashArray: "7 6", opacity: 0.9})
      .bindTooltip(`${fmt(x.d, 0)} m`, {permanent: true, direction: "center", className: "dist"})
      .addTo(layerNode)
  );
  // tramos por intensidad de hurto (capa opcional)
  R.T.forEach(x =>
    L.polyline(x.latlngs, {
      color: tramoColor(x.mwh),
      weight: x.mwh === null ? 3 : 3 + Math.min(8, x.mwh / 3),
      opacity: 0.85,
      dashArray: x.mwh === null || x.parcial ? "8 6" : null
    })
      .bindPopup(
        `<b>Tramo ${x.a} – ${x.b}</b><br>Distancia: ${fmt(x.d, 0)} m<br>Hurto estimado: ${x.mwh === null ? "sin medición" : fmt(x.mwh) + " MWh/mes"} (${tramoNivel(x.mwh)})`
      )
      .addTo(layerTram)
  );
  // elipses de iteración (objetivo + aledaño que se agrega)
  R.IT.slice(1).forEach((it, i) => {
    const col = ITC[i % ITC.length],
      e = ellipse(t, it.nuevo, i);
    if (!e) return;
    L.polygon(e.pts, {color: col, weight: 3, fill: true, fillColor: col, fillOpacity: 0.05, dashArray: it.skip ? "6 6" : null})
      .bindPopup(
        `<b>Iteración ${it.k}</b>: se agrega ${it.nuevo.sed} (${fmt(it.nuevo.d, 0)} m)${it.skip ? " · sin balance" : ""}<br>Pérdida real estimada de ${R.sed}: ${fmt(it.realO)} MWh<br>Mayor pérdida del nodo: <b>${it.lead ? it.lead.r.sed + " (" + fmt(it.lead.ex) + " MWh)" : "-"}</b>`
      )
      .addTo(layerNode);
    L.marker(e.lab, {
      icon: L.divIcon({
        className: "",
        html: `<span class="itlab" style="border-color:${col};color:${col}">Iteración ${it.k}</span>`,
        iconAnchor: [40, 10]
      }),
      interactive: false
    }).addTo(layerNode);
  });
  // pares con error de cadena (flecha roja: de la SED que factura de más a la que pierde de más)
  R.cadPairs.forEach(x => {
    if (!ok(x.i.lat) || !ok(x.j.lat)) return;
    L.polyline(
      [
        [x.i.lat, x.i.lon],
        [x.j.lat, x.j.lon]
      ],
      {color: "#c00000", weight: 5, dashArray: "2 8", lineCap: "round"}
    )
      .bindTooltip(`Error de cadena ${x.i.sed} ↔ ${x.j.sed} · P ${pctf(x.pCad, 0)} · ${fmt(x.xMax)} MWh`, {sticky: true})
      .addTo(layerNode);
  });
  const mcol = r => (colorMode === "crit" ? (r.ia ? CCOL[r.ia.clase] : "#bdbdbd") : sedColor(r.sed));
  R.rows.slice(1).forEach(r => {
    const isC = r.ia && r.ia.clase === "Crítica";
    new SedMarker([r.lat, r.lon], {
      radius: isC ? 13 : 11,
      color: R.gen === r ? "#000" : "#222",
      weight: R.gen === r ? 3.5 : 2,
      fillColor: mcol(r),
      fillOpacity: 1
    })
      .bindTooltip(
        `<b>${r.sed}</b> · ${fmt(r.d, 0)} m · ${esc(r.alim)}<br>Pérdida ${fmt(r.perd)} MWh${r.medida ? "" : " (estimada)"} · criticidad IA ${r.ia ? r.ia.clase : "s/d"}`
      )
      .bindPopup(
        `<b>${r.sed}</b> · aledaña a ${fmt(r.d, 0)} m<br>Pérdida ${fmt(r.perd)} MWh<br><button class="btn" style="margin-top:6px;padding:4px 10px" onclick="run('${r.sed}')">Analizar</button> <button class="btn sec" style="margin-top:6px;padding:4px 10px" onclick="openSV(${r.lat},${r.lon},'${r.sed}')">📷 Street View</button>`
      )
      .addTo(layerNode);
    L.marker([r.lat, r.lon], {
      icon: L.divIcon({
        className: "",
        html: `<span class="slab"${isC ? ' style="background:#d50000;color:#fff"' : ""}>${r.sed}${R.gen === r ? " · mayor pérdida" : ""}</span>`,
        iconAnchor: [-14, 8]
      }),
      interactive: false
    }).addTo(layerNode);
  });
  const tC = R.ia && R.ia.clase === "Crítica";
  new SedMarker([t.lat, t.lon], {
    radius: 16,
    color: "#000",
    weight: R.gen === R.rows[0] ? 3.5 : 2.5,
    fillColor: mcol(R.rows[0]),
    fillOpacity: 1
  })
    .bindTooltip(
      `<b>${R.sed}</b> (analizada)<br>Pérdida ${fmt(R.ts ? R.ts.perd : null)} MWh · real tras iterar ${fmt(R.rows[0].corr)} MWh<br>Criticidad IA ${R.ia ? R.ia.clase : "-"} · ${R.clase}`
    )
    .bindPopup(
      `<b>${R.sed}</b> (analizada)<br><button class="btn sec" style="margin-top:6px;padding:4px 10px" onclick="openSV(${t.lat},${t.lon},'${R.sed}')">📷 Street View</button>`
    )
    .addTo(layerNode)
    .openTooltip();
  L.marker([t.lat, t.lon], {
    icon: L.divIcon({
      className: "",
      html: `<span class="slab" style="background:${tC ? "#d50000" : "#3a57a7"};color:#fff">${R.sed}${R.gen === R.rows[0] ? " · mayor pérdida" : ""}</span>`,
      iconAnchor: [-18, 10]
    }),
    interactive: false
  }).addTo(layerNode);
  if (!keepView) map.fitBounds(L.latLngBounds(pts).pad(0.35), {maxZoom: 17, animate: false});
}
