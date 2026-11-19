import { Router } from 'express';
import { getDb, nextDocCode, roundCup, runInTransaction } from '../db.js';
import { logAudit, logAutomation, requireAuth, requirePermission, requireRole } from '../auth.js';
import {
  CUP_DENOMINATIONS,
  NCIF_ACCOUNTS,
  checkAndTriggerAutoRestock,
  getConfig,
  getNextBusinessDayIso,
  getTodayIso,
  postJournalEntry,
} from '../cubanLawEngine.js';

const router = Router();

function loadSessionBundle(db, sessionId) {
  const session = db
    .prepare(
      `SELECT ss.*, st.name AS shift_name, st.code AS shift_code, st.start_time, st.end_time,
              st.required_sellers, u1.full_name AS opened_by_name, u2.full_name AS audited_by_name
       FROM shift_sessions ss
       JOIN shift_templates st ON st.id = ss.shift_template_id
       LEFT JOIN users u1 ON u1.id = ss.opened_by
       LEFT JOIN users u2 ON u2.id = ss.audited_by
       WHERE ss.id = ?`
    )
    .get(sessionId);

  if (!session) return null;

  const registers = db
    .prepare(
      `SELECT sr.*, u.full_name AS seller_name, u.username AS seller_username, u.ci AS seller_ci,
              uv.full_name AS validated_by_name
       FROM shift_registers sr
       JOIN users u ON u.id = sr.seller_id
       LEFT JOIN users uv ON uv.id = sr.validated_by
       WHERE sr.shift_session_id = ?
       ORDER BY sr.register_number ASC`
    )
    .all(sessionId)
    .map((r) => ({
      ...r,
      denominations: (() => {
        try {
          return JSON.parse(r.denominations_json || '{}');
        } catch {
          return {};
        }
      })(),
    }));

  const ipv = db
    .prepare(
      `SELECT s.*, p.sku, p.name AS product_name, p.category, p.unit,
              p.is_price_capped, p.price_cap_cup, p.kiosk_min_stock, p.warehouse_stock
       FROM shift_ipv_snapshots s
       JOIN products p ON p.id = s.product_id
       WHERE s.shift_session_id = ?
       ORDER BY p.category, p.name`
    )
    .all(sessionId);

  const sales = db
    .prepare(
      `SELECT s.*, u.full_name AS seller_name, sr.register_number
       FROM sales s
       JOIN users u ON u.id = s.seller_id
       JOIN shift_registers sr ON sr.id = s.shift_register_id
       WHERE s.shift_session_id = ?
       ORDER BY s.id DESC
       LIMIT 60`
    )
    .all(sessionId);

  const getItems = db.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`);
  const salesWithItems = sales.map((s) => ({
    ...s,
    items: getItems.all(s.id),
  }));

  const cashMovements = db
    .prepare(
      `SELECT cm.*, sr.register_number, u.full_name AS created_by_name
       FROM cash_movements cm
       JOIN shift_registers sr ON sr.id = cm.shift_register_id
       LEFT JOIN users u ON u.id = cm.created_by
       WHERE cm.shift_session_id = ?
       ORDER BY cm.id DESC`
    )
    .all(sessionId);

  const registersWithCash = registers.map((r) => {
    const movs = cashMovements.filter((m) => m.shift_register_id === r.id);
    const cash_in_cup = roundCup(
      movs.filter((m) => m.type === 'ENTRADA').reduce((a, m) => a + m.amount_cup, 0)
    );
    const cash_out_cup = roundCup(
      movs.filter((m) => m.type === 'SALIDA').reduce((a, m) => a + m.amount_cup, 0)
    );
    return { ...r, cash_in_cup, cash_out_cup };
  });

  // Compute voided/returned units per product during this shift
  const returnedRows = db
    .prepare(
      `SELECT si.product_id, COALESCE(SUM(si.quantity), 0) AS returned_qty
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.shift_session_id = ? AND s.status = 'ANULADA'
       GROUP BY si.product_id`
    )
    .all(sessionId);
  const retMap = new Map(returnedRows.map((r) => [r.product_id, roundCup(r.returned_qty)]));
  const enrichedIpv = ipv.map((row) => ({
    ...row,
    returned_qty: retMap.get(row.product_id) || 0,
  }));

  const totals = {
    total_sales_cup: roundCup(registersWithCash.reduce((a, r) => a + r.total_sales_cup, 0)),
    cash_sales_cup: roundCup(registersWithCash.reduce((a, r) => a + r.cash_sales_cup, 0)),
    transfermovil_sales_cup: roundCup(
      registersWithCash.reduce((a, r) => a + r.transfermovil_sales_cup, 0)
    ),
    enzona_sales_cup: roundCup(registersWithCash.reduce((a, r) => a + r.enzona_sales_cup, 0)),
    cash_in_cup: roundCup(registersWithCash.reduce((a, r) => a + r.cash_in_cup, 0)),
    cash_out_cup: roundCup(registersWithCash.reduce((a, r) => a + r.cash_out_cup, 0)),
    sales_count: registersWithCash.reduce((a, r) => a + r.sales_count, 0),
    ipv_sold_amount_cup: roundCup(enrichedIpv.reduce((a, i) => a + i.sold_amount_cup, 0)),
  };

  return {
    session,
    registers: registersWithCash,
    ipv: enrichedIpv,
    sales: salesWithItems,
    cash_movements: cashMovements,
    totals,
  };
}

router.get('/active-shift', requireAuth, (_req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const shifts = db.prepare(`SELECT * FROM shift_templates WHERE active = 1 ORDER BY id`).all();
  const active = db
    .prepare(`SELECT id FROM shift_sessions WHERE status = 'ABIERTO' ORDER BY id DESC LIMIT 1`)
    .get();

  res.json({
    active: active ? loadSessionBundle(db, active.id) : null,
    shift_templates: shifts,
    denominations: CUP_DENOMINATIONS,
    payment_config: {
      business_name: config.business_name,
      nit: config.nit,
      bank_name: config.bank_name,
      fiscal_account_cup: config.fiscal_account_cup,
      transfermovil_phone: config.transfermovil_phone,
      transfermovil_merchant_code: config.transfermovil_merchant_code,
      enzona_merchant_code: config.enzona_merchant_code,
      qr_discount_pct: config.qr_discount_pct,
      petty_cash_fund_cup: config.petty_cash_fund_cup,
      max_sellers_per_shift: config.max_sellers_per_shift,
    },
  });
});

router.get('/shifts', requireAuth, (_req, res) => {
  const db = getDb();
  const sessions = db
    .prepare(
      `SELECT ss.*, st.name AS shift_name, st.start_time, st.end_time,
              u1.full_name AS opened_by_name, u2.full_name AS audited_by_name
       FROM shift_sessions ss
       JOIN shift_templates st ON st.id = ss.shift_template_id
       LEFT JOIN users u1 ON u1.id = ss.opened_by
       LEFT JOIN users u2 ON u2.id = ss.audited_by
       ORDER BY ss.id DESC
       LIMIT 30`
    )
    .all();

  const getRegs = db.prepare(
    `SELECT sr.*, u.full_name AS seller_name
     FROM shift_registers sr
     JOIN users u ON u.id = sr.seller_id
     WHERE sr.shift_session_id = ?
     ORDER BY sr.register_number`
  );

  const enriched = sessions.map((s) => {
    const registers = getRegs.all(s.id);
    return {
      ...s,
      registers,
      total_sales_cup: roundCup(registers.reduce((a, r) => a + r.total_sales_cup, 0)),
      cash_sales_cup: roundCup(registers.reduce((a, r) => a + r.cash_sales_cup, 0)),
      electronic_sales_cup: roundCup(
        registers.reduce((a, r) => a + r.transfermovil_sales_cup + r.enzona_sales_cup, 0)
      ),
      total_diff_cup: roundCup(registers.reduce((a, r) => a + (r.cash_difference_cup || 0), 0)),
      sales_count: registers.reduce((a, r) => a + r.sales_count, 0),
    };
  });

  res.json({ sessions: enriched });
});

router.get('/shifts/:id/ipv', requireAuth, (req, res) => {
  const db = getDb();
  const bundle = loadSessionBundle(db, Number(req.params.id));
  if (!bundle) return res.status(404).json({ error: 'Turno no encontrado.' });
  res.json(bundle);
});

/**
 * Open a new shift session or join an open shift on Caja 1 or Caja 2 (strictly max 2 sellers per shift).
 */
router.post('/shifts/open', requireAuth, requireRole('vendedor', 'jefe'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const { shift_template_id, register_number, seller_id, opening_cash_cup } = req.body || {};

  if (req.user.role === 'vendedor' && config.permissions?.vendedor_open_shift === false) {
    return res.status(403).json({
      error: 'El creador configuró que la apertura de turnos la realice únicamente Dirección.',
    });
  }

  const targetSellerId =
    req.user.role === 'jefe' && seller_id ? Number(seller_id) : req.user.id;
  const seller = config.owner_can_operate_pos
    ? db
        .prepare(`SELECT * FROM users WHERE id = ? AND active = 1 AND role IN ('vendedor', 'jefe')`)
        .get(targetSellerId)
    : db
        .prepare(`SELECT * FROM users WHERE id = ? AND active = 1 AND role = 'vendedor'`)
        .get(targetSellerId);

  if (!seller) {
    return res.status(400).json({
      error:
        'Solo los Vendedores pueden abrir una caja (o active "El creador puede operar caja" en Mi Empresa y Modo).',
    });
  }

  try {
    const out = runInTransaction(db, () => {
      let session = db
        .prepare(`SELECT * FROM shift_sessions WHERE status = 'ABIERTO' ORDER BY id DESC LIMIT 1`)
        .get();

      const fallbackTpl = db
        .prepare(`SELECT * FROM shift_templates WHERE active = 1 ORDER BY id ASC LIMIT 1`)
        .get();
      if (!session) {
        const tplId = Number(shift_template_id || seller.shift_template_id || fallbackTpl?.id || 0);
        const tpl = db.prepare(`SELECT * FROM shift_templates WHERE id = ? AND active = 1`).get(tplId);
        if (!tpl) throw new Error('Seleccione un turno de trabajo válido.');

        const today = getTodayIso();
        const countToday = db
          .prepare(`SELECT COUNT(*) AS cnt FROM shift_sessions WHERE work_date = ?`)
          .get(today).cnt;
        const suffix = countToday > 0 ? `${tpl.code[0]}${countToday + 1}` : tpl.code[0];
        const sessionCode = `TRN-${today.replace(/-/g, '')}-${suffix}`;

        const sRes = db
          .prepare(
            `INSERT INTO shift_sessions (session_code, shift_template_id, work_date, status, opened_by, notes)
             VALUES (?, ?, ?, 'ABIERTO', ?, ?)`
          )
          .run(sessionCode, tpl.id, today, req.user.id, `Apertura automatizada de ${tpl.name}`);

        const sessionId = Number(sRes.lastInsertRowid);

        // Automated IPV opening snapshot from current kiosk stock
        const products = db.prepare(`SELECT * FROM products WHERE active = 1`).all();
        const insSnap = db.prepare(
          `INSERT INTO shift_ipv_snapshots
           (shift_session_id, product_id, opening_qty, entries_qty, losses_qty, sold_qty, closing_qty, sale_price_cup, sold_amount_cup)
           VALUES (?, ?, ?, 0, 0, 0, ?, ?, 0)`
        );
        for (const p of products) {
          insSnap.run(sessionId, p.id, p.kiosk_stock, p.kiosk_stock, p.sale_price_cup);
        }

        session = db.prepare(`SELECT * FROM shift_sessions WHERE id = ?`).get(sessionId);
      }

      const existingRegs = db
        .prepare(`SELECT * FROM shift_registers WHERE shift_session_id = ?`)
        .all(session.id);

      if (existingRegs.some((r) => r.seller_id === seller.id)) {
        throw new Error(`${seller.full_name} ya tiene una caja registrada en este turno.`);
      }

      if (existingRegs.length >= Number(config.max_sellers_per_shift)) {
        throw new Error(
          `Regla operativa del kiosko: Máximo ${config.max_sellers_per_shift} vendedores por turno (Caja 1 y Caja 2 ya están asignadas en ${session.session_code}). Cierre el turno actual antes de iniciar el relevo.`
        );
      }

      const maxSellers = Math.max(1, Math.min(6, Number(config.max_sellers_per_shift || 2)));
      let regNum = Math.max(
        1,
        Math.min(maxSellers, Number(register_number) || seller.default_register || 1)
      );
      if (existingRegs.some((r) => r.register_number === regNum)) {
        const free = Array.from({ length: maxSellers }, (_, i) => i + 1).find(
          (n) => !existingRegs.some((r) => r.register_number === n)
        );
        regNum = free || 1;
      }

      const openCash = roundCup(
        opening_cash_cup !== undefined ? opening_cash_cup : config.petty_cash_fund_cup
      );

      db.prepare(
        `INSERT INTO shift_registers
         (shift_session_id, register_number, seller_id, status, opening_cash_cup, expected_cash_cup)
         VALUES (?, ?, ?, 'ABIERTA', ?, ?)`
      ).run(session.id, regNum, seller.id, openCash, openCash);

      logAutomation(
        db,
        'TURNO',
        'INFO',
        `Caja ${regNum} abierta en ${session.session_code}`,
        `Vendedor: ${seller.full_name} · Fondo fijo: ${openCash.toFixed(2)} CUP · Vendedores en turno: ${
          existingRegs.length + 1
        }/${config.max_sellers_per_shift}.`,
        session.session_code
      );
      logAudit(
        db,
        req.user,
        'APERTURA_TURNO_CAJA',
        'Turnos y POS',
        `Abierta Caja ${regNum} (${seller.full_name}) en ${session.session_code} con fondo ${openCash.toFixed(2)} CUP.`
      );

      return loadSessionBundle(db, session.id);
    });

    res.status(201).json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Register a POS sale — automated stock deduction, IPV update, QR discount, NCIF accounting & auto-restock.
 */
router.post('/sales', requireAuth, requireRole('vendedor', 'jefe'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const {
    items,
    payment_method,
    cash_tendered_cup,
    cash_amount_cup,
    electronic_channel,
    electronic_ref,
    customer_phone,
    apply_qr_discount = true,
    register_id,
  } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Agregue al menos un producto al comprobante de venta.' });
  }

  const method = String(payment_method || 'EFECTIVO').toUpperCase();
  if (!['EFECTIVO', 'TRANSFERMOVIL', 'ENZONA', 'MIXTO'].includes(method)) {
    return res.status(400).json({ error: 'Método de pago no válido.' });
  }

  if (['TRANSFERMOVIL', 'ENZONA', 'MIXTO'].includes(method) && !String(electronic_ref || '').trim()) {
    return res.status(400).json({
      error:
        'Bancarización (Res. 111/2023 BCC): Ingrese el código de confirmación de Transfermóvil o EnZona para conciliar el cobro.',
    });
  }

  try {
    const result = runInTransaction(db, () => {
      const session = db
        .prepare(`SELECT * FROM shift_sessions WHERE status = 'ABIERTO' ORDER BY id DESC LIMIT 1`)
        .get();
      if (!session) {
        throw new Error('No hay ningún turno abierto. Abra el turno y su caja antes de facturar.');
      }

      let register = null;
      if (req.user.role === 'vendedor') {
        register = db
          .prepare(
            `SELECT * FROM shift_registers
             WHERE shift_session_id = ? AND seller_id = ? AND status = 'ABIERTA'`
          )
          .get(session.id, req.user.id);
        if (!register) {
          throw new Error(
            'Usted no tiene una caja abierta en el turno actual. Solo los 2 vendedores con caja activa en el turno pueden cobrar.'
          );
        }
      } else {
        register = register_id
          ? db
              .prepare(
                `SELECT * FROM shift_registers WHERE id = ? AND shift_session_id = ? AND status = 'ABIERTA'`
              )
              .get(Number(register_id), session.id)
          : db
              .prepare(
                `SELECT * FROM shift_registers WHERE shift_session_id = ? AND status = 'ABIERTA' ORDER BY register_number LIMIT 1`
              )
              .get(session.id);
        if (!register) {
          throw new Error('No hay ninguna caja abierta en el turno activo.');
        }
      }

      // Validate products, stock & Cuban price caps strictly server-side
      let subtotal = 0;
      let totalCost = 0;
      const resolvedItems = [];

      for (const raw of items) {
        const pid = Number(raw.product_id);
        const qty = roundCup(raw.quantity);
        if (!pid || qty <= 0) throw new Error('Cantidad de producto inválida.');

        const prod = db.prepare(`SELECT * FROM products WHERE id = ? AND active = 1`).get(pid);
        if (!prod) throw new Error(`Producto #${pid} no existe o está inactivo.`);

        if (qty > prod.kiosk_stock + 0.0001) {
          throw new Error(
            `Stock insuficiente en mostrador para "${prod.name}": quedan ${prod.kiosk_stock} ${prod.unit}. Solicite reabastecimiento al Almacenero.`
          );
        }

        if (prod.is_price_capped && prod.price_cap_cup && prod.sale_price_cup > prod.price_cap_cup + 0.01) {
          throw new Error(
            `Venta bloqueada por ${prod.price_cap_resolution || 'Res. 225/2024 MFP'}: "${prod.name}" supera su tope oficial (${prod.price_cap_cup} CUP).`
          );
        }

        if (prod.next_expiry_date && prod.next_expiry_date < getTodayIso()) {
          throw new Error(
            `Venta bloqueada por Protección al Consumidor: El lote de "${prod.name}" venció el ${prod.next_expiry_date}. Reporte merma SC-2-16.`
          );
        }

        const lineTotal = roundCup(prod.sale_price_cup * qty);
        const lineCost = roundCup(prod.unit_cost_cup * qty);
        subtotal = roundCup(subtotal + lineTotal);
        totalCost = roundCup(totalCost + lineCost);
        resolvedItems.push({ prod, qty, lineTotal, lineCost });
      }

      const isPureQr = method === 'TRANSFERMOVIL' || method === 'ENZONA';
      const qrDiscount =
        isPureQr && apply_qr_discount && Number(config.qr_discount_pct) > 0
          ? roundCup((subtotal * Number(config.qr_discount_pct)) / 100)
          : 0;
      const total = roundCup(subtotal - qrDiscount);

      let cashAmt = 0;
      let tendered = 0;
      let changeGiven = 0;
      let tmAmt = 0;
      let ezAmt = 0;

      if (method === 'EFECTIVO') {
        cashAmt = total;
        tendered = cash_tendered_cup !== undefined && Number(cash_tendered_cup) > 0 ? roundCup(cash_tendered_cup) : total;
        if (tendered < total - 0.01) {
          throw new Error(
            `Efectivo recibido (${tendered.toFixed(2)} CUP) inferior al total a cobrar (${total.toFixed(2)} CUP).`
          );
        }
        changeGiven = roundCup(tendered - total);
      } else if (method === 'TRANSFERMOVIL') {
        tmAmt = total;
      } else if (method === 'ENZONA') {
        ezAmt = total;
      } else if (method === 'MIXTO') {
        cashAmt = roundCup(cash_amount_cup);
        if (cashAmt <= 0 || cashAmt >= total) {
          throw new Error(
            `En pago mixto, la parte en efectivo debe ser mayor que 0 y menor que el total (${total.toFixed(2)} CUP).`
          );
        }
        tendered = cashAmt;
        const remainder = roundCup(total - cashAmt);
        if (String(electronic_channel || 'TRANSFERMOVIL').toUpperCase() === 'ENZONA') {
          ezAmt = remainder;
        } else {
          tmAmt = remainder;
        }
      }

      const receiptNumber = nextDocCode(db, 'sales', 'receipt_number', 'TK', 5);
      const today = getTodayIso();

      const saleRes = db
        .prepare(
          `INSERT INTO sales
           (receipt_number, shift_session_id, shift_register_id, seller_id, sale_date,
            subtotal_cup, qr_discount_cup, total_cup, total_cost_cup, payment_method,
            cash_amount_cup, cash_tendered_cup, change_given_cup,
            transfermovil_amount_cup, enzona_amount_cup, electronic_ref, customer_phone, status, reconciled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETADA', 0)`
        )
        .run(
          receiptNumber,
          session.id,
          register.id,
          register.seller_id,
          today,
          subtotal,
          qrDiscount,
          total,
          totalCost,
          method,
          cashAmt,
          tendered,
          changeGiven,
          tmAmt,
          ezAmt,
          String(electronic_ref || '').trim(),
          String(customer_phone || '').trim()
        );
      const saleId = Number(saleRes.lastInsertRowid);

      const triggeredRestocks = [];

      for (const it of resolvedItems) {
        db.prepare(
          `INSERT INTO sale_items
           (sale_id, product_id, product_name, unit, quantity, unit_price_cup, unit_cost_cup, line_total_cup, line_cost_cup, is_price_capped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          saleId,
          it.prod.id,
          it.prod.name,
          it.prod.unit,
          it.qty,
          it.prod.sale_price_cup,
          it.prod.unit_cost_cup,
          it.lineTotal,
          it.lineCost,
          it.prod.is_price_capped
        );

        const newKiosk = roundCup(it.prod.kiosk_stock - it.qty);
        db.prepare(`UPDATE products SET kiosk_stock = ?, updated_at = datetime('now') WHERE id = ?`).run(
          newKiosk,
          it.prod.id
        );

        // Update live IPV automatically
        const snap = db
          .prepare(`SELECT id FROM shift_ipv_snapshots WHERE shift_session_id = ? AND product_id = ?`)
          .get(session.id, it.prod.id);
        if (snap) {
          db.prepare(
            `UPDATE shift_ipv_snapshots
             SET sold_qty = ROUND(sold_qty + ?, 2),
                 closing_qty = ROUND(closing_qty - ?, 2),
                 sold_amount_cup = ROUND(sold_amount_cup + ?, 2)
             WHERE id = ?`
          ).run(it.qty, it.qty, it.lineTotal, snap.id);
        }

        // Update Kardex SC-2-14 movement
        db.prepare(
          `INSERT INTO inventory_movements
           (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
            warehouse_balance_after, kiosk_balance_after, reason, shift_session_id, created_by)
           VALUES (?, 'VENTA', 'APLICADO', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          receiptNumber,
          it.prod.id,
          it.qty,
          it.prod.unit_cost_cup,
          it.lineCost,
          it.prod.warehouse_stock,
          newKiosk,
          `Venta Caja ${register.register_number} (${method})`,
          session.id,
          register.seller_id
        );

        // Run automatic restock trigger
        const rr = checkAndTriggerAutoRestock(db, it.prod.id);
        if (rr?.created) {
          triggeredRestocks.push({ product_name: it.prod.name, suggested_qty: rr.suggested_qty, unit: it.prod.unit });
        }
      }

      // Update seller's register running balances
      db.prepare(
        `UPDATE shift_registers
         SET expected_cash_cup = ROUND(expected_cash_cup + ?, 2),
             total_sales_cup = ROUND(total_sales_cup + ?, 2),
             cash_sales_cup = ROUND(cash_sales_cup + ?, 2),
             transfermovil_sales_cup = ROUND(transfermovil_sales_cup + ?, 2),
             enzona_sales_cup = ROUND(enzona_sales_cup + ?, 2),
             sales_count = sales_count + 1
         WHERE id = ?`
      ).run(cashAmt, total, cashAmt, tmAmt, ezAmt, register.id);

      // Post automatic NCIF accounting entry
      const qrAmt = roundCup(tmAmt + ezAmt);
      const journal = config.auto_accounting_enabled
        ? postJournalEntry(db, {
            entryDate: today,
            sourceType: 'VENTA',
            sourceRef: receiptNumber,
            description: `Venta ${receiptNumber} — Caja ${register.register_number} (${method}) + costo de venta`,
            createdBy: register.seller_id,
            lines: [
              ...(cashAmt > 0 ? [{ account: NCIF_ACCOUNTS.CAJA_GENERAL, debit: cashAmt }] : []),
              ...(qrAmt > 0 ? [{ account: NCIF_ACCOUNTS.COBROS_QR, debit: qrAmt }] : []),
              ...(qrDiscount > 0 ? [{ account: NCIF_ACCOUNTS.GASTOS_VENTAS, debit: qrDiscount }] : []),
              { account: NCIF_ACCOUNTS.COSTO_VENTAS, debit: totalCost },
              { account: NCIF_ACCOUNTS.INGRESOS_VENTAS, credit: subtotal },
              { account: NCIF_ACCOUNTS.INV_KIOSKO, credit: totalCost },
            ],
          })
        : null;

      const createdSale = db
        .prepare(
          `SELECT s.*, u.full_name AS seller_name, sr.register_number
           FROM sales s
           JOIN users u ON u.id = s.seller_id
           JOIN shift_registers sr ON sr.id = s.shift_register_id
           WHERE s.id = ?`
        )
        .get(saleId);
      const saleItems = db.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`).all(saleId);

      logAudit(
        db,
        req.user,
        'VENTA_POS',
        'Turnos y POS',
        `${receiptNumber} (Caja ${register.register_number}): ${total.toFixed(2)} CUP vía ${method}.`
      );

      return {
        sale: { ...createdSale, items: saleItems },
        journal_entry: journal?.entryNumber || null,
        triggered_restocks: triggeredRestocks,
      };
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Close & Cash Count (Arqueo de Caja por denominación de billetes CUP) for a seller's register.
 * Automatically posts NCIF shortage/surplus and generates BCC Res. 111/2023 deposit order when shift finishes.
 */
router.post('/registers/:id/close', requireAuth, requireRole('vendedor', 'jefe'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const regId = Number(req.params.id);
  const { denominations, counted_cash_cup, closing_notes, close_shift_if_last = true } = req.body || {};

  try {
    const out = runInTransaction(db, () => {
      const reg = db
        .prepare(
          `SELECT sr.*, u.full_name AS seller_name, ss.session_code, ss.work_date
           FROM shift_registers sr
           JOIN users u ON u.id = sr.seller_id
           JOIN shift_sessions ss ON ss.id = sr.shift_session_id
           WHERE sr.id = ?`
        )
        .get(regId);

      if (!reg) throw new Error('Caja de turno no encontrada.');
      if (reg.status !== 'ABIERTA') throw new Error('Esta caja ya fue arqueada y cerrada.');
      if (req.user.role === 'vendedor' && reg.seller_id !== req.user.id) {
        throw new Error('Por responsabilidad material, cada vendedor solo puede arquear su propia caja.');
      }

      let counted = 0;
      const cleanDenom = {};
      if (denominations && typeof denominations === 'object' && Object.keys(denominations).length > 0) {
        for (const bill of CUP_DENOMINATIONS) {
          const qty = Math.max(0, Math.floor(Number(denominations[bill] || 0)));
          if (qty > 0) {
            cleanDenom[bill] = qty;
            counted += bill * qty;
          }
        }
        if (Number(denominations.monedas) > 0) {
          cleanDenom.monedas = roundCup(denominations.monedas);
          counted = roundCup(counted + cleanDenom.monedas);
        }
      } else if (counted_cash_cup !== undefined) {
        counted = Math.max(0, roundCup(counted_cash_cup));
      } else {
        throw new Error('Ingrese el conteo de billetes CUP para realizar el arqueo de caja.');
      }

      const diff = roundCup(counted - reg.expected_cash_cup);

      db.prepare(
        `UPDATE shift_registers
         SET status = 'ARQUEADA',
             counted_cash_cup = ?,
             cash_difference_cup = ?,
             denominations_json = ?,
             closing_notes = ?,
             closed_at = datetime('now')
         WHERE id = ?`
      ).run(counted, diff, JSON.stringify(cleanDenom), String(closing_notes || '').trim(), regId);

      // Automated accounting for cash shortage (330 Responsabilidad Material) or surplus (950 Otros Ingresos)
      if (config.auto_accounting_enabled && Math.abs(diff) >= 0.5) {
        if (diff < 0) {
          const shortage = Math.abs(diff);
          postJournalEntry(db, {
            entryDate: getTodayIso(),
            sourceType: 'ARQUEO',
            sourceRef: `${reg.session_code}-C${reg.register_number}`,
            description: `Faltante en arqueo Caja ${reg.register_number} (${reg.seller_name}) — Responsabilidad material`,
            createdBy: req.user.id,
            lines: [
              { account: NCIF_ACCOUNTS.FALTANTES, debit: shortage },
              { account: NCIF_ACCOUNTS.CAJA_GENERAL, credit: shortage },
            ],
          });
          logAutomation(
            db,
            'TURNO',
            'ALERTA',
            `Faltante detectado en Caja ${reg.register_number}: -${shortage.toFixed(2)} CUP`,
            `Vendedor ${reg.seller_name} (${reg.session_code}). Contabilizado en Cuenta 330 Faltantes en Investigación para revisión del Económico y Jefe.`,
            reg.session_code
          );
        } else {
          postJournalEntry(db, {
            entryDate: getTodayIso(),
            sourceType: 'ARQUEO',
            sourceRef: `${reg.session_code}-C${reg.register_number}`,
            description: `Sobrante en arqueo Caja ${reg.register_number} (${reg.seller_name})`,
            createdBy: req.user.id,
            lines: [
              { account: NCIF_ACCOUNTS.CAJA_GENERAL, debit: diff },
              { account: NCIF_ACCOUNTS.OTROS_INGRESOS, credit: diff },
            ],
          });
        }
      }

      // Check if all registers in shift are now closed -> auto-close session & create BCC deposit order!
      const stillOpen = db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM shift_registers WHERE shift_session_id = ? AND status = 'ABIERTA'`
        )
        .get(reg.shift_session_id).cnt;

      let shiftClosed = false;
      let autoDeposit = null;

      if (stillOpen === 0 && close_shift_if_last) {
        db.prepare(
          `UPDATE shift_sessions SET status = 'CERRADO', closed_at = datetime('now') WHERE id = ?`
        ).run(reg.shift_session_id);
        shiftClosed = true;

        // Calculate net cash collected across all registers above opening petty cash fund
        const allRegs = db
          .prepare(`SELECT * FROM shift_registers WHERE shift_session_id = ?`)
          .all(reg.shift_session_id);
        const netCashToDeposit = roundCup(
          allRegs.reduce((acc, r) => acc + Math.max(0, (r.counted_cash_cup || 0) - r.opening_cash_cup), 0)
        );

        if (config.auto_deposit_order_enabled && netCashToDeposit > 0) {
          const orderNum = nextDocCode(db, 'bank_deposits', 'order_number', 'DEP', 4);
          const dueDate = getNextBusinessDayIso(reg.work_date);
          db.prepare(
            `INSERT INTO bank_deposits
             (order_number, origin, shift_session_id, amount_cup, due_date, status, notes, created_by)
             VALUES (?, 'AUTOMATICO', ?, ?, ?, 'PENDIENTE', ?, ?)`
          ).run(
            orderNum,
            reg.shift_session_id,
            netCashToDeposit,
            dueDate,
            `Efectivo neto recaudado en ${reg.session_code} (manteniendo fondo fijo de cambio). Depositar en ${config.bank_name} antes del ${dueDate} (Res. 111/2023 BCC).`,
            req.user.id
          );
          autoDeposit = { order_number: orderNum, amount_cup: netCashToDeposit, due_date: dueDate };

          logAutomation(
            db,
            'BANCARIZACION',
            'INFO',
            `Orden de depósito ${orderNum} creada al cerrar turno`,
            `${netCashToDeposit.toFixed(2)} CUP listos para depositar en Cuenta Fiscal ${config.bank_name} antes del ${dueDate} (Res. 111/2023 BCC).`,
            orderNum
          );
        }
      }

      logAudit(
        db,
        req.user,
        'ARQUEO_CIERRE_CAJA',
        'Turnos y POS',
        `Cerrada Caja ${reg.register_number} (${reg.session_code}): Esperado ${reg.expected_cash_cup.toFixed(
          2
        )} CUP, Contado ${counted.toFixed(2)} CUP, Dif. ${diff.toFixed(2)} CUP.`
      );

      return {
        register_number: reg.register_number,
        expected_cash_cup: reg.expected_cash_cup,
        counted_cash_cup: counted,
        cash_difference_cup: diff,
        shift_closed: shiftClosed,
        auto_deposit: autoDeposit,
      };
    });

    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Registra una Entrada o Salida operativa de efectivo en una caja abierta (cambio, gasto menor autorizado, aporte de fondo).
 */
router.post('/registers/:id/cash-movement', requireAuth, (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const reg = db
    .prepare(
      `SELECT sr.*, ss.session_code, ss.status AS shift_status, u.full_name AS seller_name
       FROM shift_registers sr
       JOIN shift_sessions ss ON ss.id = sr.shift_session_id
       JOIN users u ON u.id = sr.seller_id
       WHERE sr.id = ?`
    )
    .get(id);

  if (!reg) return res.status(404).json({ error: 'Caja de turno no encontrada.' });
  if (reg.status !== 'ABIERTA' || reg.shift_status !== 'ABIERTO') {
    return res.status(400).json({ error: 'Solo se admiten movimientos de efectivo en una caja abierta.' });
  }

  const isOwner = req.user.role === 'jefe';
  const canCashFlag = Boolean(req.user.permissions_matrix?.flags?.cash_movements);
  const canApproveShift = Boolean(req.user.permissions_matrix?.items?.['shift-ipv']?.canApprove);
  if (!isOwner && !canApproveShift) {
    if (!canCashFlag || reg.seller_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: 'Solo el cajero titular con permiso o el Jefe pueden registrar entradas/salidas en esta caja.' });
    }
  }

  const type = String(req.body?.type || '').toUpperCase();
  const amount = roundCup(req.body?.amount_cup);
  const reason = String(req.body?.reason || '').trim();

  if (!['ENTRADA', 'SALIDA'].includes(type)) {
    return res.status(400).json({ error: 'Seleccione tipo de movimiento: ENTRADA o SALIDA.' });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Ingrese un importe en CUP mayor que cero.' });
  }
  if (reason.length < 4) {
    return res.status(400).json({ error: 'Indique el motivo de la entrada o salida de caja (mín. 4 caracteres).' });
  }
  if (type === 'SALIDA' && amount > reg.expected_cash_cup + 0.01) {
    return res.status(400).json({
      error: `Efectivo insuficiente en Caja #${reg.register_number} (disponible ${reg.expected_cash_cup.toFixed(2)} CUP).`,
    });
  }

  const delta = type === 'ENTRADA' ? amount : -amount;
  const nextExpected = roundCup(reg.expected_cash_cup + delta);

  const movId = runInTransaction(db, () => {
    const r = db
      .prepare(
        `INSERT INTO cash_movements (shift_session_id, shift_register_id, type, amount_cup, reason, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(reg.shift_session_id, reg.id, type, amount, reason, req.user.id);

    db.prepare(`UPDATE shift_registers SET expected_cash_cup = ? WHERE id = ?`).run(nextExpected, reg.id);

    logAudit(
      db,
      req.user,
      type === 'ENTRADA' ? 'ENTRADA_CAJA' : 'SALIDA_CAJA',
      'Turnos, Cajas e IPV',
      `${type} de ${amount.toFixed(2)} CUP en Caja #${reg.register_number} (${reg.session_code}): ${reason}. Efectivo esperado: ${nextExpected.toFixed(2)} CUP.`
    );
    return Number(r.lastInsertRowid);
  });

  res.status(201).json({
    id: movId,
    type,
    amount_cup: amount,
    expected_cash_cup: nextExpected,
    active: loadSessionBundle(db, reg.shift_session_id),
  });
});

/**
 * Económico or Jefe audits and validates a closed shift session.
 */
router.post('/shifts/:id/audit', requireAuth, requirePermission('shift-ipv', 'canApprove'), (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const session = db.prepare(`SELECT * FROM shift_sessions WHERE id = ?`).get(id);
  if (!session) return res.status(404).json({ error: 'Turno no encontrado.' });
  if (session.status === 'ABIERTO') {
    return res.status(400).json({ error: 'Los 2 vendedores deben cerrar sus cajas antes de auditar el turno.' });
  }

  runInTransaction(db, () => {
    db.prepare(
      `UPDATE shift_sessions
       SET status = 'AUDITADO', audited_by = ?, audited_at = datetime('now'),
           notes = CASE WHEN ? != '' THEN ? ELSE notes END
       WHERE id = ?`
    ).run(req.user.id, String(req.body?.notes || '').trim(), String(req.body?.notes || '').trim(), id);

    db.prepare(
      `UPDATE shift_registers
       SET status = 'VALIDADA', validated_by = ?, validated_at = datetime('now')
       WHERE shift_session_id = ?`
    ).run(req.user.id, id);

    logAudit(
      db,
      req.user,
      'AUDITORIA_TURNO',
      'Economía',
      `Validado IPV y arqueos de las cajas del turno ${session.session_code}.`
    );
  });

  res.json({ ok: true, session_code: session.session_code });
});

export default router;
