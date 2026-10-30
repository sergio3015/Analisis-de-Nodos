/* ============================================================================================================
 * ARCHIVO 15 · ANÁLISIS MASIVO (hasta 200 SED)
 *   - runMass(): analiza TODAS las SED ingresadas con los 6 métodos (barra de avance). Si una SED no tiene energía en el
 *     rango o no está en la GUIA, igual se analiza su nodo y queda al final con una nota; solo se excluye un código que no
 *     existe ni en el Balance ni en la GUIA.
 *   - Prioridad (N°): de mayor a menor PÉRDIDA REAL (tras compensar y descontar el error de cadena).
 *   - renderMass(): cuadro resumen; drawMass(): números de prioridad en el mapa.
 *   - exportMass(): Excel con los encabezados del Balance (N°, SED, MARCA MEDIDOR, … Clasificación) y una hoja por método.
 *     Hoja Detalle_nodos: cada caso empieza con la SED Objetivo, siguen sus aledañas de mayor a menor pérdida y termina con
 *     la fila amarilla NODO = total de TODO el grupo (con balance + estimadas), con % de la pérdida y puntaje.
 * ========================================================================================================== */
"use strict";

/**
 * Resultado del análisis masivo: {list: SED analizadas ordenadas, miss: SED no analizadas y motivo}.
 */
let MASS = null,
  layerMass = null;

/**
 * Máximo de SED del análisis masivo.
 */
const MAXMASS = 200;

/**
 * Valor que ordena la prioridad del análisis masivo: pérdida real de la SED tras compensar y descontar el error de cadena.
 */
const prioKey = R => (ok(R.rows[0].corr) ? R.rows[0].corr : -1e9); // prioridad: pérdida real de la SED tras compensar y descontar el error de cadena

/**
 * true si el dato de la SED es dudoso (factura > distribuye o más energía que el trafo): se marca en rojo en Calidad del dato.
 */
const dudosa = R => R.rows[0].qc !== "OK" || (R.ia && R.ia.clase === "Validar medición"); // dato dudoso (factura > distribuye, más energía que el trafo): va después, primero validar TOTA

/**
 * Texto de calidad del dato (calidad, meses con distribuida y notas como "sin energía en el rango").
 */
const calTxt = R =>
  R.sinBal ? R.nota : `${R.rows[0].qc === "OK" ? "OK" : R.rows[0].qc} · ${R.ts.nD} mes(es) con distribuida${R.nota ? " · " + R.nota : ""}`;

/**
 * Analiza en masivo hasta 200 SED con todos los métodos (todas las ingresadas) y las ordena por pérdida real.
 */
async function runMass(list) {
  showTab("t3");
  $("#prioBox").open = false;
  CUR = null;
  if (layerNode) {
    layerNode.clearLayers();
    layerTram.clearLayers();
  }
  const extra = list.length > MAXMASS ? list.length - MAXMASS : 0;
  list = list.slice(0, MAXMASS);
  if (JSON.stringify(DB.p) !== JSON.stringify(P())) build();
  const p = P(),
    ok1 = [],
    miss = [];
  $("#runBtn").disabled = true;
  for (let i = 0; i < list.length; i++) {
    const sed = list[i];
    if (i % 4 === 0) {
      $("#result").innerHTML =
        `<div class="card"><b>Análisis masivo</b> · analizando ${i + 1} de ${list.length} SED…<div class="bar" style="margin-top:8px"><i style="width:${((100 * i) / list.length).toFixed(0)}%"></i></div></div>`;
      await new Promise(r => setTimeout(r, 0));
    }
    if (!RAW.bal.has(sed) && !DB.G.has(sed)) {
      miss.push([sed, "no existe en el Balance SED SI – CAMPO ni en la GUIA_SETIEMBRE (revise el código)"]);
      continue;
    }
    try {
      const R = analyze(sed, p);
      if (!R) {
        miss.push([sed, `no tiene energía en el rango ${mlab(RANGE.a)} a ${mlab(RANGE.b)} ni coordenadas en la GUIA`]);
        continue;
      }
      if (!R.ts) {
        // sin balance en el rango: se analiza igual su nodo y queda al final con la nota
        const b = RAW.bal.get(sed) || {};
        R.sinBal = true;
        R.ts = {
          dist: null,
          factBal: null,
          perd: null,
          desv: null,
          crit: b.crit || "",
          meta: b.meta || {},
          kva: b.kva || R.t.kva,
          nD: 0,
          nF: 0
        };
        R.nota = RAW.bal.has(sed)
          ? `sin energía con valor en el rango ${mlab(RANGE.a)} a ${mlab(RANGE.b)}`
          : "no está en el Balance (solo GUIA): se estima";
      } else if (R.t.sinCoord) R.nota = "no está en la GUIA: se analiza sin aledañas";
      ok1.push(R);
    } catch (e) {
      miss.push([sed, "error: " + e.message]);
    }
  }
  ok1.sort((a, b) => !!a.sinBal - !!b.sinBal || prioKey(b) - prioKey(a) || (b.ia ? b.ia.score : 0) - (a.ia ? a.ia.score : 0));
  ok1.forEach((R, i) => (R.prio = i + 1));
  MASS = {list: ok1, miss, extra, at: new Date()};
  $("#runBtn").disabled = false;
  $("#xlsMass").disabled = !ok1.length;
  $("#massBack").style.display = "none";
  renderMass();
}

/**
 * Dibuja el cuadro del análisis masivo (KPIs, tabla por prioridad y SED no analizadas).
 */
function renderMass() {
  const M = MASS,
    L = M.list,
    S = f => L.reduce((a, R) => a + (ok(f(R)) ? f(R) : 0), 0);
  const tag3 = R => (R.cadPairs.length ? R.cadPairs.map(x => `${x.i.sed}→${x.j.sed} (${pctf(x.pCad, 0)})`).join(", ") : "-");
  $("#result").innerHTML =
    `<div class="method" style="border-left-color:var(--pl-blue)"><h2>Análisis masivo · ${L.length + M.miss.length} SED ingresadas · ${L.length} analizadas${M.miss.length ? ` · ${M.miss.length} con código no encontrado` : ""}</h2>
    <details class="que"><summary>¿Cómo se ordena?</summary>Cada SED se analiza con su nodo de aledaños y los 6 métodos. La prioridad (Nº) ordena de mayor a menor la <b>pérdida real</b>: la Pérdida Validación de la SED después de compensar con sus aledaños y de descontar la energía que, por error de cadena (incluida la migración de clientes), está facturada en otra SED. El intervalo P5–P95 viene de 200 simulaciones de Monte Carlo. Las SED con dato dudoso (factura más de lo que distribuye o más energía que la capacidad del trafo según su kVA) se marcan en rojo en «Calidad del dato»; las SED sin energía en el rango van al final.${M.extra ? ` Se ingresaron ${L.length + M.miss.length + M.extra} SED: solo se analizan las primeras ${MAXMASS}.` : ""}</details>
    <div class="kpis"><div class="kpi"><b>${L.length}</b><span>SED analizadas</span></div><div class="kpi y"><b>${fmt(
      S(R => R.ts.perd),
      1
    )}</b><span>Pérdida Validación (MWh/mes)</span></div>
      <div class="kpi g"><b>${fmt(
        S(R => R.rows[0].adj),
        1
      )}</b><span>Ajuste por error de cadena (MWh)</span></div><div class="kpi hot"><b>${fmt(
        S(R => R.rows[0].corr),
        1
      )}</b><span>Pérdida real (MWh/mes)</span></div>
      <div class="kpi"><b>${L.filter(R => R.ia && R.ia.clase === "Crítica").length}</b><span>Crítica (IA)</span></div><div class="kpi"><b>${L.filter(R => R.cadObj.length).length}</b><span>con error de cadena</span></div><div class="kpi"><b>${L.filter(R => R.migs && R.migs.length).length}</b><span>con migración de clientes</span></div></div>
    <div class="tblwrap" style="max-height:520px"><table><thead><tr><th>Nº</th><th>SED</th><th>Clasificación</th><th>SET</th><th>Alim.</th><th>E. Distribuida (MWh) Balance</th><th>E. Fact. Balance (MWh)</th><th>Pérdida Validación (MWh)</th><th>Compensación (0–3 MWh)</th><th>Ajuste por cadena (MWh)</th><th class="y">Pérdida real (MWh)</th><th>P5 – P95 (MWh)</th><th>Exceso real (MWh)</th><th>Error de cadena (P)</th><th>Migración de clientes</th><th>Mayor pérdida del nodo</th><th>Criticidad IA</th><th>Criticidad (balance)</th><th>Calidad del dato</th></tr></thead><tbody>
    ${L.map(R => {
      const s = R.ts,
        R0 = R.rows[0],
        mt = s.meta || {};
      return `<tr class="click" data-s="${R.sed}"><td>${R.prio}</td><td class="l"><b>${R.sed}</b> ${svBtn(R.t.lat, R.t.lon, R.sed)}</td><td class="l">${esc(mt.clasif || "")}</td><td class="l">${esc(mt.set || "")}</td><td class="l">${esc(R.t.alim)}</td><td>${fmt(s.dist)}</td><td>${fmt(s.factBal)}</td><td><b class="${s.perd < 0 ? "neg" : ""}">${fmt(s.perd)}</b></td><td class="l">${tagCmp(R0)}</td>
      <td>${ok(R0.adj) && Math.abs(R0.adj) > 0.005 ? (R0.adj > 0 ? "+" : "") + fmt(R0.adj) : fmt(0)}</td><td><b>${fmt(R0.corr)}</b></td><td>${R0.ci ? fmt(R0.ci.c5) + " – " + fmt(R0.ci.c95) : "-"}</td><td class="${R0.exc > 0 ? "neg" : ""}">${fmt(R0.exc)}</td><td class="l">${tag3(R)}</td><td class="l">${(R.migs || []).map(m => `${m.r.sed} ${m.lab}`).join(", ") || "-"}</td><td class="l">${R.gen ? R.gen.sed : "-"}</td><td>${tagC(R.ia ? R.ia.clase : null)}</td><td class="l">${esc(s.crit) || "-"}</td><td class="l">${dudosa(R) ? `<span class="tag t-bad">${esc(calTxt(R))}</span>` : esc(calTxt(R))}</td></tr>`;
    }).join("")}
    <tr class="node"><td></td><td class="l">TOTAL</td><td></td><td></td><td></td><td>${fmt(S(R => R.ts.dist))}</td><td>${fmt(S(R => R.ts.factBal))}</td><td class="hl"><b>${fmt(S(R => R.ts.perd))}</b></td><td></td><td>${fmt(S(R => R.rows[0].adj))}</td><td class="hl"><b>${fmt(S(R => R.rows[0].corr))}</b></td><td></td><td>${fmt(S(R => R.rows[0].exc))}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table></div>
    ${M.miss.length ? `<details open><summary>${M.miss.length} código(s) no encontrado(s)</summary><div class="tblwrap" style="max-height:200px"><table><thead><tr><th>SED</th><th>Motivo</th></tr></thead><tbody>${M.miss.map(([s, m]) => `<tr><td class="l">${esc(s)}</td><td class="l">${esc(m)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
    <p class="small">Haga clic en una fila para ver los 6 métodos de esa SED; con «◀ Volver al análisis masivo» regresa a este cuadro. En el mapa, el número es la prioridad.</p></div>`;
  $("#result")
    .querySelectorAll("tr.click")
    .forEach(tr => (tr.onclick = () => run(tr.dataset.s)));
  drawMass();
}

/**
 * Dibuja en el mapa las SED del análisis masivo con su número de prioridad.
 */
function drawMass() {
  if (!map || !MASS) return;
  if (!layerMass) layerMass = L.layerGroup().addTo(map);
  layerMass.clearLayers();
  const pts = [];
  MASS.list.forEach(R => {
    if (!ok(R.t.lat)) return;
    pts.push([R.t.lat, R.t.lon]);
    new SedMarker([R.t.lat, R.t.lon], {
      radius: 11,
      color: "#000",
      weight: 2,
      fillColor: CCOL[R.ia ? R.ia.clase : "Sin balance"],
      fillOpacity: 1
    })
      .bindTooltip(`<b>Nº ${R.prio} · ${R.sed}</b><br>Pérdida real ${fmt(R.rows[0].corr)} MWh · ${R.ia ? R.ia.clase : "-"}`)
      .bindPopup(
        `<b>Nº ${R.prio} · ${R.sed}</b><br><button class="btn" style="margin-top:6px;padding:4px 10px" onclick="run('${R.sed}')">Ver métodos</button> <button class="btn sec" style="margin-top:6px;padding:4px 10px" onclick="openSV(${R.t.lat},${R.t.lon},'${R.sed}')">📷 Street View</button>`
      )
      .addTo(layerMass);
    L.marker([R.t.lat, R.t.lon], {
      icon: L.divIcon({
        className: "",
        html: `<span class="slab" style="background:#3a57a7;color:#fff">${R.prio}</span>`,
        iconAnchor: [-12, 8]
      }),
      interactive: false
    }).addTo(layerMass);
  });
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.1), {maxZoom: 16, animate: false});
}

/**
 * Encabezados pedidos para el Excel masivo (tomados del Balance SED SI – CAMPO).
 */
const MASS_BASE = [
  "N°",
  "SED",
  "MARCA MEDIDOR",
  "FACTOR",
  "IP",
  "SET",
  "LINEA TENSION NOMINAL [kV]",
  "TRAFOS [#]",
  "POTENCIA DEL TRANSFORMADOR [KVA]",
  "E. FACTURADA AJUSTADA MES [MWh]",
  "E. DISTRIBUIDA MES [MWh]",
  "Clasificación"
];

/**
 * Valores de los encabezados base para una SED (los datos descriptivos son el último dato del Balance;
 * E. FACTURADA y E. DISTRIBUIDA son el promedio mensual del rango).
 */
const massBase = R => {
  const s = R.ts,
    m = s.meta || {};
  return [
    R.prio,
    R.sed,
    m.marca ?? "",
    m.factor ?? "",
    m.ip ?? "",
    m.set ?? "",
    m.linea ?? "",
    m.trafos ?? "",
    m.kva || s.kva || "",
    r3(s.factBal),
    r3(s.dist),
    m.clasif ?? ""
  ];
};

/**
 * Ancho de las columnas base en Excel.
 */
const MASS_W = [5, 9, 12, 8, 14, 6, 10, 8, 12, 14, 14, 18];

/**
 * Exporta el análisis masivo a Excel: hojas Prioridad, Método 1 … Método 6, Detalle_nodos (con total por nodo, % y puntaje),
 * No_analizadas y Notas, todas ordenadas por el mismo N° de prioridad.
 */
function exportMass() {
  if (!MASS || !MASS.list.length) return;
  const L = MASS.list,
    wb = XLSX.utils.book_new(),
    add = (nm, head, rowF, w) => {
      const a = [[...MASS_BASE, ...head]];
      L.forEach(R => a.push([...massBase(R), ...rowF(R)]));
      XLSX.utils.book_append_sheet(wb, sheet(a, [...MASS_W, ...w]), nm);
    };
  const cadTxt = R => R.cadPairs.map(x => `${x.i.sed} → ${x.j.sed} (${fmt(x.xMax)} MWh, P ${pctf(x.pCad, 0)})`).join("; ");
  add(
    "Prioridad",
    [
      "Pérdida Validación (MWh)",
      "Ajuste por error de cadena (MWh)",
      "Pérdida real sin error de cadena (MWh)",
      "P5 (MWh)",
      "P95 (MWh)",
      "Exceso sobre lo esperado (MWh)",
      "Compensación (Método 1)",
      "Error de cadena",
      "Migración de clientes",
      "Criticidad IA",
      "Puntaje IA",
      "Criticidad (balance)",
      "SED con mayor pérdida del nodo",
      "Calidad del dato",
      "Conclusión"
    ],
    R => {
      const R0 = R.rows[0];
      return [
        r3(R.ts.perd),
        r3(R0.adj),
        r3(R0.corr),
        r3(R0.ci && R0.ci.c5),
        r3(R0.ci && R0.ci.c95),
        r3(R0.exc),
        R.m1.CN.res,
        cadTxt(R),
        (R.migs || []).map(m => `${m.r.sed} ${m.lab} (${m.da > 0 ? "+" : ""}${m.da} / ${m.db > 0 ? "+" : ""}${m.db})`).join("; "),
        R.ia ? R.ia.clase : "",
        R.ia ? r3(100 * R.ia.score) : "",
        R.ts.crit,
        R.gen ? R.gen.sed : "",
        calTxt(R),
        `${R.clase}: ${R.ver}`
      ];
    },
    [12, 12, 14, 9, 9, 12, 24, 40, 30, 12, 8, 20, 12, 26, 80]
  );
  add(
    "Método 1",
    [
      "Desv. Fact. (%)",
      "Clientes",
      "Pérdida por cliente (kWh)",
      "Nº aledañas",
      "Aledañas (distancia m)",
      "Pérdida del nodo (MWh)",
      "SED con pérdida negativa",
      "Resultado de compensación",
      "Compensan al objetivo",
      "Compensado al objetivo (MWh)",
      "Queda tras compensar (MWh)",
      "Mayor pérdida del nodo (Método 1)"
    ],
    R => {
      const R0 = R.rows[0];
      return [
        r3(R.ts.desv),
        r3(R0.cli),
        r3(R0.perdCli),
        R.rows.length - 1,
        R.rows
          .slice(1)
          .map(x => `${x.sed} (${fmt(x.d, 0)})`)
          .join(", "),
        r3(R.node.perd),
        R.m1.compAll.map(x => `${x.sed} (${fmt(x.perd)})`).join(", "),
        R.m1.CN.res,
        R0.cmp.con.map(x => `${x.r.sed} ${fmt(x.mwh)}`).join(", "),
        r3(R.m1.CN.objComp),
        r3(R.m1.CN.objResto),
        R.m1.gen ? `${R.m1.gen.sed} (${fmt(R.m1.gen.perd)})` : ""
      ];
    },
    [9, 8, 10, 8, 40, 12, 26, 24, 26, 12, 12, 22]
  );
  add(
    "Método 2",
    [
      "Alimentador",
      "Distrito",
      "Radio usado (m)",
      "Nº aledañas",
      "Nº con balance",
      "Aledañas: SED · distancia · P(aledaña) · criterio",
      "Aledaño directo (grafo de Gabriel)",
      "Áreas de servicio que se tocan"
    ],
    R => {
      const sel = R.nb.cand.filter(c => c.sel);
      return [
        R.t.alim,
        R.t.dist,
        r3(R.nb.Rused),
        sel.length,
        sel.filter(c => c.hasBal).length,
        sel.map(c => `${c.g.sed} · ${fmt(c.d, 0)} m · ${pctf(c.prob, 0)} · ${c.crit}`).join("; "),
        sel
          .filter(c => c.gab)
          .map(c => c.g.sed)
          .join(", "),
        sel
          .filter(c => c.touch)
          .map(c => c.g.sed)
          .join(", ")
      ];
    },
    [10, 16, 10, 8, 8, 70, 24, 24]
  );
  add(
    "Método 3",
    [
      "Clientes",
      "kWh por cliente",
      "Pérdida esperada (MWh)",
      "Exceso sobre lo esperado (MWh)",
      "Exceso por cliente (kWh)",
      "Modelo (regresión cuantil)"
    ],
    R => {
      const R0 = R.rows[0];
      return [
        r3(R0.cli),
        r3(R0.kwhcli),
        r3(R0.esp),
        r3(R0.r0),
        r3(R0.r0cli),
        `${r3(R.QR.a)} × E. Distribuida + ${r3(R.QR.b)} MWh por cada 1000 clientes`
      ];
    },
    [8, 10, 12, 12, 12, 50]
  );
  add(
    "Método 4",
    [
      "Ajuste por cadena (MWh)",
      "Pérdida real (MWh)",
      "P5 (MWh)",
      "P95 (MWh)",
      "Exceso real (MWh)",
      "P(exceso > 0)",
      "Exceso por cliente (kWh)",
      "Traslados: de → a (MWh, P cadena)",
      "SED con mayor pérdida real del nodo",
      "Pérdida real del nodo (MWh)",
      "Búsqueda (pares · temple simulado · ascensión de colinas)"
    ],
    R => {
      const R0 = R.rows[0];
      return [
        r3(R0.adj),
        r3(R0.corr),
        r3(R0.ci && R0.ci.c5),
        r3(R0.ci && R0.ci.c95),
        r3(R0.exc),
        r3(R0.ci && R0.ci.pEx),
        r3(R0.excCli),
        R.TR.map(x => `${x.i.sed} → ${x.j.sed} (${fmt(x.t)} MWh, ${pctf(x.pCad, 0)})`).join("; "),
        R.gen ? `${R.gen.sed} (${fmt(R.gen.exc)} MWh)` : "",
        r3(R.FIN.totCorr),
        `${R.FIN.nPares} · ${R.FIN.nSA} · ${R.FIN.sweeps}`
      ];
    },
    [11, 11, 9, 9, 11, 9, 11, 50, 20, 12, 20]
  );
  add(
    "Método 5",
    [
      "Resultado",
      "Puntaje",
      "Criterios cumplidos",
      "Migración de clientes (C8)",
      "Cambio brusco de clientes (C10)",
      "Historial de corrección de cadena (C9)",
      "Pares con error de cadena"
    ],
    R => [
      R.cTxt,
      `${R.cScore} de ${R.cMax}`,
      R.CRIT.filter(c => c.c)
        .map(c => c.id)
        .join(", "),
      (R.CRIT.find(c => c.id === "C8") || {}).v || "",
      (R.CRIT.find(c => c.id === "C10") || {}).v || "",
      (R.CRIT.find(c => c.id === "C9") || {}).v || "",
      cadTxt(R)
    ],
    [26, 9, 18, 40, 50, 30, 50]
  );
  add(
    "Método 6",
    [
      "Puntaje IA",
      "Criticidad IA",
      "Criticidad (balance)",
      "¿Coinciden?",
      "P(hurto)",
      "P(medición)",
      "P(cadena)",
      "Pérdida por hurto estimada (MWh/mes)",
      "Clasificación del análisis",
      "Veredicto"
    ],
    R => [
      R.ia ? r3(100 * R.ia.score) : "",
      R.ia ? R.ia.clase : "",
      R.ts.crit,
      !R.ia ? "" : lvlBal(R.ts.crit) === 0 ? "sin dato" : lvlBal(R.ts.crit) === lvlIA(R.ia.clase) ? "sí" : "no",
      r3(R.P1),
      r3(R.P2),
      r3(R.P3),
      r3(R.hurto),
      R.clase,
      R.ver
    ],
    [8, 12, 20, 9, 8, 8, 8, 12, 18, 80]
  );
  // Detalle_nodos: cada nodo con sus SED ordenadas de mayor a menor pérdida real, el % de la pérdida del nodo, un puntaje y la fila NODO (total)
  const det = [
    [
      "N° prioridad",
      "SED analizada",
      "Orden en el nodo (1 = más pérdida)",
      "SED",
      "Tipo",
      "Dist. (m)",
      "E. Distribuida (MWh) Balance",
      "E. Fact. Balance (MWh)",
      "Pérdida Validación (MWh)",
      "Desv. Fact. (%)",
      "Clientes",
      "Compensación (0–3 MWh)",
      "Ajuste por error de cadena (MWh)",
      "Pérdida real por SED (MWh)",
      "% de la pérdida del nodo",
      "Puntaje de pérdida en el nodo (0–100)",
      "Puntaje IA (0–100)",
      "Criticidad IA",
      "Calidad del dato"
    ]
  ];
  // Cada caso (SED analizada) va separado: 1) la SED Objetivo, 2) sus aledañas de mayor a menor pérdida, 3) la fila NODO con el total de TODO el grupo
  // (SED con balance + SED estimadas sin balance). "Orden en el nodo" numera a todas las SED del grupo de mayor a menor pérdida.
  L.forEach(R => {
    const S = (a, k) => a.reduce((s, r) => s + (ok(r[k]) ? r[k] : 0), 0),
      tipo = r => (r.rol === "Objetivo" ? "Objetivo" : "Aledaña");
    const all = R.rows
      .map(r => ({
        r,
        real: r.medida ? (ok(r.corr) ? r.corr : r.perd) : r.perd,
        dist: ok(r.dist) ? r.dist : r.distU,
        fact: r.medida ? r.factBal : r.fv
      }))
      .filter(x => ok(x.real) || ok(x.dist));
    const tot = all.reduce((a, x) => a + (ok(x.real) ? x.real : 0), 0),
      pos = all.reduce((a, x) => a + Math.max(0, x.real || 0), 0),
      den = tot > 0 ? tot : pos,
      mx = Math.max(0, ...all.map(x => x.real || 0));
    [...all].sort((a, b) => (b.real ?? -1e9) - (a.real ?? -1e9)).forEach((x, i) => (x.orden = i + 1));
    const obj = all.filter(x => x.r.rol === "Objetivo"),
      ale = all.filter(x => x.r.rol !== "Objetivo").sort((a, b) => a.orden - b.orden);
    [...obj, ...ale].forEach(x => {
      const r = x.r;
      det.push([
        R.prio,
        R.sed,
        x.orden,
        r.sed,
        tipo(r),
        r3(r.d),
        r3(x.dist),
        r3(x.fact),
        r3(r.perd),
        r.medida ? r3(r.desv) : "",
        r3(r.cli),
        r.medida ? cmpTxt(r) : "Sin balance: pérdida estimada con los clientes de la guía",
        r.medida ? r3(r.adj) : 0,
        r3(x.real),
        den > 0 && ok(x.real) ? r3(x.real / den) : "",
        mx > 0 && ok(x.real) ? Math.round((100 * Math.max(0, x.real)) / mx) : 0,
        r.ia ? Math.round(100 * r.ia.score) : "",
        r.ia ? r.ia.clase : "",
        r.medida ? r.qc : "Sin balance (estimada)"
      ]);
    });
    const nMed = all.filter(x => x.r.medida).length,
      nEst = all.length - nMed;
    det.push([
      R.prio,
      R.sed,
      "NODO (total del grupo)",
      `${all.length} SED${nEst ? ` (${nMed} con balance + ${nEst} estimadas)` : ""}`,
      "",
      "",
      r3(all.reduce((a, x) => a + (ok(x.dist) ? x.dist : 0), 0)),
      r3(all.reduce((a, x) => a + (ok(x.fact) ? x.fact : 0), 0)),
      r3(
        S(
          all.map(x => x.r),
          "perd"
        )
      ),
      "",
      r3(
        S(
          all.map(x => x.r),
          "cli"
        )
      ),
      "",
      r3(all.reduce((a, x) => a + (x.r.medida && ok(x.r.adj) ? x.r.adj : 0), 0)),
      r3(tot),
      den > 0 ? r3(tot / den) : "",
      "",
      "",
      "",
      ""
    ]);
    det.push([]);
  });
  XLSX.utils.book_append_sheet(wb, sheet(det, [8, 10, 10, 10, 9, 8, 13, 12, 12, 9, 8, 46, 11, 12, 11, 12, 10, 12, 18]), "Detalle_nodos");
  if (MASS.miss.length) XLSX.utils.book_append_sheet(wb, sheet([["SED", "Motivo"], ...MASS.miss], [12, 70]), "No_analizadas");
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ["NOTAS"],
        [],
        [
          "Rango de meses",
          `${mlab(RANGE.a)} a ${mlab(RANGE.b)} (${RANGE.modo === "todos" ? "todos los meses" : "solo meses con dato"}${RANGE.obs ? ", incluye OBS S.INFLUYENTE" : ""})`
        ],
        ["E. FACTURADA AJUSTADA MES [MWh] / E. DISTRIBUIDA MES [MWh]", "promedio mensual del rango (S.INFLUYENTE + OBS S.INFLUYENTE)"],
        ["MARCA MEDIDOR, FACTOR, IP, SET, LINEA, TRAFOS, POTENCIA, Clasificación", "último dato del Balance SED SI – CAMPO"],
        [
          "Detalle_nodos",
          "cada caso empieza con la SED Objetivo, siguen sus aledañas de mayor a menor pérdida y termina con la fila amarilla NODO = total de TODO el grupo (con balance + estimadas). Orden en el nodo: 1 = la SED que más pierde del grupo. % de la pérdida del nodo = pérdida real de la SED ÷ total del grupo. Puntaje = 100 para la SED que más pierde. Las SED sin balance usan su pérdida estimada"
        ],
        ["Promedios", "E. Distribuida y E. Facturada = promedio de los meses del rango que tienen valor (vacío o cero no cuentan)"],
        [
          "N° (prioridad)",
          "de mayor a menor pérdida real: Pérdida Validación tras compensar con los aledaños y descontar el error de cadena (Método 4); las SED sin energía en el rango van al final; la columna Calidad del dato marca los datos dudosos"
        ],
        ["Método 1", "Cálculo de nodos y compensación por SED (regla 0–3 MWh)"],
        ["Método 2", "SED aledañas con GIS: distancia, grafo de Gabriel, áreas de servicio, regresión logística"],
        ["Método 3", "Pérdida esperada según energía y clientes (regresión cuantil)"],
        ["Método 4", "Iteración nodal: red bayesiana del par + temple simulado + ascensión de colinas + Monte Carlo (P5–P95)"],
        [
          "Método 5",
          "Error de cadena: 10 criterios (satisfacción de restricciones), migración de clientes, espejo mensual, historial de corrección"
        ],
        ["Método 6", "Criticidad IA: Bayes empírico, EM, Isolation Forest, red bayesiana ingenua"],
        ["Archivos", `${RAW.src.bal} · ${RAW.src.guia}`]
      ],
      [50, 110]
    ),
    "Notas"
  );
  XLSX.writeFile(wb, `Analisis_masivo_${L.length}_SED_${mlab(RANGE.a)}_a_${mlab(RANGE.b)}.xlsx`);
}
