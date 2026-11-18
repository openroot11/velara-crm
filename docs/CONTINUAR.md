# Para seguir en otro PC

Última sesión: 18 de noviembre de 2026. Todo está en este disco.

## 1. Dónde abrir

- **Carpeta del CRM:** `01 VELARA\crm` en este disco. En el otro PC la letra puede cambiar (por ejemplo `E:\01 VELARA\crm` en lugar de `D:\`).
- **En Claude Code** (app de escritorio, pestaña Code): abre esa carpeta y escribe:
  > Lee docs/CONTINUAR.md y seguimos con el CRM.
- La memoria de Claude se queda en el otro computador. **Este archivo es el que lleva el contexto.**

## 2. Arrancar el CRM

1. El PC necesita **Node.js 22.5 o superior** (https://nodejs.org, versión LTS).
2. Doble clic en `iniciar.bat`. Si es la primera vez en ese PC, instala lo que falte.
3. Abre http://localhost:4000 y entra con tu usuario.
4. Si el puerto 4000 está ocupado, abre una terminal en `crm\server` y corre `set PORT=4001 && node index.js`.

**Antes de desconectar el disco, cierra la ventana negra del servidor.** Si no, la base puede quedar a medio guardar.

## 3. Git

- Rama de trabajo: **`cotizaciones-plantillas`**. Todo lo de esta sesión quedó guardado ahí en un commit.
- Es posible que en el otro PC git diga "dubious ownership" porque el disco viene de otro usuario. Se arregla así (cambia la letra si no es `D:`):
  ```
  git config --global --add safe.directory "D:/01 VELARA/crm"
  ```
- La rama **no** se ha subido a GitHub (`origin` = openroot11/velara-crm). Si se quiere trabajar sin el disco, hay que subirla primero.

## 4. Datos

- **Base real:** `server/data/nova_crm.db`. No está en git; viaja en el disco.
- **Copia antes de los cambios de hoy:** `server/backups/antes-cotizador-categorias-2026-11-18.db`.

## 5. Lo que se hizo en esta sesión

**Cotizador por categorías (estilo Odoo)**
- Cotizaciones › **Catálogo**, con tres pestañas:
  - **Productos:** precio, descripción de venta y unidad.
  - **Categorías:** encabezado, garantía y tiempo de entrega.
  - **Plantillas.**
- Al cotizar, cada producto abre la sección de su categoría. También hay notas y secciones libres, y se puede "Guardar como plantilla" o "Aplicar plantilla".
- En el PDF, cada sección sale con su subtotal y hay un bloque "Garantía y tiempo de entrega" por categoría.
- El botón "Traer catálogo anterior" importa los productos del cotizador de Nova marcados "por revisar". **No se usó en la base real.**

**Forros para carros (lo único en lo que se centra Velara por ahora)**
- Van **en tela, sin sintéticos**: en una sola tela, combinados o abullonados con diseño. Siempre juego completo, a la medida.
- Precios cargados en el catálogo (costo del proveedor → precio de venta):

  | Producto | Costo | Venta |
  |---|---|---|
  | Sencillo | 300.000 | 470.000 |
  | Corte original | 400.000 | 620.000 |
  | Abullonado con diseño | 450.000 | 690.000 |
  | Camioneta | 450.000 | 720.000 |
  | Fénix | 550.000 | 850.000 |
  | Esterillado (adicional) | 50.000 | 80.000 |

- Se gana cerca del 35 %. Para negociar, el precio mínimo es el costo ÷ 0,75. No se cobra IVA.
- Entrega: **8 días hábiles**. Garantía: 6 meses en costura y cierres.
- **Sin confirmar con el proveedor:** qué es exactamente el Fénix y el esterillado, y si la instalación cuesta aparte.

**Nueva cotización**
- Los datos del cliente arrancan plegados. El botón "Cliente nuevo" despliega el formulario.

**Navegación como Odoo**
- **Inicio:** cuadrícula de aplicaciones a pantalla completa.
- **Dentro de cada aplicación:** el menú va arriba, de borde a borde (es el predeterminado). En Configuración › Ajustes › Apariencia se puede volver al menú lateral.

**CRM** (antes "Ventas"): menú **Ventas ▾** (Mi flujo, Equipos, Clientes) y Resumen.
- **Flujo:**
  - Columnas Nuevos / Contactados / Cotizados / Ganados / Perdidos, con tarjetas que se arrastran.
  - Buscador con chips (en todo o por campo), filtros, filtro por vendedor, y vista de tarjetas o de lista.
- **Equipos:** un cuadro por vendedor con sus cifras y una gráfica de 5 semanas.
- **Resumen:** las cifras y la tabla que antes estaban en el Inicio.

**Sitio web** (`01 VELARA\sitio-y-marca\sitio`, carpeta sin git)
- En la ficha de forros para carros: 8 días hábiles, tela en lugar de cuerina, y sin "servicio express".
- **Falta publicarlo en Vercel.**

## 6. Lo que sigue

- **CRM:** etapas configurables (como en Odoo), ficha del cliente, Ganados y Perdidos de más de 30 días, y Reportes.
- **Otras aplicaciones al estilo Odoo, una por una:** Cotizaciones, Trabajos, Inventario, Finanzas.
- **Fotos propias de Velara:** la foto principal de forros en el sitio todavía es de cuero (material de Nova).
- **Pendientes de antes:** `docs/PENDIENTES.md`.

## 7. Contexto que no hay que olvidar

- Velara nace de Manufacturas y Diseños Nova. No hay que tomar material de Nova (clientes, precios, fotos) como si fuera de Velara.
- El CRM de Odoo de Nova se revisó solo como referencia de diseño.
- `D:\CLAUDE.md` (en la raíz del disco) todavía tiene rutas viejas. Lo tiene que editar el usuario.
