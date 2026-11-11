import { getGoogleAccessToken } from './google-auth.js';
import { macComputeOnline } from './mac-compute.js';

/**
 * The access token for a Vertex call, tolerant of there being no usable Google
 * credential while the Mac worker is online.
 *
 * With the Mac answering, the token is only needed if the Mac fails and the
 * call falls through — so a missing or broken credential must not stop a
 * request the Mac could have served. `vertexFetch` refuses to reach Vertex
 * with the empty token this returns in that case.
 */
export async function vertexAccessToken(credentialJson: string | undefined): Promise<string> {
  if (!macComputeOnline()) return getGoogleAccessToken(credentialJson ?? '');
  if (!credentialJson) return '';
  try {
    return await getGoogleAccessToken(credentialJson);
  } catch {
    return '';
  }
}
