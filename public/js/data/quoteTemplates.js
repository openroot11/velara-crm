// Plantillas de cotización según lo que se va a fabricar. Cada plantilla
// es una calculadora: pide medidas y opciones, sugiere un precio con las
// tarifas de Cotizaciones › Plantillas y tarifas (server/quoteTemplates.js)
// y agrega la línea a la cotización del CRM. La línea queda editable y se
// guarda como cualquier otra (quotation_lines), así cuenta en el embudo, el
// informe y el PDF de VELARA.
//
// Para agregar una plantilla nueva: sumarla a TEMPLATES y darle un
// formulario en components/quoteTemplateModal.js.

export const TEMPLATES = [
  {
    key: 'forro-carro',
    label: 'Forros para carro',
    icon: 'directions_car',
    service_slug: 'forros-para-carros',
    auto: 'forrosCarros',
    desc: 'Forros a la medida del vehículo: completo, delanteros, banca trasera o juego completo.',
  },
  {
    key: 'tapizado-auto',
    label: 'Tapizado automotriz',
    icon: 'airline_seat_recline_extra',
    service_slug: 'tapizado-automotriz',
    auto: 'tapizado',
    desc: 'Sillas, paneles, cielos, timones y consolas, o flotas de trabajo.',
  },
  {
    key: 'sillin-moto',
    label: 'Sillín de moto',
    icon: 'two_wheeler',
    service_slug: 'tapizado-de-motos',
    auto: 'motos',
    desc: 'Sillín individual, biplaza o baúl, con espuma nueva y antideslizante opcionales.',
  },
  {
    key: 'carpa',
    label: 'Carpa de fachada',
    icon: 'storefront',
    service_slug: 'carpas-para-negocio',
    desc: 'Toldos fijos o recogibles, cerchadas, curvas, tipo concha o solo lona. Precio por área y tipo de lona.',
  },
  {
    key: 'forro',
    label: 'Forro a medida',
    icon: 'checkroom',
    service_slug: 'forros',
    desc: 'Capuchón (largo × ancho × alto) o forro plano / funda. Precio por área de material y extras.',
  },
  {
    key: 'catalogo',
    label: 'Catálogo de forros',
    icon: 'menu_book',
    service_slug: 'forros',
    desc: 'Forros y estuches con precio fijo: sonido, industrial, colchonetas, adicionales.',
  },
  {
    key: 'costeo',
    label: 'Costeo especial',
    icon: 'calculate',
    service_slug: null,
    desc: 'Para productos fuera de catálogo: materiales + mano de obra ÷ (1 − margen).',
  },
];

export function findTemplate(key) {
  return TEMPLATES.find((t) => t.key === key) || null;
}

export const CARPA_TIPOS = {
  brazos: { nom: 'Brazos fija (toldo fijo)', titulo: 'Carpa de brazos para fachada' },
  recogible: { nom: 'Brazos recogible / enrollable', titulo: 'Carpa de brazos recogible para fachada' },
  cerchada: { nom: 'Cerchada (tubo cuadrado)', titulo: 'Carpa cerchada para fachada' },
  curva: { nom: 'Cerchada curva', titulo: 'Carpa cerchada curva para fachada' },
  concha: { nom: 'Tipo concha (por unidad)', titulo: 'Carpa de fachada tipo concha' },
  lona: { nom: 'Solo lona (reemplazo)', titulo: 'Lona para carpa de fachada' },
};

export const CARPA_LONAS = {
  pvc: { nom: 'PVC California', txt: 'lona de PVC impermeable ref. California con uniones electroselladas' },
  suntech: { nom: 'Textil Suntech', txt: 'lona textil de exterior ref. Suntech' },
  docril: { nom: 'Acrílica Docril', txt: 'lona acrílica tipo textil ref. Docril' },
  acrisum: { nom: 'Acrílica Acrisum (importada)', txt: 'lona acrílica importada ref. Acrisum' },
};

export const MATERIAL_INFO = {
  pvc: 'Lona de PVC ref. California: producto nacional, impermeable, con protección UV, anti-hongo y retardante al fuego; calibre 400 micras, 480 g/m².',
  suntech: 'Lona textil ref. Suntech: tejido de exterior semi-impermeable, con protección UV, transpirable, acabado tipo tela.',
  docril: 'Lona acrílica ref. Docril: tejido acrílico teñido en masa, alta resistencia al sol y al color, repelente al agua.',
  acrisum: 'Lona acrílica ref. Acrisum: tejido acrílico importado de alta resistencia, repelente al agua y con protección UV.',
};

export const FORRO_TIPOS = {
  capuchon: { nom: 'Capuchón a medida (L × A × H)', titulo: 'Forro tipo capuchón' },
  plano: { nom: 'Forro plano / funda (L × A)', titulo: 'Forro protector' },
};

export const FORRO_MATERIALES = {
  pvc: { nom: 'Lona PVC California', txt: 'lona de PVC impermeable ref. California' },
  arkansas: { nom: 'Tela PVC Arkansas / Tango', txt: 'tela de PVC impermeable ref. Arkansas' },
  superflex: { nom: 'PVC Superflex (tráfico pesado)', txt: 'lona de PVC reforzada de tráfico pesado ref. Superflex' },
  autoforro: { nom: 'Autoforro (PVC base algodón)', txt: 'lona autoforro (PVC con base de algodón)' },
  poliester: { nom: 'Poliéster mate / Ciclón', txt: 'lona de poliéster mate ref. Ciclón' },
  camionera: { nom: 'Lona camionera 600 micras', txt: 'lona camionera de 600 micras doble faz' },
  vinilo: { nom: 'Vinilo transparente', txt: 'vinilo transparente calibre 20' },
  cuerina: { nom: 'Cuerina', txt: 'cuerina' },
  antifluido: { nom: 'Tela antifluido', txt: 'tela antifluido' },
};

const num = (v) => Number(v) || 0;

export function roundTo(value, step) {
  const r = num(step) || 1;
  return Math.round(value / r) * r;
}

// ---- carpas -----------------------------------------------------------------

export function newCarpa() {
  return { modelo: 'brazos', lona: 'pvc', ancho: 300, proy: 150, alto: '', falda: 30, color: 'por definir', colorEst: 'blanco', tubo: '', logos: 0, instala: true, cant: 1, verMaterial: true };
}

export function carpaArea(it) {
  const alto = it.modelo === 'concha' ? num(it.alto) || num(it.proy) : num(it.proy);
  return (num(it.ancho) / 100) * (alto / 100);
}

export function carpaPrice(it, cfg) {
  const t = cfg.carpas.tipos[it.modelo];
  if (!t) return 0;
  let v = Math.max(t.min, t.fijo + t.m2 * carpaArea(it)) * (cfg.carpas.lonas[it.lona] || 1);
  v += num(it.logos) * cfg.carpas.logo;
  if (!it.instala) v *= 1 - num(cfg.carpas.sinInstalacion) / 100;
  return roundTo(v, cfg.redondeo);
}

function carpaMedida(it) {
  if (it.modelo === 'concha') return `${num(it.ancho)} × ${num(it.proy)} × ${num(it.alto)} cm`;
  return `${num(it.ancho)} × ${num(it.proy)} cm`;
}

export function carpaDescription(it) {
  const L = CARPA_LONAS[it.lona]?.txt || '';
  const col = it.color || 'por definir';
  const ce = it.colorEst || 'por definir';
  const tubo = it.tubo ? ` de ${it.tubo}` : '';
  let s = '';
  switch (it.modelo) {
    case 'brazos':
      s = `Toldo fijo de ${carpaMedida(it)}, en ${L}, color ${col}. Estructura tipo brazos en tubo redondo${tubo} con pintura electrostática color ${ce}.`;
      break;
    case 'recogible':
      s = `Toldo recogible de ${carpaMedida(it)} con sistema enrollable manual, en ${L}, color ${col}. Estructura en tubo galvanizado redondo${tubo} con pintura electrostática color ${ce}.`;
      break;
    case 'cerchada':
      s = `Carpa fija de ${carpaMedida(it)}. Estructura tipo cercha en tubería cuadrada de ${it.tubo || '1" × 1" calibre 18'} con pintura electrostática color ${ce}. Cubierta en ${L}, color ${col}.`;
      break;
    case 'curva':
      s = `Carpa curva de ${carpaMedida(it)} en tubería estructural${tubo} con pintura electrostática color ${ce}. Cubierta en ${L}, color ${col}.`;
      break;
    case 'concha':
      s = `Carpa tipo concha de ${carpaMedida(it)} en tubería redonda galvanizada de ${it.tubo || '½" C16'}, en ${L}, color ${col}.`;
      break;
    case 'lona':
      s = `Lona de reemplazo de ${carpaMedida(it)} en ${L}, color ${col}.`;
      break;
  }
  if (num(it.falda) && it.modelo !== 'concha') s += ` Incluye falda de ${num(it.falda)} cm.`;
  if (num(it.logos)) s += ` Incluye ${num(it.logos)} logo${num(it.logos) > 1 ? 's' : ''} estampado${num(it.logos) > 1 ? 's' : ''}.`;
  s += it.instala ? ' Incluye instalación.' : ' No incluye instalación.';
  if (it.verMaterial && MATERIAL_INFO[it.lona]) s += ` ${MATERIAL_INFO[it.lona]}`;
  return s;
}

export function carpaLine(it, cfg) {
  return {
    product_name: CARPA_TIPOS[it.modelo]?.titulo || 'Carpa de fachada',
    description: carpaDescription(it),
    qty: Math.max(1, num(it.cant)),
    price_unit: carpaPrice(it, cfg),
  };
}

// Datos para los campos del servicio "Carpas y toldos para negocio".
export function carpaServiceHints(it) {
  return {
    tipo: it.modelo === 'lona' ? 'Cubierta o lona' : 'Toldo de fachada',
    dimensiones: carpaMedida(it),
    material: it.lona === 'pvc' ? 'Lona PVC' : 'Tela impermeable',
  };
}

// ---- forros -----------------------------------------------------------------

export function newForro(modelo = 'capuchon') {
  return { modelo, mat: 'pvc', L: 100, A: 60, H: 80, equipo: '', color: 'por definir', acolchado: false, sellado: false, cremallera: false, visor: false, elastico: false, bordados: 0, impresos: 0, cant: 1 };
}

export function forroArea(it) {
  const L = num(it.L) / 100;
  const A = num(it.A) / 100;
  const H = num(it.H) / 100;
  return it.modelo === 'capuchon' ? L * A + 2 * H * (L + A) : L * A;
}

export function forroPrice(it, cfg) {
  const F = cfg.forros;
  const t = F.tipos[it.modelo];
  if (!t) return 0;
  let v = Math.max(t.min, t.fijo + t.m2 * forroArea(it)) * (F.materiales[it.mat] || 1);
  if (it.acolchado) v *= F.acolchado;
  if (it.sellado) v *= F.sellado;
  if (it.cremallera) v += F.cremallera;
  if (it.visor) v += F.visor;
  v += num(it.bordados) * F.bordado + num(it.impresos) * F.impresion;
  return roundTo(v, cfg.redondeo);
}

function forroMedida(it) {
  return it.modelo === 'capuchon' ? `${num(it.L)} × ${num(it.A)} × ${num(it.H)} cm` : `${num(it.L)} × ${num(it.A)} cm`;
}

export function forroDescription(it) {
  const M = FORRO_MATERIALES[it.mat]?.txt || '';
  const ex = [];
  if (it.acolchado) ex.push('acolchado con jumbolón de 10 mm');
  if (it.sellado) ex.push('uniones electroselladas en alta frecuencia');
  if (it.cremallera) ex.push('cremallera en una arista para fácil colocación');
  if (it.visor) ex.push('visor en vinilo transparente');
  if (it.elastico) ex.push('elástico inferior para mejor ajuste');
  if (num(it.bordados)) ex.push(`${num(it.bordados)} logo${num(it.bordados) > 1 ? 's' : ''} bordado${num(it.bordados) > 1 ? 's' : ''}`);
  if (num(it.impresos)) ex.push(`${num(it.impresos)} logo${num(it.impresos) > 1 ? 's' : ''} en impresión digital full color`);
  const para = it.equipo ? ` para ${it.equipo}` : '';
  const base = it.modelo === 'capuchon' ? 'Forro tipo capuchón' : 'Forro / funda protectora';
  const ribete = it.modelo === 'capuchon' ? ', confeccionado con ribete' : '';
  return `${base}${para} de ${forroMedida(it)}, en ${M}, color ${it.color || 'por definir'}${ribete}.${ex.length ? ` Incluye ${ex.join(', ')}.` : ''}`;
}

export function forroLine(it, cfg) {
  const titulo = FORRO_TIPOS[it.modelo]?.titulo || 'Forro';
  return {
    product_name: it.equipo ? `${titulo} para ${it.equipo}` : titulo,
    description: forroDescription(it),
    qty: Math.max(1, num(it.cant)),
    price_unit: forroPrice(it, cfg),
  };
}

export function forroServiceHints(it) {
  return {
    tipo_mueble: it.equipo || (it.modelo === 'capuchon' ? 'Equipo (capuchón a medida)' : 'Forro plano / funda'),
    piezas: forroMedida(it),
  };
}

// ---- automotriz (forros para carros, tapizado, sillines) --------------------

// Opción principal de cada plantilla y la llave del campo del servicio
// (velaraServices.js) que llena.
export const AUTO_KINDS = {
  forrosCarros: { optionLabel: 'Tipo de forro', serviceField: 'tipo_forro', vehiculo: true },
  tapizado: { optionLabel: 'Zona a tapizar', serviceField: 'zona', vehiculo: true },
  motos: { optionLabel: 'Tipo de sillín', serviceField: 'tipo_sillin', vehiculo: false },
};

export const MOTO_MARCAS = ['AKT', 'Bajaj', 'Yamaha', 'Honda', 'Suzuki', 'Otra'];

export function newAuto(kind, cfg) {
  const opts = Object.keys(cfg.automotriz[kind] || {});
  return {
    kind,
    opcion: opts[0] || '',
    marca: kind === 'motos' ? 'AKT' : '',
    modelo: '',
    anio: '',
    vehiculo: Object.keys(cfg.automotriz.vehiculos)[0],
    material: Object.keys(cfg.automotriz.materiales)[0],
    color: 'negro',
    bordados: 0,
    costuraColor: false,
    espumaNueva: false,
    antideslizante: false,
    cant: 1,
    precioManual: '',
  };
}

export function autoSuggested(it, cfg) {
  const A = cfg.automotriz;
  const base = num(A[it.kind]?.[it.opcion]);
  if (!base) return 0;
  let v = base * (A.materiales[it.material] || 1);
  if (AUTO_KINDS[it.kind]?.vehiculo) v *= A.vehiculos[it.vehiculo] || 1;
  if (it.costuraColor) v += num(A.costuraColor);
  if (it.kind === 'motos') {
    if (it.espumaNueva) v += num(A.espumaNueva);
    if (it.antideslizante) v += num(A.antideslizante);
  }
  v += num(it.bordados) * num(A.bordado);
  return roundTo(v, cfg.redondeo);
}

// Precio de la línea: el escrito a mano gana; si no, el sugerido.
export function autoPrice(it, cfg) {
  return it.precioManual !== '' && it.precioManual != null ? num(it.precioManual) : autoSuggested(it, cfg);
}

// Minúscula solo la primera letra: "Camioneta / SUV" -> "camioneta / SUV".
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');

function vehicleName(it) {
  return [it.marca, it.modelo, it.anio].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
}

export function autoLine(it, cfg) {
  const veh = vehicleName(it);
  const extras = [];
  if (it.costuraColor) extras.push('costura en color de contraste');
  if (it.kind === 'motos' && it.espumaNueva) extras.push('espuma nueva en dos densidades');
  if (it.kind === 'motos' && it.antideslizante) extras.push('material antideslizante en la zona de apoyo');
  if (num(it.bordados)) extras.push(`${num(it.bordados)} bordado${num(it.bordados) > 1 ? 's' : ''} con logo o diseño`);
  let product_name;
  let description;
  if (it.kind === 'forrosCarros') {
    product_name = veh ? `Forros para ${veh}` : 'Forros para carro';
    description = `${it.opcion}, a la medida del vehículo (${lowerFirst(it.vehiculo)}), en ${it.material.toLowerCase()} color ${it.color || 'por definir'}.`;
  } else if (it.kind === 'tapizado') {
    product_name = veh ? `Tapizado ${it.opcion.toLowerCase()} · ${veh}` : `Tapizado: ${it.opcion.toLowerCase()}`;
    description = `Tapizado de ${it.opcion.toLowerCase()} (${lowerFirst(it.vehiculo)}) en ${it.material.toLowerCase()} color ${it.color || 'por definir'}, con acabado y costura a mano.`;
  } else {
    product_name = veh ? `Sillín de moto ${veh}` : 'Sillín de moto';
    description = `Tapizado de sillín ${it.opcion.toLowerCase()} en ${it.material.toLowerCase()} color ${it.color || 'por definir'}, tratado contra el sol y la lluvia.`;
  }
  if (extras.length) description += ` Incluye ${extras.join(', ')}.`;
  return { product_name, description, qty: Math.max(1, num(it.cant)), price_unit: autoPrice(it, cfg) };
}

export function autoServiceHints(it) {
  const field = AUTO_KINDS[it.kind]?.serviceField;
  return {
    marca: it.marca,
    modelo: it.modelo,
    anio: it.anio,
    material: it.material,
    // Solo llena el campo si coincide con una opción del servicio (Negro, Gris…).
    color: it.color ? it.color.charAt(0).toUpperCase() + it.color.slice(1).toLowerCase() : '',
    ...(field ? { [field]: it.opcion } : {}),
  };
}

// ---- costeo -----------------------------------------------------------------

// Mismo método de la calculadora de Excel: precio = neto ÷ (1 − margen),
// redondeado a $10.000; el unitario se redondea a $1.000.
export function costeoResult(lineas, margen, unidades) {
  const neto = lineas.reduce((a, l) => a + num(l[1]) * num(l[2]), 0);
  const m = Math.min(0.95, Math.max(0, num(margen)));
  const n = Math.max(1, num(unidades));
  const total = Math.round(neto / (1 - m) / 10000) * 10000;
  return { neto, total, unit: Math.round(total / n / 1000) * 1000, unidades: n };
}
