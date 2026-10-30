/* ============================================================================================================
 * ARCHIVO 02 · LECTOR RÁPIDO DE EXCEL (.xlsx)
 * Un archivo .xlsx es en realidad un ZIP con archivos XML adentro. Para leer el Balance de 75 MB en pocos segundos:
 *   1) XL.dir(): lee el índice del ZIP (al final del archivo) para saber dónde está cada hoja.
 *   2) XL.stream(): descomprime SOLO la hoja pedida, en trozos de 1 MB, con la librería fflate.
 *   3) XL.read(): recorre el XML fila por fila y guarda SOLO las columnas necesarias (las que pide keep()).
 *      Entre trozos deja respirar a la página (barra de avance) para que no se congele.
 * Si el archivo no es .xlsx/.xlsm o algo falla, js/04_lectura_datos.js usa SheetJS como respaldo (más lento).
 * ========================================================================================================== */
"use strict";

/* ============================== lector rápido de Excel (.xlsx) ==============================
   Un .xlsx es un ZIP con archivos XML. En vez de cargar el libro completo con SheetJS (lento y con mucha memoria),
   se lee el índice del ZIP, se descomprime SOLO la hoja pedida en trozos (fflate) y se recorre su XML fila por fila
   guardando solo las columnas que se necesitan. Si algo no calza (xls, csv, zip64…), se usa SheetJS como respaldo. */
const XL = {
  /* índice del ZIP: nombre → {pos, csize, method} (registro final y directorio central) */
  /**
   * Índice del ZIP: busca el "registro final" (firma 0x06054b50) y recorre el directorio central.
   * Devuelve {dv, out} donde out es un Map nombre de archivo → {lo: posición, csize: tamaño comprimido, method: 0 sin compresión / 8 deflate}.
   */
  dir(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--)
      if (dv.getUint32(i, true) === 0x06054b50) {
        e = i;
        break;
      }
    if (e < 0) throw new Error("no es un archivo .xlsx (zip)");
    const n = dv.getUint16(e + 10, true),
      off = dv.getUint32(e + 16, true);
    if (off === 0xffffffff) throw new Error("zip64");
    const out = new Map(),
      td = new TextDecoder();
    for (let p = off, k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("zip dañado");
      const method = dv.getUint16(p + 10, true),
        csize = dv.getUint32(p + 20, true),
        nl = dv.getUint16(p + 28, true),
        xl = dv.getUint16(p + 30, true),
        cl = dv.getUint16(p + 32, true),
        lo = dv.getUint32(p + 42, true);
      out.set(td.decode(u8.subarray(p + 46, p + 46 + nl)), {lo, csize, method});
      p += 46 + nl + xl + cl;
    }
    return {dv, out};
  },
  /* descomprime un archivo del ZIP en trozos; onText recibe el texto XML por partes (await entre trozos para no congelar la página) */
  /**
   * Descomprime un archivo del ZIP por trozos de 1 MB (fflate.Inflate) y entrega el texto a onText(texto, esFinal).
   * Entre trozos espera un instante (setTimeout) para que la página no se congele; onProg recibe el avance de 0 a 1.
   */
  async stream(u8, Z, name, onText, onProg) {
    const f = Z.out.get(name);
    if (!f) throw new Error("falta " + name);
    const s = f.lo + 30 + Z.dv.getUint16(f.lo + 26, true) + Z.dv.getUint16(f.lo + 28, true),
      data = u8.subarray(s, s + f.csize),
      td = new TextDecoder("utf-8");
    if (f.method === 0) {
      onText(td.decode(data), true);
      return;
    }
    let err = null;
    const inf = new fflate.Inflate((chunk, final) => {
      try {
        onText(td.decode(chunk, {stream: !final}), final);
      } catch (e) {
        err = e;
      }
    });
    const CH = 1 << 20;
    for (let i = 0; i < data.length; i += CH) {
      inf.push(data.subarray(i, Math.min(data.length, i + CH)), i + CH >= data.length);
      if (err) throw err;
      if (onProg) onProg(Math.min(1, (i + CH) / data.length));
      await new Promise(r => setTimeout(r, 0));
    }
  },
  /**
   * Lee un archivo del ZIP completo como texto (para los archivos chicos: workbook.xml, rels y sharedStrings.xml).
   */
  async text(u8, Z, name) {
    let t = "";
    await XL.stream(u8, Z, name, x => {
      t += x;
    });
    return t;
  },
  /**
   * Convierte los códigos XML a caracteres normales: &amp; → &, &lt; → <, &#233; → é, etc.
   */
  unesc: s =>
    s.indexOf("&") < 0
      ? s
      : s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, c) =>
          c === "lt"
            ? "<"
            : c === "gt"
              ? ">"
              : c === "amp"
                ? "&"
                : c === "quot"
                  ? '"'
                  : c === "apos"
                    ? "'"
                    : String.fromCodePoint(c[1] === "x" ? parseInt(c.slice(2), 16) : +c.slice(1))
        ),
  /**
   * Letra de columna de Excel → número desde 0 (A → 0, Z → 25, AA → 26).
   */
  col(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64;
    return n - 1;
  },
  /* lee el libro: hojas elegidas por pick(nombres) y, en cada hoja, solo las columnas que diga keep(primeras filas) */
  /**
   * Lee el libro: 1) hojas del libro y su archivo XML (workbook.xml + rels), 2) textos compartidos (sharedStrings),
   * 3) cada hoja elegida por pick(nombres): recorre las celdas <c r="AA12" t="s"><v>…</v></c> fila por fila.
   *    Con las primeras 30 filas llama a keep(filas) para saber qué columnas guardar (las demás se descartan para ahorrar memoria).
   * Devuelve [[nombre de hoja, filas]] con cada fila como arreglo de valores (números, textos o fechas como número de serie de Excel).
   */
  async read(file, pick, keep, onProg) {
    const u8 = new Uint8Array(await file.arrayBuffer()),
      Z = XL.dir(u8);
    const wb = await XL.text(u8, Z, "xl/workbook.xml"),
      rels = await XL.text(u8, Z, "xl/_rels/workbook.xml.rels");
    const R = new Map(
      [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [/Id="([^"]+)"/.exec(m[0])[1], /Target="([^"]+)"/.exec(m[0])[1]])
    );
    const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)]
      .map(m => ({name: XL.unesc(/name="([^"]*)"/.exec(m[0])[1]), rid: /r:id="([^"]+)"|\bid="([^"]+)"/.exec(m[0]).slice(1).find(Boolean)}))
      .map(s => {
        let tg = R.get(s.rid) || "";
        tg = tg.startsWith("/") ? tg.slice(1) : "xl/" + tg.replace(/^\.\//, "");
        return {...s, path: tg};
      });
    const use = pick(sheets.map(s => s.name));
    let SS = [];
    if (Z.out.has("xl/sharedStrings.xml")) {
      const t = await XL.text(u8, Z, "xl/sharedStrings.xml");
      SS = [...t.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => {
        let s = "";
        for (const x of m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)) s += x[1];
        return XL.unesc(s);
      });
    }
    const tot = use.reduce((a, nm) => a + (Z.out.get(sheets.find(s => s.name === nm).path) || {csize: 0}).csize, 0);
    let done = 0;
    const res = [];
    for (const nm of use) {
      const sh = sheets.find(s => s.name === nm),
        rows = [],
        first = [];
      let K = undefined,
        buf = "",
        cs = (Z.out.get(sh.path) || {csize: 0}).csize;
      const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      const parse = seg => {
        let m;
        cellRe.lastIndex = 0;
        while ((m = cellRe.exec(seg))) {
          const ci = XL.col(m[1]);
          if (K && !K.has(ci)) continue;
          const ri = +m[2] - 1,
            inner = m[4];
          if (inner === undefined || inner === "") continue;
          const tm = /\bt="([^"]+)"/.exec(m[3]),
            t = tm ? tm[1] : "n";
          let v;
          if (t === "inlineStr") {
            const x = /<t[^>]*>([^<]*)<\/t>/.exec(inner);
            v = x ? XL.unesc(x[1]) : "";
          } else {
            const x = /<v>([^<]*)<\/v>/.exec(inner);
            if (!x) continue;
            v = x[1];
            v = t === "s" ? SS[+v] : t === "str" || t === "e" ? XL.unesc(v) : t === "b" ? v === "1" : +v;
          }
          let r = rows[ri];
          if (!r) r = rows[ri] = [];
          r[ci] = v;
        }
      };
      const flush = final => {
        const k = final ? buf.length : buf.lastIndexOf("</row>");
        if (k < 0) return;
        const seg = buf.slice(0, final ? k : k + 6);
        buf = buf.slice(final ? k : k + 6);
        parse(seg);
        if (K === undefined && (rows.length >= 30 || final)) {
          const k2 = keep ? keep(rows.slice(0, 30).map(r => r || [])) : null;
          K = k2 ? new Set(k2) : null;
          if (K)
            rows.forEach((r, i) => {
              if (r && i >= 30)
                r.forEach((_, c) => {
                  if (!K.has(c)) delete r[c];
                });
            });
        }
      };
      await XL.stream(
        u8,
        Z,
        sh.path,
        (txt, final) => {
          buf += txt;
          if (buf.length > 4e6 || final) flush(final);
        },
        p => onProg && onProg((done + p * cs) / Math.max(1, tot), nm)
      );
      flush(true);
      done += cs;
      res.push([nm, rows.map(r => r || [])]);
    }
    return res;
  }
};
