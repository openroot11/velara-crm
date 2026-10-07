// Helpers delgados sobre Chart.js (cargado via CDN en index.html). Cada
// helper destruye cualquier chart previo atado al mismo canvas antes de
// crear el nuevo -- así las vistas pueden simplemente volver a llamar la
// función en cada refresco (ws/polling) sin llevar la cuenta de instancias.

function destroyExisting(canvas) {
  const existing = window.Chart.getChart(canvas);
  if (existing) existing.destroy();
}

// Publico para que las vistas destruyan sus charts al desmontarse (si no,
// Chart.js deja la instancia viva apuntando a un canvas ya removido del DOM
// cada vez que se navega a otra ruta).
export function destroyChart(canvas) {
  if (canvas) destroyExisting(canvas);
}

const FONT = { family: "'Inter', system-ui, sans-serif", size: 11 };

// Chart.js dibuja en <canvas> (no puede heredar color de CSS), asi que para
// que texto/grid/lineas del chart tambien cambien con el modo oscuro (ver
// #theme-vars en index.html) se leen las mismas variables CSS en el
// momento de crear el chart -- cada vista ya recrea sus charts al montar/
// refrescar, asi que alcanza sin necesitar una reactividad en vivo aparte.
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
const TICK_COLOR = () => cssVar('--c-on-surface-variant', '#6E6E6E');
const GRID_COLOR = () => cssVar('--c-outline-variant', '#E2E0DB');
const SURFACE_COLOR = () => cssVar('--c-surface', '#ffffff');

// Paleta categorica validada (8 tonos, orden fijo -- ver skill dataviz). Ya
// usada como PRODUCT_COLORS en components/colombiaMap.js; se expone aqui
// tambien para cualquier otra grafica de identidad (series por asesor, por
// canal, etc.) que necesite el mismo orden sin reinventarlo con hex sueltos.
export const CATEGORICAL_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

/**
 * Barras de una sola serie (ej. tendencia mensual de ventas). `color` es un
 * solo hex -- para una serie unica no aplica la regla de paleta categorica
 * (identidad), es solo el color de marca.
 */
export function barChart(canvas, { labels, data, color, valueFormatter = (v) => v }) {
  destroyExisting(canvas);
  return new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: color || cssVar('--c-primary', '#D71920'), borderRadius: 4, maxBarThickness: 36 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => valueFormatter(ctx.parsed.y) },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: FONT, color: TICK_COLOR() } },
        y: {
          beginAtZero: true,
          grid: { color: GRID_COLOR() },
          ticks: { font: FONT, color: TICK_COLOR(), callback: (v) => valueFormatter(v) },
        },
      },
    },
  });
}

/**
 * Barras agrupadas de varias series (ej. mes actual vs. mes anterior por
 * asesor). `series` es [{label, data, color}]; cada serie ya trae su color
 * explicito (identidad -- quien llama decide el orden categorico).
 */
export function groupedBarChart(canvas, { labels, series, valueFormatter = (v) => v }) {
  destroyExisting(canvas);
  return new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        backgroundColor: s.color,
        borderRadius: 4,
        maxBarThickness: 22,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { font: FONT, color: TICK_COLOR(), boxWidth: 10, boxHeight: 10, padding: 12 },
        },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${valueFormatter(ctx.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: FONT, color: TICK_COLOR() } },
        y: {
          beginAtZero: true,
          grid: { color: GRID_COLOR() },
          ticks: { font: FONT, color: TICK_COLOR(), callback: (v) => valueFormatter(v) },
        },
      },
    },
  });
}

/**
 * Dona/pie generica -- `colors` viene siempre explicito desde quien la llama
 * (cada vista decide si el color es identidad categorica, un estado fijo, o
 * una mezcla justificada de ambos; ver dashboard.js para el caso del embudo).
 */
export function donutChart(canvas, { labels, data, colors, cutout = '68%', showLegend = true }) {
  destroyExisting(canvas);
  return new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: SURFACE_COLOR() }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout,
      plugins: {
        legend: {
          display: showLegend,
          position: 'bottom',
          labels: { font: FONT, color: TICK_COLOR(), boxWidth: 10, boxHeight: 10, padding: 12 },
        },
      },
    },
  });
}

/**
 * Diagrama de flujo Sankey (plugin chartjs-chart-sankey, cargado via CDN en
 * index.html junto a Chart.js). `links` es [{from, to, flow}] con `from`/
 * `to` como el ID interno del nodo (puede venir prefijado para evitar
 * colisiones entre columnas, ej. "channel:Otro" vs "product:Otro"); `labels`
 * mapea esos IDs al texto visible ("Otro" en ambos casos). `nodeColor(id)`
 * devuelve el hex de cada nodo -- lo decide quien llama (identidad
 * categorica por columna, ver estadisticas.js).
 */
export function sankeyChart(canvas, { links, labels, nodeColor }) {
  destroyExisting(canvas);
  return new window.Chart(canvas, {
    type: 'sankey',
    data: {
      datasets: [
        {
          data: links,
          labels,
          colorFrom: (ctx) => nodeColor(ctx.dataset.data[ctx.dataIndex].from),
          colorTo: (ctx) => nodeColor(ctx.dataset.data[ctx.dataIndex].to),
          colorMode: 'gradient',
          color: cssVar('--c-on-surface', '#1B1B1B'),
          font: FONT,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
    },
  });
}

/**
 * Gauge circular (meta vs. real): dona de 2 segmentos, sin leyenda ni
 * tooltip -- el texto central/al lado lo compone la vista en HTML, no el
 * chart (así el mismo primitivo sirve para cualquier meta con cualquier
 * etiqueta).
 */
export function gaugeChart(canvas, { value, max, color, trackColor }) {
  destroyExisting(canvas);
  const safeMax = max > 0 ? max : 1;
  const filled = Math.max(0, Math.min(value, safeMax));
  return new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      datasets: [
        {
          data: [filled, safeMax - filled],
          backgroundColor: [color || cssVar('--c-primary', '#D71920'), trackColor || cssVar('--c-surface-container-highest', '#DCD9D2')],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '75%',
      circumference: 360,
      rotation: -90,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}
