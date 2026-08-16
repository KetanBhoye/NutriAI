import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { accountApi } from '@/api';
import { useAuth } from '@/auth';
import { colors, fonts, radius, tap } from '@/theme';
import { GOOGLE_IOS_CLIENT_ID } from '@/config';

interface GoogleSignInButtonProps {
  mode: 'signin' | 'signup';
}

/**
 * Mirrors the web app's AuthView: only renders once GET /api/auth/config
 * confirms a Google OAuth client is configured server-side. `webClientId` is
 * what POST /api/auth/google actually verifies the returned ID token's
 * audience against; `iosClientId` is required because this project has no
 * GoogleService-Info.plist for the SDK to read it from automatically.
 */
export function GoogleSignInButton({ mode }: GoogleSignInButtonProps) {
  const { refreshUser } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    accountApi
      .getAuthConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (!cfg.googleClientId) {
          // Not an error: a server with no Google client configured should
          // simply not offer the button.
          console.warn('[google] no client id from /api/auth/config');
          return;
        }
        GoogleSignin.configure({ webClientId: cfg.googleClientId, iosClientId: GOOGLE_IOS_CLIENT_ID });
        setClientId(cfg.googleClientId);
      })
      .catch((e) => {
        /**
         * `configure()` throwing used to disappear entirely: getAuthConfig has
         * its own catch, but nothing covered the callback body, so a failure
         * there became an unhandled rejection and the button silently never
         * appeared — indistinguishable from a server with Google sign-in
         * switched off.
         */
        console.warn('[google] sign-in unavailable:', (e as Error)?.message ?? e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!clientId) return null;

  const onPress = async () => {
    setError(null);
    setBusy(true);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      const idToken = result.data?.idToken;
      if (!idToken) throw new Error('No ID token returned by Google.');
      await accountApi.googleSignIn(idToken);
      await refreshUser();
    } catch (e: any) {
      if (e?.code !== statusCodes.SIGN_IN_CANCELLED) {
        console.error('Google sign-in failed:', e?.code, e?.message, e);
        setError(`Google sign-in failed: ${e?.message ?? e?.code ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>
      <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={onPress} disabled={busy}>
        <Text style={styles.text}>
          {busy ? 'Signing in…' : mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { color: colors.textDim, fontSize: 12, marginHorizontal: 10 },
  button: {
    minHeight: tap,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  text: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center', marginTop: 10 },
});
