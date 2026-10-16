import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../db/pool.js';

const SESSION_COOKIE = 'mb_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionUser = {
  id: string;
  email: string;
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
    `select u.id, u.email, u.name, u.avatar_url, u.color, u.is_admin
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

export async function roleInBook(userId: string, bookId: string): Promise<BookRole | null> {
  const { rows } = await pool.query(
    'select role from book_members where book_id = $1 and user_id = $2',
    [bookId, userId],
  );
  return rows[0]?.role ?? null;
}

const ROLE_RANK: Record<BookRole, number> = { reviewer: 0, editor: 1, author: 2, owner: 3 };

export function roleAtLeast(role: BookRole | null, min: BookRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
