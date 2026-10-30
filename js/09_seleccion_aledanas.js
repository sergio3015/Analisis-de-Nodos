/* ============================================================================================================
 * ARCHIVO 09 · SELECCIÓN DE SED ALEDAÑAS CON GIS (Método 2)
 * neighbours() busca las SED cercanas a la SED analizada usando las coordenadas de la GUIA:
 *   - distancia real (haversine) con un índice espacial por celdas de ~1 km (rápido),
 *   - grafo de Gabriel ("aledaño directo": no hay otra SED en medio),
 *   - áreas de servicio que se tocan (radio de red BT estimado con los clientes),
 *   - mismo alimentador / distrito y si tiene balance,
 *   - regresión logística que da P(aledaña) y el radio adaptativo (nunca analiza una SED sola).
 * ========================================================================================================== */
"use strict";

/**
 * Radio aproximado (m) de la red BT de una SED según sus clientes: área = clientes × 250 m² (entre 40 y 300 m).
 */
const srvR = cli => clamp(Math.sqrt((Math.max(1, cli || 0) * FIJOS.AREA) / Math.PI), 40, 300); // área de servicio ≈ clientes × 250 m² por lote

/**
 * MÉTODO 2 · Selecciona las SED aledañas de una SED con el GIS:
 *   1) busca SED dentro de RMAX con un índice espacial (celdas de ~1 km),
 *   2) para cada candidata calcula: grafo de Gabriel (aledaño directo), áreas de servicio que se tocan,
 *      mismo alimentador / distrito, si tiene balance y si tiene clientes,
 *   3) P(aledaña) = sigmoide(2 − d/λ + 1,5·directo + 1·mismo alim + 0,3·mismo distrito + 1·balance + 1·se tocan − 2,5·sin clientes),
 *   4) acepta las de mayor probabilidad dentro del radio R (máximo N),
 *   5) si hay menos de MINB con balance, amplía el radio hasta RMAX; nunca deja una SED sola.
 * Devuelve {t: SED objetivo, cand: candidatas con su criterio, Rused: radio usado}.
 */
function neighbours(sed, p) {
  const t = DB.G.get(sed);
  if (!t) {
    if (!DB.S.has(sed)) return null;
    return {t: {sed, alim: "", kva: 0, cli: 0, dist: "", prov: "", tipo: "", lat: null, lon: null, sinCoord: true}, cand: [], Rused: p.R};
  }
  const RM = Math.max(p.R, p.RMAX),
    box = (2.4 * RM) / 111000,
    near = [];
  const ci = Math.floor(t.lat / 0.01),
    cj = Math.floor(t.lon / 0.01),
    span = Math.ceil(RM / 1000) + 1; // índice espacial en celdas de ~1 km
  for (let i = ci - span; i <= ci + span; i++)
    for (let j = cj - span; j <= cj + span; j++)
      for (const g of DB.GRID.get(i + "," + j) || []) {
        if (g.sed === sed || Math.abs(g.lat - t.lat) > box || Math.abs(g.lon - t.lon) > box) continue;
        const d = hav(t.lat, t.lon, g.lat, g.lon);
        if (d <= RM) near.push({g, d});
      }
  near.sort((a, b) => a.d - b.d);
  const cand = near.filter(x => x.d <= RM);
  const st = DB.S.get(sed),
    rsT = srvR(st ? st.cli : t.cli); // radio de servicio estimado de la red BT (GIS)
  for (const c of cand) {
    let gab = true;
    for (const k of near) {
      if (k.d >= c.d) break;
      const dck = hav(c.g.lat, c.g.lon, k.g.lat, k.g.lon);
      if (k.d * k.d + dck * dck < c.d * c.d) {
        gab = false;
        break;
      }
    } // grafo de Gabriel
    const s = DB.S.get(c.g.sed);
    const rsC = srvR(s ? s.cli : c.g.cli);
    Object.assign(c, {
      gab,
      rsC,
      inR: c.d <= p.R,
      sameA: !!c.g.alim && c.g.alim === t.alim,
      sameD: !!c.g.dist && c.g.dist === t.dist,
      hasBal: !!(s && ok(s.pct)),
      touch: c.d <= rsT + rsC + 30
    });
    c.logit =
      2.0 - c.d / p.L + 1.5 * c.gab + 1.0 * c.sameA + 0.3 * c.sameD + 1.0 * c.hasBal + 1.0 * c.touch - (c.g.cli > 0 || c.hasBal ? 0 : 2.5);
    c.prob = sigm(c.logit);
  }
  cand.sort((a, b) => b.prob - a.prob);
  // 1) criterio normal: dentro del radio R y con probabilidad suficiente
  let k = 0,
    Ru = p.R;
  cand.forEach(c => {
    c.sel = c.inR && c.prob >= p.Pmin && k < p.N;
    c.crit = c.sel ? "probabilidad" : "";
    if (c.sel) k++;
  });
  // 2) radio adaptativo: el nodo debe tener al menos MINB aledaños con balance (k vecinos más cercanos con medición)
  let nb = cand.filter(c => c.sel && c.hasBal).length;
  for (const c of cand.filter(c => !c.sel && c.hasBal).sort((a, b) => a.d - b.d)) {
    if (nb >= p.MINB) break;
    c.sel = true;
    c.forz = true;
    c.crit = "radio ampliado (tiene balance)";
    nb++;
  }
  // 3) nunca analizar una SED sola: si no hay aledaños, tomar los dos más cercanos con clientes
  if (!cand.some(c => c.sel))
    cand
      .filter(c => c.g.cli > 0)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .forEach(c => {
        c.sel = true;
        c.forz = true;
        c.crit = "más cercano (sin balance)";
      });
  cand
    .filter(c => c.sel)
    .forEach(c => {
      Ru = Math.max(Ru, c.d);
    });
  return {t, rsT, cand: cand.filter(c => c.inR || c.sel).sort((a, b) => b.sel - a.sel || a.d - b.d), Rused: Ru};
}
