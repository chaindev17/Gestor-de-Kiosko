/**
 * Capa multi-empresa en navegador (para despliegues estáticos como GitHub Pages).
 * Gestiona registro e inicio de sesión por correo electrónico, creación de empresas aisladas,
 * códigos de afiliación kiosko-XXXXXX, invitaciones directas por cargo y configuración del creador.
 */
import {
  enrichUser,
  getBadges,
  handleStaticApi as handleTenantApi,
  loadState,
  saveState,
  setActiveStaticTenant,
} from './staticEngine.js';
import {
  buildWhatsappUrl,
  formatCustomerReplyWhatsapp,
  formatOrderWhatsappMessage,
  sanitizeWhatsappDigits,
} from './whatsapp.js';

const PLATFORM_KEY = 'gestor_kiosko_platform_v2';
const DEMO_TENANT_KEY = 'gestor_kiosko_cuba_state_v1';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const STATIC_DEFAULT_MODULES = {
  pos: true,
  catalog: true,
  ipv: true,
  warehouse: true,
  pricing: true,
  banking: true,
  onat: true,
  payroll: true,
  accounting: true,
  compliance: true,
};

export const STATIC_DEFAULT_PERMISSIONS = {
  vendedor_manage_orders: true,
  vendedor_request_restock: true,
  vendedor_view_pricelist: true,
  vendedor_open_shift: true,
  almacenero_create_products: true,
  almacenero_view_pricelist: true,
  almacenero_view_compliance: true,
  economico_edit_prices_directly: true,
  economico_approve_mermas: true,
  economico_manage_config: true,
};

export const STATIC_PRESETS = {
  kiosko_completo: {
    id: 'kiosko_completo',
    name: 'Kiosko Integral',
    tagline: 'Equipo por puestos, doble caja y control fiscal completo',
    max_sellers_per_shift: 2,
    owner_can_operate_pos: 0,
    flexible_role_limits: 0,
    require_cuban_ci: 1,
    auto_restock_enabled: 1,
    auto_accounting_enabled: 1,
    auto_deposit_order_enabled: 1,
    strict_price_cap_block: 1,
    strict_bancarizacion_block: 1,
    modules: { ...STATIC_DEFAULT_MODULES },
    permissions: { ...STATIC_DEFAULT_PERMISSIONS },
  },
  equipo_compacto: {
    id: 'equipo_compacto',
    name: 'Equipo Compacto',
    tagline: 'Ventas, turnos, stock, precios y cobros QR sin complejidad extra',
    max_sellers_per_shift: 2,
    owner_can_operate_pos: 1,
    flexible_role_limits: 1,
    require_cuban_ci: 0,
    auto_restock_enabled: 1,
    auto_accounting_enabled: 1,
    auto_deposit_order_enabled: 1,
    strict_price_cap_block: 1,
    strict_bancarizacion_block: 0,
    modules: {
      pos: true,
      catalog: true,
      ipv: true,
      warehouse: true,
      pricing: true,
      banking: true,
      onat: true,
      payroll: false,
      accounting: false,
      compliance: false,
    },
    permissions: { ...STATIC_DEFAULT_PERMISSIONS },
  },
  solo_dueno: {
    id: 'solo_dueno',
    name: 'Mostrador Ágil',
    tagline: 'Empieza operando tú mismo y suma afiliados cuando crezcas',
    max_sellers_per_shift: 1,
    owner_can_operate_pos: 1,
    flexible_role_limits: 1,
    require_cuban_ci: 0,
    auto_restock_enabled: 1,
    auto_accounting_enabled: 1,
    auto_deposit_order_enabled: 0,
    strict_price_cap_block: 0,
    strict_bancarizacion_block: 0,
    modules: {
      pos: true,
      catalog: true,
      ipv: true,
      warehouse: true,
      pricing: true,
      banking: true,
      onat: false,
      payroll: false,
      accounting: false,
      compliance: false,
    },
    permissions: { ...STATIC_DEFAULT_PERMISSIONS },
  },
  a_medida: {
    id: 'a_medida',
    name: 'A mi medida',
    tagline: 'El creador elige cada módulo, regla y permiso manualmente',
    max_sellers_per_shift: 2,
    owner_can_operate_pos: 1,
    flexible_role_limits: 1,
    require_cuban_ci: 0,
    auto_restock_enabled: 1,
    auto_accounting_enabled: 1,
    auto_deposit_order_enabled: 1,
    strict_price_cap_block: 1,
    strict_bancarizacion_block: 1,
    modules: { ...STATIC_DEFAULT_MODULES },
    permissions: { ...STATIC_DEFAULT_PERMISSIONS },
  },
};

const r2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;
const todayIso = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normEmail(e));

function fail(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  throw e;
}

function normCode(raw) {
  const c = String(raw || '').trim().replace(/\s+/g, '');
  if (!c) return '';
  if (/^kiosko-/i.test(c)) return `kiosko-${c.slice(7).toUpperCase()}`;
  if (/^conecta-/i.test(c)) return `kiosko-${c.slice(8).toUpperCase()}`;
  return `kiosko-${c.replace(/^[-_]+/, '').toUpperCase()}`;
}

function genCode(plat, prefix = '') {
  let s = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2);
  while (s.length < 6) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  const cand = `kiosko-${s}`;
  if (
    plat.companies.some((c) => c.company_code.toUpperCase() === cand.toUpperCase()) ||
    plat.invites.some((i) => i.code.toUpperCase() === cand.toUpperCase())
  ) {
    return genCode(plat, prefix);
  }
  return cand;
}

function initPlatformState() {
  const demo = loadState(DEMO_TENANT_KEY);
  const emailMap = {
    jefe: 'alejandro@laceiba.cu',
    economico: 'beatriz@laceiba.cu',
    almacenero: 'carlos@laceiba.cu',
    vendedor1: 'dayana@laceiba.cu',
    vendedor2: 'ernesto@laceiba.cu',
    vendedor3: 'yaima@laceiba.cu',
    vendedor4: 'luis@laceiba.cu',
  };
  const accounts = [];
  const memberships = [];
  let accSeq = 1;
  let memSeq = 1;

  demo.users.forEach((u) => {
    const email = emailMap[u.username];
    if (!email) return;
    u.email = email;
    const aid = accSeq++;
    accounts.push({
      id: aid,
      email,
      pw: u.pw || 'kiosko2026',
      full_name: u.full_name,
      ci: u.ci || '',
      phone: u.phone || '',
      recovery_code: '',
      created_at: nowIso(),
    });
    memberships.push({
      id: memSeq++,
      company_id: 1,
      account_id: aid,
      tenant_user_id: u.id,
      role: u.role,
      status: 'ACTIVO',
      requested_role: u.role,
      requested_ci: u.ci || '',
      requested_phone: u.phone || '',
      request_note: '',
      invite_code_used: 'kiosko-CEIBA1',
      created_at: nowIso(),
      decided_at: nowIso(),
    });
  });
  saveState(demo, DEMO_TENANT_KEY);

  return {
    seq: { account: accSeq, company: 2, membership: memSeq, invite: 1 },
    session: { accountId: null, companyId: null, userId: null },
    accounts,
    companies: [
      {
        id: 1,
        company_code: 'kiosko-CEIBA1',
        name: demo.config.business_name,
        business_type: 'Kiosko y Comercio Minorista',
        legal_form: demo.config.legal_form,
        municipality: demo.config.municipality,
        province: demo.config.province,
        owner_account_id: 1,
        storage_key: DEMO_TENANT_KEY,
        is_demo: true,
        join_mode: 'APPROVAL',
        active: true,
        created_at: nowIso(),
      },
    ],
    invites: [],
    memberships,
  };
}

function loadPlatform() {
  try {
    const raw = window.localStorage.getItem(PLATFORM_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  const fresh = initPlatformState();
  savePlatform(fresh);
  return fresh;
}

function savePlatform(plat) {
  try {
    window.localStorage.setItem(PLATFORM_KEY, JSON.stringify(plat));
  } catch {
    // ignore
  }
}

function safeAccount(a) {
  if (!a) return null;
  const { pw: _pw, recovery_code: _rc, ...rest } = a;
  return rest;
}

function companySummary(c) {
  if (!c) return null;
  return {
    id: c.id,
    company_code: c.company_code,
    name: c.name,
    business_type: c.business_type,
    legal_form: c.legal_form,
    municipality: c.municipality,
    province: c.province,
    is_demo: Boolean(c.is_demo),
    join_mode: c.join_mode,
    owner_account_id: c.owner_account_id,
  };
}

function pendingCount(plat, companyId) {
  return plat.memberships.filter((m) => m.company_id === companyId && m.status === 'PENDIENTE').length;
}

function membershipsFor(plat, accountId) {
  if (!accountId) return [];
  return plat.memberships
    .filter((m) => m.account_id === accountId)
    .map((m) => {
      const c = plat.companies.find((x) => x.id === m.company_id && x.active);
      if (!c) return null;
      return {
        membership_id: m.id,
        company_id: c.id,
        tenant_user_id: m.tenant_user_id,
        role: m.role,
        status: m.status,
        requested_role: m.requested_role,
        request_note: m.request_note,
        invite_code_used: m.invite_code_used,
        created_at: m.created_at,
        decided_at: m.decided_at,
        company_code: c.company_code,
        company_name: c.name,
        business_type: c.business_type,
        legal_form: c.legal_form,
        municipality: c.municipality,
        province: c.province,
        is_demo: Boolean(c.is_demo),
        owner_account_id: c.owner_account_id,
        is_owner: c.owner_account_id === accountId ? 1 : 0,
        pending_affiliations: pendingCount(plat, c.id),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.status === 'ACTIVO' ? -1 : 1) - (b.status === 'ACTIVO' ? -1 : 1));
}

function createTenantUser(ts, acc, opts = {}) {
  const role = opts.role || 'vendedor';
  const salary = Math.max(Number(ts.config.min_wage_cup || 2100), r2(opts.base_salary_cup || 6500));
  const maxS = Math.max(1, Number(ts.config.max_sellers_per_shift || 2));
  let shiftId = null;
  let regNum = null;
  if (role === 'vendedor') {
    const sh =
      ts.shifts.find((x) => x.id === Number(opts.shift_template_id)) || ts.shifts[0] || null;
    if (sh) {
      shiftId = sh.id;
      const taken = new Set(
        ts.users
          .filter((u) => u.active && u.role === 'vendedor' && u.shift_template_id === sh.id)
          .map((u) => u.default_register)
      );
      const want = Number(opts.default_register || 1);
      regNum =
        !taken.has(want) && want <= maxS
          ? want
          : Array.from({ length: Math.max(maxS, 6) }, (_, i) => i + 1).find((n) => !taken.has(n)) || 1;
    }
  }
  const baseU = acc.email.split('@')[0].replace(/[^a-z0-9._-]/gi, '').slice(0, 18) || role;
  let username = baseU;
  let n = 1;
  while (ts.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    n += 1;
    username = `${baseU}${n}`;
  }
  const id = ts.seq.user++;
  ts.users.push({
    id,
    username,
    email: acc.email,
    pw: acc.pw,
    full_name: acc.full_name,
    ci: String(opts.ci || acc.ci || '00000000000').trim(),
    nit_personal: String(opts.ci || acc.ci || '00000000000').trim(),
    role,
    shift_template_id: shiftId,
    default_register: regNum,
    contract_type: opts.contract_type || 'Indeterminado',
    contract_date: todayIso(),
    base_salary_cup: salary,
    sales_commission_pct: role === 'vendedor' ? Number(opts.sales_commission_pct || 1.0) : 0,
    phone: String(opts.phone || acc.phone || '').trim(),
    active: 1,
    created_at: nowIso(),
  });
  return id;
}

function buildCustomCompanyState(acc, companyCode, body = {}) {
  const presetKey = STATIC_PRESETS[body.management_preset] ? body.management_preset : 'kiosko_completo';
  const preset = STATIC_PRESETS[presetKey];
  const name = String(body.business_name || body.name || '').trim();
  const legalForm = body.legal_form === 'TCP' ? 'TCP' : 'MIPYME';
  const businessType = String(body.business_type || 'Kiosko y Comercio Minorista').trim();
  const municipality = String(body.municipality || 'Plaza de la Revolución').trim();
  const province = String(body.province || 'La Habana').trim();
  const maxSellers = Math.max(1, Math.min(6, Number(body.max_sellers_per_shift ?? preset.max_sellers_per_shift ?? 2)));
  const capital = Math.max(10000, r2(body.social_capital_cup ?? 150000));
  const pettyCash = Math.max(0, r2(body.petty_cash_fund_cup ?? 3000));
  const joinMode = body.join_mode === 'AUTO' ? 'AUTO' : 'APPROVAL';

  const modules = {
    ...STATIC_DEFAULT_MODULES,
    ...preset.modules,
    ...(body.modules || {}),
    pos: true,
  };
  const permissions = {
    ...STATIC_DEFAULT_PERMISSIONS,
    ...preset.permissions,
    ...(body.permissions || {}),
  };

  const shiftMode = body.shift_mode || 'double';
  const shifts =
    shiftMode === 'single'
      ? [{ id: 1, code: 'UNICO', name: 'Turno Único', start_time: '08:00', end_time: '20:00', required_sellers: maxSellers, active: 1 }]
      : shiftMode === 'triple'
      ? [
          { id: 1, code: 'MANANA', name: 'Turno Mañana', start_time: '06:00', end_time: '14:00', required_sellers: maxSellers, active: 1 },
          { id: 2, code: 'TARDE', name: 'Turno Tarde', start_time: '14:00', end_time: '22:00', required_sellers: maxSellers, active: 1 },
          { id: 3, code: 'NOCHE', name: 'Turno Noche', start_time: '22:00', end_time: '06:00', required_sellers: maxSellers, active: 1 },
        ]
      : [
          { id: 1, code: 'MANANA', name: 'Turno Mañana', start_time: '07:00', end_time: '15:00', required_sellers: maxSellers, active: 1 },
          { id: 2, code: 'TARDE', name: 'Turno Tarde', start_time: '15:00', end_time: '23:00', required_sellers: maxSellers, active: 1 },
        ];

  const s = {
    currentUserId: 1,
    seq: { user: 1, prod: 1, session: 1, reg: 1, ipv: 1, mov: 1, restock: 1, sale: 1, dep: 1, exp: 1, journal: 1, payroll: 1, pcr: 1, auto: 1, audit: 1 },
    config: {
      company_code: companyCode,
      business_name: name,
      business_type: businessType,
      management_preset: presetKey,
      legal_form: legalForm,
      nit: String(body.nit || '').trim() || '50000000001',
      reeup_code: '',
      municipality,
      province,
      address: String(body.address || `${municipality}, ${province}`).trim(),
      activity_description: `${businessType} — Gestionado por ${acc.full_name}`,
      whatsapp_phone: String(body.whatsapp_phone || acc.phone || '').trim(),
      contact_email: acc.email,
      join_mode: joinMode,
      flexible_role_limits: body.flexible_role_limits !== undefined ? (body.flexible_role_limits ? 1 : 0) : preset.flexible_role_limits,
      require_cuban_ci: body.require_cuban_ci !== undefined ? (body.require_cuban_ci ? 1 : 0) : preset.require_cuban_ci,
      owner_can_operate_pos: body.owner_can_operate_pos !== undefined ? (body.owner_can_operate_pos ? 1 : 0) : preset.owner_can_operate_pos,
      modules,
      permissions,
      bank_name: String(body.bank_name || 'Banco Metropolitano (BANMET)').trim(),
      fiscal_account_cup: String(body.fiscal_account_cup || '0598000000000001').trim(),
      fiscal_account_titular: name,
      transfermovil_phone: String(body.transfermovil_phone || body.whatsapp_phone || '+53 50000000').trim(),
      transfermovil_merchant_code: String(body.transfermovil_merchant_code || `TM-${companyCode.slice(-4)}`).trim(),
      enzona_merchant_code: String(body.enzona_merchant_code || `EZ-${companyCode.slice(-4)}`).trim(),
      qr_discount_pct: 2.0,
      social_capital_cup: capital,
      legal_reserve_balance_cup: 0,
      petty_cash_fund_cup: pettyCash,
      max_cash_provider_payment_cup: 5000,
      max_vault_cash_before_deposit_cup: 8000,
      max_sellers_per_shift: maxSellers,
      min_wage_cup: 2100,
      sales_tax_pct: 10.0,
      local_dev_tax_pct: 1.0,
      labor_force_tax_pct: 5.0,
      employer_ss_pct: 14.0,
      worker_ss_pct: 5.0,
      vacation_provision_pct: 9.09,
      profit_tax_pct: 35.0,
      legal_reserve_pct: 10.0,
      iip_exempt_monthly_cup: 3260,
      max_regulated_margin_pct: 30.0,
      indirect_cost_alloc_pct: 8.0,
      auto_restock_enabled: body.auto_restock_enabled !== undefined ? (body.auto_restock_enabled ? 1 : 0) : preset.auto_restock_enabled,
      auto_accounting_enabled: body.auto_accounting_enabled !== undefined ? (body.auto_accounting_enabled ? 1 : 0) : preset.auto_accounting_enabled,
      auto_deposit_order_enabled: body.auto_deposit_order_enabled !== undefined ? (body.auto_deposit_order_enabled ? 1 : 0) : preset.auto_deposit_order_enabled,
      strict_price_cap_block: body.strict_price_cap_block !== undefined ? (body.strict_price_cap_block ? 1 : 0) : preset.strict_price_cap_block,
      strict_bancarizacion_block: body.strict_bancarizacion_block !== undefined ? (body.strict_bancarizacion_block ? 1 : 0) : preset.strict_bancarizacion_block,
    },
    shifts,
    users: [],
    products: [],
    sessions: [],
    registers: [],
    ipvs: [],
    movements: [],
    restocks: [],
    sales: [],
    deposits: [],
    expenses: [],
    journal: [],
    payrolls: [],
    taxes: [],
    priceHistory: [],
    automations: [],
    audits: [],
  };

  const ownerId = createTenantUser(s, acc, {
    role: 'jefe',
    base_salary_cup: 12000,
    contract_type: legalForm === 'MIPYME' ? 'Socio Administrador' : 'Titular TCP',
    ci: body.owner_ci || acc.ci || '85010112345',
    phone: s.config.whatsapp_phone,
  });
  s.currentUserId = ownerId;

  const cashPart = Math.min(r2(pettyCash * maxSellers), r2(capital * 0.2));
  const bankPart = r2(capital - cashPart);
  s.journal.push({
    id: s.seq.journal++,
    entry_number: 'AST-00001',
    entry_date: todayIso(),
    source_type: 'APERTURA',
    source_ref: 'ACTA-001',
    description: `Apertura inicial de ${name}`,
    total_debit_cup: capital,
    total_credit_cup: capital,
    auto_generated: 1,
    created_by: ownerId,
    created_at: nowIso(),
    lines: [
      { account_code: '110', account_name: 'Efectivo en Banco — Cuenta Bancaria Fiscal (CUP)', debit_cup: bankPart, credit_cup: 0 },
      { account_code: '102', account_name: 'Efectivo en Caja — Turnos y Cambio (CUP)', debit_cup: cashPart, credit_cup: 0 },
      { account_code: '600', account_name: 'Capital Social / Patrimonio', debit_cup: 0, credit_cup: capital },
    ],
  });

  if ((body.seed_catalog || 'starter') === 'starter') {
    const future = (d) => {
      const dt = new Date(`${todayIso()}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + d);
      return dt.toISOString().slice(0, 10);
    };
    const starter = [
      ['BAS-001', 'Pollo troceado (paq. 1 kg)', 'Básicos Regulados', 'kg', 510, 675, 1, 680, 30, 15],
      ['BAS-002', 'Aceite vegetal 1L', 'Básicos Regulados', 'L', 740, 980, 1, 990, 24, 12],
      ['BAS-003', 'Leche en polvo entera 1 kg', 'Básicos Regulados', 'kg', 1240, 1650, 1, 1675, 14, 6],
      ['ALI-004', 'Arroz blanco grano largo 1 kg', 'Alimentos y Despensa', 'kg', 340, 460, 0, null, 40, 20],
      ['BEB-005', 'Malta lata 355 ml', 'Bebidas y Refrescos', 'u', 210, 285, 0, null, 48, 24],
      ['BEB-006', 'Refresco de Cola 1.5L', 'Bebidas y Refrescos', 'u', 270, 365, 0, null, 30, 14],
      ['CON-007', 'Galletas dulces rellenas 250g', 'Confituras y Panadería', 'paq', 195, 265, 0, null, 36, 18],
    ];
    let whV = 0;
    let kV = 0;
    starter.forEach(([sku, pname, category, unit, cost, price, capFlag, cap, wh, kiosk], i) => {
      s.products.push({
        id: s.seq.prod++,
        sku,
        name: pname,
        category,
        unit,
        unit_cost_cup: cost,
        indirect_cost_pct: 8,
        sale_price_cup: price,
        is_price_capped: capFlag,
        price_cap_cup: cap,
        price_cap_resolution: capFlag ? 'Res. 225/2024 MFP' : '',
        is_margin_regulated: 1,
        sales_tax_exempt: 0,
        warehouse_stock: wh,
        kiosk_stock: kiosk,
        warehouse_min_stock: 10,
        kiosk_min_stock: 5,
        kiosk_target_stock: 20,
        current_batch: `LT-INI-0${i + 1}`,
        next_expiry_date: future(120 + i * 15),
        active: 1,
      });
      whV = r2(whV + wh * cost);
      kV = r2(kV + kiosk * cost);
    });
    const tot = r2(whV + kV);
    const paid = Math.min(r2(bankPart * 0.6), tot);
    const cred = r2(tot - paid);
    s.journal.push({
      id: s.seq.journal++,
      entry_number: 'AST-00002',
      entry_date: todayIso(),
      source_type: 'RECEPCION',
      source_ref: 'SC204-INI',
      description: 'Inventario inicial de catálogo base',
      total_debit_cup: tot,
      total_credit_cup: tot,
      auto_generated: 1,
      created_by: ownerId,
      created_at: nowIso(),
      lines: [
        { account_code: '189', account_name: 'Mercancías para la Venta — Almacén', debit_cup: whV, credit_cup: 0 },
        { account_code: '190', account_name: 'Mercancías para la Venta — Área de Kiosko', debit_cup: kV, credit_cup: 0 },
        ...(paid > 0 ? [{ account_code: '110', account_name: 'Efectivo en Banco — Cuenta Bancaria Fiscal (CUP)', debit_cup: 0, credit_cup: paid }] : []),
        ...(cred > 0 ? [{ account_code: '405', account_name: 'Cuentas por Pagar a Proveedores', debit_cup: 0, credit_cup: cred }] : []),
      ],
    });
  }

  s.automations.push({
    id: s.seq.auto++,
    category: 'EMPRESA',
    severity: 'INFO',
    title: `Empresa creada — Código ${companyCode}`,
    detail: `Modo "${preset.name}" listo. Comparte el código ${companyCode} para afiliar a tu equipo.`,
    ref_code: companyCode,
    created_at: nowIso(),
  });
  s.audits.push({
    id: s.seq.audit++,
    user_id: ownerId,
    user_name: acc.full_name,
    user_role: 'jefe',
    action: 'CREACION_EMPRESA',
    module: 'Mi Empresa',
    detail: `Empresa "${name}" creada por ${acc.email} con código ${companyCode}.`,
    created_at: nowIso(),
  });

  return { state: s, ownerId };
}

export function handleStaticPlatformApi(method, rawPath, body = {}) {
  const plat = loadPlatform();
  const url = new URL(rawPath, 'http://local');
  const p = url.pathname;

  const commit = (res) => {
    savePlatform(plat);
    return res;
  };

  const curAcc = plat.accounts.find((a) => a.id === plat.session.accountId) || null;
  const curComp = plat.companies.find((c) => c.id === plat.session.companyId && c.active) || null;

  // --- Platform routes ---
  if (p === '/api/platform/presets') {
    return {
      presets: STATIC_PRESETS,
      default_modules: STATIC_DEFAULT_MODULES,
      default_permissions: STATIC_DEFAULT_PERMISSIONS,
    };
  }

  if (p === '/api/platform/register' && method === 'POST') {
    const name = String(body.full_name || '').trim();
    const email = normEmail(body.email);
    const pw = String(body.password || '');
    if (name.length < 2) fail('Escribe tu nombre y apellido.');
    if (!validEmail(email)) fail('Ingresa un correo electrónico válido.');
    if (pw.length < 6) fail('La contraseña debe tener al menos 6 caracteres.');
    if (plat.accounts.some((a) => a.email === email)) {
      fail('Ya existe una cuenta con ese correo electrónico. Inicia sesión para entrar.', 409);
    }
    const id = plat.seq.account++;
    const acc = {
      id,
      email,
      pw,
      full_name: name,
      ci: String(body.ci || '').trim(),
      phone: String(body.phone || '').trim(),
      recovery_code: '',
      created_at: nowIso(),
    };
    plat.accounts.push(acc);
    plat.session = { accountId: id, companyId: null, userId: null };
    return commit({
      token: `static-acc-${id}`,
      account: safeAccount(acc),
      memberships: [],
      active_company: null,
      user: null,
      config: null,
      badges: {},
    });
  }

  if (p === '/api/platform/login' && method === 'POST') {
    const email = normEmail(body.email);
    const acc = plat.accounts.find((a) => a.email === email);
    if (!acc || acc.pw !== String(body.password || '')) {
      fail('Correo electrónico o contraseña incorrectos.', 401);
    }
    const mems = membershipsFor(plat, acc.id);
    const active = mems.filter((m) => m.status === 'ACTIVO' && m.tenant_user_id);
    if (!body.open_hub && active.length === 1) {
      const comp = plat.companies.find((c) => c.id === active[0].company_id);
      const ts = loadState(comp.storage_key);
      const tu = ts.users.find((u) => u.id === active[0].tenant_user_id && u.active);
      if (comp && tu) {
        ts.currentUserId = tu.id;
        saveState(ts, comp.storage_key);
        plat.session = { accountId: acc.id, companyId: comp.id, userId: tu.id };
        return commit({
          token: `static-${acc.id}-${comp.id}-${tu.id}`,
          account: safeAccount(acc),
          memberships: mems,
          active_company: companySummary(comp),
          user: enrichUser(ts, tu),
          config: ts.config,
          badges: getBadges(ts, pendingCount(plat, comp.id)),
        });
      }
    }
    plat.session = { accountId: acc.id, companyId: null, userId: null };
    return commit({
      token: `static-acc-${acc.id}`,
      account: safeAccount(acc),
      memberships: mems,
      active_company: null,
      user: null,
      config: null,
      badges: {},
    });
  }

  if (p === '/api/platform/forgot-password' && method === 'POST') {
    const email = normEmail(body.email);
    const acc = plat.accounts.find((a) => a.email === email);
    if (!acc) fail('No encontramos ninguna cuenta registrada con ese correo.', 404);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    acc.recovery_code = code;
    return commit({
      ok: true,
      email,
      verification_code_preview: code,
      message: 'Código de recuperación generado.',
    });
  }

  if (p === '/api/platform/reset-password' && method === 'POST') {
    const email = normEmail(body.email);
    const acc = plat.accounts.find((a) => a.email === email);
    if (!acc || !acc.recovery_code || acc.recovery_code !== String(body.code || '').trim()) {
      fail('El código de verificación es incorrecto o expiró.');
    }
    if (String(body.new_password || '').length < 6) {
      fail('La nueva contraseña debe tener al menos 6 caracteres.');
    }
    acc.pw = String(body.new_password);
    acc.recovery_code = '';
    return commit({ ok: true, message: 'Contraseña actualizada correctamente.' });
  }

  if (p === '/api/platform/account') {
    if (!curAcc) fail('Inicia sesión con tu correo.', 401);
    return {
      account: safeAccount(curAcc),
      memberships: membershipsFor(plat, curAcc.id),
      active_company: companySummary(curComp),
    };
  }

  if (p === '/api/platform/lookup-code') {
    const code = normCode(url.searchParams.get('code'));
    if (code.length < 9) fail('Ingresa un código válido (ej. kiosko-ABC123).');
    const inv = plat.invites.find((i) => i.active && i.code.toUpperCase() === code.toUpperCase());
    if (inv) {
      const c = plat.companies.find((x) => x.id === inv.company_id && x.active);
      if (!c) fail('Empresa no disponible.', 404);
      return {
        valid: true,
        kind: 'invite',
        code: inv.code,
        company: { ...companySummary(c), join_mode: 'DIRECT_INVITE' },
        invite: { role: inv.role, label: inv.label, target_email: inv.target_email, default_register: inv.default_register },
      };
    }
    const c = plat.companies.find((x) => x.active && x.company_code.toUpperCase() === code.toUpperCase());
    if (!c) fail(`No encontramos ninguna empresa con el código "${code}".`, 404);
    return { valid: true, kind: 'company', code: c.company_code, company: companySummary(c), invite: null };
  }

  if (p === '/api/platform/companies' && method === 'POST') {
    if (!curAcc) fail('Inicia sesión con tu correo para crear tu empresa.', 401);
    if (!String(body.business_name || body.name || '').trim()) {
      fail('Escribe el nombre de tu empresa.');
    }
    const cid = plat.seq.company++;
    const code = genCode(plat);
    const sKey = `gestor_kiosko_tenant_${cid}`;
    const { state, ownerId } = buildCustomCompanyState(curAcc, code, body);
    saveState(state, sKey);

    const comp = {
      id: cid,
      company_code: code,
      name: state.config.business_name,
      business_type: state.config.business_type,
      legal_form: state.config.legal_form,
      municipality: state.config.municipality,
      province: state.config.province,
      owner_account_id: curAcc.id,
      storage_key: sKey,
      is_demo: false,
      join_mode: state.config.join_mode,
      active: true,
      created_at: nowIso(),
    };
    plat.companies.push(comp);
    plat.memberships.push({
      id: plat.seq.membership++,
      company_id: cid,
      account_id: curAcc.id,
      tenant_user_id: ownerId,
      role: 'jefe',
      status: 'ACTIVO',
      requested_role: 'jefe',
      requested_ci: curAcc.ci,
      requested_phone: state.config.whatsapp_phone,
      request_note: '',
      invite_code_used: code,
      created_at: nowIso(),
      decided_at: nowIso(),
    });
    plat.session = { accountId: curAcc.id, companyId: cid, userId: ownerId };
    return commit({
      token: `static-${curAcc.id}-${cid}-${ownerId}`,
      account: safeAccount(curAcc),
      memberships: membershipsFor(plat, curAcc.id),
      active_company: companySummary(comp),
      user: enrichUser(state, state.users[0]),
      config: state.config,
      badges: getBadges(state, 0),
    });
  }

  if (p === '/api/platform/affiliate' && method === 'POST') {
    const code = normCode(body.code);
    if (code.length < 9) fail('Ingresa el código de afiliación (ej. kiosko-ABC123).');
    const inv = plat.invites.find((i) => i.active && i.code.toUpperCase() === code.toUpperCase());
    const comp = inv
      ? plat.companies.find((x) => x.id === inv.company_id && x.active)
      : plat.companies.find((x) => x.active && x.company_code.toUpperCase() === code.toUpperCase());
    if (!comp) fail(`No existe ninguna empresa activa con el código "${code}".`, 404);

    let acc = curAcc;
    if (!acc) {
      const email = normEmail(body.email);
      const name = String(body.full_name || '').trim();
      const pw = String(body.password || '');
      if (name.length < 2 || !validEmail(email) || pw.length < 6) {
        fail('Completa tu nombre, correo válido y una contraseña de al menos 6 caracteres.');
      }
      const ex = plat.accounts.find((a) => a.email === email);
      if (ex) {
        if (ex.pw !== pw) fail('Ese correo ya tiene cuenta. Ingresa su contraseña correcta.', 409);
        acc = ex;
      } else {
        acc = {
          id: plat.seq.account++,
          email,
          pw,
          full_name: name,
          ci: String(body.ci || '').trim(),
          phone: String(body.phone || '').trim(),
          recovery_code: '',
          created_at: nowIso(),
        };
        plat.accounts.push(acc);
      }
    }

    if (inv?.target_email && normEmail(inv.target_email) !== normEmail(acc.email)) {
      fail(`Esta invitación es exclusiva para ${inv.target_email}.`, 403);
    }

    const existing = plat.memberships.find((m) => m.company_id === comp.id && m.account_id === acc.id);
    if (existing?.status === 'ACTIVO') fail(`Ya formas parte de "${comp.name}".`);
    if (existing?.status === 'PENDIENTE' && !inv) {
      fail(`Tu solicitud en "${comp.name}" ya está pendiente de aprobación.`);
    }

    const ts = loadState(comp.storage_key);
    const reqRole = ['vendedor', 'almacenero', 'economico'].includes(body.requested_role)
      ? body.requested_role
      : 'vendedor';
    const immediate = Boolean(inv) || comp.join_mode === 'AUTO' || ts.config.join_mode === 'AUTO';

    if (immediate) {
      const role = inv ? inv.role : reqRole;
      const uid = createTenantUser(ts, acc, {
        role,
        shift_template_id: inv?.shift_template_id,
        default_register: inv?.default_register,
        base_salary_cup: inv?.base_salary_cup || 6500,
        sales_commission_pct: inv?.sales_commission_pct || 1.0,
        ci: body.ci || acc.ci,
        phone: body.phone || acc.phone,
      });
      ts.currentUserId = uid;
      saveState(ts, comp.storage_key);
      if (existing) {
        Object.assign(existing, { tenant_user_id: uid, role, status: 'ACTIVO', decided_at: nowIso() });
      } else {
        plat.memberships.push({
          id: plat.seq.membership++,
          company_id: comp.id,
          account_id: acc.id,
          tenant_user_id: uid,
          role,
          status: 'ACTIVO',
          requested_role: role,
          requested_ci: String(body.ci || acc.ci || ''),
          requested_phone: String(body.phone || acc.phone || ''),
          request_note: String(body.note || ''),
          invite_code_used: inv ? inv.code : comp.company_code,
          created_at: nowIso(),
          decided_at: nowIso(),
        });
      }
      if (inv) {
        inv.uses_count += 1;
        if (inv.uses_count >= inv.max_uses) inv.active = 0;
      }
      plat.session = { accountId: acc.id, companyId: comp.id, userId: uid };
      const tu = ts.users.find((u) => u.id === uid);
      return commit({
        joined: true,
        status: 'ACTIVO',
        message: `¡Te uniste a ${comp.name} como ${role}!`,
        token: `static-${acc.id}-${comp.id}-${uid}`,
        account: safeAccount(acc),
        memberships: membershipsFor(plat, acc.id),
        active_company: companySummary(comp),
        user: enrichUser(ts, tu),
        config: ts.config,
        badges: getBadges(ts, pendingCount(plat, comp.id)),
      });
    }

    if (existing) {
      Object.assign(existing, {
        status: 'PENDIENTE',
        requested_role: reqRole,
        requested_ci: String(body.ci || acc.ci || ''),
        requested_phone: String(body.phone || acc.phone || ''),
        request_note: String(body.note || ''),
        created_at: nowIso(),
      });
    } else {
      plat.memberships.push({
        id: plat.seq.membership++,
        company_id: comp.id,
        account_id: acc.id,
        tenant_user_id: null,
        role: reqRole,
        status: 'PENDIENTE',
        requested_role: reqRole,
        requested_ci: String(body.ci || acc.ci || ''),
        requested_phone: String(body.phone || acc.phone || ''),
        request_note: String(body.note || ''),
        invite_code_used: comp.company_code,
        created_at: nowIso(),
        decided_at: null,
      });
    }
    if (!plat.session.companyId) {
      plat.session = { accountId: acc.id, companyId: null, userId: null };
    }
    return commit({
      joined: false,
      status: 'PENDIENTE',
      message: `Solicitud enviada a "${comp.name}". El creador la aprobará y asignará tu puesto.`,
      token: `static-acc-${acc.id}`,
      account: safeAccount(acc),
      memberships: membershipsFor(plat, acc.id),
      active_company: null,
      user: null,
      config: null,
      badges: {},
    });
  }

  if (p === '/api/platform/select-company' && method === 'POST') {
    if (!curAcc) fail('Inicia sesión con tu correo.', 401);
    const cid = Number(body.company_id);
    const mem = plat.memberships.find(
      (m) => m.company_id === cid && m.account_id === curAcc.id && m.status === 'ACTIVO'
    );
    if (!mem) fail('No tienes acceso activo a esta empresa.', 403);
    const comp = plat.companies.find((c) => c.id === cid && c.active);
    const ts = loadState(comp.storage_key);
    const tu = ts.users.find((u) => u.id === mem.tenant_user_id && u.active);
    if (!tu) fail('Usuario no encontrado en la empresa.', 404);
    ts.currentUserId = tu.id;
    saveState(ts, comp.storage_key);
    plat.session = { accountId: curAcc.id, companyId: comp.id, userId: tu.id };
    return commit({
      token: `static-${curAcc.id}-${comp.id}-${tu.id}`,
      account: safeAccount(curAcc),
      memberships: membershipsFor(plat, curAcc.id),
      active_company: companySummary(comp),
      user: enrichUser(ts, tu),
      config: ts.config,
      badges: getBadges(ts, pendingCount(plat, comp.id)),
    });
  }

  if (p === '/api/platform/exit-to-hub' && method === 'POST') {
    if (!curAcc) fail('Inicia sesión.', 401);
    plat.session = { accountId: curAcc.id, companyId: null, userId: null };
    return commit({
      token: `static-acc-${curAcc.id}`,
      account: safeAccount(curAcc),
      memberships: membershipsFor(plat, curAcc.id),
      active_company: null,
      user: null,
      config: null,
      badges: {},
    });
  }

  if (p === '/api/platform/company/affiliations' && method === 'GET') {
    if (!curComp) fail('Selecciona una empresa.', 401);
    const ts = loadState(curComp.storage_key);
    const list = plat.memberships
      .filter((m) => m.company_id === curComp.id)
      .map((m) => {
        const a = plat.accounts.find((x) => x.id === m.account_id);
        const tu = m.tenant_user_id ? ts.users.find((x) => x.id === m.tenant_user_id) : null;
        const sh = tu ? ts.shifts.find((x) => x.id === tu.shift_template_id) : null;
        return {
          ...m,
          email: a?.email || '',
          full_name: a?.full_name || '',
          account_ci: a?.ci || '',
          account_phone: a?.phone || '',
          is_owner: curComp.owner_account_id === m.account_id,
          shift_template_id: tu?.shift_template_id || null,
          shift_name: sh?.name || null,
          default_register: tu?.default_register || null,
          base_salary_cup: tu?.base_salary_cup || null,
          sales_commission_pct: tu?.sales_commission_pct || 0,
        };
      });
    return {
      company: companySummary(curComp),
      config: ts.config,
      shifts: ts.shifts,
      pending: list.filter((x) => x.status === 'PENDIENTE'),
      members: list.filter((x) => x.status !== 'PENDIENTE'),
      invites: plat.invites.filter((i) => i.company_id === curComp.id).slice().reverse(),
      presets: STATIC_PRESETS,
    };
  }

  if (p === '/api/platform/company/regenerate-code' && method === 'POST') {
    if (!curComp) fail('Empresa no activa.', 401);
    const code = genCode(plat);
    curComp.company_code = code;
    const ts = loadState(curComp.storage_key);
    ts.config.company_code = code;
    saveState(ts, curComp.storage_key);
    return commit({ company_code: code, config: ts.config });
  }

  if (p.startsWith('/api/platform/company/affiliations/') && p.endsWith('/decide') && method === 'POST') {
    if (!curComp) fail('Empresa no activa.', 401);
    const mid = Number(p.split('/')[5]);
    const mem = plat.memberships.find((m) => m.id === mid && m.company_id === curComp.id);
    if (!mem) fail('Solicitud no encontrada.', 404);
    if (body.decision === 'RECHAZAR') {
      mem.status = 'RECHAZADO';
      mem.decided_at = nowIso();
      return commit({ ok: true, status: 'RECHAZADO' });
    }
    const acc = plat.accounts.find((a) => a.id === mem.account_id);
    const ts = loadState(curComp.storage_key);
    const role = body.role || mem.requested_role || 'vendedor';
    const uid = createTenantUser(ts, acc, {
      role,
      shift_template_id: body.shift_template_id,
      default_register: body.default_register,
      base_salary_cup: body.base_salary_cup || 6500,
      sales_commission_pct: body.sales_commission_pct || 1.0,
      contract_type: body.contract_type || 'Indeterminado',
      ci: mem.requested_ci || acc.ci,
      phone: mem.requested_phone || acc.phone,
    });
    saveState(ts, curComp.storage_key);
    Object.assign(mem, { tenant_user_id: uid, role, status: 'ACTIVO', decided_at: nowIso() });
    return commit({ ok: true, status: 'ACTIVO', tenant_user_id: uid });
  }

  if (p.startsWith('/api/platform/company/affiliations/') && method === 'PUT') {
    if (!curComp) fail('Empresa no activa.', 401);
    const mid = Number(p.split('/')[5]);
    const mem = plat.memberships.find((m) => m.id === mid && m.company_id === curComp.id);
    if (!mem) fail('Afiliación no encontrada.', 404);
    if (curComp.owner_account_id === mem.account_id && body.status === 'SUSPENDIDO') {
      fail('No puedes suspender al creador de la empresa.');
    }
    if (body.status) mem.status = body.status;
    if (body.role) mem.role = body.role;
    const ts = loadState(curComp.storage_key);
    const tu = ts.users.find((u) => u.id === mem.tenant_user_id);
    if (tu) {
      tu.role = mem.role;
      tu.active = mem.status === 'ACTIVO' ? 1 : 0;
      if (body.shift_template_id) tu.shift_template_id = Number(body.shift_template_id);
      if (body.default_register) tu.default_register = Number(body.default_register);
      if (body.base_salary_cup) tu.base_salary_cup = r2(body.base_salary_cup);
      saveState(ts, curComp.storage_key);
    }
    return commit({ ok: true });
  }

  if (p === '/api/platform/company/invites' && method === 'POST') {
    if (!curComp) fail('Empresa no activa.', 401);
    const role = body.role || 'vendedor';
    const inv = {
      id: plat.seq.invite++,
      company_id: curComp.id,
      code: genCode(plat, role[0]),
      label: String(body.label || '').trim(),
      target_email: body.target_email ? normEmail(body.target_email) : '',
      role,
      shift_template_id: body.shift_template_id ? Number(body.shift_template_id) : null,
      default_register: Number(body.default_register || 1),
      base_salary_cup: Math.max(2100, r2(body.base_salary_cup || 6500)),
      sales_commission_pct: Number(body.sales_commission_pct || 0),
      max_uses: Math.max(1, Number(body.max_uses || 1)),
      uses_count: 0,
      active: 1,
      created_at: nowIso(),
    };
    plat.invites.push(inv);
    return commit({ invite: inv });
  }

  if (p.startsWith('/api/platform/company/invites/') && method === 'DELETE') {
    const iid = Number(p.split('/')[5]);
    const inv = plat.invites.find((i) => i.id === iid);
    if (inv) inv.active = 0;
    return commit({ ok: true });
  }

  if (p === '/api/platform/company/governance' && method === 'PUT') {
    if (!curComp) fail('Empresa no activa.', 401);
    const ts = loadState(curComp.storage_key);
    const preset = body.apply_preset ? STATIC_PRESETS[body.apply_preset] : null;
    if (preset) {
      ts.config.management_preset = preset.id;
      ts.config.max_sellers_per_shift = preset.max_sellers_per_shift;
      ts.config.owner_can_operate_pos = preset.owner_can_operate_pos;
      ts.config.flexible_role_limits = preset.flexible_role_limits;
      ts.config.require_cuban_ci = preset.require_cuban_ci;
      ts.config.auto_restock_enabled = preset.auto_restock_enabled;
      ts.config.auto_accounting_enabled = preset.auto_accounting_enabled;
      ts.config.auto_deposit_order_enabled = preset.auto_deposit_order_enabled;
      ts.config.strict_price_cap_block = preset.strict_price_cap_block;
      ts.config.strict_bancarizacion_block = preset.strict_bancarizacion_block;
      ts.config.modules = { ...preset.modules, pos: true };
      ts.config.permissions = { ...preset.permissions };
    }
    const { apply_preset: _ap, modules, permissions, ...rest } = body;
    Object.assign(ts.config, rest);
    if (modules) ts.config.modules = { ...ts.config.modules, ...modules, pos: true };
    if (permissions) ts.config.permissions = { ...ts.config.permissions, ...permissions };
    ['flexible_role_limits', 'require_cuban_ci', 'owner_can_operate_pos', 'auto_restock_enabled', 'auto_accounting_enabled', 'auto_deposit_order_enabled', 'strict_price_cap_block', 'strict_bancarizacion_block'].forEach((k) => {
      if (body[k] !== undefined) ts.config[k] = body[k] ? 1 : 0;
    });
    curComp.name = ts.config.business_name;
    curComp.business_type = ts.config.business_type;
    curComp.legal_form = ts.config.legal_form;
    curComp.municipality = ts.config.municipality;
    curComp.province = ts.config.province;
    curComp.join_mode = ts.config.join_mode || 'APPROVAL';
    saveState(ts, curComp.storage_key);
    return commit({
      config: ts.config,
      active_company: companySummary(curComp),
      badges: getBadges(ts, pendingCount(plat, curComp.id)),
    });
  }

  // --- Auth interception ---
  if (p === '/api/auth/me') {
    if (!curAcc && !curComp) fail('Sesión no iniciada.', 401);
    if (!curComp || !plat.session.userId) {
      return {
        account: safeAccount(curAcc),
        memberships: membershipsFor(plat, curAcc?.id),
        active_company: null,
        user: null,
        config: null,
        badges: {},
      };
    }
    const ts = loadState(curComp.storage_key);
    const tu = ts.users.find((u) => u.id === plat.session.userId && u.active);
    if (!tu) fail('Sesión expirada.', 401);
    return {
      account: safeAccount(curAcc),
      memberships: membershipsFor(plat, curAcc?.id),
      active_company: companySummary(curComp),
      user: enrichUser(ts, tu),
      config: ts.config,
      badges: getBadges(ts, pendingCount(plat, curComp.id)),
    };
  }

  if (p === '/api/auth/logout') {
    plat.session = { accountId: null, companyId: null, userId: null };
    return commit({ ok: true });
  }

  if (p === '/api/auth/quick-switch' && method === 'POST') {
    const target = body.demo || !curComp ? plat.companies.find((c) => c.is_demo) : curComp;
    const ts = loadState(target.storage_key);
    const tu =
      ts.users.find(
        (u) => u.active && (u.id === Number(body.user_id) || u.username === (body.username || 'jefe'))
      ) || ts.users[0];
    ts.currentUserId = tu.id;
    saveState(ts, target.storage_key);
    const keepAcc = curAcc && (target.is_demo || target.owner_account_id === curAcc.id) ? curAcc.id : null;
    plat.session = { accountId: keepAcc, companyId: target.id, userId: tu.id };
    return commit({
      token: `static-demo-${target.id}-${tu.id}`,
      account: keepAcc ? safeAccount(curAcc) : null,
      memberships: keepAcc ? membershipsFor(plat, keepAcc) : [],
      active_company: companySummary(target),
      user: enrichUser(ts, tu),
      config: ts.config,
      badges: getBadges(ts, pendingCount(plat, target.id)),
    });
  }

  if (p === '/api/auth/roles-preview') {
    const target = curComp || plat.companies.find((c) => c.is_demo);
    setActiveStaticTenant(target.storage_key, pendingCount(plat, target.id));
    const res = handleTenantApi(method, rawPath, body);
    return {
      ...res,
      is_demo: Boolean(target.is_demo),
      company_code: target.company_code,
      demo_switch_enabled: Boolean(target.is_demo) || curComp?.owner_account_id === curAcc?.id,
    };
  }

  if (p === '/api/auth/login' && method === 'POST' && String(body.email || body.username || '').includes('@')) {
    return handleStaticPlatformApi('POST', '/api/platform/login', {
      email: body.email || body.username,
      password: body.password,
    });
  }

  // =========================================================================
  // Public Customer Catalog & WhatsApp Orders (Static / GitHub Pages parity)
  // =========================================================================
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const availStock = (prod, cfg) =>
    (cfg.catalog_stock_source || 'BOTH') === 'KIOSKO'
      ? Math.max(0, r2(prod.kiosk_stock))
      : Math.max(0, r2(Number(prod.kiosk_stock || 0) + Number(prod.warehouse_stock || 0)));

  const buildStaticPublicCatalog = (ts, comp) => {
    const cfg = ts.config;
    const wp = String(cfg.whatsapp_phone || cfg.transfermovil_phone || '').trim();
    const prods = (ts.products || [])
      .filter((pr) => pr.active !== 0 && pr.catalog_visible !== 0)
      .map((pr) => {
        const av = availStock(pr, cfg);
        const inStock = av > 0 || Boolean(cfg.catalog_allow_backorder);
        return {
          id: pr.id,
          sku: pr.sku,
          name: pr.name,
          category: pr.category,
          unit: pr.unit,
          sale_price_cup: r2(pr.sale_price_cup),
          available_stock: av,
          in_stock: inStock,
          catalog_featured: Boolean(pr.catalog_featured),
          catalog_description: pr.catalog_description || '',
          image_url: pr.image_url || '',
        };
      })
      .filter((pr) => pr.in_stock || Boolean(cfg.catalog_show_out_of_stock))
      .sort((a, b) => Number(b.catalog_featured) - Number(a.catalog_featured) || a.name.localeCompare(b.name));

    return {
      store: {
        company_code: comp?.company_code || cfg.company_code,
        business_name: cfg.business_name,
        business_type: cfg.business_type || 'Kiosko y Comercio',
        catalog_enabled: cfg.catalog_enabled !== 0 && cfg.modules?.catalog !== false,
        whatsapp_phone: wp,
        whatsapp_digits: sanitizeWhatsappDigits(wp),
        catalog_welcome:
          cfg.catalog_welcome || 'Elige tus productos, arma tu pedido y envíalo directo a nuestro WhatsApp.',
        catalog_hours: cfg.catalog_hours || 'Todos los días · 7:00 a 22:00',
        address: cfg.address || '',
        municipality: cfg.municipality || '',
        province: cfg.province || '',
        catalog_allow_pickup: Boolean(cfg.catalog_allow_pickup ?? 1),
        catalog_allow_delivery: Boolean(cfg.catalog_allow_delivery ?? 1),
        catalog_delivery_fee_cup: r2(cfg.catalog_delivery_fee_cup ?? 0),
        catalog_free_delivery_from_cup: r2(cfg.catalog_free_delivery_from_cup ?? 0),
        catalog_min_order_cup: r2(cfg.catalog_min_order_cup ?? 0),
        catalog_show_out_of_stock: Boolean(cfg.catalog_show_out_of_stock ?? 0),
        catalog_allow_backorder: Boolean(cfg.catalog_allow_backorder ?? 0),
        qr_discount_pct: r2(cfg.qr_discount_pct ?? 0),
        has_transfermovil: Boolean(cfg.transfermovil_merchant_code || cfg.transfermovil_phone),
        has_enzona: Boolean(cfg.enzona_merchant_code),
      },
      categories: Array.from(new Set(prods.map((pr) => pr.category))),
      products: prods,
    };
  };

  const findCompByCode = (rawCode) => {
    let clean = String(rawCode || '').trim();
    if (!clean) return null;
    if (/^kiosko[-_]/i.test(clean)) clean = `kiosko-${clean.slice(7).toUpperCase()}`;
    else clean = `kiosko-${clean.toUpperCase()}`;
    return plat.companies.find((c) => c.active !== false && c.company_code.toUpperCase() === clean.toUpperCase()) || null;
  };

  const pubCatMatch = p.match(/^\/api\/catalog\/([^/]+)$/);
  if (pubCatMatch && method === 'GET') {
    const comp = findCompByCode(decodeURIComponent(pubCatMatch[1]));
    if (!comp) {
      const e = new Error('No encontramos un catálogo con ese código.');
      e.status = 404;
      throw e;
    }
    const ts = loadState(comp.storage_key);
    return buildStaticPublicCatalog(ts, comp);
  }

  const pubOrderMatch = p.match(/^\/api\/catalog\/([^/]+)\/orders$/);
  if (pubOrderMatch && method === 'POST') {
    const comp = findCompByCode(decodeURIComponent(pubOrderMatch[1]));
    if (!comp) {
      const e = new Error('Comercio no encontrado.');
      e.status = 404;
      throw e;
    }
    const ts = loadState(comp.storage_key);
    const cfg = ts.config;
    if (cfg.catalog_enabled === 0 || cfg.modules?.catalog === false) {
      throw new Error('Este comercio tiene pausada la recepción de pedidos en este momento.');
    }
    const customerName = String(body.customer_name || '').trim();
    const customerPhone = String(body.customer_phone || '').trim();
    const notes = String(body.notes || '').trim();
    if (customerName.length < 2) throw new Error('Escribe tu nombre para identificar tu pedido.');
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw new Error('Agrega al menos un producto a tu pedido.');

    let deliveryMode = String(body.delivery_mode || 'RETIRO').toUpperCase() === 'DOMICILIO' ? 'DOMICILIO' : 'RETIRO';
    if (deliveryMode === 'DOMICILIO' && !cfg.catalog_allow_delivery) deliveryMode = 'RETIRO';
    if (deliveryMode === 'RETIRO' && !cfg.catalog_allow_pickup && cfg.catalog_allow_delivery) deliveryMode = 'DOMICILIO';
    const deliveryAddress = deliveryMode === 'DOMICILIO' ? String(body.delivery_address || '').trim() : '';
    if (deliveryMode === 'DOMICILIO' && deliveryAddress.length < 4) {
      throw new Error('Indica tu dirección o referencia para el envío a domicilio.');
    }

    const rawPay = String(body.payment_method || 'EFECTIVO').toUpperCase();
    const paymentMethod = ['EFECTIVO', 'TRANSFERMOVIL', 'ENZONA'].includes(rawPay) ? rawPay : 'EFECTIVO';

    let subtotal = 0;
    const items = [];
    rawItems.forEach((raw, idx) => {
      const pr = ts.products.find((x) => x.id === Number(raw.product_id) && x.active !== 0);
      const qty = r2(raw.quantity);
      if (!pr || qty <= 0) return;
      const av = availStock(pr, cfg);
      if (!cfg.catalog_allow_backorder && qty > av + 0.001) {
        throw new Error(`De "${pr.name}" quedan ${av} ${pr.unit} disponibles.`);
      }
      const lineSub = r2(pr.sale_price_cup * qty);
      subtotal = r2(subtotal + lineSub);
      items.push({
        id: idx + 1,
        product_id: pr.id,
        product_name: pr.name,
        unit: pr.unit,
        quantity: qty,
        unit_price_cup: r2(pr.sale_price_cup),
        subtotal_cup: lineSub,
      });
    });
    if (!items.length) throw new Error('Selecciona al menos un producto válido.');

    const isQr = paymentMethod === 'TRANSFERMOVIL' || paymentMethod === 'ENZONA';
    const discountCup = isQr && Number(cfg.qr_discount_pct) > 0 ? r2((subtotal * Number(cfg.qr_discount_pct)) / 100) : 0;
    let deliveryFeeCup = 0;
    if (deliveryMode === 'DOMICILIO') {
      const fee = r2(cfg.catalog_delivery_fee_cup || 0);
      const freeFrom = r2(cfg.catalog_free_delivery_from_cup || 0);
      deliveryFeeCup = freeFrom > 0 && subtotal >= freeFrom ? 0 : fee;
    }
    const totalCup = r2(Math.max(0, subtotal - discountCup + deliveryFeeCup));
    const cashTendered = paymentMethod === 'EFECTIVO' && Number(body.cash_tendered_cup) > 0 ? r2(body.cash_tendered_cup) : 0;

    if (!Array.isArray(ts.customer_orders)) ts.customer_orders = [];
    const nextId = (ts.customer_orders.reduce((m, o) => Math.max(m, o.id || 0), 0) || 0) + 1;
    const orderCode = `PED-${String(nextId).padStart(4, '0')}`;
    const wp = String(cfg.whatsapp_phone || cfg.transfermovil_phone || '').trim();
    const order = {
      id: nextId,
      order_code: orderCode,
      status: 'NUEVO',
      customer_name: customerName,
      customer_phone: customerPhone,
      delivery_mode: deliveryMode,
      delivery_address: deliveryAddress,
      payment_method: paymentMethod,
      cash_tendered_cup: cashTendered,
      notes,
      subtotal_cup: subtotal,
      discount_cup: discountCup,
      delivery_fee_cup: deliveryFeeCup,
      total_cup: totalCup,
      source: 'CATALOGO',
      sale_id: null,
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      items,
    };
    const whatsappText = formatOrderWhatsappMessage({
      order,
      items,
      store: { business_name: cfg.business_name, currency: 'CUP' },
    });
    order.whatsapp_text = whatsappText;
    ts.customer_orders.unshift(order);
    saveState(ts, comp.storage_key);

    return {
      order,
      items,
      whatsapp_phone: wp,
      has_store_whatsapp: sanitizeWhatsappDigits(wp).length >= 7,
      whatsapp_text: whatsappText,
      whatsapp_url: buildWhatsappUrl(wp, whatsappText),
    };
  }

  // Authenticated catalog admin endpoints
  if (p.startsWith('/api/catalog-admin/')) {
    const targetComp = curComp || plat.companies.find((c) => c.is_demo);
    const ts = loadState(targetComp.storage_key);
    const cfg = ts.config;
    if (!Array.isArray(ts.customer_orders)) ts.customer_orders = [];

    if (p === '/api/catalog-admin/overview' && method === 'GET') {
      const wp = String(cfg.whatsapp_phone || cfg.transfermovil_phone || '').trim();
      const statusRank = { NUEVO: 0, PREPARANDO: 1, LISTO: 2, ENTREGADO: 3, CANCELADO: 4 };
      const orders = [...ts.customer_orders]
        .sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || (b.id || 0) - (a.id || 0))
        .map((o) => {
          const nextSt = o.status === 'NUEVO' ? 'PREPARANDO' : o.status === 'PREPARANDO' ? 'LISTO' : o.status === 'LISTO' ? 'ENTREGADO' : o.status;
          const reply = formatCustomerReplyWhatsapp({ order: o, store: { business_name: cfg.business_name }, status: nextSt });
          return {
            ...o,
            customer_whatsapp_url: o.customer_phone ? buildWhatsappUrl(o.customer_phone, reply) : '',
          };
        });
      const products = (ts.products || [])
        .filter((pr) => pr.active !== 0)
        .map((pr) => ({
          ...pr,
          available_stock: availStock(pr, cfg),
          catalog_visible: pr.catalog_visible !== 0,
          catalog_featured: Boolean(pr.catalog_featured),
        }));
      const delivered = orders.filter((o) => o.status === 'ENTREGADO');
      return {
        company_code: targetComp.company_code,
        settings: {
          business_name: cfg.business_name,
          whatsapp_phone: wp,
          whatsapp_digits: sanitizeWhatsappDigits(wp),
          catalog_enabled: cfg.catalog_enabled !== 0,
          catalog_welcome: cfg.catalog_welcome || '',
          catalog_hours: cfg.catalog_hours || '',
          catalog_allow_pickup: Boolean(cfg.catalog_allow_pickup ?? 1),
          catalog_allow_delivery: Boolean(cfg.catalog_allow_delivery ?? 1),
          catalog_delivery_fee_cup: r2(cfg.catalog_delivery_fee_cup ?? 0),
          catalog_free_delivery_from_cup: r2(cfg.catalog_free_delivery_from_cup ?? 0),
          catalog_min_order_cup: r2(cfg.catalog_min_order_cup ?? 0),
          catalog_show_out_of_stock: Boolean(cfg.catalog_show_out_of_stock ?? 0),
          catalog_allow_backorder: Boolean(cfg.catalog_allow_backorder ?? 0),
          catalog_stock_source: cfg.catalog_stock_source || 'BOTH',
          qr_discount_pct: r2(cfg.qr_discount_pct ?? 0),
          address: cfg.address || '',
        },
        stats: {
          new_count: orders.filter((o) => o.status === 'NUEVO').length,
          active_count: orders.filter((o) => ['NUEVO', 'PREPARANDO', 'LISTO'].includes(o.status)).length,
          delivered_count: delivered.length,
          delivered_total_cup: r2(delivered.reduce((s, o) => s + Number(o.total_cup || 0), 0)),
          visible_products: products.filter((pr) => pr.catalog_visible).length,
          total_products: products.length,
          featured_products: products.filter((pr) => pr.catalog_visible && pr.catalog_featured).length,
        },
        orders,
        products,
        public_preview: buildStaticPublicCatalog(ts, targetComp),
      };
    }

    if (p === '/api/catalog-admin/settings' && method === 'PUT') {
      if (body.whatsapp_phone !== undefined) cfg.whatsapp_phone = String(body.whatsapp_phone).trim();
      if (body.address !== undefined) cfg.address = String(body.address).trim();
      if (body.catalog_welcome !== undefined) cfg.catalog_welcome = String(body.catalog_welcome).trim();
      if (body.catalog_hours !== undefined) cfg.catalog_hours = String(body.catalog_hours).trim();
      if (body.catalog_stock_source) cfg.catalog_stock_source = body.catalog_stock_source;
      ['catalog_enabled', 'catalog_allow_pickup', 'catalog_allow_delivery', 'catalog_show_out_of_stock', 'catalog_allow_backorder'].forEach((k) => {
        if (body[k] !== undefined) cfg[k] = body[k] ? 1 : 0;
      });
      ['catalog_delivery_fee_cup', 'catalog_free_delivery_from_cup', 'catalog_min_order_cup'].forEach((k) => {
        if (body[k] !== undefined) cfg[k] = Math.max(0, r2(body[k]));
      });
      if (!cfg.catalog_allow_pickup && !cfg.catalog_allow_delivery) {
        cfg.catalog_allow_pickup = 1;
      }
      saveState(ts, targetComp.storage_key);
      return { config: cfg };
    }

    if (p === '/api/catalog-admin/products/quick' && method === 'POST') {
      const name = String(body.name || '').trim();
      const salePrice = r2(body.sale_price_cup);
      if (!name || salePrice <= 0) throw new Error('Indica el nombre y un precio mayor que cero.');
      const initStock = Math.max(0, r2(body.initial_stock ?? 20));
      const unitCost = Number(body.unit_cost_cup) > 0 ? r2(body.unit_cost_cup) : r2(salePrice * 0.74);
      const nextId = (ts.products.reduce((m, x) => Math.max(m, x.id || 0), 0) || 0) + 1;
      const prod = {
        id: nextId,
        sku: `CAT-${String(nextId).padStart(4, '0')}`,
        name,
        category: String(body.category || 'General').trim() || 'General',
        unit: String(body.unit || 'u').trim() || 'u',
        unit_cost_cup: unitCost,
        indirect_cost_pct: cfg.indirect_cost_alloc_pct || 8,
        sale_price_cup: salePrice,
        is_price_capped: 0,
        price_cap_cup: null,
        is_margin_regulated: cfg.strict_price_cap_block ? 1 : 0,
        sales_tax_exempt: 0,
        warehouse_stock: 0,
        kiosk_stock: initStock,
        warehouse_min_stock: 5,
        kiosk_min_stock: 3,
        kiosk_target_stock: 15,
        current_batch: 'LT-CAT',
        next_expiry_date: '',
        catalog_visible: 1,
        catalog_featured: body.catalog_featured ? 1 : 0,
        catalog_description: String(body.catalog_description || '').trim(),
        image_url: String(body.image_url || '').trim(),
        active: 1,
      };
      ts.products.push(prod);
      saveState(ts, targetComp.storage_key);
      return { product: prod };
    }

    const prodMatch = p.match(/^\/api\/catalog-admin\/products\/(\d+)$/);
    if (prodMatch && method === 'PUT') {
      const pr = ts.products.find((x) => x.id === Number(prodMatch[1]));
      if (!pr) throw new Error('Producto no encontrado.');
      if (body.name !== undefined && String(body.name).trim()) pr.name = String(body.name).trim();
      if (body.category !== undefined && String(body.category).trim()) pr.category = String(body.category).trim();
      if (body.sale_price_cup !== undefined && r2(body.sale_price_cup) > 0) pr.sale_price_cup = r2(body.sale_price_cup);
      if (body.catalog_visible !== undefined) pr.catalog_visible = body.catalog_visible ? 1 : 0;
      if (body.catalog_featured !== undefined) pr.catalog_featured = body.catalog_featured ? 1 : 0;
      if (body.catalog_description !== undefined) pr.catalog_description = String(body.catalog_description).trim();
      if (body.image_url !== undefined) pr.image_url = String(body.image_url).trim();
      saveState(ts, targetComp.storage_key);
      return {
        product: {
          ...pr,
          available_stock: availStock(pr, cfg),
          catalog_visible: Boolean(pr.catalog_visible),
          catalog_featured: Boolean(pr.catalog_featured),
        },
      };
    }

    const ordStatusMatch = p.match(/^\/api\/catalog-admin\/orders\/(\d+)\/status$/);
    if (ordStatusMatch && method === 'PUT') {
      const ord = ts.customer_orders.find((o) => o.id === Number(ordStatusMatch[1]));
      if (!ord) throw new Error('Pedido no encontrado.');
      ord.status = String(body.status || 'PREPARANDO').toUpperCase();
      saveState(ts, targetComp.storage_key);
      const reply = formatCustomerReplyWhatsapp({ order: ord, store: { business_name: cfg.business_name }, status: ord.status });
      return {
        order: ord,
        reply_text: reply,
        customer_whatsapp_url: ord.customer_phone ? buildWhatsappUrl(ord.customer_phone, reply) : '',
      };
    }

    const ordCheckoutMatch = p.match(/^\/api\/catalog-admin\/orders\/(\d+)\/checkout$/);
    if (ordCheckoutMatch && method === 'POST') {
      const ord = ts.customer_orders.find((o) => o.id === Number(ordCheckoutMatch[1]));
      if (!ord) throw new Error('Pedido no encontrado.');
      if (ord.sale_id) throw new Error('Este pedido ya fue cobrado.');

      // Ensure kiosk stock has enough (pull from warehouse if available)
      for (const it of ord.items || []) {
        const pr = ts.products.find((x) => x.id === it.product_id);
        if (pr && pr.kiosk_stock < it.quantity && pr.kiosk_stock + pr.warehouse_stock >= it.quantity) {
          const diff = r2(it.quantity - pr.kiosk_stock);
          pr.warehouse_stock = r2(pr.warehouse_stock - diff);
          pr.kiosk_stock = r2(pr.kiosk_stock + diff);
        }
      }
      saveState(ts, targetComp.storage_key);

      setActiveStaticTenant(targetComp.storage_key, pendingCount(plat, targetComp.id));
      const openSess = ts.sessions.find((x) => x.status === 'ABIERTO');
      if (!openSess) {
        handleTenantApi('POST', '/api/pos/shifts/open', { register_number: 1 });
      }
      const payMethod = String(body.payment_method || ord.payment_method || 'EFECTIVO').toUpperCase();
      const saleRes = handleTenantApi('POST', '/api/pos/sales', {
        items: (ord.items || []).map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        payment_method: payMethod,
        cash_tendered_cup: payMethod === 'EFECTIVO' ? Math.max(ord.total_cup, ord.cash_tendered_cup || 0) : 0,
        electronic_ref: payMethod !== 'EFECTIVO' ? String(body.electronic_ref || `WA-${ord.order_code}`) : '',
        customer_phone: ord.customer_phone || '',
      });

      const tsAfter = loadState(targetComp.storage_key);
      const ordAfter = tsAfter.customer_orders.find((o) => o.id === ord.id);
      ordAfter.status = 'ENTREGADO';
      ordAfter.payment_method = payMethod;
      ordAfter.sale_id = saleRes.sale?.id || Date.now();
      ordAfter.receipt_number = saleRes.sale?.receipt_number || 'TK';
      saveState(tsAfter, targetComp.storage_key);

      const reply = formatCustomerReplyWhatsapp({
        order: ordAfter,
        store: { business_name: cfg.business_name },
        status: 'ENTREGADO',
      });
      return {
        order: ordAfter,
        receipt_number: ordAfter.receipt_number,
        total_cup: ordAfter.total_cup,
        change_given_cup: saleRes.sale?.change_given_cup || 0,
        customer_whatsapp_url: ordAfter.customer_phone ? buildWhatsappUrl(ordAfter.customer_phone, reply) : '',
      };
    }
  }

  // Delegate all tenant API calls to the active company's isolated state
  const target = curComp || plat.companies.find((c) => c.is_demo);
  setActiveStaticTenant(target.storage_key, pendingCount(plat, target.id));
  const ts = loadState(target.storage_key);
  if (plat.session.userId && ts.currentUserId !== plat.session.userId) {
    ts.currentUserId = plat.session.userId;
    saveState(ts, target.storage_key);
  }
  return handleTenantApi(method, rawPath, body);
}
