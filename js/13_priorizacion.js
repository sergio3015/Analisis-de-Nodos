/* ============================================================================================================
 * ARCHIVO 13 · PRIORIZACIÓN Y TARJETAS (pantalla 3, parte superior)
 *   - renderPrio(): tarjetas Crítica/Alta/Media/Baja/Validar/Error de cadena y la tabla de prioridad.
 *   - renderGroup(): al pulsar una tarjeta muestra el cuadro de cálculo del grupo, compara la
 *     criticidad del Excel con la regla del balance aplicada a la PNT balanceada y con la IA.
 *   - lvlBal / lvlIA / critPNT: convierten las criticidades a niveles 0–4 para poder compararlas.
 * ========================================================================================================== */
"use strict";

/**
 * true = mostrar todas las SED en la tabla de priorización (por defecto solo 150).
 */
let PRIO_ALL = false;

/**
 * Tarjeta seleccionada (grupo cuyo cuadro de cálculo se muestra).
 */
let PRIO_SEL = null;

/**
 * Criticidad del Excel → nivel: 4 muy crítico (o SED CRITICA), 3 crítico, 2 semicrítico, 1 controlable, 0 sin dato.
 */
const lvlBal = c => {
  const n = norm(c);
  return !n
    ? 0
    : n.includes("MUY") || n.includes("SED CRITICA")
      ? 4
      : n.includes("SEMI")
        ? 2
        : n.includes("CONTROL")
          ? 1
          : n.includes("CRITIC")
            ? 3
            : 0;
};

/**
 * Texto de cada nivel 0–4.
 */
const LVLTXT = ["sin dato", "Controlable", "Semicrítico", "Crítico", "Muy crítico"];

/**
 * Criticidad IA → nivel: Crítica 4, Alta 3, Media 2, Baja 1.
 */
const lvlIA = c => ({Crítica: 4, Alta: 3, Media: 2, Baja: 1})[c] || 0;

/**
 * Aplica la regla del Balance a una PNT: ≥ 5 → 4, 3–5 → 3, 0–3 → 2, ≤ 0 → 1.
 */
const critPNT = v => (!ok(v) ? 0 : v >= 5 ? 4 : v >= 3 ? 3 : v > 0 ? 2 : 1); // misma regla del balance (PNT ≥ 5, 3–5, 0–3, 0) aplicada a la PNT balanceada

/**
 * Prepara la fila de una SED para el cuadro de una tarjeta: PNT balanceada, niveles y si la IA coincide con el Excel.
 */
function grpRow(r) {
  const s = r.ts,
    R0 = r.rows[0],
    pntB = ok(R0.corr) ? R0.corr - FIJOS.PT * R0.distU : null;
  const lb = lvlBal(s.crit),
    lc = critPNT(pntB),
    li = lvlIA(r.ia.clase);
  const cad = r.cadPairs.map(x => (x.i === R0 ? x.j.sed : x.j === R0 ? x.i.sed : x.i.sed + "↔" + x.j.sed));
  return {
    r,
    s,
    R0,
    pntB,
    lb,
    lc,
    li,
    cad,
    coin: r.ia.clase === "Validar medición" ? "validar TOTA" : lb === 0 ? "-" : lb === li ? "coincide" : li > lb ? "IA sube" : "IA baja"
  };
}

/**
 * Dibuja el cuadro de cálculo de la tarjeta pulsada (g = clase o "cad" = error de cadena): totales, matriz
 * Excel vs regla con PNT balanceada, comparación con la IA y tabla detallada. Incluye el botón Exportar.
 */
function renderGroup(g, base) {
  const box = $("#prioGrp");
  if (!g) {
    box.innerHTML = "";
    return;
  }
  let list = g === "cad" ? base.filter(r => r.cadObj.length) : base.filter(r => r.ia.clase === g);
  const rows = list.map(grpRow).sort((a, b) => (b.pntB ?? -1e9) - (a.pntB ?? -1e9)),
    col = g === "cad" ? "#3a57a7" : CCOL[g];
  const S = k => rows.reduce((a, x) => a + (ok(x[k]) ? x[k] : 0), 0),
    Sr = f =>
      rows.reduce((a, x) => {
        const v = f(x);
        return a + (ok(v) ? v : 0);
      }, 0);
  const tPV = Sr(x => x.s.perd),
    tAdj = Sr(x => x.R0.adj),
    tB = Sr(x => x.R0.corr),
    tPB = S("pntB"),
    nCad = rows.filter(x => x.cad.length).length;
  const matB = [4, 3, 2, 1, 0].map(l => [l, rows.filter(x => x.lb === l).length]).filter(x => x[1]);
  const matC = [4, 3, 2, 1].map(l => [l, rows.filter(x => x.lc === l).length]).filter(x => x[1]);
  const coinN = rows.filter(x => x.coin === "coincide").length,
    subeN = rows.filter(x => x.coin === "IA sube").length,
    bajaN = rows.filter(x => x.coin === "IA baja").length;
  const titulo =
    g === "cad"
      ? "SED con error de cadena detectado"
      : g === "Validar medición"
        ? "SED a validar medición (TOTA dudosa)"
        : `SED con criticidad ${g} (IA)`;
  box.innerHTML = `<div class="method" style="border-left-color:${col}">
    <h2>${titulo} · ${rows.length} SED <span style="flex:1"></span><button class="btn sec" id="grpXls">Exportar este cuadro</button><button class="btn clear" id="grpClose">✕ Cerrar</button></h2>
    <details class="que"><summary>¿Cómo se calcula este cuadro?</summary>Cada SED se calcula con su nodo de aledaños: <b>Pérdida Validación</b> (Método 1) → <b>balanceo del nodo</b>: se trasladan las energías que probablemente están facturadas en la SED equivocada (error de cadena) y se descartan meses imposibles → <b>Pérdida balanceada</b>. A la PNT balanceada (pérdida balanceada − 3,4 % técnica) se le aplica la misma regla del balance (PNT ≥ 5 muy crítico, 3–5 crítico, 0–3 semicrítico) para compararla con la criticidad del Excel, y se muestra la criticidad IA (puntaje 0–100). La columna <b>Compensación</b> aplica la regla 0–3 MWh del Método 1.</details>
    <div class="kpis"><div class="kpi"><b>${fmt(tPV, 1)}</b><span>Pérdida Validación (MWh/mes)</span></div><div class="kpi g"><b>${fmt(tAdj, 1)}</b><span>Ajuste por error de cadena (MWh)</span></div>
      <div class="kpi y"><b>${fmt(tB, 1)}</b><span>Pérdida balanceada (MWh/mes)</span></div><div class="kpi hot"><b>${fmt(tPB, 1)}</b><span>PNT balanceada (MWh/mes)</span></div><div class="kpi"><b>${nCad}</b><span>con error de cadena</span></div></div>
    <h3 style="margin:10px 0 4px">Criticidad del Excel (filas) frente a la regla del balance aplicada a la PNT balanceada (columnas)</h3>
      <div class="tblwrap"><table><thead><tr><th>Excel \ PNT balanceada</th>${[4, 3, 2, 1].map(l => `<th>${LVLTXT[l]}</th>`).join("")}<th>Total</th></tr></thead><tbody>
        ${matB
          .map(
            ([l, n]) =>
              `<tr><td class="l"><b>${LVLTXT[l]}</b></td>${[1]
                .map(c => {
                  const k = rows.filter(x => x.lb === l && x.lc === c).length;
                  return `<td style="${l === c && k ? "background:#dff3e4;font-weight:700" : ""}">${k || "-"}</td>`;
                })
                .join("")}<td><b>${n}</b></td></tr>`
          )
          .join("")}
        <tr class="node"><td class="l">Total</td>${[4, 3, 2, 1].map(c => `<td>${rows.filter(x => x.lc === c).length || "-"}</td>`).join("")}<td>${rows.length}</td></tr></tbody></table></div>
      <div class="row" style="gap:12px;align-items:stretch"><div style="flex:1;min-width:230px">${g === "Validar medición" ? `<div class="res y" style="margin:6px 0">La energía facturada supera a la distribuida (TOTA dudosa): primero se valida la medición del totalizador; no se compara su criticidad.</div>` : `<div class="res b" style="margin:6px 0">Criticidad IA vs Excel: <b>${coinN}</b> coinciden · <b>${subeN}</b> la IA las sube · <b>${bajaN}</b> la IA las baja.</div>`}
        </div><div style="flex:1;min-width:230px"><div class="res g" style="margin:6px 0">En verde: SED donde la criticidad del Excel se confirma tras balancear el nodo y descontar el error de cadena (${rows.filter(x => x.lb && x.lb === x.lc).length} de ${rows.filter(x => x.lb).length}).</div></div></div>
    <div class="tblwrap" style="max-height:420px"><table><thead><tr><th>Nº</th><th>SED</th><th>Distrito</th><th>Alim.</th><th>E. Distribuida (MWh) Balance</th><th>E. Fact. Balance (MWh)</th><th>Pérdida Validación (MWh)</th><th class="y">Desv. Fact. (%)</th>
      <th>Aledaños</th><th>Pérdida del nodo (MWh)</th><th>Compensan al objetivo</th><th>Compensación (0–3 MWh)</th><th>Ajuste por cadena (MWh)</th><th>Pérdida balanceada (MWh)</th><th>PNT balanceada (MWh)</th><th>Exceso real (MWh)</th><th>Exceso por cliente (kWh)</th><th>Error de cadena con</th>
      <th>Criticidad balance (Excel)</th><th>Regla del balance con PNT balanceada</th><th>Criticidad IA</th><th>Puntaje IA</th><th>IA vs Excel</th></tr></thead><tbody>
    ${rows
      .map((x, i) => {
        const s = x.s,
          R0 = x.R0;
        return `<tr class="click" data-s="${x.r.sed}"><td>${i + 1}</td><td class="l"><b>${x.r.sed}</b></td><td class="l">${esc(x.r.t.dist)}</td><td class="l">${esc(x.r.t.alim)}</td><td>${fmt(s.dist)}</td><td>${fmt(s.factBal)}</td><td><b class="${s.perd < 0 ? "neg" : ""}">${fmt(s.perd)}</b></td><td class="neg">${pctf(s.desv)}</td>
      <td>${x.r.rows.length - 1}</td><td>${fmt(x.r.node.perd)}</td><td class="l">${x.r.m1.comp.map(c => c.sed).join(", ") || "-"}</td><td class="l">${tagCmp(x.R0)}</td><td>${ok(R0.adj) && Math.abs(R0.adj) > 0.005 ? `<b style="color:var(--pl-green)">${R0.adj > 0 ? "+" : ""}${fmt(R0.adj)}</b>` : fmt(0)}</td><td><b>${fmt(R0.corr)}</b></td><td><b>${fmt(x.pntB)}</b></td><td>${fmt(R0.exc)}</td><td>${fmt(R0.excCli, 0)}</td><td class="l">${x.cad.join(", ") || "-"}</td>
      <td class="l">${esc(s.crit) || "-"}</td><td class="l">${LVLTXT[x.lc]}</td><td>${tagC(x.r.ia.clase)}</td><td>${fmt(100 * x.r.ia.score, 0)}</td><td class="l">${x.coin === "coincide" ? `<span class="tag t-ok">coincide</span>` : x.coin === "IA sube" ? `<span class="tag t-bad">IA sube</span>` : x.coin === "IA baja" ? `<span class="tag t-warn">IA baja</span>` : esc(x.coin)}</td></tr>`;
      })
      .join("")}
    <tr class="node"><td></td><td class="l">TOTAL</td><td></td><td></td><td>${fmt(Sr(x => x.s.dist))}</td><td>${fmt(Sr(x => x.s.factBal))}</td><td class="hl"><b>${fmt(tPV)}</b></td><td></td><td></td><td></td><td></td><td></td><td>${fmt(tAdj)}</td><td class="hl"><b>${fmt(tB)}</b></td><td><b>${fmt(tPB)}</b></td><td>${fmt(Sr(x => x.R0.exc))}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table></div>
    <p class="small">Haga clic en una fila para ver el análisis completo del nodo y ubicarlo en el mapa. Ajuste por cadena negativo = parte de la pérdida era energía facturada en un aledaño; positivo = la SED tenía clientes de otra.</p></div>`;
  box.querySelectorAll("tr.click").forEach(tr => (tr.onclick = () => run(tr.dataset.s)));
  $("#grpClose").onclick = () => {
    PRIO_SEL = null;
    renderPrio();
  };
  $("#grpXls").onclick = () => {
    const a = [
      [
        "Nº",
        "SED",
        "Distrito",
        "Alimentador",
        "E. Distribuida (MWh) Balance",
        "E. Fact. Balance (MWh)",
        "Pérdida Validación (MWh)",
        "Desv. Fact. (%)",
        "Nº aledaños",
        "Pérdida del nodo (MWh)",
        "Compensan al objetivo",
        "Compensación (0–3 MWh)",
        "Ajuste por cadena (MWh)",
        "Pérdida balanceada (MWh)",
        "PNT balanceada (MWh)",
        "Exceso real (MWh)",
        "Exceso por cliente (kWh)",
        "Error de cadena con",
        "Criticidad balance (Excel)",
        "Regla del balance con PNT balanceada",
        "Criticidad IA",
        "Puntaje IA",
        "IA vs Excel"
      ]
    ];
    rows.forEach((x, i) => {
      const s = x.s,
        R0 = x.R0;
      a.push([
        i + 1,
        x.r.sed,
        x.r.t.dist,
        x.r.t.alim,
        r3(s.dist),
        r3(s.factBal),
        r3(s.perd),
        r3(s.desv),
        x.r.rows.length - 1,
        r3(x.r.node.perd),
        x.r.m1.comp.map(c => c.sed).join(", "),
        cmpTxt(x.R0),
        r3(R0.adj),
        r3(R0.corr),
        r3(x.pntB),
        r3(R0.exc),
        r3(R0.excCli),
        x.cad.join(", "),
        s.crit,
        LVLTXT[x.lc],
        x.r.ia.clase,
        r3(100 * x.r.ia.score),
        x.coin
      ]);
    });
    a.push(["", "TOTAL", "", "", "", "", r3(tPV), "", "", "", "", "", r3(tAdj), r3(tB), r3(tPB)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheet(a, [5, 9, 14, 8, 12, 12, 12, 8, 8, 11, 18, 40, 11, 12, 11, 10, 10, 20, 20, 16, 14, 8, 12]),
      "Cuadro"
    );
    XLSX.writeFile(wb, `Cuadro_${g === "cad" ? "error_de_cadena" : g.replace(/\s+/g, "_")}_${mlab(RANGE.a)}_a_${mlab(RANGE.b)}.xlsx`);
  };
}

/**
 * Dibuja las tarjetas de criticidad y la tabla de priorización (ordenada por puntaje IA).
 */
function renderPrio() {
  const base = [...DB.LITE.values()].filter(r => r.ts && r.ia).sort((a, b) => b.ia.score - a.ia.score),
    cnt = c => base.filter(r => r.ia.clase === c);
  const lim = PRIO_ALL ? 1e9 : 150;
  $("#prioSum").textContent = `Priorización de SED (${base.length} con balance y ubicación) · rango ${mlab(RANGE.a)} a ${mlab(RANGE.b)}`;
  const card = (g, n, txt, col, colTxt) =>
    `<div class="kpi kbtn ${PRIO_SEL === g ? "sel" : ""}" data-g="${g}" style="border-top-color:${col}" title="Ver el cuadro de cálculo"><b style="color:${colTxt || col}">${n}</b><span>${txt}</span><i class="ver">ver cuadro ▸</i></div>`;
  $("#prio").innerHTML =
    `<div class="kpis">${CLS.map(c => card(c, cnt(c).length, c === "Validar medición" ? "Validar medición · TOTA dudosa" : c + " (IA)", CCOL[c], c === "Media" ? "#b38f00" : null)).join("")}
    ${card("cad", base.filter(r => r.cadObj.length).length, "Con error de cadena detectado", "#3a57a7", "#3a57a7")}</div>
    <div id="prioGrp"></div>
    <p class="hint">Pulse una tarjeta para ver su cuadro de cálculo. Haga clic en una SED: el mapa la ubica con sus aledaños agrupados y se calculan todos los métodos sobre el nodo.</p>
    <div class="tblwrap" style="max-height:330px"><table><thead><tr><th>Nº</th><th>SED</th><th>Distrito</th><th>Alim.</th><th>E. Distribuida (MWh) Balance</th><th>E. Fact. Balance (MWh)</th><th>Pérdida Validación (MWh)</th><th>% pérd.</th><th>SED que compensan</th><th>Compensación (0–3 MWh)</th><th>Mayor pérdida del nodo</th><th>Error de cadena</th><th>Puntaje IA</th><th>Criticidad IA</th><th>Criticidad (balance)</th></tr></thead><tbody>
    ${base
      .slice(0, lim)
      .map((r, i) => {
        const s = r.ts,
          R0 = r.rows[0];
        return `<tr class="click" data-s="${r.sed}"><td>${i + 1}</td><td class="l"><b>${r.sed}</b></td><td class="l">${esc(r.t.dist)}</td><td class="l">${esc(r.t.alim)}</td><td>${fmt(s.dist)}</td><td>${fmt(s.factBal)}</td><td><b>${fmt(s.perd)}</b></td><td>${pctf(s.pct)}</td><td class="l">${r.m1.comp.map(x => x.sed).join(", ") || "-"}</td><td class="l">${tagCmp(R0)}</td><td class="l">${r.gen ? r.gen.sed : "-"}</td><td class="l">${r.cadPairs.map(x => (x.i === R0 ? x.j.sed : x.j === R0 ? x.i.sed : x.i.sed + "↔" + x.j.sed)).join(", ") || "-"}</td><td>${fmt(100 * r.ia.score, 0)}</td><td>${tagC(r.ia.clase)}</td><td class="l">${esc(s.crit) || "-"}</td></tr>`;
      })
      .join("")}</tbody></table></div>
    ${base.length > 150 && !PRIO_ALL ? `<button class="btn sec" id="prioMore">Ver las ${base.length} SED</button>` : ""}`;
  $("#prio")
    .querySelectorAll(".tblwrap > table tr.click")
    .forEach(tr => (tr.onclick = () => run(tr.dataset.s)));
  $("#prio")
    .querySelectorAll(".kbtn")
    .forEach(
      k =>
        (k.onclick = () => {
          PRIO_SEL = PRIO_SEL === k.dataset.g ? null : k.dataset.g;
          renderPrio();
          if (PRIO_SEL) verEn($("#prioGrp"));
        })
    );
  if ($("#prioMore"))
    $("#prioMore").onclick = () => {
      PRIO_ALL = true;
      renderPrio();
    };
  renderGroup(PRIO_SEL, base);
}
