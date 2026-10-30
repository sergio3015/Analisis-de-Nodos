/* ============================================================================================================
 * ARCHIVO 16 · EXPORTACIÓN A EXCEL (xlsx-js-style, versión de SheetJS que permite dar formato)
 *   - sheet(): convierte una tabla en hoja de Excel CON FORMATO: encabezado azul PLUZ, filas NODO/TOTAL en amarillo,
 *     separador de miles, columnas de porcentaje y filtros.
 *   - nodeSheets() / exportNode(): Excel de una SED con todas sus hojas (resumen y cada método).
 *   - exportAll(): Excel de todas las SED (criticidad del balance vs IA, errores de cadena, acciones de campo...).
 *   - hypAoa(): acciones sugeridas para el personal de campo.
 * ========================================================================================================== */
"use strict";

/* Arma una hoja de Excel con formato: encabezado azul PLUZ, filas NODO/TOTAL en amarillo, títulos en negrita,
   números con separador de miles y columnas de porcentaje (encabezado con "%" o "P(") en formato 0.0 %. */
function sheet(aoa, widths, opt = {}) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (widths) ws["!cols"] = widths.map(w => ({wch: w}));
  if (!ws["!ref"]) return ws;
  const rg = XLSX.utils.decode_range(ws["!ref"]),
    hdr = opt.hdr ?? 0,
    H = (aoa[hdr] || []).map(x => String(x ?? "")),
    pct = H.map(h => /%|^P\(/.test(h));
  const B = {style: "thin", color: {rgb: "C9D2E3"}},
    border = {top: B, bottom: B, left: B, right: B};
  for (let r = rg.s.r; r <= rg.e.r; r++) {
    const row = aoa[r] || [],
      f3 = row.slice(0, 3).map(x => String(x ?? ""));
    const isHdr = row.length > 1 && (r === hdr || (r > hdr && H.length > 1 && row[0] === H[0] && row[1] === H[1]));
    const isTot = !isHdr && f3.some(x => /^(NODO|TOTAL|Total)\b/.test(x)),
      isTit = typeof row[0] === "string" && /^(INICIO|ITERACI|RESUMEN|CONCLUSI|COMPARACI|NOTAS|Resultados)/.test(row[0]);
    for (let c = rg.s.c; c <= rg.e.c; c++) {
      const a = XLSX.utils.encode_cell({r, c}),
        cell = ws[a];
      if (!cell) continue;
      const s = {border, alignment: {vertical: "center", wrapText: typeof cell.v === "string" && cell.v.length > 40}};
      if (isHdr)
        Object.assign(s, {
          fill: {fgColor: {rgb: "3A57A7"}},
          font: {bold: true, color: {rgb: "FFFFFF"}},
          alignment: {wrapText: true, vertical: "center", horizontal: "center"}
        });
      else if (isTot) Object.assign(s, {fill: {fgColor: {rgb: "FFF2A8"}}, font: {bold: true}});
      else if (isTit) s.font = {bold: true, sz: 12, color: {rgb: "3A57A7"}};
      if (cell.t === "n" && !isHdr) {
        cell.z = pct[c] && r > hdr ? "0.0%" : Number.isInteger(cell.v) ? "#,##0" : "#,##0.00";
        s.numFmt = cell.z;
      }
      cell.s = s;
    }
  }
  if (!opt.noFilter && H.length > 2 && rg.e.r > hdr)
    ws["!autofilter"] = {ref: XLSX.utils.encode_range({s: {r: hdr, c: 0}, e: {r: rg.e.r, c: H.length - 1}})};
  ws["!rows"] = [...Array(rg.e.r + 1)].map((_, r) => (r === hdr && H.length > 2 ? {hpt: 42} : null));
  return ws;
}

/**
 * Redondea a 3 decimales para Excel (vacío si no es número).
 */
const r3 = x => (!ok(x) ? "" : Math.round(x * 1000) / 1000);

/**
 * Encabezados comunes de las hojas de Excel de un nodo.
 */
const BASE_H = [
  "SED",
  "Tipo",
  "Distancia (m)",
  "E. Distribuida (MWh) Balance",
  "E. Fact. Balance (MWh)",
  "Pérdida Validación (MWh)",
  "Desv. Fact. (%)"
];

/**
 * Valores comunes de una SED para Excel.
 */
const baseV = r => [r.sed, r.rol, r3(r.d), r3(ok(r.dist) ? r.dist : r.distU), r3(r.s ? r.factBal : r.fv), r3(r.perd), r3(r.desv)];

/**
 * Valores de la fila NODO para Excel.
 */
const nodeV = n => ["NODO", "Total", "", r3(n.dist), r3(n.fv), r3(n.perd), r3(n.desv)];

/**
 * Agrega al libro wb todas las hojas del análisis de una SED (resumen, métodos, serie mensual, evidencias...).
 */
function nodeSheets(R, wb) {
  const gen = R.gen,
    totEx = (R.rank || []).reduce((s, r) => s + Math.max(0, r.exc), 0);
  const res = [
    ["RESUMEN DEL ANÁLISIS (energías en MWh, promedio mensual)"],
    [],
    ["SED", R.sed],
    ["Alimentador", R.t.alim],
    ["Distrito / Provincia", R.t.dist + " / " + R.t.prov],
    ["Criticidad del Excel", R.ts ? R.ts.crit : ""],
    ["CRITICIDAD PROPIA (IA)", R.ia ? `${R.ia.clase} (${fmt(100 * R.ia.score, 0)} de 100)` : ""],
    ["Clasificación", R.clase],
    ["Veredicto", R.ver],
    [],
    ["Pérdida Validación de la SED (Cuadro 1)", r3(R.ts && R.ts.perd)],
    ["Pérdida esperada por energía y clientes (Cuadro 2)", r3(R.rows[0].esp)],
    ["Pérdida real tras iterar (Cuadro 3)", r3(R.rows[0].corr)],
    ["Exceso real de la SED (MWh)", r3(R.rows[0].exc)],
    ["Exceso por cliente (kWh)", r3(R.rows[0].excCli)],
    ["Modelo de pérdida esperada", `${pctf(R.QR.a, 2)} × E. Distribuida + ${fmt(R.QR.b, 1)} kWh × clientes`],
    ["P(Hurto)", r3(R.P1)],
    ["P(Medición)", r3(R.P2)],
    ["P(Cadena)", r3(R.P3)],
    ["PÉRDIDA POR HURTO ESTIMADA (MWh/mes)", r3(R.hurto)],
    [],
    ["CONCLUSIÓN"],
    ["Pérdida real del nodo (MWh)", r3(R.FIN.totCorr)],
    ["Exceso del nodo sobre lo esperado (MWh)", r3(totEx)],
    [
      "SED con mayor pérdida",
      gen
        ? `${gen.sed} (${fmt(gen.exc)} MWh de exceso, ${totEx > 0 ? pctf(gen.exc / totEx, 0) : "-"} del nodo, ${fmt(gen.excCli, 0)} kWh por cliente)`
        : "ninguna"
    ],
    ["SED con mayor pérdida por cliente", R.genCli ? `${R.genCli.sed} (${fmt(R.genCli.excCli, 0)} kWh por cliente)` : "-"],
    [
      "Error de cadena",
      R.cadPairs.length
        ? R.cadPairs.map(x => `${x.i.sed} ↔ ${x.j.sed} (P ${pctf(x.pCad, 0)}, ${fmt(x.xMax)} MWh)`).join("; ")
        : "no detectado"
    ]
  ];
  XLSX.utils.book_append_sheet(wb, sheet(res, [50, 80]), "Resumen");
  const c1 = [
    [
      ...BASE_H,
      "Clientes",
      "Pérdida por cliente (kWh)",
      "Rol en el nodo (Método 1)",
      "Compensación (regla 0–3 MWh)",
      "Queda tras compensar (MWh)",
      "Criticidad (balance)",
      "Calidad"
    ]
  ];
  R.rows.forEach(r =>
    c1.push([
      ...baseV(r),
      r3(r.cli),
      r3(r.perdCli),
      r.rol1,
      cmpTxt(r),
      r.cmp && r.cmp.part ? r3(r.cmp.resto) : "",
      r.s ? r.s.crit : "sin balance",
      r.qc
    ])
  );
  c1.push(nodeV(R.node));
  c1.push(
    [],
    ["Resultado de compensación del objetivo", R.m1.CN.res],
    ["Compensan al objetivo", R.rows[0].cmp.con.map(x => `${x.r.sed} (${fmt(x.mwh)} MWh, paso ${x.paso})`).join(", ") || "ninguna"],
    ["Pérdida del objetivo tras compensar (MWh)", r3(R.m1.CN.objResto)],
    ["Mayor pérdida (Método 1)", R.m1.gen ? `${R.m1.gen.sed} (${fmt(R.m1.gen.perd)} MWh)` : "-"],
    ["Rango de meses", `${mlab(RANGE.a)} a ${mlab(RANGE.b)} (${RANGE.modo === "todos" ? "todos los meses" : "solo meses con dato"})`]
  );
  XLSX.utils.book_append_sheet(wb, sheet(c1, [9, 9, 10, 13, 12, 13, 9, 9, 10, 20, 50, 12, 14]), "Metodo1_Nodo");
  const c2 = [[...BASE_H, "Clientes", "kWh por cliente", "Pérdida esperada (MWh)", "Exceso (MWh)", "Exceso por cliente (kWh)"]];
  R.rows.forEach(r => c2.push([...baseV(r), r3(r.cli), r3(r.kwhcli), r3(r.esp), r.medida ? r3(r.r0) : "", r.medida ? r3(r.r0cli) : ""]));
  c2.push([...nodeV(R.node), r3(R.node.cli), "", r3(R.node.esp), r3(R.node.r0)]);
  c2.push(
    [],
    ["Modelo (regresión cuantil)", `Pérdida esperada = ${r3(R.QR.a)} × E. Distribuida + ${r3(R.QR.b)} MWh por cada 1000 clientes`]
  );
  XLSX.utils.book_append_sheet(wb, sheet(c2, [9, 9, 10, 13, 12, 13, 11, 9, 13, 9, 9, 10, 12, 11, 12]), "Metodo3_Esperada");
  const c3 = [];
  R.IT.forEach((it, k) => {
    const map = new Map(it.tab.map(x => [x.r, x]));
    c3.push([
      k === 0 ? `INICIO: solo ${R.sed}` : `ITERACIÓN ${k}: se agrega ${it.nuevo.sed} (${fmt(it.nuevo.d, 0)} m)`,
      "",
      "",
      "",
      "",
      "Mayor pérdida:",
      it.lead ? `${it.lead.r.sed} (${fmt(it.lead.ex)} MWh)` : "-"
    ]);
    c3.push([
      ...BASE_H,
      "Pérdida esperada (MWh)",
      "Ajuste por cadena (MWh)",
      "Pérdida real estimada (MWh)",
      "Exceso real (MWh)",
      "Exceso por cliente (kWh)"
    ]);
    it.tab.forEach(x => c3.push([...baseV(x.r), r3(x.r.esp), r3(x.adj), r3(x.corr), r3(x.ex), r3(x.exCli)]));
    c3.push(["NODO", "Total", "", "", "", "", "", "", r3(it.totAdj), r3(it.totCorr), r3(it.totEx)]);
    it.tr.forEach(x =>
      c3.push([
        `Paso ${x.paso}`,
        `${x.i.sed} → ${x.j.sed}`,
        r3(x.d),
        "P(cadena)",
        r3(x.pCad),
        "Compensable",
        r3(x.xMax),
        "Trasladado",
        r3(x.t),
        x.lrs.map(([a, b]) => `${a} ×${fmt(b, 2)}`).join("; ")
      ])
    );
    c3.push([]);
  });
  XLSX.utils.book_append_sheet(
    wb,
    sheet(c3, [22, 14, 10, 13, 12, 13, 11, 12, 14, 30, 12, 12, 14, 11, 12], {hdr: 1, noFilter: true}),
    "Metodo4_Iteraciones"
  );
  const c4 = [
    [
      ...BASE_H,
      "Pérdida real tras iterar (MWh)",
      "Exceso por cliente (kWh)",
      "% ajustado Bayes empírico",
      "Grupo EM",
      "Anomalía",
      "P(hurto)",
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
      "Puntaje IA",
      "Criticidad IA",
      "Criticidad Excel"
    ]
  ];
  R.rows.forEach(r =>
    c4.push([
      ...baseV(r),
      r3(r.corr),
      r3(r.excCli),
      r.s ? r3(r.s.pctEB) : "",
      r.s ? r.s.gmmG : "",
      r.s ? r3(r.s.isoP) : "",
      r3(r.P1),
      ...(r.ia ? [r.ia.S1, r.ia.S2, r.ia.S3, r.ia.S4, r.ia.S5, r.ia.S6].map(r3) : ["", "", "", "", "", ""]),
      r.ia ? r3(100 * r.ia.score) : "",
      r.ia ? r.ia.clase : "",
      r.s ? r.s.crit : ""
    ])
  );
  c4.push([...nodeV(R.node), r3(R.FIN.totCorr)]);
  XLSX.utils.book_append_sheet(
    wb,
    sheet(c4, [9, 9, 10, 13, 12, 13, 11, 9, 13, 9, 13, 11, 11, 8, 9, 8, 6, 6, 6, 6, 6, 6, 9, 14, 20]),
    "Metodo6_Criticidad"
  );
  const cc = [
    [
      "Nº",
      "SED",
      "Clientes",
      "Pérdida Validación (MWh)",
      "Ajuste por cadena (MWh)",
      "Pérdida real estimada (MWh)",
      "Pérdida esperada (MWh)",
      "Exceso real (MWh)",
      "Exceso por cliente (kWh)",
      "% del exceso del nodo",
      "Criticidad IA",
      "Criticidad Excel"
    ]
  ];
  (R.rank || []).forEach((r, i) =>
    cc.push([
      i + 1,
      r.sed,
      r3(r.cli),
      r3(r.perd),
      r3(r.adj),
      r3(r.corr),
      r3(r.esp),
      r3(r.exc),
      r3(r.excCli),
      totEx > 0 && r.exc > 0 ? r3(r.exc / totEx) : 0,
      r.ia ? r.ia.clase : "",
      r.s ? r.s.crit : ""
    ])
  );
  XLSX.utils.book_append_sheet(wb, sheet(cc, [6, 12, 9, 13, 13, 13, 13, 11, 12, 11, 14, 20]), "Conclusion");
  const dm = [["Distancias (m)", ...R.rows.map(r => r.sed)]];
  R.rows.forEach((r, i) => dm.push([r.sed, ...R.DM[i].map(r3)]));
  XLSX.utils.book_append_sheet(wb, sheet(dm, [14, ...R.rows.map(() => 9)]), "Distancias");
  const ms = [["SED", "Mes", "Distribuida (MWh)", "Facturada (MWh)", "Pérdida (MWh)", "% pérdida", "¿Se usó?"]];
  R.rows
    .filter(r => r.s)
    .forEach(r =>
      r.s.raw.forEach((m, i) => {
        const o = r.s.series[i];
        ms.push([r.sed, m.lab, r3(m.d), r3(m.f), r3(o ? o.l : null), r3(o ? o.pc : null), o ? "Sí" : "No (cero, negativo o atípico)"]);
      })
    );
  XLSX.utils.book_append_sheet(wb, sheet(ms, [9, 8, 14, 14, 12, 10, 26]), "Serie_mensual");
  const cr = [["Criterio", "Descripción", "Peso", "¿Cumple?", "Dato"]];
  R.CRIT.forEach(c => cr.push([c.id, c.txt, c.w, c.c ? "SÍ" : "NO", c.v]));
  cr.push([], ["Resultado", R.cTxt, R.cScore + " de " + R.cMax]);
  XLSX.utils.book_append_sheet(wb, sheet(cr, [8, 60, 6, 9, 60]), "Metodo5_Cadena");
  const ev = [["Evidencia", "Grado (0-1)", "Dato", "LR+ Hurto", "LR− Hurto", "LR+ Medición", "LR− Medición", "LR+ Cadena", "LR− Cadena"]];
  R.ev.forEach(e => ev.push([e.id + " " + e.name, r3(e.deg), e.txt, ...e.lr.flat().map(r3)]));
  XLSX.utils.book_append_sheet(wb, sheet(ev, [46, 10, 34, 9, 9, 9, 9, 9, 9]), "Evidencias");
}

/**
 * Tabla de acciones sugeridas para campo (error de cadena, nodo incompleto, validar medición, hurto).
 */
function hypAoa(list) {
  const a = [
    [
      "SED objetivo",
      "Alimentador",
      "Criticidad IA",
      "Clasificación",
      "Acción",
      "SED involucradas",
      "MWh/mes",
      "Prioridad",
      "Evidencia",
      "Acción para el personal técnico",
      "Resultado de campo"
    ]
  ];
  list.forEach(R =>
    (R.H || []).forEach(h =>
      a.push([R.sed, R.t.alim, R.ia ? R.ia.clase : "", R.clase, h.tipo, h.seds, r3(h.mwh), h.prior, h.ev, h.acc, ""])
    )
  );
  return a;
}

/**
 * Tabla de lo aprendido de los resultados de campo.
 */
function learnAoa() {
  const p = P(),
    LR = learnedLR(p);
  const a = [["Resultados de campo usados para aprender"], ["SED", "Resultado", "Nota"]];
  FIELD.forEach(f => a.push([f.sed, RES_TXT[f.res], f.nota]));
  a.push(
    [],
    ["Evidencia", "LR+ Hurto usado", "LR− Hurto usado", "LR+ Medición", "LR− Medición", "LR+ Cadena", "LR− Cadena", "Peso de los datos λ"]
  );
  EXPERT.forEach(([id, nm]) => a.push([id + " " + nm, ...LR[id].flatMap(x => [r3(x[0]), r3(x[1])]), r3(LR[id][0][2])]));
  return a;
}

/**
 * Botón "Exportar Excel del nodo".
 */
function exportNode() {
  if (!CUR) return;
  const wb = XLSX.utils.book_new();
  nodeSheets(CUR, wb);
  XLSX.utils.book_append_sheet(wb, sheet(hypAoa([CUR]), [10, 9, 12, 18, 26, 18, 9, 8, 60, 70, 20]), "Acciones_campo");
  XLSX.utils.book_append_sheet(wb, sheet(learnAoa(), [46, 12, 12, 12, 12, 12, 12, 12]), "Aprendizaje");
  XLSX.writeFile(wb, `Analisis_nodo_${CUR.sed}.xlsx`);
}

/**
 * Botón "Exportar Excel de todas las SED": criticidad del balance vs IA, errores de cadena, acciones de campo, etc.
 */
function exportAll() {
  const btn = $("#xlsAll");
  btn.disabled = true;
  btn.textContent = "Calculando…";
  setTimeout(() => {
    try {
      const p = P(),
        all = [...DB.LITE.values()].filter(r => r.ts && r.ia);
      const byEx = all.slice().sort((a, b) => (b.ts.pnt ?? -1e9) - (a.ts.pnt ?? -1e9)),
        byIA = all.slice().sort((a, b) => b.ia.score - a.ia.score);
      const A = [
        [
          "Nº",
          "SED",
          "Alimentador",
          "Distrito",
          "E. Distribuida (MWh) Balance",
          "E. Fact. Balance (MWh)",
          "Pérdida Validación (MWh)",
          "Desv. Fact. (%)",
          "PT (MWh)",
          "PNT (MWh)",
          "Criticidad Excel",
          "¿PNT ≥ 5?"
        ]
      ];
      byEx.forEach((R, i) => {
        const s = R.ts;
        A.push([
          i + 1,
          R.sed,
          R.t.alim,
          R.t.dist,
          r3(s.dist),
          r3(s.factBal),
          r3(s.perd),
          r3(s.desv),
          r3(s.pt),
          r3(s.pnt),
          s.crit,
          ok(s.pnt) && s.pnt >= 5 ? "SÍ" : "NO"
        ]);
      });
      const B = [
        [
          "Nº",
          "SED",
          "CRITICIDAD IA",
          "Puntaje IA",
          "Criticidad Excel",
          "Alimentador",
          "Distrito",
          "Clientes",
          "E. Distribuida (MWh) Balance",
          "E. Fact. Balance (MWh)",
          "Pérdida Validación (MWh)",
          "Pérdida esperada (MWh)",
          "Pérdida real tras iterar (MWh)",
          "Exceso real (MWh)",
          "Exceso por cliente (kWh)",
          "% ajustado Bayes empírico",
          "Grupo EM",
          "Anomalía",
          "Nº aledañas",
          "SED aledañas (m)",
          "SED con mayor pérdida en su nodo",
          "Error de cadena",
          "P(Hurto)",
          "P(Medición)",
          "P(Cadena)",
          "PÉRDIDA POR HURTO (MWh/mes)",
          "Clasificación"
        ]
      ];
      byIA.forEach((R, i) => {
        const s = R.ts,
          R0 = R.rows[0];
        B.push([
          i + 1,
          R.sed,
          R.ia.clase,
          r3(100 * R.ia.score),
          s.crit,
          R.t.alim,
          R.t.dist,
          r3(s.cli),
          r3(s.dist),
          r3(s.fv),
          r3(s.perd),
          r3(R0.esp),
          r3(R0.corr),
          r3(R0.exc),
          r3(R0.excCli),
          r3(s.pctEB),
          s.gmmG,
          r3(s.isoP),
          R.rows.length - 1,
          R.rows
            .slice(1)
            .map(x => `${x.sed} (${fmt(x.d, 0)})`)
            .join(", "),
          R.gen ? R.gen.sed : "",
          R.cadPairs.map(x => `${x.i.sed}↔${x.j.sed}`).join(", "),
          r3(R.P1),
          r3(R.P2),
          r3(R.P3),
          r3(R.hurto),
          R.clase
        ]);
      });
      const wb = XLSX.utils.book_new(),
        exC = [...new Set(all.map(r => r.ts.crit || "(sin dato)"))];
      const tot = [
        ["RESUMEN – energías en MWh (promedio mensual)"],
        [],
        ["SED analizadas", all.length],
        ["Modelo de pérdida esperada", `${pctf(DB.QR.a, 2)} × E. Distribuida + ${fmt(DB.QR.b, 1)} kWh × clientes`],
        ...CLS.map(c => ["Criticidad IA: " + c, all.filter(r => r.ia.clase === c).length]),
        ["SED con error de cadena detectado", all.filter(r => r.cadObj.length).length],
        ["SED con PNT ≥ 5 MWh según Método 1", all.filter(r => ok(r.ts.pnt) && r.ts.pnt >= 5).length],
        [],
        ["COMPARACIÓN: Criticidad Excel vs Criticidad IA"],
        ["Criticidad Excel", ...CLS, "Total"],
        ...exC.map(e => [
          e,
          ...CLS.map(c => all.filter(r => (r.ts.crit || "(sin dato)") === e && r.ia.clase === c).length),
          all.filter(r => (r.ts.crit || "(sin dato)") === e).length
        ]),
        [],
        ["Archivos usados"],
        ...["bal", "guia"].map(k => [KNAME[k === "guia" ? "gui" : k], RAW.src[k]]),
        ["Rango", `${mlab(RANGE.a)} a ${mlab(RANGE.b)}`]
      ];
      XLSX.utils.book_append_sheet(wb, sheet(tot, [46, 14, 10, 10, 10, 16, 8]), "Resumen");
      XLSX.utils.book_append_sheet(wb, sheet(A, [5, 9, 9, 16, 13, 12, 13, 9, 9, 9, 20, 8]), "Criticidad_balance");
      XLSX.utils.book_append_sheet(
        wb,
        sheet(B, [5, 9, 14, 8, 20, 9, 16, 8, 13, 13, 13, 12, 13, 11, 12, 11, 8, 8, 7, 50, 14, 26, 8, 8, 8, 13, 18]),
        "Criticidad_propia_IA"
      );
      const cad = [
        ["SED analizada", "Factura de más", "Pierde de más", "Distancia (m)", "Energía compensable (MWh)", "P(cadena)", "Señales"]
      ];
      all.forEach(R =>
        R.cadPairs.forEach(x =>
          cad.push([
            R.sed,
            x.i.sed,
            x.j.sed,
            r3(x.d),
            r3(x.xMax),
            r3(x.pCad),
            x.lrs
              .filter(l => l[1] > 1)
              .map(l => l[0])
              .join("; ")
          ])
        )
      );
      XLSX.utils.book_append_sheet(wb, sheet(cad, [10, 12, 12, 10, 12, 9, 80]), "Errores_cadena");
      const sus = byIA.filter(r => r.ia.clase === "Crítica" || r.ia.clase === "Alta" || r.cadPairs.length).slice(0, 250),
        full = sus.map(R => analyze(R.sed, p));
      const gn = [
        [
          "SED analizada",
          "SED con mayor pérdida en el nodo",
          "Distancia (m)",
          "Pérdida Validación (MWh)",
          "Pérdida real estimada (MWh)",
          "Exceso real (MWh)",
          "Exceso por cliente (kWh)",
          "Criticidad IA de esa SED"
        ]
      ];
      full.forEach(R => {
        if (R.gen)
          gn.push([
            R.sed,
            R.gen.sed,
            r3(R.gen.d),
            r3(R.gen.perd),
            r3(R.gen.corr),
            r3(R.gen.exc),
            r3(R.gen.excCli),
            R.gen.ia ? R.gen.ia.clase : ""
          ]);
      });
      XLSX.utils.book_append_sheet(wb, sheet(gn, [10, 14, 10, 12, 12, 10, 12, 14]), "SED_mayor_perdida");
      XLSX.utils.book_append_sheet(wb, sheet(hypAoa(full), [10, 9, 12, 18, 26, 18, 9, 8, 60, 70, 20]), "Acciones_campo");
      const ms = [["SED", ...DB.common.flatMap(m => ["Dist " + m.lab, "Fact " + m.lab, "Pérdida " + m.lab])]];
      all.forEach(R =>
        ms.push([
          R.sed,
          ...R.ts.raw.flatMap((m, i) => {
            const o = R.ts.series[i];
            return [r3(m.d), r3(m.f), o ? r3(o.l) : "excluido"];
          })
        ])
      );
      XLSX.utils.book_append_sheet(wb, sheet(ms, [9, ...DB.common.flatMap(() => [10, 10, 11])]), "Serie_mensual");
      XLSX.utils.book_append_sheet(wb, sheet(learnAoa(), [46, 12, 12, 12, 12, 12, 12, 12]), "Aprendizaje");
      XLSX.writeFile(wb, "Analisis_nodal_criticidad_Excel_vs_IA.xlsx");
    } catch (e) {
      alert("Error: " + e.message);
    }
    btn.disabled = false;
    btn.textContent = "Exportar Excel de todas las SED";
  }, 30);
}
