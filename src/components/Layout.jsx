import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  Check,
  ChevronDown,
  ClipboardList,
  Copy,
  Eye,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  Receipt,
  Repeat,
  Scale,
  ShoppingCart,
  Sliders,
  Tag,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_META } from '../lib/format.js';
import { buildCatalogUrl } from '../lib/whatsapp.js';

export function getNavForRole(role, badges = {}, config = null) {
  const mods = config?.modules || {};
  const perms = config?.permissions || {};
  const isOn = (key) => mods[key] !== false;

  if (role === 'jefe') {
    const items = [
      { id: 'jefe-home', label: 'Inicio', icon: LayoutDashboard, group: 'daily', mobilePin: true },
    ];
    if (isOn('pos')) {
      items.push({ id: 'pos', label: 'Cobrar (Caja)', icon: ShoppingCart, group: 'daily', mobilePin: true });
    }
    if (isOn('catalog')) {
      items.push({
        id: 'catalog-wa',
        label: 'Catálogo WhatsApp',
        icon: MessageCircle,
        badge: badges.pending_orders,
        badgeTone: 'green',
        group: 'daily',
        mobilePin: true,
      });
    }
    if (isOn('ipv')) {
      items.push({
        id: 'shift-ipv',
        label: 'Turnos y Arqueo',
        icon: ClipboardList,
        badge: badges.unvalidated_shifts,
        group: 'daily',
      });
    }
    if (isOn('warehouse')) {
      items.push({
        id: 'warehouse',
        label: 'Productos y Stock',
        icon: Package,
        badge: (badges.pending_restocks || 0) + (badges.pending_mermas || 0),
        group: 'stock',
        mobilePin: true,
      });
    }
    if (isOn('pricing')) {
      items.push({ id: 'pricing', label: 'Precios y Lista', icon: Tag, group: 'stock' });
    }

    items.push({ id: 'staff', label: 'Equipo y Horarios', icon: Users, group: 'company' });
    items.push({
      id: 'workspace-settings',
      label: 'Mi Empresa y Modo',
      icon: Sliders,
      badge: badges.pending_affiliations,
      group: 'company',
    });

    if (isOn('banking')) {
      items.push({
        id: 'banking',
        label: 'Banco y Gastos',
        icon: Landmark,
        badge: badges.pending_deposits,
        group: 'admin',
      });
    }
    if (isOn('onat')) items.push({ id: 'onat', label: 'Impuestos (ONAT)', icon: Receipt, group: 'admin' });
    if (isOn('payroll')) items.push({ id: 'payroll', label: 'Sueldos y Comisiones', icon: Wallet, group: 'admin' });
    if (isOn('accounting')) items.push({ id: 'accounting', label: 'Contabilidad', icon: BookOpen, group: 'admin' });
    if (isOn('compliance')) {
      items.push({
        id: 'compliance',
        label: 'Inspección y Leyes',
        icon: Scale,
        badge: badges.compliance_critical,
        group: 'admin',
      });
    }
    return items;
  }

  if (role === 'economico') {
    const items = [];
    if (isOn('banking')) {
      items.push({
        id: 'banking',
        label: 'Cobros QR y Banco',
        icon: Landmark,
        badge: (badges.pending_deposits || 0) + (badges.unreconciled_qr || 0),
        group: 'daily',
        mobilePin: true,
      });
    }
    if (isOn('pricing')) items.push({ id: 'pricing', label: 'Precios y Fichas', icon: Tag, group: 'daily', mobilePin: true });
    if (isOn('catalog')) items.push({ id: 'catalog-wa', label: 'Catálogo WhatsApp', icon: MessageCircle, group: 'daily' });
    if (isOn('onat')) items.push({ id: 'onat', label: 'Impuestos (ONAT)', icon: Receipt, group: 'daily', mobilePin: true });
    if (isOn('payroll')) items.push({ id: 'payroll', label: 'Sueldos', icon: Wallet, group: 'daily' });
    if (isOn('accounting')) items.push({ id: 'accounting', label: 'Contabilidad', icon: BookOpen, group: 'daily', mobilePin: true });
    if (isOn('ipv')) {
      items.push({
        id: 'shift-ipv',
        label: 'Revisar Turnos',
        icon: FileSpreadsheet,
        badge: badges.unvalidated_shifts,
        group: 'stock',
      });
    }
    if (isOn('warehouse')) {
      items.push({
        id: 'warehouse',
        label: 'Stock y Mermas',
        icon: Package,
        badge: perms.economico_approve_mermas !== false ? badges.pending_mermas : 0,
        group: 'stock',
      });
    }
    if (isOn('compliance')) {
      items.push({
        id: 'compliance',
        label: 'Leyes e Inspección',
        icon: Scale,
        badge: badges.compliance_critical,
        group: 'stock',
      });
    }
    if (items.length === 0) {
      items.push({ id: 'jefe-home', label: 'Inicio', icon: LayoutDashboard, group: 'daily', mobilePin: true });
    }
    return items;
  }

  if (role === 'almacenero') {
    const items = [
      {
        id: 'warehouse',
        label: 'Productos y Stock',
        icon: Package,
        badge: badges.pending_restocks,
        group: 'daily',
        mobilePin: true,
      },
    ];
    if (isOn('catalog')) {
      items.push({
        id: 'catalog-wa',
        label: 'Catálogo WhatsApp',
        icon: MessageCircle,
        badge: badges.pending_orders,
        badgeTone: 'green',
        group: 'daily',
        mobilePin: true,
      });
    }
    if (isOn('pricing') && perms.almacenero_view_pricelist !== false) {
      items.push({ id: 'pricing', label: 'Precios y Lista', icon: Tag, group: 'daily', mobilePin: true });
    }
    if (isOn('compliance') && perms.almacenero_view_compliance !== false) {
      items.push({ id: 'compliance', label: 'Normas y Vencimientos', icon: Scale, group: 'daily' });
    }
    return items;
  }

  // vendedor — ultra-clean 4-item bar!
  const items = [
    { id: 'pos', label: 'Cobrar (Caja)', icon: ShoppingCart, group: 'daily', mobilePin: true },
  ];
  if (isOn('catalog') && perms.vendedor_manage_orders !== false) {
    items.push({
      id: 'catalog-wa',
      label: 'Pedidos WhatsApp',
      icon: MessageCircle,
      badge: badges.pending_orders,
      badgeTone: 'green',
      group: 'daily',
      mobilePin: true,
    });
  }
  if (isOn('ipv')) {
    items.push({ id: 'shift-ipv', label: 'Mi Caja y Turno', icon: ClipboardList, group: 'daily', mobilePin: true });
  }
  if (isOn('pricing') && perms.vendedor_view_pricelist !== false) {
    items.push({ id: 'pricing', label: 'Lista de Precios', icon: Tag, group: 'daily', mobilePin: true });
  }
  return items;
}

export function getDefaultPageForRole(role, badges = {}, config = null) {
  const nav = getNavForRole(role, badges, config);
  return nav[0]?.id || 'pos';
}

const GROUP_LABELS = {
  daily: 'Día a día',
  stock: 'Mercancía',
  company: 'Tu negocio',
  admin: 'Cuentas y ley',
};

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
  onLogout,
  notify,
  children,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [roleUsers, setRoleUsers] = useState([]);
  const [copiedCat, setCopiedCat] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const navItems = useMemo(() => getNavForRole(user.role, badges, config), [user.role, badges, config]);
  const isInAdminGroup = useMemo(
    () => navItems.some((i) => i.group === 'admin' && i.id === activePage),
    [navItems, activePage]
  );
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    if (isInAdminGroup) setAdminOpen(true);
  }, [isInAdminGroup]);

  const roleMeta = ROLE_META[user.role] || ROLE_META.vendedor;
  const companyCode = activeCompany?.company_code || config?.company_code || '';
  const isDemo = Boolean(activeCompany?.is_demo);
  const canQuickSwitch = isDemo || user.role === 'jefe';
  const catalogOn = config?.modules?.catalog !== false;

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

  function handleCopyCatalogLink() {
    if (!companyCode) return;
    const url = buildCatalogUrl(companyCode);
    navigator.clipboard?.writeText(url);
    setCopiedCat(true);
    notify?.('Link de tu catálogo copiado. Envíalo por WhatsApp a tus clientes.');
    setTimeout(() => setCopiedCat(false), 2200);
  }

  function handleCopyTeamCode() {
    if (!companyCode) return;
    navigator.clipboard?.writeText(companyCode);
    setCopiedCode(true);
    notify?.(`Código para empleados ${companyCode} copiado.`);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  const groupedSections = useMemo(() => {
    const order = ['daily', 'stock', 'company', 'admin'];
    return order
      .map((key) => {
        const items = navItems.filter((i) => (i.group || 'daily') === key);
        const badgeTotal = items.reduce((s, i) => s + Number(i.badge || 0), 0);
        return { key, label: GROUP_LABELS[key], items, badgeTotal };
      })
      .filter((g) => g.items.length > 0);
  }, [navItems]);

  const mobileTabs = useMemo(() => {
    const pinned = navItems.filter((i) => i.mobilePin).slice(0, 4);
    return pinned.length > 0 ? pinned : navItems.slice(0, 4);
  }, [navItems]);

  const renderNavItem = (item) => {
    const Icon = item.icon;
    const active = activePage === item.id;
    const isGreenBadge = item.badgeTone === 'green';
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleNav(item.id)}
        className={`w-full flex items-center justify-between gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all cursor-pointer ${
          active
            ? 'bg-[#181715] text-[#FAF8F4] shadow-xs'
            : 'text-[#4A463F] hover:bg-[#EFECE4] hover:text-[#181715]'
        }`}
      >
        <span className="flex items-center gap-2.5 truncate">
          <Icon
            className={`h-4 w-4 shrink-0 ${
              active
                ? 'text-[#FAF8F4]'
                : item.id === 'catalog-wa'
                ? 'text-[#1DA851]'
                : 'text-[#827B70]'
            }`}
          />
          <span className="truncate">{item.label}</span>
        </span>
        {Number(item.badge) > 0 && (
          <span
            className={`min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-extrabold flex items-center justify-center tabular-nums ${
              isGreenBadge ? 'bg-[#1DA851] text-white' : 'bg-[#C2542D] text-white'
            }`}
          >
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#F6F3EC] border-r border-[#E7E1D6]">
      {/* Brand + Company switcher */}
      <div className="px-4 pt-4 pb-3 border-b border-[#E7E1D6] space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-[#181715] text-[#FAF8F4] flex items-center justify-center font-editorial text-lg">
              {(config?.business_name || 'K').slice(0, 1)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#181715] truncate leading-tight">
                {config?.business_name || 'Mi Kiosko'}
              </p>
              <p className="text-[11px] text-[#7A7368] truncate">
                {user.full_name.split(' ')[0]} · {roleMeta.short}
              </p>
            </div>
          </div>
          {account && onOpenHub && (
            <button
              type="button"
              onClick={onOpenHub}
              title="Cambiar de empresa o crear otra"
              className="shrink-0 rounded-full border border-[#DDD6C8] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4A463F] hover:text-[#181715] hover:border-[#BDB4A3] inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeftRight className="h-3 w-3" />
              Empresas
            </button>
          )}
        </div>

        {/* 1-Click Customer Catalog Mini Bar — always at your fingertips! */}
        {catalogOn && companyCode && onPreviewCatalog && (
          <div className="rounded-xl bg-white border border-[#E2DCD0] p-2 flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                onPreviewCatalog(companyCode);
              }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#E6F5EF] hover:bg-[#D5EDE3] text-[#15614B] text-[11px] font-bold py-1.5 px-2.5 transition cursor-pointer"
            >
              <Eye className="h-3.5 w-3.5" />
              Ver catálogo
            </button>
            <button
              type="button"
              onClick={handleCopyCatalogLink}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#FAF8F4] hover:bg-[#EFECE4] text-[#3F3C37] text-[11px] font-semibold py-1.5 px-2.5 border border-[#E7E1D6] transition cursor-pointer"
              title="Copiar enlace del catálogo para clientes"
            >
              {copiedCat ? <Check className="h-3.5 w-3.5 text-[#15614B]" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedCat ? 'Listo' : 'Link'}
            </button>
          </div>
        )}
      </div>

      {/* Grouped, super-clear Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {groupedSections.map((sec) => {
          const isCollapsible = sec.key === 'admin' && user.role === 'jefe';
          if (isCollapsible) {
            return (
              <div key={sec.key} className="space-y-1">
                <button
                  type="button"
                  onClick={() => setAdminOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#8A8379] hover:text-[#181715] cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    {sec.label}
                    {sec.badgeTotal > 0 && (
                      <span className="rounded-full bg-[#C2542D] text-white px-1.5 py-0.2 text-[9px] font-extrabold">
                        {sec.badgeTotal}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${adminOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {adminOpen && <div className="space-y-0.5">{sec.items.map(renderNavItem)}</div>}
              </div>
            );
          }

          return (
            <div key={sec.key} className="space-y-1">
              {groupedSections.length > 1 && (
                <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#968F84]">
                  {sec.label}
                </p>
              )}
              <div className="space-y-0.5">{sec.items.map(renderNavItem)}</div>
            </div>
          );
        })}
      </nav>

      {/* Clean Footer: Shift status + Team code + Role switcher + Logout */}
      <div className="p-3 border-t border-[#E7E1D6] space-y-2">
        {companyCode && user.role === 'jefe' && (
          <button
            type="button"
            onClick={handleCopyTeamCode}
            className="w-full flex items-center justify-between rounded-xl bg-[#EFECE4]/70 hover:bg-[#EAE5DA] px-3 py-2 text-[11px] text-[#5E584F] transition cursor-pointer"
            title="Copiar código para afiliar empleados"
          >
            <span>
              Código equipo: <strong className="font-mono text-[#181715]">{companyCode}</strong>
            </span>
            {copiedCode ? (
              <Check className="h-3.5 w-3.5 text-[#15614B]" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-[#8A8379]" />
            )}
          </button>
        )}

        <div className="flex items-center gap-1.5">
          {canQuickSwitch && (
            <div className="relative flex-1">
              <button
                type="button"
                onClick={() => setSwitchOpen((v) => !v)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#DDD6C8] bg-white hover:bg-[#FAF8F4] px-2.5 py-2 text-xs font-semibold text-[#3F3C37] cursor-pointer"
              >
                <Repeat className="h-3.5 w-3.5 text-[#7A7368]" />
                {isDemo ? 'Probar rol' : 'Ver como rol'}
              </button>

              {switchOpen && roleUsers.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-60 rounded-2xl bg-white border border-[#E7E1D6] shadow-xl p-2 z-50 space-y-1">
                  <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#8A8379]">
                    Cambiar vista de puesto
                  </p>
                  {roleUsers.map((ru) => (
                    <button
                      key={ru.id}
                      type="button"
                      onClick={() => {
                        setSwitchOpen(false);
                        setMobileOpen(false);
                        onSwitchUser?.(ru.id);
                      }}
                      className={`w-full rounded-xl px-2.5 py-2 text-left text-xs flex items-center justify-between cursor-pointer ${
                        ru.id === user.id
                          ? 'bg-[#181715] text-white font-semibold'
                          : 'hover:bg-[#F3EFE7] text-[#2E2C28]'
                      }`}
                    >
                      <span className="truncate">{ru.full_name}</span>
                      <span
                        className={`text-[10px] ml-2 shrink-0 ${
                          ru.id === user.id ? 'text-[#C8C2B7]' : 'text-[#8A8379]'
                        }`}
                      >
                        {ROLE_META[ru.role]?.short || ru.role}
                        {ru.default_register ? ` C${ru.default_register}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#DDD6C8] bg-white hover:bg-[#FBEAEA] hover:text-[#9E2A2B] hover:border-[#E6B8B8] px-3 py-2 text-xs font-semibold text-[#5E584F] transition cursor-pointer"
            title="Cerrar sesión"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Salir</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FAF8F4] text-[#181715] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen no-print">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 lg:hidden no-print"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="h-full w-72 max-w-[85vw] shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-3.5 right-3 z-10 h-8 w-8 rounded-full bg-white border border-[#E7E1D6] flex items-center justify-center text-[#181715]"
              aria-label="Cerrar menú"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile Top Bar */}
        <header className="lg:hidden sticky top-0 z-30 bg-[#FAF8F4]/95 backdrop-blur-md border-b border-[#E7E1D6] px-4 py-2.5 flex items-center justify-between gap-2 no-print">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="h-9 w-9 rounded-xl bg-white border border-[#E7E1D6] flex items-center justify-center text-[#181715]"
              aria-label="Abrir menú"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#181715] truncate">
                {config?.business_name || 'Mi Kiosko'}
              </p>
              <p className="text-[10px] text-[#7A7368] truncate">
                {badges?.active_shift ? `● ${badges.active_shift.shift_name} abierto` : roleMeta.label}
              </p>
            </div>
          </div>

          {catalogOn && companyCode && onPreviewCatalog && (
            <button
              type="button"
              onClick={() => onPreviewCatalog(companyCode)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[#E6F5EF] text-[#15614B] px-3 py-1.5 text-xs font-bold"
            >
              <Eye className="h-3.5 w-3.5" />
              Catálogo
            </button>
          )}
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-5 sm:py-7 pb-24 lg:pb-8 max-w-7xl w-full mx-auto">
          {children}
        </main>

        {/* Mobile Bottom Tab Bar — effortless 1-thumb operation! */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/98 backdrop-blur-md border-t border-[#E7E1D6] px-2 py-1.5 flex items-center justify-around no-print">
          {mobileTabs.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`relative flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-xl text-[10px] font-bold transition ${
                  active ? 'text-[#181715]' : 'text-[#8A8379]'
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${
                    active ? 'text-[#181715]' : item.id === 'catalog-wa' ? 'text-[#1DA851]' : ''
                  }`}
                />
                <span className="truncate max-w-[68px]">{item.label.split(' ')[0]}</span>
                {Number(item.badge) > 0 && (
                  <span className="absolute top-0.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#1DA851] text-white text-[9px] font-extrabold flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-xl text-[10px] font-bold text-[#8A8379]"
          >
            <Menu className="h-5 w-5" />
            <span>Más</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
