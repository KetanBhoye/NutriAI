import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';
import { getConfig } from './config.js';
import { CONSENT_VERSION } from './services/consent.js';

/**
 * Consent has to be evidenced, not assumed.
 *
 * Health data is special-category under GDPR and sensitive under India's DPDP
 * Act, so the lawful basis is explicit consent — and consent you cannot show,
 * per person, against a specific version of the text, is consent you do not
 * have. These tests pin that record, not the checkbox.
 */

globalThis.crypto.randomUUID = randomUUID as typeof globalThis.crypto.randomUUID;

let dir: string;
let running: Awaited<ReturnType<typeof createApp>>;

const signUp = (body: Record<string, unknown>) =>
  request(running.app).post('/api/auth/signup').send(body);

const base = () => ({
  name: 'Consent',
  email: `c${randomUUID()}@example.test`,
  password: 'Consent@1234',
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nutriai-consent-'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  running = await createApp({
    ...getConfig(),
    dbDriver: 'sqlite',
    databasePath: join(dir, 'consent.db'),
  });
});

afterEach(async () => {
  await running?.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('recording consent', () => {
  it('stores the policy version and the time it was given', async () => {
    // The version matters as much as the timestamp: consent is to a specific
    // text, and without it a policy change cannot be detected.
    const res = await signUp({ ...base(), accepted_terms: true });
    expect(res.status).toBe(201);

    const row = running.env.DB;
    const stored = await row
      .prepare('SELECT consent_version, consented_at FROM users WHERE id = ?')
      .bind(res.body.user.id)
      .first<{ consent_version: string | null; consented_at: string | null }>();

    expect(stored?.consent_version).toBe(CONSENT_VERSION);
    expect(stored?.consented_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('records nothing when the box was not ticked', async () => {
    // An account with no consent must be distinguishable from one with it, so
    // it can be asked later rather than silently treated as agreed.
    const res = await signUp(base());
    const stored = await running.env.DB
      .prepare('SELECT consent_version, consented_at FROM users WHERE id = ?')
      .bind(res.body.user.id)
      .first<{ consent_version: string | null; consented_at: string | null }>();

    expect(stored?.consent_version).toBeNull();
    expect(stored?.consented_at).toBeNull();
  });

  it('rejects a client that sends a false agreement rather than storing one', async () => {
    // `false` is not "no consent recorded", it is a client bug or a tampered
    // request. Failing loudly beats creating an account that looks consented.
    const res = await signUp({ ...base(), accepted_terms: false });
    expect(res.status).toBe(400);
  });
});

describe('the documents themselves', () => {
  it('serves the privacy policy and terms without a session', async () => {
    // A reviewer opens these in a clean browser. Requiring a login is a
    // rejection on both stores.
    for (const path of ['/privacy', '/privacy-policy', '/terms']) {
      const res = await request(running.app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.text).toContain('NutriAI');
    }
  });

  it('states the health-data promises Apple looks for', async () => {
    const res = await request(running.app).get('/privacy');
    const text = res.text.replace(/\s+/g, ' ').toLowerCase();
    expect(text).toContain('never used for advertising');
  });

  it('says the shared food database excludes identity', async () => {
    // The claim the repo design rests on; if the code ever stops honouring it,
    // this text becomes a false statement to regulators.
    // Whitespace-collapsed first: the source HTML wraps, so a phrase can be
    // split across a newline and a literal match would fail on formatting.
    const res = await request(running.app).get('/privacy');
    const flat = res.text.replace(/\s+/g, ' ');
    expect(flat).toMatch(/never contains your identity/i);
  });
});
