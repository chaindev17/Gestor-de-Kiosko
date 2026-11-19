import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Check,
  CheckCircle2,
  Copy,
  Globe,
  Minus,
  PackagePlus,
  Plus,
  Printer,
  QrCode,
  Search,
  ShoppingCart,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatCup, formatDateTime, formatNumber } from '../lib/format.js';
import { buildCatalogUrl, buildWhatsappUrl } from '../lib/whatsapp.js';
import QrCodeBadge from '../components/QrCodeBadge.jsx';
import Modal from '../components/Modal.jsx';

function MerchantQrBadge({ code, amount }) {
  // Deterministic 15x15 QR-style matrix generated from merchant code + amount
  const seedStr = `${code}:${amount}`;
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const size = 15;
  const isFinder = (r, c) =>
    (r < 4 && c < 4) || (r < 4 && c >= size - 4) || (r >= size - 4 && c < 4);
  const finderDark = (r, c) => {
    const lr = r >= size - 4 ? r - (size - 4) : r;
    const lc = c >= size - 4 ? c - (size - 4) : c;
    return lr === 0 || lr === 3 || lc === 0 || lc === 3 || (lr >= 1 && lr <= 2 && lc >= 1 && lc <= 2);
  };
  const cells = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      let dark = false;
      if (isFinder(r, c)) {
        dark = finderDark(r, c);
      } else {
        const bit = ((hash >>> ((r * 7 + c * 13) % 24)) ^ (r * 31 + c * 17)) & 1;
        dark = bit === 1;
      }
      if (dark) {
        cells.push(<rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#171C22" />);
      }
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-16 w-16 shrink-0 rounded-md border border-[#D4DEE9] bg-white p-1.5"
      aria-label={`QR ${code}`}
    >
      {cells}
    </svg>
  );
}

export default function PosPage({
  user,
  config,
  activeCompany,
  badges = {},
  onNavigate,
  onPreviewCatalog,
  onRefreshBadges,
  notify,
}) {
  const [products, setProducts] = useState([]);
  const [shiftBundle, setShiftBundle] = useState(null);
  const [payConfig, setPayConfig] = useState(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('TODAS');
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO');
  const [cashTendered, setCashTendered] = useState('');
  const [mixedCash, setMixedCash] = useState('');
  const [mixedChannel, setMixedChannel] = useState('TRANSFERMOVIL');
  const [electronicRef, setElectronicRef] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedRegId, setSelectedRegId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);

  const load = useCallback(async () => {
    try {
      const [prodRes, shiftRes] = await Promise.all([
        api.get('/api/warehouse/products'),
        api.get('/api/pos/active-shift'),
      ]);
      setProducts(prodRes.products || []);
      setShiftBundle(shiftRes.active);
      setPayConfig(shiftRes.payment_config);
      if (shiftRes.active?.registers?.length && !selectedRegId) {
        const openReg = shiftRes.active.registers.find((r) => r.status === 'ABIERTA');
        if (openReg) setSelectedRegId(String(openReg.id));
      }
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify, selectedRegId]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category));
    return ['TODAS', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== 'TODAS' && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.compatibility || '').toLowerCase().includes(q) ||
        (p.catalog_description || '').toLowerCase().includes(q)
      );
    });
  }, [products, category, search]);
  const [catalogQrOpen, setCatalogQrOpen] = useState(false);
  const [copiedCat, setCopiedCat] = useState(false);

  const myRegister = useMemo(() => {
    if (!shiftBundle?.registers) return null;
    if (user.role === 'vendedor') {
      return shiftBundle.registers.find((r) => r.seller_id === user.id && r.status === 'ABIERTA') || null;
    }
    return (
      shiftBundle.registers.find((r) => String(r.id) === String(selectedRegId) && r.status === 'ABIERTA') ||
      shiftBundle.registers.find((r) => r.status === 'ABIERTA') ||
      null
    );
  }, [shiftBundle, user, selectedRegId]);

  function addToCart(product) {
    if (product.kiosk_stock <= 0) {
      notify(`"${product.name}" sin existencia en mostrador. Solicite despacho al Almacenero.`, 'error');
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product.id === product.id);
      if (idx >= 0) {
        const nextQty = prev[idx].qty + 1;
        if (nextQty > product.kiosk_stock) {
          notify(`Solo quedan ${product.kiosk_stock} ${product.unit} en mostrador.`, 'error');
          return prev;
        }
        return prev.map((it, k) => (k === idx ? { ...it, qty: nextQty } : it));
      }
      return [...prev, { product, qty: 1 }];
    });
  }

  function updateQty(productId, delta) {
    setCart((prev) =>
      prev
        .map((it) => {
          if (it.product.id !== productId) return it;
          const next = Math.round((it.qty + delta) * 100) / 100;
          if (next > it.product.kiosk_stock) return it;
          return { ...it, qty: next };
        })
        .filter((it) => it.qty > 0)
    );
  }

  async function requestRestock(product, e) {
    e.stopPropagation();
    try {
      await api.post('/api/warehouse/restock-requests', { product_id: product.id });
      notify(`Solicitud urgente enviada al Almacenero: ${product.name}.`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  const subtotal = useMemo(
    () => Math.round(cart.reduce((a, i) => a + i.product.sale_price_cup * i.qty, 0) * 100) / 100,
    [cart]
  );
  const qrDiscountPct = Number(payConfig?.qr_discount_pct || 0);
  const isPureQr = paymentMethod === 'TRANSFERMOVIL' || paymentMethod === 'ENZONA';
  const qrDiscount = isPureQr && qrDiscountPct > 0 ? Math.round(subtotal * qrDiscountPct) / 100 : 0;
  const total = Math.round((subtotal - qrDiscount) * 100) / 100;
  const tenderedNum = Number(cashTendered) || 0;
  const changeDue =
    paymentMethod === 'EFECTIVO' && tenderedNum > total
      ? Math.round((tenderedNum - total) * 100) / 100
      : 0;
  const mixedElectronic =
    paymentMethod === 'MIXTO' && Number(mixedCash) > 0 && Number(mixedCash) < total
      ? Math.round((total - Number(mixedCash)) * 100) / 100
      : 0;

  async function handleCheckout(e) {
    e.preventDefault();
    if (!myRegister) {
      notify('Debe tener una caja abierta en el turno actual para registrar ventas.', 'error');
      return;
    }
    if (cart.length === 0) return;

    setSubmitting(true);
    try {
      const payload = {
        items: cart.map((c) => ({ product_id: c.product.id, quantity: c.qty })),
        payment_method: paymentMethod,
        cash_tendered_cup: paymentMethod === 'EFECTIVO' ? Number(cashTendered) || total : 0,
        cash_amount_cup: paymentMethod === 'MIXTO' ? Number(mixedCash) : 0,
        electronic_channel: mixedChannel,
        electronic_ref: electronicRef,
        customer_phone: customerPhone,
        apply_qr_discount: true,
        register_id: myRegister.id,
      };
      const res = await api.post('/api/pos/sales', payload);
      setLastReceipt(res);
      setCart([]);
      setCashTendered('');
      setMixedCash('');
      setElectronicRef('');
      setCustomerPhone('');
      notify(`Venta ${res.sale.receipt_number} cobrada (${formatCup(res.sale.total_cup)}) y contabilizada.`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Incoming WhatsApp orders quick banner */}
      {Number(badges?.pending_orders) > 0 && (
        <div className="rounded-2xl bg-[#E6F5EF] border border-[#BDE5D5] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold text-[#113D2F]">
            💬 Tienes {badges.pending_orders} {badges.pending_orders === 1 ? 'pedido' : 'pedidos'} de WhatsApp esperando — puedes cobrarlo y descontar stock en 1 clic.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('catalog-wa')}
            className="rounded-full bg-[#15614B] hover:bg-[#104B3A] text-white text-xs font-bold px-3.5 py-1.5 cursor-pointer"
          >
            Ver pedidos →
          </button>
        </div>
      )}

      {/* Top status bar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Mostrador</p>
          <h1 className="font-editorial text-3xl text-[#181715]">
            Cobrar en Caja
          </h1>
          <p className="text-xs text-[#6E685F]">
            Toca los productos para armar el ticket · El stock y las cuentas se actualizan solos
          </p>
        </div>

        {myRegister ? (
          <div className="flex items-center gap-2">
            {user.role === 'jefe' && shiftBundle?.registers?.filter((r) => r.status === 'ABIERTA').length > 1 && (
              <select
                className="input-field text-xs py-1.5 w-auto"
                value={myRegister.id}
                onChange={(e) => setSelectedRegId(e.target.value)}
              >
                {shiftBundle.registers
                  .filter((r) => r.status === 'ABIERTA')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      Caja {r.register_number} — {r.seller_name}
                    </option>
                  ))}
              </select>
            )}
            <div className="rounded-lg border border-[#0F5C4D]/25 bg-[#0F5C4D]/8 px-3 py-1.5 text-xs">
              <span className="font-bold text-[#0F5C4D]">Caja {myRegister.register_number}</span> ·{' '}
              <span className="text-[#23322E]">{myRegister.seller_name}</span> ·{' '}
              <span className="font-semibold tabular-nums">{formatCup(myRegister.total_sales_cup)}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#E5DED0] bg-[#F3EFE7] px-3.5 py-2 text-xs text-[#3F3C37]">
            <span>Sin caja abierta en este momento.</span>
            <button
              type="button"
              onClick={async () => {
                try {
                  await api.post('/api/pos/shifts/open', { register_number: user.default_register || 1 });
                  notify('Turno y caja abiertos. Ya puedes registrar ventas.');
                  await load();
                  onRefreshBadges?.();
                } catch (err) {
                  notify(err.message, 'error');
                  onNavigate('shift-ipv');
                }
              }}
              className="btn-primary rounded-full text-[11px] py-1.5 px-3"
            >
              Abrir caja ahora
            </button>
          </div>
        )}
      </div>

      {/* Main POS Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Catalog */}
        <section className="lg:col-span-7 space-y-3">
          <div className="card p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="h-4 w-4 text-[#7B8491] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  className="input-field pl-9"
                  placeholder="Buscar por nombre, código SKU o compatibilidad..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => setCatalogQrOpen(true)}
                title="Mostrar QR o copiar enlace del Catálogo público para el cliente"
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#E6F5EF] hover:bg-[#D5EEE4] text-[#15614B] px-3 py-2 text-xs font-bold shrink-0 cursor-pointer"
              >
                <QrCode className="h-4 w-4" />
                <span className="hidden sm:inline">QR Catálogo</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                    category === cat
                      ? 'bg-[#0F5C4D] text-white'
                      : 'bg-[#F3F1EB] text-[#4C5561] hover:bg-[#E7E3D8]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {filteredProducts.map((p) => {
              const inCart = cart.find((c) => c.product.id === p.id);
              const outOfStock = p.kiosk_stock <= 0;
              return (
                <div
                  key={p.id}
                  onClick={() => !outOfStock && addToCart(p)}
                  className={`card p-3.5 transition flex flex-col justify-between gap-2 ${
                    outOfStock
                      ? 'opacity-65 bg-[#FAF9F5]'
                      : 'hover:border-[#0F5C4D] hover:shadow-xs cursor-pointer'
                  } ${inCart ? 'ring-2 ring-[#0F5C4D]/35 border-[#0F5C4D]' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    {p.image_url && (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        loading="lazy"
                        className="h-12 w-12 shrink-0 rounded-lg object-cover border border-[#E5E1D7] bg-[#FAF8F4]"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#171C22] leading-snug">{p.name}</p>
                      <p className="text-[11px] text-[#6F7885] mt-0.5 truncate">
                        {p.sku} · {p.unit}
                        {p.compatibility ? ` · ${p.compatibility}` : ''}
                      </p>
                    </div>
                    {p.is_price_capped ? (
                      <span
                        className="shrink-0 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                        title={`Tope ${p.price_cap_cup} CUP (${p.price_cap_resolution})`}
                      >
                        Tope {p.price_cap_cup}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-end justify-between gap-2 pt-1">
                    <span className="text-base font-bold text-[#0F5C4D] tabular-nums">
                      {formatCup(p.sale_price_cup, 0)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                          outOfStock
                            ? 'bg-red-100 text-red-800'
                            : p.low_kiosk
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-[#F2F0E9] text-[#4C5561]'
                        }`}
                      >
                        {formatNumber(p.kiosk_stock)} {p.unit}
                      </span>
                      {p.low_kiosk && p.warehouse_stock > 0 && (
                        <button
                          type="button"
                          onClick={(e) => requestRestock(p, e)}
                          title={
                            p.pending_restock
                              ? 'Orden de reabastecimiento ya enviada'
                              : `Pedir reposición al Almacenero (${p.warehouse_stock} en almacén)`
                          }
                          className="rounded p-1 bg-[#8A4B08]/12 text-[#8A4B08] hover:bg-[#8A4B08]/20 cursor-pointer"
                        >
                          <PackagePlus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Cart & Bancarización Checkout */}
        <section className="lg:col-span-5 card p-4 space-y-4 lg:sticky lg:top-20">
          <div className="flex items-center justify-between border-b border-[#ECE8DE] pb-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-[#0F5C4D]" />
              <h2 className="text-sm font-bold text-[#171C22]">Comprobante Actual</h2>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setCart([])}
                className="text-xs text-red-700 hover:underline cursor-pointer"
              >
                Vaciar
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#6F7885]">
              Toque los productos del catálogo para agregarlos a la venta.
            </div>
          ) : (
            <div className="divide-y divide-[#F0EDE5] max-h-60 overflow-y-auto">
              {cart.map(({ product, qty }) => (
                <div key={product.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[#171C22] truncate">{product.name}</p>
                    <p className="text-[#6F7885] tabular-nums">
                      {formatCup(product.sale_price_cup, 0)} / {product.unit}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => updateQty(product.id, -1)}
                      className="rounded border border-[#D5D0C4] p-1 hover:bg-[#F3F1EB] cursor-pointer"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-8 text-center font-semibold tabular-nums">{qty}</span>
                    <button
                      type="button"
                      onClick={() => updateQty(product.id, 1)}
                      className="rounded border border-[#D5D0C4] p-1 hover:bg-[#F3F1EB] cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <span className="w-20 text-right font-semibold text-[#171C22] tabular-nums">
                    {formatCup(product.sale_price_cup * qty, 0)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCart((c) => c.filter((x) => x.product.id !== product.id))}
                    className="text-[#8B93A0] hover:text-red-700 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Payment channels (Res. 111/2023 BCC) */}
          <form onSubmit={handleCheckout} className="space-y-3 pt-2 border-t border-[#ECE8DE]">
            <div>
              <label className="block text-xs font-semibold text-[#3C4450] mb-1.5">
                Vía de cobro (Res. 111/2023 BCC — Bancarización)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'EFECTIVO', label: 'Efectivo CUP', icon: Banknote },
                  { id: 'TRANSFERMOVIL', label: 'Transfermóvil', icon: Smartphone },
                  { id: 'ENZONA', label: 'EnZona QR', icon: QrCode },
                  { id: 'MIXTO', label: 'Pago Mixto', icon: QrCode },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const active = paymentMethod === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPaymentMethod(opt.id)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition cursor-pointer ${
                        active
                          ? 'border-[#0F5C4D] bg-[#0F5C4D]/10 text-[#0F5C4D]'
                          : 'border-[#D5D0C4] bg-white text-[#4C5561] hover:bg-[#F7F6F1]'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {paymentMethod === 'EFECTIVO' && total > 0 && (
              <div className="rounded-lg bg-[#FAF9F5] border border-[#E5E1D7] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-[#3C4450]">Efectivo recibido (CUP)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder={String(Math.ceil(total))}
                    className="input-field w-32 text-right tabular-nums py-1"
                    value={cashTendered}
                    onChange={(e) => setCashTendered(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {[total, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000]
                    .filter((v, i, arr) => v >= total && arr.indexOf(v) === i)
                    .slice(0, 4)
                    .map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setCashTendered(String(amt))}
                        className="rounded border border-[#D5D0C4] bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums hover:bg-[#EFECE4] cursor-pointer"
                      >
                        {formatNumber(amt)} CUP
                      </button>
                    ))}
                </div>
                {changeDue > 0 && (
                  <div className="flex justify-between text-xs font-bold text-[#0F5C4D] pt-1 border-t border-[#E5E1D7] tabular-nums">
                    <span>Vuelto a entregar:</span>
                    <span>{formatCup(changeDue)}</span>
                  </div>
                )}
              </div>
            )}

            {(paymentMethod === 'TRANSFERMOVIL' || paymentMethod === 'ENZONA') && payConfig && (
              <div className="rounded-lg bg-[#F4F7FA] border border-[#D4DEE9] p-3 space-y-2.5 text-xs">
                <div className="flex items-center gap-3">
                  <MerchantQrBadge
                    code={
                      paymentMethod === 'TRANSFERMOVIL'
                        ? payConfig.transfermovil_merchant_code
                        : payConfig.enzona_merchant_code
                    }
                    amount={total}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[#1E3A5F]">
                      <span className="font-bold">
                        QR {paymentMethod === 'TRANSFERMOVIL' ? payConfig.transfermovil_merchant_code : payConfig.enzona_merchant_code}
                      </span>
                      {qrDiscountPct > 0 && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                          -{qrDiscountPct}% Bonif. QR
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#525B68] truncate">
                      Cuenta Fiscal: <span className="font-mono">{payConfig.fiscal_account_cup}</span>
                    </p>
                    <p className="text-[11px] font-semibold text-[#0F5C4D] tabular-nums">
                      Importe QR: {formatCup(total)}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    className="input-field text-xs py-1.5 font-mono"
                    placeholder="Nro. operación SMS/QR *"
                    value={electronicRef}
                    onChange={(e) => setElectronicRef(e.target.value)}
                    required
                  />
                  <input
                    className="input-field text-xs py-1.5"
                    placeholder="Móvil cliente (opc.)"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                </div>
              </div>
            )}

            {paymentMethod === 'MIXTO' && (
              <div className="rounded-lg bg-[#FAF9F5] border border-[#E5E1D7] p-3 space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium mb-1">Parte en Efectivo (CUP)</label>
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, total - 1)}
                      className="input-field py-1.5 text-xs tabular-nums"
                      value={mixedCash}
                      onChange={(e) => setMixedCash(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium mb-1">Resto por pasarela</label>
                    <select
                      className="input-field py-1.5 text-xs"
                      value={mixedChannel}
                      onChange={(e) => setMixedChannel(e.target.value)}
                    >
                      <option value="TRANSFERMOVIL">Transfermóvil</option>
                      <option value="ENZONA">EnZona</option>
                    </select>
                  </div>
                </div>
                {mixedElectronic > 0 && (
                  <p className="text-[11px] font-semibold text-[#1E3A5F] tabular-nums">
                    Importe a cobrar por {mixedChannel}: {formatCup(mixedElectronic)}
                  </p>
                )}
                <input
                  className="input-field text-xs py-1.5 font-mono"
                  placeholder="Nro. operación electrónica *"
                  value={electronicRef}
                  onChange={(e) => setElectronicRef(e.target.value)}
                  required
                />
              </div>
            )}

            {/* Totals */}
            <div className="space-y-1 pt-2 border-t border-[#ECE8DE] text-xs tabular-nums">
              <div className="flex justify-between text-[#525B68]">
                <span>Subtotal</span>
                <span>{formatCup(subtotal)}</span>
              </div>
              {qrDiscount > 0 && (
                <div className="flex justify-between text-emerald-700 font-medium">
                  <span>Bonificación pago electrónico ({qrDiscountPct}%)</span>
                  <span>-{formatCup(qrDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-[#171C22] pt-1">
                <span>Total a cobrar</span>
                <span>{formatCup(total)}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || cart.length === 0 || !myRegister}
              className="btn-primary w-full py-2.5 text-sm"
            >
              {submitting ? 'Procesando cobro...' : `Cobrar ${formatCup(total)}`}
            </button>
          </form>
        </section>
      </div>

      {/* Receipt confirmation modal */}
      <Modal
        open={Boolean(lastReceipt)}
        onClose={() => setLastReceipt(null)}
        title={`Comprobante ${lastReceipt?.sale?.receipt_number || ''}`}
        subtitle="Venta contabilizada y descargada del IPV automáticamente"
        maxWidth="max-w-md"
        printable
      >
        {lastReceipt && (
          <div className="space-y-4 text-xs">
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
              <div className="space-y-0.5 text-emerald-900">
                <p className="font-semibold">Operación registrada con éxito</p>
                {lastReceipt.journal_entry && (
                  <p>Asiento NCIF generado: <strong>{lastReceipt.journal_entry}</strong></p>
                )}
                {lastReceipt.triggered_restocks?.length > 0 && (
                  <p className="text-amber-900 font-medium">
                    Auto-pedido enviado a Almacén:{' '}
                    {lastReceipt.triggered_restocks
                      .map((r) => `${r.product_name} (+${r.suggested_qty} ${r.unit})`)
                      .join(', ')}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-[#E3DFD5] p-3.5 space-y-2 font-mono text-[11px]">
              <div className="text-center border-b border-dashed border-[#D5D0C4] pb-2">
                <p className="font-bold text-xs">{payConfig?.business_name}</p>
                <p>NIT: {payConfig?.nit}</p>
                <p>
                  {lastReceipt.sale.receipt_number} · Caja {lastReceipt.sale.register_number} ·{' '}
                  {formatDateTime(lastReceipt.sale.created_at)}
                </p>
                <p>Atendido por: {lastReceipt.sale.seller_name}</p>
              </div>
              <div className="space-y-1">
                {lastReceipt.sale.items.map((it) => (
                  <div key={it.id} className="flex justify-between">
                    <span>
                      {it.quantity} {it.unit} {it.product_name}
                    </span>
                    <span>{formatCup(it.line_total_cup)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-[#D5D0C4] pt-2 space-y-0.5">
                {lastReceipt.sale.qr_discount_cup > 0 && (
                  <div className="flex justify-between">
                    <span>Bonificación QR:</span>
                    <span>-{formatCup(lastReceipt.sale.qr_discount_cup)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-xs">
                  <span>TOTAL PAGADO:</span>
                  <span>{formatCup(lastReceipt.sale.total_cup)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Vía de pago:</span>
                  <span>
                    {lastReceipt.sale.payment_method}
                    {lastReceipt.sale.electronic_ref ? ` (${lastReceipt.sale.electronic_ref})` : ''}
                  </span>
                </div>
                {lastReceipt.sale.change_given_cup > 0 && (
                  <div className="flex justify-between">
                    <span>Vuelto entregado:</span>
                    <span>{formatCup(lastReceipt.sale.change_given_cup)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => window.print()} className="btn-secondary text-xs">
                <Printer className="h-3.5 w-3.5" />
                Imprimir
              </button>
              <button type="button" onClick={() => setLastReceipt(null)} className="btn-primary text-xs">
                Nueva venta
              </button>
            </div>
          </div>
        )}
      </Modal>
      {/* Modal: QR y Enlace del Catálogo Público para compartir al cliente desde el Mostrador */}
      <Modal
        open={catalogQrOpen}
        onClose={() => setCatalogQrOpen(false)}
        title="Catálogo Público para el Cliente"
        subtitle="El cliente escanea el QR o recibe el enlace por WhatsApp con fotos, precios en CUP y disponibilidad"
      >
        {(() => {
          const catCode =
            activeCompany?.company_code || config?.company_code || 'kiosko-CEIBA1';
          const catUrl = buildCatalogUrl(catCode);
          const waShare = buildWhatsappUrl(
            '',
            `¡Hola! Consulta nuestro catálogo actualizado de *${payConfig?.business_name || config?.business_name || 'nuestro comercio'}* aquí:\n${catUrl}`
          );
          return (
            <div className="text-center space-y-4 py-1 text-xs">
              <div className="inline-flex p-4 rounded-2xl bg-[#FAF8F4] border border-[#E5DED0]">
                <QrCodeBadge value={catUrl} size={180} />
              </div>
              <p className="font-mono text-[11px] text-[#4C5561] bg-[#FAF8F4] rounded-lg px-3 py-2 break-all">
                {catUrl}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(catUrl);
                    setCopiedCat(true);
                    notify('Enlace del catálogo copiado.');
                    setTimeout(() => setCopiedCat(false), 2000);
                  }}
                  className="btn-primary text-xs"
                >
                  {copiedCat ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedCat ? 'Copiado' : 'Copiar enlace'}
                </button>
                <a
                  href={waShare}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-xs"
                >
                  <Globe className="h-3.5 w-3.5 text-emerald-700" />
                  Enviar por WhatsApp
                </a>
                {onPreviewCatalog && (
                  <button
                    type="button"
                    onClick={() => {
                      setCatalogQrOpen(false);
                      onPreviewCatalog(catCode);
                    }}
                    className="btn-secondary text-xs"
                  >
                    Ver como cliente
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
