// Configuración de las plantillas de cotización (Cotizaciones › Plantillas y
// tarifas): tarifas para los precios sugeridos, catálogo de forros con
// precio fijo, presets de costeo, observaciones rápidas y las políticas de
// fabricación que salen en el PDF de carpas y forros.
//
// Origen: el cotizador de carpas y forros de la empresa de referencia
// (cotiza/.../COTIZADOR NOVA - CARPAS Y FORROS.html). Se rescató el método
// de cálculo, las tarifas (ajustadas a su historial de cotizaciones) y sus
// políticas, cambiando todo dato de esa empresa por VELARA. El historial de
// clientes de esa empresa NO se trajo: no son clientes de VELARA.
//
// Se guarda en settings ('quote_templates_config', JSON) para que todo el
// equipo use las mismas tarifas -- el cotizador original las guardaba en el
// navegador de cada equipo. Las fórmulas viven en el frontend
// (public/js/data/quoteTemplates.js): el servidor solo guarda la línea ya
// calculada en quotation_lines, como cualquier otra cotización.

const { getSetting, setSetting } = require('./db');

const SETTING_KEY = 'quote_templates_config';

// Servicios (slugs de velaraServices.js) que se cotizan con las políticas
// de fabricación en lugar de las condiciones generales de Ajustes.
const FABRICATION_SLUGS = ['carpas-para-negocio', 'forros'];

const DEFAULT_CONFIG = {
  carpas: {
    // Precio sugerido = max(mínimo, fijo + m² × área) × factor de lona
    //                   + logos × precio logo, menos % si no lleva instalación.
    // Base: lona PVC con instalación en Barranquilla.
    tipos: {
      brazos: { fijo: 600000, m2: 160000, min: 900000 },
      recogible: { fijo: 1500000, m2: 180000, min: 2500000 },
      cerchada: { fijo: 1000000, m2: 150000, min: 2000000 },
      curva: { fijo: 2000000, m2: 400000, min: 4000000 },
      concha: { fijo: 790000, m2: 190000, min: 900000 },
      lona: { fijo: 150000, m2: 110000, min: 450000 },
    },
    lonas: { pvc: 1, suntech: 1.2, docril: 1.4, acrisum: 1.6 },
    logo: 60000,
    sinInstalacion: 10,
  },
  forros: {
    // Área: capuchón = tapa + 4 lados; plano = largo × ancho.
    tipos: {
      capuchon: { fijo: 110000, m2: 22000, min: 120000 },
      plano: { fijo: 60000, m2: 35000, min: 80000 },
    },
    materiales: { pvc: 1, arkansas: 0.85, superflex: 1.15, autoforro: 1.2, poliester: 1.1, camionera: 1.25, vinilo: 1.3, cuerina: 0.9, antifluido: 0.85 },
    acolchado: 1.6,
    sellado: 1.15,
    cremallera: 20000,
    visor: 30000,
    bordado: 35000,
    impresion: 75000,
  },
  // Automotriz (forros para carros, tapizado, sillines de moto). Precio
  // sugerido = precio base de la opción × factor material × factor
  // vehículo + extras. Los precios base arrancan en 0 a propósito: VELARA
  // aún no tiene lista de precios cargada y no se inventa una -- mientras
  // estén en 0 la plantilla pide el precio a mano. Las llaves son las mismas
  // opciones de velaraServices.js, para llenar los campos del servicio.
  automotriz: {
    forrosCarros: {
      'Forro completo (sillas, espaldar y cabeceras)': 0,
      'Solo asientos delanteros': 0,
      'Solo banca trasera': 0,
      'Juego completo': 0,
    },
    tapizado: {
      'Sillas y asientos': 0,
      'Paneles y tableros': 0,
      'Cielos y techos': 0,
      'Timones y consolas': 0,
      'Flota o vehículo de trabajo': 0,
    },
    motos: {
      Individual: 0,
      Biplaza: 0,
      'Baúl o maleta': 0,
    },
    materiales: {
      'Cuero sintético premium': 1,
      'Tela técnica deportiva': 1,
      Cuerina: 1,
      Neopreno: 1,
      'Cuero genuino': 1,
    },
    vehiculos: {
      Automóvil: 1,
      'Camioneta / SUV': 1,
      'Van o 7 puestos': 1,
      'Pick-up': 1,
    },
    bordado: 0,
    costuraColor: 0,
    espumaNueva: 0,
    antideslizante: 0,
  },
  transporte: 120000,
  impresionLogo: 120000,
  redondeo: 10000,
  // IVA de las cotizaciones en %. 0 = VELARA no cobra IVA por ahora (no
  // sale en la pantalla ni en el PDF). Cambiarlo a 19 cuando se facture con IVA.
  iva: 0,
  costeo: {
    margen: 0.48,
    plantillas: {
      capuchon: { nombre: 'Capuchón industrial (California + MO vulcanizado)', lineas: [['Lona California (m)', 16, 15000], ['Mano de obra vulcanizado', 1, 180000], ['Insumos', 1, 50000]] },
      bajo: { nombre: 'Forro bajo doble (Superflex + jumbolón)', lineas: [['Lona Superflex (m)', 3.5, 19000], ['Jumbolón', 5, 2000], ['Mano de obra confección', 1, 80000], ['Insumos', 1, 20000], ['Tafeta', 2, 2000]] },
      soloLona: { nombre: 'Capuchón solo lona (Powerflex)', lineas: [['Lona Powerflex (m)', 23, 34000], ['Mano de obra vulcanizado', 1, 200000], ['Insumos', 1, 50000]] },
      colchon: { nombre: 'Forro de colchón 190 × 140 × 14', lineas: [['Tela (m)', 19, 7550], ['Mano de obra', 4, 30000], ['Insumos', 4, 5000], ['Envío', 1, 25000]] },
    },
  },
  // Precios unitarios antes de IVA (referencia 2025–2026). Editables.
  catalogo: [
    {
      cat: 'Sonido · forros',
      items: [
        { t: 'Forro para cabina de 10"', d: 'Forro en lona de PVC, color negro.', p: 170000 },
        { t: 'Forro para cabina de 12"', d: 'Forro en lona de PVC, color negro.', p: 190000 },
        { t: 'Forro para cabina de 15"', d: 'Forro en lona de PVC brillante cuadriculada, color negro.', p: 227000 },
        { t: 'Forro para cabina de 18"', d: 'Forro en lona de PVC brillante cuadriculada, color negro.', p: 330000 },
        { t: 'Forro para bajo sencillo de 15"', d: 'Forro en lona de PVC, color negro.', p: 294000 },
        { t: 'Forro para bajo sencillo de 18"', d: 'Forro en lona de PVC, color negro.', p: 330000 },
        { t: 'Forro para bajo doble de 18"', d: 'Forro mate en lona de PVC. Incluye refuerzo en reata en los bordes.', p: 420000 },
        { t: 'Forro para monitor de piso', d: 'Forro en lona de PVC, color negro.', p: 220000 },
        { t: 'Forro para caja line array', d: 'Forro mate en lona de PVC.', p: 190000 },
        { t: 'Capuchón para line array (4 pisos)', d: 'Cubierta para cabinas line array sobre patineta. Forro mate.', p: 500000 },
        { t: 'Forro para Soundking Stratos 8000', d: 'Lona textil cuadriculada color negro mate. Incluye logo bordado de 15 × 15 cm.', p: 600000 },
        { t: 'Forro para Bose S1 Pro', d: 'Forro mate.', p: 130000 },
        { t: 'Forro para planta de bajo / amplificador', d: 'Forro en lona de PVC.', p: 250000 },
        { t: 'Forro para piano digital', d: 'Elaborado en tela tipo terciopelo color negro.', p: 250000 },
        { t: 'Forro para consola de audio', d: 'Forro tipo capuchón en lona de PVC impermeable con costuras ribeteadas.', p: 250000 },
      ],
    },
    {
      cat: 'Sonido · estuches',
      items: [
        { t: 'Estuche enduro para consola', d: 'Estuche en duro acolchado en lona de PVC, color negro.', p: 250000 },
        { t: 'Estuche en duro para luces LED (4 compartimientos)', d: 'Estuche en duro en lona de PVC impermeable, color negro.', p: 250000 },
        { t: 'Estuche en duro para parales de micrófono (6 compartimientos)', d: 'Estuche en duro en lona de PVC.', p: 350000 },
        { t: 'Estuche en duro para parales de micrófono (8 compartimientos)', d: 'Estuche en duro en lona de PVC.', p: 450000 },
        { t: 'Estuche acolchado para cables', d: 'Estuche sencillo acolchado con correa en lona de PVC.', p: 160000 },
        { t: 'Estuche para proyector', d: 'Estuche brillante en duro liso.', p: 130000 },
        { t: 'Estuche para instrumento (conga / timbal)', d: 'Forro acolchado con correa.', p: 270000 },
        { t: 'Estuche en duro para computador portátil', d: 'Estuche en duro en lona de PVC.', p: 200000 },
      ],
    },
    {
      cat: 'Adicionales y servicios',
      items: [
        { t: 'Logo bordado de 15 × 15 cm', d: '', p: 35000 },
        { t: 'Bordado pequeño', d: '', p: 25000 },
        { t: 'Logo en impresión digital full color', d: '', p: 75000 },
        { t: 'Modificación de forro', d: 'Ajuste de forro existente a una nueva referencia.', p: 70000 },
        { t: 'Reparación de forros', d: 'Arreglo de costuras, cambio de broches y refuerzos en zonas afectadas.', p: 70000 },
      ],
    },
    {
      cat: 'Industrial y comercial',
      items: [
        { t: 'Forro para dispensador de combustible', d: 'Elaborado en lona de PVC impermeable.', p: 250000 },
        { t: 'Forro protector para surtidor con visor', d: 'Lona de PVC impermeable con vinilo transparente para las pantallas.', p: 340000 },
        { t: 'Forro para dispensador en clear transparente', d: 'Lona de PVC ref. California clear transparente, solapas en velcro.', p: 350000 },
        { t: 'Forro protector interno para ascensor', d: 'Lona de poliéster doble cara con acolchado interno y ojetes superiores. Incluye aviso impreso y cosido con logo y texto.', p: 680000 },
        { t: 'Forro de guarda-cadena', d: 'Lona camionera de 600 micras doble faz, triple puntada con hilo nylon y refuerzo lateral cruzado en reata. Color negro.', p: 200000 },
        { t: 'Forro para equipo de soldadura', d: 'Lona de PVC impermeable calibre 500, uniones vulcanizadas y tapa con aletilla en velcro.', p: 380000 },
        { t: 'Forro para maquinaria de corte (podadora)', d: 'Lona de PVC impermeable con uniones electroselladas en alta frecuencia.', p: 820000 },
        { t: 'Funda protectora en cuerina para silletería', d: '', p: 100000 },
        { t: 'Capuchón para cabina de vehículo', d: 'Lona autoforro gris (PVC con base de algodón), costura con ribete negro y elástico inferior.', p: 790000 },
        { t: 'Forro protector tipo funda para TV', d: 'Lona de PVC impermeable con costuras ribeteadas.', p: 190000 },
        { t: 'Forro protector para mesa redonda', d: 'Lona de PVC impermeable con elástico inferior para ajuste.', p: 172000 },
        { t: 'Estuche protector para mesa de ping pong', d: 'Lona de PVC impermeable con protección interna en espuma de polietileno.', p: 380000 },
        { t: 'Forro para equipo médico (funda + bolso)', d: 'Lona de PVC impermeable de fácil limpieza. Incluye logotipo bordado.', p: 760000 },
        { t: 'Forro para extintor', d: 'Lona de PVC ref. California con cara frontal en vinilo transparente calibre 20.', p: 75000 },
        { t: 'Forro para camilla', d: 'Lona de PVC ref. California.', p: 150000 },
      ],
    },
    {
      cat: 'Colchones, colchonetas y acolchados',
      items: [
        { t: 'Forro para colchón 140 × 190 × 14', d: 'Elaborado en cuerina con cremallera.', p: 165000 },
        { t: 'Forro para colchoneta 80 × 190 × 14', d: 'Tela de PVC impermeable antibacterial y retardante al fuego. Cremallera en "L".', p: 95000 },
        { t: 'Colchoneta 200 × 100 × 2,4 cm', d: 'Espuma de polietileno con forro en lona de PVC.', p: 170000 },
        { t: 'Colchoneta para acolchado de piso (por m²)', d: 'Espesor 2,4 cm. Espuma de polietileno de alto impacto y forro en lona de PVC con aletillas en velcro.', p: 100000 },
        { t: 'Acolchado para protección de pared (metro lineal, 140 cm de alto)', d: 'Soporte en madera, espuma y forro en lona de PVC impermeable. Incluye instalación.', p: 270000 },
        { t: 'Módulo acolchado para protección de cancha (2 m de alto)', d: 'Espesor 11 cm. Lona de PVC de alto tráfico con uniones vulcanizadas, soporte de madera y espuma.', p: 520000 },
        { t: 'Colchoneta protección de poste 120 × 200 × 10', d: 'Espuma y forro en lona de PVC alto tráfico. Incluye correa en reata y argollas.', p: 250000 },
        { t: 'Colchoneta plegable 3 piezas 180 × 60 × 5', d: 'Espuma densidad 23 y forro en tela vinílica o PVC. Incluye dos asas.', p: 260000 },
      ],
    },
  ],
  // Garantía por servicio -- la misma de la página "Garantía del taller"
  // del sitio (velara/sitio/src/data/recursos.ts). El PDF arma la línea de
  // garantía con esto; si cambia aquí, cambiarla también en el sitio y en
  // el manual de atención (ver Datos maestros de la empresa en la bóveda).
  garantias: {
    'forros-para-carros': '6 meses en costura y cierres',
    'tapizado-automotriz': '12 meses en costura y material',
    'tapizado-de-motos': '12 meses en costura y material',
    'carpas-para-negocio': '24 meses en costura y confección; la lona, según la garantía del fabricante',
    forros: '6 meses en costura y cremalleras',
  },
  // Tiempo típico por servicio -- el de la ficha de cada servicio del sitio
  // (velara/sitio/src/data/services.ts, "Tiempo típico").
  tiempos: {
    'forros-para-carros': '1 a 3 días hábiles',
    'tapizado-automotriz': '1 a 3 semanas, según el alcance',
    'tapizado-de-motos': '3 a 7 días',
    'carpas-para-negocio': '2 a 4 semanas',
    forros: '3 días a 2 semanas',
  },
  garantiaReclamo:
    'Cubre defectos de confección, no el desgaste por uso ni daños por mal uso. Para hacerla efectiva escríbanos con el número de orden y una foto; coordinamos la reparación en un plazo de 5 días hábiles.',
  // Botones de "Notas y condiciones" en Nueva cotización.
  observaciones: [
    'Incluye instalación y transporte en Barranquilla.',
    'No incluye instalación.',
    'No incluye envío.',
    'Precio por unidad. Color por definir con el cliente.',
    'Se requieren 10 días hábiles después del pago para su fabricación.',
    'Imagen de referencia adjunta.',
  ],
  // Políticas del PDF para carpas y forros (FABRICATION_SLUGS). Rescatadas
  // del cotizador de referencia y redactadas para VELARA.
  politicasFabricacion: [
    'Para iniciar la producción se requiere un anticipo del 50 %. El saldo debe cancelarse en su totalidad antes de la entrega o el despacho del pedido.',
    'El plazo de entrega se cuenta a partir de la confirmación del anticipo y de la definición completa del diseño. La fecha en firme se acuerda con el asesor.',
    'Una vez aprobados los diseños y las especificaciones del pedido, cualquier modificación posterior es responsabilidad del cliente y puede generar costos adicionales y cambiar el tiempo de entrega.',
    'VELARA no se hace responsable por retrasos ocasionados por causas externas, como transporte, fuerza mayor, demoras de proveedores o falta de información oportuna por parte del cliente.',
  ],
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// Mezcla lo guardado sobre los valores por defecto, para que una clave
// nueva agregada aquí aparezca aunque la configuración guardada sea vieja.
function merge(base, saved) {
  if (saved === undefined || saved === null) return base;
  if (Array.isArray(base) || typeof base !== 'object') return saved;
  const out = { ...base };
  for (const k of Object.keys(saved)) out[k] = k in base ? merge(base[k], saved[k]) : saved[k];
  return out;
}

async function getConfig() {
  let saved = null;
  try {
    saved = JSON.parse((await getSetting(SETTING_KEY, '')) || 'null');
  } catch {
    saved = null;
  }
  return merge(clone(DEFAULT_CONFIG), saved);
}

async function saveConfig(config) {
  await setSetting(SETTING_KEY, JSON.stringify(config));
  return getConfig();
}

async function resetConfig() {
  await setSetting(SETTING_KEY, '');
  return getConfig();
}

function isFabrication(slug) {
  return FABRICATION_SLUGS.includes(slug);
}

module.exports = { DEFAULT_CONFIG, FABRICATION_SLUGS, getConfig, saveConfig, resetConfig, isFabrication };
