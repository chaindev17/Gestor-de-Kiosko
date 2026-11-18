import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  KeyRound,
  Mail,
  Package,
  Pause,
  Play,
  QrCode,
  ShieldCheck,
  Sliders,
  Store,
  UserPlus,
  Users,
} from 'lucide-react';
import { PRESET_CARDS } from '../lib/modules.js';
import QrCodeBadge from './QrCodeBadge.jsx';

const DEMO_STEPS = [
  {
    num: 1,
    title: 'Creas tu empresa',
    sub: 'Con tu correo, en un minuto',
  },
  {
    num: 2,
    title: 'Se afilia tu equipo',
    sub: 'Ingresan tu código único',
  },
  {
    num: 3,
    title: 'Decides el manejo',
    sub: 'Módulos, turnos y permisos',
  },
  {
    num: 4,
    title: 'Todo cuadra solo',
    sub: 'Ventas, stock y cuentas al día',
  },
];

const INTENT_FILTERS = [
  { id: 'all', label: 'Ver todos' },
  { id: 'solo_dueno', label: 'Recién arranco solo' },
  { id: 'equipo_compacto', label: 'Tengo vendedores por turno' },
  { id: 'kiosko_completo', label: 'Quiero control fiscal y contable total' },
];

const FAQS = [
  {
    q: '¿Cómo funciona el registro con correo electrónico?',
    a: 'Creas tu cuenta con tu nombre, correo electrónico y contraseña. En ese mismo momento eliges si quieres crear una empresa nueva (quedando como creador y administrador) o afiliarte a una empresa existente con su código.',
  },
  {
    q: '¿Cómo se afilia un trabajador a mi empresa?',
    a: 'Al crear tu empresa recibes un código único con formato kiosko-ABC123 (y también puedes generar códigos directos para un correo y puesto específico). Tu trabajador se registra con su correo, escribe el código y tú apruebas su ingreso asignándole puesto, turno y caja.',
  },
  {
    q: '¿El creador puede decidir cómo usar el software y apagar lo que no necesite?',
    a: 'Sí, en cualquier momento. Desde el asistente inicial o desde "Mi Empresa y Modo" eliges qué módulos mostrar (POS, Turnos e IPV, Almacén, Precios, Bancarización QR, Tributos ONAT, Nómina, Contabilidad y Cumplimiento), cuántas cajas por turno usar, si tú mismo cobras en caja y qué permisos tiene cada rol.',
  },
  {
    q: '¿Puedo empezar simple y activar más módulos después?',
    a: 'Exactamente. Puedes arrancar en modo "Mostrador Ágil" operando tú solo con caja y stock, y cuando sumes vendedores, almacenero o económico activas los demás módulos con un toque sin perder ni un solo dato.',
  },
  {
    q: '¿Una misma cuenta de correo puede crear o afiliarse a varias empresas?',
    a: 'Sí. Cada empresa tiene sus datos, inventario, ventas y contabilidad completamente separados. Desde "Mis empresas" cambias de un local a otro en un segundo o te afilias a un nuevo negocio con su código.',
  },
  {
    q: '¿Incluye las reglas económicas, bancarización, precios topados y contabilidad?',
    a: 'Sí: soporta Micro-MIPYME (DL 88/2024) y TCP (DL 90/2024), cobros QR (Transfermóvil y EnZona), control de efectivo (Res. 111/2023 BCC), fichas de costo y precios topados (MFP), tributos ONAT (Ley 113), nómina (Ley 116), modelos de almacén SC y contabilidad NCIF. Y tú decides cuáles reglas aplicar como bloqueo estricto o de forma flexible.',
  },
];

export default function ConectaLanding({
  onStartRegister,
  onStartLogin,
  onStartAffiliate,
  onTryDemo,
  demoLoading = false,
}) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [quickName, setQuickName] = useState('');
  const [intent, setIntent] = useState('all');
  const [openFaq, setOpenFaq] = useState(0);
  const [previewMods, setPreviewMods] = useState({
    pos: true,
    warehouse: true,
    banking: true,
    pricing: true,
    onat: true,
    accounting: false,
  });

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => {
      setStep((prev) => (prev + 1) % DEMO_STEPS.length);
    }, 4200);
    return () => clearInterval(t);
  }, [playing]);

  function handleQuickCreate(e) {
    e.preventDefault();
    onStartRegister({
      intent: 'create',
      businessName: quickName.trim(),
      preset: 'kiosko_completo',
    });
  }

  return (
    <div className="min-h-screen bg-[#FAF8F4] text-[#181715]">
      {/* Sticky editorial navbar */}
      <header className="sticky top-0 z-40 border-b border-[#EAE4D9]/90 bg-[#FAF8F4]/90 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <a href="#inicio" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#181715] text-[#FAF8F4]">
              <Store className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-bold tracking-tight text-[#181715]">
              Kiosko <span className="font-editorial italic font-normal text-lg text-[#C2542D]">Conecta</span>
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-[13.5px] font-medium text-[#57534E]">
            <a href="#como-funciona" className="hover:text-[#181715] transition">
              Cómo funciona
            </a>
            <a href="#dia-a-dia" className="hover:text-[#181715] transition">
              En tu día a día
            </a>
            <a href="#elegir" className="hover:text-[#181715] transition">
              Modos de manejo
            </a>
            <a href="#preguntas" className="hover:text-[#181715] transition">
              Preguntas
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onStartAffiliate()}
              className="hidden sm:inline-flex text-[13px] font-medium text-[#57534E] hover:text-[#181715] px-2.5 py-1.5 cursor-pointer"
            >
              Afiliarme
            </button>
            <button
              type="button"
              onClick={onStartLogin}
              className="rounded-full border border-[#D8D1C3] bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[#181715] hover:bg-[#F3EFE7] transition cursor-pointer"
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => onStartRegister({ intent: 'create' })}
              className="rounded-full bg-[#181715] px-4 py-1.5 text-[13px] font-semibold text-[#FAF8F4] hover:bg-[#2E2C28] transition cursor-pointer"
            >
              Crear cuenta
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="inicio" className="mx-auto max-w-6xl px-5 sm:px-8 pt-12 pb-14 lg:pt-18 lg:pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left editorial copy */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#E5DED0] bg-[#F3EFE7] px-3.5 py-1 text-xs font-medium text-[#57534E]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#C2542D]" />
              Para kioscos, almacenes y comercios con equipo
            </div>

            <h1 className="font-editorial text-[46px] sm:text-[58px] lg:text-[64px] leading-[0.98] text-[#181715]">
              Pon tu negocio{' '}
              <em className="italic text-[#C2542D]">en orden y a tu manera.</em>
            </h1>

            <p className="text-[16px] sm:text-[17px] leading-relaxed text-[#57534E] max-w-xl">
              Te registras con tu correo electrónico, creas tu empresa o te afilias a una con su
              código.{' '}
              <strong className="font-semibold text-[#181715]">
                El creador decide cómo manejar el software, qué módulos activar y qué hace cada
                persona.
              </strong>
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onStartRegister({ intent: 'create' })}
                className="btn-pill"
              >
                Crear mi empresa
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onStartAffiliate()}
                className="btn-pill-outline"
              >
                <KeyRound className="h-4 w-4 text-[#C2542D]" />
                Afiliarme con código
              </button>
            </div>

            <p className="text-xs leading-relaxed text-[#857F76]">
              Registro con tu email · Sin instalar nada · ¿Ya tienes cuenta?{' '}
              <button
                type="button"
                onClick={onStartLogin}
                className="font-semibold text-[#181715] underline underline-offset-3 hover:text-[#C2542D] cursor-pointer"
              >
                Entrar a mi panel
              </button>{' '}
              · ¿Quieres verlo funcionando?{' '}
              <button
                type="button"
                disabled={demoLoading}
                onClick={onTryDemo}
                className="font-semibold text-[#181715] underline underline-offset-3 hover:text-[#C2542D] cursor-pointer"
              >
                {demoLoading ? 'Abriendo demo...' : 'Probar demo en vivo'}
              </button>
            </p>
          </div>

          {/* Right interactive 4-step Conecta showcase */}
          <div className="lg:col-span-6">
            <div className="rounded-[28px] border border-[#E5DED0] bg-[#F3EFE7] p-5 sm:p-6 shadow-[0_18px_50px_-28px_rgba(24,23,21,0.22)]">
              {/* Stage top bar */}
              <div className="flex items-center justify-between text-[11px] text-[#7A746B] mb-4">
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#181715]">
                  <span className="h-2 w-2 rounded-full bg-[#15614B]" />
                  Kiosko La Unión · Panel en vivo
                </span>
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  className="inline-flex items-center gap-1 rounded-full border border-[#DDD5C6] bg-white/80 px-2.5 py-1 text-[11px] font-medium text-[#57534E] hover:text-[#181715] cursor-pointer"
                >
                  {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {playing ? 'Pausar demostración' : 'Reanudar'}
                </button>
              </div>

              {/* Dynamic visual canvas */}
              <div className="rounded-2xl border border-[#E7E1D6] bg-white p-5 min-h-[256px] flex flex-col justify-between">
                {step === 0 && (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#C2542D]">
                          Paso 1 · Creador registrado
                        </p>
                        <h3 className="mt-1 text-lg font-bold text-[#181715]">Kiosko La Unión</h3>
                        <p className="text-xs text-[#6E685F]">camila@launion.com · Micro-MIPYME</p>
                      </div>
                      <QrCodeBadge value="kiosko-UNI482" size={64} className="p-1.5 rounded-xl" />
                    </div>
                    <div className="rounded-xl bg-[#FAF8F4] border border-[#EAE4D9] p-3.5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] text-[#857F76]">Código único para afiliar tu equipo</p>
                        <p className="mt-0.5 font-mono text-base font-bold tracking-tight text-[#181715]">
                          kiosko-UNI482
                        </p>
                      </div>
                      <span className="rounded-full bg-[#181715] px-3 py-1 text-[11px] font-semibold text-white">
                        Listo para compartir
                      </span>
                    </div>
                    <p className="text-xs text-[#6E685F]">
                      Tu empresa queda aislada con su propio inventario, cajas y reglas desde el primer minuto.
                    </p>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-3.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#C2542D]">
                        Paso 2 · Solicitud con kiosko-UNI482
                      </p>
                      <h3 className="mt-1 text-lg font-bold text-[#181715]">
                        Tu equipo entra con su correo
                      </h3>
                    </div>
                    <div className="rounded-xl border border-[#E7E1D6] bg-[#FAF8F4] p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-[#181715]">Lucía Fernández</p>
                          <p className="text-xs text-[#6E685F]">lucia.f@correo.com · Solicita Vendedora</p>
                        </div>
                        <span className="rounded-full bg-[#FBEEE8] px-2.5 py-0.5 text-[11px] font-semibold text-[#C2542D]">
                          Nueva
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#EAE4D9]">
                        <span className="text-xs text-[#57534E]">
                          Asignar: <strong>Turno Mañana · Caja 1</strong>
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#15614B] px-3 py-1 text-[11px] font-semibold text-white">
                          <Check className="h-3 w-3" /> Aprobar ingreso
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#6E685F] px-1">
                      <span>Mateo Silva · Almacenero</span>
                      <span className="font-semibold text-[#15614B]">Activo ✓</span>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#C2542D]">
                          Paso 3 · El creador decide todo
                        </p>
                        <h3 className="mt-0.5 text-lg font-bold text-[#181715]">
                          Prende solo lo que uses
                        </h3>
                      </div>
                      <span className="text-[11px] text-[#857F76]">Toca para probar</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ['pos', 'Mostrador y POS'],
                        ['warehouse', 'Almacén y Stock'],
                        ['banking', 'Cobros QR y Banco'],
                        ['pricing', 'Precios y Tablilla'],
                        ['onat', 'Tributos ONAT'],
                        ['accounting', 'Contabilidad NCIF'],
                      ].map(([k, label]) => {
                        const on = previewMods[k];
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => {
                              setPlaying(false);
                              if (k !== 'pos') {
                                setPreviewMods((m) => ({ ...m, [k]: !m[k] }));
                              }
                            }}
                            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-medium transition cursor-pointer ${
                              on
                                ? 'border-[#181715] bg-[#181715] text-white'
                                : 'border-[#E7E1D6] bg-[#FAF8F4] text-[#6E685F]'
                            }`}
                          >
                            <span className="truncate">{label}</span>
                            <span
                              className={`h-2 w-2 rounded-full shrink-0 ${
                                on ? 'bg-[#6EE7B7]' : 'bg-[#CFC8B9]'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-[#6E685F]">
                      El menú de cada afiliado se adapta al instante según lo que actives.
                    </p>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#15614B]">
                          Paso 4 · Jornada en marcha
                        </p>
                        <h3 className="mt-0.5 text-lg font-bold text-[#181715]">
                          Turno Mañana · 2 cajas activas
                        </h3>
                      </div>
                      <span className="rounded-full bg-[#E7F3EE] px-2.5 py-1 text-[11px] font-semibold text-[#15614B]">
                        En regla 100%
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                      <div className="rounded-xl bg-[#FAF8F4] border border-[#EAE4D9] p-3">
                        <p className="text-[11px] text-[#857F76]">Ventas hoy</p>
                        <p className="mt-1 text-sm font-bold tabular-nums">$ 28,450</p>
                      </div>
                      <div className="rounded-xl bg-[#FAF8F4] border border-[#EAE4D9] p-3">
                        <p className="text-[11px] text-[#857F76]">Cobros QR</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-[#15614B]">64%</p>
                      </div>
                      <div className="rounded-xl bg-[#FAF8F4] border border-[#EAE4D9] p-3">
                        <p className="text-[11px] text-[#857F76]">Stock bajo</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-[#C2542D]">Auto-pedido</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#EAE4D9] px-3.5 py-2.5 flex items-center justify-between text-xs">
                      <span className="text-[#57534E]">Arqueo, IPV y asientos del día</span>
                      <span className="font-semibold text-[#181715]">Cuadrados al instante ✓</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 4 clickable step indicators just like Conecta */}
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DEMO_STEPS.map((s, idx) => {
                  const active = idx === step;
                  return (
                    <button
                      key={s.num}
                      type="button"
                      onClick={() => {
                        setStep(idx);
                        setPlaying(false);
                      }}
                      className={`rounded-xl p-2.5 text-left transition cursor-pointer border ${
                        active
                          ? 'bg-white border-[#181715] shadow-xs'
                          : 'bg-transparent border-transparent hover:bg-white/60'
                      }`}
                    >
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                          active ? 'bg-[#181715] text-white' : 'bg-[#E2DBD0] text-[#57534E]'
                        }`}
                      >
                        {s.num}
                      </span>
                      <p className="mt-1.5 text-xs font-semibold text-[#181715] leading-tight">
                        {s.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#7A746B] leading-tight">{s.sub}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Conecta-style inline quick launcher bar */}
        <div className="mt-12 rounded-3xl border border-[#E7E1D6] bg-white p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5 shadow-[0_6px_24px_-16px_rgba(24,23,21,0.14)]">
          <div className="max-w-sm">
            <p className="text-sm font-bold text-[#181715]">
              Empieza ahora con el nombre de tu comercio
            </p>
            <p className="mt-0.5 text-xs text-[#7A746B]">
              Lo configuras con tu correo y recibes tu código de afiliación al instante.
            </p>
          </div>
          <form
            onSubmit={handleQuickCreate}
            className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 max-w-xl"
          >
            <input
              type="text"
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
              placeholder="Ej. Kiosko El Sol, Panadería La Unión..."
              className="flex-1 rounded-full border border-[#D8D1C3] bg-[#FAF8F4] px-4 py-2.5 text-sm text-[#181715] placeholder:text-[#9C958B] focus:outline-none focus:border-[#181715] focus:bg-white"
            />
            <button type="submit" className="btn-pill py-2.5 px-5 text-sm shrink-0">
              Crear mi empresa
            </button>
          </form>
          <button
            type="button"
            onClick={() => onStartAffiliate()}
            className="text-xs font-semibold text-[#57534E] hover:text-[#181715] underline underline-offset-3 text-left lg:text-right shrink-0 cursor-pointer"
          >
            Ya tengo código kiosko-ABC123
          </button>
        </div>
      </section>

      {/* Cómo funciona — Tres pasos */}
      <section id="como-funciona" className="border-y border-[#EAE4D9] bg-[#F3EFE7]/75 py-18">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="kicker">Cómo funciona</p>
          <h2 className="mt-2 font-editorial text-4xl sm:text-5xl text-[#181715]">
            Tres <em className="italic text-[#C2542D]">pasos.</em>
          </h2>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                num: '1',
                icon: Mail,
                title: 'Te registras con tu correo',
                body: 'Una sola cuenta con tu email y contraseña. Sin trámites largos ni instalaciones en la computadora.',
              },
              {
                num: '2',
                icon: UserPlus,
                title: 'Creas tu empresa o te afilias',
                body: 'Si eres el dueño, creas tu negocio y obtienes tu código kiosko-ABC123. Si trabajas allí, ingresas ese código para sumarte.',
              },
              {
                num: '3',
                icon: Sliders,
                title: 'El creador marca las reglas',
                body: 'Eliges qué módulos encender, cuántas cajas abrir por turno, cómo aprobar afiliados y qué puede hacer cada puesto.',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.num} className="rounded-3xl border border-[#E5DED0] bg-white p-7 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-editorial text-3xl text-[#C2542D]">{item.num}</span>
                    <span className="rounded-full bg-[#F3EFE7] p-2.5 text-[#181715]">
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-[#181715]">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-[#57534E]">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* En tu día a día */}
      <section id="dia-a-dia" className="mx-auto max-w-6xl px-5 sm:px-8 py-18">
        <p className="kicker">En tu día a día</p>
        <h2 className="mt-2 font-editorial text-4xl sm:text-5xl text-[#181715]">
          Menos libretas sueltas. <em className="italic text-[#C2542D]">Más control.</em>
        </h2>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              icon: QrCode,
              title: 'Cobras en efectivo o con QR al toque',
              desc: 'Caja ágil con Transfermóvil, EnZona, pago mixto, bonificación automática y comprobante listo para imprimir.',
            },
            {
              icon: Package,
              title: 'El almacén te avisa antes de quedarte sin nada',
              desc: 'Cada venta descuenta del mostrador, alerta vencimientos FEFO y genera el pedido de reposición solo.',
            },
            {
              icon: Users,
              title: 'Cada persona ve solo lo que le toca',
              desc: 'Vendedores en sus cajas, almacenero en stock, económico en cuentas y tú con la vista completa del negocio.',
            },
            {
              icon: ShieldCheck,
              title: 'Precios, impuestos y cuentas sin dolores',
              desc: 'Fichas de costo, tablilla de precios, nómina, tributos ONAT y asientos contables calculados al instante.',
            },
          ].map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="card p-6 space-y-3 hover:border-[#CFC7B8] transition">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#F3EFE7] text-[#181715]">
                  <Icon className="h-4 w-4" />
                </div>
                <h3 className="text-[15px] font-bold leading-snug text-[#181715]">{f.title}</h3>
                <p className="text-xs leading-relaxed text-[#656058]">{f.desc}</p>
              </div>
            );
          })}
        </div>

        {/* Conecta storytelling example strip */}
        <div className="mt-10 card-warm p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-md space-y-1.5">
            <p className="kicker">Un ejemplo real</p>
            <h3 className="text-lg font-bold text-[#181715]">
              Un mismo gestor que cambia cuando tu negocio cambia.
            </h3>
            <p className="text-sm text-[#57534E]">
              Lo ajustas desde tu panel de creador en segundos, sin volver a cargar productos ni cuentas.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 max-w-xl">
            <div className="rounded-2xl bg-white border border-[#E7E1D6] p-4">
              <p className="text-[11px] font-semibold text-[#857F76]">Primer mes</p>
              <p className="mt-1 text-sm font-bold text-[#181715]">1 caja · Dueño en mostrador</p>
              <p className="mt-1 text-xs text-[#656058]">Solo ventas, stock y lista de precios.</p>
            </div>
            <div className="rounded-2xl bg-white border border-[#E7E1D6] p-4">
              <p className="text-[11px] font-semibold text-[#C2542D]">Cuando creces</p>
              <p className="mt-1 text-sm font-bold text-[#181715]">2 turnos · Equipo afiliado</p>
              <p className="mt-1 text-xs text-[#656058]">
                Sumas vendedores, almacén, económico y contabilidad.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Elige cómo manejar tu empresa */}
      <section id="elegir" className="border-t border-[#EAE4D9] bg-[#F3EFE7]/75 py-18">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="kicker">Configura tu empresa</p>
          <h2 className="mt-2 font-editorial text-4xl sm:text-5xl text-[#181715]">
            ¿Cómo quieres <em className="italic text-[#C2542D]">manejar el software?</em>
          </h2>
          <p className="mt-3 text-sm text-[#57534E] max-w-2xl">
            Elige un punto de partida al crear tu empresa.{' '}
            <strong className="text-[#181715]">
              Los tres incluyen tu código único de afiliación y puedes cambiar módulos o permisos
              cuando quieras.
            </strong>
          </p>

          {/* Filter pills inspired by Conecta */}
          <div className="mt-6 flex flex-wrap gap-2">
            {INTENT_FILTERS.map((f) => {
              const active = intent === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setIntent(f.id)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    active
                      ? 'bg-[#181715] text-white'
                      : 'bg-white border border-[#DDD5C6] text-[#57534E] hover:text-[#181715]'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* 3 Conecta-style option cards */}
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
            {PRESET_CARDS.map((card) => {
              const highlighted = intent === card.id || (intent === 'all' && card.featured);
              const dimmed = intent !== 'all' && intent !== card.id;
              return (
                <div
                  key={card.id}
                  className={`rounded-3xl bg-white p-7 flex flex-col justify-between transition border ${
                    highlighted
                      ? 'border-[#181715] ring-1 ring-[#181715] shadow-md'
                      : 'border-[#E5DED0]'
                  } ${dimmed ? 'opacity-65 hover:opacity-100' : ''}`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#C2542D]">
                        {card.tag}
                      </span>
                      {card.featured && (
                        <span className="rounded-full bg-[#F3EFE7] px-2.5 py-0.5 text-[11px] font-semibold text-[#181715]">
                          Más completo
                        </span>
                      )}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-[#181715]">{card.headline}</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-[#57534E]">{card.summary}</p>
                    </div>
                    <p className="rounded-2xl bg-[#FAF8F4] border border-[#EDE7DC] px-3.5 py-2.5 text-xs text-[#656058]">
                      <strong className="text-[#181715]">Ideal para:</strong> {card.ideal}
                    </p>
                    <div className="pt-2 border-t border-[#EFEAE0]">
                      <p className="font-editorial text-3xl text-[#181715]">{card.name}</p>
                      <p className="text-[11px] text-[#857F76]">Editable siempre desde tu panel</p>
                    </div>
                    <ul className="space-y-2 pt-1">
                      {card.highlights.map((h) => (
                        <li key={h} className="flex items-start gap-2 text-xs text-[#3F3C37]">
                          <Check className="h-3.5 w-3.5 text-[#15614B] shrink-0 mt-0.5" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={() => onStartRegister({ intent: 'create', preset: card.id })}
                    className={`mt-7 w-full rounded-full py-3 px-4 text-sm font-semibold transition cursor-pointer flex items-center justify-center gap-2 ${
                      highlighted
                        ? 'bg-[#181715] text-white hover:bg-[#2F2D28]'
                        : 'bg-[#F3EFE7] text-[#181715] hover:bg-[#E7E0D3]'
                    }`}
                  >
                    Empezar con {card.name}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Two clear secondary strips: Custom + Affiliate */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-[#E5DED0] bg-white p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-[#C2542D]">A medida</p>
                <p className="mt-0.5 text-sm font-bold text-[#181715]">
                  ¿Quieres armar tu propia combinación?
                </p>
                <p className="text-xs text-[#656058]">
                  Elige uno por uno los módulos, turnos, cajas y permisos por cargo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onStartRegister({ intent: 'create', preset: 'a_medida' })}
                className="btn-secondary rounded-full shrink-0 text-xs"
              >
                Personalizar →
              </button>
            </div>

            <div className="rounded-2xl border border-[#E5DED0] bg-white p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-[#15614B]">Para integrantes del equipo</p>
                <p className="mt-0.5 text-sm font-bold text-[#181715]">
                  ¿Te invitaron a una empresa ya creada?
                </p>
                <p className="text-xs text-[#656058]">
                  Ingresa el código <span className="font-mono font-semibold">kiosko-ABC123</span> con tu correo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onStartAffiliate()}
                className="btn-secondary rounded-full shrink-0 text-xs"
              >
                Ingresar código →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Preguntas frecuentes */}
      <section id="preguntas" className="mx-auto max-w-3xl px-5 sm:px-8 py-18">
        <p className="kicker">Preguntas</p>
        <h2 className="mt-2 font-editorial text-4xl sm:text-5xl text-[#181715]">
          Preguntas <em className="italic text-[#C2542D]">frecuentes.</em>
        </h2>

        <div className="mt-8 divide-y divide-[#E7E1D6] border-y border-[#E7E1D6]">
          {FAQS.map((item, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div key={item.q}>
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? -1 : idx)}
                  className="w-full py-5 flex items-center justify-between gap-4 text-left cursor-pointer group"
                >
                  <span className="text-[15px] font-semibold text-[#181715] group-hover:text-[#C2542D] transition">
                    {item.q}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-[#857F76] shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-[#181715]' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <p className="pb-5 pr-8 text-sm leading-relaxed text-[#57534E]">{item.a}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Editorial closing callout */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 pb-16">
        <div className="rounded-[32px] bg-[#181715] text-[#FAF8F4] px-7 py-12 sm:px-12 sm:py-16 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="max-w-xl space-y-3">
            <h2 className="font-editorial text-4xl sm:text-5xl leading-tight">
              Tu comercio, tu equipo, <em className="italic text-[#E89574]">tus reglas.</em>
            </h2>
            <p className="text-sm text-[#C7C1B7] leading-relaxed">
              Regístrate con tu correo en menos de un minuto para crear tu empresa o afiliarte al
              local donde trabajas.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onStartRegister({ intent: 'create' })}
              className="inline-flex items-center gap-2 rounded-full bg-[#FAF8F4] px-6 py-3 text-sm font-semibold text-[#181715] hover:bg-[#EFEAE0] transition cursor-pointer"
            >
              Crear mi cuenta
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onStartAffiliate()}
              className="inline-flex items-center gap-2 rounded-full border border-white/25 px-5 py-3 text-sm font-semibold text-[#FAF8F4] hover:bg-white/10 transition cursor-pointer"
            >
              Afiliarme con código
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#EAE4D9] py-6 px-5 sm:px-8">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#857F76]">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#181715]">Kiosko Conecta</span>
            <span>· Gestión multi-empresa configurable</span>
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={onStartLogin}
              className="hover:text-[#181715] cursor-pointer"
            >
              Entrar al panel
            </button>
            <button
              type="button"
              onClick={() => onStartAffiliate()}
              className="hover:text-[#181715] cursor-pointer"
            >
              Activar afiliación
            </button>
            <button
              type="button"
              onClick={onTryDemo}
              className="hover:text-[#181715] cursor-pointer"
            >
              Ver empresa demo
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
