import { escapeHtml, formatMoney } from '../utils.js';
import { openModal, confirmModal } from '../components/modal.js';
import { openEditLeadModal, deleteLead } from '../components/leadActions.js';
import { SERVICES as VELARA_SERVICES } from '../data/velaraServices.js';

// Embudo de ventas: cada cliente interesado avanza Nuevo -> Contactado ->
// Cotizado -> Ganado (o Perdido). Arriba, lo que hay que hacer hoy. Reemplaza
// las pantallas de Leads, Seguimiento, Cotizaciones y Ventas cerradas, que
// estaban pensadas para un equipo de asesores. Ver GET /api/leads/pipeline.

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

export async function mount(container, ctx) {
  let data = { rows: [] };
  let q = '';
  let showLost = false;

  async function load() {
    try {
      data = await ctx.api.get('/api/leads/pipeline');
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
    render();
  }

  // Lo que hay que hacer hoy: recordatorios vencidos, nuevos sin contestar y
  // cotizaciones sin seguimiento.
  function pendingOf(rows) {
    const open = rows.filter((l) => !l.status.startsWith('cerrado'));
    return [
      ...open.filter((l) => l.action_due).map((l) => ({ l, why: l.next_action_note || 'Próximo paso de hoy', icon: 'alarm', urgent: true })),
      ...open.filter((l) => !l.action_due && l.status === 'asignado' && daysSince(l.created_at) > 0.04).map((l) => ({ l, why: `Escribió ${ago(l.created_at)} y no se ha contestado`, icon: 'mark_chat_unread', urgent: daysSince(l.created_at) > 1 })),
      ...open
        .filter((l) => !l.action_due && l.status === 'cotizado' && ['pendiente', 'urgente'].includes(l.followup_status))
        .map((l) => ({ l, why: `Cotizado ${ago(l.quoted_at)}${l.followup_count ? ` · ${l.followup_count} seguimiento(s)` : ''}: hacer seguimiento`, icon: 'notifications_active', urgent: l.followup_status === 'urgente' })),
    ];
  }

  function render() {
    const term = q.toLowerCase();
    const rows = data.rows.filter((l) => !term || [l.client_name, l.phone, l.product, l.quotation?.number].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
    const open = rows.filter((l) => !l.status.startsWith('cerrado'));
    const won = rows.filter((l) => l.status === 'cerrado_ganado');
    const lost = rows.filter((l) => l.status === 'cerrado_perdido');
    const pending = pendingOf(rows);
    const quotedValue = open.filter((l) => l.status === 'cotizado').reduce((s, l) => s + (l.quotation?.amount_total || 0), 0);
    const wonValue = won.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const closedCount = won.length + lost.length;

    container.innerHTML = `
      <div class="flex justify-between items-end mb-gutter flex-wrap gap-3">
        <div>
          <h2 class="text-headline-lg font-headline-lg text-on-surface">Ventas</h2>
          <p class="text-body-md text-on-surface-variant mt-1">Cada cliente interesado, desde que escribe hasta que compra.</p>
        </div>
        <div class="flex gap-2 flex-wrap">
          <button id="em-new" class="btn btn-primary"><span class="material-symbols-outlined">person_add</span>Nuevo cliente</button>
          <a href="#/cotizar" class="btn btn-secondary"><span class="material-symbols-outlined">request_quote</span>Cotizar</a>
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-gutter">
        ${stat('En conversación', open.length, `${open.filter((l) => l.status === 'asignado').length} sin contactar`)}
        ${stat('Cotizado por cerrar', formatMoney(quotedValue), `${open.filter((l) => l.status === 'cotizado').length} cotización(es)`)}
        ${stat('Vendido (30 días)', formatMoney(wonValue), `${won.length} venta(s)`)}
        ${stat('Cierre (30 días)', closedCount ? `${Math.round((won.length / closedCount) * 100)} %` : '—', `${won.length} de ${closedCount} cerrados`)}
      </div>

      ${pending.length ? `
      <section class="${CARD} mb-gutter overflow-hidden">
        <header class="px-4 py-3 border-b border-outline-variant flex items-center justify-between">
          <p class="text-body-md font-bold text-on-surface flex items-center gap-2"><span class="material-symbols-outlined text-primary">today</span>Para hoy</p>
          <span class="text-[12px] text-on-surface-variant">${pending.length} pendiente(s)</span>
        </header>
        <div class="divide-y divide-outline-variant">
          ${pending.slice(0, 8).map(({ l, why, icon, urgent }) => `
            <div class="flex items-center gap-3 px-4 py-2.5 flex-wrap">
              <span class="material-symbols-outlined text-[20px] ${urgent ? 'text-error' : 'text-on-surface-variant'}">${icon}</span>
              <button data-open="${l.id}" class="min-w-0 flex-1 text-left">
                <span class="block text-body-sm font-bold text-on-surface truncate">${escapeHtml(l.client_name)}</span>
                <span class="block text-[12px] ${urgent ? 'text-error' : 'text-on-surface-variant'} truncate">${escapeHtml(why)}</span>
              </button>
              ${waLink(l.phone) ? `<a href="${waLink(l.phone)}" target="_blank" rel="noopener" class="btn btn-secondary !px-3 !py-1.5"><span class="material-symbols-outlined">chat</span>WhatsApp</a>` : ''}
            </div>`).join('')}
        </div>
      </section>` : ''}

      <div class="flex flex-wrap gap-2 mb-gutter items-center">
        <input id="em-q" type="search" value="${escapeHtml(q)}" placeholder="Buscar cliente, teléfono, cotización…" class="p-2 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm outline-none focus:border-outline flex-1 min-w-[200px] max-w-md" />
        <label class="flex items-center gap-2 text-body-sm text-on-surface-variant"><input id="em-lost" type="checkbox" ${showLost ? 'checked' : ''} /> Ver perdidos (${lost.length})</label>
      </div>

      <div class="flex lg:grid lg:grid-cols-4 gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-margin-mobile px-margin-mobile sm:mx-0 sm:px-0">
        ${STAGES.map((s) => {
          const list = rows.filter((l) => l.status === s.key);
          return `
          <section class="snap-start shrink-0 w-[85vw] sm:w-[320px] lg:w-auto bg-surface-container-low rounded-xl p-3 flex flex-col min-h-[200px]">
            <header class="flex items-center justify-between px-1 pb-3">
              <span class="flex items-center gap-2 text-body-sm font-bold text-on-surface"><span class="material-symbols-outlined text-[18px]">${s.icon}</span>${s.label}</span>
              <span class="text-[12px] text-on-surface-variant">${list.length}</span>
            </header>
            <div class="flex flex-col gap-2">
              ${list.length ? list.map(cardHtml).join('') : `<p class="text-[12px] text-on-surface-variant text-center py-6">${s.key === 'cerrado_ganado' ? 'Sin ventas en los últimos 30 días.' : 'Nada aquí.'}</p>`}
            </div>
          </section>`;
        }).join('')}
      </div>

      ${showLost ? `
      <section class="${CARD} mt-gutter overflow-hidden">
        <header class="px-4 py-3 border-b border-outline-variant text-body-md font-bold text-on-surface">Perdidos (30 días)</header>
        ${lost.length ? `<div class="divide-y divide-outline-variant">${lost.map((l) => `
          <button data-open="${l.id}" class="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-container-low">
            <span class="min-w-0"><span class="block text-body-sm font-bold text-on-surface truncate">${escapeHtml(l.client_name)}</span><span class="block text-[12px] text-on-surface-variant truncate">${escapeHtml(l.product || '')}${l.lost_reason ? ` · ${escapeHtml(l.lost_reason)}` : ''}</span></span>
            <span class="text-[12px] text-on-surface-variant shrink-0">${ago(l.closed_at)}</span>
          </button>`).join('')}</div>` : '<p class="px-4 py-6 text-body-sm text-on-surface-variant">Ninguno.</p>'}
        ${lost.length ? lostSummary(lost) : ''}
      </section>` : ''}`;

    container.querySelector('#em-new').addEventListener('click', openNewLead);
    let t;
    container.querySelector('#em-q').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        q = e.target.value.trim();
        render();
        const el = container.querySelector('#em-q');
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 250);
    });
    container.querySelector('#em-lost').addEventListener('change', (e) => {
      showLost = e.target.checked;
      render();
    });
    container.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => openLead(data.rows.find((l) => l.id === Number(el.dataset.open)))));
    container.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const lead = data.rows.find((l) => l.id === Number(b.dataset.id));
        act(b.dataset.act, lead);
      })
    );
  }

  function stat(label, value, hint) {
    return `
      <div class="${CARD} p-4 min-w-0">
        <p class="eyebrow !text-[10px] text-on-surface-variant mb-2">${label}</p>
        <p class="text-[20px] leading-7 font-bold tracking-tight text-on-surface truncate">${value}</p>
        <p class="text-[11px] text-on-surface-variant mt-1 truncate">${hint}</p>
      </div>`;
  }

  function lostSummary(lost) {
    const counts = {};
    for (const l of lost) counts[l.lost_reason || 'Sin motivo'] = (counts[l.lost_reason || 'Sin motivo'] || 0) + 1;
    return `<p class="px-4 py-3 border-t border-outline-variant text-[12px] text-on-surface-variant">Por qué se pierden: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${escapeHtml(k)} (${n})`).join(' · ')}</p>`;
  }

  function cardHtml(l) {
    const quote = l.quotation;
    const followupWarn = l.status === 'cotizado' && ['pendiente', 'urgente'].includes(l.followup_status);
    const actions = {
      asignado: [['contact', 'Ya le escribí', 'check'], ['quote', 'Cotizar', 'request_quote']],
      contactado: [['quote', 'Cotizar', 'request_quote']],
      cotizado: [['won', 'Ganado', 'emoji_events'], ['followup', 'Seguimiento', 'notifications']],
      cerrado_ganado: [],
    }[l.status] || [];
    return `
      <article data-open="${l.id}" class="${CARD} p-3 cursor-pointer hover:border-on-surface transition-colors">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-body-sm font-bold text-on-surface leading-snug truncate">${escapeHtml(l.client_name)}</p>
            <p class="text-[12px] text-on-surface-variant truncate">${escapeHtml(l.product || 'Sin servicio definido')}</p>
          </div>
          ${waLink(l.phone) ? `<a href="${waLink(l.phone)}" target="_blank" rel="noopener" data-stop class="shrink-0 w-8 h-8 rounded-full border border-outline-variant flex items-center justify-center text-on-surface hover:bg-surface-container-low" aria-label="Escribir por WhatsApp"><span class="material-symbols-outlined text-[16px]">chat</span></a>` : ''}
        </div>
        ${quote ? `<p class="text-[12px] text-on-surface mt-2"><span class="text-on-surface-variant">${escapeHtml(quote.number || 'Cotización')}</span> · <b>${formatMoney(quote.amount_total)}</b></p>` : ''}
        ${l.status === 'cerrado_ganado' ? `<p class="text-[12px] text-on-surface mt-2"><b>${formatMoney(l.amount)}</b> · ${ago(l.closed_at)}</p>${l.work_order ? `<a href="#/trabajos?id=${l.work_order.id}" data-stop class="inline-flex items-center gap-1 text-[12px] underline text-on-surface mt-1"><span class="material-symbols-outlined text-[14px]">construction</span>${escapeHtml(l.work_order.number)}</a>` : `<button data-act="job" data-id="${l.id}" class="text-[12px] underline text-on-surface mt-1">Crear trabajo</button>`}` : ''}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px]">
          ${l.status !== 'cerrado_ganado' ? `<span class="text-on-surface-variant">${l.status === 'cotizado' ? `cotizado ${ago(l.quoted_at)}` : `entró ${ago(l.created_at)}`}</span>` : ''}
          ${l.next_action_at && l.status !== 'cerrado_ganado' ? `<span class="flex items-center gap-0.5 ${l.action_due ? 'text-error font-bold' : 'text-on-surface'}"><span class="material-symbols-outlined text-[13px]">alarm</span>${shortDate(l.next_action_at)}${l.next_action_note ? ` · ${escapeHtml(l.next_action_note)}` : ''}</span>` : ''}
          ${followupWarn && !l.next_action_at ? `<span class="${l.followup_status === 'urgente' ? 'text-error font-bold' : 'text-on-surface'}">Falta seguimiento</span>` : ''}
        </div>
        ${actions.length ? `<div class="flex gap-1.5 mt-3">${actions.map(([a, label, icon]) => `<button data-act="${a}" data-id="${l.id}" class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-full border border-outline-variant text-[12px] font-semibold text-on-surface hover:bg-on-surface hover:text-surface hover:border-on-surface transition-colors"><span class="material-symbols-outlined text-[15px]">${icon}</span>${label}</button>`).join('')}</div>` : ''}
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
              ${!closed ? `<button data-x="quote" class="btn btn-secondary"><span class="material-symbols-outlined">request_quote</span>${lead.quotation ? 'Nueva cotización' : 'Cotizar'}</button>` : ''}
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

  const offs = ['leads_changed', 'jobs_changed'].map((ev) => ctx.ws.on(ev, load));
  await load();
  return () => offs.forEach((off) => off());
}
