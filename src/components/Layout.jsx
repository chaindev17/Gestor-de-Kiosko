import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  Check,
  ClipboardList,
  Copy,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Receipt,
  Repeat,
  Scale,
  ShoppingCart,
  Sliders,
  Store,
  Tag,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_META } from '../lib/format.js';

export function getNavForRole(role, badges = {}, config = null) {
  const mods = config?.modules || {};
  const perms = config?.permissions || {};
  const isOn = (key) => mods[key] !== false;

  if (role === 'jefe') {
    const items = [
      { id: 'jefe-home', label: 'Inicio del Negocio', icon: LayoutDashboard },
      {
        id: 'workspace-settings',
        label: 'Mi Empresa y Modo',
        icon: Sliders,
        badge: badges.pending_affiliations,
      },
      { id: 'staff', label: 'Equipo y Turnos', icon: Users },
    ];
    if (isOn('pos')) items.push({ id: 'pos', label: 'Mostrador (POS)', icon: ShoppingCart });
    if (isOn('ipv')) {
      items.push({
        id: 'shift-ipv',
        label: 'Turnos, Cajas e IPV',
        icon: ClipboardList,
        badge: badges.unvalidated_shifts,
      });
    }
    if (isOn('warehouse')) {
      items.push({
        id: 'warehouse',
        label: 'Almacén y Stock',
        icon: Package,
        badge: (badges.pending_restocks || 0) + (badges.pending_mermas || 0),
      });
    }
    if (isOn('pricing')) items.push({ id: 'pricing', label: 'Precios y Tablilla', icon: Tag });
    if (isOn('banking')) {
      items.push({
        id: 'banking',
        label: 'Cobros QR y Banco',
        icon: Landmark,
        badge: badges.pending_deposits,
      });
    }
    if (isOn('onat')) items.push({ id: 'onat', label: 'Tributos ONAT', icon: Receipt });
    if (isOn('payroll')) items.push({ id: 'payroll', label: 'Nómina y Comisiones', icon: Wallet });
    if (isOn('accounting')) items.push({ id: 'accounting', label: 'Contabilidad NCIF', icon: BookOpen });
    if (isOn('compliance')) {
      items.push({
        id: 'compliance',
        label: 'Leyes e Inspección',
        icon: Scale,
        badge: badges.compliance_critical,
      });
    }
    return items;
  }

  if (role === 'economico') {
    const items = [];
    if (isOn('banking')) {
      items.push({
        id: 'banking',
        label: 'Cobros QR y Caja',
        icon: Landmark,
        badge: (badges.pending_deposits || 0) + (badges.unreconciled_qr || 0),
      });
    }
    if (isOn('pricing')) items.push({ id: 'pricing', label: 'Precios y Fichas', icon: Tag });
    if (isOn('onat')) items.push({ id: 'onat', label: 'Liquidación ONAT', icon: Receipt });
    if (isOn('payroll')) items.push({ id: 'payroll', label: 'Nómina y Retenciones', icon: Wallet });
    if (isOn('accounting')) items.push({ id: 'accounting', label: 'Contabilidad NCIF', icon: BookOpen });
    if (isOn('ipv')) {
      items.push({
        id: 'shift-ipv',
        label: 'Auditoría de Turnos',
        icon: FileSpreadsheet,
        badge: badges.unvalidated_shifts,
      });
    }
    if (isOn('warehouse')) {
      items.push({
        id: 'warehouse',
        label: 'Submayor y Mermas',
        icon: Package,
        badge: perms.economico_approve_mermas !== false ? badges.pending_mermas : 0,
      });
    }
    if (isOn('compliance')) {
      items.push({
        id: 'compliance',
        label: 'Cumplimiento Legal',
        icon: Scale,
        badge: badges.compliance_critical,
      });
    }
    if (items.length === 0) {
      items.push({ id: 'jefe-home', label: 'Resumen General', icon: LayoutDashboard });
    }
    return items;
  }

  if (role === 'almacenero') {
    const items = [];
    if (isOn('warehouse') || true) {
      items.push({
        id: 'warehouse',
        label: 'Gestión de Almacén',
        icon: Package,
        badge: badges.pending_restocks,
      });
    }
    if (isOn('pricing') && perms.almacenero_view_pricelist !== false) {
      items.push({ id: 'pricing', label: 'Catálogo y Tablilla', icon: Tag });
    }
    if (isOn('compliance') && perms.almacenero_view_compliance !== false) {
      items.push({ id: 'compliance', label: 'Normas y Vencimientos', icon: Scale });
    }
    return items;
  }

  // vendedor
  const items = [{ id: 'pos', label: 'Mostrador (POS)', icon: ShoppingCart }];
  if (isOn('ipv')) {
    items.push({ id: 'shift-ipv', label: 'Mi Caja, Turno e IPV', icon: ClipboardList });
  }
  if (isOn('pricing') && perms.vendedor_view_pricelist !== false) {
    items.push({ id: 'pricing', label: 'Tablilla de Precios', icon: Tag });
  }
  return items;
}

export function getDefaultPageForRole(role, badges = {}, config = null) {
  const nav = getNavForRole(role, badges, config);
  return nav[0]?.id || 'pos';
}

export default function Layout({
  user,
  account,
  activeCompany,
  config,
  badges,
  activePage,
  onNavigate,
  onSwitchUser,
  onOpenHub,
  onLogout,
  notify,
  children,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [roleUsers, setRoleUsers] = useState([]);
  const [copied, setCopied] = useState(false);

  const navItems = getNavForRole(user.role, badges, config);
  const roleMeta = ROLE_META[user.role] || ROLE_META.vendedor;
  const isDemo = Boolean(activeCompany?.is_demo);
  const canPreviewRoles = isDemo || user.role === 'jefe';
  const companyCode = activeCompany?.company_code || config?.company_code || '';
  const maxCajas = Number(config?.max_sellers_per_shift || 2);

  useEffect(() => {
    setRoleUsers([]);
  }, [activeCompany?.id]);

  useEffect(() => {
    if (switchOpen && canPreviewRoles) {
      api
        .get('/api/auth/roles-preview')
        .then((d) => setRoleUsers(d.users || []))
        .catch(() => {});
    }
  }, [switchOpen, canPreviewRoles]);

  function handleCopyCode() {
    if (!companyCode) return;
    navigator.clipboard?.writeText(companyCode);
    setCopied(true);
    notify?.(`Código ${companyCode} copiado para compartir con tu equipo.`);
    setTimeout(() => setCopied(false), 2000);
  }

  const showCompliance = config?.modules?.compliance !== false;
  const compliancePill =
    badges?.compliance_overall === 'RIESGO_MULTA'
      ? { text: 'Revisar alertas', cls: 'bg-red-50 text-red-800 border-red-200' }
      : badges?.compliance_overall === 'ATENCION'
      ? {
          text: `Control ${badges.compliance_score}%`,
          cls: 'bg-[#FBEEE8] text-[#9A3B1B] border-[#F0D0C2]',
        }
      : {
          text: `En regla ${badges?.compliance_score ?? 100}%`,
          cls: 'bg-[#E7F3EE] text-[#15614B] border-[#C5E2D6]',
        };

  return (
    <div className="min-h-screen flex bg-[#FAF8F4]">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#181715]/40 lg:hidden no-print"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Editorial warm sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-66 bg-white border-r border-[#E7E1D6] flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 no-print ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 pt-4 pb-3.5 border-b border-[#EFEAE0] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#181715] text-[#FAF8F4]">
                <Store className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#181715]">
                  {config?.business_name || activeCompany?.name || 'Mi Empresa'}
                </p>
                <p className="truncate text-[11px] text-[#7A746B]">
                  {isDemo ? 'Empresa Demo · ' : ''}
                  {config?.legal_form || 'MIPYME'}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="lg:hidden rounded-lg p-1 text-[#7A746B] hover:bg-[#F3EFE7]"
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {user.role === 'jefe' && companyCode && (
            <button
              type="button"
              onClick={handleCopyCode}
              title="Copiar código para afiliar empleados"
              className="w-full flex items-center justify-between rounded-xl bg-[#F3EFE7] hover:bg-[#EAE3D5] px-3 py-1.5 text-[11px] text-[#3F3C37] transition cursor-pointer"
            >
              <span className="font-mono font-semibold text-[#181715]">{companyCode}</span>
              <span className="inline-flex items-center gap-1 text-[#6E685F]">
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-[#15614B]" /> Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Afiliar
                  </>
                )}
              </span>
            </button>
          )}
        </div>

        <div className="px-4 py-3 border-b border-[#EFEAE0] bg-[#FAF8F4]">
          <span className="inline-flex items-center rounded-full bg-white border border-[#E5DED0] px-2.5 py-0.5 text-[11px] font-semibold text-[#181715]">
            {roleMeta.label}
          </span>
          <p className="mt-1.5 text-sm font-semibold text-[#181715] truncate">{user.full_name}</p>
          {(user.email || account?.email) && (
            <p className="text-[11px] text-[#857F76] truncate">{user.email || account?.email}</p>
          )}
          {user.role === 'vendedor' && user.shift_name && (
            <p className="mt-0.5 text-[11px] font-medium text-[#57534E]">
              {user.shift_name} · Caja {user.default_register}
            </p>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id);
                  setMobileOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition cursor-pointer ${
                  active
                    ? 'bg-[#181715] text-[#FAF8F4] font-semibold'
                    : 'text-[#4A4640] hover:bg-[#F3EFE7] font-medium'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                      active ? 'bg-[#C2542D] text-white' : 'bg-[#FBEEE8] text-[#C2542D]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[#EFEAE0] space-y-1">
          {account && onOpenHub && (
            <button
              type="button"
              onClick={onOpenHub}
              className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-[#3F3C37] hover:bg-[#F3EFE7] cursor-pointer"
            >
              <ArrowLeftRight className="h-3.5 w-3.5 text-[#C2542D]" />
              Mis empresas / Afiliarme
            </button>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-[#6E685F] hover:bg-[#F3EFE7] hover:text-[#181715] cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            {isDemo && !account ? 'Salir de la demo' : 'Cerrar sesión'}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 border-b border-[#E7E1D6] bg-[#FAF8F4]/92 backdrop-blur-md px-4 lg:px-7 py-3 flex items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="lg:hidden rounded-xl border border-[#D8D1C3] bg-white p-1.5 text-[#181715]"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {badges?.active_shift ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C5E2D6] bg-[#E7F3EE] px-3 py-1 font-medium text-[#15614B]">
                  <span className="h-2 w-2 rounded-full bg-[#15614B]" />
                  {badges.active_shift.shift_name} ({badges.active_shift.open_registers}/{maxCajas}{' '}
                  {maxCajas === 1 ? 'caja' : 'cajas'})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#DFD8CA] bg-[#F3EFE7] px-3 py-1 font-medium text-[#57534E]">
                  Sin turno abierto
                </span>
              )}
              {showCompliance && (
                <span
                  className={`hidden sm:inline-flex items-center rounded-full border px-3 py-1 font-medium ${compliancePill.cls}`}
                >
                  {compliancePill.text}
                </span>
              )}
              {user.role === 'jefe' && badges?.pending_affiliations > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('workspace-settings')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#C2542D] px-3 py-1 font-semibold text-white hover:bg-[#A84420] cursor-pointer"
                >
                  {badges.pending_affiliations} afiliación(es) por aprobar
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user.role === 'jefe' && activePage !== 'workspace-settings' && (
              <button
                type="button"
                onClick={() => onNavigate('workspace-settings')}
                className="hidden md:inline-flex btn-secondary rounded-full text-xs py-1.5 px-3"
              >
                <Sliders className="h-3.5 w-3.5 text-[#C2542D]" />
                Modo y módulos
              </button>
            )}

            {canPreviewRoles && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSwitchOpen((o) => !o)}
                  className="btn-secondary rounded-full text-xs py-1.5 px-3"
                  title="Ver el sistema desde otro puesto del equipo"
                >
                  <Repeat className="h-3.5 w-3.5 text-[#181715]" />
                  <span className="hidden sm:inline">
                    {isDemo ? 'Cambiar puesto' : 'Vista por rol'}
                  </span>
                </button>
                {switchOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setSwitchOpen(false)} />
                    <div className="absolute right-0 mt-2 z-50 w-72 rounded-2xl border border-[#E5DED0] bg-white shadow-xl p-2">
                      <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#7A746B]">
                        {isDemo ? 'Probar puestos (Empresa Demo)' : 'Previsualizar puesto de tu equipo'}
                      </p>
                      <div className="max-h-80 overflow-y-auto space-y-0.5">
                        {roleUsers.map((ru) => {
                          const isCurrent = ru.id === user.id;
                          const m = ROLE_META[ru.role];
                          return (
                            <button
                              key={ru.id}
                              type="button"
                              onClick={async () => {
                                setSwitchOpen(false);
                                if (!isCurrent) await onSwitchUser(ru.id);
                              }}
                              className={`w-full rounded-xl px-3 py-2 text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${
                                isCurrent
                                  ? 'bg-[#181715] text-[#FAF8F4] font-semibold'
                                  : 'hover:bg-[#F3EFE7] text-[#181715]'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium">{ru.full_name}</p>
                                <p
                                  className={`text-[11px] truncate ${
                                    isCurrent ? 'text-[#CFC8BC]' : 'text-[#7A746B]'
                                  }`}
                                >
                                  {m?.short}
                                  {ru.shift_name
                                    ? ` · ${ru.shift_name} (Caja ${ru.default_register})`
                                    : ''}
                                </p>
                              </div>
                              {isCurrent && <span className="text-[10px] font-bold">Actual</span>}
                            </button>
                          );
                        })}
                        {roleUsers.length <= 1 && (
                          <p className="px-3 py-2 text-[11px] text-[#857F76]">
                            Aún estás solo en la empresa. Comparte tu código{' '}
                            <span className="font-mono font-semibold">{companyCode}</span> para sumar
                            integrantes.
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-7 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
