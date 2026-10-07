import { escapeHtml } from '../utils.js';
import { TEMPLATES, CARPA_TIPOS, CARPA_LONAS, FORRO_TIPOS, FORRO_MATERIALES } from '../data/quoteTemplates.js';
import { SERVICES } from '../data/velaraServices.js';
import { confirmModal } from '../components/modal.js';

// Cotizaciones › Plantillas y tarifas: lo que usan las plantillas de
// "Nueva cotización" para sugerir precios (server/quoteTemplates.js). Se
// guarda en el CRM, así todo el equipo cotiza con las mismas tarifas.

const NUM = 'w-full p-1.5 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm text-right';
const TXT = 'w-full p-1.5 border border-outline-variant rounded-md outline-none focus:border-outline text-body-sm';
const LABEL = 'block text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-1';

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

function numInput(path, value, step = 1000) {
  return `<input data-path="${path}" type="number" step="${step}" min="0" value="${value ?? ''}" class="${NUM}" />`;
}

function card(title, desc, inner) {
  return `<section class="bg-surface rounded-xl border border-outline-variant shadow-sm p-5">
    <h3 class="text-body-md font-bold text-on-surface">${title}</h3>
    ${desc ? `<p class="text-[12px] text-on-surface-variant mb-3">${desc}</p>` : ''}
    ${inner}
  </section>`;
}

function tarifaTable(base, tipos, cfgTipos) {
  return `<div class="overflow-x-auto"><table class="w-full text-body-sm">
    <thead><tr class="text-[10px] uppercase text-on-surface-variant"><th class="text-left py-1">Tipo</th><th class="py-1">Valor fijo</th><th class="py-1">Valor por m²</th><th class="py-1">Mínimo</th></tr></thead>
    <tbody>${Object.entries(tipos)
      .map(
        ([k, v]) => `<tr class="border-t border-outline-variant/60">
          <td class="py-1.5 pr-2">${escapeHtml(v.nom)}</td>
          <td class="p-1">${numInput(`${base}.${k}.fijo`, cfgTipos[k]?.fijo)}</td>
          <td class="p-1">${numInput(`${base}.${k}.m2`, cfgTipos[k]?.m2)}</td>
          <td class="p-1">${numInput(`${base}.${k}.min`, cfgTipos[k]?.min)}</td>
        </tr>`
      )
      .join('')}</tbody></table></div>`;
}

function factorGrid(base, map, values) {
  return `<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">${Object.entries(map)
    .map(([k, v]) => `<div><label class="${LABEL}">Factor ${escapeHtml(v.nom)}</label>${numInput(`${base}.${k}`, values[k], 0.05)}</div>`)
    .join('')}</div>`;
}

// Tabla de precios base por opción (llaves = opciones del servicio).
function basePriceTable(base, title, values) {
  return `<div class="mt-3"><p class="${LABEL}">${title}</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">${Object.entries(values)
      .map(
        ([k, v]) => `<div class="flex items-center gap-2"><span class="flex-1 text-body-sm">${escapeHtml(k)}</span>
          <div class="w-36">${numInput(`${base}.${escapeHtml(k)}`, v, 1000)}</div>
          ${Number(v) ? '' : '<span class="text-[10px] text-tertiary w-16">sin precio</span>'}</div>`
      )
      .join('')}</div></div>`;
}

function factorList(base, values) {
  return `<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3">${Object.entries(values)
    .map(([k, v]) => `<div><label class="${LABEL}">Factor ${escapeHtml(k)}</label>${numInput(`${base}.${escapeHtml(k)}`, v, 0.05)}</div>`)
    .join('')}</div>`;
}

function fieldGrid(items) {
  return `<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">${items
    .map(([path, label, value, step]) => `<div><label class="${LABEL}">${label}</label>${numInput(path, value, step)}</div>`)
    .join('')}</div>`;
}

export async function mount(container, ctx) {
  const canEdit = ['admin', 'coordinador'].includes(ctx.user?.role);
  let config = null;

  container.innerHTML = `
    <div class="mb-gutter flex justify-between items-end flex-wrap gap-gutter">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface mb-base">Plantillas y tarifas</h2>
        <p class="text-body-md font-body-md text-on-surface-variant">Lo que usan las plantillas de cotización para sugerir precios. Cambie una tarifa cuando suban los costos: aplica para todo el equipo.</p>
      </div>
      <div class="flex gap-2" id="pt-actions"></div>
    </div>
    <div id="pt-root" class="flex flex-col gap-gutter"></div>`;
  const root = container.querySelector('#pt-root');
  const actions = container.querySelector('#pt-actions');

  async function load() {
    try {
      config = (await ctx.api.get('/api/quote-templates')).config;
    } catch (err) {
      root.innerHTML = `<p class="text-error">${escapeHtml(err.message)}</p>`;
      return;
    }
    render();
  }

  function catalogHtml() {
    return config.catalogo
      .map(
        (g, gi) => `<div class="mb-4">
          <div class="flex items-center gap-2 mb-1">
            <input data-cat="${gi}" value="${escapeHtml(g.cat)}" class="${TXT} font-bold max-w-sm" />
            <button type="button" data-add-item="${gi}" class="btn btn-ghost text-[12px]"><span class="material-symbols-outlined">add</span>Producto</button>
          </div>
          ${g.items
            .map(
              (x, ii) => `<div class="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_120px_32px] gap-2 py-1 border-t border-outline-variant/60 items-center">
                <input data-item="${gi}:${ii}" data-f="t" value="${escapeHtml(x.t)}" placeholder="Producto" class="${TXT}" />
                <input data-item="${gi}:${ii}" data-f="d" value="${escapeHtml(x.d)}" placeholder="Descripción" class="${TXT}" />
                <input data-item="${gi}:${ii}" data-f="p" type="number" step="1000" min="0" value="${x.p}" class="${NUM}" />
                <button type="button" data-del-item="${gi}:${ii}" class="btn btn-icon" aria-label="Quitar"><span class="material-symbols-outlined text-[18px]">delete</span></button>
              </div>`
            )
            .join('')}
        </div>`
      )
      .join('');
  }

  function render() {
    const serviceTitle = (slug) => SERVICES.find((s) => s.slug === slug)?.title || 'Cualquier servicio';
    root.innerHTML = `
      ${card(
        'Plantillas disponibles',
        'Se usan en Cotizaciones › Nueva cotización, paso 3. Cada línea calculada queda ligada al cliente, al embudo y al PDF de VELARA.',
        `<div class="grid grid-cols-1 md:grid-cols-2 gap-3">${TEMPLATES.map(
          (t) => `<div class="border border-outline-variant rounded-lg p-3 flex gap-3">
            <span class="material-symbols-outlined text-on-surface-variant">${t.icon}</span>
            <div><p class="font-bold text-on-surface text-body-sm">${escapeHtml(t.label)}</p>
            <p class="text-[12px] text-on-surface-variant">${escapeHtml(t.desc)}</p>
            <p class="text-[11px] text-on-surface-variant mt-1">Servicio: <b>${escapeHtml(serviceTitle(t.service_slug))}</b></p></div>
          </div>`
        ).join('')}</div>`
      )}

      ${card(
        'Automotriz: forros, tapizado y sillines',
        'Precio sugerido = precio base de la opción × factor material × factor vehículo + extras. Mientras una opción esté en $0, la plantilla pide escribir el precio a mano.',
        `${basePriceTable('automotriz.forrosCarros', 'Forros para carro · precio base', config.automotriz.forrosCarros)}
         ${basePriceTable('automotriz.tapizado', 'Tapizado automotriz · precio base', config.automotriz.tapizado)}
         ${basePriceTable('automotriz.motos', 'Sillín de moto · precio base', config.automotriz.motos)}
         <p class="${LABEL} mt-4">Factor por material (1 = sin cambio)</p>
         ${factorList('automotriz.materiales', config.automotriz.materiales)}
         <p class="${LABEL} mt-4">Factor por tipo de vehículo (forros y tapizado)</p>
         ${factorList('automotriz.vehiculos', config.automotriz.vehiculos)}
         ${fieldGrid([
           ['automotriz.bordado', 'Bordado (+$ c/u)', config.automotriz.bordado, 1000],
           ['automotriz.costuraColor', 'Costura de contraste (+$)', config.automotriz.costuraColor, 1000],
           ['automotriz.espumaNueva', 'Espuma nueva, moto (+$)', config.automotriz.espumaNueva, 1000],
           ['automotriz.antideslizante', 'Antideslizante, moto (+$)', config.automotriz.antideslizante, 1000],
         ])}`
      )}

      ${card(
        'Carpas de fachada',
        'Precio sugerido = máx(mínimo, fijo + m² × área) × factor de lona + logos; menos el % indicado si no lleva instalación. Base: lona PVC, instalada en Barranquilla.',
        `${tarifaTable('carpas.tipos', CARPA_TIPOS, config.carpas.tipos)}
         ${factorGrid('carpas.lonas', CARPA_LONAS, config.carpas.lonas)}
         ${fieldGrid([
           ['carpas.logo', 'Precio por logo', config.carpas.logo, 1000],
           ['carpas.sinInstalacion', 'Descuento sin instalación (%)', config.carpas.sinInstalacion, 1],
         ])}`
      )}

      ${card(
        'Forros a medida',
        'Área: capuchón = tapa + 4 lados; plano = largo × ancho. Los factores multiplican; los extras en pesos se suman por unidad.',
        `${tarifaTable('forros.tipos', FORRO_TIPOS, config.forros.tipos)}
         ${factorGrid('forros.materiales', FORRO_MATERIALES, config.forros.materiales)}
         ${fieldGrid([
           ['forros.acolchado', 'Factor acolchado', config.forros.acolchado, 0.05],
           ['forros.sellado', 'Factor electrosellado', config.forros.sellado, 0.05],
           ['forros.cremallera', 'Cremallera (+$)', config.forros.cremallera, 1000],
           ['forros.visor', 'Visor vinilo (+$)', config.forros.visor, 1000],
           ['forros.bordado', 'Logo bordado (+$)', config.forros.bordado, 1000],
           ['forros.impresion', 'Logo impreso (+$)', config.forros.impresion, 1000],
         ])}`
      )}

      ${card(
        'Generales',
        '',
        fieldGrid([
          ['transporte', 'Transporte por defecto', config.transporte, 10000],
          ['impresionLogo', 'Impresión de logo (1 tinta)', config.impresionLogo, 10000],
          ['redondeo', 'Redondear precios a', config.redondeo, 1000],
          ['costeo.margen', 'Margen del costeo (0–0,95)', config.costeo.margen, 0.01],
        ])
      )}

      ${card('Catálogo de forros', 'Precios unitarios antes de IVA. Aparecen en la plantilla "Catálogo de forros".', `<div id="pt-catalog">${catalogHtml()}</div>
        <button type="button" id="pt-add-cat" class="btn btn-ghost text-[12px]"><span class="material-symbols-outlined">add</span>Categoría</button>`)}

      ${card(
        'Políticas de fabricación',
        'Salen en el PDF de las cotizaciones de carpas y forros, bajo "Políticas y condiciones". Una por línea. Las demás cotizaciones usan las condiciones de Configuración › Ajustes.',
        `<textarea id="pt-politicas" rows="7" class="${TXT}">${escapeHtml(config.politicasFabricacion.join('\n'))}</textarea>`
      )}

      ${card(
        'Observaciones rápidas',
        'Botones que agregan texto a "Notas y condiciones" en Nueva cotización. Una por línea.',
        `<textarea id="pt-obs" rows="6" class="${TXT}">${escapeHtml(config.observaciones.join('\n'))}</textarea>`
      )}`;

    if (!canEdit) {
      root.querySelectorAll('input, textarea, button').forEach((el) => (el.disabled = true));
      actions.innerHTML = '<span class="text-[12px] text-on-surface-variant">Solo coordinador o administrador puede cambiar las tarifas.</span>';
      return;
    }
    actions.innerHTML = `
      <button type="button" id="pt-reset" class="btn btn-secondary"><span class="material-symbols-outlined">restart_alt</span>Restaurar valores originales</button>
      <button type="button" id="pt-save" class="btn btn-primary"><span class="material-symbols-outlined">save</span>Guardar</button>`;
    actions.querySelector('#pt-save').addEventListener('click', save);
    actions.querySelector('#pt-reset').addEventListener('click', reset);
    wireCatalog();
  }

  // Lee el catálogo de los campos actuales (para no perder lo escrito al
  // agregar o quitar una fila).
  function readCatalog() {
    root.querySelectorAll('[data-cat]').forEach((el) => (config.catalogo[Number(el.dataset.cat)].cat = el.value));
    root.querySelectorAll('[data-item]').forEach((el) => {
      const [gi, ii] = el.dataset.item.split(':').map(Number);
      const item = config.catalogo[gi].items[ii];
      item[el.dataset.f] = el.dataset.f === 'p' ? Number(el.value) || 0 : el.value;
    });
  }

  function repaintCatalog() {
    root.querySelector('#pt-catalog').innerHTML = catalogHtml();
    wireCatalog();
  }

  function wireCatalog() {
    root.querySelectorAll('[data-add-item]').forEach((btn) =>
      btn.addEventListener('click', () => {
        readCatalog();
        config.catalogo[Number(btn.dataset.addItem)].items.push({ t: '', d: '', p: 0 });
        repaintCatalog();
      })
    );
    root.querySelectorAll('[data-del-item]').forEach((btn) =>
      btn.addEventListener('click', () => {
        readCatalog();
        const [gi, ii] = btn.dataset.delItem.split(':').map(Number);
        config.catalogo[gi].items.splice(ii, 1);
        if (!config.catalogo[gi].items.length) config.catalogo.splice(gi, 1);
        repaintCatalog();
      })
    );
    const addCat = root.querySelector('#pt-add-cat');
    if (addCat && !addCat.dataset.wired) {
      addCat.dataset.wired = '1';
      addCat.addEventListener('click', () => {
        readCatalog();
        config.catalogo.push({ cat: 'Nueva categoría', items: [{ t: '', d: '', p: 0 }] });
        repaintCatalog();
      });
    }
  }

  async function save() {
    const next = JSON.parse(JSON.stringify(config));
    root.querySelectorAll('[data-path]').forEach((el) => {
      if (el.value !== '') setPath(next, el.dataset.path, Number(el.value));
    });
    readCatalog();
    next.catalogo = config.catalogo
      .map((g) => ({ cat: g.cat.trim() || 'Sin categoría', items: g.items.filter((x) => String(x.t).trim()).map((x) => ({ t: x.t.trim(), d: String(x.d || '').trim(), p: Number(x.p) || 0 })) }))
      .filter((g) => g.items.length);
    const lines = (id) => root.querySelector(id).value.split('\n').map((s) => s.trim()).filter(Boolean);
    next.politicasFabricacion = lines('#pt-politicas');
    next.observaciones = lines('#pt-obs');
    if (getPath(next, 'costeo.margen') >= 1) {
      ctx.toast('El margen debe ser menor que 1 (ej. 0,48 = 48 %)', 'error');
      return;
    }
    const btn = actions.querySelector('#pt-save');
    btn.disabled = true;
    try {
      config = (await ctx.api.put('/api/quote-templates', { config: next })).config;
      ctx.toast('Tarifas guardadas', 'success');
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
      btn.disabled = false;
    }
  }

  async function reset() {
    const ok = await confirmModal({
      title: 'Restaurar valores originales',
      message: 'Se pierden las tarifas, el catálogo y las políticas que haya cambiado. ¿Continuar?',
      confirmLabel: 'Restaurar',
      danger: true,
    });
    if (!ok) return;
    try {
      config = (await ctx.api.post('/api/quote-templates/reset')).config;
      ctx.toast(`Valores originales restaurados`, 'success');
      render();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  await load();
}
