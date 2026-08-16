import type { Request } from 'express';
import type { AuthUser, D1DatabaseCompat } from '../db/types.js';
import { hashSha256 } from './security.js';
import { isoNow } from '../db/time.js';

export function extractBearerToken(headerValue?: string): string | null {
  if (!headerValue || !headerValue.startsWith('Bearer ')) {
    return null;
  }
  return headerValue.slice(7).trim() || null;
}

export async function verifyBearerToken(
  db: D1DatabaseCompat,
  token: string
): Promise<AuthUser | null> {
  const tokenHash = hashSha256(token);

  const oauthTokenResult = await db
    .prepare(
      `SELECT t.user_id, u.role
       FROM oauth_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.expires_at > ?`
    )
    .bind(tokenHash, isoNow())
    .first<{ user_id: string; role: string }>();

  if (oauthTokenResult) {
    return {
      userId: oauthTokenResult.user_id,
      isAdmin: oauthTokenResult.role === 'admin',
    };
  }

  const clientSecretResult = await db
    .prepare(
      `SELECT c.user_id, c.is_admin
       FROM oauth_clients c
       WHERE c.client_secret_hash = ?`
    )
    .bind(tokenHash)
    .first<{ user_id: string; is_admin: number }>();

  if (clientSecretResult) {
    return {
      userId: clientSecretResult.user_id,
      isAdmin: Boolean(clientSecretResult.is_admin),
    };
  }

  const apiKeyResult = await db
    .prepare('SELECT id, role FROM users WHERE api_key_hash = ?')
    .bind(tokenHash)
    .first<{ id: string; role: string }>();

  if (apiKeyResult) {
    return {
      userId: apiKeyResult.id,
      isAdmin: apiKeyResult.role === 'admin',
    };
  }

  return null;
}

export async function authenticateRequestBearer(
  db: D1DatabaseCompat,
  request: Pick<Request, 'headers'>
): Promise<AuthUser | null> {
  const token = extractBearerToken(request.headers.authorization);

  if (!token) {
    return null;
  }

  return verifyBearerToken(db, token);
}
