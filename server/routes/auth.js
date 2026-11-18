import { Router } from 'express';
import { getDb } from '../db.js';
import {
  COOKIE_NAME,
  logAudit,
  requireAuth,
  sanitizeUser,
  signSession,
  verifyPassword,
} from '../auth.js';
import { getConfig, runComplianceAudit } from '../cubanLawEngine.js';

const router = Router();

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function getSystemBadges(db) {
  const pendingRestocks = db
    .prepare(`SELECT COUNT(*) AS cnt FROM restock_requests WHERE status = 'PENDIENTE'`)
    .get().cnt;
  const pendingMermas = db
    .prepare(`SELECT COUNT(*) AS cnt FROM inventory_movements WHERE status = 'PENDIENTE_APROBACION'`)
    .get().cnt;
  const pendingDeposits = db
    .prepare(`SELECT COUNT(*) AS cnt FROM bank_deposits WHERE status = 'PENDIENTE'`)
    .get().cnt;
  const unreconciledQr = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM sales
       WHERE status = 'COMPLETADA' AND reconciled = 0 AND (transfermovil_amount_cup > 0 OR enzona_amount_cup > 0)`
    )
    .get().cnt;
  const unvalidatedShifts = db
    .prepare(`SELECT COUNT(*) AS cnt FROM shift_sessions WHERE status = 'CERRADO'`)
    .get().cnt;
  const activeShift = db
    .prepare(
      `SELECT ss.*, st.name AS shift_name, st.start_time, st.end_time,
              (SELECT COUNT(*) FROM shift_registers sr WHERE sr.shift_session_id = ss.id AND sr.status = 'ABIERTA') AS open_registers
       FROM shift_sessions ss
       JOIN shift_templates st ON st.id = ss.shift_template_id
       WHERE ss.status = 'ABIERTO'
       ORDER BY ss.id DESC LIMIT 1`
    )
    .get();
  const compliance = runComplianceAudit(db);

  return {
    pending_restocks: Number(pendingRestocks || 0),
    pending_mermas: Number(pendingMermas || 0),
    pending_deposits: Number(pendingDeposits || 0),
    unreconciled_qr: Number(unreconciledQr || 0),
    unvalidated_shifts: Number(unvalidatedShifts || 0),
    active_shift: activeShift || null,
    compliance_score: compliance.score,
    compliance_overall: compliance.overall,
    compliance_critical: compliance.critical_count,
  };
}

router.get('/roles-preview', (_req, res) => {
  const db = getDb();
  const config = getConfig(db);
  const users = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.role, u.default_register,
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
    .all();

  res.json({
    business_name: config?.business_name || 'Gestor de Kiosko',
    legal_form: config?.legal_form || 'MIPYME',
    municipality: config?.municipality || '',
    province: config?.province || '',
    demo_switch_enabled: process.env.KIOSKO_DISABLE_DEMO_SWITCH !== '1',
    users,
  });
});

router.post('/login', (req, res) => {
  const db = getDb();
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Ingrese usuario y contraseña.' });
  }
  const user = db
    .prepare(
      `SELECT u.*, st.name AS shift_name, st.code AS shift_code, st.start_time, st.end_time
       FROM users u
       LEFT JOIN shift_templates st ON st.id = u.shift_template_id
       WHERE lower(u.username) = lower(?) AND u.active = 1`
    )
    .get(String(username).trim());

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas o usuario inactivo.' });
  }

  const token = signSession(user.id);
  setSessionCookie(res, token);
  const safe = sanitizeUser(user);
  logAudit(db, safe, 'INICIO_SESION', 'Acceso', `Ingreso al sistema como ${safe.role}.`);

  res.json({
    token,
    user: safe,
    config: getConfig(db),
    badges: getSystemBadges(db),
  });
});

router.post('/quick-switch', (req, res) => {
  if (process.env.KIOSKO_DISABLE_DEMO_SWITCH === '1') {
    return res.status(403).json({ error: 'El cambio rápido de perfil está deshabilitado.' });
  }
  const db = getDb();
  const { user_id, username } = req.body || {};
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
        .get(String(username || '').trim());

  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado o inactivo.' });
  }

  const token = signSession(user.id);
  setSessionCookie(res, token);
  const safe = sanitizeUser(user);

  res.json({
    token,
    user: safe,
    config: getConfig(db),
    badges: getSystemBadges(db),
  });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  res.json({
    user: req.user,
    config: getConfig(db),
    badges: getSystemBadges(db),
  });
});

export default router;
