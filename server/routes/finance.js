import { Router } from 'express';
import { getDb, nextDocCode, roundCup, runInTransaction } from '../db.js';
import { logAudit, logAutomation, requireAuth, requireRole } from '../auth.js';
import {
  MFP_RES_225_CAPS,
  NCIF_ACCOUNTS,
  calculateCostSheet,
  calculateOnatSummary,
  calculatePayrollPreview,
  getConfig,
  getCurrentPeriod,
  getNextBusinessDayIso,
  getTodayIso,
  postJournalEntry,
  runComplianceAudit,
  validateBancarizacionPayment,
  validateProposedPrice,
} from '../cubanLawEngine.js';

const router = Router();

/**
 * MFP Cost Sheets & Official Retail Price Board (Tablilla Oficial de Precios en CUP)
 */
router.get('/cost-sheets', requireAuth, (_req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const products = db.prepare(`SELECT * FROM products WHERE active = 1 ORDER BY category, name`).all();
  const items = products.map((p) => ({
    ...p,
    cost_sheet: calculateCostSheet(p, config),
  }));
  const history = db
    .prepare(
      `SELECT pcr.*, p.sku, p.name AS product_name, p.unit, u.full_name AS created_by_name
       FROM price_change_requests pcr
       JOIN products p ON p.id = pcr.product_id
       LEFT JOIN users u ON u.id = pcr.created_by
       ORDER BY pcr.id DESC LIMIT 25`
    )
    .all();

  res.json({
    business: {
      business_name: config.business_name,
      legal_form: config.legal_form,
      nit: config.nit,
      municipality: config.municipality,
      province: config.province,
      address: config.address,
      transfermovil_merchant_code: config.transfermovil_merchant_code,
      enzona_merchant_code: config.enzona_merchant_code,
      qr_discount_pct: config.qr_discount_pct,
      max_regulated_margin_pct: config.max_regulated_margin_pct,
      indirect_cost_alloc_pct: config.indirect_cost_alloc_pct,
    },
    mfp_res_225_caps: MFP_RES_225_CAPS,
    items,
    history,
  });
});

router.post('/products/:id/price', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const id = Number(req.params.id);
  const product = db.prepare(`SELECT * FROM products WHERE id = ? AND active = 1`).get(id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });

  const b = req.body || {};
  const nextIndirect =
    b.indirect_cost_pct !== undefined ? Math.max(0, Number(b.indirect_cost_pct)) : product.indirect_cost_pct;
  const nextIsCapped = b.is_price_capped !== undefined ? (b.is_price_capped ? 1 : 0) : product.is_price_capped;
  const nextCap =
    nextIsCapped && Number(b.price_cap_cup ?? product.price_cap_cup) > 0
      ? roundCup(b.price_cap_cup ?? product.price_cap_cup)
      : null;
  const nextCapRes = nextIsCapped
    ? String(b.price_cap_resolution ?? product.price_cap_resolution ?? 'Res. 225/2024 MFP').trim()
    : '';
  const nextMarginReg =
    b.is_margin_regulated !== undefined ? (b.is_margin_regulated ? 1 : 0) : product.is_margin_regulated;

  const candidate = {
    ...product,
    indirect_cost_pct: nextIndirect,
    is_price_capped: nextIsCapped,
    price_cap_cup: nextCap,
    price_cap_resolution: nextCapRes,
    is_margin_regulated: nextMarginReg,
  };

  const check = validateProposedPrice(candidate, b.sale_price_cup, config);
  if (!check.valid) {
    logAutomation(
      db,
      'PRECIOS_MFP',
      'BLOQUEO',
      `Cambio de precio bloqueado: ${product.name}`,
      check.message,
      product.sku
    );
    return res.status(400).json({ error: check.message, cost_sheet: check.sheet });
  }

  const newPrice = roundCup(b.sale_price_cup);

  runInTransaction(db, () => {
    db.prepare(
      `UPDATE products SET
         sale_price_cup = ?, indirect_cost_pct = ?, is_price_capped = ?,
         price_cap_cup = ?, price_cap_resolution = ?, is_margin_regulated = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(newPrice, nextIndirect, nextIsCapped, nextCap, nextCapRes, nextMarginReg, id);

    db.prepare(
      `INSERT INTO price_change_requests
       (product_id, old_price_cup, new_price_cup, unit_cost_cup, full_cost_cup, margin_pct, reason, status, created_by, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'APLICADO', ?, ?)`
    ).run(
      id,
      product.sale_price_cup,
      newPrice,
      check.sheet.unit_cost_cup,
      check.sheet.full_cost_cup,
      check.sheet.margin_pct,
      String(b.reason || 'Actualización de Ficha de Costo MFP').trim(),
      req.user.id,
      req.user.id
    );

    // Update reference price in open shift IPV if not yet sold, or keep new price current
    const openShift = db.prepare(`SELECT id FROM shift_sessions WHERE status = 'ABIERTO' LIMIT 1`).get();
    if (openShift) {
      db.prepare(
        `UPDATE shift_ipv_snapshots SET sale_price_cup = ? WHERE shift_session_id = ? AND product_id = ?`
      ).run(newPrice, openShift.id, id);
    }

    logAudit(
      db,
      req.user,
      'FICHA_COSTO_PRECIO',
      'Precios MFP',
      `${product.sku} (${product.name}): ${product.sale_price_cup.toFixed(2)} → ${newPrice.toFixed(
        2
      )} CUP (margen ${check.sheet.margin_pct}%).`
    );
  });

  res.json({ ok: true, sale_price_cup: newPrice, cost_sheet: check.sheet, warning: check.warning });
});

router.post('/auto-optimize-prices', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const products = db.prepare(`SELECT * FROM products WHERE active = 1 AND unit_cost_cup > 0`).all();

  const adjusted = runInTransaction(db, () => {
    const changes = [];
    for (const p of products) {
      const sheet = calculateCostSheet(p, config);
      if (sheet.exceeds_cap || sheet.exceeds_margin || sheet.below_cost) {
        const target = sheet.suggested_price_cup;
        if (target > 0 && Math.abs(target - p.sale_price_cup) >= 0.5) {
          const newSheet = calculateCostSheet({ ...p, sale_price_cup: target }, config);
          db.prepare(`UPDATE products SET sale_price_cup = ?, updated_at = datetime('now') WHERE id = ?`).run(
            target,
            p.id
          );
          db.prepare(
            `INSERT INTO price_change_requests
             (product_id, old_price_cup, new_price_cup, unit_cost_cup, full_cost_cup, margin_pct, reason, status, created_by, approved_by)
             VALUES (?, ?, ?, ?, ?, ?, 'Ajuste automático de cumplimiento MFP (topes y margen ≤ 30%)', 'APLICADO', ?, ?)`
          ).run(
            p.id,
            p.sale_price_cup,
            target,
            newSheet.unit_cost_cup,
            newSheet.full_cost_cup,
            newSheet.margin_pct,
            req.user.id,
            req.user.id
          );
          changes.push({ name: p.name, old: p.sale_price_cup, next: target });
        }
      }
    }
    if (changes.length > 0) {
      logAutomation(
        db,
        'PRECIOS_MFP',
        'INFO',
        `Ajuste automático MFP en ${changes.length} producto(s)`,
        changes.map((c) => `${c.name}: ${c.old}→${c.next} CUP`).join('; '),
        'MFP-AUTO'
      );
      logAudit(
        db,
        req.user,
        'AUTO_AJUSTE_PRECIOS',
        'Precios MFP',
        `Ajustados automáticamente ${changes.length} precios fuera de rango MFP.`
      );
    }
    return changes;
  });

  res.json({ adjusted_count: adjusted.length, adjusted });
});

/**
 * ONAT Tax Summary & Payment Recording
 */
router.get('/onat', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const period = String(req.query.period || getCurrentPeriod()).slice(0, 7);
  const summary = calculateOnatSummary(db, period);
  const config = getConfig(db);

  const periodsRows = db
    .prepare(
      `SELECT DISTINCT substr(sale_date, 1, 7) AS p FROM sales
       UNION
       SELECT DISTINCT period AS p FROM tax_filings
       ORDER BY p DESC`
    )
    .all();
  const periods = Array.from(new Set([getCurrentPeriod(), ...periodsRows.map((r) => r.p)]));

  res.json({
    ...summary,
    available_periods: periods,
    business: {
      business_name: config.business_name,
      legal_form: config.legal_form,
      nit: config.nit,
      municipality: config.municipality,
      province: config.province,
      bank_name: config.bank_name,
      fiscal_account_cup: config.fiscal_account_cup,
      social_capital_cup: config.social_capital_cup,
      legal_reserve_balance_cup: config.legal_reserve_balance_cup,
    },
  });
});

router.post('/onat/pay', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const { period, tax_code, payment_ref } = req.body || {};
  const targetPeriod = String(period || getCurrentPeriod()).slice(0, 7);

  if (!tax_code || !String(payment_ref || '').trim()) {
    return res.status(400).json({
      error:
        'Indique el tributo ONAT y el número de comprobante bancario / Transfermóvil (pago desde Cuenta Bancaria Fiscal).',
    });
  }

  const summary = calculateOnatSummary(db, targetPeriod);
  const ob = summary.obligations.find((o) => o.tax_code === tax_code);
  if (!ob) return res.status(404).json({ error: 'Concepto tributario no encontrado.' });
  if (ob.status === 'PAGADO') {
    return res.status(400).json({ error: 'Este tributo ya fue liquidado y pagado en el período seleccionado.' });
  }
  if (ob.amount_cup <= 0) {
    return res.status(400).json({ error: 'El importe calculado para este tributo es 0.00 CUP; no requiere pago.' });
  }

  const out = runInTransaction(db, () => {
    const cleanRef = String(payment_ref).trim();
    db.prepare(
      `INSERT INTO tax_filings
       (period, tax_code, tax_name, onat_paragraph, taxable_base_cup, rate_pct, amount_cup, due_date, status, payment_ref, paid_at, paid_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PAGADO', ?, datetime('now'), ?)
       ON CONFLICT(period, tax_code) DO UPDATE SET
         amount_cup = excluded.amount_cup,
         taxable_base_cup = excluded.taxable_base_cup,
         status = 'PAGADO',
         payment_ref = excluded.payment_ref,
         paid_at = datetime('now'),
         paid_by = excluded.paid_by`
    ).run(
      targetPeriod,
      ob.tax_code,
      ob.tax_name,
      ob.onat_paragraph,
      ob.taxable_base_cup,
      ob.rate_pct,
      ob.amount_cup,
      ob.due_date,
      cleanRef,
      req.user.id
    );

    // Check if payroll already accrued IUFT/SS/Retenciones to debit liability rather than double-expensing
    const paidPayroll = db
      .prepare(`SELECT id FROM payroll_runs WHERE period = ? AND status IN ('APROBADA', 'PAGADA')`)
      .get(targetPeriod);

    let debitAccount = NCIF_ACCOUNTS.GASTOS_TRIBUTOS;
    if (paidPayroll) {
      if (ob.tax_code === 'RETENCION_SS_IIP') debitAccount = NCIF_ACCOUNTS.RETENCIONES_PAGAR;
      else if (ob.tax_code === 'SS_EMPLEADOR') debitAccount = NCIF_ACCOUNTS.SS_PAGAR;
      else if (ob.tax_code === 'IUFT_5') debitAccount = NCIF_ACCOUNTS.ONAT_PAGAR;
    }

    const journal = postJournalEntry(db, {
      entryDate: getTodayIso(),
      sourceType: 'ONAT',
      sourceRef: `ONAT-${ob.onat_paragraph}-${targetPeriod}`,
      description: `Pago ONAT Párrafo ${ob.onat_paragraph} (${ob.tax_name} — ${targetPeriod}) Ref: ${cleanRef}`,
      createdBy: req.user.id,
      lines: [
        { account: debitAccount, debit: ob.amount_cup },
        { account: NCIF_ACCOUNTS.BANCO_FISCAL, credit: ob.amount_cup },
      ],
    });

    logAutomation(
      db,
      'ONAT',
      'INFO',
      `Tributo ONAT pagado: ${ob.tax_name}`,
      `Liquidado ${ob.amount_cup.toFixed(2)} CUP (Párrafo ${ob.onat_paragraph}, período ${targetPeriod}) desde Cuenta Bancaria Fiscal — Ref: ${cleanRef}.`,
      cleanRef
    );
    logAudit(
      db,
      req.user,
      'PAGO_ONAT',
      'Tributos ONAT',
      `Pagado ${ob.tax_name} (${targetPeriod}) por ${ob.amount_cup.toFixed(2)} CUP — Ref. ${cleanRef}.`
    );

    return { journal_entry: journal?.entryNumber, amount_cup: ob.amount_cup };
  });

  res.json({ ok: true, ...out, summary: calculateOnatSummary(db, targetPeriod) });
});

/**
 * Banking, Bancarización Res. 111/2023 BCC, QR Reconciliation & Operating Expenses
 */
router.get('/banking', requireAuth, requireRole('economico', 'jefe'), (_req, res) => {
  const db = getDb();
  const config = getConfig(db);

  const acctBal = (code) => {
    const r = db
      .prepare(`SELECT COALESCE(SUM(debit_cup - credit_cup), 0) AS bal FROM journal_lines WHERE account_code = ?`)
      .get(code);
    return roundCup(r?.bal || 0);
  };

  const deposits = db
    .prepare(
      `SELECT bd.*, ss.session_code, u1.full_name AS created_by_name, u2.full_name AS completed_by_name
       FROM bank_deposits bd
       LEFT JOIN shift_sessions ss ON ss.id = bd.shift_session_id
       LEFT JOIN users u1 ON u1.id = bd.created_by
       LEFT JOIN users u2 ON u2.id = bd.completed_by
       ORDER BY CASE bd.status WHEN 'PENDIENTE' THEN 0 ELSE 1 END, bd.id DESC
       LIMIT 40`
    )
    .all();

  const unreconciledQr = db
    .prepare(
      `SELECT s.id, s.receipt_number, s.sale_date, s.payment_method,
              s.transfermovil_amount_cup, s.enzona_amount_cup, s.electronic_ref,
              s.customer_phone, s.created_at, u.full_name AS seller_name, sr.register_number
       FROM sales s
       JOIN users u ON u.id = s.seller_id
       JOIN shift_registers sr ON sr.id = s.shift_register_id
       WHERE s.status = 'COMPLETADA' AND s.reconciled = 0
         AND (s.transfermovil_amount_cup > 0 OR s.enzona_amount_cup > 0)
       ORDER BY s.id DESC`
    )
    .all();

  const expenses = db
    .prepare(
      `SELECT e.*, u.full_name AS created_by_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
       ORDER BY e.id DESC
       LIMIT 50`
    )
    .all();

  res.json({
    config: {
      bank_name: config.bank_name,
      fiscal_account_cup: config.fiscal_account_cup,
      transfermovil_merchant_code: config.transfermovil_merchant_code,
      enzona_merchant_code: config.enzona_merchant_code,
      max_cash_provider_payment_cup: config.max_cash_provider_payment_cup,
      max_vault_cash_before_deposit_cup: config.max_vault_cash_before_deposit_cup,
      petty_cash_fund_cup: config.petty_cash_fund_cup,
    },
    balances: {
      bank_fiscal_cup: acctBal('110'),
      cash_general_cup: acctBal('101'),
      cash_petty_cup: acctBal('102'),
      qr_pending_cup: acctBal('135'),
      faltantes_cup: acctBal('330'),
    },
    deposits,
    unreconciled_qr: unreconciledQr,
    expenses,
  });
});

router.post('/deposits/:id/complete', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const ref = String(req.body?.bank_voucher_ref || '').trim();
  if (!ref) {
    return res
      .status(400)
      .json({ error: 'Ingrese el número del comprobante de depósito bancario emitido por la sucursal.' });
  }

  const dep = db.prepare(`SELECT * FROM bank_deposits WHERE id = ? AND status = 'PENDIENTE'`).get(id);
  if (!dep) return res.status(404).json({ error: 'Orden de depósito no encontrada o ya ejecutada.' });

  const out = runInTransaction(db, () => {
    db.prepare(
      `UPDATE bank_deposits
       SET status = 'DEPOSITADO', bank_voucher_ref = ?, completed_by = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(ref, req.user.id, id);

    const journal = postJournalEntry(db, {
      entryDate: getTodayIso(),
      sourceType: 'DEPOSITO',
      sourceRef: dep.order_number,
      description: `Depósito de efectivo en Cuenta Bancaria Fiscal (${dep.order_number}) — Voucher ${ref}`,
      createdBy: req.user.id,
      lines: [
        { account: NCIF_ACCOUNTS.BANCO_FISCAL, debit: dep.amount_cup },
        { account: NCIF_ACCOUNTS.CAJA_GENERAL, credit: dep.amount_cup },
      ],
    });

    logAudit(
      db,
      req.user,
      'DEPOSITO_BANCARIO',
      'Bancarización BCC',
      `Confirmado depósito ${dep.order_number} por ${dep.amount_cup.toFixed(2)} CUP — Comprobante ${ref}.`
    );
    return { journal_entry: journal?.entryNumber };
  });

  res.json({ ok: true, ...out });
});

router.post('/deposits', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const amount = roundCup(req.body?.amount_cup);
  const voucher = String(req.body?.bank_voucher_ref || '').trim();
  const notes = String(req.body?.notes || 'Depósito de efectivo en Cuenta Bancaria Fiscal').trim();

  if (amount <= 0) return res.status(400).json({ error: 'Indique un importe mayor que cero en CUP.' });

  const orderNum = nextDocCode(db, 'bank_deposits', 'order_number', 'DEP', 4);
  const executeNow = Boolean(voucher);

  runInTransaction(db, () => {
    db.prepare(
      `INSERT INTO bank_deposits
       (order_number, origin, amount_cup, due_date, status, bank_voucher_ref, notes, created_by, completed_by, completed_at)
       VALUES (?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orderNum,
      amount,
      getNextBusinessDayIso(getTodayIso()),
      executeNow ? 'DEPOSITADO' : 'PENDIENTE',
      voucher,
      notes,
      req.user.id,
      executeNow ? req.user.id : null,
      executeNow ? new Date().toISOString() : null
    );

    if (executeNow) {
      postJournalEntry(db, {
        entryDate: getTodayIso(),
        sourceType: 'DEPOSITO',
        sourceRef: orderNum,
        description: `Depósito bancario directo ${orderNum} — Comprobante ${voucher}`,
        createdBy: req.user.id,
        lines: [
          { account: NCIF_ACCOUNTS.BANCO_FISCAL, debit: amount },
          { account: NCIF_ACCOUNTS.CAJA_GENERAL, credit: amount },
        ],
      });
    }

    logAudit(
      db,
      req.user,
      'CREACION_DEPOSITO',
      'Bancarización BCC',
      `${orderNum}: ${amount.toFixed(2)} CUP (${executeNow ? 'Depositado' : 'Pendiente'}).`
    );
  });

  res.status(201).json({ order_number: orderNum });
});

router.post('/reconcile-qr', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const pending = db
    .prepare(
      `SELECT id, receipt_number, transfermovil_amount_cup, enzona_amount_cup
       FROM sales
       WHERE status = 'COMPLETADA' AND reconciled = 0
         AND (transfermovil_amount_cup > 0 OR enzona_amount_cup > 0)`
    )
    .all();

  if (pending.length === 0) {
    return res.status(400).json({ error: 'Todos los cobros QR (Transfermóvil y EnZona) ya están conciliados.' });
  }

  const out = runInTransaction(db, () => {
    const totalQr = roundCup(
      pending.reduce((a, s) => a + s.transfermovil_amount_cup + s.enzona_amount_cup, 0)
    );
    const ids = pending.map((p) => p.id);
    db.prepare(
      `UPDATE sales SET reconciled = 1 WHERE id IN (${ids.map(() => '?').join(',')})`
    ).run(...ids);

    const journal = postJournalEntry(db, {
      entryDate: getTodayIso(),
      sourceType: 'DEPOSITO',
      sourceRef: `CONC-QR-${ids.length}`,
      description: `Conciliación automática de ${pending.length} cobro(s) Transfermóvil/EnZona en Cuenta Bancaria Fiscal`,
      createdBy: req.user.id,
      lines: [
        { account: NCIF_ACCOUNTS.BANCO_FISCAL, debit: totalQr },
        { account: NCIF_ACCOUNTS.COBROS_QR, credit: totalQr },
      ],
    });

    logAudit(
      db,
      req.user,
      'CONCILIACION_QR',
      'Bancarización BCC',
      `Conciliados ${pending.length} pagos QR por ${totalQr.toFixed(2)} CUP en Cuenta Bancaria Fiscal.`
    );
    return { count: pending.length, total_cup: totalQr, journal_entry: journal?.entryNumber };
  });

  res.json(out);
});

router.post('/expenses', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const b = req.body || {};
  const amount = roundCup(b.amount_cup);
  const method = String(b.payment_method || 'TRANSFERENCIA').toUpperCase();

  if (!b.category?.trim() || !b.description?.trim() || !b.provider_name?.trim() || amount <= 0) {
    return res
      .status(400)
      .json({ error: 'Complete categoría, descripción, proveedor e importe mayor que cero.' });
  }

  const bccCheck = validateBancarizacionPayment(amount, method, b.payment_ref, config);
  if (!bccCheck.valid) {
    logAutomation(
      db,
      'BANCARIZACION',
      'BLOQUEO',
      `Gasto en efectivo bloqueado (${amount.toFixed(2)} CUP)`,
      bccCheck.message,
      'BCC-111'
    );
    return res.status(400).json({ error: bccCheck.message });
  }

  const hasReceipt = b.has_valid_receipt !== undefined ? (b.has_valid_receipt ? 1 : 0) : 1;
  const docNum = nextDocCode(db, 'expenses', 'doc_number', 'GAS', 4);
  const expDate = b.expense_date || getTodayIso();

  runInTransaction(db, () => {
    db.prepare(
      `INSERT INTO expenses
       (doc_number, expense_date, category, description, provider_name, invoice_ref,
        has_valid_receipt, amount_cup, payment_method, payment_ref, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      docNum,
      expDate,
      String(b.category).trim(),
      String(b.description).trim(),
      String(b.provider_name).trim(),
      String(b.invoice_ref || '').trim(),
      hasReceipt,
      amount,
      method,
      String(b.payment_ref || '').trim(),
      req.user.id
    );

    postJournalEntry(db, {
      entryDate: expDate,
      sourceType: 'GASTO',
      sourceRef: docNum,
      description: `Gasto ${docNum} (${b.category}): ${b.description} — ${b.provider_name}`,
      createdBy: req.user.id,
      lines: [
        { account: NCIF_ACCOUNTS.GASTOS_ADMIN, debit: amount },
        {
          account: method === 'EFECTIVO' ? NCIF_ACCOUNTS.CAJA_GENERAL : NCIF_ACCOUNTS.BANCO_FISCAL,
          credit: amount,
        },
      ],
    });

    logAudit(
      db,
      req.user,
      'REGISTRO_GASTO',
      'Economía',
      `${docNum}: ${amount.toFixed(2)} CUP en ${b.category} (${method}, justificante=${hasReceipt ? 'Sí' : 'No'}).`
    );
  });

  res.status(201).json({ doc_number: docNum });
});

/**
 * Automated Cuban Payroll (Ley 116 + Ley 113 progressive IIP + SS + IUFT + 9.09% Vacation)
 */
router.get('/payroll', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const period = String(req.query.period || getCurrentPeriod()).slice(0, 7);
  const preview = calculatePayrollPreview(db, period);

  const savedRun = db.prepare(`SELECT * FROM payroll_runs WHERE period = ?`).get(period);
  const savedItems = savedRun
    ? db.prepare(`SELECT * FROM payroll_items WHERE payroll_run_id = ? ORDER BY id`).all(savedRun.id)
    : null;

  const history = db.prepare(`SELECT * FROM payroll_runs ORDER BY period DESC LIMIT 12`).all();

  res.json({
    period,
    saved_run: savedRun ? { ...savedRun, items: savedItems } : null,
    live_preview: { items: preview.items, totals: preview.totals },
    rules: {
      legal_form: preview.config.legal_form,
      min_wage_cup: preview.config.min_wage_cup,
      vacation_provision_pct: preview.config.vacation_provision_pct,
      worker_ss_pct: preview.config.worker_ss_pct,
      employer_ss_pct: preview.config.employer_ss_pct,
      labor_force_tax_pct: preview.config.labor_force_tax_pct,
      iip_exempt_monthly_cup: preview.config.iip_exempt_monthly_cup,
    },
    history,
  });
});

router.post('/payroll/generate', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const period = String(req.body?.period || getCurrentPeriod()).slice(0, 7);
  const payNow = Boolean(req.body?.pay_now);
  const paymentRef = String(req.body?.payment_ref || '').trim();

  if (payNow && !paymentRef) {
    return res.status(400).json({
      error:
        'Para pagar la nómina por transferencia bancaria (tarjetas magnéticas / Transfermóvil) indique la referencia bancaria.',
    });
  }

  const existing = db.prepare(`SELECT * FROM payroll_runs WHERE period = ?`).get(period);
  if (existing?.status === 'PAGADA') {
    return res.status(400).json({ error: `La nómina del período ${period} ya fue pagada y contabilizada.` });
  }

  const preview = calculatePayrollPreview(db, period);
  const { items, totals } = preview;

  const out = runInTransaction(db, () => {
    if (existing) {
      db.prepare(`DELETE FROM payroll_runs WHERE id = ?`).run(existing.id);
    }

    const status = payNow ? 'PAGADA' : 'APROBADA';
    const r = db
      .prepare(
        `INSERT INTO payroll_runs
         (period, status, total_gross_cup, total_vacation_accrual_cup, total_worker_ss_cup,
          total_worker_iip_cup, total_net_cup, total_employer_ss_cup, total_labor_tax_cup,
          payment_method, payment_ref, created_by, approved_by, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'TRANSFERENCIA', ?, ?, ?, ?)`
      )
      .run(
        period,
        status,
        totals.total_gross_cup,
        totals.total_vacation_accrual_cup,
        totals.total_worker_ss_cup,
        totals.total_worker_iip_cup,
        totals.total_net_cup,
        totals.total_employer_ss_cup,
        totals.total_labor_tax_cup,
        paymentRef,
        req.user.id,
        req.user.id,
        payNow ? new Date().toISOString() : null
      );
    const runId = Number(r.lastInsertRowid);

    const insItem = db.prepare(
      `INSERT INTO payroll_items
       (payroll_run_id, user_id, full_name, role, ci, shifts_worked, seller_sales_cup,
        base_salary_cup, commission_cup, gross_salary_cup, vacation_accrual_cup,
        worker_ss_cup, worker_iip_cup, net_salary_cup, employer_ss_cup, labor_tax_cup)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of items) {
      insItem.run(
        runId,
        it.user_id,
        it.full_name,
        it.role,
        it.ci,
        it.shifts_worked,
        it.seller_sales_cup,
        it.base_salary_cup,
        it.commission_cup,
        it.gross_salary_cup,
        it.vacation_accrual_cup,
        it.worker_ss_cup,
        it.worker_iip_cup,
        it.net_salary_cup,
        it.employer_ss_cup,
        it.labor_tax_cup
      );
    }

    let journal = null;
    if (payNow) {
      const salaryAndVac = roundCup(totals.total_gross_cup + totals.total_vacation_accrual_cup);
      const employerTaxes = roundCup(totals.total_employer_ss_cup + totals.total_labor_tax_cup);
      const withholdings = roundCup(totals.total_worker_ss_cup + totals.total_worker_iip_cup);

      journal = postJournalEntry(db, {
        entryDate: getTodayIso(),
        sourceType: 'NOMINA',
        sourceRef: `NOM-${period}`,
        description: `Nómina ${period} pagada por banco (Ref: ${paymentRef}) + retenciones SS/IIP, 9.09% vacaciones e IUFT`,
        createdBy: req.user.id,
        lines: [
          { account: NCIF_ACCOUNTS.GASTOS_ADMIN, debit: salaryAndVac },
          { account: NCIF_ACCOUNTS.GASTOS_TRIBUTOS, debit: employerTaxes },
          { account: NCIF_ACCOUNTS.BANCO_FISCAL, credit: totals.total_net_cup },
          { account: NCIF_ACCOUNTS.RETENCIONES_PAGAR, credit: withholdings },
          { account: NCIF_ACCOUNTS.VACACIONES_PROV, credit: totals.total_vacation_accrual_cup },
          { account: NCIF_ACCOUNTS.SS_PAGAR, credit: totals.total_employer_ss_cup },
          { account: NCIF_ACCOUNTS.ONAT_PAGAR, credit: totals.total_labor_tax_cup },
        ],
      });

      logAutomation(
        db,
        'NOMINA',
        'INFO',
        `Nómina ${period} pagada y contabilizada automáticamente`,
        `${items.length} trabajadores · Neto transferido: ${totals.total_net_cup.toFixed(
          2
        )} CUP · Retenciones ONAT: ${withholdings.toFixed(2)} CUP · SS+IUFT: ${employerTaxes.toFixed(2)} CUP.`,
        `NOM-${period}`
      );
    }

    logAudit(
      db,
      req.user,
      payNow ? 'PAGO_NOMINA' : 'GENERACION_NOMINA',
      'Nómina Laboral',
      `Nómina ${period} (${status}): Bruto ${totals.total_gross_cup.toFixed(2)} CUP, Neto ${totals.total_net_cup.toFixed(
        2
      )} CUP.`
    );

    return { payroll_run_id: runId, status, journal_entry: journal?.entryNumber || null };
  });

  res.status(201).json(out);
});

router.post('/payroll/:id/pay', requireAuth, requireRole('economico', 'jefe'), (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const paymentRef = String(req.body?.payment_ref || '').trim();
  if (!paymentRef) {
    return res.status(400).json({ error: 'Ingrese el número de transferencia bancaria del pago de nómina.' });
  }

  const run = db.prepare(`SELECT * FROM payroll_runs WHERE id = ?`).get(id);
  if (!run) return res.status(404).json({ error: 'Nómina no encontrada.' });
  if (run.status === 'PAGADA') return res.status(400).json({ error: 'Esta nómina ya fue pagada.' });

  const out = runInTransaction(db, () => {
    db.prepare(
      `UPDATE payroll_runs SET status = 'PAGADA', payment_ref = ?, approved_by = ?, paid_at = datetime('now') WHERE id = ?`
    ).run(paymentRef, req.user.id, id);

    const salaryAndVac = roundCup(run.total_gross_cup + run.total_vacation_accrual_cup);
    const employerTaxes = roundCup(run.total_employer_ss_cup + run.total_labor_tax_cup);
    const withholdings = roundCup(run.total_worker_ss_cup + run.total_worker_iip_cup);

    const journal = postJournalEntry(db, {
      entryDate: getTodayIso(),
      sourceType: 'NOMINA',
      sourceRef: `NOM-${run.period}`,
      description: `Pago de Nómina ${run.period} (Ref: ${paymentRef}) + provisión vacaciones y tributos ONAT`,
      createdBy: req.user.id,
      lines: [
        { account: NCIF_ACCOUNTS.GASTOS_ADMIN, debit: salaryAndVac },
        { account: NCIF_ACCOUNTS.GASTOS_TRIBUTOS, debit: employerTaxes },
        { account: NCIF_ACCOUNTS.BANCO_FISCAL, credit: run.total_net_cup },
        { account: NCIF_ACCOUNTS.RETENCIONES_PAGAR, credit: withholdings },
        { account: NCIF_ACCOUNTS.VACACIONES_PROV, credit: run.total_vacation_accrual_cup },
        { account: NCIF_ACCOUNTS.SS_PAGAR, credit: run.total_employer_ss_cup },
        { account: NCIF_ACCOUNTS.ONAT_PAGAR, credit: run.total_labor_tax_cup },
      ],
    });

    logAudit(
      db,
      req.user,
      'PAGO_NOMINA',
      'Nómina Laboral',
      `Desembolsada nómina ${run.period} por ${run.total_net_cup.toFixed(2)} CUP — Ref: ${paymentRef}.`
    );

    return { journal_entry: journal?.entryNumber };
  });

  res.json({ ok: true, ...out });
});

/**
 * Automated NCIF Accounting: General Journal, Trial Balance & Income Statement
 */
router.get('/accounting', requireAuth, requireRole('economico', 'jefe'), (_req, res) => {
  const db = getDb();
  const period = getCurrentPeriod();

  const trialRows = db
    .prepare(
      `SELECT account_code, account_name,
              ROUND(SUM(debit_cup), 2) AS total_debit_cup,
              ROUND(SUM(credit_cup), 2) AS total_credit_cup
       FROM journal_lines
       GROUP BY account_code, account_name
       ORDER BY account_code ASC`
    )
    .all()
    .map((r) => {
      const net = roundCup(r.total_debit_cup - r.total_credit_cup);
      return {
        ...r,
        debit_balance_cup: net > 0 ? net : 0,
        credit_balance_cup: net < 0 ? Math.abs(net) : 0,
      };
    });

  const trialTotals = {
    total_debit_cup: roundCup(trialRows.reduce((a, r) => a + r.total_debit_cup, 0)),
    total_credit_cup: roundCup(trialRows.reduce((a, r) => a + r.total_credit_cup, 0)),
    debit_balance_cup: roundCup(trialRows.reduce((a, r) => a + r.debit_balance_cup, 0)),
    credit_balance_cup: roundCup(trialRows.reduce((a, r) => a + r.credit_balance_cup, 0)),
  };
  trialTotals.is_balanced =
    Math.abs(trialTotals.total_debit_cup - trialTotals.total_credit_cup) < 0.02 &&
    Math.abs(trialTotals.debit_balance_cup - trialTotals.credit_balance_cup) < 0.02;

  const entries = db
    .prepare(
      `SELECT je.*, u.full_name AS created_by_name
       FROM journal_entries je
       LEFT JOIN users u ON u.id = je.created_by
       ORDER BY je.id DESC
       LIMIT 60`
    )
    .all();

  const getLines = db.prepare(`SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY id`);
  const journal = entries.map((e) => ({ ...e, lines: getLines.all(e.id) }));

  const onat = calculateOnatSummary(db, period);

  res.json({
    period,
    trial_balance: trialRows,
    trial_totals: trialTotals,
    journal,
    income_statement: onat.income_statement,
  });
});

/**
 * Virtual Inspector & Ready-to-Print Inspection Dossier (DIS / ONAT / BCC / MFP / MTSS)
 */
router.get('/compliance', requireAuth, requireRole('jefe', 'economico', 'almacenero'), (_req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const audit = runComplianceAudit(db);
  const period = getCurrentPeriod();
  const onat = calculateOnatSummary(db, period);

  const staff = db
    .prepare(
      `SELECT u.full_name, u.ci, u.role, u.contract_type, u.contract_date, u.base_salary_cup,
              st.name AS shift_name, u.default_register
       FROM users u
       LEFT JOIN shift_templates st ON st.id = u.shift_template_id
       WHERE u.active = 1
       ORDER BY CASE u.role WHEN 'jefe' THEN 1 WHEN 'economico' THEN 2 WHEN 'almacenero' THEN 3 ELSE 4 END, u.id`
    )
    .all();

  const cappedProducts = db
    .prepare(`SELECT * FROM products WHERE active = 1 AND is_price_capped = 1 ORDER BY sku`)
    .all()
    .map((p) => ({ ...p, cost_sheet: calculateCostSheet(p, config) }));

  res.json({
    config,
    compliance: audit,
    dossier: {
      generated_at: new Date().toISOString(),
      period,
      staff,
      capped_products: cappedProducts,
      onat_totals: onat.totals,
      electronic_share_pct: onat.income_statement.electronic_share_pct,
      gross_sales_cup: onat.income_statement.gross_sales_cup,
    },
  });
});

export default router;
