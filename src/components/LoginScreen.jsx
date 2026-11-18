import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Calculator,
  KeyRound,
  Package,
  ShieldCheck,
  ShoppingBag,
  Store,
  UserCheck,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_META } from '../lib/format.js';

const ROLE_ICON = {
  jefe: UserCheck,
  economico: Calculator,
  almacenero: Package,
  vendedor: ShoppingBag,
};

export default function LoginScreen({ onAuthenticated }) {
  const [preview, setPreview] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get('/api/auth/roles-preview')
      .then(setPreview)
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login', { username, password });
      onAuthenticated(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickEnter(user) {
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/quick-switch', { user_id: user.id });
      onAuthenticated(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const leaders = preview?.users?.filter((u) => u.role !== 'vendedor') || [];
  const sellers = preview?.users?.filter((u) => u.role === 'vendedor') || [];

  return (
    <div className="min-h-screen bg-[#F6F5F0] flex flex-col justify-between">
      <header className="border-b border-[#E3DFD5] bg-white/90">
        <div className="mx-auto max-w-6xl px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F5C4D] text-white">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-[#171C22]">
                {preview?.business_name || 'Gestor de Kiosko'}
              </h1>
              <p className="text-xs text-[#656E7B]">
                {preview?.legal_form === 'TCP' ? 'Trabajador por Cuenta Propia (DL 90/2024)' : 'Micro-MIPYME (DL 88/2024)'}
                {preview?.municipality ? ` · ${preview.municipality}, ${preview.province}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#0F5C4D]/20 bg-[#0F5C4D]/8 px-3 py-1 text-xs font-medium text-[#0F5C4D]">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>ONAT Ley 113 · BCC Res. 111/2023 · MFP Res. 225/2024 · NCIF</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <section className="lg:col-span-7 space-y-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-[#171C22]">
              Sistema automatizado por puestos de trabajo
            </h2>
            <p className="mt-1.5 text-sm text-[#525B68] leading-relaxed">
              Cada integrante opera su módulo con segregación de funciones (Res. 60/22): ventas en doble caja por turno,
              abastecimiento de almacén, contabilidad NCIF, bancarización y tributos ONAT en tiempo real.
            </p>
          </div>

          {preview?.demo_switch_enabled && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#66707D] mb-2.5">
                  Dirección, Economía y Almacén (Acceso directo)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {leaders.map((u) => {
                    const Icon = ROLE_ICON[u.role] || UserCheck;
                    const meta = ROLE_META[u.role];
                    return (
                      <button
                        key={u.id}
                        type="button"
                        disabled={loading}
                        onClick={() => handleQuickEnter(u)}
                        className="card p-3.5 text-left hover:border-[#0F5C4D] hover:shadow-sm transition group cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}>
                            <Icon className="h-3 w-3" />
                            {meta.short}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-[#9AA2AE] group-hover:text-[#0F5C4D] transition" />
                        </div>
                        <p className="mt-2.5 text-sm font-semibold text-[#171C22] leading-snug">{u.full_name}</p>
                        <p className="mt-1 text-[11px] text-[#66707D] leading-snug">{meta.description}</p>
                        <p className="mt-2 text-[11px] font-mono text-[#7C8592]">@{u.username}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#66707D] mb-2.5">
                  Vendedores — 2 por Turno (Caja 1 y Caja 2)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {sellers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      disabled={loading}
                      onClick={() => handleQuickEnter(u)}
                      className="card p-3.5 text-left hover:border-[#0F5C4D] hover:shadow-sm transition group cursor-pointer flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-semibold text-[#171C22]">{u.shift_name}</span>
                          <span className="rounded bg-[#F1EFE8] px-1.5 py-0.5 text-[11px] font-medium text-[#4A5360]">
                            Caja {u.default_register}
                          </span>
                          {u.active_register && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                              En turno
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm font-semibold text-[#171C22]">{u.full_name}</p>
                        <p className="text-[11px] text-[#66707D]">
                          Horario {u.start_time}–{u.end_time} · <span className="font-mono">@{u.username}</span>
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-[#9AA2AE] group-hover:text-[#0F5C4D]" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="lg:col-span-5">
          <div className="card p-6 shadow-xs">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="rounded-lg bg-[#F4F2EC] p-2 text-[#0F5C4D]">
                <KeyRound className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#171C22]">Ingreso con credenciales</h2>
                <p className="text-xs text-[#66707D]">Identificación individual para bitácora de auditoría</p>
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-[#3C4450] mb-1">Usuario</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ej. jefe, economico, almacenero, vendedor1"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3C4450] mb-1">Contraseña</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
                {loading ? 'Verificando acceso...' : 'Entrar al sistema'}
              </button>
            </form>

            <div className="mt-5 rounded-lg bg-[#F7F6F1] border border-[#E8E4DA] p-3 text-xs text-[#58616E] space-y-1">
              <p className="font-semibold text-[#2A313B]">Credenciales iniciales configuradas:</p>
              <p>
                Usuarios: <code className="font-mono text-[#0F5C4D]">jefe</code>,{' '}
                <code className="font-mono text-[#0F5C4D]">economico</code>,{' '}
                <code className="font-mono text-[#0F5C4D]">almacenero</code>,{' '}
                <code className="font-mono text-[#0F5C4D]">vendedor1</code>,{' '}
                <code className="font-mono text-[#0F5C4D]">vendedor2</code>
              </p>
              <p>
                Contraseña inicial: <code className="font-mono text-[#0F5C4D]">kiosko2026</code> (editable por el Jefe)
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E3DFD5] bg-white/70 py-3 px-5 text-center text-xs text-[#6F7885]">
        Moneda oficial de operación: Peso Cubano (CUP) · Parámetros tributarios y precios topados configurables conforme a la Gaceta Oficial de Cuba.
      </footer>
    </div>
  );
}
