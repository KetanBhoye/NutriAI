import { createSign } from 'node:crypto';
import { buildSystemPrompt, type LlmProvider, type ParseContext } from './types.js';

/**
 * Google Gemini via **Vertex AI** (aiplatform.googleapis.com).
 *
 * Unlike the AI Studio Gemini API, Vertex bills to Google Cloud Billing — so
 * usage draws from a Cloud free-trial credit.
 *
 * Accepts either credential shape in GOOGLE_SERVICE_ACCOUNT_JSON:
 *  - a service-account key (`type: service_account`) → JWT-bearer grant, or
 *  - Application Default Credentials (`type: authorized_user`) → refresh-token
 *    grant. The ADC form is what you get from `gcloud auth application-default
 *    login`, and is the path to use when an org policy blocks SA key creation.
 *
 * Config:
 *   GCP_PROJECT                    the Cloud project id
 *   GCP_LOCATION                   region (default us-central1)
 *   GOOGLE_SERVICE_ACCOUNT_JSON    SA key JSON or ADC user-credential JSON
 *   LLM_MODEL                      model (default gemini-2.5-flash)
 */
interface Credential {
  type?: string;
  // service_account
  client_email?: string;
  private_key?: string;
  project_id?: string;
  // authorized_user (ADC)
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  quota_project_id?: string;
}

export class VertexProvider implements LlmProvider {
  readonly name = 'vertex';
  private cred: Credential;
  private project: string;
  private location: string;
  private model: string;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(config: {
    serviceAccountJson: string;
    project?: string;
    location?: string;
    model?: string;
  }) {
    this.cred = JSON.parse(config.serviceAccountJson) as Credential;
    this.project = config.project || this.cred.project_id || this.cred.quota_project_id || '';
    this.location = config.location || 'us-central1';
    this.model = config.model || 'gemini-2.5-flash';
    if (!this.project) {
      throw new Error('Vertex provider needs GCP_PROJECT.');
    }
  }

  /** Mints (and caches) a cloud-platform access token from the credential. */
  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60) {
      return this.cachedToken.token;
    }

    const body =
      this.cred.type === 'authorized_user'
        ? new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.cred.client_id!,
            client_secret: this.cred.client_secret!,
            refresh_token: this.cred.refresh_token!,
          })
        : this.serviceAccountAssertion(now);

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Vertex token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { token: data.access_token, expiresAt: now + data.expires_in };
    return data.access_token;
  }

  private serviceAccountAssertion(now: number): URLSearchParams {
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header = b64({ alg: 'RS256', typ: 'JWT' });
    const claim = b64({
      iss: this.cred.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    });
    const signingInput = `${header}.${claim}`;
    const signature = createSign('RSA-SHA256').update(signingInput).sign(this.cred.private_key!, 'base64url');
    return new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`,
    });
  }

  async parseFoodLog(userMessage: string, context: ParseContext): Promise<unknown> {
    const token = await this.accessToken();
    const url =
      `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.project}` +
      `/locations/${this.location}/publishers/google/models/${encodeURIComponent(this.model)}:generateContent`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(context) }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: VERTEX_RESPONSE_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Vertex request failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Vertex response contained no content');
    return JSON.parse(text);
  }
}

/** Same schema dialect as the AI Studio path (uppercase types, `nullable`). */
const VERTEX_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    understood: { type: 'BOOLEAN' },
    clarification: { type: 'STRING', nullable: true },
    entry_date: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          food_name: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unit: { type: 'STRING' },
          meal_type: { type: 'STRING', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
          calories: { type: 'NUMBER' },
          protein_g: { type: 'NUMBER' },
          carbs_g: { type: 'NUMBER' },
          fat_g: { type: 'NUMBER' },
        },
        required: ['food_name', 'quantity', 'unit', 'meal_type', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
      },
    },
  },
  required: ['understood', 'clarification', 'entry_date', 'items'],
} as const;
