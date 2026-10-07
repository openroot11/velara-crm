import { escapeHtml, formatMoney } from '../utils.js';
import { openModal, confirmModal } from '../components/modal.js';

// Trabajos del taller: tablero simple por etapas y la ficha de cada trabajo
// (material usado, fotos, abonos, pago al operario y cuánto dejó). Ver
// server/routes/jobs.js. Reemplaza la producción por pedidos/OP pensada para
// una fábrica.

const STAGES = [
  { key: 'por_iniciar', label: 'Por hacer', next: 'Empezar', icon: 'inventory' },
  { key: 'en_proceso', label: 'En proceso', next: 'Marcar listo', icon: 'construction' },
  { key: 'listo', label: 'Listo', next: 'Entregar', icon: 'task_alt' },
  { key: 'entregado', label: 'Entregado', next: null, icon: 'handshake' },
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
STAGE_LABEL.cancelada = 'Cancelado';
const FILE_KIND_LABEL = { antes: 'Antes', despues: 'Después', diseno: 'Diseño', otro: 'Otro' };
const LABOR = 'Nómina y pagos a operarios';

const inputCls = 'w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline bg-surface-container-lowest';
const labelCls = 'block text-[10px] font-label-bold uppercase tracking-wider text-on-surface-variant mb-1';
const CARD = 'bg-surface-container-lowest border border-outline-variant rounded-xl';

function todayIso(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}
function shortDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!m) return '';
  if (value.slice(0, 10) === todayIso()) return 'Hoy';
  if (value.slice(0, 10) === todayIso(1)) return 'Mañana';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
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
function fmtQty(n) {
  return Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

export async function mount(container, ctx) {
  const role = ctx.user?.role;
  const canManage = role === 'admin' || role === 'coordinador';
  const seesMoney = canManage;
  let meta = { workers: [], materials: [], services: [] };
  let cashMeta = { accounts: [], categories: { egreso: [] } };
  const filters = { q: '', worker: '' };

  async function loadMeta() {
    try {
      meta = await ctx.api.get('/api/jobs/meta');
    } catch {
      /* sin meta */
    }
    if (seesMoney) {
      try {
        cashMeta = await ctx.api.get('/api/cash/meta');
      } catch {
        /* sin finanzas */
      }
    }
  }

  // ---- tablero ---------------------------------------------------------------------------
  async function renderBoard() {
    const qs = new URLSearchParams();
    if (filters.q) qs.set('q', filters.q);
    if (filters.worker) qs.set('worker', filters.worker);
    const jobs = await ctx.api.get(`/api/jobs?${qs}`);
    const open = jobs.filter((j) => j.stage !== 'entregado');
    const overdue = open.filter((j) => j.overdue).length;
    const soon = open.filter((j) => j.due_soon).length;
    const ready = jobs.filter((j) => j.stage === 'listo').length;
    const owed = jobs.filter((j) => j.stage === 'entregado' && j.balance > 0);

    container.innerHTML = `
      <div class="flex justify-between items-end mb-gutter flex-wrap gap-3">
        <div>
          <h2 class="text-headline-lg font-headline-lg text-on-surface">Trabajos</h2>
          <p class="text-body-md text-on-surface-variant mt-1">Lo que está en el taller, de la entrada a la entrega.</p>
        </div>
        ${canManage ? '<button id="tj-new" class="btn btn-primary"><span class="material-symbols-outlined">add</span>Nuevo trabajo</button>' : ''}
      </div>

      <div class="flex flex-wrap gap-2 mb-gutter">
        ${chipStat('schedule', `${open.length} en el taller`)}
        ${overdue ? chipStat('event_busy', `${overdue} atrasado(s)`, 'text-error border-error/40') : ''}
        ${soon ? chipStat('alarm', `${soon} para hoy o mañana`) : ''}
        ${ready ? chipStat('task_alt', `${ready} listo(s) para entregar`) : ''}
        ${seesMoney && owed.length ? chipStat('request_quote', `Entregados sin pagar: ${formatMoney(owed.reduce((s, j) => s + j.balance, 0))}`, 'text-error border-error/40') : ''}
      </div>

      <div class="flex flex-wrap gap-2 mb-gutter">
        <input id="tj-q" type="search" value="${escapeHtml(filters.q)}" placeholder="Buscar cliente, número…" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline flex-1 min-w-[180px] max-w-sm" />
        ${meta.workers.length ? `<select id="tj-worker" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline">
          <option value="">Todos los operarios</option>${meta.workers.map((w) => `<option value="${w.id}" ${String(w.id) === filters.worker ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('')}
        </select>` : ''}
      </div>

      <div class="flex lg:grid lg:grid-cols-4 gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-margin-mobile px-margin-mobile sm:mx-0 sm:px-0">
        ${STAGES.map((s) => {
          const list = jobs.filter((j) => j.stage === s.key);
          return `
          <section class="snap-start shrink-0 w-[85vw] sm:w-[320px] lg:w-auto bg-surface-container-low rounded-xl p-3 flex flex-col min-h-[200px]">
            <header class="flex items-center justify-between px-1 pb-3">
              <span class="flex items-center gap-2 text-body-sm font-bold text-on-surface"><span class="material-symbols-outlined text-[18px]">${s.icon}</span>${s.label}</span>
              <span class="text-[12px] text-on-surface-variant">${list.length}</span>
            </header>
            <div class="flex flex-col gap-2">
              ${list.length ? list.map(cardHtml).join('') : `<p class="text-[12px] text-on-surface-variant text-center py-6">${s.key === 'entregado' ? 'Nada entregado en los últimos 30 días.' : 'Nada aquí.'}</p>`}
            </div>
          </section>`;
        }).join('')}
      </div>`;

    container.querySelector('#tj-new')?.addEventListener('click', openNewJob);
    let t;
    container.querySelector('#tj-q').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        filters.q = e.target.value.trim();
        await renderBoard();
        const q = container.querySelector('#tj-q');
        q.focus();
        q.setSelectionRange(q.value.length, q.value.length);
      }, 300);
    });
    container.querySelector('#tj-worker')?.addEventListener('change', (e) => {
      filters.worker = e.target.value;
      renderBoard();
    });
    container.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => ctx.navigate('trabajos', { id: el.dataset.open })));
    container.querySelectorAll('[data-advance]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const job = jobs.find((j) => j.id === Number(b.dataset.advance));
        advance(job);
      })
    );
  }

  function chipStat(icon, label, cls = 'text-on-surface border-outline-variant') {
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-surface-container-lowest text-body-sm ${cls}"><span class="material-symbols-outlined text-[16px]">${icon}</span>${label}</span>`;
  }

  function cardHtml(j) {
    const stage = STAGES.find((s) => s.key === j.stage);
    const dateCls = j.overdue ? 'text-error font-bold' : j.due_soon ? 'text-on-surface font-bold' : 'text-on-surface-variant';
    return `
      <article data-open="${j.id}" class="${CARD} p-3 cursor-pointer hover:border-on-surface transition-colors">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="text-[11px] font-semibold text-on-surface-variant">${escapeHtml(j.number || '')}${j.service_title ? ` · ${escapeHtml(j.service_title)}` : ''}</span>
          ${j.files_count ? `<span class="material-symbols-outlined text-[14px] text-on-surface-variant" title="${j.files_count} foto(s)">photo_camera</span>` : ''}
        </div>
        <p class="text-body-sm font-bold text-on-surface leading-snug">${escapeHtml(j.client_name)}</p>
        ${j.description ? `<p class="text-[12px] text-on-surface-variant mt-0.5 line-clamp-2">${escapeHtml(j.description)}</p>` : ''}
        <div class="flex items-center justify-between gap-2 mt-2.5 flex-wrap">
          <span class="flex items-center gap-1 text-[12px] ${dateCls}">
            ${j.stage === 'entregado' ? `<span class="material-symbols-outlined text-[14px]">check</span>${shortDate(j.delivered_at)}` : j.promised_date ? `<span class="material-symbols-outlined text-[14px]">${j.overdue ? 'event_busy' : 'event'}</span>${j.overdue ? 'Atrasado · ' : ''}${shortDate(j.promised_date)}` : '<span class="text-on-surface-variant">Sin fecha</span>'}
          </span>
          ${j.worker_name ? `<span class="flex items-center gap-1 text-[12px] text-on-surface-variant"><span class="w-5 h-5 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center text-[10px] font-bold">${escapeHtml(j.worker_name.slice(0, 1).toUpperCase())}</span>${escapeHtml(j.worker_name.split(' ')[0])}</span>` : ''}
        </div>
        ${seesMoney && j.balance > 0 ? `<p class="text-[12px] mt-2 ${j.stage === 'entregado' ? 'text-error font-bold' : 'text-on-surface-variant'}">Debe ${formatMoney(j.balance)}</p>` : ''}
        ${stage.next ? `<button data-advance="${j.id}" class="mt-3 w-full flex items-center justify-center gap-1 py-1.5 rounded-full border border-outline-variant text-[12px] font-semibold text-on-surface hover:bg-on-surface hover:text-surface hover:border-on-surface transition-colors">${stage.next}<span class="material-symbols-outlined text-[16px]">arrow_forward</span></button>` : ''}
      </article>`;
  }

  async function advance(job) {
    const idx = STAGES.findIndex((s) => s.key === job.stage);
    const next = STAGES[idx + 1];
    if (!next) return;
    if (next.key === 'entregado') return openDeliver(job);
    try {
      await ctx.api.post(`/api/jobs/${job.id}/stage`, { stage: next.key });
      ctx.toast(`${job.number} → ${next.label}`, 'success');
      reload();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  // ---- nuevo / editar -----------------------------------------------------------------------
  function jobForm(job) {
    return `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2"><label class="${labelCls}">Cliente</label><input id="jf-client" type="text" value="${escapeHtml(job?.client_name || '')}" class="${inputCls}" /></div>
        <div><label class="${labelCls}">Teléfono</label><input id="jf-phone" type="tel" value="${escapeHtml(job?.phone || '')}" class="${inputCls}" /></div>
        <div><label class="${labelCls}">Servicio</label><select id="jf-service" class="${inputCls}"><option value="">Otro</option>${meta.services.map((s) => `<option value="${s.slug}" ${s.slug === job?.service_slug ? 'selected' : ''}>${escapeHtml(s.title)}</option>`).join('')}</select></div>
        <div class="sm:col-span-2"><label class="${labelCls}">Qué hay que hacer</label><textarea id="jf-desc" rows="3" class="${inputCls}" placeholder="Ej. Forro completo en cuero sintético negro, costura roja">${escapeHtml(job?.description || '')}</textarea></div>
        ${seesMoney ? `<div><label class="${labelCls}">Valor del trabajo (con IVA)</label><input id="jf-amount" type="text" inputmode="numeric" value="${job?.amount_total ?? ''}" class="${inputCls}" /></div>` : ''}
        <div><label class="${labelCls}">Fecha de entrega</label><input id="jf-date" type="date" value="${job?.promised_date || ''}" class="${inputCls}" /></div>
        <div><label class="${labelCls}">Operario</label><select id="jf-worker" class="${inputCls}"><option value="">Sin asignar</option>${meta.workers.map((w) => `<option value="${w.id}" ${w.id === job?.worker_id ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('')}</select></div>
        ${seesMoney ? `<div><label class="${labelCls}">Pago acordado al operario</label><input id="jf-labor" type="text" inputmode="numeric" value="${job?.labor_cost || ''}" class="${inputCls}" /></div>` : ''}
        <div class="sm:col-span-2"><label class="${labelCls}">Dirección (si es instalación)</label><input id="jf-address" type="text" value="${escapeHtml(job?.address || '')}" class="${inputCls}" /></div>
        <div class="sm:col-span-2"><label class="${labelCls}">Notas</label><input id="jf-notes" type="text" value="${escapeHtml(job?.notes || '')}" class="${inputCls}" /></div>
        ${job ? `<div><label class="${labelCls}">Garantía (meses)</label><input id="jf-warranty" type="number" min="0" value="${job.warranty_months ?? 6}" class="${inputCls}" /></div>` : ''}
      </div>`;
  }

  function readJobForm(body) {
    const v = (id) => body.querySelector(id)?.value;
    const payload = {
      client_name: v('#jf-client'),
      phone: v('#jf-phone'),
      service_slug: v('#jf-service') || null,
      description: v('#jf-desc'),
      promised_date: v('#jf-date') || null,
      worker_id: Number(v('#jf-worker')) || null,
      address: v('#jf-address'),
      notes: v('#jf-notes'),
    };
    if (body.querySelector('#jf-amount')) payload.amount_total = digits(v('#jf-amount'));
    if (body.querySelector('#jf-labor')) payload.labor_cost = digits(v('#jf-labor'));
    if (body.querySelector('#jf-warranty')) payload.warranty_months = Number(v('#jf-warranty'));
    return payload;
  }

  function openNewJob() {
    openModal({
      title: 'Nuevo trabajo',
      wide: true,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-[12px] text-on-surface-variant mb-4">Para un trabajo que ya cotizaste, ábrelo desde la cotización con "Crear trabajo": se llena solo.</p>
          ${jobForm(null)}
          <div class="flex justify-end gap-2 mt-5"><button id="jf-cancel" class="btn btn-ghost">Cancelar</button><button id="jf-ok" class="btn btn-primary">Crear trabajo</button></div>`;
        body.querySelectorAll('#jf-amount, #jf-labor').forEach(bindMoneyInput);
        body.querySelector('#jf-cancel').addEventListener('click', close);
        body.querySelector('#jf-ok').addEventListener('click', async () => {
          try {
            const job = await ctx.api.post('/api/jobs', readJobForm(body));
            ctx.toast(`Trabajo ${job.number} creado`, 'success');
            close();
            ctx.navigate('trabajos', { id: job.id });
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  function openEditJob(job) {
    openModal({
      title: `Editar ${escapeHtml(job.number)}`,
      wide: true,
      render: (body, { close }) => {
        body.innerHTML = `
          ${jobForm(job)}
          <div class="flex justify-between gap-2 mt-5">
            <div>${canManage && job.stage !== 'cancelada' ? '<button id="jf-del" class="btn btn-ghost !text-error">Cancelar trabajo</button>' : ''}</div>
            <div class="flex gap-2"><button id="jf-cancel" class="btn btn-ghost">Cerrar</button><button id="jf-ok" class="btn btn-primary">Guardar</button></div>
          </div>`;
        body.querySelectorAll('#jf-amount, #jf-labor').forEach(bindMoneyInput);
        body.querySelector('#jf-cancel').addEventListener('click', close);
        body.querySelector('#jf-del')?.addEventListener('click', async () => {
          const ok = await confirmModal({ title: 'Cancelar trabajo', message: `${job.number} sale del tablero. Lo que ya se registró (abonos, material, gastos) se conserva.`, confirmLabel: 'Cancelar trabajo', danger: true });
          if (!ok) return;
          try {
            await ctx.api.post(`/api/jobs/${job.id}/cancel`, {});
            close();
            ctx.navigate('trabajos');
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
        body.querySelector('#jf-ok').addEventListener('click', async () => {
          try {
            await ctx.api.patch(`/api/jobs/${job.id}`, readJobForm(body));
            ctx.toast('Cambios guardados', 'success');
            close();
            reload();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- entregar ------------------------------------------------------------------------------
  function openDeliver(job) {
    const accounts = cashMeta.accounts.filter((a) => a.active);
    openModal({
      title: `Entregar ${escapeHtml(job.number)}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="space-y-3">
            <div><label class="${labelCls}">Quién recibió</label><input id="dv-who" type="text" value="${escapeHtml(job.client_name)}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Fecha de entrega</label><input id="dv-date" type="date" value="${todayIso()}" class="${inputCls}" /></div>
            ${seesMoney && job.balance > 0 ? `
            <div class="rounded-lg border border-outline-variant p-3">
              <label class="flex items-center gap-2 text-body-sm text-on-surface"><input id="dv-pay" type="checkbox" checked /> El cliente pagó el saldo de <b>${formatMoney(job.balance)}</b></label>
              <div id="dv-pay-fields" class="grid grid-cols-2 gap-3 mt-3">
                <div><label class="${labelCls}">Valor</label><input id="dv-amount" type="text" inputmode="numeric" value="${job.balance}" class="${inputCls}" /></div>
                <div><label class="${labelCls}">Entró a</label><select id="dv-acc" class="${inputCls}">${accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
              </div>
            </div>` : ''}
          </div>
          <div class="flex justify-end gap-2 mt-5"><button id="dv-cancel" class="btn btn-ghost">Cancelar</button><button id="dv-ok" class="btn btn-primary">Marcar entregado</button></div>`;
        const amountEl = body.querySelector('#dv-amount');
        if (amountEl) bindMoneyInput(amountEl);
        body.querySelector('#dv-pay')?.addEventListener('change', (e) => body.querySelector('#dv-pay-fields').classList.toggle('hidden', !e.target.checked));
        body.querySelector('#dv-cancel').addEventListener('click', close);
        body.querySelector('#dv-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post(`/api/jobs/${job.id}/stage`, { stage: 'entregado', received_by: body.querySelector('#dv-who').value, date: body.querySelector('#dv-date').value });
            if (body.querySelector('#dv-pay')?.checked && job.lead_id) {
              await ctx.api.post(`/api/leads/${job.lead_id}/payments`, {
                amount: digits(amountEl.value),
                account_id: Number(body.querySelector('#dv-acc').value) || null,
                work_order_id: job.id,
                notes: 'Saldo contra entrega',
              });
            }
            ctx.toast(`${job.number} entregado`, 'success');
            close();
            reload();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  // ---- ficha del trabajo -------------------------------------------------------------------------
  async function renderDetail(id) {
    let job;
    try {
      job = await ctx.api.get(`/api/jobs/${id}`);
    } catch (err) {
      container.innerHTML = `<p class="p-10 text-center text-on-surface-variant">${escapeHtml(err.message)}</p>`;
      return;
    }
    const idx = STAGES.findIndex((s) => s.key === job.stage);
    const fields = Object.entries(job.service_fields || {}).filter(([, v]) => v);
    const p = job.profit;
    const usedByMaterial = new Map();
    for (const m of job.materials) {
      const cur = usedByMaterial.get(m.material_id) || { name: m.name, unit: m.unit, qty: 0, cost: 0 };
      cur.qty -= Number(m.qty);
      cur.cost -= Number(m.qty) * Number(m.unit_cost);
      usedByMaterial.set(m.material_id, cur);
    }
    const used = [...usedByMaterial.entries()].filter(([, v]) => v.qty > 0.0001);
    const photos = job.files.filter((f) => /^image\//.test(f.mime || ''));
    const otherFiles = job.files.filter((f) => !/^image\//.test(f.mime || ''));

    container.innerHTML = `
      <a href="#/trabajos" class="inline-flex items-center gap-1 text-body-sm text-on-surface-variant hover:text-on-surface mb-3"><span class="material-symbols-outlined text-[18px]">arrow_back</span>Trabajos</a>
      <div class="flex justify-between items-start gap-3 flex-wrap mb-gutter">
        <div class="min-w-0">
          <p class="eyebrow text-on-surface-variant !text-[10px]">${escapeHtml(job.number)}${job.service_title ? ` · ${escapeHtml(job.service_title)}` : ''}${job.quotation_number ? ` · Cotización ${escapeHtml(job.quotation_number)}` : ''}</p>
          <h2 class="text-headline-lg font-headline-lg text-on-surface mt-2">${escapeHtml(job.client_name)}</h2>
          <p class="text-body-sm text-on-surface-variant mt-1">${job.phone ? `<a class="underline" href="https://wa.me/${(job.phone || '').replace(/\D/g, '').replace(/^(\d{10})$/, '57$1')}" target="_blank" rel="noopener">${escapeHtml(job.phone)}</a>` : 'Sin teléfono'}${job.address ? ` · ${escapeHtml(job.address)}` : ''}</p>
        </div>
        <div class="flex gap-2 flex-wrap">
          <a href="/api/jobs/${job.id}/pdf/orden" target="_blank" class="btn btn-secondary"><span class="material-symbols-outlined">description</span>Orden de trabajo</a>
          ${job.stage === 'entregado' ? `<a href="/api/jobs/${job.id}/pdf/acta" target="_blank" class="btn btn-secondary"><span class="material-symbols-outlined">verified</span>Acta y garantía</a>` : ''}
          ${canManage ? '<button id="jd-edit" class="btn btn-secondary"><span class="material-symbols-outlined">edit</span>Editar</button>' : ''}
        </div>
      </div>

      ${job.stage === 'cancelada' ? `<div class="px-4 py-3 rounded-lg border border-error/40 bg-error-container/40 text-body-sm text-on-surface mb-gutter">Trabajo cancelado${job.cancel_reason ? `: ${escapeHtml(job.cancel_reason)}` : ''}.</div>` : `
      <div class="${CARD} p-3 sm:p-4 mb-gutter">
        <ol class="grid grid-cols-4 gap-1 sm:gap-2">
          ${STAGES.map((s, i) => `
            <li>
              <button data-stage="${s.key}" class="w-full text-left rounded-lg px-2 sm:px-3 py-2 transition-colors ${i === idx ? 'bg-on-surface text-surface' : i < idx ? 'bg-surface-container text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-low'}">
                <span class="block h-1 rounded-full mb-2 ${i <= idx ? (i === idx ? 'bg-primary' : 'bg-on-surface-variant') : 'bg-surface-container-high'}"></span>
                <span class="block text-[11px] sm:text-body-sm font-semibold truncate">${s.label}</span>
              </button>
            </li>`).join('')}
        </ol>
        <div class="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <p class="text-body-sm ${job.overdue ? 'text-error font-bold' : 'text-on-surface-variant'}">
            ${job.stage === 'entregado' ? `Entregado el ${fmtDate(job.delivered_at)}${job.received_by ? ` a ${escapeHtml(job.received_by)}` : ''}${job.warranty_until ? ` · garantía hasta el ${fmtDate(job.warranty_until)}` : ''}` : job.promised_date ? `${job.overdue ? 'Atrasado: se prometió para el' : 'Entrega prometida:'} ${fmtDate(job.promised_date)}` : 'Sin fecha de entrega'}
          </p>
          ${STAGES[idx]?.next ? `<button id="jd-advance" class="btn btn-primary">${STAGES[idx].next}<span class="material-symbols-outlined">arrow_forward</span></button>` : ''}
        </div>
      </div>`}

      <div class="grid grid-cols-1 xl:grid-cols-3 gap-gutter">
        <div class="xl:col-span-2 space-y-gutter">
          <section class="${CARD} p-4 sm:p-5">
            <p class="text-body-md font-bold text-on-surface mb-3">Qué hay que hacer</p>
            <p class="text-body-md text-on-surface whitespace-pre-line">${escapeHtml(job.description || 'Sin descripción.')}</p>
            ${fields.length ? `<dl class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">${fields.map(([k, v]) => `<div><dt class="text-[11px] text-on-surface-variant capitalize">${escapeHtml(k.replace(/_/g, ' '))}</dt><dd class="text-body-sm font-semibold text-on-surface">${escapeHtml(v)}</dd></div>`).join('')}</dl>` : ''}
            <div class="flex flex-wrap gap-x-6 gap-y-2 mt-4 pt-4 border-t border-outline-variant text-body-sm">
              <span><span class="text-on-surface-variant">Operario:</span> <b>${escapeHtml(job.worker_name || 'Sin asignar')}</b></span>
              ${job.notes ? `<span><span class="text-on-surface-variant">Notas:</span> ${escapeHtml(job.notes)}</span>` : ''}
            </div>
          </section>

          <section class="${CARD} p-4 sm:p-5">
            <div class="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <p class="text-body-md font-bold text-on-surface">Fotos</p>
              <div class="flex gap-2">
                ${['antes', 'despues'].map((k) => `
                  <label class="btn btn-secondary cursor-pointer !py-1.5"><span class="material-symbols-outlined">photo_camera</span>${FILE_KIND_LABEL[k]}
                    <input data-upload="${k}" type="file" accept="image/*" capture="environment" class="hidden" />
                  </label>`).join('')}
                <label class="btn btn-ghost cursor-pointer !py-1.5" title="Diseño, plano u otro archivo"><span class="material-symbols-outlined">attach_file</span>
                  <input data-upload="otro" type="file" class="hidden" />
                </label>
              </div>
            </div>
            ${photos.length ? `<div class="grid grid-cols-3 sm:grid-cols-4 gap-2">${photos.map((f) => `
              <figure class="relative group">
                <a href="/api/jobs/files/${f.id}" target="_blank"><img src="/api/jobs/files/${f.id}" alt="${escapeHtml(f.original_name || '')}" loading="lazy" class="w-full aspect-square object-cover rounded-lg border border-outline-variant" /></a>
                <figcaption class="absolute left-1.5 top-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-semibold">${FILE_KIND_LABEL[f.kind] || f.kind}</figcaption>
                ${canManage ? `<button data-del-file="${f.id}" class="absolute right-1 top-1 w-6 h-6 rounded-full bg-black/60 text-white hidden group-hover:flex items-center justify-center" aria-label="Borrar foto"><span class="material-symbols-outlined text-[14px]">close</span></button>` : ''}
              </figure>`).join('')}</div>` : '<p class="text-body-sm text-on-surface-variant">Toma una foto al recibir y otra al entregar: sirve para la garantía y para mostrar tu trabajo.</p>'}
            ${otherFiles.length ? `<ul class="mt-3 space-y-1">${otherFiles.map((f) => `<li class="flex items-center justify-between text-body-sm"><a class="underline text-on-surface truncate" href="/api/jobs/files/${f.id}" target="_blank">${escapeHtml(f.original_name || 'Archivo')}</a>${canManage ? `<button data-del-file="${f.id}" class="text-on-surface-variant hover:text-error" aria-label="Borrar"><span class="material-symbols-outlined text-[16px]">delete</span></button>` : ''}</li>`).join('')}</ul>` : ''}
          </section>

          <section class="${CARD} p-4 sm:p-5">
            <p class="text-body-md font-bold text-on-surface mb-3">Material usado</p>
            ${used.length ? `<div class="divide-y divide-outline-variant mb-4">${used.map(([mid, m]) => `
              <div class="flex items-center justify-between gap-3 py-2">
                <span class="text-body-sm text-on-surface">${escapeHtml(m.name)}</span>
                <span class="flex items-center gap-3 shrink-0">
                  <span class="text-body-sm font-semibold">${fmtQty(m.qty)} ${escapeHtml(m.unit)}</span>
                  ${seesMoney ? `<span class="text-[12px] text-on-surface-variant w-24 text-right">${formatMoney(m.cost)}</span>` : ''}
                  <button data-return="${mid}" class="text-[12px] text-on-surface-variant hover:text-on-surface underline">Devolver</button>
                </span>
              </div>`).join('')}</div>` : '<p class="text-body-sm text-on-surface-variant mb-4">Todavía no se ha sacado material del inventario para este trabajo.</p>'}
            ${meta.materials.length ? `
            <div class="flex flex-wrap gap-2 items-end">
              <div class="flex-1 min-w-[180px]"><label class="${labelCls}">Material</label><select id="jd-mat" class="${inputCls}">${meta.materials.map((m) => `<option value="${m.id}">${escapeHtml(m.name)} · quedan ${fmtQty(m.stock)} ${escapeHtml(m.unit)}</option>`).join('')}</select></div>
              <div class="w-28"><label class="${labelCls}">Cantidad</label><input id="jd-qty" type="number" min="0" step="0.1" class="${inputCls}" /></div>
              <button id="jd-use" class="btn btn-secondary">Usar</button>
            </div>` : '<p class="text-[12px] text-on-surface-variant">Agrega tus materiales en Inventario para descontarlos aquí.</p>'}
          </section>
        </div>

        <aside class="space-y-gutter">
          ${seesMoney ? `
          <section class="${CARD} p-4 sm:p-5">
            <p class="text-body-md font-bold text-on-surface mb-3">Cobro</p>
            <div class="space-y-1.5 text-body-sm">
              <div class="flex justify-between"><span class="text-on-surface-variant">Valor del trabajo</span><span class="font-semibold">${formatMoney(job.amount_total)}</span></div>
              <div class="flex justify-between"><span class="text-on-surface-variant">Abonado</span><span>${formatMoney(job.paid)}</span></div>
              <div class="flex justify-between text-body-md pt-1.5 border-t border-outline-variant"><span class="font-bold">Saldo</span><span class="font-bold ${job.balance > 0 ? 'text-error' : 'text-status-good'}">${formatMoney(job.balance)}</span></div>
            </div>
            ${job.payments.length ? `<ul class="mt-3 space-y-1">${job.payments.map((pm) => `<li class="flex justify-between text-[12px] text-on-surface-variant"><span>${fmtDate(pm.paid_at)} · ${escapeHtml(pm.account_name || '')}${pm.notes ? ` · ${escapeHtml(pm.notes)}` : ''}</span><span>${formatMoney(pm.amount)}</span></li>`).join('')}</ul>` : ''}
            ${job.balance > 0 && job.lead_id ? '<button id="jd-pay" class="btn btn-secondary w-full mt-3"><span class="material-symbols-outlined">payments</span>Registrar abono</button>' : ''}
          </section>

          <section class="${CARD} p-4 sm:p-5">
            <p class="text-body-md font-bold text-on-surface mb-3">Operario</p>
            <div class="space-y-1.5 text-body-sm">
              <div class="flex justify-between"><span class="text-on-surface-variant">${escapeHtml(job.worker_name || 'Sin asignar')} · acordado</span><span class="font-semibold">${formatMoney(job.labor_cost)}</span></div>
              <div class="flex justify-between"><span class="text-on-surface-variant">Pagado</span><span>${formatMoney(p.labor_paid)}</span></div>
              ${p.labor_pending ? `<div class="flex justify-between"><span class="font-bold">Falta pagarle</span><span class="font-bold">${formatMoney(p.labor_pending)}</span></div>` : ''}
            </div>
            ${job.worker_id ? `<button id="jd-pay-worker" class="btn btn-secondary w-full mt-3"><span class="material-symbols-outlined">engineering</span>Pagar al operario</button>` : ''}
          </section>

          <section class="${CARD} p-4 sm:p-5">
            <p class="text-body-md font-bold text-on-surface mb-3">Otros gastos del trabajo</p>
            ${job.expenses.filter((e) => e.category !== LABOR).length ? `<ul class="space-y-1 mb-3">${job.expenses.filter((e) => e.category !== LABOR).map((e) => `<li class="flex justify-between gap-2 text-[12px]"><span class="text-on-surface-variant truncate">${escapeHtml(e.category)}${e.description ? ` · ${escapeHtml(e.description)}` : ''}</span><span class="text-on-surface shrink-0">${formatMoney(e.amount)}</span></li>`).join('')}</ul>` : '<p class="text-[12px] text-on-surface-variant mb-3">Transporte, insumos comprados para este trabajo, etc.</p>'}
            <button id="jd-expense" class="btn btn-ghost w-full"><span class="material-symbols-outlined">add</span>Agregar gasto</button>
          </section>

          <section class="relative overflow-hidden rounded-xl bg-[#0B0B0B] text-[#F2F0EA] p-4 sm:p-5">
            <p class="text-body-md font-bold mb-3">Cuánto te deja</p>
            <div class="space-y-1.5 text-body-sm">
              <div class="flex justify-between"><span class="text-[#A7A9AC]">Cobrado sin IVA</span><span>${formatMoney(p.revenue)}</span></div>
              <div class="flex justify-between"><span class="text-[#A7A9AC]">Material</span><span>− ${formatMoney(p.materials_cost)}</span></div>
              <div class="flex justify-between"><span class="text-[#A7A9AC]">Operario</span><span>− ${formatMoney(Math.max(p.labor_paid, job.labor_cost))}</span></div>
              <div class="flex justify-between"><span class="text-[#A7A9AC]">Otros gastos</span><span>− ${formatMoney(p.other_cost)}</span></div>
              <div class="flex justify-between text-[18px] font-bold pt-2 mt-1 border-t border-[#333]"><span>Ganancia</span><span class="${p.margin < 0 ? 'text-[#FF8A80]' : ''}">${formatMoney(p.margin)}</span></div>
              ${p.revenue ? `<p class="text-[11px] text-[#A7A9AC]">${Math.round((p.margin / p.revenue) * 100)} % de lo cobrado</p>` : ''}
            </div>
          </section>` : ''}
        </aside>
      </div>`;

    container.querySelector('#jd-edit')?.addEventListener('click', () => openEditJob(job));
    container.querySelector('#jd-advance')?.addEventListener('click', () => advance(job));
    container.querySelectorAll('[data-stage]').forEach((b) =>
      b.addEventListener('click', async () => {
        const target = b.dataset.stage;
        if (target === job.stage) return;
        if (target === 'entregado') return openDeliver(job);
        try {
          await ctx.api.post(`/api/jobs/${job.id}/stage`, { stage: target });
          reload();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      })
    );
    container.querySelectorAll('[data-upload]').forEach((input) =>
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('kind', input.dataset.upload);
        fd.append('file', file);
        try {
          const res = await fetch(`/api/jobs/${job.id}/files`, { method: 'POST', body: fd });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo subir');
          ctx.toast('Foto guardada', 'success');
          reload();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      })
    );
    container.querySelectorAll('[data-del-file]').forEach((b) =>
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        const ok = await confirmModal({ title: 'Borrar archivo', message: 'Se borra esta foto o archivo del trabajo.', confirmLabel: 'Borrar', danger: true });
        if (!ok) return;
        try {
          await ctx.api.del(`/api/jobs/files/${b.dataset.delFile}`);
          reload();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      })
    );
    container.querySelector('#jd-use')?.addEventListener('click', async () => {
      const qty = Number(container.querySelector('#jd-qty').value);
      if (!(qty > 0)) return ctx.toast('Escribe la cantidad', 'error');
      try {
        await ctx.api.post(`/api/jobs/${job.id}/materials`, { material_id: Number(container.querySelector('#jd-mat').value), qty });
        await loadMeta();
        ctx.toast('Material descontado del inventario', 'success');
        reload();
      } catch (err) {
        ctx.toast(err.message, 'error');
      }
    });
    container.querySelectorAll('[data-return]').forEach((b) =>
      b.addEventListener('click', () => {
        const m = usedByMaterial.get(Number(b.dataset.return));
        openModal({
          title: `Devolver ${escapeHtml(m.name)}`,
          render: (body, { close }) => {
            body.innerHTML = `
              <p class="text-body-sm text-on-surface-variant mb-3">Lo que sobró vuelve al inventario. Se usaron ${fmtQty(m.qty)} ${escapeHtml(m.unit)}.</p>
              <label class="${labelCls}">Cantidad que vuelve</label><input id="rt-qty" type="number" min="0" step="0.1" max="${m.qty}" class="${inputCls}" />
              <div class="flex justify-end gap-2 mt-4"><button id="rt-cancel" class="btn btn-ghost">Cancelar</button><button id="rt-ok" class="btn btn-primary">Devolver</button></div>`;
            body.querySelector('#rt-cancel').addEventListener('click', close);
            body.querySelector('#rt-ok').addEventListener('click', async () => {
              try {
                await ctx.api.post(`/api/jobs/${job.id}/materials`, { material_id: Number(b.dataset.return), qty: Number(body.querySelector('#rt-qty').value), return: true });
                await loadMeta();
                close();
                reload();
              } catch (err) {
                ctx.toast(err.message, 'error');
              }
            });
          },
        });
      })
    );
    container.querySelector('#jd-pay')?.addEventListener('click', () => openPayment(job));
    container.querySelector('#jd-pay-worker')?.addEventListener('click', () => openExpense(job, { category: LABOR, worker_id: job.worker_id, amount: p.labor_pending || '', description: `Pago a ${job.worker_name}` }));
    container.querySelector('#jd-expense')?.addEventListener('click', () => openExpense(job, {}));
  }

  function openPayment(job) {
    const accounts = cashMeta.accounts.filter((a) => a.active);
    openModal({
      title: `Abono · ${escapeHtml(job.client_name)}`,
      render: (body, { close }) => {
        body.innerHTML = `
          <p class="text-body-sm text-on-surface-variant mb-3">Saldo: <b class="text-on-surface">${formatMoney(job.balance)}</b></p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${labelCls}">Valor</label><input id="ab-amount" type="text" inputmode="numeric" value="${job.balance}" class="${inputCls}" /></div>
            <div><label class="${labelCls}">Entró a</label><select id="ab-acc" class="${inputCls}">${accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
          </div>
          <div class="mt-3"><label class="${labelCls}">Nota</label><input id="ab-notes" type="text" placeholder="Ej. anticipo 50 %" class="${inputCls}" /></div>
          <div class="flex justify-end gap-2 mt-4"><button id="ab-cancel" class="btn btn-ghost">Cancelar</button><button id="ab-ok" class="btn btn-primary">Registrar abono</button></div>`;
        bindMoneyInput(body.querySelector('#ab-amount'));
        body.querySelector('#ab-cancel').addEventListener('click', close);
        body.querySelector('#ab-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post(`/api/leads/${job.lead_id}/payments`, {
              amount: digits(body.querySelector('#ab-amount').value),
              account_id: Number(body.querySelector('#ab-acc').value) || null,
              work_order_id: job.id,
              notes: body.querySelector('#ab-notes').value,
            });
            ctx.toast('Abono registrado', 'success');
            close();
            reload();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  function openExpense(job, preset) {
    const accounts = cashMeta.accounts.filter((a) => a.active);
    const cats = (cashMeta.categories.egreso || []).filter((c) => !(cashMeta.non_operating || []).includes(c));
    openModal({
      title: preset.category === LABOR ? `Pagar a ${escapeHtml(job.worker_name || 'operario')}` : 'Gasto del trabajo',
      render: (body, { close }) => {
        body.innerHTML = `
          <div class="space-y-3">
            ${preset.category === LABOR ? '' : `<div><label class="${labelCls}">Categoría</label><select id="ex-cat" class="${inputCls}">${cats.map((c) => `<option ${c === 'Compra de materiales' ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select></div>`}
            <div class="grid grid-cols-2 gap-3">
              <div><label class="${labelCls}">Valor</label><input id="ex-amount" type="text" inputmode="numeric" value="${preset.amount || ''}" class="${inputCls}" /></div>
              <div><label class="${labelCls}">Salió de</label><select id="ex-acc" class="${inputCls}">${accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
            </div>
            <div><label class="${labelCls}">Descripción</label><input id="ex-desc" type="text" value="${escapeHtml(preset.description || '')}" class="${inputCls}" /></div>
          </div>
          <div class="flex justify-end gap-2 mt-4"><button id="ex-cancel" class="btn btn-ghost">Cancelar</button><button id="ex-ok" class="btn btn-primary">Registrar</button></div>`;
        bindMoneyInput(body.querySelector('#ex-amount'));
        body.querySelector('#ex-cancel').addEventListener('click', close);
        body.querySelector('#ex-ok').addEventListener('click', async () => {
          try {
            await ctx.api.post('/api/cash/entries', {
              kind: 'egreso',
              category: preset.category || body.querySelector('#ex-cat').value,
              amount: digits(body.querySelector('#ex-amount').value),
              account_id: Number(body.querySelector('#ex-acc').value) || null,
              description: body.querySelector('#ex-desc').value,
              work_order_id: job.id,
              worker_id: preset.worker_id || null,
            });
            ctx.toast('Gasto registrado', 'success');
            close();
            reload();
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        });
      },
    });
  }

  function reload() {
    const id = ctx.routeParams.get('id');
    return id ? renderDetail(id) : renderBoard();
  }

  await loadMeta();
  const offs = ['jobs_changed', 'cash_changed', 'leads_changed', 'materials_changed'].map((ev) => ctx.ws.on(ev, () => reload()));
  await reload();
  return () => offs.forEach((off) => off());
}
