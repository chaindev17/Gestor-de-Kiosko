import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Download,
  FilePlus2,
  Package,
  Plus,
  Send,
  Truck,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { downloadCsv, formatCup, formatDate, formatDateTime, formatNumber } from '../lib/format.js';
import StatCard from '../components/StatCard.jsx';
import Modal from '../components/Modal.jsx';

export default function WarehousePage({ user, onRefreshBadges, notify }) {
  const [tab, setTab] = useState('submayor');
  const [products, setProducts] = useState([]);
  const [mfpCaps, setMfpCaps] = useState([]);
  const [cashLimit, setCashLimit] = useState(5000);
  const [restocks, setRestocks] = useState([]);
  const [movements, setMovements] = useState([]);
  const [kardexProduct, setKardexProduct] = useState(null);
  const [kardexRows, setKardexRows] = useState([]);
  const [busy, setBusy] = useState(false);

  // Forms
  const [recForm, setRecForm] = useState({
    product_id: '',
    quantity: 20,
    unit_cost_cup: '',
    supplier_name: 'Comercializadora Mayorista Alimentos Habana',
    supplier_nit: '30001849201',
    invoice_number: '',
    payment_method: 'TRANSFERENCIA',
    payment_ref: '',
    batch_code: '',
    expiry_date: '',
    reason: '',
  });

  const [trfForm, setTrfForm] = useState({ product_id: '', quantity: 10, reason: '' });
  const [mermaForm, setMermaForm] = useState({
    product_id: '',
    quantity: 1,
    location: 'ALMACEN',
    reason: '',
  });

  const [newProdModal, setNewProdModal] = useState(false);
  const [newProd, setNewProd] = useState({
    sku: '',
    name: '',
    category: 'Alimentos y Conservas',
    unit: 'kg',
    unit_cost_cup: 300,
    sale_price_cup: '',
    is_price_capped: false,
    price_cap_cup: '',
    price_cap_resolution: 'Res. 225/2024 MFP',
    warehouse_min_stock: 10,
    kiosk_min_stock: 5,
    kiosk_target_stock: 20,
  });

  const canOperateWarehouse = user.role === 'almacenero' || user.role === 'jefe';
  const canApproveMerma = user.role === 'economico' || user.role === 'jefe';

  const load = useCallback(async () => {
    try {
      const [pRes, rRes, mRes] = await Promise.all([
        api.get('/api/warehouse/products'),
        api.get('/api/warehouse/restock-requests'),
        api.get('/api/warehouse/movements'),
      ]);
      const list = pRes.products || [];
      setProducts(list);
      setMfpCaps(pRes.mfp_res_225_caps || []);
      setCashLimit(pRes.max_cash_provider_payment_cup || 5000);
      setRestocks(rRes.requests || []);
      setMovements(mRes.movements || []);

      if (list.length > 0) {
        setRecForm((f) =>
          f.product_id ? f : { ...f, product_id: list[0].id, unit_cost_cup: list[0].unit_cost_cup }
        );
        setTrfForm((f) => (f.product_id ? f : { ...f, product_id: list[0].id }));
        setMermaForm((f) => (f.product_id ? f : { ...f, product_id: list[0].id }));
      }
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function openKardex(product) {
    setKardexProduct(product);
    try {
      const res = await api.get(`/api/warehouse/movements?product_id=${product.id}`);
      setKardexRows(res.movements || []);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function fulfillOne(id) {
    setBusy(true);
    try {
      const r = await api.post(`/api/warehouse/restock-requests/${id}/fulfill`, {});
      notify(
        `Vale ${r.doc_number}: Despachados ${r.quantity} de ${r.product_name} al Kiosko e IPV (${r.journal_entry}).`
      );
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function fulfillAll() {
    setBusy(true);
    try {
      const r = await api.post('/api/warehouse/restock-requests/fulfill-all', {});
      notify(`${r.count} órdenes despachadas automáticamente al mostrador (SC-2-09 + IPV + NCIF).`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitReceipt(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/warehouse/receipts', recForm);
      notify(
        `Recepción ${r.doc_number} registrada. Costo ponderado: ${formatCup(r.new_weighted_cost_cup)} · Asiento ${r.journal_entry}.`
      );
      setRecForm((f) => ({ ...f, invoice_number: '', payment_ref: '', batch_code: '', reason: '' }));
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitTransfer(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/warehouse/transfers', trfForm);
      notify(
        `Transferencia ${r.doc_number}: ${r.quantity} de ${r.product_name} enviados a mostrador${
          r.ipv_updated ? ' (IPV actualizado)' : ''
        }.`
      );
      setTrfForm((f) => ({ ...f, reason: '' }));
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submitMerma(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/warehouse/mermas', mermaForm);
      notify(`Acta de merma ${r.doc_number} registrada y enviada a aprobación de Economía/Jefe.`);
      setMermaForm((f) => ({ ...f, quantity: 1, reason: '' }));
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function decideMerma(id, decision) {
    setBusy(true);
    try {
      const r = await api.post(`/api/warehouse/mermas/${id}/decide`, { decision });
      notify(
        decision === 'RECHAZAR'
          ? `Acta ${r.doc_number} rechazada.`
          : `Acta ${r.doc_number} aprobada, rebajada del stock y contabilizada (${r.journal_entry}).`
      );
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createProduct(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/warehouse/products', newProd);
      notify(`Producto ${r.sku} creado con precio MFP ${formatCup(r.sale_price_cup)}.`);
      setNewProdModal(false);
      setNewProd({
        sku: '',
        name: '',
        category: 'Alimentos y Conservas',
        unit: 'kg',
        unit_cost_cup: 300,
        sale_price_cup: '',
        is_price_capped: false,
        price_cap_cup: '',
        price_cap_resolution: 'Res. 225/2024 MFP',
        warehouse_min_stock: 10,
        kiosk_min_stock: 5,
        kiosk_target_stock: 20,
      });
      await load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const pendingRestocks = restocks.filter((r) => r.status === 'PENDIENTE');
  const pendingMermas = movements.filter((m) => m.status === 'PENDIENTE_APROBACION');
  const whValue = products.reduce((a, p) => a + p.warehouse_value_cup, 0);
  const kioskValue = products.reduce((a, p) => a + p.kiosk_value_cup, 0);
  const expiringCount = products.filter((p) => p.expiry_status !== 'VIGENTE').length;
  const recTotal = (Number(recForm.quantity) || 0) * (Number(recForm.unit_cost_cup) || 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#171C22]">
            Almacén Central y Abastecimiento Automatizado
          </h1>
          <p className="text-xs text-[#66707D] mt-0.5">
            Modelos cubanos SC-2-04 (Recepción), SC-2-09 (Transferencia a Kiosko), SC-2-14 (Estiba) y SC-2-16 (Mermas)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                'Submayor-Inventario-SC214.csv',
                ['SKU', 'Producto', 'UM', 'Almacén', 'Mostrador', 'Costo Pond. CUP', 'Precio CUP', 'Lote', 'Vence'],
                products.map((p) => [
                  p.sku,
                  p.name,
                  p.unit,
                  p.warehouse_stock,
                  p.kiosk_stock,
                  p.unit_cost_cup,
                  p.sale_price_cup,
                  p.current_batch,
                  p.next_expiry_date,
                ])
              )
            }
            className="btn-secondary text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            Submayor CSV
          </button>
          <button type="button" onClick={() => setNewProdModal(true)} className="btn-primary text-xs">
            <Plus className="h-3.5 w-3.5" />
            Nuevo producto
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Almacén Central (Cta. 189)"
          value={formatCup(whValue)}
          hint={`${products.length} renglones en custodia del Almacenero`}
          icon={Package}
          tone="brand"
        />
        <StatCard
          label="Mostrador Kiosko (Cta. 190)"
          value={formatCup(kioskValue)}
          hint="Controlado en el IPV del turno activo"
          icon={ArrowRightLeft}
          tone="navy"
        />
        <StatCard
          label="Auto-Reabastecimiento"
          value={`${pendingRestocks.length} orden(es)`}
          hint="Generadas al bajar del mínimo en mostrador"
          icon={Zap}
          tone={pendingRestocks.length > 0 ? 'amber' : 'default'}
        />
        <StatCard
          label="Alerta FEFO / Mermas"
          value={`${expiringCount} lote(s) · ${pendingMermas.length} acta(s)`}
          hint="Vencimientos ≤15 días y mermas por aprobar"
          icon={AlertTriangle}
          tone={expiringCount > 0 || pendingMermas.length > 0 ? 'amber' : 'default'}
        />
      </div>

      {/* Automated Restock Orders Banner */}
      {pendingRestocks.length > 0 && (
        <div className="card p-4 border-amber-300 bg-amber-50/40 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#8A4B08]" />
              <div>
                <h2 className="text-sm font-bold text-[#171C22]">
                  Órdenes Automáticas de Despacho al Kiosko ({pendingRestocks.length})
                </h2>
                <p className="text-xs text-[#58616E]">
                  Al despachar se emite el SC-2-09, se suma al IPV de los 2 vendedores y se contabiliza automáticamente.
                </p>
              </div>
            </div>
            {canOperateWarehouse && (
              <button type="button" disabled={busy} onClick={fulfillAll} className="btn-primary text-xs">
                <Send className="h-3.5 w-3.5" />
                Despachar Todas en 1 Clic
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {pendingRestocks.map((rr) => (
              <div
                key={rr.id}
                className="rounded-lg border border-[#E3DFD5] bg-white p-3 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                        rr.priority === 'URGENTE'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {rr.priority}
                    </span>
                    <span className="text-[10px] text-[#6F7885]">{rr.origin}</span>
                  </div>
                  <p className="font-semibold text-[#171C22] truncate mt-1">{rr.product_name}</p>
                  <p className="text-[11px] text-[#66707D] tabular-nums">
                    Kiosko: {rr.kiosk_stock} · Almacén: {rr.warehouse_stock} · Sugerido:{' '}
                    <strong>
                      +{rr.suggested_qty} {rr.unit}
                    </strong>
                  </p>
                </div>
                {canOperateWarehouse && (
                  <button
                    type="button"
                    disabled={busy || rr.warehouse_stock <= 0}
                    onClick={() => fulfillOne(rr.id)}
                    className="btn-secondary text-[11px] py-1 px-2.5 shrink-0"
                  >
                    Despachar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-[#E3DFD5] pb-2">
        {[
          { id: 'submayor', label: 'Submayor / Estiba (SC-2-14)' },
          ...(canOperateWarehouse
            ? [
                { id: 'recepcion', label: 'Recepción Proveedor (SC-2-04)' },
                { id: 'transferencia', label: 'Despacho a Kiosko (SC-2-09)' },
              ]
            : []),
          { id: 'mermas', label: `Mermas (SC-2-16)${pendingMermas.length ? ` (${pendingMermas.length})` : ''}` },
          { id: 'movimientos', label: 'Historial Documental' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
              tab === t.id ? 'bg-[#0F5C4D] text-white' : 'bg-white text-[#4C5561] border border-[#E3DFD5] hover:bg-[#F3F1EB]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: Submayor SC-2-14 */}
      {tab === 'submayor' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">SKU / Producto</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Almacén</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Mostrador</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Costo Pond.</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Precio CUP</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Lote / Vence (FEFO)</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Estiba</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-[#FAF9F5]">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-[#171C22]">{p.name}</p>
                      <p className="text-[11px] text-[#6F7885]">
                        {p.sku} · {p.category}
                      </p>
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-semibold ${
                        p.low_warehouse ? 'text-red-700' : 'text-[#171C22]'
                      }`}
                    >
                      {formatNumber(p.warehouse_stock)} {p.unit}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-semibold ${
                        p.low_kiosk ? 'text-amber-700' : 'text-[#0F5C4D]'
                      }`}
                    >
                      {formatNumber(p.kiosk_stock)} {p.unit}
                    </td>
                    <td className="px-3 py-2.5 text-right">{formatCup(p.unit_cost_cup)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{formatCup(p.sale_price_cup, 0)}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[11px]">{p.current_batch || '—'}</span>
                      {p.next_expiry_date && (
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            p.expiry_status === 'VENCIDO'
                              ? 'bg-red-100 text-red-800'
                              : p.expiry_status === 'PROXIMO_VENCER'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-[#F2F0E9] text-[#525B68]'
                          }`}
                        >
                          {formatDate(p.next_expiry_date)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => openKardex(p)}
                        className="text-xs font-semibold text-[#0F5C4D] hover:underline cursor-pointer"
                      >
                        Kardex
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Recepción SC-2-04 */}
      {tab === 'recepcion' && canOperateWarehouse && (
        <div className="card p-5 max-w-3xl">
          <div className="flex items-center gap-2 mb-4">
            <Truck className="h-4 w-4 text-[#0F5C4D]" />
            <div>
              <h2 className="text-sm font-bold text-[#171C22]">
                Informe de Recepción de Mercancías (Modelo SC-2-04)
              </h2>
              <p className="text-xs text-[#66707D]">
                Recalcula automáticamente costo promedio ponderado, Ficha de Costo MFP y asiento NCIF. Controla límite de{' '}
                {formatCup(cashLimit, 0)} en efectivo (Res. 111/2023 BCC).
              </p>
            </div>
          </div>

          <form onSubmit={submitReceipt} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block font-medium mb-1">Producto</label>
                <select
                  className="input-field"
                  value={recForm.product_id}
                  onChange={(e) => {
                    const pid = Number(e.target.value);
                    const found = products.find((p) => p.id === pid);
                    setRecForm({
                      ...recForm,
                      product_id: pid,
                      unit_cost_cup: found?.unit_cost_cup || '',
                    });
                  }}
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name} (Stock alm.: {p.warehouse_stock} {p.unit})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Cantidad recibida</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  className="input-field tabular-nums"
                  value={recForm.quantity}
                  onChange={(e) => setRecForm({ ...recForm, quantity: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium mb-1">Costo unitario compra (CUP)</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  className="input-field tabular-nums"
                  value={recForm.unit_cost_cup}
                  onChange={(e) => setRecForm({ ...recForm, unit_cost_cup: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Proveedor (MIPYME / Estatal / TCP)</label>
                <input
                  className="input-field"
                  value={recForm.supplier_name}
                  onChange={(e) => setRecForm({ ...recForm, supplier_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block font-medium mb-1">NIT / REEUP Proveedor</label>
                <input
                  className="input-field font-mono"
                  value={recForm.supplier_nit}
                  onChange={(e) => setRecForm({ ...recForm, supplier_nit: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium mb-1">Nro. Factura o Conduce *</label>
                <input
                  className="input-field font-mono"
                  placeholder="FAC-2026-1420"
                  value={recForm.invoice_number}
                  onChange={(e) => setRecForm({ ...recForm, invoice_number: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Código de Lote</label>
                <input
                  className="input-field font-mono"
                  placeholder="LT-1126-A"
                  value={recForm.batch_code}
                  onChange={(e) => setRecForm({ ...recForm, batch_code: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Fecha de vencimiento</label>
                <input
                  type="date"
                  className="input-field"
                  value={recForm.expiry_date}
                  onChange={(e) => setRecForm({ ...recForm, expiry_date: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg bg-[#FAF9F5] border border-[#E5E1D7] p-3">
              <div>
                <label className="block font-medium mb-1">Medio de pago (Res. 111/2023 BCC)</label>
                <select
                  className="input-field"
                  value={recForm.payment_method}
                  onChange={(e) => setRecForm({ ...recForm, payment_method: e.target.value })}
                >
                  <option value="TRANSFERENCIA">Transferencia Bancaria (Cuenta Fiscal)</option>
                  <option value="TRANSFERMOVIL">Transfermóvil B2B</option>
                  <option value="ENZONA">EnZona B2B</option>
                  <option value="CREDITO">Crédito Comercial (Cta. 405 Proveedores)</option>
                  <option value="EFECTIVO">Efectivo CUP (solo ≤ {cashLimit} CUP)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Referencia bancaria / electrónica</label>
                <input
                  className="input-field font-mono"
                  placeholder={
                    ['TRANSFERENCIA', 'TRANSFERMOVIL', 'ENZONA'].includes(recForm.payment_method)
                      ? 'Ej. BM-TRF-99012 (obligatorio)'
                      : 'Opcional'
                  }
                  value={recForm.payment_ref}
                  onChange={(e) => setRecForm({ ...recForm, payment_ref: e.target.value })}
                />
              </div>
              {recForm.payment_method === 'EFECTIVO' && recTotal > cashLimit && (
                <p className="sm:col-span-2 text-xs font-semibold text-red-700">
                  Alerta Res. 111/2023 BCC: El importe total ({formatCup(recTotal)}) supera {formatCup(cashLimit, 0)}. El
                  sistema bloqueará el pago en efectivo; seleccione transferencia o pasarela electrónica.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-sm font-bold text-[#171C22] tabular-nums">
                Importe total factura: {formatCup(recTotal)}
              </span>
              <button type="submit" disabled={busy} className="btn-primary text-xs">
                <FilePlus2 className="h-3.5 w-3.5" />
                Emitir Informe SC-2-04
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: Transferencia a Kiosko SC-2-09 */}
      {tab === 'transferencia' && canOperateWarehouse && (
        <div className="card p-5 max-w-xl">
          <h2 className="text-sm font-bold text-[#171C22] mb-1">
            Vale de Transferencia Almacén → Mostrador (SC-2-09)
          </h2>
          <p className="text-xs text-[#66707D] mb-4">
            Rebaja automáticamente Almacén (Cta. 189), incrementa Mostrador (Cta. 190) y suma Entradas en el IPV activo.
          </p>
          <form onSubmit={submitTransfer} className="space-y-3.5 text-xs">
            <div>
              <label className="block font-medium mb-1">Producto a despachar</label>
              <select
                className="input-field"
                value={trfForm.product_id}
                onChange={(e) => setTrfForm({ ...trfForm, product_id: Number(e.target.value) })}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — Almacén: {p.warehouse_stock} {p.unit} | Kiosko: {p.kiosk_stock} {p.unit}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Cantidad a entregar al turno</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                className="input-field tabular-nums"
                value={trfForm.quantity}
                onChange={(e) => setTrfForm({ ...trfForm, quantity: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Observación</label>
              <input
                className="input-field"
                placeholder="Ej. Reposición media mañana (rotación FEFO)"
                value={trfForm.reason}
                onChange={(e) => setTrfForm({ ...trfForm, reason: e.target.value })}
              />
            </div>
            <div className="flex justify-end pt-2">
              <button type="submit" disabled={busy} className="btn-primary text-xs">
                <Send className="h-3.5 w-3.5" />
                Emitir Vale SC-2-09 y actualizar IPV
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 4: Mermas SC-2-16 */}
      {tab === 'mermas' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {canOperateWarehouse && (
            <div className="card p-5 lg:col-span-5">
              <h2 className="text-sm font-bold text-[#171C22] mb-1">Reportar Merma o Rotura (SC-2-16)</h2>
              <p className="text-xs text-[#66707D] mb-4">
                Por Control Interno (Res. 60/22), el Almacenero reporta y el Económico o Jefe aprueba antes de afectar
                inventario y utilidades.
              </p>
              <form onSubmit={submitMerma} className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium mb-1">Producto</label>
                  <select
                    className="input-field"
                    value={mermaForm.product_id}
                    onChange={(e) => setMermaForm({ ...mermaForm, product_id: Number(e.target.value) })}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Alm: {p.warehouse_stock} / Kiosko: {p.kiosk_stock} {p.unit})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium mb-1">Área afectada</label>
                    <select
                      className="input-field"
                      value={mermaForm.location}
                      onChange={(e) => setMermaForm({ ...mermaForm, location: e.target.value })}
                    >
                      <option value="ALMACEN">Almacén Central</option>
                      <option value="KIOSKO">Mostrador Kiosko</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium mb-1">Cantidad</label>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      className="input-field tabular-nums"
                      value={mermaForm.quantity}
                      onChange={(e) => setMermaForm({ ...mermaForm, quantity: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-medium mb-1">Causa justificada *</label>
                  <input
                    className="input-field"
                    placeholder="Ej. Rotura de envase en descarga o vencimiento de lote"
                    value={mermaForm.reason}
                    onChange={(e) => setMermaForm({ ...mermaForm, reason: e.target.value })}
                    required
                  />
                </div>
                <button type="submit" disabled={busy} className="btn-primary text-xs w-full">
                  Enviar Acta SC-2-16 a Aprobación
                </button>
              </form>
            </div>
          )}

          <div className={`card p-5 space-y-3 ${canOperateWarehouse ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
            <h2 className="text-sm font-bold text-[#171C22]">Actas SC-2-16 Registradas</h2>
            <div className="space-y-2.5 text-xs">
              {movements
                .filter((m) => m.type === 'MERMA')
                .map((m) => (
                  <div
                    key={m.id}
                    className="rounded-lg border border-[#E3DFD5] bg-[#FAF9F5] p-3.5 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold">{m.doc_number}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            m.status === 'APLICADO'
                              ? 'bg-emerald-100 text-emerald-800'
                              : m.status === 'RECHAZADO'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {m.status}
                        </span>
                      </div>
                      <p className="font-semibold text-[#171C22]">
                        {m.quantity} {m.unit} de {m.product_name} ({formatCup(m.total_cost_cup)})
                      </p>
                      <p className="text-[#58616E]">{m.reason}</p>
                      <p className="text-[11px] text-[#7B8491]">Reportado por: {m.created_by_name}</p>
                    </div>
                    {canApproveMerma && m.status === 'PENDIENTE_APROBACION' && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => decideMerma(m.id, 'APROBAR')}
                          className="btn-primary text-[11px] py-1 px-2.5"
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => decideMerma(m.id, 'RECHAZAR')}
                          className="btn-secondary text-[11px] py-1 px-2.5"
                        >
                          Rechazar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Historial Documental */}
      {tab === 'movimientos' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
                <tr>
                  <th className="px-4 py-2.5 text-left">Documento</th>
                  <th className="px-3 py-2.5 text-left">Tipo</th>
                  <th className="px-3 py-2.5 text-left">Producto</th>
                  <th className="px-3 py-2.5 text-right">Cant.</th>
                  <th className="px-3 py-2.5 text-right">Costo Total</th>
                  <th className="px-3 py-2.5 text-left">Detalle / Pago</th>
                  <th className="px-4 py-2.5 text-left">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE5] tabular-nums">
                {movements.slice(0, 50).map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 font-mono font-semibold">{m.doc_number}</td>
                    <td className="px-3 py-2">{m.type}</td>
                    <td className="px-3 py-2 font-medium">{m.product_name}</td>
                    <td className="px-3 py-2 text-right">
                      {formatNumber(m.quantity)} {m.unit}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCup(m.total_cost_cup)}</td>
                    <td className="px-3 py-2 text-[#58616E] truncate max-w-xs">
                      {m.supplier_name
                        ? `${m.supplier_name} · ${m.payment_method} ${m.payment_ref}`
                        : m.reason}
                    </td>
                    <td className="px-4 py-2 text-[#6F7885]">{formatDateTime(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Kardex SC-2-14 Modal */}
      <Modal
        open={Boolean(kardexProduct)}
        onClose={() => setKardexProduct(null)}
        title={`Tarjeta de Estiba SC-2-14 — ${kardexProduct?.name || ''}`}
        subtitle={`SKU ${kardexProduct?.sku || ''} · Almacén: ${kardexProduct?.warehouse_stock} · Mostrador: ${kardexProduct?.kiosk_stock} ${kardexProduct?.unit || ''}`}
        maxWidth="max-w-3xl"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-[#FAF9F5] border-b border-[#E5E1D7]">
              <tr>
                <th className="px-3 py-2 text-left">Doc.</th>
                <th className="px-3 py-2 text-left">Operación</th>
                <th className="px-3 py-2 text-right">Cant.</th>
                <th className="px-3 py-2 text-right">Saldo Alm.</th>
                <th className="px-3 py-2 text-right">Saldo Kiosko</th>
                <th className="px-3 py-2 text-left">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE5]">
              {kardexRows.map((kr) => (
                <tr key={kr.id}>
                  <td className="px-3 py-2 font-mono">{kr.doc_number}</td>
                  <td className="px-3 py-2">{kr.type}</td>
                  <td className="px-3 py-2 text-right font-semibold">{kr.quantity}</td>
                  <td className="px-3 py-2 text-right">{kr.warehouse_balance_after}</td>
                  <td className="px-3 py-2 text-right">{kr.kiosk_balance_after}</td>
                  <td className="px-3 py-2 text-[#66707D]">{kr.created_by_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* New Product Modal */}
      <Modal
        open={newProdModal}
        onClose={() => setNewProdModal(false)}
        title="Alta de Producto en Catálogo"
        subtitle="Si deja el precio en blanco, el sistema calcula automáticamente el precio legal MFP (≤ 30% margen y tope)"
      >
        <form onSubmit={createProduct} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium mb-1">Código SKU</label>
              <input
                className="input-field font-mono"
                placeholder="ALI-015"
                value={newProd.sku}
                onChange={(e) => setNewProd({ ...newProd, sku: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium mb-1">Nombre comercial *</label>
              <input
                className="input-field"
                placeholder="Ej. Café molido Serrano 250g"
                value={newProd.name}
                onChange={(e) => setNewProd({ ...newProd, name: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block font-medium mb-1">Categoría</label>
              <select
                className="input-field"
                value={newProd.category}
                onChange={(e) => setNewProd({ ...newProd, category: e.target.value })}
              >
                <option>Básicos Regulados</option>
                <option>Alimentos y Conservas</option>
                <option>Bebidas y Refrescos</option>
                <option>Confituras y Panadería</option>
                <option>Aseo y Hogar</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Unidad (UM)</label>
              <select
                className="input-field"
                value={newProd.unit}
                onChange={(e) => setNewProd({ ...newProd, unit: e.target.value })}
              >
                <option value="kg">kg</option>
                <option value="L">L</option>
                <option value="u">u (unidad)</option>
                <option value="paq">paq</option>
                <option value="lb">lb</option>
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Costo referencial (CUP)</label>
              <input
                type="number"
                min="0"
                className="input-field tabular-nums"
                value={newProd.unit_cost_cup}
                onChange={(e) => setNewProd({ ...newProd, unit_cost_cup: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Precio venta CUP (vacío = auto MFP)</label>
              <input
                type="number"
                min="0"
                className="input-field tabular-nums"
                placeholder="Auto-calculado"
                value={newProd.sale_price_cup}
                onChange={(e) => setNewProd({ ...newProd, sale_price_cup: e.target.value })}
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Mínimo en mostrador</label>
              <input
                type="number"
                min="1"
                className="input-field tabular-nums"
                value={newProd.kiosk_min_stock}
                onChange={(e) => setNewProd({ ...newProd, kiosk_min_stock: e.target.value })}
              />
            </div>
          </div>

          <div className="rounded-lg bg-[#FAF9F5] border border-[#E5E1D7] p-3 space-y-2">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={newProd.is_price_capped}
                onChange={(e) => setNewProd({ ...newProd, is_price_capped: e.target.checked })}
              />
              Producto con precio minorista topado (Res. 225/2024 MFP o acuerdo CAM)
            </label>
            {newProd.is_price_capped && (
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="input-field text-xs"
                  onChange={(e) => {
                    const c = mfpCaps.find((x) => x.key === e.target.value);
                    if (c) {
                      setNewProd({
                        ...newProd,
                        unit: c.unit,
                        price_cap_cup: c.cap_cup,
                        price_cap_resolution: c.resolution,
                      });
                    }
                  }}
                >
                  <option value="">Plantilla Res. 225/2024...</option>
                  {mfpCaps.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name} — {c.cap_cup} CUP/{c.unit}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  placeholder="Tope CUP"
                  className="input-field tabular-nums"
                  value={newProd.price_cap_cup}
                  onChange={(e) => setNewProd({ ...newProd, price_cap_cup: e.target.value })}
                  required
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setNewProdModal(false)} className="btn-secondary text-xs">
              Cancelar
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              Crear producto
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
