/* ============================================================================================================
 * ARCHIVO 14 · INTERFAZ DE LA PANTALLA 3 Y DIBUJO DE LOS 6 MÉTODOS
 *   - run(): botón Ejecutar. Si se escribe una SED la analiza; si se pegan varias, llama al análisis masivo.
 *   - clearAll(): botón Limpiar.
 *   - openSV(): ventana con las fotos de Google Street View de la SED.
 *   - BASE_COLS / fmtTable(): columnas comunes de las tablas (SED, Tipo, Dist., E. Distribuida, E. Fact., Pérdida, Desv.).
 *   - chartIter(): gráfico de barras de la iteración nodal.
 *   - render(): escribe en pantalla el resultado completo de una SED (Métodos 1 a 6 y conclusión).
 * Para cambiar textos o columnas de un método, busque M(1, ...), M(2, ...), etc. dentro de render().
 * ========================================================================================================== */
"use strict";

/**
 * CUR = resultado de la SED que se está viendo · MANUAL = aledañas marcadas o desmarcadas a mano.
 */
let CUR = null,
  MANUAL = new Map();

/**
 * Desplaza la página hasta el elemento (por ejemplo, el resultado de una SED) dejando visibles las pestañas.
 */
function verEn(el) {
  // lleva el elemento a la parte de arriba del panel izquierdo, sin mover la página
  if (!el) return;
  const tb = $(".tabs"),
    h = tb ? tb.getBoundingClientRect().height : 0;
  window.scrollTo({top: el.getBoundingClientRect().top + window.scrollY - h - 8});
}

/**
 * Separa el texto del buscador en códigos de SED (coma, espacio, punto y coma o salto de línea) sin repetir.
 */
const parseSeds = txt => [
  ...new Set(
    String(txt || "")
      .toUpperCase()
      .split(/[\s,;|]+/)
      .map(s => s.trim())
      .filter(Boolean)
  )
];

/**
 * Botón Ejecutar de la pantalla 3. Con una SED: la analiza, dibuja los 6 métodos y la ubica en el mapa.
 * Con varias SED: llama a runMass (análisis masivo). keep = true mantiene la vista (al marcar aledañas).
 */
function run(sed, keep) {
  if (!hayDatos()) {
    showTab("t3");
    $("#result").innerHTML =
      `<p class="hint vacio">Aún no hay datos: cargue el Balance SED SI – CAMPO y la GUIA_SETIEMBRE en la pantalla 1 y pulse Ejecutar.</p>`;
    return;
  }
  if (!sed) {
    const L = parseSeds($("#sedInput").value);
    if (!L.length) return;
    if (L.length > 1) return runMass(L);
    sed = L[0];
  }
  sed = String(sed).trim().toUpperCase();
  if (!sed) return;
  $("#massBack").style.display = MASS ? "" : "none";
  showTab("t3");
  if (!DB.S.has(sed)) {
    $("#result").innerHTML =
      `<p class="status err">La SED ${esc(sed)} no tiene balance en el rango ${mlab(RANGE.a)} a ${mlab(RANGE.b)}.</p>`;
    return;
  }
  if (!DB.G.has(sed)) {
    $("#result").innerHTML =
      `<p class="status err">La SED ${esc(sed)} no está en la GUIA SED cargada (no tiene coordenadas): no se puede formar su nodo de aledaños.</p>`;
    return;
  }
  if (JSON.stringify(DB.p) !== JSON.stringify(P())) build();
  if (!keep || !CUR || CUR.sed !== sed) MANUAL = new Map();
  CUR = analyze(sed, P(), {manual: MANUAL});
  if (!MASS) $("#sedInput").value = sed;
  $("#prioBox").open = false;
  render(CUR);
  drawNode(CUR);
  $("#xlsNode").disabled = false;
  if (!keep) verEn($("#result"));
}

/**
 * Botón Limpiar: borra el análisis, el análisis masivo y vuelve a mostrar la priorización.
 */
function clearAll() {
  if (!hayDatos()) {
    vaciar();
    return;
  }
  CUR = null;
  MANUAL = new Map();
  MASS = null;
  $("#sedInput").value = "";
  $("#xlsMass").disabled = true;
  $("#massBack").style.display = "none";
  if (layerMass) layerMass.clearLayers();
  $("#result").innerHTML =
    `<p class="hint">Elija una SED de la priorización, escríbala arriba o haga clic en el mapa y pulse "Analizar".</p>`;
  if (layerNode) {
    layerNode.clearLayers();
    layerTram.clearLayers();
  }
  $("#xlsNode").disabled = true;
  $("#prioBox").open = true;
  fitAll();
}

/**
 * Etiqueta de color para la calidad del dato (OK, Sin balance, Fact > Dist, Utilización >100 %).
 */
const tagQC = q =>
  q === "OK"
    ? `<span class="tag t-ok">OK</span>`
    : q === "Sin balance"
      ? `<span class="tag t-warn">Sin balance</span>`
      : `<span class="tag t-bad">${q}</span>`;

/**
 * Etiqueta de nivel de sospecha de hurto (ALTA / MEDIA / BAJA).
 */
const tagN = (n, short) =>
  `<span class="tag ${n === "ALTA" ? "t-alta" : n === "MEDIA" ? "t-media" : n === "BAJA" ? "t-baja" : "t-gray"}">${short ? n : "Sospecha de hurto: " + n}</span>`;

/**
 * Etiqueta de color de la criticidad IA.
 */
const tagC = c =>
  c
    ? `<span class="tag" style="background:${CCOL[c]};color:${c === "Media" ? "#333" : "#fff"}">${c}</span>`
    : `<span class="tag t-gray">sin balance</span>`;

/**
 * Etiqueta del rol de la SED en el nodo (Mayor pérdida, Compensa, Estimada, Pierde).
 */
const tagR = r =>
  r === "Validar TOTA"
    ? `<span class="rol est">Validar TOTA</span>`
    : r === "Mayor pérdida"
      ? `<span class="rol gen">Mayor pérdida</span>`
      : r === "Compensa"
        ? `<span class="rol comp">Compensa</span>`
        : r === "Estimada"
          ? `<span class="rol est">Estimada</span>`
          : `<span class="rol norm">Pierde</span>`;

/**
 * Formato con 2 decimales (alias corto de fmt).
 */
const e2 = v => fmt(v);

/**
 * Botón 📷 que abre Street View en la ubicación de la SED (big = botón grande con texto).
 */
const svBtn = (lat, lon, sed, big) =>
  ok(lat) && ok(lon)
    ? `<button class="svb${big ? " big" : ""}" title="Ver fotos Street View de ${sed}" onclick="event.stopPropagation();openSV(${lat},${lon},'${sed}')">📷${big ? " Street View" : ""}</button>`
    : "";

/**
 * Abre la ventana de Google Street View en las coordenadas de la SED, con enlaces a Google Maps.
 * No necesita clave de Google; requiere internet.
 */
function openSV(lat, lon, sed) {
  let m = $("#svModal");
  if (!m) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="svModal" class="svm"><div class="svbox"><div class="svhead"><b id="svTit"></b><span style="flex:1"></span><a id="svLnk" class="btn sec" target="_blank" rel="noopener">Abrir en Google Street View ↗</a><a id="svMap" class="btn sec" target="_blank" rel="noopener">Ver en Google Maps ↗</a><button class="btn clear" id="svClose">✕ Cerrar</button></div><iframe id="svFrame" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe><p class="small" id="svNota"></p></div></div>`
    );
    m = $("#svModal");
    $("#svClose").onclick = () => {
      m.classList.remove("on");
      $("#svFrame").src = "about:blank";
    };
    m.onclick = e => {
      if (e.target === m) $("#svClose").onclick();
    };
  }
  const ll = `${(+lat).toFixed(6)},${(+lon).toFixed(6)}`;
  $("#svTit").textContent = `Street View · SED ${sed} (${ll})`;
  $("#svFrame").src = `https://maps.google.com/maps?layer=c&cbll=${ll}&cbp=11,0,0,0,0&output=svembed`;
  $("#svLnk").href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}`;
  $("#svMap").href = `https://www.google.com/maps/search/?api=1&query=${ll}`;
  $("#svNota").innerHTML =
    "Fotos de Google Street View en la ubicación de la GUIA SED (requiere internet). Si no aparece imagen, la calle no tiene fotos en ese punto: use «Abrir en Google Street View», que busca la foto más cercana.";
  m.classList.add("on");
}

/**
 * Etiqueta del resultado de compensación de una SED (Método 1).
 */
const tagCmp = r => (r.cmp ? `<span class="tag ${r.cmp.cls}">${r.cmp.est}</span>` : "");

/**
 * Texto rojo "Error en factor" con la operación (mes, valor original ÷ FACTOR = valor corregido).
 */
const efTxt = r =>
  r.s && r.s.errFactor
    ? `<div class="efac-txt">Error en factor: ${r.s.errFactor.months.map(m => `${m.lab} ${fmt(m.raw)} ÷ ${fmt(r.s.errFactor.factor, 0)} = ${fmt(m.fix)} MWh`).join(" · ")}</div>`
    : "";

/**
 * Rol de la SED + resultado de compensación + detalle (columna "Rol en el nodo").
 */
const rolCmp = r =>
  `${efTxt(r)}${r.rol1 === "Compensa" && r.cmp && r.cmp.part ? "" : tagR(r.rol1)} ${tagCmp(r)}${r.cmp && r.cmp.det ? `<div class="cmpd">${r.cmp.det}</div>` : ""}`;

/**
 * Color del resultado de compensación del objetivo (rojo, verde, amarillo, gris).
 */
const bloqCls = b => (/^No se compensa/.test(b) ? "b1" : /^Se compensa|compensa a sus/.test(b) ? "b2" : /parcial/.test(b) ? "b3" : "b0");

/**
 * Resultado de compensación en texto (para Excel); si hubo error en factor lo antepone.
 */
const cmpTxt = r =>
  (r.s && r.s.errFactor
    ? `ERROR EN FACTOR (${r.s.errFactor.months.map(m => `${m.lab} ${fmt(m.raw)} ÷ ${fmt(r.s.errFactor.factor, 0)}`).join(", ")}) · `
    : "") + (r.cmp ? `${r.cmp.est}${r.cmp.det ? " · " + r.cmp.det : ""}` : "");

/**
 * Columnas comunes de las tablas de los métodos: [título, función que da el valor, clase CSS, clase del encabezado].
 * E. Distribuida corregida por error en factor se muestra en morado (al pasar el mouse muestra la operación).
 * Para agregar o quitar una columna en TODAS las tablas de métodos, edite esta lista (y NODE_BASE).
 */
const BASE_COLS = [
  ["SED", r => r.sed, "l"],
  ["Tipo", r => (r.rol === "Objetivo" ? "Objetivo" : "Aledaña"), "l"],
  ["Dist. (m)", r => (r.rol === "Objetivo" ? "-" : fmt(r.d, 0))],
  [
    "E. Distribuida (MWh) Balance",
    r =>
      r.s && r.s.errFactor
        ? `<span class="efac" title="Error en factor: ${r.s.errFactor.months.map(m => `${m.lab} ${fmt(m.raw)} ÷ ${fmt(r.s.errFactor.factor, 0)} = ${fmt(m.fix)}`).join(" · ")}">${e2(r.dist)}</span>`
        : e2(ok(r.dist) ? r.dist : r.distU) + (ok(r.dist) ? "" : "*")
  ],
  ["E. Fact. Balance (MWh)", r => (r.s ? e2(r.factBal) : ok(r.fv) ? e2(r.fv) + "*" : "-")],
  ["Pérdida Validación (MWh)", r => `<b class="${r.perd < 0 ? "neg" : ""}">${e2(r.perd)}</b>`],
  ["Desv. Fact. (%)", r => `<span class="neg">${pctf(r.desv)}</span>`, "", "y"]
];

/**
 * Fila NODO de las tablas: suma de las SED CON balance (medidas). Las SED estimadas se muestran en una fila aparte.
 */
const NODE_BASE = n => ["NODO", "Total medido", "", e2(n.dist), e2(n.fv), `<b>${e2(n.perd)}</b>`, pctf(n.desv)];

/**
 * Arma una tabla HTML con las columnas comunes + columnas extra, una fila por SED del nodo y la fila NODO.
 */
function fmtTable(R, extra, nodeExtra, opt = {}) {
  const cols = (opt.base || BASE_COLS).concat(extra),
    rows = opt.rows || R.rows;
  const nb = opt.nodeBase || NODE_BASE(R.node),
    hlIdx = opt.hl ?? 5;
  return `<div class="tblwrap"><table><thead><tr>${cols.map(c => `<th class="${c[3] || ""}">${c[0]}</th>`).join("")}</tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.rol === "Objetivo" ? "obj" : ""} ${r.medida ? "" : "est"} ${opt.mark && opt.mark(r) ? "gen" : ""}">${cols.map(c => `<td class="${c[2] || ""}">${c[1](r)}</td>`).join("")}</tr>`).join("")}
    <tr class="node">${nb
      .concat(nodeExtra)
      .map((v, i) => `<td class="${i < 2 ? "l" : ""} ${i === hlIdx ? "hl" : ""}">${v}</td>`)
      .join("")}</tr>
    ${!opt.nodeBase && R.node.est && R.node.est.n ? `<tr class="est"><td class="l" colspan="3">Sin balance (${R.node.est.n} SED estimadas, no suman al NODO)</td><td>${e2(R.node.est.dist)}*</td><td>${e2(R.node.est.fv)}*</td><td>${e2(R.node.est.perd)}*</td>${"<td></td>".repeat(Math.max(0, nb.length + nodeExtra.length - 6))}</tr>` : ""}</tbody></table></div>`;
}

/**
 * Gráfico (SVG) de la iteración nodal: barras = pérdida del nodo en cada iteración; línea = pérdida real del objetivo.
 */
function chartIter(R) {
  if (!R.ts || !R.rows[0].medida || R.IT.length < 2) return "";
  const pts = R.IT.map((it, k) => ({
    lab: it.nuevo.sed,
    sub: k === 0 ? "solo la SED" : it.skip ? `It.${k} · s/balance` : `It.${k} · ${fmt(it.nuevo.d, 0)} m`,
    bar: it.tab.reduce((s, x) => s + (x.r.medida ? x.r.perd : 0), 0),
    line: it.realO,
    lead: it.lead ? it.lead.r.sed : "-",
    col: k === 0 ? "var(--pl-blue)" : ITC[(k - 1) % ITC.length]
  }));
  const W = 560,
    H = 250,
    L0 = 40,
    B = 44,
    T0 = 34,
    w = (W - L0 - 16) / pts.length;
  const all = pts.flatMap(x => [x.bar, x.line]).filter(ok),
    mx = Math.max(1, ...all),
    mn = Math.min(0, ...all),
    y = v => T0 + ((mx - v) / (mx - mn || 1)) * (H - T0 - B);
  const fs = pts.length > 6 ? 9.5 : 11;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Iteraciones del nodo"><line class="ax" x1="${L0}" x2="${W - 16}" y1="${y(0)}" y2="${y(0)}"/>`;
  pts.forEach((x, i) => {
    const cx = L0 + i * w + w / 2,
      yy = Math.min(y(x.bar), y(0)),
      h = Math.abs(y(x.bar) - y(0));
    s += `<rect x="${cx - w * 0.28}" y="${yy}" width="${w * 0.56}" height="${Math.max(1, h)}" fill="${x.col}" opacity="${i === 0 ? 1 : 0.6}" rx="2"><title>Pérdida medida del nodo en la iteración ${i}: ${fmt(x.bar)} MWh</title></rect>`;
    s +=
      h > 16
        ? `<text x="${cx}" y="${x.bar >= 0 ? y(0) - 5 : y(0) + 14}" text-anchor="middle" style="fill:#fff;font-weight:700">${fmt(x.bar, 1)}</text>`
        : `<text x="${cx}" y="${yy - 3}" text-anchor="middle">${fmt(x.bar, 1)}</text>`;
    s += `<text x="${cx}" y="${T0 - 20}" text-anchor="middle" style="font-weight:700;font-size:${fs}px;fill:var(--accent)">${x.lead}</text>`;
    s += `<text x="${cx}" y="${H - B + 15}" text-anchor="middle" style="font-weight:600;font-size:${fs}px">${x.lab}</text><text x="${cx}" y="${H - B + 29}" text-anchor="middle" style="fill:var(--muted);font-size:${fs}px">${x.sub}</text>`;
  });
  const lp = pts.map((x, i) => (ok(x.line) ? `${L0 + i * w + w / 2},${y(x.line)}` : null)).filter(Boolean);
  s += `<polyline fill="none" stroke="var(--pl-yellow)" stroke-width="3" points="${lp.join(" ")}"/>`;
  pts.forEach((x, i) => {
    if (ok(x.line))
      s += `<circle cx="${L0 + i * w + w / 2}" cy="${y(x.line)}" r="4.5" fill="var(--pl-yellow)" stroke="#7a5c00"/><text x="${L0 + i * w + w / 2 + 7}" y="${y(x.line) - 7}" style="font-weight:700;paint-order:stroke;stroke:var(--panel);stroke-width:3px">${fmt(x.line, 1)}</text>`;
  });
  return (
    s +
    `</svg><details class="que"><summary>¿Cómo se lee el gráfico?</summary><p class="small">Barras: pérdida medida del nodo en cada iteración (MWh). <span style="color:#b38f00">●</span> Línea: pérdida real estimada de ${R.sed}, que se ajusta en cada iteración. Arriba en rojo: la SED con mayor pérdida real en esa iteración.</p></details>`
  );
}

/**
 * Escribe en pantalla el análisis completo de una SED: KPIs, veredicto, Métodos 1 a 6 y la conclusión.
 * Cada método se arma con M(nº, título, técnica, explicación, contenido, resultado).
 */
function render(R) {
  const {t, ts, rows, node} = R,
    a = R.alim || {},
    R0 = rows[0],
    QR = R.QR,
    M1 = R.m1;
  const sumR = (list, k) => list.reduce((s, r) => s + (ok(r[k]) ? r[k] : 0), 0);
  const cand = R.nb.cand
    .map(
      c =>
        `<tr><td class="l"><input type="checkbox" data-s="${c.g.sed}" ${c.sel ? "checked" : ""}> ${c.g.sed}</td><td>${fmt(c.d, 0)}</td><td class="l">${esc(c.g.alim) || "-"}</td><td>${c.gab ? "sí" : "no"}</td><td>${c.touch ? "sí" : "no"}</td><td>${c.sameA ? "sí" : "no"}</td><td>${c.hasBal ? "sí" : "no"}</td><td>${fmt(c.g.cli, 0)}</td><td><b>${pctf(c.prob, 0)}</b></td><td class="l">${c.sel ? (c.forz ? `<span class="tag t-warn">${c.crit}</span>` : "probabilidad") : "-"}</td></tr>`
    )
    .join("");
  const dm = `<div class="tblwrap"><table><thead><tr><th>m</th>${rows.map(r => `<th>${r.sed}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr><td class="l"><b>${r.sed}</b></td>${R.DM[i].map((d, j) => `<td>${i === j ? "-" : fmt(d, 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  /* Método 1 */
  // Método 1: tabla del nodo con Clientes, Pérdida por cliente, Rol en el nodo + compensación y Calidad.
  const c1 = fmtTable(
    R,
    [
      ["Clientes", r => fmt(r.cli, 0)],
      ["Pérdida por cliente (kWh)", r => fmt(r.perdCli, 0)],
      ["Rol en el nodo · compensación (0–3 MWh)", r => rolCmp(r), "l"],
      ["Calidad", r => tagQC(r.qc)]
    ],
    [fmt(node.cli, 0), "", "", ""]
  );
  const CN = M1.CN;
  const blkRows = rows
    .map((r, i) => {
      const c = r.cmp;
      const rel =
        r.perd < 0
          ? c.para.map(x => `→ ${x.r.sed}: ${fmt(x.mwh)}${x.paso < 3 ? ` · par 0–3 (dif. ${fmt(x.dif)})` : " · sobrante"}`).join("<br>")
          : c.con.map(x => `← ${x.r.sed}: ${fmt(x.mwh)}${x.paso < 3 ? ` · par 0–3 (dif. ${fmt(x.dif)})` : " · sobrante"}`).join("<br>");
      return `<tr class="${i === 0 ? "o" : r.perd < 0 && c.para.length ? "neg" : ""}"><td class="l"><b>${r.sed}</b> ${svBtn(r.lat, r.lon, r.sed)}</td><td class="l">${i === 0 ? "Objetivo" : "Aledaña"}</td><td>${i === 0 ? "-" : fmt(r.d, 0)}</td><td><b class="${r.perd < 0 ? "neg" : ""}">${e2(r.perd)}</b>${c.part ? "" : "*"}</td><td class="l w">${rel || "-"}</td><td>${c.part ? e2(c.resto) : "-"}</td><td>${e2(c.acum)}</td><td class="l w" style="min-width:105px">${tagCmp(r)}</td></tr>`;
    })
    .join("");
  const blkCard = !ts
    ? ""
    : `<div class="card" style="margin-top:8px"><h3 style="margin:0 0 4px">Compensación por SED</h3>
    <div class="tblwrap"><table class="cmpblk"><thead><tr><th>SED</th><th>Tipo</th><th>Dist. (m)</th><th>Pérdida Validación (MWh)</th><th>Compensación</th><th>Queda (MWh)</th><th>Saldo acumulado (MWh)</th><th>Resultado</th></tr></thead><tbody>${blkRows}
    <tr class="node"><td class="l">NODO</td><td class="l">Total</td><td></td><td class="hl"><b>${e2(CN.tot)}</b></td><td class="l w">${fmt(CN.objComp)} MWh compensan al objetivo</td><td><b>${e2(CN.objResto)}</b></td><td><b>${e2(CN.tot)}</b></td><td class="l w" style="min-width:120px"><span class="bloq ${bloqCls(CN.res)}">${CN.res}</span></td></tr></tbody></table></div>
    <details class="que"><summary>Ver el criterio de compensación</summary><div class="small">
      Una SED con <b>Pérdida Validación negativa</b> factura más de lo que recibe: es la única que puede compensar. Dos SED se compensan si <b>Diferencia = | Pérdida SED A − | Pérdida SED B | | está entre 0 y ${TOLC} MWh</b>.<br>
      1) El valor del objetivo se busca en las aledañas negativas (ejemplo: objetivo 25 y aledaña −23 → diferencia 2 → se compensa; el nodo queda 25 − 23 + 1 + 2 = 5).<br>
      2) Las negativas que quedan se emparejan con aledaños con pérdida (ejemplo: 10 y −10 → diferencia 0 → se compensan).<br>
      3) Lo que sobra de las negativas se descuenta primero al objetivo y luego a los aledaños más cercanos (ejemplo: objetivo 25 con −10, −15 y 10 → el −10 cubre al 10 y el −15 baja el objetivo a 10 → compensa parcialmente).<br>
      Si ninguna aledaña es negativa, nada resta (ejemplo: 25 + 10 + 10 + 5 = 50) → no se compensa: pérdida crítica. Una compensación menor a 3 MWh no se considera.<br>
      Saldo acumulado = suma de la Pérdida Validación desde el objetivo hasta esa fila; la última fila es el total del nodo. * SED estimada: no entra a la compensación.</div></details></div>`;
  const m1txt = !ts
    ? "Sin balance de la SED."
    : `Objetivo <b>${R.sed}</b>: ${tagCmp(R0)} ${R0.cmp.det ? R0.cmp.det + "." : ""}<br>
    ${M1.compAll.length ? `SED con pérdida negativa: <b>${M1.compAll.map(r => `${r.sed} (${e2(r.perd)})`).join(", ")}</b>. ` : "Ninguna SED del nodo tiene pérdida negativa. "}
    ${M1.gen ? `Mayor pérdida: <b>${M1.gen.sed}</b>${M1.gen.rol === "Objetivo" ? " (la analizada)" : ` (aledaño a ${fmt(M1.gen.d, 0)} m)`} con ${e2(M1.gen.perd)} MWh.` : ""} Total del nodo: <b>${e2(node.perd)} MWh</b>.`;
  /* Cuadro 3: iteraciones */
  // Método 4: un bloque desplegable por iteración (tabla del nodo + pasos de traslado por error de cadena).
  const itBlocks = R.IT.map((it, k) => {
    const map = new Map(it.tab.map(x => [x.r, x])),
      rws = it.tab.map(x => x.r),
      rm = rws.filter(r => r.medida),
      nn = {dist: sumR(rm, "distU"), factBal: sumR(rm, "factBal"), fv: sumR(rm, "fv"), reg: 0, alp: 0};
    nn.perd = nn.dist - nn.fv;
    {
      const mm = rws.filter(r => r.s && ok(r.desv)),
        fb = sumR(mm, "factBal");
      nn.desv = mm.length && fb > 0 ? mm.reduce((a, r) => a + r.desv * r.factBal, 0) / fb : null;
    }
    const tb = fmtTable(
      R,
      [
        ["Pérdida esperada (MWh)", r => e2(r.esp)],
        [
          "Ajuste por cadena (MWh)",
          r => {
            const v = map.get(r).adj;
            return ok(v) && Math.abs(v) > 0.005
              ? `<b style="color:var(--pl-green)">${v > 0 ? "+" : ""}${e2(v)}</b>`
              : r.medida
                ? fmt(0)
                : "-";
          }
        ],
        ["Pérdida real estimada (MWh)", r => `<b>${e2(map.get(r).corr)}</b>`],
        ["Exceso real (MWh)", r => `<b class="${map.get(r).ex > 0 ? "neg" : ""}">${e2(map.get(r).ex)}</b>`],
        ["Exceso por cliente (kWh)", r => fmt(map.get(r).exCli, 0)]
      ],
      [e2(sumR(rm, "esp")), e2(it.totAdj), `<b>${e2(it.totCorr)}</b>`, `<b>${e2(it.totEx)}</b>`, ""],
      {rows: rws, nodeBase: NODE_BASE(nn), mark: r => it.lead && it.lead.r === r}
    );
    const trs = it.tr.length
      ? it.tr
          .map(
            x =>
              `<div class="small" style="margin:2px 0">Paso ${x.paso}: <b>${x.i.sed}</b> factura de más → <b>${x.j.sed}</b> pierde de más · ${x.lrs.map(([n, v]) => `${n} <span style="color:${v > 1 ? "var(--accent)" : "var(--ok)"}">×${fmt(v, 2)}</span>`).join(" · ")} → P(cadena) <b>${pctf(x.pCad, 0)}</b> · compensable ${fmt(x.xMax)} MWh · se traslada <b>${fmt(x.t)} MWh</b></div>`
          )
          .join("")
      : `<div class="small">Sin transferencias de cadena: ninguna SED del nodo factura de más frente a otra que pierde de más.</div>`;
    const trsBox = it.tr.length
      ? `<details class="que"><summary>Ver los ${it.tr.length} pasos de traslado (error de cadena)</summary>${trs}</details>`
      : trs;
    const col = k === 0 ? "var(--pl-blue)" : ITC[(k - 1) % ITC.length];
    return `<details ${k === R.IT.length - 1 ? "open" : ""}><summary><span class="tag" style="background:${col};color:#fff">${k === 0 ? "Inicio" : "Iteración " + k}</span> ${k === 0 ? `solo ${R.sed}` : `se agrega ${it.nuevo.sed} (${fmt(it.nuevo.d, 0)} m)${it.skip ? " · sin balance, solo estimada" : ""}`} → mayor pérdida: <b>${it.lead ? it.lead.r.sed + " (" + fmt(it.lead.ex) + " MWh)" : "-"}</b>${it.leadCli && (!it.lead || it.leadCli.r !== it.lead.r) ? ` · por cliente: <b>${it.leadCli.r.sed}</b>` : ""}</summary>${tb}${trsBox}</details>`;
  }).join("");
  const ciRows = rows.filter(r => r.ci).sort((a, b) => b.corr - a.corr);
  const ciTable = ciRows.length
    ? `<h3 style="margin:10px 0 4px">Pérdida real con intervalo (200 simulaciones)</h3><div class="tblwrap"><table><thead><tr><th>SED</th><th>Tipo</th><th>Dist. (m)</th><th>Pérdida Validación (MWh)</th><th>Ajuste por cadena (MWh)</th><th>Pérdida real (MWh)</th><th>Intervalo P5 – P95 (MWh)</th><th>Exceso real (MWh)</th><th>P(exceso &gt; 0)</th></tr></thead><tbody>
    ${ciRows.map(r => `<tr class="${r.rol === "Objetivo" ? "obj" : ""}"><td class="l"><b>${r.sed}</b></td><td class="l">${r.rol === "Objetivo" ? "Objetivo" : "Aledaña"}</td><td>${r.rol === "Objetivo" ? "-" : fmt(r.d, 0)}</td><td>${e2(r.perd)}</td><td>${ok(r.adj) && Math.abs(r.adj) > 0.005 ? (r.adj > 0 ? "+" : "") + e2(r.adj) : fmt(0)}</td><td><b>${e2(r.corr)}</b></td><td>${fmt(r.ci.c5)} – ${fmt(r.ci.c95)}</td><td class="${r.exc > 0 ? "neg" : ""}">${e2(r.exc)}</td><td>${pctf(r.ci.pEx, 0)}</td></tr>`).join("")}</tbody></table></div>
    <p class="small">Búsqueda: ${R.FIN.nPares} pares candidatos · ${fmt(R.FIN.nSA, 0)} pasos de temple simulado · ${R.FIN.sweeps} barridos de ascensión de colinas · J final ${fmt(R.FIN.J, 3)}.</p>`
    : "";
  /* Cuadro 4: criticidad IA */
  // Método 6: tabla de criticidad IA de cada SED del nodo.
  const c4 = fmtTable(
    R,
    [
      ["Pérdida real tras iterar (MWh)", r => `<b>${e2(r.corr)}</b>`],
      ["Exceso por cliente (kWh)", r => fmt(r.excCli, 0)],
      ["% ajustado (Bayes empírico)", r => (r.s ? pctf(r.s.pctEB) : "-")],
      ["Grupo EM", r => (r.s ? r.s.gmmG || "-" : "-")],
      ["Anomalía", r => (r.s ? pctf(r.s.isoP, 0) : "-")],
      ["P(hurto)", r => pctf(r.P1, 0)],
      ["Puntaje IA", r => (r.ia ? `<b>${fmt(100 * r.ia.score, 0)}</b>` : "-")],
      ["Criticidad IA", r => tagC(r.ia ? r.ia.clase : null)],
      ["Criticidad Excel", r => (r.s ? esc(r.s.crit) || "-" : "-"), "l"],
      [
        "¿Coinciden?",
        r =>
          !r.s || !r.ia
            ? "-"
            : norm(r.s.crit).includes("CRITIC") === (r.ia.clase === "Crítica" || r.ia.clase === "Alta")
              ? "sí"
              : `<b class="neg">no</b>`
      ]
    ],
    [`<b>${e2(R.FIN.totCorr)}</b>`, "", "", "", "", "", "", "", "", ""]
  );
  const months = DB.common;
  const mrows = rows
    .filter(r => r.s)
    .map(
      r =>
        `<tr class="${r.rol === "Objetivo" ? "obj" : ""}"><td class="l">${r.sed}</td>${r.s.raw
          .map((m, i) => {
            const o = r.s.series[i];
            const cl = r.s.cliS ? r.s.cliS[i] : null;
            return o
              ? `<td>${fmt(o.d, 1)} / ${fmt(o.f, 1)} → <b class="${o.l < 0 ? "neg" : ""}">${fmt(o.l, 1)}</b> (${pctf(o.pc, 0)})${ok(cl) ? `<br><span class="small">${fmt(cl, 0)} clientes</span>` : ""}</td>`
              : `<td style="color:var(--muted)">${!m.okD ? (ok(m.d) && m.d < 0 ? "dist negativa" : ok(m.d) && m.d > 0 ? "dist atípica" : "sin dist") : ok(m.f) && m.f > 0 ? "fact atípica" : "sin fact"}${ok(cl) ? `<br><span class="small">${fmt(cl, 0)} clientes</span>` : ""}</td>`;
          })
          .join("")}<td>${r.s.kal.x !== null ? pctf(r.s.kal.x) + " ± " + pctf(r.s.kal.sdx, 0) : "-"}</td></tr>`
    )
    .join("");
  const mir = R.mirror
    .map(
      m =>
        `<tr><td class="l">${R.sed} ↔ ${m.r.sed}</td><td>${m.n}</td><td>${m.rr === null ? "-" : fmt(m.rr)}</td><td>${fmt(m.sA)}</td><td>${fmt(m.sB)}</td><td>${fmt(m.sS)}</td><td>${m.esp ? `<span class="tag t-bad">espejo</span>` : `<span class="tag t-ok">no</span>`}</td></tr>`
    )
    .join("");
  const crit = R.CRIT.map(
    c =>
      `<div class="crit"><span class="ic">${c.c ? "✅" : "⬜"}</span><span><b>${c.id}</b> ${c.txt} <span class="small">(peso ${c.w})</span></span><span class="v">${esc(c.v)}</span></div>`
  ).join("");
  const probs = ts
    ? [
        ["Hurto / PNT", R.P1],
        ["Error de medición / factor", R.P2],
        ["Error de cadena", R.P3]
      ]
        .map(
          ([n, v]) =>
            `<div class="prob"><span>${n}</span><div class="bar"><i style="width:${(100 * v).toFixed(0)}%"></i></div><b>${pctf(v, 0)}</b></div>`
        )
        .join("")
    : "<p class='hint'>Sin balance.</p>";
  const evs = R.ev
    .map(
      e =>
        `<div class="ev"><span>${e.id} ${e.name}</span><div class="bar"><i style="width:${e.deg === null ? 0 : (100 * e.deg).toFixed(0)}%;background:var(--warn)"></i></div><span class="small" style="margin:0">${e.deg === null ? "sin dato" : fmt(e.deg)} · ${esc(e.txt)}</span></div>`
    )
    .join("");
  const tramos = R.T.map(
    (x, i) =>
      `<tr><td class="l">${i === 0 && x.mwh ? "🔴 " : ""}${x.a} – ${x.b}</td><td>${fmt(x.d, 0)}</td><td>${ok(x.ha) ? fmt(x.ha) : "s/d"}</td><td>${ok(x.hb) ? fmt(x.hb) : "s/d"}</td><td><b>${x.mwh === null ? "s/d" : fmt(x.mwh)}</b></td><td class="l">${tramoNivel(x.mwh)}</td></tr>`
  ).join("");
  /* Método 3: pérdida esperada */
  // Método 3: tabla de pérdida esperada y exceso por SED.
  const c2 = fmtTable(
    R,
    [
      ["Clientes", r => fmt(r.cli, 0)],
      ["kWh por cliente", r => fmt(r.kwhcli, 0)],
      ["Pérdida esperada (MWh)", r => e2(r.esp)],
      ["Exceso sobre lo esperado (MWh)", r => `<b class="${r.r0 > 0 ? "neg" : ""}">${r.medida ? e2(r.r0) : "-"}</b>`],
      ["Exceso por cliente (kWh)", r => (r.medida ? fmt(r.r0cli, 0) : "-")]
    ],
    [fmt(node.cli, 0), "", e2(node.esp), `<b>${e2(node.r0)}</b>`, node.cli > 0 ? fmt((node.r0 * 1000) / node.cli, 0) : "-"]
  );
  const top3 = rows.filter(r => r.medida && ok(r.r0)).sort((x, y) => y.r0 - x.r0)[0];
  /* Conclusión */
  const totEx = R.rank.reduce((s, r) => s + Math.max(0, r.exc), 0);
  const rk = R.rank
    .map(
      (r, i) =>
        `<tr class="${R.gen === r ? "gen" : ""}"><td>${i + 1}</td><td class="l">${R.gen === r ? "🔴 " : ""}<b>${r.sed}</b> ${r.rol === "Objetivo" ? "(objetivo)" : ""}</td><td>${fmt(r.cli, 0)}</td><td>${e2(r.perd)}</td><td class="l">${tagR(r.rol1)} ${tagCmp(r)}</td><td>${e2(r.adj)}</td><td><b>${e2(r.corr)}</b></td><td>${e2(r.esp)}</td><td class="${r.exc > 0 ? "neg" : ""}"><b>${e2(r.exc)}</b></td><td>${fmt(r.excCli, 0)}</td><td><b>${totEx > 0 && r.exc > 0 ? pctf(r.exc / totEx, 0) : "0%"}</b></td><td>${tagC(r.ia ? r.ia.clase : null)}</td></tr>`
    )
    .join("");
  const gen = R.gen,
    gc = R.genCli;
  const mm = rows.filter(r => r.medida),
    sumM = k => mm.reduce((a, r) => a + (ok(r[k]) ? r[k] : 0), 0),
    exPos = mm.reduce((a, r) => a + Math.max(0, r.exc || 0), 0),
    exNeg = mm.reduce((a, r) => a + Math.min(0, r.exc || 0), 0);
  const trTot = R.TR.reduce((a, x) => a + x.t, 0);
  const desg = `<h3 style="margin:12px 0 4px">Desglose de la pérdida del nodo (SED medidas)</h3>
    <div class="tblwrap"><table><thead><tr><th>Componente</th><th>MWh/mes</th><th>% del total</th><th>De dónde sale</th></tr></thead><tbody>
    <tr class="node"><td class="l"><b>Pérdida total del nodo</b></td><td><b>${e2(node.perd)}</b></td><td>100%</td><td class="l">E. Distribuida − E. Facturada de las SED medidas (Método 1). Es el balance físico: es el mismo en todos los métodos.</td></tr>
    <tr><td class="l">Pérdida técnica (3,4 %)</td><td>${e2(sumM("pt"))}</td><td>${node.perd ? pctf(sumM("pt") / node.perd, 0) : "-"}</td><td class="l">3,4 % de la energía distribuida</td></tr>
    <tr><td class="l">No técnica esperada para su energía y clientes</td><td>${e2(sumM("esp") - sumM("pt"))}</td><td>${node.perd ? pctf((sumM("esp") - sumM("pt")) / node.perd, 0) : "-"}</td><td class="l">Método 3 (regresión cuantil): lo que pierde una SED «sana» de su tamaño</td></tr>
    <tr><td class="l">Exceso sobre lo esperado</td><td><b>${e2(sumM("r0"))}</b></td><td>${node.perd ? pctf(sumM("r0") / node.perd, 0) : "-"}</td><td class="l">= ${e2(exPos)} de SED que pierden de más (posible hurto) ${exNeg < -0.005 ? `+ (${e2(exNeg)}) de SED que facturan más de lo esperado` : ""}</td></tr>
    <tr><td class="l">Energía reasignada entre SED (Método 4)</td><td>${e2(trTot)}</td><td>${node.perd ? pctf(trTot / node.perd, 0) : "-"}</td><td class="l">Método 4: se mueve de una SED a otra según P(cadena) (incluye pares de baja probabilidad); no cambia el total</td></tr>
    <tr><td class="l">Pérdida por hurto estimada (SED analizada)</td><td>${e2(R.hurto)}</td><td></td><td class="l">Método 6: P(hurto) × (1 − P(medición)) × PNT esperada</td></tr>
    <tr><td class="l">Intervalo del total (Monte Carlo)</td><td>${R.mc && ok(R.mc.nodeP5) ? fmt(R.mc.nodeP5) + " – " + fmt(R.mc.nodeP95) : "-"}</td><td></td><td class="l">PNT del nodo con el error de medición de los totalizadores</td></tr>
    ${node.est.n ? `<tr class="est"><td class="l">SED sin balance (${node.est.n}, fuera del total)</td><td>${e2(node.est.perd)}*</td><td></td><td class="l">Estimadas con los clientes de la guía: no se suman porque su pérdida es supuesta</td></tr>` : ""}
    </tbody></table></div>
    <p class="small">¿Por qué el total del nodo es igual en todos los métodos? Porque la energía del nodo se conserva: ningún método crea ni elimina pérdida. Lo que cambia es <b>cómo se reparte</b> entre las SED (compensación, error de cadena) y <b>qué parte</b> es técnica, esperada o exceso (posible hurto).</p>`;
  const concl = !ts
    ? `<p class="hint">Sin balance de la SED: no se puede concluir.</p>` + desg
    : `
    <div class="res r">Dónde se genera la pérdida: el nodo pierde <b>${e2(R.FIN.totCorr)} MWh/mes</b>; <b>${e2(totEx)} MWh</b> están por encima de lo esperado para su energía y sus clientes.
      ${gen ? `La mayor parte está en <b>${gen.sed}</b>${gen.rol === "Objetivo" ? " (la SED analizada)" : ` (aledaño a ${fmt(gen.d, 0)} m)`}: ${e2(gen.exc)} MWh de exceso real (${totEx > 0 ? pctf(gen.exc / totEx, 0) : "-"} del exceso del nodo, ${fmt(gen.excCli, 0)} kWh por cliente).` : "Ninguna SED pierde más de lo esperado."}
      ${gc && gc !== gen ? ` Por cliente, la que más pierde es <b>${gc.sed}</b> (${fmt(gc.excCli, 0)} kWh por cliente).` : ""}
      ${
        rows.filter(r => r.medida && r.qc === "Utilización >100%").length
          ? ` Atención: ${rows
              .filter(r => r.medida && r.qc === "Utilización >100%")
              .map(r => r.sed)
              .join(
                ", "
              )} registra(n) más energía que la capacidad de su trafo según el kVA del Balance: el cálculo usa el dato tal cual, pero conviene validar el kVA y la TOTA.`
          : ""
      }</div>
    <div class="res y">Error de cadena: ${!R.cadPairs.length && R.TR.length ? `no hay pares con P(cadena) ≥ 60 %; el Método 4 reparte ${e2(R.TR.reduce((a, x) => a + x.t, 0))} MWh entre ${R.TR.map(x => x.i.sed + " → " + x.j.sed + " (" + pctf(x.pCad, 0) + ")").join(", ")} por ser la explicación más probable del balance. ` : ""}${R.cadPairs.length ? R.cadPairs.map(x => `<b>${x.i.sed} ↔ ${x.j.sed}</b> (P = ${pctf(x.pCad, 0)}, hasta ${e2(x.xMax)} MWh de clientes de ${x.j.sed} facturados en ${x.i.sed})`).join("; ") : R.TR.length ? `P(cadena) de la SED ${pctf(R.P3, 0)}; ${R.cTxt.toLowerCase()} según los criterios del Método 5.` : `no se detecta en ningún par del nodo (P(cadena) de la SED ${pctf(R.P3, 0)}; ${R.cTxt.toLowerCase()}).`}</div>
    <div class="res b">Método 1 (compensación 0–3 MWh): <span class="bloq ${bloqCls(M1.CN.res)}">${M1.CN.res}</span> ${M1.comp.length ? `compensan al objetivo ${M1.comp.map(r => r.sed).join(", ")} (${e2(M1.compMWh)} MWh, queda ${e2(M1.CN.objResto)} MWh)` : "ninguna aledaña compensa al objetivo"}; mayor pérdida observada en ${M1.gen ? M1.gen.sed : "-"}. Tras la iteración (Método 4), la mayor pérdida real está en ${gen ? gen.sed : "-"}.
      Criticidad: balance <b>${esc(ts.crit) || "-"}</b> · cálculo propio <b>${R.ia ? R.ia.clase + " (" + fmt(100 * R.ia.score, 0) + " de 100)" : "-"}</b>. Pérdida por hurto estimada ${e2(R.hurto)} MWh/mes.</div>
    <div class="tblwrap"><table><thead><tr><th>Nº</th><th>SED</th><th>Clientes</th><th>Pérdida Validación (MWh)</th><th>Rol (Método 1)</th><th>Ajuste por cadena (MWh)</th><th>Pérdida real estimada (MWh)</th><th>Pérdida esperada (MWh)</th><th>Exceso real (MWh)</th><th>Exceso por cliente (kWh)</th><th>% del exceso del nodo</th><th>Criticidad IA</th></tr></thead><tbody>${rk}</tbody></table></div>` +
      desg;
  // M() arma la tarjeta de un método: título, técnica de IA, explicación desplegable (¿Cómo se calcula?), contenido y resultado.
  const M = (n, title, ia, que, body, res) =>
    `<div class="method"><h2>Método N° ${n} · ${title} ${ia ? `<span class="ia">${ia}</span>` : ""}</h2><details class="que"><summary>¿Cómo se calcula?</summary>${que}</details>${body}${res || ""}</div>`;
  $("#result").innerHTML = `
  <h2>SED ${R.sed} · ${esc(t.alim) || "-"} · ${esc(t.dist) || "-"} / ${esc(t.prov) || "-"} ${R.ia ? tagC(R.ia.clase) : ""} ${ts ? tagN(R.nivel) : ""} ${svBtn(t.lat, t.lon, R.sed, true)}</h2>
  ${ts ? `<details class="que" style="margin:-4px 0 4px"><summary>Detalle de los meses usados</summary><p class="small">Rango ${mlab(RANGE.a)} a ${mlab(RANGE.b)} · meses usados: distribuida ${ts.nD}, facturada ${ts.nF}${ts.nBad ? ` · <span style="color:var(--accent)">${ts.nBad} mes(es) con valor negativo no se promedian</span>` : ""}${ts.nOut ? ` · <span style="color:var(--accent)">${ts.nOut} mes(es) con más energía que la capacidad del trafo (dato dudoso, sí se promedia)</span>` : ""} · criticidad del balance: <b>${esc(ts.crit) || "-"}</b></p></details>` : ""}
  <div class="kpis">
    <div class="kpi"><b>${fmt(ts ? ts.dist : null)}</b><span>E. Distribuida Balance (MWh)</span></div>
    <div class="kpi"><b>${fmt(ts ? ts.perd : null)}</b><span>Pérdida Validación de la SED (MWh)</span></div>
    <div class="kpi y"><b>${fmt(node.perd)}</b><span>Pérdida del nodo (MWh)</span></div>
    <div class="kpi g"><b>${e2(M1.compMWh)}</b><span>Compensado al objetivo (MWh)</span></div>
    <div class="kpi hot"><b>${fmt(R0.exc)}</b><span>Exceso real de la SED tras iterar (MWh)</span></div>
    <div class="kpi"><b>${R.CI === null ? "-" : fmt(R.CI)}</b><span>Índice de compensación</span></div>
  </div>
  <div class="verdict">${R.clase}: ${R.ver}</div>

  ${M(
    1,
    "Cálculo de nodos",
    "Balance del nodo",
    `Se toma la SED y sus aledaños (Método 2) y se calcula con los cuadros de la pantalla 2: <b>E. Distribuida Balance</b> y <b>E. Fact. Balance</b> = promedio de los meses del rango (S.INFLUYENTE + OBS S.INFLUYENTE); <b>Pérdida Validación</b> = E. Distribuida Balance − E. Fact. Balance; <b>Desv. Fact.</b> = variación de la E. Facturada dentro del rango = (promedio de los últimos meses − promedio de los primeros meses) ÷ promedio de los primeros meses (una caída o subida fuerte suele indicar clientes que cambiaron de SED). Una SED con pérdida negativa <b>compensa</b>: factura más de lo que recibe.`,
    c1 +
      `<details class="que"><summary>Notas del cuadro</summary><p class="small">* estimado: SED sin balance en el rango (clientes de la guía × kWh/cliente de su alimentador; distribuida = facturación ÷ 0,9); no suma al NODO. E. Distribuida y E. Fact. Balance = promedio de los meses del rango que tienen valor (vacío o cero no cuentan). El total del NODO es el balance físico de las SED medidas y es el mismo en todos los métodos (ver el desglose en la Conclusión).</p></details>` +
      blkCard,
    `<div class="res b">${m1txt}</div>`
  )}

  ${M(
    2,
    "SED aledañas con GIS e IA",
    "Búsqueda + grafo de Gabriel + áreas de servicio + logística",
    `Se miden en el mapa las distancias reales a las SED cercanas. Pistas: distancia, <b>aledaño directo</b> (no hay otra SED entre ambas), <b>áreas de servicio que se tocan</b> (radio de la red BT estimado con sus clientes, ≈ 250 m² por lote), mismo alimentador, mismo distrito y si tiene balance. P(aledaña) = sigmoide(2 − d/λ + 1,5·directo + 1,0·áreas se tocan + 1,0·mismo alim. + 0,3·mismo distrito + 1,0·balance − 2,5·sin clientes). Si hay menos de ${R.p.MINB} aledaños con balance, el radio crece hasta ${R.p.RMAX} m.`,
    `<div class="tblwrap" style="max-height:230px"><table><thead><tr><th>SED</th><th>Dist. (m)</th><th>Alim.</th><th>Aledaño directo</th><th>Áreas se tocan</th><th>Mismo alim.</th><th>¿Balance?</th><th>Clientes guía</th><th>P(aledaña)</th><th>Criterio de inclusión</th></tr></thead><tbody>${cand || `<tr><td class="l" colspan="10">Sin SED cercanas</td></tr>`}</tbody></table></div>
    <details><summary>Distancia entre cada par de SED del nodo (m)</summary>${dm}</details>`,
    `<div class="res g">Nodo: ${R.sed} + ${rows.length - 1} aledaños (${rows.filter(r => r.medida).length - 1} con balance)${R.nb.Rused > R.p.R + 1 ? `; radio ampliado a ${fmt(R.nb.Rused, 0)} m` : ""}. Marque o desmarque para recalcular.</div>`
  )}

  ${M(
    3,
    "Pérdida esperada según energía y clientes",
    "Regresión cuantil",
    `Una SED con más energía y más clientes pierde más aunque no haya hurto. Con todas las SED se calcula lo que pierde una SED «sana» de su tamaño: <b>Pérdida esperada = ${pctf(QR.a, 2)} × E. Distribuida + ${fmt(QR.b, 2)} kWh × clientes</b>. Exceso = Pérdida Validación − Pérdida esperada.`,
    c2,
    top3
      ? `<div class="res r">Mayor exceso antes de corregir la cadena: <b>${top3.sed}</b> (${e2(top3.r0)} MWh, ${fmt(top3.r0cli, 0)} kWh por cliente).</div>`
      : ""
  )}

  ${M(
    4,
    "Iteración nodal: reparto real de la pérdida y error de cadena",
    "Bayes + temple simulado + ascensión de colinas + Monte Carlo",
    `En cada iteración se agrega un aledaño (del más cercano al más lejano) y se vuelve a conciliar todo el nodo. Para cada par donde una SED factura de más y otra pierde de más se calcula P(cadena) con una red bayesiana ingenua (factura más de lo que recibe, cobertura, espejo mensual, <b>migración de clientes</b>, distancia, kWh por cliente). Luego se busca el reparto que mejor explica el balance (Russell & Norvig, cap. 4): <b>J = Σ φ(residuo) + Σ ((1 − P)/P)·x²/máximo</b>, donde un residuo negativo (SED que factura más de lo esperado) pesa 20 veces más que uno positivo. Se arranca con la búsqueda voraz, se explora con <b>temple simulado</b> y se afina con <b>ascensión de colinas</b> por coordenadas. Con 200 simulaciones de Monte Carlo (ruido de medición y del modelo de pérdida esperada) se da el intervalo P5–P95 de la pérdida real. La pérdida total del nodo no cambia.`,
    chartIter(R) + itBlocks + ciTable,
    gen
      ? `<div class="res r">SED con mayor pérdida real: <b>${gen.sed}</b> (${e2(gen.exc)} MWh sobre lo esperado). ${R.cadPairs.length ? `Error de cadena: ${R.cadPairs.map(x => `${x.i.sed} ↔ ${x.j.sed}`).join(", ")}.` : "Sin error de cadena en el nodo."}</div>`
      : ""
  )}

  ${M(
    5,
    "¿Hay error de cadena?",
    "Satisfacción de restricciones + Kalman + correlación",
    `Se revisan 10 criterios como un problema de satisfacción de restricciones (Russell & Norvig, cap. 5): el balance de cada SED y del nodo debe cerrar. Se analiza la energía por cliente y la <b>CANT CLIENTES TOTALES</b> de cada mes: si una SED pasa, por ejemplo, de 50 a 30 clientes y un aledaño gana unos 20 el mismo mes, los clientes se migraron en el sistema (no en la red) y aparece pérdida negativa en una y positiva en la otra. También el espejo mensual de pérdidas y el historial de corrección de cadena.`,
    ts
      ? `<div class="card">${crit}</div>
    <div class="tblwrap"><table><thead><tr><th>SED</th>${months.map(m => `<th>${m.lab}</th>`).join("")}<th>Nivel filtrado</th></tr></thead><tbody>${mrows || `<tr><td class="l" colspan="${months.length + 2}">Sin series mensuales</td></tr>`}</tbody></table></div>
    ${R.mirror.length ? `<div class="tblwrap"><table><thead><tr><th>Par</th><th>Meses comunes</th><th>Correlación</th><th>Variación SED (sd)</th><th>Variación aledaño (sd)</th><th>Variación de la suma (sd)</th><th>¿Espejo?</th></tr></thead><tbody>${mir}</tbody></table></div>` : ""}`
      : `<p class="hint">Sin balance de la SED.</p>`,
    ts
      ? `<div class="res y">${R.cTxt}: cumple ${R.CRIT.filter(c => c.c).length} de ${R.CRIT.length} criterios (puntaje ${R.cScore} de ${R.cMax}; ≥ 7 probable, 4–6 posible).</div>`
      : ""
  )}

  ${M(
    6,
    "Criticidad propia y causa probable",
    "Bayes empírico + EM + Isolation Forest + red bayesiana + Monte Carlo",
    `Puntaje 0–100: 25 % exceso real tras iterar, 20 % exceso por cliente, 15 % grupo de alta pérdida (mezcla de gaussianas, EM), 10 % % de pérdida ajustado por Bayes empírico, 10 % anomalía (Isolation Forest), 20 % P(hurto) × (1 − P(medición)). Crítica ≥ 62 · Alta ≥ 48 · Media ≥ 34.`,
    c4 +
      `<div class="card">${probs}<p class="small">Hurto = P(hurto) × (1 − P(medición)) × PNT esperada = <b>${e2(R.hurto)} MWh/mes</b> · PNT SED rango 90 % (1000 simulaciones): ${R.mc.tP5 === null ? "-" : fmt(R.mc.tP5, 1) + " – " + fmt(R.mc.tP95, 1)} MWh.</p><details><summary>Ver las ${R.ev.length} evidencias</summary>${evs}</details>
    <details><summary>Ver tramos del nodo</summary><div class="tblwrap"><table><thead><tr><th>Tramo</th><th>Distancia (m)</th><th>Exceso A (MWh)</th><th>Exceso B (MWh)</th><th>Intensidad (MWh/mes)</th><th>Nivel</th></tr></thead><tbody>${tramos || `<tr><td class="l" colspan="6">Sin tramos</td></tr>`}</tbody></table></div></details></div>`,
    R.ia
      ? `<div class="res r">Criticidad propia de ${R.sed}: <b>${R.ia.clase}</b> (${fmt(100 * R.ia.score, 0)} de 100) · balance: ${esc(ts ? ts.crit : "") || "-"}.</div>`
      : ""
  )}

  <div class="method" style="border-left-color:var(--accent)"><h2>Conclusión: dónde se genera la pérdida y dónde hay error de cadena</h2>${concl}</div>`;
  $("#result")
    .querySelectorAll("input[type=checkbox]")
    .forEach(cb =>
      cb.addEventListener("change", () => {
        MANUAL.set(cb.dataset.s, cb.checked);
        run(R.sed, true);
      })
    );
}

/**
 * Nivel de un tramo por pérdida estimada (MWh/mes).
 */
const tramoNivel = m => (m === null ? "sin medición" : m >= 15 ? "Muy alto" : m >= 5 ? "Alto" : m >= 1 ? "Medio" : "Bajo");

/**
 * Color de un tramo en el mapa según su pérdida.
 */
const tramoColor = m =>
  !ok(m) ? "#9e9e9e" : m >= 30 ? "#5d0000" : m >= 15 ? "#b71c1c" : m >= 5 ? "#e53935" : m >= 1 ? "#fb8c00" : "#fdd835";
