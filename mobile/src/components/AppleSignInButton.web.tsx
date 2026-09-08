/**
 * Sign in with Apple, on the web — deliberately absent.
 *
 * `expo-apple-authentication` wraps the native AuthenticationServices
 * framework and has no browser implementation; calling it here would throw.
 *
 * Apple's guideline 4.8 is a requirement on the *iOS app*, not on this PWA,
 * and the web already offers Google Identity Services alongside email and
 * password. Doing this properly on the web would mean Apple's JS-based flow
 * with its own service ID and redirect URL — a separate credential and a
 * separate server route to verify against a different audience. Worth adding
 * if web sign-in demand appears; not worth a half-working button before then.
 */
export function AppleSignInButton(_props: { mode: 'signin' | 'signup' }) {
  return null;
}
