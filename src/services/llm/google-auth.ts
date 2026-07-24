import { createSign } from 'node:crypto';

/**
 * Mints Google Cloud access tokens from either credential shape, with a small
 * process-level cache keyed on the credential. Shared by the Vertex food
 * parser and the Coach agent so token logic lives in one place.
 *
 *  - service_account  → JWT-bearer grant (signed with the SA private key)
 *  - authorized_user  → refresh-token grant (ADC from `gcloud auth
 *                       application-default login`, the path used when an org
 *                       policy blocks SA keys)
 */
interface Credential {
  type?: string;
  client_email?: string;
  private_key?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
}

const cache = new Map<string, { token: string; expiresAt: number }>();

export async function getGoogleAccessToken(credentialJson: string): Promise<string> {
  const cred = JSON.parse(credentialJson) as Credential;
  const cacheKey = cred.refresh_token || cred.private_key || cred.client_email || 'default';
  const now = Math.floor(Date.now() / 1000);

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  const body =
    cred.type === 'authorized_user'
      ? new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: cred.client_id!,
          client_secret: cred.client_secret!,
          refresh_token: cred.refresh_token!,
        })
      : serviceAccountAssertion(cred, now);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(cacheKey, { token: data.access_token, expiresAt: now + data.expires_in });
  return data.access_token;
}

function serviceAccountAssertion(cred: Credential, now: number): URLSearchParams {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({
    iss: cred.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const signingInput = `${header}.${claim}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(cred.private_key!, 'base64url');
  return new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${signingInput}.${signature}`,
  });
}
