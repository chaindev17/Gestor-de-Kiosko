import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Calculator,
  ClipboardList,
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
  Store,
  Tag,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_META } from '../lib/format.js';

export function getNavForRole(role, badges = {}) {
  if (role === 'jefe') {
    return [
      { id: 'jefe-home', label: 'Centro de Control', icon: LayoutDashboard },
      { id: 'staff', label: 'Personal y Turnos', icon: Users },
      { id: 'shift-ipv', label: 'Turnos, Cajas e IPV', icon: ClipboardList, badge: badges.unvalidated_shifts },
      { id: 'pos', label: 'Punto de Venta (POS)', icon: ShoppingCart },
      {
        id: 'warehouse',
        label: 'Almacén y Abastecimiento',
        icon: Package,
        badge: (badges.pending_restocks || 0) + (badges.pending_mermas || 0),
      },
      { id: 'pricing', label: 'Precios y Fichas (MFP)', icon: Tag },
      {
        id: 'banking',
        label: 'Bancarización y Gastos',
        icon: Landmark,
        badge: badges.pending_deposits,
      },
      { id: 'onat', label: 'Tributos ONAT', icon: Receipt },
      { id: 'payroll', label: 'Nómina (Ley 116)', icon: Wallet },
      { id: 'accounting', label: 'Contabilidad NCIF', icon: BookOpen },
      {
        id: 'compliance',
        label: 'Leyes e Inspección',
        icon: Scale,
        badge: badges.compliance_critical,
      },
    ];
  }

  if (role === 'economico') {
    return [
      {
        id: 'banking',
        label: 'Bancarización y Caja',
        icon: Landmark,
        badge: (badges.pending_deposits || 0) + (badges.unreconciled_qr || 0),
      },
      { id: 'pricing', label: 'Fichas de Costo (MFP)', icon: Tag },
      { id: 'onat', label: 'Liquidación ONAT', icon: Receipt },
      { id: 'payroll', label: 'Nómina y Retenciones', icon: Wallet },
      { id: 'accounting', label: 'Contabilidad NCIF', icon: BookOpen },
      {
        id: 'shift-ipv',
        label: 'Auditoría de Turnos / IPV',
        icon: FileSpreadsheet,
        badge: badges.unvalidated_shifts,
      },
      {
        id: 'warehouse',
        label: 'Submayor y Mermas',
        icon: Package,
        badge: badges.pending_mermas,
      },
      {
        id: 'compliance',
        label: 'Cumplimiento Legal',
        icon: Scale,
        badge: badges.compliance_critical,
      },
    ];
  }

  if (role === 'almacenero') {
    return [
      {
        id: 'warehouse',
        label: 'Gestión de Almacén',
        icon: Package,
        badge: badges.pending_restocks,
      },
      { id: 'pricing', label: 'Catálogo y Tablilla CUP', icon: Tag },
      { id: 'compliance', label: 'Normas y Vencimientos', icon: Scale },
    ];
  }

  // vendedor (2 vendedores por turno)
  return [
    { id: 'pos', label: 'Punto de Venta (POS)', icon: ShoppingCart },
    { id: 'shift-ipv', label: 'Mi Caja, Turno e IPV', icon: ClipboardList },
    { id: 'pricing', label: 'Tablilla Oficial CUP', icon: Tag },
  ];
}

export default function Layout({
  user,
  config,
  badges,
  activePage,
  onNavigate,
  onSwitchUser,
  onLogout,
  children,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [roleUsers, setRoleUsers] = useState([]);

  const navItems = getNavForRole(user.role, badges);
  const roleMeta = ROLE_META[user.role] || ROLE_META.vendedor;

  useEffect(() => {
    if (switchOpen && roleUsers.length === 0) {
      api
        .get('/api/auth/roles-preview')
        .then((d) => setRoleUsers(d.users || []))
        .catch(() => {});
    }
  }, [switchOpen, roleUsers.length]);

  const compliancePill =
    badges?.compliance_overall === 'RIESGO_MULTA'
      ? { text: 'Alerta Legal', cls: 'bg-red-50 text-red-800 border-red-200' }
      : badges?.compliance_overall === 'ATENCION'
      ? { text: `Cumplimiento ${badges.compliance_score}%`, cls: 'bg-amber-50 text-amber-800 border-amber-200' }
      : { text: `En regla ${badges?.compliance_score ?? 100}%`, cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' };

  return (
    <div className="min-h-screen flex bg-[#F6F5F0]">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#171C22]/40 lg:hidden no-print"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#E3DFD5] flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 no-print ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-4 border-b border-[#ECE8DE] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0F5C4D] text-white">
              <Store className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[#171C22]">
                {config?.business_name || 'Gestor de Kiosko'}
              </p>
              <p className="truncate text-[11px] text-[#66707D]">
                {config?.legal_form || 'MIPYME'} · NIT {config?.nit || '—'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="lg:hidden rounded-lg p-1 text-[#66707D] hover:bg-[#F3F1EB]"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-[#ECE8DE] bg-[#FAF9F5]">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${roleMeta.badgeClass}`}
          >
            {roleMeta.label}
          </span>
          <p className="mt-1.5 text-sm font-semibold text-[#171C22] truncate">{user.full_name}</p>
          {user.role === 'vendedor' && user.shift_name && (
            <p className="text-[11px] text-[#66707D]">
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
                className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition cursor-pointer ${
                  active
                    ? 'bg-[#0F5C4D] text-white font-semibold'
                    : 'text-[#3C4450] hover:bg-[#F3F1EB] font-medium'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                      active ? 'bg-white/20 text-white' : 'bg-[#B45309]/15 text-[#9A3412]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[#ECE8DE] space-y-1.5">
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[#5A6370] hover:bg-[#F3F1EB] hover:text-[#171C22] cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 border-b border-[#E3DFD5] bg-white/95 backdrop-blur-xs px-4 lg:px-6 py-3 flex items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="lg:hidden rounded-lg border border-[#D5D0C4] p-1.5 text-[#171C22]"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {badges?.active_shift ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-900">
                  <span className="h-2 w-2 rounded-full bg-emerald-600" />
                  {badges.active_shift.shift_name} activo ({badges.active_shift.open_registers}/2 vendedores)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-stone-100 px-2.5 py-1 font-medium text-stone-700">
                  Sin turno abierto
                </span>
              )}
              <span className={`hidden sm:inline-flex items-center rounded-full border px-2.5 py-1 font-medium ${compliancePill.cls}`}>
                {compliancePill.text}
              </span>
            </div>
          </div>

          {/* Quick Role Switcher */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSwitchOpen((o) => !o)}
              className="btn-secondary text-xs py-1.5 px-2.5"
              title="Cambiar rápidamente de puesto de trabajo"
            >
              <Repeat className="h-3.5 w-3.5 text-[#0F5C4D]" />
              <span className="hidden sm:inline">Cambiar puesto</span>
            </button>
            {switchOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSwitchOpen(false)} />
                <div className="absolute right-0 mt-2 z-50 w-72 rounded-xl border border-[#DFDBD0] bg-white shadow-lg p-2">
                  <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#66707D]">
                    Cambiar vista de trabajador
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
                          className={`w-full rounded-lg px-2.5 py-2 text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${
                            isCurrent ? 'bg-[#0F5C4D]/10 text-[#0F5C4D] font-semibold' : 'hover:bg-[#F4F2EC] text-[#171C22]'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{ru.full_name}</p>
                            <p className="text-[11px] text-[#66707D] truncate">
                              {m?.short}
                              {ru.shift_name ? ` · ${ru.shift_name} (Caja ${ru.default_register})` : ''}
                            </p>
                          </div>
                          {isCurrent && <span className="text-[10px] font-bold">Actual</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
