import { api } from './api.js';
import { ws } from './ws.js';
import { escapeHtml } from './utils.js';
import { getCurrentUser, logout } from './auth.js';
import { ROUTES_BY_ROLE, NAV, appOfRoute, routeLabel } from './apps.js';
import { getNavStyle, NAV_STYLE_EVENT } from './navStyle.js';

const user = getCurrentUser();

// Rutas visibles por rol (ver apps.js). Todos aterrizan en Inicio.
const allowedRoutes = ROUTES_BY_ROLE[user?.role] || ROUTES_BY_ROLE.asesor;
const DEFAULT_ROUTE = 'inicio';

const ROLE_LABELS = { admin: 'Dueño / Admin', coordinador: 'Coordinador', asesor: 'Asesor', produccion: 'Producción' };
const sidebarFoot = document.getElementById('sidebar-foot');
if (sidebarFoot && user) {
  sidebarFoot.innerHTML = `
    <div class="w-7 h-7 rounded-full bg-surface-container-highest flex items-center justify-center text-[12px] font-semibold text-on-surface-variant shrink-0">${escapeHtml((user.username || '?').slice(0, 1).toUpperCase())}</div>
    <div class="min-w-0 flex-1">
      <p class="text-[13px] font-medium text-on-surface truncate">${escapeHtml(user.username)}</p>
      <p class="text-[11.5px] text-on-surface-variant truncate">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</p>
    </div>
    <button id="logout-btn" type="button" aria-label="Cerrar sesión" class="btn btn-icon shrink-0" title="Cerrar sesión">
      <span class="material-symbols-outlined">logout</span>
    </button>
  `;
  sidebarFoot.querySelector('#logout-btn').addEventListener('click', logout);
}
// Lo mismo en la barra de arriba, para cuando el menú va arriba (sin menú
// lateral, como Odoo).
const topbarUser = document.getElementById('topbar-user');
if (topbarUser && user) {
  topbarUser.innerHTML = `
    <span class="w-7 h-7 rounded-full bg-on-surface text-surface flex items-center justify-center text-[12px] font-semibold shrink-0" title="${escapeHtml(`${user.username} · ${ROLE_LABELS[user.role] || user.role}`)}">${escapeHtml((user.username || '?').slice(0, 1).toUpperCase())}</span>
    <button id="topbar-logout" type="button" aria-label="Cerrar sesión" class="btn btn-icon" title="Cerrar sesión"><span class="material-symbols-outlined">logout</span></button>`;
  topbarUser.querySelector('#topbar-logout').addEventListener('click', logout);
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

// El menú es parte de la ventana: en escritorio está siempre (salvo que lo
// ocultes con el botón); en teléfono se abre encima y se cierra al elegir.
function applySidebar() {
  const mobile = mobileQuery.matches;
  const hidden = mobile ? !mobileSidebarOpen : sidebarCollapsed;
  sidebarEl.classList.toggle('-translate-x-full', mobile && hidden);
  sidebarEl.classList.toggle('lg:hidden', !mobile && hidden);
  sidebarEl.classList.toggle('shadow-xl', mobile && mobileSidebarOpen);
  mainColEl.classList.toggle('lg:ml-1.5', !mobile && hidden);
  sidebarBackdrop?.classList.toggle('hidden', !(mobile && mobileSidebarOpen));
  sidebarToggleBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  // Inicio y menú arriba (como Odoo): sin menú lateral y de borde a borde,
  // sin el marco de "ventana" (margen, esquinas redondas y sombra) que usa
  // el estilo de menú lateral.
  const flat = shellMode !== 'side';
  if (flat) {
    sidebarEl.classList.add('hidden');
    sidebarBackdrop?.classList.add('hidden');
  } else {
    sidebarEl.classList.remove('hidden');
  }
  document.body.classList.toggle('lg:p-3', !flat);
  for (const c of WINDOW_FRAME) appWindowEl?.classList.toggle(c, !flat);
  for (const c of PANEL_FRAME) mainColEl.classList.toggle(c, !flat);
  if (flat) mainColEl.classList.remove('lg:ml-1.5');
}
const appWindowEl = document.getElementById('app-window');
const WINDOW_FRAME = ['lg:rounded-[18px]', 'lg:border', 'lg:border-outline-variant', 'lg:shadow-[var(--shadow-app)]'];
const PANEL_FRAME = ['lg:my-1.5', 'lg:mr-1.5', 'lg:rounded-xl', 'lg:border', 'lg:border-outline-variant'];

// 'side' = menú lateral; 'top' = menú arriba de la aplicación (Odoo);
// 'home' = Inicio a pantalla completa (sin menú ni barra). Lo fija render().
let shellMode = 'side';

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
  resumen: () => import('./views/resumen.js'),
  dashboard1: () => import('./views/dashboard1.js'),
  dashboard: () => import('./views/dashboard.js'),
  ventas: () => import('./views/ventas.js'),
  seguimiento: () => import('./views/seguimiento.js'),
  cotizaciones: () => import('./views/cotizaciones.js'),
  cotizar: () => import('./views/cotizar.js'),
  catalogo: () => import('./views/catalogo.js'),
  'plantillas-cotizacion': () => import('./views/plantillasCotizacion.js'),
  manual: () => import('./views/manual.js'),
  embudo: () => import('./views/embudo.js'),
  equipos: () => import('./views/equipos.js'),
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
  // Aviso flotante blanco con un punto de color (no bloques de color llenos).
  const dot = { info: 'bg-outline', success: 'bg-status-good', error: 'bg-error' };
  const el = document.createElement('div');
  el.className = 'flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface text-on-surface text-[13px] max-w-xs shadow-[var(--shadow-pop)]';
  el.innerHTML = `<span class="w-1.5 h-1.5 rounded-full shrink-0 ${dot[kind] || dot.info}"></span><span></span>`;
  el.lastChild.textContent = message;
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

// Menú lateral único con todo junto (NAV en apps.js): grupos con rótulo
// gris y un ícono por pantalla, como la referencia. Solo salen las
// pantallas que el rol puede ver.
function renderSidebar(route) {
  const linkCls = (active) =>
    `nav-link flex items-center gap-2.5 px-2.5 h-8 rounded-lg text-[13px] transition-colors ${
      active ? 'bg-surface-container-high text-on-surface font-medium' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
    }`;
  navList.innerHTML = NAV.map((group) => {
    const items = group.items.filter(([r]) => allowedRoutes.includes(r));
    if (!items.length) return '';
    return `
      ${group.label ? `<li class="px-2.5 pt-5 pb-1.5 text-[11.5px] text-outline">${escapeHtml(group.label)}</li>` : ''}
      ${items
        .map(
          ([r, label, icon]) => `
        <li><a href="#/${r}" data-route="${r}" class="${linkCls(r === route)}"${r === route ? ' aria-current="page"' : ''}>
          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">${icon}</span>${escapeHtml(label)}</a></li>`
        )
        .join('')}`;
  }).join('');
}

// Tocar un enlace del menú en teléfono lo cierra (también si es la misma
// pantalla en la que ya estás, donde no hay hashchange).
navList.addEventListener('click', (e) => {
  if (e.target.closest('a[href]')) closeMobileSidebar();
});

// Menú arriba de la aplicación (como Odoo): botón de cuadrícula para volver
// al Inicio, el nombre de la aplicación y sus pantallas (APPS en apps.js,
// solo las que el rol puede ver). En teléfono la fila de pantallas se
// desliza de lado. Con el menú lateral, la barra muestra el título de
// siempre.
const appbarEl = document.getElementById('appbar');
function renderAppbar(route, app) {
  const top = shellMode === 'top';
  // En teléfono las pantallas van en una segunda fila (cabe todo el texto).
  let sub = document.getElementById('appbar-sub');
  if (!sub) {
    sub = document.createElement('nav');
    sub.id = 'appbar-sub';
    sub.className = 'sm:hidden flex items-center gap-0.5 px-margin-mobile h-10 shrink-0 bg-surface border-b border-outline-variant overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
    document.getElementById('topbar').after(sub);
  }
  appbarEl.classList.toggle('hidden', !top);
  appbarEl.classList.toggle('flex', top);
  pageTitle.classList.toggle('hidden', top);
  sidebarToggleBtn.classList.toggle('hidden', top);
  topbarUser?.classList.toggle('hidden', !top);
  topbarUser?.classList.toggle('flex', top);
  // app.menus (si existe) agrupa pantallas en desplegables, como Odoo
  // ("Ventas ▾"); si no, cada pantalla es un enlace suelto.
  const allowed = ([r]) => allowedRoutes.includes(r);
  const entries = !top || !app ? [] : (app.menus || app.routes)
    .map((m) => (Array.isArray(m) ? (allowed(m) ? m : null) : { label: m.label, items: m.items.filter(allowed) }))
    .filter((m) => m && (Array.isArray(m) || m.items.length));
  const items = entries.flatMap((m) => (Array.isArray(m) ? [m] : m.items));
  const showMenu = items.length > 1 || (items.length > 0 && !items.some(([r]) => r === route));
  sub.classList.toggle('!hidden', !(top && showMenu));
  if (!top) return;
  const first = items[0]?.[0] || route;
  const linkCls = (active) =>
    `px-2.5 h-8 inline-flex items-center gap-0.5 rounded-md text-[13px] whitespace-nowrap transition-colors ${
      active ? 'bg-surface-container-high text-on-surface font-medium' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
    }`;
  const link = ([r, label]) => `<a href="#/${r}" class="${linkCls(r === route)}"${r === route ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`;
  const desktop = entries
    .map((m, i) => {
      if (Array.isArray(m)) return link(m);
      const active = m.items.some(([r]) => r === route);
      return `<button type="button" data-menu="${i}" aria-haspopup="true" aria-expanded="false" class="${linkCls(active)}">${escapeHtml(m.label)}<span class="material-symbols-outlined text-[16px] -mr-1" aria-hidden="true">expand_more</span></button>`;
    })
    .join('');
  appbarEl.innerHTML = `
    <a href="#/inicio" class="btn btn-icon -ml-2 shrink-0" aria-label="Ir al Inicio" title="Inicio"><span class="material-symbols-outlined">apps</span></a>
    <a href="#/${first}" class="text-[14px] font-semibold text-on-surface whitespace-nowrap truncate mr-1 sm:mr-3">${escapeHtml(app ? app.label : routeLabel(route))}</a>
    ${
      showMenu
        ? `<nav aria-label="Menú de ${escapeHtml(app.label)}" class="hidden sm:flex items-center gap-0.5 overflow-x-auto min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">${desktop}</nav>`
        : ''
    }`;
  appbarEl.querySelectorAll('[data-menu]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAppMenu(btn, entries[Number(btn.dataset.menu)], route);
    })
  );
  sub.setAttribute('aria-label', `Menú de ${app ? app.label : ''}`);
  sub.innerHTML = items.map(link).join('');
}

// Desplegable de un grupo del menú de arriba. Va con position: fixed para
// que no lo recorte la fila de menús (que se desliza de lado).
let appMenuEl = null;
function closeAppMenu() {
  if (!appMenuEl) return;
  appMenuEl.remove();
  appMenuEl = null;
  appbarEl.querySelectorAll('[data-menu]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}
function openAppMenu(btn, group, route) {
  const wasOpen = appMenuEl && appMenuEl.dataset.for === btn.dataset.menu;
  closeAppMenu();
  if (wasOpen) return;
  const rect = btn.getBoundingClientRect();
  appMenuEl = document.createElement('div');
  appMenuEl.dataset.for = btn.dataset.menu;
  appMenuEl.setAttribute('role', 'menu');
  appMenuEl.className = 'fixed z-[95] min-w-[190px] py-1.5 rounded-xl bg-surface shadow-[var(--shadow-pop)]';
  appMenuEl.style.left = `${rect.left}px`;
  appMenuEl.style.top = `${rect.bottom + 4}px`;
  appMenuEl.innerHTML = group.items
    .map(
      ([r, label]) =>
        `<a role="menuitem" href="#/${r}" class="block px-3.5 py-1.5 text-[13px] ${r === route ? 'text-on-surface font-medium bg-surface-container-low' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'}">${escapeHtml(label)}</a>`
    )
    .join('');
  appMenuEl.addEventListener('click', closeAppMenu);
  document.body.appendChild(appMenuEl);
  btn.setAttribute('aria-expanded', 'true');
  appMenuEl.querySelector('a')?.focus();
}
document.addEventListener('click', (e) => {
  if (appMenuEl && !appMenuEl.contains(e.target)) closeAppMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAppMenu();
});
window.addEventListener('hashchange', closeAppMenu);
window.addEventListener('resize', closeAppMenu);

window.addEventListener(NAV_STYLE_EVENT, () => render());

let currentUnmount = null;

async function render() {
  const rawHash = location.hash.replace('#/', '') || DEFAULT_ROUTE;
  const [hashRoute, hashQuery = ''] = rawHash.split('?');
  const route = routes[hashRoute] && allowedRoutes.includes(hashRoute) ? hashRoute : DEFAULT_ROUTE;
  ctx.routeParams = new URLSearchParams(route === hashRoute ? hashQuery : '');

  const app = appOfRoute(route);
  renderSidebar(route);
  mobileSidebarOpen = false;
  // Inicio = cuadrícula de aplicaciones a pantalla completa (views/inicio.js
  // trae su propia barra). Dentro de una aplicación, el menú va arriba
  // (como Odoo) o al lado, según Ajustes › Apariencia.
  const isHome = route === 'inicio';
  shellMode = isHome ? 'home' : getNavStyle() === 'top' ? 'top' : 'side';
  applySidebar();
  renderAppbar(route, app);
  document.getElementById('topbar')?.classList.toggle('hidden', isHome);
  viewRoot.classList.toggle('!p-0', isHome); // el fondo del Inicio llega a los bordes

  const title = routeLabel(route);
  pageTitle.innerHTML = app
    ? `<span class="text-outline">${escapeHtml(app.label)}</span> <span class="text-outline">/</span> ${escapeHtml(title)}`
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
    connDot.className = 'w-1.5 h-1.5 rounded-full bg-status-good ml-1';
    connDot.title = 'En vivo';
  } else {
    connDot.className = 'w-1.5 h-1.5 rounded-full bg-error ml-1';
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
