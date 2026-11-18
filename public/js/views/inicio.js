import { escapeHtml } from '../utils.js';
import { visibleApps } from '../apps.js';
import { logout } from '../auth.js';

// Inicio: cuadrícula de aplicaciones a pantalla completa (como el inicio de
// Odoo, con la marca de Velara). Cada cuadro abre la primera pantalla de su
// aplicación (APPS en apps.js); el rol solo ve las que puede abrir. En esta
// pantalla app.js oculta el menú lateral y la barra de arriba: la barra es
// la de aquí (logo, tema, empresa y usuario). El panel de cifras que antes
// vivía aquí está en Ventas › Resumen (views/resumen.js).

const COMPANY = 'Velara Taller';

const ROLE_LABELS = { admin: 'Dueño / Admin', coordinador: 'Coordinador', asesor: 'Asesor', produccion: 'Producción' };

// Fondo con franjas diagonales suaves (las franjas de la marca, muy
// tenues). Se inyecta al montar y se quita al salir.
const STYLE = `
  .vh-root { position: relative; min-height: 100%; isolation: isolate; overflow: hidden;
    background: linear-gradient(135deg, #F4F3EF 0%, #EEEDF1 55%, #E8E7EC 100%); }
  .dark .vh-root { background: linear-gradient(135deg, #151517 0%, #1B1B1F 55%, #121214 100%); }
  .vh-band { position: absolute; z-index: -1; pointer-events: none; border-radius: 56px; transform: rotate(-32deg); }
  .vh-b1 { width: 150%; height: 46%; left: -25%; top: 42%; background: rgba(255, 255, 255, 0.5); }
  .vh-b2 { width: 70%; height: 30%; right: -18%; top: -8%; background: rgba(167, 169, 172, 0.13); }
  .dark .vh-b1 { background: rgba(255, 255, 255, 0.03); }
  .dark .vh-b2 { background: rgba(167, 169, 172, 0.06); }
  .vh-icon { background: #FFFFFF; box-shadow: 0 1px 2px rgba(16, 16, 30, 0.08), 0 6px 16px -6px rgba(16, 16, 30, 0.18);
    transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .dark .vh-icon { background: #232327; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 8px 18px -8px rgba(0, 0, 0, 0.7); }
  .vh-tile:hover .vh-icon, .vh-tile:focus-visible .vh-icon { transform: translateY(-2px);
    box-shadow: 0 2px 4px rgba(16, 16, 30, 0.08), 0 12px 24px -8px rgba(16, 16, 30, 0.28); }
  .vh-tile:focus-visible { outline: 2px solid var(--c-outline); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .vh-icon { transition: none; } .vh-tile:hover .vh-icon { transform: none; } }
`;

function tile(app) {
  return `
    <a href="#/${app.firstRoute}" class="vh-tile flex flex-col items-center gap-2.5 w-[104px] sm:w-[112px] p-1.5 rounded-xl" title="${escapeHtml(app.desc || app.label)}">
      <span class="vh-icon relative w-[64px] h-[64px] sm:w-[70px] sm:h-[70px] rounded-[16px] flex items-center justify-center overflow-hidden">
        <span class="absolute right-[-10px] bottom-[-10px] w-9 h-9 rounded-full" style="background:${app.color}22"></span>
        <span class="material-symbols-outlined relative" aria-hidden="true" style="font-size:36px;color:${app.color};font-variation-settings:'FILL' 1,'wght' 500">${app.icon}</span>
      </span>
      <span class="text-[13px] leading-tight text-on-surface text-center">${escapeHtml(app.label)}</span>
    </a>`;
}

export async function mount(container, ctx) {
  const user = ctx.user || {};
  const apps = visibleApps(ctx.allowedRoutes);
  const isDark = () => document.documentElement.classList.contains('dark');

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  container.innerHTML = `
    <div class="vh-root">
      <span class="vh-band vh-b1"></span><span class="vh-band vh-b2"></span>

      <header class="flex items-center justify-between gap-3 px-4 sm:px-6 h-14">
        <a href="#/inicio" aria-label="Velara, Inicio" class="shrink-0">
          <img src="/img/brand/logo-positivo.svg" alt="Velara" class="w-[112px] h-auto dark:hidden" />
          <img src="/img/brand/logo-negativo.svg" alt="Velara" class="w-[112px] h-auto hidden dark:block" />
        </a>
        <div class="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
          <button type="button" id="vh-theme" class="btn btn-icon" aria-label="Cambiar tema claro/oscuro"><span class="material-symbols-outlined">${isDark() ? 'light_mode' : 'dark_mode'}</span></button>
          <span class="hidden sm:inline text-[12px] font-semibold tracking-[0.08em] uppercase text-on-surface-variant truncate">${escapeHtml(COMPANY)}</span>
          <span class="w-8 h-8 rounded-full bg-on-surface text-surface flex items-center justify-center text-[13px] font-semibold shrink-0" title="${escapeHtml(`${user.username || ''} · ${ROLE_LABELS[user.role] || user.role || ''}`)}">${escapeHtml((user.username || '?').slice(0, 1).toUpperCase())}</span>
          <button type="button" id="vh-logout" class="btn btn-icon" aria-label="Cerrar sesión" title="Cerrar sesión"><span class="material-symbols-outlined">logout</span></button>
        </div>
      </header>

      <nav aria-label="Aplicaciones" class="px-4 pt-8 sm:pt-14 pb-16">
        <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-x-1 lg:gap-x-4 gap-y-7 justify-items-center max-w-[820px] mx-auto">
          ${apps.map(tile).join('')}
        </div>
      </nav>
    </div>`;

  // El botón de tema real vive en la barra de arriba (oculta en Inicio).
  container.querySelector('#vh-theme').addEventListener('click', (e) => {
    document.getElementById('theme-toggle-btn')?.click();
    e.currentTarget.querySelector('.material-symbols-outlined').textContent = isDark() ? 'light_mode' : 'dark_mode';
  });
  container.querySelector('#vh-logout').addEventListener('click', logout);

  return () => style.remove();
}
