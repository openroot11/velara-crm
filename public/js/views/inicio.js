import { escapeHtml, formatMoney, formatCompactMoney } from '../utils.js';
import { visibleApps } from '../apps.js';

// Inicio: un resumen del negocio arriba (lo esencial del Panel de gerencia)
// y debajo las aplicaciones de Velara como tarjetas (igual que el inicio de
// Odoo). En Inicio no hay menú lateral: las tarjetas SON la navegación; el
// menú aparece al entrar a una aplicación.
//
// Cada bloque del resumen se pide por separado y se oculta si el rol no
// tiene acceso (kpis y caja son solo admin/coordinador; las OP las ve
// cualquiera, filtradas por el backend -- un asesor ve solo las suyas).
// Estética del manual de marca: banda en negro carbón con el patrón de
// planos a 47,4°, título con filete rojo, íconos lineales con un solo
// detalle en rojo.

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

function today() {
  return new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthRange() {
  const now = new Date();
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
}

function monthName() {
  const s = new Date().toLocaleDateString('es-CO', { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Patrón "oscuro · planos" (VELARA_patron_05) recortado a la banda.
const PATTERN = `
  <svg class="absolute inset-y-0 right-0 h-full w-[70%] max-w-[560px] pointer-events-none" viewBox="0 0 560 220" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
    <polygon points="40,0 200,0 404,220 244,220" fill="#161616"/>
    <polygon points="230,0 310,0 514,220 434,220" fill="#1E1E1E"/>
    <polygon points="350,0 400,0 604,220 554,220" fill="#262626"/>
    <polygon points="430,0 452,0 656,220 634,220" fill="#D71920"/>
  </svg>`;

const CARD = 'bg-surface-container-lowest border border-outline-variant rounded-xl p-5';

function kpiCard(label, value, sub, href) {
  const tag = href ? 'a' : 'div';
  return `
    <${tag} ${href ? `href="${href}"` : ''} class="${CARD} block ${href ? 'hover:border-on-surface transition-colors' : ''}">
      <p class="overline text-on-surface-variant mb-2">${label}</p>
      <p class="text-[24px] leading-[30px] sm:text-[32px] sm:leading-[38px] font-bold tracking-tight text-on-surface truncate">${value}</p>
      ${sub ? `<p class="text-body-sm text-on-surface-variant mt-2 truncate">${sub}</p>` : ''}
    </${tag}>`;
}

function cardHeader(title, href, linkLabel) {
  return `
    <div class="flex items-baseline justify-between gap-3 mb-4">
      <h3 class="text-body-md font-bold text-on-surface">${title}</h3>
      ${href ? `<a href="${href}" class="text-body-sm text-on-surface-variant hover:text-on-surface shrink-0">${linkLabel} ›</a>` : ''}
    </div>`;
}

function statRow(label, value, tone = '') {
  return `
    <div class="flex items-center justify-between gap-3 py-2">
      <span class="text-body-sm text-on-surface-variant">${label}</span>
      <span class="text-body-md font-bold ${tone || 'text-on-surface'}">${value}</span>
    </div>`;
}

function topAdvisorsCard(advisors) {
  const rows = advisors
    .filter((a) => a.monto_vendido > 0)
    .sort((a, b) => b.monto_vendido - a.monto_vendido)
    .slice(0, 5);
  const max = rows[0]?.monto_vendido || 1;
  return `
    <div class="${CARD}">
      ${cardHeader('Mejores asesores del mes', '#/dashboard1', 'Panel de gerencia')}
      ${
        rows.length
          ? `<ol class="space-y-3">${rows
              .map(
                (a, i) => `
            <li>
              <div class="flex items-baseline justify-between gap-3 text-body-sm">
                <span class="truncate"><span class="text-on-surface-variant mr-2">${i + 1}</span><span class="font-semibold text-on-surface">${escapeHtml(a.name)}</span></span>
                <span class="font-bold text-on-surface shrink-0">${formatCompactMoney(a.monto_vendido)}</span>
              </div>
              <div class="h-1.5 mt-1.5 rounded-full bg-surface-container overflow-hidden">
                <div class="h-full rounded-full ${i === 0 ? 'bg-primary' : 'bg-on-surface-variant'}" style="width:${Math.max(4, Math.round((a.monto_vendido / max) * 100))}%"></div>
              </div>
              <p class="text-[11px] text-on-surface-variant mt-1">${a.vendidos} ${a.vendidos === 1 ? 'venta' : 'ventas'} · ${a.tasa_cierre}% de cierre</p>
            </li>`
              )
              .join('')}</ol>`
          : '<p class="text-body-sm text-on-surface-variant py-6 text-center">Todavía no hay ventas este mes.</p>'
      }
    </div>`;
}

function productionCard(ops, isAsesor) {
  const active = ops.filter((o) => o.status !== 'entregada');
  const count = (fn) => active.filter(fn).length;
  const vencidas = count((o) => o.alert === 'vencida');
  const riesgo = count((o) => o.alert === 'en_riesgo');
  const bloqueadas = count((o) => o.blocked);
  return `
    <div class="${CARD}">
      ${cardHeader(isAsesor ? 'Producción de mis clientes' : 'Producción', '#/produccion', 'Tablero')}
      <div class="divide-y divide-outline-variant">
        ${statRow('Órdenes abiertas', active.length)}
        ${statRow('En producción', count((o) => o.status === 'en_produccion'))}
        ${statRow('Por validar', count((o) => o.status === 'por_validar'))}
        ${statRow('Listas para entregar', count((o) => o.status === 'lista'))}
        ${statRow('Vencidas', vencidas, vencidas ? 'text-error' : '')}
        ${statRow('Vencen hoy o mañana', riesgo, riesgo ? 'text-primary' : '')}
        ${statRow('Bloqueadas', bloqueadas, bloqueadas ? 'text-error' : '')}
      </div>
    </div>`;
}

function receivablesCard(r) {
  const delivered = r.rows.filter((x) => x.delivered);
  const deliveredTotal = delivered.reduce((s, x) => s + x.balance, 0);
  return `
    <div class="${CARD}">
      ${cardHeader('Cartera por cobrar', '#/finanzas', 'Caja y cartera')}
      <p class="text-[24px] leading-[30px] sm:text-[32px] sm:leading-[38px] font-bold tracking-tight text-on-surface truncate">${formatMoney(r.total)}</p>
      <p class="text-body-sm text-on-surface-variant mt-2">${r.rows.length} ${r.rows.length === 1 ? 'venta con saldo' : 'ventas con saldo'}</p>
      <div class="divide-y divide-outline-variant mt-4">
        ${statRow('Ya entregado, sin pagar', formatMoney(deliveredTotal), deliveredTotal ? 'text-primary' : '')}
        ${statRow('Trabajos entregados', delivered.length)}
      </div>
    </div>`;
}

export async function mount(container, ctx) {
  const apps = visibleApps(ctx.allowedRoutes);
  const role = ctx.user?.role;
  const isManager = role === 'admin' || role === 'coordinador';
  const seesProduction = ctx.allowedRoutes.includes('produccion');

  container.innerHTML = `
    <div class="max-w-6xl mx-auto pb-6">
      <section class="relative overflow-hidden rounded-xl bg-[#0B0B0B] text-[#F2F0EA] px-6 sm:px-10 py-7 sm:py-8 mb-8">
        ${PATTERN}
        <div class="relative max-w-[60%] min-w-[220px]">
          <p class="overline text-[#A7A9AC] first-letter:uppercase">${escapeHtml(today())}</p>
          <h2 class="text-headline-lg font-headline-lg mt-3">${greeting()}, ${escapeHtml(ctx.user?.username || '')}</h2>
          <span class="rule-under mt-4" style="background:#D71920"></span>
        </div>
      </section>

      <div id="ini-resumen" class="mb-10">
        <p class="overline text-on-surface-variant mb-4">Resumen de ${escapeHtml(monthName())}</p>
        <div id="ini-kpis" class="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-4"></div>
        <div id="ini-cards" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4"></div>
        <p id="ini-loading" class="text-body-sm text-on-surface-variant py-6 text-center">Cargando resumen…</p>
      </div>

      <p class="overline text-on-surface-variant mb-4">Aplicaciones</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        ${apps
          .map(
            (a) => `
          <a href="#/${a.firstRoute}" class="group relative overflow-hidden bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col gap-4 hover:border-on-surface transition-colors">
            <span class="absolute top-0 right-0 w-10 h-10 overflow-hidden" aria-hidden="true">
              <span class="absolute -top-2 right-2 w-[7px] h-14 bg-primary rotate-[42.6deg] origin-top translate-x-3 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300"></span>
            </span>
            <span class="relative w-12 h-12 rounded-lg flex items-center justify-center bg-surface-container text-on-surface">
              <span class="material-symbols-outlined text-[28px]" style="font-variation-settings:'FILL' 0,'wght' 300">${a.icon}</span>
              <span class="absolute -bottom-1 -right-1 w-3 h-3 rounded-[2px] bg-primary" aria-hidden="true"></span>
            </span>
            <span>
              <span class="block text-body-md font-bold text-on-surface">${escapeHtml(a.label)}</span>
              <span class="block text-[12px] leading-[16px] text-on-surface-variant mt-1">${escapeHtml(a.desc)}</span>
            </span>
          </a>`
          )
          .join('')}
      </div>
    </div>
  `;

  const resumenEl = container.querySelector('#ini-resumen');
  const kpisEl = container.querySelector('#ini-kpis');
  const cardsEl = container.querySelector('#ini-cards');
  const loadingEl = container.querySelector('#ini-loading');

  if (!isManager && !seesProduction) {
    resumenEl.remove();
    return undefined;
  }

  let alive = true;

  async function load() {
    const { from, to } = monthRange();
    const skip = Promise.resolve(null);
    const [funnel, ops, receivables] = await Promise.allSettled([
      isManager ? ctx.api.get(`/api/kpis/funnel?from=${from}&to=${to}`) : skip,
      seesProduction ? ctx.api.get('/api/production/ops') : skip,
      isManager ? ctx.api.get('/api/cash/receivables') : skip,
    ]);
    if (!alive) return;
    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    const f = val(funnel);
    const o = val(ops);
    const r = val(receivables);

    loadingEl.classList.add('hidden');

    if (f) {
      const t = f.totals;
      const ticket = t.vendidos ? Math.round(t.monto_vendido / t.vendidos) : 0;
      kpisEl.innerHTML = [
        kpiCard('Monto vendido', formatMoney(t.monto_vendido), `${t.vendidos} ${t.vendidos === 1 ? 'venta' : 'ventas'}`, '#/ventas-cerradas'),
        kpiCard('Ticket promedio', formatMoney(ticket), 'Por venta cerrada'),
        kpiCard('Tasa de cierre', `${t.tasa_cierre}%`, `${t.vendidos} de ${t.cotizados} cotizados`),
        kpiCard('Leads asignados', t.asignados, `${t.cotizados} cotizados · ${t.cotizados_sobre_asignados}%`, '#/ventas'),
      ].join('');
    } else {
      kpisEl.innerHTML = '';
    }

    const cards = [];
    if (f) cards.push(topAdvisorsCard(f.advisors || []));
    if (Array.isArray(o)) cards.push(productionCard(o, role === 'asesor'));
    if (r) cards.push(receivablesCard(r));
    cardsEl.innerHTML = cards.join('');

    if (!f && !o && !r) {
      loadingEl.textContent = 'No se pudo cargar el resumen.';
      loadingEl.classList.remove('hidden');
    }
  }

  const offs = [];
  if (isManager) offs.push(ctx.ws.on('leads_changed', load));
  if (seesProduction) offs.push(ctx.ws.on('production_changed', load));
  await load();

  return () => {
    alive = false;
    offs.forEach((off) => off());
  };
}
