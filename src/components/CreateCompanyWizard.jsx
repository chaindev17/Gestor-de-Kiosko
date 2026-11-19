import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Share2,
  Sparkles,
  Store,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { AUTOMATION_RULES, MODULE_CATALOG, PRESET_CARDS } from '../lib/modules.js';
import QrCodeBadge from './QrCodeBadge.jsx';

const BUSINESS_TYPES = [
  'Kiosko y Comercio Minorista',
  'Almacén / Bodega de Barrio',
  'Cafetería / Gastronomía Ligera',
  'Panadería y Confitura',
  'Minipunto / Mercado',
  'Tienda y Servicios',
];

export default function CreateCompanyWizard({
  account,
  initialBusinessName = '',
  initialPreset = 'kiosko_completo',
  onBack,
  onCreated,
  notify,
}) {
  const startCard =
    PRESET_CARDS.find((c) => c.id === initialPreset) || PRESET_CARDS[2];

  const [step, setStep] = useState(1); // 1: Negocio, 2: Equipo y manejo, 3: Módulos y reglas, 4: Éxito con código
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdPayload, setCreatedPayload] = useState(null);
  const [copied, setCopied] = useState(false);

  // Step 1: Business details
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0]);
  const [legalForm, setLegalForm] = useState('MIPYME');
  const [municipality, setMunicipality] = useState('');
  const [province, setProvince] = useState('');
  const [nit, setNit] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState(account?.phone || '');
  const [seedCatalog, setSeedCatalog] = useState('starter');

  // Step 2: How the creator wants to organize team & shifts
  const [preset, setPreset] = useState(
    ['solo_dueno', 'equipo_compacto', 'kiosko_completo', 'a_medida'].includes(initialPreset)
      ? initialPreset
      : 'kiosko_completo'
  );
  const [shiftMode, setShiftMode] = useState(startCard.defaults.shift_mode);
  const [maxSellers, setMaxSellers] = useState(startCard.defaults.max_sellers_per_shift);
  const [joinMode, setJoinMode] = useState('APPROVAL');
  const [pettyCash, setPettyCash] = useState(3000);
  const [socialCapital, setSocialCapital] = useState(150000);

  // Step 3: Active modules & rules
  const [modules, setModules] = useState({ ...startCard.defaults.modules });
  const [rules, setRules] = useState({
    owner_can_operate_pos: startCard.defaults.owner_can_operate_pos,
    flexible_role_limits: startCard.defaults.flexible_role_limits,
    require_cuban_ci: startCard.defaults.require_cuban_ci,
    auto_restock_enabled: startCard.defaults.auto_restock_enabled,
    auto_accounting_enabled: startCard.defaults.auto_accounting_enabled,
    auto_deposit_order_enabled: startCard.defaults.auto_deposit_order_enabled,
    strict_price_cap_block: startCard.defaults.strict_price_cap_block,
    strict_bancarizacion_block: startCard.defaults.strict_bancarizacion_block,
  });

  function selectPreset(id) {
    setPreset(id);
    const card = PRESET_CARDS.find((c) => c.id === id);
    if (!card) return;
    setShiftMode(card.defaults.shift_mode);
    setMaxSellers(card.defaults.max_sellers_per_shift);
    setModules({ ...card.defaults.modules });
    setRules({
      owner_can_operate_pos: card.defaults.owner_can_operate_pos,
      flexible_role_limits: card.defaults.flexible_role_limits,
      require_cuban_ci: card.defaults.require_cuban_ci,
      auto_restock_enabled: card.defaults.auto_restock_enabled,
      auto_accounting_enabled: card.defaults.auto_accounting_enabled,
      auto_deposit_order_enabled: card.defaults.auto_deposit_order_enabled,
      strict_price_cap_block: card.defaults.strict_price_cap_block,
      strict_bancarizacion_block: card.defaults.strict_bancarizacion_block,
    });
  }

  function toggleModule(key) {
    if (key === 'pos') return;
    setPreset('a_medida');
    setModules((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleRule(key) {
    setPreset('a_medida');
    setRules((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleCreate() {
    setError('');
    setSaving(true);
    try {
      const res = await api.post('/api/platform/companies', {
        business_name: businessName.trim(),
        business_type: businessType,
        legal_form: legalForm,
        municipality: municipality.trim() || 'Centro',
        province: province.trim() || 'La Habana',
        nit: nit.trim(),
        whatsapp_phone: whatsappPhone.trim(),
        seed_catalog: seedCatalog,
        management_preset: preset,
        shift_mode: shiftMode,
        max_sellers_per_shift: Number(maxSellers),
        join_mode: joinMode,
        petty_cash_fund_cup: Number(pettyCash),
        social_capital_cup: Number(socialCapital),
        modules,
        ...rules,
      });
      setCreatedPayload(res);
      setStep(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function buildShareLink(code) {
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}?codigo=${encodeURIComponent(code)}`;
  }

  function handleCopyCode() {
    const code = createdPayload?.active_company?.company_code;
    if (!code) return;
    navigator.clipboard?.writeText(code);
    setCopied(true);
    notify?.(`Código ${code} copiado.`);
    setTimeout(() => setCopied(false), 2200);
  }

  function handleShareWhatsApp() {
    const comp = createdPayload?.active_company;
    if (!comp) return;
    const text = `Hola! Te invito a afiliarte a "${comp.name}" en Kiosko Conecta.\n\nCódigo de empresa: ${comp.company_code}\nEnlace directo: ${buildShareLink(comp.company_code)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col justify-between px-5 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-3xl flex items-center justify-between">
        {step < 4 ? (
          <button
            type="button"
            onClick={() => (step === 1 ? onBack() : setStep((s) => s - 1))}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#57534E] hover:text-[#181715] cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {step === 1 ? 'Volver' : 'Paso anterior'}
          </button>
        ) : (
          <span className="text-xs font-semibold text-[#15614B]">Empresa activada ✓</span>
        )}

        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#181715] text-[#FAF8F4]">
            <Store className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-bold text-[#181715]">
            Kiosko <span className="font-editorial italic font-normal text-base text-[#C2542D]">Conecta</span>
          </span>
        </div>
      </div>

      <main className="mx-auto w-full max-w-3xl py-8">
        {step < 4 && (
          <div className="flex items-center gap-2 mb-6">
            {[
              [1, 'Tu empresa'],
              [2, 'Equipo y turnos'],
              [3, 'Módulos y reglas'],
            ].map(([n, label]) => (
              <div key={n} className="flex items-center gap-2">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    step >= n ? 'bg-[#181715] text-white' : 'bg-[#E5DED0] text-[#7A746B]'
                  }`}
                >
                  {step > n ? <Check className="h-3.5 w-3.5" /> : n}
                </span>
                <span
                  className={`text-xs font-semibold ${
                    step === n ? 'text-[#181715]' : 'text-[#857F76] hidden sm:inline'
                  }`}
                >
                  {label}
                </span>
                {n < 3 && <span className="w-6 h-px bg-[#DDD5C6]" />}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            {error}
          </div>
        )}

        {/* STEP 1: Datos de tu negocio */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <p className="kicker">Paso 1 de 3 · Creador: {account?.email}</p>
              <h1 className="mt-1.5 font-editorial text-4xl sm:text-5xl text-[#181715]">
                Cuéntanos de <em className="italic text-[#C2542D]">tu empresa.</em>
              </h1>
              <p className="mt-2 text-sm text-[#57534E]">
                Solo lo esencial para arrancar. Todo lo podrás editar cuando quieras desde tu panel.
              </p>
            </div>

            <div className="card p-6 sm:p-8 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    Nombre comercial de tu empresa o local *
                  </label>
                  <input
                    type="text"
                    className="input-field text-base"
                    placeholder="Ej. Kiosko La Unión"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    Tipo de comercio
                  </label>
                  <select
                    className="input-field"
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                  >
                    {BUSINESS_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    Forma jurídica
                  </label>
                  <select
                    className="input-field"
                    value={legalForm}
                    onChange={(e) => setLegalForm(e.target.value)}
                  >
                    <option value="MIPYME">Micro-MIPYME / S.U.R.L. (DL 88/2024)</option>
                    <option value="TCP">Cuenta Propia / Unipersonal (DL 90/2024)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    Municipio / Barrio
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Ej. Plaza, Centro, Pocitos..."
                    value={municipality}
                    onChange={(e) => setMunicipality(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    Provincia / Departamento
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Ej. La Habana, Santiago, Montevideo..."
                    value={province}
                    onChange={(e) => setProvince(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    NIT / Identificación fiscal <span className="font-normal text-[#857F76]">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Lo puedes completar luego"
                    value={nit}
                    onChange={(e) => setNit(e.target.value)}
                  />
                </div>

                <div className="sm:col-span-2 rounded-2xl bg-[#EDF7ED] border border-[#C6E4C6] p-4">
                  <label className="block text-xs font-bold text-[#18261C] mb-1">
                    WhatsApp donde recibirás los pedidos de tus clientes{' '}
                    <span className="font-normal text-[#386B46]">(con código de país)</span>
                  </label>
                  <input
                    type="tel"
                    className="input-field bg-white"
                    placeholder="Ej: +598 99 123 456  o  +53 5 284 9102"
                    value={whatsappPhone}
                    onChange={(e) => setWhatsappPhone(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] text-[#2F5D3C]">
                    Tu empresa incluye un catálogo digital: el cliente elige sus productos y el pedido te llega armado a este WhatsApp.
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-[#EFEAE0]">
                <label className="block text-xs font-semibold text-[#3F3C37] mb-2">
                  ¿Cómo prefieres iniciar tu catálogo de productos?
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSeedCatalog('starter')}
                    className={`rounded-2xl border p-3.5 text-left transition cursor-pointer ${
                      seedCatalog === 'starter'
                        ? 'border-[#181715] bg-[#F3EFE7]'
                        : 'border-[#E7E1D6] hover:bg-[#FAF8F4]'
                    }`}
                  >
                    <p className="text-xs font-bold text-[#181715]">
                      Con productos de ejemplo editables
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#656058]">
                      Ideal para probar ventas y stock desde el primer segundo.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSeedCatalog('empty')}
                    className={`rounded-2xl border p-3.5 text-left transition cursor-pointer ${
                      seedCatalog === 'empty'
                        ? 'border-[#181715] bg-[#F3EFE7]'
                        : 'border-[#E7E1D6] hover:bg-[#FAF8F4]'
                    }`}
                  >
                    <p className="text-xs font-bold text-[#181715]">Totalmente en blanco</p>
                    <p className="mt-0.5 text-[11px] text-[#656058]">
                      Cargas tú mismo (o tu almacenero) tus propios productos y precios.
                    </p>
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!businessName.trim()) {
                      setError('Escribe el nombre de tu empresa para continuar.');
                      return;
                    }
                    setError('');
                    setStep(2);
                  }}
                  className="btn-pill"
                >
                  Elegir manejo de equipo
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Cómo quiere manejar el equipo y turnos */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <p className="kicker">Paso 2 de 3 · Organización</p>
              <h1 className="mt-1.5 font-editorial text-4xl sm:text-5xl text-[#181715]">
                ¿Cómo quieres <em className="italic text-[#C2542D]">organizar tu equipo?</em>
              </h1>
              <p className="mt-2 text-sm text-[#57534E]">
                Elige un modo base y ajusta turnos, cantidad de cajas y cómo se afilian tus trabajadores.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PRESET_CARDS.map((c) => {
                const active = preset === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectPreset(c.id)}
                    className={`rounded-2xl border p-4 text-left transition cursor-pointer ${
                      active
                        ? 'border-[#181715] bg-[#181715] text-[#FAF8F4]'
                        : 'border-[#E5DED0] bg-white text-[#181715] hover:bg-[#F3EFE7]'
                    }`}
                  >
                    <p
                      className={`text-[10px] font-semibold uppercase tracking-wider ${
                        active ? 'text-[#E89574]' : 'text-[#C2542D]'
                      }`}
                    >
                      {c.tag}
                    </p>
                    <p className="mt-1 text-base font-bold">{c.name}</p>
                    <p
                      className={`mt-1 text-[11px] leading-snug ${
                        active ? 'text-[#CFC8BC]' : 'text-[#656058]'
                      }`}
                    >
                      {c.summary}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="card p-6 sm:p-8 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    Esquema de turnos diarios
                  </label>
                  <select
                    className="input-field"
                    value={shiftMode}
                    onChange={(e) => setShiftMode(e.target.value)}
                  >
                    <option value="single">1 Turno Único (08:00 a 20:00)</option>
                    <option value="double">2 Turnos: Mañana y Tarde (07:00–15:00 / 15:00–23:00)</option>
                    <option value="triple">3 Turnos / 24 horas (Mañana, Tarde y Noche)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    Cajas / vendedores simultáneos por turno
                  </label>
                  <select
                    className="input-field"
                    value={maxSellers}
                    onChange={(e) => setMaxSellers(Number(e.target.value))}
                  >
                    <option value={1}>1 caja por turno</option>
                    <option value={2}>2 cajas por turno (Caja 1 y Caja 2)</option>
                    <option value={3}>3 cajas por turno</option>
                    <option value={4}>4 cajas por turno</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                    Política cuando alguien usa tu código
                  </label>
                  <select
                    className="input-field"
                    value={joinMode}
                    onChange={(e) => setJoinMode(e.target.value)}
                  >
                    <option value="APPROVAL">Con mi aprobación (yo asigno el puesto)</option>
                    <option value="AUTO">Ingreso directo (se afilian al instante)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                      Fondo de caja
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      className="input-field tabular-nums"
                      value={pettyCash}
                      onChange={(e) => setPettyCash(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#3F3C37] mb-1.5">
                      Capital inicial
                    </label>
                    <input
                      type="number"
                      min="10000"
                      step="5000"
                      className="input-field tabular-nums"
                      value={socialCapital}
                      onChange={(e) => setSocialCapital(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="btn-secondary rounded-full"
                >
                  Atrás
                </button>
                <button type="button" onClick={() => setStep(3)} className="btn-pill">
                  Elegir módulos y reglas
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Módulos y automatizaciones */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <p className="kicker">Paso 3 de 3 · A tu medida</p>
              <h1 className="mt-1.5 font-editorial text-4xl sm:text-5xl text-[#181715]">
                Decide qué <em className="italic text-[#C2542D]">módulos y reglas</em> usar.
              </h1>
              <p className="mt-2 text-sm text-[#57534E]">
                Activa solo lo que te sirva hoy. Podrás encender o apagar cualquiera cuando quieras desde tu panel.
              </p>
            </div>

            <div className="card p-6 sm:p-7 space-y-5">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#7A746B] mb-3">
                  Módulos del software ({Object.values(modules).filter(Boolean).length} de {MODULE_CATALOG.length} activos)
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {MODULE_CATALOG.map((m) => {
                    const active = Boolean(modules[m.key]);
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => toggleModule(m.key)}
                        className={`rounded-2xl border p-3.5 text-left transition flex items-start justify-between gap-3 ${
                          m.locked ? 'cursor-default' : 'cursor-pointer'
                        } ${
                          active
                            ? 'border-[#181715] bg-[#FAF8F4]'
                            : 'border-[#E7E1D6] bg-white opacity-65 hover:opacity-100'
                        }`}
                      >
                        <div>
                          <p className="text-xs font-bold text-[#181715]">{m.label}</p>
                          <p className="mt-0.5 text-[11px] text-[#656058] leading-snug">{m.short}</p>
                        </div>
                        <span
                          className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
                            active ? 'bg-[#181715] justify-end' : 'bg-[#DDD5C6] justify-start'
                          }`}
                        >
                          <span className="h-4 w-4 rounded-full bg-white" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-[#EFEAE0]">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#7A746B] mb-3">
                  Reglas y automatizaciones
                </h2>
                <div className="space-y-2">
                  {AUTOMATION_RULES.map((r) => {
                    const on = Boolean(rules[r.key]);
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => toggleRule(r.key)}
                        className="w-full rounded-xl border border-[#EAE4D9] bg-white hover:bg-[#FAF8F4] px-4 py-3 flex items-center justify-between gap-4 text-left cursor-pointer transition"
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

              <div className="flex items-center justify-between pt-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="btn-secondary rounded-full"
                >
                  Atrás
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleCreate}
                  className="btn-pill"
                >
                  <Sparkles className="h-4 w-4" />
                  {saving ? 'Creando tu empresa...' : 'Crear mi empresa ahora'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Conecta-style Company + Customer Catalog Ready Cards */}
        {step === 4 && createdPayload && (
          <div className="max-w-3xl mx-auto space-y-6 text-center">
            <div>
              <p className="kicker text-[#15614B]">Todo listo</p>
              <h1 className="mt-2 font-editorial text-4xl sm:text-5xl text-[#181715]">
                {createdPayload.active_company.name}{' '}
                <em className="italic text-[#C2542D]">ya está en marcha.</em>
              </h1>
              <p className="mt-2 text-sm text-[#57534E]">
                Ya tienes listo tu catálogo para recibir pedidos al WhatsApp y tu código para sumar empleados.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
              {/* Card A: Customer WhatsApp Catalog */}
              <div className="rounded-3xl border-2 border-[#15614B] bg-white p-6 shadow-sm space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <span className="inline-flex rounded-full bg-[#E6F5EF] text-[#15614B] px-3 py-1 text-[11px] font-bold">
                    🛍️ Para tus clientes
                  </span>
                  <div className="flex justify-center">
                    <QrCodeBadge
                      value={`${window.location.origin}${window.location.pathname}?tienda=${encodeURIComponent(
                        createdPayload.active_company.company_code
                      )}`}
                      size={112}
                    />
                  </div>
                  <div>
                    <p className="text-base font-bold text-[#181715]">Catálogo con pedido a WhatsApp</p>
                    <p className="mt-0.5 text-xs text-[#6E685F]">
                      El cliente elige sus productos, arma el pedido y te llega listo a tu WhatsApp.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}${window.location.pathname}?tienda=${encodeURIComponent(
                        createdPayload.active_company.company_code
                      )}`;
                      navigator.clipboard?.writeText(url);
                      notify?.('¡Link del catálogo copiado!');
                    }}
                    className="btn-secondary rounded-full text-xs py-2 px-3.5"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copiar link
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const comp = createdPayload.active_company;
                      const url = `${window.location.origin}${window.location.pathname}?tienda=${encodeURIComponent(
                        comp.company_code
                      )}`;
                      const msg = `¡Hola! 👋 Mira el catálogo de *${comp.name}*, arma tu pedido y envíamelo por aquí:\n${url}`;
                      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#1DA851] hover:bg-[#178F44] text-white text-xs font-bold px-3.5 py-2 cursor-pointer"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Compartir catálogo
                  </button>
                </div>
              </div>

              {/* Card B: Team Affiliation Code */}
              <div className="rounded-3xl border border-[#181715] bg-white p-6 shadow-sm space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <span className="inline-flex rounded-full bg-[#F3EFE7] text-[#181715] px-3 py-1 text-[11px] font-bold">
                    👥 Para tu equipo
                  </span>
                  <div className="flex justify-center">
                    <QrCodeBadge
                      value={buildShareLink(createdPayload.active_company.company_code)}
                      size={112}
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#857F76]">
                      Código de afiliación
                    </p>
                    <p className="mt-0.5 font-mono text-2xl font-bold tracking-tight text-[#181715]">
                      {createdPayload.active_company.company_code}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="btn-secondary rounded-full text-xs py-2 px-3.5"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#15614B]" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copiar código
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleShareWhatsApp}
                    className="btn-secondary rounded-full text-xs py-2 px-3.5"
                  >
                    <Share2 className="h-3.5 w-3.5 text-[#15614B]" />
                    Invitar equipo
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onCreated(createdPayload)}
              className="btn-pill px-8 py-3.5 text-base"
            >
              Entrar al panel de mi empresa
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </main>

      <div className="text-center text-[11px] text-[#9C958B]">
        Puedes modificar módulos, turnos, cajas y permisos en cualquier momento
      </div>
    </div>
  );
}
