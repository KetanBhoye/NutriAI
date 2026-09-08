import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { accountApi } from '@/api';
import { useAuth } from '@/auth';
import { colors, fonts, radius, tap } from '@/theme';

/**
 * Sign in with Apple.
 *
 * Not a nice-to-have. Guideline 4.8 requires an equivalent privacy-preserving
 * login wherever an app offers a third-party social login, and this app offers
 * Google — so an iOS build without this button is rejected, not warned.
 *
 * Rendered only where it can actually work:
 *
 *  - **iOS only.** The requirement is Apple's and applies to the iOS app.
 *    Android has no native Sign in with Apple; offering it there would mean a
 *    web OAuth detour that is worse than the Google button already present.
 *  - **Only once `isAvailableAsync` says so.** It is false on iOS below 13 and
 *    in some enterprise configurations. Apple rejects a *non-functional*
 *    button as readily as a missing one.
 *
 * Apple's own component is used rather than a styled Pressable, because the
 * Human Interface Guidelines require their button's exact appearance — the
 * same reason the Google button on web has to be Google's own.
 */

interface AppleSignInButtonProps {
  mode: 'signin' | 'signup';
}

export function AppleSignInButton({ mode }: AppleSignInButtonProps) {
  const { refreshUser } = useAuth();
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => {
        if (!cancelled) setAvailable(ok);
      })
      .catch(() => {
        // An unavailable check is itself an unavailable button. Never a crash:
        // this sits on the login screen, the one place an error is fatal.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  const onPress = async () => {
    setError(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) throw new Error('Apple returned no identity token.');

      /**
       * Sent now or lost forever.
       *
       * Apple releases the name and email on the FIRST authorization only.
       * Every later sign-in returns nulls, by design — so these are forwarded
       * on the one occasion they exist, and the server keys the account on
       * the token's `sub` from then on. A build that ignored them here would
       * work in testing (the tester's first run) and create nameless accounts
       * for everyone who ever reinstalled.
       */
      const name = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean)
        .join(' ')
        .trim();

      await accountApi.appleSignIn({
        identityToken: credential.identityToken,
        name: name || undefined,
        email: credential.email || undefined,
      });
      await refreshUser();
    } catch (e) {
      // Dismissing the sheet is a choice, not a failure, and must not paint
      // the screen red.
      if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return;
      setError((e as Error)?.message ?? 'Apple sign-in failed. Try again.');
    }
  };

  return (
    <View style={styles.wrap}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={
          mode === 'signup'
            ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
            : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
        }
        // The app is dark throughout; Apple's white button would be the one
        // glaring rectangle on the screen.
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
        cornerRadius={radius}
        style={styles.button}
        onPress={onPress}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  // Height is set here rather than left to the component: Apple's button has
  // no intrinsic height in a flex layout and collapses to nothing without it.
  button: { height: tap, width: '100%' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center', marginTop: 10, fontFamily: fonts.regular },
});
