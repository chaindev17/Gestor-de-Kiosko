import { Router } from 'express';
import { getDb } from '../db.js';
import {
  COOKIE_NAME,
  buildSystemBadges,
  logAudit,
  resolveSessionContext,
  sanitizeUser,
  setSessionCookie,
  signSession,
  verifyPassword,
} from '../auth.js';
import { getConfig, runComplianceAudit } from '../cubanLawEngine.js';
import {
  getAccountMemberships,
  getCompanyDb,
  getDemoCompany,
  getPlatformDb,
  normalizeEmail,
  sanitizeAccount,
} from '../platform.js';

const router = Router();

function formatCompanySummary(c) {
  if (!c) return null;
  return {
    id: c.id,
    company_code: c.company_code,
    name: c.name,
    business_type: c.business_type,
    legal_form: c.legal_form,
    municipality: c.municipality,
    province: c.province,
    is_demo: Boolean(c.is_demo),
    join_mode: c.join_mode,
    owner_account_id: c.owner_account_id,
  };
}

router.get('/roles-preview', (req, res) => {
  const ctx = resolveSessionContext(req);
  const company = ctx?.company || getDemoCompany();
  const db = ctx?.tenantDb || getDb();
  const config = getConfig(db);

  // Only expose quick role preview on the demo company or when creator/owner is previewing their own company
  const allowQuickSwitch =
    process.env.KIOSKO_DISABLE_DEMO_SWITCH !== '1' &&
    (Boolean(company?.is_demo) || ctx?.user?.role === 'jefe');

  const users = allowQuickSwitch
    ? db
        .prepare(
          `SELECT u.id, u.username, u.email, u.full_name, u.role, u.default_register,
                  st.name AS shift_name, st.code AS shift_code, st.start_time, st.end_time,
                  (SELECT sr.register_number FROM shift_registers sr
                   JOIN shift_sessions ss ON ss.id = sr.shift_session_id
                   WHERE sr.seller_id = u.id AND sr.status = 'ABIERTA' AND ss.status = 'ABIERTO'
                   LIMIT 1) AS active_register
           FROM users u
           LEFT JOIN shift_templates st ON st.id = u.shift_template_id
           WHERE u.active = 1
           ORDER BY CASE u.role
             WHEN 'jefe' THEN 1
             WHEN 'economico' THEN 2
             WHEN 'almacenero' THEN 3
             WHEN 'vendedor' THEN 4
           END, u.shift_template_id, u.default_register, u.id`
        )
        .all()
    : [];

  res.json({
    business_name: config?.business_name || 'Gestor de Kiosko',
    company_code: company?.company_code || config?.company_code || 'kiosko-CEIBA1',
    is_demo: Boolean(company?.is_demo),
    legal_form: config?.legal_form || 'MIPYME',
    municipality: config?.municipality || '',
    province: config?.province || '',
    demo_switch_enabled: allowQuickSwitch,
    users,
  });
});

router.post('/login', (req, res) => {
  const { username, email, password } = req.body || {};
  const identifier = String(email || username || '').trim();
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Ingresa tu correo electrónico (o usuario) y contraseña.' });
  }

  // 1. If identifier looks like an email, authenticate against platform accounts first
  if (identifier.includes('@')) {
    const pdb = getPlatformDb();
    const cleanEmail = normalizeEmail(identifier);
    const acc = pdb.prepare('SELECT * FROM accounts WHERE email = ?').get(cleanEmail);
    if (!acc || !verifyPassword(password, acc.password_hash)) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    const safeAcc = sanitizeAccount(acc);
    const memberships = getAccountMemberships(acc.id);
    const activeNonDemo = memberships.find((m) => m.status === 'ACTIVO' && !m.is_demo);
    const primary = activeNonDemo || memberships.find((m) => m.status === 'ACTIVO') || null;

    if (primary && primary.tenant_user_id) {
      const cdb = getCompanyDb(primary.company_id);
      const tUser = cdb
        .prepare(
          `SELECT u.*, st.name AS shift_name, st.code AS shift_code, st.start_time, st.end_time
           FROM users u
           LEFT JOIN shift_templates st ON st.id = u.shift_template_id
           WHERE u.id = ? AND u.active = 1`
        )
        .get(primary.tenant_user_id);
      if (tUser) {
        const company = pdb.prepare('SELECT * FROM companies WHERE id = ?').get(primary.company_id);
        const token = signSession({ aid: acc.id, cid: company.id, uid: tUser.id });
        setSessionCookie(res, token);
        const safeUser = sanitizeUser(tUser);
        logAudit(cdb, safeUser, 'INICIO_SESION', 'Acceso', `Ingreso por correo (${acc.email}) como ${safeUser.role}.`);
        return res.json({
          token,
          account: safeAcc,
          memberships,
          active_company: formatCompanySummary(company),
          user: safeUser,
          config: getConfig(cdb),
          badges: buildSystemBadges(cdb, company.id, runComplianceAudit),
        });
      }
    }

    const token = signSession({ aid: acc.id, cid: null, uid: null });
    setSessionCookie(res, token);
    return res.json({
      token,
      account: safeAcc,
      memberships,
      active_company: null,
      user: null,
      config: null,
      badges: {},
    });
  }

  // 2. Direct username login against default demo company (preserves backward-compatibility & demo flow)
  const demoCompany = getDemoCompany();
  const db = demoCompany ? getCompanyDb(demoCompany.id) : getDb();
  const user = db
    .prepare(
      `SELECT u.*, st.name AS shift_name, st.code AS shift_code, st.start_time, st.end_time
       FROM users u
       LEFT JOIN shift_templates st ON st.id = u.shift_template_id
       WHERE lower(u.username) = lower(?) AND u.active = 1`
    )
    .get(identifier);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas o usuario inactivo.' });
  }

  const token = signSession({ aid: null, cid: demoCompany?.id || null, uid: user.id });
  setSessionCookie(res, token);
  const cfg = getConfig(db);
  const safe = sanitizeUser(user, cfg);
  logAudit(db, safe, 'INICIO_SESION', 'Acceso', `Ingreso al sistema como ${safe.role}.`);

  return res.json({
    token,
    account: null,
    memberships: [],
    active_company: formatCompanySummary(demoCompany),
    user: safe,
    config: cfg,
    badges: buildSystemBadges(db, demoCompany?.id, runComplianceAudit),
  });
});

router.post('/quick-switch', (req, res) => {
  if (process.env.KIOSKO_DISABLE_DEMO_SWITCH === '1') {
    return res.status(403).json({ error: 'El cambio rápido de perfil está deshabilitado.' });
  }
  const ctx = resolveSessionContext(req);
  const { user_id, username, demo } = req.body || {};

  // Use demo company if explicitly requested or not inside an active company
  const targetCompany =
    demo || !ctx?.company ? getDemoCompany() : ctx.company;
  if (!targetCompany) {
    return res.status(404).json({ error: 'Empresa de demostración no disponible.' });
  }

  // Only permit switching roles inside the demo company or if current account owns targetCompany
  const isOwnerPreview =
    ctx?.account && Number(targetCompany.owner_account_id) === Number(ctx.account.id);
  if (!targetCompany.is_demo && !isOwnerPreview) {
    return res.status(403).json({
      error: 'En empresas reales cada integrante ingresa con su propio correo electrónico.',
    });
  }

  const db = getCompanyDb(targetCompany.id);
  const user = user_id
    ? db
        .prepare(
          `SELECT u.*, st.name AS shift_name, st.code AS shift_code, st.start_time, st.end_time
           FROM users u
           LEFT JOIN shift_templates st ON st.id = u.shift_template_id
           WHERE u.id = ? AND u.active = 1`
        )
        .get(Number(user_id))
    : db
        .prepare(
          `SELECT u.*, st.name AS shift_name, st.code AS shift_code, st.start_time, st.end_time
           FROM users u
           LEFT JOIN shift_templates st ON st.id = u.shift_template_id
           WHERE lower(u.username) = lower(?) AND u.active = 1`
        )
        .get(String(username || 'jefe').trim());

  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado o inactivo.' });
  }

  const keepAccountId = isOwnerPreview || (ctx?.account && targetCompany.is_demo) ? ctx.account.id : null;
  const token = signSession({ aid: keepAccountId, cid: targetCompany.id, uid: user.id });
  setSessionCookie(res, token);
  const cfg = getConfig(db);
  const safe = sanitizeUser(user, cfg);

  return res.json({
    token,
    account: keepAccountId ? ctx.account : null,
    memberships: keepAccountId ? getAccountMemberships(keepAccountId) : [],
    active_company: formatCompanySummary(targetCompany),
    user: safe,
    config: cfg,
    badges: buildSystemBadges(db, targetCompany.id, runComplianceAudit),
  });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const ctx = resolveSessionContext(req);
  if (!ctx || (!ctx.user && !ctx.account)) {
    return res.status(401).json({ error: 'Sesión no iniciada o expirada.' });
  }

  const memberships = ctx.account ? getAccountMemberships(ctx.account.id) : [];

  if (!ctx.user || !ctx.tenantDb) {
    return res.json({
      account: ctx.account,
      memberships,
      active_company: null,
      user: null,
      config: null,
      badges: {},
    });
  }

  return res.json({
    account: ctx.account,
    memberships,
    active_company: formatCompanySummary(ctx.company),
    user: ctx.user,
    config: getConfig(ctx.tenantDb),
    badges: buildSystemBadges(ctx.tenantDb, ctx.company?.id, runComplianceAudit),
  });
});

export default router;
