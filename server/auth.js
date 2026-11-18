import crypto from 'node:crypto';
import { getDb } from './db.js';

const TOKEN_SECRET =
  process.env.KIOSKO_SESSION_SECRET ||
  crypto.createHash('sha256').update('gestor-de-kiosko-cuba-local-secret-v1').digest('hex');

export const COOKIE_NAME = 'kiosko_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, keyHex] = stored.split(':');
  const derived = crypto.scryptSync(String(password), salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function signSession(userId) {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, iat: Date.now() })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.uid) return null;
    // 7 days validity
    if (Date.now() - Number(data.iat || 0) > 7 * 24 * 60 * 60 * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash: _pw, ...safe } = user;
  return safe;
}

export function getUserFromRequest(req) {
  const db = getDb();
  let token = req.cookies?.[COOKIE_NAME];
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }
  const session = verifySession(token);
  if (!session) return null;
  const user = db
    .prepare(
      `SELECT u.*, st.name AS shift_name, st.code AS shift_code, st.start_time, st.end_time
       FROM users u
       LEFT JOIN shift_templates st ON st.id = u.shift_template_id
       WHERE u.id = ? AND u.active = 1`
    )
    .get(session.uid);
  return sanitizeUser(user);
}

export function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Sesión no iniciada o expirada. Ingrese nuevamente.' });
  }
  req.user = user;
  next();
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Acceso restringido por Control Interno (Res. 60/22). Su rol (${req.user.role}) no está autorizado para esta operación.`,
      });
    }
    next();
  };
}

export function logAudit(db, user, action, module, detail) {
  db.prepare(
    `INSERT INTO audit_logs (user_id, user_name, user_role, action, module, detail)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    user?.id || null,
    user?.full_name || 'Sistema Automatizado',
    user?.role || 'sistema',
    action,
    module,
    detail
  );
}

export function logAutomation(db, category, severity, title, detail, refCode = '') {
  db.prepare(
    `INSERT INTO automation_events (category, severity, title, detail, ref_code)
     VALUES (?, ?, ?, ?, ?)`
  ).run(category, severity, title, detail, refCode);
}
