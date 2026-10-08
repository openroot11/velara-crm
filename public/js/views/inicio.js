import { escapeHtml, formatMoney, formatCompactMoney } from '../utils.js';

// Inicio al estilo de la referencia (Shakuro CRM): una sola pantalla
// continua, sin secciones ni tarjetas de "aplicaciones". Arriba, pestañas y
// la acción principal; debajo, una franja de cifras separadas por líneas
// finas; luego filtro + búsqueda y la tabla de clientes del embudo
// (GET /api/leads/pipeline) con su etiqueta de estado.
//
// El rol producción no ve el embudo comercial: su inicio es el tablero del
// taller.

const STATUS = {
  asignado: ['Nuevo', 'bg-[#E8F0FE] text-[#1A56C4] dark:bg-[#16264A] dark:text-[#9DBBF5]'],
  contactado: ['Contactado', 'bg-surface-container-high text-on-surface-variant'],
  cotizado: ['Cotizado', 'bg-[#FDF3D8] text-[#8A6100] dark:bg-[#3A2E10] dark:text-[#E9C46A]'],
  cerrado_ganado: ['Ganado', 'bg-[#E3F4E8] text-[#1E7A3C] dark:bg-[#12301F] dark:text-[#6FD39A]'],
  cerrado_perdido: ['Perdido', 'bg-surface-container text-outline'],
};

const TABS = [
  ['abiertos', 'En curso'],
  ['ganados', 'Ganados'],
  ['todos', 'Todos'],
];

function parseUtc(s) {
  return new Date(`${String(s).replace(' ', 'T')}Z`);
}
function ago(utc) {
  if (!utc) return '';
  const mins = Math.floor((Date.now() - parseUtc(utc).getTime()) / 60000);
  if (mins < 60) return `hace ${Math.max(1, mins)} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}
function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function kpi(label, value, sub) {
  return `
    <div class="px-6 py-5 min-w-0">
      <p class="text-[13px] text-on-surface truncate">${label}</p>
      <p class="text-[26px] leading-[32px] font-normal tracking-[-0.02em] text-on-surface mt-2 truncate">${value}</p>
      <p class="text-[12px] text-outline mt-1 truncate">${sub}</p>
    </div>`;
}

export async function mount(container, ctx) {
  if (!ctx.allowedRoutes.includes('embudo')) {
    location.replace('#/trabajos');
    return undefined;
  }
  const isManager = ctx.user?.role === 'admin' || ctx.user?.role === 'coordinador';

  let rows = [];
  let receivables = null;
  let tab = 'abiertos';
  let q = '';
  let alive = true;

  // El contenido va pegado a los bordes del panel (como la referencia): se
  // anula el padding general de la vista solo aquí.
  container.innerHTML = `
    <div class="-m-margin-mobile sm:-m-margin-desktop">
      <div class="flex items-center justify-between gap-3 px-6 border-b border-outline-variant">
        <div id="ini-tabs" class="flex" role="tablist"></div>
        <a href="#/cotizar" class="btn btn-primary my-2.5">Nueva cotización</a>
      </div>
      <div id="ini-kpis" class="grid grid-cols-2 lg:grid-cols-${isManager ? 5 : 4} border-b border-outline-variant lg:divide-x divide-outline-variant"></div>
      <div class="flex items-center gap-4 px-6 h-12 border-b border-outline-variant">
        <span class="flex items-center gap-1.5 text-[13px] text-on-surface"><span class="material-symbols-outlined text-[17px]">filter_list</span>Filtros</span>
        <label class="flex items-center gap-1.5 flex-1 min-w-0 text-outline">
          <span class="material-symbols-outlined text-[17px]">search</span>
          <input id="ini-q" type="search" placeholder="Buscar" autocomplete="off" class="flex-1 min-w-0 !border-0 !bg-transparent !p-0 !ring-0 text-[13px]" />
        </label>
        <span id="ini-count" class="text-[12.5px] text-outline shrink-0"></span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead>
            <tr class="border-b border-outline-variant text-left">
              <th class="pl-6 pr-3 py-3">Nombre</th>
              <th class="px-3 py-3">Servicio</th>
              <th class="px-3 py-3 hidden md:table-cell">Asesor</th>
              <th class="px-3 py-3 hidden lg:table-cell">Ciudad</th>
              <th class="px-3 py-3 hidden sm:table-cell">Entró</th>
              <th class="px-3 pr-6 py-3">Estado</th>
            </tr>
          </thead>
          <tbody id="ini-rows"></tbody>
        </table>
        <p id="ini-empty" class="hidden text-[13px] text-outline text-center py-12"></p>
      </div>
    </div>`;

  const tabsEl = container.querySelector('#ini-tabs');
  const kpisEl = container.querySelector('#ini-kpis');
  const rowsEl = container.querySelector('#ini-rows');
  const emptyEl = container.querySelector('#ini-empty');
  const countEl = container.querySelector('#ini-count');

  function paintTabs() {
    tabsEl.innerHTML = TABS.map(
      ([k, label]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}" class="mr-5 py-3.5 -mb-px border-b-[1.5px] text-[13px] font-medium transition-colors ${
        k === tab ? 'border-on-surface text-on-surface' : 'border-transparent text-outline hover:text-on-surface'
      }">${label}</button>`
    ).join('');
  }
  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    paintTabs();
    paintRows();
  });

  function paintKpis() {
    const open = rows.filter((l) => !l.status.startsWith('cerrado'));
    const won = rows.filter((l) => l.status === 'cerrado_ganado');
    const lost = rows.filter((l) => l.status === 'cerrado_perdido');
    const quoted = open.filter((l) => l.status === 'cotizado');
    const quotedValue = quoted.reduce((s, l) => s + (l.quotation?.amount_total || 0), 0);
    const wonValue = won.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const closed = won.length + lost.length;
    kpisEl.innerHTML = [
      kpi('En conversación', open.length, `${open.filter((l) => l.status === 'asignado').length} sin contactar`),
      kpi('Cotizado por cerrar', formatCompactMoney(quotedValue), `${quoted.length} cotizaciones`),
      kpi('Vendido · 30 días', formatCompactMoney(wonValue), `${won.length} ventas`),
      kpi('Cierre · 30 días', closed ? `${Math.round((won.length / closed) * 100)}%` : '—', `${won.length} de ${closed} cerrados`),
      isManager && receivables ? kpi('Por cobrar', formatCompactMoney(receivables.total), `${receivables.rows.length} ventas con saldo`) : '',
    ].join('');
  }

  function paintRows() {
    const term = q.toLowerCase();
    const list = rows.filter((l) => {
      if (tab === 'abiertos' && l.status.startsWith('cerrado')) return false;
      if (tab === 'ganados' && l.status !== 'cerrado_ganado') return false;
      return !term || [l.client_name, l.phone, l.product, l.city, l.advisor_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
    });
    countEl.textContent = `${list.length} ${list.length === 1 ? 'cliente' : 'clientes'}`;
    emptyEl.classList.toggle('hidden', list.length > 0);
    emptyEl.textContent = term ? 'Nada coincide con la búsqueda.' : 'No hay clientes en esta vista.';
    rowsEl.innerHTML = list
      .map((l) => {
        const [label, cls] = STATUS[l.status] || [l.status, 'bg-surface-container text-on-surface-variant'];
        return `
          <tr data-client="${l.client_id || ''}" class="border-b border-outline-variant cursor-pointer">
            <td class="pl-6 pr-3 py-2.5">
              <span class="flex items-center gap-2.5 min-w-0">
                <span class="w-6 h-6 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-medium flex items-center justify-center shrink-0">${escapeHtml(initials(l.client_name))}</span>
                <span class="truncate text-on-surface">${escapeHtml(l.client_name || '—')}</span>
              </span>
            </td>
            <td class="px-3 py-2.5 text-on-surface truncate max-w-[220px]">${escapeHtml(l.product || '—')}</td>
            <td class="px-3 py-2.5 text-on-surface hidden md:table-cell">${escapeHtml(l.advisor_name || '—')}</td>
            <td class="px-3 py-2.5 text-on-surface hidden lg:table-cell">${escapeHtml(l.city || '—')}</td>
            <td class="px-3 py-2.5 text-outline hidden sm:table-cell whitespace-nowrap">${ago(l.created_at)}</td>
            <td class="px-3 pr-6 py-2.5 whitespace-nowrap">
              <span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[12px] font-medium ${cls}">${label}</span>
              ${l.quotation?.amount_total ? `<span class="text-outline text-[12px] ml-2">${formatMoney(l.quotation.amount_total)}</span>` : ''}
            </td>
          </tr>`;
      })
      .join('');
  }

  rowsEl.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-client]');
    if (!tr) return;
    if (tr.dataset.client) ctx.navigate('clientes', { open: tr.dataset.client });
    else ctx.navigate('embudo');
  });
  container.querySelector('#ini-q').addEventListener('input', (e) => {
    q = e.target.value.trim();
    paintRows();
  });

  async function load() {
    const [pipe, recv] = await Promise.allSettled([
      ctx.api.get('/api/leads/pipeline'),
      isManager ? ctx.api.get('/api/cash/receivables') : Promise.resolve(null),
    ]);
    if (!alive) return;
    if (pipe.status === 'fulfilled') rows = pipe.value.rows || [];
    else ctx.toast(pipe.reason?.message || 'No se pudo cargar el inicio', 'error');
    receivables = recv.status === 'fulfilled' ? recv.value : null;
    paintKpis();
    paintRows();
  }

  paintTabs();
  const off = ctx.ws.on('leads_changed', load);
  await load();

  return () => {
    alive = false;
    off();
  };
}
