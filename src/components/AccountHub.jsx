import React, { useState } from 'react';
import {
  ArrowRight,
  Building2,
  Check,
  Clock,
  Copy,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Store,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_META } from '../lib/format.js';

export default function AccountHub({
  account,
  memberships = [],
  onSelectCompany,
  onPreviewCatalog,
  onStartCreateCompany,
  onStartAffiliate,
  onRefreshAccount,
  onTryDemo,
  onLogout,
  notify,
}) {
  const [enteringId, setEnteringId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedCode, setCopiedCode] = useState('');

  const activeList = memberships.filter((m) => m.status === 'ACTIVO');
  const pendingList = memberships.filter((m) => m.status === 'PENDIENTE');
  const otherList = memberships.filter((m) => !['ACTIVO', 'PENDIENTE'].includes(m.status));

  async function enter(companyId) {
    setEnteringId(companyId);
    try {
      const res = await api.post('/api/platform/select-company', { company_id: companyId });
      onSelectCompany(res);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setEnteringId(null);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefreshAccount?.();
      notify('Estado de tus empresas actualizado.');
    } finally {
      setRefreshing(false);
    }
  }

  function copyCode(code) {
    navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    notify(`Código ${code} copiado al portapapeles.`);
    setTimeout(() => setCopiedCode(''), 2000);
  }

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col justify-between">
      <header className="border-b border-[#EAE4D9] bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#181715] text-[#FAF8F4]">
              <Store className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-bold text-[#181715]">
              Kiosko <span className="font-editorial italic font-normal text-lg text-[#C2542D]">Conecta</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-[#6E685F]">{account?.email}</span>
            <button
              type="button"
              onClick={onLogout}
              className="btn-secondary rounded-full py-1.5 px-3 text-xs"
            >
              <LogOut className="h-3.5 w-3.5" />
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-5 sm:px-8 py-12 space-y-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker">Tu cuenta · {account?.email}</p>
            <h1 className="mt-2 font-editorial text-4xl sm:text-5xl text-[#181715]">
              Hola, <em className="italic text-[#C2542D]">{account?.full_name?.split(' ')[0] || 'bienvenido'}.</em>
            </h1>
            <p className="mt-2 text-sm text-[#57534E]">
              {activeList.length > 0
                ? 'Elige a qué empresa entrar, crea un nuevo negocio o afíliate con un código.'
                : 'Elige cómo empezar: crea tu propia empresa o únete a una con el código del creador.'}
            </p>
          </div>

          {memberships.length > 0 && (
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="btn-secondary rounded-full text-xs py-2 px-3.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          )}
        </div>

        {/* Active companies */}
        {activeList.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#7A746B]">
              Mis empresas activas ({activeList.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeList.map((m) => {
                const roleMeta = ROLE_META[m.role] || ROLE_META.vendedor;
                const isOwner = Boolean(m.is_owner);
                return (
                  <div
                    key={m.membership_id}
                    className="card p-6 flex flex-col justify-between gap-5 hover:border-[#181715] transition"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F3EFE7] px-3 py-1 text-[11px] font-semibold text-[#181715]">
                          {isOwner ? 'Creador · Jefe' : roleMeta.label}
                        </span>
                        {isOwner && m.pending_affiliations > 0 && (
                          <span className="rounded-full bg-[#FBEEE8] px-2.5 py-0.5 text-[11px] font-semibold text-[#C2542D]">
                            {m.pending_affiliations} solicitud(es) nueva(s)
                          </span>
                        )}
                      </div>

                      <div>
                        <h3 className="text-lg font-bold text-[#181715]">{m.company_name}</h3>
                        <p className="text-xs text-[#6E685F]">
                          {m.business_type}
                          {m.municipality ? ` · ${m.municipality}, ${m.province}` : ''}
                        </p>
                      </div>

                      {isOwner && (
                        <div className="flex items-center justify-between rounded-xl bg-[#FAF8F4] border border-[#EAE4D9] px-3 py-2 text-xs">
                          <span className="text-[#7A746B]">
                            Código: <strong className="font-mono text-[#181715]">{m.company_code}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => copyCode(m.company_code)}
                            className="inline-flex items-center gap-1 font-semibold text-[#181715] hover:text-[#C2542D] cursor-pointer"
                          >
                            {copiedCode === m.company_code ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-[#15614B]" /> Copiado
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" /> Copiar
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={enteringId === m.company_id}
                        onClick={() => enter(m.company_id)}
                        className="btn-pill flex-1 py-2.5 text-sm"
                      >
                        {enteringId === m.company_id ? 'Abriendo...' : 'Abrir panel'}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                      {onPreviewCatalog && m.company_code && (
                        <button
                          type="button"
                          onClick={() => onPreviewCatalog(m.company_code)}
                          className="btn-secondary rounded-full py-2.5 px-3.5 text-xs"
                          title="Ver catálogo para clientes"
                        >
                          Catálogo
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Pending requests */}
        {pendingList.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#7A746B]">
              Afiliaciones en espera de aprobación
            </h2>
            <div className="space-y-2.5">
              {pendingList.map((m) => (
                <div
                  key={m.membership_id}
                  className="rounded-2xl border border-[#E5DED0] bg-[#F3EFE7] p-5 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="rounded-full bg-white p-2 text-[#C2542D]">
                      <Clock className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-[#181715]">{m.company_name}</p>
                      <p className="text-xs text-[#57534E]">
                        Solicitaste ingresar como <strong className="capitalize">{m.requested_role}</strong>{' '}
                        con el código <span className="font-mono">{m.company_code}</span>.
                      </p>
                      <p className="mt-1 text-[11px] text-[#7A746B]">
                        Cuando el creador de la empresa apruebe tu ingreso y te asigne tu puesto, aparecerá arriba lista para entrar.
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-white border border-[#DFD7C8] px-3 py-1 text-xs font-semibold text-[#C2542D]">
                    Pendiente
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {otherList.length > 0 && (
          <section className="space-y-2">
            {otherList.map((m) => (
              <div
                key={m.membership_id}
                className="rounded-xl border border-[#E7E1D6] bg-white px-4 py-3 flex items-center justify-between text-xs text-[#7A746B]"
              >
                <span>{m.company_name}</span>
                <span>{m.status === 'RECHAZADO' ? 'Solicitud no aprobada' : 'Acceso pausado'}</span>
              </div>
            ))}
          </section>
        )}

        {/* Two main actions: Create company or Affiliate */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#7A746B]">
            Sumar otra opción
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={onStartCreateCompany}
              className="rounded-3xl border border-[#E5DED0] bg-white p-6 text-left hover:border-[#181715] transition cursor-pointer group flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#181715] text-[#FAF8F4]">
                  <Plus className="h-5 w-5" />
                </span>
                <h3 className="text-lg font-bold text-[#181715] flex items-center gap-2">
                  Crear mi empresa
                  <ArrowRight className="h-4 w-4 text-[#9C958B] group-hover:text-[#181715] transition" />
                </h3>
                <p className="text-xs leading-relaxed text-[#57534E]">
                  Da de alta tu comercio, recibe tu código único <span className="font-mono">kiosko-ABC123</span> y
                  decide qué módulos, turnos y reglas quieres usar.
                </p>
              </div>
              <span className="text-xs font-semibold text-[#C2542D]">Configurar en 3 pasos →</span>
            </button>

            <button
              type="button"
              onClick={onStartAffiliate}
              className="rounded-3xl border border-[#E5DED0] bg-white p-6 text-left hover:border-[#181715] transition cursor-pointer group flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#F3EFE7] text-[#181715]">
                  <KeyRound className="h-5 w-5" />
                </span>
                <h3 className="text-lg font-bold text-[#181715] flex items-center gap-2">
                  Afiliarme a una empresa
                  <ArrowRight className="h-4 w-4 text-[#9C958B] group-hover:text-[#181715] transition" />
                </h3>
                <p className="text-xs leading-relaxed text-[#57534E]">
                  Ingresa el código que te compartió el dueño del local o una invitación directa para
                  incorporarte a su equipo de trabajo.
                </p>
              </div>
              <span className="text-xs font-semibold text-[#15614B]">Ingresar código →</span>
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#EAE4D9] py-5 px-5 text-center text-xs text-[#857F76]">
        ¿Quieres probar un negocio ya cargado con datos?{' '}
        <button
          type="button"
          onClick={onTryDemo}
          className="font-semibold text-[#181715] underline underline-offset-3 cursor-pointer"
        >
          Explorar empresa demo (Kiosko La Ceiba)
        </button>
      </footer>
    </div>
  );
}
