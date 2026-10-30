/* ============================================================================================================
 * ARCHIVO 05 · MESES Y RANGO DE FECHAS (pantalla 2)
 * Arma la lista de meses disponibles (años con datos + 1 antes + 2 después), llena los selectores
 * Fecha inicio / Fecha final (mes y año) y define inRange(), que devuelve los meses del rango elegido.
 * Todos los promedios del análisis se calculan solo con los meses de ese rango.
 * ========================================================================================================== */
"use strict";

/**
 * DATAY = años que tienen datos; YEARS = años que se muestran en los selectores.
 */
let DATAY = [],
  YEARS = [];

/**
 * Lista de todos los meses posibles: los años con datos más uno antes y dos después (para cargar años nuevos).
 */
function monthsUniverse() {
  const ks = new Set();
  RAW.bal.forEach(b => b.m.forEach((v, k) => ks.add(k)));
  DATAY = [...new Set([...ks].map(k => Math.floor(k / 100)))].sort((a, b) => a - b);
  const cur = new Date().getFullYear() % 100,
    y0 = Math.min(DATAY.length ? DATAY[0] : cur, cur) - 1,
    y1 = Math.max(DATAY.length ? DATAY[DATAY.length - 1] : cur, cur) + 2;
  YEARS = [];
  for (let y = y0; y <= y1; y++) YEARS.push(y); // años con datos + uno antes y dos después (para cargar archivos nuevos)
  const out = [];
  for (const y of YEARS) for (let m = 1; m <= 12; m++) out.push(y * 100 + m);
  return out;
}

/**
 * Llena los selectores de mes y año. Si el rango anterior ya no existe, toma Ene–Dic del último año con datos.
 */
function setupRange(keep) {
  MONTHS = monthsUniverse();
  const last = DATAY.length ? DATAY[DATAY.length - 1] : new Date().getFullYear() % 100;
  if (!keep || !RANGE || !MONTHS.includes(RANGE.a) || !MONTHS.includes(RANGE.b))
    RANGE = {a: last * 100 + 1, b: last * 100 + 12, modo: RANGE ? RANGE.modo : "dato", obs: RANGE ? RANGE.obs : true};
  const optM = k =>
    MESL.slice(1)
      .map((n, i) => `<option value="${i + 1}" ${k % 100 === i + 1 ? "selected" : ""}>${n}</option>`)
      .join("");
  const optY = k =>
    YEARS.map(
      y =>
        `<option value="${y}" ${Math.floor(k / 100) === y ? "selected" : ""}>${2000 + y}${DATAY.includes(y) ? "" : " · sin datos"}</option>`
    ).join("");
  $("#mIniM").innerHTML = optM(RANGE.a);
  $("#mIniY").innerHTML = optY(RANGE.a);
  $("#mFinM").innerHTML = optM(RANGE.b);
  $("#mFinY").innerHTML = optY(RANGE.b);
  if (!$("#mModo"))
    $("#mFinY").insertAdjacentHTML(
      "afterend",
      `<label>Promedio</label><select id="mModo"><option value="dato">solo meses con dato</option><option value="todos">todos los meses del rango</option></select><label><input type="checkbox" id="mObs" checked> incluir OBS S.INFLUYENTE</label>`
    );
  $("#mModo").value = RANGE.modo;
  $("#mObs").checked = RANGE.obs;
}

/**
 * Meses (claves aaMM) que caen dentro del rango elegido en la pantalla 2.
 */
const inRange = () => MONTHS.filter(k => k >= RANGE.a && k <= RANGE.b);
