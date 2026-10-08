import { escapeHtml, formatMoney, initials } from '../utils.js';
import { openCloseModal } from '../components/leadActions.js';
import { SERVICES, findService } from '../data/velaraServices.js';
import { TEMPLATES } from '../data/quoteTemplates.js';
import { openTemplateModal } from '../components/quoteTemplateModal.js';

// Pestaña "Cotizar": motor de cotizaciones propio de Velara CRM, sin
// ninguna dependencia de Odoo -- guarda todo en las tablas nativas del CRM
// (server/nativeQuotes.js: quotations/quotation_lines/products) para que
// esta pantalla siga funcionando aunque en algún momento el negocio deje de
// usar Odoo en conjunto con el CRM. El flujo viejo (botón "Cotizar" en
// Ventas/SLA/Kanban, que sí arma un sale.order en Odoo -- ver
// leadActions.js openQuotationModal) sigue existiendo tal cual, aparte; esta
// pestaña es la única que usa el motor nativo por ahora.
//
// Layout de dos columnas (izq: pasos 1-4, der: panel de resumen fijo) sobre
// el concepto de Velara: cliente -> servicio (con sus propios campos --
// marca/modelo/año para tapicería, dimensiones para carpas, etc., ver
// server/velaraServices.js) -> detalle de la cotización -> notas.

const STATE_STEPS = [
  { key: 'draft', label: 'Borrador', icon: 'edit_note' },
  { key: 'sent', label: 'Enviada', icon: 'send' },
  { key: 'seguimiento', label: 'Seguimiento', icon: 'schedule' },
  { key: 'aprobada', label: 'Aprobada', icon: 'thumb_up' },
  { key: 'sale', label: 'Venta', icon: 'task_alt' },
];

// Lado a lado de los totales: el IVA sale de Plantillas y tarifas ("iva",
// en %). Hoy VELARA no cobra IVA (0) y entonces no se muestra en ningún lado.
function ivaPct(config) {
  return Math.min(100, Math.max(0, Number(config?.iva) || 0));
}

// Fotos/diseños: se reducen a 1600 px y se pasan a JPEG en el navegador
// (así cualquier formato que abra el navegador -- HEIC de iPhone en Safari,
// WebP, PNG -- entra al PDF sin pesar de más).
const MAX_IMAGE_SIDE = 1600;

async function toJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`No se pudo leer la imagen "${file.name}"`));
      el.src = url;
    });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; // fondo blanco para PNG con transparencia
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error(`No se pudo convertir "${file.name}"`);
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// La API JSON (api.js) no manda archivos: la imagen va por FormData.
async function uploadQuotationImage(quotationId, blob, name, caption) {
  const fd = new FormData();
  fd.append('caption', caption || '');
  fd.append('file', blob, (name || 'imagen').replace(/\.[^.]+$/, '') + '.jpg');
  const res = await fetch(`/api/quotations/${quotationId}/images`, { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data.quotation;
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(320, el.scrollHeight + 2)}px`;
}

function fmtDate(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days) {
  return new Date(Date.now() + Number(days) * 86400000).toISOString().slice(0, 10);
}

function daysUntil(isoDate) {
  if (!isoDate) return null;
  const target = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - Date.now()) / 86400000);
}

const STATE_BADGE = {
  draft: 'bg-surface-container-high text-on-surface-variant',
  sent: 'bg-tertiary-container text-on-tertiary-container',
  seguimiento: 'bg-tertiary-container text-on-tertiary-container',
  aprobada: 'bg-secondary-container text-on-secondary-container',
  sale: 'bg-primary-container text-on-primary-container',
  cancel: 'bg-error-container text-on-error-container',
};
const STATE_LABEL = {
  draft: 'Borrador',
  sent: 'Enviada',
  seguimiento: 'En seguimiento',
  aprobada: 'Aprobada',
  sale: 'Venta',
  cancel: 'Cancelada',
};

function field(id, label, value, opts = {}) {
  const { type = 'text', required = false, readonly = false, span = '' } = opts;
  return `
    <div class="${span}">
      <label class="block text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">${label}${required ? ' *' : ''}</label>
      <input id="${id}" type="${type}" ${readonly ? 'readonly' : ''} value="${escapeHtml(value || '')}" class="w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm ${readonly ? 'bg-surface-container-low text-on-surface-variant' : ''}" />
    </div>`;
}

// Tarjeta de un paso (1 Cliente / 2 Servicio / 3 Detalle / 4 Notas): solo
// número y título, sin ícono ni subtítulo de ayuda (minimalismo). `icon` y
// `desc` se siguen recibiendo para no tocar cada llamada, pero no se pintan.
function stepCard(number, icon, title, desc, innerHtml, extraHeaderHtml = '') {
  void icon;
  void desc;
  return `
    <div class="bg-surface rounded-xl border border-outline-variant p-5">
      <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 class="text-[14px] font-semibold text-on-surface flex items-center gap-2">
          <span class="text-outline font-medium tabular-nums">${number}</span>${title}
        </h3>
        ${extraHeaderHtml}
      </div>
      ${innerHtml}
    </div>
  `;
}

export async function mount(container, ctx) {
  container.innerHTML = `
    <div id="cz-root"></div>
  `;
  const root = container.querySelector('#cz-root');

  // ---- estado ---------------------------------------------------------------
  let lead = null; // null = cliente aun no elegido/creado
  let quotation = null; // última cotización nativa leída/creada para el lead
  let history = []; // todas las cotizaciones nativas del lead (para el historial)
  let selectedServiceSlug = null;
  let serviceFieldValues = {};
  let advisorsCache = [];
  // Imágenes elegidas antes de guardar la primera vez: se suben al guardar.
  let pendingImages = []; // { blob, name, caption, url }
  // Condiciones: true = el asesor las escribió para esta cotización; false =
  // se muestran las de siempre del servicio (y se recargan si cambia).
  let termsCustom = false;
  // Tarifas, catálogo y observaciones de las plantillas (Cotizaciones ›
  // Plantillas y tarifas). Sin esto la pantalla funciona igual, solo sin
  // la barra de plantillas.
  let templateConfig = null;
  try {
    templateConfig = (await ctx.api.get('/api/quote-templates')).config;
  } catch {
    templateConfig = null;
  }
  if (ctx.user?.role !== 'asesor') {
    try {
      advisorsCache = (await ctx.api.get('/api/advisors')).filter((a) => !a.is_group && a.active);
    } catch {
      /* si falla, el select de asesor simplemente sale vacio */
    }
  }

  // Se puede corregir hasta que se vuelve venta o se cancela.
  function isEditable() {
    return !quotation || (quotation.state !== 'sale' && quotation.state !== 'cancel');
  }

  // Trae el historial de cotizaciones nativas del lead activo y deja
  // `quotation` apuntando a la indicada (o a la última no cancelada).
  async function refreshHistory(preselectId) {
    quotation = null;
    history = [];
    try {
      const data = await ctx.api.get(`/api/leads/${lead.id}/quotations`);
      history = data.quotations || [];
      quotation = preselectId
        ? history.find((q) => q.id === preselectId) || null
        : history.find((q) => q.state !== 'cancel') || null;
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
    selectedServiceSlug = quotation ? quotation.service_slug || null : null;
    serviceFieldValues = quotation ? { ...(quotation.service_fields || {}) } : {};
  }

  function resetAll() {
    pendingImages.forEach((p) => URL.revokeObjectURL(p.url));
    pendingImages = [];
    lead = null;
    quotation = null;
    history = [];
    selectedServiceSlug = null;
    serviceFieldValues = {};
    render();
  }

  // ---- barra de estado (draft -> sent -> seguimiento -> aprobada -> sale) ---
  function statusStepper() {
    if (quotation && quotation.state === 'cancel') {
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-body-sm font-bold bg-error-container text-on-error-container"><span class="material-symbols-outlined text-[16px]">cancel</span>Cancelada</span>`;
    }
    const currentKey = quotation ? quotation.state : 'draft';
    const currentIdx = Math.max(0, STATE_STEPS.findIndex((s) => s.key === currentKey));
    return `
      <div class="flex flex-col gap-1.5">
        ${STATE_STEPS.map((s, i) => {
          const done = i < currentIdx;
          const current = i === currentIdx;
          const dotCls = current ? 'bg-on-surface' : done ? 'bg-on-surface-variant' : 'bg-surface-container-high';
          const textCls = current ? 'text-on-surface font-bold' : done ? 'text-on-surface-variant' : 'text-on-surface-variant/70';
          return `
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full shrink-0 ${dotCls}"></span>
              <span class="text-[12px] ${textCls}">${s.label}</span>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ---- historial de cotizaciones del lead ------------------------------------
  function historyStrip() {
    if (history.length < 2) return '';
    return `
      <div class="px-5 pt-4 flex items-center gap-2 flex-wrap">
        <span class="text-[11px] font-label-bold uppercase tracking-wide text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">history</span>Historial</span>
        ${history
          .map((q) => {
            const active = quotation && q.id === quotation.id;
            return `<button type="button" data-hist="${q.id}" class="px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
              active
                ? 'bg-on-surface text-surface border-on-surface'
                : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
            }">${escapeHtml(q.number || '—')} · ${formatMoney(q.amount_total)}</button>`;
          })
          .join('')}
      </div>`;
  }

  // ---- servicio + campos propios (marca/modelo, dimensiones, etc.) -----------
  function serviceSection() {
    return stepCard(
      2,
      'construction',
      'Servicio',
      'Seleccione el servicio. Los detalles son opcionales: salen en el PDF solo si los llena.',
      `
      <div class="max-w-xs mb-3">
        <label class="block text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Servicio *</label>
        <select id="cz-service" ${!isEditable() ? 'disabled' : ''} class="w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm">
          <option value="">Seleccione un servicio…</option>
          ${SERVICES.map((s) => `<option value="${s.slug}" ${s.slug === selectedServiceSlug ? 'selected' : ''}>${escapeHtml(s.title)}</option>`).join('')}
        </select>
      </div>
      <div id="cz-service-fields" class="grid grid-cols-1 md:grid-cols-3 gap-3"></div>
      `
    );
  }

  function renderServiceFields() {
    const wrap = root.querySelector('#cz-service-fields');
    if (!wrap) return;
    const service = findService(selectedServiceSlug);
    const editable = isEditable();
    if (!service) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = service.fields
      .map((f) => {
        const value = serviceFieldValues[f.key] || '';
        if (f.type === 'select') {
          return `<div>
            <label class="block text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">${escapeHtml(f.label)}</label>
            <select data-svc-field="${f.key}" ${editable ? '' : 'disabled'} class="w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm">
              <option value="">Seleccione…</option>
              ${f.options.map((o) => `<option value="${escapeHtml(o)}" ${o === value ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
            </select>
          </div>`;
        }
        return `<div>
          <label class="block text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">${escapeHtml(f.label)}</label>
          <input data-svc-field="${f.key}" type="text" ${editable ? '' : 'readonly'} value="${escapeHtml(value)}" placeholder="${escapeHtml(f.placeholder || '')}" class="w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm ${editable ? '' : 'bg-surface-container-low text-on-surface-variant'}" />
        </div>`;
      })
      .join('');
    wrap.querySelectorAll('[data-svc-field]').forEach((el) => {
      const sync = () => {
        serviceFieldValues[el.dataset.svcField] = el.value;
      };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });
  }

  function readServiceFields() {
    const wrap = root.querySelector('#cz-service-fields');
    const out = {};
    wrap?.querySelectorAll('[data-svc-field]').forEach((el) => {
      if (el.value) out[el.dataset.svcField] = el.value;
    });
    return out;
  }

  function wireServiceSection() {
    const select = root.querySelector('#cz-service');
    if (!select) return;
    select.addEventListener('change', () => {
      selectedServiceSlug = select.value || null;
      serviceFieldValues = {}; // servicio nuevo -> campos propios distintos, no tiene sentido conservar los del anterior
      renderServiceFields();
      loadDefaultTerms();
    });
  }

  // ---- líneas de producto -----------------------------------------------------
  function computeClientTotals(list) {
    let sub = 0;
    list.querySelectorAll('[data-line]').forEach((row) => {
      const qtyEl = row.querySelector('[data-qty]');
      if (!qtyEl) return; // fila de solo lectura (cotización confirmada)
      const qty = Number(qtyEl.value) || 0;
      const priceRaw = row.querySelector('[data-price]').value;
      const price = priceRaw === '' ? Number(row.dataset.listPrice || 0) : Number(priceRaw);
      const discount = Math.min(100, Math.max(0, Number(row.querySelector('[data-discount]')?.value) || 0));
      sub += qty * price * (1 - discount / 100);
    });
    return sub;
  }

  function renderTotals() {
    const totalsEl = root.querySelector('#cz-totals');
    const list = root.querySelector('#cz-lines');
    if (!totalsEl || !list) return;
    const totalsHtml = (sub, iva, label) => `
      ${
        iva > 0
          ? `<div class="flex justify-between gap-8 text-body-sm text-on-surface-variant"><span>Subtotal</span><span class="font-bold text-on-surface">${formatMoney(sub)}</span></div>
             <div class="flex justify-between gap-8 text-body-sm text-on-surface-variant mt-1"><span>${label}</span><span class="font-bold text-on-surface">${formatMoney(iva)}</span></div>`
          : ''
      }
      <div class="flex justify-between gap-8 items-baseline mt-2 pt-2 px-3 -mx-3 rounded-lg bg-primary-container"><span class="text-body-md font-bold text-on-surface">Total</span><span class="text-headline-sm font-headline-sm font-bold text-on-surface">${formatMoney(sub + iva)}</span></div>
    `;
    if (!isEditable()) {
      const pct = quotation.amount_untaxed > 0 ? Math.round((quotation.amount_tax / quotation.amount_untaxed) * 100) : 0;
      totalsEl.innerHTML = totalsHtml(quotation.amount_untaxed, quotation.amount_tax, `IVA ${pct}%`);
      return;
    }
    const sub = computeClientTotals(list);
    const pct = ivaPct(templateConfig);
    totalsEl.innerHTML = totalsHtml(sub, (sub * pct) / 100, `IVA ${pct}%`);
    const countEl = root.querySelector('#cz-line-count');
    if (countEl) countEl.textContent = list.querySelectorAll('[data-line]').length;
  }

  function moveRow(row, dir) {
    const sibling = dir === 'up' ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (dir === 'up') row.parentElement.insertBefore(row, sibling);
    else row.parentElement.insertBefore(sibling, row);
    renderTotals();
  }

  function appendLineRow(list, preset, editable) {
    const row = document.createElement('div');
    row.dataset.line = '';
    row.className = 'border border-outline-variant rounded-lg p-3 mb-2 bg-surface-container-lowest';
    if (preset && preset.price_unit != null) row.dataset.listPrice = Math.round(preset.price_unit);

    if (!editable) {
      const discount = Number(preset.discount_percent) || 0;
      row.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-bold text-on-surface truncate">${escapeHtml(preset.product_name || '—')}</p>
            ${preset.description ? `<p class="text-[12px] text-on-surface-variant mt-0.5">${escapeHtml(preset.description)}</p>` : ''}
          </div>
          <p class="font-bold text-on-surface shrink-0">${formatMoney(preset.subtotal ?? preset.qty * preset.price_unit)}</p>
        </div>
        <div class="flex items-center gap-3 mt-2 text-[12px] text-on-surface-variant">
          <span>${preset.qty} Unidades</span>
          <span>${formatMoney(preset.price_unit)} c/u</span>
          ${discount > 0 ? `<span class="text-error font-bold">− ${discount}%</span>` : ''}
        </div>
      `;
      list.appendChild(row);
      return;
    }

    row.innerHTML = `
      <div class="flex items-start gap-2">
        <div class="flex flex-col gap-0.5 pt-1.5 shrink-0">
          <button type="button" data-move-up class="p-0.5 rounded text-on-surface-variant hover:bg-surface-container-low" aria-label="Subir"><span class="material-symbols-outlined text-[16px]">keyboard_arrow_up</span></button>
          <button type="button" data-move-down class="p-0.5 rounded text-on-surface-variant hover:bg-surface-container-low" aria-label="Bajar"><span class="material-symbols-outlined text-[16px]">keyboard_arrow_down</span></button>
        </div>
        <div class="flex-1 min-w-0">
          <div class="relative">
            <input data-prod-search type="text" autocomplete="off" placeholder="Buscar producto o escribir uno nuevo…" class="w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm font-bold" />
            <input data-prod type="hidden" />
            <div data-prod-results class="hidden fixed z-[9999] bg-surface border border-outline-variant rounded-md shadow-lg max-h-52 overflow-y-auto"></div>
          </div>
          <textarea data-description rows="2" placeholder="Descripción: medidas, material, color, lo que incluye… (se puede escribir libremente)" class="w-full p-2 mt-1.5 border border-outline-variant rounded-md focus:border-outline text-[12px] text-on-surface outline-none bg-surface resize-y"></textarea>
          <div class="flex items-end gap-3 mt-2 flex-wrap">
            <div>
              <label class="block text-[10px] font-label-bold uppercase text-on-surface-variant">Cantidad</label>
              <div class="flex items-center border border-outline-variant rounded-md overflow-hidden">
                <button type="button" data-qty-dec class="w-7 h-8 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low"><span class="material-symbols-outlined text-[16px]">remove</span></button>
                <input data-qty type="number" min="0" step="1" value="1" class="w-12 h-8 text-center outline-none text-body-sm" />
                <button type="button" data-qty-inc class="w-7 h-8 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low"><span class="material-symbols-outlined text-[16px]">add</span></button>
              </div>
            </div>
            <div>
              <label class="block text-[10px] font-label-bold uppercase text-on-surface-variant">Precio unitario</label>
              <input data-price type="number" min="0" step="1000" placeholder="precio" class="w-28 h-8 px-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm text-right" />
            </div>
            <div>
              <label class="block text-[10px] font-label-bold uppercase text-on-surface-variant">Desc. %</label>
              <input data-discount type="number" min="0" max="100" step="1" value="0" class="w-16 h-8 px-2 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm text-right" />
            </div>
            <div class="flex-1 text-right">
              <label class="block text-[10px] font-label-bold uppercase text-on-surface-variant">Subtotal</label>
              <p data-subtotal class="font-bold text-on-surface">${formatMoney(0)}</p>
            </div>
          </div>
        </div>
        <button type="button" data-del class="btn btn-icon shrink-0" aria-label="Quitar línea"><span class="material-symbols-outlined">delete</span></button>
      </div>
    `;

    const search = row.querySelector('[data-prod-search]');
    const hidden = row.querySelector('[data-prod]');
    const results = row.querySelector('[data-prod-results]');
    const description = row.querySelector('[data-description]');
    const qty = row.querySelector('[data-qty]');
    const price = row.querySelector('[data-price]');
    const discountInput = row.querySelector('[data-discount]');
    const subtotalCell = row.querySelector('[data-subtotal]');

    function recalcRow() {
      const q = Number(qty.value) || 0;
      const p = price.value === '' ? Number(row.dataset.listPrice || 0) : Number(price.value);
      const d = Math.min(100, Math.max(0, Number(discountInput.value) || 0));
      subtotalCell.textContent = formatMoney(q * p * (1 - d / 100));
      renderTotals();
    }

    function pick(p) {
      hidden.value = p.id;
      search.value = p.name;
      row.dataset.listPrice = p.price || 0;
      price.value = Math.round(p.price || 0) || '';
      if (p.description && !description.value) description.value = p.description;
      results.classList.add('hidden');
      recalcRow();
    }

    // La fila vive en una lista que puede desplazarse en pantallas angostas
    // -- por la regla CSS de que overflow-x/overflow-y quedan atados entre
    // sí, un `position: absolute` que se salga del alto de la fila se
    // recortaría. Con `position: fixed` y coordenadas calculadas a mano el
    // desplegable se pinta sobre el viewport, fuera de ese recorte.
    function showResults() {
      const rect = search.getBoundingClientRect();
      results.style.left = `${rect.left}px`;
      results.style.top = `${rect.bottom + 4}px`;
      results.style.width = `${rect.width}px`;
      results.classList.remove('hidden');
    }

    let deb;
    search.addEventListener('input', () => {
      hidden.value = ''; // cambió el texto -> ya no hay producto del catálogo elegido hasta que pinche uno
      clearTimeout(deb);
      const term = search.value.trim();
      if (term.length < 2) {
        results.classList.add('hidden');
        return;
      }
      deb = setTimeout(async () => {
        let list2 = [];
        try {
          list2 = await ctx.api.get(`/api/products?q=${encodeURIComponent(term)}`);
        } catch {
          return;
        }
        if (!list2.length) {
          results.innerHTML = '<p class="px-3 py-2 text-[11px] text-on-surface-variant">Sin resultados en la lista de precios — puedes dejar el nombre escrito y poner el precio a mano</p>';
          showResults();
          return;
        }
        results.innerHTML = list2
          .slice(0, 30)
          .map(
            (p) =>
              `<button type="button" data-pid="${p.id}" data-pname="${escapeHtml(p.name)}" data-pprice="${p.price || 0}" data-pdesc="${escapeHtml(p.description || '')}" class="w-full text-left px-3 py-1.5 hover:bg-surface-container-low text-body-sm flex justify-between gap-2"><span class="truncate">${escapeHtml(p.name)}</span>${p.price ? `<span class="shrink-0 text-on-surface-variant">${formatMoney(p.price)}</span>` : ''}</button>`
          )
          .join('');
        showResults();
      }, 250);
    });
    results.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pid]');
      if (!b) return;
      pick({ id: Number(b.dataset.pid), name: b.dataset.pname, price: Number(b.dataset.pprice), description: b.dataset.pdesc });
    });
    search.addEventListener('blur', () => setTimeout(() => results.classList.add('hidden'), 150));
    description.addEventListener('input', () => autoGrow(description));
    qty.addEventListener('input', recalcRow);
    price.addEventListener('input', recalcRow);
    discountInput.addEventListener('input', recalcRow);
    row.querySelector('[data-qty-dec]').addEventListener('click', () => {
      qty.value = Math.max(0, (Number(qty.value) || 0) - 1);
      recalcRow();
    });
    row.querySelector('[data-qty-inc]').addEventListener('click', () => {
      qty.value = (Number(qty.value) || 0) + 1;
      recalcRow();
    });
    row.querySelector('[data-del]').addEventListener('click', () => {
      row.remove();
      renderTotals();
    });
    row.querySelector('[data-move-up]').addEventListener('click', () => moveRow(row, 'up'));
    row.querySelector('[data-move-down]').addEventListener('click', () => moveRow(row, 'down'));

    if (preset) {
      if (preset.product_id) hidden.value = preset.product_id;
      if (preset.product_name) search.value = preset.product_name;
      if (preset.description) description.value = preset.description;
      if (preset.qty != null) qty.value = preset.qty;
      if (preset.price_unit != null) price.value = Math.round(preset.price_unit);
      if (preset.discount_percent) discountInput.value = preset.discount_percent;
    }

    list.appendChild(row);
    autoGrow(description);
    recalcRow();
  }

  // El nombre del producto es texto libre (no depende de tener un
  // product_id del catálogo): asi una línea puede ser "Instalación" o
  // cualquier cosa que no esté en la lista de precios, con el precio puesto
  // a mano -- mismo criterio de "precios manuales" que ya usa el resto del CRM.
  function readLines(list) {
    return [...list.querySelectorAll('[data-line]')]
      .map((row) => {
        const prodInput = row.querySelector('[data-prod]');
        if (!prodInput) return null;
        const search = row.querySelector('[data-prod-search]');
        const priceRaw = row.querySelector('[data-price]').value;
        const listPrice = Number(row.dataset.listPrice || 0);
        return {
          product_id: Number(prodInput.value) || null,
          product_name: search.value.trim(),
          description: row.querySelector('[data-description]').value.trim() || null,
          qty: Number(row.querySelector('[data-qty]').value) || 0,
          price_unit: priceRaw === '' ? listPrice : Number(priceRaw),
          discount_percent: Math.min(100, Math.max(0, Number(row.querySelector('[data-discount]').value) || 0)),
        };
      })
      .filter((l) => l && l.product_name && l.qty > 0);
  }

  // ---- plantillas de cotización (data/quoteTemplates.js) ---------------------
  function templateBar() {
    if (!templateConfig) return '';
    return `
      <div class="mb-3">
        <p class="text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-1.5">Plantillas según lo que se va a fabricar</p>
        <div class="flex flex-wrap gap-2">
          ${TEMPLATES.map(
            (t) => `<button type="button" data-template="${t.key}" title="${escapeHtml(t.desc)}" class="btn btn-secondary text-[12px]"><span class="material-symbols-outlined">${t.icon}</span>${escapeHtml(t.label)}</button>`
          ).join('')}
          <button type="button" data-quick-line="transporte" class="btn btn-ghost text-[12px]"><span class="material-symbols-outlined">local_shipping</span>Transporte</button>
          <button type="button" data-quick-line="logo" class="btn btn-ghost text-[12px]"><span class="material-symbols-outlined">print</span>Logo / impresión</button>
        </div>
      </div>`;
  }

  // Agrega las líneas que devolvió una plantilla. Quita la fila vacía del
  // arranque y, si aún no hay servicio elegido, toma el de la plantilla y
  // llena sus campos vacíos con lo calculado (tipo, medidas…).
  function addTemplateLines(list, lines, { service_slug, hints }) {
    list.querySelectorAll('[data-line]').forEach((row) => {
      const search = row.querySelector('[data-prod-search]');
      if (search && !search.value.trim()) row.remove();
    });
    lines.forEach((l) => appendLineRow(list, l, true));

    if (service_slug && !selectedServiceSlug) {
      selectedServiceSlug = service_slug;
      serviceFieldValues = {};
      const select = root.querySelector('#cz-service');
      if (select) select.value = service_slug;
      loadDefaultTerms();
    }
    if (service_slug && service_slug === selectedServiceSlug) {
      serviceFieldValues = { ...serviceFieldValues, ...readServiceFields() };
      const service = findService(service_slug);
      for (const f of service?.fields || []) {
        if (serviceFieldValues[f.key] || !hints[f.key]) continue;
        if (f.type === 'select' && !f.options.includes(hints[f.key])) continue;
        serviceFieldValues[f.key] = hints[f.key];
      }
      renderServiceFields();
    }
    renderTotals();
    ctx.toast(lines.length === 1 ? 'Línea agregada a la cotización' : `${lines.length} líneas agregadas`, 'success');
  }

  function wireTemplateBar(list) {
    root.querySelectorAll('[data-template]').forEach((btn) => {
      btn.addEventListener('click', () =>
        openTemplateModal({ key: btn.dataset.template, config: templateConfig, onAdd: (lines, meta) => addTemplateLines(list, lines, meta) })
      );
    });
    root.querySelectorAll('[data-quick-line]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const line =
          btn.dataset.quickLine === 'transporte'
            ? { product_name: 'Servicio de transporte', description: null, qty: 1, price_unit: templateConfig.transporte }
            : { product_name: 'Servicio de impresión', description: 'Logo a una tinta.', qty: 1, price_unit: templateConfig.impresionLogo };
        addTemplateLines(list, [line], { service_slug: null, hints: {} });
      });
    });
  }

  // ---- imágenes de referencia (salen en el PDF) -------------------------------
  function imagesSection() {
    const editable = isEditable();
    const saved = quotation?.images || [];
    if (!editable && !saved.length) return '';
    const cell = (src, caption, attrs) => `
      <div class="border border-outline-variant rounded-lg overflow-hidden bg-surface-container-lowest">
        <a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="" loading="lazy" class="w-full aspect-[4/3] object-cover" /></a>
        <div class="p-2 flex items-start gap-1">
          ${
            editable
              ? `<input ${attrs.input} type="text" maxlength="200" value="${escapeHtml(caption || '')}" placeholder="Leyenda (opcional)" class="flex-1 min-w-0 p-1 border border-outline-variant rounded-md text-[12px] outline-none focus:border-outline" />
                 <button type="button" ${attrs.del} class="btn btn-icon shrink-0" aria-label="Quitar imagen"><span class="material-symbols-outlined text-[18px]">delete</span></button>`
              : `<p class="text-[12px] text-on-surface-variant">${escapeHtml(caption || '')}</p>`
          }
        </div>
      </div>`;
    const cells = [
      ...saved.map((img) => cell(`/api/quotations/images/${img.id}`, img.caption, { input: `data-img-caption="${img.id}"`, del: `data-img-del="${img.id}"` })),
      ...pendingImages.map((p, i) => cell(p.url, p.caption, { input: `data-pend-caption="${i}"`, del: `data-pend-del="${i}"` })),
    ];
    return stepCard(
      5,
      'image',
      'Imágenes',
      'Diseños, fotos del sitio o modelos de referencia. Salen en el PDF, dos por fila, con su leyenda.',
      `
        ${cells.length ? `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">${cells.join('')}</div>` : ''}
        ${
          editable
            ? `<label class="btn btn-secondary text-[12px] cursor-pointer inline-flex">
                 <span class="material-symbols-outlined">add_photo_alternate</span>Agregar imágenes
                 <input id="cz-images" type="file" accept="image/*" multiple class="hidden" />
               </label>
               ${!quotation && pendingImages.length ? '<p class="text-[11px] text-on-surface-variant mt-2">Se suben al guardar la cotización.</p>' : ''}`
            : ''
        }
      `
    );
  }

  async function loadDefaultTerms() {
    const ta = root.querySelector('#cz-terms');
    if (!ta || termsCustom) return;
    try {
      const r = await ctx.api.get(`/api/quotations/default-terms?service=${encodeURIComponent(selectedServiceSlug || '')}`);
      if (!termsCustom && ta.isConnected) {
        ta.value = r.text;
        autoGrow(ta);
      }
    } catch {
      /* sin condiciones por defecto: el cuadro queda vacío y el PDF usa las de siempre */
    }
  }

  function wireTerms() {
    const ta = root.querySelector('#cz-terms');
    if (!ta) return;
    const reset = root.querySelector('#cz-terms-reset');
    termsCustom = !!quotation?.terms;
    ta.addEventListener('input', () => {
      termsCustom = true;
      reset.classList.remove('hidden');
      autoGrow(ta);
    });
    reset.addEventListener('click', () => {
      termsCustom = false;
      reset.classList.add('hidden');
      loadDefaultTerms();
    });
    if (termsCustom) autoGrow(ta);
    else loadDefaultTerms();
  }

  async function uploadPending(quotationId) {
    if (!pendingImages.length) return;
    let failed = 0;
    for (const p of pendingImages) {
      try {
        await uploadQuotationImage(quotationId, p.blob, p.name, p.caption);
      } catch (err) {
        failed++;
        ctx.toast(err.message, 'error');
      }
      URL.revokeObjectURL(p.url);
    }
    pendingImages = [];
    if (failed) ctx.toast(`${failed} imagen(es) no se pudieron subir`, 'error');
  }

  function wireImages() {
    const input = root.querySelector('#cz-images');
    input?.addEventListener('change', async () => {
      const files = [...input.files];
      input.value = '';
      if (!files.length) return;
      const label = input.closest('label');
      label?.classList.add('opacity-60', 'pointer-events-none');
      for (const file of files) {
        let blob;
        try {
          blob = await toJpeg(file);
        } catch (err) {
          ctx.toast(err.message, 'error');
          continue;
        }
        if (quotation) {
          try {
            quotation = await uploadQuotationImage(quotation.id, blob, file.name, '');
          } catch (err) {
            ctx.toast(err.message, 'error');
          }
        } else {
          pendingImages.push({ blob, name: file.name, caption: '', url: URL.createObjectURL(blob) });
        }
      }
      if (quotation) history = history.map((q) => (q.id === quotation.id ? quotation : q));
      rerenderImages();
    });
    root.querySelectorAll('[data-pend-caption]').forEach((el) =>
      el.addEventListener('input', () => {
        pendingImages[Number(el.dataset.pendCaption)].caption = el.value;
      })
    );
    root.querySelectorAll('[data-pend-del]').forEach((el) =>
      el.addEventListener('click', () => {
        const [p] = pendingImages.splice(Number(el.dataset.pendDel), 1);
        if (p) URL.revokeObjectURL(p.url);
        rerenderImages();
      })
    );
    root.querySelectorAll('[data-img-caption]').forEach((el) =>
      el.addEventListener('change', async () => {
        try {
          quotation = (await ctx.api.patch(`/api/quotations/images/${el.dataset.imgCaption}`, { caption: el.value })).quotation;
          ctx.toast('Leyenda guardada', 'success');
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      })
    );
    root.querySelectorAll('[data-img-del]').forEach((el) =>
      el.addEventListener('click', async () => {
        if (!confirm('¿Quitar esta imagen de la cotización?')) return;
        try {
          quotation = (await ctx.api.del(`/api/quotations/images/${el.dataset.imgDel}`)).quotation;
          history = history.map((q) => (q.id === quotation.id ? quotation : q));
          rerenderImages();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      })
    );
  }

  // Solo repinta la tarjeta de imágenes: no se pierde lo que se lleva escrito
  // en las líneas sin guardar.
  function rerenderImages() {
    const slot = root.querySelector('#cz-images-slot');
    if (!slot) return;
    slot.innerHTML = imagesSection();
    wireImages();
  }

  // ---- cliente: buscador + datos de facturación ------------------------------
  // Coordinador/admin eligen el asesor (también en un cliente ya
  // registrado: se cambia al guardar). El asesor ve el suyo, sin cambiarlo.
  function clientSection() {
    const canPickAdvisor = ctx.user?.role !== 'asesor' && advisorsCache.length;
    const current = lead?.assigned_advisor_id;
    const advisorField = canPickAdvisor
      ? `<div>
           <label class="block text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Asesor *</label>
           <select id="cz-advisor" class="w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm">
             ${lead && !current ? '<option value="">Sin asignar</option>' : ''}
             ${advisorsCache.map((a) => `<option value="${a.id}" ${a.id === current ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
             ${current && !advisorsCache.some((a) => a.id === current) ? `<option value="${current}" selected>${escapeHtml(lead.advisor_name || 'Asesor inactivo')}</option>` : ''}
           </select>
         </div>`
      : lead
        ? field('cz-advisor-ro', 'Asesor', lead.advisor_name || 'Sin asignar', { readonly: true })
        : `<div class="md:col-span-3 flex items-center gap-1.5 text-[11px] text-tertiary"><span class="material-symbols-outlined text-[14px]">info</span>Cliente nuevo: solo coordinador/admin puede registrarlo. Busca uno que ya exista.</div>`;

    return stepCard(
      1,
      'person',
      'Cliente',
      'Busque un cliente existente o registre uno nuevo.',
      `
        ${
          !lead
            ? `<div class="relative max-w-lg mb-3">
                 <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none">search</span>
                 <input id="cz-search" type="text" autocomplete="off" placeholder="Buscar por nombre, teléfono o documento…" class="w-full pl-10 pr-3 py-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20" />
                 <div id="cz-results" class="hidden absolute z-20 mt-1 w-full bg-surface border border-outline-variant rounded-md shadow-lg max-h-72 overflow-y-auto"></div>
               </div>`
            : ''
        }
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${field('cz-name', 'Nombre', lead?.client_name, { required: true })}
          ${field('cz-phone', 'Teléfono', lead?.phone, { required: true, type: 'tel' })}
          ${field('cz-document', 'NIT / Documento', lead?.document)}
          ${field('cz-email', 'Correo', lead?.email, { type: 'email' })}
          ${field('cz-address', 'Dirección', lead?.address)}
          ${field('cz-city', 'Ciudad', lead?.city)}
          ${advisorField}
        </div>
      `,
      lead ? `<button type="button" id="cz-change" class="btn btn-ghost text-[11px]"><span class="material-symbols-outlined">swap_horiz</span>Cambiar cliente</button>` : ''
    );
  }

  function wireClientSection() {
    root.querySelector('#cz-change')?.addEventListener('click', resetAll);
    const search = root.querySelector('#cz-search');
    const results = root.querySelector('#cz-results');
    if (!search) return;
    let deb;
    search.addEventListener('input', () => {
      clearTimeout(deb);
      const term = search.value.trim();
      if (term.length < 2) {
        results.classList.add('hidden');
        return;
      }
      deb = setTimeout(async () => {
        let list = [];
        try {
          list = await ctx.api.get(`/api/leads?q=${encodeURIComponent(term)}`);
        } catch {
          return;
        }
        if (!list.length) {
          results.innerHTML = '<p class="px-3 py-2 text-[11px] text-on-surface-variant">Sin resultados — llena los datos de abajo para registrarlo</p>';
          results.classList.remove('hidden');
          return;
        }
        results.innerHTML = list
          .slice(0, 20)
          .map(
            (l) => `<button type="button" data-id="${l.id}" class="w-full text-left px-3 py-2 hover:bg-surface-container-low transition-colors flex items-center gap-2.5">
              <span class="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-[11px] font-bold shrink-0">${escapeHtml(initials(l.client_name))}</span>
              <span class="min-w-0">
                <span class="block text-body-sm font-bold text-on-surface truncate">${escapeHtml(l.client_name)}</span>
                <span class="block text-[11px] text-on-surface-variant truncate">${escapeHtml(l.phone || '')}${l.product ? ' · ' + escapeHtml(l.product) : ''}${l.advisor_name ? ' · ' + escapeHtml(l.advisor_name) : ''}</span>
              </span>
            </button>`
          )
          .join('');
        results.classList.remove('hidden');
      }, 250);
    });
    results.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      results.classList.add('hidden');
      try {
        lead = await ctx.api.get(`/api/leads/${btn.dataset.id}`);
      } catch (err) {
        ctx.toast(err.message, 'error');
        return;
      }
      await refreshHistory();
      render();
    });
  }

  // Cierra el desplegable de resultados al hacer clic afuera -- un solo
  // listener en document (no uno por cada render) para no acumularlos; se
  // limpia al desmontar la vista.
  function onDocClick(e) {
    const search = root.querySelector('#cz-search');
    const results = root.querySelector('#cz-results');
    if (!search || !results) return;
    if (!search.contains(e.target) && !results.contains(e.target)) results.classList.add('hidden');
  }
  document.addEventListener('click', onDocClick);

  // ---- panel de resumen (derecha) --------------------------------------------
  function summaryPanel() {
    const hasQuotation = !!quotation;
    const badgeCls = hasQuotation ? STATE_BADGE[quotation.state] || STATE_BADGE.draft : STATE_BADGE.draft;
    const badgeLabel = hasQuotation ? STATE_LABEL[quotation.state] || quotation.state : 'Borrador';
    const expiresIn = hasQuotation ? daysUntil(quotation.validity_date) : null;
    const isCancelled = hasQuotation && quotation.state === 'cancel';

    return `
      <div class="bg-surface rounded-xl border border-outline-variant shadow-sm p-5">
        <div class="flex items-center gap-2 mb-4">
          <span class="material-symbols-outlined text-[20px] text-on-surface-variant">receipt_long</span>
          <h3 class="text-body-md font-body-md font-bold text-on-surface">Resumen de cotización</h3>
          <span class="ml-auto px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${badgeCls}">${badgeLabel}</span>
        </div>

        <div class="space-y-1.5 text-body-sm mb-4">
          <div class="flex justify-between gap-3"><span class="text-on-surface-variant">N.º de cotización</span><span class="font-bold text-on-surface">${hasQuotation ? escapeHtml(quotation.number) : 'Se asigna al guardar'}</span></div>
          <div class="flex justify-between gap-3"><span class="text-on-surface-variant">Fecha</span><span class="font-bold text-on-surface">${hasQuotation ? fmtDate(quotation.date_order) : fmtDate(todayIso())}</span></div>
          <div class="flex justify-between gap-3">
            <span class="text-on-surface-variant">Válida hasta</span>
            <span class="font-bold text-on-surface flex items-center gap-1">
              ${hasQuotation ? fmtDate(quotation.validity_date) : `<span id="cz-validity-date">${fmtDate(addDaysIso(8))}</span>`}
              ${expiresIn !== null ? `<span class="text-[10px] px-1.5 py-0.5 rounded ${expiresIn < 0 ? 'bg-error-container text-on-error-container' : expiresIn <= 2 ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-surface-container-high text-on-surface-variant'}">${expiresIn < 0 ? 'Vencida' : expiresIn === 0 ? 'Hoy' : `${expiresIn}d`}</span>` : ''}
            </span>
          </div>
        </div>

        <div id="cz-totals" class="border-t border-outline-variant pt-3 mb-4"></div>

        <div id="cz-summary-actions" class="flex flex-col gap-2 mb-4"></div>

        <div class="border-t border-outline-variant pt-4 mb-4">
          <p class="text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-2 flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">timeline</span>Estado de la cotización</p>
          ${statusStepper()}
        </div>

        ${
          hasQuotation && !isCancelled
            ? `<div class="border-t border-outline-variant pt-4">
                 <p class="text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-2">Acciones adicionales</p>
                 <div class="flex flex-col gap-1">
                   <button type="button" id="cz-duplicate" class="text-left text-body-sm text-on-surface hover:underline flex items-center gap-1.5 py-1"><span class="material-symbols-outlined text-[16px]">content_copy</span>Duplicar cotización</button>
                   ${
                     quotation.state !== 'sale'
                       ? `<button type="button" id="cz-confirm" class="text-left text-body-sm text-on-surface hover:underline flex items-center gap-1.5 py-1"><span class="material-symbols-outlined text-[16px]">task_alt</span>Convertir en venta</button>`
                       : ''
                   }
                   ${
                     lead?.client_id
                       ? `<button type="button" id="cz-view-client" class="text-left text-body-sm text-on-surface hover:underline flex items-center gap-1.5 py-1"><span class="material-symbols-outlined text-[16px]">badge</span>Ver historial del cliente</button>`
                       : ''
                   }
                   ${
                     quotation.state !== 'sale'
                       ? `<button type="button" id="cz-cancel" class="text-left text-body-sm text-error hover:text-error/80 flex items-center gap-1.5 py-1"><span class="material-symbols-outlined text-[16px]">cancel</span>Cancelar cotización</button>`
                       : ''
                   }
                 </div>
               </div>`
            : ''
        }
      </div>
    `;
  }

  const NEXT_STATE_ACTION = {
    draft: { label: 'Marcar como enviada', fn: () => transitionState('send', 'Cotización marcada como enviada') },
    sent: { label: 'Marcar en seguimiento', fn: () => transitionState('seguimiento', 'Cotización en seguimiento') },
    seguimiento: { label: 'Marcar como aprobada', fn: () => transitionState('aprobar', 'Cotización marcada como aprobada') },
  };

  function renderSummaryActions() {
    const el = root.querySelector('#cz-summary-actions');
    if (!el) return;
    if (!quotation) {
      el.innerHTML = '';
      return;
    }
    const buttons = [];
    if (lead?.phone) {
      buttons.push(
        `<button type="button" id="cz-whatsapp" class="btn btn-primary w-full justify-center"><span class="material-symbols-outlined">chat</span>Compartir por WhatsApp</button>`
      );
    }
    buttons.push(
      `<a href="/api/quotations/${quotation.id}/pdf" target="_blank" rel="noopener" class="btn btn-secondary w-full justify-center inline-flex"><span class="material-symbols-outlined">picture_as_pdf</span>Descargar PDF</a>`
    );
    const next = quotation.state !== 'cancel' ? NEXT_STATE_ACTION[quotation.state] : null;
    if (next) {
      buttons.push(`<button type="button" id="cz-next-state" class="btn btn-secondary w-full justify-center">${next.label}</button>`);
    }
    if (quotation.state !== 'cancel') buttons.push('<div id="cz-wo"></div>');
    el.innerHTML = buttons.join('');
    renderWorkOrderAction(el.querySelector('#cz-wo'));
    el.querySelector('#cz-whatsapp')?.addEventListener('click', sendWhatsApp);
    el.querySelector('#cz-next-state')?.addEventListener('click', (e) => {
      e.currentTarget.disabled = true;
      next.fn();
    });
  }

  // ---- pantalla completa (una sola, siempre) ---------------------------------
  function render() {
    root.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 class="text-headline-lg font-headline-lg text-on-surface truncate min-w-0">${quotation ? escapeHtml(quotation.number) : 'Nueva cotización'}</h2>
        <div class="flex flex-wrap gap-2" id="cz-actions"></div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-gutter items-start">
        <div class="flex flex-col gap-gutter">
          ${clientSection()}
          ${serviceSection()}
          ${stepCard(
            3,
            'inventory_2',
            'Detalle de la cotización',
            'Agregue los conceptos y precios.',
            `
              ${
                isEditable()
                  ? `<div class="flex items-center gap-1.5 mb-3 flex-wrap">
                       <label for="cz-number" class="text-[11px] text-on-surface-variant">N.º de cotización</label>
                       <input id="cz-number" type="text" maxlength="40" value="${quotation ? escapeHtml(quotation.number || '') : ''}" placeholder="Automático (COT-0001)" class="w-44 p-1 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm mr-3" />
                       <label class="text-[11px] text-on-surface-variant">Válida por</label>
                       <input id="cz-validity" type="number" min="1" value="${quotation ? quotation.validity_days || 8 : 8}" class="w-14 p-1 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm" />
                       <span class="text-[11px] text-on-surface-variant">días${quotation ? ' desde la fecha de la cotización' : ''}</span>
                     </div>`
                  : ''
              }
              ${isEditable() ? templateBar() : ''}
              <div id="cz-lines"></div>
              ${isEditable() ? `<button type="button" id="cz-add-line" class="btn btn-ghost mt-1 text-[12px]"><span class="material-symbols-outlined">add</span>Agregar concepto</button>` : ''}
            `
          )}
          ${
            isEditable()
              ? stepCard(
                  4,
                  'sticky_note_2',
                  'Notas y condiciones',
                  'Incluya información adicional, tiempos de entrega o condiciones.',
                  `<label class="block text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">Observaciones</label>
                   <textarea id="cz-note" rows="3" placeholder="Opcional — se incluye en el PDF de la cotización" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20">${escapeHtml(quotation?.note || '')}</textarea>
                   <div class="flex items-end justify-between gap-2 mt-4 mb-1 flex-wrap">
                     <label class="block text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant">Condiciones (una por línea)</label>
                     <button type="button" id="cz-terms-reset" class="btn btn-ghost text-[11px] ${quotation?.terms ? '' : 'hidden'}"><span class="material-symbols-outlined">restart_alt</span>Usar las de siempre</button>
                   </div>
                   <textarea id="cz-terms" rows="7" class="w-full p-2.5 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-[12px] resize-y">${escapeHtml(quotation?.terms || '')}</textarea>`
                )
              : quotation.note
                ? stepCard(4, 'sticky_note_2', 'Notas y condiciones', '', `<p class="text-body-sm text-on-surface-variant whitespace-pre-line">${escapeHtml(quotation.note)}</p>`)
                : ''
          }
          <div id="cz-images-slot">${imagesSection()}</div>
          ${historyStrip()}
        </div>

        <div class="lg:sticky lg:top-4">
          ${summaryPanel()}
        </div>
      </div>
    `;

    wireClientSection();
    wireServiceSection();
    renderServiceFields();
    root.querySelector('#cz-validity')?.addEventListener('input', (e) => {
      const days = Number(e.target.value) || 0;
      const hint = root.querySelector('#cz-validity-date');
      if (hint) hint.textContent = days > 0 ? fmtDate(addDaysIso(days)) : '—';
      renderTotals();
    });
    root.querySelectorAll('[data-hist]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        pendingImages.forEach((p) => URL.revokeObjectURL(p.url));
        pendingImages = [];
        await refreshHistory(Number(btn.dataset.hist));
        render();
      });
    });

    const list = root.querySelector('#cz-lines');
    const editable = isEditable();
    if (quotation) {
      quotation.lines.forEach((l) => appendLineRow(list, l, editable));
    } else {
      appendLineRow(list, null, true);
    }
    root.querySelector('#cz-add-line')?.addEventListener('click', () => appendLineRow(list, null, true));
    wireTemplateBar(list);
    wireImages();
    wireTerms();

    renderTotals();
    renderSummaryActions();
    renderActions();

    root.querySelector('#cz-duplicate')?.addEventListener('click', duplicateQuotation);
    root.querySelector('#cz-confirm')?.addEventListener('click', convertToSale);
    root.querySelector('#cz-cancel')?.addEventListener('click', cancelQuotation);
    root.querySelector('#cz-view-client')?.addEventListener('click', () => ctx.navigate('clientes', { open: lead.client_id }));
  }

  function renderActions() {
    const actionsEl = root.querySelector('#cz-actions');
    if (!actionsEl) return;
    if (!isEditable()) {
      actionsEl.innerHTML = '';
      return;
    }
    const label = quotation ? 'Guardar cambios' : lead ? 'Guardar cotización' : 'Registrar y cotizar';
    actionsEl.innerHTML = `<button type="button" id="cz-save" class="btn btn-primary"><span class="material-symbols-outlined">save</span>${label}</button>`;
    actionsEl.querySelector('#cz-save').addEventListener('click', save);
  }

  // Trabajos: cuando el cliente acepta, "Crear trabajo" marca la venta como
  // ganada y pasa la cotización al tablero de Trabajos (ver routes/jobs.js).
  // Si ya se creó, el botón lleva a ese trabajo.
  async function renderWorkOrderAction(slot) {
    if (!slot) return;
    const forQuotation = quotation.id;
    let existing = null;
    try {
      const list = await ctx.api.get('/api/jobs?all=1');
      existing = list.find((j) => j.quotation_id === forQuotation && j.stage !== 'cancelada') || null;
    } catch {
      return; // sin acceso a Trabajos, no se muestra nada
    }
    if (!quotation || quotation.id !== forQuotation || !slot.isConnected) return;
    if (existing) {
      slot.innerHTML = `<a href="#/trabajos?id=${existing.id}" class="btn btn-secondary w-full justify-center inline-flex"><span class="material-symbols-outlined">construction</span>Ver trabajo ${escapeHtml(existing.number)}</a>`;
      return;
    }
    slot.innerHTML = `<button type="button" class="btn btn-secondary w-full justify-center"><span class="material-symbols-outlined">construction</span>El cliente aceptó · Crear trabajo</button>`;
    slot.querySelector('button').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const job = await ctx.api.post('/api/jobs/from-quotation', { quotation_id: quotation.id });
        ctx.toast(`Trabajo ${job.number} creado y venta marcada como ganada`, 'success');
        ctx.navigate('trabajos', { id: job.id });
      } catch (err) {
        ctx.toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  }

  // Abre WhatsApp Web/app con el chat del cliente y un mensaje ya escrito --
  // WhatsApp no deja adjuntar un archivo por URL, así que el mensaje le pide
  // adjuntar el PDF descargado (o compartirlo el asesor manualmente).
  function sendWhatsApp() {
    const digits = (lead.phone || '').replace(/\D/g, '');
    if (!digits) {
      ctx.toast('Este cliente no tiene teléfono registrado', 'error');
      return;
    }
    const phone = digits.length === 10 ? `57${digits}` : digits; // 10 dígitos = celular colombiano sin indicativo
    const text = `Hola ${lead.client_name}, te comparto la cotización ${quotation.number} por ${formatMoney(quotation.amount_total)}. Te adjunto el PDF a continuación.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  async function duplicateQuotation() {
    const btn = root.querySelector('#cz-duplicate');
    btn.disabled = true;
    try {
      const r = await ctx.api.post(`/api/quotations/${quotation.id}/duplicate`);
      ctx.toast(`Cotización duplicada como ${r.quotation.number}`, 'success');
      await refreshHistory(r.quotation.id);
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
      btn.disabled = false;
    }
  }

  // Estados intermedios (enviada/seguimiento/aprobada) -- se marcan a mano,
  // igual que el resto del embudo en este CRM (nada avanza solo).
  async function transitionState(endpoint, successMsg) {
    try {
      await ctx.api.post(`/api/quotations/${quotation.id}/${endpoint}`);
      ctx.toast(successMsg, 'success');
      await refreshHistory(quotation.id);
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
      render();
    }
  }

  function convertToSale() {
    openCloseModal(lead, ctx, async () => {
      try {
        await ctx.api.post(`/api/quotations/${quotation.id}/confirm`);
      } catch {
        /* el lead ya quedo cerrado en el CRM aunque esto falle; no es bloqueante */
      }
      await refreshHistory(quotation.id);
      render();
    });
  }

  async function cancelQuotation() {
    if (!confirm(`¿Cancelar la cotización ${quotation.number}? Esta acción no se puede deshacer.`)) return;
    try {
      await ctx.api.post(`/api/quotations/${quotation.id}/cancel`);
      ctx.toast('Cotización cancelada', 'success');
      await refreshHistory(quotation.id);
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  // Un solo botón hace todo: si el cliente es nuevo lo crea (o actualiza sus
  // datos si ya existía) y crea/actualiza la cotización -- así la búsqueda y
  // el formulario de cotización quedan en una sola pantalla, un solo guardado.
  async function save() {
    const name = root.querySelector('#cz-name').value.trim();
    const phone = root.querySelector('#cz-phone').value.trim();
    if (!name || !phone) {
      ctx.toast('Nombre y teléfono son obligatorios', 'error');
      return;
    }
    const list = root.querySelector('#cz-lines');
    const lines = readLines(list);
    if (!lines.length) {
      ctx.toast('Agrega al menos un producto con cantidad', 'error');
      return;
    }

    const service_slug = root.querySelector('#cz-service')?.value || null;
    if (!service_slug) {
      ctx.toast('Selecciona un servicio', 'error');
      return;
    }
    const service = findService(service_slug);
    const service_fields = readServiceFields();

    const fields = {
      client_name: name,
      phone,
      document: root.querySelector('#cz-document').value.trim(),
      email: root.querySelector('#cz-email').value.trim(),
      address: root.querySelector('#cz-address').value.trim(),
      city: root.querySelector('#cz-city').value.trim(),
      // El "producto" del lead queda sincronizado con el servicio elegido en
      // esta cotización -- el desplegable de "Producto de interés" que
      // vivía en esta pantalla se reemplazó por el paso "Servicio" de abajo,
      // pero el lead sigue necesitando ese dato para Estadísticas/Dashboard.
      product: service.title,
    };

    const btn = root.querySelector('#cz-save');
    btn.disabled = true;
    btn.setAttribute('data-loading', '');
    try {
      if (!lead) {
        const advisorSelect = root.querySelector('#cz-advisor');
        if (ctx.user?.role !== 'asesor' && !advisorSelect?.value) {
          ctx.toast('Selecciona un asesor', 'error');
          btn.disabled = false;
          btn.removeAttribute('data-loading');
          return;
        }
        lead = await ctx.api.post('/api/leads', { ...fields, advisor_id: advisorSelect?.value });
        ctx.toast('Cliente registrado', 'success');
      } else {
        const advisorId = Number(root.querySelector('#cz-advisor')?.value) || null;
        const advisorChanged = advisorId && advisorId !== lead.assigned_advisor_id;
        lead = await ctx.api.patch(`/api/leads/${lead.id}`, advisorChanged ? { ...fields, advisor_id: advisorId } : fields);
        if (advisorChanged) ctx.toast(`Asesor cambiado a ${lead.advisor_name || 'otro asesor'}`, 'success');
      }

      let r;
      const note = root.querySelector('#cz-note')?.value.trim() ?? undefined;
      const validity_days = Number(root.querySelector('#cz-validity')?.value) || 8;
      const terms = termsCustom ? root.querySelector('#cz-terms')?.value.trim() || null : null;
      const number = root.querySelector('#cz-number')?.value.trim() ?? undefined;
      if (quotation) {
        r = await ctx.api.put(`/api/quotations/${quotation.id}`, { lines, service_slug, service_fields, note, validity_days, terms, number });
        ctx.toast('Cotización actualizada', 'success');
      } else {
        r = await ctx.api.post(`/api/leads/${lead.id}/quotations`, { lines, validity_days, note: note || undefined, service_slug, service_fields, terms, number });
        ctx.toast('Cotización creada', 'success');
      }
      await uploadPending(r.quotation.id);
      await refreshHistory(r.quotation.id);
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
      btn.disabled = false;
      btn.removeAttribute('data-loading');
    }
  }

  // Deep-link opcional: #/cotizar?lead=123 abre esa cotización (la última
  // activa); con &quotation=45 (ej. desde la pestaña "Cotizaciones") abre
  // esa cotización puntual del historial, aunque no sea la más reciente.
  const presetLeadId = ctx.routeParams.get('lead');
  const presetQuotationId = ctx.routeParams.get('quotation');
  if (presetLeadId) {
    try {
      lead = await ctx.api.get(`/api/leads/${presetLeadId}`);
      await refreshHistory(presetQuotationId ? Number(presetQuotationId) : undefined);
    } catch {
      lead = null;
    }
  }
  render();

  return () => {
    document.removeEventListener('click', onDocClick);
  };
}
