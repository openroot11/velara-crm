import { escapeHtml, formatMoney } from '../utils.js';
import { tabBarHtml, paintTabBar } from '../components/ui.js';
import { openModal, confirmModal } from '../components/modal.js';

// Cotizaciones › Catálogo (estilo Odoo): productos, categorías y plantillas
// de cotización. Cada producto pertenece a una categoría; la categoría trae
// a la cotización su encabezado, su garantía y su tiempo de entrega (ver
// server/routes/productCategories.js). Las plantillas se arman desde Nueva
// cotización ("Guardar como plantilla") y aquí se renombran o se borran.

const INPUT = 'w-full p-2 border border-outline-variant rounded-md outline-none focus:border-outline focus:ring-2 focus:ring-outline/20 text-body-sm bg-surface';
const LABEL = 'block text-[10px] font-label-bold uppercase tracking-wide text-on-surface-variant mb-1';

const TABS = [
  { key: 'productos', label: 'Productos', icon: 'inventory_2' },
  { key: 'categorias', label: 'Categorías', icon: 'category' },
  { key: 'plantillas', label: 'Plantillas', icon: 'library_books' },
];

function badge(text, cls) {
  return `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${cls}">${escapeHtml(text)}</span>`;
}

export async function mount(container, ctx) {
  const canEdit = ['admin', 'coordinador'].includes(ctx.user?.role);
  let tab = ['productos', 'categorias', 'plantillas'].includes(ctx.routeParams.get('tab')) ? ctx.routeParams.get('tab') : 'productos';
  let categories = [];
  let products = [];
  let presets = [];
  let filterCat = '';
  let filterText = '';

  container.innerHTML = `
    <div class="mb-gutter flex justify-between items-end flex-wrap gap-gutter">
      <div>
        <h2 class="text-headline-lg font-headline-lg text-on-surface mb-base">Catálogo</h2>
        <p class="text-body-md font-body-md text-on-surface-variant">Productos con su precio y descripción, agrupados por categoría. Cada categoría pone en la cotización su encabezado, su garantía y su tiempo de entrega.</p>
      </div>
      <div class="flex gap-2 flex-wrap" id="ct-actions"></div>
    </div>
    ${tabBarHtml(TABS, tab)}
    <div id="ct-root"></div>`;
  const root = container.querySelector('#ct-root');
  const actions = container.querySelector('#ct-actions');

  container.querySelectorAll('[role="tablist"] [data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      paintTabBar(container, tab);
      render();
    })
  );

  async function load() {
    try {
      [categories, products, presets] = await Promise.all([
        ctx.api.get('/api/product-categories?all=1'),
        ctx.api.get('/api/products?all=1'),
        ctx.api.get('/api/quote-presets?all=1'),
      ]);
    } catch (err) {
      root.innerHTML = `<p class="text-error">${escapeHtml(err.message)}</p>`;
      return;
    }
    render();
  }

  function render() {
    if (tab === 'categorias') renderCategories();
    else if (tab === 'plantillas') renderPresets();
    else renderProducts();
  }

  // ---- productos ---------------------------------------------------------------
  function renderProducts() {
    const pending = products.filter((p) => p.needs_review && p.active).length;
    actions.innerHTML = canEdit
      ? `${products.length ? '' : '<button type="button" id="ct-import" class="btn btn-secondary"><span class="material-symbols-outlined">download</span>Traer catálogo anterior</button>'}
         <button type="button" id="ct-new" class="btn btn-primary"><span class="material-symbols-outlined">add</span>Nuevo producto</button>`
      : '';
    actions.querySelector('#ct-new')?.addEventListener('click', () => openProduct(null));
    actions.querySelector('#ct-import')?.addEventListener('click', importLegacy);

    const term = filterText.trim().toLowerCase();
    const visible = products.filter(
      (p) =>
        (!filterCat || String(p.category_id || '') === filterCat) &&
        (!term || `${p.name} ${p.description || ''}`.toLowerCase().includes(term))
    );
    const groups = [...categories.map((c) => ({ id: c.id, name: c.name })), { id: null, name: 'Sin categoría' }]
      .map((g) => ({ ...g, items: visible.filter((p) => (p.category_id || null) === g.id) }))
      .filter((g) => g.items.length);

    root.innerHTML = `
      ${
        pending
          ? `<div class="mb-4 p-3 rounded-lg bg-tertiary-container text-on-tertiary-container text-body-sm flex items-start gap-2">
               <span class="material-symbols-outlined text-[18px]">rule</span>
               <span><b>${pending} producto(s) por revisar.</b> Vienen del cotizador anterior: no salen en Nueva cotización hasta que confirmes su nombre, precio y descripción.</span>
             </div>`
          : ''
      }
      <div class="flex gap-3 flex-wrap mb-4">
        <div class="relative flex-1 min-w-[220px] max-w-md">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none">search</span>
          <input id="ct-q" type="text" value="${escapeHtml(filterText)}" placeholder="Buscar producto…" class="${INPUT} pl-10" />
        </div>
        <select id="ct-cat" class="${INPUT} w-auto">
          <option value="">Todas las categorías</option>
          ${categories.map((c) => `<option value="${c.id}" ${String(c.id) === filterCat ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      ${
        groups.length
          ? groups
              .map(
                (g) => `
            <section class="bg-surface rounded-xl border border-outline-variant shadow-sm mb-gutter overflow-hidden">
              <div class="px-5 py-3 border-b border-outline-variant flex items-center gap-2">
                <span class="material-symbols-outlined text-[18px] text-on-surface-variant">category</span>
                <h3 class="text-body-md font-bold text-on-surface">${escapeHtml(g.name)}</h3>
                <span class="text-[11px] text-on-surface-variant">${g.items.length}</span>
              </div>
              <div class="divide-y divide-outline-variant">
                ${g.items
                  .map(
                    (p) => `
                  <div class="px-5 py-3 flex items-start gap-3 ${canEdit ? 'cursor-pointer hover:bg-surface-container-low' : ''} ${p.active ? '' : 'opacity-60'}" data-pid="${p.id}">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p class="font-bold text-on-surface text-body-sm">${escapeHtml(p.name)}</p>
                        ${p.needs_review ? badge('Por revisar', 'bg-tertiary-container text-on-tertiary-container') : ''}
                        ${p.active ? '' : badge('Inactivo', 'bg-surface-container-high text-on-surface-variant')}
                      </div>
                      ${p.description ? `<p class="text-[12px] text-on-surface-variant mt-0.5 line-clamp-2">${escapeHtml(p.description)}</p>` : ''}
                    </div>
                    <div class="text-right shrink-0">
                      <p class="font-bold text-on-surface text-body-sm">${p.price ? formatMoney(p.price) : '<span class="text-tertiary">Sin precio</span>'}</p>
                      <p class="text-[11px] text-on-surface-variant">por ${escapeHtml((p.unit || 'Unidad').toLowerCase())}</p>
                    </div>
                    ${
                      canEdit && p.needs_review && p.active
                        ? `<button type="button" data-confirm="${p.id}" class="btn btn-secondary text-[11px] shrink-0"><span class="material-symbols-outlined">check</span>Confirmar</button>`
                        : ''
                    }
                  </div>`
                  )
                  .join('')}
              </div>
            </section>`
              )
              .join('')
          : `<div class="bg-surface rounded-xl border border-outline-variant p-8 text-center text-on-surface-variant text-body-sm">
               ${products.length ? 'Ningún producto coincide con la búsqueda.' : 'Todavía no hay productos. Crea el primero con «Nuevo producto».'}
             </div>`
      }`;

    const q = root.querySelector('#ct-q');
    q.addEventListener('input', () => {
      filterText = q.value;
      const pos = q.selectionStart;
      renderProducts();
      const again = root.querySelector('#ct-q');
      again.focus();
      again.setSelectionRange(pos, pos);
    });
    root.querySelector('#ct-cat').addEventListener('change', (e) => {
      filterCat = e.target.value;
      renderProducts();
    });
    if (canEdit) {
      root.querySelectorAll('[data-pid]').forEach((row) =>
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-confirm]')) return;
          openProduct(products.find((p) => p.id === Number(row.dataset.pid)));
        })
      );
      root.querySelectorAll('[data-confirm]').forEach((b) =>
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const updated = await ctx.api.patch(`/api/products/${b.dataset.confirm}`, { needs_review: false });
            products = products.map((p) => (p.id === updated.id ? updated : p));
            ctx.toast('Producto confirmado: ya sale en Nueva cotización', 'success');
            renderProducts();
          } catch (err) {
            ctx.toast(err.message, 'error');
            b.disabled = false;
          }
        })
      );
    }
  }

  async function importLegacy() {
    const ok = await confirmModal({
      title: 'Traer catálogo anterior',
      message:
        'Se agregan los productos de la lista de precios que tenía el cotizador (forros de sonido, estuches, colchonetas…). Vienen del cotizador de la empresa de referencia, así que entran marcados «Por revisar» en Forros de protección para equipos y no salen en las cotizaciones hasta que los confirmes.',
      confirmLabel: 'Traer productos',
    });
    if (!ok) return;
    try {
      const r = await ctx.api.post('/api/products/import-legacy');
      ctx.toast(`${r.added} productos agregados por revisar${r.skipped ? ` (${r.skipped} ya existían)` : ''}`, 'success');
      await load();
    } catch (err) {
      ctx.toast(err.message, 'error');
    }
  }

  function openProduct(product) {
    openModal({
      title: product ? 'Editar producto' : 'Nuevo producto',
      render(body, { close }) {
        body.innerHTML = `
          <div class="flex flex-col gap-4">
            ${
              product?.needs_review
                ? '<p class="p-2.5 rounded-md bg-tertiary-container text-on-tertiary-container text-[12px]">Viene del cotizador anterior. Al guardar queda confirmado y empieza a salir en Nueva cotización.</p>'
                : ''
            }
            <div><label class="${LABEL}">Nombre *</label><input id="pf-name" class="${INPUT}" value="${escapeHtml(product?.name || '')}" /></div>
            <div><label class="${LABEL}">Categoría</label>
              <select id="pf-cat" class="${INPUT}">
                <option value="">Sin categoría</option>
                ${categories
                  .filter((c) => c.active || c.id === product?.category_id)
                  .map((c) => `<option value="${c.id}" ${c.id === product?.category_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
                  .join('')}
              </select>
              <p class="text-[11px] text-on-surface-variant mt-1">De la categoría salen el encabezado, la garantía y el tiempo de entrega en la cotización.</p>
            </div>
            <div><label class="${LABEL}">Descripción de venta</label>
              <textarea id="pf-desc" rows="4" class="${INPUT} resize-y" placeholder="Material, medidas, lo que incluye… Se copia a la cotización al agregar el producto.">${escapeHtml(product?.description || '')}</textarea></div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="${LABEL}">Precio (antes de IVA)</label><input id="pf-price" type="number" min="0" step="1000" class="${INPUT} text-right" value="${product ? Math.round(product.price || 0) : ''}" /></div>
              <div><label class="${LABEL}">Unidad</label><input id="pf-unit" class="${INPUT}" list="pf-units" value="${escapeHtml(product?.unit || 'Unidad')}" />
                <datalist id="pf-units"><option value="Unidad"><option value="Juego"><option value="Metro"><option value="m²"><option value="Servicio"></datalist></div>
            </div>
            ${
              product
                ? `<label class="flex items-center gap-2 text-body-sm"><input id="pf-active" type="checkbox" ${product.active ? 'checked' : ''} /> Activo (sale en el buscador de la cotización)</label>`
                : ''
            }
            <div class="flex justify-end gap-2 pt-2">
              <button type="button" id="pf-cancel" class="btn btn-ghost">Cancelar</button>
              <button type="button" id="pf-save" class="btn btn-primary"><span class="material-symbols-outlined">save</span>Guardar</button>
            </div>
          </div>`;
        body.querySelector('#pf-cancel').addEventListener('click', close);
        body.querySelector('#pf-save').addEventListener('click', async (e) => {
          const payload = {
            name: body.querySelector('#pf-name').value,
            category_id: body.querySelector('#pf-cat').value || null,
            description: body.querySelector('#pf-desc').value,
            price: Number(body.querySelector('#pf-price').value) || 0,
            unit: body.querySelector('#pf-unit').value,
          };
          if (!payload.name.trim()) {
            ctx.toast('Ponle un nombre al producto', 'error');
            return;
          }
          if (product) {
            payload.active = body.querySelector('#pf-active').checked;
            payload.needs_review = false;
          }
          e.currentTarget.disabled = true;
          try {
            const saved = product ? await ctx.api.patch(`/api/products/${product.id}`, payload) : await ctx.api.post('/api/products', payload);
            products = product ? products.map((p) => (p.id === saved.id ? saved : p)) : [...products, saved];
            ctx.toast(product ? 'Producto guardado' : 'Producto creado', 'success');
            close();
            renderProducts();
          } catch (err) {
            ctx.toast(err.message, 'error');
            e.currentTarget.disabled = false;
          }
        });
      },
    });
  }

  // ---- categorías -------------------------------------------------------------
  function renderCategories() {
    actions.innerHTML = canEdit ? '<button type="button" id="ct-new-cat" class="btn btn-primary"><span class="material-symbols-outlined">add</span>Nueva categoría</button>' : '';
    actions.querySelector('#ct-new-cat')?.addEventListener('click', async () => {
      try {
        const c = await ctx.api.post('/api/product-categories', { name: 'Nueva categoría' });
        categories = [...categories, c];
        renderCategories();
        root.querySelector(`[data-cat="${c.id}"] [data-f="name"]`)?.select();
      } catch (err) {
        ctx.toast(err.message, 'error');
      }
    });
    const ro = canEdit ? '' : 'readonly';
    root.innerHTML = `
      <p class="text-body-sm text-on-surface-variant mb-4">Al agregar un producto a una cotización, se abre sola la sección de su categoría con este encabezado. La garantía y el tiempo de entrega salen en el PDF, uno por cada categoría cotizada.</p>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-gutter">
        ${categories
          .map(
            (c) => `
          <section data-cat="${c.id}" class="bg-surface rounded-xl border border-outline-variant shadow-sm p-5 ${c.active ? '' : 'opacity-60'}">
            <div class="flex items-center gap-2 mb-3">
              <input data-f="name" ${ro} value="${escapeHtml(c.name)}" class="${INPUT} font-bold" />
              <span class="text-[11px] text-on-surface-variant whitespace-nowrap">${c.product_count} producto(s)</span>
            </div>
            <label class="${LABEL}">Encabezado (abre la sección en la cotización)</label>
            <textarea data-f="header" ${ro} rows="3" class="${INPUT} resize-y mb-3">${escapeHtml(c.header || '')}</textarea>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label class="${LABEL}">Garantía</label><input data-f="warranty" ${ro} value="${escapeHtml(c.warranty || '')}" placeholder="6 meses en costura y cierres" class="${INPUT}" /></div>
              <div><label class="${LABEL}">Tiempo de entrega</label><input data-f="lead_time" ${ro} value="${escapeHtml(c.lead_time || '')}" placeholder="3 a 7 días" class="${INPUT}" /></div>
            </div>
            ${
              canEdit
                ? `<div class="flex items-center justify-between gap-2 mt-4">
                     <label class="flex items-center gap-2 text-[12px] text-on-surface-variant"><input data-f="active" type="checkbox" ${c.active ? 'checked' : ''} /> Activa</label>
                     <button type="button" data-save-cat class="btn btn-secondary text-[12px]"><span class="material-symbols-outlined">save</span>Guardar</button>
                   </div>`
                : ''
            }
          </section>`
          )
          .join('')}
      </div>`;
    root.querySelectorAll('[data-save-cat]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-cat]');
        const f = (k) => card.querySelector(`[data-f="${k}"]`);
        btn.disabled = true;
        try {
          const saved = await ctx.api.patch(`/api/product-categories/${card.dataset.cat}`, {
            name: f('name').value,
            header: f('header').value,
            warranty: f('warranty').value,
            lead_time: f('lead_time').value,
            active: f('active').checked,
          });
          categories = categories.map((c) => (c.id === saved.id ? saved : c));
          ctx.toast('Categoría guardada', 'success');
          renderCategories();
        } catch (err) {
          ctx.toast(err.message, 'error');
          btn.disabled = false;
        }
      })
    );
  }

  // ---- plantillas -------------------------------------------------------------
  function renderPresets() {
    actions.innerHTML = '<a href="#/cotizar" class="btn btn-secondary inline-flex"><span class="material-symbols-outlined">add_notes</span>Ir a Nueva cotización</a>';
    root.innerHTML = `
      <p class="text-body-sm text-on-surface-variant mb-4">Una plantilla es un grupo de líneas listo (productos, secciones y notas). Se arma en Nueva cotización con «Guardar como plantilla» y se aplica de un clic. Los productos del catálogo llegan siempre con su precio de hoy.</p>
      ${
        presets.length
          ? `<div class="grid grid-cols-1 xl:grid-cols-2 gap-gutter">${presets
              .map(
                (p) => `
            <section data-preset="${p.id}" class="bg-surface rounded-xl border border-outline-variant shadow-sm p-5">
              <div class="flex items-start gap-2 mb-2">
                <div class="flex-1 min-w-0">
                  <h3 class="text-body-md font-bold text-on-surface">${escapeHtml(p.name)}</h3>
                  ${p.description ? `<p class="text-[12px] text-on-surface-variant">${escapeHtml(p.description)}</p>` : ''}
                </div>
                <span class="text-[11px] text-on-surface-variant whitespace-nowrap">${p.product_count} producto(s)</span>
              </div>
              <ul class="text-[12px] text-on-surface mb-3 space-y-0.5">
                ${p.lines
                  .slice(0, 8)
                  .map((l) =>
                    l.line_type === 'section'
                      ? `<li class="font-bold mt-1">${escapeHtml(l.product_name)}</li>`
                      : l.line_type === 'note'
                        ? `<li class="text-on-surface-variant italic">${escapeHtml(l.description)}</li>`
                        : `<li class="flex justify-between gap-2"><span class="truncate">${l.qty} × ${escapeHtml(l.product_name)}</span><span class="text-on-surface-variant shrink-0">${formatMoney(l.qty * l.price_unit * (1 - (l.discount_percent || 0) / 100))}</span></li>`
                  )
                  .join('')}
                ${p.lines.length > 8 ? `<li class="text-on-surface-variant">y ${p.lines.length - 8} línea(s) más…</li>` : ''}
              </ul>
              ${
                canEdit
                  ? `<div class="flex justify-end gap-2">
                       <button type="button" data-rename="${p.id}" class="btn btn-ghost text-[12px]"><span class="material-symbols-outlined">edit</span>Renombrar</button>
                       <button type="button" data-del-preset="${p.id}" class="btn btn-ghost text-[12px] text-error"><span class="material-symbols-outlined">delete</span>Borrar</button>
                     </div>`
                  : ''
              }
            </section>`
              )
              .join('')}</div>`
          : '<div class="bg-surface rounded-xl border border-outline-variant p-8 text-center text-on-surface-variant text-body-sm">Todavía no hay plantillas. Arma una cotización y usa «Guardar como plantilla».</div>'
      }`;
    root.querySelectorAll('[data-rename]').forEach((b) =>
      b.addEventListener('click', () => {
        const preset = presets.find((p) => p.id === Number(b.dataset.rename));
        openModal({
          title: 'Plantilla',
          render(body, { close }) {
            body.innerHTML = `
              <div class="flex flex-col gap-4">
                <div><label class="${LABEL}">Nombre *</label><input id="pp-name" class="${INPUT}" value="${escapeHtml(preset.name)}" /></div>
                <div><label class="${LABEL}">Descripción</label><input id="pp-desc" class="${INPUT}" value="${escapeHtml(preset.description || '')}" /></div>
                <div class="flex justify-end gap-2"><button type="button" id="pp-save" class="btn btn-primary">Guardar</button></div>
              </div>`;
            body.querySelector('#pp-save').addEventListener('click', async () => {
              try {
                const saved = await ctx.api.patch(`/api/quote-presets/${preset.id}`, {
                  name: body.querySelector('#pp-name').value,
                  description: body.querySelector('#pp-desc').value,
                });
                presets = presets.map((p) => (p.id === saved.id ? saved : p));
                close();
                renderPresets();
              } catch (err) {
                ctx.toast(err.message, 'error');
              }
            });
          },
        });
      })
    );
    root.querySelectorAll('[data-del-preset]').forEach((b) =>
      b.addEventListener('click', async () => {
        const preset = presets.find((p) => p.id === Number(b.dataset.delPreset));
        const ok = await confirmModal({
          title: 'Borrar plantilla',
          message: `¿Borrar la plantilla «${preset.name}»? Las cotizaciones que ya se hicieron con ella no cambian.`,
          confirmLabel: 'Borrar',
          danger: true,
        });
        if (!ok) return;
        try {
          await ctx.api.del(`/api/quote-presets/${preset.id}`);
          presets = presets.filter((p) => p.id !== preset.id);
          renderPresets();
        } catch (err) {
          ctx.toast(err.message, 'error');
        }
      })
    );
  }

  await load();
}
