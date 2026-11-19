# Gestor de Kiosko — Plataforma Multi-Empresa & Gestión Integral

Plataforma web integral de gestión automatizada para kioskos y comercios minoristas — con experiencia editorial inspirada en **Conecta** (`conecta.simplemente.com.uy`), **registro por correo electrónico**, **creación de empresas aisladas**, **afiliación por código (`kiosko-XXXXXX`)** y **control total del creador sobre cómo se maneja el software**.

## Novedades principales

- **Catálogo público con pedido directo a tu WhatsApp (`?tienda=kiosko-XXXXXX`)**:
  - Cada empresa cuenta con su link público y cartel QR imprimible para mostrador o redes sociales.
  - Tus clientes entran sin registrarse, filtran por categorías o destacados, arman su carrito, eligen **retiro en local** o **envío a domicilio** (con cálculo automático de envío gratis), indican cómo pagan (efectivo con cálculo exacto de vuelto o QR con bonificación) y envían el pedido perfectamente redactado directo a tu **WhatsApp**.
  - En tu panel **Catálogo WhatsApp** respondes al cliente en 1 clic, cambias el estado (*Nuevo → Preparando → Listo → Entregado*) y cobras descontando inventario y generando asiento contable con un solo toque.
- **Interfaz extremadamente intuitiva y adaptable al celular**:
  - Pantalla de inicio con accesos directos claros (*Cobrar venta*, *Catálogo WhatsApp*, *Productos y stock*, *Equipo y código*), navegación agrupada en lenguaje cotidiano, barra inferior táctil para celulares y alta rápida de productos en segundos.
- **Cuentas con correo electrónico**: registro, inicio de sesión, recuperación de contraseña y panel multi-empresa (*Tus Empresas*), permitiendo a una misma persona ser creadora de su negocio y/o afiliada a otros comercios.
- **Crear tu propia empresa en 3 pasos**: cada empresa recibe su propia base de datos aislada y un código único (`kiosko-XXXXXX`) con tarjeta QR imprimible, enlace directo (`?codigo=kiosko-XXXXXX`) y botón para compartir por WhatsApp.
- **Afiliarse a una empresa existente**: los trabajadores ingresan el código `kiosko-XXXXXX`, verifican el comercio en vivo y solicitan afiliación (para que el creador apruebe y asigne puesto, turno, caja y salario) o ingresan al instante con un código de invitación directa por rol/correo.
- **El creador decide cómo se maneja el software** (en el asistente inicial y en cualquier momento desde *Mi Empresa y Modo*):
  - **4 modos de gestión**: *Mostrador Ágil (Dueño en Caja)*, *Equipo Compacto*, *Kiosko Integral (2 Cajas por Turno)* y *A tu Medida*.
  - **Módulos activables/desactivables**: Punto de Venta (POS), Turnos e IPV, Almacén y Mermas, Precios y Fichas MFP, Bancarización y QR, Tributos ONAT, Nómina Ley 116, Contabilidad NCIF y Carpeta de Inspección.
  - **Estructura y reglas a medida**: de 1 a 6 cajas simultáneas por turno, turno único/doble/24h, dueño operando POS, cupos de puestos estrictos o flexibles, carné de identidad obligatorio u opcional, y automatizaciones/topes legales activables.
  - **Permisos granulares por rol**: decide exactamente qué pueden hacer vendedores, almaceneros y económicos.
- **Automatización comercial, tributaria y contable completa**: POS en CUP con cobro en efectivo, Transfermóvil, EnZona y Mixto; IPV en vivo; modelos SC-2-04, SC-2-09, SC-2-14 y SC-2-16; fichas de costo Res. 225/2024 MFP y tablilla Decreto 30/2021; Bancarización Res. 111/2023 BCC; tributos ONAT Ley 113 (MIPYME DL 88/2024 y TCP DL 90/2024); Nómina Ley 116; y contabilidad NCIF de partida doble automática.
- **Doble modo de ejecución**: servidor full-stack (`Express` + `node:sqlite`) o modo estático 100 % funcional en **GitHub Pages** con persistencia multi-empresa en el navegador.

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
npm test          # Suite automatizada de pruebas (9 escenarios E2E)
npm run build     # Compilación de producción en ./dist (lista para GitHub Pages)
npm start         # Servidor en producción sirviendo ./dist
```
