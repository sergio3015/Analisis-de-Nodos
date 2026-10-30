# Análisis Nodal de Pérdidas · SED y aledañas (PLUZ)

Herramienta web para analizar las pérdidas de energía de cada SED junto con sus SED aledañas:
cálculo de nodos, compensación 0–3 MWh, error de cadena (incluida la migración de clientes y el error en factor)
y criticidad con inteligencia artificial. Todo se trabaja en MWh.

## 1. Cómo ejecutarla

- **Doble clic en `INICIAR.bat`** (o en `index.html`): se abre en el navegador (Chrome o Edge).
- La herramienta empieza **vacía**. En la pantalla 1 cargue el **Balance SED SI – CAMPO** y la **GUIA_SETIEMBRE** y pulse **Ejecutar**
  (unos 12 segundos con el Balance de 75 MB).
- Necesita **internet** para el mapa (Leaflet + ArcGIS) y para las librerías de Excel (xlsx-js-style y fflate).

## 2. Cómo abrirla y editarla en Visual Studio Code

1. **Archivo › Abrir carpeta…** y elija la carpeta `Analisis_Nodal_SED_PLUZ`.
2. Acepte las extensiones recomendadas (**Live Server** y **Prettier**).
3. Para ver la herramienta mientras edita:
   - **Live Server:** clic derecho en `index.html` › *Open with Live Server* (o **Go Live**, abajo a la derecha).
     Cada vez que guarde, la página se recarga sola.
   - **Depurar (F5):** *Abrir en Chrome* o *Abrir en Edge*; puede poner puntos de interrupción en los `js/*.js`.
   - **Tarea:** *Terminal › Ejecutar tarea… › Abrir la herramienta en el navegador*.
4. Al guardar, Prettier ordena el código (reglas en `.prettierrc.json`).

Cada archivo `js` empieza con una explicación de lo que hace; cada función tiene un comentario con su propósito,
sus datos de entrada y su resultado; los cálculos largos tienen comentarios paso a paso.

## 3. Estructura de la carpeta

| Archivo | Qué contiene |
|---|---|
| `index.html` | Estructura de las 3 pantallas y el orden de carga de los scripts. |
| `css/estilos.css` | Colores PLUZ, tablas, tarjetas, mapa fijo a la derecha y desplazamiento de la página. |
| `js/01_utilidades.js` | Formato de números, estadística, distancia (haversine), meses. |
| `js/02_lector_rapido_xlsx.js` | Lector rápido de .xlsx (lee solo las hojas y columnas necesarias). |
| `js/03_parametros.js` | Los 5 parámetros de la pantalla 1 y los criterios internos fijos. |
| `js/04_lectura_datos.js` | Lectura del Balance (**por nombre de encabezado**) y de la GUIA. |
| `js/05_meses_y_rango.js` | Selectores de mes y año (Fecha inicio / Fecha final). |
| `js/06_base_por_sed.js` | `build()`: **error en factor**, **promedio de meses con valor**, pérdida, clientes por mes, k-NN, Isolation Forest, priorización. |
| `js/07_cuadros_por_mes.js` | Cuadro 1 (Energía Distribuida y Facturada por mes). |
| `js/08_aprendizaje_campo.js` | Aprendizaje con resultados de campo (pesos de la red bayesiana). |
| `js/09_seleccion_aledanas.js` | **Método 2**: aledañas con GIS (grafo de Gabriel, áreas de servicio, regresión logística). |
| `js/10_evidencias_y_conciliacion.js` | Evidencias bayesianas, migración de clientes y **Método 4** (temple simulado + ascensión de colinas). |
| `js/11_compensacion_y_analisis_nodo.js` | **Método 1** (compensación 0–3 MWh) y `analyze()`, que corre todos los métodos. |
| `js/12_criticidad_ia.js` | **Método 6**: criticidad IA (Bayes empírico, EM, Isolation Forest, red bayesiana). |
| `js/13_priorizacion.js` | Tarjetas de criticidad, tabla de priorización y cuadro de cada tarjeta. |
| `js/14_interfaz_metodos.js` | Botón Ejecutar, Street View y dibujo de los 6 métodos y la Conclusión. |
| `js/15_analisis_masivo.js` | Análisis masivo de hasta 200 SED y su Excel (Prioridad, Método 1…6, Detalle_nodos, Notas). |
| `js/16_excel.js` | Hojas de Excel con formato y exportaciones (nodo y todas las SED). |
| `js/17_mapa.js` | Mapa GIS: ícono de SED, nodo, iteraciones, error de cadena, tramos. |
| `js/18_arranque.js` | Conecta los botones y deja la página vacía al abrir. |
| `img/logo.png` | Logo PLUZ. |

## 4. Dónde cambiar las cosas más comunes

| Quiero cambiar… | Dónde |
|---|---|
| Valores por defecto (radio, nº de aledañas…) | `PARAMS` en `js/03_parametros.js` |
| Pérdida técnica (3,4 %) u otros criterios internos | `FIJOS` en `js/03_parametros.js` |
| Umbral del error en factor (500 MWh) | `build()` en `js/06_base_por_sed.js` (busque "ERROR EN FACTOR") |
| Regla del promedio de meses | `cleanSeries()` en `js/06_base_por_sed.js` |
| Tolerancia de compensación (0–3 MWh) | `TOLC` en `js/11_compensacion_y_analisis_nodo.js` |
| Leer otra columna del Balance | `BAL_F` y `parseBalanceSheet()` en `js/04_lectura_datos.js` |
| Columnas de las tablas de los métodos | `BASE_COLS` en `js/14_interfaz_metodos.js` |
| Umbrales de criticidad IA (62 / 48 / 34) | `critIA()` en `js/12_criticidad_ia.js` |
| Pesos de las evidencias bayesianas | `EXPERT` en `js/10_evidencias_y_conciliacion.js` |
| Encabezados u hojas del Excel masivo | `MASS_BASE` y `exportMass()` en `js/15_analisis_masivo.js` |
| Formato de los Excel (colores, %) | `sheet()` en `js/16_excel.js` |
| Ancho del mapa | `.layout` en `css/estilos.css` |

## 5. Métodos

1. **Cálculo de nodos y compensación por SED** (regla 0–3 MWh).
2. **Aledañas con GIS**: distancia real, grafo de Gabriel, áreas de servicio, regresión logística.
3. **Pérdida esperada** según energía y clientes (regresión cuantil).
4. **Iteración nodal**: red bayesiana del par + temple simulado + ascensión de colinas + Monte Carlo (P5–P95).
5. **Error de cadena**: 10 criterios (satisfacción de restricciones), migración de clientes, espejo mensual, historial.
6. **Criticidad IA**: Bayes empírico, mezcla de gaussianas (EM), Isolation Forest, red bayesiana ingenua.

Referencia: Russell, S. y Norvig, P. *Inteligencia Artificial: un enfoque moderno* (cap. 4 búsqueda local,
cap. 5 satisfacción de restricciones, cap. 13–14 redes bayesianas, cap. 20 aprendizaje estadístico).
