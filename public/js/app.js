import { api } from './api.js';
import { ws } from './ws.js';
import { escapeHtml } from './utils.js';
import { getCurrentUser, logout } from './auth.js';
import { ROUTES_BY_ROLE, appOfRoute, routeLabel } from './apps.js';

const user = getCurrentUser();

// Rutas visibles por rol (ver apps.js). Todos aterrizan en Inicio, la
// pantalla de aplicaciones (como el inicio de Odoo).
const allowedRoutes = ROUTES_BY_ROLE[user?.role] || ROUTES_BY_ROLE.asesor;
const DEFAULT_ROUTE = 'inicio';

const ROLE_LABELS = { admin: 'Dueño / Admin', coordinador: 'Coordinador', asesor: 'Asesor', produccion: 'Producción' };
const sidebarFoot = document.querySelector('#sidebar > div:last-child');
if (sidebarFoot && user) {
  sidebarFoot.innerHTML = `
    <div class="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center font-bold text-on-surface-variant shrink-0">${escapeHtml((user.username || '?').slice(0, 1).toUpperCase())}</div>
    <div class="min-w-0 flex-1">
      <p class="text-label-bold font-label-bold truncate">${escapeHtml(user.username)}</p>
      <p class="text-body-sm font-body-sm text-on-surface-variant truncate">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</p>
    </div>
    <button id="logout-btn" type="button" aria-label="Cerrar sesión" class="p-2 text-on-surface-variant hover:text-error transition-colors shrink-0" title="Cerrar sesión">
      <span class="material-symbols-outlined text-[20px]">logout</span>
    </button>
  `;
  sidebarFoot.querySelector('#logout-btn').addEventListener('click', logout);
}
const topbarUser = document.getElementById('topbar-user');
if (topbarUser && user) {
  topbarUser.innerHTML = `
    <div class="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center font-bold text-body-sm text-on-surface-variant shrink-0" title="${escapeHtml(`${user.username} · ${ROLE_LABELS[user.role] || user.role}`)}">${escapeHtml((user.username || '?').slice(0, 1).toUpperCase())}</div>
    <button type="button" aria-label="Cerrar sesión" class="p-2 text-on-surface-variant hover:text-error transition-colors" title="Cerrar sesión">
      <span class="material-symbols-outlined text-[20px]">logout</span>
    </button>`;
  topbarUser.querySelector('button').addEventListener('click', logout);
}

// Menu lateral ocultable: libera espacio horizontal en pantallas chicas o
// cuando simplemente estorba. Se recuerda en localStorage (por navegador,
// no por usuario) para que quede como lo dejaste al recargar o cambiar de
// pestaña.
const SIDEBAR_COLLAPSED_KEY = 'nova_sidebar_collapsed';
const sidebarEl = document.getElementById('sidebar');
const mainColEl = document.getElementById('main-col');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');

// En teléfono/tablet (< 1024px) el menú no empuja el contenido: se abre
// encima, con un fondo oscuro, y se cierra al elegir una pantalla, al tocar
// afuera o con Escape. En escritorio sigue como antes (fijo a la izquierda,
// ocultable y recordado). El ancho del menú (252px) y el margen del
// contenido (lg:ml-[252px] en index.html) deben coincidir.
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const mobileQuery = window.matchMedia('(max-width: 1023px)');
let mobileSidebarOpen = false;

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

let sidebarCollapsed = readCollapsed();
// En Inicio no hay menú lateral: las tarjetas de aplicaciones ya son la
// navegación, y un menú con los mismos destinos sobra. render() lo marca.
let onHome = false;

function applySidebar() {
  const mobile = mobileQuery.matches;
  const hidden = onHome || (mobile ? !mobileSidebarOpen : sidebarCollapsed);
  sidebarEl.classList.toggle('-translate-x-full', hidden);
  sidebarEl.classList.toggle('invisible', onHome);
  sidebarEl.classList.toggle('shadow-xl', mobile && mobileSidebarOpen);
  mainColEl.classList.toggle('lg:ml-[252px]', !onHome && !sidebarCollapsed);
  sidebarToggleBtn.classList.toggle('hidden', onHome);
  topbarUser?.classList.toggle('hidden', !onHome);
  topbarUser?.classList.toggle('flex', onHome);
  sidebarBackdrop?.classList.toggle('hidden', !(mobile && mobileSidebarOpen));
  sidebarToggleBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
}

function closeMobileSidebar() {
  if (!mobileSidebarOpen) return;
  mobileSidebarOpen = false;
  applySidebar();
}

applySidebar();
sidebarToggleBtn.addEventListener('click', () => {
  if (mobileQuery.matches) {
    mobileSidebarOpen = !mobileSidebarOpen;
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* sin almacenamiento: solo dura esta visita */
    }
  }
  applySidebar();
});
sidebarBackdrop?.addEventListener('click', closeMobileSidebar);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMobileSidebar();
});
mobileQuery.addEventListener('change', () => {
  mobileSidebarOpen = false;
  applySidebar();
});

// Modo oscuro: la clase "dark" en <html> ya la puso (o no) el script en el
// <head> de index.html antes de pintar nada, para no parpadear -- aquí solo
// se engancha el botón para alternarla y recordar la preferencia. Mismo
// localStorage key ("nova_theme") que lee ese script al arrancar.
const THEME_KEY = 'nova_theme';
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeToggleIcon = document.getElementById('theme-toggle-icon');
function applyThemeIcon() {
  const isDark = document.documentElement.classList.contains('dark');
  themeToggleIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
  themeToggleBtn.title = isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
}
applyThemeIcon();
themeToggleBtn.addEventListener('click', () => {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
  applyThemeIcon();
});

const routes = {
  inicio: () => import('./views/inicio.js'),
  dashboard1: () => import('./views/dashboard1.js'),
  dashboard: () => import('./views/dashboard.js'),
  ventas: () => import('./views/ventas.js'),
  seguimiento: () => import('./views/seguimiento.js'),
  cotizaciones: () => import('./views/cotizaciones.js'),
  cotizar: () => import('./views/cotizar.js'),
  embudo: () => import('./views/embudo.js'),
  trabajos: () => import('./views/trabajos.js'),
  produccion: () => import('./views/produccion.js'),
  pedidos: () => import('./views/pedidos.js'),
  programacion: () => import('./views/programacion.js'),
  op: () => import('./views/op.js'),
  'solicitudes-material': () => import('./views/solicitudesMaterial.js'),
  'reportes-produccion': () => import('./views/reportesProduccion.js'),
  inventario: () => import('./views/inventario.js'),
  garantias: () => import('./views/garantias.js'),
  compras: () => import('./views/compras.js'),
  finanzas: () => import('./views/finanzas.js'),
  facturacion: () => import('./views/facturacion.js'),
  clientes: () => import('./views/clientes.js'),
  informe: () => import('./views/informe.js'),
  'ventas-cerradas': () => import('./views/ventasCerradas.js'),
  estadisticas: () => import('./views/estadisticas.js'),
  reporte: () => import('./views/reporte.js'),
  asesores: () => import('./views/asesores.js'),
  operarios: () => import('./views/operarios.js'),
  ajustes: () => import('./views/ajustes.js'),
};

const viewRoot = document.getElementById('view-root');
const pageTitle = document.getElementById('page-title');
const navList = document.getElementById('nav-list');
const toastRoot = document.getElementById('toast-root');

function toast(message, kind = 'info') {
  const kindClasses = {
    info: 'bg-inverse-surface text-inverse-on-surface',
    success: 'bg-secondary text-on-secondary',
    error: 'bg-error text-on-error',
  };
  const el = document.createElement('div');
  el.className = `px-4 py-3 rounded-lg shadow-lg text-sm font-semibold max-w-xs ${kindClasses[kind] || kindClasses.info}`;
  el.textContent = message;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

const ctx = {
  api,
  ws,
  toast,
  user,
  allowedRoutes,
  navigate: (route, params) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    location.hash = `#/${route}${qs}`;
  },
  routeParams: new URLSearchParams(),
};

// Menú lateral: solo existe dentro de una aplicación y muestra sus
// pantallas (como Odoo), con un enlace para volver a Inicio. En Inicio se
// oculta (ver applySidebar).
function renderSidebar(route, app) {
  const linkCls = (active) =>
    `nav-link flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
      active ? 'bg-surface-container-high text-on-surface font-bold shadow-[inset_3px_0_0_var(--c-primary)]' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
    }`;
  const homeLink = `
    <li><a href="#/inicio" data-route="inicio" class="${linkCls(false)}">
      <span class="material-symbols-outlined text-[20px]">apps</span><span class="text-label-bold font-label-bold">Inicio</span></a></li>`;

  if (!app) {
    navList.innerHTML = '';
    return;
  }

  const items = app.routes.filter(([r]) => allowedRoutes.includes(r));
  navList.innerHTML = `
    ${homeLink}
    <li class="px-3 pt-4 pb-2 flex items-center gap-2">
      <span class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-surface-container-high text-on-surface"><span class="material-symbols-outlined text-[20px]">${app.icon}</span></span>
      <span class="text-body-md font-bold text-on-surface truncate">${escapeHtml(app.label)}</span>
    </li>
    ${items
      .map(
        ([r, label]) => `
      <li><a href="#/${r}" data-route="${r}" class="${linkCls(r === route)} text-body-sm"${r === route ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a></li>`
      )
      .join('')}
  `;
}

// Tocar un enlace del menú en teléfono lo cierra (también si es la misma
// pantalla en la que ya estás, donde no hay hashchange).
navList.addEventListener('click', (e) => {
  if (e.target.closest('a[href]')) closeMobileSidebar();
});

let currentUnmount = null;

async function render() {
  const rawHash = location.hash.replace('#/', '') || DEFAULT_ROUTE;
  const [hashRoute, hashQuery = ''] = rawHash.split('?');
  const route = routes[hashRoute] && allowedRoutes.includes(hashRoute) ? hashRoute : DEFAULT_ROUTE;
  ctx.routeParams = new URLSearchParams(route === hashRoute ? hashQuery : '');

  const app = appOfRoute(route);
  renderSidebar(route, app);
  onHome = !app;
  mobileSidebarOpen = false;
  applySidebar();

  const title = routeLabel(route);
  pageTitle.innerHTML = app
    ? `<a href="#/${app.firstRoute}" class="font-normal text-on-surface-variant hover:text-on-surface">${escapeHtml(app.label)} ›</a> ${escapeHtml(title)}`
    : escapeHtml(title);
  document.title = `${title} · Velara CRM`;

  if (typeof currentUnmount === 'function') {
    try {
      currentUnmount();
    } catch {
      /* la vista ya no existe, se ignora */
    }
    currentUnmount = null;
  }

  viewRoot.innerHTML = '<div class="p-10 text-center text-on-surface-variant">Cargando…</div>';
  try {
    const mod = await routes[route]();
    viewRoot.innerHTML = '';
    currentUnmount = await mod.mount(viewRoot, ctx);
  } catch (err) {
    console.error(err);
    viewRoot.innerHTML = `<div class="p-10 text-center text-error">Error cargando la vista: ${err.message || err}</div>`;
  }
}

window.addEventListener('hashchange', render);
render();

// Indicador de conexion en vivo (WebSocket)
const connDot = document.getElementById('conn-dot');
ws.on('__status', (status) => {
  if (status === 'online') {
    connDot.className = 'w-2 h-2 rounded-full bg-secondary ml-1';
    connDot.title = 'En vivo';
  } else {
    connDot.className = 'w-2 h-2 rounded-full bg-error ml-1';
    connDot.title = 'Reconectando…';
  }
});

// Aviso en vivo cuando entra un lead nuevo (lo cree quien lo cree), para
// quien tenga el CRM abierto en cualquier vista -- no solo en Ventas.
ws.on('leads_changed', (payload) => {
  if (payload && payload.reason === 'created' && payload.client_name) {
    toast(`Nuevo lead: ${payload.client_name}${payload.advisor_name ? ' · ' + payload.advisor_name : ''}`, 'info');
  }
});
