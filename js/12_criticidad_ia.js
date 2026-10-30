/* ============================================================================================================
 * ARCHIVO 12 · CRITICIDAD PROPIA CON INTELIGENCIA ARTIFICIAL (Método 6)
 * critIA() calcula para cada SED un puntaje de 0 a 100 que combina 6 señales:
 *   S1 % de pérdida corregido con Bayes empírico (si hay pocos meses se acerca al de su alimentador),
 *   S2 exceso real de pérdida tras la iteración, S3 exceso por cliente (percentil),
 *   S4 grupo de alta pérdida según una mezcla de gaussianas ajustada con EM (gmmEM),
 *   S5 anomalía (Isolation Forest), S6 P(hurto) × (1 − P(medición)) de la red bayesiana.
 * Clases: Crítica ≥ 62, Alta ≥ 48, Media ≥ 34, Baja; "Validar medición" si el dato es dudoso.
 * ========================================================================================================== */
"use strict";

/**
 * Mezcla de K gaussianas (diagonal) ajustada con el algoritmo EM (Expectation–Maximization).
 * Agrupa las SED en pérdida baja / media / alta sin reglas fijas. Devuelve la probabilidad de cada SED en cada grupo.
 */
function gmmEM(X, K, iters) {
  // mezcla de gaussianas (diagonal) ajustada con el algoritmo EM
  const n = X.length,
    d = X[0].length,
    srt = X.map((x, i) => [x[0], i]).sort((a, b) => a[0] - b[0]);
  let M = Array.from({length: K}, (_, k) => X[srt[Math.floor(((k + 0.5) / K) * n)][1]].slice()),
    V = Array.from({length: K}, () => Array.from({length: d}, (_, j) => sd(X.map(x => x[j])) ** 2 || 1)),
    PI = Array(K).fill(1 / K),
    Rr = [];
  for (let t = 0; t < iters; t++) {
    Rr = X.map(x => {
      const l = M.map(
        (m, k) => Math.log(PI[k]) + m.reduce((a, mj, j) => a - 0.5 * Math.log(2 * Math.PI * V[k][j]) - (x[j] - mj) ** 2 / (2 * V[k][j]), 0)
      );
      const mx = Math.max(...l),
        e = l.map(v => Math.exp(v - mx)),
        s = e.reduce((a, b) => a + b, 0);
      return e.map(v => v / s);
    });
    for (let k = 0; k < K; k++) {
      const nk = Rr.reduce((a, r) => a + r[k], 0) + 1e-9;
      PI[k] = nk / n;
      M[k] = Array.from({length: d}, (_, j) => Rr.reduce((a, r, i) => a + r[k] * X[i][j], 0) / nk);
      V[k] = Array.from({length: d}, (_, j) => Math.max(1e-3, Rr.reduce((a, r, i) => a + r[k] * (X[i][j] - M[k][j]) ** 2, 0) / nk));
    }
  }
  return {R: Rr, M, V, PI};
}

/**
 * MÉTODO 6 · Criticidad IA de todas las SED: Bayes empírico + EM + exceso real + Isolation Forest + red bayesiana.
 * Guarda en cada SED r.ia = {S1..S6, score (0–1), clase}.
 */
function critIA() {
  const L = [...DB.LITE.values()].filter(r => r.ts),
    sv = L.map(r => r.ts);
  if (!sv.length) return;
  // 1) Bayes empírico: el % de pérdida se acerca al de su alimentador si lo respaldan pocos meses
  const vars = sv
    .map(s => {
      const pcs = s.series.filter(Boolean).map(o => o.pc);
      return pcs.length >= 2 ? sd(pcs) ** 2 : null;
    })
    .filter(ok);
  const s2 = median(vars) || 0.0025,
    gm = median(sv.map(s => s.pct)),
    gv = sd(sv.map(s => s.pct)) ** 2;
  const byA = {};
  sv.forEach(s => {
    const a = s.g ? s.g.alim : "-";
    (byA[a] = byA[a] || []).push(s);
  });
  for (const arr of Object.values(byA)) {
    const m = arr.length >= 3 ? mean(arr.map(s => s.pct)) : gm,
      tau2 = arr.length >= 3 ? Math.max(0.002, sd(arr.map(s => s.pct)) ** 2 - s2 / 2) : gv;
    arr.forEach(s => {
      const n = Math.max(1, s.series.filter(Boolean).length),
        w = tau2 / (tau2 + s2 / n);
      s.pctEB = w * s.pct + (1 - w) * m;
      s.ebW = w;
    });
  }
  // 2) mezcla de gaussianas (EM) sobre % de pérdida y tamaño de la pérdida
  const X = sv.map(s => [clamp(s.pctEB, -0.5, 1), Math.log(Math.max(0.5, s.pnt + 1))]);
  const G = gmmEM(X, 3, 60),
    order = G.M.map((m, k) => [m[0] + 0.1 * m[1], k])
      .sort((a, b) => a[0] - b[0])
      .map(x => x[1]),
    hi = order[2],
    midc = order[1];
  sv.forEach((s, i) => {
    s.gmmHi = G.R[i][hi] + 0.5 * G.R[i][midc];
    s.gmmG = ["bajo", "medio", "alto"][order.indexOf(G.R[i].indexOf(Math.max(...G.R[i])))];
  });
  DB.GMM = {M: order.map(k => G.M[k]), PI: order.map(k => G.PI[k])};
  // 3) exceso real por cliente (tras iterar) en percentil
  const pcs = L.map(r => r.rows[0].excCli)
      .filter(ok)
      .sort((a, b) => a - b),
    rk = v => {
      let lo = 0,
        hi2 = pcs.length;
      while (lo < hi2) {
        const m = (lo + hi2) >> 1;
        if (pcs[m] <= v) lo = m + 1;
        else hi2 = m;
      }
      return pcs.length ? lo / pcs.length : 0.5;
    };
  // 4) ensamble ponderado
  L.forEach(r => {
    const s = r.ts,
      R0 = r.rows[0],
      ex = ok(R0.exc) ? R0.exc : ok(s.pnt) ? s.pnt : 0;
    const S1 = mu(s.pctEB, 0.1, 0.45) ?? 0,
      S2 = ex > 0 ? clamp((Math.log(ex + 1) - Math.log(1.5)) / (Math.log(31) - Math.log(1.5)), 0, 1) : 0,
      S3 = ok(R0.excCli) ? rk(R0.excCli) : 0.5,
      S4 = s.gmmHi,
      S5 = mu(s.isoP, 0.5, 0.98) ?? 0,
      S6 = (r.P1 || 0) * (1 - (r.P2 || 0));
    const score = 0.1 * S1 + 0.25 * S2 + 0.2 * S3 + 0.15 * S4 + 0.1 * S5 + 0.2 * S6;
    const vm = s.qc === "Fact > Dist" || (s.util !== null && s.util > 1.5) || r.clase === "Validar medición";
    r.ia = {
      S1,
      S2,
      S3,
      S4,
      S5,
      S6,
      score,
      ex,
      exCli: R0.excCli,
      clase: vm ? "Validar medición" : score >= 0.62 ? "Crítica" : score >= 0.48 ? "Alta" : score >= 0.34 ? "Media" : "Baja"
    };
  });
}
