import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MODULES,
  DEFAULT_PERMISSIONS,
  MANAGEMENT_PRESETS,
  getDb,
  openTenantDb,
  roundCup,
  runInTransaction,
} from './db.js';
import { hashPassword, logAudit, logAutomation } from './auth.js';
import { NCIF_ACCOUNTS, getTodayIso, postJournalEntry } from './cubanLawEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, '..', 'data');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let platformDb = null;
let isMemoryMode = false;
const tenantDbPool = new Map();

export function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

export function isValidEmail(email) {
  const clean = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) && clean.length <= 160;
}

export function normalizeCompanyCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/\s+/g, '');
  if (/^kiosko-/i.test(cleaned)) {
    return `kiosko-${cleaned.slice(7).toUpperCase()}`;
  }
  if (/^conecta-/i.test(cleaned)) {
    return `kiosko-${cleaned.slice(8).toUpperCase()}`;
  }
  return `kiosko-${cleaned.replace(/^[-_]+/, '').toUpperCase()}`;
}

export function generateUniqueCode(pdb, prefix = '') {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let suffix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2);
    const remaining = 6 - suffix.length;
    const bytes = crypto.randomBytes(remaining);
    for (let i = 0; i < remaining; i += 1) {
      suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    const candidate = `kiosko-${suffix}`;
    const inComp = pdb
      .prepare('SELECT id FROM companies WHERE upper(company_code) = upper(?)')
      .get(candidate);
    const inInv = pdb
      .prepare('SELECT id FROM company_invites WHERE upper(code) = upper(?)')
      .get(candidate);
    if (!inComp && !inInv) return candidate;
  }
  return `kiosko-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function initPlatformSchema(pdb) {
  pdb.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      ci TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      recovery_code_hash TEXT DEFAULT '',
      recovery_expires_at INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      business_type TEXT NOT NULL DEFAULT 'Kiosko y Comercio Minorista',
      legal_form TEXT NOT NULL DEFAULT 'MIPYME',
      municipality TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      owner_account_id INTEGER REFERENCES accounts(id),
      db_path TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0,
      join_mode TEXT NOT NULL DEFAULT 'APPROVAL' CHECK (join_mode IN ('APPROVAL', 'AUTO')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS company_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      target_email TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('economico', 'almacenero', 'vendedor', 'jefe')),
      shift_template_id INTEGER DEFAULT NULL,
      default_register INTEGER DEFAULT NULL,
      base_salary_cup REAL NOT NULL DEFAULT 6500,
      sales_commission_pct REAL NOT NULL DEFAULT 0,
      max_uses INTEGER NOT NULL DEFAULT 1,
      uses_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_by_account_id INTEGER REFERENCES accounts(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS company_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      tenant_user_id INTEGER DEFAULT NULL,
      role TEXT NOT NULL DEFAULT 'vendedor' CHECK (role IN ('jefe', 'economico', 'almacenero', 'vendedor')),
      status TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('ACTIVO', 'PENDIENTE', 'RECHAZADO', 'SUSPENDIDO')),
      requested_role TEXT NOT NULL DEFAULT 'vendedor',
      requested_ci TEXT NOT NULL DEFAULT '',
      requested_phone TEXT NOT NULL DEFAULT '',
      request_note TEXT NOT NULL DEFAULT '',
      invite_code_used TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT DEFAULT NULL,
      UNIQUE(company_id, account_id)
    );
  `);
}

function seedDemoPlatformRecords(pdb, defaultTenantDb) {
  const existingDemo = pdb.prepare('SELECT * FROM companies WHERE is_demo = 1 LIMIT 1').get();
  if (existingDemo) return existingDemo;

  const cfg = defaultTenantDb.prepare('SELECT * FROM business_config WHERE id = 1').get();
  const demoUsers = defaultTenantDb.prepare('SELECT * FROM users ORDER BY id ASC').all();
  const demoJefe = demoUsers.find((u) => u.role === 'jefe');

  let ownerAccountId = null;
  if (demoJefe) {
    const demoEmail = 'alejandro@laceiba.cu';
    const existingAcc = pdb.prepare('SELECT id FROM accounts WHERE email = ?').get(demoEmail);
    if (existingAcc) {
      ownerAccountId = existingAcc.id;
    } else {
      const aRes = pdb
        .prepare(
          `INSERT INTO accounts (email, password_hash, full_name, ci, phone)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(demoEmail, demoJefe.password_hash, demoJefe.full_name, demoJefe.ci, demoJefe.phone || '');
      ownerAccountId = Number(aRes.lastInsertRowid);
    }
    defaultTenantDb.prepare('UPDATE users SET email = ? WHERE id = ?').run(demoEmail, demoJefe.id);
  }

  const cRes = pdb
    .prepare(
      `INSERT INTO companies
       (company_code, name, business_type, legal_form, municipality, province, owner_account_id, db_path, is_demo, join_mode, active)
       VALUES ('kiosko-CEIBA1', ?, 'Kiosko y Comercio Minorista', ?, ?, ?, ?, '__DEFAULT__', 1, 'APPROVAL', 1)`
    )
    .run(
      cfg?.business_name || 'Kiosko La Ceiba S.U.R.L.',
      cfg?.legal_form || 'MIPYME',
      cfg?.municipality || 'Plaza de la Revolución',
      cfg?.province || 'La Habana',
      ownerAccountId
    );
  const demoCompanyId = Number(cRes.lastInsertRowid);

  defaultTenantDb
    .prepare(`UPDATE business_config SET company_code = 'kiosko-CEIBA1', contact_email = 'alejandro@laceiba.cu' WHERE id = 1`)
    .run();

  if (ownerAccountId && demoJefe) {
    pdb
      .prepare(
        `INSERT OR IGNORE INTO company_memberships
         (company_id, account_id, tenant_user_id, role, status, requested_role, requested_ci, requested_phone, decided_at)
         VALUES (?, ?, ?, 'jefe', 'ACTIVO', 'jefe', ?, ?, datetime('now'))`
      )
      .run(demoCompanyId, ownerAccountId, demoJefe.id, demoJefe.ci, demoJefe.phone || '');
  }

  // Also link the other demo staff with clean emails so the demo company showcases email affiliations
  const staffEmails = {
    economico: 'beatriz@laceiba.cu',
    almacenero: 'carlos@laceiba.cu',
    vendedor1: 'dayana@laceiba.cu',
    vendedor2: 'ernesto@laceiba.cu',
    vendedor3: 'yaima@laceiba.cu',
    vendedor4: 'luis@laceiba.cu',
  };
  for (const u of demoUsers) {
    const em = staffEmails[u.username];
    if (!em) continue;
    defaultTenantDb.prepare('UPDATE users SET email = ? WHERE id = ?').run(em, u.id);
    const acc = pdb
      .prepare(
        `INSERT OR IGNORE INTO accounts (email, password_hash, full_name, ci, phone)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(em, u.password_hash, u.full_name, u.ci, u.phone || '');
    const accRow = acc.lastInsertRowid
      ? { id: Number(acc.lastInsertRowid) }
      : pdb.prepare('SELECT id FROM accounts WHERE email = ?').get(em);
    if (accRow) {
      pdb
        .prepare(
          `INSERT OR IGNORE INTO company_memberships
           (company_id, account_id, tenant_user_id, role, status, requested_role, requested_ci, requested_phone, decided_at)
           VALUES (?, ?, ?, ?, 'ACTIVO', ?, ?, ?, datetime('now'))`
        )
        .run(demoCompanyId, accRow.id, u.id, u.role, u.role, u.ci, u.phone || '');
    }
  }

  return pdb.prepare('SELECT * FROM companies WHERE id = ?').get(demoCompanyId);
}

export function initPlatform(customDbPath) {
  if (platformDb) return platformDb;
  isMemoryMode = customDbPath === ':memory:';
  const defaultTenantDb = getDb(customDbPath);

  if (isMemoryMode) {
    platformDb = new DatabaseSync(':memory:');
  } else {
    const pPath =
      process.env.KIOSKO_PLATFORM_DB_PATH || path.join(defaultDataDir, 'platform.db');
    fs.mkdirSync(path.dirname(pPath), { recursive: true });
    platformDb = new DatabaseSync(pPath);
    platformDb.exec('PRAGMA journal_mode = WAL;');
    platformDb.exec('PRAGMA busy_timeout = 5000;');
  }
  platformDb.exec('PRAGMA foreign_keys = ON;');
  initPlatformSchema(platformDb);
  const demoCompany = seedDemoPlatformRecords(platformDb, defaultTenantDb);
  tenantDbPool.set(demoCompany.id, defaultTenantDb);
  return platformDb;
}

export function getPlatformDb() {
  if (!platformDb) return initPlatform();
  return platformDb;
}

export function getCompanyById(companyId) {
  if (!companyId) return null;
  const pdb = getPlatformDb();
  return pdb.prepare('SELECT * FROM companies WHERE id = ? AND active = 1').get(Number(companyId)) || null;
}

export function getDemoCompany() {
  const pdb = getPlatformDb();
  return pdb.prepare('SELECT * FROM companies WHERE is_demo = 1 ORDER BY id ASC LIMIT 1').get() || null;
}

export function getCompanyDb(companyId) {
  const cid = Number(companyId);
  if (!cid) return getDb();
  if (tenantDbPool.has(cid)) return tenantDbPool.get(cid);

  const company = getCompanyById(cid);
  if (!company) return null;
  if (company.db_path === '__DEFAULT__') {
    const db = getDb();
    tenantDbPool.set(cid, db);
    return db;
  }

  const resolvedPath = path.isAbsolute(company.db_path)
    ? company.db_path
    : path.join(defaultDataDir, company.db_path);
  const db = openTenantDb(resolvedPath);
  tenantDbPool.set(cid, db);
  return db;
}

export function closePlatform() {
  for (const [, tdb] of tenantDbPool.entries()) {
    try {
      tdb.close();
    } catch {
      // ignore already closed
    }
  }
  tenantDbPool.clear();
  if (platformDb) {
    try {
      platformDb.close();
    } catch {
      // ignore
    }
    platformDb = null;
  }
  isMemoryMode = false;
}

export function sanitizeAccount(acc) {
  if (!acc) return null;
  return {
    id: acc.id,
    email: acc.email,
    full_name: acc.full_name,
    ci: acc.ci || '',
    phone: acc.phone || '',
    created_at: acc.created_at,
  };
}

export function getAccountMemberships(accountId) {
  if (!accountId) return [];
  const pdb = getPlatformDb();
  return pdb
    .prepare(
      `SELECT m.id AS membership_id, m.company_id, m.tenant_user_id, m.role, m.status,
              m.requested_role, m.request_note, m.invite_code_used, m.created_at, m.decided_at,
              c.company_code, c.name AS company_name, c.business_type, c.legal_form,
              c.municipality, c.province, c.is_demo, c.owner_account_id,
              CASE WHEN c.owner_account_id = m.account_id THEN 1 ELSE 0 END AS is_owner,
              (SELECT COUNT(*) FROM company_memberships pm
               WHERE pm.company_id = c.id AND pm.status = 'PENDIENTE') AS pending_affiliations
       FROM company_memberships m
       JOIN companies c ON c.id = m.company_id
       WHERE m.account_id = ? AND c.active = 1
       ORDER BY CASE m.status WHEN 'ACTIVO' THEN 0 WHEN 'PENDIENTE' THEN 1 ELSE 2 END,
                is_owner DESC, m.id DESC`
    )
    .all(Number(accountId));
}

export function getPendingAffiliationsCount(companyId) {
  if (!companyId) return 0;
  const pdb = getPlatformDb();
  const row = pdb
    .prepare(`SELECT COUNT(*) AS cnt FROM company_memberships WHERE company_id = ? AND status = 'PENDIENTE'`)
    .get(Number(companyId));
  return Number(row?.cnt || 0);
}

function buildUniqueUsername(tdb, emailOrName, fallbackRole = 'usuario') {
  const baseRaw = String(emailOrName || fallbackRole)
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 20);
  const base = baseRaw || fallbackRole;
  let candidate = base;
  let n = 1;
  while (tdb.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(candidate)) {
    n += 1;
    candidate = `${base}${n}`;
  }
  return candidate;
}

export function provisionTenantUserFromAccount(
  tdb,
  account,
  {
    role = 'vendedor',
    shift_template_id = null,
    default_register = null,
    base_salary_cup = 6500,
    sales_commission_pct = 0,
    contract_type = 'Indeterminado',
    ci = '',
    phone = '',
  } = {}
) {
  const cfg = tdb.prepare('SELECT * FROM business_config WHERE id = 1').get();
  const minWage = Number(cfg?.min_wage_cup || 2100);
  const maxSellers = Math.max(1, Number(cfg?.max_sellers_per_shift || 2));
  const salary = Math.max(minWage, roundCup(base_salary_cup || 6500));

  let shiftId = null;
  let regNum = null;
  if (role === 'vendedor') {
    const chosenShift = shift_template_id
      ? tdb.prepare('SELECT * FROM shift_templates WHERE id = ? AND active = 1').get(Number(shift_template_id))
      : tdb.prepare('SELECT * FROM shift_templates WHERE active = 1 ORDER BY id ASC LIMIT 1').get();
    if (chosenShift) {
      shiftId = chosenShift.id;
      const inShift = tdb
        .prepare(`SELECT default_register FROM users WHERE active = 1 AND role = 'vendedor' AND shift_template_id = ?`)
        .all(shiftId);
      const taken = new Set(inShift.map((r) => Number(r.default_register)));
      const desired = Number(default_register);
      if (desired >= 1 && desired <= maxSellers && !taken.has(desired)) {
        regNum = desired;
      } else {
        for (let r = 1; r <= Math.max(maxSellers, 6); r += 1) {
          if (!taken.has(r)) {
            regNum = r;
            break;
          }
        }
        if (!regNum) regNum = 1;
      }
    }
  }

  const cleanCi = String(ci || account.ci || '').trim() || '00000000000';
  const cleanPhone = String(phone || account.phone || '').trim();
  const username = buildUniqueUsername(tdb, account.email, role);

  // Check if an inactive user with same email already exists in this tenant
  const existing = tdb
    .prepare('SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1')
    .get(account.email);
  if (existing) {
    tdb
      .prepare(
        `UPDATE users SET
           full_name = ?, password_hash = ?, ci = ?, role = ?, shift_template_id = ?,
           default_register = ?, contract_type = ?, base_salary_cup = ?, sales_commission_pct = ?,
           phone = ?, active = 1
         WHERE id = ?`
      )
      .run(
        account.full_name,
        account.password_hash,
        cleanCi,
        role,
        shiftId,
        regNum,
        contract_type,
        salary,
        role === 'vendedor' ? Math.max(0, Number(sales_commission_pct || 0)) : 0,
        cleanPhone,
        existing.id
      );
    return Number(existing.id);
  }

  const res = tdb
    .prepare(
      `INSERT INTO users
       (username, email, password_hash, full_name, ci, nit_personal, role, shift_template_id, default_register,
        contract_type, contract_date, base_salary_cup, sales_commission_pct, phone, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      username,
      account.email,
      account.password_hash,
      account.full_name,
      cleanCi,
      cleanCi,
      role,
      shiftId,
      regNum,
      contract_type,
      getTodayIso(),
      salary,
      role === 'vendedor' ? Math.max(0, Number(sales_commission_pct || 0)) : 0,
      cleanPhone
    );
  return Number(res.lastInsertRowid);
}

const STARTER_CATALOG = [
  {
    sku: 'BAS-001',
    name: 'Pollo troceado (paq. 1 kg)',
    category: 'Básicos Regulados',
    unit: 'kg',
    cost: 510,
    price: 675,
    capped: 1,
    cap: 680,
    res: 'Res. 225/2024 MFP',
    wh: 30,
    kiosk: 15,
    whMin: 12,
    kMin: 6,
    kTarget: 20,
    days: 90,
  },
  {
    sku: 'BAS-002',
    name: 'Aceite vegetal 1L',
    category: 'Básicos Regulados',
    unit: 'L',
    cost: 740,
    price: 980,
    capped: 1,
    cap: 990,
    res: 'Res. 225/2024 MFP',
    wh: 24,
    kiosk: 12,
    whMin: 10,
    kMin: 5,
    kTarget: 18,
    days: 180,
  },
  {
    sku: 'BAS-003',
    name: 'Leche en polvo entera 1 kg',
    category: 'Básicos Regulados',
    unit: 'kg',
    cost: 1240,
    price: 1650,
    capped: 1,
    cap: 1675,
    res: 'Res. 225/2024 MFP',
    wh: 14,
    kiosk: 6,
    whMin: 6,
    kMin: 4,
    kTarget: 10,
    days: 150,
  },
  {
    sku: 'BAS-004',
    name: 'Pastas alimenticias espagueti 1 kg',
    category: 'Básicos Regulados',
    unit: 'kg',
    cost: 610,
    price: 820,
    capped: 1,
    cap: 835,
    res: 'Res. 225/2024 MFP',
    wh: 20,
    kiosk: 12,
    whMin: 10,
    kMin: 5,
    kTarget: 16,
    days: 240,
  },
  {
    sku: 'ALI-005',
    name: 'Arroz blanco grano largo 1 kg',
    category: 'Alimentos y Despensa',
    unit: 'kg',
    cost: 340,
    price: 460,
    capped: 0,
    cap: null,
    res: '',
    wh: 40,
    kiosk: 20,
    whMin: 15,
    kMin: 8,
    kTarget: 25,
    days: 210,
  },
  {
    sku: 'BEB-006',
    name: 'Malta lata 355 ml',
    category: 'Bebidas y Refrescos',
    unit: 'u',
    cost: 210,
    price: 285,
    capped: 0,
    cap: null,
    res: '',
    wh: 48,
    kiosk: 24,
    whMin: 20,
    kMin: 10,
    kTarget: 30,
    days: 140,
  },
  {
    sku: 'BEB-007',
    name: 'Refresco de Cola 1.5L',
    category: 'Bebidas y Refrescos',
    unit: 'u',
    cost: 270,
    price: 365,
    capped: 0,
    cap: null,
    res: '',
    wh: 30,
    kiosk: 14,
    whMin: 12,
    kMin: 6,
    kTarget: 20,
    days: 120,
  },
  {
    sku: 'CON-008',
    name: 'Galletas dulces rellenas 250g',
    category: 'Confituras y Panadería',
    unit: 'paq',
    cost: 195,
    price: 265,
    capped: 0,
    cap: null,
    res: '',
    wh: 36,
    kiosk: 18,
    whMin: 12,
    kMin: 6,
    kTarget: 24,
    days: 95,
  },
];

export function createCompanyForAccount(account, payload = {}) {
  const pdb = getPlatformDb();
  const name = String(payload.business_name || payload.name || '').trim();
  if (!name) {
    throw new Error('Escribe el nombre de tu empresa o comercio.');
  }

  const presetKey = MANAGEMENT_PRESETS[payload.management_preset]
    ? payload.management_preset
    : 'kiosko_completo';
  const preset = MANAGEMENT_PRESETS[presetKey];

  const legalForm = payload.legal_form === 'TCP' ? 'TCP' : 'MIPYME';
  const businessType = String(payload.business_type || 'Kiosko y Comercio Minorista').trim();
  const municipality = String(payload.municipality || 'Plaza de la Revolución').trim();
  const province = String(payload.province || 'La Habana').trim();
  const address = String(payload.address || `${municipality}, ${province}`).trim();
  const nit = String(payload.nit || '').trim() || '50000000001';
  const whatsappPhone = String(payload.whatsapp_phone || account.phone || '').trim();
  const bankName = String(payload.bank_name || 'Banco Metropolitano (BANMET)').trim();
  const fiscalAccount = String(payload.fiscal_account_cup || '0598000000000001').trim();
  const tmPhone = String(payload.transfermovil_phone || whatsappPhone || '+53 50000000').trim();
  const tmCode =
    String(payload.transfermovil_merchant_code || '').trim() ||
    `TM-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const ezCode =
    String(payload.enzona_merchant_code || '').trim() ||
    `EZ-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const socialCapital = Math.max(10000, roundCup(payload.social_capital_cup ?? 150000));
  const pettyCash = Math.max(0, roundCup(payload.petty_cash_fund_cup ?? 3000));
  const joinMode = payload.join_mode === 'AUTO' ? 'AUTO' : 'APPROVAL';

  const maxSellers = Math.max(
    1,
    Math.min(6, Number(payload.max_sellers_per_shift ?? preset.max_sellers_per_shift ?? 2))
  );
  const ownerPos =
    payload.owner_can_operate_pos !== undefined
      ? payload.owner_can_operate_pos
        ? 1
        : 0
      : preset.owner_can_operate_pos;
  const flexRoles =
    payload.flexible_role_limits !== undefined
      ? payload.flexible_role_limits
        ? 1
        : 0
      : preset.flexible_role_limits;
  const reqCi =
    payload.require_cuban_ci !== undefined ? (payload.require_cuban_ci ? 1 : 0) : preset.require_cuban_ci;

  const autoRestock =
    payload.auto_restock_enabled !== undefined
      ? payload.auto_restock_enabled
        ? 1
        : 0
      : preset.auto_restock_enabled;
  const autoAccounting =
    payload.auto_accounting_enabled !== undefined
      ? payload.auto_accounting_enabled
        ? 1
        : 0
      : preset.auto_accounting_enabled;
  const autoDeposit =
    payload.auto_deposit_order_enabled !== undefined
      ? payload.auto_deposit_order_enabled
        ? 1
        : 0
      : preset.auto_deposit_order_enabled;
  const strictPriceCap =
    payload.strict_price_cap_block !== undefined
      ? payload.strict_price_cap_block
        ? 1
        : 0
      : preset.strict_price_cap_block;
  const strictBancarizacion =
    payload.strict_bancarizacion_block !== undefined
      ? payload.strict_bancarizacion_block
        ? 1
        : 0
      : preset.strict_bancarizacion_block;

  const modules = {
    ...DEFAULT_MODULES,
    ...preset.modules,
    ...(payload.modules && typeof payload.modules === 'object' ? payload.modules : {}),
    pos: true,
  };
  const permissions = {
    ...DEFAULT_PERMISSIONS,
    ...preset.permissions,
    ...(payload.permissions && typeof payload.permissions === 'object' ? payload.permissions : {}),
  };

  const companyCode = generateUniqueCode(pdb);

  // Create platform record first to get numeric company id
  const tempDbPath = isMemoryMode ? ':memory:' : `companies/pending_${Date.now()}.db`;
  const cRes = pdb
    .prepare(
      `INSERT INTO companies
       (company_code, name, business_type, legal_form, municipality, province, owner_account_id, db_path, is_demo, join_mode, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)`
    )
    .run(
      companyCode,
      name,
      businessType,
      legalForm,
      municipality,
      province,
      account.id,
      tempDbPath,
      joinMode
    );
  const companyId = Number(cRes.lastInsertRowid);

  let finalDbRelPath = ':memory:';
  let tdb;
  if (isMemoryMode) {
    tdb = openTenantDb(':memory:');
  } else {
    finalDbRelPath = `companies/company_${companyId}.db`;
    pdb.prepare('UPDATE companies SET db_path = ? WHERE id = ?').run(finalDbRelPath, companyId);
    tdb = openTenantDb(path.join(defaultDataDir, finalDbRelPath));
  }
  tenantDbPool.set(companyId, tdb);

  // Seed company tenant DB according to creator's choices
  const shiftMode = payload.shift_mode || 'double'; // 'single' | 'double' | 'triple'
  const seedCatalog = payload.seed_catalog || 'starter'; // 'starter' | 'empty'
  const today = getTodayIso();

  let ownerTenantUserId = null;

  runInTransaction(tdb, () => {
    tdb
      .prepare(
        `INSERT INTO business_config (
          id, company_code, business_name, business_type, management_preset, legal_form, nit, reeup_code,
          municipality, province, address, activity_description, whatsapp_phone, contact_email,
          join_mode, flexible_role_limits, require_cuban_ci, owner_can_operate_pos,
          modules_json, permissions_json,
          bank_name, fiscal_account_cup, fiscal_account_titular,
          transfermovil_phone, transfermovil_merchant_code, enzona_merchant_code, qr_discount_pct,
          social_capital_cup, legal_reserve_balance_cup, petty_cash_fund_cup,
          max_cash_provider_payment_cup, max_vault_cash_before_deposit_cup,
          max_sellers_per_shift, min_wage_cup,
          auto_restock_enabled, auto_accounting_enabled, auto_deposit_order_enabled,
          strict_price_cap_block, strict_bancarizacion_block
        ) VALUES (
          1, ?, ?, ?, ?, ?, ?, '',
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, 2.0,
          ?, 0, ?,
          5000, 8000,
          ?, 2100,
          ?, ?, ?,
          ?, ?
        )`
      )
      .run(
        companyCode,
        name,
        businessType,
        presetKey,
        legalForm,
        nit,
        municipality,
        province,
        address,
        `${businessType} — Operación configurada por ${account.full_name}`,
        whatsappPhone,
        account.email,
        joinMode,
        flexRoles,
        reqCi,
        ownerPos,
        JSON.stringify(modules),
        JSON.stringify(permissions),
        bankName,
        fiscalAccount,
        name,
        tmPhone,
        tmCode,
        ezCode,
        socialCapital,
        pettyCash,
        maxSellers,
        autoRestock,
        autoAccounting,
        autoDeposit,
        strictPriceCap,
        strictBancarizacion
      );

    const insShift = tdb.prepare(
      `INSERT INTO shift_templates (code, name, start_time, end_time, required_sellers, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    );

    if (Array.isArray(payload.custom_shifts) && payload.custom_shifts.length > 0) {
      payload.custom_shifts.forEach((sh, idx) => {
        const cleanCode =
          String(sh.code || sh.name || `TRN${idx + 1}`)
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 12) || `TRN${idx + 1}`;
        insShift.run(
          cleanCode,
          String(sh.name || `Turno ${idx + 1}`).trim(),
          sh.start_time || '08:00',
          sh.end_time || '20:00',
          maxSellers
        );
      });
    } else if (shiftMode === 'single') {
      insShift.run('UNICO', 'Turno Único', '08:00', '20:00', maxSellers);
    } else if (shiftMode === 'triple') {
      insShift.run('MANANA', 'Turno Mañana', '06:00', '14:00', maxSellers);
      insShift.run('TARDE', 'Turno Tarde', '14:00', '22:00', maxSellers);
      insShift.run('NOCHE', 'Turno Noche', '22:00', '06:00', maxSellers);
    } else {
      insShift.run('MANANA', 'Turno Mañana', '07:00', '15:00', maxSellers);
      insShift.run('TARDE', 'Turno Tarde', '15:00', '23:00', maxSellers);
    }

    ownerTenantUserId = provisionTenantUserFromAccount(tdb, account, {
      role: 'jefe',
      base_salary_cup: Math.max(12000, 2100),
      contract_type: legalForm === 'MIPYME' ? 'Socio Administrador' : 'Titular TCP',
      ci: payload.owner_ci || account.ci || '85010112345',
      phone: whatsappPhone,
    });

    // Opening balance journal entry
    const cashReserve = Math.min(roundCup(pettyCash * maxSellers), roundCup(socialCapital * 0.2));
    const bankOpening = roundCup(socialCapital - cashReserve);
    postJournalEntry(tdb, {
      entryDate: today,
      sourceType: 'APERTURA',
      sourceRef: 'ACTA-001',
      description: `Apertura inicial de ${name} — Capital Social y Fondo de Caja`,
      createdBy: ownerTenantUserId,
      silent: true,
      lines: [
        ...(bankOpening > 0 ? [{ account: NCIF_ACCOUNTS.BANCO_FISCAL, debit: bankOpening }] : []),
        ...(cashReserve > 0 ? [{ account: NCIF_ACCOUNTS.CAJA_CHICA, debit: cashReserve }] : []),
        { account: NCIF_ACCOUNTS.CAPITAL_SOCIAL, credit: socialCapital },
      ],
    });

    if (seedCatalog === 'starter') {
      const insProd = tdb.prepare(
        `INSERT INTO products
         (sku, name, category, unit, unit_cost_cup, indirect_cost_pct, sale_price_cup,
          is_price_capped, price_cap_cup, price_cap_resolution, is_margin_regulated, sales_tax_exempt,
          warehouse_stock, kiosk_stock, warehouse_min_stock, kiosk_min_stock, kiosk_target_stock,
          current_batch, next_expiry_date, active)
         VALUES (?, ?, ?, ?, ?, 8.0, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, 1)`
      );
      const insMov = tdb.prepare(
        `INSERT INTO inventory_movements
         (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
          warehouse_balance_after, kiosk_balance_after, supplier_name, payment_method, batch_code, expiry_date, reason, created_by)
         VALUES (?, ?, 'APLICADO', ?, ?, ?, ?, ?, ?, 'Inventario Inicial', 'TRANSFERENCIA', ?, ?, ?, ?)`
      );

      let whValue = 0;
      let kioskValue = 0;
      STARTER_CATALOG.forEach((item, idx) => {
        const expDate = new Date(`${today}T12:00:00Z`);
        expDate.setUTCDate(expDate.getUTCDate() + item.days);
        const expIso = expDate.toISOString().slice(0, 10);
        const batch = `LT-INI-${String(idx + 1).padStart(2, '0')}`;
        const pid = Number(
          insProd.run(
            item.sku,
            item.name,
            item.category,
            item.unit,
            item.cost,
            item.price,
            item.capped,
            item.cap,
            item.res,
            item.wh,
            item.kiosk,
            item.whMin,
            item.kMin,
            item.kTarget,
            batch,
            expIso
          ).lastInsertRowid
        );
        const totQty = item.wh + item.kiosk;
        whValue = roundCup(whValue + item.wh * item.cost);
        kioskValue = roundCup(kioskValue + item.kiosk * item.cost);
        insMov.run(
          `SC204-${String(idx + 1).padStart(4, '0')}`,
          'RECEPCION',
          pid,
          totQty,
          item.cost,
          roundCup(totQty * item.cost),
          totQty,
          0,
          batch,
          expIso,
          'Carga inicial editable de catálogo',
          ownerTenantUserId
        );
        insMov.run(
          `SC209-${String(idx + 1).padStart(4, '0')}`,
          'TRANSFERENCIA_KIOSKO',
          pid,
          item.kiosk,
          item.cost,
          roundCup(item.kiosk * item.cost),
          item.wh,
          item.kiosk,
          batch,
          expIso,
          'Surtido inicial de mostrador',
          ownerTenantUserId
        );
      });

      const totalInv = roundCup(whValue + kioskValue);
      const fromBank = Math.min(roundCup(bankOpening * 0.6), totalInv);
      const onCredit = roundCup(totalInv - fromBank);
      postJournalEntry(tdb, {
        entryDate: today,
        sourceType: 'RECEPCION',
        sourceRef: 'SC204-INICIAL',
        description: 'Registro contable de catálogo base inicial (SC-2-04 / SC-2-09)',
        createdBy: ownerTenantUserId,
        silent: true,
        lines: [
          { account: NCIF_ACCOUNTS.INV_ALMACEN, debit: whValue },
          { account: NCIF_ACCOUNTS.INV_KIOSKO, debit: kioskValue },
          ...(fromBank > 0 ? [{ account: NCIF_ACCOUNTS.BANCO_FISCAL, credit: fromBank }] : []),
          ...(onCredit > 0 ? [{ account: NCIF_ACCOUNTS.PROVEEDORES, credit: onCredit }] : []),
        ],
      });
    }

    logAutomation(
      tdb,
      'EMPRESA',
      'INFO',
      `Empresa creada — Código de afiliación ${companyCode}`,
      `Modo "${preset.name}" activado con ${Object.values(modules).filter(Boolean).length} módulos y hasta ${maxSellers} caja(s) por turno. Comparte ${companyCode} con tu equipo.`,
      companyCode
    );
    logAudit(
      tdb,
      { id: ownerTenantUserId, full_name: account.full_name, role: 'jefe' },
      'CREACION_EMPRESA',
      'Mi Empresa',
      `Creada la empresa "${name}" (${legalForm}) por ${account.email} con código ${companyCode}.`
    );
  });

  pdb
    .prepare(
      `INSERT INTO company_memberships
       (company_id, account_id, tenant_user_id, role, status, requested_role, requested_ci, requested_phone, decided_at)
       VALUES (?, ?, ?, 'jefe', 'ACTIVO', 'jefe', ?, ?, datetime('now'))`
    )
    .run(companyId, account.id, ownerTenantUserId, account.ci || '', whatsappPhone);

  const company = pdb.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  return { company, tenantDb: tdb, tenantUserId: ownerTenantUserId };
}

export function hashSimpleCode(code) {
  return hashPassword(String(code).trim());
}
