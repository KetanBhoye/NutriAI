import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import z from 'zod';
import type { D1DatabaseCompat } from '../db/types.js';
import { isoNow } from '../db/time.js';
import {
  getSessionIdFromCookie,
  getSessionUser,
} from './session.js';
import {
  hashSha256,
  randomToken,
  verifyPkceS256,
} from './security.js';

interface OAuthRouterOptions {
  db: D1DatabaseCompat;
  adminApiKey: string;
  baseUrl: string;
}

const TRUSTED_PUBLIC_REGISTRATION_HOSTS = new Set([
  'claude.ai',
  'claude.com',
  'chatgpt.com',
  'chat.openai.com',
  '127.0.0.1',
  'localhost',
]);

const registerSchema = z.object({
  client_name: z.string().min(1),
  redirect_uris: z.array(z.string().url()).min(1),
  user_id: z.string().min(1).default('admin'),
  scope: z.string().optional(),
});

const authorizeSchema = z.object({
  response_type: z.string().optional(),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  state: z.string().optional(),
  scope: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
});

function getBaseUrl(req: Request, fallback: string): string {
  const host = req.headers.host;
  if (!host) {
    return fallback;
  }

  const protocol = req.headers['x-forwarded-proto']?.toString().split(',')[0] || req.protocol;
  return `${protocol}://${host}`;
}

function sendOAuthError(
  res: Response,
  status: number,
  error: string,
  description?: string
): void {
  res.status(status).json({
    error,
    ...(description ? { error_description: description } : {}),
  });
}

async function verifyClient(
  db: D1DatabaseCompat,
  clientId: string,
  clientSecret?: string
): Promise<
  | {
      client_id: string;
      user_id: string;
      is_admin: number;
      redirect_uris: string;
      scope: string | null;
    }
  | null
> {
  const client = await db
    .prepare(
      'SELECT client_id, user_id, is_admin, redirect_uris, scope, client_secret_hash FROM oauth_clients WHERE client_id = ?'
    )
    .bind(clientId)
    .first<{
      client_id: string;
      user_id: string;
      is_admin: number;
      redirect_uris: string;
      scope: string | null;
      client_secret_hash: string;
    }>();

  if (!client) {
    return null;
  }

  if (clientSecret && hashSha256(clientSecret) !== client.client_secret_hash) {
    return null;
  }

  if (!clientSecret) {
    return null;
  }

  return {
    client_id: client.client_id,
    user_id: client.user_id,
    is_admin: client.is_admin,
    redirect_uris: client.redirect_uris,
    scope: client.scope,
  };
}

async function getClientById(
  db: D1DatabaseCompat,
  clientId: string
): Promise<
  | {
      client_id: string;
      user_id: string;
      is_admin: number;
      redirect_uris: string;
      scope: string | null;
    }
  | null
> {
  const client = await db
    .prepare(
      'SELECT client_id, user_id, is_admin, redirect_uris, scope FROM oauth_clients WHERE client_id = ?'
    )
    .bind(clientId)
    .first<{
      client_id: string;
      user_id: string;
      is_admin: number;
      redirect_uris: string;
      scope: string | null;
    }>();

  return client || null;
}

function parseRedirectUris(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const expanded = parsed
        .filter((value): value is string => typeof value === 'string')
        .flatMap((value) =>
          value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        );
      return expanded;
    }
  } catch {
    // Ignore parse errors and treat as no URIs.
  }

  return [];
}

function normalizeRedirectUri(raw: string): string | null {
  try {
    const url = new URL(raw);
    let pathname = url.pathname;
    if (pathname.length > 1) {
      pathname = pathname.replace(/\/+$/, '');
    }
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    return null;
  }
}

function redirectUriMatches(
  requestedRedirectUri: string,
  registeredRedirectUri: string
): boolean {
  if (requestedRedirectUri === registeredRedirectUri) {
    return true;
  }

  const requestedNormalized = normalizeRedirectUri(requestedRedirectUri);
  const registeredNormalized = normalizeRedirectUri(registeredRedirectUri);
  if (!requestedNormalized || !registeredNormalized) {
    return false;
  }

  return requestedNormalized === registeredNormalized;
}

function isRedirectUriAllowed(
  requestedRedirectUri: string,
  registeredRedirectUris: string[]
): boolean {
  return registeredRedirectUris.some((registered) =>
    redirectUriMatches(requestedRedirectUri, registered)
  );
}

function parseBasicAuthHeader(
  authHeader: string | undefined
): { clientId: string; clientSecret: string } | null {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex <= 0) {
      return null;
    }

    return {
      clientId: decoded.slice(0, separatorIndex),
      clientSecret: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function isTrustedPublicRegistration(redirectUris: string[]): boolean {
  return redirectUris.every((redirectUri) => {
    try {
      const parsed = new URL(redirectUri);
      if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        return false;
      }
      return TRUSTED_PUBLIC_REGISTRATION_HOSTS.has(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  });
}

export function createOAuthRouter(options: OAuthRouterOptions): Router {
  const router = Router();

  router.get('/.well-known/oauth-authorization-server', (req, res) => {
    const baseUrl = getBaseUrl(req, options.baseUrl);

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:tools'],
    });
  });

  router.get('/.well-known/oauth-protected-resource', (req, res) => {
    const baseUrl = getBaseUrl(req, options.baseUrl);

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:tools'],
    });
  });

  router.post('/oauth/register', async (req, res) => {
    try {
      const parsedBody = registerSchema.safeParse(req.body);
      if (!parsedBody.success) {
        sendOAuthError(res, 400, 'invalid_request', parsedBody.error.message);
        return;
      }

      const body = parsedBody.data;
      const apiKeyHeader = req.headers['x-api-key'];
      const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
      const hasAdminApiKey = Boolean(apiKey && apiKey === options.adminApiKey);

      if (!hasAdminApiKey && !isTrustedPublicRegistration(body.redirect_uris)) {
        sendOAuthError(
          res,
          401,
          'unauthorized',
          'Admin API key required for untrusted redirect URI registration'
        );
        return;
      }

      const userId = hasAdminApiKey ? body.user_id : 'admin';

      const user = await options.db
        .prepare('SELECT id, role FROM users WHERE id = ?')
        .bind(userId)
        .first<{ id: string; role: string }>();

      if (!user) {
        sendOAuthError(res, 400, 'invalid_request', 'user_id does not exist');
        return;
      }

      const clientId = randomUUID();
      const clientSecret = randomToken(32);

      await options.db
        .prepare(
          `INSERT INTO oauth_clients
           (client_id, client_secret_hash, client_name, redirect_uris, scope, user_id, is_admin)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          clientId,
          hashSha256(clientSecret),
          body.client_name,
          JSON.stringify(body.redirect_uris),
          body.scope || 'mcp:tools',
          user.id,
          user.role === 'admin' ? 1 : 0
        )
        .run();

      res.status(201).json({
        client_id: clientId,
        client_secret: clientSecret,
        client_name: body.client_name,
        scope: body.scope || 'mcp:tools',
      });
    } catch (error) {
      console.error('OAuth register error:', error);
      sendOAuthError(res, 500, 'server_error', 'Failed to register OAuth client');
    }
  });

  router.get('/oauth/authorize', async (req, res) => {
    try {
      const parsed = authorizeSchema.safeParse(req.query);
      if (!parsed.success) {
        sendOAuthError(res, 400, 'invalid_request', parsed.error.message);
        return;
      }

      const params = parsed.data;

      if (params.response_type && params.response_type !== 'code') {
        sendOAuthError(res, 400, 'unsupported_response_type');
        return;
      }

      const client = await options.db
        .prepare('SELECT client_id, redirect_uris FROM oauth_clients WHERE client_id = ?')
        .bind(params.client_id)
        .first<{ client_id: string; redirect_uris: string }>();

      if (!client) {
        sendOAuthError(res, 401, 'invalid_client');
        return;
      }

      const redirectUris = parseRedirectUris(client.redirect_uris);
      if (!isRedirectUriAllowed(params.redirect_uri, redirectUris)) {
        sendOAuthError(res, 400, 'invalid_request', 'redirect_uri mismatch');
        return;
      }

      const sessionId = getSessionIdFromCookie(req.headers.cookie);
      const sessionUser = sessionId
        ? await getSessionUser(options.db, sessionId)
        : null;

      if (!sessionUser) {
        const currentUrl = new URL(req.originalUrl, getBaseUrl(req, options.baseUrl));
        const loginUrl = new URL('/login', getBaseUrl(req, options.baseUrl));
        loginUrl.searchParams.set('next', currentUrl.pathname + currentUrl.search);
        res.redirect(loginUrl.toString());
        return;
      }

      const authorizationCode = randomToken(24);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await options.db
        .prepare(
          `INSERT INTO oauth_authorization_codes
           (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          hashSha256(authorizationCode),
          params.client_id,
          sessionUser.userId,
          params.redirect_uri,
          params.code_challenge || null,
          params.code_challenge_method || null,
          params.scope || 'mcp:tools',
          expiresAt
        )
        .run();

      const redirectUrl = new URL(params.redirect_uri);
      redirectUrl.searchParams.set('code', authorizationCode);
      if (params.state) {
        redirectUrl.searchParams.set('state', params.state);
      }

      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error('OAuth authorize error:', error);
      sendOAuthError(res, 500, 'server_error', 'Failed to authorize request');
    }
  });

  router.post('/oauth/token', async (req, res) => {
    try {
      const grantType = String(req.body.grant_type || '');
      const basicAuth = parseBasicAuthHeader(req.headers.authorization?.toString());
      const clientId = String(req.body.client_id || basicAuth?.clientId || '');
      const clientSecret = String(req.body.client_secret || basicAuth?.clientSecret || '');

      if (!grantType || !clientId) {
        sendOAuthError(res, 400, 'invalid_request', 'Missing grant_type or client_id');
        return;
      }

      const client = clientSecret
        ? await verifyClient(options.db, clientId, clientSecret)
        : await getClientById(options.db, clientId);
      if (!client) {
        sendOAuthError(res, 401, 'invalid_client');
        return;
      }

      if (grantType === 'authorization_code') {
        const code = String(req.body.code || '');
        const codeVerifier = String(req.body.code_verifier || '');
        const redirectUri = String(req.body.redirect_uri || '');

        if (!code) {
          sendOAuthError(res, 400, 'invalid_request', 'Missing authorization code');
          return;
        }

        const codeRecord = await options.db
          .prepare(
            `SELECT client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope
             FROM oauth_authorization_codes
             WHERE code_hash = ? AND expires_at > ?`
          )
          .bind(hashSha256(code), isoNow())
          .first<{
            client_id: string;
            user_id: string;
            redirect_uri: string;
            code_challenge: string | null;
            code_challenge_method: string | null;
            scope: string | null;
          }>();

        if (!codeRecord || codeRecord.client_id !== client.client_id) {
          sendOAuthError(res, 400, 'invalid_grant', 'Invalid authorization code');
          return;
        }

        if (
          redirectUri &&
          !redirectUriMatches(redirectUri, codeRecord.redirect_uri)
        ) {
          sendOAuthError(res, 400, 'invalid_grant', 'redirect_uri mismatch');
          return;
        }

        if (codeRecord.code_challenge) {
          if (!codeVerifier) {
            sendOAuthError(res, 400, 'invalid_request', 'Missing code_verifier');
            return;
          }

          const challengeMethod = codeRecord.code_challenge_method || 'plain';
          const isPkceValid =
            challengeMethod === 'S256'
              ? verifyPkceS256(codeVerifier, codeRecord.code_challenge)
              : challengeMethod === 'plain'
                ? codeVerifier === codeRecord.code_challenge
                : false;

          if (!isPkceValid) {
            sendOAuthError(res, 400, 'invalid_grant', 'PKCE verification failed');
            return;
          }
        } else if (!clientSecret) {
          sendOAuthError(res, 400, 'invalid_request', 'Public clients must use PKCE');
          return;
        }

        const accessToken = randomToken(32);
        const refreshToken = randomToken(32);
        const expiresIn = 3600;
        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        await options.db
          .prepare(
            `INSERT INTO oauth_tokens
             (token_hash, refresh_token_hash, client_id, user_id, token_type, scope, expires_at)
             VALUES (?, ?, ?, ?, 'Bearer', ?, ?)`
          )
          .bind(
            hashSha256(accessToken),
            hashSha256(refreshToken),
            client.client_id,
            codeRecord.user_id,
            codeRecord.scope || 'mcp:tools',
            expiresAt
          )
          .run();

        await options.db
          .prepare('DELETE FROM oauth_authorization_codes WHERE code_hash = ?')
          .bind(hashSha256(code))
          .run();

        res.json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: expiresIn,
          refresh_token: refreshToken,
          scope: codeRecord.scope || 'mcp:tools',
        });
        return;
      }

      if (grantType === 'refresh_token') {
        const refreshToken = String(req.body.refresh_token || '');
        if (!refreshToken) {
          sendOAuthError(res, 400, 'invalid_request', 'Missing refresh_token');
          return;
        }

        const tokenRecord = await options.db
          .prepare(
            `SELECT user_id, scope
             FROM oauth_tokens
             WHERE refresh_token_hash = ? AND client_id = ?`
          )
          .bind(hashSha256(refreshToken), client.client_id)
          .first<{ user_id: string; scope: string | null }>();

        if (!tokenRecord) {
          sendOAuthError(res, 400, 'invalid_grant', 'Invalid refresh_token');
          return;
        }

        const accessToken = randomToken(32);
        const nextRefreshToken = randomToken(32);
        const expiresIn = 3600;
        const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        await options.db
          .prepare(
            `UPDATE oauth_tokens
             SET token_hash = ?, refresh_token_hash = ?, expires_at = ?, created_at = CURRENT_TIMESTAMP
             WHERE refresh_token_hash = ? AND client_id = ?`
          )
          .bind(
            hashSha256(accessToken),
            hashSha256(nextRefreshToken),
            expiresAt,
            hashSha256(refreshToken),
            client.client_id
          )
          .run();

        res.json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: expiresIn,
          refresh_token: nextRefreshToken,
          scope: tokenRecord.scope || 'mcp:tools',
        });
        return;
      }

      sendOAuthError(res, 400, 'unsupported_grant_type');
    } catch (error) {
      console.error('OAuth token error:', error);
      sendOAuthError(res, 500, 'server_error', 'Failed to issue token');
    }
  });

  return router;
}
