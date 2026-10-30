/* ============================================================================================================
 * ARCHIVO 03 · PARÁMETROS DEL ANÁLISIS
 * Define los 5 parámetros que el usuario puede cambiar en la pantalla 1 (radio, nº de aledañas, etc.)
 * y los criterios internos fijos (FIJOS). La función P() junta ambos en un solo objeto que reciben
 * todos los cálculos. Si quiere cambiar un valor por defecto, edite la tabla PARAMS o FIJOS.
 * ========================================================================================================== */
"use strict";

/**
 * Parámetros editables en la pantalla 1: [clave, texto, valor por defecto, paso].
 *   R    = radio máximo para buscar aledañas (m)
 *   N    = máximo de aledañas por nodo
 *   MINB = mínimo de aledañas con balance (si faltan, el radio crece hasta RMAX)
 *   RMAX = radio ampliado máximo (m)
 *   L    = escala de distancia λ de la regresión logística (m)
 */
const PARAMS = [
  ["R", "Radio máximo de búsqueda de aledañas (m)", 400, 50],
  ["N", "Máximo de SED aledañas por nodo", 6, 1],
  ["MINB", "Mínimo de aledaños con balance por nodo", 2, 1],
  ["RMAX", "Radio ampliado máximo para buscar aledaños con balance (m)", 1000, 50],
  ["L", "Escala de distancia λ (m)", 150, 10]
];
$("#params").innerHTML =
  PARAMS.map(([k, t, v, s]) => `<div class="prow"><span>${t}</span><input type="number" id="p_${k}" value="${v}" step="${s}"></div>`).join(
    ""
  ) + `<p class="hint">Se aplican al pulsar Ejecutar.</p>`;

/**
 * Criterios internos (no se muestran en pantalla):
 *   Pmin = probabilidad mínima para aceptar una aledaña · PT = pérdida técnica (3,4 % de la distribuida)
 *   SUP  = pérdida supuesta para SED sin balance (10 %) · TAU = cuantil de la regresión (0,25)
 *   CR/CC = umbrales del índice de compensación · OUT = quitar meses atípicos (1 = sí)
 *   KNN = vecinos del k-NN · UI = MWh/año para recomendar inspección · N0 = peso del aprendizaje · AREA = m² por lote
 */
const FIJOS = {Pmin: 0.5, PT: 0.034, SUP: 0.1, TAU: 0.25, CR: 0.8, CC: 0.3, OUT: 1, KNN: 15, UI: 12, N0: 30, AREA: 250}; // criterios internos

/**
 * Junta los parámetros de la pantalla 1 con los FIJOS y el rango de meses en un solo objeto p.
 * Todas las funciones de cálculo reciben este objeto.
 */
const P = () => {
  const o = {...FIJOS};
  PARAMS.forEach(([k, , v]) => (o[k] = num($("#p_" + k).value) ?? v));
  o.RANGE = RANGE ? `${RANGE.a}-${RANGE.b}-${RANGE.modo}-${RANGE.obs}` : "";
  return o;
};
