# Gestor de Kiosko — Sistema Integral Automatizado (Legislación Económica Cubana)

Aplicación web *full-stack* para la gestión automatizada de ventas, abastecimiento de almacén, personal por turnos y control económico-financiero de un kiosko o pequeño negocio en Cuba.

## Estructura de Puestos Soportada (Segregación de Funciones — Res. 60/22)

1. **Jefe del Negocio (`jefe`)**: Centro de control ejecutivo en tiempo real, monitor simultáneo de los 2 vendedores en turno, gestión de plantilla y turnos, aprobaciones en un clic (mermas, reabastecimientos, auditorías), configuración fiscal, bitácora de auditoría y expediente listo para inspecciones (ONAT, DIS, BCC, MTSS).
2. **Económico (`economico`)**: Bancarización y tesorería, conciliación automática de Transfermóvil y EnZona, órdenes de depósito en Cuenta Bancaria Fiscal, Fichas de Costo y Precios (MFP), liquidación de tributos ONAT por párrafos, nómina automatizada, gastos deducibles y contabilidad de partida doble (NCIF).
3. **Almacenero (`almacenero`)**: Custodia del Almacén Central, Informe de Recepción de proveedores (**SC-2-04**), despacho automático en 1 clic al mostrador del kiosko (**SC-2-09**), Submayor y Tarjeta de Estiba (**SC-2-14**) con rotación **FEFO** por vencimiento, y reporte de mermas (**SC-2-16**).
4. **2 Vendedores por Turno (`vendedor1` / `vendedor2` — Mañana; `vendedor3` / `vendedor4` — Tarde)**: Punto de Venta ágil en **CUP** con doble caja independiente (Caja 1 y Caja 2, máximo estricto de 2 vendedores activos por turno), cobro en Efectivo (con cálculo de vuelto), **Transfermóvil QR**, **EnZona QR** y pago mixto, **IPV (Informe de Producto a la Venta)** en vivo, pedidos a almacén y arqueo de cierre por denominación de billetes CUP (`1000` a `1` CUP).

## Marco Legal Económico Cubano Integrado

- **Formas de Gestión (DL 88/2024 MIPYMES y DL 90/2024 TCP)**: Preconfigurado como **Micro-MIPYME** (1 a 10 personas, exigido cuando la plantilla supera los 3 trabajadores contratados del TCP), con opción de alternar a **TCP Régimen General** y alerta/bloqueo legal automático.
- **Bancarización (Resolución 111/2023 del BCC)**: Moneda oficial CUP, pasarelas QR Transfermóvil y EnZona con bonificación configurable y conciliación bancaria, bloqueo automático de pagos en efectivo superiores a **5,000 CUP** a proveedores, y generación automática de órdenes de depósito bancario para el siguiente día hábil al cerrar cada turno.
- **Control de Precios y Fichas de Costo (Resolución 225/2024 MFP y Decreto 30/2021)**: Topes minoristas oficiales para los 6 productos básicos regulados (pollo troceado, aceite vegetal, leche en polvo, pastas alimenticias, salchichas y detergente en polvo), control automático del **margen comercial máximo del 30%** sobre costos y gastos reconocidos, y **Tablilla Oficial de Precios en CUP** lista para imprimir y exhibir en mostrador.
- **Sistema Tributario ONAT (Ley 113)**: Cálculo automático de Impuesto sobre las Ventas (**10%**), Contribución Territorial para el Desarrollo Local (**1%**), Impuesto por la Utilización de la Fuerza de Trabajo (**5%**), Contribución a la Seguridad Social (**14%** entidad + **5%** retención trabajador), escala progresiva mensual de Ingresos Personales (mínimo exento **3,260 CUP**), Impuesto sobre Utilidades (**35%**) y Reserva Legal para Pérdidas y Contingencias (**10%** hasta el 20% del capital social).
- **Código de Trabajo (Ley 116)**: Control de salario mínimo (**2,100 CUP/mes**), provisión automática del **9.09%** de vacaciones anuales pagadas, estímulo por ventas y registro de faltantes en caja (Cuenta 330 — Responsabilidad Material).
- **Contabilidad Cubana (NCIF)**: Generación automática de asientos de partida doble (Libro Diario y Balance de Comprobación) en cada operación.

> *Nota*: Todas las tasas tributarias, topes de precios y límites bancarios son configurables desde el módulo **Leyes e Inspección** para adaptarse a nuevas disposiciones de la Gaceta Oficial o acuerdos del Consejo de la Administración Municipal (CAM).

## Puesta en Marcha

### Opción 1: Servidor completo con base de datos SQLite (recomendado para operar en el kiosko)
```bash
npm install
npm run dev       # Servidor unificado (API + interfaz) en http://0.0.0.0:3000
npm test          # Pruebas automatizadas de API, roles y reglas legales cubanas
npm run build     # Compilación de producción
npm start         # Servidor en modo producción en http://0.0.0.0:3000
```
Luego abre `http://localhost:3000` en el navegador (o la IP local de la PC para que los 2 vendedores, el almacenero, el económico y el jefe entren desde sus teléfonos o tablets en la misma red Wi-Fi).

### Opción 2: Prueba directa en GitHub Pages (sin instalar servidor)
El proyecto incluye el flujo `.github/workflows/deploy-pages.yml` y un motor autónomo con persistencia en `localStorage` para probar el 100% de las funciones directamente desde el navegador:
1. Fusiona (*Merge*) el Pull Request hacia la rama `main`.
2. En GitHub ve a **Settings → Pages → Build and deployment → Source** y selecciona **GitHub Actions** *(en cuentas gratuitas de GitHub, el repositorio debe ser público para usar GitHub Pages)*.
3. Accede a `https://chaindev17.github.io/Gestor-de-Kiosko/`.

### Credenciales Iniciales de Demostración
- Usuarios: `jefe`, `economico`, `almacenero`, `vendedor1`, `vendedor2`, `vendedor3`, `vendedor4`
- Contraseña inicial: `kiosko2026` (también incluye acceso directo en 1 clic por puesto).
