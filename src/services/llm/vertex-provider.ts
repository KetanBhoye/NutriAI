import { createSign } from 'node:crypto';
import { buildSystemPrompt, type LlmProvider, type ParseContext } from './types.js';

/**
 * Google Gemini via **Vertex AI** (aiplatform.googleapis.com).
 *
 * Unlike the AI Studio Gemini API, Vertex bills to Google Cloud Billing — so
 * usage draws from a Cloud free-trial credit. Auth is a service-account access
 * token (minted from the SA's private key with the JWT-bearer grant), which is
 * why this needs a service account JSON rather than a simple API key.
 *
 * Config:
 *   GCP_PROJECT                    the Cloud project id
 *   GCP_LOCATION                   region (default us-central1)
 *   GOOGLE_SERVICE_ACCOUNT_JSON    the full service-account key JSON
 *   LLM_MODEL                      model (default gemini-2.5-flash)
 */
interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export class VertexProvider implements LlmProvider {
  readonly name = 'vertex';
  private sa: ServiceAccount;
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
    this.sa = JSON.parse(config.serviceAccountJson) as ServiceAccount;
    this.project = config.project || this.sa.project_id || '';
    this.location = config.location || 'us-central1';
    this.model = config.model || 'gemini-2.5-flash';
    if (!this.project) {
      throw new Error('Vertex provider needs GCP_PROJECT (or project_id in the service account).');
    }
  }

  /** Mints (and caches) a cloud-platform access token from the service account. */
  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60) {
      return this.cachedToken.token;
    }

    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header = b64({ alg: 'RS256', typ: 'JWT' });
    const claim = b64({
      iss: this.sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    });
    const signingInput = `${header}.${claim}`;
    const signature = createSign('RSA-SHA256').update(signingInput).sign(this.sa.private_key, 'base64url');
    const jwt = `${signingInput}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
    if (!res.ok) {
      throw new Error(`Vertex token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { token: data.access_token, expiresAt: now + data.expires_in };
    return data.access_token;
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
