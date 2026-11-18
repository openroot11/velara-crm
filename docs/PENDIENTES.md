# Pendientes de Velara CRM/ERP

Última actualización: 24-sep-2026. Detalle técnico de cada punto (archivo, línea, escenario) en [AUDITORIA-2026-09-24.md](AUDITORIA-2026-09-24.md).

## Antes de facturar de verdad (negocio)
- [ ] Hablar con el contador: ¿persona natural o SAS?, ¿qué régimen?, ¿cobra IVA?, ¿qué retenciones aplican?
- [ ] Formalizar Velara (RUT con responsabilidad 52 de facturador electrónico, Cámara de Comercio).
- [ ] Elegir proveedor tecnológico (recomendado MATIAS API Mini o Plemsi) y habilitarse en la DIAN.
- [ ] Configurar el régimen en Facturación → "Para la declaración".
- [ ] Quitar "S.A.S." del sitio y del dossier hasta que la empresa exista.

## Arreglos del sistema, en orden (de la auditoría)
1. [ ] **Backups completos** (copiar la base entera con `VACUUM INTO`) y sin la clave de sesión. Hoy el backup no guarda abonos, clientes, cotizaciones, producción, inventario, caja ni facturas.
2. [ ] **Seguridad**: escapar títulos de modales y nombres (inyección de código por nombre de cliente), restringir tipo de archivos subidos a las OP, sacar al rol Producción de las rutas comerciales, que un asesor solo edite sus clientes, pedir sesión en el WebSocket.
3. [ ] **IVA según el régimen**: desde 2026-10-08 es configurable (Plantillas y tarifas › IVA en cotizaciones, hoy 0 %); cotizaciones, trabajos, rentabilidad y prefactura usan ese valor. Falta confirmar con el contador y definir si el monto del lead va con o sin IVA.
4. [ ] **Un solo cobro**: ligar factura de venta ↔ abono ↔ Caja, una sola cartera, evitar facturar dos veces la misma venta.
5. [ ] **Días en hora de Colombia** en informes y filtros (hoy cortan a las 7 p.m.).
6. [ ] **Quitar el filtro "solo Google Ads"** (`leads_visible`) y no cambiar el canal a Google Ads al cerrar una venta.
7. [ ] **Reconectar Producción ↔ Inventario ↔ Finanzas**: consumo de material por OP, rentabilidad sobre OP, exigir venta cerrada para crear pedido.
8. [ ] Sacar la llamada al proveedor de facturación fuera de la transacción antes de conectar uno real.
9. [ ] Borrado de leads, "Restaurar de fábrica", orden de la migración de `db.js`, asignar leads cerrados, validación de montos, sesiones persistentes.
10. [ ] Rendimiento: índices y paginación de leads.

## Mejoras de Facturación pendientes
- [ ] Casilla "Precio con IVA incluido" al facturar.
- [ ] Opción "Ya pagó (contado)" al emitir.
- [ ] Botón "Facturar" en el pedido / OP entregada y aviso de entregados sin facturar.
- [ ] Datos de Velara como facturador editables (razón social, NIT, resolución DIAN).
- [ ] Retenciones (retefuente, reteIVA, reteICA).
- [ ] Documento soporte (compras a quien no factura), notas crédito parciales y notas débito.
- [ ] Enviar la factura por correo al cliente.
- [ ] Borrar las facturas simuladas antes de pasar a producción real.

## Sin commit todavía
- Módulo Facturación completo (`server/einvoice.js`, `server/routes/invoices.js`, `public/js/views/facturacion.js` y cambios en `db.js`, `erp.js`, `cash.js`, `index.js`, `app.js`, `apps.js`).
- Rediseño en `public/` (24-sep): modo oscuro de formularios, menú en celular, naranja solo en botón principal, botones estándar, componente compartido `public/js/components/ui.js`. Detalle en [DISENO-2026-09-24.md](DISENO-2026-09-24.md).

## Diseño pendiente
- [ ] Contraste del botón principal (texto blanco sobre #FF5A1F = 2,9:1): usar #C7420E o texto negro — decisión de marca.
- [ ] Subir la letra de los botones de 11 px a 13–14 px.
- [ ] Pasar clientes, dashboard1, reporte, production y Estadísticas a `ui.js`.
- [ ] Estados en naranja pálido (Cotizado, En producción) a otro tono.
- [ ] Tarjetas en vez de tablas en celular (Leads, Seguimiento, Pedidos).
- [ ] Revisar con sesión real: Dashboard, Informe, Reporte, Ventas cerradas, Producción y detalle de OP (no se pudieron probar).
