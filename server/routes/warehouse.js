import { Router } from 'express';
import { getDb, nextDocCode, roundCup, runInTransaction } from '../db.js';
import { logAudit, logAutomation, requireAuth, requirePermission, requireRole } from '../auth.js';
import {
  MFP_RES_225_CAPS,
  NCIF_ACCOUNTS,
  calculateCostSheet,
  checkAndTriggerAutoRestock,
  getConfig,
  getTodayIso,
  postJournalEntry,
  validateBancarizacionPayment,
  validateProposedPrice,
} from '../cubanLawEngine.js';

const router = Router();

function sanitizeImageUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.length > 750000) {
    throw new Error('La imagen supera el tamaño permitido. Comprímala (máx. 800×800 WebP/JPEG).');
  }
  if (
    s.startsWith('data:image/webp;base64,') ||
    s.startsWith('data:image/jpeg;base64,') ||
    s.startsWith('data:image/png;base64,') ||
    s.startsWith('https://') ||
    s.startsWith('http://') ||
    s.startsWith('/')
  ) {
    return s;
  }
  throw new Error('Formato de imagen inválido. Use foto WebP/JPEG/PNG o URL https://.');
}

function getWarehousePrivacy(user) {
  if (user?.role === 'jefe') {
    return {
      canViewGlobalCosts: true,
      canViewEntryCost: true,
      canEditPrices: true,
      canUploadPhotos: true,
      canPublishCatalog: true,
      canRegisterMermas: true,
    };
  }
  const flags = user?.permissions_matrix?.flags || {};
  return {
    canViewGlobalCosts: Boolean(flags.view_costs),
    canViewEntryCost: Boolean(flags.view_costs || flags.view_entry_cost),
    canEditPrices: Boolean(flags.edit_prices),
    canUploadPhotos: Boolean(flags.upload_photos),
    canPublishCatalog: Boolean(flags.publish_catalog),
    canRegisterMermas: Boolean(flags.register_mermas),
  };
}

function enrichProduct(product, config, pendingRestockMap, today, privacy) {
  const sheet = calculateCostSheet(product, config);
  let expiryStatus = 'VIGENTE';
  let daysToExpiry = null;
  if (product.next_expiry_date) {
    const diffMs =
      new Date(`${product.next_expiry_date}T12:00:00Z`).getTime() -
      new Date(`${today}T12:00:00Z`).getTime();
    daysToExpiry = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (daysToExpiry < 0) expiryStatus = 'VENCIDO';
    else if (daysToExpiry <= 15) expiryStatus = 'PROXIMO_VENCER';
  }
  const totalStock = roundCup(product.warehouse_stock + product.kiosk_stock);
  const base = {
    ...product,
    compatibility: product.compatibility || '',
    total_stock: totalStock,
    in_stock: totalStock > 0,
    low_kiosk: product.kiosk_stock <= product.kiosk_min_stock,
    low_warehouse: product.warehouse_stock <= product.warehouse_min_stock,
    expiry_status: expiryStatus,
    days_to_expiry: daysToExpiry,
    pending_restock: pendingRestockMap.get(product.id) || null,
  };

  if (privacy?.canViewGlobalCosts) {
    return {
      ...base,
      warehouse_value_cup: roundCup(product.warehouse_stock * product.unit_cost_cup),
      kiosk_value_cup: roundCup(product.kiosk_stock * product.unit_cost_cup),
      cost_sheet: sheet,
    };
  }

  if (privacy?.canViewEntryCost) {
    // Almacenero: puede ver costo unitario de entrada del producto, NO márgenes ni costos globales del negocio
    return {
      ...base,
      indirect_cost_pct: null,
      warehouse_value_cup: null,
      kiosk_value_cup: null,
      cost_sheet: {
        suggested_price_cup: sheet.suggested_price_cup,
        max_legal_price_cup: sheet.max_legal_price_cup,
        is_compliant: sheet.is_compliant,
        compliance_note: sheet.compliance_note,
      },
    };
  }

  // Dependiente POS / Consulta de stock básica: CERO costos privados, márgenes ni valoraciones internas
  return {
    ...base,
    unit_cost_cup: null,
    indirect_cost_pct: null,
    warehouse_value_cup: null,
    kiosk_value_cup: null,
    cost_sheet: null,
  };
}

router.get('/products', requireAuth, (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const today = getTodayIso();
  const privacy = getWarehousePrivacy(req.user);
  const products = db.prepare(`SELECT * FROM products WHERE active = 1 ORDER BY category, name`).all();
  const pendingRestocks = db
    .prepare(`SELECT * FROM restock_requests WHERE status = 'PENDIENTE'`)
    .all();
  const restockMap = new Map(pendingRestocks.map((r) => [r.product_id, r]));
  const pendingPrices = privacy.canViewEntryCost
    ? db
        .prepare(
          `SELECT product_id, new_price_cup, created_at FROM price_change_requests
           WHERE status = 'PENDIENTE_JEFE' ORDER BY id DESC`
        )
        .all()
    : [];
  const pendingPriceMap = new Map();
  for (const pr of pendingPrices) {
    if (!pendingPriceMap.has(pr.product_id)) pendingPriceMap.set(pr.product_id, pr);
  }

  const enriched = products.map((p) => ({
    ...enrichProduct(p, config, restockMap, today, privacy),
    pending_price_request: pendingPriceMap.get(p.id) || null,
  }));
  res.json({
    products: enriched,
    privacy,
    catalog_settings: {
      catalog_enabled: Boolean(config.catalog_enabled),
      catalog_show_out_of_stock: Boolean(config.catalog_show_out_of_stock),
      catalog_show_stock_qty: Boolean(config.catalog_show_stock_qty),
    },
    fx_rates:
      privacy.canViewGlobalCosts && config.show_fx_reference
        ? {
            usd: config.rate_usd_cup || 320,
            mlc: config.rate_mlc_cup || 275,
            eur: config.rate_eur_cup || 340,
          }
        : null,
    mfp_res_225_caps: MFP_RES_225_CAPS,
    max_cash_provider_payment_cup: config.max_cash_provider_payment_cup,
  });
});

router.post('/products', requireAuth, requirePermission('warehouse', 'canEdit'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  if (req.user.role === 'almacenero' && config.permissions?.almacenero_create_products === false) {
    return res.status(403).json({
      error: 'El creador de la empresa restringió la creación de productos nuevos a Dirección o Economía.',
    });
  }
  const b = req.body || {};

  if (!b.name?.trim() || !b.unit?.trim() || !b.category?.trim()) {
    return res.status(400).json({ error: 'Indique nombre, categoría y unidad de medida del producto.' });
  }

  const sku = String(b.sku || `PRD-${Date.now().toString().slice(-4)}`)
    .trim()
    .toUpperCase();
  const dup = db.prepare(`SELECT id FROM products WHERE upper(sku) = ?`).get(sku);
  if (dup) {
    return res.status(400).json({ error: `Ya existe un producto con el código SKU ${sku}.` });
  }

  const unitCost = Math.max(0, roundCup(b.unit_cost_cup || 0));
  const isCapped = b.is_price_capped ? 1 : 0;
  const priceCap = isCapped && Number(b.price_cap_cup) > 0 ? roundCup(b.price_cap_cup) : null;
  const isMarginReg = b.is_margin_regulated !== undefined ? (b.is_margin_regulated ? 1 : 0) : 1;
  const indirectPct = Number(b.indirect_cost_pct ?? config.indirect_cost_alloc_pct);

  const draft = {
    name: String(b.name).trim(),
    unit: String(b.unit).trim(),
    unit_cost_cup: unitCost,
    indirect_cost_pct: indirectPct,
    is_price_capped: isCapped,
    price_cap_cup: priceCap,
    price_cap_resolution: isCapped ? String(b.price_cap_resolution || 'Res. 225/2024 MFP').trim() : '',
    is_margin_regulated: isMarginReg,
  };

  let salePrice = roundCup(b.sale_price_cup || 0);
  if (salePrice <= 0 && unitCost > 0) {
    // Auto-calculate optimal compliant retail price
    salePrice = calculateCostSheet(draft, config).suggested_price_cup;
  }

  if (salePrice > 0) {
    const check = validateProposedPrice(draft, salePrice, config);
    if (!check.valid) {
      return res.status(400).json({ error: check.message });
    }
  }

  let imageUrl = '';
  try {
    imageUrl = sanitizeImageUrl(b.image_url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const compatibility = String(b.compatibility || '').trim().slice(0, 260);
  const catalogDesc = String(b.catalog_description || '').trim().slice(0, 320);
  const catalogVisible = b.catalog_visible === undefined ? 1 : b.catalog_visible ? 1 : 0;
  const catalogFeatured = b.catalog_featured ? 1 : 0;

  const result = db
    .prepare(
      `INSERT INTO products
       (sku, name, category, compatibility, unit, unit_cost_cup, indirect_cost_pct, sale_price_cup,
        is_price_capped, price_cap_cup, price_cap_resolution, is_margin_regulated, sales_tax_exempt,
        warehouse_stock, kiosk_stock, warehouse_min_stock, kiosk_min_stock, kiosk_target_stock,
        current_batch, next_expiry_date, image_url, catalog_visible, catalog_featured, catalog_description, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      sku,
      draft.name,
      String(b.category).trim(),
      compatibility,
      draft.unit,
      unitCost,
      indirectPct,
      salePrice,
      isCapped,
      priceCap,
      draft.price_cap_resolution,
      isMarginReg,
      b.sales_tax_exempt ? 1 : 0,
      Math.max(0, Number(b.warehouse_min_stock ?? 10)),
      Math.max(0, Number(b.kiosk_min_stock ?? 5)),
      Math.max(1, Number(b.kiosk_target_stock ?? 20)),
      String(b.current_batch || '').trim(),
      String(b.next_expiry_date || '').trim(),
      imageUrl,
      catalogVisible,
      catalogFeatured,
      catalogDesc
    );

  const newId = Number(result.lastInsertRowid);

  // Add to open shift IPV snapshot with 0 opening qty
  const openShift = db.prepare(`SELECT id FROM shift_sessions WHERE status = 'ABIERTO' LIMIT 1`).get();
  if (openShift) {
    db.prepare(
      `INSERT OR IGNORE INTO shift_ipv_snapshots
       (shift_session_id, product_id, opening_qty, entries_qty, losses_qty, sold_qty, closing_qty, sale_price_cup, sold_amount_cup)
       VALUES (?, ?, 0, 0, 0, 0, 0, ?, 0)`
    ).run(openShift.id, newId, salePrice);
  }

  logAudit(
    db,
    req.user,
    'ALTA_PRODUCTO',
    'Almacén',
    `Creado producto ${sku} — ${draft.name} (precio ${salePrice.toFixed(2)} CUP/${draft.unit}).`
  );

  res.status(201).json({ id: newId, sku, sale_price_cup: salePrice });
});

router.put('/products/:id', requireAuth, requirePermission('warehouse', 'canEdit'), (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });

  const b = req.body || {};
  let nextImage = product.image_url || '';
  if (b.image_url !== undefined) {
    try {
      nextImage = sanitizeImageUrl(b.image_url);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  db.prepare(
    `UPDATE products SET
       name = ?, category = ?, compatibility = ?, unit = ?,
       warehouse_min_stock = ?, kiosk_min_stock = ?, kiosk_target_stock = ?,
       current_batch = ?, next_expiry_date = ?,
       image_url = ?, catalog_description = ?, catalog_visible = ?, catalog_featured = ?,
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    String(b.name ?? product.name).trim(),
    String(b.category ?? product.category).trim(),
    String(b.compatibility ?? product.compatibility ?? '').trim().slice(0, 260),
    String(b.unit ?? product.unit).trim(),
    Math.max(0, Number(b.warehouse_min_stock ?? product.warehouse_min_stock)),
    Math.max(0, Number(b.kiosk_min_stock ?? product.kiosk_min_stock)),
    Math.max(1, Number(b.kiosk_target_stock ?? product.kiosk_target_stock)),
    String(b.current_batch ?? product.current_batch).trim(),
    String(b.next_expiry_date ?? product.next_expiry_date).trim(),
    nextImage,
    String(b.catalog_description ?? product.catalog_description ?? '').trim().slice(0, 320),
    b.catalog_visible === undefined ? product.catalog_visible : b.catalog_visible ? 1 : 0,
    b.catalog_featured === undefined ? product.catalog_featured : b.catalog_featured ? 1 : 0,
    id
  );

  checkAndTriggerAutoRestock(db, id);
  logAudit(
    db,
    req.user,
    'EDICION_PRODUCTO',
    'Almacén y Stock',
    `Actualizada ficha/estiba de ${product.sku} — ${b.name ?? product.name}.`
  );
  res.json({ ok: true });
});

/**
 * Edición integral de Ficha de Producto + Foto (WebP/JPEG) + Compatibilidad + Catálogo + Precio
 * Respeta permisos estrictos: si el trabajador NO tiene permiso edit_prices, la foto/ficha se guarda
 * al instante y el cambio de precio queda como propuesta PENDIENTE_JEFE para aprobación del Jefe.
 */
router.put('/products/:id/ficha', requireAuth, (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const privacy = getWarehousePrivacy(req.user);
  const canEditWarehouse = Boolean(req.user.permissions_matrix?.items?.warehouse?.canEdit);
  const canEditCatalog = Boolean(req.user.permissions_matrix?.items?.['catalog-wa']?.canEdit);
  const canEditPricing = Boolean(req.user.permissions_matrix?.items?.pricing?.canEdit);

  if (!canEditWarehouse && !canEditCatalog && !canEditPricing && !privacy.canUploadPhotos) {
    return res
      .status(403)
      .json({ error: 'Su usuario no tiene permiso para editar fichas ni fotos de productos.' });
  }

  const id = Number(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });

  const b = req.body || {};
  let nextImage = product.image_url || '';
  if (b.image_url !== undefined) {
    if (!privacy.canUploadPhotos && !canEditCatalog && req.user.role !== 'jefe') {
      return res.status(403).json({ error: 'No tiene permiso para cambiar fotos de productos.' });
    }
    try {
      nextImage = sanitizeImageUrl(b.image_url);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const nextName = b.name !== undefined && String(b.name).trim() ? String(b.name).trim() : product.name;
  const nextCat =
    b.category !== undefined && String(b.category).trim() ? String(b.category).trim() : product.category;
  const nextUnit = b.unit !== undefined && String(b.unit).trim() ? String(b.unit).trim() : product.unit;
  const nextCompat =
    b.compatibility !== undefined
      ? String(b.compatibility).trim().slice(0, 260)
      : product.compatibility || '';
  const nextDesc =
    b.catalog_description !== undefined
      ? String(b.catalog_description).trim().slice(0, 320)
      : product.catalog_description || '';
  const nextVisible =
    b.catalog_visible !== undefined && privacy.canPublishCatalog
      ? b.catalog_visible
        ? 1
        : 0
      : product.catalog_visible;
  const nextFeatured =
    b.catalog_featured !== undefined && privacy.canPublishCatalog
      ? b.catalog_featured
        ? 1
        : 0
      : product.catalog_featured;
  const nextUnitCost =
    b.unit_cost_cup !== undefined && privacy.canViewGlobalCosts && Number(b.unit_cost_cup) >= 0
      ? roundCup(b.unit_cost_cup)
      : product.unit_cost_cup;

  let nextSalePrice = product.sale_price_cup;
  let priceStatus = 'UNCHANGED';

  if (b.sale_price_cup !== undefined && roundCup(b.sale_price_cup) > 0) {
    const proposed = roundCup(b.sale_price_cup);
    if (Math.abs(proposed - product.sale_price_cup) >= 0.01) {
      const check = validateProposedPrice(
        { ...product, unit_cost_cup: nextUnitCost },
        proposed,
        config
      );
      if (!check.valid) {
        return res.status(400).json({ error: check.message });
      }

      if (privacy.canEditPrices) {
        nextSalePrice = proposed;
        priceStatus = 'APPLIED';
        db.prepare(
          `INSERT INTO price_change_requests
           (product_id, old_price_cup, new_price_cup, unit_cost_cup, full_cost_cup, margin_pct, reason, status, created_by, approved_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'APLICADO', ?, ?)`
        ).run(
          id,
          product.sale_price_cup,
          proposed,
          nextUnitCost,
          check.sheet.full_cost_cup,
          check.sheet.margin_pct ?? 0,
          String(b.price_reason || 'Actualización de precio desde Ficha de Producto').trim(),
          req.user.id,
          req.user.id
        );
        const openShift = db
          .prepare(`SELECT id FROM shift_sessions WHERE status = 'ABIERTO' LIMIT 1`)
          .get();
        if (openShift) {
          db.prepare(
            `UPDATE shift_ipv_snapshots SET sale_price_cup = ? WHERE shift_session_id = ? AND product_id = ?`
          ).run(proposed, openShift.id, id);
        }
      } else {
        // Sin permiso final de precios: crea solicitud PENDIENTE_JEFE
        priceStatus = 'PENDING_APPROVAL';
        db.prepare(
          `INSERT INTO price_change_requests
           (product_id, old_price_cup, new_price_cup, unit_cost_cup, full_cost_cup, margin_pct, reason, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE_JEFE', ?)`
        ).run(
          id,
          product.sale_price_cup,
          proposed,
          nextUnitCost,
          check.sheet.full_cost_cup,
          check.sheet.margin_pct ?? 0,
          String(b.price_reason || 'Propuesta de precio desde Almacén (pendiente aprobación del Jefe)').trim(),
          req.user.id
        );
      }
    }
  }

  db.prepare(
    `UPDATE products SET
       name = ?, category = ?, compatibility = ?, unit = ?,
       unit_cost_cup = ?, sale_price_cup = ?,
       warehouse_min_stock = ?, kiosk_min_stock = ?, kiosk_target_stock = ?,
       current_batch = ?, next_expiry_date = ?,
       image_url = ?, catalog_description = ?, catalog_visible = ?, catalog_featured = ?,
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    nextName,
    nextCat,
    nextCompat,
    nextUnit,
    nextUnitCost,
    nextSalePrice,
    Math.max(0, Number(b.warehouse_min_stock ?? product.warehouse_min_stock)),
    Math.max(0, Number(b.kiosk_min_stock ?? product.kiosk_min_stock)),
    Math.max(1, Number(b.kiosk_target_stock ?? product.kiosk_target_stock)),
    String(b.current_batch ?? product.current_batch ?? '').trim(),
    String(b.next_expiry_date ?? product.next_expiry_date ?? '').trim(),
    nextImage,
    nextDesc,
    nextVisible,
    nextFeatured,
    id
  );

  checkAndTriggerAutoRestock(db, id);

  const changesNote = [
    b.image_url !== undefined ? (nextImage ? 'foto actualizada' : 'foto retirada') : null,
    nextVisible !== product.catalog_visible
      ? nextVisible
        ? 'publicado en Catálogo'
        : 'ocultado del Catálogo'
      : null,
    priceStatus === 'APPLIED'
      ? `precio ${product.sale_price_cup.toFixed(2)} → ${nextSalePrice.toFixed(2)} CUP`
      : null,
    priceStatus === 'PENDING_APPROVAL'
      ? `propuesta precio ${roundCup(b.sale_price_cup).toFixed(2)} CUP (pendiente Jefe)`
      : null,
  ]
    .filter(Boolean)
    .join(', ');

  logAudit(
    db,
    req.user,
    'FICHA_PRODUCTO',
    'Almacén y Catálogo',
    `Actualizada ficha de ${product.sku} — ${nextName}${changesNote ? ` (${changesNote})` : ''}.`
  );

  res.json({
    ok: true,
    id,
    sale_price_cup: nextSalePrice,
    catalog_visible: Boolean(nextVisible),
    price_status: priceStatus,
  });
});

/**
 * NIVEL 2 DE ENTRADA DE ALMACÉN: Crear producto nuevo + foto WebP/JPEG + entrada inicial SC-2-04
 * + ubicación opcional directa a POS/Mostrador (SC-2-09 + IPV) + publicación en Catálogo en 1 solo paso.
 */
router.post(
  '/products/create-with-entry',
  requireAuth,
  requirePermission('warehouse', 'canEdit'),
  (req, res) => {
    const db = getDb();
    const config = getConfig(db);
    const privacy = getWarehousePrivacy(req.user);

    if (req.user.role === 'almacenero' && config.permissions?.almacenero_create_products === false) {
      return res.status(403).json({
        error: 'El Jefe restringió el alta de productos nuevos.',
      });
    }

    const b = req.body || {};
    if (!b.name?.trim() || !b.category?.trim() || !b.unit?.trim()) {
      return res
        .status(400)
        .json({ error: 'Indique nombre del producto, categoría y unidad de medida.' });
    }

    let imageUrl = '';
    try {
      imageUrl = sanitizeImageUrl(b.image_url);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const sku = String(b.sku || `PRD-${Date.now().toString().slice(-5)}`)
      .trim()
      .toUpperCase();
    const dup = db.prepare(`SELECT id FROM products WHERE upper(sku) = ?`).get(sku);
    if (dup) {
      return res.status(400).json({ error: `Ya existe un producto con el código SKU ${sku}.` });
    }

    const qty = Math.max(0, roundCup(b.quantity || 0));
    const unitCost = Math.max(0, roundCup(b.unit_cost_cup || 0));
    const destination = ['ALMACEN', 'KIOSKO', 'MIXTO'].includes(String(b.destination).toUpperCase())
      ? String(b.destination).toUpperCase()
      : 'ALMACEN';
    const paymentMethod = String(b.payment_method || 'TRANSFERENCIA').toUpperCase();

    if (qty > 0 && unitCost <= 0) {
      return res
        .status(400)
        .json({ error: 'Ingrese el costo unitario de entrada (CUP) para contabilizar la recepción.' });
    }

    const supplierName = String(b.supplier_name || 'Proveedor directo').trim();
    const invoiceNumber = String(
      b.invoice_number || `ENT-${getTodayIso().replace(/-/g, '')}-${sku.slice(-4)}`
    ).trim();

    if (qty > 0 && paymentMethod !== 'CREDITO') {
      const totalCostCheck = roundCup(qty * unitCost);
      const bccCheck = validateBancarizacionPayment(
        totalCostCheck,
        paymentMethod,
        b.payment_ref || (paymentMethod !== 'EFECTIVO' ? `REF-${invoiceNumber}` : ''),
        config
      );
      if (!bccCheck.valid) {
        return res.status(400).json({ error: bccCheck.message });
      }
    }

    const isCapped = b.is_price_capped ? 1 : 0;
    const priceCap = isCapped && Number(b.price_cap_cup) > 0 ? roundCup(b.price_cap_cup) : null;
    const isMarginReg = b.is_margin_regulated !== undefined ? (b.is_margin_regulated ? 1 : 0) : 1;
    const indirectPct = Number(b.indirect_cost_pct ?? config.indirect_cost_alloc_pct);

    const draft = {
      name: String(b.name).trim(),
      unit: String(b.unit).trim(),
      unit_cost_cup: unitCost,
      indirect_cost_pct: indirectPct,
      is_price_capped: isCapped,
      price_cap_cup: priceCap,
      price_cap_resolution: isCapped ? String(b.price_cap_resolution || 'Res. 225/2024 MFP').trim() : '',
      is_margin_regulated: isMarginReg,
    };

    const suggestedPrice = unitCost > 0 ? calculateCostSheet(draft, config).suggested_price_cup : 0;
    const requestedPrice = roundCup(b.sale_price_cup || 0);
    let salePrice = suggestedPrice;
    let pendingPriceProposal = null;

    if (requestedPrice > 0) {
      const check = validateProposedPrice(draft, requestedPrice, config);
      if (!check.valid) {
        return res.status(400).json({ error: check.message });
      }
      if (privacy.canEditPrices || suggestedPrice <= 0) {
        salePrice = requestedPrice;
      } else if (Math.abs(requestedPrice - suggestedPrice) >= 0.01) {
        // Trabajador sin edit_prices: se fija precio sugerido MFP seguro y queda propuesta al Jefe
        salePrice = suggestedPrice;
        pendingPriceProposal = {
          proposed: requestedPrice,
          margin_pct: check.sheet.margin_pct ?? 0,
        };
      }
    }

    if (salePrice <= 0) {
      return res.status(400).json({ error: 'Indique un precio de venta público o costo unitario válido.' });
    }

    const catalogVisible =
      privacy.canPublishCatalog && b.catalog_visible !== undefined
        ? b.catalog_visible
          ? 1
          : 0
        : b.catalog_visible === false
          ? 0
          : 1;
    const catalogFeatured = privacy.canPublishCatalog && b.catalog_featured ? 1 : 0;
    const compatibility = String(b.compatibility || '').trim().slice(0, 260);
    const catalogDesc = String(b.catalog_description || '').trim().slice(0, 320);
    const batchCode = String(b.batch_code || b.current_batch || '').trim();
    const expiryDate = String(b.expiry_date || b.next_expiry_date || '').trim();

    try {
      const out = runInTransaction(db, () => {
        const resProd = db
          .prepare(
            `INSERT INTO products
             (sku, name, category, compatibility, unit, unit_cost_cup, indirect_cost_pct, sale_price_cup,
              is_price_capped, price_cap_cup, price_cap_resolution, is_margin_regulated, sales_tax_exempt,
              warehouse_stock, kiosk_stock, warehouse_min_stock, kiosk_min_stock, kiosk_target_stock,
              current_batch, next_expiry_date, image_url, catalog_visible, catalog_featured, catalog_description, active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          )
          .run(
            sku,
            draft.name,
            String(b.category).trim(),
            compatibility,
            draft.unit,
            unitCost,
            indirectPct,
            salePrice,
            isCapped,
            priceCap,
            draft.price_cap_resolution,
            isMarginReg,
            b.sales_tax_exempt ? 1 : 0,
            qty,
            Math.max(0, Number(b.warehouse_min_stock ?? 6)),
            Math.max(0, Number(b.kiosk_min_stock ?? 3)),
            Math.max(1, Number(b.kiosk_target_stock ?? 15)),
            batchCode,
            expiryDate,
            imageUrl,
            catalogVisible,
            catalogFeatured,
            catalogDesc
          );

        const newId = Number(resProd.lastInsertRowid);

        const openShift = db
          .prepare(`SELECT id FROM shift_sessions WHERE status = 'ABIERTO' LIMIT 1`)
          .get();
        if (openShift) {
          db.prepare(
            `INSERT OR IGNORE INTO shift_ipv_snapshots
             (shift_session_id, product_id, opening_qty, entries_qty, losses_qty, sold_qty, closing_qty, sale_price_cup, sold_amount_cup)
             VALUES (?, ?, 0, 0, 0, 0, 0, ?, 0)`
          ).run(openShift.id, newId, salePrice);
        }

        let receiptDoc = null;
        let transferDoc = null;

        if (qty > 0) {
          const totalCost = roundCup(qty * unitCost);
          receiptDoc = nextDocCode(db, 'inventory_movements', 'doc_number', 'SC204', 4);
          db.prepare(
            `INSERT INTO inventory_movements
             (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
              warehouse_balance_after, kiosk_balance_after, supplier_name, supplier_nit,
              invoice_number, payment_method, payment_ref, batch_code, expiry_date, reason, created_by, approved_by)
             VALUES (?, 'RECEPCION', 'APLICADO', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            receiptDoc,
            newId,
            qty,
            unitCost,
            totalCost,
            qty,
            supplierName,
            String(b.supplier_nit || '').trim(),
            invoiceNumber,
            paymentMethod,
            String(b.payment_ref || '').trim(),
            batchCode,
            expiryDate,
            String(b.reason || 'Alta + entrada inicial en un paso').trim(),
            req.user.id,
            req.user.id
          );

          if (config.auto_accounting_enabled) {
            const creditAccount =
              paymentMethod === 'EFECTIVO'
                ? NCIF_ACCOUNTS.CAJA_GENERAL
                : paymentMethod === 'CREDITO'
                  ? NCIF_ACCOUNTS.PROVEEDORES
                  : NCIF_ACCOUNTS.BANCO_FISCAL;
            postJournalEntry(db, {
              entryDate: getTodayIso(),
              sourceType: 'RECEPCION',
              sourceRef: receiptDoc,
              description: `Alta + Recepción ${receiptDoc}: ${qty} ${draft.unit} de ${draft.name} (${supplierName})`,
              createdBy: req.user.id,
              lines: [
                { account: NCIF_ACCOUNTS.INV_ALMACEN, debit: totalCost },
                { account: creditAccount, credit: totalCost },
              ],
            });
          }

          let toKioskQty = 0;
          if (destination === 'KIOSKO') toKioskQty = qty;
          else if (destination === 'MIXTO') {
            const reqKiosk = roundCup(b.kiosk_quantity ?? Math.ceil(qty / 2));
            toKioskQty = Math.min(qty, Math.max(0, reqKiosk));
          }

          if (toKioskQty > 0) {
            const tr = executeKioskTransfer(db, {
              productId: newId,
              quantity: toKioskQty,
              reason: `Pase inicial a Mostrador (POS) en alta de producto (${receiptDoc})`,
              user: req.user,
            });
            transferDoc = tr.doc_number;
          }
        }

        const fullCostVal = calculateCostSheet({ ...draft, sale_price_cup: salePrice }, config);
        if (pendingPriceProposal) {
          db.prepare(
            `INSERT INTO price_change_requests
             (product_id, old_price_cup, new_price_cup, unit_cost_cup, full_cost_cup, margin_pct, reason, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE_JEFE', ?)`
          ).run(
            newId,
            salePrice,
            pendingPriceProposal.proposed,
            unitCost,
            fullCostVal.full_cost_cup,
            pendingPriceProposal.margin_pct,
            'Precio público propuesto en alta de producto desde Almacén',
            req.user.id
          );
        } else {
          db.prepare(
            `INSERT INTO price_change_requests
             (product_id, old_price_cup, new_price_cup, unit_cost_cup, full_cost_cup, margin_pct, reason, status, created_by, approved_by)
             VALUES (?, 0, ?, ?, ?, ?, ?, 'APLICADO', ?, ?)`
          ).run(
            newId,
            salePrice,
            unitCost,
            fullCostVal.full_cost_cup,
            fullCostVal.margin_pct ?? 0,
            'Precio inicial fijado en alta + entrada de almacén',
            req.user.id,
            req.user.id
          );
        }

        logAudit(
          db,
          req.user,
          'ALTA_CON_ENTRADA',
          'Almacén y Catálogo',
          `Alta + Entrada de ${sku} — ${draft.name}: ${qty} ${draft.unit} (${destination}), precio ${salePrice.toFixed(2)} CUP, catálogo=${catalogVisible ? 'SÍ' : 'NO'}${imageUrl ? ', con foto optimizada' : ''}.`
        );

        const finalProd = db.prepare('SELECT * FROM products WHERE id = ?').get(newId);
        return {
          id: newId,
          sku,
          name: draft.name,
          sale_price_cup: salePrice,
          warehouse_stock: finalProd.warehouse_stock,
          kiosk_stock: finalProd.kiosk_stock,
          catalog_visible: Boolean(catalogVisible),
          has_photo: Boolean(imageUrl),
          doc_number: receiptDoc,
          transfer_doc: transferDoc,
          price_status: pendingPriceProposal ? 'PENDING_APPROVAL' : 'APPLIED',
        };
      });

      res.status(201).json(out);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * SC-2-04: Informe de Recepción de Proveedores (Automated weighted-average cost + BCC Res. 111/2023 + NCIF)
 */
router.post('/receipts', requireAuth, requirePermission('warehouse', 'canEdit'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const privacy = getWarehousePrivacy(req.user);
  const b = req.body || {};

  const productId = Number(b.product_id);
  const qty = roundCup(b.quantity);
  const unitCost = roundCup(b.unit_cost_cup);
  const paymentMethod = String(b.payment_method || 'TRANSFERENCIA').toUpperCase();

  if (!productId || qty <= 0 || unitCost <= 0) {
    return res
      .status(400)
      .json({ error: 'Seleccione producto e ingrese cantidad y costo unitario mayores que cero.' });
  }
  if (!b.supplier_name?.trim() || !b.invoice_number?.trim()) {
    return res.status(400).json({
      error:
        'Exigencia ONAT / NCIF (Modelo SC-2-04): Debe registrar el nombre del proveedor y el número de factura o conduce oficial.',
    });
  }
  if (!['TRANSFERENCIA', 'TRANSFERMOVIL', 'ENZONA', 'EFECTIVO', 'CREDITO'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Medio de pago inválido.' });
  }

  const totalCost = roundCup(qty * unitCost);

  // BCC Res. 111/2023 Bancarización validation
  if (paymentMethod !== 'CREDITO') {
    const bccCheck = validateBancarizacionPayment(totalCost, paymentMethod, b.payment_ref, config);
    if (!bccCheck.valid) {
      logAutomation(
        db,
        'BANCARIZACION',
        'BLOQUEO',
        `Pago en efectivo bloqueado (${totalCost.toFixed(2)} CUP)`,
        bccCheck.message,
        'BCC-111'
      );
      return res.status(400).json({ error: bccCheck.message });
    }
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });

  try {
    const out = runInTransaction(db, () => {
      // Weighted-average unit cost (Costo Promedio Ponderado NCIF)
      const currentTotalStock = roundCup(product.warehouse_stock + product.kiosk_stock);
      const newWeightedCost =
        currentTotalStock > 0
          ? roundCup((currentTotalStock * product.unit_cost_cup + totalCost) / (currentTotalStock + qty))
          : unitCost;

      const newWarehouseStock = roundCup(product.warehouse_stock + qty);
      const nextBatch = String(b.batch_code || product.current_batch || '').trim();
      // Keep earliest expiry for FEFO control if existing stock expires sooner
      let nextExpiry = product.next_expiry_date || '';
      if (b.expiry_date) {
        if (!nextExpiry || product.warehouse_stock <= 0 || b.expiry_date < nextExpiry) {
          nextExpiry = b.expiry_date;
        }
      }

      // Check cost sheet with new weighted cost
      let newSalePrice = product.sale_price_cup;
      const updatedSheet = calculateCostSheet(
        { ...product, unit_cost_cup: newWeightedCost, sale_price_cup: newSalePrice },
        config
      );
      let priceAutoAdjusted = false;
      if (newSalePrice <= 0 || (updatedSheet.exceeds_margin && config.strict_price_cap_block)) {
        newSalePrice = updatedSheet.suggested_price_cup;
        priceAutoAdjusted = true;
      }

      db.prepare(
        `UPDATE products SET
           warehouse_stock = ?, unit_cost_cup = ?, sale_price_cup = ?,
           current_batch = ?, next_expiry_date = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(newWarehouseStock, newWeightedCost, newSalePrice, nextBatch, nextExpiry, productId);

      const docNumber = nextDocCode(db, 'inventory_movements', 'doc_number', 'SC204', 4);
      const movRes = db
        .prepare(
          `INSERT INTO inventory_movements
           (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
            warehouse_balance_after, kiosk_balance_after, supplier_name, supplier_nit,
            invoice_number, payment_method, payment_ref, batch_code, expiry_date, reason, created_by, approved_by)
           VALUES (?, 'RECEPCION', 'APLICADO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          docNumber,
          productId,
          qty,
          unitCost,
          totalCost,
          newWarehouseStock,
          product.kiosk_stock,
          String(b.supplier_name).trim(),
          String(b.supplier_nit || '').trim(),
          String(b.invoice_number).trim(),
          paymentMethod,
          String(b.payment_ref || '').trim(),
          nextBatch,
          String(b.expiry_date || '').trim(),
          String(b.reason || 'Entrada a almacén según factura de proveedor').trim(),
          req.user.id,
          req.user.id
        );

      // Automatic NCIF accounting entry
      const creditAccount =
        paymentMethod === 'EFECTIVO'
          ? NCIF_ACCOUNTS.CAJA_GENERAL
          : paymentMethod === 'CREDITO'
          ? NCIF_ACCOUNTS.PROVEEDORES
          : NCIF_ACCOUNTS.BANCO_FISCAL;

      const journal = config.auto_accounting_enabled
        ? postJournalEntry(db, {
            entryDate: getTodayIso(),
            sourceType: 'RECEPCION',
            sourceRef: docNumber,
            description: `Informe de Recepción ${docNumber}: ${qty} ${product.unit} de ${product.name} (${b.supplier_name})`,
            createdBy: req.user.id,
            lines: [
              { account: NCIF_ACCOUNTS.INV_ALMACEN, debit: totalCost },
              { account: creditAccount, credit: totalCost },
            ],
          })
        : null;

      if (updatedSheet.below_cost) {
        logAutomation(
          db,
          'PRECIOS_MFP',
          'ALERTA',
          `Revisión de Ficha de Costo requerida: ${product.name}`,
          `Nuevo costo ponderado ${newWeightedCost.toFixed(2)} CUP deja el precio actual (${newSalePrice.toFixed(2)} CUP) por debajo del costo total. Precio sugerido MFP: ${updatedSheet.suggested_price_cup.toFixed(2)} CUP.`,
          docNumber
        );
      } else if (priceAutoAdjusted) {
        logAutomation(
          db,
          'PRECIOS_MFP',
          'INFO',
          `Precio MFP auto-ajustado: ${product.name}`,
          `Actualizado automáticamente a ${newSalePrice.toFixed(2)} CUP para mantener margen ≤ ${config.max_regulated_margin_pct}%.`,
          docNumber
        );
      }

      // Check if kiosk is low and create restock order OR transfer immediately if destination is KIOSKO/MIXTO
      const dest = String(b.destination || 'ALMACEN').toUpperCase();
      let transferDoc = null;
      if (dest === 'KIOSKO' || dest === 'MIXTO') {
        const toKiosk =
          dest === 'KIOSKO'
            ? qty
            : Math.min(qty, Math.max(0, roundCup(b.kiosk_quantity ?? Math.ceil(qty / 2))));
        if (toKiosk > 0) {
          const tr = executeKioskTransfer(db, {
            productId,
            quantity: toKiosk,
            reason: `Pase directo a Mostrador (POS) en entrada ${docNumber}`,
            user: req.user,
          });
          transferDoc = tr.doc_number;
        }
      }
      if (b.catalog_visible !== undefined && privacy.canPublishCatalog) {
        db.prepare('UPDATE products SET catalog_visible = ? WHERE id = ?').run(
          b.catalog_visible ? 1 : 0,
          productId
        );
      }
      const restock = checkAndTriggerAutoRestock(db, productId);

      logAudit(
        db,
        req.user,
        'RECEPCION_SC204',
        'Almacén y Stock',
        `${docNumber}: Recibidos ${qty} ${product.unit} de ${product.name} por ${totalCost.toFixed(2)} CUP (${paymentMethod}, destino ${dest}). Costo ponderado: ${newWeightedCost.toFixed(2)} CUP.`
      );

      const finalProd = db.prepare('SELECT warehouse_stock, kiosk_stock FROM products WHERE id = ?').get(productId);
      return {
        movement_id: Number(movRes.lastInsertRowid),
        doc_number: docNumber,
        transfer_doc: transferDoc,
        total_cost_cup: totalCost,
        new_weighted_cost_cup: newWeightedCost,
        new_warehouse_stock: finalProd.warehouse_stock,
        new_kiosk_stock: finalProd.kiosk_stock,
        journal_entry: journal?.entryNumber || null,
        cost_sheet_alert: updatedSheet.below_cost ? updatedSheet.compliance_note : null,
        auto_restock: restock,
      };
    });

    res.status(201).json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Internal helper for dispatching Warehouse -> Kiosk (SC-2-09)
 */
function executeKioskTransfer(db, { productId, quantity, reason, user, restockRequestId = null }) {
  const config = getConfig(db);
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId);
  if (!product) throw new Error('Producto no encontrado.');

  const qty = roundCup(quantity);
  if (qty <= 0) throw new Error('La cantidad a transferir debe ser mayor que cero.');
  if (qty > product.warehouse_stock + 0.0001) {
    throw new Error(
      `Stock insuficiente en Almacén para "${product.name}": disponible ${product.warehouse_stock} ${product.unit}, solicitado ${qty} ${product.unit}.`
    );
  }

  const newWh = roundCup(product.warehouse_stock - qty);
  const newKiosk = roundCup(product.kiosk_stock + qty);
  const totalCost = roundCup(qty * product.unit_cost_cup);

  db.prepare(
    `UPDATE products SET warehouse_stock = ?, kiosk_stock = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newWh, newKiosk, productId);

  const openShift = db.prepare(`SELECT id, session_code FROM shift_sessions WHERE status = 'ABIERTO' LIMIT 1`).get();

  const docNumber = nextDocCode(db, 'inventory_movements', 'doc_number', 'SC209', 4);
  const movRes = db
    .prepare(
      `INSERT INTO inventory_movements
       (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
        warehouse_balance_after, kiosk_balance_after, batch_code, expiry_date, reason,
        shift_session_id, created_by, approved_by, approved_at)
       VALUES (?, 'TRANSFERENCIA_KIOSKO', 'APLICADO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      docNumber,
      productId,
      qty,
      product.unit_cost_cup,
      totalCost,
      newWh,
      newKiosk,
      product.current_batch || '',
      product.next_expiry_date || '',
      reason || 'Abastecimiento de Almacén al Mostrador del Kiosko (FEFO)',
      openShift?.id || null,
      user.id,
      user.id
    );
  const movementId = Number(movRes.lastInsertRowid);

  // Automatically update active shift IPV snapshot
  if (openShift) {
    const existingSnap = db
      .prepare(`SELECT id FROM shift_ipv_snapshots WHERE shift_session_id = ? AND product_id = ?`)
      .get(openShift.id, productId);
    if (existingSnap) {
      db.prepare(
        `UPDATE shift_ipv_snapshots
         SET entries_qty = ROUND(entries_qty + ?, 2),
             closing_qty = ROUND(closing_qty + ?, 2)
         WHERE id = ?`
      ).run(qty, qty, existingSnap.id);
    } else {
      db.prepare(
        `INSERT INTO shift_ipv_snapshots
         (shift_session_id, product_id, opening_qty, entries_qty, losses_qty, sold_qty, closing_qty, sale_price_cup, sold_amount_cup)
         VALUES (?, ?, 0, ?, 0, 0, ?, ?, 0)`
      ).run(openShift.id, productId, qty, newKiosk, product.sale_price_cup);
    }
  }

  // Close matching pending restock requests automatically
  if (restockRequestId) {
    db.prepare(
      `UPDATE restock_requests
       SET status = 'DESPACHADO', fulfilled_by = ?, movement_id = ?, fulfilled_at = datetime('now')
       WHERE id = ?`
    ).run(user.id, movementId, restockRequestId);
  } else if (newKiosk > product.kiosk_min_stock) {
    db.prepare(
      `UPDATE restock_requests
       SET status = 'DESPACHADO', fulfilled_by = ?, movement_id = ?, fulfilled_at = datetime('now')
       WHERE product_id = ? AND status = 'PENDIENTE'`
    ).run(user.id, movementId, productId);
  }

  // Post automatic NCIF transfer entry (190 vs 189)
  const journal = config.auto_accounting_enabled
    ? postJournalEntry(db, {
        entryDate: getTodayIso(),
        sourceType: 'TRANSFERENCIA',
        sourceRef: docNumber,
        description: `Vale SC-2-09 ${docNumber}: ${qty} ${product.unit} de ${product.name} → Mostrador${
          openShift ? ` (IPV ${openShift.session_code})` : ''
        }`,
        createdBy: user.id,
        lines: [
          { account: NCIF_ACCOUNTS.INV_KIOSKO, debit: totalCost },
          { account: NCIF_ACCOUNTS.INV_ALMACEN, credit: totalCost },
        ],
      })
    : null;

  if (newWh <= product.warehouse_min_stock) {
    logAutomation(
      db,
      'ALMACEN',
      'ALERTA',
      `Punto de compra a proveedor: ${product.name}`,
      `Stock en Almacén bajó a ${newWh} ${product.unit} (mínimo ${product.warehouse_min_stock}). Programar reposición mayorista.`,
      product.sku
    );
  }

  logAudit(
    db,
    user,
    'DESPACHO_SC209',
    'Almacén',
    `${docNumber}: Transferidos ${qty} ${product.unit} de ${product.name} al Kiosko (nuevo stock mostrador: ${newKiosk}).`
  );

  return {
    doc_number: docNumber,
    product_name: product.name,
    quantity: qty,
    new_warehouse_stock: newWh,
    new_kiosk_stock: newKiosk,
    ipv_updated: Boolean(openShift),
    journal_entry: journal?.entryNumber || null,
  };
}

router.post('/transfers', requireAuth, requirePermission('warehouse', 'canEdit'), (req, res) => {
  const db = getDb();
  const { product_id, quantity, reason } = req.body || {};
  try {
    const out = runInTransaction(db, () =>
      executeKioskTransfer(db, {
        productId: Number(product_id),
        quantity: Number(quantity),
        reason,
        user: req.user,
      })
    );
    res.status(201).json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/restock-requests', requireAuth, (_req, res) => {
  const db = getDb();
  const requests = db
    .prepare(
      `SELECT rr.*, p.sku, p.name AS product_name, p.unit, p.kiosk_stock, p.kiosk_min_stock,
              p.kiosk_target_stock, p.warehouse_stock, p.current_batch, p.next_expiry_date,
              u1.full_name AS requested_by_name, u2.full_name AS fulfilled_by_name,
              im.doc_number AS movement_doc
       FROM restock_requests rr
       JOIN products p ON p.id = rr.product_id
       LEFT JOIN users u1 ON u1.id = rr.requested_by
       LEFT JOIN users u2 ON u2.id = rr.fulfilled_by
       LEFT JOIN inventory_movements im ON im.id = rr.movement_id
       ORDER BY CASE rr.status WHEN 'PENDIENTE' THEN 0 ELSE 1 END,
                CASE rr.priority WHEN 'URGENTE' THEN 0 ELSE 1 END,
                rr.id DESC
       LIMIT 50`
    )
    .all();
  res.json({ requests });
});

router.post('/restock-requests', requireAuth, requireRole('vendedor', 'almacenero', 'jefe'), (req, res) => {
  const db = getDb();
  const cfg = getConfig(db);
  if (req.user.role === 'vendedor' && cfg.permissions?.vendedor_request_restock === false) {
    return res
      .status(403)
      .json({ error: 'El creador de la empresa desactivó las solicitudes manuales de reabastecimiento para vendedores.' });
  }
  const { product_id, quantity, notes } = req.body || {};
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(product_id));
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });

  const suggested = roundCup(
    Number(quantity) > 0 ? Number(quantity) : Math.max(1, product.kiosk_target_stock - product.kiosk_stock)
  );

  const existing = db
    .prepare(`SELECT id FROM restock_requests WHERE product_id = ? AND status = 'PENDIENTE'`)
    .get(product.id);
  if (existing) {
    db.prepare(
      `UPDATE restock_requests SET suggested_qty = ?, priority = 'URGENTE', notes = ?, requested_by = ? WHERE id = ?`
    ).run(suggested, String(notes || 'Solicitado desde mostrador por vendedor').trim(), req.user.id, existing.id);
    return res.json({ id: existing.id, updated: true });
  }

  const r = db
    .prepare(
      `INSERT INTO restock_requests (product_id, suggested_qty, origin, priority, status, notes, requested_by)
       VALUES (?, ?, 'VENDEDOR', 'URGENTE', 'PENDIENTE', ?, ?)`
    )
    .run(
      product.id,
      suggested,
      String(notes || `Pedido urgente desde mostrador por ${req.user.full_name}`).trim(),
      req.user.id
    );

  logAudit(
    db,
    req.user,
    'PEDIDO_ALMACEN',
    'Turnos y POS',
    `Solicitados ${suggested} ${product.unit} de ${product.name} al Almacenero.`
  );
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.post(
  '/restock-requests/:id/fulfill',
  requireAuth,
  requireRole('almacenero', 'jefe'),
  (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const rr = db.prepare(`SELECT * FROM restock_requests WHERE id = ? AND status = 'PENDIENTE'`).get(id);
    if (!rr) return res.status(404).json({ error: 'Orden de reabastecimiento no encontrada o ya atendida.' });

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(rr.product_id);
    const qty = roundCup(
      req.body?.quantity ? Number(req.body.quantity) : Math.min(rr.suggested_qty, product.warehouse_stock)
    );

    try {
      const out = runInTransaction(db, () =>
        executeKioskTransfer(db, {
          productId: rr.product_id,
          quantity: qty,
          reason: `Despacho automático de orden #${rr.id} (${rr.origin})`,
          user: req.user,
          restockRequestId: rr.id,
        })
      );
      res.json(out);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

router.post(
  '/restock-requests/fulfill-all',
  requireAuth,
  requireRole('almacenero', 'jefe'),
  (req, res) => {
    const db = getDb();
    const pending = db
      .prepare(
        `SELECT rr.*, p.warehouse_stock
         FROM restock_requests rr
         JOIN products p ON p.id = rr.product_id
         WHERE rr.status = 'PENDIENTE' AND p.warehouse_stock > 0
         ORDER BY rr.id ASC`
      )
      .all();

    if (pending.length === 0) {
      return res
        .status(400)
        .json({ error: 'No hay órdenes pendientes con stock disponible en Almacén para despachar.' });
    }

    try {
      const dispatched = runInTransaction(db, () =>
        pending.map((rr) =>
          executeKioskTransfer(db, {
            productId: rr.product_id,
            quantity: Math.min(rr.suggested_qty, rr.warehouse_stock),
            reason: `Despacho automatizado masivo (Orden #${rr.id})`,
            user: req.user,
            restockRequestId: rr.id,
          })
        )
      );
      res.json({ count: dispatched.length, dispatched });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * SC-2-16: Reporte de Merma / Rotura / Vencimiento (requires Económico or Jefe approval per Res. 60/22)
 */
router.post('/mermas', requireAuth, (req, res) => {
  const privacy = getWarehousePrivacy(req.user);
  if (!privacy.canRegisterMermas && req.user.role !== 'jefe') {
    return res.status(403).json({ error: 'Su usuario no tiene permiso para reportar mermas o roturas.' });
  }
  const db = getDb();
  const { product_id, quantity, location, reason } = req.body || {};
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(product_id));
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });

  const qty = roundCup(quantity);
  const loc = location === 'KIOSKO' ? 'KIOSKO' : 'ALMACEN';
  if (req.user.role === 'vendedor' && loc !== 'KIOSKO') {
    return res.status(403).json({ error: 'Los vendedores solo pueden reportar mermas del mostrador del kiosko.' });
  }
  if (qty <= 0 || !reason?.trim()) {
    return res.status(400).json({ error: 'Indique cantidad mayor que cero y causa detallada para el acta SC-2-16.' });
  }
  const available = loc === 'KIOSKO' ? product.kiosk_stock : product.warehouse_stock;
  if (qty > available) {
    return res
      .status(400)
      .json({ error: `La cantidad (${qty}) supera la existencia en ${loc} (${available} ${product.unit}).` });
  }

  const docNumber = nextDocCode(db, 'inventory_movements', 'doc_number', 'SC216', 4);
  const totalCost = roundCup(qty * product.unit_cost_cup);
  const taggedReason = `[${loc}] ${String(reason).trim()}`;

  const r = db
    .prepare(
      `INSERT INTO inventory_movements
       (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
        warehouse_balance_after, kiosk_balance_after, batch_code, expiry_date, reason, created_by)
       VALUES (?, 'MERMA', 'PENDIENTE_APROBACION', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      docNumber,
      product.id,
      qty,
      product.unit_cost_cup,
      totalCost,
      product.warehouse_stock,
      product.kiosk_stock,
      product.current_batch || '',
      product.next_expiry_date || '',
      taggedReason,
      req.user.id
    );

  logAutomation(
    db,
    'ALMACEN',
    'ALERTA',
    `Acta de Merma ${docNumber} enviada a aprobación`,
    `${qty} ${product.unit} de ${product.name} (${totalCost.toFixed(2)} CUP) en ${loc}. Requiere firma de Económico o Jefe (Res. 60/22).`,
    docNumber
  );
  logAudit(db, req.user, 'REPORTE_MERMA_SC216', 'Almacén', `${docNumber}: ${taggedReason}`);

  res.status(201).json({ id: Number(r.lastInsertRowid), doc_number: docNumber });
});

router.post('/mermas/:id/decide', requireAuth, requirePermission('warehouse', 'canApprove'), (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  if (req.user.role === 'economico' && config.permissions?.economico_approve_mermas === false) {
    return res
      .status(403)
      .json({ error: 'Solo el creador/jefe de la empresa está autorizado para aprobar actas de merma en este negocio.' });
  }
  const id = Number(req.params.id);
  const decision = req.body?.decision === 'RECHAZAR' ? 'RECHAZADO' : 'APLICADO';

  const mov = db
    .prepare(`SELECT * FROM inventory_movements WHERE id = ? AND status = 'PENDIENTE_APROBACION'`)
    .get(id);
  if (!mov) return res.status(404).json({ error: 'Acta SC-2-16 no encontrada o ya procesada.' });

  if (decision === 'RECHAZADO') {
    db.prepare(
      `UPDATE inventory_movements SET status = 'RECHAZADO', approved_by = ?, approved_at = datetime('now') WHERE id = ?`
    ).run(req.user.id, id);
    logAudit(db, req.user, 'RECHAZO_MERMA', 'Economía', `Rechazada merma ${mov.doc_number}.`);
    return res.json({ status: 'RECHAZADO', doc_number: mov.doc_number });
  }

  try {
    const out = runInTransaction(db, () => {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(mov.product_id);
      const fromKiosk = String(mov.reason || '').startsWith('[KIOSKO]');
      let newWh = product.warehouse_stock;
      let newKiosk = product.kiosk_stock;

      if (fromKiosk) {
        if (mov.quantity > product.kiosk_stock) {
          throw new Error('Stock actual en mostrador insuficiente para aplicar la merma.');
        }
        newKiosk = roundCup(product.kiosk_stock - mov.quantity);
      } else {
        if (mov.quantity > product.warehouse_stock) {
          throw new Error('Stock actual en almacén insuficiente para aplicar la merma.');
        }
        newWh = roundCup(product.warehouse_stock - mov.quantity);
      }

      db.prepare(
        `UPDATE products SET warehouse_stock = ?, kiosk_stock = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(newWh, newKiosk, product.id);

      db.prepare(
        `UPDATE inventory_movements
         SET status = 'APLICADO', warehouse_balance_after = ?, kiosk_balance_after = ?,
             approved_by = ?, approved_at = datetime('now')
         WHERE id = ?`
      ).run(newWh, newKiosk, req.user.id, id);

      if (fromKiosk) {
        const openShift = db.prepare(`SELECT id FROM shift_sessions WHERE status = 'ABIERTO' LIMIT 1`).get();
        if (openShift) {
          db.prepare(
            `UPDATE shift_ipv_snapshots
             SET losses_qty = ROUND(losses_qty + ?, 2),
                 closing_qty = ROUND(closing_qty - ?, 2)
             WHERE shift_session_id = ? AND product_id = ?`
          ).run(mov.quantity, mov.quantity, openShift.id, product.id);
        }
        checkAndTriggerAutoRestock(db, product.id);
      }

      const journal = config.auto_accounting_enabled
        ? postJournalEntry(db, {
            entryDate: getTodayIso(),
            sourceType: 'MERMA',
            sourceRef: mov.doc_number,
            description: `Baja por Merma aprobada ${mov.doc_number}: ${mov.quantity} ${product.unit} de ${product.name}`,
            createdBy: req.user.id,
            lines: [
              { account: NCIF_ACCOUNTS.GASTOS_VENTAS, debit: mov.total_cost_cup },
              {
                account: fromKiosk ? NCIF_ACCOUNTS.INV_KIOSKO : NCIF_ACCOUNTS.INV_ALMACEN,
                credit: mov.total_cost_cup,
              },
            ],
          })
        : null;

      logAudit(
        db,
        req.user,
        'APROBACION_MERMA',
        'Economía',
        `Aprobada y contabilizada merma ${mov.doc_number} por ${mov.total_cost_cup.toFixed(2)} CUP.`
      );

      return { status: 'APLICADO', doc_number: mov.doc_number, journal_entry: journal?.entryNumber || null };
    });

    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/movements', requireAuth, requirePermission('warehouse', 'canView'), (req, res) => {
  const db = getDb();
  const privacy = getWarehousePrivacy(req.user);
  const { product_id, type } = req.query;
  const clauses = [];
  const params = [];
  if (product_id) {
    clauses.push('im.product_id = ?');
    params.push(Number(product_id));
  }
  if (type) {
    clauses.push('im.type = ?');
    params.push(String(type));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rawMovements = db
    .prepare(
      `SELECT im.*, p.sku, p.name AS product_name, p.unit,
              u1.full_name AS created_by_name, u2.full_name AS approved_by_name
       FROM inventory_movements im
       JOIN products p ON p.id = im.product_id
       LEFT JOIN users u1 ON u1.id = im.created_by
       LEFT JOIN users u2 ON u2.id = im.approved_by
       ${where}
       ORDER BY im.id DESC
       LIMIT 120`
    )
    .all(...params);

  const movements = privacy.canViewEntryCost
    ? rawMovements
    : rawMovements.map((m) => ({
        ...m,
        unit_cost_cup: null,
        total_cost_cup: null,
        supplier_name: '',
        supplier_nit: '',
        invoice_number: '',
      }));

  res.json({ movements });
});

export default router;
