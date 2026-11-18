import { Router } from 'express';
import { getDb, roundCup, runInTransaction } from '../db.js';
import { hashPassword, logAudit, logAutomation, requireAuth, requireRole } from '../auth.js';
import {
  MFP_RES_225_CAPS,
  calculateOnatSummary,
  getConfig,
  getCurrentPeriod,
  getTodayIso,
  runComplianceAudit,
} from '../cubanLawEngine.js';
import { resetAllData } from '../seed.js';

const router = Router();

router.get('/', requireAuth, (_req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const shifts = db.prepare('SELECT * FROM shift_templates ORDER BY id').all();
  res.json({ config, shifts, mfp_res_225_caps: MFP_RES_225_CAPS });
});

router.put('/', requireAuth, requireRole('jefe', 'economico'), (req, res) => {
  const db = getDb();
  const current = getConfig(db);
  const body = req.body || {};

  // Only Jefe can modify legal form, business name, social capital, or max sellers
  const isJefe = req.user.role === 'jefe';
  const nextLegalForm =
    isJefe && ['MIPYME', 'TCP'].includes(body.legal_form) ? body.legal_form : current.legal_form;
  const nextMinWage = Math.max(2100, Number(body.min_wage_cup ?? current.min_wage_cup));

  const updated = {
    business_name: isJefe ? String(body.business_name ?? current.business_name).trim() : current.business_name,
    legal_form: nextLegalForm,
    nit: String(body.nit ?? current.nit).trim(),
    reeup_code: String(body.reeup_code ?? current.reeup_code).trim(),
    municipality: String(body.municipality ?? current.municipality).trim(),
    province: String(body.province ?? current.province).trim(),
    address: String(body.address ?? current.address).trim(),
    activity_description: String(body.activity_description ?? current.activity_description).trim(),
    bank_name: String(body.bank_name ?? current.bank_name).trim(),
    fiscal_account_cup: String(body.fiscal_account_cup ?? current.fiscal_account_cup).trim(),
    fiscal_account_titular: String(body.fiscal_account_titular ?? current.fiscal_account_titular).trim(),
    transfermovil_phone: String(body.transfermovil_phone ?? current.transfermovil_phone).trim(),
    transfermovil_merchant_code: String(
      body.transfermovil_merchant_code ?? current.transfermovil_merchant_code
    ).trim(),
    enzona_merchant_code: String(body.enzona_merchant_code ?? current.enzona_merchant_code).trim(),
    qr_discount_pct: Math.max(0, Math.min(15, Number(body.qr_discount_pct ?? current.qr_discount_pct))),
    social_capital_cup: isJefe
      ? Math.max(0, roundCup(body.social_capital_cup ?? current.social_capital_cup))
      : current.social_capital_cup,
    legal_reserve_balance_cup: Math.max(
      0,
      roundCup(body.legal_reserve_balance_cup ?? current.legal_reserve_balance_cup)
    ),
    petty_cash_fund_cup: Math.max(0, roundCup(body.petty_cash_fund_cup ?? current.petty_cash_fund_cup)),
    max_cash_provider_payment_cup: Math.max(
      500,
      roundCup(body.max_cash_provider_payment_cup ?? current.max_cash_provider_payment_cup)
    ),
    max_vault_cash_before_deposit_cup: Math.max(
      1000,
      roundCup(body.max_vault_cash_before_deposit_cup ?? current.max_vault_cash_before_deposit_cup)
    ),
    min_wage_cup: nextMinWage,
    sales_tax_pct: Math.max(0, Number(body.sales_tax_pct ?? current.sales_tax_pct)),
    local_dev_tax_pct: Math.max(0, Number(body.local_dev_tax_pct ?? current.local_dev_tax_pct)),
    labor_force_tax_pct: Math.max(0, Number(body.labor_force_tax_pct ?? current.labor_force_tax_pct)),
    employer_ss_pct: Math.max(0, Number(body.employer_ss_pct ?? current.employer_ss_pct)),
    worker_ss_pct: Math.max(0, Number(body.worker_ss_pct ?? current.worker_ss_pct)),
    vacation_provision_pct: Math.max(0, Number(body.vacation_provision_pct ?? current.vacation_provision_pct)),
    profit_tax_pct: Math.max(0, Number(body.profit_tax_pct ?? current.profit_tax_pct)),
    legal_reserve_pct: Math.max(0, Number(body.legal_reserve_pct ?? current.legal_reserve_pct)),
    iip_exempt_monthly_cup: Math.max(0, Number(body.iip_exempt_monthly_cup ?? current.iip_exempt_monthly_cup)),
    max_regulated_margin_pct: Math.max(
      5,
      Number(body.max_regulated_margin_pct ?? current.max_regulated_margin_pct)
    ),
    indirect_cost_alloc_pct: Math.max(
      0,
      Number(body.indirect_cost_alloc_pct ?? current.indirect_cost_alloc_pct)
    ),
    auto_restock_enabled: body.auto_restock_enabled !== undefined ? (body.auto_restock_enabled ? 1 : 0) : current.auto_restock_enabled,
    auto_accounting_enabled:
      body.auto_accounting_enabled !== undefined ? (body.auto_accounting_enabled ? 1 : 0) : current.auto_accounting_enabled,
    auto_deposit_order_enabled:
      body.auto_deposit_order_enabled !== undefined
        ? body.auto_deposit_order_enabled
          ? 1
          : 0
        : current.auto_deposit_order_enabled,
    strict_price_cap_block:
      body.strict_price_cap_block !== undefined ? (body.strict_price_cap_block ? 1 : 0) : current.strict_price_cap_block,
    strict_bancarizacion_block:
      body.strict_bancarizacion_block !== undefined
        ? body.strict_bancarizacion_block
          ? 1
          : 0
        : current.strict_bancarizacion_block,
  };

  db.prepare(
    `UPDATE business_config SET
       business_name = @business_name,
       legal_form = @legal_form,
       nit = @nit,
       reeup_code = @reeup_code,
       municipality = @municipality,
       province = @province,
       address = @address,
       activity_description = @activity_description,
       bank_name = @bank_name,
       fiscal_account_cup = @fiscal_account_cup,
       fiscal_account_titular = @fiscal_account_titular,
       transfermovil_phone = @transfermovil_phone,
       transfermovil_merchant_code = @transfermovil_merchant_code,
       enzona_merchant_code = @enzona_merchant_code,
       qr_discount_pct = @qr_discount_pct,
       social_capital_cup = @social_capital_cup,
       legal_reserve_balance_cup = @legal_reserve_balance_cup,
       petty_cash_fund_cup = @petty_cash_fund_cup,
       max_cash_provider_payment_cup = @max_cash_provider_payment_cup,
       max_vault_cash_before_deposit_cup = @max_vault_cash_before_deposit_cup,
       min_wage_cup = @min_wage_cup,
       sales_tax_pct = @sales_tax_pct,
       local_dev_tax_pct = @local_dev_tax_pct,
       labor_force_tax_pct = @labor_force_tax_pct,
       employer_ss_pct = @employer_ss_pct,
       worker_ss_pct = @worker_ss_pct,
       vacation_provision_pct = @vacation_provision_pct,
       profit_tax_pct = @profit_tax_pct,
       legal_reserve_pct = @legal_reserve_pct,
       iip_exempt_monthly_cup = @iip_exempt_monthly_cup,
       max_regulated_margin_pct = @max_regulated_margin_pct,
       indirect_cost_alloc_pct = @indirect_cost_alloc_pct,
       auto_restock_enabled = @auto_restock_enabled,
       auto_accounting_enabled = @auto_accounting_enabled,
       auto_deposit_order_enabled = @auto_deposit_order_enabled,
       strict_price_cap_block = @strict_price_cap_block,
       strict_bancarizacion_block = @strict_bancarizacion_block,
       updated_at = datetime('now')
     WHERE id = 1`
  ).run(updated);

  logAudit(
    db,
    req.user,
    'ACTUALIZACION_CONFIG',
    'Configuración Legal',
    `Actualizados parámetros fiscales/operativos (${updated.business_name} — ${updated.legal_form}).`
  );

  const compliance = runComplianceAudit(db);
  if (nextLegalForm === 'TCP' && current.legal_form !== 'TCP') {
    const hired = db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE active = 1 AND role != 'jefe'`).get().cnt;
    if (hired > 3) {
      logAutomation(
        db,
        'ONAT',
        'ALERTA',
        'Advertencia legal DL 90/2024 al cambiar a TCP',
        `El negocio posee ${hired} trabajadores contratados. El DL 90/2024 limita a 3 contratados en TCP; para 2 vendedores/turno + almacenero + económico corresponde Micro-MIPYME (DL 88/2024).`,
        'DL-90'
      );
    }
  }

  res.json({ config: getConfig(db), compliance });
});

router.get('/staff', requireAuth, requireRole('jefe', 'economico'), (_req, res) => {
  const db = getDb();
  const period = getCurrentPeriod();
  const config = getConfig(db);
  const shifts = db.prepare('SELECT * FROM shift_templates ORDER BY id').all();
  const users = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.ci, u.nit_personal, u.role,
              u.shift_template_id, st.name AS shift_name, st.start_time, st.end_time,
              u.default_register, u.contract_type, u.contract_date,
              u.base_salary_cup, u.sales_commission_pct, u.phone, u.active, u.created_at,
              (SELECT COALESCE(SUM(s.total_cup), 0) FROM sales s
               WHERE s.seller_id = u.id AND s.status = 'COMPLETADA' AND substr(s.sale_date, 1, 7) = ?) AS month_sales_cup,
              (SELECT COUNT(*) FROM shift_registers sr
               JOIN shift_sessions ss ON ss.id = sr.shift_session_id
               WHERE sr.seller_id = u.id AND substr(ss.work_date, 1, 7) = ?) AS month_shifts
       FROM users u
       LEFT JOIN shift_templates st ON st.id = u.shift_template_id
       ORDER BY u.active DESC, CASE u.role
         WHEN 'jefe' THEN 1
         WHEN 'economico' THEN 2
         WHEN 'almacenero' THEN 3
         WHEN 'vendedor' THEN 4
       END, u.shift_template_id, u.default_register`
    )
    .all(period, period);

  res.json({ staff: users, shifts, config });
});

router.post('/staff', requireAuth, requireRole('jefe'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const {
    username,
    password,
    full_name,
    ci,
    nit_personal,
    role,
    shift_template_id,
    default_register,
    contract_type,
    contract_date,
    base_salary_cup,
    sales_commission_pct,
    phone,
  } = req.body || {};

  if (!username?.trim() || !full_name?.trim() || !ci?.trim() || !role) {
    return res.status(400).json({ error: 'Complete usuario, nombre completo, Carné de Identidad y cargo.' });
  }
  if (!['jefe', 'economico', 'almacenero', 'vendedor'].includes(role)) {
    return res.status(400).json({ error: 'Cargo inválido.' });
  }
  const cleanCi = String(ci).replace(/\D/g, '');
  if (cleanCi.length !== 11) {
    return res.status(400).json({ error: 'El Carné de Identidad cubano (CI) debe tener exactamente 11 dígitos.' });
  }

  const salary = roundCup(base_salary_cup);
  if (salary < Number(config.min_wage_cup)) {
    return res.status(400).json({
      error: `Bloqueado por Ley 116 (Código de Trabajo): El salario básico (${salary} CUP) no puede ser inferior al salario mínimo legal en Cuba (${config.min_wage_cup} CUP/mes).`,
    });
  }

  // Validate DL 90/2024 TCP limit
  if (config.legal_form === 'TCP' && role !== 'jefe') {
    const hired = db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE active = 1 AND role != 'jefe'`).get().cnt;
    if (hired >= 3) {
      return res.status(400).json({
        error:
          'Bloqueado por Decreto-Ley 90/2024: Un TCP solo puede contratar hasta 3 trabajadores. Cambie la forma jurídica a Micro-MIPYME (DL 88/2024, hasta 10 personas) para ampliar la plantilla.',
      });
    }
  }

  // Enforce 1 jefe, 1 economico, 1 almacenero or 2 sellers per shift
  if (['jefe', 'economico', 'almacenero'].includes(role)) {
    const existsRole = db
      .prepare(`SELECT COUNT(*) AS cnt FROM users WHERE active = 1 AND role = ?`)
      .get(role).cnt;
    if (existsRole >= 1) {
      const label = role === 'jefe' ? 'Jefe del Negocio' : role === 'economico' ? 'Económico' : 'Almacenero';
      return res.status(400).json({
        error: `La plantilla del kiosko establece exactamente 1 ${label} activo. Desactive o edite al titular actual antes de asignar otro.`,
      });
    }
  }

  let shiftId = null;
  let regNum = null;
  if (role === 'vendedor') {
    if (!shift_template_id) {
      return res.status(400).json({ error: 'Todo vendedor debe estar asignado a un turno de trabajo.' });
    }
    shiftId = Number(shift_template_id);
    const sellersInShift = db
      .prepare(`SELECT * FROM users WHERE active = 1 AND role = 'vendedor' AND shift_template_id = ?`)
      .all(shiftId);
    if (sellersInShift.length >= Number(config.max_sellers_per_shift)) {
      return res.status(400).json({
        error: `Ese turno ya cuenta con el máximo de ${config.max_sellers_per_shift} vendedores activos (Caja 1 y Caja 2). Asigne otro turno o cree un nuevo turno.`,
      });
    }
    const desiredReg = Number(default_register) === 2 ? 2 : 1;
    const regTaken = sellersInShift.some((s) => s.default_register === desiredReg);
    regNum = regTaken ? (desiredReg === 1 ? 2 : 1) : desiredReg;
  }

  const dupUser = db
    .prepare(`SELECT id FROM users WHERE lower(username) = lower(?)`)
    .get(String(username).trim());
  if (dupUser) {
    return res.status(400).json({ error: 'Ya existe un trabajador con ese nombre de usuario.' });
  }

  const pwHash = hashPassword(password?.trim() || 'kiosko2026');
  const result = db
    .prepare(
      `INSERT INTO users
       (username, password_hash, full_name, ci, nit_personal, role, shift_template_id, default_register,
        contract_type, contract_date, base_salary_cup, sales_commission_pct, phone, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      String(username).trim(),
      pwHash,
      String(full_name).trim(),
      cleanCi,
      String(nit_personal || cleanCi).trim(),
      role,
      shiftId,
      regNum,
      String(contract_type || 'Indeterminado').trim(),
      contract_date || getTodayIso(),
      salary,
      role === 'vendedor' ? Math.max(0, Number(sales_commission_pct || 0)) : 0,
      String(phone || '').trim()
    );

  logAudit(
    db,
    req.user,
    'ALTA_TRABAJADOR',
    'Personal y Turnos',
    `Contratado ${full_name} (CI ${cleanCi}) como ${role} — Salario ${salary.toFixed(2)} CUP.`
  );

  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.put('/staff/:id', requireAuth, requireRole('jefe'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const id = Number(req.params.id);
  const emp = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!emp) return res.status(404).json({ error: 'Trabajador no encontrado.' });

  const body = req.body || {};
  const nextSalary = body.base_salary_cup !== undefined ? roundCup(body.base_salary_cup) : emp.base_salary_cup;
  if (nextSalary < Number(config.min_wage_cup)) {
    return res.status(400).json({
      error: `Bloqueado por Ley 116: El salario (${nextSalary} CUP) no puede ser inferior al mínimo legal (${config.min_wage_cup} CUP).`,
    });
  }

  const nextActive = body.active !== undefined ? (body.active ? 1 : 0) : emp.active;
  if (emp.id === req.user.id && nextActive === 0) {
    return res.status(400).json({ error: 'No puede desactivar su propio usuario de Jefe del Negocio.' });
  }

  const nextRole =
    body.role && ['jefe', 'economico', 'almacenero', 'vendedor'].includes(body.role) ? body.role : emp.role;
  let nextShift = nextRole === 'vendedor' ? Number(body.shift_template_id ?? emp.shift_template_id) : null;
  let nextReg =
    nextRole === 'vendedor'
      ? [1, 2].includes(Number(body.default_register))
        ? Number(body.default_register)
        : emp.default_register || 1
      : null;

  if (nextActive === 1 && nextRole === 'vendedor' && nextShift) {
    const others = db
      .prepare(
        `SELECT * FROM users WHERE active = 1 AND role = 'vendedor' AND shift_template_id = ? AND id != ?`
      )
      .all(nextShift, id);
    if (others.length >= Number(config.max_sellers_per_shift)) {
      return res.status(400).json({
        error: `Ese turno ya tiene ${config.max_sellers_per_shift} vendedores activos asignados.`,
      });
    }
    if (others.some((o) => o.default_register === nextReg)) {
      nextReg = nextReg === 1 ? 2 : 1;
    }
  }

  if (nextActive === 1 && ['jefe', 'economico', 'almacenero'].includes(nextRole)) {
    const otherSame = db
      .prepare(`SELECT id FROM users WHERE active = 1 AND role = ? AND id != ?`)
      .get(nextRole, id);
    if (otherSame) {
      return res.status(400).json({
        error: `Ya existe otro trabajador activo ocupando la plaza de ${nextRole}.`,
      });
    }
  }

  const nextCi = body.ci ? String(body.ci).replace(/\D/g, '') : emp.ci;
  if (nextCi.length !== 11) {
    return res.status(400).json({ error: 'El CI debe tener 11 dígitos.' });
  }

  db.prepare(
    `UPDATE users SET
       full_name = ?, ci = ?, role = ?, shift_template_id = ?, default_register = ?,
       contract_type = ?, base_salary_cup = ?, sales_commission_pct = ?, phone = ?, active = ?
     WHERE id = ?`
  ).run(
    String(body.full_name ?? emp.full_name).trim(),
    nextCi,
    nextRole,
    nextShift,
    nextReg,
    String(body.contract_type ?? emp.contract_type).trim(),
    nextSalary,
    nextRole === 'vendedor' ? Math.max(0, Number(body.sales_commission_pct ?? emp.sales_commission_pct)) : 0,
    String(body.phone ?? emp.phone).trim(),
    nextActive,
    id
  );

  if (body.password && String(body.password).trim().length >= 4) {
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
      hashPassword(String(body.password).trim()),
      id
    );
  }

  logAudit(
    db,
    req.user,
    'EDICION_TRABAJADOR',
    'Personal y Turnos',
    `Actualizado ${body.full_name ?? emp.full_name} (${nextRole}, salario ${nextSalary} CUP, activo=${nextActive}).`
  );

  res.json({ ok: true });
});

router.post('/shifts', requireAuth, requireRole('jefe'), (req, res) => {
  const db = getDb();
  const { code, name, start_time, end_time } = req.body || {};
  if (!name?.trim() || !start_time || !end_time) {
    return res.status(400).json({ error: 'Indique nombre, hora de inicio y hora de cierre del turno.' });
  }
  const cleanCode = String(code || name)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  const result = db
    .prepare(
      `INSERT INTO shift_templates (code, name, start_time, end_time, required_sellers, active)
       VALUES (?, ?, ?, ?, 2, 1)`
    )
    .run(cleanCode || `TRN${Date.now() % 1000}`, String(name).trim(), start_time, end_time);

  logAudit(
    db,
    req.user,
    'CREACION_TURNO',
    'Personal y Turnos',
    `Creado turno "${name}" (${start_time}–${end_time}) con 2 vendedores requeridos.`
  );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.get('/overview', requireAuth, requireRole('jefe', 'economico'), (_req, res) => {
  const db = getDb();
  const today = getTodayIso();
  const period = getCurrentPeriod();
  const config = getConfig(db);

  const todaySales = db
    .prepare(
      `SELECT
         COUNT(*) AS tickets,
         COALESCE(SUM(total_cup), 0) AS total_cup,
         COALESCE(SUM(total_cost_cup), 0) AS cost_cup,
         COALESCE(SUM(cash_amount_cup), 0) AS cash_cup,
         COALESCE(SUM(transfermovil_amount_cup), 0) AS tm_cup,
         COALESCE(SUM(enzona_amount_cup), 0) AS ez_cup
       FROM sales WHERE status = 'COMPLETADA' AND sale_date = ?`
    )
    .get(today);

  const invAgg = db
    .prepare(
      `SELECT
         COUNT(*) AS total_products,
         COALESCE(SUM(warehouse_stock * unit_cost_cup), 0) AS warehouse_cost_cup,
         COALESCE(SUM(kiosk_stock * unit_cost_cup), 0) AS kiosk_cost_cup,
         COALESCE(SUM(kiosk_stock * sale_price_cup), 0) AS kiosk_retail_cup,
         SUM(CASE WHEN kiosk_stock <= kiosk_min_stock THEN 1 ELSE 0 END) AS low_kiosk_count,
         SUM(CASE WHEN warehouse_stock <= warehouse_min_stock THEN 1 ELSE 0 END) AS low_warehouse_count
       FROM products WHERE active = 1`
    )
    .get();

  const bankRow = db
    .prepare(
      `SELECT COALESCE(SUM(debit_cup - credit_cup), 0) AS balance
       FROM journal_lines WHERE account_code = '110'`
    )
    .get();

  const activeShift = db
    .prepare(
      `SELECT ss.*, st.name AS shift_name, st.start_time, st.end_time
       FROM shift_sessions ss
       JOIN shift_templates st ON st.id = ss.shift_template_id
       WHERE ss.status = 'ABIERTO'
       ORDER BY ss.id DESC LIMIT 1`
    )
    .get();

  const activeRegisters = activeShift
    ? db
        .prepare(
          `SELECT sr.*, u.full_name AS seller_name, u.username AS seller_username
           FROM shift_registers sr
           JOIN users u ON u.id = sr.seller_id
           WHERE sr.shift_session_id = ?
           ORDER BY sr.register_number`
        )
        .all(activeShift.id)
    : [];

  const pendingMermas = db
    .prepare(
      `SELECT im.*, p.name AS product_name, p.unit, p.sku, u.full_name AS created_by_name
       FROM inventory_movements im
       JOIN products p ON p.id = im.product_id
       LEFT JOIN users u ON u.id = im.created_by
       WHERE im.status = 'PENDIENTE_APROBACION'
       ORDER BY im.id DESC`
    )
    .all();

  const pendingDeposits = db
    .prepare(`SELECT * FROM bank_deposits WHERE status = 'PENDIENTE' ORDER BY due_date ASC`)
    .all();

  const pendingRestocks = db
    .prepare(
      `SELECT rr.*, p.name AS product_name, p.sku, p.unit, p.kiosk_stock, p.warehouse_stock
       FROM restock_requests rr
       JOIN products p ON p.id = rr.product_id
       WHERE rr.status = 'PENDIENTE'
       ORDER BY CASE rr.priority WHEN 'URGENTE' THEN 0 ELSE 1 END, rr.id DESC`
    )
    .all();

  const unvalidatedShifts = db
    .prepare(
      `SELECT ss.*, st.name AS shift_name,
              (SELECT COALESCE(SUM(total_sales_cup), 0) FROM shift_registers WHERE shift_session_id = ss.id) AS total_sales_cup,
              (SELECT COALESCE(SUM(cash_difference_cup), 0) FROM shift_registers WHERE shift_session_id = ss.id) AS total_diff_cup
       FROM shift_sessions ss
       JOIN shift_templates st ON st.id = ss.shift_template_id
       WHERE ss.status = 'CERRADO'
       ORDER BY ss.id DESC`
    )
    .all();

  const topProducts = db
    .prepare(
      `SELECT si.product_id, si.product_name, si.unit, si.is_price_capped,
              SUM(si.quantity) AS qty_sold,
              ROUND(SUM(si.line_total_cup), 2) AS revenue_cup,
              ROUND(SUM(si.line_total_cup - si.line_cost_cup), 2) AS margin_cup
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'COMPLETADA' AND substr(s.sale_date, 1, 7) = ?
       GROUP BY si.product_id
       ORDER BY revenue_cup DESC
       LIMIT 6`
    )
    .all(period);

  const automationFeed = db
    .prepare(`SELECT * FROM automation_events ORDER BY id DESC LIMIT 12`)
    .all();

  const staffSummary = db
    .prepare(
      `SELECT role, COUNT(*) AS count FROM users WHERE active = 1 GROUP BY role`
    )
    .all();

  const onat = calculateOnatSummary(db, period);
  const compliance = runComplianceAudit(db);

  res.json({
    today,
    period,
    config,
    today_sales: {
      tickets: Number(todaySales.tickets || 0),
      total_cup: roundCup(todaySales.total_cup),
      gross_margin_cup: roundCup(todaySales.total_cup - todaySales.cost_cup),
      cash_cup: roundCup(todaySales.cash_cup),
      transfermovil_cup: roundCup(todaySales.tm_cup),
      enzona_cup: roundCup(todaySales.ez_cup),
      electronic_pct:
        todaySales.total_cup > 0
          ? roundCup(((todaySales.tm_cup + todaySales.ez_cup) / todaySales.total_cup) * 100)
          : 0,
    },
    bank_balance_cup: roundCup(bankRow?.balance || 0),
    inventory: {
      total_products: Number(invAgg.total_products || 0),
      warehouse_cost_cup: roundCup(invAgg.warehouse_cost_cup),
      kiosk_cost_cup: roundCup(invAgg.kiosk_cost_cup),
      total_cost_cup: roundCup(invAgg.warehouse_cost_cup + invAgg.kiosk_cost_cup),
      kiosk_retail_cup: roundCup(invAgg.kiosk_retail_cup),
      low_kiosk_count: Number(invAgg.low_kiosk_count || 0),
      low_warehouse_count: Number(invAgg.low_warehouse_count || 0),
    },
    active_shift: activeShift ? { ...activeShift, registers: activeRegisters } : null,
    onat,
    compliance,
    pending_approvals: {
      mermas: pendingMermas,
      deposits: pendingDeposits,
      restocks: pendingRestocks,
      unvalidated_shifts: unvalidatedShifts,
    },
    top_products: topProducts,
    automation_feed: automationFeed,
    staff_summary: staffSummary,
  });
});

router.get('/audit', requireAuth, requireRole('jefe', 'economico'), (_req, res) => {
  const db = getDb();
  const auditLogs = db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100`).all();
  const automations = db.prepare(`SELECT * FROM automation_events ORDER BY id DESC LIMIT 80`).all();
  res.json({ audit_logs: auditLogs, automation_events: automations });
});

router.post('/reset', requireAuth, requireRole('jefe'), (req, res) => {
  const db = getDb();
  const mode = req.body?.mode === 'clean' ? 'clean' : 'demo';
  runInTransaction(db, () => {}); // verify db writable
  resetAllData(db, mode);
  res.json({
    ok: true,
    mode,
    message:
      mode === 'demo'
        ? 'Datos de demostración restaurados correctamente.'
        : 'Sistema inicializado en limpio listo para operar en producción.',
  });
});

export default router;
