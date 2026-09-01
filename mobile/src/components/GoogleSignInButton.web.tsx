import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { accountApi } from '@/api';
import { useAuth } from '@/auth';
import { colors, fonts, radius } from '@/theme';

/**
 * Google sign-in in a browser.
 *
 * The native build drives the Google SDK itself and styles its own button (see
 * GoogleSignInButton.tsx). That is not portable: the SDK is a native module,
 * and on the web the equivalent is Google Identity Services, which hands back
 * a credential only through *its own* rendered button. So this renders GIS's
 * button rather than the app's — the one visible place the PWA departs from
 * the native UI, and not by choice: Google's branding terms require their
 * button for their sign-in, and a custom control cannot receive the credential
 * from the ID flow anyway.
 *
 * Everything around it is kept identical — the same "or" divider, the same
 * width, the same position — so the screen still reads as the same screen.
 *
 * What comes back is an ID token, exactly as on native, and it goes to the
 * same `POST /api/auth/google`. This is the same flow the Vue app at /app has
 * always used; the backend sees no difference between the three clients.
 */

interface GoogleSignInButtonProps {
  mode: 'signin' | 'signup';
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/**
 * GIS is loaded on demand rather than from the HTML shell: it is a
 * third-party script on the critical path, and most launches are an
 * already-signed-in user who never sees this button. Resolving from a single
 * shared promise keeps the signin and signup screens from racing to add two
 * copies of the tag.
 */
let gsiPromise: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever —
      // this fails on a flaky connection, and on networks where Google is
      // blocked, where the right outcome is simply no button.
      gsiPromise = null;
      reject(new Error('Could not load Google sign-in.'));
    };
    document.head.appendChild(script);
  });
  return gsiPromise;
}

export function GoogleSignInButton({ mode }: GoogleSignInButtonProps) {
  const { refreshUser } = useAuth();
  const hostRef = useRef<View | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * GIS's button is drawn at a fixed pixel width, so it cannot inherit the
   * full-width layout the rest of the form uses — it has to be told. Measuring
   * the container is what keeps it flush with the "Sign in" button above it at
   * every screen size instead of a lone 320px control in a wider column.
   */
  const [width, setWidth] = useState(0);

  const onCredential = useCallback(
    async (response: { credential?: string }) => {
      if (!response.credential) return;
      setError(null);
      try {
        await accountApi.googleSignIn(response.credential);
        await refreshUser();
      } catch (e) {
        setError(`Google sign-in failed: ${(e as Error)?.message ?? 'unknown error'}`);
      }
    },
    [refreshUser]
  );

  // Keep the newest callback reachable from GIS, which captures whatever it
  // was initialized with: re-initializing on every render would tear down the
  // rendered button mid-click.
  const credentialRef = useRef(onCredential);
  credentialRef.current = onCredential;

  useEffect(() => {
    if (!width) return;
    let cancelled = false;

    (async () => {
      const cfg = await accountApi.getAuthConfig().catch(() => ({ googleClientId: null }));
      // Not an error: a server with no Google client configured should simply
      // not offer the button. Same rule as native.
      if (!cfg.googleClientId || cancelled) return;

      await loadGoogleScript().catch((e: Error) => {
        console.warn('[google] sign-in unavailable:', e.message);
      });
      const id = window.google?.accounts?.id;
      const host = hostRef.current as unknown as HTMLElement | null;
      if (!id || !host || cancelled) return;

      id.initialize({
        client_id: cfg.googleClientId,
        callback: (response) => void credentialRef.current(response),
      });
      // Emptied first so a re-render (a resize, say) replaces the button
      // rather than stacking a second one underneath it.
      host.innerHTML = '';
      id.renderButton(host, {
        theme: 'filled_black',
        size: 'large',
        shape: 'rectangular',
        text: mode === 'signup' ? 'signup_with' : 'continue_with',
        logo_alignment: 'center',
        // GIS clamps to 400 and rejects anything larger outright, which on a
        // tablet-width column would mean no button at all.
        width: Math.min(Math.round(width), 400),
      });
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [width, mode]);

  return (
    // Laid out even before GIS answers, because measuring is what triggers the
    // load — but collapsed to nothing until there is a button to show. Height
    // zero rather than `opacity: 0`: a server with no Google client configured
    // never renders a button, and an invisible one still takes its space, so
    // that left a blank gap and a floating "or" under the sign-in form.
    <View style={[styles.wrap, !ready && styles.collapsed]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>
      <View ref={hostRef} style={styles.host} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  // A zero-height box still reports its width to onLayout, which is what
  // keeps the measurement that starts all of this working while collapsed.
  collapsed: { height: 0, marginTop: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' },
  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { color: colors.textDim, fontSize: 12, marginHorizontal: 10 },
  // GIS draws its own button with its own corner radius; clipping it to the
  // app's keeps it from being the one square-cornered control on the screen.
  host: { alignItems: 'center', borderRadius: radius, overflow: 'hidden' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center', marginTop: 10, fontFamily: fonts.regular },
});

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize(config: { client_id: string; callback: (response: { credential?: string }) => void }): void;
          renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
        };
      };
    };
  }
}
