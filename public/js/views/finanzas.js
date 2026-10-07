import { escapeHtml, formatMoney } from '../utils.js';
import { openModal, confirmModal } from '../components/modal.js';
import { findService } from '../data/velaraServices.js';
import { tabBarHtml, paintTabBar, mountDateRange, DATE_PRESETS, ratioBar } from '../components/ui.js';
import { groupedBarChart, destroyChart } from '../components/charts.js';

// Finanzas: todo lo que entra y sale de plata del negocio. Ver
// server/routes/cash.js.
//   Resumen       -> saldo de cada cuenta, cómo va el mes, estado de resultados
//   Movimientos   -> cada gasto, ingreso, abono y traslado (filtrable)
//   Por cobrar    -> ventas con saldo pendiente
//   Gastos fijos  -> arriendo, servicios... y cuáles faltan por pagar
//   Ganancia      -> cuánto dejó cada trabajo
//   Operarios     -> cuánto se le ha pagado a cada uno
// Pensado para registrar un gasto en segundos desde el celular.

const TABS = [
  { key: 'resumen', label: 'Resumen', icon: 'space_dashboard' },
  { key: 'movimientos', label: 'Movimientos', icon: 'receipt_long' },
  { key: 'cobrar', label: 'Por cobrar', icon: 'request_quote' },
  { key: 'fijos', label: 'Gastos fijos', icon: 'event_repeat' },
  { key: 'ganancia', label: 'Ganancia', icon: 'trending_up' },
  { key: 'operarios', label: 'Operarios', icon: 'engineering' },
];
const MONTH_TABS = ['resumen', 'fijos', 'ganancia', 'operarios'];

const ACCOUNT_ICON = { efectivo: 'payments', digital: 'smartphone', banco: 'account_balance' };
const ACCOUNT_KIND_LABEL = { efectivo: 'Efectivo', digital: 'Billetera digital', banco: 'Banco' };
const STAGE_LABEL = { por_iniciar: 'Por hacer', en_proceso: 'En proceso', listo: 'Listo', entregado: 'Entregado' };
const CATEGORY_ICON = {
  'Compra de materiales': 'inventory_2',
  'Nómina y pagos a operarios': 'engineering',
  Arriendo: 'home',
  'Servicios públicos': 'bolt',
  'Transporte y domicilios': 'local_shipping',
  'Herramientas y mantenimiento': 'build',
  Publicidad: 'campaign',
  Impuestos: 'gavel',
  'Comisiones y gastos bancarios': 'account_balance',
  'Alimentación y cafetería': 'restaurant',
  'Otros gastos': 'more_horiz',
  'Retiro del dueño': 'person_remove',
  'Otros ingresos': 'add_card',
  'Aporte de socios': 'savings',
  'Abono de cliente': 'handshake',
  'Traslado entre cuentas': 'swap_horiz',
};
const LABOR = 'Nómina y pagos a operarios';

const inputCls = 'w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline bg-surface-container-lowest';
const labelCls = 'block text-[10px] font-label-bold uppercase tracking-wider text-on-surface-variant mb-1';
const CARD = 'bg-surface-container-lowest border border-outline-variant rounded-xl';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthLabel(m) {
  const [y, mm] = m.split('-').map(Number);
  return `${MONTHS[mm - 1].charAt(0).toUpperCase()}${MONTHS[mm - 1].slice(1)} ${y}`;
}
function shortMonth(m) {
  return MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 3);
}
function shiftMonth(m, delta) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthBounds(m) {
  const [y, mm] = m.split('-').map(Number);
  const last = new Date(y, mm, 0).getDate();
  return [`${m}-01`, `${m}-${String(last).padStart(2, '0')}`];
}
function fmtDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}
function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = todayIso();
  if (iso === today) return 'Hoy';
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (iso === `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`) return 'Ayer';
  const s = date.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function digits(v) {
  return Number(String(v || '').replace(/\D/g, '')) || 0;
}
// Campo de plata: se escribe con teclado numérico y se ve con puntos de miles.
function bindMoneyInput(el) {
  const paint = () => {
    const n = digits(el.value);
    el.value = n ? n.toLocaleString('es-CO') : '';
  };
  el.addEventListener('input', paint);
  paint();
}
function delta(cur, prev) {
  if (!prev) return '';
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (!Number.isFinite(pct) || pct === 0) return 'igual que el mes pasado';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)} % vs. mes pasado`;
}
function kpi(label, value, hint = '', tone = '') {
  const color = tone === 'bad' ? 'text-error' : tone === 'good' ? 'text-status-good' : 'text-on-surface';
  return `
    <div class="${CARD} p-4 min-w-0">
      <p class="eyebrow text-on-surface-variant !text-[10px] mb-2">${label}</p>
      <p class="text-[20px] leading-7 sm:text-[24px] sm:leading-8 font-bold tracking-tight ${color} truncate">${value}</p>
      ${hint ? `<p class="text-[11px] text-on-surface-variant mt-1 truncate">${hint}</p>` : ''}
    </div>`;
}
function empty(text) {
  return `<p class="px-4 py-10 text-center text-body-sm text-on-surface-variant">${text}</p>`;
}

export async function mount(container, ctx) {
  const isAdmin = ctx.user?.role === 'admin';
  let tab = TABS.some((t) => t.key === ctx.routeParams.get('tab')) ? ctx.routeParams.get('tab') : 'resumen';
  let month = todayIso().slice(0, 7);
  let [from, to] = DATE_PRESETS.mes[1]();
  const filters = { account: '', kind: '', category: '', q: '' };
  let profitScope = 'entregados';
  let meta = { categories: { egreso: [], ingreso: [] }, accounts: [], workers: [], jobs: [] };
  let chart = null;

  container.innerHTML = `
    <div class="flex justify-between items-end mb-gutter flex-wrap gap-3">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface">Finanzas</h2>
        <p class="text-body-md text-on-surface-variant mt-1">Cada peso que entra y sale del negocio.</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button data-new="egreso" class="btn btn-primary"><span class="material-symbols-outlined">remove</span>Gasto</button>
        <button data-new="ingreso" class="btn btn-secondary"><span class="material-symbols-outlined">add</span>Ingreso</button>
        <button data-new="traslado" class="btn btn-secondary"><span class="material-symbols-outlined">swap_horiz</span>Traslado</button>
      </div>
    </div>
    ${tabBarHtml(TABS, tab)}
    <div id="fn-month" class="flex items-center gap-2 mb-gutter">
      <button data-month="-1" class="btn btn-icon" aria-label="Mes anterior"><span class="material-symbols-outlined">chevron_left</span></button>
      <span id="fn-month-label" class="text-body-md font-bold text-on-surface min-w-[150px] text-center"></span>
      <button data-month="1" class="btn btn-icon" aria-label="Mes siguiente"><span class="material-symbols-outlined">chevron_right</span></button>
      <button id="fn-month-today" class="btn btn-ghost hidden">Este mes</button>
    </div>
    <div id="fn-range" class="flex flex-wrap items-end gap-3 mb-3 hidden"></div>
    <div id="fn-body"></div>
  `;

  const bodyEl = container.querySelector('#fn-body');
  const rangeEl = container.querySelector('#fn-range');
  const monthEl = container.querySelector('#fn-month');

  function paintChrome() {
    paintTabBar(container, tab);
    monthEl.classList.toggle('hidden', !MONTH_TABS.includes(tab));
    rangeEl.classList.toggle('hidden', tab !== 'movimientos');
    container.querySelector('#fn-month-label').textContent = monthLabel(month);
    container.querySelector('#fn-month-today').classList.toggle('hidden', month === todayIso().slice(0, 7));
  }

  async function refreshMeta() {
    try {
      meta = await ctx.api.get('/api/cash/meta');
    } catch {
      /* sin meta: los formularios quedan con listas vacías */
    }
  }

  // ---- Resumen ------------------------------------------------------------------------
  async function renderResumen() {
    const d = await ctx.api.get(`/api/cash/summary?month=${month}`);
    const t = d.totals;
    const p = d.prev_totals;
    const active = d.accounts.filter((a) => a.active);
    const available = active.reduce((s, a) => s + a.balance, 0);
    const maxCat = d.gastos_por_categoria[0]?.total || 1;

    bodyEl.innerHTML = `
      <section class="mb-gutter">
        <div class="flex items-baseline justify-between mb-3">
          <p class="eyebrow text-on-surface-variant">Dónde está la plata hoy</p>
          ${isAdmin ? '<button id="acc-new" class="text-body-sm text-on-surface-variant hover:text-on-surface">+ Cuenta</button>' : ''}
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="relative overflow-hidden rounded-xl bg-[#0B0B0B] text-[#F2F0EA] p-4 col-span-2 lg:col-span-1">
            <svg class="absolute right-0 top-0 h-full w-24 pointer-events-none" viewBox="60 0 240 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
              <polygon points="100,0 160,0 344,200 284,200" fill="#1C1C1C"/><polygon points="180,0 210,0 394,200 364,200" fill="#D71920"/>
            </svg>
            <p class="relative eyebrow !text-[10px] text-[#A7A9AC] mb-2">Total disponible</p>
            <p class="relative text-[24px] leading-8 font-bold tracking-tight">${formatMoney(available)}</p>
            <p class="relative text-[11px] text-[#A7A9AC] mt-1">${active.length} cuenta(s)</p>
          </div>
          ${active
            .map(
              (a) => `
            <button data-acc="${a.id}" class="${CARD} p-4 text-left hover:border-on-surface transition-colors min-w-0">
              <p class="flex items-center gap-1.5 text-body-sm text-on-surface-variant mb-2"><span class="material-symbols-outlined text-[18px]">${ACCOUNT_ICON[a.kind] || 'wallet'}</span><span class="truncate">${escapeHtml(a.name)}</span></p>
              <p class="text-[20px] leading-7 font-bold tracking-tight ${a.balance < 0 ? 'text-error' : 'text-on-surface'} truncate">${formatMoney(a.balance)}</p>
              <p class="text-[11px] text-on-surface-variant mt-1">Ver movimientos ›</p>
            </button>`
            )
            .join('')}
        </div>
      </section>

      ${d.fixed.overdue || d.without_receipt || d.receivables.delivered ? `
      <div class="flex flex-col gap-2 mb-gutter">
        ${d.fixed.overdue ? `<button data-go="fijos" class="flex items-center gap-2 px-4 py-3 rounded-lg border border-error/40 bg-error-container/40 text-left text-body-sm text-on-surface"><span class="material-symbols-outlined text-error">event_busy</span><b>${d.fixed.overdue} gasto(s) fijo(s) vencido(s)</b> sin pagar este mes ›</button>` : ''}
        ${d.receivables.delivered ? `<button data-go="cobrar" class="flex items-center gap-2 px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low text-left text-body-sm text-on-surface"><span class="material-symbols-outlined">request_quote</span><b>${d.receivables.delivered} trabajo(s) entregado(s)</b> todavía sin pagar ›</button>` : ''}
        ${d.without_receipt ? `<button data-go="movimientos" class="flex items-center gap-2 px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low text-left text-body-sm text-on-surface"><span class="material-symbols-outlined">photo_camera</span><b>${d.without_receipt} gasto(s)</b> de este mes sin foto del recibo ›</button>` : ''}
      </div>` : ''}

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-gutter">
        ${kpi('Entró en el mes', formatMoney(t.ingresos), delta(t.ingresos, p.ingresos))}
        ${kpi('Salió en el mes', formatMoney(t.gastos), delta(t.gastos, p.gastos))}
        ${kpi('Ganancia del mes', formatMoney(t.ganancia), t.ganancia < 0 ? 'Salió más de lo que entró' : delta(t.ganancia, p.ganancia), t.ganancia < 0 ? 'bad' : 'good')}
        ${kpi('Por cobrar', formatMoney(d.receivables.total), `${d.receivables.count} venta(s) con saldo`)}
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-5 gap-gutter mb-gutter">
        <div class="${CARD} p-4 xl:col-span-3">
          <p class="text-body-md font-bold text-on-surface mb-1">Últimos 6 meses</p>
          <p class="text-body-sm text-on-surface-variant mb-3">Lo que entró y lo que salió cada mes.</p>
          <div class="h-[240px]"><canvas id="fn-chart"></canvas></div>
        </div>
        <div class="${CARD} p-4 xl:col-span-2">
          <div class="flex items-baseline justify-between mb-3">
            <p class="text-body-md font-bold text-on-surface">Gastos fijos de ${MONTHS[Number(month.slice(5)) - 1]}</p>
            <button data-go="fijos" class="text-body-sm text-on-surface-variant hover:text-on-surface">Ver todos ›</button>
          </div>
          ${d.fixed.rows.length ? `
            <div class="divide-y divide-outline-variant">
              ${d.fixed.rows.slice(0, 6).map((r) => `
                <div class="flex items-center justify-between gap-3 py-2">
                  <div class="min-w-0">
                    <p class="text-body-sm font-semibold text-on-surface truncate">${escapeHtml(r.name)}</p>
                    <p class="text-[11px] ${r.overdue ? 'text-error font-bold' : 'text-on-surface-variant'}">${r.paid ? `Pagado el ${fmtDate(r.paid_date)}` : r.overdue ? `Venció el ${fmtDate(r.due_date)}` : `Vence el ${fmtDate(r.due_date)}`}</p>
                  </div>
                  ${r.paid ? `<span class="text-body-sm text-on-surface-variant shrink-0">${formatMoney(r.paid_amount)}</span>` : `<button data-pay-fixed="${r.id}" class="btn btn-secondary !px-3 !py-1 shrink-0">Pagar ${formatMoney(r.amount)}</button>`}
                </div>`).join('')}
            </div>
            <p class="text-[11px] text-on-surface-variant mt-3">Falta por pagar: <b class="text-on-surface">${formatMoney(d.fixed.pending)}</b> de ${formatMoney(d.fixed.total)}</p>`
            : `<p class="text-body-sm text-on-surface-variant py-4">Aún no tienes gastos fijos. Agrega el arriendo, los servicios o el internet para saber cada mes qué falta por pagar.</p><button data-go="fijos" class="btn btn-secondary mt-1">Agregar gastos fijos</button>`}
        </div>
      </div>

      <div class="${CARD} p-4 sm:p-6">
        <p class="text-body-md font-bold text-on-surface">Estado de resultados · ${monthLabel(month)}</p>
        <p class="text-body-sm text-on-surface-variant mb-5">Lo que vendiste menos lo que gastaste. No cuenta traslados, aportes ni retiros del dueño.</p>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <p class="eyebrow text-on-surface-variant mb-3">Ingresos</p>
            ${d.ingresos_por_categoria.length ? d.ingresos_por_categoria.map((r) => `
              <div class="flex justify-between text-body-sm py-1.5"><span class="text-on-surface">${escapeHtml(r.name)}</span><span class="text-on-surface">${formatMoney(r.total)}</span></div>`).join('') : '<p class="text-body-sm text-on-surface-variant">Sin ingresos este mes.</p>'}
            <div class="flex justify-between text-body-md font-bold border-t border-outline-variant mt-2 pt-2"><span>Total ingresos</span><span>${formatMoney(t.ingresos)}</span></div>
          </div>
          <div>
            <p class="eyebrow text-on-surface-variant mb-3">Gastos</p>
            ${d.gastos_por_categoria.length ? d.gastos_por_categoria.map((r) => `
              <button data-cat="${escapeHtml(r.name)}" class="block w-full text-left py-1.5 group">
                <div class="flex justify-between text-body-sm"><span class="text-on-surface group-hover:underline">${escapeHtml(r.name)}</span><span class="text-on-surface">${formatMoney(r.total)}</span></div>
                ${ratioBar(Math.round((r.total / maxCat) * 100))}
              </button>`).join('') : '<p class="text-body-sm text-on-surface-variant">Sin gastos este mes.</p>'}
            <div class="flex justify-between text-body-md font-bold border-t border-outline-variant mt-2 pt-2"><span>Total gastos</span><span>${formatMoney(t.gastos)}</span></div>
          </div>
        </div>
        <div class="flex justify-between items-center mt-6 px-4 py-3 rounded-lg ${t.ganancia < 0 ? 'bg-error-container/50' : 'bg-surface-container'}">
          <span class="text-body-md font-bold text-on-surface">${t.ganancia < 0 ? 'Pérdida del mes' : 'Ganancia del mes'}</span>
          <span class="text-[20px] font-bold ${t.ganancia < 0 ? 'text-error' : 'text-on-surface'}">${formatMoney(t.ganancia)}</span>
        </div>
        ${t.aportes || t.retiros ? `<p class="text-[12px] text-on-surface-variant mt-3">Aparte: aportes del dueño ${formatMoney(t.aportes)} · retiros del dueño ${formatMoney(t.retiros)}.</p>` : ''}
      </div>`;

    const canvas = bodyEl.querySelector('#fn-chart');
    chart = groupedBarChart(canvas, {
      labels: d.series.map((s) => shortMonth(s.month)),
      series: [
        { label: 'Entró', data: d.series.map((s) => s.ingresos), color: cssVar('--c-on-surface-variant', '#5E6064') },
        { label: 'Salió', data: d.series.map((s) => s.gastos), color: cssVar('--c-primary', '#D71920') },
      ],
      valueFormatter: (v) => formatMoney(v),
    });

    bodyEl.querySelectorAll('[data-acc]').forEach((b) =>
      b.addEventListener('click', () => {
        filters.account = b.dataset.acc;
        [from, to] = monthBounds(month);
        go('movimientos');
      })
    );
    bodyEl.querySelectorAll('[data-cat]').forEach((b) =>
      b.addEventListener('click', () => {
        filters.category = b.dataset.cat;
        filters.kind = 'egreso';
        [from, to] = monthBounds(month);
        go('movimientos');
      })
    );
    bodyEl.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    bodyEl.querySelectorAll('[data-pay-fixed]').forEach((b) => b.addEventListener('click', () => openPayFixed(d.fixed.rows.find((r) => r.id === Number(b.dataset.payFixed)))));
    bodyEl.querySelector('#acc-new')?.addEventListener('click', () => openAccount(null));
  }

  // ---- Movimientos ----------------------------------------------------------------------
  function paintRange() {
    mountDateRange(rangeEl, {
      idPrefix: 'fn',
      from,
      to,
      presets: ['hoy', 'mes', 'mes_pasado', 'anio'],
      onChange: (f, t) => {
        [from, to] = [f, t];
        load();
      },
    });
  }

  async function renderMovimientos() {
    const qs = new URLSearchParams({ from, to });
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    const d = await ctx.api.get(`/api/cash/entries?${qs}`);
    const allCats = [...new Set([...meta.categories.egreso, ...meta.categories.ingreso, 'Abono de cliente'])];
    const byDay = [];
    for (const r of d.rows) {
      const last = byDay[byDay.length - 1];
      if (last && last.day === r.entry_date) last.rows.push(r);
      else byDay.push({ day: r.entry_date, rows: [r] });
    }
    const sel = (id, options, value, placeholder) =>
      `<select id="${id}" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
        <option value="">${placeholder}</option>${options.map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(v) === String(value) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
      </select>`;

    bodyEl.innerHTML = `
      <div class="flex flex-wrap gap-2 mb-gutter">
        <input id="mv-q" type="search" value="${escapeHtml(filters.q)}" placeholder="Buscar…" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline flex-1 min-w-[160px]" />
        ${sel('mv-account', meta.accounts.map((a) => [a.id, a.name]), filters.account, 'Todas las cuentas')}
        ${sel('mv-kind', [['egreso', 'Gastos'], ['ingreso', 'Ingresos'], ['traslado', 'Traslados']], filters.kind, 'Todo')}
        ${sel('mv-category', allCats.map((c) => [c, c]), filters.category, 'Todas las categorías')}
        ${Object.values(filters).some(Boolean) ? '<button id="mv-clear" class="btn btn-ghost">Quitar filtros</button>' : ''}
      </div>
      <div class="${CARD} grid grid-cols-3 divide-x divide-outline-variant mb-gutter">
        ${[
          ['Entró', d.totals.ingresos + d.totals.aportes, 'text-status-good'],
          ['Salió', d.totals.gastos + d.totals.retiros, 'text-on-surface'],
          ['Neto', d.totals.ingresos + d.totals.aportes - d.totals.gastos - d.totals.retiros, null],
        ]
          .map(
            ([l, v, c]) => `
          <div class="px-3 py-3 min-w-0">
            <p class="eyebrow !text-[10px] text-on-surface-variant mb-1.5">${l}</p>
            <p class="text-[14px] sm:text-[18px] font-bold tracking-tight ${c || (v < 0 ? 'text-error' : 'text-on-surface')} break-all">${formatMoney(v)}</p>
          </div>`
          )
          .join('')}
      </div>
      <div class="${CARD} overflow-hidden">
        ${byDay.length ? byDay.map((g) => `
          <div class="px-4 py-2 bg-surface-container-low border-b border-outline-variant flex justify-between text-[12px] text-on-surface-variant">
            <span class="font-semibold">${dayLabel(g.day)}</span>
            <span>${formatMoney(g.rows.reduce((s, r) => s + (r.kind === 'ingreso' ? r.amount : r.kind === 'egreso' ? -r.amount : 0), 0))}</span>
          </div>
          <div class="divide-y divide-outline-variant border-b border-outline-variant last:border-b-0">
            ${g.rows.map((r) => {
              const sign = r.kind === 'ingreso' ? '+' : r.kind === 'egreso' ? '−' : '';
              const color = r.kind === 'ingreso' ? 'text-status-good' : r.kind === 'egreso' ? 'text-on-surface' : 'text-on-surface-variant';
              const tags = [
                r.kind === 'traslado' ? `${escapeHtml(r.account_name || '')} → ${escapeHtml(r.to_account_name || '')}` : escapeHtml(r.account_name || ''),
                r.work_order_number ? `Trabajo ${escapeHtml(r.work_order_number)}` : '',
                r.worker_name ? escapeHtml(r.worker_name) : '',
                r.purchase_number ? escapeHtml(r.purchase_number) : '',
                r.invoice_number ? `Factura ${escapeHtml(r.invoice_number)}` : '',
                r.non_operating ? 'No cuenta en la ganancia' : '',
              ].filter(Boolean);
              return `
              <button data-row="${r.source}:${r.id}" class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container-low transition-colors">
                <span class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${r.kind === 'ingreso' ? 'bg-surface-container text-status-good' : 'bg-surface-container text-on-surface'}">
                  <span class="material-symbols-outlined text-[18px]">${CATEGORY_ICON[r.category] || 'payments'}</span>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-body-sm text-on-surface truncate"><b>${escapeHtml(r.category)}</b>${r.description ? ` · ${escapeHtml(r.description)}` : ''}</span>
                  <span class="block text-[11px] text-on-surface-variant truncate">${tags.join(' · ')}</span>
                </span>
                ${r.has_receipt ? '<span class="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0" title="Tiene recibo">attach_file</span>' : ''}
                <span class="font-bold text-body-sm ${color} shrink-0">${sign}${formatMoney(r.amount)}</span>
              </button>`;
            }).join('')}
          </div>`).join('') : empty('No hay movimientos con estos filtros.')}
      </div>`;

    const reload = () => load();
    let qTimer;
    bodyEl.querySelector('#mv-q').addEventListener('input', (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        filters.q = e.target.value.trim();
        reload().then(() => {
          const q = bodyEl.querySelector('#mv-q');
          q.focus();
          q.setSelectionRange(q.value.length, q.value.length);
        });
      }, 300);
    });
    for (const [id, key] of [['mv-account', 'account'], ['mv-kind', 'kind'], ['mv-category', 'category']]) {
      bodyEl.querySelector(`#${id}`).addEventListener('change', (e) => {
        filters[key] = e.target.value;
        reload();
      });
    }
    bodyEl.querySelector('#mv-clear')?.addEventListener('click', () => {
      Object.keys(filters).forEach((k) => (filters[k] = ''));
      reload();
    });
    bodyEl.querySelectorAll('[data-row]').forEach((b) =>
      b.addEventListener('click', () => {
        const [source, id] = b.dataset.row.split(':');
        const row = d.rows.find((r) => r.source === source && r.id === Number(id));
        if (source === 'caja') openEntry(row.kind, row);
        else if (source === 'traslado') openTransferDetail(row);
        else ctx.toast('Los abonos de clientes se corrigen en la venta (Por cobrar o la ficha del cliente).', 'info');
      })
    );
  }

  // ---- Formulario de gasto / ingreso --------------------------------------------------------
  function openEntry(kind, existing = null, preset = {}) {
    const cats = meta.categories[kind] || [];
    const accounts = meta.accounts.filter((a) => a.active || (existing && a.id === existing.account_id));
    let category = existing?.category || preset.category || (kind === 'egreso' ? 'Compra de materiales' : cats[0]);
    let accountId = existing?.account_id || preset.account_id || accounts[0]?.id;
    let file = null;

    openModal({
      title: existing ? (kind === 'egreso' ? 'Editar gasto' : 'Editar ingreso') : kind === 'egreso' ? 'Registrar gasto' : 'Registrar ingreso',
      wide: true,
      render: (body, { close }) => {
        const chipBtn = (attr, value, label, icon, on) =>
          `<button type="button" ${attr}="${escapeHtml(value)}" class="flex items-center gap-1.5 px-3 py-2 rounded-full border text-body-sm transition-colors ${on ? 'border-on-surface bg-on-surface text-surface' : 'border-outline-variant text-on-surface hover:bg-surface-container-low'}">${icon ? `<span class="material-symbols-outlined text-[16px]">${icon}</span>` : ''}${escapeHtml(label)}</button>`;
        const paint = () => {
          body.querySelector('#ce-cats').innerHTML = cats.map((c) => chipBtn('data-c', c, c, CATEGORY_ICON[c], c === category)).join('');
          body.querySelector('#ce-accs').innerHTML = accounts.map((a) => chipBtn('data-a', a.id, a.name, ACCOUNT_ICON[a.kind], a.id === accountId)).join('');
          body.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { category = b.dataset.c; paint(); }));
          body.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { accountId = Number(b.dataset.a); paint(); }));
          body.querySelector('#ce-worker-wrap').classList.toggle('hidden', kind !== 'egreso' || (category !== LABOR && !body.querySelector('#ce-worker').value));
          body.querySelector('#ce-nonop').classList.toggle('hidden', !meta.non_operating?.includes(category));
        };
        body.innerHTML = `
          ${kind === 'ingreso' ? '<p class="text-[12px] text-on-surface-variant mb-3">Los abonos de clientes no van aquí: se registran en la venta (pestaña Por cobrar).</p>' : ''}
          <label class="${labelCls}" for="ce-amount">Valor</label>
          <div class="flex items-center gap-2 mb-4 border-b-2 border-on-surface pb-1">
            <span class="text-[28px] font-bold text-on-surface-variant">$</span>
            <input id="ce-amount" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${existing ? existing.amount : preset.amount || ''}" class="w-full text-[32px] font-bold bg-transparent border-0 p-0 focus:ring-0 outline-none text-on-surface" />
          </div>
          <p class="${labelCls}">Categoría</p>
          <div id="ce-cats" class="flex flex-wrap gap-2 mb-1"></div>
          <p id="ce-nonop" class="text-[11px] text-on-surface-variant mb-3 hidden">Mueve plata pero no cuenta como venta ni gasto del negocio (no cambia la ganancia).</p>
          <p class="${labelCls} mt-3">${kind === 'egreso' ? 'Salió de' : 'Entró a'}</p>
          <div id="ce-accs" class="flex flex-wrap gap-2 mb-4"></div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="${labelCls}" for="ce-date">Fecha</label><input id="ce-date" type="date" value="${existing?.entry_date || todayIso()}" class="${inputCls}" /></div>
            <div><label class="${labelCls}" for="ce-desc">Descripción</label><input id="ce-desc" type="text" value="${escapeHtml(existing?.description || preset.description || '')}" placeholder="${kind === 'egreso' ? 'Ej. 3 m de cuero negro' : 'Ej. venta de retazos'}" class="${inputCls}" /></div>
            <div><label class="${labelCls}" for="ce-job">Trabajo (opcional)</label>
              <select id="ce-job" class="${inputCls}"><option value="">Ninguno</option>${meta.jobs.map((j) => `<option value="${j.id}" ${j.id === (existing?.work_order_id || preset.work_order_id) ? 'selected' : ''}>${escapeHtml(j.number)} · ${escapeHtml(j.client_name)}${STAGE_LABEL[j.stage] ? ` (${STAGE_LABEL[j.stage]})` : ''}</option>`).join('')}</select>
              <p class="text-[11px] text-on-surface-variant mt-1">Así sabes cuánto te dejó ese trabajo.</p>
            </div>
            <div id="ce-worker-wrap"><label class="${labelCls}" for="ce-worker">Operario</label>
              <select id="ce-worker" class="${inputCls}"><option value="">Ninguno</option>${meta.workers.map((w) => `<option value="${w.id}" ${w.id === (existing?.worker_id || preset.worker_id) ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('')}</select>
            </div>
          </div>
          ${kind === 'egreso' ? `
          <div class="mt-4">
            <p class="${labelCls}">Foto del recibo</p>
            <div class="flex items-center gap-3 flex-wrap">
              <label class="btn btn-secondary cursor-pointer"><span class="material-symbols-outlined">photo_camera</span><span id="ce-file-label">${existing?.has_receipt ? 'Cambiar foto' : 'Tomar o subir foto'}</span>
                <input id="ce-file" type="file" accept="image/*,application/pdf" capture="environment" class="hidden" />
              </label>
              ${existing?.has_receipt ? `<a href="/api/cash/entries/${existing.id}/receipt" target="_blank" class="text-body-sm underline text-on-surface">Ver recibo</a><button id="ce-file-del" type="button" class="text-body-sm text-error">Quitar</button>` : ''}
            </div>
          </div>` : ''}
          <div class="flex justify-between gap-2 mt-6">
            <div>${existing && isAdmin ? '<button id="ce-del" class="btn btn-ghost !text-error">Borrar</button>' : ''}</div>
            <div class="flex gap-2"><button id="ce-cancel" class="btn btn-ghost">Cancelar</button><button id="ce-ok" class="btn btn-primary">${existing ? 'Guardar' : 'Registrar'}</button></div>
          </div>`;
        bindMoneyInput(body.querySelector('#ce-amount'));
        paint();
        body.querySelector('#ce-amount').focus();
        body.querySelector('#ce-worker').addEventListener('change', paint);
        body.querySelector('#ce-file')?.addEventListener('change', (e) => {
          file = e.target.files[0] || null;
          body.querySelector('#ce-file-label').textContent = file ? file.name : 'Tomar o subir foto';
        });
        body.querySelector('#ce-file-del')?.addEventListener('click', async () => {
          try {
            await ctx.api.del(`/api/cash/entries/${existing.id}/receipt`);
            ctx.toast('Recibo quitado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
        body.querySelector('#ce-cancel').addEventListener('click', close);
        body.querySelector('#ce-del')?.addEventListener('click', async () => {
          const ok = await confirmModal({ title: 'Borrar movimiento', message: 'Se borra este movimiento. Úsalo solo para corregir un error.', confirmLabel: 'Borrar', danger: true });
          if (!ok) return;
          try {
            await ctx.api.del(`/api/cash/entries/${existing.id}`);
            ctx.toast('Movimiento borrado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
        body.querySelector('#ce-ok').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const amount = digits(body.querySelector('#ce-amount').value);
          if (!amount) return ctx.toast('Escribe el valor', 'error');
          const payload = {
            kind,
            category,
            amount,
            account_id: accountId,
            entry_date: body.querySelector('#ce-date').value,
            description: body.querySelector('#ce-desc').value,
            work_order_id: Number(body.querySelector('#ce-job').value) || null,
            worker_id: Number(body.querySelector('#ce-worker').value) || null,
          };
          btn.dataset.loading = '';
          try {
            const saved = existing ? await ctx.api.patch(`/api/cash/entries/${existing.id}`, payload) : await ctx.api.post('/api/cash/entries', payload);
            if (file) {
              const fd = new FormData();
              fd.append('file', file);
              const res = await fetch(`/api/cash/entries/${saved.id}/receipt`, { method: 'POST', body: fd });
              if (!res.ok) ctx.toast((await res.json().catch(() => ({}))).error || 'No se pudo subir la foto', 'error');
            }
            ctx.toast(existing ? 'Cambios guardados' : kind === 'egreso' ? 'Gasto registrado' : 'Ingreso registrado', 'success');
            close();
            await refreshMeta();
            load();
          } catch (err) {
            delete btn.dataset.loading;
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- Traslados ----------------------------------------------------------------------------
  function openTransfer() {
    const accounts = meta.accounts.filter((a) => a.active);
    if (accounts.length < 2) return ctx.toast('Necesitas al menos dos cuentas para trasladar plata.', 'error');
    openModal({
      title: 'Trasladar entre cuentas',
      render: (body, { close }) => {
        const opts = (sel) => accounts.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${escapeHtml(a.name)} · ${formatMoney(a.balance)}</option>`).join('');
        body.innerHTML = `
          <p class="text-[12px] text-on-surface-variant mb-3">Por ejemplo, consignar el efectivo en el banco. No es ingreso ni gasto: solo cambia dónde está la plata.</p>
          <div class="space-y-3">
            <div><label class="${labelCls}">Sale de</label><select id="tr-from" class="${inputCls}">${opts(accounts[0].id)}</select></div>
            <div><label class="${labelCls}">Entra a</label><select id="tr-to" class="${inputCls}">${opts(accounts[1].id)}</select></div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="${labelCls}">Valor</label><input id="tr-amount" type="text" inputmode="numeric" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Fecha</label><input id="tr-date" type="date" value="${todayIso()}" class="${inputCls}" /></div>
            </div>
            <div><label class="${labelCls}">Nota</label><input id="tr-note" type="text" placeholder="Opcional" class="${inputCls}" /></div>
          </div>
          <div class="flex justify-end gap-2 mt-5"><button id="tr-cancel" class="btn btn-ghost">Cancelar</button><button id="tr-ok" class="btn btn-primary">Trasladar</button></div>`;
        bindMoneyInput(body.querySelector('#tr-amount'));
        body.querySelector('#tr-cancel').addEventListener('click', close);
        body.querySelector('#tr-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post('/api/cash/transfers', {
              from_account_id: Number(body.querySelector('#tr-from').value),
              to_account_id: Number(body.querySelector('#tr-to').value),
              amount: digits(body.querySelector('#tr-amount').value),
              date: body.querySelector('#tr-date').value,
              note: body.querySelector('#tr-note').value,
            });
            ctx.toast('Traslado registrado', 'success');
            close();
            await refreshMeta();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  function openTransferDetail(row) {
    openModal({
      title: 'Traslado entre cuentas',
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-body-md text-on-surface"><b>${formatMoney(row.amount)}</b> de <b>${escapeHtml(row.account_name || '')}</b> a <b>${escapeHtml(row.to_account_name || '')}</b></p>
          <p class="text-body-sm text-on-surface-variant mt-1">${fmtDate(row.entry_date)}${row.description ? ` · ${escapeHtml(row.description)}` : ''}</p>
          <div class="flex justify-between gap-2 mt-5">
            <div>${isAdmin ? '<button id="tr-del" class="btn btn-ghost !text-error">Borrar traslado</button>' : ''}</div>
            <button id="tr-close" class="btn btn-secondary">Cerrar</button>
          </div>`;
        body.querySelector('#tr-close').addEventListener('click', close);
        body.querySelector('#tr-del')?.addEventListener('click', async () => {
          try {
            await ctx.api.del(`/api/cash/transfers/${row.id}`);
            ctx.toast('Traslado borrado', 'success');
            close();
            await refreshMeta();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- Cuentas ------------------------------------------------------------------------------
  function openAccount(acc) {
    openModal({
      title: acc ? 'Editar cuenta' : 'Nueva cuenta',
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="space-y-3">
            <div><label class="${labelCls}">Nombre</label><input id="ac-name" type="text" value="${escapeHtml(acc?.name || '')}" placeholder="Ej. Bancolombia ahorros" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Tipo</label><select id="ac-kind" class="${inputCls}">${Object.entries(ACCOUNT_KIND_LABEL).map(([k, l]) => `<option value="${k}" ${acc?.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div><label class="${labelCls}">Saldo con el que arrancó</label><input id="ac-open" type="text" inputmode="numeric" value="${acc ? acc.opening_balance : ''}" class="${inputCls}" />
              <p class="text-[11px] text-on-surface-variant mt-1">La plata que había en esta cuenta antes de empezar a registrar movimientos.</p></div>
            ${acc ? `<label class="flex items-center gap-2 text-body-sm text-on-surface"><input id="ac-active" type="checkbox" ${acc.active ? 'checked' : ''} /> Cuenta en uso</label>` : ''}
          </div>
          <div class="flex justify-end gap-2 mt-5"><button id="ac-cancel" class="btn btn-ghost">Cancelar</button><button id="ac-ok" class="btn btn-primary">Guardar</button></div>`;
        bindMoneyInput(body.querySelector('#ac-open'));
        body.querySelector('#ac-cancel').addEventListener('click', close);
        body.querySelector('#ac-ok').addEventListener('click', async () => {
          const payload = {
            name: body.querySelector('#ac-name').value,
            kind: body.querySelector('#ac-kind').value,
            opening_balance: digits(body.querySelector('#ac-open').value),
          };
          if (acc) payload.active = body.querySelector('#ac-active').checked;
          try {
            if (acc) await ctx.api.patch(`/api/cash/accounts/${acc.id}`, payload);
            else await ctx.api.post('/api/cash/accounts', payload);
            ctx.toast('Cuenta guardada', 'success');
            close();
            await refreshMeta();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- Por cobrar ---------------------------------------------------------------------------
  async function renderCobrar() {
    const data = await ctx.api.get('/api/cash/receivables');
    const delivered = data.rows.filter((r) => r.delivered);
    bodyEl.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-gutter">
        ${kpi('Por cobrar', formatMoney(data.total), `${data.rows.length} venta(s) con saldo`, data.total > 0 ? 'bad' : '')}
        ${kpi('Entregado y sin pagar', formatMoney(delivered.reduce((s, r) => s + r.balance, 0)), delivered.length ? `${delivered.length} trabajo(s): cobrar ya` : 'Ninguno', delivered.length ? 'bad' : '')}
        ${kpi('Aún en el taller', formatMoney(data.rows.filter((r) => !r.delivered).reduce((s, r) => s + r.balance, 0)), 'Se cobra el saldo al entregar')}
      </div>
      <div class="${CARD} divide-y divide-outline-variant overflow-hidden">
        ${data.rows.length ? data.rows.map((r) => `
          <div class="flex items-center gap-3 px-4 py-3 flex-wrap">
            <div class="min-w-0 flex-1">
              <p class="text-body-sm font-bold text-on-surface">${escapeHtml(r.client_name)}</p>
              <p class="text-[11px] text-on-surface-variant">${escapeHtml(r.phone || '')}${r.work_order_number ? ` · Trabajo ${escapeHtml(r.work_order_number)} · <span class="${r.delivered ? 'text-error font-bold' : ''}">${STAGE_LABEL[r.work_order_stage] || ''}</span>` : ''} · vendido ${fmtDate(r.closed_at)}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-body-sm font-bold text-error">${formatMoney(r.balance)}</p>
              <p class="text-[11px] text-on-surface-variant">de ${formatMoney(r.amount)} · abonado ${formatMoney(r.paid)}</p>
            </div>
            <button data-pay="${r.lead_id}" class="btn btn-secondary shrink-0">Registrar abono</button>
          </div>`).join('') : empty('Nadie te debe nada.')}
      </div>`;
    bodyEl.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => openAbono(data.rows.find((r) => r.lead_id === Number(b.dataset.pay)))));
  }

  function openAbono(row) {
    const accounts = meta.accounts.filter((a) => a.active);
    openModal({
      title: `Abono · ${escapeHtml(row.client_name)}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-body-sm text-on-surface-variant mb-3">Saldo pendiente: <b class="text-on-surface">${formatMoney(row.balance)}</b></p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${labelCls}">Valor</label><input id="ab-amount" type="text" inputmode="numeric" value="${row.balance}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Entró a</label><select id="ab-account" class="${inputCls}">${accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
          </div>
          <div class="mt-3"><label class="${labelCls}">Nota</label><input id="ab-notes" type="text" placeholder="Ej. saldo contra entrega" class="${inputCls}" /></div>
          <div class="flex justify-end gap-2 mt-4"><button id="ab-cancel" class="btn btn-ghost">Cancelar</button><button id="ab-ok" class="btn btn-primary">Registrar abono</button></div>`;
        bindMoneyInput(body.querySelector('#ab-amount'));
        body.querySelector('#ab-cancel').addEventListener('click', close);
        body.querySelector('#ab-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post(`/api/leads/${row.lead_id}/payments`, {
              amount: digits(body.querySelector('#ab-amount').value),
              account_id: Number(body.querySelector('#ab-account').value),
              work_order_id: row.work_order_id || null,
              notes: body.querySelector('#ab-notes').value,
            });
            ctx.toast('Abono registrado', 'success');
            close();
            await refreshMeta();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- Gastos fijos ---------------------------------------------------------------------------
  async function renderFijos() {
    const d = await ctx.api.get(`/api/cash/recurring?month=${month}`);
    const accName = (id) => meta.accounts.find((a) => a.id === id)?.name || 'Sin cuenta';
    bodyEl.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-gutter">
        ${kpi('Gastos fijos del mes', formatMoney(d.total), `${d.rows.length} gasto(s)`)}
        ${kpi('Falta por pagar', formatMoney(d.pending), d.rows.filter((r) => r.overdue).length ? `${d.rows.filter((r) => r.overdue).length} vencido(s)` : '', d.rows.some((r) => r.overdue) ? 'bad' : '')}
        <div class="col-span-2 lg:col-span-1 flex items-center"><button id="fx-new" class="btn btn-secondary w-full sm:w-auto"><span class="material-symbols-outlined">add</span>Nuevo gasto fijo</button></div>
      </div>
      <div class="${CARD} divide-y divide-outline-variant overflow-hidden">
        ${d.rows.length ? d.rows.map((r) => `
          <div class="flex items-center gap-3 px-4 py-3 flex-wrap">
            <span class="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[18px]">${CATEGORY_ICON[r.category] || 'event_repeat'}</span></span>
            <div class="min-w-0 flex-1">
              <p class="text-body-sm font-bold text-on-surface">${escapeHtml(r.name)}</p>
              <p class="text-[11px] text-on-surface-variant">${escapeHtml(r.category)} · el día ${r.day_of_month} · ${escapeHtml(accName(r.account_id))}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-body-sm font-bold text-on-surface">${formatMoney(r.paid ? r.paid_amount : r.amount)}</p>
              <p class="text-[11px] ${r.paid ? 'text-status-good' : r.overdue ? 'text-error font-bold' : 'text-on-surface-variant'}">${r.paid ? `Pagado el ${fmtDate(r.paid_date)}` : r.overdue ? `Vencido (${fmtDate(r.due_date)})` : `Vence el ${fmtDate(r.due_date)}`}</p>
            </div>
            <div class="flex gap-1 shrink-0">
              ${r.paid ? '' : `<button data-fx-pay="${r.id}" class="btn btn-primary !px-3">Pagar</button>`}
              <button data-fx-edit="${r.id}" class="btn btn-icon" aria-label="Editar"><span class="material-symbols-outlined">edit</span></button>
            </div>
          </div>`).join('') : empty('Agrega los gastos que se repiten cada mes (arriendo, servicios, internet, plan del celular...) y aquí verás cuáles faltan por pagar.')}
      </div>`;
    bodyEl.querySelector('#fx-new').addEventListener('click', () => openFixed(null));
    bodyEl.querySelectorAll('[data-fx-pay]').forEach((b) => b.addEventListener('click', () => openPayFixed(d.rows.find((r) => r.id === Number(b.dataset.fxPay)))));
    bodyEl.querySelectorAll('[data-fx-edit]').forEach((b) => b.addEventListener('click', () => openFixed(d.rows.find((r) => r.id === Number(b.dataset.fxEdit)))));
  }

  function openFixed(r) {
    const cats = (meta.categories.egreso || []).filter((c) => !meta.non_operating?.includes(c));
    openModal({
      title: r ? 'Editar gasto fijo' : 'Nuevo gasto fijo',
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="space-y-3">
            <div><label class="${labelCls}">Nombre</label><input id="fx-name" type="text" value="${escapeHtml(r?.name || '')}" placeholder="Ej. Arriendo del local" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Categoría</label><select id="fx-cat" class="${inputCls}">${cats.map((c) => `<option ${c === (r?.category || 'Arriendo') ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select></div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="${labelCls}">Valor aproximado</label><input id="fx-amount" type="text" inputmode="numeric" value="${r?.amount || ''}" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Día de pago</label><input id="fx-day" type="number" min="1" max="31" value="${r?.day_of_month || 1}" class="${inputCls}" /></div>
            </div>
            <div><label class="${labelCls}">Se paga desde</label><select id="fx-acc" class="${inputCls}"><option value="">Elegir al pagar</option>${meta.accounts.filter((a) => a.active).map((a) => `<option value="${a.id}" ${a.id === r?.account_id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select></div>
          </div>
          <div class="flex justify-between gap-2 mt-5">
            <div>${r ? '<button id="fx-del" class="btn btn-ghost !text-error">Quitar</button>' : ''}</div>
            <div class="flex gap-2"><button id="fx-cancel" class="btn btn-ghost">Cancelar</button><button id="fx-ok" class="btn btn-primary">Guardar</button></div>
          </div>`;
        bindMoneyInput(body.querySelector('#fx-amount'));
        body.querySelector('#fx-cancel').addEventListener('click', close);
        body.querySelector('#fx-del')?.addEventListener('click', async () => {
          const ok = await confirmModal({ title: 'Quitar gasto fijo', message: `"${r.name}" deja de aparecer en los próximos meses. Los pagos ya registrados se conservan.`, confirmLabel: 'Quitar', danger: true });
          if (!ok) return;
          try {
            await ctx.api.del(`/api/cash/recurring/${r.id}`);
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
        body.querySelector('#fx-ok').addEventListener('click', async () => {
          const payload = {
            name: body.querySelector('#fx-name').value,
            category: body.querySelector('#fx-cat').value,
            amount: digits(body.querySelector('#fx-amount').value),
            day_of_month: Number(body.querySelector('#fx-day').value),
            account_id: Number(body.querySelector('#fx-acc').value) || null,
          };
          try {
            if (r) await ctx.api.patch(`/api/cash/recurring/${r.id}`, payload);
            else await ctx.api.post('/api/cash/recurring', payload);
            ctx.toast('Gasto fijo guardado', 'success');
            close();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  function openPayFixed(r) {
    if (!r) return;
    const accounts = meta.accounts.filter((a) => a.active);
    openModal({
      title: `Pagar · ${escapeHtml(r.name)}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${labelCls}">Valor</label><input id="pf-amount" type="text" inputmode="numeric" value="${r.amount}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Fecha</label><input id="pf-date" type="date" value="${todayIso()}" class="${inputCls}" /></div>
          </div>
          <div class="mt-3"><label class="${labelCls}">Salió de</label><select id="pf-acc" class="${inputCls}">${accounts.map((a) => `<option value="${a.id}" ${a.id === r.account_id ? 'selected' : ''}>${escapeHtml(a.name)} · ${formatMoney(a.balance)}</option>`).join('')}</select></div>
          <div class="flex justify-end gap-2 mt-5"><button id="pf-cancel" class="btn btn-ghost">Cancelar</button><button id="pf-ok" class="btn btn-primary">Registrar pago</button></div>`;
        bindMoneyInput(body.querySelector('#pf-amount'));
        body.querySelector('#pf-cancel').addEventListener('click', close);
        body.querySelector('#pf-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post(`/api/cash/recurring/${r.id}/pay`, {
              amount: digits(body.querySelector('#pf-amount').value),
              date: body.querySelector('#pf-date').value,
              account_id: Number(body.querySelector('#pf-acc').value),
            });
            ctx.toast('Pago registrado', 'success');
            close();
            await refreshMeta();
            load();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- Ganancia por trabajo -------------------------------------------------------------------
  async function renderGanancia() {
    const [f, t] = monthBounds(month);
    const d = await ctx.api.get(`/api/cash/profitability?from=${f}&to=${t}&scope=${profitScope}`);
    const tt = d.totals;
    const cost = tt.materials_cost + tt.labor_cost + tt.other_cost;
    const pct = tt.revenue ? Math.round((tt.margin / tt.revenue) * 100) : 0;
    bodyEl.innerHTML = `
      <div class="flex gap-1.5 mb-gutter" role="group">
        ${[['entregados', `Entregados en ${MONTHS[Number(month.slice(5)) - 1]}`], ['todos', 'Todos los trabajos']].map(([k, l]) => `<button data-scope="${k}" class="px-3 py-2 border rounded-md text-body-sm ${profitScope === k ? 'border-outline bg-surface-container-high text-on-surface font-bold' : 'border-outline-variant text-on-surface hover:bg-surface-container-low'}">${l}</button>`).join('')}
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-gutter">
        ${kpi('Trabajos', d.rows.length)}
        ${kpi('Cobrado (sin IVA)', formatMoney(tt.revenue))}
        ${kpi('Costos del trabajo', formatMoney(cost), `Material ${formatMoney(tt.materials_cost)} · Operarios ${formatMoney(tt.labor_cost)}`)}
        ${kpi('Te quedó', formatMoney(tt.margin), `${pct} % de lo cobrado`, tt.margin < 0 ? 'bad' : 'good')}
      </div>
      <p class="text-[12px] text-on-surface-variant mb-gutter">Cada trabajo resta el material que sacaste del inventario para él y los gastos que ligaste a él (pago al operario, transporte…). Los gastos fijos del local no se reparten aquí; se ven en el Resumen.</p>
      <div class="grid grid-cols-1 2xl:grid-cols-5 gap-gutter">
        <div class="${CARD} p-4 2xl:col-span-2">
          <p class="text-body-md font-bold text-on-surface mb-3">Por servicio</p>
          ${d.by_service.length ? d.by_service.map((s) => `
            <div class="py-2 border-b border-outline-variant last:border-b-0">
              <div class="flex justify-between text-body-sm"><span class="font-bold text-on-surface">${escapeHtml(findService(s.service_slug)?.title || 'Otro')}</span><span class="text-on-surface">${formatMoney(s.margin)}</span></div>
              <p class="text-[11px] text-on-surface-variant">${s.jobs} trabajo(s) · cobrado ${formatMoney(s.revenue)} · costos ${formatMoney(s.cost)} · ${s.revenue ? Math.round((s.margin / s.revenue) * 100) : 0} %</p>
            </div>`).join('') : '<p class="text-body-sm text-on-surface-variant">Sin trabajos en este periodo.</p>'}
        </div>
        <div class="${CARD} 2xl:col-span-3 overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-[620px]">
            <thead><tr class="border-b border-outline-variant">
              ${['Trabajo', 'Cobrado', 'Material', 'Operario', 'Otros', 'Quedó'].map((h, i) => `<th class="p-table-cell-padding eyebrow !text-[10px] text-on-surface-variant ${i ? 'text-right' : ''}">${h}</th>`).join('')}
            </tr></thead>
            <tbody class="divide-y divide-outline-variant">
              ${d.rows.length ? d.rows.map((r) => `
                <tr>
                  <td class="p-table-cell-padding text-body-sm"><span class="font-bold text-on-surface">${escapeHtml(r.number || '')}</span> · ${escapeHtml(r.client_name)}<span class="block text-[11px] text-on-surface-variant">${escapeHtml(findService(r.service_slug)?.title || 'Otro')} · ${STAGE_LABEL[r.stage] || r.stage}${r.worker_name ? ` · ${escapeHtml(r.worker_name)}` : ''}</span></td>
                  <td class="p-table-cell-padding text-right text-body-sm">${formatMoney(r.revenue)}</td>
                  <td class="p-table-cell-padding text-right text-body-sm text-on-surface-variant">${formatMoney(r.materials_cost)}</td>
                  <td class="p-table-cell-padding text-right text-body-sm text-on-surface-variant">${formatMoney(r.labor_cost)}</td>
                  <td class="p-table-cell-padding text-right text-body-sm text-on-surface-variant">${formatMoney(r.other_cost)}</td>
                  <td class="p-table-cell-padding text-right text-body-sm font-bold ${r.margin < 0 ? 'text-error' : 'text-on-surface'}">${formatMoney(r.margin)}${r.margin_pct !== null ? `<span class="block text-[11px] font-normal text-on-surface-variant">${r.margin_pct} %</span>` : ''}</td>
                </tr>`).join('') : `<tr><td colspan="6">${empty('Sin trabajos en este periodo.')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    bodyEl.querySelectorAll('[data-scope]').forEach((b) =>
      b.addEventListener('click', () => {
        profitScope = b.dataset.scope;
        load();
      })
    );
  }

  // ---- Operarios --------------------------------------------------------------------------------
  async function renderOperarios() {
    const [f, t] = monthBounds(month);
    const d = await ctx.api.get(`/api/cash/workers?from=${f}&to=${t}`);
    const total = d.rows.reduce((s, r) => s + r.paid, 0);
    bodyEl.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-gutter">
        ${kpi(`Pagado a operarios en ${MONTHS[Number(month.slice(5)) - 1]}`, formatMoney(total))}
        ${kpi('Operarios activos', d.rows.filter((r) => r.active).length)}
      </div>
      <div class="${CARD} divide-y divide-outline-variant overflow-hidden">
        ${d.rows.length ? d.rows.map((r) => `
          <div class="flex items-center gap-3 px-4 py-3 flex-wrap">
            <span class="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center font-bold text-on-surface shrink-0">${escapeHtml(r.name.slice(0, 1).toUpperCase())}</span>
            <div class="min-w-0 flex-1">
              <p class="text-body-sm font-bold text-on-surface">${escapeHtml(r.name)}${r.active ? '' : ' <span class="text-on-surface-variant font-normal">(inactivo)</span>'}</p>
              <p class="text-[11px] text-on-surface-variant">${r.jobs_delivered} trabajo(s) entregado(s) · ${r.payments} pago(s) en el mes</p>
            </div>
            <p class="text-body-sm font-bold text-on-surface shrink-0">${formatMoney(r.paid)}</p>
            ${r.active ? `<button data-pay-worker="${r.id}" class="btn btn-secondary shrink-0">Registrar pago</button>` : ''}
          </div>`).join('') : empty('Aún no hay operarios. Agrégalos en Configuración → Operarios.')}
      </div>`;
    bodyEl.querySelectorAll('[data-pay-worker]').forEach((b) =>
      b.addEventListener('click', () => {
        const w = d.rows.find((r) => r.id === Number(b.dataset.payWorker));
        openEntry('egreso', null, { category: LABOR, worker_id: w.id, description: `Pago a ${w.name}` });
      })
    );
  }

  // ---- navegación ---------------------------------------------------------------------------
  function go(next) {
    tab = next;
    paintChrome();
    if (tab === 'movimientos') paintRange();
    load();
  }

  async function load() {
    if (chart) {
      destroyChart(bodyEl.querySelector('#fn-chart'));
      chart = null;
    }
    try {
      if (tab === 'resumen') await renderResumen();
      else if (tab === 'movimientos') await renderMovimientos();
      else if (tab === 'cobrar') await renderCobrar();
      else if (tab === 'fijos') await renderFijos();
      else if (tab === 'ganancia') await renderGanancia();
      else await renderOperarios();
    } catch (err) {
      ctx.toast(err.message || 'No se pudieron cargar las finanzas', 'error');
    }
  }

  container.querySelectorAll('[role="tablist"] [data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  container.querySelectorAll('[data-month]').forEach((b) =>
    b.addEventListener('click', () => {
      month = shiftMonth(month, Number(b.dataset.month));
      paintChrome();
      load();
    })
  );
  container.querySelector('#fn-month-today').addEventListener('click', () => {
    month = todayIso().slice(0, 7);
    paintChrome();
    load();
  });
  container.querySelectorAll('[data-new]').forEach((b) =>
    b.addEventListener('click', () => (b.dataset.new === 'traslado' ? openTransfer() : openEntry(b.dataset.new)))
  );

  await refreshMeta();
  paintChrome();
  if (tab === 'movimientos') paintRange();
  // Acceso directo desde otras pantallas: #/finanzas?nuevo=gasto abre el formulario.
  if (ctx.routeParams.get('nuevo') === 'gasto') openEntry('egreso');
  const offs = ['cash_changed', 'leads_changed', 'purchases_changed', 'production_changed', 'invoices_changed'].map((ev) =>
    ctx.ws.on(ev, async () => {
      await refreshMeta();
      load();
    })
  );
  await load();
  return () => {
    offs.forEach((off) => off());
    if (chart) destroyChart(bodyEl.querySelector('#fn-chart'));
  };
}
