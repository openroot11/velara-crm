import { escapeHtml, formatMoney } from '../utils.js';

// CRM › Equipos (como los equipos de ventas de Odoo): un cuadro por vendedor
// con sus oportunidades abiertas, las vencidas, sus cotizaciones activas y
// lo ganado en 30 días, más cuántos clientes le entraron en cada una de las
// últimas 5 semanas. "Flujo" y cada cifra abren el flujo ya filtrado por ese
// vendedor. Datos: GET /api/kpis/teams.

export async function mount(container, ctx) {
  let data = { weeks: [], teams: [] };
  let q = '';

  // De borde a borde, como Odoo: barra de control con borde abajo y los
  // cuadros sobre el gris de la ventana.
  container.classList.add('!p-0'); // de borde a borde (app.js lo quita al salir)
  container.innerHTML = `
    <div class="min-h-full flex flex-col bg-shell">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 bg-surface border-b border-outline-variant">
        <h2 class="text-[17px] font-normal text-on-surface shrink-0 h-8 flex items-center">Equipos</h2>
        <div class="relative flex-1 basis-full sm:basis-auto sm:max-w-[600px] sm:mx-auto order-last sm:order-none">
          <span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none">search</span>
          <input id="eq-q" type="text" autocomplete="off" placeholder="Buscar vendedor…" aria-label="Buscar vendedor" class="w-full h-9 pl-9 pr-3 rounded-md border border-outline-variant bg-surface outline-none focus:border-outline text-body-sm" />
        </div>
        <span id="eq-count" class="text-[13px] text-on-surface-variant tabular-nums ml-auto sm:ml-0"></span>
      </div>
      <div id="eq-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 p-2 sm:p-3 content-start"></div>
    </div>`;
  const grid = container.querySelector('#eq-grid');

  container.querySelector('#eq-q').addEventListener('input', (e) => {
    q = e.target.value.trim().toLowerCase();
    render();
  });

  const flujo = (id, extra = '') => `#/embudo?advisor=${id}${extra}`;

  function stat(href, count, label, value, warn = false) {
    return `
      <a href="${href}" class="flex items-baseline justify-between gap-3 py-0.5 group">
        <span class="text-[13px] ${warn && count ? 'text-error' : 'text-[#2A7F8F] dark:text-[#6FC3CF]'} group-hover:underline truncate">${count} ${escapeHtml(label)}</span>
        <span class="text-[13px] tabular-nums text-on-surface shrink-0">${value == null ? '' : formatMoney(value)}</span>
      </a>`;
  }

  function chart(weeks, labels) {
    const max = Math.max(1, ...weeks);
    return `
      <div class="mt-4 border-t border-outline-variant pt-3" role="img" aria-label="Clientes nuevos por semana: ${labels.map((l, i) => `${l}: ${weeks[i]}`).join(', ')}">
        <div class="grid grid-cols-5 gap-2 items-end h-24">
          ${weeks
            .map(
              (n, i) => `<div class="flex flex-col items-center justify-end h-full" title="${escapeHtml(labels[i])}: ${n} cliente(s) nuevo(s)">
                <span class="text-[11px] tabular-nums text-on-surface-variant mb-1">${n || ''}</span>
                <span class="w-full rounded-t ${i === weeks.length - 1 ? 'bg-[#2A7F8F]/70' : 'bg-[#B5487A]/25 dark:bg-[#B5487A]/40'}" style="height:${n ? Math.max(6, (n / max) * 72) : 2}px"></span>
              </div>`
            )
            .join('')}
        </div>
        <div class="grid grid-cols-5 gap-2 mt-1.5">${labels.map((l) => `<span class="text-[10.5px] text-on-surface-variant text-center truncate">${escapeHtml(l)}</span>`).join('')}</div>
        <p class="text-[11px] text-outline mt-1">Clientes nuevos por semana</p>
      </div>`;
  }

  function render() {
    const teams = data.teams.filter((t) => !q || t.name.toLowerCase().includes(q));
    container.querySelector('#eq-count').textContent = teams.length ? `1-${teams.length} / ${data.teams.length}` : `0 / ${data.teams.length}`;
    grid.innerHTML = teams.length
      ? teams
          .map(
            (t) => `
        <section class="bg-surface border border-outline-variant px-4 pt-3.5 pb-3 ${t.active ? '' : 'opacity-60'}">
          <div class="flex items-start justify-between gap-3 mb-3">
            <h3 class="text-[16px] font-semibold text-on-surface uppercase truncate">${escapeHtml(t.name)}</h3>
            ${t.active ? '' : '<span class="text-[11px] text-outline shrink-0">Pausado</span>'}
          </div>
          <div class="flex gap-5 items-start">
            <a href="${flujo(t.advisor_id)}" class="btn btn-primary shrink-0 !h-8 !px-3">Flujo</a>
            <div class="flex-1 min-w-0">
              ${stat(flujo(t.advisor_id, '&filter=open'), t.open_count, 'Oportunidades abiertas', t.open_value)}
              ${t.overdue_count ? stat(flujo(t.advisor_id, '&filter=today'), t.overdue_count, 'Con próximo paso vencido', null, true) : ''}
              ${stat(flujo(t.advisor_id, '&filter=with_quote'), t.quotes_count, 'Cotizaciones activas', t.quotes_value)}
              ${stat(flujo(t.advisor_id, '&filter=won'), t.won_count, 'Ventas (30 días)', t.won_value)}
            </div>
          </div>
          ${chart(t.weeks, data.weeks)}
        </section>`
          )
          .join('')
      : `<p class="text-body-sm text-on-surface-variant">${data.teams.length ? 'Ningún vendedor coincide con la búsqueda.' : 'No hay vendedores. Agrégalos en Configuración › Equipo de ventas.'}</p>`;
  }

  async function load() {
    try {
      data = await ctx.api.get('/api/kpis/teams');
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
    render();
  }

  const off = ctx.ws.on('leads_changed', load);
  await load();
  return () => off();
}
