import { Router } from 'express';
import { getDb, nextDocCode, roundCup, runInTransaction } from '../db.js';
import { logAudit, logAutomation, requireAuth, requireRole } from '../auth.js';
import { getCompanyByCode, getCompanyDb } from '../platform.js';
import {
  NCIF_ACCOUNTS,
  calculateCostSheet,
  checkAndTriggerAutoRestock,
  getConfig,
  getTodayIso,
  postJournalEntry,
  validateProposedPrice,
} from '../cubanLawEngine.js';
import {
  buildWhatsappUrl,
  formatCustomerReplyWhatsapp,
  formatOrderWhatsappMessage,
  sanitizeWhatsappDigits,
} from '../../src/lib/whatsapp.js';

export const publicCatalogRouter = Router();
export const adminCatalogRouter = Router();

function computeAvailableStock(prod, config) {
  const source = config.catalog_stock_source || 'BOTH';
  if (source === 'KIOSKO') return Math.max(0, roundCup(prod.kiosk_stock));
  return Math.max(0, roundCup(Number(prod.kiosk_stock || 0) + Number(prod.warehouse_stock || 0)));
}

function resolveStoreWhatsapp(config) {
  return String(config.whatsapp_phone || config.transfermovil_phone || '').trim();
}

function buildPublicCatalogPayload(db, company) {
  const config = getConfig(db);
  const whatsappPhone = resolveStoreWhatsapp(config);
  const rawProducts = db
    .prepare(
      `SELECT id, sku, name, category, compatibility, unit, sale_price_cup, kiosk_stock, warehouse_stock,
              catalog_visible, catalog_featured, catalog_description, image_url, next_expiry_date
       FROM products
       WHERE active = 1 AND catalog_visible = 1
       ORDER BY catalog_featured DESC, category ASC, name ASC`
    )
    .all();

  const today = getTodayIso();
  const products = rawProducts
    .filter((p) => !p.next_expiry_date || p.next_expiry_date >= today)
    .map((p) => {
      const available = computeAvailableStock(p, config);
      const inStock = available > 0 || Boolean(config.catalog_allow_backorder);
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        compatibility: p.compatibility || '',
        unit: p.unit,
        sale_price_cup: roundCup(p.sale_price_cup),
        available_stock: available,
        show_stock_qty: Boolean(config.catalog_show_stock_qty),
        stock_label: available > 0 ? 'Disponible' : config.catalog_allow_backorder ? 'Por encargo' : 'Agotado',
        in_stock: inStock,
        catalog_featured: Boolean(p.catalog_featured),
        catalog_description: p.catalog_description || '',
        image_url: p.image_url || '',
      };
    })
    .filter((p) => p.in_stock || Boolean(config.catalog_show_out_of_stock));

  const categories = Array.from(new Set(products.map((p) => p.category)));

  return {
    store: {
      company_code: company?.company_code || config.company_code,
      business_name: config.business_name,
      business_type: config.business_type || 'Kiosko y Comercio',
      catalog_enabled: config.catalog_enabled !== 0 && config.modules?.catalog !== false,
      whatsapp_phone: whatsappPhone,
      whatsapp_digits: sanitizeWhatsappDigits(whatsappPhone),
      catalog_welcome:
        config.catalog_welcome ||
        'Elige tus productos, arma tu pedido y envíalo directo a nuestro WhatsApp.',
      catalog_hours: config.catalog_hours || 'Todos los días · 7:00 a 22:00',
      address: config.address || '',
      municipality: config.municipality || '',
      province: config.province || '',
      catalog_allow_pickup: Boolean(config.catalog_allow_pickup ?? 1),
      catalog_allow_delivery: Boolean(config.catalog_allow_delivery ?? 1),
      catalog_delivery_fee_cup: roundCup(config.catalog_delivery_fee_cup ?? 0),
      catalog_free_delivery_from_cup: roundCup(config.catalog_free_delivery_from_cup ?? 0),
      catalog_min_order_cup: roundCup(config.catalog_min_order_cup ?? 0),
      catalog_show_out_of_stock: Boolean(config.catalog_show_out_of_stock ?? 1),
      catalog_show_stock_qty: Boolean(config.catalog_show_stock_qty ?? 0),
      catalog_allow_backorder: Boolean(config.catalog_allow_backorder ?? 0),
      qr_discount_pct: roundCup(config.qr_discount_pct ?? 0),
      has_transfermovil: Boolean(config.transfermovil_merchant_code || config.transfermovil_phone),
      has_enzona: Boolean(config.enzona_merchant_code),
    },
    categories,
    products,
  };
}

function hydrateOrders(db, limit = 80) {
  const orders = db
    .prepare(
      `SELECT co.*, s.receipt_number, u.full_name AS handled_by_name
       FROM customer_orders co
       LEFT JOIN sales s ON s.id = co.sale_id
       LEFT JOIN users u ON u.id = co.handled_by
       ORDER BY
         CASE co.status
           WHEN 'NUEVO' THEN 0
           WHEN 'PREPARANDO' THEN 1
           WHEN 'LISTO' THEN 2
           WHEN 'ENTREGADO' THEN 3
           ELSE 4
         END ASC,
         co.id DESC
       LIMIT ?`
    )
    .all(limit);

  if (orders.length === 0) return [];
  const itemStmt = db.prepare(`SELECT * FROM customer_order_items WHERE order_id = ? ORDER BY id ASC`);
  const config = getConfig(db);

  return orders.map((o) => {
    const items = itemStmt.all(o.id);
    const nextStatus =
      o.status === 'NUEVO'
        ? 'PREPARANDO'
        : o.status === 'PREPARANDO'
        ? 'LISTO'
        : o.status === 'LISTO'
        ? 'ENTREGADO'
        : o.status;
    const replyText = formatCustomerReplyWhatsapp({
      order: o,
      store: { business_name: config.business_name },
      status: nextStatus,
    });
    return {
      ...o,
      items,
      customer_whatsapp_url: o.customer_phone ? buildWhatsappUrl(o.customer_phone, replyText) : '',
    };
  });
}

// ============================================================================
// PUBLIC CUSTOMER STOREFRONT ENDPOINTS (No login required)
// ============================================================================

publicCatalogRouter.get('/:code', (req, res) => {
  const company = getCompanyByCode(req.params.code);
  if (!company) {
    return res.status(404).json({
      error: 'No encontramos un catálogo con ese código. Verifica el enlace con el comercio.',
    });
  }
  const db = getCompanyDb(company.id);
  const payload = buildPublicCatalogPayload(db, company);
  res.json(payload);
});

publicCatalogRouter.post('/:code/orders', (req, res) => {
  const company = getCompanyByCode(req.params.code);
  if (!company) {
    return res.status(404).json({ error: 'Comercio no encontrado.' });
  }
  const db = getCompanyDb(company.id);
  const config = getConfig(db);

  if (config.catalog_enabled === 0 || config.modules?.catalog === false) {
    return res.status(403).json({
      error: 'Este comercio tiene pausada la recepción de pedidos en este momento.',
    });
  }

  const body = req.body || {};
  const customerName = String(body.customer_name || '').trim();
  const customerPhone = String(body.customer_phone || '').trim();
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const notes = String(body.notes || '').trim().slice(0, 400);

  if (!customerName || customerName.length < 2) {
    return res.status(400).json({ error: 'Escribe tu nombre para identificar tu pedido.' });
  }
  if (rawItems.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un producto a tu pedido.' });
  }

  let deliveryMode = String(body.delivery_mode || 'RETIRO').toUpperCase() === 'DOMICILIO' ? 'DOMICILIO' : 'RETIRO';
  if (deliveryMode === 'DOMICILIO' && !config.catalog_allow_delivery) deliveryMode = 'RETIRO';
  if (deliveryMode === 'RETIRO' && !config.catalog_allow_pickup && config.catalog_allow_delivery) {
    deliveryMode = 'DOMICILIO';
  }

  const deliveryAddress = deliveryMode === 'DOMICILIO' ? String(body.delivery_address || '').trim() : '';
  if (deliveryMode === 'DOMICILIO' && deliveryAddress.length < 4) {
    return res.status(400).json({ error: 'Indica tu dirección o referencia para el envío a domicilio.' });
  }

  const rawPay = String(body.payment_method || 'EFECTIVO').toUpperCase();
  const paymentMethod = ['EFECTIVO', 'TRANSFERMOVIL', 'ENZONA'].includes(rawPay) ? rawPay : 'EFECTIVO';

  try {
    const created = runInTransaction(db, () => {
      let subtotal = 0;
      const resolvedItems = [];

      for (const raw of rawItems) {
        const pid = Number(raw.product_id);
        const qty = roundCup(raw.quantity);
        if (!pid || qty <= 0) continue;

        const prod = db
          .prepare('SELECT * FROM products WHERE id = ? AND active = 1 AND catalog_visible = 1')
          .get(pid);
        if (!prod) {
          throw new Error('Uno de los productos seleccionados ya no está disponible en el catálogo.');
        }

        const available = computeAvailableStock(prod, config);
        if (!config.catalog_allow_backorder && qty > available + 0.0001) {
          throw new Error(
            `De "${prod.name}" quedan ${available} ${prod.unit} disponibles. Ajusta la cantidad para continuar.`
          );
        }

        const lineSub = roundCup(prod.sale_price_cup * qty);
        subtotal = roundCup(subtotal + lineSub);
        resolvedItems.push({
          product_id: prod.id,
          product_name: prod.name,
          unit: prod.unit,
          quantity: qty,
          unit_price_cup: roundCup(prod.sale_price_cup),
          subtotal_cup: lineSub,
        });
      }

      if (resolvedItems.length === 0) {
        throw new Error('Selecciona al menos un producto válido.');
      }

      const minOrder = roundCup(config.catalog_min_order_cup || 0);
      if (minOrder > 0 && subtotal < minOrder - 0.01) {
        throw new Error(`El pedido mínimo en este comercio es de ${minOrder} CUP.`);
      }

      const isQr = paymentMethod === 'TRANSFERMOVIL' || paymentMethod === 'ENZONA';
      const discountCup =
        isQr && Number(config.qr_discount_pct) > 0
          ? roundCup((subtotal * Number(config.qr_discount_pct)) / 100)
          : 0;

      let deliveryFeeCup = 0;
      if (deliveryMode === 'DOMICILIO') {
        const baseFee = roundCup(config.catalog_delivery_fee_cup || 0);
        const freeFrom = roundCup(config.catalog_free_delivery_from_cup || 0);
        deliveryFeeCup = freeFrom > 0 && subtotal >= freeFrom ? 0 : baseFee;
      }

      const totalCup = roundCup(Math.max(0, subtotal - discountCup + deliveryFeeCup));
      const cashTendered =
        paymentMethod === 'EFECTIVO' && Number(body.cash_tendered_cup) > 0
          ? roundCup(body.cash_tendered_cup)
          : 0;

      const orderCode = nextDocCode(db, 'customer_orders', 'order_code', 'PED', 4);
      const orderDraft = {
        order_code: orderCode,
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
      };

      const whatsappPhone = resolveStoreWhatsapp(config);
      const whatsappText = formatOrderWhatsappMessage({
        order: orderDraft,
        items: resolvedItems,
        store: { business_name: config.business_name, currency: 'CUP' },
      });
      const whatsappUrl = buildWhatsappUrl(whatsappPhone, whatsappText);

      const ins = db
        .prepare(
          `INSERT INTO customer_orders
           (order_code, status, customer_name, customer_phone, delivery_mode, delivery_address,
            payment_method, cash_tendered_cup, notes, subtotal_cup, discount_cup, delivery_fee_cup,
            total_cup, whatsapp_text, source)
           VALUES (?, 'NUEVO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CATALOGO')`
        )
        .run(
          orderCode,
          customerName,
          customerPhone,
          deliveryMode,
          deliveryAddress,
          paymentMethod,
          cashTendered,
          notes,
          subtotal,
          discountCup,
          deliveryFeeCup,
          totalCup,
          whatsappText
        );
      const orderId = Number(ins.lastInsertRowid);

      const insItem = db.prepare(
        `INSERT INTO customer_order_items
         (order_id, product_id, product_name, unit, quantity, unit_price_cup, subtotal_cup)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of resolvedItems) {
        insItem.run(
          orderId,
          it.product_id,
          it.product_name,
          it.unit,
          it.quantity,
          it.unit_price_cup,
          it.subtotal_cup
        );
      }

      logAutomation(
        db,
        'WHATSAPP',
        'INFO',
        `Nuevo pedido ${orderCode} desde el catálogo (${customerName})`,
        `${resolvedItems.length} producto(s) · ${deliveryMode === 'DOMICILIO' ? 'Envío a domicilio' : 'Retiro en local'} · Total ${totalCup.toFixed(2)} CUP (${paymentMethod}).`,
        orderCode
      );

      const savedOrder = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(orderId);
      return {
        order: savedOrder,
        items: resolvedItems,
        whatsapp_phone: whatsappPhone,
        has_store_whatsapp: sanitizeWhatsappDigits(whatsappPhone).length >= 7,
        whatsapp_text: whatsappText,
        whatsapp_url: whatsappUrl,
      };
    });

    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// AUTHENTICATED WORKSPACE CATALOG & WHATSAPP ORDERS ENDPOINTS
// ============================================================================

adminCatalogRouter.get('/overview', requireAuth, (req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const canViewCosts =
    req.user.role === 'jefe' || Boolean(req.user.permissions_matrix?.flags?.view_costs);
  const orders = hydrateOrders(db, 80);
  const products = db
    .prepare(
      `SELECT id, sku, name, category, compatibility, unit, unit_cost_cup, sale_price_cup,
              is_price_capped, price_cap_cup, kiosk_stock, warehouse_stock,
              catalog_visible, catalog_featured, catalog_description, image_url
       FROM products
       WHERE active = 1
       ORDER BY catalog_featured DESC, category ASC, name ASC`
    )
    .all()
    .map((p) => {
      const available = computeAvailableStock(p, config);
      return {
        ...p,
        compatibility: p.compatibility || '',
        unit_cost_cup: canViewCosts ? p.unit_cost_cup : null,
        available_stock: available,
        in_stock: available > 0,
        catalog_visible: Boolean(p.catalog_visible),
        catalog_featured: Boolean(p.catalog_featured),
      };
    });

  const publicPreview = buildPublicCatalogPayload(db, req.company);
  const whatsappPhone = resolveStoreWhatsapp(config);
  const activeOrders = orders.filter((o) => ['NUEVO', 'PREPARANDO', 'LISTO'].includes(o.status));
  const deliveredOrders = orders.filter((o) => o.status === 'ENTREGADO');

  res.json({
    company_code: req.company?.company_code || config.company_code,
    settings: {
      business_name: config.business_name,
      whatsapp_phone: whatsappPhone,
      whatsapp_digits: sanitizeWhatsappDigits(whatsappPhone),
      catalog_enabled: Boolean(config.catalog_enabled ?? 1),
      catalog_welcome: config.catalog_welcome || '',
      catalog_hours: config.catalog_hours || '',
      catalog_allow_pickup: Boolean(config.catalog_allow_pickup ?? 1),
      catalog_allow_delivery: Boolean(config.catalog_allow_delivery ?? 1),
      catalog_delivery_fee_cup: roundCup(config.catalog_delivery_fee_cup ?? 0),
      catalog_free_delivery_from_cup: roundCup(config.catalog_free_delivery_from_cup ?? 0),
      catalog_min_order_cup: roundCup(config.catalog_min_order_cup ?? 0),
      catalog_show_out_of_stock: Boolean(config.catalog_show_out_of_stock ?? 1),
      catalog_show_stock_qty: Boolean(config.catalog_show_stock_qty ?? 0),
      catalog_allow_backorder: Boolean(config.catalog_allow_backorder ?? 0),
      catalog_stock_source: config.catalog_stock_source || 'BOTH',
      qr_discount_pct: roundCup(config.qr_discount_pct ?? 0),
      address: config.address || '',
    },
    stats: {
      new_count: orders.filter((o) => o.status === 'NUEVO').length,
      active_count: activeOrders.length,
      delivered_count: deliveredOrders.length,
      delivered_total_cup: roundCup(deliveredOrders.reduce((s, o) => s + Number(o.total_cup || 0), 0)),
      visible_products: products.filter((p) => p.catalog_visible).length,
      total_products: products.length,
      featured_products: products.filter((p) => p.catalog_visible && p.catalog_featured).length,
    },
    orders,
    products,
    public_preview: publicPreview,
  });
});

adminCatalogRouter.put('/settings', requireAuth, requireRole('jefe', 'economico'), (req, res) => {
  const db = getDb();
  const current = getConfig(db);
  if (req.user.role === 'economico' && current.permissions?.economico_manage_config === false) {
    return res.status(403).json({ error: 'Solo el creador puede cambiar la configuración del catálogo.' });
  }
  const b = req.body || {};

  const pickBool = (k) => (b[k] !== undefined ? (b[k] ? 1 : 0) : current[k] ? 1 : 0);
  const whatsappPhone =
    b.whatsapp_phone !== undefined ? String(b.whatsapp_phone).trim() : current.whatsapp_phone;
  const welcome =
    b.catalog_welcome !== undefined ? String(b.catalog_welcome).trim() : current.catalog_welcome;
  const hours = b.catalog_hours !== undefined ? String(b.catalog_hours).trim() : current.catalog_hours;
  const address = b.address !== undefined ? String(b.address).trim() : current.address;
  const stockSource =
    b.catalog_stock_source === 'KIOSKO' || b.catalog_stock_source === 'BOTH'
      ? b.catalog_stock_source
      : current.catalog_stock_source || 'BOTH';

  const allowPickup = pickBool('catalog_allow_pickup');
  const allowDelivery = pickBool('catalog_allow_delivery');
  if (!allowPickup && !allowDelivery) {
    return res
      .status(400)
      .json({ error: 'Deja activa al menos una forma de entrega (Retiro en local o Envío a domicilio).' });
  }

  db.prepare(
    `UPDATE business_config
     SET whatsapp_phone = ?,
         address = ?,
         catalog_enabled = ?,
         catalog_welcome = ?,
         catalog_hours = ?,
         catalog_allow_pickup = ?,
         catalog_allow_delivery = ?,
         catalog_delivery_fee_cup = ?,
         catalog_free_delivery_from_cup = ?,
         catalog_min_order_cup = ?,
         catalog_show_out_of_stock = ?,
         catalog_show_stock_qty = ?,
         catalog_allow_backorder = ?,
         catalog_stock_source = ?,
         updated_at = datetime('now')
     WHERE id = 1`
  ).run(
    whatsappPhone,
    address,
    pickBool('catalog_enabled'),
    welcome,
    hours,
    allowPickup,
    allowDelivery,
    Math.max(0, roundCup(b.catalog_delivery_fee_cup ?? current.catalog_delivery_fee_cup ?? 0)),
    Math.max(0, roundCup(b.catalog_free_delivery_from_cup ?? current.catalog_free_delivery_from_cup ?? 0)),
    Math.max(0, roundCup(b.catalog_min_order_cup ?? current.catalog_min_order_cup ?? 0)),
    pickBool('catalog_show_out_of_stock'),
    pickBool('catalog_show_stock_qty'),
    pickBool('catalog_allow_backorder'),
    stockSource
  );

  logAudit(
    db,
    req.user,
    'CONFIG_CATALOGO_WHATSAPP',
    'Catálogo',
    `Actualizado catálogo y WhatsApp de pedidos (${whatsappPhone || 'sin número'}).`
  );

  res.json({ config: getConfig(db) });
});

adminCatalogRouter.put('/products/:id', requireAuth, (req, res) => {
  const canPublish =
    req.user.role === 'jefe' ||
    Boolean(req.user.permissions_matrix?.flags?.publish_catalog) ||
    Boolean(req.user.permissions_matrix?.flags?.upload_photos) ||
    Boolean(req.user.permissions_matrix?.items?.['catalog-wa']?.canEdit);
  if (!canPublish) {
    return res
      .status(403)
      .json({ error: 'Su usuario no tiene permiso para editar productos del catálogo.' });
  }
  const db = getDb();
  const config = getConfig(db);
  const id = Number(req.params.id);
  const prod = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado.' });

  const b = req.body || {};
  const nextVisible = b.catalog_visible !== undefined ? (b.catalog_visible ? 1 : 0) : prod.catalog_visible;
  const nextFeatured =
    b.catalog_featured !== undefined ? (b.catalog_featured ? 1 : 0) : prod.catalog_featured;
  const nextDesc =
    b.catalog_description !== undefined
      ? String(b.catalog_description).trim().slice(0, 320)
      : prod.catalog_description;
  const nextCompat =
    b.compatibility !== undefined
      ? String(b.compatibility).trim().slice(0, 260)
      : prod.compatibility || '';
  let nextImg = prod.image_url || '';
  if (b.image_url !== undefined) {
    const rawImg = String(b.image_url).trim();
    if (rawImg.length > 750000) {
      return res.status(400).json({ error: 'La foto supera el tamaño máximo (comprímala a ≤800×800 WebP/JPEG).' });
    }
    if (
      rawImg &&
      !rawImg.startsWith('data:image/') &&
      !rawImg.startsWith('https://') &&
      !rawImg.startsWith('http://') &&
      !rawImg.startsWith('/')
    ) {
      return res.status(400).json({ error: 'Formato de foto no admitido.' });
    }
    nextImg = rawImg;
  }
  const nextName = b.name !== undefined && String(b.name).trim() ? String(b.name).trim() : prod.name;
  const nextCategory =
    b.category !== undefined && String(b.category).trim() ? String(b.category).trim() : prod.category;

  let nextPrice = prod.sale_price_cup;
  const canEditPrices =
    req.user.role === 'jefe' || Boolean(req.user.permissions_matrix?.flags?.edit_prices);
  if (b.sale_price_cup !== undefined && roundCup(b.sale_price_cup) !== roundCup(prod.sale_price_cup)) {
    if (!canEditPrices) {
      return res.status(403).json({
        error: 'Solo el Jefe o usuarios con permiso de precios pueden modificar el precio final.',
      });
    }
    const candidate = roundCup(b.sale_price_cup);
    if (candidate <= 0) return res.status(400).json({ error: 'El precio debe ser mayor que cero.' });
    const check = validateProposedPrice(prod, candidate, config);
    if (!check.ok && check.valid === false) return res.status(400).json({ error: check.message || check.error });
    if (check.error) return res.status(400).json({ error: check.error });
    nextPrice = candidate;
    db.prepare(
      `INSERT INTO price_change_requests
       (product_id, old_price_cup, new_price_cup, unit_cost_cup, full_cost_cup, margin_pct, reason, status, created_by, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'APLICADO', ?, ?)`
    ).run(
      id,
      prod.sale_price_cup,
      candidate,
      prod.unit_cost_cup,
      check.sheet?.full_cost_cup ?? prod.unit_cost_cup,
      check.sheet?.margin_pct ?? 0,
      'Actualización de precio desde Catálogo y Pedidos',
      req.user.id,
      req.user.id
    );
  }

  db.prepare(
    `UPDATE products
     SET name = ?, category = ?, compatibility = ?, sale_price_cup = ?,
         catalog_visible = ?, catalog_featured = ?, catalog_description = ?, image_url = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(nextName, nextCategory, nextCompat, nextPrice, nextVisible, nextFeatured, nextDesc, nextImg, id);

  logAudit(
    db,
    req.user,
    'CATALOGO_PRODUCTO',
    'Catálogo y Pedidos',
    `Actualizado ${prod.sku} — ${nextName} (visible=${nextVisible ? 'SÍ' : 'NO'}, precio=${nextPrice.toFixed(2)} CUP).`
  );

  const canViewCosts =
    req.user.role === 'jefe' || Boolean(req.user.permissions_matrix?.flags?.view_costs);
  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({
    product: {
      ...updated,
      unit_cost_cup: canViewCosts ? updated.unit_cost_cup : null,
      available_stock: computeAvailableStock(updated, config),
      in_stock: computeAvailableStock(updated, config) > 0,
      catalog_visible: Boolean(updated.catalog_visible),
      catalog_featured: Boolean(updated.catalog_featured),
    },
  });
});

// Super-intuitive 4-field product creator so shop owners add catalog & POS items effortlessly
adminCatalogRouter.post(
  '/products/quick',
  requireAuth,
  requireRole('jefe', 'almacenero', 'economico'),
  (req, res) => {
    const db = getDb();
    const config = getConfig(db);
    if (req.user.role === 'almacenero' && config.permissions?.almacenero_create_products === false) {
      return res.status(403).json({ error: 'Solo el creador puede dar de alta productos nuevos.' });
    }

    const b = req.body || {};
    const name = String(b.name || '').trim();
    const category = String(b.category || 'General').trim() || 'General';
    const unit = String(b.unit || 'u').trim() || 'u';
    const salePrice = roundCup(b.sale_price_cup);
    const initialStock = Math.max(0, roundCup(b.initial_stock ?? 20));
    const rawCost = Number(b.unit_cost_cup);
    // Auto-derive a sensible cost if left empty so the user never gets stuck on accounting math
    const unitCost =
      rawCost > 0 ? roundCup(rawCost) : roundCup(salePrice / ((1 + (config.indirect_cost_alloc_pct || 8) / 100) * 1.22));
    const description = String(b.catalog_description || '').trim().slice(0, 320);
    const compatibility = String(b.compatibility || '').trim().slice(0, 260);
    const rawImg = String(b.image_url || '').trim();
    if (rawImg.length > 750000) {
      return res.status(400).json({ error: 'La foto supera el límite (máx. 800×800 WebP/JPEG).' });
    }
    const imageUrl = rawImg;
    const featured = b.catalog_featured ? 1 : 0;

    if (!name) return res.status(400).json({ error: 'Escribe el nombre del producto.' });
    if (salePrice <= 0) return res.status(400).json({ error: 'Indica un precio de venta mayor que cero.' });

    const draftProd = {
      unit_cost_cup: unitCost,
      indirect_cost_pct: config.indirect_cost_alloc_pct || 8,
      sale_price_cup: salePrice,
      is_price_capped: 0,
      price_cap_cup: null,
      is_margin_regulated: config.strict_price_cap_block ? 1 : 0,
    };
    if (rawCost > 0 && config.strict_price_cap_block) {
      const sheet = calculateCostSheet(draftProd, config);
      if (sheet.exceeds_margin) {
        return res.status(400).json({
          error: `Con costo ${unitCost} CUP, el precio máximo permitido por tu regla de margen (${sheet.max_margin_pct}%) es ${sheet.max_legal_price_cup} CUP. Puedes subir el costo, ajustar el precio o desactivar el tope en Mi Empresa y Modo.`,
        });
      }
    }

    try {
      const product = runInTransaction(db, () => {
        const sku = nextDocCode(db, 'products', 'sku', 'CAT', 4);
        const ins = db
          .prepare(
            `INSERT INTO products
             (sku, name, category, compatibility, unit, unit_cost_cup, indirect_cost_pct, sale_price_cup,
              is_price_capped, is_margin_regulated, sales_tax_exempt,
              warehouse_stock, kiosk_stock, warehouse_min_stock, kiosk_min_stock, kiosk_target_stock,
              current_batch, catalog_visible, catalog_featured, catalog_description, image_url, active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, ?, 5, 3, 15, 'LT-CAT', 1, ?, ?, ?, 1)`
          )
          .run(
            sku,
            name,
            category,
            compatibility,
            unit,
            unitCost,
            config.indirect_cost_alloc_pct || 8,
            salePrice,
            config.strict_price_cap_block ? 1 : 0,
            initialStock,
            featured,
            description,
            imageUrl
          );
        const pid = Number(ins.lastInsertRowid);

        if (initialStock > 0) {
          const totalCost = roundCup(initialStock * unitCost);
          const doc = nextDocCode(db, 'inventory_movements', 'doc_number', 'INI', 4);
          db.prepare(
            `INSERT INTO inventory_movements
             (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
              warehouse_balance_after, kiosk_balance_after, supplier_name, payment_method, reason, created_by)
             VALUES (?, 'AJUSTE', 'APLICADO', ?, ?, ?, ?, 0, ?, 'Carga rápida de catálogo', 'EFECTIVO', 'Stock inicial en mostrador', ?)`
          ).run(doc, pid, initialStock, unitCost, totalCost, initialStock, req.user.id);

          // Add to open shift IPV snapshot if a shift is currently open
          const openShift = db
            .prepare(`SELECT id FROM shift_sessions WHERE status = 'ABIERTO' ORDER BY id DESC LIMIT 1`)
            .get();
          if (openShift) {
            db.prepare(
              `INSERT OR IGNORE INTO shift_ipv_snapshots
               (shift_session_id, product_id, opening_qty, entries_qty, losses_qty, sold_qty, closing_qty, sale_price_cup, sold_amount_cup)
               VALUES (?, ?, 0, ?, 0, 0, ?, ?, 0)`
            ).run(openShift.id, pid, initialStock, initialStock, salePrice);
          }

          if (config.auto_accounting_enabled && totalCost > 0) {
            postJournalEntry(db, {
              entryDate: getTodayIso(),
              sourceType: 'APERTURA',
              sourceRef: doc,
              description: `Alta rápida de producto en catálogo: ${name} (${initialStock} ${unit})`,
              createdBy: req.user.id,
              silent: true,
              lines: [
                { account: NCIF_ACCOUNTS.INV_KIOSKO, debit: totalCost },
                { account: NCIF_ACCOUNTS.CAPITAL_SOCIAL, credit: totalCost },
              ],
            });
          }
        }

        logAudit(
          db,
          req.user,
          'ALTA_RAPIDA_CATALOGO',
          'Catálogo',
          `Producto "${name}" agregado al catálogo y POS (${salePrice} CUP · stock ${initialStock} ${unit}).`
        );

        return db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
      });

      res.status(201).json({ product });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

adminCatalogRouter.put(
  '/orders/:id/status',
  requireAuth,
  requireRole('jefe', 'vendedor', 'almacenero'),
  (req, res) => {
    const db = getDb();
    const config = getConfig(db);
    if (req.user.role === 'vendedor' && config.permissions?.vendedor_manage_orders === false) {
      return res.status(403).json({ error: 'No tienes permiso para gestionar pedidos de WhatsApp.' });
    }

    const id = Number(req.params.id);
    const order = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });

    const nextStatus = String(req.body?.status || '').toUpperCase();
    if (!['NUEVO', 'PREPARANDO', 'LISTO', 'ENTREGADO', 'CANCELADO'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Estado de pedido no válido.' });
    }

    db.prepare(
      `UPDATE customer_orders
       SET status = ?, handled_by = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(nextStatus, req.user.id, id);

    const updated = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(id);
    const replyText = formatCustomerReplyWhatsapp({
      order: updated,
      store: { business_name: config.business_name },
      status: nextStatus,
    });

    res.json({
      order: updated,
      reply_text: replyText,
      customer_whatsapp_url: updated.customer_phone
        ? buildWhatsappUrl(updated.customer_phone, replyText)
        : '',
    });
  }
);

// 1-click: turn a WhatsApp catalog order into a real POS sale (stock + IPV + accounting!)
adminCatalogRouter.post(
  '/orders/:id/checkout',
  requireAuth,
  requireRole('jefe', 'vendedor'),
  (req, res) => {
    const db = getDb();
    const config = getConfig(db);
    if (req.user.role === 'vendedor' && config.permissions?.vendedor_manage_orders === false) {
      return res.status(403).json({ error: 'No tienes permiso para cobrar pedidos de WhatsApp.' });
    }

    const id = Number(req.params.id);
    const order = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (order.sale_id) {
      return res.status(400).json({ error: 'Este pedido ya fue cobrado y descontado del inventario.' });
    }
    if (order.status === 'CANCELADO') {
      return res.status(400).json({ error: 'No se puede cobrar un pedido cancelado.' });
    }

    const items = db.prepare('SELECT * FROM customer_order_items WHERE order_id = ?').all(id);
    if (items.length === 0) {
      return res.status(400).json({ error: 'El pedido no contiene productos.' });
    }

    const method = String(req.body?.payment_method || order.payment_method || 'EFECTIVO').toUpperCase();
    const electronicRef =
      String(req.body?.electronic_ref || '').trim() ||
      (method !== 'EFECTIVO' ? `WA-${order.order_code}` : '');

    try {
      const result = runInTransaction(db, () => {
        const today = getTodayIso();
        // Find open shift, or auto-open one seamlessly if owner/seller has permission!
        let session = db
          .prepare(`SELECT * FROM shift_sessions WHERE status = 'ABIERTO' ORDER BY id DESC LIMIT 1`)
          .get();

        if (!session) {
          if (req.user.role === 'jefe' && !config.owner_can_operate_pos) {
            throw new Error(
              'No hay un turno abierto en mostrador. Abre un turno en "Turnos y Arqueo" o activa "El creador puede cobrar" en Mi Empresa y Modo.'
            );
          }
          const tpl = db.prepare('SELECT * FROM shift_templates WHERE active = 1 ORDER BY id ASC LIMIT 1').get();
          const code = nextDocCode(db, 'shift_sessions', 'session_code', 'TRN', 4);
          const sRes = db
            .prepare(
              `INSERT INTO shift_sessions (session_code, shift_template_id, work_date, status, opened_by, notes)
               VALUES (?, ?, ?, 'ABIERTO', ?, 'Apertura automática al cobrar pedido de WhatsApp')`
            )
            .run(code, tpl.id, today, req.user.id);
          session = db.prepare('SELECT * FROM shift_sessions WHERE id = ?').get(Number(sRes.lastInsertRowid));

          // Snapshot IPV for all active products
          const allProds = db.prepare('SELECT id, kiosk_stock, sale_price_cup FROM products WHERE active = 1').all();
          const insSnap = db.prepare(
            `INSERT INTO shift_ipv_snapshots
             (shift_session_id, product_id, opening_qty, entries_qty, losses_qty, sold_qty, closing_qty, sale_price_cup, sold_amount_cup)
             VALUES (?, ?, ?, 0, 0, 0, ?, ?, 0)`
          );
          for (const p of allProds) {
            insSnap.run(session.id, p.id, p.kiosk_stock, p.kiosk_stock, p.sale_price_cup);
          }
        }

        let register =
          req.user.role === 'vendedor'
            ? db
                .prepare(
                  `SELECT * FROM shift_registers WHERE shift_session_id = ? AND seller_id = ? AND status = 'ABIERTA'`
                )
                .get(session.id, req.user.id)
            : db
                .prepare(
                  `SELECT * FROM shift_registers WHERE shift_session_id = ? AND status = 'ABIERTA' ORDER BY register_number ASC LIMIT 1`
                )
                .get(session.id);

        if (!register) {
          if (req.user.role === 'jefe' && !config.owner_can_operate_pos) {
            throw new Error('No hay ninguna caja abierta en el turno actual.');
          }
          const used = db
            .prepare('SELECT register_number FROM shift_registers WHERE shift_session_id = ?')
            .all(session.id)
            .map((r) => r.register_number);
          let regNum = 1;
          while (used.includes(regNum) && regNum <= (config.max_sellers_per_shift || 2)) regNum += 1;
          if (used.includes(regNum)) {
            throw new Error('No tienes una caja abierta en el turno actual.');
          }
          const openCash = roundCup(config.petty_cash_fund_cup || 0);
          const rRes = db
            .prepare(
              `INSERT INTO shift_registers
               (shift_session_id, register_number, seller_id, status, opening_cash_cup, expected_cash_cup)
               VALUES (?, ?, ?, 'ABIERTA', ?, ?)`
            )
            .run(session.id, regNum, req.user.id, openCash, openCash);
          register = db.prepare('SELECT * FROM shift_registers WHERE id = ?').get(Number(rRes.lastInsertRowid));
        }

        let totalCost = 0;
        let autoTransferredCost = 0;
        const resolved = [];

        for (const it of items) {
          if (!it.product_id) continue;
          const prod = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(it.product_id);
          if (!prod) {
            throw new Error(`El producto "${it.product_name}" ya no está activo.`);
          }
          const qty = roundCup(it.quantity);
          let kioskStock = roundCup(prod.kiosk_stock);
          let whStock = roundCup(prod.warehouse_stock);

          // Seamless auto-pull from warehouse if kiosk shelf is short but warehouse has it!
          if (qty > kioskStock + 0.0001) {
            const deficit = roundCup(qty - kioskStock);
            if (whStock + 0.0001 >= deficit) {
              whStock = roundCup(whStock - deficit);
              kioskStock = roundCup(kioskStock + deficit);
              const tCost = roundCup(deficit * prod.unit_cost_cup);
              autoTransferredCost = roundCup(autoTransferredCost + tCost);
              const tDoc = nextDocCode(db, 'inventory_movements', 'doc_number', 'SC209', 4);
              db.prepare(
                `UPDATE products SET warehouse_stock = ?, kiosk_stock = ?, updated_at = datetime('now') WHERE id = ?`
              ).run(whStock, kioskStock, prod.id);
              db.prepare(
                `INSERT INTO inventory_movements
                 (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
                  warehouse_balance_after, kiosk_balance_after, reason, shift_session_id, created_by)
                 VALUES (?, 'TRANSFERENCIA_KIOSKO', 'APLICADO', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                tDoc,
                prod.id,
                deficit,
                prod.unit_cost_cup,
                tCost,
                whStock,
                kioskStock,
                `Pase automático para cubrir pedido WhatsApp ${order.order_code}`,
                session.id,
                req.user.id
              );
              db.prepare(
                `UPDATE shift_ipv_snapshots
                 SET entries_qty = ROUND(entries_qty + ?, 2), closing_qty = ROUND(closing_qty + ?, 2)
                 WHERE shift_session_id = ? AND product_id = ?`
              ).run(deficit, deficit, session.id, prod.id);
            } else {
              throw new Error(
                `Stock insuficiente para "${prod.name}": pedido ${qty} ${prod.unit}, disponible ${roundCup(kioskStock + whStock)} ${prod.unit}.`
              );
            }
          }

          const lineCost = roundCup(prod.unit_cost_cup * qty);
          totalCost = roundCup(totalCost + lineCost);
          resolved.push({ prod: { ...prod, kiosk_stock: kioskStock, warehouse_stock: whStock }, item: it, qty, lineCost });
        }

        if (config.auto_accounting_enabled && autoTransferredCost > 0) {
          postJournalEntry(db, {
            entryDate: today,
            sourceType: 'TRASLADO',
            sourceRef: order.order_code,
            description: `Pase automático Almacén → Mostrador para pedido WhatsApp ${order.order_code}`,
            createdBy: req.user.id,
            silent: true,
            lines: [
              { account: NCIF_ACCOUNTS.INV_KIOSKO, debit: autoTransferredCost },
              { account: NCIF_ACCOUNTS.INV_ALMACEN, credit: autoTransferredCost },
            ],
          });
        }

        const grossRevenue = roundCup(Number(order.subtotal_cup || 0) + Number(order.delivery_fee_cup || 0));
        const qrDiscount = roundCup(order.discount_cup || 0);
        const total = roundCup(order.total_cup || 0);

        const cashAmt = method === 'EFECTIVO' ? total : 0;
        const tmAmt = method === 'TRANSFERMOVIL' ? total : 0;
        const ezAmt = method === 'ENZONA' ? total : 0;
        const tendered =
          method === 'EFECTIVO'
            ? Math.max(total, roundCup(req.body?.cash_tendered_cup || order.cash_tendered_cup || total))
            : 0;
        const changeGiven = method === 'EFECTIVO' ? roundCup(tendered - total) : 0;

        const receiptNumber = nextDocCode(db, 'sales', 'receipt_number', 'TK', 5);
        const sIns = db
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
            grossRevenue,
            qrDiscount,
            total,
            totalCost,
            method,
            cashAmt,
            tendered,
            changeGiven,
            tmAmt,
            ezAmt,
            electronicRef,
            order.customer_phone || ''
          );
        const saleId = Number(sIns.lastInsertRowid);

        for (const r of resolved) {
          db.prepare(
            `INSERT INTO sale_items
             (sale_id, product_id, product_name, unit, quantity, unit_price_cup, unit_cost_cup, line_total_cup, line_cost_cup, is_price_capped)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            saleId,
            r.prod.id,
            r.prod.name,
            r.prod.unit,
            r.qty,
            r.item.unit_price_cup,
            r.prod.unit_cost_cup,
            r.item.subtotal_cup,
            r.lineCost,
            r.prod.is_price_capped
          );

          const nextKiosk = roundCup(r.prod.kiosk_stock - r.qty);
          db.prepare(`UPDATE products SET kiosk_stock = ?, updated_at = datetime('now') WHERE id = ?`).run(
            nextKiosk,
            r.prod.id
          );
          db.prepare(
            `UPDATE shift_ipv_snapshots
             SET sold_qty = ROUND(sold_qty + ?, 2),
                 closing_qty = ROUND(closing_qty - ?, 2),
                 sold_amount_cup = ROUND(sold_amount_cup + ?, 2)
             WHERE shift_session_id = ? AND product_id = ?`
          ).run(r.qty, r.qty, r.item.subtotal_cup, session.id, r.prod.id);

          db.prepare(
            `INSERT INTO inventory_movements
             (doc_number, type, status, product_id, quantity, unit_cost_cup, total_cost_cup,
              warehouse_balance_after, kiosk_balance_after, reason, shift_session_id, created_by)
             VALUES (?, 'VENTA', 'APLICADO', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            receiptNumber,
            r.prod.id,
            r.qty,
            r.prod.unit_cost_cup,
            r.lineCost,
            r.prod.warehouse_stock,
            nextKiosk,
            `Pedido WhatsApp ${order.order_code} (${order.customer_name})`,
            session.id,
            register.seller_id
          );

          checkAndTriggerAutoRestock(db, r.prod.id);
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
        ).run(cashAmt, total, cashAmt, tmAmt, ezAmt, register.id);

        const qrAmt = roundCup(tmAmt + ezAmt);
        if (config.auto_accounting_enabled) {
          postJournalEntry(db, {
            entryDate: today,
            sourceType: 'VENTA',
            sourceRef: receiptNumber,
            description: `Cobro pedido WhatsApp ${order.order_code} (${receiptNumber}) — ${order.customer_name}`,
            createdBy: register.seller_id,
            lines: [
              ...(cashAmt > 0 ? [{ account: NCIF_ACCOUNTS.CAJA_GENERAL, debit: cashAmt }] : []),
              ...(qrAmt > 0 ? [{ account: NCIF_ACCOUNTS.COBROS_QR, debit: qrAmt }] : []),
              ...(qrDiscount > 0 ? [{ account: NCIF_ACCOUNTS.GASTOS_VENTAS, debit: qrDiscount }] : []),
              ...(totalCost > 0 ? [{ account: NCIF_ACCOUNTS.COSTO_VENTAS, debit: totalCost }] : []),
              ...(grossRevenue > 0 ? [{ account: NCIF_ACCOUNTS.INGRESOS_VENTAS, credit: grossRevenue }] : []),
              ...(totalCost > 0 ? [{ account: NCIF_ACCOUNTS.INV_KIOSKO, credit: totalCost }] : []),
            ],
          });
        }

        db.prepare(
          `UPDATE customer_orders
           SET status = 'ENTREGADO', payment_method = ?, sale_id = ?, handled_by = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(method, saleId, req.user.id, id);

        logAudit(
          db,
          req.user,
          'COBRO_PEDIDO_WHATSAPP',
          'Catálogo y POS',
          `Pedido ${order.order_code} de ${order.customer_name} cobrado como ${receiptNumber} (${total.toFixed(2)} CUP · ${method}).`
        );

        const updatedOrder = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(id);
        const replyText = formatCustomerReplyWhatsapp({
          order: updatedOrder,
          store: { business_name: config.business_name },
          status: 'ENTREGADO',
        });

        return {
          order: updatedOrder,
          receipt_number: receiptNumber,
          total_cup: total,
          change_given_cup: changeGiven,
          customer_whatsapp_url: updatedOrder.customer_phone
            ? buildWhatsappUrl(updatedOrder.customer_phone, replyText)
            : '',
        };
      });

      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);
