/* ============================================================================================================
 * ARCHIVO 08 · APRENDIZAJE CON RESULTADOS DE CAMPO
 * Guarda resultados de inspecciones (hurto confirmado, error de medición, error de cadena) y con ellos
 * re-estima cuánto pesa cada evidencia en la red bayesiana (learnedLR). Mezcla lo aprendido con el
 * criterio experto según cuántos casos hay (suavizado de Laplace). Se guarda en el navegador (localStorage).
 * ========================================================================================================== */
"use strict";

/**
 * Resultados de campo iniciales (SED, resultado H1 hurto / H2 medición / H3 cadena, nota).
 */
const FIELD0 = [
  ["14331A", "H1", "1er envío: >25 conexiones clandestinas Causal V"],
  ["17236A", "H1", "2do envío: clandestinas, SED fuera de servicio"],
  ["17036A", "H2", "1er envío: inconsistencia de factor"],
  ["21952A", "H2", "1er envío: inconsistencia de factor"],
  ["14320A", "H1", "2do envío (preliminar): AAHH"],
  ["20813A", "H1", "2do envío (preliminar): AAHH"]
];

/**
 * Texto de cada tipo de resultado de campo.
 */
const RES_TXT = {H1: "Hurto / PNT confirmado", H2: "Error de medición", H3: "Error de cadena", NO: "Sin hallazgo"};

/**
 * Resultados de campo en uso (los iniciales o los guardados en el navegador).
 */
let FIELD = [];

/**
 * Lee los resultados de campo guardados en el navegador (o usa los iniciales).
 */
function loadField() {
  try {
    const s = JSON.parse(localStorage.getItem("nodal_campo") || "null");
    FIELD = Array.isArray(s) ? s : FIELD0.map(x => ({sed: x[0], res: x[1], nota: x[2]}));
  } catch (e) {
    FIELD = FIELD0.map(x => ({sed: x[0], res: x[1], nota: x[2]}));
  }
}

/**
 * Guarda los resultados de campo en el navegador y obliga a recalcular lo aprendido.
 */
function saveField() {
  try {
    localStorage.setItem("nodal_campo", JSON.stringify(FIELD));
  } catch (e) {}
  if (DB) DB.LR = null;
  renderLearn();
}

/**
 * Aprende de los resultados de campo cuánto pesa cada evidencia (razones de verosimilitud LR+ y LR−)
 * para cada hipótesis (hurto, medición, cadena). Usa suavizado de Laplace y mezcla con el criterio experto:
 * con pocos casos pesa más el experto; con muchos, lo aprendido.
 */
function learnedLR(p) {
  if (DB.LR) return DB.LR;
  const lab = FIELD.filter(f => DB.S.has(f.sed) && DB.G.has(f.sed))
    .map(f => ({f, R: analyze(f.sed, p, {lite: true, expert: true})}))
    .filter(x => x.R && x.R.ts);
  const LR = {};
  EXPERT.forEach(([id, , lr]) => {
    LR[id] = lr.map((pair, h) => {
      const H = ["H1", "H2", "H3"][h];
      let s1 = 0,
        n1 = 0,
        s0 = 0,
        n0 = 0;
      lab.forEach(({f, R}) => {
        const e = R.ev.find(x => x.id === id);
        if (!e || e.deg === null) return;
        if (f.res === H) {
          s1 += e.deg;
          n1++;
        } else {
          s0 += e.deg;
          n0++;
        }
      });
      const lp = (s1 + 1) / (n1 + 2) / ((s0 + 1) / (n0 + 2)),
        ln = (n1 - s1 + 1) / (n1 + 2) / ((n0 - s0 + 1) / (n0 + 2)),
        lam = (n1 + n0) / (n1 + n0 + p.N0);
      return [
        Math.exp(lam * Math.log(lp) + (1 - lam) * Math.log(pair[0])),
        Math.exp(lam * Math.log(ln) + (1 - lam) * Math.log(pair[1])),
        lam
      ];
    });
  });
  DB.LR = LR;
  DB.nLab = lab.length;
  return LR;
}

/**
 * (Desactivada) Mostraba la tabla de resultados de campo.
 */
function renderLearn() {
  return;
  const n = DB ? FIELD.filter(f => DB.S.has(f.sed)).length : 0;
  $("#learnBox").innerHTML =
    `<p class="hint">Cada resultado de campo re-estima cuánto pesa cada señal (Laplace + mezcla con el criterio experto). Se guarda en este navegador. Con los datos actuales, ${n} de ${FIELD.length} casos tienen balance y se usan para aprender.</p>
    <div class="tblwrap" style="max-height:200px"><table><thead><tr><th>SED</th><th>Resultado</th><th>Nota</th><th></th></tr></thead><tbody>
    ${FIELD.map((f, i) => `<tr><td class="l">${esc(f.sed)}</td><td class="l">${RES_TXT[f.res]}</td><td class="l">${esc(f.nota || "")}</td><td><a href="#" data-i="${i}">quitar</a></td></tr>`).join("")}</tbody></table></div>
    <div class="row"><button class="btn sec" id="fieldReset">Restablecer resultados iniciales</button></div>`;
  $("#learnBox")
    .querySelectorAll("a[data-i]")
    .forEach(
      a =>
        (a.onclick = e => {
          e.preventDefault();
          FIELD.splice(+a.dataset.i, 1);
          saveField();
        })
    );
  $("#fieldReset").onclick = () => {
    FIELD = FIELD0.map(x => ({sed: x[0], res: x[1], nota: x[2]}));
    saveField();
  };
}
