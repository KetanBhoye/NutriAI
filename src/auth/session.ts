import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { D1DatabaseCompat } from '../db/types.js';
import { isoNow } from '../db/time.js';

const SESSION_COOKIE_NAME = 'ct_sid';

export interface SessionUser {
  userId: string;
  isAdmin: boolean;
  name: string;
  email: string;
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const key = decodeURIComponent(part.slice(0, idx));
        const value = decodeURIComponent(part.slice(idx + 1));
        acc[key] = value;
      }
      return acc;
    }, {});
}

export function getSessionIdFromCookie(cookieHeader?: string): string | null {
  const cookies = parseCookies(cookieHeader);
  return cookies[SESSION_COOKIE_NAME] || null;
}

export async function createSession(
  db: D1DatabaseCompat,
  userId: string,
  ttlHours: number
): Promise<{ sessionId: string; expiresAt: string }> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  await db
    .prepare('INSERT INTO web_sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(sessionId, userId, expiresAt)
    .run();

  return { sessionId, expiresAt };
}

export async function getSessionUser(
  db: D1DatabaseCompat,
  sessionId: string
): Promise<SessionUser | null> {
  const result = await db
    .prepare(
      `SELECT s.user_id, u.role, u.name, u.email
       FROM web_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_id = ? AND s.expires_at > ?`
    )
    .bind(sessionId, isoNow())
    .first<{ user_id: string; role: string; name: string; email: string }>();

  if (!result) {
    return null;
  }

  return {
    userId: result.user_id,
    isAdmin: result.role === 'admin',
    name: result.name,
    email: result.email,
  };
}

export async function destroySession(
  db: D1DatabaseCompat,
  sessionId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM web_sessions WHERE session_id = ?')
    .bind(sessionId)
    .run();
}

export function setSessionCookie(
  res: Response,
  sessionId: string,
  expiresAt: string,
  secure: boolean
): void {
  const expires = new Date(expiresAt);
  const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', cookie);
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  const cookie = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(0).toUTCString()}${secure ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', cookie);
}
