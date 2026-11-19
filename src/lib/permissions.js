// Granular permission model shared between Express backend, static GitHub Pages engine, and React UI.
// Every menu item carries { canView, canEdit, canApprove } plus operational/privacy flags.

export const MENU_SCHEMA = [
  {
    id: 'jefe-home',
    label: 'Inicio del Negocio',
    moduleKey: null,
    supportsApprove: true,
    description: 'Resumen ejecutivo del día, ventas por método de pago, cajas, alertas y accesos rápidos.',
  },
  {
    id: 'workspace-settings',
    label: 'Mi Empresa y Modo',
    moduleKey: null,
    supportsApprove: true,
    description: 'Razón social, NIT, cuentas bancarias, modo de operación, tasas de referencia y afiliados.',
  },
  {
    id: 'staff',
    label: 'Equipo y Turnos',
    moduleKey: null,
    supportsApprove: false,
    description: 'Alta y baja de trabajadores, roles, permisos granulares y programación de turnos.',
  },
  {
    id: 'pos',
    label: 'Mostrador (POS)',
    moduleKey: 'pos',
    supportsApprove: false,
    description: 'Venta directa, búsqueda por nombre/SKU/compatibilidad, cobros, comprobante y QR del catálogo.',
  },
  {
    id: 'shift-ipv',
    label: 'Turnos, Cajas e IPV',
    moduleKey: 'ipv',
    supportsApprove: true,
    description: 'Apertura con fondo, entradas/salidas de efectivo, IPV completo y arqueo con validación.',
  },
  {
    id: 'warehouse',
    label: 'Almacén y Stock',
    moduleKey: 'warehouse',
    supportsApprove: true,
    description: 'Inventario maestro, entradas y fichas con foto, traspasos al POS, mermas y trazabilidad.',
  },
  {
    id: 'pricing',
    label: 'Precios y Tablilla',
    moduleKey: 'pricing',
    supportsApprove: true,
    description: 'Precios de venta, costos y márgenes, publicación al catálogo, tablilla e historial de cambios.',
  },
  {
    id: 'catalog-wa',
    label: 'Catálogo y Pedidos',
    moduleKey: 'catalog',
    supportsApprove: false,
    description: 'Catálogo público para clientes, pedidos recibidos al WhatsApp, enlace y cartel QR.',
  },
  {
    id: 'banking',
    label: 'Cobros QR y Banco',
    moduleKey: 'banking',
    supportsApprove: true,
    description: 'Conciliación Transfermóvil y EnZona, cuentas fiscales/operativas, depósitos y gastos.',
  },
  {
    id: 'onat',
    label: 'Tributos ONAT',
    moduleKey: 'onat',
    supportsApprove: true,
    description: 'Calendario tributario ONAT, cálculo de impuestos por régimen, vencimientos y referencias de pago.',
  },
  {
    id: 'payroll',
    label: 'Nómina y Comisiones',
    moduleKey: 'payroll',
    supportsApprove: true,
    description: 'Salarios, turnos trabajados, comisiones por ventas, retenciones y cierre mensual de plantilla.',
  },
  {
    id: 'accounting',
    label: 'Contabilidad NCIF',
    moduleKey: 'accounting',
    supportsApprove: false,
    description: 'Libro diario de partida doble y balance de comprobación automático por cada operación.',
  },
  {
    id: 'compliance',
    label: 'Leyes e Inspección',
    moduleKey: 'compliance',
    supportsApprove: false,
    description: 'Carpeta de inspección normativa y bitácora de auditoría interna por usuario y operación.',
  },
];

export const PERMISSION_FLAGS_SCHEMA = [
  {
    key: 'view_costs',
    label: 'Ver costos de compra, márgenes y proveedores',
    hint: 'Desactivado para dependientes: solo ven foto, precio de venta y stock.',
  },
  {
    key: 'view_entry_cost',
    label: 'Ingresar costo unitario al registrar entradas',
    hint: 'Permite cargar el costo en una recepción de almacén sin ver finanzas globales.',
  },
  {
    key: 'edit_prices',
    label: 'Modificar precios de venta finales sin aprobación',
    hint: 'Si está apagado, cualquier cambio de precio queda pendiente de aprobación del Jefe.',
  },
  {
    key: 'upload_photos',
    label: 'Subir/actualizar fotos, descripción y compatibilidad',
    hint: 'Permite editar la ficha comercial del producto al dar entrada o en inventario.',
  },
  {
    key: 'publish_catalog',
    label: 'Publicar u ocultar productos en el Catálogo público',
    hint: 'Controla el interruptor "Mostrar en Catálogo público".',
  },
  {
    key: 'register_mermas',
    label: 'Registrar y justificar mermas (SC-2-16)',
    hint: 'Reporta bajas por rotura o vencimiento sujetas a aprobación del Jefe.',
  },
  {
    key: 'cash_movements',
    label: 'Registrar entradas y salidas de efectivo en caja',
    hint: 'Permite asentar cambio, extracciones o ingresos operativos en su turno con motivo.',
  },
];

const NO_ACCESS = { canView: false, canEdit: false, canApprove: false };
const FULL_ACCESS = { canView: true, canEdit: true, canApprove: true };

export function parseUserPermissionsJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getRoleDefaultMatrix(role, config = null) {
  const perms = config?.permissions || {};
  const items = {};
  for (const m of MENU_SCHEMA) {
    items[m.id] = { ...NO_ACCESS };
  }

  if (role === 'jefe') {
    for (const m of MENU_SCHEMA) {
      items[m.id] = {
        canView: true,
        canEdit: true,
        canApprove: Boolean(m.supportsApprove),
      };
    }
    return {
      items,
      flags: {
        view_costs: true,
        view_entry_cost: true,
        edit_prices: true,
        upload_photos: true,
        publish_catalog: true,
        register_mermas: true,
        cash_movements: true,
      },
    };
  }

  if (role === 'economico') {
    const canPrice = perms.economico_edit_prices_directly !== false;
    const canMerma = perms.economico_approve_mermas !== false;
    const canCfg = perms.economico_manage_config !== false;

    items['jefe-home'] = { canView: false, canEdit: false, canApprove: false };
    items['banking'] = { canView: true, canEdit: true, canApprove: true };
    items['pricing'] = { canView: true, canEdit: canPrice, canApprove: false };
    items['catalog-wa'] = { canView: true, canEdit: canPrice, canApprove: false };
    items['onat'] = { canView: true, canEdit: true, canApprove: true };
    items['payroll'] = { canView: true, canEdit: true, canApprove: true };
    items['accounting'] = { canView: true, canEdit: true, canApprove: false };
    items['shift-ipv'] = { canView: true, canEdit: false, canApprove: true };
    items['warehouse'] = { canView: true, canEdit: false, canApprove: canMerma };
    items['compliance'] = { canView: true, canEdit: canCfg, canApprove: false };

    return {
      items,
      flags: {
        view_costs: true,
        view_entry_cost: true,
        edit_prices: canPrice,
        upload_photos: true,
        publish_catalog: true,
        register_mermas: false,
        cash_movements: false,
      },
    };
  }

  if (role === 'almacenero') {
    const canViewPrice = perms.almacenero_view_pricelist !== false;
    const canViewComp = perms.almacenero_view_compliance !== false;
    const canEditPrice = Boolean(perms.almacenero_edit_prices);

    items['warehouse'] = { canView: true, canEdit: true, canApprove: false };
    items['pricing'] = { canView: canViewPrice, canEdit: canEditPrice, canApprove: false };
    items['catalog-wa'] = { canView: true, canEdit: true, canApprove: false };
    items['compliance'] = { canView: canViewComp, canEdit: false, canApprove: false };

    return {
      items,
      flags: {
        view_costs: false, // Does NOT see global financial profits/margins by default
        view_entry_cost: true, // Can enter acquisition cost on warehouse reception
        edit_prices: canEditPrice, // Cannot alter final sale prices without Jefe approval by default
        upload_photos: true, // Can upload/update photo, description & compatibility
        publish_catalog: true, // Can toggle "Mostrar en Catálogo público" on entry
        register_mermas: true, // Can report mermas SC-2-16 for Jefe approval
        cash_movements: false,
      },
    };
  }

  // vendedor (Dependiente / Cajero de Mostrador)
  const canViewPrice = perms.vendedor_view_pricelist !== false;
  const canOrders = perms.vendedor_manage_orders !== false;
  const canViewStock = perms.vendedor_view_stock !== false;

  items['pos'] = { canView: true, canEdit: true, canApprove: false };
  items['shift-ipv'] = { canView: true, canEdit: true, canApprove: false };
  // Read-only basic stock lookup (photo, compatibility, price & availability — NO costs or suppliers!)
  items['warehouse'] = { canView: canViewStock, canEdit: false, canApprove: false };
  items['pricing'] = { canView: canViewPrice, canEdit: false, canApprove: false };
  items['catalog-wa'] = { canView: canOrders, canEdit: canOrders, canApprove: false };

  return {
    items,
    flags: {
      view_costs: false,
      view_entry_cost: false,
      edit_prices: false,
      upload_photos: false,
      publish_catalog: false,
      register_mermas: true,
      cash_movements: true,
    },
  };
}

export function buildUserPermissions(user, config = null) {
  if (!user) return { items: {}, flags: {}, hasCustomOverrides: false };

  const mods = config?.modules || {};
  const isModuleEnabled = (moduleKey) => !moduleKey || mods[moduleKey] !== false;

  // Jefe del Negocio ALWAYS retains full access to every enabled module and full privacy visibility
  if (user.role === 'jefe') {
    const items = {};
    for (const m of MENU_SCHEMA) {
      const enabled = m.moduleKey === 'pos' ? true : isModuleEnabled(m.moduleKey);
      items[m.id] = enabled
        ? { ...FULL_ACCESS, canApprove: Boolean(m.supportsApprove) }
        : { ...NO_ACCESS };
    }
    return {
      items,
      flags: {
        view_costs: true,
        view_entry_cost: true,
        edit_prices: true,
        upload_photos: true,
        publish_catalog: true,
        register_mermas: true,
        cash_movements: true,
      },
      hasCustomOverrides: false,
    };
  }

  const base = getRoleDefaultMatrix(user.role, config);
  const custom = parseUserPermissionsJson(user.permissions_json || user.custom_permissions);
  const customItems = custom?.items && typeof custom.items === 'object' ? custom.items : {};
  const customFlags = custom?.flags && typeof custom.flags === 'object' ? custom.flags : {};

  const hasCustomOverrides =
    Object.keys(customItems).length > 0 || Object.keys(customFlags).length > 0;

  const items = {};
  for (const m of MENU_SCHEMA) {
    const enabled = isModuleEnabled(m.moduleKey);
    if (!enabled) {
      items[m.id] = { ...NO_ACCESS };
      continue;
    }
    const b = base.items[m.id] || NO_ACCESS;
    const ov = customItems[m.id];
    if (ov && typeof ov === 'object') {
      const canApprove = Boolean(m.supportsApprove && ov.canApprove);
      const canEdit = Boolean(ov.canEdit);
      const canView = Boolean(ov.canView || canEdit || canApprove);
      items[m.id] = { canView, canEdit, canApprove };
    } else {
      items[m.id] = { ...b };
    }
  }

  const flags = { ...base.flags };
  for (const f of PERMISSION_FLAGS_SCHEMA) {
    if (customFlags[f.key] !== undefined) {
      flags[f.key] = Boolean(customFlags[f.key]);
    }
  }
  // If user can view full costs, they can also input entry cost
  if (flags.view_costs) flags.view_entry_cost = true;

  return { items, flags, hasCustomOverrides };
}

export function canUserAccess(user, config, menuId, level = 'canView') {
  if (!user) return false;
  if (user.role === 'jefe') {
    const def = MENU_SCHEMA.find((m) => m.id === menuId);
    if (!def) return false;
    if (def.moduleKey && def.moduleKey !== 'pos' && config?.modules?.[def.moduleKey] === false) {
      return false;
    }
    return true;
  }
  const matrix = user.permissions_matrix || buildUserPermissions(user, config);
  return Boolean(matrix?.items?.[menuId]?.[level]);
}

export function hasPermissionFlag(user, config, flagKey) {
  if (!user) return false;
  if (user.role === 'jefe') return true;
  const matrix = user.permissions_matrix || buildUserPermissions(user, config);
  return Boolean(matrix?.flags?.[flagKey]);
}
