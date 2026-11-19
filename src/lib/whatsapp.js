// Shared helpers for WhatsApp order links, message formatting, category visuals,
// and portable catalog links (used by both Express backend and React / GitHub Pages).

export function sanitizeWhatsappDigits(rawPhone) {
  if (!rawPhone) return '';
  const trimmed = String(rawPhone).trim();
  const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Friendly auto-prefix for common local mobile formats when country code was omitted:
  // - Uruguay local mobile: 09X XXX XXX (9 digits starting with 09) -> 5989XXXXXXX
  if (!hasPlus && digits.length === 9 && digits.startsWith('09')) {
    return `598${digits.slice(1)}`;
  }
  // - Cuba local mobile: 5XXXXXXX or 6XXXXXXX (8 digits) -> 53XXXXXXXX
  if (!hasPlus && digits.length === 8 && (digits.startsWith('5') || digits.startsWith('6'))) {
    return `53${digits}`;
  }
  return digits;
}

export function buildWhatsappUrl(rawPhone, text) {
  const digits = sanitizeWhatsappDigits(rawPhone);
  const encoded = encodeURIComponent(String(text || ''));
  if (digits.length >= 7) {
    return `https://wa.me/${digits}?text=${encoded}`;
  }
  return `https://api.whatsapp.com/send?text=${encoded}`;
}

function fmtMoney(n) {
  const val = Number(n) || 0;
  const hasCents = Math.abs(val - Math.round(val)) > 0.005;
  return val.toLocaleString('es-ES', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function fmtQty(n) {
  const val = Number(n) || 0;
  return Number.isInteger(val) ? String(val) : String(Math.round(val * 100) / 100);
}

export const PAYMENT_LABELS = {
  EFECTIVO: 'Efectivo',
  TRANSFERMOVIL: 'Transfermóvil (QR)',
  ENZONA: 'EnZona (QR)',
};

export function formatOrderWhatsappMessage({ order, items = [], store = {} }) {
  const currency = store.currency || 'CUP';
  const lines = [];

  lines.push(`*NUEVO PEDIDO ${order.order_code || ''}*`.trim());
  if (store.business_name) {
    lines.push(`Comercio: *${store.business_name}*`);
  }
  lines.push('');
  lines.push(`Cliente: *${order.customer_name}*`);
  if (order.customer_phone) {
    lines.push(`Teléfono: ${order.customer_phone}`);
  }

  if (order.delivery_mode === 'DOMICILIO') {
    lines.push(`Entrega: *Envío a domicilio*`);
    if (order.delivery_address) {
      lines.push(`Dirección: ${order.delivery_address}`);
    }
  } else {
    lines.push(`Entrega: *Retiro en el local*`);
  }

  lines.push('');
  lines.push('*Detalle del pedido:*');
  for (const it of items) {
    const unitTag = it.unit && it.unit !== 'u' && it.unit !== 'unidad' ? ` ${it.unit}` : '';
    lines.push(
      `• ${fmtQty(it.quantity)}${unitTag} x ${it.product_name} — $${fmtMoney(it.subtotal_cup)}`
    );
  }

  lines.push('');
  const hasExtras = Number(order.discount_cup) > 0 || Number(order.delivery_fee_cup) > 0;
  if (hasExtras) {
    lines.push(`Subtotal: $${fmtMoney(order.subtotal_cup)} ${currency}`);
    if (Number(order.discount_cup) > 0) {
      lines.push(`Descuento pago QR: -$${fmtMoney(order.discount_cup)} ${currency}`);
    }
    if (order.delivery_mode === 'DOMICILIO') {
      lines.push(
        Number(order.delivery_fee_cup) > 0
          ? `Envío a domicilio: $${fmtMoney(order.delivery_fee_cup)} ${currency}`
          : `Envío a domicilio: ¡Gratis!`
      );
    }
  }
  lines.push(`*TOTAL: $${fmtMoney(order.total_cup)} ${currency}*`);

  const payLabel = PAYMENT_LABELS[order.payment_method] || order.payment_method || 'Efectivo';
  lines.push(`Pago: *${payLabel}*`);
  if (
    order.payment_method === 'EFECTIVO' &&
    Number(order.cash_tendered_cup) > Number(order.total_cup)
  ) {
    const change = Math.round((Number(order.cash_tendered_cup) - Number(order.total_cup)) * 100) / 100;
    lines.push(
      `Paga con: $${fmtMoney(order.cash_tendered_cup)} (vuelto: $${fmtMoney(change)} ${currency})`
    );
  }

  if (order.notes && String(order.notes).trim()) {
    lines.push(`Nota: ${String(order.notes).trim()}`);
  }

  return lines.join('\n');
}

export function formatCustomerReplyWhatsapp({ order, store = {}, status }) {
  const biz = store.business_name || 'nuestro local';
  const total = `$${fmtMoney(order.total_cup)} CUP`;
  const st = status || order.status;

  if (st === 'PREPARANDO') {
    return `¡Hola ${order.customer_name}! Recibimos tu pedido *${order.order_code}* en *${biz}* por *${total}*. Ya lo estamos preparando y te avisamos enseguida.`;
  }
  if (st === 'LISTO') {
    if (order.delivery_mode === 'DOMICILIO') {
      return `¡Hola ${order.customer_name}! Tu pedido *${order.order_code}* de *${biz}* (*${total}*) ya salió para *${order.delivery_address || 'tu dirección'}*.`;
    }
    return `¡Hola ${order.customer_name}! Tu pedido *${order.order_code}* ya está listo para retirar en *${biz}* (*${total}*). ¡Te esperamos!`;
  }
  if (st === 'ENTREGADO') {
    return `¡Gracias por tu compra, ${order.customer_name}! Tu pedido *${order.order_code}* en *${biz}* quedó entregado. Cuando quieras volver a pedir estamos a las órdenes.`;
  }
  if (st === 'CANCELADO') {
    return `Hola ${order.customer_name}, te escribimos de *${biz}* sobre tu pedido *${order.order_code}*. Tuvimos que cancelarlo — escríbenos por aquí si deseas modificarlo.`;
  }
  return `¡Hola ${order.customer_name}! Te escribimos de *${biz}* por tu pedido *${order.order_code}* (*${total}*).`;
}

// Compact UTF-8 base64url encoder/decoder so static deployments (e.g. GitHub Pages)
// can also share a self-contained catalog link to any customer's phone.
export function encodeCatalogSnapshot(catalog) {
  try {
    if (!catalog?.store) return '';
    const s = catalog.store;
    const compact = {
      v: 1,
      c: s.company_code,
      n: s.business_name,
      t: s.business_type || '',
      w: s.whatsapp_phone || '',
      m: s.catalog_welcome || '',
      h: s.catalog_hours || '',
      a: s.address || '',
      mu: s.municipality || '',
      pu: s.catalog_allow_pickup ? 1 : 0,
      dl: s.catalog_allow_delivery ? 1 : 0,
      df: Number(s.catalog_delivery_fee_cup || 0),
      fd: Number(s.catalog_free_delivery_from_cup || 0),
      mo: Number(s.catalog_min_order_cup || 0),
      qd: Number(s.qr_discount_pct || 0),
      tm: s.has_transfermovil ? 1 : 0,
      ez: s.has_enzona ? 1 : 0,
      bo: s.catalog_allow_backorder ? 1 : 0,
      p: (catalog.products || []).slice(0, 60).map((p) => [
        p.id,
        p.name,
        p.category,
        p.unit,
        Number(p.sale_price_cup || 0),
        Number(p.available_stock ?? 99),
        p.catalog_featured ? 1 : 0,
        (p.catalog_description || '').slice(0, 80),
        p.image_url || '',
      ]),
    };
    const json = JSON.stringify(compact);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

export function decodeCatalogSnapshot(encoded) {
  try {
    if (!encoded) return null;
    let b64 = String(encoded).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const d = JSON.parse(new TextDecoder().decode(bytes));
    if (!d || !d.n || !Array.isArray(d.p)) return null;

    const products = d.p.map((arr) => ({
      id: arr[0],
      name: arr[1],
      category: arr[2] || 'General',
      unit: arr[3] || 'u',
      sale_price_cup: Number(arr[4] || 0),
      available_stock: Number(arr[5] ?? 99),
      in_stock: Number(arr[5] ?? 99) > 0 || Boolean(d.bo),
      catalog_featured: Boolean(arr[6]),
      catalog_description: arr[7] || '',
      image_url: arr[8] || '',
    }));

    const categories = Array.from(new Set(products.map((p) => p.category)));
    return {
      portable: true,
      store: {
        company_code: d.c || '',
        business_name: d.n,
        business_type: d.t || 'Comercio',
        catalog_enabled: true,
        whatsapp_phone: d.w || '',
        whatsapp_digits: sanitizeWhatsappDigits(d.w || ''),
        catalog_welcome: d.m || '',
        catalog_hours: d.h || '',
        address: d.a || '',
        municipality: d.mu || '',
        province: '',
        catalog_allow_pickup: Boolean(d.pu),
        catalog_allow_delivery: Boolean(d.dl),
        catalog_delivery_fee_cup: Number(d.df || 0),
        catalog_free_delivery_from_cup: Number(d.fd || 0),
        catalog_min_order_cup: Number(d.mo || 0),
        catalog_allow_backorder: Boolean(d.bo),
        qr_discount_pct: Number(d.qd || 0),
        has_transfermovil: Boolean(d.tm),
        has_enzona: Boolean(d.ez),
      },
      categories,
      products,
    };
  } catch {
    return null;
  }
}

export function buildCatalogUrl(companyCode, options = {}) {
  if (typeof window === 'undefined') return `?tienda=${encodeURIComponent(companyCode || '')}`;
  const base = `${window.location.origin}${window.location.pathname}`;
  const params = new URLSearchParams();
  params.set('tienda', companyCode || 'kiosko-CEIBA1');
  if (options.snapshot) {
    params.set('s', options.snapshot);
  }
  return `${base}?${params.toString()}`;
}

export function buildAffiliationUrl(companyCode) {
  if (typeof window === 'undefined') return `?codigo=${encodeURIComponent(companyCode || '')}`;
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?codigo=${encodeURIComponent(companyCode || '')}`;
}

const CATEGORY_VISUALS = [
  { match: /c[aá]rn|pollo|embut|jam[oó]n|cerdo|picadillo/i, emoji: '🍗', bg: 'bg-[#FCECE6]', text: 'text-[#A33D1B]' },
  { match: /bebid|refresc|agua|jugo|cervez|malta|caf[eé]|infus/i, emoji: '🥤', bg: 'bg-[#E6F2FE]', text: 'text-[#1D5B96]' },
  { match: /l[aá]cte|leche|queso|yogur|mantequ/i, emoji: '🥛', bg: 'bg-[#EEF4FF]', text: 'text-[#2C4E8A]' },
  { match: /panad|gallet|confit|dulce|golosin|chocol|snack/i, emoji: '🍪', bg: 'bg-[#FDF2DF]', text: 'text-[#945B10]' },
  { match: /aseo|limpiez|jab[oó]n|deterg|higiene|perfum/i, emoji: '🧼', bg: 'bg-[#E6F6F2]', text: 'text-[#146350]' },
  { match: /grano|arroz|frijol|pasta|aceit|alimen|despens|b[aá]sic|conserv/i, emoji: '🛒', bg: 'bg-[#F3EFE4]', text: 'text-[#5C4D2E]' },
  { match: /fruta|verdur|agro|vianda|hortal/i, emoji: '🥬', bg: 'bg-[#E9F6E8]', text: 'text-[#236B27]' },
  { match: /hogar|ferret|[uú]til|electr/i, emoji: '🏠', bg: 'bg-[#EFECE8]', text: 'text-[#4A453E]' },
];

export function getCategoryVisual(category) {
  const cat = String(category || '');
  for (const item of CATEGORY_VISUALS) {
    if (item.match.test(cat)) return item;
  }
  return { emoji: '📦', bg: 'bg-[#F3EFE7]', text: 'text-[#5A534A]' };
}

export const ORDER_STATUS_META = {
  NUEVO: {
    label: 'Nuevo',
    hint: 'Recién recibido · confirmar al cliente',
    badge: 'bg-[#FCECE6] text-[#B5421E] border-[#E8B8A6]',
    dot: 'bg-[#C2542D]',
    next: 'PREPARANDO',
    nextLabel: 'Aceptar y preparar',
  },
  PREPARANDO: {
    label: 'Preparando',
    hint: 'Armando el pedido en mostrador',
    badge: 'bg-[#FEF4E0] text-[#8F5B0B] border-[#ECD198]',
    dot: 'bg-[#D18A15]',
    next: 'LISTO',
    nextLabel: 'Marcar listo',
  },
  LISTO: {
    label: 'Listo',
    hint: 'Listo para entregar y cobrar',
    badge: 'bg-[#E6F5EF] text-[#15614B] border-[#A7D9C6]',
    dot: 'bg-[#15614B]',
    next: 'ENTREGADO',
    nextLabel: 'Cobrar y entregar',
  },
  ENTREGADO: {
    label: 'Entregado',
    hint: 'Pedido completado',
    badge: 'bg-[#F1EFEA] text-[#57524A] border-[#DED9CE]',
    dot: 'bg-[#7A746B]',
    next: null,
    nextLabel: null,
  },
  CANCELADO: {
    label: 'Cancelado',
    hint: 'No concretado',
    badge: 'bg-[#FBEAEA] text-[#9E2A2B] border-[#E6B8B8]',
    dot: 'bg-[#9E2A2B]',
    next: null,
    nextLabel: null,
  },
};
