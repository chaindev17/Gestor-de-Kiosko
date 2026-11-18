import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  Search,
  Store,
  UserPlus,
} from 'lucide-react';
import { api } from '../lib/api.js';

const ROLE_OPTIONS = [
  { id: 'vendedor', label: 'Vendedor / Mostrador', hint: 'Atención en caja y ventas del turno' },
  { id: 'almacenero', label: 'Almacenero', hint: 'Recepciones, stock y pases al mostrador' },
  { id: 'economico', label: 'Económico / Contador', hint: 'Precios, banco, nómina y tributos' },
];

export default function AuthFlow({
  initialMode = 'login', // 'login' | 'register' | 'affiliate' | 'forgot'
  initialIntent = 'create', // 'create' | 'affiliate'
  initialBusinessName = '',
  initialCode = '',
  account = null, // present when signed-in user opens 'affiliate' from AccountHub
  onBack,
  onAuthComplete, // (payload, nextAction?: 'create_wizard' | 'affiliate' | 'hub') => void
  onTryDemo,
}) {
  const [mode, setMode] = useState(initialMode);
  const [intent, setIntent] = useState(initialIntent);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Account fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');

  // Affiliate fields
  const [code, setCode] = useState(initialCode || '');
  const [lookup, setLookup] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [requestedRole, setRequestedRole] = useState('vendedor');
  const [ci, setCi] = useState('');
  const [note, setNote] = useState('');

  // Password recovery fields
  const [recoveryStep, setRecoveryStep] = useState(1);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryPreview, setRecoveryPreview] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    setMode(initialMode);
    setError('');
    setInfo('');
  }, [initialMode]);

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      verifyCode(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  async function verifyCode(rawCode) {
    const target = String(rawCode ?? code).trim();
    if (!target) return;
    setError('');
    setLookingUp(true);
    try {
      const res = await api.get(`/api/platform/lookup-code?code=${encodeURIComponent(target)}`);
      setLookup(res);
      setCode(res.code);
      if (res.invite?.role) setRequestedRole(res.invite.role);
      if (res.invite?.target_email && !email) setEmail(res.invite.target_email);
    } catch (err) {
      setLookup(null);
      setError(err.message);
    } finally {
      setLookingUp(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/api/platform/login', { email, password });
      onAuthComplete(res, res.user ? null : 'hub');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/api/platform/register', {
        full_name: fullName,
        email,
        password,
        phone,
      });
      onAuthComplete(res, intent === 'affiliate' ? 'affiliate' : 'create_wizard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAffiliate(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = {
        code,
        requested_role: lookup?.invite?.role || requestedRole,
        ci,
        phone,
        note,
        ...(account
          ? {}
          : {
              full_name: fullName,
              email,
              password,
            }),
      };
      const res = await api.post('/api/platform/affiliate', payload);
      onAuthComplete(res, res.joined && res.user ? null : 'hub');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotStep1(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await api.post('/api/platform/forgot-password', { email });
      setRecoveryPreview(res.verification_code_preview || '');
      setRecoveryStep(2);
      setInfo('Ingresa el código de verificación de 6 dígitos y elige tu nueva contraseña.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotStep2(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/api/platform/reset-password', {
        email,
        code: recoveryCode,
        new_password: newPassword,
      });
      setMode('login');
      setRecoveryStep(1);
      setRecoveryCode('');
      setRecoveryPreview('');
      setPassword('');
      setInfo(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col justify-between px-5 py-6 sm:px-8">
      {/* Top minimal bar inspired by conecta.simplemente.com.uy/panel/ */}
      <div className="mx-auto w-full max-w-4xl flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#57534E] hover:text-[#181715] cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {account ? 'Volver a mis empresas' : 'Volver al inicio'}
        </button>

        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#181715] text-[#FAF8F4]">
            <Store className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-bold text-[#181715]">
            Kiosko <span className="font-editorial italic font-normal text-base text-[#C2542D]">Conecta</span>
          </span>
        </div>
      </div>

      {/* Centered auth card */}
      <main className="mx-auto w-full max-w-md py-10">
        {mode === 'login' && (
          <div className="space-y-6">
            <div>
              <p className="kicker">Panel Kiosko Conecta</p>
              <h1 className="mt-2 font-editorial text-4xl sm:text-[44px] leading-none text-[#181715]">
                Entra a <em className="italic text-[#C2542D]">tu panel.</em>
              </h1>
              <p className="mt-2 text-sm text-[#656058]">
                Accede con tu correo electrónico a tu empresa o a los comercios donde estás afiliado.
              </p>
            </div>

            <div className="card p-6 sm:p-7 space-y-4">
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                  {error}
                </div>
              )}
              {info && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
                  {info}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    className="input-field"
                    placeholder="tunombre@correo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[#3F3C37]">Contraseña</label>
                    <button
                      type="button"
                      onClick={() => {
                        setError('');
                        setInfo('');
                        setMode('forgot');
                      }}
                      className="text-xs text-[#7A746B] hover:text-[#181715] cursor-pointer"
                    >
                      Olvidé mi contraseña
                    </button>
                  </div>
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

                <button type="submit" disabled={loading} className="btn-pill w-full py-3">
                  {loading ? 'Entrando...' : 'Entrar'}
                </button>
              </form>

              <div className="pt-3 border-t border-[#EFEAE0] space-y-2 text-center text-xs text-[#6E685F]">
                <p>
                  ¿Primera vez?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setMode('register');
                    }}
                    className="font-semibold text-[#181715] underline underline-offset-3 hover:text-[#C2542D] cursor-pointer"
                  >
                    Crea tu cuenta con tu correo
                  </button>
                </p>
                <p>
                  ¿Te pasaron un código de empresa?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setMode('affiliate');
                    }}
                    className="font-semibold text-[#181715] underline underline-offset-3 hover:text-[#C2542D] cursor-pointer"
                  >
                    Ingresar código
                  </button>
                </p>
              </div>
            </div>

            {onTryDemo && (
              <p className="text-center text-xs text-[#857F76]">
                ¿Solo quieres explorar antes de registrarte?{' '}
                <button
                  type="button"
                  onClick={onTryDemo}
                  className="font-semibold text-[#181715] underline underline-offset-3 cursor-pointer"
                >
                  Abrir empresa demo
                </button>
              </p>
            )}
          </div>
        )}

        {mode === 'register' && (
          <div className="space-y-6">
            <div>
              <p className="kicker">Registro por correo</p>
              <h1 className="mt-2 font-editorial text-4xl sm:text-[44px] leading-none text-[#181715]">
                Crea tu <em className="italic text-[#C2542D]">cuenta.</em>
              </h1>
              <p className="mt-2 text-sm text-[#656058]">
                {initialBusinessName
                  ? `Preparamos todo para "${initialBusinessName}". Completa tu correo para continuar.`
                  : 'Elige si vas a crear tu propia empresa o afiliarte a una ya existente.'}
              </p>
            </div>

            {/* Two-path selector */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setIntent('create')}
                className={`rounded-2xl border p-3.5 text-left transition cursor-pointer ${
                  intent === 'create'
                    ? 'border-[#181715] bg-[#181715] text-[#FAF8F4]'
                    : 'border-[#E5DED0] bg-white text-[#181715] hover:bg-[#F3EFE7]'
                }`}
              >
                <Building2 className="h-4 w-4 mb-1.5" />
                <p className="text-xs font-bold">Crear mi empresa</p>
                <p
                  className={`mt-0.5 text-[11px] leading-snug ${
                    intent === 'create' ? 'text-[#CFC8BC]' : 'text-[#7A746B]'
                  }`}
                >
                  Seré el creador y configuraré el manejo
                </p>
              </button>

              <button
                type="button"
                onClick={() => setIntent('affiliate')}
                className={`rounded-2xl border p-3.5 text-left transition cursor-pointer ${
                  intent === 'affiliate'
                    ? 'border-[#181715] bg-[#181715] text-[#FAF8F4]'
                    : 'border-[#E5DED0] bg-white text-[#181715] hover:bg-[#F3EFE7]'
                }`}
              >
                <UserPlus className="h-4 w-4 mb-1.5" />
                <p className="text-xs font-bold">Afiliarme a una</p>
                <p
                  className={`mt-0.5 text-[11px] leading-snug ${
                    intent === 'affiliate' ? 'text-[#CFC8BC]' : 'text-[#7A746B]'
                  }`}
                >
                  Tengo el código de mi lugar de trabajo
                </p>
              </button>
            </div>

            <div className="card p-6 sm:p-7 space-y-4">
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                  {error}
                </div>
              )}

              <form onSubmit={handleRegister} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                    Nombre y apellido
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Ej. Camila Rodríguez"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    className="input-field"
                    placeholder="camila@correo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                    Contraseña <span className="font-normal text-[#857F76]">(mínimo 6 caracteres)</span>
                  </label>
                  <input
                    type="password"
                    className="input-field"
                    placeholder="Elige una contraseña segura"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                    Teléfono / WhatsApp <span className="font-normal text-[#857F76]">(opcional)</span>
                  </label>
                  <input
                    type="tel"
                    className="input-field"
                    placeholder="Ej. +53 5300 0000 o +598 99 000 000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>

                <button type="submit" disabled={loading} className="btn-pill w-full py-3 mt-1">
                  {loading
                    ? 'Creando tu cuenta...'
                    : intent === 'create'
                    ? 'Continuar y configurar mi empresa'
                    : 'Continuar e ingresar código'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>

              <p className="pt-3 border-t border-[#EFEAE0] text-center text-xs text-[#6E685F]">
                ¿Ya tienes una cuenta?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setMode('login');
                  }}
                  className="font-semibold text-[#181715] underline underline-offset-3 cursor-pointer"
                >
                  Entrar a tu panel
                </button>
              </p>
            </div>
          </div>
        )}

        {mode === 'affiliate' && (
          <div className="space-y-6">
            <div>
              <p className="kicker">Afiliación a empresa</p>
              <h1 className="mt-2 font-editorial text-4xl sm:text-[44px] leading-none text-[#181715]">
                Ingresa el código <em className="italic text-[#C2542D]">de la empresa.</em>
              </h1>
              <p className="mt-2 text-sm text-[#656058]">
                Te lo comparte el creador del negocio o viene en tu invitación. Se ve así:{' '}
                <span className="font-mono font-semibold text-[#181715]">kiosko-ABC123</span>.
              </p>
            </div>

            <div className="card p-6 sm:p-7 space-y-4">
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                  {error}
                </div>
              )}

              <form onSubmit={handleAffiliate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    Código de afiliación
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="input-field font-mono text-sm tracking-wide"
                      placeholder="kiosko-ABC123"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value);
                        if (lookup) setLookup(null);
                      }}
                      required
                    />
                    <button
                      type="button"
                      disabled={lookingUp || !code.trim()}
                      onClick={() => verifyCode(code)}
                      className="btn-secondary shrink-0 px-3.5 text-xs"
                    >
                      <Search className="h-3.5 w-3.5" />
                      {lookingUp ? '...' : 'Verificar'}
                    </button>
                  </div>
                </div>

                {lookup?.valid && (
                  <div className="rounded-2xl border border-[#15614B]/30 bg-[#E7F3EE] p-4 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#15614B]">
                      <CheckCircle2 className="h-4 w-4" />
                      {lookup.kind === 'invite'
                        ? 'Invitación directa verificada (ingreso inmediato)'
                        : 'Empresa encontrada'}
                    </div>
                    <p className="text-sm font-bold text-[#181715]">{lookup.company.name}</p>
                    <p className="text-xs text-[#4C5C54]">
                      {lookup.company.business_type}
                      {lookup.company.municipality
                        ? ` · ${lookup.company.municipality}, ${lookup.company.province}`
                        : ''}
                    </p>
                    {lookup.kind === 'invite' && (
                      <p className="text-xs font-semibold text-[#181715] pt-1">
                        Puesto asignado por el creador:{' '}
                        <span className="capitalize">{lookup.invite.role}</span>
                        {lookup.invite.label ? ` · ${lookup.invite.label}` : ''}
                      </p>
                    )}
                  </div>
                )}

                {lookup?.kind !== 'invite' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                      ¿A qué puesto te incorporas?
                    </label>
                    <div className="space-y-1.5">
                      {ROLE_OPTIONS.map((r) => (
                        <label
                          key={r.id}
                          className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs cursor-pointer transition ${
                            requestedRole === r.id
                              ? 'border-[#181715] bg-[#FAF8F4] font-semibold'
                              : 'border-[#E7E1D6] hover:bg-[#FAF8F4]'
                          }`}
                        >
                          <div>
                            <p className="text-[#181715] font-semibold">{r.label}</p>
                            <p className="text-[11px] text-[#7A746B] font-normal">{r.hint}</p>
                          </div>
                          <input
                            type="radio"
                            name="requested_role"
                            value={r.id}
                            checked={requestedRole === r.id}
                            onChange={() => setRequestedRole(r.id)}
                            className="accent-[#181715]"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {!account ? (
                  <div className="pt-2 border-t border-[#EFEAE0] space-y-3">
                    <p className="text-xs font-semibold text-[#57534E]">
                      Tus datos de acceso por correo
                    </p>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Tu nombre y apellido"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                    <input
                      type="email"
                      className="input-field"
                      placeholder="Tu correo electrónico"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                    <input
                      type="password"
                      className="input-field"
                      placeholder="Crea tu contraseña (mín. 6 caracteres)"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={6}
                      required
                    />
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#FAF8F4] border border-[#EAE4D9] px-3.5 py-2.5 text-xs text-[#57534E]">
                    Te afiliarás como <strong className="text-[#181715]">{account.full_name}</strong> (
                    {account.email}).
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    className="input-field text-xs"
                    placeholder="Documento / CI (opcional)"
                    value={ci}
                    onChange={(e) => setCi(e.target.value)}
                  />
                  <input
                    type="text"
                    className="input-field text-xs"
                    placeholder="Nota al creador (opcional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>

                <button type="submit" disabled={loading} className="btn-pill w-full py-3">
                  <KeyRound className="h-4 w-4" />
                  {loading
                    ? 'Procesando afiliación...'
                    : lookup?.kind === 'invite' || lookup?.company?.join_mode === 'AUTO'
                    ? 'Unirme y entrar a la empresa'
                    : 'Solicitar afiliación'}
                </button>
              </form>

              {!account && (
                <p className="pt-3 border-t border-[#EFEAE0] text-center text-xs text-[#6E685F]">
                  ¿Todavía no tienes empresa?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setIntent('create');
                      setMode('register');
                    }}
                    className="font-semibold text-[#181715] underline underline-offset-3 cursor-pointer"
                  >
                    Crea la tuya aquí
                  </button>
                </p>
              )}
            </div>
          </div>
        )}

        {mode === 'forgot' && (
          <div className="space-y-6">
            <div>
              <p className="kicker">Recuperar acceso</p>
              <h1 className="mt-2 font-editorial text-4xl leading-none text-[#181715]">
                Restablece tu <em className="italic text-[#C2542D]">contraseña.</em>
              </h1>
            </div>

            <div className="card p-6 sm:p-7 space-y-4">
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                  {error}
                </div>
              )}
              {info && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
                  {info}
                </div>
              )}
              {recoveryPreview && (
                <div className="rounded-xl border border-[#E5DED0] bg-[#F3EFE7] px-3.5 py-2.5 text-xs text-[#3F3C37]">
                  Código de verificación generado:{' '}
                  <strong className="font-mono text-sm text-[#181715]">{recoveryPreview}</strong>
                </div>
              )}

              {recoveryStep === 1 ? (
                <form onSubmit={handleForgotStep1} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                      Correo electrónico de tu cuenta
                    </label>
                    <input
                      type="email"
                      className="input-field"
                      placeholder="tunombre@correo.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" disabled={loading} className="btn-pill w-full py-3">
                    {loading ? 'Generando código...' : 'Obtener código de recuperación'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleForgotStep2} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                      Código de 6 dígitos
                    </label>
                    <input
                      type="text"
                      className="input-field font-mono tracking-widest"
                      placeholder="123456"
                      value={recoveryCode}
                      onChange={(e) => setRecoveryCode(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#3F3C37] mb-1">
                      Nueva contraseña
                    </label>
                    <input
                      type="password"
                      className="input-field"
                      placeholder="Mínimo 6 caracteres"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      minLength={6}
                      required
                    />
                  </div>
                  <button type="submit" disabled={loading} className="btn-pill w-full py-3">
                    {loading ? 'Guardando...' : 'Guardar nueva contraseña'}
                  </button>
                </form>
              )}

              <p className="pt-2 text-center text-xs text-[#6E685F]">
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setInfo('');
                    setRecoveryStep(1);
                    setMode('login');
                  }}
                  className="font-semibold text-[#181715] underline underline-offset-3 cursor-pointer"
                >
                  Volver a iniciar sesión
                </button>
              </p>
            </div>
          </div>
        )}
      </main>

      <div className="text-center text-[11px] text-[#9C958B]">
        Datos aislados por empresa · Cada integrante accede con su propio correo
      </div>
    </div>
  );
}
