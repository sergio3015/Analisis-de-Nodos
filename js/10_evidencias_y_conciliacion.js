/* ============================================================================================================
 * ARCHIVO 10 · EVIDENCIAS, PARES DE SED Y CONCILIACIÓN DEL NODO (Método 4)
 *   - EXPERT / PRIOR: evidencias E1..E20 de la red bayesiana y sus razones de verosimilitud.
 *   - rowFor(): arma la fila de cada SED del nodo (medida o estimada si no tiene balance).
 *   - quantReg(): regresión cuantil = pérdida esperada según energía y clientes (Método 3).
 *   - mirrorPair(), cliMig(): señales de error de cadena (pérdidas en espejo y migración de clientes).
 *   - pairStatic(), pairEv(): probabilidad de que un par de SED tenga error de cadena (Bayes).
 *   - reconcile(): reparte la energía mal asignada con búsqueda voraz + temple simulado +
 *     ascensión de colinas (Russell & Norvig, cap. 4). La pérdida total del nodo no cambia.
 * ========================================================================================================== */
"use strict";

/**
 * Evidencias de la red bayesiana ingenua: [id, nombre, [[LR+, LR−] para hurto, medición y cadena]].
 * LR+ > 1 = la evidencia hace más probable la hipótesis; LR− < 1 = su ausencia la hace menos probable.
 */
// prettier-ignore
const EXPERT = [
  // id, nombre de la evidencia, [LR+, LR−] hurto, [LR+, LR−] medición, [LR+, LR−] cadena
  ["E1", "Pérdida alta", [[3, .35], [1.8, .8], [1.2, .9]]],
  ["E2", "Alta frente a su alimentador", [[2, .9], [1.5, .95], [1, 1]]],
  ["E3", "Más pérdida que sus aledaños", [[2, .85], [1.5, .95], [1.5, .9]]],
  ["E4", "Conglomerado de pérdida (zona)", [[3, .92], [.7, 1.03], [.6, 1.03]]],
  ["E5", "Pérdida no explicada por sus clientes (k-NN)", [[2.5, .85], [1.2, .97], [1, 1]]],
  ["E6", "Consumo por cliente bajo", [[2, .92], [1.2, .97], [1.3, .97]]],
  ["E7", "Anomalía Isolation Forest", [[2, .9], [2, .9], [1, 1]]],
  ["E8", "Energía mayor que la capacidad del trafo", [[1.2, .98], [6, .7], [1, 1]]],
  ["E9", "Meses negativos o atípicos", [[1, 1], [3, .9], [1.5, .97]]],
  ["E10", "Pérdida en aumento (tendencia)", [[2.5, .95], [1.2, .99], [1.2, .99]]],
  ["E11", "Salto brusco en un mes (Kalman)", [[1.5, .97], [2, .93], [2, .93]]],
  ["E12", "Cambio brusco de clientes (posible migración)", [[1, 1], [1.3, .97], [3, .9]]],
  ["E13", "Aledaño que factura de más o pierde menos de lo normal", [[.85, 1.02], [1, 1], [3, .9]]],
  ["E14", "Pérdidas en espejo con un aledaño", [[.8, 1.02], [1.2, .98], [5, .85]]],
  ["E15", "Consumo por cliente invertido", [[1, 1], [1, 1], [3, .9]]],
  ["E16", "Energía que podría estar mal asignada (iteración)", [[.9, 1.02], [1, 1], [3, .8]]],
  ["E17", "Aledaño sin balance muy cercano", [[.9, 1], [1, 1], [2, .9]]],
  ["E18", "El nodo compensa (índice)", [[.7, 1.05], [1, 1], [4, .8]]],
  ["E19", "Migración de clientes con un aledaño", [[1, 1], [1, 1], [5, .85]]],
  ["E20", "Historial de corrección de cadena", [[1, 1], [1, 1], [3, .95]]]
];

/**
 * Probabilidades iniciales (a priori) de las hipótesis: hurto 30 %, error de medición 8 %, error de cadena 10 %.
 */
const PRIOR = [0.3, 0.08, 0.1];

/**
 * Arma la fila de una SED dentro del nodo (rol Objetivo o Aledaña, distancia d, probabilidad).
 * Si tiene balance usa sus datos medidos; si no, la estima: facturación = clientes de la guía × kWh por cliente de su
 * alimentador y distribuida = facturación ÷ 0,9. Calcula pérdida, % de pérdida, PT y PNT.
 */
function rowFor(g, rol, d, prob, p) {
  const s = DB.S.get(g.sed),
    r = {sed: g.sed, rol, d, prob, alim: g.alim, cliRef: g.cli, kva: g.kva, lat: g.lat, lon: g.lon, g};
  if (s && ok(s.pct)) {
    Object.assign(r, {
      s,
      dist: s.dist,
      factBal: s.factBal,
      reg: s.reg,
      regSrc: s.regSrc,
      alp: s.alp,
      fv: s.fv,
      desv: s.desv,
      util: s.util,
      cli: s.cli,
      kwhcli: s.kwhcli,
      qc: s.qc,
      series: s.series,
      zG: s.zG,
      excKnn: s.excKnn,
      slope: s.slope,
      hasMaestro: s.hasMaestro,
      cad: s.cad,
      dif: s.dif,
      cmN: s.cmN
    });
    r.medida = true; // con balance siempre se usa el dato medido (si es dudoso queda marcado en Calidad)
  } else {
    const a = DB.AL[g.alim],
      k = a && a.medK > 0 ? a.medK : DB.medKG;
    r.fv = g.cli > 0 ? (g.cli * k) / 1000 : null;
    r.reg = null;
    r.alp = 0;
    r.cli = g.cli;
    r.regSrc = "Estimado (clientes guía × kWh/cliente del alimentador)";
    r.estFact = true;
    r.hasMaestro = false;
    r.qc = "Sin balance";
    r.medida = false;
    r.dist = null;
    r.factBal = null;
    r.kwhcli = r.cli > 0 && r.fv !== null ? (r.fv * 1000) / r.cli : null;
  }
  if (r.medida) r.distU = r.dist;
  else r.distU = ok(r.fv) ? r.fv / (1 - p.SUP) : null;
  if (r.distU !== null) {
    r.perd = r.distU - r.fv;
    r.pct = r.distU > 0 ? r.perd / r.distU : 0;
    r.pt = p.PT * r.distU;
    r.pnt = r.perd - r.pt;
    r.pntcli = r.cli > 0 ? (r.pnt * 1000) / r.cli : null;
  }
  return r;
}

/**
 * Colores de las iteraciones en el mapa y en el gráfico.
 */
const ITC = ["#d32f2f", "#1e63c8", "#8e0000", "#2e7d32", "#6a1b9a", "#ef6c00", "#00838f", "#ad1457"];

/**
 * Clases de criticidad IA.
 */
const CLS = ["Crítica", "Alta", "Media", "Baja", "Validar medición"];

/**
 * Color de cada clase de criticidad (también se usa en el mapa).
 */
const CCOL = {
  Crítica: "#d50000",
  Alta: "#fb8c00",
  Media: "#fdd835",
  Baja: "#43a047",
  "Validar medición": "#7b1fa2",
  "Sin balance": "#9e9e9e"
};

/**
 * MÉTODO 3 · Regresión cuantil (τ = 0,25) por mínimos cuadrados reponderados:
 *   pérdida esperada = a × E. Distribuida + b × clientes.
 * Usar el cuantil 25 % (y no el promedio) hace que la referencia sea una SED "sana", no una con hurto.
 */
function quantReg(D, C, Lo, tau) {
  // regresión cuantil por mínimos cuadrados reponderados: pérdida = a·E.distribuida + b·clientes
  let a = 0.08,
    b = 0.02;
  for (let it = 0; it < 120; it++) {
    let s11 = 0,
      s12 = 0,
      s22 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < D.length; i++) {
      const r = Lo[i] - a * D[i] - b * C[i],
        w = (r >= 0 ? tau : 1 - tau) / Math.max(Math.abs(r), 0.05);
      s11 += w * D[i] * D[i];
      s12 += w * D[i] * C[i];
      s22 += w * C[i] * C[i];
      y1 += w * D[i] * Lo[i];
      y2 += w * C[i] * Lo[i];
    }
    const det = s11 * s22 - s12 * s12;
    if (Math.abs(det) < 1e-12) break;
    const na = (y1 * s22 - y2 * s12) / det,
      nb = (s11 * y2 - s12 * y1) / det;
    if (Math.abs(na - a) < 1e-7 && Math.abs(nb - b) < 1e-7) {
      a = na;
      b = nb;
      break;
    }
    a = na;
    b = nb;
  }
  return {a, b};
}

/**
 * Pérdidas en espejo entre dos SED: si cuando la pérdida de una sube la de la otra baja (correlación ≤ −0,6) y la suma
 * queda estable, es la firma de clientes registrados en la SED equivocada.
 */
function mirrorPair(a, b) {
  // pérdidas en espejo: cuando una sube la otra baja y la suma queda estable
  const A = a.series || [],
    B = b.series || [];
  const pr = A.map((x, i) => (x && B[i] ? [x.l, B[i].l] : null)).filter(Boolean);
  if (pr.length < 2) return null;
  const la = pr.map(x => x[0]),
    lb = pr.map(x => x[1]),
    sA = sd(la),
    sB = sd(lb),
    sS = sd(pr.map(x => x[0] + x[1]));
  const rr = pr.length >= 3 ? pearson(la, lb) : null,
    d1 = la[la.length - 1] - la[0],
    d2 = lb[lb.length - 1] - lb[0];
  const esp =
    pr.length >= 3
      ? rr !== null && rr <= -0.6 && sS < 0.7 * Math.max(sA, sB)
      : d1 * d2 < 0 && Math.abs(d1 + d2) < 0.5 * Math.max(Math.abs(d1), Math.abs(d2)) && Math.min(Math.abs(d1), Math.abs(d2)) > 0.5;
  return {n: pr.length, rr, sA, sB, sS, esp};
}

/**
 * Migración de clientes entre dos SED: busca el mes en que una pierde clientes y la otra gana una cantidad parecida
 * (≥ 5 clientes, ≥ 8 % de la SED más chica, y tamaños parecidos). Ej.: una pasa de 50 a 30 y la otra gana 20.
 * Devuelve {lab: mes, da: cambio en a, db: cambio en b} o null.
 */
function cliMig(a, b) {
  // migración de clientes: el mismo mes una SED pierde clientes y la otra gana una cantidad parecida
  const A = a.s && a.s.cliS,
    B = b.s && b.s.cliS;
  if (!A || !B) return null;
  let best = null;
  for (let i = 1; i < A.length; i++) {
    if (![A[i], A[i - 1], B[i], B[i - 1]].every(ok)) continue;
    const da = A[i] - A[i - 1],
      db = B[i] - B[i - 1];
    if (da * db >= 0) continue;
    const m = Math.min(Math.abs(da), Math.abs(db)),
      M = Math.max(Math.abs(da), Math.abs(db));
    if (m < Math.max(5, 0.08 * Math.min(A[i - 1], B[i - 1])) || m < 0.6 * M) continue; // cambio relevante (≥ 5 clientes y ≥ 8 % de la SED más chica) y de tamaño parecido en ambas
    if (!best || m > best.n) best = {i, k: DB.ks[i], lab: mlab(DB.ks[i]), n: m, da, db};
  }
  return best;
}

/**
 * Evidencias de un par (i factura de más, j pierde de más) que no dependen de cuánto se traslade:
 * factura más de lo que recibe, espejo mensual, migración de clientes, distancia y kWh por cliente.
 * Cada evidencia tiene una razón de verosimilitud (LR).
 */
function pairStatic(i, j, p) {
  // evidencia del par que no depende de cuánto se traslade
  const d = ok(i.lat) && ok(j.lat) ? hav(i.lat, i.lon, j.lat, j.lon) : p.R,
    wd = clamp(1 - Math.max(0, d - 150) / (1.2 * p.R), 0.25, 1),
    L = [];
  L.push(
    i.fv > i.dist
      ? [`${i.sed} factura más energía de la que recibe`, 4]
      : [`${i.sed} pierde menos de lo esperado para su energía y clientes`, 1.5]
  );
  const m = mirrorPair(i, j);
  if (m) L.push(m.esp ? ["pérdidas en espejo mes a mes", m.n >= 3 ? 4 : 2] : ["sin espejo mensual", 0.85]);
  const mg = cliMig(i, j);
  if (mg)
    L.push(
      mg.da > 0
        ? [`migración de clientes en ${mg.lab}: ${i.sed} +${fmt(mg.da, 0)}, ${j.sed} ${fmt(mg.db, 0)}`, 5]
        : [`cambio de clientes en espejo en ${mg.lab} (${i.sed} ${fmt(mg.da, 0)}, ${j.sed} +${fmt(mg.db, 0)})`, 1.5]
    );
  L.push([`distancia ${fmt(d, 0)} m`, d <= 150 ? 1.8 : d <= 300 ? 1.2 : d <= 450 ? 0.9 : 0.6]);
  if (ok(i.kwhcli) && ok(j.kwhcli) && j.kwhcli > 0) {
    const q = i.kwhcli / j.kwhcli;
    L.push([`kWh por cliente de ${i.sed} = ${fmt(q, 2)} × el de ${j.sed}`, q > 1.4 ? 2 : q < 0.8 ? 0.8 : 1]);
  }
  return {d, wd, L, mir: m, mig: mg};
}

/**
 * Probabilidad de error de cadena del par (red bayesiana ingenua): parte de 10 % y multiplica las razones de verosimilitud.
 * Agrega la cobertura (cuánto de la pérdida de j explica lo que i factura de más).
 * Devuelve pCad, la energía máxima trasladable (xMax) y la explicación de cada evidencia (lrs).
 */
function pairEv(i, j, ri, rj, p, st) {
  // i factura de más (podría tener clientes de j); j pierde de más
  st = st || pairStatic(i, j, p);
  const t0 = Math.min(-ri, rj);
  const lrs = [
    st.L[0],
    t0 >= 0.3 * rj
      ? [`lo que ${i.sed} factura de más cubre ${pctf(t0 / rj, 0)} de la pérdida de ${j.sed}`, 2.5]
      : [`solo cubre ${pctf(t0 / rj, 0)} de la pérdida de ${j.sed}`, 0.8],
    ...st.L.slice(1)
  ];
  let lo = Math.log(0.1 / 0.9);
  lrs.forEach(([, v]) => (lo += Math.log(v)));
  const pCad = sigm(lo);
  return {i, j, d: st.d, wd: st.wd, t0, xMax: t0 * st.wd, pCad, t: t0 * st.wd * pCad, lrs, mir: st.mir, mig: st.mig, st};
}
/* Conciliación del nodo (Russell & Norvig cap. 4: búsqueda local).
   Variables: x = energía de clientes de j facturada en i (traslado por error de cadena), 0 ≤ x ≤ máximo compensable.
   Función objetivo J = Σ φ(residuo) + Σ costo(x):  φ(r) = r² si r < 0 (SED que factura más de lo esperado, imposible sin explicación), 0,05·r² si r > 0 (puede ser hurto);
   costo(x) = ((1 − P) / P) · x² / máximo: trasladar energía con poca probabilidad de cadena cuesta caro.
   1) inicio voraz (el par más probable primero) → 2) temple simulado → 3) ascensión de colinas por coordenadas (cada traslado se ajusta exacto). La pérdida total del nodo no cambia. */
function reconcile(set, p, opt = {}) {
  const r0 = opt.r0 || new Map(set.map(r => [r, r.r0])),
    C = [],
    cache = opt.cache || new Map();
  for (const i of set)
    for (const j of set) {
      if (i === j) continue;
      const ri = r0.get(i),
        rj = r0.get(j);
      if (!(ri < -0.05 && rj > 0.05)) continue;
      if (ok(i.lat) && ok(j.lat) && hav(i.lat, i.lon, j.lat, j.lon) > 1.2 * p.R) continue;
      const key = i.sed + ">" + j.sed;
      let st = cache.get(key);
      if (!st) {
        st = pairStatic(i, j, p);
        cache.set(key, st);
      }
      const e = pairEv(i, j, ri, rj, p, st);
      if (e.xMax < 0.05) continue;
      C.push(e);
    }
  const idx = new Map(set.map((r, n) => [r, n])),
    RS = set.map(r => r0.get(r)),
    I = C.map(c => idx.get(c.i)),
    Jj = C.map(c => idx.get(c.j)),
    x = new Float64Array(C.length),
    XM = C.map(c => c.xMax);
  const pen = C.map(c => (1 - c.pCad) / Math.max(c.pCad, 1e-3) / Math.max(c.xMax, 0.5)),
    nS = RS.length,
    nC = C.length;
  const J = () => {
    let s = 0;
    for (let n = 0; n < nS; n++) {
      const v = RS[n];
      s += v < 0 ? v * v : 0.05 * v * v;
    }
    for (let k = 0; k < nC; k++) s += pen[k] * x[k] * x[k];
    return s;
  };
  const setX = (k, v) => {
    const dx = v - x[k];
    if (!dx) return;
    x[k] = v;
    RS[I[k]] += dx;
    RS[Jj[k]] -= dx;
  };
  C.map((c, k) => k)
    .sort((a, b) => C[b].t - C[a].t)
    .forEach(k => setX(k, Math.max(0, Math.min(C[k].t, -RS[I[k]], RS[Jj[k]]))));
  let nSA = 0;
  if (nC && !opt.noSA && !opt.lite) {
    const rnd = mulberry32(11 + nS),
      N = 800 * nC;
    let cur = J();
    const T0 = Math.max(0.02, 0.2 * cur); // temple simulado
    for (let n = 0; n < N; n++) {
      const T = T0 * Math.pow(0.001, n / N),
        k = Math.floor(rnd() * nC),
        old = x[k];
      setX(k, clamp(old + (rnd() - 0.5) * XM[k], 0, XM[k]));
      const nw = J();
      if (nw <= cur || rnd() < Math.exp((cur - nw) / T)) cur = nw;
      else setX(k, old);
    }
    nSA = N;
  }
  const best1 = k => {
    // mínimo exacto de J moviendo solo el traslado k (J es cuadrática por tramos)
    const A = RS[I[k]] - x[k],
      B = RS[Jj[k]] + x[k],
      P = pen[k],
      hi = XM[k],
      cuts = [0, hi];
    if (-A > 0 && -A < hi) cuts.push(-A);
    if (B > 0 && B < hi) cuts.push(B);
    cuts.sort((u, v) => u - v);
    const f = v => {
      const ri = A + v,
        rj = B - v;
      return (ri < 0 ? 1 : 0.05) * ri * ri + (rj < 0 ? 1 : 0.05) * rj * rj + P * v * v;
    };
    let bx = 0,
      bf = Infinity;
    for (let q = 0; q < cuts.length - 1; q++) {
      const lo = cuts[q],
        up = cuts[q + 1],
        mid = (lo + up) / 2,
        wi = A + mid < 0 ? 1 : 0.05,
        wj = B - mid < 0 ? 1 : 0.05;
      const v = clamp((wj * B - wi * A) / (wi + wj + P), lo, up);
      for (const c of [v, lo, up]) {
        const fv = f(c);
        if (fv < bf) {
          bf = fv;
          bx = c;
        }
      }
    }
    return bx;
  };
  let sweeps = 0; // ascensión de colinas por coordenadas (J es convexa: converge al mismo óptimo)
  for (; sweeps < 80 && nC; sweeps++) {
    let mv = 0;
    for (let k = 0; k < nC; k++) {
      const old = x[k];
      setX(k, best1(k));
      mv = Math.max(mv, Math.abs(x[k] - old));
    }
    if (mv < 1e-5) break;
  }
  const res = new Map(set.map((r, n) => [r, RS[n]]));
  const adj = new Map(set.map(r => [r, 0]));
  C.forEach((c, k) => {
    adj.set(c.i, adj.get(c.i) + x[k]);
    adj.set(c.j, adj.get(c.j) - x[k]);
  });
  const tr = C.map((c, k) => ({...c, t: x[k]}))
    .filter(c => c.t >= 0.05)
    .sort((a, b) => b.t - a.t)
    .map((c, n) => ({...c, paso: n + 1}));
  return {tr, res, adj, J: J(), nPares: C.length, nSA, sweeps};
}
