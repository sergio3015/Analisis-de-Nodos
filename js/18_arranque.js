/* ============================================================================================================
 * ARCHIVO 18 · ARRANQUE Y BOTONES
 * Se carga al final. Conecta los botones de las 3 pantallas con sus funciones (Ejecutar, Limpiar, Siguiente, Aplicar rango,
 * exportaciones). Al abrir la página todo queda VACÍO (vaciar()); al pulsar Ejecutar, process() lee los 2 Excel,
 * arma el rango de meses y calcula la priorización de todas las SED (unos 12 segundos con el Balance completo).
 * ========================================================================================================== */
"use strict";

/**
 * Cambia de pantalla (t1 datos, t2 cuadros por mes, t3 métodos). El mapa solo se muestra en la pantalla 3 y se reubica
 * en la SED analizada, en el análisis masivo o en todas las SED.
 */
function showTab(id) {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === id));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.id === id));
  if (id !== "t3" && document.querySelector(".layout").classList.contains("map-expanded")) setMapExpanded(false);
  $(".layout").classList.toggle("nomap", id !== "t3"); // el mapa GIS solo se muestra en la pantalla de métodos
  if (map && id === "t3")
    setTimeout(() => {
      map.invalidateSize();
      if (CUR) drawNode(CUR);
      else if (MASS) drawMass();
      else fitAll();
    }, 60);
}
document.querySelectorAll(".tabs button").forEach(b => (b.onclick = () => showTab(b.dataset.t)));
$("#runBtn").onclick = () => run();
$("#clearBtn").onclick = clearAll;
$("#sedInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    run();
  }
});
$("#xlsMass").onclick = exportMass;
$("#massBack").onclick = () => {
  if (MASS) {
    CUR = null;
    if (layerNode) {
      layerNode.clearLayers();
      layerTram.clearLayers();
    }
    renderMass();
  }
};
$("#xlsNode").onclick = exportNode;
$("#xlsAll").onclick = () => {
  if (hayDatos()) exportAll();
};
$("#xlsTabs").onclick = () => {
  if (hayDatos()) exportTables();
};
KINDS.forEach(
  k =>
    ($("#f_" + k).onchange = () => {
      $("#st_" + k).className = "status";
      $("#st_" + k).textContent = "";
      PENDING = true;
    })
);

/**
 * true si se eligieron archivos que aún no se procesaron.
 */
let PENDING = false;

/**
 * Bloquea o libera los botones mientras se calcula.
 */
const busy = (on, txt) => {
  const b = $("#dataRun");
  b.disabled = on;
  b.textContent = on ? txt || "Procesando…" : "▶ Ejecutar";
  $("#dataNext").disabled = on;
  $("#rangeApply").disabled = on;
};

/**
 * true si ya se cargaron los Excel y se calculó la base.
 */
const hayDatos = () => !!(DB && RAW.bal.size);

/**
 * Deja todas las pantallas vacías (al abrir la página y al pulsar Limpiar en la pantalla 1).
 */
function vaciar() {
  // deja todas las pantallas vacías
  DB = null;
  CUR = null;
  MASS = null;
  MANUAL = new Map();
  $("#tab1").innerHTML =
    `<p class="hint vacio">Aún no hay datos: cargue el Balance SED SI – CAMPO y la GUIA_SETIEMBRE en la pantalla 1 y pulse Ejecutar.</p>`;
  $("#pg1").innerHTML = "";
  $("#rangeInfo").innerHTML = "";
  $("#chips").innerHTML = "";
  $("#prio").innerHTML =
    `<p class="hint vacio">Aún no hay datos: cargue el Balance SED SI – CAMPO y la GUIA_SETIEMBRE en la pantalla 1 y pulse Ejecutar.</p>`;
  $("#prioSum").textContent = "Priorización de SED";
  $("#result").innerHTML = "";
  $("#xlsNode").disabled = true;
  $("#xlsMass").disabled = true;
  $("#xlsAll").disabled = true;
  $("#xlsTabs").disabled = true;
  $("#massBack").style.display = "none";
  $("#sedInput").value = "";
  if (layerAll) {
    layerAll.clearLayers();
    layerNode.clearLayers();
    layerTram.clearLayers();
  }
  if (layerMass) layerMass.clearLayers();
}

/**
 * Botón Ejecutar de la pantalla 1: verifica que estén los 2 archivos, los lee, arma el rango de meses y calcula todo.
 * Devuelve false si falta un archivo o hubo un error.
 */
async function process() {
  const fb = $("#f_bal").files[0],
    fg = $("#f_gui").files[0];
  if (!PENDING && hayDatos()) {
    busy(true);
    await new Promise(r => setTimeout(r, 30));
    build();
    refreshMap();
    busy(false);
    if (CUR) run(CUR.sed, true);
    return true;
  }
  if ((!fb && !RAW.bal.size) || (!fg && !RAW.guia.length)) {
    if (!fb && !RAW.bal.size) {
      $("#st_bal").className = "status err";
      $("#st_bal").textContent = "Falta elegir el Balance SED SI – CAMPO.";
    }
    if (!fg && !RAW.guia.length) {
      $("#st_gui").className = "status err";
      $("#st_gui").textContent = "Falta elegir la GUIA_SETIEMBRE.";
    }
    return false;
  }
  busy(true);
  await new Promise(r => setTimeout(r, 30));
  let okAll = true;
  if (fb && PENDING) okAll = (await onFile("bal", fb)) && okAll;
  if (fg && PENDING) okAll = (await onFile("gui", fg)) && okAll;
  if (!okAll || !RAW.bal.size || !RAW.guia.length) {
    busy(false);
    return false;
  }
  $("#st_bal").innerHTML = `<span class="small">Calculando la priorización de todas las SED…</span>`;
  await new Promise(r => setTimeout(r, 30));
  setupRange(false);
  build();
  refreshMap();
  PENDING = false;
  busy(false);
  $("#st_bal").textContent = "";
  if (CUR) run(CUR.sed, true);
  return true;
}

/**
 * Botón Aplicar de la pantalla 2: valida que el rango tenga datos y recalcula con los meses elegidos.
 */
async function applyRange() {
  if (!hayDatos()) {
    $("#rangeInfo").innerHTML = `<span class="status err">Primero cargue los archivos en la pantalla 1 y pulse Ejecutar.</span>`;
    return false;
  }
  let a = +$("#mIniY").value * 100 + +$("#mIniM").value,
    b = +$("#mFinY").value * 100 + +$("#mFinM").value;
  if (a > b) [a, b] = [b, a];
  if (!DATAY.some(y => y >= Math.floor(a / 100) && y <= Math.floor(b / 100))) {
    $("#rangeInfo").innerHTML =
      `<span class="status err">El rango ${mlab(a)} a ${mlab(b)} no tiene datos cargados. Años con datos: ${DATAY.map(y => 2000 + y).join(", ")}. Cargue en la pantalla 1 los archivos del nuevo año (Balance, Consumo Maestro y ALP) y pulse Ejecutar.</span>`;
    return false;
  }
  const nr = {a, b, modo: $("#mModo").value, obs: $("#mObs").checked};
  if (JSON.stringify(nr) === JSON.stringify(RANGE)) return;
  RANGE = nr;
  PG = {t1: 0, t2: 0};
  busy(true);
  $("#rangeApply").textContent = "Calculando…";
  await new Promise(r => setTimeout(r, 30));
  setupRange(true);
  build();
  refreshMap();
  busy(false);
  $("#rangeApply").textContent = "Aplicar";
  if (CUR) run(CUR.sed, true);
}
$("#dataRun").onclick = process;
$("#dataNext").onclick = async () => {
  if (PENDING || !hayDatos() || JSON.stringify(DB.p) !== JSON.stringify(P())) {
    if (!(await process())) return;
  }
  showTab("t2");
};
$("#rangeApply").onclick = applyRange;
$("#next2").onclick = async () => {
  if ((await applyRange()) === false) return;
  showTab("t3");
  if (!CUR) fitAll();
};
$("#q1").oninput = () => {
  PG.t1 = 0;
  renderTables();
};
$("#dataClear").onclick = () => {
  KINDS.forEach(k => {
    $("#f_" + k).value = "";
    $("#st_" + k).className = "status";
    $("#st_" + k).textContent = "";
  });
  PENDING = false;
  loadSeed();
  vaciar();
  setupRange(false);
};
$("#themeBtn").onclick = () => {
  const r = document.documentElement;
  r.dataset.theme = r.dataset.theme === "dark" ? "light" : "dark";
};
loadField();
loadSeed();
try {
  initMap();
} catch (e) {
  $("#map").innerHTML = "<p style='padding:20px'>No se pudo cargar el mapa (requiere conexión a internet).</p>";
}
setupRange(false);
vaciar();
