import { roundCup, runInTransaction } from './db.js';
import { hashPassword, logAudit, logAutomation } from './auth.js';
import {
  NCIF_ACCOUNTS,
  checkAndTriggerAutoRestock,
  getNextBusinessDayIso,
  getTodayIso,
  postJournalEntry,
} from './cubanLawEngine.js';

export function seedIfEmpty(db) {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM business_config').get();
  if (Number(row?.cnt || 0) > 0) return false;
  seedDemoData(db);
  return true;
}

export function resetAllData(db, mode = 'demo') {
  const tables = [
    'audit_logs',
    'automation_events',
    'price_change_requests',
    'tax_filings',
    'payroll_items',
    'payroll_runs',
    'journal_lines',
    'journal_entries',
    'expenses',
    'bank_deposits',
    'sale_items',
    'sales',
    'restock_requests',
    'inventory_movements',
    'shift_ipv_snapshots',
    'shift_registers',
    'shift_sessions',
    'products',
    'users',
    'shift_templates',
    'business_config',
  ];
  runInTransaction(db, () => {
    db.exec('PRAGMA foreign_keys = OFF;');
    for (const t of tables) {
      db.exec(`DELETE FROM ${t};`);
    }
    db.exec(`DELETE FROM sqlite_sequence;`);
    db.exec('PRAGMA foreign_keys = ON;');
  });

  if (mode === 'demo') {
    seedDemoData(db);
  } else {
    seedCleanProductionData(db);
  }
}

function insertBaseConfigAndStaff(db) {
  db.prepare(
    `INSERT INTO business_config (
      id, business_name, legal_form, nit, reeup_code, municipality, province, address,
      activity_description, bank_name, fiscal_account_cup, fiscal_account_titular,
      transfermovil_phone, transfermovil_merchant_code, enzona_merchant_code, qr_discount_pct,
      social_capital_cup, legal_reserve_balance_cup, petty_cash_fund_cup,
      max_cash_provider_payment_cup, max_vault_cash_before_deposit_cup,
      max_sellers_per_shift, min_wage_cup,
      sales_tax_pct, local_dev_tax_pct, labor_force_tax_pct, employer_ss_pct, worker_ss_pct,
      vacation_provision_pct, profit_tax_pct, legal_reserve_pct, iip_exempt_monthly_cup,
      max_regulated_margin_pct, indirect_cost_alloc_pct,
      auto_restock_enabled, auto_accounting_enabled, auto_deposit_order_enabled,
      strict_price_cap_block, strict_bancarizacion_block
    ) VALUES (
      1, 'Kiosko La Ceiba S.U.R.L.', 'MIPYME', '50004182937', '542.0.11842',
      'Plaza de la Revolución', 'La Habana', 'Calle 23 #814 e/ A y B, Vedado',
      'Comercio minorista de alimentos, bebidas, aseo y productos básicos en kiosko (CNAE 4711)',
      'Banco Metropolitano (BANMET)', '0598742001384912', 'Kiosko La Ceiba S.U.R.L.',
      '+53 53841920', 'TM-HAB-48291', 'EZ-KLC-90314', 2.0,
      250000, 18000, 3000,
      5000, 8000,
      2, 2100,
      10.0, 1.0, 5.0, 14.0, 5.0,
      9.09, 35.0, 10.0, 3260,
      30.0, 8.0,
      1, 1, 1,
      1, 1
    )`
  ).run();

  const shiftMorning = db
    .prepare(
      `INSERT INTO shift_templates (code, name, start_time, end_time, required_sellers, active)
       VALUES ('MANANA', 'Turno Mañana', '07:00', '15:00', 2, 1)`
    )
    .run();
  const shiftAfternoon = db
    .prepare(
      `INSERT INTO shift_templates (code, name, start_time, end_time, required_sellers, active)
       VALUES ('TARDE', 'Turno Tarde', '15:00', '23:00', 2, 1)`
    )
    .run();

  const mId = Number(shiftMorning.lastInsertRowid);
  const tId = Number(shiftAfternoon.lastInsertRowid);
  const pw = hashPassword('kiosko2026');

  const insertUser = db.prepare(
    `INSERT INTO users
     (username, password_hash, full_name, ci, nit_personal, role, shift_template_id, default_register,
      contract_type, contract_date, base_salary_cup, sales_commission_pct, phone, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );

  const jefeId = Number(
    insertUser.run(
      'jefe',
      pw,
      'Alejandro Morales Pérez',
      '82041512489',
      '82041512489',
      'jefe',
      null,
      null,
      'Socio Administrador',
      '2025-02-01',
      14500,
      0,
      '+53 53841920'
    ).lastInsertRowid
  );
  const ecoId = Number(
    insertUser.run(
      'economico',
      pw,
      'Beatriz Domínguez Ruiz',
      '87092218342',
      '87092218342',
      'economico',
      null,
      null,
      'Indeterminado',
      '2025-02-01',
      11500,
      0,
      '+53 52910433'
    ).lastInsertRowid
  );
  const almId = Number(
    insertUser.run(
      'almacenero',
      pw,
      'Carlos Enrique Vega',
      '90031124510',
      '90031124510',
      'almacenero',
      null,
      null,
      'Indeterminado',
      '2025-02-10',
      8800,
      0,
      '+53 54128891'
    ).lastInsertRowid
  );
  const vend1Id = Number(
    insertUser.run(
      'vendedor1',
      pw,
      'Dayana Torres Castellanos',
      '96071831204',
      '96071831204',
      'vendedor',
      mId,
      1,
      'Indeterminado',
      '2025-02-15',
      7200,
      1.2,
      '+53 58102344'
    ).lastInsertRowid
  );
  const vend2Id = Number(
    insertUser.run(
      'vendedor2',
      pw,
      'Ernesto Valdés Mena',
      '94110528719',
      '94110528719',
      'vendedor',
      mId,
      2,
      'Indeterminado',
      '2025-02-15',
      7200,
      1.2,
      '+53 55739012'
    ).lastInsertRowid
  );
  const vend3Id = Number(
    insertUser.run(
      'vendedor3',
      pw,
      'Yaima Hernández Soto',
      '98022419638',
      '98022419638',
      'vendedor',
      tId,
      1,
      'Indeterminado',
      '2025-03-01',
      7200,
      1.2,
      '+53 59041182'
    ).lastInsertRowid
  );
  const vend4Id = Number(
    insertUser.run(
      'vendedor4',
      pw,
      'Luis Alberto Cabrera',
      '93081914527',
      '93081914527',
      'vendedor',
      tId,
      2,
      'Indeterminado',
      '2025-03-01',
      7200,
      1.2,
      '+53 53661209'
    ).lastInsertRowid
  );

  return { mId, tId, jefeId, ecoId, almId, vend1Id, vend2Id, vend3Id, vend4Id };
}

function seedCleanProductionData(db) {
  runInTransaction(db, () => {
    const { jefeId } = insertBaseConfigAndStaff(db);
    postJournalEntry(db, {
      entryDate: getTodayIso(),
      sourceType: 'APERTURA',
      sourceRef: 'ACTA-001',
      description: 'Apertura contable inicial — Capital Social en Cuenta Bancaria Fiscal y Caja',
      createdBy: jefeId,
      silent: true,
      lines: [
        { account: NCIF_ACCOUNTS.BANCO_FISCAL, debit: 244000 },
        { account: NCIF_ACCOUNTS.CAJA_CHICA, debit: 6000 },
        { account: NCIF_ACCOUNTS.CAPITAL_SOCIAL, credit: 250000 },
      ],
    });
    logAudit(
      db,
      { id: jefeId, full_name: 'Alejandro Morales Pérez', role: 'jefe' },
      'REINICIO_PRODUCCION',
      'Sistema',
      'Base de datos inicializada en limpio con plantilla base y cuentas NCIF.'
    );
  });
}

export function seedDemoData(db) {
  runInTransaction(db, () => {
    const today = getTodayIso();
    const yesterdayDate = new Date(`${today}T12:00:00Z`);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);

    const futureDate = (days) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };

    const { mId, tId, jefeId, ecoId, almId, vend1Id, vend2Id, vend3Id, vend4Id } =
      insertBaseConfigAndStaff(db);

    // 1. Opening capital journal entry (Social Capital 250,000 + Legal Reserve 18,000 = 268,000)
    postJournalEntry(db, {
      entryDate: yesterday,
      sourceType: 'APERTURA',
      sourceRef: 'ESC-0142',
      description: 'Saldos iniciales — Cuenta Bancaria Fiscal BANMET, Fondo de Caja y Reserva Legal',
      createdBy: ecoId,
      silent: true,
      lines: [
        { account: NCIF_ACCOUNTS.BANCO_FISCAL, debit: 256000 },
        { account: NCIF_ACCOUNTS.CAJA_CHICA, debit: 6000 },
        { account: NCIF_ACCOUNTS.CAJA_GENERAL, debit: 6000 },
        { account: NCIF_ACCOUNTS.CAPITAL_SOCIAL, credit: 250000 },
        { account: NCIF_ACCOUNTS.RESERVA_LEGAL, credit: 18000 },
      ],
    });

    // 2. Catalog of 14 authentic Cuban kiosk products (including the 6 Res. 225/2024 MFP capped staples)
    const catalog = [
      // 6 Capped staples under Res. 225/2024 MFP
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
        wh: 42,
        kiosk: 18,
        whMin: 20,
        kMin: 8,
        kTarget: 24,
        batch: 'LT-POL-11A',
        exp: futureDate(65),
      },
      {
        sku: 'BAS-002',
        name: 'Aceite vegetal de soya 1L',
        category: 'Básicos Regulados',
        unit: 'L',
        cost: 740,
        price: 980,
        capped: 1,
        cap: 990,
        res: 'Res. 225/2024 MFP',
        wh: 36,
        kiosk: 10,
        whMin: 15,
        kMin: 8,
        kTarget: 22,
        batch: 'LT-ACE-09C',
        exp: futureDate(180),
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
        wh: 18,
        kiosk: 7,
        whMin: 8,
        kMin: 5,
        kTarget: 12,
        batch: 'LT-LEC-10B',
        exp: futureDate(120),
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
        wh: 30,
        kiosk: 16,
        whMin: 12,
        kMin: 6,
        kTarget: 20,
        batch: 'LT-PAS-08F',
        exp: futureDate(240),
      },
      {
        sku: 'BAS-005',
        name: 'Salchichas de pollo (1 kg)',
        category: 'Básicos Regulados',
        unit: 'kg',
        cost: 760,
        price: 1020,
        capped: 1,
        cap: 1045,
        res: 'Res. 225/2024 MFP',
        wh: 22,
        kiosk: 9,
        whMin: 10,
        kMin: 6,
        kTarget: 16,
        batch: 'LT-SAL-11D',
        exp: futureDate(12), // Expiring in 12 days -> FEFO alert!
      },
      {
        sku: 'BAS-006',
        name: 'Detergente en polvo multiuso 1 kg',
        category: 'Básicos Regulados',
        unit: 'kg',
        cost: 460,
        price: 620,
        capped: 1,
        cap: 630,
        res: 'Res. 225/2024 MFP',
        wh: 35,
        kiosk: 15,
        whMin: 12,
        kMin: 6,
        kTarget: 20,
        batch: 'LT-DET-07M',
        exp: futureDate(365),
      },
      // Non-capped everyday kiosk goods (still regulated by 30% max margin over full cost)
      {
        sku: 'ALI-007',
        name: 'Arroz blanco grano largo 1 kg',
        category: 'Alimentos y Conservas',
        unit: 'kg',
        cost: 340,
        price: 460,
        capped: 0,
        cap: null,
        res: '',
        wh: 55,
        kiosk: 25,
        whMin: 20,
        kMin: 10,
        kTarget: 30,
        batch: 'LT-ARR-11K',
        exp: futureDate(210),
      },
      {
        sku: 'ALI-008',
        name: 'Frijol negro seleccionado 1 kg',
        category: 'Alimentos y Conservas',
        unit: 'kg',
        cost: 520,
        price: 700,
        capped: 0,
        cap: null,
        res: '',
        wh: 28,
        kiosk: 14,
        whMin: 12,
        kMin: 6,
        kTarget: 18,
        batch: 'LT-FRI-10P',
        exp: futureDate(190),
      },
      {
        sku: 'ALI-009',
        name: 'Puré de tomate condimentado 400g',
        category: 'Alimentos y Conservas',
        unit: 'u',
        cost: 260,
        price: 350,
        capped: 0,
        cap: null,
        res: '',
        wh: 32,
        kiosk: 14,
        whMin: 10,
        kMin: 6,
        kTarget: 18,
        batch: 'LT-TOM-09R',
        exp: futureDate(150),
      },
      {
        sku: 'BEB-010',
        name: 'Malta Bucanero lata 355 ml',
        category: 'Bebidas y Refrescos',
        unit: 'u',
        cost: 210,
        price: 285,
        capped: 0,
        cap: null,
        res: '',
        wh: 72,
        kiosk: 11,
        whMin: 24,
        kMin: 10,
        kTarget: 36,
        batch: 'LT-MAL-11B',
        exp: futureDate(140),
      },
      {
        sku: 'BEB-011',
        name: 'Refresco de Cola Ciego Montero 1.5L',
        category: 'Bebidas y Refrescos',
        unit: 'u',
        cost: 270,
        price: 365,
        capped: 0,
        cap: null,
        res: '',
        wh: 40,
        kiosk: 18,
        whMin: 15,
        kMin: 8,
        kTarget: 24,
        batch: 'LT-REF-11E',
        exp: futureDate(95),
      },
      {
        sku: 'BEB-012',
        name: 'Jugo de Mango La Estancia 1L',
        category: 'Bebidas y Refrescos',
        unit: 'u',
        cost: 310,
        price: 420,
        capped: 0,
        cap: null,
        res: '',
        wh: 26,
        kiosk: 12,
        whMin: 10,
        kMin: 6,
        kTarget: 18,
        batch: 'LT-JUG-10V',
        exp: futureDate(110),
      },
      {
        sku: 'CON-013',
        name: 'Galletas dulces rellenas (paq. 250g)',
        category: 'Confituras y Panadería',
        unit: 'paq',
        cost: 195,
        price: 265,
        capped: 0,
        cap: null,
        res: '',
        wh: 48,
        kiosk: 22,
        whMin: 15,
        kMin: 8,
        kTarget: 28,
        batch: 'LT-GAL-11S',
        exp: futureDate(85),
      },
      {
        sku: 'ASE-014',
        name: 'Jabón de tocador Suchel 110g',
        category: 'Aseo y Hogar',
        unit: 'u',
        cost: 135,
        price: 185,
        capped: 0,
        cap: null,
        res: '',
        wh: 50,
        kiosk: 20,
        whMin: 15,
        kMin: 8,
        kTarget: 25,
        batch: 'LT-JAB-08Z',
        exp: futureDate(400),
      },
    ];

    const insertProduct = db.prepare(
      `INSERT INTO products
       (sku, name, category, unit, unit_cost_cup, indirect_cost_pct, sale_price_cup,
        is_price_capped, price_cap_cup, price_cap_resolution, is_margin_regulated, sales_tax_exempt,
        warehouse_stock, kiosk_stock, warehouse_min_stock, kiosk_min_stock, kiosk_target_stock,
        current_batch, next_expiry_date, active)
       VALUES (?, ?, ?, ?, ?, 8.0, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, 1)`
    );

    const insertMov = db.prepare(
      `INSERT INTO inventory_movements
       (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
        warehouse_balance_after, kiosk_balance_after, supplier_name, supplier_nit, invoice_number,
        payment_method, payment_ref, batch_code, expiry_date, reason, created_by, approved_by, created_at)
       VALUES (?, ?, 'APLICADO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const productIds = {};
    let totalWarehouseValue = 0;
    let totalKioskValue = 0;
    let movIdx = 1;

    for (const item of catalog) {
      const pid = Number(
        insertProduct.run(
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
          item.batch,
          item.exp
        ).lastInsertRowid
      );
      productIds[item.sku] = { id: pid, ...item };

      const totalQty = item.wh + item.kiosk;
      const recCost = roundCup(totalQty * item.cost);
      const trfCost = roundCup(item.kiosk * item.cost);
      totalWarehouseValue = roundCup(totalWarehouseValue + item.wh * item.cost);
      totalKioskValue = roundCup(totalKioskValue + trfCost);

      // SC-2-04 supplier receipt (paid via bank transfer per Res. 111/2023 BCC)
      insertMov.run(
        `SC204-${String(movIdx).padStart(4, '0')}`,
        'RECEPCION',
        pid,
        totalQty,
        item.cost,
        recCost,
        totalQty,
        0,
        item.capped ? 'Comercializadora Mayorista Alimentos Habana' : 'Distribuidora Caribe S.R.L.',
        item.capped ? '30001849201' : '50002918440',
        `FAC-2026-${1100 + movIdx}`,
        'TRANSFERENCIA',
        `BM-TRF-884${String(movIdx).padStart(2, '0')}`,
        item.batch,
        item.exp,
        'Abastecimiento quincenal según contrato económico',
        almId,
        ecoId,
        `${yesterday} 08:00:00`
      );

      // SC-2-09 transfer to sales floor
      insertMov.run(
        `SC209-${String(movIdx).padStart(4, '0')}`,
        'TRANSFERENCIA_KIOSKO',
        pid,
        item.kiosk,
        item.cost,
        trfCost,
        item.wh,
        item.kiosk,
        '',
        '',
        '',
        '',
        '',
        item.batch,
        item.exp,
        'Habilitación inicial de mostrador del kiosko',
        almId,
        almId,
        `${yesterday} 09:00:00`
      );
      movIdx += 1;
    }

    const totalInitialInv = roundCup(totalWarehouseValue + totalKioskValue);
    // Pay 200,000 by bank transfer and rest on supplier short-term credit so bank stays healthy
    const paidFromBank = Math.min(185000, totalInitialInv);
    const creditSuppliers = roundCup(totalInitialInv - paidFromBank);

    postJournalEntry(db, {
      entryDate: yesterday,
      sourceType: 'RECEPCION',
      sourceRef: 'SC204-LOTE01',
      description: 'Recepción mayorista de mercancías (SC-2-04) — Pago bancarizado Res. 111/2023 BCC',
      createdBy: almId,
      silent: true,
      lines: [
        { account: NCIF_ACCOUNTS.INV_ALMACEN, debit: totalInitialInv },
        { account: NCIF_ACCOUNTS.BANCO_FISCAL, credit: paidFromBank },
        ...(creditSuppliers > 0 ? [{ account: NCIF_ACCOUNTS.PROVEEDORES, credit: creditSuppliers }] : []),
      ],
    });

    postJournalEntry(db, {
      entryDate: yesterday,
      sourceType: 'TRANSFERENCIA',
      sourceRef: 'SC209-LOTE01',
      description: 'Despacho de mercancías de Almacén Central al Mostrador del Kiosko (SC-2-09)',
      createdBy: almId,
      silent: true,
      lines: [
        { account: NCIF_ACCOUNTS.INV_KIOSKO, debit: totalKioskValue },
        { account: NCIF_ACCOUNTS.INV_ALMACEN, credit: totalKioskValue },
      ],
    });

    // Helper to record a realistic completed sale inside a shift & register
    let ticketCounter = 1;
    const recordSeedSale = ({
      sessionId,
      registerId,
      sellerId,
      saleDate,
      createdAt,
      items,
      paymentMethod,
      electronicRef = '',
      customerPhone = '',
      cashPart = 0,
      reconciled = 0,
    }) => {
      let subtotal = 0;
      let totalCost = 0;
      const builtItems = items.map(({ sku, qty }) => {
        const prod = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
        const lineTotal = roundCup(prod.sale_price_cup * qty);
        const lineCost = roundCup(prod.unit_cost_cup * qty);
        subtotal = roundCup(subtotal + lineTotal);
        totalCost = roundCup(totalCost + lineCost);
        return { prod, qty, lineTotal, lineCost };
      });

      const isPureQr = paymentMethod === 'TRANSFERMOVIL' || paymentMethod === 'ENZONA';
      const qrDiscount = isPureQr ? roundCup(subtotal * 0.02) : 0;
      const total = roundCup(subtotal - qrDiscount);

      let cashAmt = 0;
      let tmAmt = 0;
      let ezAmt = 0;
      if (paymentMethod === 'EFECTIVO') {
        cashAmt = total;
      } else if (paymentMethod === 'TRANSFERMOVIL') {
        tmAmt = total;
      } else if (paymentMethod === 'ENZONA') {
        ezAmt = total;
      } else if (paymentMethod === 'MIXTO') {
        cashAmt = roundCup(cashPart);
        tmAmt = roundCup(total - cashAmt);
      }

      const receipt = `TK-${String(ticketCounter++).padStart(5, '0')}`;
      const sRes = db
        .prepare(
          `INSERT INTO sales
           (receipt_number, shift_session_id, shift_register_id, seller_id, sale_date,
            subtotal_cup, qr_discount_cup, total_cup, total_cost_cup, payment_method,
            cash_amount_cup, cash_tendered_cup, change_given_cup,
            transfermovil_amount_cup, enzona_amount_cup, electronic_ref, customer_phone,
            status, reconciled, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'COMPLETADA', ?, ?)`
        )
        .run(
          receipt,
          sessionId,
          registerId,
          sellerId,
          saleDate,
          subtotal,
          qrDiscount,
          total,
          totalCost,
          paymentMethod,
          cashAmt,
          cashAmt,
          tmAmt,
          ezAmt,
          electronicRef,
          customerPhone,
          reconciled,
          createdAt
        );
      const saleId = Number(sRes.lastInsertRowid);

      for (const bi of builtItems) {
        db.prepare(
          `INSERT INTO sale_items
           (sale_id, product_id, product_name, unit, quantity, unit_price_cup, unit_cost_cup, line_total_cup, line_cost_cup, is_price_capped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          saleId,
          bi.prod.id,
          bi.prod.name,
          bi.prod.unit,
          bi.qty,
          bi.prod.sale_price_cup,
          bi.prod.unit_cost_cup,
          bi.lineTotal,
          bi.lineCost,
          bi.prod.is_price_capped
        );

        const newKiosk = roundCup(bi.prod.kiosk_stock - bi.qty);
        db.prepare(`UPDATE products SET kiosk_stock = ?, updated_at = ? WHERE id = ?`).run(
          newKiosk,
          createdAt,
          bi.prod.id
        );

        db.prepare(
          `UPDATE shift_ipv_snapshots
           SET sold_qty = ROUND(sold_qty + ?, 2),
               closing_qty = ROUND(closing_qty - ?, 2),
               sold_amount_cup = ROUND(sold_amount_cup + ?, 2)
           WHERE shift_session_id = ? AND product_id = ?`
        ).run(bi.qty, bi.qty, bi.lineTotal, sessionId, bi.prod.id);

        db.prepare(
          `INSERT INTO inventory_movements
           (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
            warehouse_balance_after, kiosk_balance_after, reason, shift_session_id, created_by, created_at)
           VALUES (?, 'VENTA', 'APLICADO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          receipt,
          bi.prod.id,
          bi.qty,
          bi.prod.unit_cost_cup,
          bi.lineCost,
          bi.prod.warehouse_stock,
          newKiosk,
          `Venta minorista ${paymentMethod}`,
          sessionId,
          sellerId,
          createdAt
        );
      }

      db.prepare(
        `UPDATE shift_registers
         SET expected_cash_cup = ROUND(expected_cash_cup + ?, 2),
             total_sales_cup = ROUND(total_sales_cup + ?, 2),
             cash_sales_cup = ROUND(cash_sales_cup + ?, 2),
             transfermovil_sales_cup = ROUND(transfermovil_sales_cup + ?, 2),
             enzona_sales_cup = ROUND(enzona_sales_cup + ?, 2),
             sales_count = sales_count + 1
         WHERE id = ?`
      ).run(cashAmt, total, cashAmt, tmAmt, ezAmt, registerId);

      // Automated NCIF accounting entry
      const qrTotal = roundCup(tmAmt + ezAmt);
      postJournalEntry(db, {
        entryDate: saleDate,
        sourceType: 'VENTA',
        sourceRef: receipt,
        description: `Venta ${receipt} (${paymentMethod}) y descarga automática de costo`,
        createdBy: sellerId,
        silent: true,
        lines: [
          ...(cashAmt > 0 ? [{ account: NCIF_ACCOUNTS.CAJA_GENERAL, debit: cashAmt }] : []),
          ...(qrTotal > 0
            ? [
                {
                  account: reconciled ? NCIF_ACCOUNTS.BANCO_FISCAL : NCIF_ACCOUNTS.COBROS_QR,
                  debit: qrTotal,
                },
              ]
            : []),
          ...(qrDiscount > 0 ? [{ account: NCIF_ACCOUNTS.GASTOS_VENTAS, debit: qrDiscount }] : []),
          { account: NCIF_ACCOUNTS.COSTO_VENTAS, debit: totalCost },
          { account: NCIF_ACCOUNTS.INGRESOS_VENTAS, credit: subtotal },
          { account: NCIF_ACCOUNTS.INV_KIOSKO, credit: totalCost },
        ],
      });

      return { total, cashAmt, tmAmt, ezAmt, receipt };
    };

    const createIpvSnapshot = (sessionId) => {
      const allProds = db.prepare('SELECT * FROM products WHERE active = 1').all();
      const ins = db.prepare(
        `INSERT INTO shift_ipv_snapshots
         (shift_session_id, product_id, opening_qty, entries_qty, losses_qty, sold_qty, closing_qty, sale_price_cup, sold_amount_cup)
         VALUES (?, ?, ?, 0, 0, 0, ?, ?, 0)`
      );
      for (const p of allProds) {
        ins.run(sessionId, p.id, p.kiosk_stock, p.kiosk_stock, p.sale_price_cup);
      }
    };

    // 3. Yesterday's afternoon shift (Closed & Audited — Yaima & Luis Alberto)
    const ySession = Number(
      db
        .prepare(
          `INSERT INTO shift_sessions (session_code, shift_template_id, work_date, status, opened_at, closed_at, opened_by, audited_by, audited_at, notes)
           VALUES (?, ?, ?, 'AUDITADO', ?, ?, ?, ?, ?, 'Turno Tarde cerrado sin diferencias en arqueo.')`
        )
        .run(
          `TRN-${yesterday.replace(/-/g, '')}-T`,
          tId,
          yesterday,
          `${yesterday} 15:00:00`,
          `${yesterday} 22:55:00`,
          vend3Id,
          ecoId,
          `${yesterday} 23:10:00`
        ).lastInsertRowid
    );
    createIpvSnapshot(ySession);

    const yReg1 = Number(
      db
        .prepare(
          `INSERT INTO shift_registers (shift_session_id, register_number, seller_id, status, opening_cash_cup, expected_cash_cup, opened_at)
           VALUES (?, 1, ?, 'VALIDADA', 3000, 3000, ?)`
        )
        .run(ySession, vend3Id, `${yesterday} 15:00:00`).lastInsertRowid
    );
    const yReg2 = Number(
      db
        .prepare(
          `INSERT INTO shift_registers (shift_session_id, register_number, seller_id, status, opening_cash_cup, expected_cash_cup, opened_at)
           VALUES (?, 2, ?, 'VALIDADA', 3000, 3000, ?)`
        )
        .run(ySession, vend4Id, `${yesterday} 15:02:00`).lastInsertRowid
    );

    recordSeedSale({
      sessionId: ySession,
      registerId: yReg1,
      sellerId: vend3Id,
      saleDate: yesterday,
      createdAt: `${yesterday} 16:18:00`,
      items: [
        { sku: 'BAS-001', qty: 3 },
        { sku: 'BAS-002', qty: 2 },
        { sku: 'ALI-007', qty: 4 },
      ],
      paymentMethod: 'TRANSFERMOVIL',
      electronicRef: 'TM94820114',
      customerPhone: '53194820',
      reconciled: 1,
    });
    recordSeedSale({
      sessionId: ySession,
      registerId: yReg1,
      sellerId: vend3Id,
      saleDate: yesterday,
      createdAt: `${yesterday} 18:40:00`,
      items: [
        { sku: 'BAS-003', qty: 2 },
        { sku: 'BAS-004', qty: 3 },
        { sku: 'CON-013', qty: 4 },
      ],
      paymentMethod: 'EFECTIVO',
    });
    recordSeedSale({
      sessionId: ySession,
      registerId: yReg2,
      sellerId: vend4Id,
      saleDate: yesterday,
      createdAt: `${yesterday} 17:12:00`,
      items: [
        { sku: 'BAS-005', qty: 2 },
        { sku: 'ALI-008', qty: 3 },
        { sku: 'BEB-011', qty: 4 },
      ],
      paymentMethod: 'EFECTIVO',
    });
    recordSeedSale({
      sessionId: ySession,
      registerId: yReg2,
      sellerId: vend4Id,
      saleDate: yesterday,
      createdAt: `${yesterday} 20:05:00`,
      items: [
        { sku: 'BAS-006', qty: 3 },
        { sku: 'BEB-012', qty: 3 },
        { sku: 'ASE-014', qty: 5 },
      ],
      paymentMethod: 'ENZONA',
      electronicRef: 'EZ77102945',
      customerPhone: '52881034',
      reconciled: 1,
    });

    // Finalize yesterday's registers exact cash count
    const yr1Data = db.prepare('SELECT * FROM shift_registers WHERE id = ?').get(yReg1);
    const yr2Data = db.prepare('SELECT * FROM shift_registers WHERE id = ?').get(yReg2);
    db.prepare(
      `UPDATE shift_registers SET counted_cash_cup = expected_cash_cup, cash_difference_cup = 0,
       closed_at = ?, validated_by = ?, validated_at = ?, closing_notes = 'Cuadre exacto en CUP.' WHERE id IN (?, ?)`
    ).run(`${yesterday} 22:50:00`, ecoId, `${yesterday} 23:10:00`, yReg1, yReg2);

    // Automatic bank deposit order created from yesterday's cash sales (Res. 111/2023 BCC)
    const yCashToDeposit = roundCup(yr1Data.cash_sales_cup + yr2Data.cash_sales_cup);
    db.prepare(
      `INSERT INTO bank_deposits
       (order_number, origin, shift_session_id, amount_cup, due_date, status, notes, created_by, created_at)
       VALUES ('DEP-0001', 'AUTOMATICO', ?, ?, ?, 'PENDIENTE',
               'Recaudación en efectivo del Turno Tarde — Depositar en Cuenta Fiscal BANMET (Res. 111/2023 BCC)', ?, ?)`
    ).run(ySession, yCashToDeposit, getNextBusinessDayIso(yesterday), ecoId, `${yesterday} 22:55:00`);

    // 4. TODAY's active Morning Shift with BOTH sellers (Dayana Caja 1 & Ernesto Caja 2) working live!
    const tSession = Number(
      db
        .prepare(
          `INSERT INTO shift_sessions (session_code, shift_template_id, work_date, status, opened_at, opened_by, notes)
           VALUES (?, ?, ?, 'ABIERTO', ?, ?, 'Turno Mañana activo con 2 vendedores en mostrador.')`
        )
        .run(`TRN-${today.replace(/-/g, '')}-M`, mId, today, `${today} 07:00:00`, vend1Id).lastInsertRowid
    );
    createIpvSnapshot(tSession);

    const tReg1 = Number(
      db
        .prepare(
          `INSERT INTO shift_registers (shift_session_id, register_number, seller_id, status, opening_cash_cup, expected_cash_cup, opened_at)
           VALUES (?, 1, ?, 'ABIERTA', 3000, 3000, ?)`
        )
        .run(tSession, vend1Id, `${today} 07:00:00`).lastInsertRowid
    );
    const tReg2 = Number(
      db
        .prepare(
          `INSERT INTO shift_registers (shift_session_id, register_number, seller_id, status, opening_cash_cup, expected_cash_cup, opened_at)
           VALUES (?, 2, ?, 'ABIERTA', 3000, 3000, ?)`
        )
        .run(tSession, vend2Id, `${today} 07:03:00`).lastInsertRowid
    );

    // Live sales today from Dayana (Caja 1) and Ernesto (Caja 2)
    recordSeedSale({
      sessionId: tSession,
      registerId: tReg1,
      sellerId: vend1Id,
      saleDate: today,
      createdAt: `${today} 08:15:00`,
      items: [
        { sku: 'BAS-001', qty: 2 },
        { sku: 'BAS-002', qty: 3 }, // Drops Oil from 8 to 5 (below min 8 -> triggers auto-restock!)
        { sku: 'ALI-009', qty: 2 },
      ],
      paymentMethod: 'TRANSFERMOVIL',
      electronicRef: 'TM95011287',
      customerPhone: '54918203',
      reconciled: 0,
    });
    recordSeedSale({
      sessionId: tSession,
      registerId: tReg1,
      sellerId: vend1Id,
      saleDate: today,
      createdAt: `${today} 09:42:00`,
      items: [
        { sku: 'ALI-007', qty: 3 },
        { sku: 'BEB-010', qty: 4 }, // Drops Malta from 11 to 7 (below min 10 -> triggers auto-restock!)
        { sku: 'CON-013', qty: 2 },
      ],
      paymentMethod: 'EFECTIVO',
    });
    recordSeedSale({
      sessionId: tSession,
      registerId: tReg2,
      sellerId: vend2Id,
      saleDate: today,
      createdAt: `${today} 08:50:00`,
      items: [
        { sku: 'BAS-003', qty: 1 },
        { sku: 'BAS-005', qty: 2 }, // Drops Salchichas from 7 to 5 (below min 6 -> triggers auto-restock with FEFO!)
        { sku: 'BEB-011', qty: 2 },
      ],
      paymentMethod: 'ENZONA',
      electronicRef: 'EZ77209418',
      customerPhone: '58392011',
      reconciled: 0,
    });
    recordSeedSale({
      sessionId: tSession,
      registerId: tReg2,
      sellerId: vend2Id,
      saleDate: today,
      createdAt: `${today} 10:25:00`,
      items: [
        { sku: 'BAS-004', qty: 2 },
        { sku: 'BEB-010', qty: 3 }, // Drops Malta further to 4!
        { sku: 'ASE-014', qty: 3 },
      ],
      paymentMethod: 'MIXTO',
      cashPart: 1500,
      electronicRef: 'TM95044819',
      customerPhone: '53091827',
      reconciled: 0,
    });

    // Trigger automated restock engine across modified products
    for (const sku of ['BAS-002', 'BAS-005', 'BEB-010']) {
      checkAndTriggerAutoRestock(db, productIds[sku].id);
    }

    // 5. Pending SC-2-16 Merma reported by Almacenero awaiting Económico/Jefe approval
    const galletas = db.prepare(`SELECT * FROM products WHERE sku = 'CON-013'`).get();
    db.prepare(
      `INSERT INTO inventory_movements
       (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
        warehouse_balance_after, kiosk_balance_after, batch_code, reason, created_by, created_at)
       VALUES ('SC216-0001', 'MERMA', 'PENDIENTE_APROBACION', ?, 2, ?, ?, ?, ?, ?,
               '2 paquetes con envase deteriorado en manipulación de estiba (Almacén)', ?, ?)`
    ).run(
      galletas.id,
      galletas.unit_cost_cup,
      roundCup(galletas.unit_cost_cup * 2),
      galletas.warehouse_stock,
      galletas.kiosk_stock,
      galletas.current_batch,
      almId,
      `${today} 09:10:00`
    );

    // 6. Deductible monthly operating expenses (UNE electricity & local rent via transfer)
    const exp1 = {
      doc: 'GAS-0001',
      cat: 'Electricidad (UNE)',
      desc: 'Factura eléctrica mensual refrigeración y local comercial',
      prov: 'Empresa Eléctrica de La Habana (UNE)',
      inv: 'UNE-11-482910',
      amt: 2850,
      method: 'TRANSFERMOVIL',
      ref: 'TM-UNE-48291',
    };
    const exp2 = {
      doc: 'GAS-0002',
      cat: 'Envases y Jabas',
      desc: 'Compra de jabas de nylon y bandejas para despacho minorista',
      prov: 'Plásticos Habana TCP',
      inv: 'REC-00892',
      amt: 1400,
      method: 'EFECTIVO',
      ref: '',
    };

    for (const e of [exp1, exp2]) {
      db.prepare(
        `INSERT INTO expenses
         (doc_number, expense_date, category, description, provider_name, invoice_ref, has_valid_receipt, amount_cup, payment_method, payment_ref, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      ).run(e.doc, yesterday, e.cat, e.desc, e.prov, e.inv, e.amt, e.method, e.ref, ecoId);

      postJournalEntry(db, {
        entryDate: yesterday,
        sourceType: 'GASTO',
        sourceRef: e.doc,
        description: `Gasto operativo deducible: ${e.cat} — ${e.prov}`,
        createdBy: ecoId,
        silent: true,
        lines: [
          { account: NCIF_ACCOUNTS.GASTOS_ADMIN, debit: e.amt },
          {
            account: e.method === 'EFECTIVO' ? NCIF_ACCOUNTS.CAJA_GENERAL : NCIF_ACCOUNTS.BANCO_FISCAL,
            credit: e.amt,
          },
        ],
      });
    }

    // Seed informative automation events & audit trail
    logAutomation(
      db,
      'BANCARIZACION',
      'ALERTA',
      'Orden automática de depósito DEP-0001 generada',
      `Efectivo recaudado del Turno Tarde (${yCashToDeposit.toFixed(2)} CUP) programado para depósito en Cuenta Bancaria Fiscal BANMET según Res. 111/2023 BCC.`,
      'DEP-0001'
    );
    logAutomation(
      db,
      'TURNO',
      'INFO',
      'Turno Mañana abierto con dotación completa (2/2 vendedores)',
      'Caja 1: Dayana Torres (fondo 3,000 CUP) · Caja 2: Ernesto Valdés (fondo 3,000 CUP). IPV inicializado con 14 productos.',
      `TRN-${today.replace(/-/g, '')}-M`
    );
    logAutomation(
      db,
      'PRECIOS_MFP',
      'INFO',
      'Verificación diaria de precios topados Res. 225/2024 MFP',
      '6 productos básicos regulados verificados: 100% dentro del precio minorista máximo y margen ≤ 30%.',
      'MFP-225'
    );
    logAutomation(
      db,
      'ONAT',
      'INFO',
      'Provisión tributaria ONAT actualizada en tiempo real',
      'Impuesto sobre Ventas (10%), Contribución Territorial (1%), Fuerza de Trabajo (5%) y Seg. Social (14%) calculados al día.',
      'ONAT-113'
    );

    logAudit(
      db,
      { id: vend1Id, full_name: 'Dayana Torres Castellanos', role: 'vendedor' },
      'APERTURA_CAJA',
      'Turnos y POS',
      `Apertura de Caja 1 en Turno Mañana con fondo fijo de 3,000.00 CUP.`
    );
    logAudit(
      db,
      { id: vend2Id, full_name: 'Ernesto Valdés Mena', role: 'vendedor' },
      'APERTURA_CAJA',
      'Turnos y POS',
      `Apertura de Caja 2 en Turno Mañana con fondo fijo de 3,000.00 CUP.`
    );
    logAudit(
      db,
      { id: almId, full_name: 'Carlos Enrique Vega', role: 'almacenero' },
      'REPORTE_MERMA',
      'Almacén',
      'Registrado modelo SC-2-16 (SC216-0001) por 2 paq. de Galletas dulces rellenas pendiente de aprobación.'
    );
    logAudit(
      db,
      { id: ecoId, full_name: 'Beatriz Domínguez Ruiz', role: 'economico' },
      'VALIDACION_TURNO',
      'Economía',
      `Auditado Turno Tarde (${yesterday}) sin faltantes y conciliados cobros QR Transfermóvil/EnZona.`
    );
  });
}
