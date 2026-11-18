// Catálogo de servicios de Velara Taller S.A.S. y los campos propios de
// cada uno para la cotización -- espejo de server/velaraServices.js (ese es
// CommonJS, este es módulo ES nativo del frontend sin build; si se cambia
// un campo, replicarlo en ambos lados).
//
// Mismos slugs y orden que Velara/sitio/src/data/services.ts.

const COLOR_OPTIONS = ['Negro', 'Café', 'Gris', 'Beige', 'Blanco', 'Personalizado'];
const MATERIAL_OPTIONS = ['Cuero sintético premium', 'Tela técnica deportiva', 'Cuerina', 'Neopreno', 'Cuero genuino'];
// Los forros para carros son en tela (no llevan sintéticos): en una sola
// tela, combinados o abullonados con diseño.
const FORRO_TELA_OPTIONS = ['Una sola tela', 'Combinado', 'Abullonado con diseño'];

export const SERVICES = [
  {
    slug: 'forros-para-carros',
    title: 'Forros para carros',
    fields: [
      { key: 'marca', label: 'Marca', type: 'text', required: true, placeholder: 'Chevrolet' },
      { key: 'modelo', label: 'Modelo', type: 'text', required: true, placeholder: 'Onix' },
      { key: 'anio', label: 'Año', type: 'text', required: true, placeholder: '2021' },
      {
        key: 'tipo_forro',
        label: 'Tipo de forro',
        type: 'select',
        required: true,
        options: ['Forro completo (sillas, espaldar y cabeceras)', 'Solo asientos delanteros', 'Solo banca trasera', 'Juego completo'],
      },
      { key: 'material', label: 'Tela', type: 'select', options: FORRO_TELA_OPTIONS },
      { key: 'color', label: 'Color', type: 'select', options: COLOR_OPTIONS },
    ],
  },
  {
    slug: 'tapizado-automotriz',
    title: 'Tapizado automotriz',
    fields: [
      { key: 'marca', label: 'Marca', type: 'text', required: true, placeholder: 'Renault' },
      { key: 'modelo', label: 'Modelo', type: 'text', required: true, placeholder: 'Duster' },
      { key: 'anio', label: 'Año', type: 'text', required: true, placeholder: '2019' },
      {
        key: 'zona',
        label: 'Zona a tapizar',
        type: 'select',
        required: true,
        options: ['Sillas y asientos', 'Paneles y tableros', 'Cielos y techos', 'Timones y consolas', 'Flota o vehículo de trabajo'],
      },
      { key: 'material', label: 'Material', type: 'select', options: MATERIAL_OPTIONS },
      { key: 'color', label: 'Color', type: 'select', options: COLOR_OPTIONS },
    ],
  },
  {
    slug: 'tapizado-de-motos',
    title: 'Tapizado de motos',
    fields: [
      { key: 'marca', label: 'Marca', type: 'select', required: true, options: ['AKT', 'Bajaj', 'Yamaha', 'Honda', 'Suzuki', 'Otra'] },
      { key: 'modelo', label: 'Modelo', type: 'text', required: true, placeholder: 'NKD 125' },
      { key: 'anio', label: 'Año', type: 'text', placeholder: '2022' },
      { key: 'tipo_sillin', label: 'Tipo de sillín', type: 'select', required: true, options: ['Individual', 'Biplaza', 'Baúl o maleta'] },
      { key: 'material', label: 'Material', type: 'select', options: MATERIAL_OPTIONS },
      { key: 'color', label: 'Color', type: 'select', options: COLOR_OPTIONS },
    ],
  },
  {
    slug: 'carpas-para-negocio',
    title: 'Carpas y toldos para negocio',
    fields: [
      {
        key: 'tipo',
        label: 'Tipo',
        type: 'select',
        required: true,
        options: ['Toldo de fachada', 'Carpa para terraza', 'Cubierta o lona', 'Cerramiento y faldón'],
      },
      { key: 'dimensiones', label: 'Dimensiones', type: 'text', required: true, placeholder: '4m x 3m' },
      { key: 'material', label: 'Material', type: 'select', options: ['Lona náutica', 'Lona PVC', 'Tela impermeable', 'Estructura en aluminio'] },
      { key: 'color', label: 'Color', type: 'select', options: COLOR_OPTIONS },
      { key: 'ubicacion', label: 'Lugar de instalación', type: 'text', placeholder: 'Fachada del local, calle 45...' },
    ],
  },
  {
    slug: 'forros',
    title: 'Forros para muebles y equipos',
    fields: [
      { key: 'tipo_mueble', label: 'Mueble o equipo', type: 'text', required: true, placeholder: 'Juego de sala 3 puestos' },
      { key: 'piezas', label: 'Cantidad de piezas / dimensiones', type: 'text', placeholder: '3 piezas' },
      { key: 'material', label: 'Material', type: 'select', options: MATERIAL_OPTIONS },
      { key: 'color', label: 'Color', type: 'select', options: COLOR_OPTIONS },
    ],
  },
  {
    slug: 'otro',
    title: 'Otro',
    fields: [{ key: 'detalle', label: 'Detalle', type: 'text', placeholder: 'Describa el trabajo' }],
  },
];

export function findService(slug) {
  return SERVICES.find((s) => s.slug === slug) || null;
}

export const PRODUCTS = SERVICES.map((s) => s.title);

export const PRODUCT_COLORS = {
  'Forros para carros': '#2a78d6',
  'Tapizado automotriz': '#eb6834',
  'Tapizado de motos': '#1baf7a',
  'Carpas y toldos para negocio': '#eda100',
  'Forros para muebles y equipos': '#e87ba4',
  Otro: '#4a3aa7',
};
