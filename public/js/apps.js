// Aplicaciones de Velara (como el inicio de Odoo): cada una agrupa sus
// pantallas y tiene su propio menú lateral. Es la ÚNICA fuente de verdad de
// la navegación -- el menú, el Inicio y el título de cada pantalla salen de
// aquí. "hidden" = pantallas de la app que no van en el menú (ej. el
// detalle de una OP se abre desde el tablero).

export const APPS = [
  {
    key: 'comercial',
    label: 'Comercial',
    desc: 'Leads, cotizaciones, ventas y clientes',
    icon: 'storefront',
    color: '#E4572E',
    routes: [
      ['ventas', 'Leads'],
      ['seguimiento', 'Seguimiento'],
      ['cotizar', 'Cotizar'],
      ['cotizaciones', 'Cotizaciones'],
      ['ventas-cerradas', 'Ventas cerradas'],
      ['clientes', 'Clientes'],
    ],
  },
  {
    key: 'produccion',
    label: 'Producción',
    desc: 'Pedidos, órdenes de producción y entregas',
    icon: 'precision_manufacturing',
    color: '#2A7F8F',
    routes: [
      ['produccion', 'Tablero'],
      ['pedidos', 'Pedidos'],
      ['programacion', 'Programación'],
      ['solicitudes-material', 'Solicitudes de material'],
      ['garantias', 'Garantías'],
      ['reportes-produccion', 'Reportes'],
    ],
    hidden: [['op', 'Orden de producción']],
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
    desc: 'Equipo, operarios y ajustes',
    icon: 'settings',
    color: '#6B7280',
    routes: [
      ['asesores', 'Equipo de ventas'],
      ['operarios', 'Operarios'],
      ['ajustes', 'Ajustes'],
    ],
  },
];

// Pantallas permitidas por rol (el backend además protege cada endpoint).
// produccion = jefe de producción/taller: toda la app Producción, consulta
// de Inventario y los operarios; no ve finanzas ni el embudo comercial.
const PRODUCCION = ['produccion', 'pedidos', 'programacion', 'op', 'solicitudes-material', 'garantias', 'reportes-produccion'];
export const ROUTES_BY_ROLE = {
  admin: ['inicio', 'dashboard1', 'dashboard', 'ventas', 'seguimiento', 'cotizaciones', 'cotizar', ...PRODUCCION, 'inventario', 'compras', 'finanzas', 'facturacion', 'clientes', 'informe', 'ventas-cerradas', 'estadisticas', 'reporte', 'asesores', 'operarios', 'ajustes'],
  coordinador: ['inicio', 'dashboard1', 'dashboard', 'ventas', 'seguimiento', 'cotizaciones', 'cotizar', ...PRODUCCION, 'inventario', 'compras', 'finanzas', 'facturacion', 'clientes', 'informe', 'ventas-cerradas', 'estadisticas', 'asesores', 'operarios'],
  produccion: ['inicio', ...PRODUCCION, 'inventario', 'operarios'],
  // Un asesor opera lo suyo: su embudo comercial y el avance en producción
  // de sus clientes (el backend le filtra las OP a las de sus leads).
  asesor: ['inicio', 'ventas', 'cotizaciones', 'cotizar', 'clientes', 'produccion', 'pedidos', 'op', 'garantias', 'inventario'],
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
// entrada al abrir la app.
export function visibleApps(allowedRoutes) {
  return APPS.map((a) => {
    const first = a.routes.find(([r]) => allowedRoutes.includes(r));
    return first ? { ...a, firstRoute: first[0] } : null;
  }).filter(Boolean);
}
