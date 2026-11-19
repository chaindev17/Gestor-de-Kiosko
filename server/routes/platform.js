import { Router } from 'express';
import crypto from 'node:crypto';
import {
  DEFAULT_MODULES,
  DEFAULT_PERMISSIONS,
  MANAGEMENT_PRESETS,
  getDb,
  roundCup,
} from '../db.js';
import {
  buildSystemBadges,
  hashPassword,
  loadTenantUser,
  logAudit,
  logAutomation,
  requireAccount,
  requireAuth,
  requireRole,
  resolveSessionContext,
  setSessionCookie,
  signSession,
  verifyPassword,
} from '../auth.js';
import { getConfig, runComplianceAudit } from '../cubanLawEngine.js';
import {
  createCompanyForAccount,
  generateUniqueCode,
  getAccountMemberships,
  getCompanyById,
  getCompanyDb,
  getPlatformDb,
  hashSimpleCode,
  isValidEmail,
  normalizeCompanyCode,
  normalizeEmail,
  provisionTenantUserFromAccount,
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

router.get('/presets', (_req, res) => {
  res.json({
    presets: MANAGEMENT_PRESETS,
    default_modules: DEFAULT_MODULES,
    default_permissions: DEFAULT_PERMISSIONS,
  });
});

router.post('/register', (req, res) => {
  const pdb = getPlatformDb();
  const { full_name, email, password, phone, ci } = req.body || {};

  const cleanName = String(full_name || '').trim();
  const cleanEmail = normalizeEmail(email);
  const rawPw = String(password || '');

  if (cleanName.length < 2) {
    return res.status(400).json({ error: 'Escribe tu nombre y apellido.' });
  }
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Ingresa un correo electrónico válido (ej. nombre@correo.com).' });
  }
  if (rawPw.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  const dup = pdb.prepare('SELECT id FROM accounts WHERE email = ?').get(cleanEmail);
  if (dup) {
    return res
      .status(409)
      .json({ error: 'Ya existe una cuenta registrada con ese correo electrónico. Inicia sesión para entrar.' });
  }

  const pwHash = hashPassword(rawPw);
  const cleanPhone = String(phone || '').trim();
  const cleanCi = String(ci || '').trim();

  const aRes = pdb
    .prepare(
      `INSERT INTO accounts (email, password_hash, full_name, ci, phone)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(cleanEmail, pwHash, cleanName, cleanCi, cleanPhone);

  const accountId = Number(aRes.lastInsertRowid);
  const account = sanitizeAccount(pdb.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId));
  const token = signSession({ aid: accountId, cid: null, uid: null });
  setSessionCookie(res, token);

  return res.status(201).json({
    token,
    account,
    memberships: [],
    active_company: null,
    user: null,
    config: null,
    badges: {},
  });
});

router.post('/login', (req, res) => {
  const pdb = getPlatformDb();
  const { email, password, open_hub } = req.body || {};
  const cleanEmail = normalizeEmail(email);

  if (!cleanEmail || !password) {
    return res.status(400).json({ error: 'Ingresa tu correo electrónico y contraseña.' });
  }

  const acc = pdb.prepare('SELECT * FROM accounts WHERE email = ?').get(cleanEmail);
  if (!acc || !verifyPassword(password, acc.password_hash)) {
    return res.status(401).json({ error: 'Correo electrónico o contraseña incorrectos.' });
  }

  const safeAcc = sanitizeAccount(acc);
  const memberships = getAccountMemberships(acc.id);
  const activeMemberships = memberships.filter((m) => m.status === 'ACTIVO' && m.tenant_user_id);

  // Enter directly when user has exactly 1 active company (and didn't request hub)
  if (!open_hub && activeMemberships.length === 1) {
    const primary = activeMemberships[0];
    const company = getCompanyById(primary.company_id);
    const cdb = company ? getCompanyDb(company.id) : null;
    const tUser = cdb ? loadTenantUser(cdb, primary.tenant_user_id) : null;
    if (company && cdb && tUser) {
      const token = signSession({ aid: acc.id, cid: company.id, uid: tUser.id });
      setSessionCookie(res, token);
      logAudit(cdb, tUser, 'INICIO_SESION', 'Acceso', `Ingreso con correo ${acc.email} (${tUser.role}).`);
      return res.json({
        token,
        account: safeAcc,
        memberships,
        active_company: formatCompanySummary(company),
        user: tUser,
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
});

router.post('/forgot-password', (req, res) => {
  const pdb = getPlatformDb();
  const cleanEmail = normalizeEmail(req.body?.email);
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Ingresa el correo electrónico de tu cuenta.' });
  }
  const acc = pdb.prepare('SELECT * FROM accounts WHERE email = ?').get(cleanEmail);
  if (!acc) {
    return res.status(404).json({ error: 'No encontramos ninguna cuenta registrada con ese correo.' });
  }
  const num = crypto.randomInt(100000, 999999);
  const code = String(num);
  const expiresAt = Date.now() + 15 * 60 * 1000;
  pdb
    .prepare('UPDATE accounts SET recovery_code_hash = ?, recovery_expires_at = ? WHERE id = ?')
    .run(hashSimpleCode(code), expiresAt, acc.id);

  // Returned for local/self-hosted environments without SMTP configured
  return res.json({
    ok: true,
    email: cleanEmail,
    verification_code_preview: code,
    message: 'Código de recuperación generado (válido por 15 minutos).',
  });
});

router.post('/reset-password', (req, res) => {
  const pdb = getPlatformDb();
  const cleanEmail = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  const newPassword = String(req.body?.new_password || '');

  if (!isValidEmail(cleanEmail) || !code || newPassword.length < 6) {
    return res
      .status(400)
      .json({ error: 'Completa el correo, el código de 6 dígitos y una contraseña de al menos 6 caracteres.' });
  }

  const acc = pdb.prepare('SELECT * FROM accounts WHERE email = ?').get(cleanEmail);
  if (
    !acc ||
    !acc.recovery_code_hash ||
    Date.now() > Number(acc.recovery_expires_at || 0) ||
    !verifyPassword(code, acc.recovery_code_hash)
  ) {
    return res.status(400).json({ error: 'El código de verificación es incorrecto o expiró.' });
  }

  const nextHash = hashPassword(newPassword);
  pdb
    .prepare(
      `UPDATE accounts SET password_hash = ?, recovery_code_hash = '', recovery_expires_at = 0 WHERE id = ?`
    )
    .run(nextHash, acc.id);

  // Sync updated password to all affiliated tenant user records
  const mems = pdb
    .prepare('SELECT company_id, tenant_user_id FROM company_memberships WHERE account_id = ? AND tenant_user_id IS NOT NULL')
    .all(acc.id);
  for (const m of mems) {
    const cdb = getCompanyDb(m.company_id);
    if (cdb) {
      cdb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(nextHash, m.tenant_user_id);
    }
  }

  return res.json({ ok: true, message: 'Contraseña actualizada correctamente. Ya puedes entrar a tu panel.' });
});

router.get('/account', requireAccount, (req, res) => {
  const memberships = getAccountMemberships(req.account.id);
  res.json({
    account: req.account,
    memberships,
    active_company: formatCompanySummary(req.company),
  });
});

router.get('/lookup-code', (req, res) => {
  const pdb = getPlatformDb();
  const normalized = normalizeCompanyCode(req.query.code);
  if (!normalized || normalized.length < 9) {
    return res.status(400).json({ error: 'Ingresa un código válido (por ejemplo: kiosko-ABC123).' });
  }

  // 1. Check direct role/email invite first
  const invite = pdb
    .prepare(
      `SELECT i.*, c.name AS company_name, c.company_code, c.business_type,
              c.legal_form, c.municipality, c.province, c.join_mode, c.active AS company_active
       FROM company_invites i
       JOIN companies c ON c.id = i.company_id
       WHERE upper(i.code) = upper(?) AND i.active = 1 AND c.active = 1`
    )
    .get(normalized);

  if (invite) {
    if (invite.max_uses > 0 && invite.uses_count >= invite.max_uses) {
      return res.status(400).json({ error: 'Este código de invitación ya fue utilizado.' });
    }
    return res.json({
      valid: true,
      kind: 'invite',
      code: invite.code,
      company: {
        id: invite.company_id,
        company_code: invite.company_code,
        name: invite.company_name,
        business_type: invite.business_type,
        legal_form: invite.legal_form,
        municipality: invite.municipality,
        province: invite.province,
        join_mode: 'DIRECT_INVITE',
      },
      invite: {
        role: invite.role,
        label: invite.label,
        target_email: invite.target_email || '',
        default_register: invite.default_register,
      },
    });
  }

  // 2. Check general company affiliation code
  const company = pdb
    .prepare('SELECT * FROM companies WHERE upper(company_code) = upper(?) AND active = 1')
    .get(normalized);

  if (!company) {
    return res.status(404).json({
      error: `No encontramos ninguna empresa con el código "${normalized}". Verifica que esté bien escrito o pídeselo al creador del negocio.`,
    });
  }

  return res.json({
    valid: true,
    kind: 'company',
    code: company.company_code,
    company: formatCompanySummary(company),
    invite: null,
  });
});

router.post('/companies', requireAccount, (req, res) => {
  const pdb = getPlatformDb();
  const fullAcc = pdb.prepare('SELECT * FROM accounts WHERE id = ?').get(req.account.id);
  if (!fullAcc) {
    return res.status(401).json({ error: 'Cuenta no encontrada.' });
  }

  try {
    const { company, tenantDb, tenantUserId } = createCompanyForAccount(fullAcc, req.body || {});
    const tUser = loadTenantUser(tenantDb, tenantUserId);
    const token = signSession({ aid: fullAcc.id, cid: company.id, uid: tenantUserId });
    setSessionCookie(res, token);

    return res.status(201).json({
      token,
      account: sanitizeAccount(fullAcc),
      memberships: getAccountMemberships(fullAcc.id),
      active_company: formatCompanySummary(company),
      user: tUser,
      config: getConfig(tenantDb),
      badges: buildSystemBadges(tenantDb, company.id, runComplianceAudit),
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/affiliate', (req, res) => {
  const pdb = getPlatformDb();
  const ctx = resolveSessionContext(req);
  const {
    code,
    requested_role = 'vendedor',
    ci = '',
    phone = '',
    note = '',
    // Optional inline registration if user is not logged in yet
    full_name,
    email,
    password,
  } = req.body || {};

  const normalized = normalizeCompanyCode(code);
  if (!normalized || normalized.length < 9) {
    return res.status(400).json({ error: 'Ingresa el código de afiliación (ej. kiosko-ABC123).' });
  }

  // Locate invite or company BEFORE creating any account so invalid codes fail cleanly
  const invite = pdb
    .prepare(
      `SELECT i.*, c.active AS company_active
       FROM company_invites i
       JOIN companies c ON c.id = i.company_id
       WHERE upper(i.code) = upper(?) AND i.active = 1 AND c.active = 1`
    )
    .get(normalized);

  if (invite && invite.max_uses > 0 && invite.uses_count >= invite.max_uses) {
    return res.status(400).json({ error: 'Este código de invitación ya alcanzó su límite de usos.' });
  }

  const company = invite
    ? getCompanyById(invite.company_id)
    : pdb
        .prepare('SELECT * FROM companies WHERE upper(company_code) = upper(?) AND active = 1')
        .get(normalized);

  if (!company) {
    return res.status(404).json({
      error: `No existe ninguna empresa activa con el código "${normalized}".`,
    });
  }

  // Resolve or register account
  let fullAcc = ctx?.account
    ? pdb.prepare('SELECT * FROM accounts WHERE id = ?').get(ctx.account.id)
    : null;

  if (!fullAcc) {
    const cleanEmail = normalizeEmail(email);
    const cleanName = String(full_name || '').trim();
    const rawPw = String(password || '');
    if (cleanName.length < 2 || !isValidEmail(cleanEmail) || rawPw.length < 6) {
      return res.status(400).json({
        error: 'Completa tu nombre, correo electrónico válido y una contraseña de al menos 6 caracteres para afiliarte.',
      });
    }
    const existingAcc = pdb.prepare('SELECT * FROM accounts WHERE email = ?').get(cleanEmail);
    if (existingAcc) {
      // If they entered matching password, authenticate and affiliate smoothly
      if (!verifyPassword(rawPw, existingAcc.password_hash)) {
        return res.status(409).json({
          error: 'Ese correo ya tiene cuenta. Ingresa su contraseña correcta o entra primero a tu panel.',
        });
      }
      fullAcc = existingAcc;
    } else {
      const aRes = pdb
        .prepare(
          `INSERT INTO accounts (email, password_hash, full_name, ci, phone)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(cleanEmail, hashPassword(rawPw), cleanName, String(ci || '').trim(), String(phone || '').trim());
      fullAcc = pdb.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(aRes.lastInsertRowid));
    }
  }

  if (invite?.target_email && normalizeEmail(invite.target_email) !== normalizeEmail(fullAcc.email)) {
    return res.status(403).json({
      error: `Esta invitación fue emitida exclusivamente para el correo ${invite.target_email}.`,
    });
  }

  // Update account CI/phone if newly provided
  if ((ci && !fullAcc.ci) || (phone && !fullAcc.phone)) {
    pdb
      .prepare('UPDATE accounts SET ci = ?, phone = ? WHERE id = ?')
      .run(String(ci || fullAcc.ci || '').trim(), String(phone || fullAcc.phone || '').trim(), fullAcc.id);
    fullAcc = pdb.prepare('SELECT * FROM accounts WHERE id = ?').get(fullAcc.id);
  }

  const existingMem = pdb
    .prepare('SELECT * FROM company_memberships WHERE company_id = ? AND account_id = ?')
    .get(company.id, fullAcc.id);

  if (existingMem && existingMem.status === 'ACTIVO') {
    return res.status(400).json({ error: `Ya formas parte de "${company.name}".` });
  }
  if (existingMem && existingMem.status === 'PENDIENTE' && !invite) {
    return res.status(400).json({
      error: `Tu solicitud para unirte a "${company.name}" ya está pendiente de aprobación por el creador.`,
    });
  }

  const validRole = ['vendedor', 'almacenero', 'economico'].includes(requested_role)
    ? requested_role
    : 'vendedor';
  const cdb = getCompanyDb(company.id);
  const cfg = getConfig(cdb);

  const joinImmediately = Boolean(invite) || cfg?.join_mode === 'AUTO' || company.join_mode === 'AUTO';

  if (joinImmediately) {
    const assignedRole = invite ? invite.role : validRole;
    const tenantUserId = provisionTenantUserFromAccount(cdb, fullAcc, {
      role: assignedRole,
      shift_template_id: invite?.shift_template_id || null,
      default_register: invite?.default_register || null,
      base_salary_cup: invite?.base_salary_cup || Math.max(6500, Number(cfg?.min_wage_cup || 2100)),
      sales_commission_pct: invite?.sales_commission_pct || (assignedRole === 'vendedor' ? 1.0 : 0),
      ci: ci || fullAcc.ci,
      phone: phone || fullAcc.phone,
    });

    if (existingMem) {
      pdb
        .prepare(
          `UPDATE company_memberships SET
             tenant_user_id = ?, role = ?, status = 'ACTIVO', requested_role = ?,
             requested_ci = ?, requested_phone = ?, request_note = ?, invite_code_used = ?,
             decided_at = datetime('now')
           WHERE id = ?`
        )
        .run(
          tenantUserId,
          assignedRole,
          assignedRole,
          String(ci || fullAcc.ci || '').trim(),
          String(phone || fullAcc.phone || '').trim(),
          String(note || '').trim(),
          invite ? invite.code : company.company_code,
          existingMem.id
        );
    } else {
      pdb
        .prepare(
          `INSERT INTO company_memberships
           (company_id, account_id, tenant_user_id, role, status, requested_role, requested_ci, requested_phone, request_note, invite_code_used, decided_at)
           VALUES (?, ?, ?, ?, 'ACTIVO', ?, ?, ?, ?, ?, datetime('now'))`
        )
        .run(
          company.id,
          fullAcc.id,
          tenantUserId,
          assignedRole,
          assignedRole,
          String(ci || fullAcc.ci || '').trim(),
          String(phone || fullAcc.phone || '').trim(),
          String(note || '').trim(),
          invite ? invite.code : company.company_code
        );
    }

    if (invite) {
      pdb
        .prepare(
          `UPDATE company_invites
           SET uses_count = uses_count + 1,
               active = CASE WHEN max_uses > 0 AND uses_count + 1 >= max_uses THEN 0 ELSE active END
           WHERE id = ?`
        )
        .run(invite.id);
    }

    const tUser = loadTenantUser(cdb, tenantUserId);
    logAutomation(
      cdb,
      'EQUIPO',
      'INFO',
      `Nuevo afiliado incorporado: ${fullAcc.full_name}`,
      `${fullAcc.email} se unió a la empresa como ${assignedRole} mediante el código ${invite ? invite.code : company.company_code}.`,
      invite ? invite.code : company.company_code
    );
    logAudit(
      cdb,
      tUser,
      'AFILIACION_DIRECTA',
      'Mi Empresa',
      `${fullAcc.full_name} (${fullAcc.email}) se afilió con cargo ${assignedRole}.`
    );

    const token = signSession({ aid: fullAcc.id, cid: company.id, uid: tenantUserId });
    setSessionCookie(res, token);

    return res.status(201).json({
      joined: true,
      status: 'ACTIVO',
      message: `¡Te uniste a ${company.name} como ${assignedRole}!`,
      token,
      account: sanitizeAccount(fullAcc),
      memberships: getAccountMemberships(fullAcc.id),
      active_company: formatCompanySummary(company),
      user: tUser,
      config: getConfig(cdb),
      badges: buildSystemBadges(cdb, company.id, runComplianceAudit),
    });
  }

  // Approval required: create or reopen PENDIENTE request
  if (existingMem) {
    pdb
      .prepare(
        `UPDATE company_memberships SET
           status = 'PENDIENTE', requested_role = ?, requested_ci = ?, requested_phone = ?,
           request_note = ?, invite_code_used = ?, created_at = datetime('now'), decided_at = NULL
         WHERE id = ?`
      )
      .run(
        validRole,
        String(ci || fullAcc.ci || '').trim(),
        String(phone || fullAcc.phone || '').trim(),
        String(note || '').trim(),
        company.company_code,
        existingMem.id
      );
  } else {
    pdb
      .prepare(
        `INSERT INTO company_memberships
         (company_id, account_id, role, status, requested_role, requested_ci, requested_phone, request_note, invite_code_used)
         VALUES (?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?)`
      )
      .run(
        company.id,
        fullAcc.id,
        validRole,
        validRole,
        String(ci || fullAcc.ci || '').trim(),
        String(phone || fullAcc.phone || '').trim(),
        String(note || '').trim(),
        company.company_code
      );
  }

  logAutomation(
    cdb,
    'EQUIPO',
    'ALERTA',
    `Solicitud de afiliación: ${fullAcc.full_name}`,
    `${fullAcc.email} solicitó unirse como ${validRole} usando ${company.company_code}. Revísala en "Mi Empresa y Modo".`,
    company.company_code
  );

  // Preserve active company session if they already had one, otherwise issue account hub session
  const token =
    ctx?.user && ctx?.company
      ? signSession({ aid: fullAcc.id, cid: ctx.company.id, uid: ctx.user.id })
      : signSession({ aid: fullAcc.id, cid: null, uid: null });
  setSessionCookie(res, token);

  return res.status(201).json({
    joined: false,
    status: 'PENDIENTE',
    message: `Solicitud enviada a "${company.name}". El creador la aprobará y te asignará tu puesto.`,
    token,
    account: sanitizeAccount(fullAcc),
    memberships: getAccountMemberships(fullAcc.id),
    active_company: ctx?.user ? formatCompanySummary(ctx.company) : null,
    user: ctx?.user || null,
    config: ctx?.tenantDb ? getConfig(ctx.tenantDb) : null,
    badges: ctx?.tenantDb ? buildSystemBadges(ctx.tenantDb, ctx.company?.id, runComplianceAudit) : {},
  });
});

router.post('/select-company', requireAccount, (req, res) => {
  const pdb = getPlatformDb();
  const companyId = Number(req.body?.company_id);
  if (!companyId) {
    return res.status(400).json({ error: 'Indica la empresa a la que deseas entrar.' });
  }

  const mem = pdb
    .prepare(
      `SELECT * FROM company_memberships
       WHERE company_id = ? AND account_id = ?`
    )
    .get(companyId, req.account.id);

  if (!mem) {
    return res.status(403).json({ error: 'Tu cuenta no está afiliada a esa empresa.' });
  }
  if (mem.status === 'PENDIENTE') {
    return res.status(403).json({ error: 'Tu afiliación aún está pendiente de aprobación por el creador.' });
  }
  if (mem.status !== 'ACTIVO' || !mem.tenant_user_id) {
    return res.status(403).json({ error: 'Tu acceso a esta empresa no está activo.' });
  }

  const company = getCompanyById(companyId);
  const cdb = company ? getCompanyDb(company.id) : null;
  const tUser = cdb ? loadTenantUser(cdb, mem.tenant_user_id) : null;
  if (!company || !cdb || !tUser) {
    return res.status(404).json({ error: 'No se pudo cargar tu usuario en esta empresa.' });
  }

  const token = signSession({ aid: req.account.id, cid: company.id, uid: tUser.id });
  setSessionCookie(res, token);

  return res.json({
    token,
    account: req.account,
    memberships: getAccountMemberships(req.account.id),
    active_company: formatCompanySummary(company),
    user: tUser,
    config: getConfig(cdb),
    badges: buildSystemBadges(cdb, company.id, runComplianceAudit),
  });
});

router.post('/exit-to-hub', requireAccount, (req, res) => {
  const token = signSession({ aid: req.account.id, cid: null, uid: null });
  setSessionCookie(res, token);
  return res.json({
    token,
    account: req.account,
    memberships: getAccountMemberships(req.account.id),
    active_company: null,
    user: null,
    config: null,
    badges: {},
  });
});

// =========================================================================
// CREATOR / OWNER CONTROLS INSIDE ACTIVE COMPANY
// =========================================================================

router.get('/company/affiliations', requireAuth, requireRole('jefe'), (req, res) => {
  const pdb = getPlatformDb();
  const db = getDb();
  const config = getConfig(db);
  const companyId = req.company?.id;
  const shifts = db.prepare('SELECT * FROM shift_templates WHERE active = 1 ORDER BY id').all();

  if (!companyId) {
    return res.json({
      company: null,
      config,
      shifts,
      pending: [],
      members: [],
      invites: [],
      presets: MANAGEMENT_PRESETS,
    });
  }

  const company = getCompanyById(companyId);
  const allMems = pdb
    .prepare(
      `SELECT m.*, a.email, a.full_name, a.ci AS account_ci, a.phone AS account_phone,
              CASE WHEN c.owner_account_id = m.account_id THEN 1 ELSE 0 END AS is_owner
       FROM company_memberships m
       JOIN accounts a ON a.id = m.account_id
       JOIN companies c ON c.id = m.company_id
       WHERE m.company_id = ?
       ORDER BY CASE m.status WHEN 'PENDIENTE' THEN 0 WHEN 'ACTIVO' THEN 1 ELSE 2 END,
                is_owner DESC, m.id DESC`
    )
    .all(companyId);

  const getTenantInfo = db.prepare(
    `SELECT u.id, u.username, u.role, u.shift_template_id, st.name AS shift_name,
            u.default_register, u.base_salary_cup, u.sales_commission_pct, u.active
     FROM users u
     LEFT JOIN shift_templates st ON st.id = u.shift_template_id
     WHERE u.id = ?`
  );

  const enriched = allMems.map((m) => {
    const tu = m.tenant_user_id ? getTenantInfo.get(m.tenant_user_id) : null;
    return {
      ...m,
      is_owner: Boolean(m.is_owner),
      shift_template_id: tu?.shift_template_id || null,
      shift_name: tu?.shift_name || null,
      default_register: tu?.default_register || null,
      base_salary_cup: tu?.base_salary_cup || null,
      sales_commission_pct: tu?.sales_commission_pct || 0,
      username: tu?.username || '',
    };
  });

  const invites = pdb
    .prepare(
      `SELECT * FROM company_invites WHERE company_id = ? ORDER BY active DESC, id DESC LIMIT 30`
    )
    .all(companyId);

  return res.json({
    company: formatCompanySummary(company),
    config,
    shifts,
    pending: enriched.filter((m) => m.status === 'PENDIENTE'),
    members: enriched.filter((m) => m.status !== 'PENDIENTE'),
    invites,
    presets: MANAGEMENT_PRESETS,
  });
});

router.post('/company/regenerate-code', requireAuth, requireRole('jefe'), (req, res) => {
  const pdb = getPlatformDb();
  const db = getDb();
  if (!req.company?.id) {
    return res.status(400).json({ error: 'Empresa no identificada.' });
  }
  const newCode = generateUniqueCode(pdb);
  pdb.prepare('UPDATE companies SET company_code = ? WHERE id = ?').run(newCode, req.company.id);
  db.prepare('UPDATE business_config SET company_code = ?, updated_at = datetime(\'now\') WHERE id = 1').run(
    newCode
  );
  logAudit(
    db,
    req.user,
    'REGENERAR_CODIGO',
    'Mi Empresa',
    `Nuevo código de afiliación generado: ${newCode}.`
  );
  res.json({ company_code: newCode, config: getConfig(db) });
});

router.post('/company/affiliations/:id/decide', requireAuth, requireRole('jefe'), (req, res) => {
  const pdb = getPlatformDb();
  const db = getDb();
  const config = getConfig(db);
  const memId = Number(req.params.id);
  const {
    decision,
    role,
    shift_template_id,
    default_register,
    base_salary_cup,
    sales_commission_pct,
    contract_type,
  } = req.body || {};

  const mem = pdb
    .prepare('SELECT * FROM company_memberships WHERE id = ? AND company_id = ?')
    .get(memId, req.company?.id);
  if (!mem) {
    return res.status(404).json({ error: 'Solicitud de afiliación no encontrada.' });
  }

  const acc = pdb.prepare('SELECT * FROM accounts WHERE id = ?').get(mem.account_id);
  if (!acc) {
    return res.status(404).json({ error: 'Cuenta del solicitante no encontrada.' });
  }

  if (decision === 'RECHAZAR') {
    pdb
      .prepare(
        `UPDATE company_memberships SET status = 'RECHAZADO', decided_at = datetime('now') WHERE id = ?`
      )
      .run(memId);
    logAudit(
      db,
      req.user,
      'RECHAZO_AFILIACION',
      'Mi Empresa',
      `Rechazada solicitud de ${acc.full_name} (${acc.email}).`
    );
    return res.json({ ok: true, status: 'RECHAZADO' });
  }

  const assignedRole = ['vendedor', 'almacenero', 'economico', 'jefe'].includes(role)
    ? role
    : mem.requested_role || 'vendedor';

  const salary = roundCup(base_salary_cup ?? Math.max(6500, Number(config.min_wage_cup || 2100)));
  if (salary < Number(config.min_wage_cup || 2100)) {
    return res.status(400).json({
      error: `El salario (${salary} CUP) no puede ser menor al mínimo configurado (${config.min_wage_cup} CUP).`,
    });
  }

  if (!config.flexible_role_limits && ['economico', 'almacenero'].includes(assignedRole)) {
    const existingRole = db
      .prepare('SELECT id FROM users WHERE active = 1 AND role = ?')
      .get(assignedRole);
    if (existingRole) {
      return res.status(400).json({
        error: `Ya tienes un ${assignedRole} activo. Puedes activar "Permitir varios trabajadores por cargo" en Reglas y Permisos o elegir otro rol.`,
      });
    }
  }

  const tenantUserId = provisionTenantUserFromAccount(db, acc, {
    role: assignedRole,
    shift_template_id: assignedRole === 'vendedor' ? shift_template_id : null,
    default_register: assignedRole === 'vendedor' ? default_register : null,
    base_salary_cup: salary,
    sales_commission_pct: assignedRole === 'vendedor' ? Number(sales_commission_pct || 1.0) : 0,
    contract_type: contract_type || 'Indeterminado',
    ci: mem.requested_ci || acc.ci,
    phone: mem.requested_phone || acc.phone,
  });

  pdb
    .prepare(
      `UPDATE company_memberships
       SET tenant_user_id = ?, role = ?, status = 'ACTIVO', decided_at = datetime('now')
       WHERE id = ?`
    )
    .run(tenantUserId, assignedRole, memId);

  logAutomation(
    db,
    'EQUIPO',
    'INFO',
    `Afiliación aprobada: ${acc.full_name}`,
    `${acc.email} ahora forma parte del equipo como ${assignedRole}.`,
    config.company_code
  );
  logAudit(
    db,
    req.user,
    'APROBACION_AFILIACION',
    'Mi Empresa',
    `Aprobada afiliación de ${acc.full_name} (${acc.email}) como ${assignedRole} — Salario ${salary} CUP.`
  );

  return res.json({ ok: true, status: 'ACTIVO', tenant_user_id: tenantUserId });
});

router.put('/company/affiliations/:id', requireAuth, requireRole('jefe'), (req, res) => {
  const pdb = getPlatformDb();
  const db = getDb();
  const memId = Number(req.params.id);
  const mem = pdb
    .prepare('SELECT * FROM company_memberships WHERE id = ? AND company_id = ?')
    .get(memId, req.company?.id);
  if (!mem) return res.status(404).json({ error: 'Afiliación no encontrada.' });

  if (Number(req.company?.owner_account_id) === Number(mem.account_id) && req.body?.status === 'SUSPENDIDO') {
    return res.status(400).json({ error: 'No puedes suspender al creador de la empresa.' });
  }

  const nextStatus =
    req.body?.status && ['ACTIVO', 'SUSPENDIDO'].includes(req.body.status)
      ? req.body.status
      : mem.status;
  const nextRole =
    req.body?.role && ['jefe', 'economico', 'almacenero', 'vendedor'].includes(req.body.role)
      ? req.body.role
      : mem.role;

  pdb
    .prepare('UPDATE company_memberships SET status = ?, role = ? WHERE id = ?')
    .run(nextStatus, nextRole, memId);

  if (mem.tenant_user_id) {
    const tu = db.prepare('SELECT * FROM users WHERE id = ?').get(mem.tenant_user_id);
    if (tu) {
      const shiftId =
        nextRole === 'vendedor'
          ? Number(req.body?.shift_template_id || tu.shift_template_id || 0) ||
            db.prepare('SELECT id FROM shift_templates WHERE active = 1 ORDER BY id LIMIT 1').get()?.id ||
            null
          : null;
      const regNum =
        nextRole === 'vendedor'
          ? Math.max(1, Math.min(6, Number(req.body?.default_register || tu.default_register || 1)))
          : null;
      const salary =
        req.body?.base_salary_cup !== undefined ? roundCup(req.body.base_salary_cup) : tu.base_salary_cup;

      db.prepare(
        `UPDATE users SET role = ?, shift_template_id = ?, default_register = ?, base_salary_cup = ?, active = ?
         WHERE id = ?`
      ).run(nextRole, shiftId, regNum, salary, nextStatus === 'ACTIVO' ? 1 : 0, tu.id);
    }
  }

  logAudit(
    db,
    req.user,
    'ACTUALIZACION_AFILIADO',
    'Mi Empresa',
    `Actualizada afiliación #${memId}: cargo=${nextRole}, estado=${nextStatus}.`
  );
  res.json({ ok: true });
});

router.post('/company/invites', requireAuth, requireRole('jefe'), (req, res) => {
  const pdb = getPlatformDb();
  const db = getDb();
  const config = getConfig(db);
  if (!req.company?.id) {
    return res.status(400).json({ error: 'Empresa no identificada.' });
  }

  const {
    role = 'vendedor',
    target_email = '',
    label = '',
    shift_template_id = null,
    default_register = 1,
    base_salary_cup = 6500,
    sales_commission_pct = 1.0,
    max_uses = 1,
  } = req.body || {};

  if (!['vendedor', 'almacenero', 'economico', 'jefe'].includes(role)) {
    return res.status(400).json({ error: 'Selecciona un puesto válido.' });
  }

  const cleanEmail = target_email ? normalizeEmail(target_email) : '';
  if (cleanEmail && !isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'El correo del destinatario no tiene formato válido.' });
  }

  const salary = Math.max(Number(config.min_wage_cup || 2100), roundCup(base_salary_cup));
  const rolePrefix = role === 'vendedor' ? 'V' : role === 'almacenero' ? 'A' : role === 'economico' ? 'E' : 'J';
  const code = generateUniqueCode(pdb, rolePrefix);

  const iRes = pdb
    .prepare(
      `INSERT INTO company_invites
       (company_id, code, label, target_email, role, shift_template_id, default_register,
        base_salary_cup, sales_commission_pct, max_uses, created_by_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.company.id,
      code,
      String(label || '').trim(),
      cleanEmail,
      role,
      role === 'vendedor' && shift_template_id ? Number(shift_template_id) : null,
      role === 'vendedor' ? Math.max(1, Math.min(6, Number(default_register || 1))) : null,
      salary,
      role === 'vendedor' ? Math.max(0, Number(sales_commission_pct || 0)) : 0,
      Math.max(1, Math.min(50, Number(max_uses || 1))),
      req.account?.id || null
    );

  const invite = pdb.prepare('SELECT * FROM company_invites WHERE id = ?').get(Number(iRes.lastInsertRowid));
  logAudit(
    db,
    req.user,
    'CREACION_INVITACION',
    'Mi Empresa',
    `Generado código directo ${code} para cargo ${role}${cleanEmail ? ` (${cleanEmail})` : ''}.`
  );

  res.status(201).json({ invite });
});

router.delete('/company/invites/:id', requireAuth, requireRole('jefe'), (req, res) => {
  const pdb = getPlatformDb();
  pdb
    .prepare('UPDATE company_invites SET active = 0 WHERE id = ? AND company_id = ?')
    .run(Number(req.params.id), req.company?.id || 0);
  res.json({ ok: true });
});

router.put('/company/governance', requireAuth, requireRole('jefe'), (req, res) => {
  const pdb = getPlatformDb();
  const db = getDb();
  const current = getConfig(db);
  const body = req.body || {};

  // If apply_preset is set, apply full preset defaults before specific overrides
  const presetToApply = body.apply_preset ? MANAGEMENT_PRESETS[body.apply_preset] : null;

  const nextPreset =
    body.management_preset && MANAGEMENT_PRESETS[body.management_preset]
      ? body.management_preset
      : presetToApply
      ? presetToApply.id
      : current.management_preset || 'kiosko_completo';

  const nextModules = {
    ...DEFAULT_MODULES,
    ...(presetToApply ? presetToApply.modules : current.modules),
    ...(body.modules && typeof body.modules === 'object' ? body.modules : {}),
    pos: true,
  };

  const nextPermissions = {
    ...DEFAULT_PERMISSIONS,
    ...(presetToApply ? presetToApply.permissions : current.permissions),
    ...(body.permissions && typeof body.permissions === 'object' ? body.permissions : {}),
  };

  const pickBool = (key) => {
    if (body[key] !== undefined) return body[key] ? 1 : 0;
    if (presetToApply && presetToApply[key] !== undefined) return presetToApply[key] ? 1 : 0;
    return current[key] ? 1 : 0;
  };

  const nextName = String(body.business_name ?? current.business_name).trim() || current.business_name;
  const nextType =
    String(body.business_type ?? current.business_type ?? 'Kiosko y Comercio Minorista').trim();
  const nextLegalForm = ['MIPYME', 'TCP'].includes(body.legal_form)
    ? body.legal_form
    : current.legal_form;
  const nextJoinMode = body.join_mode
    ? body.join_mode === 'AUTO'
      ? 'AUTO'
      : 'APPROVAL'
    : current.join_mode || 'APPROVAL';
  const nextMaxSellers = Math.max(
    1,
    Math.min(
      6,
      Number(
        body.max_sellers_per_shift ??
          (presetToApply ? presetToApply.max_sellers_per_shift : current.max_sellers_per_shift) ??
          2
      )
    )
  );
  const nextMunicipality = String(body.municipality ?? current.municipality).trim();
  const nextProvince = String(body.province ?? current.province).trim();
  const nextAddress = String(body.address ?? current.address).trim();
  const nextNit = String(body.nit ?? current.nit).trim();
  const nextWhatsapp = String(body.whatsapp_phone ?? current.whatsapp_phone ?? '').trim();
  const nextEmail = String(body.contact_email ?? current.contact_email ?? '').trim();
  const nextBank = String(body.bank_name ?? current.bank_name).trim();
  const nextFiscalAcc = String(body.fiscal_account_cup ?? current.fiscal_account_cup).trim();
  const nextTmPhone = String(body.transfermovil_phone ?? current.transfermovil_phone).trim();
  const nextTmCode = String(body.transfermovil_merchant_code ?? current.transfermovil_merchant_code).trim();
  const nextEzCode = String(body.enzona_merchant_code ?? current.enzona_merchant_code).trim();
  const nextQrDiscount = Math.max(
    0,
    Math.min(15, Number(body.qr_discount_pct ?? current.qr_discount_pct))
  );
  const nextPettyCash = Math.max(
    0,
    roundCup(body.petty_cash_fund_cup ?? current.petty_cash_fund_cup)
  );
  const nextMaxCash = Math.max(
    500,
    roundCup(body.max_cash_provider_payment_cup ?? current.max_cash_provider_payment_cup)
  );
  const nextMargin = Math.max(
    5,
    Number(body.max_regulated_margin_pct ?? current.max_regulated_margin_pct)
  );
  const allowedOpModes = ['SOLO_POS', 'POS_CATALOGO', 'SOLO_CATALOGO', 'MULTICAJA'];
  const nextOpMode = allowedOpModes.includes(body.operation_mode)
    ? body.operation_mode
    : current.operation_mode || 'POS_CATALOGO';
  const nextRateUsd = Math.max(1, roundCup(body.rate_usd_cup ?? current.rate_usd_cup ?? 320));
  const nextRateMlc = Math.max(1, roundCup(body.rate_mlc_cup ?? current.rate_mlc_cup ?? 275));
  const nextRateEur = Math.max(1, roundCup(body.rate_eur_cup ?? current.rate_eur_cup ?? 340));

  db.prepare(
    `UPDATE business_config SET
       business_name = ?,
       business_type = ?,
       management_preset = ?,
       legal_form = ?,
       nit = ?,
       municipality = ?,
       province = ?,
       address = ?,
       whatsapp_phone = ?,
       contact_email = ?,
       join_mode = ?,
       max_sellers_per_shift = ?,
       flexible_role_limits = ?,
       require_cuban_ci = ?,
       owner_can_operate_pos = ?,
       modules_json = ?,
       permissions_json = ?,
       bank_name = ?,
       fiscal_account_cup = ?,
       transfermovil_phone = ?,
       transfermovil_merchant_code = ?,
       enzona_merchant_code = ?,
       qr_discount_pct = ?,
       petty_cash_fund_cup = ?,
       max_cash_provider_payment_cup = ?,
       max_regulated_margin_pct = ?,
       auto_restock_enabled = ?,
       auto_accounting_enabled = ?,
       auto_deposit_order_enabled = ?,
       strict_price_cap_block = ?,
       strict_bancarizacion_block = ?,
       operation_mode = ?,
       strict_ipv_control = ?,
       rate_usd_cup = ?,
       rate_mlc_cup = ?,
       rate_eur_cup = ?,
       show_fx_reference = ?,
       catalog_enabled = ?,
       catalog_show_out_of_stock = ?,
       catalog_show_stock_qty = ?,
       catalog_allow_backorder = ?,
       updated_at = datetime('now')
     WHERE id = 1`
  ).run(
    nextName,
    nextType,
    nextPreset,
    nextLegalForm,
    nextNit,
    nextMunicipality,
    nextProvince,
    nextAddress,
    nextWhatsapp,
    nextEmail,
    nextJoinMode,
    nextMaxSellers,
    pickBool('flexible_role_limits'),
    pickBool('require_cuban_ci'),
    pickBool('owner_can_operate_pos'),
    JSON.stringify(nextModules),
    JSON.stringify(nextPermissions),
    nextBank,
    nextFiscalAcc,
    nextTmPhone,
    nextTmCode,
    nextEzCode,
    nextQrDiscount,
    nextPettyCash,
    nextMaxCash,
    nextMargin,
    pickBool('auto_restock_enabled'),
    pickBool('auto_accounting_enabled'),
    pickBool('auto_deposit_order_enabled'),
    pickBool('strict_price_cap_block'),
    pickBool('strict_bancarizacion_block'),
    nextOpMode,
    pickBool('strict_ipv_control'),
    nextRateUsd,
    nextRateMlc,
    nextRateEur,
    pickBool('show_fx_reference'),
    body.operation_mode === 'SOLO_POS'
      ? 0
      : body.operation_mode === 'POS_CATALOGO' || body.operation_mode === 'SOLO_CATALOGO'
        ? 1
        : pickBool('catalog_enabled'),
    pickBool('catalog_show_out_of_stock'),
    pickBool('catalog_show_stock_qty'),
    pickBool('catalog_allow_backorder')
  );

  db.prepare('UPDATE shift_templates SET required_sellers = ? WHERE active = 1').run(nextMaxSellers);

  if (req.company?.id) {
    pdb
      .prepare(
        `UPDATE companies
         SET name = ?, business_type = ?, legal_form = ?, municipality = ?, province = ?, join_mode = ?
         WHERE id = ?`
      )
      .run(
        nextName,
        nextType,
        nextLegalForm,
        nextMunicipality,
        nextProvince,
        nextJoinMode,
        req.company.id
      );
  }

  logAudit(
    db,
    req.user,
    'CONFIGURACION_MODO',
    'Mi Empresa',
    `Actualizado el modo de manejo del software (${nextPreset}, ${Object.values(nextModules).filter(Boolean).length} módulos activos, hasta ${nextMaxSellers} cajas/turno).`
  );

  const updatedCompany = req.company?.id ? getCompanyById(req.company.id) : null;
  return res.json({
    config: getConfig(db),
    active_company: formatCompanySummary(updatedCompany),
    badges: buildSystemBadges(db, req.company?.id, runComplianceAudit),
  });
});

export default router;
