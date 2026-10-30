/* ============================================================================================================
 * ARCHIVO 01 · UTILIDADES GENERALES
 * Funciones pequeñas que usa todo el programa:
 *   - $()            : atajo para buscar un elemento de la página (como document.querySelector).
 *   - ok(), num()    : validan y convierten números (tolera "-", vacíos y comas decimales).
 *   - fmt(), pctf()  : dan formato peruano a números y porcentajes (1,234.56 / 12.3%).
 *   - mean, sd, median, quant : estadística básica (promedio, desviación, mediana, percentil).
 *   - hav()          : distancia real en metros entre dos coordenadas (fórmula del haversine).
 *   - mulberry32, gauss : números aleatorios reproducibles (para Monte Carlo y temple simulado).
 *   - mkey(), MESN, MESL : reconocen meses escritos como "Ene-26", "MAY26", fechas de Excel, etc.
 * No depende de ningún otro archivo: por eso se carga primero.
 * ========================================================================================================== */
"use strict";

/**
 * Atajo para buscar un elemento de la página por su selector CSS. Ej.: $("#sedInput") devuelve la caja de búsqueda.
 */
const $ = s => document.querySelector(s);

/**
 * Devuelve true si x es un número válido (no vacío, no null, no infinito). Se usa antes de cualquier cálculo.
 */
const ok = x => x !== null && x !== undefined && x !== "" && isFinite(x);

/**
 * Caché de formateadores de números (uno por cantidad de decimales). Crear un formateador es lento; así se reutiliza.
 */
const NF = [],
  nf = d => NF[d] || (NF[d] = new Intl.NumberFormat("es-PE", {minimumFractionDigits: d, maximumFractionDigits: d})); // formateadores en caché (mucho más rápidos que toLocaleString)

/**
 * Da formato a un número con d decimales y separador de miles (estilo Perú). Si no es número devuelve "-".
 * Ej.: fmt(1234.567) → "1,234.57".
 */
const fmt = (x, d = 2) => (!ok(x) ? "-" : nf(d).format(Number(x)));

/**
 * Da formato de porcentaje: pctf(0.1234) → "12.3%".
 */
const pctf = (x, d = 1) => (!ok(x) ? "-" : nf(d).format(100 * x) + "%");

/**
 * Limita x al intervalo [a, b].
 */
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * Grado de pertenencia difuso (0 a 1): 0 si x ≤ a, 1 si x ≥ b y proporcional en medio. Lo usan las evidencias de la red bayesiana.
 */
const mu = (x, a, b) => (!ok(x) ? null : clamp((x - a) / (b - a), 0, 1));

/**
 * Función sigmoide (logística): convierte un puntaje en probabilidad entre 0 y 1.
 */
const sigm = z => 1 / (1 + Math.exp(-z));

/**
 * Normaliza un texto para comparar encabezados: quita tildes, pasa a MAYÚSCULAS y deja un solo espacio entre palabras.
 */
const norm = s =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Convierte un valor de Excel a número. Acepta coma decimal. Devuelve null si está vacío o es "-".
 */
const num = v => {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) ? n : null;
};

/**
 * Promedio de un arreglo de números.
 */
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/**
 * Desviación estándar de un arreglo de números.
 */
const sd = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/**
 * Mediana de un arreglo (valor central, menos sensible a datos atípicos que el promedio).
 */
const median = a => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const h = b.length >> 1;
  return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2;
};

/**
 * Percentil q (0 a 1) de un arreglo. Ej.: quant(a, 0.05) es el P5.
 */
const quant = (a, q) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? b[Math.min(b.length - 1, Math.max(0, Math.round(q * (b.length - 1))))] : null;
};

/**
 * Escapa texto para mostrarlo en HTML sin riesgo (convierte <, >, &, comillas).
 */
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);

/**
 * Distancia en METROS entre dos puntos (latitud, longitud) con la fórmula del haversine (Tierra esférica).
 */
function hav(lat1, lon1, lat2, lon2) {
  const R = 6371000,
    r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Generador de números aleatorios con semilla: siempre da la misma secuencia, así los resultados se repiten igual.
 */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Número aleatorio con distribución normal (media 0, desviación 1) a partir del generador r (método de Box-Muller).
 */
function gauss(r) {
  let u = 0,
    v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Correlación de Pearson entre dos series (−1 a 1). Se usa para detectar pérdidas en espejo entre SED.
 */
function pearson(x, y) {
  const mx = mean(x),
    my = mean(y);
  let a = 0,
    b = 0,
    c = 0;
  for (let i = 0; i < x.length; i++) {
    a += (x[i] - mx) * (y[i] - my);
    b += (x[i] - mx) ** 2;
    c += (y[i] - my) ** 2;
  }
  return b > 0 && c > 0 ? a / Math.sqrt(b * c) : null;
}

/**
 * Nombre corto del mes → número (ENE=1 … DIC=12; SET y SEP = 9).
 */
const MESN = {ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, SEP: 9, OCT: 10, NOV: 11, DIC: 12};

/**
 * Número de mes → nombre corto para mostrar (1 → "Ene").
 */
const MESL = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];

/**
 * Reconoce un mes en una fecha o en un texto ("Ene-26", "MAY26", "Jun-2026") y devuelve {k: 2601, lab: "Ene-26"}.
 * La clave k = año (2 dígitos) × 100 + mes, así los meses se ordenan como números.
 */
function mkey(lbl) {
  if (lbl instanceof Date && !isNaN(lbl)) {
    const dd = new Date(lbl.getTime() + 12 * 3600e3),
      y = dd.getFullYear() % 100,
      m = dd.getMonth() + 1;
    return {k: y * 100 + m, lab: MESL[m] + "-" + String(y).padStart(2, "0")};
  }
  const m = norm(lbl).match(/(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SET|SEP|OCT|NOV|DIC)[A-Z]*[-\s\/.]*(\d{2,4})/);
  if (!m) return null;
  const y = +m[2] % 100;
  return {k: y * 100 + MESN[m[1]], lab: MESL[MESN[m[1]]] + "-" + String(y).padStart(2, "0")};
}
