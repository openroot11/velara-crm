import { escapeHtml, formatMoney } from '../utils.js';
import { openModal, confirmModal } from '../components/modal.js';
import { openEditLeadModal, deleteLead } from '../components/leadActions.js';
import { SERVICES as VELARA_SERVICES } from '../data/velaraServices.js';

// CRM › Flujo (como el flujo del CRM de Odoo): cada cliente interesado
// avanza Nuevo -> Contactado -> Cotizado -> Ganado (o Perdido), en columnas
// con tarjetas que se arrastran. Arriba: Nuevo, el buscador con chips
// (buscar en todo o por campo, filtros y vendedor) y tarjetas/lista. Las
// cifras del mes viven en CRM › Resumen. Ver GET /api/leads/pipeline.

const STAGES = [
  { key: 'asignado', label: 'Nuevos', icon: 'fiber_new' },
  { key: 'contactado', label: 'Contactados', icon: 'forum' },
  { key: 'cotizado', label: 'Cotizados', icon: 'request_quote' },
  { key: 'cerrado_ganado', label: 'Ganados', icon: 'emoji_events' },
];
const CHANNELS = [
  ['Google Ads', 'Anuncio de Google'],
  ['Orgánico', 'Redes / búsqueda'],
  ['Referido', 'Referido'],
  ['Otro', 'Otro'],
];
const SOURCES = ['WhatsApp', 'Llamada', 'Correo', 'Otro'];
const LOST_REASONS = ['Precio', 'No respondió', 'Se fue con otro taller', 'Ya no lo necesita', 'Tiempo de entrega', 'Otro'];

const inputCls = 'w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline bg-surface-container-lowest';
const labelCls = 'block text-[10px] font-label-bold uppercase tracking-wider text-on-surface-variant mb-1';
const CARD = 'bg-surface-container-lowest border border-outline-variant rounded-xl';

function todayIso(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
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
function daysSince(utc) {
  return utc ? (Date.now() - parseUtc(utc).getTime()) / 86400000 : 0;
}
function shortDate(iso) {
  if (!iso) return '';
  if (iso === todayIso()) return 'hoy';
  if (iso === todayIso(1)) return 'mañana';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
}
function waLink(phone, text = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const full = digits.length === 10 ? `57${digits}` : digits;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
function digits(v) {
  return Number(String(v || '').replace(/\D/g, '')) || 0;
}
function bindMoneyInput(el) {
  const paint = () => {
    const n = digits(el.value);
    el.value = n ? n.toLocaleString('es-CO') : '';
  };
  el.addEventListener('input', paint);
  paint();
}

// Búsqueda como Odoo: lo que se escribe se puede buscar en todo o en un
// campo (Cliente, N.º de cotización…); cada búsqueda queda como un chip.
const SEARCH_FIELDS = [
  ['all', 'Todo'],
  ['client', 'Cliente'],
  ['quote', 'N.º de cotización'],
  ['phone', 'Teléfono o documento'],
  ['product', 'Servicio'],
  ['city', 'Ciudad'],
  ['advisor', 'Vendedor'],
];
function fieldValues(l, field) {
  const by = {
    client: [l.client_name, l.email],
    quote: [l.quotation?.number],
    phone: [l.phone, l.document],
    product: [l.product],
    city: [l.city],
    advisor: [l.advisor_name],
  };
  if (field !== 'all') return by[field] || [];
  return [...Object.values(by).flat(), l.notes, l.source, l.channel_detail, l.lost_reason, l.work_order?.number, l.address];
}
function matchesText(l, field, value) {
  const term = String(value).toLowerCase();
  const digitsTerm = term.replace(/\D/g, '');
  return fieldValues(l, field).some((v) => {
    if (v == null) return false;
    const s = String(v).toLowerCase();
    if (s.includes(term)) return true;
    // Teléfonos y números sin espacios ni guiones: "300 366" encuentra "300366…".
    return digitsTerm.length >= 3 && s.replace(/\D/g, '').includes(digitsTerm);
  });
}

// Lo que hay que atender hoy (mismo criterio que la lista "Para hoy").
function needsAttention(l) {
  if (l.status.startsWith('cerrado')) return false;
  if (l.action_due) return true;
  if (l.status === 'asignado' && daysSince(l.created_at) > 0.04) return true;
  return l.status === 'cotizado' && ['pendiente', 'urgente'].includes(l.followup_status);
}
// Color de la tarjeta en la barra de su columna (como Odoo): rojo = urgente,
// amarillo = pendiente, verde = con próximo paso al día, gris = nada.
function heat(l) {
  if (l.status.startsWith('cerrado')) return 'none';
  if (l.action_due || l.followup_status === 'urgente' || (l.status === 'asignado' && daysSince(l.created_at) > 1)) return 'red';
  if (needsAttention(l)) return 'amber';
  if (l.next_action_at) return 'green';
  return 'none';
}
const HEAT_CLS = { red: 'bg-error', amber: 'bg-[#E9A23B]', green: 'bg-status-good', none: 'bg-outline-variant' };

// A qué etapas se puede arrastrar una tarjeta (el embudo solo avanza).
const MOVES = {
  asignado: ['contactado', 'cotizado', 'cerrado_ganado', 'cerrado_perdido'],
  contactado: ['cotizado', 'cerrado_ganado', 'cerrado_perdido'],
  cotizado: ['cerrado_ganado', 'cerrado_perdido'],
};
const STAGE_LABEL = { asignado: 'Nuevos', contactado: 'Contactados', cotizado: 'Cotizados', cerrado_ganado: 'Ganados', cerrado_perdido: 'Perdidos' };

const AVATAR_COLORS = ['#E4572E', '#2A7F8F', '#8E6BBF', '#3F9C6B', '#C7420E', '#3E7CB1', '#B5487A', '#D9922E'];
function avatarColor(id) {
  return AVATAR_COLORS[(Number(id) || 0) % AVATAR_COLORS.length];
}

export async function mount(container, ctx) {
  let data = { rows: [] };
  let advisors = [];
  let view = 'kanban';
  let lostOpen = false;
  let typed = '';
  let panelOpen = false;
  let suggestIdx = 0;
  // Chips activos: { kind: 'text', field, value } | { kind: 'filter', key } | { kind: 'advisor', id, name }
  let facets = [];
  const myAdvisor = ctx.user?.advisor_id || null;
  const isManager = ctx.user?.role !== 'asesor';

  // Filtros del panel, por grupos (como Odoo): dentro de un grupo se suman
  // ("o"), entre grupos se cruzan ("y").
  const FILTER_GROUPS = [
    [
      ...(myAdvisor ? [['mine', 'Mi flujo', (l) => l.assigned_advisor_id === myAdvisor]] : []),
      ...(isManager ? [['unassigned', 'Sin asignar', (l) => !l.assigned_advisor_id]] : []),
    ],
    [
      ['today', 'Para hoy', needsAttention],
      ['with_quote', 'Con cotización', (l) => !!l.quotation],
    ],
    [
      ['open', 'En curso', (l) => !l.status.startsWith('cerrado')],
      ['won', 'Ganados', (l) => l.status === 'cerrado_ganado'],
      ['lost', 'Perdidos', (l) => l.status === 'cerrado_perdido'],
    ],
  ].filter((g) => g.length);
  const FILTERS = new Map(FILTER_GROUPS.flat().map((f) => [f[0], f]));

  // Desde Equipos u otra pantalla: #/embudo?advisor=3&filter=today
  const pAdvisor = Number(ctx.routeParams.get('advisor'));
  const pFilter = ctx.routeParams.get('filter');
  const pView = ctx.routeParams.get('view');
  if (pFilter && FILTERS.has(pFilter)) facets.push({ kind: 'filter', key: pFilter });
  if (pView === 'list') view = 'list';

  async function load() {
    try {
      data = await ctx.api.get('/api/leads/pipeline');
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
    renderBoard();
  }

  function applyFacets(rows, extraText) {
    const groupsOn = FILTER_GROUPS.map((g) => g.filter(([k]) => facets.some((f) => f.kind === 'filter' && f.key === k))).filter((g) => g.length);
    const advisorIds = facets.filter((f) => f.kind === 'advisor').map((f) => f.id);
    const byField = new Map();
    for (const f of facets.filter((x) => x.kind === 'text')) byField.set(f.field, [...(byField.get(f.field) || []), f.value]);
    return rows.filter((l) => {
      if (advisorIds.length && !advisorIds.includes(l.assigned_advisor_id)) return false;
      for (const g of groupsOn) if (!g.some(([, , fn]) => fn(l))) return false;
      for (const [field, values] of byField) if (!values.some((v) => matchesText(l, field, v))) return false;
      if (extraText && !matchesText(l, 'all', extraText)) return false;
      return true;
    });
  }

  // ---- panel de control (Nuevo · título · buscador · vistas) -------------------
  // De borde a borde, como Odoo: barra de control blanca con borde abajo y,
  // debajo, el tablero sobre el gris de la ventana (se anula el padding de
  // la vista solo aquí).
  // Sin el relleno de la vista: la barra y el tablero van de borde a borde
  // (app.js lo vuelve a poner al cambiar de pantalla).
  container.classList.add('!p-0');
  container.innerHTML = `
    <div class="min-h-full flex flex-col bg-shell">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 bg-surface border-b border-outline-variant">
        <div class="flex items-center gap-2.5 shrink-0">
          <button id="em-new" class="btn btn-primary !h-8 !px-3">Nuevo</button>
          <h2 class="text-[17px] font-normal text-on-surface">Flujo</h2>
        </div>
        <div id="em-search" class="relative order-last sm:order-none basis-full sm:basis-auto flex-1 sm:max-w-[600px] sm:mx-auto"></div>
        <div class="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
          <span id="em-pager" class="hidden md:inline text-[13px] text-on-surface-variant tabular-nums"></span>
          <div class="flex rounded-md border border-outline-variant overflow-hidden" role="group" aria-label="Vista">
            <button type="button" data-view="kanban" class="w-9 h-8 inline-flex items-center justify-center text-on-surface-variant" title="Tarjetas" aria-label="Vista en tarjetas"><span class="material-symbols-outlined text-[19px]">view_kanban</span></button>
            <button type="button" data-view="list" class="w-9 h-8 inline-flex items-center justify-center text-on-surface-variant border-l border-outline-variant" title="Lista" aria-label="Vista en lista"><span class="material-symbols-outlined text-[19px]">view_list</span></button>
          </div>
        </div>
      </div>
      <div id="em-board" class="flex-1 flex flex-col"></div>
    </div>`;
  const searchEl = container.querySelector('#em-search');
  const boardEl = container.querySelector('#em-board');

  container.querySelector('#em-new').addEventListener('click', openNewLead);
  container.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view;
      paintViewButtons();
      renderBoard();
    })
  );
  function paintViewButtons() {
    container.querySelectorAll('[data-view]').forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle('bg-surface-container-high', on);
      b.classList.toggle('text-on-surface', on);
      b.classList.toggle('text-on-surface-variant', !on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  paintViewButtons();

  function chipLabel(group) {
    if (group.kind === 'filter') return { icon: 'filter_alt', text: group.items.map((f) => FILTERS.get(f.key)?.[1] || f.key).join(' o ') };
    if (group.kind === 'advisor') return { icon: 'person', text: `Vendedor: ${group.items.map((f) => f.name).join(' o ')}` };
    const field = SEARCH_FIELDS.find(([k]) => k === group.field)?.[1] || '';
    return { icon: 'search', text: `${group.field === 'all' ? '' : `${field}: `}${group.items.map((f) => f.value).join(' o ')}` };
  }
  // Un chip por grupo de filtros, por vendedor y por campo de búsqueda.
  function chipGroups() {
    const out = [];
    for (const g of FILTER_GROUPS) {
      const items = facets.filter((f) => f.kind === 'filter' && g.some(([k]) => k === f.key));
      if (items.length) out.push({ kind: 'filter', items, keys: items.map((f) => f.key) });
    }
    const adv = facets.filter((f) => f.kind === 'advisor');
    if (adv.length) out.push({ kind: 'advisor', items: adv });
    for (const [field] of SEARCH_FIELDS) {
      const items = facets.filter((f) => f.kind === 'text' && f.field === field);
      if (items.length) out.push({ kind: 'text', field, items });
    }
    return out;
  }
  function removeGroup(g) {
    facets = facets.filter((f) => !g.items.includes(f));
  }

  function renderSearch() {
    const groups = chipGroups();
    searchEl.innerHTML = `
      <div class="flex items-center gap-1 flex-wrap min-h-[34px] pl-2.5 pr-9 py-0.5 rounded-md border border-outline-variant bg-surface focus-within:border-outline">
        <span class="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden="true">search</span>
        ${groups
          .map((g, i) => {
            const { icon, text } = chipLabel(g);
            return `<span class="inline-flex items-center gap-1 h-6 pl-1.5 pr-1 rounded-md bg-surface-container-high text-[12px] text-on-surface max-w-full">
              <span class="material-symbols-outlined text-[14px] text-on-surface-variant" aria-hidden="true">${icon}</span><span class="truncate">${escapeHtml(text)}</span>
              <button type="button" data-chip="${i}" class="w-4 h-4 inline-flex items-center justify-center rounded hover:bg-surface-container-highest" aria-label="Quitar filtro ${escapeHtml(text)}"><span class="material-symbols-outlined text-[14px]">close</span></button>
            </span>`;
          })
          .join('')}
        <input id="em-q" type="text" autocomplete="off" value="${escapeHtml(typed)}" placeholder="${groups.length ? '' : 'Buscar cliente, cotización, teléfono…'}" aria-label="Buscar en el flujo" class="flex-1 min-w-[120px] h-7 bg-transparent outline-none text-body-sm" />
      </div>
      <button type="button" id="em-toggle" aria-expanded="${panelOpen}" aria-label="Filtros y vendedores" class="absolute right-1 top-1 w-7 h-7 rounded-md inline-flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low"><span class="material-symbols-outlined text-[20px]">${panelOpen ? 'arrow_drop_up' : 'arrow_drop_down'}</span></button>
      <div id="em-pop"></div>`;

    const input = searchEl.querySelector('#em-q');
    searchEl.querySelectorAll('[data-chip]').forEach((b) =>
      b.addEventListener('click', () => {
        removeGroup(groups[Number(b.dataset.chip)]);
        refresh();
        searchEl.querySelector('#em-q')?.focus();
      })
    );
    searchEl.querySelector('#em-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      panelOpen = !panelOpen;
      typed = input.value;
      renderSearch();
    });
    input.addEventListener('input', () => {
      typed = input.value;
      suggestIdx = 0;
      panelOpen = false;
      paintPop();
      renderBoard();
      searchEl.querySelector('#em-toggle .material-symbols-outlined').textContent = 'arrow_drop_down';
    });
    input.addEventListener('keydown', (e) => {
      const term = input.value.trim();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (term) addText(SEARCH_FIELDS[suggestIdx][0], term);
      } else if (e.key === 'ArrowDown' && term) {
        e.preventDefault();
        suggestIdx = (suggestIdx + 1) % SEARCH_FIELDS.length;
        paintPop();
      } else if (e.key === 'ArrowUp' && term) {
        e.preventDefault();
        suggestIdx = (suggestIdx - 1 + SEARCH_FIELDS.length) % SEARCH_FIELDS.length;
        paintPop();
      } else if (e.key === 'Backspace' && !input.value && groups.length) {
        removeGroup(groups[groups.length - 1]);
        refresh();
        searchEl.querySelector('#em-q')?.focus();
      } else if (e.key === 'Escape') {
        panelOpen = false;
        typed = '';
        input.value = '';
        paintPop();
        renderBoard();
      }
    });
    paintPop();
  }

  function addText(field, value) {
    facets.push({ kind: 'text', field, value });
    typed = '';
    suggestIdx = 0;
    refresh();
    searchEl.querySelector('#em-q')?.focus();
  }

  // Desplegable debajo del buscador: sugerencias de búsqueda mientras se
  // escribe, o el panel de filtros y vendedores con el botón ▾.
  function paintPop() {
    const pop = searchEl.querySelector('#em-pop');
    if (!pop) return;
    const term = typed.trim();
    const box = 'absolute left-0 right-0 top-full mt-1 z-40 rounded-xl bg-surface shadow-[var(--shadow-pop)] overflow-hidden';
    if (term && !panelOpen) {
      pop.innerHTML = `<div class="${box} py-1" role="listbox">
        ${SEARCH_FIELDS.map(
          ([k, label], i) => `<button type="button" data-sug="${k}" role="option" aria-selected="${i === suggestIdx}" class="w-full text-left px-3 py-1.5 text-body-sm ${i === suggestIdx ? 'bg-surface-container-low' : 'hover:bg-surface-container-low'}">
            Buscar <b>${label}</b> para: <i class="not-italic font-semibold text-on-surface">${escapeHtml(term)}</i>
          </button>`
        ).join('')}
      </div>`;
      pop.querySelectorAll('[data-sug]').forEach((b) =>
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          addText(b.dataset.sug, term);
        })
      );
      return;
    }
    if (!panelOpen) {
      pop.innerHTML = '';
      return;
    }
    const isOn = (k) => facets.some((f) => f.kind === 'filter' && f.key === k);
    const advOn = (id) => facets.some((f) => f.kind === 'advisor' && f.id === id);
    const counts = (fn) => data.rows.filter(fn).length;
    const item = (attr, label, on, count) => `
      <button type="button" ${attr} class="w-full text-left px-3 py-1.5 text-body-sm flex items-center gap-2 hover:bg-surface-container-low">
        <span class="material-symbols-outlined text-[16px] ${on ? 'text-on-surface' : 'text-transparent'}" aria-hidden="true">check</span>
        <span class="flex-1 ${on ? 'font-semibold text-on-surface' : 'text-on-surface-variant'}">${escapeHtml(label)}</span>
        ${count != null ? `<span class="text-[11px] text-outline">${count}</span>` : ''}
      </button>`;
    pop.innerHTML = `<div class="${box} grid grid-cols-1 ${isManager && advisors.length ? 'sm:grid-cols-2' : ''} divide-y sm:divide-y-0 sm:divide-x divide-outline-variant">
      <div class="py-2">
        <p class="px-3 pb-1 text-[11px] font-semibold text-on-surface flex items-center gap-1"><span class="material-symbols-outlined text-[15px]">filter_alt</span>Filtros</p>
        ${FILTER_GROUPS.map((g, gi) => `${gi ? '<div class="my-1 mx-3 border-t border-outline-variant"></div>' : ''}${g.map(([k, label, fn]) => item(`data-flt="${k}"`, label, isOn(k), counts(fn))).join('')}`).join('')}
      </div>
      ${
        isManager && advisors.length
          ? `<div class="py-2">
               <p class="px-3 pb-1 text-[11px] font-semibold text-on-surface flex items-center gap-1"><span class="material-symbols-outlined text-[15px]">person</span>Vendedor</p>
               ${advisors.map((a) => item(`data-adv="${a.id}"`, a.name, advOn(a.id), counts((l) => l.assigned_advisor_id === a.id))).join('')}
             </div>`
          : ''
      }
    </div>`;
    pop.querySelectorAll('[data-flt]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = b.dataset.flt;
        facets = isOn(k) ? facets.filter((f) => !(f.kind === 'filter' && f.key === k)) : [...facets, { kind: 'filter', key: k }];
        refresh();
      })
    );
    pop.querySelectorAll('[data-adv]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(b.dataset.adv);
        const a = advisors.find((x) => x.id === id);
        facets = advOn(id) ? facets.filter((f) => !(f.kind === 'advisor' && f.id === id)) : [...facets, { kind: 'advisor', id, name: a.name }];
        refresh();
      })
    );
  }

  function refresh() {
    renderSearch();
    renderBoard();
  }

  function onDocClick(e) {
    if (!searchEl.contains(e.target) && (panelOpen || typed)) {
      if (panelOpen) {
        panelOpen = false;
        renderSearch();
      } else {
        const pop = searchEl.querySelector('#em-pop');
        if (pop) pop.innerHTML = '';
      }
    }
  }
  document.addEventListener('click', onDocClick);

  // ---- tablero ------------------------------------------------------------------
  function renderBoard() {
    const rows = applyFacets(data.rows, typed.trim());
    const pager = container.querySelector('#em-pager');
    if (pager) pager.textContent = rows.length ? `1-${rows.length} / ${rows.length}` : '0 / 0';
    if (view === 'list') return renderList(rows);
    // Columnas como Odoo: ~300 px, separadas 24 px, título en negrita con
    // "+" a la derecha, barra fina con el total y tarjetas apiladas.
    const column = (s, foldable = false) => {
      const list = rows.filter((l) => l.status === s.key);
      const total = list.reduce((sum, l) => sum + (s.key === 'cerrado_ganado' ? Number(l.amount) || 0 : l.quotation?.amount_total || 0), 0);
      const tally = { red: 0, amber: 0, green: 0, none: 0 };
      list.forEach((l) => tally[heat(l)]++);
      const bar = list.length
        ? ['green', 'amber', 'red', 'none']
            .filter((k) => tally[k])
            .map((k) => `<span class="${HEAT_CLS[k]} h-full" style="width:${(tally[k] / list.length) * 100}%" title="${tally[k]}"></span>`)
            .join('')
        : '';
      return `
        <section data-drop="${s.key}" class="em-col shrink-0 w-[85vw] sm:w-[300px] flex flex-col transition-colors rounded-sm">
          <header class="pt-1 pb-2.5">
            <div class="flex items-center justify-between gap-2 h-7">
              <h3 class="text-[15px] font-semibold text-on-surface truncate">${s.label}</h3>
              ${s.key === 'asignado' ? '<button type="button" data-quick class="w-7 h-7 inline-flex items-center justify-center rounded text-on-surface-variant hover:bg-surface-container-high" aria-label="Nuevo cliente" title="Nuevo cliente"><span class="material-symbols-outlined text-[20px]">add</span></button>' : ''}
              ${foldable ? '<button type="button" data-fold class="w-7 h-7 inline-flex items-center justify-center rounded text-on-surface-variant hover:bg-surface-container-high" aria-label="Plegar Perdidos" title="Plegar"><span class="material-symbols-outlined text-[20px]">chevron_left</span></button>' : ''}
            </div>
            <div class="flex items-center gap-3 mt-1">
              <div class="flex-1 h-[7px] rounded-sm bg-surface-container-high overflow-hidden flex">${bar}</div>
              <span class="text-[12px] tabular-nums w-auto text-right ${total || list.length ? 'font-semibold text-on-surface' : 'text-outline'}">${total ? formatMoney(total) : list.length}</span>
            </div>
          </header>
          <div class="flex flex-col flex-1 min-h-[160px]">
            ${list.map(cardHtml).join('')}
          </div>
        </section>`;
    };
    const lostList = rows.filter((l) => l.status === 'cerrado_perdido');
    boardEl.innerHTML = `
      <div class="flex-1 flex gap-6 overflow-x-auto px-3 sm:px-4 pt-3 pb-6 items-stretch" title="Arrastra una tarjeta a otra columna para avanzarla">
        ${STAGES.map((s) => column(s)).join('')}
        ${
          lostOpen
            ? column({ key: 'cerrado_perdido', label: 'Perdidos' }, true)
            : `<button type="button" data-drop="cerrado_perdido" data-fold class="em-col shrink-0 w-9 self-start flex flex-col items-center gap-3 pt-2 pb-4 rounded-sm text-on-surface-variant hover:bg-surface-container-high transition-colors" title="Perdidos (últimos 30 días)" aria-label="Ver Perdidos">
                 <span class="text-[12px] font-semibold tabular-nums">${lostList.length}</span>
                 <span class="text-[15px] font-semibold [writing-mode:vertical-rl]">Perdidos</span>
               </button>`
        }
      </div>`;

    boardEl.querySelector('[data-quick]')?.addEventListener('click', openNewLead);
    boardEl.querySelectorAll('[data-fold]').forEach((el) =>
      el.addEventListener('click', () => {
        lostOpen = !lostOpen;
        renderBoard();
      })
    );
    wireCards();
    wireDnd();
  }

  // Lista como la de Odoo: de borde a borde, filas de 41 px con borde abajo,
  // casilla a la izquierda y el total del valor al pie.
  function renderList(rows) {
    const th = 'h-10 px-3 text-left text-[13.5px] font-semibold text-on-surface whitespace-nowrap';
    const td = 'h-[41px] px-3 whitespace-nowrap';
    const value = (l) => (l.status === 'cerrado_ganado' ? Number(l.amount) || 0 : l.quotation?.amount_total || 0);
    const total = rows.reduce((s, l) => s + value(l), 0);
    boardEl.innerHTML = `
      <div class="flex-1 overflow-x-auto bg-surface">
        <table class="w-full text-[13.5px]">
          <thead class="border-b border-outline-variant"><tr>
            <th class="w-10 pl-3 sm:pl-4"><input type="checkbox" aria-label="Seleccionar todos" class="align-middle" /></th>
            <th class="${th}">Oportunidad</th><th class="${th}">Teléfono</th><th class="${th}">Correo electrónico</th>
            <th class="${th}">Vendedor</th><th class="${th} text-right">Ingreso esperado</th><th class="${th}">Etapa</th><th class="${th}">Próximo paso</th>
          </tr></thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map(
                      (l) => `<tr data-open="${l.id}" class="border-b border-outline-variant cursor-pointer hover:bg-surface-container-low">
                        <td class="pl-3 sm:pl-4" data-stop><input type="checkbox" aria-label="Seleccionar ${escapeHtml(l.client_name)}" class="align-middle" /></td>
                        <td class="${td} text-on-surface">${escapeHtml([l.quotation?.number, l.client_name].filter(Boolean).join(' · '))}<span class="text-on-surface-variant">${l.product ? ` · ${escapeHtml(l.product)}` : ''}</span></td>
                        <td class="${td} text-on-surface">${escapeHtml(l.phone || '')}</td>
                        <td class="${td} text-on-surface">${escapeHtml(l.email || '')}</td>
                        <td class="${td} text-on-surface"><span class="inline-flex items-center gap-2"><span class="w-6 h-6 rounded text-white text-[11px] font-semibold inline-flex items-center justify-center" style="background:${l.assigned_advisor_id ? avatarColor(l.assigned_advisor_id) : '#A7A9AC'}">${escapeHtml((l.advisor_name || '?').slice(0, 1).toUpperCase())}</span>${escapeHtml(l.advisor_name || 'Sin asignar')}</span></td>
                        <td class="${td} text-right tabular-nums text-on-surface">${formatMoney(value(l))}</td>
                        <td class="${td} font-semibold text-on-surface uppercase text-[13px]">${STAGE_LABEL[l.status] || l.status}</td>
                        <td class="${td} ${l.action_due ? 'text-error' : 'text-on-surface-variant'}">${l.next_action_at ? `${shortDate(l.next_action_at)}${l.next_action_note ? ` · ${escapeHtml(l.next_action_note)}` : ''}` : ''}</td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="8" class="px-4 py-10 text-center text-on-surface-variant">Ningún cliente coincide con la búsqueda.</td></tr>'
            }
          </tbody>
          ${rows.length ? `<tfoot><tr><td></td><td colspan="4"></td><td class="${td} text-right tabular-nums font-semibold text-on-surface">${formatMoney(total)}</td><td colspan="2"></td></tr></tfoot>` : ''}
        </table>
      </div>`;
    wireCards();
  }

  function wireCards() {
    boardEl.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => openLead(data.rows.find((l) => l.id === Number(el.dataset.open)))));
  }

  // ---- arrastrar y soltar --------------------------------------------------------
  // Con el mouse se arrastra la tarjeta a otra columna; en teléfono se abre la
  // tarjeta y se usan sus botones (Ya le escribí, Cotizar, Ganado, Perdido).
  let dragLead = null;
  function wireDnd() {
    boardEl.querySelectorAll('[draggable="true"]').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        dragLead = data.rows.find((l) => l.id === Number(card.dataset.open));
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragLead?.id || ''));
        requestAnimationFrame(() => card.classList.add('opacity-40'));
        const ok = MOVES[dragLead?.status] || [];
        boardEl.querySelectorAll('[data-drop]').forEach((col) => {
          if (col.dataset.drop !== dragLead?.status && !ok.includes(col.dataset.drop)) col.classList.add('opacity-50');
        });
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('opacity-40');
        boardEl.querySelectorAll('[data-drop]').forEach((col) => col.classList.remove('opacity-50', 'bg-surface-container-high', 'ring-2', 'ring-outline'));
        dragLead = null;
      });
    });
    boardEl.querySelectorAll('[data-drop]').forEach((col) => {
      const allowed = () => dragLead && (MOVES[dragLead.status] || []).includes(col.dataset.drop);
      col.addEventListener('dragover', (e) => {
        if (!allowed()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('bg-surface-container-high', 'ring-2', 'ring-outline');
      });
      col.addEventListener('dragleave', (e) => {
        if (!col.contains(e.relatedTarget)) col.classList.remove('bg-surface-container-high', 'ring-2', 'ring-outline');
      });
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        const lead = dragLead;
        col.classList.remove('bg-surface-container-high', 'ring-2', 'ring-outline');
        if (lead && allowed()) moveLead(lead, col.dataset.drop);
      });
    });
  }

  async function moveLead(lead, to) {
    if (to === 'contactado') return act('contact', lead);
    if (to === 'cerrado_ganado') return openWon(lead);
    if (to === 'cerrado_perdido') return openLost(lead);
    if (to === 'cotizado') {
      openModal({
        title: `Cotizado · ${escapeHtml(lead.client_name)}`,
        variant: 'center',
        render: (body, { close }) => {
          body.innerHTML = `
            <p class="text-body-sm text-on-surface-variant mb-4">${escapeHtml(lead.client_name)} todavía no tiene una cotización en el CRM.</p>
            <div class="flex flex-col gap-2">
              <button type="button" id="mv-quote" class="btn btn-primary justify-center"><span class="material-symbols-outlined">request_quote</span>Hacer la cotización</button>
              <button type="button" id="mv-mark" class="btn btn-secondary justify-center">Solo pasarlo a Cotizados</button>
            </div>`;
          body.querySelector('#mv-quote').addEventListener('click', () => {
            close();
            ctx.navigate('cotizar', { lead: lead.id });
          });
          body.querySelector('#mv-mark').addEventListener('click', async () => {
            try {
              await ctx.api.patch(`/api/leads/${lead.id}/quote`, {});
              ctx.toast(`${lead.client_name} → Cotizados`, 'success');
              close();
              load();
            } catch (err) {
              ctx.toast(err.message, 'error');
            }
          });
        },
      });
    }
  }

  // Tarjeta como en Odoo: esquinas casi rectas, apiladas sin espacio (los
  // bordes se tocan), título en negrita, servicio y cotización debajo y, en
  // la fila de abajo, el reloj del próximo paso y la inicial del vendedor.
  function cardHtml(l) {
    const quote = l.quotation;
    const closed = l.status.startsWith('cerrado');
    const value = l.status === 'cerrado_ganado' ? Number(l.amount) || 0 : quote?.amount_total || 0;
    const h = heat(l);
    const clockCls = l.action_due ? 'text-error' : l.next_action_at ? 'text-status-good' : 'text-on-surface-variant';
    const clockTitle = l.next_action_at ? `${shortDate(l.next_action_at)}${l.next_action_note ? ` · ${l.next_action_note}` : ''}` : 'Sin próximo paso';
    const title = [quote?.number, l.client_name].filter(Boolean).join(' · ');
    const note =
      l.status === 'cotizado' && ['pendiente', 'urgente'].includes(l.followup_status) && !l.next_action_at
        ? `<p class="text-[12px] mt-0.5 ${l.followup_status === 'urgente' ? 'text-error' : 'text-[#B7791F]'}">Falta seguimiento</p>`
        : l.status === 'asignado' && daysSince(l.created_at) > 0.04
          ? `<p class="text-[12px] mt-0.5 ${h === 'red' ? 'text-error' : 'text-[#B7791F]'}">Escribió ${ago(l.created_at)}, sin contestar</p>`
          : l.status === 'cerrado_perdido' && l.lost_reason
            ? `<p class="text-[12px] mt-0.5 text-on-surface-variant truncate">${escapeHtml(l.lost_reason)}</p>`
            : '';
    return `
      <article data-open="${l.id}" ${closed ? '' : 'draggable="true"'} class="relative -mt-px first:mt-0 bg-surface border border-outline-variant px-2.5 pt-2 pb-2 ${closed ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} hover:z-10 hover:shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition-shadow">
        <p class="text-[14px] font-semibold text-on-surface leading-snug">${escapeHtml(title)}</p>
        <p class="text-[13px] text-on-surface-variant truncate">${escapeHtml(l.product || 'Sin servicio definido')}</p>
        ${value ? `<p class="text-[13px] text-on-surface tabular-nums">${formatMoney(value)}</p>` : ''}
        ${note}
        ${l.status === 'cerrado_ganado' && l.work_order ? `<a href="#/trabajos?id=${l.work_order.id}" data-stop class="inline-flex items-center gap-1 text-[12px] underline text-on-surface"><span class="material-symbols-outlined text-[14px]">construction</span>${escapeHtml(l.work_order.number)}</a>` : ''}
        <div class="flex items-center gap-2 mt-1.5">
          <span class="material-symbols-outlined text-[18px] ${clockCls}" title="${escapeHtml(clockTitle)}" aria-label="${escapeHtml(clockTitle)}">schedule</span>
          ${waLink(l.phone) ? `<a href="${waLink(l.phone)}" target="_blank" rel="noopener" data-stop class="text-on-surface-variant hover:text-on-surface" title="Escribir por WhatsApp" aria-label="Escribir por WhatsApp"><span class="material-symbols-outlined text-[18px]">chat</span></a>` : ''}
          <span class="ml-auto text-[11.5px] text-outline">${closed ? ago(l.closed_at) : ago(l.created_at)}</span>
          <span class="w-6 h-6 rounded text-white text-[12px] font-semibold flex items-center justify-center" style="background:${l.assigned_advisor_id ? avatarColor(l.assigned_advisor_id) : '#A7A9AC'}" title="${escapeHtml(l.advisor_name || 'Sin asignar')}">${escapeHtml((l.advisor_name || '?').slice(0, 1).toUpperCase())}</span>
        </div>
      </article>`;
  }

  async function act(action, lead) {
    try {
      if (action === 'contact') {
        await ctx.api.patch(`/api/leads/${lead.id}/contact`, {});
        ctx.toast(`${lead.client_name} → Contactado`, 'success');
      } else if (action === 'quote') {
        return ctx.navigate('cotizar', { lead: lead.id });
      } else if (action === 'followup') {
        return openFollowup(lead);
      } else if (action === 'won') {
        return openWon(lead);
      } else if (action === 'job') {
        return openWon(lead, true);
      } else if (action === 'lost') {
        return openLost(lead);
      }
      load();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  // ---- nuevo cliente -------------------------------------------------------------------------
  function openNewLead() {
    openModal({
      title: 'Nuevo cliente interesado',
      wide: true,
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="${labelCls}">Nombre</label><input id="nl-name" type="text" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Celular</label><input id="nl-phone" type="tel" inputmode="tel" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Qué necesita</label><select id="nl-product" class="${inputCls}">${VELARA_SERVICES.map((s) => `<option>${escapeHtml(s.title)}</option>`).join('')}<option>Otro</option></select></div>
            <div><label class="${labelCls}">Ciudad</label><input id="nl-city" type="text" value="Barranquilla" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Cómo nos conoció</label><select id="nl-channel" class="${inputCls}">${CHANNELS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
            <div><label class="${labelCls}">Por dónde escribió</label><select id="nl-source" class="${inputCls}">${SOURCES.map((s) => `<option>${s}</option>`).join('')}</select></div>
            <div class="sm:col-span-2"><label class="${labelCls}">Notas</label><textarea id="nl-notes" rows="2" class="${inputCls}" placeholder="Ej. Duster 2019, quiere cuero café"></textarea></div>
          </div>
          <div class="flex justify-end gap-2 mt-5 flex-wrap">
            <button id="nl-cancel" class="btn btn-ghost">Cancelar</button>
            <button id="nl-save" class="btn btn-secondary">Guardar</button>
            <button id="nl-quote" class="btn btn-primary">Guardar y cotizar</button>
          </div>`;
        body.querySelector('#nl-cancel').addEventListener('click', close);
        const save = async (thenQuote) => {
          try {
            const lead = await ctx.api.post('/api/leads', {
              client_name: body.querySelector('#nl-name').value,
              phone: body.querySelector('#nl-phone').value,
              product: body.querySelector('#nl-product').value,
              city: body.querySelector('#nl-city').value,
              channel_detail: body.querySelector('#nl-channel').value,
              source: body.querySelector('#nl-source').value,
              notes: body.querySelector('#nl-notes').value,
            });
            close();
            if (thenQuote) ctx.navigate('cotizar', { lead: lead.id });
            else {
              ctx.toast('Cliente agregado', 'success');
              load();
            }
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        };
        body.querySelector('#nl-save').addEventListener('click', () => save(false));
        body.querySelector('#nl-quote').addEventListener('click', () => save(true));
      },
    });
  }

  // ---- ficha rápida ---------------------------------------------------------------------------
  function openLead(lead) {
    if (!lead) return;
    const closed = lead.status.startsWith('cerrado');
    openModal({
      title: escapeHtml(lead.client_name),
      wide: true,
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="flex flex-wrap gap-x-6 gap-y-2 text-body-sm mb-4">
            <span><span class="text-on-surface-variant">Celular:</span> ${escapeHtml(lead.phone || '—')}</span>
            <span><span class="text-on-surface-variant">Necesita:</span> ${escapeHtml(lead.product || '—')}</span>
            <span><span class="text-on-surface-variant">Ciudad:</span> ${escapeHtml(lead.city || '—')}</span>
            <span><span class="text-on-surface-variant">Entró:</span> ${ago(lead.created_at)} por ${escapeHtml(lead.source || '—')}</span>
          </div>
          ${lead.notes ? `<p class="text-body-sm text-on-surface bg-surface-container-low rounded-lg px-3 py-2 mb-4 whitespace-pre-line">${escapeHtml(lead.notes)}</p>` : ''}
          ${lead.quotation ? `<a href="#/cotizar?quotation=${lead.quotation.id}" class="flex items-center justify-between gap-3 rounded-lg border border-outline-variant px-3 py-2.5 mb-4 hover:bg-surface-container-low"><span class="text-body-sm"><b>${escapeHtml(lead.quotation.number || 'Cotización')}</b> · ${formatMoney(lead.quotation.amount_total)}</span><span class="text-[12px] text-on-surface-variant">Abrir ›</span></a>` : ''}
          ${lead.status === 'cerrado_perdido' ? `<p class="text-body-sm text-error mb-4">Perdido${lead.lost_reason ? `: ${escapeHtml(lead.lost_reason)}` : ''}.</p>` : ''}
          ${!closed ? `
          <div class="rounded-lg border border-outline-variant p-3 mb-4">
            <p class="${labelCls}">Próximo paso</p>
            <div class="flex flex-wrap gap-2 items-end">
              <input id="ld-next-date" type="date" value="${lead.next_action_at ? lead.next_action_at.slice(0, 10) : todayIso(2)}" class="${inputCls} !w-auto" />
              <input id="ld-next-note" type="text" value="${escapeHtml(lead.next_action_note || '')}" placeholder="Ej. llamar para confirmar" class="${inputCls} flex-1 min-w-[160px]" />
              <button id="ld-next-save" class="btn btn-secondary">Guardar</button>
              ${lead.next_action_at ? '<button id="ld-next-clear" class="btn btn-ghost">Quitar</button>' : ''}
            </div>
          </div>` : ''}
          <div class="flex flex-wrap gap-2 justify-between">
            <div class="flex flex-wrap gap-2">
              ${waLink(lead.phone) ? `<a href="${waLink(lead.phone, `Hola ${lead.client_name}, te escribo de VELARA.`)}" target="_blank" rel="noopener" class="btn btn-secondary"><span class="material-symbols-outlined">chat</span>WhatsApp</a>` : ''}
              ${lead.status === 'asignado' ? '<button data-x="contact" class="btn btn-secondary"><span class="material-symbols-outlined">check</span>Ya le escribí</button>' : ''}
              ${!closed ? `<button data-x="quote" class="btn btn-secondary"><span class="material-symbols-outlined">request_quote</span>${lead.quotation ? 'Nueva cotización' : 'Cotizar'}</button>` : ''}
              ${lead.status === 'cotizado' ? '<button data-x="followup" class="btn btn-secondary"><span class="material-symbols-outlined">notifications</span>Seguimiento</button>' : ''}
              ${lead.status === 'cerrado_ganado' && !lead.work_order ? '<button data-x="job" class="btn btn-secondary"><span class="material-symbols-outlined">construction</span>Crear trabajo</button>' : ''}
              ${!closed ? '<button data-x="won" class="btn btn-primary"><span class="material-symbols-outlined">emoji_events</span>Ganado</button>' : ''}
              ${!closed ? '<button data-x="lost" class="btn btn-ghost">Perdido</button>' : ''}
            </div>
            <div class="flex gap-2">
              <button data-x="edit" class="btn btn-ghost"><span class="material-symbols-outlined">edit</span>Editar</button>
              ${ctx.user?.role === 'admin' ? '<button data-x="delete" class="btn btn-ghost !text-error" aria-label="Borrar"><span class="material-symbols-outlined">delete</span></button>' : ''}
            </div>
          </div>`;
        body.querySelector('#ld-next-save')?.addEventListener('click', async () => {
          try {
            await ctx.api.patch(`/api/leads/${lead.id}/next-action`, { at: body.querySelector('#ld-next-date').value, note: body.querySelector('#ld-next-note').value });
            ctx.toast('Próximo paso guardado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
        body.querySelector('#ld-next-clear')?.addEventListener('click', async () => {
          await ctx.api.patch(`/api/leads/${lead.id}/next-action`, { at: null });
          close();
          load();
        });
        body.querySelectorAll('[data-x]').forEach((b) =>
          b.addEventListener('click', () => {
            const x = b.dataset.x;
            close();
            if (x === 'quote') ctx.navigate('cotizar', { lead: lead.id });
            else if (x === 'contact' || x === 'followup' || x === 'job') act(x, lead);
            else if (x === 'won') openWon(lead);
            else if (x === 'lost') openLost(lead);
            else if (x === 'edit') openEditLeadModal(lead, ctx, load);
            else if (x === 'delete') deleteLead(lead, ctx, load);
          })
        );
      },
    });
  }

  function openFollowup(lead) {
    openModal({
      title: `Seguimiento · ${escapeHtml(lead.client_name)}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-body-sm text-on-surface-variant mb-3">Registra que le escribiste o llamaste, y cuándo volver a intentar.</p>
          ${waLink(lead.phone) ? `<a href="${waLink(lead.phone, `Hola ${lead.client_name}, ¿pudiste revisar la cotización${lead.quotation?.number ? ` ${lead.quotation.number}` : ''}? Quedo atento.`)}" target="_blank" rel="noopener" class="btn btn-secondary w-full mb-4"><span class="material-symbols-outlined">chat</span>Escribirle por WhatsApp</a>` : ''}
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${labelCls}">Volver a escribir</label><input id="fu-date" type="date" value="${todayIso(3)}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Nota</label><input id="fu-note" type="text" placeholder="Opcional" class="${inputCls}" /></div>
          </div>
          <div class="flex justify-end gap-2 mt-5"><button id="fu-cancel" class="btn btn-ghost">Cancelar</button><button id="fu-ok" class="btn btn-primary">Registrar seguimiento</button></div>`;
        body.querySelector('#fu-cancel').addEventListener('click', close);
        body.querySelector('#fu-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post(`/api/leads/${lead.id}/followup`, {});
            const at = body.querySelector('#fu-date').value;
            await ctx.api.patch(`/api/leads/${lead.id}/next-action`, { at: at || null, note: body.querySelector('#fu-note').value || 'Seguimiento de la cotización' });
            ctx.toast('Seguimiento registrado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // Ganado: con cotización, crea el trabajo desde ella (queda todo lleno);
  // sin cotización, pide el valor y crea el trabajo para esta venta.
  function openWon(lead, jobOnly = false) {
    openModal({
      title: jobOnly ? `Crear trabajo · ${escapeHtml(lead.client_name)}` : `¡Venta ganada! · ${escapeHtml(lead.client_name)}`,
      render: (body, { close }) => {
        const fromQuote = !!lead.quotation && !jobOnly;
        body.innerHTML = `
          ${fromQuote
            ? `<p class="text-body-sm text-on-surface mb-3">Se crea el trabajo con la cotización <b>${escapeHtml(lead.quotation.number || '')}</b> por <b>${formatMoney(lead.quotation.amount_total)}</b>.</p>`
            : `<div class="mb-3"><label class="${labelCls}">Valor de la venta</label><input id="wn-amount" type="text" inputmode="numeric" value="${lead.amount || lead.quotation?.amount_total || ''}" class="${inputCls}" /></div>
               <div class="mb-3"><label class="${labelCls}">Qué hay que hacer</label><textarea id="wn-desc" rows="2" class="${inputCls}">${escapeHtml(lead.product || '')}</textarea></div>`}
          <div><label class="${labelCls}">Fecha de entrega prometida</label><input id="wn-date" type="date" class="${inputCls}" /></div>
          <div class="flex justify-end gap-2 mt-5"><button id="wn-cancel" class="btn btn-ghost">Cancelar</button><button id="wn-ok" class="btn btn-primary">Crear trabajo</button></div>`;
        const amountEl = body.querySelector('#wn-amount');
        if (amountEl) bindMoneyInput(amountEl);
        body.querySelector('#wn-cancel').addEventListener('click', close);
        body.querySelector('#wn-ok').addEventListener('click', async () => {
          try {
            const promised = body.querySelector('#wn-date').value || null;
            let job;
            if (fromQuote) {
              job = await ctx.api.post('/api/jobs/from-quotation', { quotation_id: lead.quotation.id, promised_date: promised });
            } else {
              const amount = digits(amountEl.value);
              if (!amount) return ctx.toast('Escribe el valor de la venta', 'error');
              const svc = VELARA_SERVICES.find((s) => s.title === lead.product);
              job = await ctx.api.post('/api/jobs', { lead_id: lead.id, amount_total: amount, description: body.querySelector('#wn-desc').value, service_slug: svc ? svc.slug : null, promised_date: promised });
            }
            ctx.toast(`Venta ganada · trabajo ${job.number} creado`, 'success');
            close();
            ctx.navigate('trabajos', { id: job.id });
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  function openLost(lead) {
    openModal({
      title: `Venta perdida · ${escapeHtml(lead.client_name)}`,
      render: (body, { close }) => {
        let reason = LOST_REASONS[0];
        const paint = () => {
          body.querySelector('#ls-reasons').innerHTML = LOST_REASONS.map((r) => `<button type="button" data-r="${escapeHtml(r)}" class="px-3 py-1.5 rounded-full border text-body-sm ${r === reason ? 'border-on-surface bg-on-surface text-surface' : 'border-outline-variant text-on-surface'}">${escapeHtml(r)}</button>`).join('');
          body.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { reason = b.dataset.r; paint(); }));
        };
        body.innerHTML = `
          <p class="text-body-sm text-on-surface-variant mb-3">¿Por qué no se cerró? Sirve para ver qué ajustar (precio, tiempos, seguimiento).</p>
          <div id="ls-reasons" class="flex flex-wrap gap-2 mb-3"></div>
          <input id="ls-note" type="text" placeholder="Detalle (opcional)" class="${inputCls}" />
          <div class="flex justify-end gap-2 mt-5"><button id="ls-cancel" class="btn btn-ghost">Cancelar</button><button id="ls-ok" class="btn btn-primary">Marcar perdida</button></div>`;
        paint();
        body.querySelector('#ls-cancel').addEventListener('click', close);
        body.querySelector('#ls-ok').addEventListener('click', async () => {
          const note = body.querySelector('#ls-note').value.trim();
          try {
            await ctx.api.post(`/api/leads/${lead.id}/close`, { result: 'perdido', lost_reason: note ? `${reason}: ${note}` : reason });
            ctx.toast('Marcada como perdida', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // Los enlaces dentro de una tarjeta (WhatsApp, trabajo) no abren la ficha.
  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) e.stopPropagation();
  }, true);

  if (isManager) {
    try {
      advisors = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group);
    } catch {
      advisors = [];
    }
  }
  const fromParam = advisors.find((a) => a.id === pAdvisor);
  if (fromParam) facets.push({ kind: 'advisor', id: fromParam.id, name: fromParam.name });
  renderSearch();

  const offs = ['leads_changed', 'jobs_changed'].map((ev) => ctx.ws.on(ev, load));
  await load();
  return () => {
    offs.forEach((off) => off());
    document.removeEventListener('click', onDocClick);
  };
}
