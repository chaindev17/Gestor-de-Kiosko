/**
 * Motor autónomo en navegador (respaldo automático con localStorage)
 * Permite probar el 100% del sistema en alojamientos estáticos como GitHub Pages
 * cuando el servidor Node.js/SQLite no está presente.
 */

const STORAGE_KEY = 'gestor_kiosko_cuba_state_v1';

const NCIF = {
  CAJA_GENERAL: { code: '101', name: 'Efectivo en Caja General (CUP)' },
  CAJA_CHICA: { code: '102', name: 'Efectivo en Caja — Turnos y Cambio (CUP)' },
  BANCO_FISCAL: { code: '110', name: 'Efectivo en Banco — Cuenta Bancaria Fiscal (CUP)' },
  COBROS_QR: { code: '135', name: 'Cobros Electrónicos Transfermóvil/EnZona (CUP)' },
  INV_ALMACEN: { code: '189', name: 'Mercancías para la Venta — Almacén' },
  INV_KIOSKO: { code: '190', name: 'Mercancías para la Venta — Área de Kiosko' },
  FALTANTES: { code: '330', name: 'Faltantes y Bienes en Investigación' },
  PROVEEDORES: { code: '405', name: 'Cuentas por Pagar a Proveedores' },
  ONAT_PAGAR: { code: '440', name: 'Obligaciones con el Presupuesto del Estado (ONAT)' },
  RETENCIONES_PAGAR: { code: '445', name: 'Retenciones por Pagar (SS e Ingresos Personales)' },
  VACACIONES_PROV: { code: '461', name: 'Provisión para Vacaciones Acumuladas (9.09%)' },
  SS_PAGAR: { code: '492', name: 'Contribución a la Seguridad Social por Pagar' },
  CAPITAL_SOCIAL: { code: '600', name: 'Capital Social / Patrimonio' },
  RESERVA_LEGAL: { code: '645', name: 'Reserva para Pérdidas y Contingencias (DL 88)' },
  COSTO_VENTAS: { code: '810', name: 'Costo de Ventas de Mercancías' },
  GASTOS_VENTAS: { code: '822', name: 'Gastos de Distribución, Mermas y Bonif. QR' },
  GASTOS_ADMIN: { code: '826', name: 'Gastos Generales, Salarios y Administración' },
  GASTOS_TRIBUTOS: { code: '850', name: 'Impuestos, Tasas y Contribuciones (ONAT)' },
  INGRESOS_VENTAS: { code: '904', name: 'Ventas Minoristas de Mercancías' },
  OTROS_INGRESOS: { code: '950', name: 'Otros Ingresos (Sobrantes de Caja)' },
};

const MFP_CAPS = [
  { key: 'pollo', name: 'Pollo troceado', unit: 'kg', cap_cup: 680, resolution: 'Res. 225/2024 MFP' },
  { key: 'aceite', name: 'Aceite vegetal (excepto oliva)', unit: 'L', cap_cup: 990, resolution: 'Res. 225/2024 MFP' },
  { key: 'leche', name: 'Leche en polvo', unit: 'kg', cap_cup: 1675, resolution: 'Res. 225/2024 MFP' },
  { key: 'pastas', name: 'Pastas alimenticias', unit: 'kg', cap_cup: 835, resolution: 'Res. 225/2024 MFP' },
  { key: 'salchichas', name: 'Salchichas', unit: 'kg', cap_cup: 1045, resolution: 'Res. 225/2024 MFP' },
  { key: 'detergente', name: 'Detergente en polvo', unit: 'kg', cap_cup: 630, resolution: 'Res. 225/2024 MFP' },
];

const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 3, 1];

const r2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;
const todayIso = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const curPeriod = () => todayIso().slice(0, 7);

function offsetDate(days) {
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextBizDay(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function onatDue(period) {
  let [y, m] = period.split('-').map(Number);
  m += 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}-20`;
}

function err400(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  throw e;
}

function calcCostSheet(p, cfg) {
  const unitCost = r2(p.unit_cost_cup);
  const indirectPct = Number(p.indirect_cost_pct ?? cfg.indirect_cost_alloc_pct ?? 8);
  const indirectAmt = r2((unitCost * indirectPct) / 100);
  const fullCost = r2(unitCost + indirectAmt);
  const maxMargin = Number(cfg.max_regulated_margin_pct || 30);
  const maxByMargin = fullCost > 0 ? r2(fullCost * (1 + maxMargin / 100)) : 0;
  const capped = Boolean(p.is_price_capped) && Number(p.price_cap_cup) > 0;
  const cap = capped ? r2(p.price_cap_cup) : null;
  const marginReg = Boolean(p.is_margin_regulated);

  let legalMax = null;
  if (capped && marginReg && maxByMargin > 0) legalMax = r2(Math.min(cap, maxByMargin));
  else if (capped) legalMax = cap;
  else if (marginReg && maxByMargin > 0) legalMax = maxByMargin;

  let suggested = fullCost > 0 ? Math.floor(fullCost * (1 + Math.min(maxMargin, 26) / 100)) : 0;
  if (legalMax !== null && suggested > legalMax) suggested = Math.floor(legalMax);

  const price = r2(p.sale_price_cup);
  const marginPct = fullCost > 0 ? r2(((price - fullCost) / fullCost) * 100) : 0;
  const exceedsCap = capped && price > cap + 0.005;
  const exceedsMargin = marginReg && fullCost > 0 && price > maxByMargin + 0.02;
  const belowCost = fullCost > 0 && price < fullCost - 0.01;

  return {
    unit_cost_cup: unitCost,
    indirect_pct: indirectPct,
    indirect_amount_cup: indirectAmt,
    full_cost_cup: fullCost,
    max_margin_pct: maxMargin,
    max_price_by_margin_cup: maxByMargin,
    price_cap_cup: cap,
    legal_max_price_cup: legalMax,
    suggested_price_cup: suggested,
    sale_price_cup: price,
    unit_profit_cup: r2(price - fullCost),
    margin_pct: marginPct,
    exceeds_cap: exceedsCap,
    exceeds_margin: exceedsMargin,
    below_cost: belowCost,
    compliance_status: exceedsCap ? 'VIOLACION_TOPE' : exceedsMargin ? 'EXCESO_MARGEN' : belowCost ? 'BAJO_COSTO' : 'OK',
  };
}

function calcIIP(gross, exempt = 3260) {
  if (gross <= exempt) return 0;
  const brackets = [
    [exempt, 9510, 0.03],
    [9510, 15000, 0.05],
    [15000, 20000, 0.075],
    [20000, 25000, 0.1],
    [25000, 30000, 0.15],
    [30000, Infinity, 0.2],
  ];
  let t = 0;
  for (const [a, b, rate] of brackets) {
    if (gross > a && b > a) t += (Math.min(gross, b) - a) * rate;
  }
  return r2(t);
}

function calcWorkerSS(gross, pct = 5) {
  if (gross <= 0) return 0;
  const base = pct / 100;
  if (gross <= 15000) return r2(gross * base);
  return r2(15000 * base + (gross - 15000) * Math.max(base, 0.1));
}

function addJournal(state, { date, sourceType, sourceRef = '', description, lines, createdBy = null, silent = false }) {
  const clean = lines
    .map((l) => ({
      id: state.seq.jline++,
      account_code: l.account.code,
      account_name: l.account.name,
      debit_cup: r2(l.debit || 0),
      credit_cup: r2(l.credit || 0),
    }))
    .filter((l) => l.debit_cup > 0 || l.credit_cup > 0);
  if (!clean.length) return null;
  const td = r2(clean.reduce((a, l) => a + l.debit_cup, 0));
  const tc = r2(clean.reduce((a, l) => a + l.credit_cup, 0));
  if (td !== tc) {
    const cl = [...clean].reverse().find((x) => x.credit_cup > 0);
    if (cl) cl.credit_cup = r2(cl.credit_cup + (td - tc));
  }
  const entryNumber = `AST-${String(state.journal.length + 1).padStart(5, '0')}`;
  const entry = {
    id: state.seq.journal++,
    entry_number: entryNumber,
    entry_date: date || todayIso(),
    source_type: sourceType,
    source_ref: sourceRef,
    description,
    total_debit_cup: td,
    total_credit_cup: td,
    created_by: createdBy,
    created_at: nowIso(),
    lines: clean,
  };
  state.journal.push(entry);
  if (!silent) {
    state.automations.push({
      id: state.seq.auto++,
      category: 'CONTABILIDAD',
      severity: 'INFO',
      title: `Asiento NCIF ${entryNumber} contabilizado`,
      detail: `${description} — Partida doble por ${td.toFixed(2)} CUP.`,
      ref_code: entryNumber,
      created_at: nowIso(),
    });
  }
  return entryNumber;
}

function addAudit(state, user, action, module, detail) {
  state.audits.push({
    id: state.seq.audit++,
    user_id: user?.id || null,
    user_name: user?.full_name || 'Sistema',
    user_role: user?.role || 'sistema',
    action,
    module,
    detail,
    created_at: nowIso(),
  });
}

function triggerRestock(state, productId) {
  if (!state.config.auto_restock_enabled) return null;
  const p = state.products.find((x) => x.id === productId);
  if (!p || p.kiosk_stock > p.kiosk_min_stock || p.warehouse_stock <= 0) return null;
  const qty = r2(Math.min(p.warehouse_stock, Math.max(1, p.kiosk_target_stock - p.kiosk_stock)));
  const prio = p.kiosk_stock <= Math.max(1, p.kiosk_min_stock * 0.4) ? 'URGENTE' : 'NORMAL';
  const ex = state.restocks.find((r) => r.product_id === productId && r.status === 'PENDIENTE');
  if (ex) {
    ex.suggested_qty = qty;
    ex.priority = prio;
    return { updated: true };
  }
  const item = {
    id: state.seq.restock++,
    product_id: productId,
    suggested_qty: qty,
    origin: 'AUTOMATICO',
    priority: prio,
    status: 'PENDIENTE',
    notes: `Auto-generado (FEFO lote ${p.current_batch || 'actual'})`,
    created_at: nowIso(),
  };
  state.restocks.push(item);
  state.automations.push({
    id: state.seq.auto++,
    category: 'ALMACEN',
    severity: prio === 'URGENTE' ? 'ALERTA' : 'INFO',
    title: `Orden automática de reabastecimiento: ${p.name}`,
    detail: `Mostrador en ${p.kiosk_stock} ${p.unit}. Solicitados ${qty} ${p.unit} al Almacenero.`,
    ref_code: p.sku,
    created_at: nowIso(),
  });
  return { created: true, suggested_qty: qty };
}

function buildInitialState(mode = 'demo') {
  const s = {
    seq: { user: 1, shift: 1, prod: 1, mov: 1, restock: 1, session: 1, reg: 1, ipv: 1, sale: 1, sitem: 1, dep: 1, exp: 1, journal: 1, jline: 1, pay: 1, tax: 1, pcr: 1, auto: 1, audit: 1 },
    config: {
      id: 1,
      business_name: 'Kiosko La Ceiba S.U.R.L.',
      legal_form: 'MIPYME',
      nit: '50004182937',
      reeup_code: '542.0.11842',
      municipality: 'Plaza de la Revolución',
      province: 'La Habana',
      address: 'Calle 23 #814 e/ A y B, Vedado',
      activity_description: 'Comercio minorista de alimentos, bebidas, aseo y productos básicos en kiosko (CNAE 4711)',
      bank_name: 'Banco Metropolitano (BANMET)',
      fiscal_account_cup: '0598742001384912',
      fiscal_account_titular: 'Kiosko La Ceiba S.U.R.L.',
      transfermovil_phone: '+53 53841920',
      transfermovil_merchant_code: 'TM-HAB-48291',
      enzona_merchant_code: 'EZ-KLC-90314',
      qr_discount_pct: 2.0,
      social_capital_cup: 250000,
      legal_reserve_balance_cup: 18000,
      petty_cash_fund_cup: 3000,
      max_cash_provider_payment_cup: 5000,
      max_vault_cash_before_deposit_cup: 8000,
      max_sellers_per_shift: 2,
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
      auto_restock_enabled: 1,
      auto_accounting_enabled: 1,
      auto_deposit_order_enabled: 1,
      strict_price_cap_block: 1,
      strict_bancarizacion_block: 1,
    },
    shifts: [
      { id: 1, code: 'MANANA', name: 'Turno Mañana', start_time: '07:00', end_time: '15:00', required_sellers: 2, active: 1 },
      { id: 2, code: 'TARDE', name: 'Turno Tarde', start_time: '15:00', end_time: '23:00', required_sellers: 2, active: 1 },
    ],
    users: [
      { id: 1, username: 'jefe', pw: 'kiosko2026', full_name: 'Alejandro Morales Pérez', ci: '82041512489', role: 'jefe', shift_template_id: null, default_register: null, contract_type: 'Socio Administrador', contract_date: '2025-02-01', base_salary_cup: 14500, sales_commission_pct: 0, phone: '+53 53841920', active: 1 },
      { id: 2, username: 'economico', pw: 'kiosko2026', full_name: 'Beatriz Domínguez Ruiz', ci: '87092218342', role: 'economico', shift_template_id: null, default_register: null, contract_type: 'Indeterminado', contract_date: '2025-02-01', base_salary_cup: 11500, sales_commission_pct: 0, phone: '+53 52910433', active: 1 },
      { id: 3, username: 'almacenero', pw: 'kiosko2026', full_name: 'Carlos Enrique Vega', ci: '90031124510', role: 'almacenero', shift_template_id: null, default_register: null, contract_type: 'Indeterminado', contract_date: '2025-02-10', base_salary_cup: 8800, sales_commission_pct: 0, phone: '+53 54128891', active: 1 },
      { id: 4, username: 'vendedor1', pw: 'kiosko2026', full_name: 'Dayana Torres Castellanos', ci: '96071831204', role: 'vendedor', shift_template_id: 1, default_register: 1, contract_type: 'Indeterminado', contract_date: '2025-02-15', base_salary_cup: 7200, sales_commission_pct: 1.2, phone: '+53 58102344', active: 1 },
      { id: 5, username: 'vendedor2', pw: 'kiosko2026', full_name: 'Ernesto Valdés Mena', ci: '94110528719', role: 'vendedor', shift_template_id: 1, default_register: 2, contract_type: 'Indeterminado', contract_date: '2025-02-15', base_salary_cup: 7200, sales_commission_pct: 1.2, phone: '+53 55739012', active: 1 },
      { id: 6, username: 'vendedor3', pw: 'kiosko2026', full_name: 'Yaima Hernández Soto', ci: '98022419638', role: 'vendedor', shift_template_id: 2, default_register: 1, contract_type: 'Indeterminado', contract_date: '2025-03-01', base_salary_cup: 7200, sales_commission_pct: 1.2, phone: '+53 59041182', active: 1 },
      { id: 7, username: 'vendedor4', pw: 'kiosko2026', full_name: 'Luis Alberto Cabrera', ci: '93081914527', role: 'vendedor', shift_template_id: 2, default_register: 2, contract_type: 'Indeterminado', contract_date: '2025-03-01', base_salary_cup: 7200, sales_commission_pct: 1.2, phone: '+53 53661209', active: 1 },
    ],
    products: [],
    movements: [],
    restocks: [],
    sessions: [],
    registers: [],
    ipvs: [],
    sales: [],
    deposits: [],
    expenses: [],
    journal: [],
    payrolls: [],
    taxes: [],
    priceHistory: [],
    automations: [],
    audits: [],
    currentUserId: null,
  };
  s.seq.user = 8;
  s.seq.shift = 3;

  const y = offsetDate(-1);
  const t = todayIso();

  addJournal(s, {
    date: y,
    sourceType: 'APERTURA',
    sourceRef: 'ESC-0142',
    description: 'Saldos iniciales — Cuenta Bancaria Fiscal BANMET, Fondo de Caja y Reserva Legal',
    createdBy: 2,
    silent: true,
    lines: [
      { account: NCIF.BANCO_FISCAL, debit: 256000 },
      { account: NCIF.CAJA_CHICA, debit: 6000 },
      { account: NCIF.CAJA_GENERAL, debit: 6000 },
      { account: NCIF.CAPITAL_SOCIAL, credit: 250000 },
      { account: NCIF.RESERVA_LEGAL, credit: 18000 },
    ],
  });

  if (mode === 'clean') return s;

  const cat = [
    ['BAS-001', 'Pollo troceado (paq. 1 kg)', 'Básicos Regulados', 'kg', 510, 675, 1, 680, 'Res. 225/2024 MFP', 42, 16, 20, 8, 24, 'LT-POL-11A', 65],
    ['BAS-002', 'Aceite vegetal de soya 1L', 'Básicos Regulados', 'L', 740, 980, 1, 990, 'Res. 225/2024 MFP', 36, 8, 15, 8, 22, 'LT-ACE-09C', 180],
    ['BAS-003', 'Leche en polvo entera 1 kg', 'Básicos Regulados', 'kg', 1240, 1650, 1, 1675, 'Res. 225/2024 MFP', 18, 6, 8, 5, 12, 'LT-LEC-10B', 120],
    ['BAS-004', 'Pastas alimenticias espagueti 1 kg', 'Básicos Regulados', 'kg', 610, 820, 1, 835, 'Res. 225/2024 MFP', 30, 14, 12, 6, 20, 'LT-PAS-08F', 240],
    ['BAS-005', 'Salchichas de pollo (1 kg)', 'Básicos Regulados', 'kg', 760, 1020, 1, 1045, 'Res. 225/2024 MFP', 22, 7, 10, 6, 16, 'LT-SAL-11D', 12],
    ['BAS-006', 'Detergente en polvo multiuso 1 kg', 'Básicos Regulados', 'kg', 460, 620, 1, 630, 'Res. 225/2024 MFP', 35, 14, 12, 6, 20, 'LT-DET-07M', 365],
    ['ALI-007', 'Arroz blanco grano largo 1 kg', 'Alimentos y Conservas', 'kg', 340, 460, 0, null, '', 55, 22, 20, 10, 30, 'LT-ARR-11K', 210],
    ['ALI-008', 'Frijol negro seleccionado 1 kg', 'Alimentos y Conservas', 'kg', 520, 700, 0, null, '', 28, 13, 12, 6, 18, 'LT-FRI-10P', 190],
    ['ALI-009', 'Puré de tomate condimentado 400g', 'Alimentos y Conservas', 'u', 260, 350, 0, null, '', 32, 14, 10, 6, 18, 'LT-TOM-09R', 150],
    ['BEB-010', 'Malta Bucanero lata 355 ml', 'Bebidas y Refrescos', 'u', 210, 285, 0, null, '', 72, 11, 24, 10, 36, 'LT-MAL-11B', 140],
    ['BEB-011', 'Refresco de Cola Ciego Montero 1.5L', 'Bebidas y Refrescos', 'u', 270, 365, 0, null, '', 40, 16, 15, 8, 24, 'LT-REF-11E', 95],
    ['BEB-012', 'Jugo de Mango La Estancia 1L', 'Bebidas y Refrescos', 'u', 310, 420, 0, null, '', 26, 12, 10, 6, 18, 'LT-JUG-10V', 110],
    ['CON-013', 'Galletas dulces rellenas (paq. 250g)', 'Confituras y Panadería', 'paq', 195, 265, 0, null, '', 48, 20, 15, 8, 28, 'LT-GAL-11S', 85],
    ['ASE-014', 'Jabón de tocador Suchel 110g', 'Aseo y Hogar', 'u', 135, 185, 0, null, '', 50, 18, 15, 8, 25, 'LT-JAB-08Z', 400],
  ];

  let whVal = 0;
  let kVal = 0;
  for (const c of cat) {
    const id = s.seq.prod++;
    const exp = offsetDate(c[15]);
    s.products.push({
      id, sku: c[0], name: c[1], category: c[2], unit: c[3],
      unit_cost_cup: c[4], indirect_cost_pct: 8.0, sale_price_cup: c[5],
      is_price_capped: c[6], price_cap_cup: c[7], price_cap_resolution: c[8],
      is_margin_regulated: 1, sales_tax_exempt: 0,
      warehouse_stock: c[9], kiosk_stock: c[10], warehouse_min_stock: c[11],
      kiosk_min_stock: c[12], kiosk_target_stock: c[13], current_batch: c[14], next_expiry_date: exp, active: 1,
    });
    const tot = c[9] + c[10];
    whVal = r2(whVal + c[9] * c[4]);
    kVal = r2(kVal + c[10] * c[4]);
    s.movements.push({
      id: s.seq.mov++, doc_number: `SC204-${String(id).padStart(4, '0')}`, type: 'RECEPCION', status: 'APLICADO',
      product_id: id, quantity: tot, unit_cost_cup: c[4], total_cost_cup: r2(tot * c[4]),
      warehouse_balance_after: tot, kiosk_balance_after: 0,
      supplier_name: 'Comercializadora Mayorista Alimentos Habana', supplier_nit: '30001849201',
      invoice_number: `FAC-2026-${1100 + id}`, payment_method: 'TRANSFERENCIA', payment_ref: `BM-TRF-88${id}`,
      batch_code: c[14], expiry_date: exp, reason: 'Abastecimiento mayorista bancarizado', created_by: 3, created_at: `${y} 08:00:00`,
    });
    s.movements.push({
      id: s.seq.mov++, doc_number: `SC209-${String(id).padStart(4, '0')}`, type: 'TRANSFERENCIA_KIOSKO', status: 'APLICADO',
      product_id: id, quantity: c[10], unit_cost_cup: c[4], total_cost_cup: r2(c[10] * c[4]),
      warehouse_balance_after: c[9], kiosk_balance_after: c[10],
      supplier_name: '', payment_method: '', payment_ref: '', batch_code: c[14], expiry_date: exp,
      reason: 'Habilitación inicial de mostrador', created_by: 3, created_at: `${y} 09:00:00`,
    });
  }

  const totInv = r2(whVal + kVal);
  const bankPay = Math.min(185000, totInv);
  addJournal(s, {
    date: y, sourceType: 'RECEPCION', sourceRef: 'SC204-LOTE01',
    description: 'Recepción mayorista SC-2-04 — Pago bancarizado Res. 111/2023 BCC', createdBy: 3, silent: true,
    lines: [
      { account: NCIF.INV_ALMACEN, debit: totInv },
      { account: NCIF.BANCO_FISCAL, credit: bankPay },
      ...(totInv > bankPay ? [{ account: NCIF.PROVEEDORES, credit: r2(totInv - bankPay) }] : []),
    ],
  });
  addJournal(s, {
    date: y, sourceType: 'TRANSFERENCIA', sourceRef: 'SC209-LOTE01',
    description: 'Despacho Almacén Central → Mostrador del Kiosko (SC-2-09)', createdBy: 3, silent: true,
    lines: [
      { account: NCIF.INV_KIOSKO, debit: kVal },
      { account: NCIF.INV_ALMACEN, credit: kVal },
    ],
  });

  // Open today's Morning shift with 2 sellers (Dayana Caja 1, Ernesto Caja 2)
  const sessId = s.seq.session++;
  s.sessions.push({
    id: sessId, session_code: `TRN-${t.replace(/-/g, '')}-M`, shift_template_id: 1,
    work_date: t, status: 'ABIERTO', opened_at: `${t} 07:00:00`, opened_by: 4, notes: 'Turno Mañana activo con 2 vendedores.',
  });
  for (const p of s.products) {
    s.ipvs.push({
      id: s.seq.ipv++, shift_session_id: sessId, product_id: p.id,
      opening_qty: p.kiosk_stock, entries_qty: 0, losses_qty: 0, sold_qty: 0,
      closing_qty: p.kiosk_stock, sale_price_cup: p.sale_price_cup, sold_amount_cup: 0,
    });
  }
  s.registers.push(
    { id: s.seq.reg++, shift_session_id: sessId, register_number: 1, seller_id: 4, status: 'ABIERTA', opening_cash_cup: 3000, expected_cash_cup: 3000, counted_cash_cup: null, cash_difference_cup: 0, denominations: {}, total_sales_cup: 0, cash_sales_cup: 0, transfermovil_sales_cup: 0, enzona_sales_cup: 0, sales_count: 0, opened_at: `${t} 07:00:00` },
    { id: s.seq.reg++, shift_session_id: sessId, register_number: 2, seller_id: 5, status: 'ABIERTA', opening_cash_cup: 3000, expected_cash_cup: 3000, counted_cash_cup: null, cash_difference_cup: 0, denominations: {}, total_sales_cup: 0, cash_sales_cup: 0, transfermovil_sales_cup: 0, enzona_sales_cup: 0, sales_count: 0, opened_at: `${t} 07:03:00` }
  );

  // Seed 4 live sales across Seller 1 and Seller 2
  execSale(s, { items: [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 3 }, { product_id: 9, quantity: 2 }], payment_method: 'TRANSFERMOVIL', electronic_ref: 'TM95011287', register_id: 1 }, s.users[3], true);
  execSale(s, { items: [{ product_id: 7, quantity: 3 }, { product_id: 10, quantity: 4 }, { product_id: 13, quantity: 2 }], payment_method: 'EFECTIVO', cash_tendered_cup: 3500, register_id: 1 }, s.users[3], true);
  execSale(s, { items: [{ product_id: 3, quantity: 1 }, { product_id: 5, quantity: 2 }, { product_id: 11, quantity: 2 }], payment_method: 'ENZONA', electronic_ref: 'EZ77209418', register_id: 2 }, s.users[4], true);
  execSale(s, { items: [{ product_id: 4, quantity: 2 }, { product_id: 10, quantity: 3 }, { product_id: 14, quantity: 3 }], payment_method: 'MIXTO', cash_amount_cup: 1500, electronic_channel: 'TRANSFERMOVIL', electronic_ref: 'TM95044819', register_id: 2 }, s.users[4], true);

  // Pending merma SC-2-16 + pending deposit DEP-0001 + UNE expense
  s.movements.push({
    id: s.seq.mov++, doc_number: 'SC216-0001', type: 'MERMA', status: 'PENDIENTE_APROBACION',
    product_id: 13, quantity: 2, unit_cost_cup: 195, total_cost_cup: 390,
    warehouse_balance_after: 48, kiosk_balance_after: 18, batch_code: 'LT-GAL-11S',
    reason: '[ALMACEN] 2 paquetes con envase deteriorado en manipulación de estiba', created_by: 3, created_at: `${t} 09:10:00`,
  });
  s.deposits.push({
    id: s.seq.dep++, order_number: 'DEP-0001', origin: 'AUTOMATICO', amount_cup: 4550,
    due_date: nextBizDay(t), status: 'PENDIENTE', bank_voucher_ref: '',
    notes: 'Efectivo recaudado en turno previo — Depositar en BANMET (Res. 111/2023 BCC)', created_by: 2, created_at: `${y} 22:55:00`,
  });
  s.expenses.push({
    id: s.seq.exp++, doc_number: 'GAS-0001', expense_date: y, category: 'Electricidad (UNE)',
    description: 'Factura eléctrica mensual refrigeración y local comercial', provider_name: 'Empresa Eléctrica de La Habana (UNE)',
    invoice_ref: 'UNE-11-482910', has_valid_receipt: 1, amount_cup: 2850, payment_method: 'TRANSFERMOVIL', payment_ref: 'TM-UNE-48291', created_by: 2,
  });
  addJournal(s, {
    date: y, sourceType: 'GASTO', sourceRef: 'GAS-0001',
    description: 'Gasto operativo deducible: Electricidad (UNE)', createdBy: 2, silent: true,
    lines: [{ account: NCIF.GASTOS_ADMIN, debit: 2850 }, { account: NCIF.BANCO_FISCAL, credit: 2850 }],
  });

  s.automations.push(
    { id: s.seq.auto++, category: 'TURNO', severity: 'INFO', title: 'Turno Mañana activo (2/2 vendedores)', detail: 'Caja 1: Dayana Torres · Caja 2: Ernesto Valdés. IPV inicializado.', ref_code: 'TRN', created_at: `${t} 07:03:00` },
    { id: s.seq.auto++, category: 'PRECIOS_MFP', severity: 'INFO', title: 'Topes Res. 225/2024 MFP verificados', detail: '6 productos básicos regulados dentro del precio máximo y margen ≤ 30%.', ref_code: 'MFP-225', created_at: `${t} 07:05:00` }
  );
  addAudit(s, s.users[3], 'APERTURA_CAJA', 'Turnos y POS', 'Apertura de Caja 1 en Turno Mañana (fondo 3,000 CUP).');
  addAudit(s, s.users[4], 'APERTURA_CAJA', 'Turnos y POS', 'Apertura de Caja 2 en Turno Mañana (fondo 3,000 CUP).');
  return s;
}

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  const fresh = buildInitialState('demo');
  saveState(fresh);
  return fresh;
}

function saveState(s) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

function enrichUser(s, u) {
  if (!u) return null;
  const st = s.shifts.find((x) => x.id === u.shift_template_id);
  const { pw: _pw, ...safe } = u;
  return { ...safe, shift_name: st?.name || null, shift_code: st?.code || null, start_time: st?.start_time || null, end_time: st?.end_time || null };
}

function execSale(s, body, user, silent = false) {
  const sess = s.sessions.find((x) => x.status === 'ABIERTO');
  if (!sess) err400('No hay ningún turno abierto. Abra el turno antes de facturar.');
  const reg =
    user.role === 'vendedor'
      ? s.registers.find((r) => r.shift_session_id === sess.id && r.seller_id === user.id && r.status === 'ABIERTA')
      : s.registers.find((r) => r.id === Number(body.register_id) && r.status === 'ABIERTA') ||
        s.registers.find((r) => r.shift_session_id === sess.id && r.status === 'ABIERTA');
  if (!reg) err400('No tiene una caja abierta en el turno actual.');

  const method = String(body.payment_method || 'EFECTIVO').toUpperCase();
  if (['TRANSFERMOVIL', 'ENZONA', 'MIXTO'].includes(method) && !String(body.electronic_ref || '').trim()) {
    err400('Bancarización (Res. 111/2023 BCC): Ingrese el código de operación de Transfermóvil o EnZona.');
  }

  let sub = 0;
  let cost = 0;
  const resolved = body.items.map((raw) => {
    const p = s.products.find((x) => x.id === Number(raw.product_id));
    const q = r2(raw.quantity);
    if (!p || q <= 0) err400('Producto o cantidad inválida.');
    if (q > p.kiosk_stock + 0.001) err400(`Stock insuficiente en mostrador para "${p.name}" (quedan ${p.kiosk_stock} ${p.unit}).`);
    const lt = r2(p.sale_price_cup * q);
    const lc = r2(p.unit_cost_cup * q);
    sub = r2(sub + lt);
    cost = r2(cost + lc);
    return { p, q, lt, lc };
  });

  const qrDisc =
    (method === 'TRANSFERMOVIL' || method === 'ENZONA') && s.config.qr_discount_pct > 0
      ? r2((sub * s.config.qr_discount_pct) / 100)
      : 0;
  const total = r2(sub - qrDisc);
  let cash = 0;
  let tendered = 0;
  let change = 0;
  let tm = 0;
  let ez = 0;
  if (method === 'EFECTIVO') {
    cash = total;
    tendered = Number(body.cash_tendered_cup) > 0 ? r2(body.cash_tendered_cup) : total;
    if (tendered < total - 0.01) err400('Efectivo recibido inferior al total a cobrar.');
    change = r2(tendered - total);
  } else if (method === 'TRANSFERMOVIL') tm = total;
  else if (method === 'ENZONA') ez = total;
  else {
    cash = r2(body.cash_amount_cup);
    if (cash <= 0 || cash >= total) err400('Parte en efectivo inválida para pago mixto.');
    if (body.electronic_channel === 'ENZONA') ez = r2(total - cash);
    else tm = r2(total - cash);
  }

  const receipt = `TK-${String(s.sales.length + 1).padStart(5, '0')}`;
  const triggered = [];
  const saleItems = resolved.map(({ p, q, lt, lc }) => {
    p.kiosk_stock = r2(p.kiosk_stock - q);
    const snap = s.ipvs.find((i) => i.shift_session_id === sess.id && i.product_id === p.id);
    if (snap) {
      snap.sold_qty = r2(snap.sold_qty + q);
      snap.closing_qty = r2(snap.closing_qty - q);
      snap.sold_amount_cup = r2(snap.sold_amount_cup + lt);
    }
    s.movements.push({
      id: s.seq.mov++, doc_number: receipt, type: 'VENTA', status: 'APLICADO', product_id: p.id,
      quantity: q, unit_cost_cup: p.unit_cost_cup, total_cost_cup: lc,
      warehouse_balance_after: p.warehouse_stock, kiosk_balance_after: p.kiosk_stock,
      reason: `Venta Caja ${reg.register_number} (${method})`, created_by: reg.seller_id, created_at: nowIso(),
    });
    const rr = triggerRestock(s, p.id);
    if (rr?.created) triggered.push({ product_name: p.name, suggested_qty: rr.suggested_qty, unit: p.unit });
    return { id: s.seq.sitem++, product_id: p.id, product_name: p.name, unit: p.unit, quantity: q, unit_price_cup: p.sale_price_cup, unit_cost_cup: p.unit_cost_cup, line_total_cup: lt, line_cost_cup: lc, is_price_capped: p.is_price_capped };
  });

  reg.expected_cash_cup = r2(reg.expected_cash_cup + cash);
  reg.total_sales_cup = r2(reg.total_sales_cup + total);
  reg.cash_sales_cup = r2(reg.cash_sales_cup + cash);
  reg.transfermovil_sales_cup = r2(reg.transfermovil_sales_cup + tm);
  reg.enzona_sales_cup = r2(reg.enzona_sales_cup + ez);
  reg.sales_count += 1;

  const seller = s.users.find((u) => u.id === reg.seller_id);
  const sale = {
    id: s.seq.sale++, receipt_number: receipt, shift_session_id: sess.id, shift_register_id: reg.id,
    seller_id: reg.seller_id, seller_name: seller?.full_name || '', register_number: reg.register_number,
    sale_date: todayIso(), subtotal_cup: sub, qr_discount_cup: qrDisc, total_cup: total, total_cost_cup: cost,
    payment_method: method, cash_amount_cup: cash, cash_tendered_cup: tendered, change_given_cup: change,
    transfermovil_amount_cup: tm, enzona_amount_cup: ez, electronic_ref: body.electronic_ref || '',
    customer_phone: body.customer_phone || '', status: 'COMPLETADA', reconciled: 0, created_at: nowIso(), items: saleItems,
  };
  s.sales.push(sale);

  const je = addJournal(s, {
    date: todayIso(), sourceType: 'VENTA', sourceRef: receipt,
    description: `Venta ${receipt} — Caja ${reg.register_number} (${method}) + costo de venta`,
    createdBy: reg.seller_id, silent,
    lines: [
      ...(cash > 0 ? [{ account: NCIF.CAJA_GENERAL, debit: cash }] : []),
      ...(tm + ez > 0 ? [{ account: NCIF.COBROS_QR, debit: r2(tm + ez) }] : []),
      ...(qrDisc > 0 ? [{ account: NCIF.GASTOS_VENTAS, debit: qrDisc }] : []),
      { account: NCIF.COSTO_VENTAS, debit: cost },
      { account: NCIF.INGRESOS_VENTAS, credit: sub },
      { account: NCIF.INV_KIOSKO, credit: cost },
    ],
  });
  if (!silent) addAudit(s, user, 'VENTA_POS', 'Turnos y POS', `${receipt}: ${total.toFixed(2)} CUP vía ${method}.`);
  return { sale, journal_entry: je, triggered_restocks: triggered };
}

function execTransfer(s, { productId, quantity, reason, user, restockId = null }) {
  const p = s.products.find((x) => x.id === Number(productId));
  const q = r2(quantity);
  if (!p || q <= 0) err400('Producto o cantidad inválida.');
  if (q > p.warehouse_stock) err400(`Stock insuficiente en Almacén para "${p.name}" (${p.warehouse_stock} ${p.unit}).`);
  p.warehouse_stock = r2(p.warehouse_stock - q);
  p.kiosk_stock = r2(p.kiosk_stock + q);
  const tc = r2(q * p.unit_cost_cup);
  const doc = `SC209-${String(s.movements.length + 1).padStart(4, '0')}`;
  const movId = s.seq.mov++;
  s.movements.push({
    id: movId, doc_number: doc, type: 'TRANSFERENCIA_KIOSKO', status: 'APLICADO', product_id: p.id,
    quantity: q, unit_cost_cup: p.unit_cost_cup, total_cost_cup: tc,
    warehouse_balance_after: p.warehouse_stock, kiosk_balance_after: p.kiosk_stock,
    reason: reason || 'Despacho a mostrador (FEFO)', created_by: user.id, created_at: nowIso(),
  });
  const open = s.sessions.find((x) => x.status === 'ABIERTO');
  if (open) {
    const snap = s.ipvs.find((i) => i.shift_session_id === open.id && i.product_id === p.id);
    if (snap) {
      snap.entries_qty = r2(snap.entries_qty + q);
      snap.closing_qty = r2(snap.closing_qty + q);
    }
  }
  s.restocks.forEach((rr) => {
    if (rr.status === 'PENDIENTE' && (rr.id === restockId || rr.product_id === p.id)) {
      rr.status = 'DESPACHADO';
      rr.movement_id = movId;
    }
  });
  const je = addJournal(s, {
    date: todayIso(), sourceType: 'TRANSFERENCIA', sourceRef: doc,
    description: `Vale SC-2-09 ${doc}: ${q} ${p.unit} de ${p.name} → Mostrador`, createdBy: user.id,
    lines: [{ account: NCIF.INV_KIOSKO, debit: tc }, { account: NCIF.INV_ALMACEN, credit: tc }],
  });
  addAudit(s, user, 'DESPACHO_SC209', 'Almacén', `${doc}: ${q} ${p.unit} de ${p.name} al Kiosko.`);
  return { doc_number: doc, product_name: p.name, quantity: q, ipv_updated: Boolean(open), journal_entry: je };
}

function calcPayroll(s, period) {
  const cfg = s.config;
  const items = s.users
    .filter((u) => u.active)
    .map((u) => {
      const salesSum = r2(
        s.sales.filter((x) => x.seller_id === u.id && x.sale_date.startsWith(period)).reduce((a, x) => a + x.total_cup, 0)
      );
      const shiftsWorked = s.registers.filter((r) => {
        const ss = s.sessions.find((z) => z.id === r.shift_session_id);
        return r.seller_id === u.id && ss?.work_date.startsWith(period);
      }).length;
      const comm = u.role === 'vendedor' ? r2((salesSum * u.sales_commission_pct) / 100) : 0;
      const gross = r2(u.base_salary_cup + comm);
      const tcpOwner = cfg.legal_form === 'TCP' && u.role === 'jefe';
      const vac = tcpOwner ? 0 : r2((gross * cfg.vacation_provision_pct) / 100);
      const wss = tcpOwner ? 0 : calcWorkerSS(gross, cfg.worker_ss_pct);
      const iip = tcpOwner ? 0 : calcIIP(gross, cfg.iip_exempt_monthly_cup);
      const net = r2(gross - wss - iip);
      const ess = tcpOwner ? 0 : r2((gross * cfg.employer_ss_pct) / 100);
      const iuft = tcpOwner ? 0 : r2(((gross + vac) * cfg.labor_force_tax_pct) / 100);
      return {
        user_id: u.id, full_name: u.full_name, role: u.role, ci: u.ci,
        shifts_worked: shiftsWorked, seller_sales_cup: salesSum, base_salary_cup: u.base_salary_cup,
        commission_cup: comm, gross_salary_cup: gross, vacation_accrual_cup: vac,
        worker_ss_cup: wss, worker_iip_cup: iip, net_salary_cup: net, employer_ss_cup: ess, labor_tax_cup: iuft,
      };
    });
  const sum = (k) => r2(items.reduce((a, i) => a + i[k], 0));
  return {
    items,
    totals: {
      period,
      total_gross_cup: sum('gross_salary_cup'),
      total_vacation_accrual_cup: sum('vacation_accrual_cup'),
      total_worker_ss_cup: sum('worker_ss_cup'),
      total_worker_iip_cup: sum('worker_iip_cup'),
      total_net_cup: sum('net_salary_cup'),
      total_employer_ss_cup: sum('employer_ss_cup'),
      total_labor_tax_cup: sum('labor_tax_cup'),
    },
  };
}

function calcOnat(s, period) {
  const cfg = s.config;
  const pSales = s.sales.filter((x) => x.sale_date.startsWith(period));
  const gross = r2(pSales.reduce((a, x) => a + x.total_cup, 0));
  const sub = r2(pSales.reduce((a, x) => a + x.subtotal_cup, 0));
  const qrd = r2(pSales.reduce((a, x) => a + x.qr_discount_cup, 0));
  const cogs = r2(pSales.reduce((a, x) => a + x.total_cost_cup, 0));
  const cash = r2(pSales.reduce((a, x) => a + x.cash_amount_cup, 0));
  const tm = r2(pSales.reduce((a, x) => a + x.transfermovil_amount_cup, 0));
  const ez = r2(pSales.reduce((a, x) => a + x.enzona_amount_cup, 0));
  const pExp = s.expenses.filter((x) => x.expense_date.startsWith(period));
  const dedExp = r2(pExp.filter((x) => x.has_valid_receipt).reduce((a, x) => a + x.amount_cup, 0));
  const nonDed = r2(pExp.filter((x) => !x.has_valid_receipt).reduce((a, x) => a + x.amount_cup, 0));
  const mermas = r2(s.movements.filter((m) => m.type === 'MERMA' && m.status === 'APLICADO').reduce((a, m) => a + m.total_cost_cup, 0));
  const pay = s.payrolls.find((p) => p.period === period) || { ...calcPayroll(s, period).totals, status: 'PROYECCION_AUTOMATICA' };

  const salesTax = r2((gross * cfg.sales_tax_pct) / 100);
  const ctdl = r2((gross * cfg.local_dev_tax_pct) / 100);
  const iuft = pay.total_labor_tax_cup;
  const ess = pay.total_employer_ss_cup;
  const wh = r2(pay.total_worker_ss_cup + pay.total_worker_iip_cup);
  const dedTax = r2(salesTax + ctdl + iuft + ess);
  const pbt = r2(gross - (cogs + dedExp + mermas + pay.total_gross_cup + pay.total_vacation_accrual_cup + dedTax));
  const room = Math.max(0, cfg.social_capital_cup * 0.2 - cfg.legal_reserve_balance_cup);
  const resProv = cfg.legal_form === 'MIPYME' && pbt > 0 ? r2(Math.min(room, (pbt * cfg.legal_reserve_pct) / 100)) : 0;
  const taxProf = Math.max(0, r2(pbt - resProv));
  const profTax = cfg.legal_form === 'MIPYME' ? r2((taxProf * cfg.profit_tax_pct) / 100) : calcIIP(taxProf, cfg.iip_exempt_monthly_cup);
  const net = r2(pbt - resProv - profTax - nonDed);
  const due = onatDue(period);

  const raw = [
    { tax_code: 'VENTAS_10', tax_name: 'Impuesto sobre las Ventas Minoristas', onat_paragraph: cfg.legal_form === 'MIPYME' ? '011402' : '013002', frequency: 'Mensual (antes del día 20)', law_ref: 'Ley 113', taxable_base_cup: gross, rate_pct: cfg.sales_tax_pct, amount_cup: salesTax, due_date: due },
    { tax_code: 'CTDL_1', tax_name: 'Contribución Territorial para el Desarrollo Local', onat_paragraph: '073012', frequency: 'Mensual (antes del día 20)', law_ref: 'Ley 113 — Municipio', taxable_base_cup: gross, rate_pct: cfg.local_dev_tax_pct, amount_cup: ctdl, due_date: due },
    { tax_code: 'IUFT_5', tax_name: 'Impuesto por la Utilización de la Fuerza de Trabajo', onat_paragraph: '061032', frequency: 'Mensual (antes del día 20)', law_ref: 'Ley 113 Art. 225', taxable_base_cup: r2(pay.total_gross_cup + pay.total_vacation_accrual_cup), rate_pct: cfg.labor_force_tax_pct, amount_cup: iuft, due_date: due },
    { tax_code: 'SS_EMPLEADOR', tax_name: 'Contribución a la Seguridad Social (Entidad)', onat_paragraph: '082013', frequency: 'Mensual (antes del día 20)', law_ref: 'Ley 105 / Ley 113', taxable_base_cup: pay.total_gross_cup, rate_pct: cfg.employer_ss_pct, amount_cup: ess, due_date: due },
    { tax_code: 'RETENCION_SS_IIP', tax_name: 'Retenciones a Trabajadores (SS 5% + Ingresos Personales)', onat_paragraph: '082053 / 051052', frequency: 'Mensual (antes del día 20)', law_ref: 'Ley 113 — Retenedor', taxable_base_cup: pay.total_gross_cup, rate_pct: pay.total_gross_cup ? r2((wh / pay.total_gross_cup) * 100) : 0, amount_cup: wh, due_date: due },
    { tax_code: 'UTILIDADES_35', tax_name: cfg.legal_form === 'MIPYME' ? 'Provisión Impuesto sobre Utilidades (MIPYME)' : 'Provisión Ingresos Personales TCP (DJ-08)', onat_paragraph: cfg.legal_form === 'MIPYME' ? '040082' : '051012', frequency: 'Trimestral / DJ Anual', law_ref: cfg.legal_form === 'MIPYME' ? 'DL 88/2024' : 'DL 90/2024', taxable_base_cup: taxProf, rate_pct: cfg.profit_tax_pct, amount_cup: profTax, due_date: due },
  ];

  const obligations = raw.map((o) => {
    const f = s.taxes.find((x) => x.period === period && x.tax_code === o.tax_code);
    return { ...o, status: f?.status || 'CALCULADO', payment_ref: f?.payment_ref || '', paid_amount_cup: f ? o.amount_cup : 0 };
  });
  const totOnat = r2(obligations.reduce((a, o) => a + o.amount_cup, 0));
  const totPaid = r2(obligations.reduce((a, o) => a + o.paid_amount_cup, 0));

  return {
    period,
    legal_form: cfg.legal_form,
    due_date: due,
    payroll_source: pay.status,
    available_periods: [period],
    business: cfg,
    income_statement: {
      sales_count: pSales.length, subtotal_cup: sub, qr_discount_cup: qrd, gross_sales_cup: gross,
      taxable_sales_cup: gross, exempt_sales_cup: 0, cash_sales_cup: cash,
      transfermovil_sales_cup: tm, enzona_sales_cup: ez, electronic_sales_cup: r2(tm + ez),
      electronic_share_pct: gross > 0 ? r2(((tm + ez) / gross) * 100) : 0,
      cogs_cup: cogs, gross_profit_cup: r2(gross - cogs), deductible_expenses_cup: dedExp,
      non_deductible_expenses_cup: nonDed, mermas_cup: mermas, payroll_gross_cup: pay.total_gross_cup,
      payroll_vacation_cup: pay.total_vacation_accrual_cup, deductible_taxes_cup: dedTax,
      profit_before_tax_cup: pbt, legal_reserve_provision_cup: resProv, taxable_profit_cup: taxProf,
      profit_tax_provision_cup: profTax, net_profit_cup: net,
    },
    obligations,
    totals: { total_onat_cup: totOnat, total_paid_cup: totPaid, total_pending_cup: r2(totOnat - totPaid) },
  };
}

function calcCompliance(s) {
  const cfg = s.config;
  const active = s.users.filter((u) => u.active);
  const hired = active.filter((u) => u.role !== 'jefe').length;
  const capBad = s.products.filter((p) => calcCostSheet(p, cfg).exceeds_cap);
  const mrgBad = s.products.filter((p) => calcCostSheet(p, cfg).exceeds_margin);
  const pDeps = s.deposits.filter((d) => d.status === 'PENDIENTE');
  const pMermas = s.movements.filter((m) => m.status === 'PENDIENTE_APROBACION');
  const checks = [
    cfg.legal_form === 'TCP' && hired > 3
      ? { code: 'DL90', authority: 'MTSS / ONAT', law: 'DL 90/2024 y DL 88/2024', title: 'Límite de 3 contratados en TCP superado', status: 'CRITICO', detail: `Tiene ${hired} contratados; debe operar como Micro-MIPYME (DL 88/2024).` }
      : { code: 'DL88', authority: 'MEP / MTSS', law: 'Decreto-Ley 88/2024 (Micro-MIPYME)', title: 'Forma jurídica y plantilla en regla', status: 'OK', detail: `${active.length} integrantes: 1 Jefe, 1 Económico, 1 Almacenero y 2 vendedores por turno.` },
    { code: 'BCC1', authority: 'BCC / ONAT', law: 'Resolución 111/2023 BCC', title: 'Cuenta Bancaria Fiscal y cobro QR obligatorio', status: 'OK', detail: `Cuenta ${cfg.fiscal_account_cup} (${cfg.bank_name}), QR Transfermóvil y EnZona habilitados.` },
    { code: 'BCC2', authority: 'BCC', law: 'Resolución 111/2023 BCC', title: 'Depósito de efectivo recaudado', status: pDeps.length ? 'ALERTA' : 'OK', detail: pDeps.length ? `${pDeps.length} orden(es) de depósito pendiente(s) para próximo día hábil.` : 'Todo el efectivo excedente está depositado.' },
    { code: 'BCC3', authority: 'BCC / ONAT', law: 'Resolución 111/2023 BCC', title: `Tope de ${cfg.max_cash_provider_payment_cup} CUP en pagos en efectivo`, status: 'OK', detail: '100% de pagos mayores liquidados por vía electrónica.' },
    { code: 'MFP1', authority: 'MFP / DIS', law: 'Resolución 225/2024 MFP y Decreto 30', title: 'Precios minoristas topados y Tablilla CUP', status: capBad.length ? 'CRITICO' : 'OK', detail: capBad.length ? `Violación en ${capBad.map((x) => x.name).join(', ')}` : '6 productos básicos regulados dentro del tope oficial.' },
    { code: 'MFP2', authority: 'MFP', law: `Margen máx. ${cfg.max_regulated_margin_pct}%`, title: 'Fichas de Costo y margen comercial', status: mrgBad.length ? 'ALERTA' : 'OK', detail: 'Todos los productos cuentan con Ficha de Costo dentro del límite.' },
    { code: 'MTSS', authority: 'MTSS', law: 'Ley 116 — Código de Trabajo', title: 'Salario mínimo (2,100 CUP), contratos y 9.09% vacaciones', status: 'OK', detail: 'Todos los salarios superan el mínimo legal con acumulación de vacaciones.' },
    { code: 'ONAT', authority: 'ONAT', law: 'Ley 113 del Sistema Tributario', title: 'Obligaciones tributarias al día (día 20)', status: 'OK', detail: 'Sin tributos vencidos; provisión mensual automatizada.' },
    { code: 'CGR', authority: 'Control Interno', law: 'Res. 60/22 / NCIF', title: 'Modelos SC, IPV y arqueos de caja', status: pMermas.length ? 'ALERTA' : 'OK', detail: pMermas.length ? `${pMermas.length} acta(s) SC-2-16 pendiente(s) de aprobación.` : 'Todo conciliado.' },
    { code: 'DIS', authority: 'DIS / MINSAP', law: 'Protección al Consumidor', title: 'Control FEFO de vencimientos', status: 'ALERTA', detail: 'Salchichas de pollo con vencimiento próximo priorizadas en despacho FEFO.' },
  ];
  const ok = checks.filter((c) => c.status === 'OK').length;
  const warn = checks.filter((c) => c.status === 'ALERTA').length;
  const crit = checks.filter((c) => c.status === 'CRITICO').length;
  const score = Math.round(((ok + warn * 0.6) / checks.length) * 100);
  return { score, overall: crit ? 'RIESGO_MULTA' : warn ? 'ATENCION' : 'CUMPLIENDO', ok_count: ok, warning_count: warn, critical_count: crit, checks };
}

function acctBal(s, code) {
  let b = 0;
  for (const j of s.journal) {
    for (const l of j.lines) if (l.account_code === code) b += l.debit_cup - l.credit_cup;
  }
  return r2(b);
}

function getBadges(s) {
  const open = s.sessions.find((x) => x.status === 'ABIERTO');
  const st = open ? s.shifts.find((x) => x.id === open.shift_template_id) : null;
  const openRegs = open ? s.registers.filter((r) => r.shift_session_id === open.id && r.status === 'ABIERTA').length : 0;
  const comp = calcCompliance(s);
  return {
    pending_restocks: s.restocks.filter((r) => r.status === 'PENDIENTE').length,
    pending_mermas: s.movements.filter((m) => m.status === 'PENDIENTE_APROBACION').length,
    pending_deposits: s.deposits.filter((d) => d.status === 'PENDIENTE').length,
    unreconciled_qr: s.sales.filter((x) => !x.reconciled && (x.transfermovil_amount_cup > 0 || x.enzona_amount_cup > 0)).length,
    unvalidated_shifts: s.sessions.filter((x) => x.status === 'CERRADO').length,
    active_shift: open ? { ...open, shift_name: st?.name || 'Turno', open_registers: openRegs } : null,
    compliance_score: comp.score,
    compliance_overall: comp.overall,
    compliance_critical: comp.critical_count,
  };
}

function sessionBundle(s, id) {
  const sess = s.sessions.find((x) => x.id === Number(id));
  if (!sess) return null;
  const st = s.shifts.find((x) => x.id === sess.shift_template_id);
  const regs = s.registers
    .filter((r) => r.shift_session_id === sess.id)
    .map((r) => {
      const u = s.users.find((z) => z.id === r.seller_id);
      return { ...r, seller_name: u?.full_name || '', seller_ci: u?.ci || '' };
    });
  const ipv = s.ipvs
    .filter((i) => i.shift_session_id === sess.id)
    .map((i) => {
      const p = s.products.find((z) => z.id === i.product_id);
      return { ...i, sku: p.sku, product_name: p.name, category: p.category, unit: p.unit, is_price_capped: p.is_price_capped, kiosk_min_stock: p.kiosk_min_stock };
    });
  const sales = s.sales.filter((x) => x.shift_session_id === sess.id).slice().reverse();
  return {
    session: { ...sess, shift_name: st?.name || 'Turno', start_time: st?.start_time, end_time: st?.end_time },
    registers: regs,
    ipv,
    sales,
    totals: {
      total_sales_cup: r2(regs.reduce((a, r) => a + r.total_sales_cup, 0)),
      ipv_sold_amount_cup: r2(ipv.reduce((a, i) => a + i.sold_amount_cup, 0)),
    },
  };
}

export function handleStaticApi(method, rawPath, body = {}) {
  const s = loadState();
  const url = new URL(rawPath, 'http://local');
  const p = url.pathname;
  const me = s.users.find((u) => u.id === s.currentUserId && u.active);

  const finish = (res) => {
    saveState(s);
    return res;
  };

  if (p === '/api/auth/roles-preview') {
    const open = s.sessions.find((x) => x.status === 'ABIERTO');
    return {
      business_name: s.config.business_name,
      legal_form: s.config.legal_form,
      municipality: s.config.municipality,
      province: s.config.province,
      demo_switch_enabled: true,
      users: s.users.filter((u) => u.active).map((u) => ({
        ...enrichUser(s, u),
        active_register: open
          ? s.registers.find((r) => r.shift_session_id === open.id && r.seller_id === u.id && r.status === 'ABIERTA')?.register_number || null
          : null,
      })),
    };
  }

  if (p === '/api/auth/login' && method === 'POST') {
    const u = s.users.find((x) => x.active && x.username.toLowerCase() === String(body.username || '').trim().toLowerCase());
    if (!u || u.pw !== String(body.password || '')) err400('Credenciales incorrectas.', 401);
    s.currentUserId = u.id;
    return finish({ token: `static-${u.id}`, user: enrichUser(s, u), config: s.config, badges: getBadges(s) });
  }

  if (p === '/api/auth/quick-switch' && method === 'POST') {
    const u = s.users.find((x) => x.active && (x.id === Number(body.user_id) || x.username === body.username));
    if (!u) err400('Usuario no encontrado.', 404);
    s.currentUserId = u.id;
    return finish({ token: `static-${u.id}`, user: enrichUser(s, u), config: s.config, badges: getBadges(s) });
  }

  if (p === '/api/auth/logout') {
    s.currentUserId = null;
    return finish({ ok: true });
  }

  if (!me) err400('Sesión no iniciada.', 401);
  const user = enrichUser(s, me);

  if (p === '/api/auth/me') return { user, config: s.config, badges: getBadges(s) };
  if (p === '/api/config' && method === 'GET') return { config: s.config, shifts: s.shifts, mfp_res_225_caps: MFP_CAPS };
  if (p === '/api/config' && method === 'PUT') {
    Object.assign(s.config, body, { min_wage_cup: Math.max(2100, Number(body.min_wage_cup || 2100)) });
    addAudit(s, user, 'ACTUALIZACION_CONFIG', 'Configuración', 'Actualizados parámetros legales.');
    return finish({ config: s.config, compliance: calcCompliance(s) });
  }
  if (p === '/api/config/reset' && method === 'POST') {
    const next = buildInitialState(body.mode === 'clean' ? 'clean' : 'demo');
    next.currentUserId = 1;
    saveState(next);
    return { ok: true, message: body.mode === 'clean' ? 'Sistema inicializado en limpio.' : 'Datos de demostración restaurados.' };
  }
  if (p === '/api/config/audit') {
    return { audit_logs: s.audits.slice().reverse(), automation_events: s.automations.slice().reverse() };
  }
  if (p === '/api/config/staff' && method === 'GET') {
    const per = curPeriod();
    return {
      config: s.config,
      shifts: s.shifts,
      staff: s.users.map((u) => ({
        ...enrichUser(s, u),
        month_sales_cup: r2(s.sales.filter((x) => x.seller_id === u.id && x.sale_date.startsWith(per)).reduce((a, x) => a + x.total_cup, 0)),
        month_shifts: s.registers.filter((r) => r.seller_id === u.id).length,
      })),
    };
  }
  if (p === '/api/config/staff' && method === 'POST') {
    const ci = String(body.ci || '').replace(/\D/g, '');
    if (ci.length !== 11) err400('El Carné de Identidad debe tener 11 dígitos.');
    if (Number(body.base_salary_cup) < s.config.min_wage_cup) err400(`Ley 116: El salario no puede ser inferior a ${s.config.min_wage_cup} CUP.`);
    if (body.role === 'vendedor') {
      const inShift = s.users.filter((u) => u.active && u.role === 'vendedor' && u.shift_template_id === Number(body.shift_template_id));
      if (inShift.length >= 2) err400('Ese turno ya cuenta con sus 2 vendedores activos (Caja 1 y Caja 2).');
    }
    const id = s.seq.user++;
    s.users.push({
      id, username: body.username, pw: body.password || 'kiosko2026', full_name: body.full_name, ci,
      role: body.role, shift_template_id: body.role === 'vendedor' ? Number(body.shift_template_id) : null,
      default_register: body.role === 'vendedor' ? Number(body.default_register || 1) : null,
      contract_type: body.contract_type || 'Indeterminado', contract_date: todayIso(),
      base_salary_cup: r2(body.base_salary_cup), sales_commission_pct: Number(body.sales_commission_pct || 0),
      phone: body.phone || '', active: 1,
    });
    return finish({ id });
  }
  if (p.startsWith('/api/config/staff/') && method === 'PUT') {
    const id = Number(p.split('/').pop());
    const emp = s.users.find((u) => u.id === id);
    if (!emp) err400('No encontrado', 404);
    if (Number(body.base_salary_cup) < s.config.min_wage_cup) err400(`Ley 116: Salario mínimo ${s.config.min_wage_cup} CUP.`);
    Object.assign(emp, {
      full_name: body.full_name ?? emp.full_name,
      ci: body.ci ?? emp.ci,
      role: body.role ?? emp.role,
      shift_template_id: body.role === 'vendedor' ? Number(body.shift_template_id) : null,
      default_register: body.role === 'vendedor' ? Number(body.default_register) : null,
      contract_type: body.contract_type ?? emp.contract_type,
      base_salary_cup: r2(body.base_salary_cup ?? emp.base_salary_cup),
      sales_commission_pct: Number(body.sales_commission_pct ?? emp.sales_commission_pct),
      phone: body.phone ?? emp.phone,
      active: body.active ? 1 : 0,
    });
    return finish({ ok: true });
  }
  if (p === '/api/config/shifts' && method === 'POST') {
    const id = s.seq.shift++;
    s.shifts.push({ id, code: String(body.name).toUpperCase().slice(0, 8), name: body.name, start_time: body.start_time, end_time: body.end_time, required_sellers: 2, active: 1 });
    return finish({ id });
  }
  if (p === '/api/config/overview') {
    const t = todayIso();
    const per = curPeriod();
    const ts = s.sales.filter((x) => x.sale_date === t);
    const tSum = r2(ts.reduce((a, x) => a + x.total_cup, 0));
    const tQr = r2(ts.reduce((a, x) => a + x.transfermovil_amount_cup + x.enzona_amount_cup, 0));
    const whC = r2(s.products.reduce((a, x) => a + x.warehouse_stock * x.unit_cost_cup, 0));
    const kC = r2(s.products.reduce((a, x) => a + x.kiosk_stock * x.unit_cost_cup, 0));
    const open = s.sessions.find((x) => x.status === 'ABIERTO');
    const b = open ? sessionBundle(s, open.id) : null;
    const prodMap = new Map();
    s.sales.forEach((sa) => sa.items.forEach((it) => {
      const cur = prodMap.get(it.product_id) || { product_id: it.product_id, product_name: it.product_name, unit: it.unit, is_price_capped: it.is_price_capped, qty_sold: 0, revenue_cup: 0 };
      cur.qty_sold = r2(cur.qty_sold + it.quantity);
      cur.revenue_cup = r2(cur.revenue_cup + it.line_total_cup);
      prodMap.set(it.product_id, cur);
    }));
    return {
      today: t, period: per, config: s.config,
      today_sales: { tickets: ts.length, total_cup: tSum, electronic_pct: tSum ? r2((tQr / tSum) * 100) : 0 },
      bank_balance_cup: acctBal(s, '110'),
      inventory: {
        total_products: s.products.length, warehouse_cost_cup: whC, kiosk_cost_cup: kC, total_cost_cup: r2(whC + kC),
        low_kiosk_count: s.products.filter((x) => x.kiosk_stock <= x.kiosk_min_stock).length,
      },
      active_shift: b ? { ...b.session, registers: b.registers } : null,
      onat: calcOnat(s, per),
      compliance: calcCompliance(s),
      pending_approvals: {
        mermas: s.movements.filter((m) => m.status === 'PENDIENTE_APROBACION').map((m) => {
          const pr = s.products.find((z) => z.id === m.product_id);
          return { ...m, product_name: pr?.name, unit: pr?.unit };
        }),
        deposits: s.deposits.filter((d) => d.status === 'PENDIENTE'),
        restocks: s.restocks.filter((r) => r.status === 'PENDIENTE').map((r) => {
          const pr = s.products.find((z) => z.id === r.product_id);
          return { ...r, product_name: pr?.name, unit: pr?.unit, kiosk_stock: pr?.kiosk_stock, warehouse_stock: pr?.warehouse_stock };
        }),
        unvalidated_shifts: s.sessions.filter((x) => x.status === 'CERRADO').map((x) => ({
          ...x,
          total_sales_cup: r2(s.registers.filter((r) => r.shift_session_id === x.id).reduce((a, r) => a + r.total_sales_cup, 0)),
          total_diff_cup: r2(s.registers.filter((r) => r.shift_session_id === x.id).reduce((a, r) => a + (r.cash_difference_cup || 0), 0)),
        })),
      },
      top_products: Array.from(prodMap.values()).sort((a, z) => z.revenue_cup - a.revenue_cup).slice(0, 6),
      automation_feed: s.automations.slice().reverse().slice(0, 12),
    };
  }

  // Warehouse
  if (p === '/api/warehouse/products' && method === 'GET') {
    const t = todayIso();
    return {
      mfp_res_225_caps: MFP_CAPS,
      max_cash_provider_payment_cup: s.config.max_cash_provider_payment_cup,
      products: s.products.map((pr) => {
        const diff = pr.next_expiry_date ? Math.round((new Date(pr.next_expiry_date) - new Date(t)) / 86400000) : 999;
        return {
          ...pr,
          warehouse_value_cup: r2(pr.warehouse_stock * pr.unit_cost_cup),
          kiosk_value_cup: r2(pr.kiosk_stock * pr.unit_cost_cup),
          low_kiosk: pr.kiosk_stock <= pr.kiosk_min_stock,
          low_warehouse: pr.warehouse_stock <= pr.warehouse_min_stock,
          expiry_status: diff < 0 ? 'VENCIDO' : diff <= 15 ? 'PROXIMO_VENCER' : 'VIGENTE',
          pending_restock: s.restocks.find((r) => r.product_id === pr.id && r.status === 'PENDIENTE') || null,
          cost_sheet: calcCostSheet(pr, s.config),
        };
      }),
    };
  }
  if (p === '/api/warehouse/products' && method === 'POST') {
    const draft = {
      id: s.seq.prod++, sku: (body.sku || `PRD-${s.seq.prod}`).toUpperCase(), name: body.name,
      category: body.category, unit: body.unit, unit_cost_cup: r2(body.unit_cost_cup), indirect_cost_pct: 8,
      sale_price_cup: r2(body.sale_price_cup), is_price_capped: body.is_price_capped ? 1 : 0,
      price_cap_cup: body.is_price_capped ? r2(body.price_cap_cup) : null,
      price_cap_resolution: body.price_cap_resolution || 'Res. 225/2024 MFP', is_margin_regulated: 1,
      warehouse_stock: 0, kiosk_stock: 0, warehouse_min_stock: 10,
      kiosk_min_stock: Number(body.kiosk_min_stock || 5), kiosk_target_stock: 20, current_batch: '', next_expiry_date: '', active: 1,
    };
    if (!draft.sale_price_cup) draft.sale_price_cup = calcCostSheet(draft, s.config).suggested_price_cup;
    const cs = calcCostSheet(draft, s.config);
    if (cs.exceeds_cap || cs.exceeds_margin) err400('El precio supera el tope Res. 225/2024 o el margen máximo del 30% MFP.');
    s.products.push(draft);
    const open = s.sessions.find((x) => x.status === 'ABIERTO');
    if (open) s.ipvs.push({ id: s.seq.ipv++, shift_session_id: open.id, product_id: draft.id, opening_qty: 0, entries_qty: 0, losses_qty: 0, sold_qty: 0, closing_qty: 0, sale_price_cup: draft.sale_price_cup, sold_amount_cup: 0 });
    return finish({ id: draft.id, sku: draft.sku, sale_price_cup: draft.sale_price_cup });
  }
  if (p === '/api/warehouse/receipts' && method === 'POST') {
    const pr = s.products.find((x) => x.id === Number(body.product_id));
    const q = r2(body.quantity);
    const uc = r2(body.unit_cost_cup);
    const tc = r2(q * uc);
    const pm = body.payment_method;
    if (pm === 'EFECTIVO' && tc > s.config.max_cash_provider_payment_cup) {
      err400(`Resolución 111/2023 BCC: Pagos mayores a ${s.config.max_cash_provider_payment_cup} CUP (${tc} CUP) deben ser electrónicos.`);
    }
    if (['TRANSFERENCIA', 'TRANSFERMOVIL', 'ENZONA'].includes(pm) && !String(body.payment_ref || '').trim()) {
      err400('Indique el número de referencia bancaria.');
    }
    const curTot = pr.warehouse_stock + pr.kiosk_stock;
    pr.unit_cost_cup = curTot > 0 ? r2((curTot * pr.unit_cost_cup + tc) / (curTot + q)) : uc;
    pr.warehouse_stock = r2(pr.warehouse_stock + q);
    if (body.batch_code) pr.current_batch = body.batch_code;
    if (body.expiry_date) pr.next_expiry_date = body.expiry_date;
    const doc = `SC204-${String(s.movements.length + 1).padStart(4, '0')}`;
    s.movements.push({
      id: s.seq.mov++, doc_number: doc, type: 'RECEPCION', status: 'APLICADO', product_id: pr.id,
      quantity: q, unit_cost_cup: uc, total_cost_cup: tc, warehouse_balance_after: pr.warehouse_stock,
      kiosk_balance_after: pr.kiosk_stock, supplier_name: body.supplier_name, payment_method: pm,
      payment_ref: body.payment_ref || '', created_by: user.id, created_at: nowIso(),
    });
    const cred = pm === 'EFECTIVO' ? NCIF.CAJA_GENERAL : pm === 'CREDITO' ? NCIF.PROVEEDORES : NCIF.BANCO_FISCAL;
    const je = addJournal(s, {
      date: todayIso(), sourceType: 'RECEPCION', sourceRef: doc,
      description: `Recepción ${doc}: ${q} ${pr.unit} de ${pr.name}`, createdBy: user.id,
      lines: [{ account: NCIF.INV_ALMACEN, debit: tc }, { account: cred, credit: tc }],
    });
    triggerRestock(s, pr.id);
    return finish({ doc_number: doc, new_weighted_cost_cup: pr.unit_cost_cup, journal_entry: je });
  }
  if (p === '/api/warehouse/transfers' && method === 'POST') {
    return finish(execTransfer(s, { productId: body.product_id, quantity: body.quantity, reason: body.reason, user }));
  }
  if (p === '/api/warehouse/restock-requests' && method === 'GET') {
    return {
      requests: s.restocks.slice().reverse().map((r) => {
        const pr = s.products.find((z) => z.id === r.product_id);
        return { ...r, sku: pr?.sku, product_name: pr?.name, unit: pr?.unit, kiosk_stock: pr?.kiosk_stock, warehouse_stock: pr?.warehouse_stock };
      }),
    };
  }
  if (p === '/api/warehouse/restock-requests' && method === 'POST') {
    const pr = s.products.find((z) => z.id === Number(body.product_id));
    s.restocks.push({ id: s.seq.restock++, product_id: pr.id, suggested_qty: Math.max(1, pr.kiosk_target_stock - pr.kiosk_stock), origin: 'VENDEDOR', priority: 'URGENTE', status: 'PENDIENTE', created_at: nowIso() });
    return finish({ ok: true });
  }
  if (p === '/api/warehouse/restock-requests/fulfill-all' && method === 'POST') {
    const list = s.restocks.filter((r) => r.status === 'PENDIENTE');
    if (!list.length) err400('No hay órdenes pendientes.');
    const done = list.map((r) => {
      const pr = s.products.find((z) => z.id === r.product_id);
      return execTransfer(s, { productId: r.product_id, quantity: Math.min(r.suggested_qty, pr.warehouse_stock), user, restockId: r.id });
    });
    return finish({ count: done.length, dispatched: done });
  }
  if (p.endsWith('/fulfill') && method === 'POST') {
    const id = Number(p.split('/')[4]);
    const rr = s.restocks.find((x) => x.id === id && x.status === 'PENDIENTE');
    const pr = s.products.find((z) => z.id === rr.product_id);
    return finish(execTransfer(s, { productId: rr.product_id, quantity: Math.min(rr.suggested_qty, pr.warehouse_stock), user, restockId: rr.id }));
  }
  if (p === '/api/warehouse/mermas' && method === 'POST') {
    const pr = s.products.find((z) => z.id === Number(body.product_id));
    const q = r2(body.quantity);
    const doc = `SC216-${String(s.movements.length + 1).padStart(4, '0')}`;
    s.movements.push({
      id: s.seq.mov++, doc_number: doc, type: 'MERMA', status: 'PENDIENTE_APROBACION', product_id: pr.id,
      quantity: q, unit_cost_cup: pr.unit_cost_cup, total_cost_cup: r2(q * pr.unit_cost_cup),
      warehouse_balance_after: pr.warehouse_stock, kiosk_balance_after: pr.kiosk_stock,
      reason: `[${body.location}] ${body.reason}`, created_by: user.id, created_at: nowIso(),
    });
    return finish({ doc_number: doc });
  }
  if (p.includes('/api/warehouse/mermas/') && method === 'POST') {
    const id = Number(p.split('/')[4]);
    const m = s.movements.find((x) => x.id === id);
    if (body.decision === 'RECHAZAR') {
      m.status = 'RECHAZADO';
      return finish({ status: 'RECHAZADO', doc_number: m.doc_number });
    }
    const pr = s.products.find((z) => z.id === m.product_id);
    const fromK = m.reason.startsWith('[KIOSKO]');
    if (fromK) pr.kiosk_stock = r2(pr.kiosk_stock - m.quantity);
    else pr.warehouse_stock = r2(pr.warehouse_stock - m.quantity);
    m.status = 'APLICADO';
    const je = addJournal(s, {
      date: todayIso(), sourceType: 'MERMA', sourceRef: m.doc_number,
      description: `Baja por Merma ${m.doc_number} (${pr.name})`, createdBy: user.id,
      lines: [{ account: NCIF.GASTOS_VENTAS, debit: m.total_cost_cup }, { account: fromK ? NCIF.INV_KIOSKO : NCIF.INV_ALMACEN, credit: m.total_cost_cup }],
    });
    return finish({ status: 'APLICADO', doc_number: m.doc_number, journal_entry: je });
  }
  if (p === '/api/warehouse/movements') {
    const pid = url.searchParams.get('product_id');
    return {
      movements: s.movements
        .filter((m) => (!pid || m.product_id === Number(pid)))
        .slice()
        .reverse()
        .map((m) => {
          const pr = s.products.find((z) => z.id === m.product_id);
          const u = s.users.find((z) => z.id === m.created_by);
          return { ...m, product_name: pr?.name, unit: pr?.unit, created_by_name: u?.full_name };
        }),
    };
  }

  // POS & Shifts
  if (p === '/api/pos/active-shift') {
    const open = s.sessions.find((x) => x.status === 'ABIERTO');
    return { active: open ? sessionBundle(s, open.id) : null, shift_templates: s.shifts, denominations: DENOMS, payment_config: s.config };
  }
  if (p === '/api/pos/shifts' && method === 'GET') {
    return {
      sessions: s.sessions.slice().reverse().map((x) => ({
        ...x,
        shift_name: s.shifts.find((z) => z.id === x.shift_template_id)?.name || 'Turno',
      })),
    };
  }
  if (p.endsWith('/ipv') && method === 'GET') return sessionBundle(s, Number(p.split('/')[4]));
  if (p === '/api/pos/shifts/open' && method === 'POST') {
    let open = s.sessions.find((x) => x.status === 'ABIERTO');
    if (!open) {
      const id = s.seq.session++;
      open = { id, session_code: `TRN-${todayIso().replace(/-/g, '')}-${id}`, shift_template_id: Number(body.shift_template_id || 1), work_date: todayIso(), status: 'ABIERTO', opened_at: nowIso(), opened_by: user.id };
      s.sessions.push(open);
      s.products.forEach((pr) => s.ipvs.push({ id: s.seq.ipv++, shift_session_id: id, product_id: pr.id, opening_qty: pr.kiosk_stock, entries_qty: 0, losses_qty: 0, sold_qty: 0, closing_qty: pr.kiosk_stock, sale_price_cup: pr.sale_price_cup, sold_amount_cup: 0 }));
    }
    const regs = s.registers.filter((r) => r.shift_session_id === open.id);
    if (regs.length >= 2) err400('Máximo 2 vendedores simultáneos por turno (Caja 1 y Caja 2).');
    const sellerId = user.role === 'jefe' && body.seller_id ? Number(body.seller_id) : user.id;
    const regNum = regs.some((r) => r.register_number === Number(body.register_number)) ? (Number(body.register_number) === 1 ? 2 : 1) : Number(body.register_number || 1);
    const oc = r2(body.opening_cash_cup ?? s.config.petty_cash_fund_cup);
    s.registers.push({ id: s.seq.reg++, shift_session_id: open.id, register_number: regNum, seller_id: sellerId, status: 'ABIERTA', opening_cash_cup: oc, expected_cash_cup: oc, counted_cash_cup: null, cash_difference_cup: 0, total_sales_cup: 0, cash_sales_cup: 0, transfermovil_sales_cup: 0, enzona_sales_cup: 0, sales_count: 0, opened_at: nowIso() });
    return finish(sessionBundle(s, open.id));
  }
  if (p === '/api/pos/sales' && method === 'POST') return finish(execSale(s, body, user));
  if (p.includes('/api/pos/registers/') && p.endsWith('/close') && method === 'POST') {
    const id = Number(p.split('/')[4]);
    const reg = s.registers.find((r) => r.id === id);
    let counted = 0;
    for (const b of DENOMS) counted += b * Math.max(0, Math.floor(Number(body.denominations?.[b] || 0)));
    counted = r2(counted + Math.max(0, Number(body.denominations?.monedas || 0)));
    const diff = r2(counted - reg.expected_cash_cup);
    reg.status = 'ARQUEADA';
    reg.counted_cash_cup = counted;
    reg.cash_difference_cup = diff;
    if (diff < -0.5) addJournal(s, { date: todayIso(), sourceType: 'ARQUEO', sourceRef: `CAJA-${reg.register_number}`, description: `Faltante en Caja ${reg.register_number}`, createdBy: user.id, lines: [{ account: NCIF.FALTANTES, debit: Math.abs(diff) }, { account: NCIF.CAJA_GENERAL, credit: Math.abs(diff) }] });
    if (diff > 0.5) addJournal(s, { date: todayIso(), sourceType: 'ARQUEO', sourceRef: `CAJA-${reg.register_number}`, description: `Sobrante en Caja ${reg.register_number}`, createdBy: user.id, lines: [{ account: NCIF.CAJA_GENERAL, debit: diff }, { account: NCIF.OTROS_INGRESOS, credit: diff }] });
    const all = s.registers.filter((r) => r.shift_session_id === reg.shift_session_id);
    let autoDep = null;
    if (all.every((r) => r.status !== 'ABIERTA')) {
      const sess = s.sessions.find((x) => x.id === reg.shift_session_id);
      sess.status = 'CERRADO';
      const netCash = r2(all.reduce((a, r) => a + Math.max(0, r.counted_cash_cup - r.opening_cash_cup), 0));
      if (netCash > 0) {
        const order = `DEP-${String(s.deposits.length + 1).padStart(4, '0')}`;
        autoDep = { order_number: order, amount_cup: netCash, due_date: nextBizDay(todayIso()) };
        s.deposits.push({ id: s.seq.dep++, origin: 'AUTOMATICO', status: 'PENDIENTE', notes: 'Depósito cierre de turno (Res. 111/2023 BCC)', ...autoDep });
      }
    }
    return finish({ register_number: reg.register_number, cash_difference_cup: diff, auto_deposit: autoDep });
  }
  if (p.includes('/api/pos/shifts/') && p.endsWith('/audit') && method === 'POST') {
    const id = Number(p.split('/')[4]);
    const sess = s.sessions.find((x) => x.id === id);
    sess.status = 'AUDITADO';
    sess.audited_by_name = user.full_name;
    s.registers.filter((r) => r.shift_session_id === id).forEach((r) => { r.status = 'VALIDADA'; });
    return finish({ ok: true, session_code: sess.session_code });
  }

  // Finance
  if (p === '/api/finance/cost-sheets') {
    return { business: s.config, mfp_res_225_caps: MFP_CAPS, items: s.products.map((pr) => ({ ...pr, cost_sheet: calcCostSheet(pr, s.config) })), history: s.priceHistory };
  }
  if (p.includes('/api/finance/products/') && method === 'POST') {
    const id = Number(p.split('/')[4]);
    const pr = s.products.find((z) => z.id === id);
    const cand = { ...pr, ...body, sale_price_cup: r2(body.sale_price_cup), is_price_capped: body.is_price_capped ? 1 : 0, is_margin_regulated: body.is_margin_regulated ? 1 : 0 };
    const cs = calcCostSheet(cand, s.config);
    if (cs.exceeds_cap && s.config.strict_price_cap_block) err400(`Bloqueado por Res. 225/2024 MFP: supera tope de ${cs.price_cap_cup} CUP.`);
    if (cs.exceeds_margin && s.config.strict_price_cap_block) err400(`Bloqueado MFP: margen ${cs.margin_pct}% supera el máximo de ${cs.max_margin_pct}%.`);
    Object.assign(pr, cand);
    return finish({ ok: true, sale_price_cup: pr.sale_price_cup, cost_sheet: cs });
  }
  if (p === '/api/finance/auto-optimize-prices' && method === 'POST') return finish({ adjusted_count: 0, adjusted: [] });
  if (p === '/api/finance/onat') return calcOnat(s, url.searchParams.get('period') || curPeriod());
  if (p === '/api/finance/onat/pay' && method === 'POST') {
    const sum = calcOnat(s, body.period || curPeriod());
    const ob = sum.obligations.find((o) => o.tax_code === body.tax_code);
    s.taxes.push({ period: sum.period, tax_code: ob.tax_code, status: 'PAGADO', payment_ref: body.payment_ref, amount_cup: ob.amount_cup });
    const je = addJournal(s, { date: todayIso(), sourceType: 'ONAT', sourceRef: body.payment_ref, description: `Pago ONAT ${ob.onat_paragraph} — ${ob.tax_name}`, createdBy: user.id, lines: [{ account: NCIF.GASTOS_TRIBUTOS, debit: ob.amount_cup }, { account: NCIF.BANCO_FISCAL, credit: ob.amount_cup }] });
    return finish({ ok: true, amount_cup: ob.amount_cup, journal_entry: je });
  }
  if (p === '/api/finance/banking') {
    return {
      config: s.config,
      balances: { bank_fiscal_cup: acctBal(s, '110'), cash_general_cup: acctBal(s, '101'), cash_petty_cup: acctBal(s, '102'), qr_pending_cup: acctBal(s, '135'), faltantes_cup: acctBal(s, '330') },
      deposits: s.deposits.slice().reverse(),
      unreconciled_qr: s.sales.filter((x) => !x.reconciled && (x.transfermovil_amount_cup > 0 || x.enzona_amount_cup > 0)),
      expenses: s.expenses.slice().reverse(),
    };
  }
  if (p.includes('/api/finance/deposits/') && p.endsWith('/complete') && method === 'POST') {
    const id = Number(p.split('/')[4]);
    const d = s.deposits.find((x) => x.id === id);
    d.status = 'DEPOSITADO';
    d.bank_voucher_ref = body.bank_voucher_ref;
    const je = addJournal(s, { date: todayIso(), sourceType: 'DEPOSITO', sourceRef: d.order_number, description: `Depósito ${d.order_number} en Cuenta Fiscal`, createdBy: user.id, lines: [{ account: NCIF.BANCO_FISCAL, debit: d.amount_cup }, { account: NCIF.CAJA_GENERAL, credit: d.amount_cup }] });
    return finish({ ok: true, journal_entry: je });
  }
  if (p === '/api/finance/deposits' && method === 'POST') {
    const order = `DEP-${String(s.deposits.length + 1).padStart(4, '0')}`;
    const amt = r2(body.amount_cup);
    const done = Boolean(body.bank_voucher_ref?.trim());
    s.deposits.push({ id: s.seq.dep++, order_number: order, origin: 'MANUAL', amount_cup: amt, due_date: nextBizDay(todayIso()), status: done ? 'DEPOSITADO' : 'PENDIENTE', bank_voucher_ref: body.bank_voucher_ref || '', notes: body.notes || '' });
    if (done) addJournal(s, { date: todayIso(), sourceType: 'DEPOSITO', sourceRef: order, description: `Depósito directo ${order}`, createdBy: user.id, lines: [{ account: NCIF.BANCO_FISCAL, debit: amt }, { account: NCIF.CAJA_GENERAL, credit: amt }] });
    return finish({ order_number: order });
  }
  if (p === '/api/finance/reconcile-qr' && method === 'POST') {
    const pend = s.sales.filter((x) => !x.reconciled && (x.transfermovil_amount_cup > 0 || x.enzona_amount_cup > 0));
    const tot = r2(pend.reduce((a, x) => a + x.transfermovil_amount_cup + x.enzona_amount_cup, 0));
    pend.forEach((x) => { x.reconciled = 1; });
    const je = addJournal(s, { date: todayIso(), sourceType: 'DEPOSITO', sourceRef: 'CONC-QR', description: `Conciliación QR Transfermóvil/EnZona (${pend.length} cobros)`, createdBy: user.id, lines: [{ account: NCIF.BANCO_FISCAL, debit: tot }, { account: NCIF.COBROS_QR, credit: tot }] });
    return finish({ count: pend.length, total_cup: tot, journal_entry: je });
  }
  if (p === '/api/finance/expenses' && method === 'POST') {
    const amt = r2(body.amount_cup);
    if (body.payment_method === 'EFECTIVO' && amt > s.config.max_cash_provider_payment_cup) {
      err400(`Resolución 111/2023 BCC: Pagos superiores a ${s.config.max_cash_provider_payment_cup} CUP deben ser electrónicos.`);
    }
    const doc = `GAS-${String(s.expenses.length + 1).padStart(4, '0')}`;
    s.expenses.push({ id: s.seq.exp++, doc_number: doc, expense_date: todayIso(), ...body, amount_cup: amt, has_valid_receipt: body.has_valid_receipt ? 1 : 0 });
    addJournal(s, { date: todayIso(), sourceType: 'GASTO', sourceRef: doc, description: `Gasto ${doc}: ${body.category}`, createdBy: user.id, lines: [{ account: NCIF.GASTOS_ADMIN, debit: amt }, { account: body.payment_method === 'EFECTIVO' ? NCIF.CAJA_GENERAL : NCIF.BANCO_FISCAL, credit: amt }] });
    return finish({ doc_number: doc });
  }
  if (p === '/api/finance/payroll') {
    const per = curPeriod();
    return { period: per, saved_run: s.payrolls.find((x) => x.period === per) || null, live_preview: calcPayroll(s, per), rules: s.config, history: s.payrolls };
  }
  if (p === '/api/finance/payroll/generate' && method === 'POST') {
    const per = body.period || curPeriod();
    const prev = calcPayroll(s, per);
    const t = prev.totals;
    const run = { id: s.seq.pay++, period: per, status: 'PAGADA', payment_ref: body.payment_ref, items: prev.items, ...t };
    s.payrolls = [...s.payrolls.filter((x) => x.period !== per), run];
    const je = addJournal(s, {
      date: todayIso(), sourceType: 'NOMINA', sourceRef: `NOM-${per}`,
      description: `Nómina ${per} pagada (Ref: ${body.payment_ref})`, createdBy: user.id,
      lines: [
        { account: NCIF.GASTOS_ADMIN, debit: r2(t.total_gross_cup + t.total_vacation_accrual_cup) },
        { account: NCIF.GASTOS_TRIBUTOS, debit: r2(t.total_employer_ss_cup + t.total_labor_tax_cup) },
        { account: NCIF.BANCO_FISCAL, credit: t.total_net_cup },
        { account: NCIF.RETENCIONES_PAGAR, credit: r2(t.total_worker_ss_cup + t.total_worker_iip_cup) },
        { account: NCIF.VACACIONES_PROV, credit: t.total_vacation_accrual_cup },
        { account: NCIF.SS_PAGAR, credit: t.total_employer_ss_cup },
        { account: NCIF.ONAT_PAGAR, credit: t.total_labor_tax_cup },
      ],
    });
    return finish({ status: 'PAGADA', journal_entry: je });
  }
  if (p === '/api/finance/accounting') {
    const map = new Map();
    s.journal.forEach((j) => j.lines.forEach((l) => {
      const c = map.get(l.account_code) || { account_code: l.account_code, account_name: l.account_name, total_debit_cup: 0, total_credit_cup: 0 };
      c.total_debit_cup = r2(c.total_debit_cup + l.debit_cup);
      c.total_credit_cup = r2(c.total_credit_cup + l.credit_cup);
      map.set(l.account_code, c);
    }));
    const tb = Array.from(map.values()).sort((a, z) => a.account_code.localeCompare(z.account_code)).map((r) => {
      const n = r2(r.total_debit_cup - r.total_credit_cup);
      return { ...r, debit_balance_cup: n > 0 ? n : 0, credit_balance_cup: n < 0 ? Math.abs(n) : 0 };
    });
    const td = r2(tb.reduce((a, r) => a + r.total_debit_cup, 0));
    const tc = r2(tb.reduce((a, r) => a + r.total_credit_cup, 0));
    const db = r2(tb.reduce((a, r) => a + r.debit_balance_cup, 0));
    const cb = r2(tb.reduce((a, r) => a + r.credit_balance_cup, 0));
    return { period: curPeriod(), trial_balance: tb, trial_totals: { total_debit_cup: td, total_credit_cup: tc, debit_balance_cup: db, credit_balance_cup: cb, is_balanced: Math.abs(td - tc) < 0.05 }, journal: s.journal.slice().reverse() };
  }
  if (p === '/api/finance/compliance') {
    const onat = calcOnat(s, curPeriod());
    return {
      config: s.config,
      compliance: calcCompliance(s),
      dossier: {
        period: curPeriod(),
        staff: s.users.filter((u) => u.active).map((u) => enrichUser(s, u)),
        electronic_share_pct: onat.income_statement.electronic_share_pct,
      },
    };
  }

  err400(`Ruta no soportada en modo estático: ${p}`, 404);
}
