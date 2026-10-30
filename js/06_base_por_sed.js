/* ============================================================================================================
 * ARCHIVO 06 · CONSTRUCCIÓN DE LA BASE POR SED (función build)
 * Es el cálculo inicial que corre al pulsar Ejecutar (o al cambiar el rango de meses). Para cada SED del Balance:
 *   - ERROR EN FACTOR: si un mes de E. Distribuida pasa de 500 MWh, se divide entre el FACTOR del medidor.
 *   - PROMEDIO: E. Distribuida y E. Facturada = promedio de los meses del rango que TIENEN valor
 *     (vacío/NULL y cero no cuentan). Ej.: Jul NULL, Ago 0, Set 60.07 → 60.07.
 *   - Pérdida Validación = E. Distribuida − E. Facturada; PT = 3,4 %; PNT = Pérdida − PT; Desv. Fact.
 *   - Clientes de cada mes (CANT CLIENTES TOTALES) y cambio brusco de clientes (posible migración).
 *   - Calidad del dato (Fact > Dist, más energía que la capacidad del trafo) y filtro de Kalman.
 * Después, con todas las SED: k vecinos (k-NN), Isolation Forest, regresión cuantil y la priorización.
 * ========================================================================================================== */
"use strict";

/**
 * Promedio de una serie mensual con la regla pedida:
 *   - solo cuentan los meses que TIENEN valor (vacío/NULL y cero no cuentan; un negativo no es energía válida),
 *   - un mes con más energía que la capacidad del trafo (cap) SÍ se promedia, pero queda marcado (flags.out = dato dudoso).
 * Devuelve {used: meses usados, flags, mean: promedio}. Con RANGE.modo = "todos" divide entre todos los meses del rango.
 */
function cleanSeries(vals, p, cap) {
  const flags = {neg: [], zero: [], out: []},
    used = [];
  // Regla del promedio: solo se promedian los meses que TIENEN valor (vacío/NULL y cero no cuentan; un negativo no es energía válida).
  // Ej.: Jul NULL, Ago 0, Set 60.07 → promedio 60.07 · Jul 50, Ago vacío, Set 70 → (50 + 70) / 2 = 60.
  // Un mes con más energía que la capacidad del trafo SÍ se promedia, pero queda marcado como dato dudoso (flags.out).
  vals.forEach((v, i) => {
    if (!ok(v) || v === 0) {
      flags.zero.push(i);
      return;
    }
    if (v < 0) {
      flags.neg.push(i);
      return;
    }
    used.push(i);
    if (cap && v > cap) flags.out.push(i);
  });
  const tot = used.reduce((a, i) => a + vals[i], 0),
    n = RANGE.modo === "todos" ? vals.length : used.length;
  return {used, flags, mean: used.length ? tot / n : null};
}

/**
 * Filtro de Kalman 1D sobre el % de pérdida mensual: estima el nivel "real" y detecta el mes con el salto
 * más brusco (en desviaciones estándar). Sirve para ver si la pérdida cambió de golpe.
 */
function kalman(obs) {
  // filtro de Kalman 1D (paseo aleatorio) sobre el % de pérdida mensual
  let x = null,
    Pv = 0,
    maxInn = 0,
    jump = null;
  const q = 0.03 ** 2,
    r = 0.05 ** 2;
  obs.forEach(o => {
    if (x === null) {
      if (o !== null) {
        x = o.pc;
        Pv = r;
      }
      return;
    }
    Pv += q;
    if (o === null) return;
    const S = Pv + r,
      K = Pv / S,
      nu = o.pc - x,
      z = Math.abs(nu) / Math.sqrt(S);
    if (z > maxInn) {
      maxInn = z;
      jump = o.lab;
    }
    x += K * nu;
    Pv *= 1 - K;
  });
  return {x, sdx: Math.sqrt(Pv), maxInn, jump};
}

/**
 * Valores del campo f ("d" distribuida o "f" facturada) de una SED para los meses ks (respeta si se incluye OBS).
 */
const balVals = (b, ks, f) =>
  ks.map(k => {
    const x = b ? b.m.get(k) : null;
    if (!x || (x.obs && !RANGE.obs)) return null;
    return x[f];
  });

/**
 * Valores mensuales de un Map para los meses ks.
 */
const mapVals = (g, ks) => ks.map(k => (g && g.m.has(k) ? g.m.get(k) : null));

/**
 * Construye toda la base de cálculo (se ejecuta al abrir, al pulsar Ejecutar o al cambiar el rango):
 *   1) Por cada SED: limpia series, promedia, calcula pérdida, PT, PNT, Desv. Fact., clientes por mes,
 *      cambio brusco de clientes, utilización del trafo, calidad del dato y filtro de Kalman.
 *   2) Estadística por alimentador (z-scores), k vecinos más cercanos (pérdida esperada por SED parecidas)
 *      e Isolation Forest (anomalías).
 *   3) Índice espacial de la GUIA, regresión cuantil de pérdida esperada (DB.QR).
 *   4) Analiza en modo rápido todas las SED con coordenadas (DB.LITE) y calcula la criticidad IA.
 *   5) Dibuja la priorización y el Cuadro 1.
 */
function build() {
  const p = P();
  const G = new Map();
  RAW.guia.forEach(g => {
    if (!/RETIRAD/i.test(g.estado) && !G.has(g.sed)) G.set(g.sed, g);
  });
  DB = {G, p};
  const ks = inRange();
  DB.ks = ks;
  DB.common = ks.map(k => ({k, lab: mlab(k)}));
  const S = new Map();
  // 1) RECORRE CADA SED DEL BALANCE y calcula sus promedios del rango.
  for (const [sed, b] of RAW.bal) {
    const g = G.get(sed),
      dv = balVals(b, ks, "d"),
      fv0 = balVals(b, ks, "f");
    // ERROR EN FACTOR: una E. Distribuida mensual mayor de 500 MWh viene multiplicada por el FACTOR del medidor → se divide entre el FACTOR
    // (ej. 02215A Set-26: 8,410.08 ÷ 140 = 60.07). Se corrige mes a mes antes de promediar y la SED queda marcada.
    const fac = num((b.meta || {}).factor),
      fixF = [];
    dv.forEach((v, i) => {
      if (ok(v) && v > 500 && fac > 1) {
        fixF.push({lab: mlab(ks[i]), raw: v, fix: v / fac});
        dv[i] = v / fac;
      }
    });
    if (!dv.some(ok) && !fv0.some(ok)) continue;
    const kv0 = b.kva || (g ? g.kva : 0),
      cap = kv0 > 0 ? kv0 * 0.744 * 1.5 : null; // imposible: más de 150 % de la capacidad del trafo en el mes
    const dc = cleanSeries(dv, p, cap),
      fc = cleanSeries(fv0, p, cap);
    // Promedios del rango. E. Fact. Balance = E. FACTURADA AJUSTADA MES; cliS = clientes de cada mes (CANT CLIENTES TOTALES).
    const dist = dc.mean,
      factBal = fc.mean,
      fv = factBal;
    const cliS = ks.map(k => {
        const x = b.m.get(k);
        return x && !(x.obs && !RANGE.obs) && ok(x.c) && x.c > 0 ? x.c : null;
      }),
      cliL = cliS.filter(ok);
    const cli = (cliL.length ? cliL[cliL.length - 1] : 0) || b.cli || (g ? g.cli : 0) || 0,
      kva = b.kva || (g ? g.kva : 0);
    const s = {
      sed,
      g,
      crit: b.crit || "",
      meta: b.meta || {},
      dist,
      factBal,
      reg: null,
      alp: 0,
      fv,
      cli,
      cliS,
      kva,
      cad: b.cad,
      cadK: b.cadK || [],
      dif: 0,
      cmN: 0,
      hasMaestro: false,
      nD: dc.used.length,
      nF: fc.used.length,
      dFlags: dc.flags,
      fFlags: fc.flags,
      errFactor: fixF.length ? {factor: fac, months: fixF} : null
    };
    if (dist !== null && fv !== null) {
      // Pérdida Validación = E. Distribuida − E. Facturada · PT = 3,4 % de la distribuida · PNT = Pérdida − PT.
      s.perd = dist - fv;
      s.pct = dist > 0 ? s.perd / dist : null;
      s.pt = p.PT * dist;
      s.pnt = s.perd - s.pt;
    }
    {
      const fu = fc.used.map(i => fv0[i]),
        m = Math.min(3, Math.floor(fu.length / 2)); // Desv. Fact.: variación de la E. Facturada dentro del rango (últimos meses vs primeros meses)
      s.desv = m >= 1 && mean(fu.slice(0, m)) > 0 ? (mean(fu.slice(-m)) - mean(fu.slice(0, m))) / mean(fu.slice(0, m)) : null;
    }
    {
      let best = null; // cambio brusco de clientes entre dos meses seguidos (posible migración de clientes)
      for (let i = 1; i < ks.length; i++) {
        const c0 = cliS[i - 1],
          c1 = cliS[i];
        if (!ok(c0) || !ok(c1)) continue;
        const dl = c1 - c0,
          rel = dl / Math.max(c0, 1);
        if (Math.abs(dl) < 5 || Math.abs(rel) < 0.15) continue;
        const d0 = dv[i - 1],
          d1 = dv[i],
          dRel = ok(d0) && ok(d1) && d0 > 0 ? (d1 - d0) / d0 : null;
        const f0 = fv0[i - 1],
          f1 = fv0[i],
          fRel = ok(f0) && ok(f1) && f0 > 0 ? (f1 - f0) / f0 : null;
        if (!best || Math.abs(rel) > Math.abs(best.rel))
          best = {i, k: ks[i], lab: mlab(ks[i]), c0, c1, dl, rel, dRel, fRel, sinE: dRel === null || Math.abs(dRel) < 0.5 * Math.abs(rel)};
      }
      s.cliJ = best;
    }
    s.kwhcli = cli > 0 && fv !== null ? (fv * 1000) / cli : null;
    s.pntcli = cli > 0 && ok(s.pnt) ? (s.pnt * 1000) / cli : null;
    s.util = kva > 0 && dist !== null ? (dist * 1000) / (kva * 720) : null;
    s.nBad = dc.flags.neg.length + fc.flags.neg.length;
    s.nOut = dc.flags.out.length;
    // Calidad del dato: Fact > Dist (factura más de lo que recibe) o Utilización > 100 % (más energía que el trafo) = dato dudoso.
    s.qc =
      dist === null
        ? "Sin dato de distribuida"
        : fv === null
          ? "Sin facturación"
          : fv > dist
            ? "Fact > Dist"
            : s.util !== null && s.util > 1
              ? "Utilización >100%"
              : "OK";
    s.series = ks.map((k, i) => {
      if (!dc.used.includes(i) || !fc.used.includes(i)) return null;
      const dd = dv[i],
        ff = fv0[i];
      return {k, lab: mlab(k), d: dd, f: ff, l: dd - ff, pc: (dd - ff) / dd};
    });
    s.raw = ks.map((k, i) => ({lab: mlab(k), d: dv[i], f: fv0[i], okD: dc.used.includes(i), okF: fc.used.includes(i)}));
    const so = s.series.filter(Boolean);
    s.kal = kalman(s.series);
    if (so.length >= 2) {
      const xs = s.series.map((o, i) => (o ? i : null)).filter(i => i !== null),
        ys = so.map(o => o.pc),
        mx = mean(xs),
        my = mean(ys);
      s.slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
    } else s.slope = null;
    S.set(sed, s);
  }
  // 2) ESTADÍSTICA DE TODAS LAS SED: z-score frente a su alimentador y frente al total.
  const SV = [...S.values()].filter(s => ok(s.pct));
  const byA = {};
  SV.forEach(s => {
    const a = s.g ? s.g.alim : "(sin guía)";
    (byA[a] = byA[a] || []).push(s);
  });
  const mG = mean(SV.map(s => s.pct)),
    sG = sd(SV.map(s => s.pct)) || 1,
    AL = {};
  for (const [a, arr] of Object.entries(byA)) {
    const pc = arr.map(s => s.pct),
      kc = arr.map(s => s.kwhcli).filter(ok);
    AL[a] = {
      n: arr.length,
      mPct: mean(pc),
      sPct: sd(pc),
      mK: mean(kc),
      sK: sd(kc),
      medPnt: median(arr.map(s => (s.dist > 0 ? Math.max(0, s.pnt) / s.dist : 0))),
      medK: median(kc.filter(x => x > 0)),
      dist: arr.reduce((t, s) => t + s.dist, 0),
      fv: arr.reduce((t, s) => t + s.fv, 0),
      pnt: arr.reduce((t, s) => t + Math.max(0, s.pnt), 0)
    };
  }
  SV.forEach(s => {
    const a = AL[s.g ? s.g.alim : "(sin guía)"];
    s.zA = a.n > 2 && a.sPct > 0 ? (s.pct - a.mPct) / a.sPct : 0;
    s.zK = a.n > 2 && a.sK > 0 && ok(s.kwhcli) ? (s.kwhcli - a.mK) / a.sK : 0;
    s.zG = (s.pct - mG) / sG;
  });
  // 3) k VECINOS MÁS CERCANOS (k-NN): para cada SED busca las K SED más parecidas (clientes, kWh/cliente, kVA, utilización)
  // y toma la mediana de su % de pérdida como "pérdida esperada" (excKnn = cuánto se aleja).
  const feat = s => [
    Math.log(Math.max(1, s.cli)),
    Math.log(Math.max(1, s.kwhcli || 1)),
    Math.log(Math.max(10, s.kva || 100)),
    clamp(s.util ?? 0.5, 0, 1.5)
  ];
  const pool = SV.filter(s => s.qc === "OK" && s.cli > 0 && ok(s.kwhcli) && s.kwhcli > 0);
  const pool0 = pool,
    stp = Math.max(1, Math.floor(pool0.length / 3000));
  pool.length = 0;
  pool0.filter((s, i) => i % stp === 0).forEach(s => pool.push(s));
  if (pool.length > 5) {
    const Xp = pool.map(feat),
      mus = [0, 1, 2, 3].map(j => mean(Xp.map(x => x[j]))),
      sds = [0, 1, 2, 3].map(j => sd(Xp.map(x => x[j])) || 1);
    const z = x => x.map((v, j) => (v - mus[j]) / sds[j]),
      Zp = Xp.map(z),
      K = Math.max(3, Math.round(p.KNN));
    SV.forEach(s => {
      if (!RAW.zona.has(s.sed) || !(s.cli > 0 && ok(s.kwhcli) && s.kwhcli > 0)) {
        s.expPct = null;
        s.excKnn = null;
        return;
      }
      const zs = z(feat(s));
      const dd = []; // k vecinos más cercanos (selección parcial)
      for (let i = 0; i < Zp.length; i++) {
        if (pool[i] === s) continue;
        const zp = Zp[i];
        let e = 0;
        for (let j = 0; j < 4; j++) e += (zp[j] - zs[j]) ** 2;
        if (dd.length < K) {
          dd.push([e, i]);
          dd.sort((a, b) => a[0] - b[0]);
        } else if (e < dd[K - 1][0]) {
          dd[K - 1] = [e, i];
          dd.sort((a, b) => a[0] - b[0]);
        }
      }
      s.expPct = median(dd.map(x => pool[x[1]].pct));
      s.excKnn = s.pct - s.expPct;
    });
  }
  // 4) ISOLATION FOREST: puntaje de anomalía de cada SED (percentil isoP).
  const ids = SV.map(s => s.sed);
  const X = SV.map(s => [
    clamp(s.pct, -1, 1),
    Math.log1p(Math.max(0, s.kwhcli || 0)),
    Math.min(s.util ?? 0.5, 3),
    clamp(s.zA, -5, 5),
    clamp(s.excKnn ?? 0, -1, 1)
  ]);
  const sc = X.length > 10 ? isoForest(X, 150, Math.min(256, X.length), 42) : X.map(() => 0.5);
  const srt = [...sc].sort((a, b) => a - b);
  ids.forEach((k, i) => {
    S.get(k).isoP = srt.findIndex(v => v >= sc[i]) / Math.max(1, srt.length - 1);
  });
  // 5) ÍNDICE ESPACIAL de la GUIA (celdas de 0,01° ≈ 1 km) para buscar aledañas rápido.
  const DISTR = [...G.values()].filter(
    g => (g.cli > 0 || S.has(g.sed)) && !/^PM|^RC/.test(g.sed) && !/REGULADOR|COMPENSADOR|CLI_B/i.test(g.tipo)
  );
  const GRID = new Map();
  DISTR.forEach(g => {
    const k = Math.floor(g.lat / 0.01) + "," + Math.floor(g.lon / 0.01);
    (GRID.get(k) || GRID.set(k, []).get(k)).push(g);
  });
  DB.GRID = GRID;
  Object.assign(DB, {
    S,
    AL,
    DISTR,
    medPntG: median(SV.map(s => (s.dist > 0 ? Math.max(0, s.pnt) / s.dist : 0))),
    medKG: median(SV.map(s => s.kwhcli).filter(x => ok(x) && x > 0)),
    mG,
    sG
  });
  {
    const fit = SV.filter(s => s.qc === "OK" && s.cli > 0 && s.pct > -0.5 && s.pct < 0.95);
    DB.QR =
      fit.length > 20
        ? quantReg(
            fit.map(s => s.dist),
            fit.map(s => s.cli / 1000),
            fit.map(s => s.perd),
            p.TAU
          )
        : {a: 0.08, b: 0};
    if (!(DB.QR.a >= p.PT)) {
      DB.QR = quantReg(
        fit.map(s => s.dist),
        fit.map(s => s.cli / 1000),
        fit.map(s => s.perd - p.PT * s.dist),
        p.TAU
      );
      DB.QR.a += p.PT;
    }
    if (DB.QR.b < 0) DB.QR.b = 0;
  }
  // 6) PRIORIZACIÓN: analiza en modo rápido todas las SED con coordenadas y luego calcula la criticidad IA.
  DB.LR = null;
  DB.LITE = new Map();
  const conG = SV.filter(s => G.has(s.sed) && RAW.zona.has(s.sed)); // zona de la GUIA SED cargada, con coordenadas
  for (const s of conG) {
    const R = analyze(s.sed, p, {lite: true});
    if (R) DB.LITE.set(s.sed, R);
  }
  critIA();
  $("#chips").innerHTML =
    `<span class="chip">${G.size.toLocaleString("es-PE")} SED en guía</span><span class="chip">${S.size.toLocaleString("es-PE")} SED con balance en el rango</span><span class="chip">${mlab(RANGE.a)} a ${mlab(RANGE.b)}</span><span class="chip" style="background:#fde3e3;color:#b00000;border-color:#f3b4b4">${[...DB.LITE.values()].filter(r => r.ia && r.ia.clase === "Crítica").length} críticas (IA)</span>`;
  renderPrio();
  renderTables();
  $("#xlsAll").disabled = false;
  $("#xlsTabs").disabled = false;
}
