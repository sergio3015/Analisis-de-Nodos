/* ============================================================================================================
 * ARCHIVO 07 · CUADRO 1 DE LA PANTALLA 2 Y ISOLATION FOREST
 *   - renderTables(): dibuja el Cuadro 1 (Energía Distribuida y Facturada por mes) con paginación y buscador.
 *   - exportTables(): exporta ese cuadro a Excel.
 *   - isoForest(): algoritmo Isolation Forest (aprendizaje no supervisado) que mide qué tan "rara" es
 *     cada SED frente a las demás; se usa en la criticidad IA.
 * ========================================================================================================== */
"use strict";

/**
 * Página actual del Cuadro 1 (50 SED por página).
 */
let PG = {t1: 0, t2: 0};

/**
 * Formato con 2 decimales que deja la celda vacía si no hay dato.
 */
const f2 = v => (ok(v) ? fmt(v) : "");

/**
 * Dibuja el Cuadro 1 de la pantalla 2: por SED, la Energía Distribuida y Facturada de cada mes del rango
 * (las celdas en cursiva vienen de OBS S.INFLUYENTE) y la fila Total.
 */
function renderTables() {
  const ks = inRange(),
    q1 = norm($("#q1").value),
    PS = 50;
  $("#rangeInfo").innerHTML =
    `Rango: <b>${mlab(RANGE.a)} a ${mlab(RANGE.b)}</b> (${ks.length} meses) · promedio en el Método 1: <b>${RANGE.modo === "todos" ? "todos los meses del rango (los meses sin dato cuentan como 0)" : "solo los meses con dato"}</b> · ${RANGE.obs ? "incluye" : "sin"} OBS S.INFLUYENTE (celdas en cursiva). Todas las energías en MWh.`;
  // Cuadro 1
  const seds1 = [...RAW.bal.keys()]
    .filter(s => balVals(RAW.bal.get(s), ks, "d").some(ok) || balVals(RAW.bal.get(s), ks, "f").some(ok))
    .sort();
  const tot1 = ks.map(() => [0, 0]);
  seds1.forEach(s => {
    const b = RAW.bal.get(s);
    ks.forEach((k, i) => {
      const x = b.m.get(k);
      if (!x || (x.obs && !RANGE.obs)) return;
      if (ok(x.d)) tot1[i][0] += x.d;
      if (ok(x.f)) tot1[i][1] += x.f;
    });
  });
  const l1 = seds1.filter(s => !q1 || s.includes(q1)),
    np1 = Math.max(1, Math.ceil(l1.length / PS));
  PG.t1 = Math.min(PG.t1, np1 - 1);
  const cell = (b, k, f, sep) => {
    const x = b.m.get(k);
    if (!x || (x.obs && !RANGE.obs)) return `<td class="${sep ? "sep" : ""}"></td>`;
    return `<td class="${sep ? "sep" : ""}" ${x.obs ? 'style="font-style:italic;color:#6a4fb3" title="OBS S.INFLUYENTE"' : ""}>${f2(x[f])}</td>`;
  };
  $("#tab1").innerHTML =
    `<table class="mt"><thead><tr><th rowspan="2">SED</th><th class="g dis sep" colspan="${ks.length}">Energía Distribuida</th><th class="g fac sep" colspan="${ks.length}">Energía Facturada</th></tr>
    <tr>${ks.map((k, i) => `<th class="m ${i === 0 ? "sep" : ""}">Distrib. ${mlab(k)}</th>`).join("")}${ks.map((k, i) => `<th class="m ${i === 0 ? "sep" : ""}">Fact. ${mlab(k)}</th>`).join("")}</tr></thead><tbody>
    ${l1
      .slice(PG.t1 * PS, PG.t1 * PS + PS)
      .map(s => {
        const b = RAW.bal.get(s);
        return `<tr><td class="l"><b>${s}</b></td>${ks.map((k, i) => cell(b, k, "d", i === 0)).join("")}${ks.map((k, i) => cell(b, k, "f", i === 0)).join("")}</tr>`;
      })
      .join("")}
    <tr class="tot"><td class="l">Total (${seds1.length} SED)</td>${tot1.map((t, i) => `<td class="${i === 0 ? "sep" : ""}">${fmt(t[0])}</td>`).join("")}${tot1.map((t, i) => `<td class="${i === 0 ? "sep" : ""}">${fmt(t[1])}</td>`).join("")}</tr></tbody></table>`;
  $("#pg1").innerHTML =
    `<button class="btn sec" data-p="t1" data-d="-1">◀</button> página ${PG.t1 + 1} de ${np1} · ${l1.length} SED <button class="btn sec" data-p="t1" data-d="1">▶</button>`;
  document.querySelectorAll(".pager button[data-p]").forEach(
    b =>
      (b.onclick = () => {
        PG[b.dataset.p] = Math.max(0, PG[b.dataset.p] + Number(b.dataset.d));
        renderTables();
      })
  );
}

/**
 * Exporta el Cuadro 1 a Excel (una fila por SED y una columna por mes).
 */
function exportTables() {
  const ks = inRange(),
    wb = XLSX.utils.book_new();
  const a = [["SED", ...ks.map(k => "Distrib. " + mlab(k)), ...ks.map(k => "Fact. " + mlab(k))]],
    t = ks.map(() => [0, 0]);
  [...RAW.bal.keys()].sort().forEach(s => {
    const b = RAW.bal.get(s),
      d = balVals(b, ks, "d"),
      f = balVals(b, ks, "f");
    if (!d.some(ok) && !f.some(ok)) return;
    a.push([s, ...d.map(r3), ...f.map(r3)]);
    d.forEach((v, i) => {
      if (ok(v)) t[i][0] += v;
    });
    f.forEach((v, i) => {
      if (ok(v)) t[i][1] += v;
    });
  });
  a.push(["Total", ...t.map(x => r3(x[0])), ...t.map(x => r3(x[1]))]);
  XLSX.utils.book_append_sheet(wb, sheet(a, [10, ...ks.map(() => 12), ...ks.map(() => 12)]), "Distribuida_Facturada");
  XLSX.writeFile(wb, `Cuadros_${mlab(RANGE.a)}_a_${mlab(RANGE.b)}.xlsx`);
}

/**
 * Isolation Forest: construye nT árboles que parten los datos al azar. Una SED anómala queda aislada en pocos cortes.
 * Devuelve un puntaje por SED (más alto = más anómala).
 */
function isoForest(X, nT, psi, seed) {
  const rnd = mulberry32(seed),
    n = X.length,
    d = X[0].length,
    hl = Math.ceil(Math.log2(psi));
  const c = m => (m > 2 ? 2 * (Math.log(m - 1) + 0.5772156649) - (2 * (m - 1)) / m : m === 2 ? 1 : 0);
  const grow = (idx, h) => {
    if (h >= hl || idx.length <= 1) return {size: idx.length};
    const f = Math.floor(rnd() * d);
    let mn = Infinity,
      mx = -Infinity;
    idx.forEach(i => {
      mn = Math.min(mn, X[i][f]);
      mx = Math.max(mx, X[i][f]);
    });
    if (mx === mn) return {size: idx.length};
    const sp = mn + rnd() * (mx - mn);
    return {
      f,
      sp,
      l: grow(
        idx.filter(i => X[i][f] < sp),
        h + 1
      ),
      r: grow(
        idx.filter(i => X[i][f] >= sp),
        h + 1
      )
    };
  };
  const trees = [];
  for (let t = 0; t < nT; t++) {
    const idx = [];
    for (let k = 0; k < psi; k++) idx.push(Math.floor(rnd() * n));
    trees.push(grow(idx, 0));
  }
  const path = (x, nd, h) => (nd.size !== undefined ? h + c(nd.size) : path(x, x[nd.f] < nd.sp ? nd.l : nd.r, h + 1));
  return X.map(x => Math.pow(2, -mean(trees.map(t => path(x, t, 0))) / c(psi)));
}
