/* ============================================================================================================
 * ARCHIVO 04 · LECTURA DE LOS EXCEL DE ENTRADA
 * La herramienta empieza VACÍA: no trae datos precargados. Los datos aparecen al cargar los 2 Excel y pulsar Ejecutar.
 *   - onFile(): lee cada archivo elegido en la pantalla 1, mostrando una barra de avance.
 *       * Balance SED SI – CAMPO: hojas S.INFLUYENTE y OBS S.INFLUYENTE (parseBalanceSheet).
 *       * GUIA_SETIEMBRE: ubicación, alimentador, kVA y clientes de cada SED (parseGuia).
 *   - IMPORTANTE: las columnas se buscan por el NOMBRE del encabezado (tabla BAL_F), no por la letra de la columna,
 *     porque en OBS S.INFLUYENTE el mismo dato está en otra posición (ej. "CRITICIDAD [MWh]" vs "CRITICIDAD").
 *   - S.INFLUYENTE manda; OBS S.INFLUYENTE solo completa los meses que faltan.
 *   Para leer un dato nuevo del Balance: agregue su encabezado a BAL_F y guárdelo en parseBalanceSheet().
 * ========================================================================================================== */
"use strict";

/**
 * Datos leídos de los Excel (vacíos hasta pulsar Ejecutar):
 *   RAW.bal  = Map SED → {meta, crit, cli, kva, cadK, m: Map(mes → {d: distribuida, f: facturada, obs, c: clientes})}
 *   RAW.guia = lista de SED con coordenadas, alimentador, kVA y clientes · RAW.src = nombres de los archivos
 * DB = base calculada por build() · RANGE = rango de meses elegido · MONTHS = meses posibles.
 */
let RAW = {},
  DB = null,
  RANGE = null,
  MONTHS = [];

/**
 * Clave de mes → texto. Ej.: mlab(2609) → "Set-26".
 */
const mlab = k => MESL[k % 100] + "-" + String(Math.floor(k / 100)).padStart(2, "0");

/**
 * Fecha → clave de mes (aaMM). Suma 12 horas para que el huso horario de Lima no pase el día 1 al mes anterior.
 */
const mkd = d0 => {
  const d = new Date(d0.getTime() + 12 * 3600e3);
  return (d.getFullYear() % 100) * 100 + d.getMonth() + 1;
}; // +12 h: evita que el huso horario mueva el día 1 al mes anterior

/**
 * Normaliza el código de alimentador ("H-02" y "H-2" quedan iguales).
 */
const alimN = s =>
  String(s || "")
    .toUpperCase()
    .replace(/-0+(\d)/, "-$1")
    .trim();

/**
 * Datos descriptivos del Balance que se guardan por SED (el más reciente): marca de medidor, factor, IP, SET,
 * línea de tensión, nº de trafos, kVA, clasificación y zona. Se usan en el Excel del análisis masivo.
 */
const META_K = ["marca", "factor", "ip", "set", "linea", "trafos", "kva", "clasif", "zona"];

/**
 * Deja los datos en blanco (estado inicial y botón Limpiar): no hay datos precargados.
 */
function loadSeed() {
  // estado vacío: nada se muestra hasta cargar los Excel y pulsar Ejecutar
  RAW = {guia: [], bal: new Map(), zona: new Set(), src: {}};
}

/**
 * Busca, en las primeras 30 filas de una hoja, la fila de encabezados que contiene todos los textos de "must".
 */
function findHeader(rows, must) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = (rows[i] || []).map(norm);
    if (must.every(m => r.some(c => c === m || c.includes(m)))) return i;
  }
  return -1;
}

/**
 * Devuelve la posición de la columna cuyo encabezado coincide con alguno de los nombres dados (primero exacto, luego "contiene").
 */
function colIdx(hdr, ...keys) {
  const h = hdr.map(norm);
  for (const k of keys) {
    const i = h.findIndex(c => c === k);
    if (i >= 0) return i;
  }
  for (const k of keys) {
    const i = h.findIndex(c => c.includes(k));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Convierte un valor de Excel (fecha, número de serie o texto) a fecha de JavaScript.
 */
const toDate = v => {
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000));
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d)) return d;
  }
  return null;
};
/* Encabezados del Balance: se buscan por NOMBRE (sin tildes, sin espacios dobles, mayúsculas); primero el nombre exacto y luego el que empieza igual.
   Así S.INFLUYENTE y OBS S.INFLUYENTE se agrupan aunque la misma columna esté en otra posición (p. ej. "CRITICIDAD [MWh]" vs "CRITICIDAD"). */
const BAL_F = {
  sed: ["SED"],
  per: ["PERIODO"],
  d: ["E. DISTRIBUIDA MES [MWH]", "E. DISTRIBUIDA MES"],
  f: ["E. FACTURADA AJUSTADA MES [MWH]", "E. FACTURADA AJUSTADA MES"],
  cli: ["CANT CLIENTES TOTALES"],
  crit: ["CRITICIDAD [MWH]", "CRITICIDAD"],
  cad: ["SED CORRECCION DE CADENA"],
  fcad: ["FECHA CORRECCION DE CADENA"],
  kva: ["POTENCIA DEL TRANSFORMADOR [KVA]"],
  marca: ["MARCA MEDIDOR"],
  factor: ["FACTOR"],
  ip: ["IP"],
  set: ["SET"],
  linea: ["LINEA TENSION NOMINAL [KV]"],
  trafos: ["TRAFOS [#]"],
  clasif: ["CLASIFICACION"],
  zona: ["ZONA"]
};

/**
 * Para cada campo de la tabla F encuentra su columna en la fila de encabezados H
 * (primero el nombre exacto y, si no está, el que empieza igual). Devuelve {campo: índice o −1}.
 */
function colsByName(H, F) {
  const h = H.map(norm),
    c = {};
  for (const [k, al] of Object.entries(F)) {
    let i = -1;
    for (const a of al) {
      i = h.indexOf(a);
      if (i >= 0) break;
    }
    if (i < 0)
      for (const a of al) {
        i = h.findIndex(x => x.startsWith(a));
        if (i >= 0) break;
      }
    c[k] = i;
  }
  return c;
}

/**
 * Lee una hoja del Balance (S.INFLUYENTE u OBS S.INFLUYENTE) y la agrega al Map "out" agrupando por SED y mes.
 *   - isObs = true para OBS S.INFLUYENTE: solo completa los meses que no están en S.INFLUYENTE.
 *   - Guarda por mes: E. Distribuida, E. Facturada ajustada y CANT CLIENTES TOTALES.
 *   - Guarda la criticidad más reciente, la potencia, los meses con corrección de cadena y los datos descriptivos.
 * Devuelve {n: registros leídos, cols: columnas encontradas} para mostrarlo en pantalla.
 */
function parseBalanceSheet(rows, out, isObs) {
  const h = findHeader(rows, ["SED", "E. DISTRIBUIDA MES"]);
  if (h < 0) return {n: 0};
  const H = rows[h],
    c = colsByName(H, BAL_F);
  if (c.sed < 0 || c.per < 0 || c.d < 0 || c.f < 0) return {n: 0, falta: ["sed", "per", "d", "f"].filter(k => c[k] < 0)};
  let n = 0;
  const g = (r, k) => (c[k] >= 0 ? r[c[k]] : null);
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[c.sed]) continue;
    const dt = toDate(r[c.per]);
    let k = dt ? mkd(dt) : null;
    if (!k) {
      const mk = mkey(r[c.per]);
      k = mk ? mk.k : null;
    }
    if (!k) continue;
    const sed = String(r[c.sed]).trim();
    let b = out.get(sed);
    if (!b) {
      b = {cli: 0, cad: 0, cadK: [], kva: 0, crit: "", kc: 0, kcl: 0, meta: {}, km: {}, m: new Map()};
      out.set(sed, b);
    }
    if (b.m.has(k) && isObs) continue; // S.INFLUYENTE manda; OBS S.INFLUYENTE completa los meses que faltan
    const cl = num(g(r, "cli"));
    b.m.set(k, {d: num(g(r, "d")), f: num(g(r, "f")), obs: isObs ? 1 : 0, c: cl});
    n++;
    const cr = String(g(r, "crit") ?? "").trim();
    if (cr && cr !== "-" && k >= b.kc) {
      b.crit = cr;
      b.kc = k;
    }
    if (cl && k >= b.kcl) {
      b.cli = cl;
      b.kcl = k;
    }
    const kv = num(g(r, "kva"));
    if (kv) b.kva = kv;
    const cd = norm(g(r, "cad"));
    if (cd && !cd.startsWith("SIN") && !["NULL", "-", "0", "NONE"].includes(cd)) {
      const fc = toDate(g(r, "fcad"));
      const kk = fc ? mkd(fc) : k;
      if (!b.cadK.includes(kk)) b.cadK.push(kk);
      b.cad = 1;
    }
    for (const f of META_K) {
      const v = g(r, f);
      if (v === null || v === undefined || String(v).trim() === "" || String(v).trim() === "-") continue;
      if (k >= (b.km[f] || 0)) {
        b.meta[f] = typeof v === "number" ? v : String(v).trim();
        b.km[f] = k;
      }
    }
  }
  out.forEach(b => b.cadK.sort((x, y) => x - y));
  return {n, cols: c, H};
}

/**
 * Lee la GUIA_SETIEMBRE: SED, alimentador, kVA, clientes, distrito, provincia, tipo, estado y coordenadas (UTM X LONG / UTM Y LAT).
 */
function parseGuia(rows) {
  const h = findHeader(rows, ["SED", "ALIM"]);
  if (h < 0) return null;
  const H = rows[h];
  const c = {
    sed: colIdx(H, "SED"),
    alim: colIdx(H, "ALIM"),
    kva: colIdx(H, "KVA"),
    cli: colIdx(H, "CLIENTES BT CANTIDAD REFERENCIAL", "CLIENTES BT"),
    dist: colIdx(H, "DISTRITO"),
    prov: colIdx(H, "PROVINCIA"),
    tipo: colIdx(H, "TIPO DE SUBESTACION"),
    estado: colIdx(H, "ESTADO"),
    kv: colIdx(H, "LINEA TENSION MT (KV)", "TENSION"),
    lon: colIdx(H, "UTM X LONG", "LONGITUD X", "LONGITUD"),
    lat: colIdx(H, "UTM Y LAT", "LATITUD Y", "LATITUD")
  };
  if (c.sed < 0 || c.lon < 0 || c.lat < 0) return null;
  const out = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[c.sed]) continue;
    const lon = num(r[c.lon]),
      lat = num(r[c.lat]);
    if (lon === null || lat === null || Math.abs(lat) > 90) continue;
    const s = k => (c[k] >= 0 ? String(r[c[k]] ?? "") : "");
    out.push({
      sed: String(r[c.sed]).trim(),
      alim: s("alim").trim(),
      kva: c.kva >= 0 ? (num(r[c.kva]) ?? 0) : 0,
      cli: c.cli >= 0 ? (num(r[c.cli]) ?? 0) : 0,
      dist: s("dist"),
      prov: s("prov"),
      tipo: s("tipo"),
      lon,
      lat,
      estado: s("estado") || "Existente",
      kv: s("kv")
    });
  }
  return out.length ? out : null;
}

/**
 * Archivos de la pantalla 1: "bal" = Balance SED SI – CAMPO, "gui" = GUIA_SETIEMBRE.
 */
const KINDS = ["bal", "gui"];

/**
 * Nombre de cada tipo de archivo para mostrar.
 */
const KNAME = {bal: "Balance SED SI – CAMPO", gui: "GUIA_SETIEMBRE"};

/**
 * Abre un Excel: primero con el lector rápido (XL.read); si no se puede, con SheetJS (opciones livianas).
 * pick elige las hojas, keep las columnas y prog recibe el avance (0 a 1).
 */
async function sheetsOf(file, pick, keep, prog) {
  if (/\.xls[xm]$/i.test(file.name) && typeof fflate !== "undefined") {
    try {
      return await XL.read(file, pick, keep, prog);
    } catch (e) {
      console.warn("lector rápido no disponible, se usa SheetJS:", e.message);
    }
  }
  const buf = await file.arrayBuffer(),
    names = XLSX.read(buf, {type: "array", bookSheets: true}).SheetNames,
    use = pick(names);
  const wb = XLSX.read(buf, {
    type: "array",
    sheets: use,
    cellDates: true,
    dense: true,
    cellText: false,
    cellHTML: false,
    cellFormula: false,
    cellStyles: false,
    cellNF: false
  });
  return use.map(nm => [nm, XLSX.utils.sheet_to_json(wb.Sheets[nm], {header: 1, raw: true, defval: null})]);
}

/**
 * Muestra debajo del archivo una barra de avance mientras se lee.
 */
const progBar = (st, txt, p) => {
  st.className = "status";
  st.innerHTML = `${esc(txt)} <span class="small">${Math.round(100 * p)} %</span><div class="bar" style="margin-top:4px;max-width:420px"><i style="width:${(100 * p).toFixed(0)}%"></i></div>`;
};

/**
 * Lee el archivo elegido en la pantalla 1 según su tipo. Al terminar bien no deja texto; si falla muestra el error en rojo.
 * Devuelve true si se pudo leer.
 */
async function onFile(kind, file) {
  const st = $("#st_" + kind);
  progBar(st, "Leyendo " + file.name + " …", 0);
  await new Promise(r => setTimeout(r, 20));
  const prog = (p, nm) => progBar(st, `Leyendo ${file.name}${nm ? " · " + nm : ""} …`, p);
  try {
    if (kind === "bal") {
      const pick = n => {
        const a = n.filter(x => /^S\.?\s*INFLUYENTE$/i.test(x.trim())),
          b = n.filter(x => /^OBS\s*S\.?\s*INFLUYENTE$/i.test(x.trim()));
        return a.length || b.length ? [...a, ...b] : n;
      };
      const keep = first => {
        const h = findHeader(first, ["SED", "E. DISTRIBUIDA MES"]);
        if (h < 0) return null;
        const c = colsByName(first[h], BAL_F);
        return Object.values(c).filter(i => i >= 0);
      };
      const sh = await sheetsOf(file, pick, keep, prog);
      const out = new Map(),
        falta = [];
      sh.filter(([nm]) => !/^OBS/i.test(nm.trim())).forEach(([nm, rows]) => {
        const r = parseBalanceSheet(rows, out, false);
        if (r.falta) falta.push(nm + ": " + r.falta.join(", "));
      });
      sh.filter(([nm]) => /^OBS/i.test(nm.trim())).forEach(([nm, rows]) => {
        const r = parseBalanceSheet(rows, out, true);
        if (r.falta) falta.push(nm + ": " + r.falta.join(", "));
      });
      if (!out.size)
        throw new Error(
          "no se encontraron los encabezados SED, PERIODO, E. DISTRIBUIDA MES [MWh] y E. FACTURADA AJUSTADA MES [MWh]" +
            (falta.length ? " (" + falta.join("; ") + ")" : "")
        );
      RAW.bal = out;
      RAW.src.bal = file.name;
    } else if (kind === "gui") {
      const sh = await sheetsOf(file, n => n, null, prog);
      let res = null;
      for (const [, rows] of sh) {
        res = parseGuia(rows);
        if (res) break;
      }
      if (!res) throw new Error("no se encontraron SED y coordenadas (UTM X LONG / UTM Y LAT)");
      RAW.guia = res;
      RAW.zona = new Set(res.map(g => g.sed));
      RAW.src.guia = file.name;
    }
    st.className = "status";
    st.textContent = "";
    return true;
  } catch (e) {
    st.className = "status err";
    st.textContent = "Error al leer " + file.name + ": " + e.message;
    return false;
  }
}
