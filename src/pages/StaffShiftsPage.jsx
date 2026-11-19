import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Edit3, KeyRound, Lock, Plus, RotateCcw, ShieldCheck, UserPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_META, formatCup } from '../lib/format.js';
import {
  MENU_SCHEMA,
  PERMISSION_FLAGS_SCHEMA,
  buildUserPermissions,
  getRoleDefaultMatrix,
} from '../lib/permissions.js';
import Modal from '../components/Modal.jsx';

const EMPTY_FORM = {
  username: '',
  password: '',
  full_name: '',
  ci: '',
  role: 'vendedor',
  shift_template_id: '',
  default_register: 1,
  contract_type: 'Indeterminado',
  base_salary_cup: 7200,
  sales_commission_pct: 1.2,
  phone: '',
  active: true,
};

export default function StaffShiftsPage({ user, notify, onRefreshBadges }) {
  const [data, setData] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [shiftModal, setShiftModal] = useState(false);
  const [shiftForm, setShiftForm] = useState({ name: '', code: '', start_time: '07:00', end_time: '15:00' });
  const [permModal, setPermModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const canEdit =
    user.role === 'jefe' || Boolean(user.permissions_matrix?.items?.staff?.canEdit);
  const isJefe = user.role === 'jefe';

  function openPermissionsEditor(worker) {
    const resolved = worker.permissions_matrix?.items
      ? worker.permissions_matrix
      : buildUserPermissions(worker, data?.config || {});
    const itemsClone = {};
    for (const m of MENU_SCHEMA) {
      const p = resolved.items?.[m.id] || { canView: false, canEdit: false, canApprove: false };
      itemsClone[m.id] = {
        canView: Boolean(p.canView),
        canEdit: Boolean(p.canEdit),
        canApprove: Boolean(m.supportsApprove && p.canApprove),
      };
    }
    const flagsClone = {};
    for (const f of PERMISSION_FLAGS_SCHEMA) {
      flagsClone[f.key] = Boolean(resolved.flags?.[f.key]);
    }
    setPermModal({
      worker,
      items: itemsClone,
      flags: flagsClone,
      hasCustom: Boolean(worker.has_custom_permissions || resolved.hasCustomOverrides),
    });
  }

  function applyRoleTemplate(templateRole) {
    if (!permModal) return;
    if (templateRole === 'supervisor') {
      const base = getRoleDefaultMatrix('almacenero', data?.config || {});
      base.items['jefe-home'] = { canView: true, canEdit: false, canApprove: false };
      base.items.pos = { canView: true, canEdit: true, canApprove: false };
      base.items['shift-ipv'] = { canView: true, canEdit: true, canApprove: true };
      base.items['catalog-wa'] = { canView: true, canEdit: true, canApprove: false };
      base.flags.cash_movements = true;
      setPermModal((pm) => ({ ...pm, items: base.items, flags: base.flags }));
      return;
    }
    const base = getRoleDefaultMatrix(templateRole, data?.config || {});
    setPermModal((pm) => ({ ...pm, items: base.items, flags: base.flags }));
  }

  function toggleModulePerm(modId, field, supportsApprove) {
    setPermModal((pm) => {
      const cur = pm.items[modId] || { canView: false, canEdit: false, canApprove: false };
      const next = { ...cur, [field]: !cur[field] };
      if (field === 'canView' && !next.canView) {
        next.canEdit = false;
        next.canApprove = false;
      }
      if (field === 'canEdit' && next.canEdit) {
        next.canView = true;
      }
      if (field === 'canApprove') {
        if (!supportsApprove) next.canApprove = false;
        else if (next.canApprove) next.canView = true;
      }
      return {
        ...pm,
        items: { ...pm.items, [modId]: next },
      };
    });
  }

  async function saveWorkerPermissions(reset = false) {
    if (!permModal) return;
    setSaving(true);
    try {
      await api.put(`/api/config/staff/${permModal.worker.id}/permissions`, {
        reset,
        items: permModal.items,
        flags: permModal.flags,
      });
      notify(
        reset
          ? `Permisos de ${permModal.worker.full_name} restaurados a los valores estándar de su rol.`
          : `Permisos de ${permModal.worker.full_name} guardados y registrados en la bitácora.`
      );
      setPermModal(null);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/config/staff');
      setData(res);
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate(preset = {}) {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      shift_template_id: data?.shifts?.[0]?.id || '',
      ...preset,
    });
    setModalOpen(true);
  }

  function openEdit(emp) {
    setEditingId(emp.id);
    setForm({
      username: emp.username,
      password: '',
      full_name: emp.full_name,
      ci: emp.ci,
      role: emp.role,
      shift_template_id: emp.shift_template_id || data?.shifts?.[0]?.id || '',
      default_register: emp.default_register || 1,
      contract_type: emp.contract_type,
      base_salary_cup: emp.base_salary_cup,
      sales_commission_pct: emp.sales_commission_pct,
      phone: emp.phone || '',
      active: Boolean(emp.active),
    });
    setModalOpen(true);
  }

  async function saveWorker(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/api/config/staff/${editingId}`, form);
        notify('Datos del trabajador actualizados.');
      } else {
        await api.post('/api/config/staff', form);
        notify('Trabajador incorporado a la plantilla conforme a Ley 116.');
      }
      setModalOpen(false);
      await load();
      onRefreshBadges?.();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveShift(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/config/shifts', shiftForm);
      notify(`Turno "${shiftForm.name}" creado con cupo de 2 vendedores.`);
      setShiftModal(false);
      setShiftForm({ name: '', code: '', start_time: '07:00', end_time: '15:00' });
      await load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return <div className="py-12 text-center text-sm text-[#66707D]">Cargando plantilla laboral...</div>;
  }

  const activeStaff = data.staff.filter((s) => s.active);
  const inactiveStaff = data.staff.filter((s) => !s.active);
  const coreRoles = ['jefe', 'economico', 'almacenero'];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#171C22]">
            Plantilla Laboral y Turnos del Kiosko
          </h1>
          <p className="text-xs text-[#66707D] mt-0.5">
            Estructura orgánica: 1 Jefe del Negocio · 1 Económico · 1 Almacenero · 2 Vendedores por turno (Ley 116 y{' '}
            {data.config.legal_form === 'MIPYME' ? 'DL 88/2024 Micro-MIPYME' : 'DL 90/2024 TCP'})
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShiftModal(true)} className="btn-secondary text-xs">
              <Clock className="h-3.5 w-3.5" />
              Nuevo turno
            </button>
            <button type="button" onClick={() => openCreate()} className="btn-primary text-xs">
              <UserPlus className="h-3.5 w-3.5" />
              Contratar trabajador
            </button>
          </div>
        )}
      </div>

      {/* Legal note banner */}
      <div className="rounded-xl border border-[#0F5C4D]/20 bg-[#0F5C4D]/6 p-4 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-[#0F5C4D] shrink-0 mt-0.5" />
        <div className="text-xs text-[#23322E] leading-relaxed">
          <strong>Validación laboral cubana automatizada:</strong> Con {activeStaff.length} trabajadores activos (1 jefe,
          1 económico, 1 almacenero y {activeStaff.filter((s) => s.role === 'vendedor').length} vendedores en{' '}
          {data.shifts.length} turnos), el negocio supera el límite de 3 contratados del TCP (DL 90/2024) y se encuadra
          legalmente como <strong>Micro-MIPYME (1 a 10 personas, DL 88/2024)</strong>. Salario mínimo controlado:{' '}
          <strong>{formatCup(data.config.min_wage_cup)}/mes</strong> (Ley 116) + 9.09% vacaciones pagadas.
        </div>
      </div>

      {/* Core Fixed Positions: 1 Jefe, 1 Económico, 1 Almacenero */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#66707D]">
          Puestos Únicos de Dirección, Economía y Almacén
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {coreRoles.map((roleKey) => {
            const holder = activeStaff.find((s) => s.role === roleKey);
            const meta = ROLE_META[roleKey];
            return (
              <div key={roleKey} className="card p-4 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}>
                      1 × {meta.label}
                    </span>
                    {holder && canEdit && (
                      <button
                        type="button"
                        onClick={() => openEdit(holder)}
                        className="rounded p-1 text-[#66707D] hover:bg-[#F3F1EB] hover:text-[#171C22] cursor-pointer"
                        title="Editar trabajador"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {holder ? (
                    <div className="mt-3 space-y-1">
                      <p className="text-sm font-bold text-[#171C22]">{holder.full_name}</p>
                      <p className="text-xs text-[#66707D]">
                        CI: <span className="font-mono">{holder.ci}</span> · Usuario:{' '}
                        <span className="font-mono">@{holder.username}</span>
                      </p>
                      <p className="text-xs text-[#66707D]">Contrato: {holder.contract_type}</p>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <p className="text-xs text-amber-800 font-medium">Plaza vacante</p>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => openCreate({ role: roleKey, base_salary_cup: 9000 })}
                          className="mt-2 btn-secondary text-xs py-1"
                        >
                          <Plus className="h-3 w-3" /> Cubrir plaza
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {holder && (
                  <div className="pt-2.5 border-t border-[#EFECE4] space-y-2 text-xs tabular-nums">
                    <div className="flex items-center justify-between">
                      <span className="text-[#66707D]">Salario básico</span>
                      <span className="font-bold text-[#171C22]">{formatCup(holder.base_salary_cup)}</span>
                    </div>
                    {holder.role === 'jefe' ? (
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Menú completo (13/13) · Configura y aprueba todo
                      </div>
                    ) : (
                      isJefe && (
                        <button
                          type="button"
                          onClick={() => openPermissionsEditor(holder)}
                          className="w-full inline-flex items-center justify-between rounded-lg bg-[#F7F5F0] hover:bg-[#ECE8DE] border border-[#E2DDD1] px-2.5 py-1.5 text-[11px] font-bold text-[#181715] cursor-pointer"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <KeyRound className="h-3 w-3 text-[#0F5C4D]" />
                            Permisos y menú
                            {holder.has_custom_permissions && (
                              <span className="rounded bg-amber-200 px-1 py-0.2 text-[9px] text-amber-950">
                                Personalizado
                              </span>
                            )}
                          </span>
                          <span className="text-[#66707D]">
                            {
                              MENU_SCHEMA.filter((m) => holder.permissions_matrix?.items?.[m.id]?.canView)
                                .length
                            }
                            /13
                          </span>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Shifts with 2 Sellers per Shift */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#66707D]">
          Turnos de Venta (Regla estricta: 2 Vendedores por Turno — Caja 1 y Caja 2)
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.shifts.map((sh) => {
            const sellers = activeStaff.filter((s) => s.role === 'vendedor' && s.shift_template_id === sh.id);
            return (
              <div key={sh.id} className="card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-[#171C22]">{sh.name}</h3>
                    <p className="text-xs text-[#66707D]">
                      Horario: {sh.start_time} a {sh.end_time}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${
                      sellers.length === 2
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {sellers.length}/{sh.required_sellers} vendedores
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[1, 2].map((regNum) => {
                    const seller = sellers.find((s) => s.default_register === regNum);
                    return (
                      <div
                        key={regNum}
                        className={`rounded-lg border p-3.5 ${
                          seller ? 'border-[#E3DFD5] bg-[#FAF9F5]' : 'border-dashed border-[#D5D0C4] bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase text-[#5B3A70]">
                            Vendedor · Caja {regNum}
                          </span>
                          {seller && canEdit && (
                            <button
                              type="button"
                              onClick={() => openEdit(seller)}
                              className="rounded p-1 text-[#66707D] hover:bg-white cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {seller ? (
                          <div className="mt-2 space-y-1 text-xs">
                            <p className="font-semibold text-[#171C22] text-sm">{seller.full_name}</p>
                            <p className="text-[#66707D] font-mono text-[11px]">
                              CI {seller.ci} · @{seller.username}
                            </p>
                            <p className="text-[#4C5561] tabular-nums pt-1">
                              Básico: <strong>{formatCup(seller.base_salary_cup, 0)}</strong> +{' '}
                              {seller.sales_commission_pct}% ventas
                            </p>
                            <p className="text-[#0F5C4D] font-medium tabular-nums">
                              Vendido mes: {formatCup(seller.month_sales_cup)} ({seller.month_shifts} turno(s))
                            </p>
                            {isJefe && (
                              <button
                                type="button"
                                onClick={() => openPermissionsEditor(seller)}
                                className="mt-1.5 w-full inline-flex items-center justify-between rounded-lg bg-white hover:bg-[#EFECE4] border border-[#DFDBD0] px-2.5 py-1.5 text-[11px] font-bold text-[#181715] cursor-pointer"
                              >
                                <span className="inline-flex items-center gap-1">
                                  <KeyRound className="h-3 w-3 text-[#5B3A70]" />
                                  Permisos
                                  {seller.has_custom_permissions && (
                                    <span className="rounded bg-amber-200 px-1 text-[9px] text-amber-950">
                                      Pers.
                                    </span>
                                  )}
                                </span>
                                <span className="text-[#66707D]">
                                  {
                                    MENU_SCHEMA.filter(
                                      (m) => seller.permissions_matrix?.items?.[m.id]?.canView
                                    ).length
                                  }
                                  /13 módulos
                                </span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="mt-2">
                            <p className="text-xs text-[#6F7885]">Caja {regNum} sin titular</p>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() =>
                                  openCreate({
                                    role: 'vendedor',
                                    shift_template_id: sh.id,
                                    default_register: regNum,
                                  })
                                }
                                className="mt-2 btn-secondary text-[11px] py-1 px-2"
                              >
                                <Plus className="h-3 w-3" /> Asignar vendedor
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {inactiveStaff.length > 0 && (
        <section className="card p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#66707D] mb-2">
            Bajas / Inactivos ({inactiveStaff.length})
          </h3>
          <div className="divide-y divide-[#EFECE4] text-xs">
            {inactiveStaff.map((s) => (
              <div key={s.id} className="py-2 flex items-center justify-between">
                <span>
                  {s.full_name} ({ROLE_META[s.role]?.label}) — CI {s.ci}
                </span>
                {canEdit && (
                  <button type="button" onClick={() => openEdit(s)} className="btn-secondary text-[11px] py-1 px-2">
                    Gestionar
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Resumen de Permisos y Accesos por Trabajador (exclusivo del Jefe) */}
      {isJefe && (
        <section className="card p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#171C22] flex items-center gap-2">
                <Lock className="h-4 w-4 text-[#0F5C4D]" />
                Matriz de Permisos Granulares por Trabajador (Ver · Editar · Aprobar)
              </h2>
              <p className="text-xs text-[#66707D]">
                Cada trabajador ve en su menú y puede abrir por URL únicamente las funciones que tú le habilites aquí.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#FAF8F4] text-[10.5px] uppercase text-[#66707D] border-y border-[#E6E1D6]">
                <tr>
                  <th className="px-3 py-2.5 text-left">Trabajador</th>
                  <th className="px-3 py-2.5 text-left">Cargo / Turno</th>
                  <th className="px-3 py-2.5 text-left">Módulos habilitados</th>
                  <th className="px-3 py-2.5 text-center">Costos privados</th>
                  <th className="px-3 py-2.5 text-center">Editar precios</th>
                  <th className="px-3 py-2.5 text-right">Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFECE4]">
                {activeStaff.map((w) => {
                  const mx = w.permissions_matrix || buildUserPermissions(w, data.config);
                  const visibleMods = MENU_SCHEMA.filter((m) => mx.items?.[m.id]?.canView);
                  const seeCosts = w.role === 'jefe' || Boolean(mx.flags?.view_costs);
                  const editPrices = w.role === 'jefe' || Boolean(mx.flags?.edit_prices);
                  return (
                    <tr key={w.id} className="hover:bg-[#FAF9F5]">
                      <td className="px-3 py-2.5">
                        <p className="font-bold text-[#171C22]">{w.full_name}</p>
                        <p className="text-[10.5px] font-mono text-[#66707D]">@{w.username}</p>
                      </td>
                      <td className="px-3 py-2.5 text-[#4C5561]">
                        {ROLE_META[w.role]?.short || w.role}
                        {w.shift_name ? ` · ${w.shift_name}` : ''}
                      </td>
                      <td className="px-3 py-2.5">
                        {w.role === 'jefe' ? (
                          <span className="rounded-full bg-emerald-100 text-emerald-900 px-2.5 py-0.5 text-[10.5px] font-bold">
                            Todos los 13 módulos + Aprobación total
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {visibleMods.map((m) => (
                              <span
                                key={m.id}
                                className="rounded bg-[#EFECE4] px-1.5 py-0.5 text-[10px] font-semibold text-[#3C3832]"
                              >
                                {m.shortLabel}
                                {mx.items[m.id]?.canApprove
                                  ? ' ★'
                                  : !mx.items[m.id]?.canEdit
                                    ? ' (ver)'
                                    : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            seeCosts
                              ? 'bg-amber-100 text-amber-900'
                              : mx.flags?.view_entry_cost
                                ? 'bg-blue-50 text-blue-800'
                                : 'bg-stone-100 text-stone-600'
                          }`}
                        >
                          {seeCosts ? 'Global' : mx.flags?.view_entry_cost ? 'Solo entrada' : 'Ocultos'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            editPrices
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-stone-100 text-stone-600'
                          }`}
                        >
                          {editPrices ? 'Directo' : 'Con aprobación'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {w.role === 'jefe' ? (
                          <span className="text-[11px] font-semibold text-emerald-800">Fijo (Jefe)</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openPermissionsEditor(w)}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#181715] text-white px-2.5 py-1 text-[11px] font-bold hover:bg-stone-800 cursor-pointer"
                          >
                            <KeyRound className="h-3 w-3" /> Configurar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Modal de Permisos Granulares por Trabajador */}
      <Modal
        open={Boolean(permModal)}
        onClose={() => setPermModal(null)}
        title={permModal ? `Permisos de ${permModal.worker.full_name}` : ''}
        subtitle="Define qué ve en su menú, qué puede registrar/editar y qué puede aprobar. Bloquea también el acceso por URL directa."
        maxWidth="max-w-3xl"
      >
        {permModal && (
          <div className="space-y-4 text-xs">
            {/* Plantillas rápidas */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
              <span className="text-[11px] font-semibold text-slate-600">Aplicar plantilla rápida:</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'vendedor', label: 'Dependiente POS' },
                  { id: 'almacenero', label: 'Almacenero' },
                  { id: 'supervisor', label: 'Encargado turno' },
                  { id: 'economico', label: 'Económico' },
                ].map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyRoleTemplate(tpl.id)}
                    className="rounded-lg bg-white border border-slate-300 hover:border-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-800 cursor-pointer"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tabla canView / canEdit / canApprove de los 13 módulos */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10.5px] uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left">Módulo del menú</th>
                    <th className="px-2 py-2 text-center w-20">Ver</th>
                    <th className="px-2 py-2 text-center w-24">Editar / Operar</th>
                    <th className="px-2 py-2 text-center w-20">Aprobar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {MENU_SCHEMA.map((m) => {
                    const row = permModal.items[m.id] || {
                      canView: false,
                      canEdit: false,
                      canApprove: false,
                    };
                    return (
                      <tr key={m.id} className={row.canView ? 'bg-white' : 'bg-slate-50/50 text-slate-400'}>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-slate-800">{m.label}</span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={row.canView}
                            onChange={() => toggleModulePerm(m.id, 'canView', m.supportsApprove)}
                            className="h-4 w-4 accent-slate-900 cursor-pointer"
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={row.canEdit}
                            onChange={() => toggleModulePerm(m.id, 'canEdit', m.supportsApprove)}
                            className="h-4 w-4 accent-emerald-700 cursor-pointer"
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          {m.supportsApprove ? (
                            <input
                              type="checkbox"
                              checked={row.canApprove}
                              onChange={() => toggleModulePerm(m.id, 'canApprove', m.supportsApprove)}
                              className="h-4 w-4 accent-amber-600 cursor-pointer"
                            />
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Permisos de privacidad y acciones sensibles */}
            <div className="space-y-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                Privacidad de costos, fotos, catálogo y operaciones sensibles
              </p>
              <div className="grid sm:grid-cols-2 gap-2">
                {PERMISSION_FLAGS_SCHEMA.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-2.5 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(permModal.flags[f.key])}
                      onChange={(e) =>
                        setPermModal((pm) => ({
                          ...pm,
                          flags: { ...pm.flags, [f.key]: e.target.checked },
                        }))
                      }
                      className="mt-0.5 h-4 w-4 accent-slate-900"
                    />
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 leading-tight">{f.label}</p>
                      <p className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">{f.hint}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={saving}
                onClick={() => saveWorkerPermissions(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restaurar por rol
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPermModal(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-600 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveWorkerPermissions(false)}
                  className="rounded-lg bg-slate-900 px-5 py-2 font-bold text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                >
                  {saving ? 'Guardando...' : 'Guardar permisos del trabajador'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Worker Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Editar Trabajador' : 'Contratar Trabajador (Ley 116)'}
        subtitle={`Salario mínimo legal exigido: ${formatCup(data.config.min_wage_cup)}/mes`}
      >
        <form onSubmit={saveWorker} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Nombre y apellidos</label>
              <input
                className="input-field"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Carné de Identidad (11 dígitos)</label>
              <input
                className="input-field font-mono"
                maxLength={11}
                placeholder="95041218345"
                value={form.ci}
                onChange={(e) => setForm({ ...form, ci: e.target.value.replace(/\D/g, '') })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Usuario de acceso</label>
              <input
                className="input-field font-mono"
                value={form.username}
                disabled={Boolean(editingId)}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {editingId ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}
              </label>
              <input
                type="password"
                className="input-field"
                placeholder={editingId ? 'Dejar vacío para mantener' : 'Por defecto: kiosko2026'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Puesto de trabajo</label>
              <select
                className="input-field"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="vendedor">Vendedor de Turno</option>
                <option value="almacenero">Almacenero</option>
                <option value="economico">Económico</option>
                <option value="jefe">Jefe del Negocio</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Tipo de contrato (Ley 116)</label>
              <select
                className="input-field"
                value={form.contract_type}
                onChange={(e) => setForm({ ...form, contract_type: e.target.value })}
              >
                <option value="Indeterminado">Tiempo Indeterminado</option>
                <option value="Determinado">Tiempo Determinado</option>
                <option value="Socio Administrador">Socio / Titular</option>
              </select>
            </div>
          </div>

          {form.role === 'vendedor' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg bg-[#FAF9F5] border border-[#E5E1D7] p-3">
              <div>
                <label className="block text-xs font-medium mb-1">Turno asignado</label>
                <select
                  className="input-field"
                  value={form.shift_template_id}
                  onChange={(e) => setForm({ ...form, shift_template_id: Number(e.target.value) })}
                >
                  {data.shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.start_time}–{s.end_time})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Caja asignada</label>
                <select
                  className="input-field"
                  value={form.default_register}
                  onChange={(e) => setForm({ ...form, default_register: Number(e.target.value) })}
                >
                  <option value={1}>Caja 1</option>
                  <option value={2}>Caja 2</option>
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Salario básico (CUP)</label>
              <input
                type="number"
                min={data.config.min_wage_cup}
                step="50"
                className="input-field tabular-nums"
                value={form.base_salary_cup}
                onChange={(e) => setForm({ ...form, base_salary_cup: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Estímulo ventas (%)</label>
              <input
                type="number"
                min="0"
                max="15"
                step="0.1"
                disabled={form.role !== 'vendedor'}
                className="input-field tabular-nums"
                value={form.role === 'vendedor' ? form.sales_commission_pct : 0}
                onChange={(e) => setForm({ ...form, sales_commission_pct: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Teléfono (+53)</label>
              <input
                className="input-field"
                placeholder="+53 5xxxxxxx"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          {editingId && editingId !== user.id && (
            <label className="flex items-center gap-2 text-xs text-[#3C4450]">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Trabajador activo en nómina y acceso al sistema
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-xs">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary text-xs">
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Registrar contrato'}
            </button>
          </div>
        </form>
      </Modal>

      {/* New Shift Modal */}
      <Modal
        open={shiftModal}
        onClose={() => setShiftModal(false)}
        title="Crear Nuevo Turno de Trabajo"
        subtitle="Cada turno habilita exactamente 2 plazas de vendedores (Caja 1 y Caja 2)"
      >
        <form onSubmit={saveShift} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium mb-1">Nombre del turno</label>
            <input
              className="input-field"
              placeholder="Ej. Turno Fin de Semana o Turno Noche"
              value={shiftForm.name}
              onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Hora de entrada</label>
              <input
                type="time"
                className="input-field"
                value={shiftForm.start_time}
                onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Hora de salida</label>
              <input
                type="time"
                className="input-field"
                value={shiftForm.end_time}
                onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShiftModal(false)} className="btn-secondary text-xs">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary text-xs">
              Crear turno (2 vendedores)
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
