import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  Check,
  ClipboardList,
  Copy,
  ExternalLink,
  Eye,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  Receipt,
  Scale,
  ShieldCheck,
  ShoppingCart,
  Sliders,
  Tag,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_META } from '../lib/format.js';
import { MENU_SCHEMA, buildUserPermissions } from '../lib/permissions.js';
import { buildCatalogUrl } from '../lib/whatsapp.js';

const ICON_BY_ID = {
  'jefe-home': LayoutDashboard,
  'workspace-settings': Sliders,
  staff: Users,
  pos: ShoppingCart,
  'shift-ipv': ClipboardList,
  warehouse: Package,
  pricing: Tag,
  'catalog-wa': MessageCircle,
  banking: Landmark,
  onat: Receipt,
  payroll: Wallet,
  accounting: BookOpen,
  compliance: Scale,
};

const MOBILE_PRIORITY = ['jefe-home', 'pos', 'warehouse', 'catalog-wa', 'shift-ipv', 'pricing', 'banking', 'onat'];

function computeBadgeForModule(id, badges = {}) {
  switch (id) {
    case 'workspace-settings':
      return { count: Number(badges.pending_affiliations || 0), tone: 'amber' };
    case 'shift-ipv':
      return { count: Number(badges.unvalidated_shifts || 0), tone: 'amber' };
    case 'warehouse':
      return {
        count: Number(badges.pending_restocks || 0) + Number(badges.pending_mermas || 0),
        tone: 'amber',
      };
    case 'pricing':
      return { count: Number(badges.pending_prices || 0), tone: 'amber' };
    case 'catalog-wa':
      return { count: Number(badges.pending_orders || 0), tone: 'green' };
    case 'banking':
      return {
        count: Number(badges.pending_deposits || 0) + Number(badges.unreconciled_qr || 0),
        tone: 'amber',
      };
    case 'compliance':
      return { count: Number(badges.compliance_critical || 0), tone: 'red' };
    default:
      return { count: 0, tone: 'amber' };
  }
}

/**
 * Construye el menú lateral completo en orden empresarial exacto.
 * - Jefe del Negocio: ve SIEMPRE los 13 módulos completos sin ocultar ni recortar ninguno.
 * - Trabajadores: ven ÚNICAMENTE los módulos con `canView: true` según su matriz de permisos.
 */
export function getNavForUser(user, badges = {}, config = null) {
  if (!user) return [];
  const matrix = user.permissions_matrix?.items
    ? user.permissions_matrix
    : buildUserPermissions(user, config || {});

  return MENU_SCHEMA.filter((m) => {
    if (user.role === 'jefe') return true;
    return Boolean(matrix.items?.[m.id]?.canView);
  }).map((m) => {
    const perm = matrix.items?.[m.id] || { canView: false, canEdit: false, canApprove: false };
    const badgeInfo = computeBadgeForModule(m.id, badges);
    return {
      id: m.id,
      label: m.label,
      shortLabel: m.shortLabel,
      group: m.group,
      icon: ICON_BY_ID[m.id] || LayoutDashboard,
      badge: badgeInfo.count,
      badgeTone: badgeInfo.tone,
      canView: perm.canView,
      canEdit: perm.canEdit,
      canApprove: perm.canApprove,
      readOnly: Boolean(perm.canView && !perm.canEdit && !perm.canApprove),
    };
  });
}

// Retro-compatibilidad si algún módulo llama por rol
export function getNavForRole(roleOrUser, badges = {}, config = null) {
  const userObj = typeof roleOrUser === 'string' ? { role: roleOrUser } : roleOrUser;
  return getNavForUser(userObj, badges, config);
}

export function getDefaultPageForRole(roleOrUser, badges = {}, config = null) {
  const userObj = typeof roleOrUser === 'string' ? { role: roleOrUser } : roleOrUser;
  const nav = getNavForUser(userObj, badges, config);
  if (!nav.length) return 'pos';
  const role = userObj?.role;
  const preferredByRole = {
    jefe: 'jefe-home',
    vendedor: 'pos',
    almacenero: 'warehouse',
    economico: 'banking',
  };
  const pref = preferredByRole[role];
  if (pref && nav.some((n) => n.id === pref)) return pref;
  return nav[0].id;
}

export default function Layout({
  user,
  account,
  activeCompany,
  config,
  badges,
  activePage,
  onNavigate,
  onPreviewCatalog,
  onSwitchUser,
  onOpenHub,
  onStartAffiliate,
  onLogout,
  notify,
  children,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [roleUsers, setRoleUsers] = useState([]);
  const [copiedCat, setCopiedCat] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const navItems = useMemo(() => getNavForUser(user, badges, config), [user, badges, config]);

  const roleMeta = ROLE_META[user.role] || ROLE_META.vendedor;
  const companyCode = activeCompany?.company_code || config?.company_code || 'kiosko-CEIBA1';
  const isDemo = Boolean(activeCompany?.is_demo);
  const canQuickSwitch = isDemo || user.role === 'jefe';
  const catalogOn = config?.catalog_enabled !== 0 && config?.modules?.catalog !== false;

  useEffect(() => {
    if (!switchOpen || !canQuickSwitch) return;
    api
      .get('/api/auth/roles-preview')
      .then((r) => setRoleUsers(r.users || []))
      .catch(() => {});
  }, [switchOpen, canQuickSwitch]);

  function handleNav(id) {
    onNavigate(id);
    setMobileOpen(false);
  }

  function handleCompaniesAction() {
    setMobileOpen(false);
    if (onOpenHub) {
      onOpenHub();
    } else {
      setCompanyModalOpen(true);
    }
  }

  function handleCopyCatalogLink() {
    if (!companyCode) return;
    const url = buildCatalogUrl(companyCode);
    navigator.clipboard?.writeText(url);
    setCopiedCat(true);
    notify?.('Enlace público del catálogo copiado. Envíalo por WhatsApp a tus clientes.');
    setTimeout(() => setCopiedCat(false), 2200);
  }

  function handleCopyTeamCode() {
    if (!companyCode) return;
    navigator.clipboard?.writeText(companyCode);
    setCopiedCode(true);
    notify?.(`Código de empresa ${companyCode} copiado.`);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  const mobileTabs = useMemo(() => {
    const ordered = MOBILE_PRIORITY.map((id) => navItems.find((i) => i.id === id)).filter(Boolean);
    const merged = [...ordered, ...navItems.filter((i) => !ordered.includes(i))];
    return merged.slice(0, 4);
  }, [navItems]);

  const renderNavItem = (item) => {
    const Icon = item.icon;
    const active = activePage === item.id;
    const badgeColor =
      item.badgeTone === 'green'
        ? 'bg-[#1DA851] text-white'
        : item.badgeTone === 'red'
          ? 'bg-red-600 text-white'
          : 'bg-[#C2542D] text-white';

    return (
      <button
        key={item.id}
        type="button"
        data-nav-id={item.id}
        onClick={() => handleNav(item.id)}
        className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition-all cursor-pointer ${
          active
            ? 'bg-[#181715] text-[#FAF8F4] shadow-xs'
            : 'text-[#44403A] hover:bg-[#EFECE4] hover:text-[#181715]'
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <Icon
            className={`h-4 w-4 shrink-0 ${
              active
                ? 'text-[#FAF8F4]'
                : item.id === 'catalog-wa'
                  ? 'text-[#1DA851]'
                  : 'text-[#7C756A]'
            }`}
          />
          <span className="truncate">{item.label}</span>
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {item.readOnly && !active && (
            <span className="rounded bg-[#EFECE4] px-1.5 py-0.5 text-[9px] font-bold text-[#756E64]">
              Ver
            </span>
          )}
          {Number(item.badge) > 0 && (
            <span
              className={`min-w-[19px] h-[19px] px-1.5 rounded-full text-[10px] font-extrabold flex items-center justify-center tabular-nums ${badgeColor}`}
            >
              {item.badge}
            </span>
          )}
        </span>
      </button>
    );
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#F7F5F0] text-[#181715]">
      {/* Identidad del negocio y código de empresa */}
      <div className="px-4 pt-4 pb-3 border-b border-[#E6E1D6]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#181715] text-[#FAF8F4] text-sm font-black tracking-tight">
              {(activeCompany?.name || config?.business_name || 'K').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold tracking-tight text-[#181715] truncate">
                {activeCompany?.name || config?.business_name || 'Tu Comercio'}
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-[#756E64]">
                <span className="truncate">{config?.legal_form || 'MIPYME'}</span>
                <span>·</span>
                <button
                  type="button"
                  onClick={handleCopyTeamCode}
                  title="Copiar código único de empresa"
                  className="inline-flex items-center gap-1 font-mono font-bold text-[#4A463F] hover:text-[#181715] cursor-pointer"
                >
                  {companyCode}
                  {copiedCode ? (
                    <Check className="h-2.5 w-2.5 text-emerald-700" />
                  ) : (
                    <Copy className="h-2.5 w-2.5 opacity-70" />
                  )}
                </button>
              </div>
            </div>
          </div>
          {mobileOpen && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Cerrar menú"
              className="lg:hidden rounded-lg p-1.5 text-[#6E685F] hover:bg-[#EFECE4] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Acceso rápido al Catálogo público de clientes */}
        {catalogOn && companyCode && (
          <div className="mt-2.5 rounded-xl bg-white border border-[#E4DFD3] px-2.5 py-2 flex items-center justify-between gap-1.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#14793B]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#1DA851]" />
                <span>Catálogo público</span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleCopyCatalogLink}
                title="Copiar enlace para WhatsApp"
                className="inline-flex items-center gap-1 rounded-lg bg-[#1DA851] hover:bg-[#188F44] text-white px-2 py-1 text-[10.5px] font-bold cursor-pointer transition-colors"
              >
                {copiedCat ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedCat ? 'Copiado' : 'Link'}
              </button>
              {onPreviewCatalog && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    onPreviewCatalog(companyCode);
                  }}
                  title="Ver catálogo como cliente"
                  className="inline-flex items-center gap-1 rounded-lg bg-[#EFECE4] hover:bg-[#E4DFD3] text-[#181715] px-2 py-1 text-[10.5px] font-semibold cursor-pointer"
                >
                  <Eye className="h-3 w-3" />
                  Ver
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Navegación empresarial completa (filtrada estrictamente por permisos del usuario) */}
      <nav aria-label="Menú principal del negocio" className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-0.5">
        {navItems.map(renderNavItem)}

        {/* Separador — Acciones de cuenta y empresa */}
        <div className="pt-2 mt-2 border-t border-[#E6E1D6] space-y-0.5">
          <button
            type="button"
            data-nav-id="companies-hub"
            onClick={handleCompaniesAction}
            className="w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-[13px] font-semibold text-[#44403A] hover:bg-[#EFECE4] hover:text-[#181715] transition-all cursor-pointer"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Building2 className="h-4 w-4 shrink-0 text-[#7C756A]" />
              <span className="truncate">Mis empresas / Afiliarme</span>
            </span>
            <span className="rounded bg-[#ECE8DE] px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-[#5E584E] shrink-0">
              {companyCode.replace(/^kiosko-/i, '')}
            </span>
          </button>

          <button
            type="button"
            data-nav-id="logout"
            onClick={() => {
              setMobileOpen(false);
              onLogout();
            }}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-semibold text-[#7A3520] hover:bg-red-50 hover:text-red-700 transition-all cursor-pointer"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="truncate">Cerrar sesión</span>
          </button>
        </div>
      </nav>

      {/* Pie con usuario activo + cambio rápido de perfil (demo o Jefe probando permisos) */}
      <div className="px-3 py-2.5 border-t border-[#E6E1D6] bg-[#F2EFE8]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[12px] font-bold text-[#181715] truncate">{user.full_name}</p>
              {user.role === 'jefe' && (
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" title="Acceso total (Jefe)" />
              )}
            </div>
            <p className="text-[10.5px] text-[#756E64] truncate">
              {roleMeta.short}
              {user.role !== 'jefe' ? ` · ${navItems.length} módulos` : ' · Acceso total'}
              {user.shift_name ? ` · ${user.shift_name}` : ''}
            </p>
          </div>
          {canQuickSwitch && (
            <button
              type="button"
              onClick={() => setSwitchOpen(true)}
              title={isDemo ? 'Probar otro rol del negocio' : 'Ver cómo ve el sistema otro trabajador'}
              className="inline-flex items-center gap-1 rounded-lg bg-white border border-[#DED9CD] hover:border-[#181715] px-2 py-1 text-[10.5px] font-bold text-[#181715] cursor-pointer shrink-0"
            >
              <ArrowLeftRight className="h-3 w-3" />
              Rol
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const currentNav = navItems.find((i) => i.id === activePage);
  const currentTitle = currentNav?.label || 'Inicio del Negocio';

  return (
    <div className="min-h-screen flex bg-[#FAF8F4] text-[#181715]">
      {/* Barra lateral fija en escritorio */}
      <aside className="hidden lg:block lg:w-[258px] lg:shrink-0 border-r border-[#E6E1D6] sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Menú deslizable en móvil */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 w-[285px] max-w-[86vw] h-full shadow-2xl">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Área principal */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Cabecera superior compacta */}
        <header className="sticky top-0 z-30 h-14 bg-[#FAF8F4]/92 backdrop-blur-md border-b border-[#E6E1D6] px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú"
              className="lg:hidden rounded-xl p-2 -ml-1.5 text-[#181715] hover:bg-[#EFECE4] cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-[15px] sm:text-base font-bold tracking-tight text-[#181715] truncate">
              {currentTitle}
            </h1>
            {currentNav?.readOnly && (
              <span className="hidden sm:inline-flex items-center rounded-full bg-stone-200/80 px-2 py-0.5 text-[10.5px] font-bold text-stone-700">
                Solo consulta
              </span>
            )}
            {isDemo && (
              <span className="hidden md:inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                Demo · {companyCode}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {badges.active_shift ? (
              <button
                type="button"
                onClick={() => {
                  if (navItems.some((n) => n.id === 'shift-ipv')) handleNav('shift-ipv');
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 cursor-pointer"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="hidden sm:inline">{badges.active_shift.shift_name}</span>
                <span>
                  · {badges.active_shift.open_registers} caja
                  {badges.active_shift.open_registers === 1 ? '' : 's'}
                </span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EFECE4] px-2.5 py-1 text-[11px] font-medium text-[#6E685F]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#9E9689]" />
                Turno cerrado
              </span>
            )}

            {canQuickSwitch && (
              <button
                type="button"
                onClick={() => setSwitchOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-white border border-[#E2DDD1] hover:border-[#181715] px-2.5 py-1 text-[11px] font-semibold text-[#181715] transition-colors cursor-pointer"
              >
                <ArrowLeftRight className="h-3 w-3 text-[#756E64]" />
                <span>{roleMeta.short}</span>
              </button>
            )}
          </div>
        </header>

        {/* Contenido */}
        <main className="flex-1 p-4 sm:p-6 lg:p-7 pb-24 lg:pb-10 max-w-[1440px] w-full mx-auto">
          {children}
        </main>

        {/* Navegación inferior móvil */}
        <nav
          aria-label="Accesos rápidos móviles"
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-[#E6E1D6] px-1.5 py-1 flex items-center justify-around"
        >
          {mobileTabs.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`relative flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 min-w-[58px] text-[10px] font-semibold cursor-pointer ${
                  active ? 'text-[#181715]' : 'text-[#827B70]'
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${
                    active ? 'text-[#181715]' : item.id === 'catalog-wa' ? 'text-[#1DA851]' : ''
                  }`}
                />
                <span className="truncate max-w-[66px]">{item.shortLabel || item.label}</span>
                {Number(item.badge) > 0 && (
                  <span
                    className={`absolute top-0.5 right-1.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-extrabold text-white flex items-center justify-center ${
                      item.badgeTone === 'green' ? 'bg-[#1DA851]' : 'bg-[#C2542D]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 min-w-[54px] text-[10px] font-semibold text-[#827B70] cursor-pointer"
          >
            <Menu className="h-5 w-5" />
            <span>Menú</span>
          </button>
        </nav>
      </div>

      {/* Modal: Mis empresas / Afiliarme (cuando no hay cuenta Conecta multiempresa activa) */}
      {companyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-[#E6E1D6] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#EFECE4]">
              <div>
                <h3 className="text-sm font-bold text-[#181715]">Mis empresas / Afiliarme</h3>
                <p className="text-xs text-[#756E64]">
                  Código único de vinculación y acceso multiempresa Conecta
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompanyModalOpen(false)}
                className="rounded-lg p-1.5 text-[#756E64] hover:bg-[#EFECE4] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-[#F7F5F0] border border-[#E4DFD3] p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#756E64]">
                  Empresa activa en esta sesión
                </p>
                <p className="text-base font-extrabold text-[#181715] mt-0.5">
                  {activeCompany?.name || config?.business_name}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-white border border-[#DED9CD] px-3 py-2">
                  <div>
                    <p className="text-[10px] font-semibold text-[#756E64]">
                      Código para afiliar trabajadores
                    </p>
                    <p className="font-mono text-sm font-black text-[#181715]">{companyCode}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyTeamCode}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#181715] text-white px-3 py-1.5 text-xs font-bold hover:bg-stone-800 cursor-pointer"
                  >
                    {copiedCode ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedCode ? 'Copiado' : 'Copiar código'}
                  </button>
                </div>
                <p className="text-[11px] text-[#6E685F] mt-2">
                  Comparte este código con tus empleados para que se afilien a tu negocio con su correo, o úsalo en{' '}
                  <strong>Afiliarme</strong> para unirte a otra empresa.
                </p>
              </div>

              {onStartAffiliate && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCompanyModalOpen(false);
                      onStartAffiliate('affiliate');
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#181715] text-white px-3.5 py-2.5 text-xs font-bold hover:bg-stone-800 cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Afiliarme con código
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCompanyModalOpen(false);
                      onStartAffiliate('create');
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#EFECE4] text-[#181715] px-3.5 py-2.5 text-xs font-bold hover:bg-[#E4DFD3] cursor-pointer"
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    Crear / Cambiar empresa
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cambio rápido de perfil (para probar permisos de cada trabajador en vivo) */}
      {switchOpen && canQuickSwitch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-[#E6E1D6] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#EFECE4]">
              <div>
                <h3 className="text-sm font-bold text-[#181715]">
                  {isDemo ? 'Cambiar perfil de trabajo' : 'Probar vista y permisos por trabajador'}
                </h3>
                <p className="text-xs text-[#756E64]">
                  Cada trabajador ve únicamente los módulos y datos autorizados por el Jefe.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSwitchOpen(false)}
                className="rounded-lg p-1.5 text-[#756E64] hover:bg-[#EFECE4] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3 max-h-[65vh] overflow-y-auto space-y-1">
              {roleUsers.map((u) => {
                const rm = ROLE_META[u.role] || ROLE_META.vendedor;
                const isMe = u.id === user.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={async () => {
                      setSwitchOpen(false);
                      await onSwitchUser(u.id);
                    }}
                    className={`w-full flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition-all cursor-pointer ${
                      isMe ? 'bg-[#181715] text-white' : 'hover:bg-[#F7F5F0] text-[#181715]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{u.full_name}</p>
                      <p className={`text-[11px] truncate ${isMe ? 'text-white/75' : 'text-[#756E64]'}`}>
                        {rm.label}
                        {u.shift_name ? ` · ${u.shift_name}` : ''}
                        {u.active_register ? ` · Caja #${u.active_register} abierta` : ''}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        isMe ? 'bg-white/20 text-white' : 'bg-[#EFECE4] text-[#4A463F]'
                      }`}
                    >
                      {isMe ? 'Activo' : 'Entrar'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
