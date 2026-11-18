import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Check,
  Copy,
  KeyRound,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Share2,
  Shield,
  Sliders,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatCup, ROLE_META } from '../lib/format.js';
import {
  AUTOMATION_RULES,
  MODULE_CATALOG,
  PERMISSION_CONTROLS,
  PRESET_CARDS,
} from '../lib/modules.js';
import QrCodeBadge from '../components/QrCodeBadge.jsx';
import Modal from '../components/Modal.jsx';

export default function WorkspaceSettingsPage({
  config,
  activeCompany,
  onGovernanceUpdated,
  onRefreshBadges,
  notify,
}) {
  const [tab, setTab] = useState('affiliations'); // 'affiliations' | 'modules' | 'rules' | 'profile'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState('');

  // Governance draft
  const [modules, setModules] = useState(() => ({ ...(config?.modules || {}) }));
  const [permissions, setPermissions] = useState(() => ({ ...(config?.permissions || {}) }));
  const [gov, setGov] = useState({});

  // Approve modal state
  const [approving, setApproving] = useState(null);
  const [approveForm, setApproveForm] = useState({
    role: 'vendedor',
    shift_template_id: '',
    default_register: 1,
    base_salary_cup: 6500,
    sales_commission_pct: 1.0,
    contract_type: 'Indeterminado',
  });

  // Direct invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    label: '',
    target_email: '',
    role: 'vendedor',
    shift_template_id: '',
    default_register: 1,
    base_salary_cup: 6500,
    sales_commission_pct: 1.0,
    max_uses: 1,
  });

  // Printable counter/team card modal
  const [cardOpen, setCardOpen] = useState(false);

  const hydrateFromConfig = useCallback((cfg) => {
    if (!cfg) return;
    setModules({ ...(cfg.modules || {}), pos: true });
    setPermissions({ ...(cfg.permissions || {}) });
    setGov({
      business_name: cfg.business_name || '',
      business_type: cfg.business_type || 'Kiosko y Comercio Minorista',
      management_preset: cfg.management_preset || 'kiosko_completo',
      legal_form: cfg.legal_form || 'MIPYME',
      nit: cfg.nit || '',
      municipality: cfg.municipality || '',
      province: cfg.province || '',
      address: cfg.address || '',
      whatsapp_phone: cfg.whatsapp_phone || '',
      contact_email: cfg.contact_email || '',
      join_mode: cfg.join_mode || 'APPROVAL',
      max_sellers_per_shift: Number(cfg.max_sellers_per_shift || 2),
      petty_cash_fund_cup: Number(cfg.petty_cash_fund_cup || 3000),
      max_cash_provider_payment_cup: Number(cfg.max_cash_provider_payment_cup || 5000),
      max_regulated_margin_pct: Number(cfg.max_regulated_margin_pct || 30),
      bank_name: cfg.bank_name || '',
      fiscal_account_cup: cfg.fiscal_account_cup || '',
      transfermovil_phone: cfg.transfermovil_phone || '',
      transfermovil_merchant_code: cfg.transfermovil_merchant_code || '',
      enzona_merchant_code: cfg.enzona_merchant_code || '',
      qr_discount_pct: Number(cfg.qr_discount_pct ?? 2),
      owner_can_operate_pos: Boolean(cfg.owner_can_operate_pos),
      flexible_role_limits: Boolean(cfg.flexible_role_limits),
      require_cuban_ci: Boolean(cfg.require_cuban_ci),
      auto_restock_enabled: Boolean(cfg.auto_restock_enabled),
      auto_accounting_enabled: Boolean(cfg.auto_accounting_enabled),
      auto_deposit_order_enabled: Boolean(cfg.auto_deposit_order_enabled),
      strict_price_cap_block: Boolean(cfg.strict_price_cap_block),
      strict_bancarizacion_block: Boolean(cfg.strict_bancarizacion_block),
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/platform/company/affiliations');
      setData(res);
      hydrateFromConfig(res.config);
      if (res.shifts?.[0]) {
        setInviteForm((f) => ({ ...f, shift_template_id: f.shift_template_id || res.shifts[0].id }));
      }
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [hydrateFromConfig, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const companyCode =
    data?.company?.company_code || activeCompany?.company_code || config?.company_code || 'kiosko-CEIBA1';
  const companyName = data?.config?.business_name || config?.business_name || 'Mi Empresa';

  function shareUrl(code) {
    return `${window.location.origin}${window.location.pathname}?codigo=${encodeURIComponent(code)}`;
  }

  function copyText(text, label = 'Código') {
    navigator.clipboard?.writeText(text);
    setCopied(text);
    notify(`${label} copiado: ${text}`);
    setTimeout(() => setCopied(''), 2000);
  }

  function shareWhatsApp(code, extra = '') {
    const msg = `Hola! Te invito a afiliarte a "${companyName}" en Kiosko Conecta.${extra ? `\n${extra}` : ''}\n\nCódigo: ${code}\nEnlace directo: ${shareUrl(code)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  }

  async function saveGovernance(overridePayload = null, customMessage = '') {
    setSaving(true);
    try {
      const payload = overridePayload || {
        ...gov,
        modules,
        permissions,
      };
      const res = await api.put('/api/platform/company/governance', payload);
      hydrateFromConfig(res.config);
      onGovernanceUpdated?.(res);
      onRefreshBadges?.();
      notify(customMessage || 'Configuración de tu empresa guardada al instante.');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function applyPreset(presetId, presetName) {
    await saveGovernance(
      { apply_preset: presetId },
      `Modo "${presetName}" aplicado. El panel y los menús ya se actualizaron.`
    );
  }

  async function toggleModuleImmediate(key) {
    if (key === 'pos') return;
    const nextModules = { ...modules, [key]: !modules[key], pos: true };
    setModules(nextModules);
    await saveGovernance(
      {
        ...gov,
        management_preset: 'a_medida',
        modules: nextModules,
        permissions,
      },
      `Módulo ${nextModules[key] ? 'activado' : 'ocultado'} para tu empresa.`
    );
  }

  async function regenerateCode() {
    if (!window.confirm('¿Generar un nuevo código de afiliación? El anterior dejará de servir para nuevas solicitudes.')) {
      return;
    }
    try {
      const res = await api.post('/api/platform/company/regenerate-code', {});
      notify(`Nuevo código activo: ${res.company_code}`);
      await load();
      onGovernanceUpdated?.({ config: res.config });
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  function openApproveModal(mem) {
    setApproving(mem);
    setApproveForm({
      role: mem.requested_role || 'vendedor',
      shift_template_id: data?.shifts?.[0]?.id || '',
      default_register: 1,
      base_salary_cup: mem.requested_role === 'economico' ? 9500 : mem.requested_role === 'almacenero' ? 8000 : 6500,
      sales_commission_pct: mem.requested_role === 'vendedor' ? 1.0 : 0,
      contract_type: 'Indeterminado',
    });
  }

  async function confirmApprove(e) {
    e.preventDefault();
    if (!approving) return;
    setSaving(true);
    try {
      await api.post(`/api/platform/company/affiliations/${approving.id}/decide`, {
        decision: 'APROBAR',
        ...approveForm,
      });
      notify(`${approving.full_name} ya forma parte de tu empresa como ${approveForm.role}.`);
      setApproving(null);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function rejectRequest(mem) {
    try {
      await api.post(`/api/platform/company/affiliations/${mem.id}/decide`, {
        decision: 'RECHAZAR',
      });
      notify(`Solicitud de ${mem.full_name} rechazada.`);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function toggleMemberStatus(mem) {
    const nextStatus = mem.status === 'ACTIVO' ? 'SUSPENDIDO' : 'ACTIVO';
    try {
      await api.put(`/api/platform/company/affiliations/${mem.id}`, {
        status: nextStatus,
        role: mem.role,
      });
      notify(
        nextStatus === 'ACTIVO'
          ? `Acceso reactivado para ${mem.full_name}.`
          : `Acceso pausado para ${mem.full_name}.`
      );
      await load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function changeMemberRole(mem, nextRole) {
    try {
      await api.put(`/api/platform/company/affiliations/${mem.id}`, {
        role: nextRole,
        status: mem.status,
      });
      notify(`Puesto de ${mem.full_name} actualizado a ${ROLE_META[nextRole]?.label || nextRole}.`);
      await load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function createInvite(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/api/platform/company/invites', inviteForm);
      notify(`Invitación creada: ${res.invite.code}`);
      setInviteOpen(false);
      setInviteForm((f) => ({ ...f, label: '', target_email: '' }));
      await load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function revokeInvite(id) {
    try {
      await api.delete(`/api/platform/company/invites/${id}`);
      notify('Código de invitación desactivado.');
      await load();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  if (loading && !data) {
    return (
      <div className="py-14 text-center text-sm text-[#7A746B]">
        Cargando configuración de tu empresa...
      </div>
    );
  }

  const pending = data?.pending || [];
  const members = data?.members || [];
  const invites = (data?.invites || []).filter((i) => i.active);
  const shifts = data?.shifts || [];
  const maxCajas = Math.max(1, Number(gov.max_sellers_per_shift || 2));

  return (
    <div className="space-y-6">
      {/* Editorial header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Panel del Creador</p>
          <h1 className="mt-1 font-editorial text-3xl sm:text-4xl text-[#181715]">
            Mi empresa y <em className="italic text-[#C2542D]">cómo se maneja.</em>
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[#656058]">
            Afilia a tu equipo por correo, prende o apaga módulos y decide las reglas y permisos de cada puesto.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCardOpen(true)}
          className="btn-secondary rounded-full text-xs"
        >
          <Printer className="h-3.5 w-3.5" />
          Tarjeta con QR ({companyCode})
        </button>
      </div>

      {/* Navigation pills */}
      <div className="flex flex-wrap gap-2 border-b border-[#E7E1D6] pb-3">
        {[
          {
            id: 'affiliations',
            label: 'Código y Afiliaciones',
            icon: Users,
            badge: pending.length,
          },
          {
            id: 'modules',
            label: 'Módulos del Software',
            icon: Sliders,
          },
          {
            id: 'rules',
            label: 'Reglas y Permisos',
            icon: Shield,
          },
          {
            id: 'profile',
            label: 'Datos de la Empresa',
            icon: Building2,
          },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition cursor-pointer ${
                active
                  ? 'bg-[#181715] text-[#FAF8F4]'
                  : 'bg-white border border-[#E5DED0] text-[#57534E] hover:bg-[#F3EFE7] hover:text-[#181715]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.badge > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-[#C2542D] text-white' : 'bg-[#FBEEE8] text-[#C2542D]'
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: CÓDIGO Y AFILIACIONES */}
      {tab === 'affiliations' && (
        <div className="space-y-6">
          {/* Conecta-style Company Code Banner */}
          <div className="rounded-3xl border border-[#E5DED0] bg-[#F3EFE7] p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <QrCodeBadge value={shareUrl(companyCode)} size={82} className="shrink-0" />
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7A746B]">
                  Código único de afiliación
                </p>
                <p className="font-mono text-2xl font-bold tracking-tight text-[#181715]">
                  {companyCode}
                </p>
                <p className="text-xs text-[#57534E] max-w-md">
                  Quien se registre con su correo e ingrese este código{' '}
                  {gov.join_mode === 'AUTO'
                    ? 'entrará directamente a tu equipo.'
                    : 'aparecerá aquí para que apruebes su ingreso y le asignes su puesto.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copyText(companyCode, 'Código de empresa')}
                className="btn-primary rounded-full text-xs py-2.5 px-4"
              >
                {copied === companyCode ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === companyCode ? 'Copiado' : 'Copiar código'}
              </button>
              <button
                type="button"
                onClick={() => shareWhatsApp(companyCode)}
                className="btn-secondary rounded-full text-xs py-2.5 px-4"
              >
                <Share2 className="h-3.5 w-3.5 text-[#15614B]" />
                WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="btn-secondary rounded-full text-xs py-2.5 px-4"
              >
                <Plus className="h-3.5 w-3.5" />
                Invitar por correo/puesto
              </button>
              <button
                type="button"
                onClick={regenerateCode}
                className="rounded-full p-2.5 text-[#7A746B] hover:bg-white hover:text-[#181715] cursor-pointer"
                title="Regenerar código de empresa"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Pending Email Requests */}
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-[#181715]">
                  Solicitudes de afiliación pendientes ({pending.length})
                </h2>
                <p className="text-xs text-[#6E685F]">
                  Personas registradas con su correo que pidieron unirse a tu empresa.
                </p>
              </div>
              <button
                type="button"
                onClick={load}
                className="btn-secondary text-xs py-1.5 px-3 rounded-full"
              >
                <RefreshCw className="h-3 w-3" /> Actualizar
              </button>
            </div>

            {pending.length === 0 ? (
              <div className="rounded-2xl bg-[#FAF8F4] border border-[#EAE4D9] p-5 text-center text-xs text-[#7A746B]">
                No tienes solicitudes esperando aprobación. Comparte{' '}
                <strong className="font-mono text-[#181715]">{companyCode}</strong> con tu equipo o
                crea una invitación directa por correo.
              </div>
            ) : (
              <div className="space-y-3">
                {pending.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-2xl border border-[#C2542D]/30 bg-[#FBEEE8]/50 p-4 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-[#181715]">{m.full_name}</p>
                        <span className="rounded-full bg-white border border-[#E5DED0] px-2.5 py-0.5 text-[11px] font-semibold text-[#C2542D] capitalize">
                          Solicita: {m.requested_role}
                        </span>
                      </div>
                      <p className="text-xs text-[#57534E]">
                        {m.email}
                        {m.requested_ci ? ` · Doc: ${m.requested_ci}` : ''}
                        {m.requested_phone ? ` · Tel: ${m.requested_phone}` : ''}
                      </p>
                      {m.request_note && (
                        <p className="text-xs italic text-[#6E685F]">“{m.request_note}”</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openApproveModal(m)}
                        className="btn-primary rounded-full text-xs py-2 px-4"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Aprobar y asignar puesto
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectRequest(m)}
                        className="btn-secondary rounded-full text-xs py-2 px-3 text-red-700"
                      >
                        <UserX className="h-3.5 w-3.5" />
                        Rechazar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Direct role/email invites */}
          {invites.length > 0 && (
            <div className="card p-6 space-y-3">
              <h2 className="text-base font-bold text-[#181715]">
                Códigos de invitación directa activos ({invites.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {invites.map((inv) => (
                  <div
                    key={inv.id}
                    className="rounded-2xl border border-[#E7E1D6] bg-[#FAF8F4] p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold text-[#181715]">{inv.code}</p>
                      <p className="text-xs text-[#57534E] truncate">
                        Puesto: <strong className="capitalize">{inv.role}</strong>
                        {inv.target_email ? ` · Para ${inv.target_email}` : ' · Cualquier correo'}
                      </p>
                      <p className="text-[11px] text-[#857F76]">
                        Salario {formatCup(inv.base_salary_cup)} · Usos {inv.uses_count}/{inv.max_uses}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyText(inv.code, 'Invitación')}
                        className="btn-secondary py-1.5 px-2.5 text-xs"
                        title="Copiar"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          shareWhatsApp(inv.code, `Puesto asignado: ${inv.role} (ingreso directo).`)
                        }
                        className="btn-secondary py-1.5 px-2.5 text-xs"
                        title="Enviar por WhatsApp"
                      >
                        <Share2 className="h-3.5 w-3.5 text-[#15614B]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => revokeInvite(inv.id)}
                        className="rounded-lg p-1.5 text-[#857F76] hover:text-red-700 cursor-pointer"
                        title="Revocar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Affiliated members list */}
          <div className="card p-6 space-y-4">
            <h2 className="text-base font-bold text-[#181715]">
              Cuentas afiliadas a tu empresa ({members.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#EAE4D9] text-left text-[#7A746B]">
                    <th className="py-2 pr-3 font-semibold">Integrante</th>
                    <th className="py-2 px-3 font-semibold">Correo registrado</th>
                    <th className="py-2 px-3 font-semibold">Puesto asignado</th>
                    <th className="py-2 px-3 font-semibold">Turno / Caja</th>
                    <th className="py-2 px-3 font-semibold">Estado</th>
                    <th className="py-2 pl-3 text-right font-semibold">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1ECE2]">
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="py-3 pr-3 font-semibold text-[#181715]">
                        {m.full_name}
                        {m.is_owner && (
                          <span className="ml-2 rounded-full bg-[#181715] px-2 py-0.5 text-[10px] font-semibold text-white">
                            Creador
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-[#57534E]">{m.email}</td>
                      <td className="py-3 px-3">
                        {m.is_owner ? (
                          <span className="font-semibold text-[#181715]">Jefe del Negocio</span>
                        ) : (
                          <select
                            value={m.role}
                            onChange={(e) => changeMemberRole(m, e.target.value)}
                            className="rounded-lg border border-[#D8D1C3] bg-white px-2 py-1 text-xs font-medium"
                          >
                            <option value="vendedor">Vendedor</option>
                            <option value="almacenero">Almacenero</option>
                            <option value="economico">Económico</option>
                            <option value="jefe">Co-Administrador</option>
                          </select>
                        )}
                      </td>
                      <td className="py-3 px-3 text-[#656058]">
                        {m.role === 'vendedor' && m.shift_name
                          ? `${m.shift_name} · Caja ${m.default_register || 1}`
                          : 'General'}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            m.status === 'ACTIVO'
                              ? 'bg-[#E7F3EE] text-[#15614B]'
                              : 'bg-stone-100 text-stone-600'
                          }`}
                        >
                          {m.status}
                        </span>
                      </td>
                      <td className="py-3 pl-3 text-right">
                        {!m.is_owner && m.status !== 'RECHAZADO' && (
                          <button
                            type="button"
                            onClick={() => toggleMemberStatus(m)}
                            className="text-xs font-semibold text-[#57534E] hover:text-[#181715] underline cursor-pointer"
                          >
                            {m.status === 'ACTIVO' ? 'Pausar acceso' : 'Reactivar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MÓDULOS DEL SOFTWARE */}
      {tab === 'modules' && (
        <div className="space-y-6">
          <div className="card p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#181715]">Plantillas rápidas de manejo</h2>
              <p className="text-xs text-[#6E685F]">
                Aplica un estilo en un clic o personaliza cada módulo abajo. Nunca se borran tus datos al ocultar un módulo.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {PRESET_CARDS.map((p) => {
                const isCurrent = gov.management_preset === p.id;
                return (
                  <div
                    key={p.id}
                    className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 ${
                      isCurrent ? 'border-[#181715] bg-[#F3EFE7]' : 'border-[#E7E1D6] bg-white'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-[#C2542D]">{p.tag}</span>
                        {isCurrent && (
                          <span className="rounded-full bg-[#181715] px-2 py-0.5 text-[10px] font-bold text-white">
                            Activo
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1 text-base font-bold text-[#181715]">{p.name}</h3>
                      <p className="mt-1 text-xs text-[#57534E]">{p.summary}</p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => applyPreset(p.id, p.name)}
                      className="btn-secondary rounded-full text-xs py-1.5 w-full"
                    >
                      {isCurrent ? 'Reaplicar este modo' : `Usar ${p.name}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-[#181715]">
                  Interruptores por módulo ({Object.values(modules).filter(Boolean).length}/{MODULE_CATALOG.length} encendidos)
                </h2>
                <p className="text-xs text-[#6E685F]">
                  Cada cambio actualiza de inmediato tu barra lateral y la de todos tus trabajadores afiliados.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {MODULE_CATALOG.map((m) => {
                const on = Boolean(modules[m.key]);
                return (
                  <button
                    key={m.key}
                    type="button"
                    disabled={saving || m.locked}
                    onClick={() => toggleModuleImmediate(m.key)}
                    className={`rounded-2xl border p-4 text-left flex items-start justify-between gap-4 transition ${
                      m.locked ? 'cursor-default' : 'cursor-pointer'
                    } ${
                      on
                        ? 'border-[#181715] bg-[#FAF8F4]'
                        : 'border-[#E7E1D6] bg-white opacity-70 hover:opacity-100'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[#181715]">{m.label}</p>
                        {m.locked && (
                          <span className="rounded bg-[#EAE4D9] px-1.5 py-0.5 text-[10px] font-semibold text-[#57534E]">
                            Base
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#57534E] leading-relaxed">{m.detail}</p>
                    </div>
                    <span
                      className={`mt-1 inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition ${
                        on ? 'bg-[#181715] justify-end' : 'bg-[#DDD5C6] justify-start'
                      }`}
                    >
                      <span className="h-5 w-5 rounded-full bg-white" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: REGLAS Y PERMISOS POR ROL */}
      {tab === 'rules' && (
        <div className="space-y-6">
          <div className="card p-6 space-y-5">
            <h2 className="text-base font-bold text-[#181715]">Capacidad, cajas y afiliación</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                  Cajas por turno
                </label>
                <select
                  className="input-field"
                  value={gov.max_sellers_per_shift || 2}
                  onChange={(e) =>
                    setGov((g) => ({ ...g, max_sellers_per_shift: Number(e.target.value) }))
                  }
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'caja' : 'cajas'} por turno
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                  Modo de afiliación
                </label>
                <select
                  className="input-field"
                  value={gov.join_mode || 'APPROVAL'}
                  onChange={(e) => setGov((g) => ({ ...g, join_mode: e.target.value }))}
                >
                  <option value="APPROVAL">Con mi aprobación</option>
                  <option value="AUTO">Ingreso directo</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                  Tope pago en efectivo (CUP)
                </label>
                <input
                  type="number"
                  className="input-field tabular-nums"
                  value={gov.max_cash_provider_payment_cup ?? 5000}
                  onChange={(e) =>
                    setGov((g) => ({ ...g, max_cash_provider_payment_cup: Number(e.target.value) }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                  Margen comercial máx. (%)
                </label>
                <input
                  type="number"
                  className="input-field tabular-nums"
                  value={gov.max_regulated_margin_pct ?? 30}
                  onChange={(e) =>
                    setGov((g) => ({ ...g, max_regulated_margin_pct: Number(e.target.value) }))
                  }
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[#EFEAE0] space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#7A746B] mb-2">
                Automatizaciones y controles operativos
              </h3>
              {AUTOMATION_RULES.map((r) => {
                const on = Boolean(gov[r.key]);
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setGov((g) => ({ ...g, [r.key]: !g[r.key] }))}
                    className="w-full rounded-xl border border-[#EAE4D9] px-4 py-3 flex items-center justify-between gap-4 text-left hover:bg-[#FAF8F4] cursor-pointer"
                  >
                    <div>
                      <p className="text-xs font-semibold text-[#181715]">{r.label}</p>
                      <p className="text-[11px] text-[#7A746B]">{r.hint}</p>
                    </div>
                    <span
                      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
                        on ? 'bg-[#15614B] justify-end' : 'bg-[#DDD5C6] justify-start'
                      }`}
                    >
                      <span className="h-4 w-4 rounded-full bg-white" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card p-6 space-y-5">
            <div>
              <h2 className="text-base font-bold text-[#181715]">
                Permisos por puesto de trabajo
              </h2>
              <p className="text-xs text-[#6E685F]">
                Define exactamente qué acciones puede ejecutar cada rol dentro de tu empresa.
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {PERMISSION_CONTROLS.map((group) => (
                <div
                  key={group.role}
                  className="rounded-2xl border border-[#E7E1D6] bg-[#FAF8F4] p-4 space-y-3"
                >
                  <p className="text-xs font-bold uppercase tracking-wider text-[#C2542D]">
                    {group.roleLabel}
                  </p>
                  {group.items.map((item) => {
                    const on = permissions[item.key] !== false;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() =>
                          setPermissions((p) => ({ ...p, [item.key]: !on }))
                        }
                        className="w-full rounded-xl bg-white border border-[#EAE4D9] p-3 text-left flex items-start justify-between gap-3 cursor-pointer"
                      >
                        <div>
                          <p className="text-xs font-semibold text-[#181715]">{item.label}</p>
                          <p className="mt-0.5 text-[11px] text-[#7A746B] leading-snug">
                            {item.hint}
                          </p>
                        </div>
                        <span
                          className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
                            on ? 'bg-[#181715] justify-end' : 'bg-[#DDD5C6] justify-start'
                          }`}
                        >
                          <span className="h-4 w-4 rounded-full bg-white" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={() => saveGovernance()}
                className="btn-pill"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Guardando reglas...' : 'Guardar reglas y permisos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: DATOS DE LA EMPRESA */}
      {tab === 'profile' && (
        <div className="card p-6 sm:p-8 space-y-6">
          <div>
            <h2 className="text-base font-bold text-[#181715]">
              Identidad, contacto y cobros digitales
            </h2>
            <p className="text-xs text-[#6E685F]">
              Aparecen en tus comprobantes, en la Tablilla de Precios y en los códigos QR de cobro.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Nombre de la empresa
              </label>
              <input
                type="text"
                className="input-field"
                value={gov.business_name || ''}
                onChange={(e) => setGov((g) => ({ ...g, business_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Forma jurídica
              </label>
              <select
                className="input-field"
                value={gov.legal_form || 'MIPYME'}
                onChange={(e) => setGov((g) => ({ ...g, legal_form: e.target.value }))}
              >
                <option value="MIPYME">Micro-MIPYME (DL 88/2024)</option>
                <option value="TCP">TCP / Unipersonal (DL 90/2024)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">NIT / RUT</label>
              <input
                type="text"
                className="input-field"
                value={gov.nit || ''}
                onChange={(e) => setGov((g) => ({ ...g, nit: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">Municipio</label>
              <input
                type="text"
                className="input-field"
                value={gov.municipality || ''}
                onChange={(e) => setGov((g) => ({ ...g, municipality: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">Provincia</label>
              <input
                type="text"
                className="input-field"
                value={gov.province || ''}
                onChange={(e) => setGov((g) => ({ ...g, province: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">Dirección</label>
              <input
                type="text"
                className="input-field"
                value={gov.address || ''}
                onChange={(e) => setGov((g) => ({ ...g, address: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">WhatsApp</label>
              <input
                type="text"
                className="input-field"
                value={gov.whatsapp_phone || ''}
                onChange={(e) => setGov((g) => ({ ...g, whatsapp_phone: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">Banco</label>
              <input
                type="text"
                className="input-field"
                value={gov.bank_name || ''}
                onChange={(e) => setGov((g) => ({ ...g, bank_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Cuenta Bancaria Fiscal
              </label>
              <input
                type="text"
                className="input-field font-mono"
                value={gov.fiscal_account_cup || ''}
                onChange={(e) => setGov((g) => ({ ...g, fiscal_account_cup: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Bonificación por pago QR (%)
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="15"
                className="input-field tabular-nums"
                value={gov.qr_discount_pct ?? 2}
                onChange={(e) => setGov((g) => ({ ...g, qr_discount_pct: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Código comercio Transfermóvil
              </label>
              <input
                type="text"
                className="input-field font-mono"
                value={gov.transfermovil_merchant_code || ''}
                onChange={(e) =>
                  setGov((g) => ({ ...g, transfermovil_merchant_code: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Código comercio EnZona
              </label>
              <input
                type="text"
                className="input-field font-mono"
                value={gov.enzona_merchant_code || ''}
                onChange={(e) => setGov((g) => ({ ...g, enzona_merchant_code: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Fondo fijo de caja (CUP)
              </label>
              <input
                type="number"
                step="100"
                className="input-field tabular-nums"
                value={gov.petty_cash_fund_cup ?? 3000}
                onChange={(e) =>
                  setGov((g) => ({ ...g, petty_cash_fund_cup: Number(e.target.value) }))
                }
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => saveGovernance()}
              className="btn-pill"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Guardando...' : 'Guardar datos de mi empresa'}
            </button>
          </div>
        </div>
      )}

      {/* Modal: Approve pending affiliation */}
      <Modal
        open={Boolean(approving)}
        onClose={() => setApproving(null)}
        title={`Aprobar a ${approving?.full_name || ''}`}
        subtitle={`Correo: ${approving?.email || ''} · Asigna su puesto y condiciones`}
      >
        <form onSubmit={confirmApprove} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">Puesto</label>
              <select
                className="input-field"
                value={approveForm.role}
                onChange={(e) => setApproveForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="vendedor">Vendedor / Mostrador</option>
                <option value="almacenero">Almacenero</option>
                <option value="economico">Económico / Contador</option>
                <option value="jefe">Co-Administrador</option>
              </select>
            </div>

            {approveForm.role === 'vendedor' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1">Turno</label>
                  <select
                    className="input-field"
                    value={approveForm.shift_template_id}
                    onChange={(e) =>
                      setApproveForm((f) => ({ ...f, shift_template_id: Number(e.target.value) }))
                    }
                  >
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.start_time}–{s.end_time})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1">Caja</label>
                  <select
                    className="input-field"
                    value={approveForm.default_register}
                    onChange={(e) =>
                      setApproveForm((f) => ({ ...f, default_register: Number(e.target.value) }))
                    }
                  >
                    {Array.from({ length: maxCajas }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        Caja {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                    Comisión por venta (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="input-field tabular-nums"
                    value={approveForm.sales_commission_pct}
                    onChange={(e) =>
                      setApproveForm((f) => ({ ...f, sales_commission_pct: e.target.value }))
                    }
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Salario base mensual (CUP)
              </label>
              <input
                type="number"
                min="2100"
                step="100"
                className="input-field tabular-nums"
                value={approveForm.base_salary_cup}
                onChange={(e) => setApproveForm((f) => ({ ...f, base_salary_cup: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setApproving(null)} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              <Check className="h-4 w-4" />
              Confirmar afiliación
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Direct role/email invite */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Crear invitación directa por correo o puesto"
        subtitle="Quien use este código entrará al instante con el puesto que dejes configurado."
      >
        <form onSubmit={createInvite} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Correo electrónico del invitado{' '}
                <span className="font-normal text-[#857F76]">(opcional, déjalo vacío si es abierto)</span>
              </label>
              <input
                type="email"
                className="input-field"
                placeholder="empleado@correo.com"
                value={inviteForm.target_email}
                onChange={(e) => setInviteForm((f) => ({ ...f, target_email: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Puesto asignado
              </label>
              <select
                className="input-field"
                value={inviteForm.role}
                onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="vendedor">Vendedor / Mostrador</option>
                <option value="almacenero">Almacenero</option>
                <option value="economico">Económico / Contador</option>
                <option value="jefe">Co-Administrador</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Salario mensual (CUP)
              </label>
              <input
                type="number"
                min="2100"
                step="100"
                className="input-field tabular-nums"
                value={inviteForm.base_salary_cup}
                onChange={(e) => setInviteForm((f) => ({ ...f, base_salary_cup: e.target.value }))}
              />
            </div>

            {inviteForm.role === 'vendedor' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1">Turno</label>
                  <select
                    className="input-field"
                    value={inviteForm.shift_template_id}
                    onChange={(e) =>
                      setInviteForm((f) => ({ ...f, shift_template_id: Number(e.target.value) }))
                    }
                  >
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1">Caja</label>
                  <select
                    className="input-field"
                    value={inviteForm.default_register}
                    onChange={(e) =>
                      setInviteForm((f) => ({ ...f, default_register: Number(e.target.value) }))
                    }
                  >
                    {Array.from({ length: maxCajas }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        Caja {n}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Referencia / Nota
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej. Turno Mañana"
                value={inviteForm.label}
                onChange={(e) => setInviteForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                Cantidad máxima de usos
              </label>
              <input
                type="number"
                min="1"
                max="50"
                className="input-field tabular-nums"
                value={inviteForm.max_uses}
                onChange={(e) => setInviteForm((f) => ({ ...f, max_uses: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setInviteOpen(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              <KeyRound className="h-4 w-4" />
              Generar código de invitación
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Printable Conecta Card */}
      <Modal
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        title="Tarjeta de afiliación de tu empresa"
        subtitle="Muéstrala en tu celular, envíala por WhatsApp o imprímela para tu equipo."
        maxWidth="max-w-md"
        printable
      >
        <div className="space-y-5 text-center">
          <div className="rounded-3xl border-2 border-[#181715] bg-[#FAF8F4] p-7 space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#C2542D]">
              Kiosko Conecta · Equipo
            </p>
            <h3 className="font-editorial text-3xl text-[#181715]">{companyName}</h3>
            <QrCodeBadge value={shareUrl(companyCode)} size={136} />
            <div>
              <p className="text-[11px] text-[#7A746B]">Ingresa con tu correo y usa el código</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#181715]">{companyCode}</p>
            </div>
          </div>
          <div className="flex justify-center gap-2 no-print">
            <button
              type="button"
              onClick={() => copyText(shareUrl(companyCode), 'Enlace de afiliación')}
              className="btn-secondary rounded-full text-xs"
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar enlace
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-primary rounded-full text-xs"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimir tarjeta
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
