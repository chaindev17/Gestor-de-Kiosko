# Gestor de Kiosko — Plataforma Multi-Empresa & Gestión Integral

Plataforma web integral de gestión automatizada para kioskos y comercios minoristas — con experiencia editorial inspirada en **Conecta** (`conecta.simplemente.com.uy`), **registro por correo electrónico**, **creación de empresas aisladas**, **afiliación por código (`kiosko-XXXXXX`)** y **control total del creador sobre cómo se maneja el software**.

## Arquitectura completa del sistema (13 módulos + afiliación)

El menú del negocio se organiza en orden exacto y filtra dinámicamente cada elemento según los permisos reales del usuario conectado:

1. **Inicio del Negocio** — Resumen diario en CUP (Efectivo, Transfermóvil QR, EnZona QR), cajas abiertas/cerradas, alertas de stock/mermas/precios pendientes y bitácora de acciones por usuario.
2. **Mi Empresa y Modo** — Modo de operación (*Solo POS*, *POS + Catálogo*, *Solo Catálogo*, *Multicaja*), moneda oficial **CUP** con tasas referenciales internas (**USD / MLC / EUR**), datos de cobro QR, políticas de catálogo/IPV y activación de módulos.
3. **Equipo y Turnos** — Gestión de plantilla, turnos y **Matriz granular de permisos por trabajador** (`canView`, `canEdit`, `canApprove` en los 13 módulos + 7 permisos especiales de privacidad/operación), con protección real de rutas y API.
4. **Mostrador (POS)** — Venta rápida por nombre, código o compatibilidad con miniaturas de foto, cobro en Efectivo CUP, Transfermóvil, EnZona o Mixto, descuento en tiempo real de stock e IPV y botón **QR Catálogo** para clientes.
5. **Turnos, Cajas e IPV** — Apertura con fondo inicial, **entradas y salidas de efectivo en caja** con motivo, arqueo de cierre (efectivo esperado vs. contado + diferencia) e IPV exacto (*Inicial + Entradas − Ventas − Mermas − Devoluciones = Final*).
6. **Almacén y Stock** — Doble nivel de entrada (*Producto existente SC-2-04* y *Nuevo producto + foto + entrada en 1 paso* con destino Almacén, Mostrador o Mixto), compresor de fotos en navegador (**WebP/JPEG ≤ 800×800 px** desde cámara, galería o recorte cuadrado), pases SC-2-09, kardex y mermas SC-2-16 con aprobación del Jefe.
7. **Precios y Tablilla** — Fichas de costo MFP Res. 225/2024, equivalencias referenciales USD/MLC/EUR, aprobación/rechazo en 1 clic de precios propuestos desde Almacén, Tablilla Oficial Decreto 30/2021 (modo seguro sin costos para dependientes), interruptor de visibilidad en catálogo e historial completo de cambios.
8. **Catálogo y Pedidos** — Ubicado justo debajo de *Precios y Tablilla*: sincronización automática con stock, foto, compatibilidad y precio público (`Disponible` / `Agotado` al llegar a 0, sin exponer jamás costos ni proveedores), buscador público (`?tienda=kiosko-XXXXXX`), pedido directo a WhatsApp y cobro en 1 clic.
9. **Cobros QR y Banco** — Conciliación Transfermóvil/EnZona, órdenes de depósito BCC Res. 111/2023 y gastos bancarizados.
10. **Tributos ONAT** — Liquidación Ley 113 (MIPYME DL 88/2024 y TCP DL 90/2024).
11. **Nómina y Comisiones** — Cálculo Ley 116, comisiones por ventas, retenciones y aportes.
12. **Contabilidad NCIF** — Diario, Mayor, Comprobación y Estado de Resultados de partida doble automática.
13. **Leyes e Inspección** — Auditoría preventiva y carpeta oficial de inspección.
- **Mis empresas / Afiliarme** (`kiosko-XXXXXX` con QR e invitaciones) y **Cerrar sesión**.

### Privacidad estricta por rol y trabajador
- **Jefe del Negocio**: acceso total, edición/aprobación global, costos, márgenes, auditoría y configuración de permisos por empleado.
- **Almacenero**: alta y entrada de mercancía, fotos, compatibilidad, pases y reporte de mermas; ve costo de entrada pero **no** valorización ni márgenes globales, y sus cambios de precio quedan como propuesta pendiente de aprobación del Jefe (salvo permiso explícito).
- **Dependiente / Cajero POS**: vende en mostrador, gestiona su caja/IPV y consulta stock/tablilla con foto y compatibilidad, **sin ver jamás costos de compra, márgenes ni proveedores**.
- **Catálogo público de clientes**: muestra solo foto, nombre, código, categoría, compatibilidad, precio público en CUP y disponibilidad.
- **Doble modo de ejecución**: servidor full-stack (`Express` + `node:sqlite`) o modo estático 100 % funcional en **GitHub Pages** con paridad completa y persistencia multi-empresa en el navegador.

## Demo interactiva incluida

Puedes probar la empresa demostrativa **Kiosko La Ceiba S.U.R.L.** desde la portada en un clic o con cualquiera de sus correos (contraseña `kiosko2026`, código de afiliación `kiosko-CEIBA1`):

| Puesto | Correo | Usuario |
| --- | --- | --- |
| Creador / Jefe | `alejandro@laceiba.cu` | `jefe` |
| Económica | `beatriz@laceiba.cu` | `economico` |
| Almacenero | `carlos@laceiba.cu` | `almacenero` |
| Vendedores Turno Mañana | `dayana@laceiba.cu` (Caja 1) · `ernesto@laceiba.cu` (Caja 2) | `vendedor1` · `vendedor2` |
| Vendedores Turno Tarde | `yaima@laceiba.cu` (Caja 1) · `luis@laceiba.cu` (Caja 2) | `vendedor3` · `vendedor4` |

## Ejecución local

```bash
npm install
npm run dev       # Servidor Express + SQLite + Vite en http://0.0.0.0:3000
npm test          # Suite automatizada de pruebas (14 escenarios E2E)
npm run build     # Compilación de producción en ./dist (lista para GitHub Pages)
npm start         # Servidor en producción sirviendo ./dist
```
