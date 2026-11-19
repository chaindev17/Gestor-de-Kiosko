import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bike,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  MapPin,
  MessageCircle,
  Minus,
  Plus,
  QrCode,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatCup, formatNumber } from '../lib/format.js';
import {
  buildCatalogUrl,
  buildWhatsappUrl,
  encodeCatalogSnapshot,
  formatOrderWhatsappMessage,
  getCategoryVisual,
  sanitizeWhatsappDigits,
} from '../lib/whatsapp.js';

const CUSTOMER_PREFS_KEY = 'kiosko_customer_info_v1';

function unitLabel(unit) {
  const u = String(unit || 'u').toLowerCase();
  if (u === 'u' || u === 'un' || u === 'unidad' || u === 'unidades') return 'c/u';
  if (u === 'kg') return 'por kg';
  if (u === 'lb') return 'por lb';
  if (u === 'l' || u === 'lt' || u === 'litro') return 'por litro';
  if (u === 'paq' || u === 'paquete') return 'el paquete';
  if (u === 'lata') return 'la lata';
  if (u === 'bot' || u === 'botella') return 'la botella';
  return `por ${unit}`;
}

export default function PublicCatalog({
  companyCode,
  initialSnapshot = null,
  ownerPreview = false,
  onBack,
  onConfigureWhatsapp,
  onOrderCreated,
  notify,
}) {
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState(initialSnapshot);
  const [lookupCode, setLookupCode] = useState(companyCode || '');

  // Browsing state
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('TODOS');
  const [cart, setCart] = useState({}); // { [productId]: qty }

  // Checkout drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showWaPreview, setShowWaPreview] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState('RETIRO');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO');
  const [cashTendered, setCashTendered] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Confirmation & copy states
  const [confirmed, setConfirmed] = useState(null);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Restore returning customer's name/phone/address for effortless 1-tap repeat orders
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CUSTOMER_PREFS_KEY) || '{}');
      if (saved.name) setCustomerName(saved.name);
      if (saved.phone) setCustomerPhone(saved.phone);
      if (saved.address) setDeliveryAddress(saved.address);
    } catch {
      // ignore
    }
  }, []);

  const loadCatalog = useCallback(
    async (codeToLoad) => {
      const target = String(codeToLoad || '').trim();
      if (!target) {
        if (initialSnapshot) {
          setCatalog(initialSnapshot);
          setLoading(false);
          return;
        }
        setError('Ingresa el código del comercio para ver su catálogo.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const res = await api.get(`/api/catalog/${encodeURIComponent(target)}`);
        setCatalog(res);
        if (!res.store?.catalog_allow_pickup && res.store?.catalog_allow_delivery) {
          setDeliveryMode('DOMICILIO');
        } else {
          setDeliveryMode('RETIRO');
        }
      } catch (err) {
        if (initialSnapshot) {
          setCatalog(initialSnapshot);
        } else {
          setError(err.message || 'No pudimos cargar el catálogo de este comercio.');
        }
      } finally {
        setLoading(false);
      }
    },
    [initialSnapshot]
  );

  useEffect(() => {
    loadCatalog(companyCode);
  }, [companyCode, loadCatalog]);

  const store = catalog?.store || null;
  const products = useMemo(() => catalog?.products || [], [catalog]);
  const hasFeatured = useMemo(() => products.some((p) => p.catalog_featured), [products]);

  const categoryTabs = useMemo(() => {
    const counts = {};
    for (const p of products) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }
    const tabs = [{ id: 'TODOS', label: 'Todo', emoji: '✨', count: products.length }];
    if (hasFeatured) {
      tabs.push({
        id: 'DESTACADOS',
        label: 'Destacados',
        emoji: '⭐',
        count: products.filter((p) => p.catalog_featured).length,
      });
    }
    Object.keys(counts).forEach((cat) => {
      const vis = getCategoryVisual(cat);
      tabs.push({ id: cat, label: cat, emoji: vis.emoji, count: counts[cat] });
    });
    return tabs;
  }, [products, hasFeatured]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategory === 'DESTACADOS' && !p.catalog_featured) return false;
      if (activeCategory !== 'TODOS' && activeCategory !== 'DESTACADOS' && p.category !== activeCategory) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.compatibility || '').toLowerCase().includes(q) ||
        (p.catalog_description || '').toLowerCase().includes(q)
      );
    });
  }, [products, activeCategory, search]);

  function setItemQty(product, nextQty) {
    const clamped = Math.max(0, Math.round(nextQty * 100) / 100);
    if (!store?.catalog_allow_backorder && clamped > product.available_stock) {
      notify?.(`Quedan ${formatNumber(product.available_stock)} ${product.unit} disponibles de ${product.name}.`, 'error');
      return;
    }
    setCart((prev) => {
      const next = { ...prev };
      if (clamped <= 0) delete next[product.id];
      else next[product.id] = clamped;
      return next;
    });
  }

  const cartItems = useMemo(() => {
    const list = [];
    for (const [idStr, qty] of Object.entries(cart)) {
      const p = products.find((x) => x.id === Number(idStr));
      if (!p || qty <= 0) continue;
      const subtotal_cup = Math.round(p.sale_price_cup * qty * 100) / 100;
      list.push({
        product: p,
        product_id: p.id,
        product_name: p.name,
        unit: p.unit,
        quantity: qty,
        unit_price_cup: p.sale_price_cup,
        subtotal_cup,
      });
    }
    return list;
  }, [cart, products]);

  const cartCount = useMemo(
    () => Math.round(cartItems.reduce((s, i) => s + i.quantity, 0) * 100) / 100,
    [cartItems]
  );
  const subtotal = useMemo(
    () => Math.round(cartItems.reduce((s, i) => s + i.subtotal_cup, 0) * 100) / 100,
    [cartItems]
  );

  const isQr = paymentMethod === 'TRANSFERMOVIL' || paymentMethod === 'ENZONA';
  const qrPct = Number(store?.qr_discount_pct || 0);
  const discountCup = isQr && qrPct > 0 ? Math.round(subtotal * qrPct) / 100 : 0;

  const freeFrom = Number(store?.catalog_free_delivery_from_cup || 0);
  const baseDeliveryFee = Number(store?.catalog_delivery_fee_cup || 0);
  const qualifiesFreeDelivery = freeFrom > 0 && subtotal >= freeFrom;
  const remainingForFreeDelivery =
    freeFrom > 0 && subtotal < freeFrom ? Math.round((freeFrom - subtotal) * 100) / 100 : 0;
  const deliveryFeeCup =
    deliveryMode === 'DOMICILIO' ? (qualifiesFreeDelivery ? 0 : baseDeliveryFee) : 0;

  const totalCup = Math.max(0, Math.round((subtotal - discountCup + deliveryFeeCup) * 100) / 100);
  const minOrderCup = Number(store?.catalog_min_order_cup || 0);
  const belowMinOrder = minOrderCup > 0 && subtotal < minOrderCup - 0.01;

  const tenderedNum = Number(cashTendered) || 0;
  const changeDue =
    paymentMethod === 'EFECTIVO' && tenderedNum > totalCup
      ? Math.round((tenderedNum - totalCup) * 100) / 100
      : 0;

  const suggestedBills = useMemo(() => {
    if (totalCup <= 0) return [];
    const candidates = [500, 1000, 2000, 3000, 5000, 10000].filter((b) => b > totalCup);
    const roundUp500 = Math.ceil((totalCup + 1) / 500) * 500;
    const roundUp1000 = Math.ceil((totalCup + 1) / 1000) * 1000;
    const set = new Set([roundUp500, roundUp1000, ...candidates]);
    return Array.from(set)
      .filter((v) => v > totalCup)
      .sort((a, b) => a - b)
      .slice(0, 3);
  }, [totalCup]);

  const liveWhatsappPreview = useMemo(() => {
    if (!store || cartItems.length === 0) return '';
    return formatOrderWhatsappMessage({
      order: {
        order_code: 'PED-NUEVO',
        customer_name: customerName.trim() || 'Tu nombre',
        customer_phone: customerPhone.trim(),
        delivery_mode: deliveryMode,
        delivery_address: deliveryAddress.trim(),
        payment_method: paymentMethod,
        cash_tendered_cup: paymentMethod === 'EFECTIVO' ? tenderedNum : 0,
        notes: notes.trim(),
        subtotal_cup: subtotal,
        discount_cup: discountCup,
        delivery_fee_cup: deliveryFeeCup,
        total_cup: totalCup,
      },
      items: cartItems,
      store: { business_name: store.business_name, currency: 'CUP' },
    });
  }, [
    store,
    cartItems,
    customerName,
    customerPhone,
    deliveryMode,
    deliveryAddress,
    paymentMethod,
    tenderedNum,
    notes,
    subtotal,
    discountCup,
    deliveryFeeCup,
    totalCup,
  ]);

  async function handleSubmitOrder(e) {
    e.preventDefault();
    setFormError('');

    if (!customerName.trim() || customerName.trim().length < 2) {
      setFormError('Por favor escribe tu nombre.');
      return;
    }
    if (deliveryMode === 'DOMICILIO' && deliveryAddress.trim().length < 4) {
      setFormError('Indica tu dirección o referencia para enviarte el pedido.');
      return;
    }
    if (belowMinOrder) {
      setFormError(`El pedido mínimo es de ${formatCup(minOrderCup, 0)}.`);
      return;
    }

    // Save customer info locally for next visit
    try {
      window.localStorage.setItem(
        CUSTOMER_PREFS_KEY,
        JSON.stringify({
          name: customerName.trim(),
          phone: customerPhone.trim(),
          address: deliveryAddress.trim(),
        })
      );
    } catch {
      // ignore
    }

    setSubmitting(true);
    try {
      let result;
      if (catalog?.portable) {
        // Portable cross-device snapshot link: build WhatsApp message directly
        const fakeCode = `WA-${String(Date.now()).slice(-4)}`;
        const orderObj = {
          order_code: fakeCode,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          delivery_mode: deliveryMode,
          delivery_address: deliveryMode === 'DOMICILIO' ? deliveryAddress.trim() : '',
          payment_method: paymentMethod,
          cash_tendered_cup: paymentMethod === 'EFECTIVO' ? tenderedNum : 0,
          notes: notes.trim(),
          subtotal_cup: subtotal,
          discount_cup: discountCup,
          delivery_fee_cup: deliveryFeeCup,
          total_cup: totalCup,
        };
        const text = formatOrderWhatsappMessage({
          order: orderObj,
          items: cartItems,
          store: { business_name: store.business_name, currency: 'CUP' },
        });
        result = {
          order: orderObj,
          items: cartItems,
          whatsapp_phone: store.whatsapp_phone || '',
          has_store_whatsapp: sanitizeWhatsappDigits(store.whatsapp_phone).length >= 7,
          whatsapp_text: text,
          whatsapp_url: buildWhatsappUrl(store.whatsapp_phone, text),
        };
      } else {
        result = await api.post(`/api/catalog/${encodeURIComponent(store.company_code)}/orders`, {
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          delivery_mode: deliveryMode,
          delivery_address: deliveryMode === 'DOMICILIO' ? deliveryAddress.trim() : '',
          payment_method: paymentMethod,
          cash_tendered_cup: paymentMethod === 'EFECTIVO' ? tenderedNum : 0,
          notes: notes.trim(),
          items: cartItems.map((c) => ({ product_id: c.product_id, quantity: c.quantity })),
        });
      }

      setConfirmed(result);
      setCart({});
      setNotes('');
      setCashTendered('');
      setDrawerOpen(false);
      onOrderCreated?.();

      // Automatically open WhatsApp when the store has a configured WhatsApp number
      if (result.has_store_whatsapp && result.whatsapp_url && !ownerPreview) {
        window.open(result.whatsapp_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setFormError(err.message || 'No se pudo generar el pedido.');
    } finally {
      setSubmitting(false);
    }
  }

  function copyCatalogShareLink() {
    if (!store) return;
    const snap = catalog?.portable ? encodeCatalogSnapshot(catalog) : '';
    const url = buildCatalogUrl(store.company_code, snap ? { snapshot: snap } : {});
    navigator.clipboard?.writeText(url);
    setCopiedLink(true);
    notify?.('Enlace del catálogo copiado al portapapeles.');
    setTimeout(() => setCopiedLink(false), 2200);
  }

  function copyWhatsappText(text) {
    navigator.clipboard?.writeText(text);
    setCopiedMsg(true);
    setTimeout(() => setCopiedMsg(false), 2200);
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F4] flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <div className="h-9 w-9 mx-auto rounded-full border-2 border-[#181715] border-t-transparent animate-spin" />
          <p className="text-sm text-[#6E685F]">Abriendo el catálogo...</p>
        </div>
      </div>
    );
  }

  // Error / Code lookup state
  if (error || !store) {
    return (
      <div className="min-h-screen bg-[#FAF8F4] flex flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-md card p-7 text-center space-y-5">
          <div className="h-12 w-12 mx-auto rounded-2xl bg-[#F3EFE7] flex items-center justify-center text-[#181715]">
            <Store className="h-6 w-6" />
          </div>
          <div>
            <p className="kicker">Catálogo digital</p>
            <h1 className="mt-1 font-editorial text-3xl text-[#181715]">Entrá al catálogo del comercio</h1>
            <p className="mt-2 text-sm text-[#6E685F]">
              {error || 'Escribe el código del local (por ejemplo kiosko-CEIBA1) para ver sus productos y pedir por WhatsApp.'}
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadCatalog(lookupCode);
            }}
            className="space-y-3"
          >
            <input
              type="text"
              className="input-field text-center font-mono text-base"
              placeholder="kiosko-CEIBA1"
              value={lookupCode}
              onChange={(e) => setLookupCode(e.target.value)}
            />
            <button type="submit" className="btn-pill w-full">
              Abrir catálogo
            </button>
          </form>
          <div className="flex items-center justify-center gap-4 pt-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setLookupCode('kiosko-CEIBA1');
                loadCatalog('kiosko-CEIBA1');
              }}
              className="font-semibold text-[#C2542D] hover:underline cursor-pointer"
            >
              Probar catálogo de ejemplo
            </button>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-[#6E685F] hover:text-[#181715] cursor-pointer"
              >
                Volver al inicio
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Order sent confirmation screen
  if (confirmed) {
    return (
      <div className="min-h-screen bg-[#FAF8F4] px-4 py-10 flex items-center justify-center">
        <div className="w-full max-w-lg space-y-5">
          <div className="card p-6 sm:p-8 text-center space-y-5">
            <div className="h-14 w-14 mx-auto rounded-full bg-[#E6F5EF] text-[#15614B] flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8" />
            </div>

            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F3EFE7] px-3 py-1 text-xs font-mono font-semibold text-[#181715]">
                Pedido #{confirmed.order.order_code}
              </span>
              <h1 className="mt-3 font-editorial text-3xl sm:text-4xl text-[#181715]">
                ¡Tu pedido está listo para enviar!
              </h1>
              <p className="mt-2 text-sm text-[#6E685F]">
                Toca el botón verde para enviarlo al WhatsApp de{' '}
                <strong className="text-[#181715]">{store.business_name}</strong>
                {confirmed.whatsapp_phone ? ` (${confirmed.whatsapp_phone})` : ''} y recibir confirmación al instante.
              </p>
            </div>

            {!confirmed.has_store_whatsapp && ownerPreview && onConfigureWhatsapp && (
              <div className="rounded-2xl border border-[#E8B8A6] bg-[#FCECE6] p-3.5 text-left text-xs text-[#7D2F16] flex items-center justify-between gap-3">
                <span>Aún no cargaste tu número de WhatsApp. Configúralo para recibir los pedidos directo en tu celular.</span>
                <button
                  type="button"
                  onClick={onConfigureWhatsapp}
                  className="shrink-0 rounded-full bg-[#181715] px-3 py-1.5 text-white font-semibold cursor-pointer"
                >
                  Configurar
                </button>
              </div>
            )}

            <a
              href={confirmed.whatsapp_url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2.5 rounded-full bg-[#1DA851] hover:bg-[#178F44] text-white font-bold text-base px-6 py-4 shadow-lg shadow-[#1DA851]/25 transition-all"
            >
              <MessageCircle className="h-5 w-5" />
              Enviar pedido por WhatsApp
            </a>

            {/* Message preview */}
            <div className="rounded-2xl bg-[#EDF7ED] border border-[#CBE6CB] p-4 text-left space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#1F6E3D]">
                  Mensaje armado automáticamente
                </span>
                <button
                  type="button"
                  onClick={() => copyWhatsappText(confirmed.whatsapp_text)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#1F6E3D] hover:underline cursor-pointer"
                >
                  {copiedMsg ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedMsg ? 'Copiado' : 'Copiar texto'}
                </button>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-[#18261C]">
                {confirmed.whatsapp_text}
              </pre>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmed(null);
                  loadCatalog(store.company_code);
                }}
                className="btn-pill-outline text-xs py-2.5 px-5"
              >
                Seguir viendo el catálogo
              </button>
              {ownerPreview && onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="btn-pill text-xs py-2.5 px-5"
                >
                  Ver pedido en mi panel →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF8F4] text-[#181715] pb-32">
      {/* Owner live-preview banner */}
      {ownerPreview && (
        <div className="bg-[#181715] text-[#FAF8F4] px-4 py-2.5 sticky top-0 z-40">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#1DA851]/25 text-[#7BF1A8] px-2.5 py-0.5 font-semibold">
                <Eye className="h-3 w-3" />
                Vista de cliente
              </span>
              <span className="text-[#D4CFC5] hidden sm:inline">
                Así ven y arman su pedido tus clientes — pruébalo ahora mismo.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyCatalogShareLink}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/12 hover:bg-white/20 px-3 py-1 font-medium text-white transition cursor-pointer"
              >
                {copiedLink ? <Check className="h-3.5 w-3.5 text-[#7BF1A8]" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedLink ? 'Link copiado' : 'Copiar link'}
              </button>
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF8F4] text-[#181715] px-3.5 py-1 font-semibold hover:bg-[#F3EFE7] transition cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Volver a mi panel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Storefront Header */}
      <header className="border-b border-[#E7E1D6] bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-5 pb-6 space-y-4">
          {/* Top mini bar for public visitors */}
          {!ownerPreview && (
            <div className="flex items-center justify-between">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6E685F] hover:text-[#181715] cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Inicio
                </button>
              ) : (
                <span className="kicker">Catálogo online</span>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyCatalogShareLink}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#E7E1D6] bg-[#FAF8F4] px-3 py-1.5 text-xs font-medium text-[#3F3C37] hover:bg-[#F3EFE7] cursor-pointer"
                >
                  {copiedLink ? <Check className="h-3.5 w-3.5 text-[#15614B]" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedLink ? 'Copiado' : 'Compartir'}
                </button>
                {store.whatsapp_digits && (
                  <a
                    href={buildWhatsappUrl(
                      store.whatsapp_phone,
                      `¡Hola ${store.business_name}! Les escribo desde su catálogo online.`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#E6F5EF] text-[#15614B] px-3 py-1.5 text-xs font-semibold hover:bg-[#D5EEE4]"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    WhatsApp
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Store identity */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="h-14 w-14 shrink-0 rounded-2xl bg-[#181715] text-[#FAF8F4] flex items-center justify-center font-editorial text-2xl shadow-sm">
                {store.business_name?.slice(0, 1) || 'K'}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      store.catalog_enabled
                        ? 'bg-[#E6F5EF] text-[#15614B]'
                        : 'bg-[#F3EFE7] text-[#6E685F]'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        store.catalog_enabled ? 'bg-[#1DA851]' : 'bg-[#8C857B]'
                      }`}
                    />
                    {store.catalog_enabled ? 'Recibiendo pedidos por WhatsApp' : 'Pedidos en pausa'}
                  </span>
                  <span className="text-[11px] text-[#8A8379]">{store.business_type}</span>
                </div>
                <h1 className="mt-1 font-editorial text-3xl sm:text-4xl leading-tight text-[#181715]">
                  {store.business_name}
                </h1>
                {store.catalog_welcome && (
                  <p className="mt-1 text-sm text-[#5E584F] max-w-2xl">{store.catalog_welcome}</p>
                )}
              </div>
            </div>
          </div>

          {/* Clear store info pills — understood in 1 glance */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#4A463F]">
            {store.catalog_hours && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF8F4] border border-[#E7E1D6] px-3 py-1">
                <Clock className="h-3.5 w-3.5 text-[#8A8379]" />
                {store.catalog_hours}
              </span>
            )}
            {(store.address || store.municipality) && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF8F4] border border-[#E7E1D6] px-3 py-1">
                <MapPin className="h-3.5 w-3.5 text-[#8A8379]" />
                {[store.address, store.municipality].filter(Boolean).join(', ')}
              </span>
            )}
            {store.catalog_allow_pickup && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF8F4] border border-[#E7E1D6] px-3 py-1">
                <Store className="h-3.5 w-3.5 text-[#15614B]" />
                Retiro en local gratis
              </span>
            )}
            {store.catalog_allow_delivery && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF8F4] border border-[#E7E1D6] px-3 py-1">
                <Bike className="h-3.5 w-3.5 text-[#C2542D]" />
                {baseDeliveryFee > 0 ? `Envío ${formatCup(baseDeliveryFee, 0)}` : 'Envío gratis'}
                {freeFrom > 0 && baseDeliveryFee > 0 ? ` · Gratis desde ${formatCup(freeFrom, 0)}` : ''}
              </span>
            )}
            {qrPct > 0 && (store.has_transfermovil || store.has_enzona) && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E6F5EF] border border-[#BFE6D7] text-[#15614B] font-semibold px-3 py-1">
                <Sparkles className="h-3.5 w-3.5" />
                {qrPct}% de descuento pagando por QR
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Sticky Search + Category Bar */}
      <div
        className={`sticky ${
          ownerPreview ? 'top-[42px]' : 'top-0'
        } z-30 bg-[#FAF8F4]/95 backdrop-blur-md border-b border-[#E7E1D6]/80`}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 space-y-2.5">
          <div className="relative">
            <Search className="h-4 w-4 text-[#8A8379] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Buscar en ${store.business_name}...`}
              className="w-full rounded-full border border-[#E2DCD0] bg-white pl-10 pr-10 py-2.5 text-sm text-[#181715] placeholder:text-[#968F84] focus:outline-none focus:border-[#181715] shadow-xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#8A8379] hover:text-[#181715] cursor-pointer"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar">
            {categoryTabs.map((tab) => {
              const active = activeCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveCategory(tab.id)}
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    active
                      ? 'bg-[#181715] text-[#FAF8F4] shadow-xs'
                      : 'bg-white border border-[#E7E1D6] text-[#4A463F] hover:border-[#C9C0B1]'
                  }`}
                >
                  <span>{tab.emoji}</span>
                  <span>{tab.label}</span>
                  <span className={`text-[10px] ${active ? 'text-[#B8B2A7]' : 'text-[#968F84]'}`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Product Grid */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        {/* Simple 3-step micro-hint when cart is empty */}
        {cartCount === 0 && !search && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E685F]">
            <span>
              <strong className="text-[#181715]">¿Cómo pedir?</strong> 1. Tocá <strong>+ Agregar</strong> en lo que quieras · 2. Revisá tu pedido · 3. Envialo por WhatsApp.
            </span>
            <span>{filteredProducts.length} productos</span>
          </div>
        )}

        {filteredProducts.length === 0 ? (
          <div className="card p-10 text-center space-y-3">
            <p className="font-editorial text-2xl text-[#181715]">No encontramos productos con ese filtro</p>
            <p className="text-sm text-[#6E685F]">Prueba con otra palabra o vuelve a ver todo el catálogo.</p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setActiveCategory('TODOS');
              }}
              className="btn-pill-outline text-xs py-2 px-4"
            >
              Ver todos los productos
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredProducts.map((p) => {
              const qty = cart[p.id] || 0;
              const vis = getCategoryVisual(p.category);
              const outOfStock = !p.in_stock;
              const lowStock = p.in_stock && !store.catalog_allow_backorder && p.available_stock <= 5;

              return (
                <article
                  key={p.id}
                  className={`rounded-2xl bg-white border p-4 flex flex-col justify-between gap-3 transition-all ${
                    qty > 0
                      ? 'border-[#15614B] ring-2 ring-[#15614B]/15 shadow-sm'
                      : 'border-[#E7E1D6] hover:border-[#CFC6B6]'
                  } ${outOfStock ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-3.5">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        loading="lazy"
                        className="h-16 w-16 shrink-0 rounded-xl object-cover border border-[#E7E1D6] bg-[#F3EFE7]"
                      />
                    ) : (
                      <div
                        className={`h-14 w-14 shrink-0 rounded-2xl ${vis.bg} flex items-center justify-center text-2xl select-none`}
                      >
                        {vis.emoji}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        {p.catalog_featured && (
                          <span className="inline-flex items-center rounded-full bg-[#FEF4E0] text-[#945B10] px-2 py-0.5 text-[10px] font-bold">
                            ⭐ Destacado
                          </span>
                        )}
                        {outOfStock ? (
                          <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-[10px] font-bold">
                            Agotado
                          </span>
                        ) : store.catalog_show_stock_qty ? (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              lowStock
                                ? 'bg-[#FCECE6] text-[#B5421E]'
                                : 'bg-[#E6F5EF] text-[#15614B]'
                            }`}
                          >
                            Disponible · {formatNumber(p.available_stock)} {p.unit}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-[#E6F5EF] text-[#15614B] px-2 py-0.5 text-[10px] font-semibold">
                            {p.stock_label || 'Disponible'}
                          </span>
                        )}
                      </div>
                      <h2 className="text-[15px] font-bold text-[#181715] leading-snug">{p.name}</h2>
                      {p.compatibility && (
                        <p className="mt-0.5 text-[11px] font-medium text-[#4A463F] truncate">
                          {p.compatibility}
                        </p>
                      )}
                      {p.catalog_description ? (
                        <p className="mt-0.5 text-xs text-[#6E685F] line-clamp-2">{p.catalog_description}</p>
                      ) : !p.compatibility ? (
                        <p className="mt-0.5 text-[11px] text-[#8A8379]">{p.category}</p>
                      ) : null}
                    </div>
                  </div>

                  {/* Price + Tactile Add / Stepper */}
                  <div className="flex items-end justify-between gap-2 pt-2 border-t border-[#F3EFE7]">
                    <div>
                      <p className="text-lg font-extrabold tracking-tight text-[#181715] tabular-nums">
                        {formatCup(p.sale_price_cup)}
                      </p>
                      <p className="text-[11px] text-[#8A8379]">{unitLabel(p.unit)}</p>
                    </div>

                    {!store.catalog_enabled || outOfStock ? (
                      <span className="rounded-full bg-[#F3EFE7] px-3.5 py-2 text-xs font-bold text-[#7A746B]">
                        {outOfStock ? 'Agotado' : 'Pausado'}
                      </span>
                    ) : qty === 0 ? (
                      <button
                        type="button"
                        onClick={() => setItemQty(p, 1)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#181715] hover:bg-[#2E2C28] active:scale-95 text-[#FAF8F4] font-semibold text-xs px-4 py-2.5 transition cursor-pointer"
                      >
                        <Plus className="h-4 w-4" />
                        Agregar
                      </button>
                    ) : (
                      <div className="inline-flex items-center gap-1 rounded-full bg-[#15614B] text-white p-1 shadow-xs">
                        <button
                          type="button"
                          onClick={() => setItemQty(p, qty - 1)}
                          className="h-8 w-8 rounded-full hover:bg-white/15 flex items-center justify-center transition cursor-pointer"
                          aria-label={`Quitar ${p.name}`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="min-w-[28px] text-center text-sm font-extrabold tabular-nums">
                          {formatNumber(qty)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setItemQty(p, qty + 1)}
                          className="h-8 w-8 rounded-full hover:bg-white/15 flex items-center justify-center transition cursor-pointer"
                          aria-label={`Sumar ${p.name}`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Floating Sticky Cart Bar */}
      {cartItems.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 p-3 sm:p-4 bg-gradient-to-t from-[#FAF8F4] via-[#FAF8F4]/95 to-transparent pointer-events-none">
          <div className="max-w-xl mx-auto pointer-events-auto space-y-1.5">
            {store.catalog_allow_delivery && freeFrom > 0 && baseDeliveryFee > 0 && (
              <div className="rounded-full bg-white/95 border border-[#E7E1D6] px-3.5 py-1 text-center text-[11px] font-medium text-[#4A463F] shadow-xs">
                {qualifiesFreeDelivery ? (
                  <span className="text-[#15614B] font-semibold">
                    🎉 ¡Genial! Tu pedido tiene envío a domicilio gratis
                  </span>
                ) : (
                  <span>
                    Agregá <strong>{formatCup(remainingForFreeDelivery, 0)}</strong> más para tener{' '}
                    <strong className="text-[#15614B]">envío gratis</strong>
                  </span>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setFormError('');
                setDrawerOpen(true);
              }}
              className="w-full rounded-full bg-[#1DA851] hover:bg-[#178F44] active:scale-[0.99] text-white px-5 py-3.5 shadow-xl shadow-[#181715]/20 flex items-center justify-between gap-3 transition cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <span className="h-8 min-w-[32px] px-2 rounded-full bg-black/20 flex items-center justify-center text-sm font-extrabold tabular-nums">
                  {formatNumber(cartCount)}
                </span>
                <div className="text-left">
                  <p className="text-sm font-bold leading-tight">Ver mi pedido</p>
                  <p className="text-[11px] text-white/85 leading-tight">Enviar por WhatsApp</p>
                </div>
              </div>
              <span className="text-base font-extrabold tabular-nums">{formatCup(subtotal)} →</span>
            </button>
          </div>
        </div>
      )}

      {/* Slide-Up / Centered Order Builder Sheet */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[92vh] bg-[#FAF8F4] rounded-t-3xl sm:rounded-3xl border border-[#E7E1D6] shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Header */}
            <div className="px-5 py-4 bg-white border-b border-[#E7E1D6] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShoppingBag className="h-5 w-5 text-[#15614B]" />
                <div>
                  <h2 className="text-base font-bold text-[#181715]">Tu pedido</h2>
                  <p className="text-[11px] text-[#6E685F]">
                    {store.business_name} · {cartItems.length}{' '}
                    {cartItems.length === 1 ? 'producto' : 'productos'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setCart({});
                    setDrawerOpen(false);
                  }}
                  className="rounded-full px-2.5 py-1.5 text-[11px] font-medium text-[#8A8379] hover:text-[#9E2A2B] hover:bg-[#FBEAEA] inline-flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Vaciar
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="h-8 w-8 rounded-full bg-[#F3EFE7] hover:bg-[#E7E1D6] flex items-center justify-center text-[#181715] cursor-pointer"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <form onSubmit={handleSubmitOrder} className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* 1. Cart lines */}
              <div className="rounded-2xl bg-white border border-[#E7E1D6] divide-y divide-[#F3EFE7]">
                {cartItems.map((it) => (
                  <div key={it.product_id} className="p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#181715] truncate">{it.product_name}</p>
                      <p className="text-xs text-[#6E685F] tabular-nums">
                        {formatCup(it.unit_price_cup)} × {formatNumber(it.quantity)} ={' '}
                        <strong className="text-[#181715]">{formatCup(it.subtotal_cup)}</strong>
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-full bg-[#F3EFE7] p-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (cartItems.length === 1 && it.quantity <= 1) setDrawerOpen(false);
                          setItemQty(it.product, it.quantity - 1);
                        }}
                        className="h-7 w-7 rounded-full bg-white hover:bg-[#E7E1D6] flex items-center justify-center text-[#181715] cursor-pointer"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="min-w-[24px] text-center text-xs font-bold tabular-nums">
                        {formatNumber(it.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setItemQty(it.product, it.quantity + 1)}
                        className="h-7 w-7 rounded-full bg-white hover:bg-[#E7E1D6] flex items-center justify-center text-[#181715] cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="px-3.5 py-2.5 bg-[#FAF8F4]/60 text-center">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="text-xs font-semibold text-[#15614B] hover:underline cursor-pointer"
                  >
                    + Agregar más productos
                  </button>
                </div>
              </div>

              {/* 2. Delivery or Pickup */}
              {store.catalog_allow_pickup && store.catalog_allow_delivery && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[#181715]">
                    1. ¿Cómo lo quieres recibir?
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setDeliveryMode('RETIRO')}
                      className={`rounded-2xl border p-3 text-left transition cursor-pointer ${
                        deliveryMode === 'RETIRO'
                          ? 'bg-[#181715] text-white border-[#181715]'
                          : 'bg-white text-[#181715] border-[#E7E1D6] hover:border-[#C9C0B1]'
                      }`}
                    >
                      <Store className="h-4 w-4 mb-1" />
                      <p className="text-xs font-bold">Retiro en local</p>
                      <p
                        className={`text-[11px] ${
                          deliveryMode === 'RETIRO' ? 'text-[#C8C2B7]' : 'text-[#15614B] font-medium'
                        }`}
                      >
                        Sin costo
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveryMode('DOMICILIO')}
                      className={`rounded-2xl border p-3 text-left transition cursor-pointer ${
                        deliveryMode === 'DOMICILIO'
                          ? 'bg-[#181715] text-white border-[#181715]'
                          : 'bg-white text-[#181715] border-[#E7E1D6] hover:border-[#C9C0B1]'
                      }`}
                    >
                      <Bike className="h-4 w-4 mb-1" />
                      <p className="text-xs font-bold">Envío a domicilio</p>
                      <p
                        className={`text-[11px] ${
                          deliveryMode === 'DOMICILIO' ? 'text-[#C8C2B7]' : 'text-[#6E685F]'
                        }`}
                      >
                        {qualifiesFreeDelivery || baseDeliveryFee === 0
                          ? '¡Envío gratis!'
                          : `+ ${formatCup(baseDeliveryFee, 0)}`}
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {deliveryMode === 'DOMICILIO' && (
                <div>
                  <label className="block text-xs font-semibold text-[#181715] mb-1">
                    Dirección de entrega y referencia *
                  </label>
                  <input
                    type="text"
                    required
                    className="input-field bg-white"
                    placeholder="Ej: Calle 23 #450 apto 2, entre H e I"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                  />
                </div>
              )}

              {/* 3. Payment Method */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#181715]">
                  2. ¿Cómo prefieres pagar?
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'EFECTIVO', label: 'Efectivo', sub: 'Al recibir', icon: Wallet, show: true },
                    {
                      id: 'TRANSFERMOVIL',
                      label: 'Transfermóvil',
                      sub: qrPct > 0 ? `-${qrPct}% dto.` : 'Pago QR',
                      icon: QrCode,
                      show: store.has_transfermovil !== false,
                    },
                    {
                      id: 'ENZONA',
                      label: 'EnZona',
                      sub: qrPct > 0 ? `-${qrPct}% dto.` : 'Pago QR',
                      icon: QrCode,
                      show: store.has_enzona !== false,
                    },
                  ]
                    .filter((m) => m.show)
                    .map((m) => {
                      const Icon = m.icon;
                      const selected = paymentMethod === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setPaymentMethod(m.id)}
                          className={`rounded-2xl border p-2.5 text-left transition cursor-pointer ${
                            selected
                              ? 'bg-[#181715] text-white border-[#181715]'
                              : 'bg-white text-[#181715] border-[#E7E1D6] hover:border-[#C9C0B1]'
                          }`}
                        >
                          <Icon className="h-4 w-4 mb-1" />
                          <p className="text-xs font-bold truncate">{m.label}</p>
                          <p
                            className={`text-[10px] ${
                              selected
                                ? 'text-[#7BF1A8]'
                                : qrPct > 0 && m.id !== 'EFECTIVO'
                                ? 'text-[#15614B] font-semibold'
                                : 'text-[#8A8379]'
                            }`}
                          >
                            {m.sub}
                          </p>
                        </button>
                      );
                    })}
                </div>

                {paymentMethod === 'EFECTIVO' && (
                  <div className="rounded-2xl bg-white border border-[#E7E1D6] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[#5E584F]">¿Necesitas vuelto? (opcional)</span>
                      {changeDue > 0 && (
                        <span className="text-xs font-bold text-[#15614B]">
                          Vuelto: {formatCup(changeDue)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCashTendered('')}
                        className={`rounded-full px-3 py-1 text-xs font-semibold cursor-pointer ${
                          !cashTendered
                            ? 'bg-[#181715] text-white'
                            : 'bg-[#F3EFE7] text-[#4A463F] hover:bg-[#E7E1D6]'
                        }`}
                      >
                        Pago justo
                      </button>
                      {suggestedBills.map((bill) => (
                        <button
                          key={bill}
                          type="button"
                          onClick={() => setCashTendered(String(bill))}
                          className={`rounded-full px-3 py-1 text-xs font-semibold tabular-nums cursor-pointer ${
                            Number(cashTendered) === bill
                              ? 'bg-[#181715] text-white'
                              : 'bg-[#F3EFE7] text-[#4A463F] hover:bg-[#E7E1D6]'
                          }`}
                        >
                          Con ${bill.toLocaleString('es-ES')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Customer Info */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-[#181715]">
                  3. Tus datos para confirmar
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <input
                      type="text"
                      required
                      className="input-field bg-white"
                      placeholder="Tu nombre *"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                  </div>
                  <div>
                    <input
                      type="tel"
                      className="input-field bg-white"
                      placeholder="Tu teléfono / WhatsApp"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                    />
                  </div>
                </div>
                <input
                  type="text"
                  className="input-field bg-white"
                  placeholder="Nota opcional (ej: tocar timbre, paso a las 18:00...)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {/* Summary box */}
              <div className="rounded-2xl bg-white border border-[#E7E1D6] p-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-xs text-[#6E685F]">
                  <span>Productos ({formatNumber(cartCount)})</span>
                  <span className="tabular-nums">{formatCup(subtotal)}</span>
                </div>
                {discountCup > 0 && (
                  <div className="flex justify-between text-xs text-[#15614B] font-semibold">
                    <span>Descuento pago QR ({qrPct}%)</span>
                    <span className="tabular-nums">-{formatCup(discountCup)}</span>
                  </div>
                )}
                {deliveryMode === 'DOMICILIO' && (
                  <div className="flex justify-between text-xs text-[#6E685F]">
                    <span>Envío a domicilio</span>
                    <span className="tabular-nums font-medium text-[#15614B]">
                      {deliveryFeeCup > 0 ? formatCup(deliveryFeeCup) : '¡Gratis!'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-baseline pt-2 border-t border-[#F3EFE7]">
                  <span className="text-sm font-bold text-[#181715]">Total a pagar</span>
                  <span className="text-xl font-extrabold text-[#181715] tabular-nums">
                    {formatCup(totalCup)}
                  </span>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowWaPreview((v) => !v)}
                    className="text-[11px] font-semibold text-[#15614B] hover:underline cursor-pointer"
                  >
                    {showWaPreview ? 'Ocultar vista previa del mensaje' : 'Ver mensaje que se enviará por WhatsApp'}
                  </button>
                  {showWaPreview && (
                    <pre className="mt-2 rounded-xl bg-[#EDF7ED] border border-[#CBE6CB] p-3 whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-[#18261C]">
                      {liveWhatsappPreview}
                    </pre>
                  )}
                </div>
              </div>

              {formError && (
                <div className="rounded-xl bg-[#FBEAEA] border border-[#E6B8B8] px-3.5 py-2.5 text-xs font-medium text-[#9E2A2B]">
                  {formError}
                </div>
              )}

              {/* Big unmistakable WhatsApp Submit Button */}
              <button
                type="submit"
                disabled={submitting || belowMinOrder}
                className="w-full inline-flex items-center justify-center gap-2.5 rounded-full bg-[#1DA851] hover:bg-[#178F44] disabled:opacity-50 text-white font-bold text-base px-6 py-4 shadow-lg shadow-[#1DA851]/25 transition cursor-pointer"
              >
                <MessageCircle className="h-5 w-5" />
                {submitting
                  ? 'Preparando tu pedido...'
                  : belowMinOrder
                  ? `Pedido mínimo ${formatCup(minOrderCup, 0)}`
                  : `Enviar pedido al WhatsApp · ${formatCup(totalCup)}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
