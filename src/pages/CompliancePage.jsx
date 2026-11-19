import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Printer,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_META, formatCup, formatDateTime } from '../lib/format.js';
import { canUserAccess } from '../lib/permissions.js';

export default function CompliancePage({ user, config: appConfig, onConfigUpdated, onRefreshBadges, notify }) {
  const [data, setData] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [tab, setTab] = useState('inspector');
  const [cfgForm, setCfgForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const canConfigure = !user || canUserAccess(user, appConfig, 'compliance', 'canEdit');
  const isJefe = user?.role === 'jefe';

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/finance/compliance');
      setData(res);
      setCfgForm(res.config);
      if (canConfigure) {
        const a = await api.get('/api/config/audit');
        setAuditLogs(a.audit_logs || []);
      }
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify, canConfigure]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveConfig(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.put('/api/config', cfgForm);
      notify('Configuración legal, tributaria y de automatización guardada.');
      onConfigUpdated?.(r.config);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(mode) {
    const msg =
      mode === 'clean'
        ? '¿Inicializar la base de datos en limpio para comenzar producción real? Se mantendrán los usuarios y turnos, y se vaciarán ventas e inventario de prueba.'
        : '¿Restaurar los datos completos de demostración del kiosko?';
    if (!window.confirm(msg)) return;
    setSaving(true);
    try {
      const r = await api.post('/api/config/reset', { mode });
      notify(r.message);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return <div className="py-12 text-center text-sm text-[#66707D]">Ejecutando auditoría legal...</div>;
  }

  const { compliance, dossier, config } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#171C22]">
            Cumplimiento de Leyes Económicas Cubanas e Inspección
          </h1>
          <p className="text-xs text-[#66707D] mt-0.5">
            Verificación continua ante ONAT (Ley 113), BCC (Res. 111/2023), MFP (Res. 225/2024), DIS (Decreto 30), MTSS (Ley 116) y DL 88/90
          </p>
        </div>
        <button type="button" onClick={() => window.print()} className="btn-primary text-xs">
          <Printer className="h-3.5 w-3.5" />
          Imprimir Expediente Inspección
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-[#E3DFD5] pb-2 no-print">
        <button
          type="button"
          onClick={() => setTab('inspector')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
            tab === 'inspector' ? 'bg-[#0F5C4D] text-white' : 'bg-white border border-[#E3DFD5] text-[#4C5561]'
          }`}
        >
          Inspector Virtual y Expediente ({compliance.score}%)
        </button>
        {canConfigure && (
          <>
            <button
              type="button"
              onClick={() => setTab('config')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                tab === 'config' ? 'bg-[#0F5C4D] text-white' : 'bg-white border border-[#E3DFD5] text-[#4C5561]'
              }`}
            >
              Parámetros Legales y Automatización
            </button>
            <button
              type="button"
              onClick={() => setTab('bitacora')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                tab === 'bitacora' ? 'bg-[#0F5C4D] text-white' : 'bg-white border border-[#E3DFD5] text-[#4C5561]'
              }`}
            >
              Bitácora de Auditoría ({auditLogs.length})
            </button>
          </>
        )}
      </div>

      {tab === 'inspector' && (
        <div className="space-y-5">
          {/* Score Header */}
          <div className="card p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="h-12 w-12 rounded-xl bg-[#0F5C4D]/10 text-[#0F5C4D] flex items-center justify-center">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#171C22]">
                  {config.business_name} · NIT {config.nit}
                </h2>
                <p className="text-xs text-[#58616E]">
                  {config.legal_form === 'MIPYME' ? 'Micro-MIPYME (Decreto-Ley 88/2024)' : 'TCP Régimen General (Decreto-Ley 90/2024)'}{' '}
                  · {config.address}, {config.municipality}, {config.province}
                </p>
                <p className="text-xs text-[#58616E]">
                  Cuenta Fiscal CUP: <span className="font-mono font-semibold">{config.fiscal_account_cup}</span> ({config.bank_name}) ·
                  Cobro QR mes: <strong>{dossier.electronic_share_pct}%</strong>
                </p>
              </div>
            </div>
            <div className="text-right tabular-nums">
              <span className="text-2xl font-bold text-[#0F5C4D]">{compliance.score}%</span>
              <p className="text-xs text-[#66707D]">
                {compliance.ok_count}/10 puntos en regla
              </p>
            </div>
          </div>

          {/* 10 Compliance Checks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {compliance.checks.map((c) => (
              <div
                key={c.code}
                className={`card p-4 space-y-1.5 ${
                  c.status === 'CRITICO'
                    ? 'border-red-300 bg-red-50/40'
                    : c.status === 'ALERTA'
                    ? 'border-amber-300 bg-amber-50/35'
                    : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {c.status === 'OK' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle
                        className={`h-4 w-4 shrink-0 ${
                          c.status === 'CRITICO' ? 'text-red-600' : 'text-amber-600'
                        }`}
                      />
                    )}
                    <h3 className="text-xs font-bold text-[#171C22]">{c.title}</h3>
                  </div>
                  <span className="shrink-0 rounded bg-[#F2F0E9] px-1.5 py-0.5 text-[10px] font-semibold text-[#4C5561]">
                    {c.authority}
                  </span>
                </div>
                <p className="text-[11px] font-medium text-[#0F5C4D]">{c.law}</p>
                <p className="text-xs text-[#4C5561] leading-snug">{c.detail}</p>
              </div>
            ))}
          </div>

          {/* Printable Staff & Capped Goods Summary for DIS/MTSS Inspection */}
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#171C22]">
              Relación Oficial de Trabajadores Contratados (Presentación ante MTSS / ONAT)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="border-b border-[#E5E1D7] text-[#58616E]">
                  <tr>
                    <th className="py-2 text-left">Nombre y Apellidos</th>
                    <th className="py-2 text-left">CI</th>
                    <th className="py-2 text-left">Cargo y Turno</th>
                    <th className="py-2 text-left">Contrato</th>
                    <th className="py-2 text-right">Salario Básico</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EDE5]">
                  {dossier.staff.map((s) => (
                    <tr key={s.ci}>
                      <td className="py-2 font-medium">{s.full_name}</td>
                      <td className="py-2 font-mono">{s.ci}</td>
                      <td className="py-2">
                        {ROLE_META[s.role]?.label}
                        {s.shift_name ? ` — ${s.shift_name} (Caja ${s.default_register})` : ''}
                      </td>
                      <td className="py-2">{s.contract_type}</td>
                      <td className="py-2 text-right font-semibold">{formatCup(s.base_salary_cup)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[#6F7885] pt-2 border-t border-[#EFECE4]">
              Nota informativa: Las tasas, topes y controles están preconfigurados conforme a la Ley 113, DL 88/2024,
              DL 90/2024, Res. 111/2023 BCC, Res. 225/2024 MFP y Ley 116, y son ajustables ante nuevas disposiciones de
              la Gaceta Oficial o acuerdos del Consejo de la Administración Municipal (CAM). Complementan la revisión
              profesional del Económico del negocio.
            </p>
          </div>
        </div>
      )}

      {/* TAB 2: Configuration */}
      {tab === 'config' && canConfigure && cfgForm && (
        <form onSubmit={saveConfig} className="space-y-5 text-xs">
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-[#0F5C4D]" />
              <h2 className="text-sm font-bold text-[#171C22]">
                Identidad Jurídica y Bancarización (ONAT / BCC)
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium mb-1">Nombre comercial</label>
                <input
                  className="input-field"
                  disabled={!isJefe}
                  value={cfgForm.business_name}
                  onChange={(e) => setCfgForm({ ...cfgForm, business_name: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Forma de Gestión No Estatal</label>
                <select
                  className="input-field"
                  disabled={!isJefe}
                  value={cfgForm.legal_form}
                  onChange={(e) => setCfgForm({ ...cfgForm, legal_form: e.target.value })}
                >
                  <option value="MIPYME">Micro-MIPYME (1–10 personas, DL 88/2024)</option>
                  <option value="TCP">TCP — Régimen General (máx. 3 contratados, DL 90/2024)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">NIT ONAT</label>
                <input
                  className="input-field font-mono"
                  value={cfgForm.nit}
                  onChange={(e) => setCfgForm({ ...cfgForm, nit: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium mb-1">Banco comercial cubano</label>
                <select
                  className="input-field"
                  value={cfgForm.bank_name}
                  onChange={(e) => setCfgForm({ ...cfgForm, bank_name: e.target.value })}
                >
                  <option>Banco Metropolitano (BANMET)</option>
                  <option>Banco de Crédito y Comercio (BANDEC)</option>
                  <option>Banco Popular de Ahorro (BPA)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Cuenta Bancaria Fiscal CUP (16 dígitos)</label>
                <input
                  className="input-field font-mono"
                  value={cfgForm.fiscal_account_cup}
                  onChange={(e) => setCfgForm({ ...cfgForm, fiscal_account_cup: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Municipio / Provincia</label>
                <input
                  className="input-field"
                  value={cfgForm.municipality}
                  onChange={(e) => setCfgForm({ ...cfgForm, municipality: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium mb-1">Código Comercio Transfermóvil</label>
                <input
                  className="input-field font-mono"
                  value={cfgForm.transfermovil_merchant_code}
                  onChange={(e) => setCfgForm({ ...cfgForm, transfermovil_merchant_code: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Código Comercio EnZona</label>
                <input
                  className="input-field font-mono"
                  value={cfgForm.enzona_merchant_code}
                  onChange={(e) => setCfgForm({ ...cfgForm, enzona_merchant_code: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Bonificación cliente pago QR (%)</label>
                <input
                  type="number"
                  min="0"
                  max="15"
                  step="0.5"
                  className="input-field tabular-nums"
                  value={cfgForm.qr_discount_pct}
                  onChange={(e) => setCfgForm({ ...cfgForm, qr_discount_pct: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Tax & MFP Parameters */}
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-bold text-[#171C22]">
              Tasas Tributarias ONAT, Precios MFP y Límites BCC
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
              <div>
                <label className="block font-medium mb-1">Imp. Ventas (%)</label>
                <input
                  type="number"
                  step="0.5"
                  className="input-field"
                  value={cfgForm.sales_tax_pct}
                  onChange={(e) => setCfgForm({ ...cfgForm, sales_tax_pct: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Contrib. Territorial (%)</label>
                <input
                  type="number"
                  step="0.5"
                  className="input-field"
                  value={cfgForm.local_dev_tax_pct}
                  onChange={(e) => setCfgForm({ ...cfgForm, local_dev_tax_pct: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Fuerza Trabajo (%)</label>
                <input
                  type="number"
                  step="0.5"
                  className="input-field"
                  value={cfgForm.labor_force_tax_pct}
                  onChange={(e) => setCfgForm({ ...cfgForm, labor_force_tax_pct: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Seg. Social Entidad (%)</label>
                <input
                  type="number"
                  step="0.5"
                  className="input-field"
                  value={cfgForm.employer_ss_pct}
                  onChange={(e) => setCfgForm({ ...cfgForm, employer_ss_pct: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Imp. Utilidades MIPYME (%)</label>
                <input
                  type="number"
                  step="1"
                  className="input-field"
                  value={cfgForm.profit_tax_pct}
                  onChange={(e) => setCfgForm({ ...cfgForm, profit_tax_pct: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Margen Máx. MFP (%)</label>
                <input
                  type="number"
                  step="1"
                  className="input-field"
                  value={cfgForm.max_regulated_margin_pct}
                  onChange={(e) => setCfgForm({ ...cfgForm, max_regulated_margin_pct: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Tope Efectivo Prov. (CUP)</label>
                <input
                  type="number"
                  step="500"
                  className="input-field"
                  value={cfgForm.max_cash_provider_payment_cup}
                  onChange={(e) => setCfgForm({ ...cfgForm, max_cash_provider_payment_cup: e.target.value })}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Fondo Fijo por Caja (CUP)</label>
                <input
                  type="number"
                  step="500"
                  className="input-field"
                  value={cfgForm.petty_cash_fund_cup}
                  onChange={(e) => setCfgForm({ ...cfgForm, petty_cash_fund_cup: e.target.value })}
                />
              </div>
            </div>

            <div className="pt-2 border-t border-[#ECE8DE] grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                { key: 'auto_accounting_enabled', label: 'Contabilización NCIF automática en cada operación' },
                { key: 'auto_restock_enabled', label: 'Generación automática de pedidos Almacén → Kiosko (FEFO)' },
                { key: 'auto_deposit_order_enabled', label: 'Orden automática de depósito BCC al cerrar turno' },
                { key: 'strict_price_cap_block', label: 'Bloquear precios sobre topes Res. 225/2024 y margen 30%' },
                { key: 'strict_bancarizacion_block', label: 'Bloquear pagos en efectivo > 5,000 CUP a proveedores' },
              ].map((sw) => (
                <label key={sw.key} className="flex items-center gap-2 font-medium text-[#2A313B]">
                  <input
                    type="checkbox"
                    checked={Boolean(cfgForm[sw.key])}
                    onChange={(e) => setCfgForm({ ...cfgForm, [sw.key]: e.target.checked ? 1 : 0 })}
                  />
                  {sw.label}
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#ECE8DE]">
              {isJefe ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleReset('demo')}
                    className="btn-secondary text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restaurar demo
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleReset('clean')}
                    className="btn-secondary text-xs text-red-700"
                  >
                    Iniciar en limpio (producción)
                  </button>
                </div>
              ) : (
                <span />
              )}
              <button type="submit" disabled={saving} className="btn-primary text-xs">
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 3: Audit Trail */}
      {tab === 'bitacora' && canConfigure && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#FAF9F5] text-[#58616E] border-b border-[#E5E1D7]">
                <tr>
                  <th className="px-4 py-2.5 text-left">Fecha / Hora</th>
                  <th className="px-3 py-2.5 text-left">Trabajador</th>
                  <th className="px-3 py-2.5 text-left">Módulo</th>
                  <th className="px-3 py-2.5 text-left">Acción</th>
                  <th className="px-4 py-2.5 text-left">Detalle Registrado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE5]">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2 text-[#6F7885] whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    <td className="px-3 py-2 font-medium">
                      {log.user_name}{' '}
                      <span className="text-[10px] text-[#6F7885]">({log.user_role})</span>
                    </td>
                    <td className="px-3 py-2">{log.module}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{log.action}</td>
                    <td className="px-4 py-2 text-[#4C5561]">{log.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
