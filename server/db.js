import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.resolve(__dirname, '..', 'data', 'kiosko.db');

export const tenantDbStorage = new AsyncLocalStorage();

export const DEFAULT_MODULES = {
  pos: true,
  ipv: true,
  warehouse: true,
  pricing: true,
  banking: true,
  onat: true,
  payroll: true,
  accounting: true,
  compliance: true,
};

export const DEFAULT_PERMISSIONS = {
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

export const MANAGEMENT_PRESETS = {
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
    modules: { ...DEFAULT_MODULES },
    permissions: { ...DEFAULT_PERMISSIONS },
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
      ipv: true,
      warehouse: true,
      pricing: true,
      banking: true,
      onat: true,
      payroll: false,
      accounting: false,
      compliance: false,
    },
    permissions: { ...DEFAULT_PERMISSIONS },
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
      ipv: true,
      warehouse: true,
      pricing: true,
      banking: true,
      onat: false,
      payroll: false,
      accounting: false,
      compliance: false,
    },
    permissions: { ...DEFAULT_PERMISSIONS },
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
    modules: { ...DEFAULT_MODULES },
    permissions: { ...DEFAULT_PERMISSIONS },
  },
};

export function hydrateConfigGovernance(row) {
  if (!row) return null;
  let parsedModules = {};
  let parsedPermissions = {};
  try {
    parsedModules = row.modules_json ? JSON.parse(row.modules_json) : {};
  } catch {
    parsedModules = {};
  }
  try {
    parsedPermissions = row.permissions_json ? JSON.parse(row.permissions_json) : {};
  } catch {
    parsedPermissions = {};
  }
  const modules = { ...DEFAULT_MODULES, ...parsedModules, pos: parsedModules.pos !== false };
  const permissions = { ...DEFAULT_PERMISSIONS, ...parsedPermissions };
  return {
    ...row,
    modules,
    permissions,
  };
}

let dbInstance = null;

export function runWithDb(db, fn) {
  return tenantDbStorage.run(db, fn);
}

export function openTenantDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  initSchema(db);
  migrateTenantSchema(db);
  return db;
}

export function getDb(customPath) {
  if (!customPath) {
    const scoped = tenantDbStorage.getStore();
    if (scoped) return scoped;
  }
  if (dbInstance) return dbInstance;
  const dbPath = customPath || process.env.KIOSKO_DB_PATH || defaultDbPath;
  dbInstance = openTenantDb(dbPath);
  return dbInstance;
}

export function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close error
    }
    dbInstance = null;
  }
}

export function runInTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  }
}

export function roundCup(value) {
  const num = Number(value) || 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function nextDocCode(db, table, column, prefix, pad = 4) {
  const row = db.prepare(`SELECT COUNT(*) AS cnt FROM ${table}`).get();
  const next = Number(row?.cnt || 0) + 1;
  return `${prefix}-${String(next).padStart(pad, '0')}`;
}

function ensureColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function migrateTenantSchema(db) {
  const defaultMods = JSON.stringify(DEFAULT_MODULES).replace(/'/g, "''");
  const defaultPerms = JSON.stringify(DEFAULT_PERMISSIONS).replace(/'/g, "''");

  ensureColumn(db, 'business_config', 'company_code', "TEXT NOT NULL DEFAULT 'kiosko-CEIBA1'");
  ensureColumn(
    db,
    'business_config',
    'business_type',
    "TEXT NOT NULL DEFAULT 'Kiosko y Comercio Minorista'"
  );
  ensureColumn(
    db,
    'business_config',
    'management_preset',
    "TEXT NOT NULL DEFAULT 'kiosko_completo'"
  );
  ensureColumn(db, 'business_config', 'whatsapp_phone', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'business_config', 'contact_email', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'business_config', 'join_mode', "TEXT NOT NULL DEFAULT 'APPROVAL'");
  ensureColumn(db, 'business_config', 'flexible_role_limits', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'business_config', 'require_cuban_ci', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'business_config', 'owner_can_operate_pos', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'business_config', 'modules_json', `TEXT NOT NULL DEFAULT '${defaultMods}'`);
  ensureColumn(
    db,
    'business_config',
    'permissions_json',
    `TEXT NOT NULL DEFAULT '${defaultPerms}'`
  );

  ensureColumn(db, 'users', 'email', "TEXT NOT NULL DEFAULT ''");
}

export function initSchema(db) {
  const defaultMods = JSON.stringify(DEFAULT_MODULES).replace(/'/g, "''");
  const defaultPerms = JSON.stringify(DEFAULT_PERMISSIONS).replace(/'/g, "''");

  db.exec(`
    CREATE TABLE IF NOT EXISTS business_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      company_code TEXT NOT NULL DEFAULT 'kiosko-CEIBA1',
      business_name TEXT NOT NULL,
      business_type TEXT NOT NULL DEFAULT 'Kiosko y Comercio Minorista',
      management_preset TEXT NOT NULL DEFAULT 'kiosko_completo',
      legal_form TEXT NOT NULL CHECK (legal_form IN ('MIPYME', 'TCP')),
      nit TEXT NOT NULL,
      reeup_code TEXT DEFAULT '',
      municipality TEXT NOT NULL,
      province TEXT NOT NULL,
      address TEXT NOT NULL,
      activity_description TEXT NOT NULL,
      whatsapp_phone TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      join_mode TEXT NOT NULL DEFAULT 'APPROVAL',
      flexible_role_limits INTEGER NOT NULL DEFAULT 0,
      require_cuban_ci INTEGER NOT NULL DEFAULT 1,
      owner_can_operate_pos INTEGER NOT NULL DEFAULT 0,
      modules_json TEXT NOT NULL DEFAULT '${defaultMods}',
      permissions_json TEXT NOT NULL DEFAULT '${defaultPerms}',
      bank_name TEXT NOT NULL,
      fiscal_account_cup TEXT NOT NULL,
      fiscal_account_titular TEXT NOT NULL,
      transfermovil_phone TEXT NOT NULL,
      transfermovil_merchant_code TEXT NOT NULL,
      enzona_merchant_code TEXT NOT NULL,
      qr_discount_pct REAL NOT NULL DEFAULT 2.0,
      social_capital_cup REAL NOT NULL DEFAULT 150000,
      legal_reserve_balance_cup REAL NOT NULL DEFAULT 12500,
      petty_cash_fund_cup REAL NOT NULL DEFAULT 3000,
      max_cash_provider_payment_cup REAL NOT NULL DEFAULT 5000,
      max_vault_cash_before_deposit_cup REAL NOT NULL DEFAULT 8000,
      max_sellers_per_shift INTEGER NOT NULL DEFAULT 2,
      min_wage_cup REAL NOT NULL DEFAULT 2100,
      sales_tax_pct REAL NOT NULL DEFAULT 10.0,
      local_dev_tax_pct REAL NOT NULL DEFAULT 1.0,
      labor_force_tax_pct REAL NOT NULL DEFAULT 5.0,
      employer_ss_pct REAL NOT NULL DEFAULT 14.0,
      worker_ss_pct REAL NOT NULL DEFAULT 5.0,
      vacation_provision_pct REAL NOT NULL DEFAULT 9.09,
      profit_tax_pct REAL NOT NULL DEFAULT 35.0,
      legal_reserve_pct REAL NOT NULL DEFAULT 10.0,
      iip_exempt_monthly_cup REAL NOT NULL DEFAULT 3260,
      max_regulated_margin_pct REAL NOT NULL DEFAULT 30.0,
      indirect_cost_alloc_pct REAL NOT NULL DEFAULT 8.0,
      auto_restock_enabled INTEGER NOT NULL DEFAULT 1,
      auto_accounting_enabled INTEGER NOT NULL DEFAULT 1,
      auto_deposit_order_enabled INTEGER NOT NULL DEFAULT 1,
      strict_price_cap_block INTEGER NOT NULL DEFAULT 1,
      strict_bancarizacion_block INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shift_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      required_sellers INTEGER NOT NULL DEFAULT 2,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      ci TEXT NOT NULL,
      nit_personal TEXT DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('jefe', 'economico', 'almacenero', 'vendedor')),
      shift_template_id INTEGER REFERENCES shift_templates(id),
      default_register INTEGER CHECK ((default_register BETWEEN 1 AND 6) OR default_register IS NULL),
      contract_type TEXT NOT NULL DEFAULT 'Indeterminado',
      contract_date TEXT NOT NULL,
      base_salary_cup REAL NOT NULL,
      sales_commission_pct REAL NOT NULL DEFAULT 0,
      phone TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      unit_cost_cup REAL NOT NULL DEFAULT 0,
      indirect_cost_pct REAL NOT NULL DEFAULT 8.0,
      sale_price_cup REAL NOT NULL DEFAULT 0,
      is_price_capped INTEGER NOT NULL DEFAULT 0,
      price_cap_cup REAL DEFAULT NULL,
      price_cap_resolution TEXT DEFAULT '',
      is_margin_regulated INTEGER NOT NULL DEFAULT 1,
      sales_tax_exempt INTEGER NOT NULL DEFAULT 0,
      warehouse_stock REAL NOT NULL DEFAULT 0,
      kiosk_stock REAL NOT NULL DEFAULT 0,
      warehouse_min_stock REAL NOT NULL DEFAULT 10,
      kiosk_min_stock REAL NOT NULL DEFAULT 5,
      kiosk_target_stock REAL NOT NULL DEFAULT 20,
      current_batch TEXT DEFAULT '',
      next_expiry_date TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shift_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_code TEXT NOT NULL UNIQUE,
      shift_template_id INTEGER NOT NULL REFERENCES shift_templates(id),
      work_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ABIERTO', 'CERRADO', 'AUDITADO')),
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT DEFAULT NULL,
      opened_by INTEGER REFERENCES users(id),
      audited_by INTEGER REFERENCES users(id),
      audited_at TEXT DEFAULT NULL,
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS shift_registers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_session_id INTEGER NOT NULL REFERENCES shift_sessions(id),
      register_number INTEGER NOT NULL CHECK (register_number BETWEEN 1 AND 6),
      seller_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('ABIERTA', 'ARQUEADA', 'VALIDADA')),
      opening_cash_cup REAL NOT NULL DEFAULT 3000,
      expected_cash_cup REAL NOT NULL DEFAULT 3000,
      counted_cash_cup REAL DEFAULT NULL,
      cash_difference_cup REAL DEFAULT 0,
      denominations_json TEXT DEFAULT '{}',
      total_sales_cup REAL NOT NULL DEFAULT 0,
      cash_sales_cup REAL NOT NULL DEFAULT 0,
      transfermovil_sales_cup REAL NOT NULL DEFAULT 0,
      enzona_sales_cup REAL NOT NULL DEFAULT 0,
      sales_count INTEGER NOT NULL DEFAULT 0,
      closing_notes TEXT DEFAULT '',
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT DEFAULT NULL,
      validated_by INTEGER REFERENCES users(id),
      validated_at TEXT DEFAULT NULL,
      UNIQUE(shift_session_id, register_number)
    );

    CREATE TABLE IF NOT EXISTS shift_ipv_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_session_id INTEGER NOT NULL REFERENCES shift_sessions(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      opening_qty REAL NOT NULL DEFAULT 0,
      entries_qty REAL NOT NULL DEFAULT 0,
      losses_qty REAL NOT NULL DEFAULT 0,
      sold_qty REAL NOT NULL DEFAULT 0,
      closing_qty REAL NOT NULL DEFAULT 0,
      sale_price_cup REAL NOT NULL DEFAULT 0,
      sold_amount_cup REAL NOT NULL DEFAULT 0,
      UNIQUE(shift_session_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_number TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('RECEPCION', 'TRANSFERENCIA_KIOSKO', 'DEVOLUCION_ALMACEN', 'VENTA', 'MERMA', 'AJUSTE')),
      status TEXT NOT NULL CHECK (status IN ('APLICADO', 'PENDIENTE_APROBACION', 'RECHAZADO')),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL,
      unit_cost_cup REAL NOT NULL DEFAULT 0,
      total_cost_cup REAL NOT NULL DEFAULT 0,
      warehouse_balance_after REAL NOT NULL DEFAULT 0,
      kiosk_balance_after REAL NOT NULL DEFAULT 0,
      supplier_name TEXT DEFAULT '',
      supplier_nit TEXT DEFAULT '',
      invoice_number TEXT DEFAULT '',
      payment_method TEXT DEFAULT '',
      payment_ref TEXT DEFAULT '',
      batch_code TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      shift_session_id INTEGER REFERENCES shift_sessions(id),
      created_by INTEGER REFERENCES users(id),
      approved_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS restock_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      suggested_qty REAL NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('AUTOMATICO', 'VENDEDOR')),
      priority TEXT NOT NULL CHECK (priority IN ('URGENTE', 'NORMAL')),
      status TEXT NOT NULL CHECK (status IN ('PENDIENTE', 'DESPACHADO', 'CANCELADO')),
      notes TEXT DEFAULT '',
      requested_by INTEGER REFERENCES users(id),
      fulfilled_by INTEGER REFERENCES users(id),
      movement_id INTEGER REFERENCES inventory_movements(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fulfilled_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_number TEXT NOT NULL UNIQUE,
      shift_session_id INTEGER NOT NULL REFERENCES shift_sessions(id),
      shift_register_id INTEGER NOT NULL REFERENCES shift_registers(id),
      seller_id INTEGER NOT NULL REFERENCES users(id),
      sale_date TEXT NOT NULL,
      subtotal_cup REAL NOT NULL,
      qr_discount_cup REAL NOT NULL DEFAULT 0,
      total_cup REAL NOT NULL,
      total_cost_cup REAL NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('EFECTIVO', 'TRANSFERMOVIL', 'ENZONA', 'MIXTO')),
      cash_amount_cup REAL NOT NULL DEFAULT 0,
      cash_tendered_cup REAL NOT NULL DEFAULT 0,
      change_given_cup REAL NOT NULL DEFAULT 0,
      transfermovil_amount_cup REAL NOT NULL DEFAULT 0,
      enzona_amount_cup REAL NOT NULL DEFAULT 0,
      electronic_ref TEXT DEFAULT '',
      customer_phone TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'COMPLETADA' CHECK (status IN ('COMPLETADA', 'ANULADA')),
      reconciled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cup REAL NOT NULL,
      unit_cost_cup REAL NOT NULL,
      line_total_cup REAL NOT NULL,
      line_cost_cup REAL NOT NULL,
      is_price_capped INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bank_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL CHECK (origin IN ('AUTOMATICO', 'MANUAL')),
      shift_session_id INTEGER REFERENCES shift_sessions(id),
      amount_cup REAL NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDIENTE', 'DEPOSITADO')),
      bank_voucher_ref TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      completed_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_number TEXT NOT NULL UNIQUE,
      expense_date TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      invoice_ref TEXT DEFAULT '',
      has_valid_receipt INTEGER NOT NULL DEFAULT 1,
      amount_cup REAL NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('TRANSFERENCIA', 'EFECTIVO', 'TRANSFERMOVIL', 'ENZONA')),
      payment_ref TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_number TEXT NOT NULL UNIQUE,
      entry_date TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT DEFAULT '',
      description TEXT NOT NULL,
      total_debit_cup REAL NOT NULL,
      total_credit_cup REAL NOT NULL,
      auto_generated INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS journal_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      debit_cup REAL NOT NULL DEFAULT 0,
      credit_cup REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS payroll_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('BORRADOR', 'APROBADA', 'PAGADA')),
      total_gross_cup REAL NOT NULL,
      total_vacation_accrual_cup REAL NOT NULL,
      total_worker_ss_cup REAL NOT NULL,
      total_worker_iip_cup REAL NOT NULL,
      total_net_cup REAL NOT NULL,
      total_employer_ss_cup REAL NOT NULL,
      total_labor_tax_cup REAL NOT NULL,
      payment_method TEXT DEFAULT 'TRANSFERENCIA',
      payment_ref TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      approved_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS payroll_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      ci TEXT NOT NULL,
      shifts_worked INTEGER NOT NULL DEFAULT 0,
      seller_sales_cup REAL NOT NULL DEFAULT 0,
      base_salary_cup REAL NOT NULL,
      commission_cup REAL NOT NULL DEFAULT 0,
      gross_salary_cup REAL NOT NULL,
      vacation_accrual_cup REAL NOT NULL,
      worker_ss_cup REAL NOT NULL,
      worker_iip_cup REAL NOT NULL,
      net_salary_cup REAL NOT NULL,
      employer_ss_cup REAL NOT NULL,
      labor_tax_cup REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tax_filings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT NOT NULL,
      tax_code TEXT NOT NULL,
      tax_name TEXT NOT NULL,
      onat_paragraph TEXT NOT NULL,
      taxable_base_cup REAL NOT NULL,
      rate_pct REAL NOT NULL,
      amount_cup REAL NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDIENTE', 'PAGADO')),
      payment_ref TEXT DEFAULT '',
      paid_at TEXT DEFAULT NULL,
      paid_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(period, tax_code)
    );

    CREATE TABLE IF NOT EXISTS price_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      old_price_cup REAL NOT NULL,
      new_price_cup REAL NOT NULL,
      unit_cost_cup REAL NOT NULL,
      full_cost_cup REAL NOT NULL,
      margin_pct REAL NOT NULL,
      reason TEXT DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('APLICADO', 'PENDIENTE_JEFE', 'RECHAZADO')),
      created_by INTEGER REFERENCES users(id),
      approved_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS automation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('INFO', 'ALERTA', 'BLOQUEO')),
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      ref_code TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
