import { openModal } from './modal.js';
import { escapeHtml, formatMoney } from '../utils.js';
import {
  findTemplate,
  CARPA_TIPOS,
  CARPA_LONAS,
  FORRO_TIPOS,
  FORRO_MATERIALES,
  newCarpa,
  carpaArea,
  carpaLine,
  carpaServiceHints,
  newForro,
  forroArea,
  forroLine,
  forroServiceHints,
  costeoResult,
  AUTO_KINDS,
  MOTO_MARCAS,
  newAuto,
  autoSuggested,
  autoLine,
  autoServiceHints,
} from '../data/quoteTemplates.js';

// Ventana de una plantilla de cotización (ver data/quoteTemplates.js). Al
// confirmar llama onAdd(lines, { service_slug, hints }) -- la pantalla
// Cotizar agrega las líneas y, si aún no hay servicio elegido, toma el de
// la plantilla y completa sus campos con `hints`.

const INPUT = 'w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm';
const LABEL = 'block text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-1';

function inputHtml(key, label, value, type = 'text', extra = '') {
  return `<div><label class="${LABEL}">${label}</label><input data-k="${key}" type="${type}" value="${escapeHtml(value ?? '')}" ${extra} class="${INPUT}" /></div>`;
}

function selectHtml(key, label, map, value) {
  return `<div><label class="${LABEL}">${label}</label><select data-k="${key}" class="${INPUT}">${Object.entries(map)
    .map(([k, v]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${escapeHtml(v.nom)}</option>`)
    .join('')}</select></div>`;
}

function checkHtml(key, label, value) {
  return `<label class="flex items-center gap-2 text-body-sm text-on-surface"><input data-k="${key}" type="checkbox" ${value ? 'checked' : ''} /> ${label}</label>`;
}

// Lee los campos data-k del formulario sobre el objeto de estado.
function bindState(body, state, onChange) {
  body.querySelectorAll('[data-k]').forEach((el) => {
    const evt = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      const k = el.dataset.k;
      state[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      onChange(k);
    });
  });
}

// Resultado de la plantilla: nombre, descripción y precio que se arman
// solos con las opciones de arriba, pero que el asesor puede reescribir
// aquí mismo. Lo que se escribe a mano ya no lo pisa el cálculo (hasta que
// pulse "Volver al texto automático").
function resultEditor(slot, { withPrice = true, perM2Label = 'm²' } = {}) {
  slot.innerHTML = `
    <div class="rounded-lg bg-surface-container-low p-3">
      <div class="flex items-baseline justify-between gap-3 flex-wrap">
        <span class="text-body-sm text-on-surface-variant">Precio sugerido c/u</span>
        <span data-r-sug class="text-headline-sm font-headline-sm font-bold text-on-surface"></span>
      </div>
      <p data-r-area class="text-[11px] text-on-surface-variant mt-1"></p>
      <div class="grid grid-cols-1 ${withPrice ? 'md:grid-cols-[1fr_160px]' : ''} gap-3 mt-3">
        <div><label class="${LABEL}">Nombre en la cotización</label><input data-r="name" type="text" class="${INPUT}" /></div>
        ${withPrice ? `<div><label class="${LABEL}">Precio c/u</label><input data-r="price" type="number" min="0" step="1000" class="${INPUT} text-right" /></div>` : ''}
      </div>
      <div class="mt-3"><label class="${LABEL}">Descripción (sale en el PDF)</label><textarea data-r="desc" rows="4" class="${INPUT} resize-y"></textarea></div>
      <div class="flex items-center justify-between gap-2 mt-2 flex-wrap">
        <p class="text-[11px] text-on-surface-variant">Escriba libremente: lo que cambie aquí queda tal cual en la cotización.</p>
        <button type="button" data-r-reset class="btn btn-ghost text-[11px] hidden"><span class="material-symbols-outlined">restart_alt</span>Volver al texto automático</button>
      </div>
    </div>`;
  const els = { name: slot.querySelector('[data-r="name"]'), desc: slot.querySelector('[data-r="desc"]'), price: slot.querySelector('[data-r="price"]') };
  const manual = { name: false, desc: false, price: false };
  const resetBtn = slot.querySelector('[data-r-reset]');
  let auto = null;
  let autoArea = 0;

  const paintAuto = () => {
    if (!manual.name) els.name.value = auto.product_name;
    if (!manual.desc) els.desc.value = auto.description || '';
    if (els.price && !manual.price) els.price.value = auto.price_unit || '';
    const price = els.price && manual.price ? Number(els.price.value) || 0 : auto.price_unit;
    slot.querySelector('[data-r-sug]').textContent = formatMoney(auto.price_unit);
    slot.querySelector('[data-r-area]').textContent = autoArea ? `${autoArea.toFixed(2)} ${perM2Label} · ${formatMoney(price / autoArea)} por m²` : '';
    resetBtn.classList.toggle('hidden', !Object.values(manual).some(Boolean));
  };
  Object.entries(els).forEach(([k, el]) =>
    el?.addEventListener('input', () => {
      manual[k] = true;
      paintAuto();
    })
  );
  resetBtn.addEventListener('click', () => {
    Object.keys(manual).forEach((k) => (manual[k] = false));
    paintAuto();
  });

  return {
    update(line, area = 0) {
      auto = line;
      autoArea = area;
      paintAuto();
    },
    line() {
      return {
        ...auto,
        product_name: els.name.value.trim() || auto.product_name,
        description: els.desc.value.trim() || null,
        price_unit: els.price && manual.price ? Number(els.price.value) || 0 : auto.price_unit,
      };
    },
  };
}

function footer(addLabel = 'Agregar a la cotización') {
  return `<div class="flex justify-end gap-2 mt-4">
    <button type="button" data-cancel class="btn btn-secondary">Cancelar</button>
    <button type="button" data-add class="btn btn-primary"><span class="material-symbols-outlined">add</span>${addLabel}</button>
  </div>`;
}

function renderCarpa(body, config, done) {
  const it = newCarpa();
  const paint = () => {
    const concha = it.modelo === 'concha';
    body.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${selectHtml('modelo', 'Tipo', CARPA_TIPOS, it.modelo)}
        ${selectHtml('lona', 'Lona', CARPA_LONAS, it.lona)}
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        ${inputHtml('ancho', 'Ancho (cm)', it.ancho, 'number', 'min="0"')}
        ${inputHtml('proy', concha ? 'Fondo (cm)' : it.modelo === 'lona' ? 'Largo (cm)' : 'Proyección (cm)', it.proy, 'number', 'min="0"')}
        ${concha ? inputHtml('alto', 'Alto (cm)', it.alto, 'number', 'min="0"') : inputHtml('falda', 'Falda (cm)', it.falda, 'number', 'min="0"')}
        ${inputHtml('cant', 'Cantidad', it.cant, 'number', 'min="1"')}
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        ${inputHtml('color', 'Color lona', it.color)}
        ${inputHtml('colorEst', 'Color estructura', it.colorEst)}
        ${inputHtml('tubo', 'Tubería', it.tubo, 'text', 'placeholder="1½&quot; cal 16"')}
        ${inputHtml('logos', 'N.º de logos', it.logos, 'number', 'min="0"')}
      </div>
      <div class="flex flex-wrap gap-4 mt-3">
        ${checkHtml('instala', 'Incluye instalación', it.instala)}
        ${checkHtml('verMaterial', 'Agregar características de la lona', it.verMaterial)}
      </div>
      <div data-price class="mt-4"></div>
      ${footer()}`;
    const result = resultEditor(body.querySelector('[data-price]'));
    const refresh = () => result.update(carpaLine(it, config), carpaArea(it));
    bindState(body, it, (k) => (k === 'modelo' ? paint() : refresh()));
    refresh();
    body.querySelector('[data-cancel]').addEventListener('click', done.close);
    body.querySelector('[data-add]').addEventListener('click', () => done.add([result.line()], carpaServiceHints(it)));
  };
  paint();
}

function renderForro(body, config, done) {
  const it = newForro();
  const paint = () => {
    const cap = it.modelo === 'capuchon';
    body.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${selectHtml('modelo', 'Tipo', FORRO_TIPOS, it.modelo)}
        ${selectHtml('mat', 'Material', FORRO_MATERIALES, it.mat)}
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        ${inputHtml('L', 'Largo (cm)', it.L, 'number', 'min="0"')}
        ${inputHtml('A', cap ? 'Ancho / fondo (cm)' : 'Ancho (cm)', it.A, 'number', 'min="0"')}
        ${cap ? inputHtml('H', 'Alto (cm)', it.H, 'number', 'min="0"') : '<div></div>'}
        ${inputHtml('cant', 'Cantidad', it.cant, 'number', 'min="1"')}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        ${inputHtml('equipo', 'Para (equipo u objeto)', it.equipo, 'text', 'placeholder="compresor, tanque, mesa…"')}
        ${inputHtml('color', 'Color', it.color)}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-2 mt-3">
        ${checkHtml('acolchado', 'Acolchado (jumbolón)', it.acolchado)}
        ${checkHtml('sellado', 'Electrosellado / vulcanizado', it.sellado)}
        ${checkHtml('cremallera', 'Cremallera', it.cremallera)}
        ${checkHtml('visor', 'Visor en vinilo transparente', it.visor)}
        ${checkHtml('elastico', 'Elástico inferior', it.elastico)}
      </div>
      <div class="grid grid-cols-2 gap-3 mt-3">
        ${inputHtml('bordados', 'Logos bordados', it.bordados, 'number', 'min="0"')}
        ${inputHtml('impresos', 'Logos impresos full color', it.impresos, 'number', 'min="0"')}
      </div>
      <div data-price class="mt-4"></div>
      ${footer()}`;
    const result = resultEditor(body.querySelector('[data-price]'), { perM2Label: cap ? 'm² de material' : 'm²' });
    const refresh = () => result.update(forroLine(it, config), forroArea(it));
    bindState(body, it, (k) => (k === 'modelo' ? paint() : refresh()));
    refresh();
    body.querySelector('[data-cancel]').addEventListener('click', done.close);
    body.querySelector('[data-add]').addEventListener('click', () => done.add([result.line()], forroServiceHints(it)));
  };
  paint();
}

function renderCatalogo(body, config, done) {
  const picked = new Map(); // "gi:ii" -> cantidad
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  body.innerHTML = `
    <input data-filter type="search" placeholder="Buscar: cabina 15, surtidor, ascensor…" class="${INPUT} mb-3" />
    <p class="text-[11px] text-on-surface-variant mb-2">Precios unitarios. Se editan en Cotizaciones › Plantillas y tarifas; el texto y el precio también se pueden cambiar en la cotización.</p>
    <div data-list class="max-h-[50vh] overflow-y-auto border border-outline-variant rounded-lg"></div>
    <p data-count class="text-body-sm text-on-surface-variant mt-3"></p>
    ${footer('Agregar seleccionados')}`;
  const listEl = body.querySelector('[data-list]');
  const countEl = body.querySelector('[data-count]');
  const paintList = () => {
    const q = norm(body.querySelector('[data-filter]').value);
    listEl.innerHTML = config.catalogo
      .map((g, gi) => {
        const items = g.items.map((x, ii) => ({ ...x, key: `${gi}:${ii}` })).filter((x) => !q || norm(`${g.cat} ${x.t} ${x.d}`).includes(q));
        if (!items.length) return '';
        return `<div class="px-3 py-1.5 bg-surface-container-low text-[11px] font-label-bold uppercase tracking-wide text-on-surface-variant sticky top-0">${escapeHtml(g.cat)}</div>
          ${items
            .map(
              (x) => `<label class="flex items-start gap-3 px-3 py-2 border-t border-outline-variant/60 cursor-pointer hover:bg-surface-container-lowest">
                <input type="checkbox" data-pick="${x.key}" ${picked.has(x.key) ? 'checked' : ''} class="mt-1" />
                <span class="flex-1 min-w-0"><span class="block text-body-sm font-bold text-on-surface">${escapeHtml(x.t)}</span>${x.d ? `<span class="block text-[11px] text-on-surface-variant">${escapeHtml(x.d)}</span>` : ''}</span>
                <input type="number" min="1" data-qty="${x.key}" value="${picked.get(x.key) || 1}" class="w-14 p-1 border border-outline-variant rounded-md text-body-sm text-right" title="Cantidad" />
                <span class="w-24 text-right text-body-sm font-bold text-on-surface shrink-0">${formatMoney(x.p)}</span>
              </label>`
            )
            .join('')}`;
      })
      .join('') || '<p class="p-3 text-body-sm text-on-surface-variant">Sin resultados.</p>';
    listEl.querySelectorAll('[data-pick]').forEach((el) =>
      el.addEventListener('change', () => {
        const qty = Number(listEl.querySelector(`[data-qty="${el.dataset.pick}"]`).value) || 1;
        if (el.checked) picked.set(el.dataset.pick, qty);
        else picked.delete(el.dataset.pick);
        paintCount();
      })
    );
    listEl.querySelectorAll('[data-qty]').forEach((el) =>
      el.addEventListener('input', () => {
        if (picked.has(el.dataset.qty)) picked.set(el.dataset.qty, Math.max(1, Number(el.value) || 1));
        paintCount();
      })
    );
  };
  const selectedLines = () =>
    [...picked.entries()].map(([key, qty]) => {
      const [gi, ii] = key.split(':').map(Number);
      const x = config.catalogo[gi].items[ii];
      return { product_name: x.t, description: x.d || null, qty, price_unit: Number(x.p) || 0 };
    });
  const paintCount = () => {
    const lines = selectedLines();
    const total = lines.reduce((a, l) => a + l.qty * l.price_unit, 0);
    countEl.textContent = lines.length ? `${lines.length} producto(s) · ${formatMoney(total)}` : 'Marque los productos a cotizar.';
  };
  body.querySelector('[data-filter]').addEventListener('input', paintList);
  body.querySelector('[data-cancel]').addEventListener('click', done.close);
  body.querySelector('[data-add]').addEventListener('click', () => {
    const lines = selectedLines();
    if (!lines.length) return;
    done.add(lines, { tipo_mueble: lines[0].product_name });
  });
  paintList();
  paintCount();
}

function renderCosteo(body, config, done) {
  const state = {
    nombre: '',
    unidades: 1,
    margen: config.costeo.margen,
    lineas: [['Lona (m)', 1, 15000], ['Mano de obra', 1, 50000], ['Insumos', 1, 20000]],
  };
  const presets = config.costeo.plantillas || {};
  const paint = () => {
    body.innerHTML = `
      <p class="text-[12px] text-on-surface-variant mb-3">Precio = neto ÷ (1 − margen), redondeado a $10.000 — el mismo método de la calculadora de Excel.</p>
      <div class="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-3">
        <div><label class="${LABEL}">Producto</label><input data-f="nombre" value="${escapeHtml(state.nombre)}" placeholder="Capuchón industrial 155 × 285 × 200" class="${INPUT}" /></div>
        <div><label class="${LABEL}">Unidades del costeo</label><input data-f="unidades" type="number" min="1" value="${state.unidades}" class="${INPUT}" /></div>
      </div>
      <div class="mt-3 border border-outline-variant rounded-lg overflow-hidden">
        <div class="grid grid-cols-[1fr_70px_110px_100px_32px] gap-2 px-2 py-1.5 bg-surface-container-low text-[10px] font-label-bold uppercase text-on-surface-variant"><span>Concepto</span><span>Cant.</span><span>Valor unit.</span><span class="text-right">Total</span><span></span></div>
        ${state.lineas
          .map(
            (l, i) => `<div class="grid grid-cols-[1fr_70px_110px_100px_32px] gap-2 px-2 py-1.5 border-t border-outline-variant/60 items-center">
              <input data-l="${i}" data-c="0" value="${escapeHtml(l[0])}" class="p-1 border border-outline-variant rounded-md text-body-sm" />
              <input data-l="${i}" data-c="1" type="number" step="any" value="${l[1]}" class="p-1 border border-outline-variant rounded-md text-body-sm text-right" />
              <input data-l="${i}" data-c="2" type="number" step="1000" value="${l[2]}" class="p-1 border border-outline-variant rounded-md text-body-sm text-right" />
              <span data-lt="${i}" class="text-right text-body-sm">${formatMoney(l[1] * l[2])}</span>
              <button type="button" data-del="${i}" class="btn btn-icon" aria-label="Quitar"><span class="material-symbols-outlined text-[18px]">close</span></button>
            </div>`
          )
          .join('')}
      </div>
      <div class="flex flex-wrap gap-2 mt-2">
        <button type="button" data-addline class="btn btn-ghost text-[12px]"><span class="material-symbols-outlined">add</span>Línea</button>
        <select data-preset class="p-1.5 border border-outline-variant rounded-md text-body-sm">
          <option value="">Cargar plantilla de costeo…</option>
          ${Object.entries(presets).map(([k, p]) => `<option value="${k}">${escapeHtml(p.nombre)}</option>`).join('')}
        </select>
        <label class="flex items-center gap-2 text-body-sm ml-auto">Margen <input data-f="margen" type="number" step="0.01" min="0" max="0.95" value="${state.margen}" class="w-20 p-1 border border-outline-variant rounded-md text-right" /></label>
      </div>
      <div data-res class="mt-4 rounded-lg bg-surface-container-low p-3"></div>
      ${footer()}`;

    const refresh = () => {
      state.lineas.forEach((l, i) => {
        const el = body.querySelector(`[data-lt="${i}"]`);
        if (el) el.textContent = formatMoney((Number(l[1]) || 0) * (Number(l[2]) || 0));
      });
      const r = costeoResult(state.lineas, state.margen, state.unidades);
      body.querySelector('[data-res]').innerHTML = `
        <p class="text-body-sm text-on-surface-variant">Neto ${formatMoney(r.neto)} · Precio total <b class="text-on-surface">${formatMoney(r.total)}</b>${Number(config.iva) > 0 ? ` · Con IVA ${formatMoney(r.total * (1 + Number(config.iva) / 100))}` : ''}</p>
        <p class="mt-1 text-body-sm">Precio unitario: <span class="text-headline-sm font-headline-sm font-bold text-on-surface">${formatMoney(r.unit)}</span> (${r.unidades} und)</p>`;
    };
    body.querySelectorAll('[data-f]').forEach((el) =>
      el.addEventListener('input', () => {
        state[el.dataset.f] = el.type === 'number' ? Number(el.value) : el.value;
        refresh();
      })
    );
    body.querySelectorAll('[data-l]').forEach((el) =>
      el.addEventListener('input', () => {
        const c = Number(el.dataset.c);
        state.lineas[Number(el.dataset.l)][c] = c === 0 ? el.value : Number(el.value);
        refresh();
      })
    );
    body.querySelectorAll('[data-del]').forEach((el) =>
      el.addEventListener('click', () => {
        state.lineas.splice(Number(el.dataset.del), 1);
        paint();
      })
    );
    body.querySelector('[data-addline]').addEventListener('click', () => {
      state.lineas.push(['', 1, 0]);
      paint();
    });
    body.querySelector('[data-preset]').addEventListener('change', (e) => {
      const p = presets[e.target.value];
      if (!p) return;
      state.lineas = JSON.parse(JSON.stringify(p.lineas));
      if (!state.nombre) state.nombre = p.nombre;
      paint();
    });
    body.querySelector('[data-cancel]').addEventListener('click', done.close);
    body.querySelector('[data-add]').addEventListener('click', () => {
      const r = costeoResult(state.lineas, state.margen, state.unidades);
      const name = state.nombre.trim() || 'Producto especial';
      done.add([{ product_name: name, description: null, qty: r.unidades, price_unit: r.unit }], { tipo_mueble: name, detalle: name });
    });
    refresh();
  };
  paint();
}

function listSelectHtml(key, label, options, value) {
  return `<div><label class="${LABEL}">${label}</label><select data-k="${key}" class="${INPUT}">${options
    .map((o) => `<option value="${escapeHtml(o)}" ${o === value ? 'selected' : ''}>${escapeHtml(o)}</option>`)
    .join('')}</select></div>`;
}

// Forros para carro, tapizado automotriz y sillín de moto: misma ventana,
// cambia la opción principal (AUTO_KINDS). Si la opción no tiene precio
// base configurado, el precio se escribe a mano aquí mismo.
function renderAuto(kind) {
  return (body, config, done) => {
    const A = config.automotriz;
    const meta = AUTO_KINDS[kind];
    const it = newAuto(kind, config);
    const moto = kind === 'motos';
    body.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        ${moto ? listSelectHtml('marca', 'Marca', MOTO_MARCAS, it.marca) : inputHtml('marca', 'Marca', it.marca, 'text', 'placeholder="Chevrolet"')}
        ${inputHtml('modelo', 'Modelo', it.modelo, 'text', `placeholder="${moto ? 'NKD 125' : 'Onix'}"`)}
        ${inputHtml('anio', 'Año', it.anio, 'text', 'placeholder="2021"')}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-${meta.vehiculo ? 3 : 2} gap-3 mt-3">
        ${listSelectHtml('opcion', meta.optionLabel, Object.keys(A[kind]), it.opcion)}
        ${meta.vehiculo ? listSelectHtml('vehiculo', 'Tipo de vehículo', Object.keys(A.vehiculos), it.vehiculo) : ''}
        ${listSelectHtml('material', 'Material', Object.keys(A.materiales), it.material)}
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
        ${inputHtml('color', 'Color', it.color)}
        ${inputHtml('bordados', 'Bordados (logo o diseño)', it.bordados, 'number', 'min="0"')}
        ${inputHtml('cant', 'Cantidad', it.cant, 'number', 'min="1"')}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-2 mt-3">
        ${checkHtml('costuraColor', 'Costura en color de contraste', it.costuraColor)}
        ${moto ? checkHtml('espumaNueva', 'Espuma nueva (dos densidades)', it.espumaNueva) : ''}
        ${moto ? checkHtml('antideslizante', 'Antideslizante', it.antideslizante) : ''}
      </div>
      <div class="mt-3 max-w-xs">${inputHtml('precioManual', 'Precio unitario', it.precioManual, 'number', 'min="0" step="1000"')}</div>
      <div data-nobase class="mt-4 hidden rounded-lg bg-tertiary-container text-on-tertiary-container p-3 text-body-sm">Esta opción aún no tiene precio base. Escriba el precio arriba, o configúrelo en Cotizaciones › Plantillas y tarifas para que se sugiera solo.</div>
      <div data-price class="mt-4"></div>
      ${footer()}`;
    const priceInput = body.querySelector('[data-k="precioManual"]');
    const result = resultEditor(body.querySelector('[data-price]'), { withPrice: false });
    const refresh = () => {
      const sug = autoSuggested(it, config);
      priceInput.placeholder = sug ? String(sug) : 'Escriba el precio';
      const line = autoLine(it, config);
      body.querySelector('[data-nobase]').classList.toggle('hidden', !!(sug || line.price_unit));
      result.update(line, 0);
    };
    bindState(body, it, refresh);
    refresh();
    body.querySelector('[data-cancel]').addEventListener('click', done.close);
    body.querySelector('[data-add]').addEventListener('click', () => {
      const line = result.line();
      if (!line.price_unit && !confirm('La línea queda en $0. ¿Agregarla de todas formas y poner el precio después?')) return;
      done.add([line], autoServiceHints(it));
    });
  };
}

const RENDERERS = {
  'forro-carro': renderAuto('forrosCarros'),
  'tapizado-auto': renderAuto('tapizado'),
  'sillin-moto': renderAuto('motos'),
  carpa: renderCarpa,
  forro: renderForro,
  catalogo: renderCatalogo,
  costeo: renderCosteo,
};

export function openTemplateModal({ key, config, onAdd }) {
  const template = findTemplate(key);
  if (!template || !RENDERERS[key]) return;
  openModal({
    title: escapeHtml(template.label),
    wide: true,
    render: (body, { close }) => {
      RENDERERS[key](body, config, {
        close,
        add: (lines, hints) => {
          onAdd(lines, { service_slug: template.service_slug, hints: hints || {} });
          close();
        },
      });
    },
  });
}
