/* ============================================================================================================
 * ARCHIVO 11 · COMPENSACIÓN POR SED (Método 1) Y ANÁLISIS COMPLETO DEL NODO
 *   - compNode(): aplica la regla de compensación 0–3 MWh entre la SED objetivo y sus aledañas.
 *   - analyze(): analiza una SED con todos los métodos. Es la función principal del cálculo:
 *       1) forma el nodo (SED + aledañas) y calcula el balance del nodo,
 *       2) pérdida esperada (Método 3) e iteración nodal con conciliación (Método 4),
 *       3) intervalos P5–P95 con 200 simulaciones de Monte Carlo,
 *       4) 10 criterios de error de cadena (Método 5) y evidencias para la red bayesiana,
 *       5) probabilidades P(hurto), P(medición), P(cadena) y veredicto,
 *       6) compensación por SED (Método 1), acciones para campo, tramos y Monte Carlo del nodo.
 *   Con opt.lite = true hace solo lo necesario para la priorización de todas las SED (rápido).
 * ========================================================================================================== */
"use strict";

/* ===== Compensación por SED (regla 0–3 MWh) =====
   Una SED con Pérdida Validación negativa (factura más de lo que recibe) compensa a una SED con pérdida.
   Regla del par: Diferencia = | Pérdida SED A − | Pérdida SED B negativa | |; 0 ≤ Diferencia ≤ 3 MWh → se compensan.
   Orden: 1) se busca con las aledañas negativas el valor del objetivo (par 0–3 MWh);
          2) las negativas que quedan se emparejan con aledaños con pérdida (par 0–3 MWh);
          3) lo que sobra de las negativas se descuenta primero al objetivo y luego a los aledaños más cercanos.
   Resultado del objetivo: queda ≤ 3 → se compensa; se reduce pero queda > 3 → compensa parcialmente; no se reduce (o menos de 3 MWh) → no se compensa (pérdida crítica). */
const TOLC = 3;

/**
 * MÉTODO 1 · Compensación por SED con la regla 0–3 MWh:
 *   1) el valor del objetivo se busca en las aledañas negativas (|P − |N|| ≤ 3 → se compensa),
 *   2) las negativas que quedan se emparejan con aledaños con pérdida (misma regla),
 *   3) el sobrante de las negativas se descuenta primero al objetivo y luego a los aledaños más cercanos.
 * Resultado de cada SED (r.cmp): Se compensa / Compensa parcialmente / No se compensa · crítico / Compensa / Pérdida 0–3.
 * Devuelve el resumen del objetivo (cuánto se le compensó y cuánto queda).
 */
function compNode(rows) {
  const O = rows[0],
    E = 0.005,
    mem = rows.filter(r => r.medida && ok(r.perd));
  rows.forEach(r => (r.cmp = {con: [], para: [], resto: r.medida && ok(r.perd) ? r.perd : null, part: !!(r.medida && ok(r.perd))}));
  const DD = new Map(),
    dd = (a, b) => {
      const k = a.sed < b.sed ? a.sed + "|" + b.sed : b.sed + "|" + a.sed;
      let v = DD.get(k);
      if (v === undefined) {
        v = ok(a.lat) && ok(b.lat) ? hav(a.lat, a.lon, b.lat, b.lon) : 0;
        DD.set(k, v);
      }
      return v;
    },
    pasos = [];
  const give = (n, p, m, paso, dif) => {
    n.cmp.para.push({r: p, mwh: m, paso, dif});
    p.cmp.con.push({r: n, mwh: m, paso, dif});
    n.cmp.resto += m;
    p.cmp.resto -= m;
    pasos.push({paso, n, p, m, dif, d: dd(n, p)});
  };
  const negs = () => mem.filter(r => r.cmp.resto < -E);
  /* 1) el valor del objetivo se busca en las aledañas negativas */
  if (O.cmp.part && O.perd > TOLC) {
    const b = negs()
      .filter(n => n !== O)
      .map(n => ({n, dif: Math.abs(O.cmp.resto + n.cmp.resto)}))
      .filter(x => x.dif <= TOLC)
      .sort((a, b) => a.dif - b.dif)[0];
    if (b) give(b.n, O, Math.min(O.cmp.resto, -b.n.cmp.resto), 1, b.dif);
  }
  /* 2) pares 0–3 MWh entre aledaños */
  {
    const C = [];
    mem
      .filter(r => r !== O && r.cmp.resto > TOLC)
      .forEach(p =>
        negs()
          .filter(n => n !== O || true)
          .forEach(n => {
            if (n === p) return;
            const dif = Math.abs(p.cmp.resto + n.cmp.resto);
            if (dif <= TOLC) C.push({p, n, dif, d: dd(p, n)});
          })
      );
    C.sort((a, b) => a.dif - b.dif || a.d - b.d);
    const us = new Set();
    C.forEach(c => {
      if (us.has(c.p) || us.has(c.n)) return;
      us.add(c.p);
      us.add(c.n);
      give(c.n, c.p, Math.min(c.p.cmp.resto, -c.n.cmp.resto), 2, c.dif);
    });
  }
  /* 3) el sobrante de las negativas: primero al objetivo, luego a los aledaños más cercanos */
  negs()
    .sort((a, b) => a.cmp.resto - b.cmp.resto)
    .forEach(n => {
      const tgt = mem.filter(r => r !== O && r !== n && r.cmp.resto > E).sort((a, b) => dd(n, a) - dd(n, b));
      if (O.cmp.part && O !== n && O.cmp.resto > E) tgt.unshift(O);
      for (const p of tgt) {
        if (n.cmp.resto > -E) break;
        const m = Math.min(p.cmp.resto, -n.cmp.resto);
        if (m > E) give(n, p, m, 3, Math.abs(p.cmp.resto + n.cmp.resto));
      }
    });
  const lst = a => a.map(x => `${x.r.sed} ${fmt(x.mwh)}`).join(" + "),
    sumC = a => a.reduce((s, x) => s + x.mwh, 0);
  const anyNeg = mem.some(r => r !== O && r.perd < -E);
  rows.forEach(r => {
    const c = r.cmp,
      cm = sumC(c.con);
    if (!c.part) {
      c.est = "No participa";
      c.cls = "t-gray";
      c.det = "SED estimada (sin balance): no entra a la compensación";
      return;
    }
    if (r.perd < -E) {
      c.est = c.para.length ? "Compensa" : "Sin uso";
      c.cls = c.para.length ? "t-comp" : "t-gray";
      c.det =
        (c.para.length ? `a ${lst(c.para)} MWh` : "no hay SED con pérdida a quien compensar") +
        (c.resto < -TOLC ? ` · le sobran ${fmt(-c.resto)} MWh (factura de más: revisar)` : "");
      return;
    }
    if (r.perd <= TOLC && !c.con.length) {
      c.est = "Pérdida 0–3";
      c.cls = "t-gray";
      c.det = "pérdida entre 0 y 3 MWh: no requiere compensar";
      return;
    }
    if (c.resto <= TOLC && cm > E) {
      c.est = "Se compensa";
      c.cls = "t-ok";
      c.det = `con ${lst(c.con)} MWh · queda ${fmt(c.resto)} MWh (0–3)`;
      return;
    }
    if (cm > TOLC) {
      c.est = "Compensa parcialmente";
      c.cls = "t-warn";
      c.det = `con ${lst(c.con)} MWh · ${fmt(r.perd)} → ${fmt(c.resto)} MWh (${pctf(cm / r.perd, 0)} compensado)`;
      return;
    }
    c.est = r === O ? "No se compensa · crítico" : "No se compensa";
    c.cls = "t-bad";
    c.det =
      cm > E
        ? `solo ${lst(c.con)} MWh (< 3): queda ${fmt(c.resto)} MWh de pérdida`
        : r === O
          ? anyNeg
            ? `las aledañas negativas no alcanzan: queda ${fmt(c.resto)} MWh`
            : `ninguna aledaña es negativa: queda ${fmt(c.resto)} MWh`
          : "ninguna negativa la compensa";
  });
  const oc = O.cmp,
    tot = rows.reduce((a, r) => a + (ok(r.perd) ? r.perd : 0), 0);
  let acc = 0;
  rows.forEach(r => {
    if (ok(r.perd)) acc += r.perd;
    r.cmp.acum = acc;
  });
  const res = !oc.part
    ? "-"
    : O.perd < -E
      ? "El objetivo compensa a sus aledaños"
      : oc.est === "Pérdida 0–3"
        ? "Objetivo con pérdida 0–3 MWh"
        : oc.est;
  return {pasos, tot, res, estado: oc.est || "-", cls: oc.cls, objComp: sumC(oc.con), objResto: oc.resto, anyNeg};
}

/**
 * Analiza una SED con todos los métodos y devuelve el objeto R con todos los resultados.
 *   sed = código de la SED · p = parámetros (P()) · opt.lite = modo rápido (priorización)
 *   opt.manual = aledañas marcadas/desmarcadas a mano · opt.expert = sin aprendizaje (solo criterio experto).
 * Vea los comentarios internos de cada paso.
 */
function analyze(sed, p, opt = {}) {
  p = p || P();
  const nb = neighbours(sed, p);
  if (!nb) return null;
  if (opt.manual)
    nb.cand.forEach(c => {
      if (opt.manual.has(c.g.sed)) c.sel = opt.manual.get(c.g.sed);
    });
  const t = nb.t,
    s0 = DB.S.get(sed),
    ts = s0 && ok(s0.pct) ? s0 : null;
  // PASO 1 · Forma el nodo: fila 0 = SED objetivo; luego las aledañas elegidas (Método 2) de la más cercana a la más lejana.
  const rows = [rowFor(t, "Objetivo", 0, 1, p)];
  nb.cand
    .filter(c => c.sel)
    .sort((a, b) => a.d - b.d)
    .forEach(c => rows.push(rowFor(c.g, "Aledaña", c.d, c.prob, p)));
  const R0 = rows[0],
    vec = rows.slice(1);
  const sum = (a, k) => a.reduce((s, r) => s + (ok(r[k]) ? r[k] : 0), 0);
  const med = rows.filter(r => r.medida),
    val = rows.filter(r => r.distU !== null);
  // El NODO suma solo las SED con balance (medidas). Las SED sin balance se estiman y se muestran aparte: su pérdida es supuesta (10 %),
  // sumarla inflaría o desinflaría el total. Este total es el balance físico del nodo y es el MISMO en todos los métodos.
  const est = rows.filter(r => !r.medida && r.distU !== null);
  // PASO 2 · Totales del NODO (suma de todas las SED; las que no tienen balance aportan su energía estimada).
  const node = {
    dist: sum(med, "distU"),
    distB: sum(med, "dist"),
    fv: sum(med, "fv"),
    pnt: sum(med, "pnt"),
    pt: sum(med, "pt"),
    factBal: sum(med, "factBal"),
    reg: 0,
    alp: 0,
    cli: sum(med, "cli"),
    est: {n: est.length, dist: sum(est, "distU"), fv: sum(est, "fv"), perd: sum(est, "perd")}
  };
  node.perd = node.dist - node.fv;
  node.pct = node.dist > 0 ? node.perd / node.dist : 0;
  node.pntcli = node.cli > 0 ? (node.pnt * 1000) / node.cli : null;
  {
    const mm = rows.filter(r => r.s && ok(r.desv)),
      fb = sum(mm, "factBal");
    node.desv = mm.length && fb > 0 ? mm.reduce((a, r) => a + r.desv * r.factBal, 0) / fb : null;
  }
  // compl = fracción de SED medidas del nodo · CI = índice de compensación = PNT del nodo ÷ PNT de la SED
  // (CI < 0,3: los aledaños "absorben" la pérdida de la SED → probable error de cadena).
  const compl = med.length / rows.length,
    pntT = ts && R0.medida ? R0.pnt : null;
  const CI = pntT && pntT > 0 ? node.pnt / pntT : null;
  const vm = vec.filter(r => r.medida),
    dV = sum(vm, "distU"),
    fV = sum(vm, "fv");
  const exceso = dV > 0 && ts ? ts.pct - (dV - fV) / dV : null,
    zLag = vm.length ? mean(vm.map(r => r.zG)) : null;
  /* ---- MÉTODO 3: pérdida esperada según energía y número de clientes (regresión cuantil) · r0 = pérdida − esperada ---- */
  const QR = DB.QR,
    expL = r => QR.a * r.distU + (QR.b * (r.cli || 0)) / 1000;
  rows.forEach(r => {
    r.esp = ok(r.distU) ? expL(r) : null;
    r.r0 = r.medida ? r.perd - r.esp : null;
    r.r0cli = ok(r.r0) && r.cli > 0 ? (r.r0 * 1000) / r.cli : null;
  });
  node.esp = sum(med, "esp");
  node.r0 = sum(med, "r0");
  /* ---- MÉTODO 4: iteración (el nodo crece de a un aledaño y se concilia todo el nodo en cada paso con reconcile) ---- */
  const okO = !!(ts && R0.medida),
    steps = [R0, ...vec],
    IT = [],
    pcache = new Map();
  for (let k = opt.lite ? vec.length : 0; k <= vec.length; k++) {
    const mem = steps.slice(0, k + 1),
      set = mem.filter(r => r.medida),
      rc = reconcile(set, p, {lite: opt.lite, cache: pcache});
    const tab = mem.map(r => {
      const a = r.medida ? rc.adj.get(r) : null,
        corr = r.medida ? r.perd + a : null,
        ex = r.medida ? rc.res.get(r) : null;
      return {r, adj: a, corr, ex, exCli: ok(ex) && r.cli > 0 ? (ex * 1000) / r.cli : null};
    });
    const lead = tab.filter(x => ok(x.ex)).sort((a, b) => b.ex - a.ex)[0] || null,
      leadCli = tab.filter(x => ok(x.exCli)).sort((a, b) => b.exCli - a.exCli)[0] || null;
    const tot = k => tab.reduce((s, x) => s + (ok(x[k]) ? x[k] : 0), 0);
    IT.push({
      k,
      nuevo: steps[k],
      tab,
      tr: rc.tr,
      J: rc.J,
      nPares: rc.nPares,
      nSA: rc.nSA,
      sweeps: rc.sweeps,
      lead,
      leadCli,
      realO: okO ? tab[0].corr : null,
      skip: k > 0 && !steps[k].medida,
      totCorr: tot("corr"),
      totEx: tot("ex"),
      totAdj: tot("adj")
    });
  }
  // FIN = última iteración (nodo completo): de ahí salen la pérdida real (corr) y el exceso real (exc) de cada SED.
  const FIN = IT[IT.length - 1];
  FIN.tab.forEach(x => {
    x.r.adj = x.adj;
    x.r.corr = x.corr;
    x.r.exc = x.ex;
    x.r.excCli = x.exCli;
  });
  if (!opt.lite) {
    // intervalos: se repite la conciliación con ruido de medición (±0,75 % distribuida, ±0,5 % facturada) y del modelo de pérdida esperada (±15 %)
    const set = rows.filter(r => r.medida),
      rnd = mulberry32(5),
      NS = 200,
      smp = new Map(set.map(r => [r, {c: [], e: []}]));
    for (let s = 0; s < NS; s++) {
      const r0 = new Map(),
        pv = new Map();
      set.forEach(r => {
        const D = r.distU * (1 + 0.0075 * gauss(rnd)),
          F = r.fv * (1 + 0.005 * gauss(rnd)),
          pe = D - F,
          es = r.esp * Math.exp(0.15 * gauss(rnd));
        pv.set(r, pe);
        r0.set(r, pe - es);
      });
      const rc = reconcile(set, p, {lite: true, noSA: true, r0, cache: pcache});
      set.forEach(r => {
        smp.get(r).c.push(pv.get(r) + rc.adj.get(r));
        smp.get(r).e.push(rc.res.get(r));
      });
    }
    set.forEach(r => {
      const q = smp.get(r);
      r.ci = {
        c5: quant(q.c, 0.05),
        c95: quant(q.c, 0.95),
        e5: quant(q.e, 0.05),
        e95: quant(q.e, 0.95),
        pEx: q.e.filter(v => v > 0).length / NS
      };
    });
  }
  const TR = FIN.tr,
    toO = TR.filter(x => x.j === R0);
  const Ecad =
    okO && R0.pnt > 0
      ? Math.min(
          R0.pnt,
          toO.reduce((a, x) => a + x.xMax, 0)
        )
      : 0;
  const fCad = pntT > 0 ? Ecad / pntT : 0;
  const cadPairs = TR.filter(x => x.pCad >= 0.6 && x.t >= 0.5); // pares del nodo con error de cadena (P ≥ 60 % y ≥ 0,5 MWh trasladados)
  const cadObj = cadPairs.filter(x => (x.i === R0 || x.j === R0) && x.t >= 1); // la SED analizada está en el par (≥ 1 MWh)
  const mirror = ts
    ? vm
        .map(r => {
          const m = mirrorPair(ts, r);
          return m ? {...m, r} : null;
        })
        .filter(Boolean)
    : [];
  /* ---- criterios de error de cadena ---- */
  const kwN = median(rows.filter(r => r.medida && ok(r.kwhcli)).map(r => r.kwhcli));
  const inv = ts && ok(ts.kwhcli) && kwN > 0 ? vm.filter(r => ok(r.kwhcli) && r.kwhcli > 1.4 * kwN && ts.kwhcli < 0.7 * kwN) : [];
  const near150 = vec.filter(r => r.d <= 150),
    bajos = vm.filter(r => r.r0 < -0.5);
  const migs = ts
    ? vm
        .map(r => {
          const m = cliMig(R0, r);
          return m ? {r, ...m} : null;
        })
        .filter(Boolean)
    : [];
  const sg = v => (v > 0 ? "+" : "") + fmt(v, 0);
  const CRIT = ts
    ? [
        {
          id: "C1",
          txt: "Un aledaño factura más energía de la que recibe",
          v:
            vm
              .filter(r => r.fv > r.dist)
              .map(r => `${r.sed}: ${fmt(r.fv)} > ${fmt(r.dist)} MWh`)
              .join("; ") || "ninguno",
          c: vm.some(r => r.fv > r.dist),
          w: 3
        },
        {
          id: "C2",
          txt: "Un aledaño pierde menos de lo esperado para su energía y sus clientes",
          v: bajos.map(r => `${r.sed} ${fmt(r.r0)} MWh`).join(", ") || "ninguno",
          c: bajos.length > 0,
          w: 2
        },
        {
          id: "C3",
          txt: `El nodo compensa: índice de compensación < ${p.CC}`,
          v: CI === null ? "sin PNT en la SED" : "índice " + fmt(CI),
          c: CI !== null && CI < p.CC,
          w: 3
        },
        {
          id: "C4",
          txt: "Pérdidas en espejo mes a mes (cuando una sube, la otra baja)",
          v:
            mirror
              .filter(m => m.esp)
              .map(m => m.r.sed + (m.rr !== null ? ` (r = ${fmt(m.rr)})` : ""))
              .join(", ") || (mirror.length ? "no" : "sin meses comunes"),
          c: mirror.some(m => m.esp),
          w: 3
        },
        {
          id: "C5",
          txt: "Consumo por cliente invertido (la SED muy bajo, un aledaño muy alto)",
          v: inv.length
            ? `${sed} ${fmt(ts.kwhcli, 0)} vs ${inv.map(r => r.sed + " " + fmt(r.kwhcli, 0)).join(", ")} kWh/cliente`
            : ok(ts.kwhcli)
              ? `${fmt(ts.kwhcli, 0)} kWh/cliente (mediana nodo ${fmt(kwN, 0)})`
              : "sin clientes",
          c: inv.length > 0,
          w: 2
        },
        {
          id: "C6",
          txt: "Hay un aledaño a menos de 150 m (redes BT que se tocan)",
          v: near150.map(r => `${r.sed} ${fmt(r.d, 0)} m`).join(", ") || "ninguno",
          c: near150.length > 0,
          w: 1
        },
        {
          id: "C7",
          txt: "La energía que podría estar facturada en aledaños cubre ≥ 50 % de la PNT",
          v: pntT > 0 ? `${fmt(Ecad)} de ${fmt(pntT)} MWh (${pctf(fCad, 0)})` : "sin PNT",
          c: fCad >= 0.5 && pntT >= 1,
          w: 2
        },
        {
          id: "C8",
          txt: "Migración de clientes con un aledaño: el mismo mes una SED pierde clientes y la otra gana una cantidad parecida (CANT CLIENTES TOTALES)",
          v: migs.map(m => `${m.lab}: ${sed} ${sg(m.da)}, ${m.r.sed} ${sg(m.db)} clientes`).join("; ") || "no",
          c: migs.length > 0,
          w: 3
        },
        {
          id: "C9",
          txt: "Historial de corrección de cadena en el balance (SED del nodo)",
          v:
            rows
              .filter(r => r.s && r.s.cadK && r.s.cadK.length)
              .map(r => `${r.sed} (${r.s.cadK.length} mes(es), último ${mlab(r.s.cadK[r.s.cadK.length - 1])})`)
              .join("; ") || "ninguno",
          c: rows.some(r => r.cad),
          w: 2
        },
        {
          id: "C10",
          txt: "Cambio brusco de clientes en la SED sin un cambio parecido de la energía distribuida (clientes que pasaron a otra SED solo en el sistema)",
          v: ts.cliJ
            ? `${ts.cliJ.lab}: ${fmt(ts.cliJ.c0, 0)} → ${fmt(ts.cliJ.c1, 0)} clientes (${sg(100 * ts.cliJ.rel)} %), distribuida ${ts.cliJ.dRel === null ? "sin dato" : sg(100 * ts.cliJ.dRel) + " %"}, facturada ${ts.cliJ.fRel === null ? "sin dato" : sg(100 * ts.cliJ.fRel) + " %"}`
            : "no",
          c: !!(ts.cliJ && ts.cliJ.sinE),
          w: 2
        }
      ]
    : [];
  const cScore = CRIT.reduce((a, c) => a + (c.c ? c.w : 0), 0),
    cMax = CRIT.reduce((a, c) => a + c.w, 0);
  const cTxt = !ts
    ? "-"
    : cScore >= 7
      ? "Error de cadena PROBABLE"
      : cScore >= 4
        ? "Error de cadena POSIBLE"
        : "Error de cadena POCO PROBABLE";
  /* ---- evidencias difusas + red bayesiana ingenua ---- */
  const ev = [],
    LRs = opt.expert ? null : learnedLR(p);
  const E = (id, deg, txt) => {
    const ex = EXPERT.find(e => e[0] === id);
    ev.push({id, name: ex[1], deg, txt, lr: LRs ? LRs[id].map(x => [x[0], x[1]]) : ex[2]});
  };
  if (ts) {
    const sinT = vec.filter(r => r.qc === "Sin balance").map(r => r.d),
      prox = sinT.length ? clamp((400 - Math.min(...sinT)) / 250, 0, 1) : 0;
    E("E1", mu(ts.pct, 0.2, 0.45), pctf(ts.pct));
    E("E2", mu(ts.zA, 0, 2), "z = " + fmt(ts.zA));
    E(
      "E3",
      exceso === null ? null : mu(exceso, 0.05, 0.3),
      exceso === null ? "sin aledaños medidos" : (exceso >= 0 ? "+" : "") + pctf(exceso)
    );
    E(
      "E4",
      zLag === null ? null : mu(Math.min(ts.zG, zLag), 0, 1.5),
      zLag === null ? "-" : `z SED ${fmt(ts.zG)} · z aledaños ${fmt(zLag)}`
    );
    E(
      "E5",
      ok(R0.r0) && R0.distU > 0 ? mu(R0.r0 / R0.distU, 0.05, 0.25) : null,
      ok(R0.r0) ? `real ${fmt(R0.perd)} vs esperada ${fmt(R0.esp)} MWh` : "-"
    );
    E("E6", ok(ts.kwhcli) ? mu(-ts.zK, 0, 2) : null, ok(ts.kwhcli) ? fmt(ts.kwhcli, 0) + " kWh/cliente" : "sin clientes");
    E("E7", mu(ts.isoP, 0.8, 0.98), "percentil " + pctf(ts.isoP, 0));
    E("E8", ts.util === null ? null : mu(ts.util, 0.8, 1.2), ts.util === null ? "sin kVA" : "utilización " + pctf(ts.util, 0));
    E("E9", ts.nBad + ts.nOut > 0 ? 1 : 0, `${ts.nBad} mes(es) negativos · ${ts.nOut} mes(es) sobre la capacidad del trafo`);
    E(
      "E10",
      ok(ts.slope) ? mu(ts.slope, 0.01, 0.05) : null,
      ok(ts.slope) ? (ts.slope >= 0 ? "+" : "") + pctf(ts.slope) + " por mes" : "pocos meses"
    );
    E(
      "E11",
      ok(ts.kal.maxInn) && ts.kal.x !== null ? mu(ts.kal.maxInn, 2, 4) : null,
      ts.kal.jump ? `${fmt(ts.kal.maxInn, 1)} σ en ${ts.kal.jump}` : "-"
    );
    E(
      "E12",
      ts.cliJ
        ? ts.cliJ.sinE
          ? mu(Math.abs(ts.cliJ.rel), 0.1, 0.4)
          : 0.3 * mu(Math.abs(ts.cliJ.rel), 0.1, 0.4)
        : ts.cliS && ts.cliS.some(ok)
          ? 0
          : null,
      ts.cliJ ? `${ts.cliJ.lab}: ${fmt(ts.cliJ.c0, 0)} → ${fmt(ts.cliJ.c1, 0)} clientes` : "sin cambio brusco"
    );
    E(
      "E13",
      vm.some(r => r.fv > r.dist) ? 1 : bajos.length ? 0.6 : 0,
      vm.some(r => r.fv > r.dist) ? "factura de más" : bajos.length ? "pierde menos de lo esperado" : "no"
    );
    E(
      "E14",
      mirror.length ? (mirror.some(m => m.esp) ? (mirror.some(m => m.esp && m.n >= 3) ? 1 : 0.6) : 0) : null,
      mirror.length ? (mirror.some(m => m.esp) ? "sí" : "no") : "sin meses comunes"
    );
    E("E15", ok(ts.kwhcli) && kwN > 0 ? (inv.length ? 1 : 0) : null, inv.length ? "sí" : "no");
    E("E16", mu(fCad, 0.2, 0.6), pctf(fCad, 0) + " de la PNT");
    E("E17", Math.min(mu(ts.pct, 0.2, 0.45), prox), sinT.length ? fmt(Math.min(...sinT), 0) + " m" : "no");
    E("E18", CI === null ? null : clamp((p.CR - CI) / (p.CR - p.CC), 0, 1), CI === null ? "-" : "índice " + fmt(CI));
    E("E19", migs.length ? 1 : 0, migs.map(m => `${m.r.sed} (${m.lab})`).join(", ") || "no");
    E(
      "E20",
      rows.some(r => r.cad) ? 1 : 0,
      rows
        .filter(r => r.cad)
        .map(r => r.sed)
        .join(", ") || "no"
    );
  }
  // Red bayesiana ingenua con evidencias difusas: log-odds = log(prior) + Σ [grado·log(LR+) + (1 − grado)·log(LR−)].
  // prob = [P(hurto), P(error de medición), P(error de cadena)].
  const prob = PRIOR.map((pr, h) => {
    let lg = Math.log(pr / (1 - pr));
    ev.forEach(e => {
      if (e.deg !== null) lg += e.deg * Math.log(e.lr[h][0]) + (1 - e.deg) * Math.log(e.lr[h][1]);
    });
    return sigm(lg);
  });
  const [P1, P2, P3] = ts ? prob : [null, null, null];
  const pntCad = pntT !== null ? Math.max(0, pntT - Ecad) : null;
  const pntEsp = pntT !== null && ts ? (1 - P3) * pntT + P3 * pntCad : null;
  // Pérdida por hurto estimada = P(hurto) × (1 − P(medición)) × PNT esperada (descontando la parte que explica el error de cadena).
  const hurto = ts && pntEsp !== null ? P1 * (1 - P2) * Math.max(0, pntEsp) : ts ? 0 : null;
  const nivel = !ts ? "Sin balance" : P1 >= 0.7 && hurto >= 3 && R0.qc === "OK" ? "ALTA" : P1 >= 0.5 && hurto >= 1 ? "MEDIA" : "BAJA";
  /* ---- veredicto ---- */
  let ver, clase;
  const parTxt = cadPairs.length ? cadPairs.map(x => `${x.i.sed} ↔ ${x.j.sed}`).join(", ") : "con los aledaños";
  if (!ts) {
    ver = "No evaluable: la SED no tiene energía distribuida/facturada en los archivos.";
    clase = "Sin balance";
  } else if (!R0.medida || R0.qc === "Fact > Dist") {
    ver = `Dato físicamente imposible en la SED (${R0.qc}): validar TOTA, factor TC y reductores antes de concluir pérdida.`;
    clase = "Validar medición";
  } else if (P2 >= 0.5 && P2 >= P1) {
    ver = "Probable error de medición o factor: validar TOTA antes de intervenir.";
    clase = "Validar medición";
  } else if (P3 >= 0.5 && P3 >= P1) {
    ver = `Probable error de cadena (${parTxt}): hasta ${fmt(Ecad)} MWh de la PNT podrían estar facturándose en aledaños.`;
    clase = "Error de cadena";
  } else if (CI !== null && CI < p.CC) {
    ver = "El nodo COMPENSA: los aledaños absorben la pérdida (probable error de cadena).";
    clase = "Error de cadena";
  } else if (P1 >= 0.5 && ((zLag !== null && zLag > 0.5 && ts.zG > 0.5) || (CI !== null && CI >= 1.5))) {
    ver = "PÉRDIDA REAL y extendida a los aledaños (zona): campaña por zona.";
    clase = "Pérdida de zona";
  } else if (P1 >= 0.5) {
    ver = "PÉRDIDA REAL localizada en la SED: el nodo no compensa.";
    clase = "Pérdida localizada";
  } else if (pntEsp !== null && pntEsp >= 3) {
    ver = "Pérdida moderada sin señales fuertes: vigilar en el próximo balance.";
    clase = "Vigilar";
  } else {
    ver = "Sin pérdida relevante.";
    clase = "Normal";
  }
  if (CI !== null && CI >= p.CC && CI < p.CR && clase !== "Error de cadena")
    ver += ` El nodo compensa PARCIALMENTE (índice ${fmt(CI)}): revisar criterios de cadena.`;
  if (ts && R0.qc === "Utilización >100%")
    ver += ` La SED registra más energía que la capacidad de su trafo (${pctf(ts.util, 0)}): confirmar kVA y TOTA.`;
  if (ts && t.sinCoord) ver += " La SED no está en la GUIA SED cargada: no tiene coordenadas ni aledaños.";
  else if (compl < 0.5 && ts) ver += ` Nodo con ${pctf(compl, 0)} de SED medidas: el resto es estimado por clientes.`;
  const rec12 = hurto !== null ? hurto * 12 : null,
    inspec = rec12 !== null && rec12 >= p.UI && nivel !== "BAJA";
  const R = {
    sed,
    t,
    ts,
    nb,
    rows,
    node,
    compl,
    CI,
    exceso,
    zLag,
    ev,
    P1,
    P2,
    P3,
    pntT,
    Ecad,
    fCad,
    pntCad,
    pntEsp,
    hurto,
    nivel,
    ver,
    clase,
    alim: DB.AL[t.alim],
    p,
    mirror,
    IT,
    FIN,
    TR,
    cadPairs,
    cadObj,
    QR,
    CRIT,
    cScore,
    cMax,
    cTxt,
    kwN,
    rec12,
    inspec,
    migs
  };
  /* Método 1: qué SED compensa y cuál pierde más (balance directo del nodo) */
  {
    const meds = rows.filter(r => r.medida && ok(r.perd));
    rows.forEach(r => {
      r.rol1 = !r.medida ? "Estimada" : r.perd < 0 ? "Compensa" : "Pierde";
      r.perdCli = ok(r.perd) && r.cli > 0 ? (r.perd * 1000) / r.cli : null;
    });
    const g1 = meds.filter(r => r.perd > 0).sort((a, b) => b.perd - a.perd)[0] || null;
    if (g1) g1.rol1 = "Mayor pérdida";
    const gc1 = meds.filter(r => r.perd > 0 && r.qc === "OK" && ok(r.perdCli)).sort((a, b) => b.perdCli - a.perdCli)[0] || null;
    const comp = meds.filter(r => r.perd < 0),
      compMWh = Math.abs(comp.reduce((a, r) => a + r.perd, 0)),
      posMWh = meds.filter(r => r.perd > 0).reduce((a, r) => a + r.perd, 0);
    const CN = compNode(rows);
    R.m1 = {
      gen: g1,
      genCli: gc1,
      comp: rows[0].cmp.con.map(x => x.r),
      compAll: comp,
      compMWh: CN.objComp,
      posMWh,
      neto: posMWh - compMWh,
      frac: posMWh > 0 ? compMWh / posMWh : 0,
      CN
    };
  }
  R.gen = FIN.lead && FIN.lead.ex > 0 ? FIN.lead.r : null;
  R.genCli = FIN.leadCli && FIN.leadCli.exCli > 0 ? FIN.leadCli.r : null;
  if (opt.lite) return R;
  /* ---- datos de cada miembro (de su propio análisis) ---- */
  rows.forEach(r => {
    const q = DB.LITE.get(r.sed);
    if (q && q.ts) {
      r.P1 = r.rol === "Objetivo" ? P1 : q.P1;
      r.P3 = r.rol === "Objetivo" ? P3 : q.P3;
      r.hurto = r.rol === "Objetivo" ? hurto : q.hurto;
      r.clase = r.rol === "Objetivo" ? clase : q.clase;
      r.ia = q.ia;
    } else {
      r.P1 = null;
      r.P3 = null;
      r.hurto = null;
      r.clase = null;
      r.ia = null;
    }
  });
  R.ia = R0.ia;
  R.rank = rows.filter(r => ok(r.exc)).sort((a, b) => b.exc - a.exc);
  /* ---- acciones para campo (se exportan a Excel) ---- */
  const H = [];
  cadPairs.forEach(x =>
    H.push({
      tipo: "Error de cadena",
      seds: `${x.i.sed} ↔ ${x.j.sed}`,
      mwh: x.xMax,
      prior: x.pCad >= 0.7 ? "Alta" : "Media",
      ev: x.lrs
        .filter(l => l[1] > 1)
        .map(l => l[0])
        .join("; "),
      acc: `Verificar en GIS y en campo si suministros de ${x.j.sed} están registrados en ${x.i.sed} (recorrido de llaves BT, cadena SED–suministro). Si se confirma, reasignar y volver a balancear.`
    })
  );
  vec
    .filter(r => r.qc === "Sin balance" && r.d <= 350)
    .forEach(r =>
      H.push({
        tipo: "Nodo incompleto",
        seds: `${sed} ↔ ${r.sed}`,
        mwh: null,
        prior: "Media",
        ev: `${r.sed} está a ${fmt(r.d, 0)} m y no tiene balance`,
        acc: `Instalar o normalizar TOTA en ${r.sed}.`
      })
    );
  vec
    .filter(r => r.s && (r.qc === "Utilización >100%" || r.qc === "Fact > Dist"))
    .forEach(r =>
      H.push({
        tipo: "Validar medición del aledaño",
        seds: r.sed,
        mwh: null,
        prior: "Alta",
        ev: r.qc,
        acc: `Validar TOTA, factor TC y reductores de ${r.sed}.`
      })
    );
  if (ts && R0.qc !== "OK")
    H.push({
      tipo: "Validar medición de la SED",
      seds: sed,
      mwh: null,
      prior: "Alta",
      ev: R0.qc,
      acc: `Validar TOTA, factor TC y reductores de ${sed}.`
    });
  if (R.gen && R.gen.exc >= 1)
    H.push({
      tipo: "Hurto / PNT",
      seds: R.gen.sed,
      mwh: R.gen.exc,
      prior: R.gen.ia && R.gen.ia.clase === "Crítica" ? "Alta" : "Media",
      ev: `mayor pérdida real del nodo: ${fmt(R.gen.exc)} MWh sobre lo esperado (${fmt(R.gen.excCli, 0)} kWh por cliente)`,
      acc: "Bobinadoras + barrido en la SED, toma de carga por llave BT, revisión de acometidas y medidores con consumo bajo."
    });
  H.sort((a, b) => (b.mwh || 0) - (a.mwh || 0));
  /* ---- tramos (grafo de Gabriel) ---- */
  const T = [];
  if (!t.sinCoord)
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i],
          b = rows[j],
          dij = hav(a.lat, a.lon, b.lat, b.lon);
        if (dij > p.R * 1.2 && i > 0) continue;
        let gab = true;
        for (let k = 0; k < rows.length; k++) {
          if (k === i || k === j) continue;
          const c = rows[k];
          if (hav(a.lat, a.lon, c.lat, c.lon) ** 2 + hav(b.lat, b.lon, c.lat, c.lon) ** 2 < dij * dij) {
            gab = false;
            break;
          }
        }
        if (!gab && i > 0) continue;
        const ha = a.exc,
          hb = b.exc,
          known = [ha, hb].filter(ok);
        T.push({
          a: a.sed,
          b: b.sed,
          d: dij,
          ha,
          hb,
          mwh: known.length ? (Math.max(0, ha || 0) + Math.max(0, hb || 0)) / 2 : null,
          parcial: known.length < 2,
          latlngs: [
            [a.lat, a.lon],
            [b.lat, b.lon]
          ]
        });
      }
  T.sort((x, y) => (y.mwh || 0) - (x.mwh || 0));
  const DM = rows.map(a => rows.map(b => (t.sinCoord ? 0 : hav(a.lat, a.lon, b.lat, b.lon))));
  /* ---- Monte Carlo ---- */
  const rnd = mulberry32(7),
    sims = [],
    simsT = [];
  const NS = 1000;
  for (let s = 0; s < NS; s++) {
    const sup = 0.05 + rnd() * 0.15,
      ptp = 0.025 + rnd() * 0.02;
    let tot = 0,
      tT = null;
    rows.forEach((r, i) => {
      let Dd, Ff;
      if (!r.medida) return; // el intervalo del nodo usa solo SED medidas (igual que el total)
      if (r.medida) {
        Dd = r.distU * (1 + 0.0075 * gauss(rnd));
        Ff = r.fv * (1 + 0.005 * gauss(rnd));
      } else if (ok(r.fv)) {
        Ff = r.fv * (r.estFact ? Math.exp(0.3 * gauss(rnd)) : 1 + 0.005 * gauss(rnd));
        Dd = Ff / (1 - sup);
      } else return;
      const v = Dd - Ff - ptp * Dd;
      tot += v;
      if (i === 0 && r.medida) tT = v;
    });
    sims.push(tot);
    if (tT !== null) simsT.push(tT);
  }
  R.mc = {
    nodeP5: quant(sims, 0.05),
    nodeP95: quant(sims, 0.95),
    tP5: simsT.length ? quant(simsT, 0.05) : null,
    tP95: simsT.length ? quant(simsT, 0.95) : null,
    pPos: simsT.length ? simsT.filter(x => x > 0).length / simsT.length : null
  };
  Object.assign(R, {T, H, DM});
  return R;
}
