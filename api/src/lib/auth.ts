import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../db/pool.js';

const SESSION_COOKIE = 'mb_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionUser = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  avatarUrl: string | null;
  color: string;
  isAdmin: boolean;
};

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string, userAgent: string | undefined, reply: FastifyReply) {
  const token = newOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await pool.query(
    'insert into sessions (user_id, token_hash, user_agent, expires_at) values ($1, $2, $3, $4)',
    [userId, tokenHash, userAgent ?? null, expiresAt],
  );

  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (token) {
    await pool.query('delete from sessions where token_hash = $1', [hashToken(token)]);
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function currentUser(request: FastifyRequest): Promise<SessionUser | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;

  const { rows } = await pool.query(
    `select u.id, u.email, u.phone, u.name, u.avatar_url, u.color, u.is_admin
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    name: row.name,
    avatarUrl: row.avatar_url,
    color: row.color,
    isAdmin: row.is_admin,
  };
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  const user = await currentUser(request);
  if (!user) {
    reply.code(401).send({ error: 'not_authenticated' });
    return null;
  }
  return user;
}

export type BookRole = 'owner' | 'author' | 'editor' | 'reviewer';

// A book's actual membership role, except: a platform admin is always
// 'owner' everywhere (no membership row needed), and anyone with a session
// gets a read-only 'reviewer' on a book whose visibility is 'public' even
// without membership - membership stays reserved for granting edit/review
// access.
export async function roleInBook(userId: string, bookId: string): Promise<BookRole | null> {
  const { rows } = await pool.query(
    `select bm.role as member_role, b.visibility, u.is_admin
       from books b
       join users u on u.id = $1
       left join book_members bm on bm.book_id = b.id and bm.user_id = $1
      where b.id = $2 and b.deleted_at is null`,
    [userId, bookId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.is_admin) return 'owner';
  if (row.member_role) return row.member_role;
  if (row.visibility === 'public') return 'reviewer';
  return null;
}

const ROLE_RANK: Record<BookRole, number> = { reviewer: 0, editor: 1, author: 2, owner: 3 };

export function roleAtLeast(role: BookRole | null, min: BookRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

// ---- SSO handoff from the arith.land gateway (bazaar) ----
// bazaar mints a short-lived HS256 JWT (MbooksSsoGateway, same shape as the
// existing MathBallSsoGateway it already uses for MathBall - another
// separate stack with its own user table) right after its own phone-OTP
// login, so mbooks never has to know about SMS/OTP itself. Verified here
// by hand (base64url(header).base64url(payload).base64url(HMAC-SHA256))
// rather than pulling in a JWT library for one verify call.

export type SsoPayload = { phone_number: string; name: string; is_super_admin: boolean; exp: number };

function ssoSecret(): string {
  const secret = process.env.MBOOKS_SSO_SECRET;
  if (!secret) throw new Error('MBOOKS_SSO_SECRET is not set');
  return secret;
}

function base64urlJson(part: string): any {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function verifySsoToken(token: string): SsoPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, sigPart] = parts;

  let header: { alg?: string };
  try {
    header = base64urlJson(headerPart);
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;

  const expectedSig = createHmac('sha256', ssoSecret())
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');
  const a = Buffer.from(sigPart);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SsoPayload;
  try {
    payload = base64urlJson(payloadPart);
  } catch {
    return null;
  }
  if (!payload.phone_number || !payload.exp || Date.now() / 1000 > payload.exp) return null;
  return payload;
}

// Finds the user for this phone, creating one on first visit. Trusts the
// token's is_super_admin claim every time (not just at creation), so a
// promotion/demotion on the bazaar side takes effect on that person's next
// sign-in here without any manual step on mbooks.
export async function findOrCreateSsoUser(payload: SsoPayload): Promise<string> {
  const existing = await pool.query('select id from users where phone = $1', [payload.phone_number]);
  if (existing.rows[0]) {
    const userId = existing.rows[0].id;
    await pool.query('update users set name = $1, is_admin = $2, updated_at = now() where id = $3', [
      payload.name,
      payload.is_super_admin,
      userId,
    ]);
    return userId;
  }

  const created = await pool.query(
    `insert into users (phone, name, color, is_admin) values ($1, $2, $3, $4) returning id`,
    [payload.phone_number, payload.name, randomColor(), payload.is_super_admin],
  );
  return created.rows[0].id;
}

function randomColor(): string {
  const palette = ['#2563eb', '#16a34a', '#d97706', '#be185d', '#7c3aed', '#0891b2'];
  return palette[Math.floor(Math.random() * palette.length)];
}
