import crypto from 'node:crypto';
import { getDb, runWithDb } from './db.js';
import {
  getCompanyById,
  getCompanyDb,
  getDemoCompany,
  getPendingAffiliationsCount,
  getPlatformDb,
  sanitizeAccount,
} from './platform.js';

const TOKEN_SECRET =
  process.env.KIOSKO_SESSION_SECRET ||
  crypto.createHash('sha256').update('gestor-de-kiosko-cuba-local-secret-v1').digest('hex');

export const COOKIE_NAME = 'kiosko_session';

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

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

/**
 * Signs a session token.
 * Accepts either a numeric legacy tenant userId OR an object { uid, cid, aid }.
 */
export function signSession(subject) {
  const obj =
    typeof subject === 'object' && subject !== null
      ? {
          uid: subject.uid || null,
          cid: subject.cid || null,
          aid: subject.aid || null,
          iat: Date.now(),
        }
      : { uid: Number(subject), cid: null, aid: null, iat: Date.now() };

  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
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
    if (!data?.uid && !data?.aid) return null;
    if (Date.now() - Number(data.iat || 0) > 7 * 24 * 60 * 60 * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export function extractToken(req) {
  let token = req.cookies?.[COOKIE_NAME];
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }
  return token || null;
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash: _pw, ...safe } = user;
  return safe;
}

export function loadTenantUser(db, userId) {
  if (!db || !userId) return null;
  const user = db
    .prepare(
      `SELECT u.*, st.name AS shift_name, st.code AS shift_code, st.start_time, st.end_time
       FROM users u
       LEFT JOIN shift_templates st ON st.id = u.shift_template_id
       WHERE u.id = ? AND u.active = 1`
    )
    .get(Number(userId));
  return sanitizeUser(user);
}

export function resolveSessionContext(req) {
  const session = verifySession(extractToken(req));
  if (!session) return null;

  let account = null;
  if (session.aid) {
    const pdb = getPlatformDb();
    const rawAcc = pdb.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(session.aid));
    account = sanitizeAccount(rawAcc);
    if (!account && !session.uid) return null;
  }

  let company = null;
  let tenantDb = null;
  let user = null;

  if (session.uid) {
    if (session.cid) {
      company = getCompanyById(session.cid);
      if (company) {
        // If tied to an email account, verify membership is still ACTIVO (unless demo preview switch)
        if (session.aid && !company.is_demo) {
          const pdb = getPlatformDb();
          const mem = pdb
            .prepare(
              `SELECT * FROM company_memberships WHERE company_id = ? AND account_id = ? AND status = 'ACTIVO'`
            )
            .get(company.id, Number(session.aid));
          if (!mem) {
            return { session, account, company: null, tenantDb: null, user: null };
          }
        }
        tenantDb = getCompanyDb(company.id);
      }
    } else {
      company = getDemoCompany();
      tenantDb = getDb();
    }

    if (tenantDb) {
      user = loadTenantUser(tenantDb, session.uid);
    }
  }

  return { session, account, company, tenantDb, user };
}

export function requireAccount(req, res, next) {
  const ctx = resolveSessionContext(req);
  if (!ctx?.account) {
    return res.status(401).json({ error: 'Inicia sesión con tu correo electrónico para continuar.' });
  }
  req.account = ctx.account;
  req.company = ctx.company;
  req.user = ctx.user;
  req.sessionData = ctx.session;
  if (ctx.tenantDb) {
    return runWithDb(ctx.tenantDb, () => next());
  }
  return next();
}

export function requireAuth(req, res, next) {
  const ctx = resolveSessionContext(req);
  if (!ctx?.user || !ctx?.tenantDb) {
    return res.status(401).json({ error: 'Sesión no iniciada o expirada. Ingrese nuevamente.' });
  }
  req.user = ctx.user;
  req.account = ctx.account;
  req.company = ctx.company;
  req.sessionData = ctx.session;
  return runWithDb(ctx.tenantDb, () => next());
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

export function buildSystemBadges(db, companyId, runComplianceAuditFn) {
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
  const compliance = runComplianceAuditFn(db);
  const pendingAffiliations = companyId ? getPendingAffiliationsCount(companyId) : 0;

  return {
    pending_restocks: Number(pendingRestocks || 0),
    pending_mermas: Number(pendingMermas || 0),
    pending_deposits: Number(pendingDeposits || 0),
    unreconciled_qr: Number(unreconciledQr || 0),
    unvalidated_shifts: Number(unvalidatedShifts || 0),
    pending_affiliations: Number(pendingAffiliations || 0),
    active_shift: activeShift || null,
    compliance_score: compliance.score,
    compliance_overall: compliance.overall,
    compliance_critical: compliance.critical_count,
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
