// Aplicaciones de Velara (como el inicio de Odoo): cada una agrupa sus
// pantallas y tiene su propio menú lateral. Es la ÚNICA fuente de verdad de
// la navegación -- el menú, el Inicio y el título de cada pantalla salen de
// aquí. "hidden" = pantallas de la app que no van en el menú (ej. el
// detalle de una OP se abre desde el tablero).

export const APPS = [
  {
    // Ventas: un embudo por etapas en lugar de Leads/Seguimiento/
    // Cotizaciones/Ventas cerradas (pensadas para un equipo de asesores);
    // esas pantallas siguen existiendo pero salen del menú.
    // CRM (como el CRM de Odoo): el flujo por etapas, los equipos de cada
    // vendedor y los clientes. "menus" = cómo se agrupan en la barra de
    // arriba (un grupo con label abre un desplegable).
    key: 'comercial',
    label: 'CRM',
    desc: 'Clientes interesados, flujo de ventas y equipos',
    icon: 'handshake',
    color: '#E4572E',
    routes: [
      ['embudo', 'Flujo'],
      ['equipos', 'Equipos'],
      ['clientes', 'Clientes'],
      // Cifras y tabla de clientes (era el Inicio antes de la cuadrícula).
      ['resumen', 'Resumen'],
    ],
    menus: [
      {
        label: 'Ventas',
        items: [
          ['embudo', 'Mi flujo'],
          ['equipos', 'Equipos'],
          ['clientes', 'Clientes'],
        ],
      },
      ['resumen', 'Resumen'],
    ],
    // Fuera del menú (minimalismo): la pantalla sigue existiendo.
    hidden: [
      ['manual', 'Manual de atención'],
      ['ventas', 'Leads'],
      ['seguimiento', 'Seguimiento'],
      ['ventas-cerradas', 'Ventas cerradas'],
    ],
  },
  {
    // Cotizaciones: su propio apartado. "Nueva cotización" trae las
    // plantillas según lo que se fabrica (data/quoteTemplates.js); las
    // tarifas, el catálogo y las políticas se ajustan en Configuración ›
    // "Políticas y tarifas". Todo queda ligado al lead y al embudo de Ventas.
    key: 'cotizaciones',
    label: 'Cotizaciones',
    desc: 'Cotizar y ver el listado',
    icon: 'request_quote',
    color: '#C7420E',
    routes: [
      ['cotizar', 'Nueva cotización'],
      ['cotizaciones', 'Cotizaciones'],
      ['catalogo', 'Catálogo'],
    ],
  },
  {
    // Trabajos del taller: tablero simple por etapas (reemplaza la
    // producción por pedidos/OP, que era para una fábrica -- sus pantallas
    // siguen existiendo pero ya no van en el menú).
    key: 'trabajos',
    label: 'Trabajos',
    desc: 'Lo que está en el taller, de la entrada a la entrega',
    icon: 'construction',
    color: '#2A7F8F',
    routes: [
      ['trabajos', 'Tablero'],
      ['operarios', 'Operarios'],
    ],
  },
  {
    key: 'inventario',
    label: 'Inventario',
    desc: 'Materiales y existencias',
    icon: 'inventory_2',
    color: '#8E6BBF',
    routes: [['inventario', 'Materiales']],
  },
  {
    key: 'compras',
    archived: true,
    label: 'Compras',
    desc: 'Proveedores y órdenes de compra',
    icon: 'shopping_cart',
    color: '#3E7CB1',
    routes: [['compras', 'Órdenes de compra']],
  },
  {
    key: 'finanzas',
    label: 'Finanzas',
    desc: 'Cuentas, gastos, cobros y ganancia',
    icon: 'account_balance_wallet',
    color: '#3F9C6B',
    routes: [
      ['finanzas', 'Cuentas y movimientos'],
      ['facturacion', 'Facturación electrónica'],
    ],
  },
  {
    key: 'tableros',
    archived: true,
    label: 'Tableros',
    desc: 'Resumen del negocio',
    icon: 'space_dashboard',
    color: '#D9922E',
    routes: [
      ['dashboard1', 'Panel de gerencia'],
      ['dashboard', 'Panel del día'],
    ],
  },
  {
    key: 'reportes',
    archived: true,
    label: 'Reportes',
    desc: 'Informes y análisis comercial',
    icon: 'bar_chart',
    color: '#B5487A',
    routes: [
      ['informe', 'Informe diario'],
      ['estadisticas', 'Rendimiento comercial'],
      ['reporte', 'Servicio al cliente'],
    ],
  },
  {
    key: 'config',
    label: 'Configuración',
    desc: 'Equipo, políticas de cotización y ajustes',
    icon: 'settings',
    color: '#6B7280',
    routes: [
      ['asesores', 'Equipo de ventas'],
      ['plantillas-cotizacion', 'Políticas y tarifas'],
      ['ajustes', 'Ajustes'],
    ],
  },
];

// Menú lateral único, siempre visible y con todo junto (como la referencia
// Shakuro): grupos con un rótulo gris y un ícono por pantalla. Reemplaza el
// menú por aplicación estilo Odoo. Las pantallas que el rol no puede ver no
// salen; un grupo sin pantallas visibles tampoco.
export const NAV = [
  {
    label: '',
    items: [['inicio', 'Inicio', 'home']],
  },
  {
    label: 'CRM',
    items: [
      ['resumen', 'Resumen', 'space_dashboard'],
      ['embudo', 'Flujo', 'view_kanban'],
      ['equipos', 'Equipos', 'groups'],
      ['clientes', 'Clientes', 'group'],
      ['cotizar', 'Nueva cotización', 'add_notes'],
      ['cotizaciones', 'Cotizaciones', 'request_quote'],
      ['catalogo', 'Catálogo', 'category'],
    ],
  },
  {
    label: 'Taller',
    items: [
      ['trabajos', 'Trabajos', 'construction'],
      ['operarios', 'Operarios', 'engineering'],
      ['inventario', 'Inventario', 'inventory_2'],
    ],
  },
  {
    label: 'Finanzas',
    items: [
      ['finanzas', 'Cuentas y movimientos', 'account_balance_wallet'],
      ['facturacion', 'Facturación electrónica', 'receipt_long'],
    ],
  },
  {
    label: 'Configuración',
    items: [
      ['asesores', 'Equipo de ventas', 'badge'],
      ['plantillas-cotizacion', 'Políticas y tarifas', 'tune'],
      ['ajustes', 'Ajustes', 'settings'],
    ],
  },
];

// Pantallas permitidas por rol (el backend además protege cada endpoint).
// produccion = jefe de producción/taller: toda la app Producción, consulta
// de Inventario y los operarios; no ve finanzas ni el embudo comercial.
const PRODUCCION = ['trabajos', 'produccion', 'pedidos', 'programacion', 'op', 'solicitudes-material', 'garantias', 'reportes-produccion'];
export const ROUTES_BY_ROLE = {
  admin: ['inicio', 'resumen', 'embudo', 'equipos', 'manual', 'dashboard1', 'dashboard', 'ventas', 'seguimiento', 'cotizaciones', 'cotizar', 'catalogo', 'plantillas-cotizacion', ...PRODUCCION, 'inventario', 'compras', 'finanzas', 'facturacion', 'clientes', 'informe', 'ventas-cerradas', 'estadisticas', 'reporte', 'asesores', 'operarios', 'ajustes'],
  coordinador: ['inicio', 'resumen', 'embudo', 'equipos', 'manual', 'dashboard1', 'dashboard', 'ventas', 'seguimiento', 'cotizaciones', 'cotizar', 'catalogo', 'plantillas-cotizacion', ...PRODUCCION, 'inventario', 'compras', 'finanzas', 'facturacion', 'clientes', 'informe', 'ventas-cerradas', 'estadisticas', 'asesores', 'operarios'],
  produccion: ['inicio', ...PRODUCCION, 'inventario', 'operarios'],
  // Un asesor opera lo suyo: su embudo comercial y el avance en producción
  // de sus clientes (el backend le filtra las OP a las de sus leads).
  asesor: ['inicio', 'resumen', 'embudo', 'equipos', 'manual', 'ventas', 'cotizaciones', 'cotizar', 'catalogo', 'clientes', 'produccion', 'pedidos', 'op', 'garantias', 'inventario'],
};

const LABELS = { inicio: 'Inicio' };
for (const app of APPS) {
  app.firstRoute = app.routes[0][0];
  for (const [r, label] of [...app.routes, ...(app.hidden || [])]) LABELS[r] = label;
}

export function routeLabel(route) {
  return LABELS[route] || route;
}

export function appOfRoute(route) {
  return APPS.find((a) => [...a.routes, ...(a.hidden || [])].some(([r]) => r === route)) || null;
}

// Apps con al menos una pantalla permitida; la primera permitida es la de
// entrada al abrir la app. "archived" = app que sale del Inicio por
// minimalismo (sus pantallas siguen existiendo y abren por URL); quitar la
// marca la vuelve a mostrar.
export function visibleApps(allowedRoutes) {
  return APPS.filter((a) => !a.archived).map((a) => {
    const first = a.routes.find(([r]) => allowedRoutes.includes(r));
    return first ? { ...a, firstRoute: first[0] } : null;
  }).filter(Boolean);
}
