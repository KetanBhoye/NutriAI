import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth';
import { ApiError } from '@/api';
import { Button, FadeIn, TextField } from '@/components/ui';
import { BrandMark } from '@/components/BrandMark';
import { colors, fonts, radius, space } from '@/theme';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

/**
 * The first screen anyone sees.
 *
 * Every vertical measurement comes from the `space` scale in the theme, so the
 * rhythm is deliberate rather than a pile of one-off numbers. Two things made
 * it look uneven before:
 *
 *  - `TextField` carries its own 12px bottom margin, and this screen added a
 *    12px `gap` on top of it. The fields ended up 24px apart while everything
 *    around them sat at 12 — the sort of thing you feel before you can name
 *    it. Spacing between fields is now the field's own margin, once.
 *  - `GoogleSignInButton` draws its own "or" rule, so the one added here made
 *    two of them.
 */

const PROOF = [
  'Log a meal by photo, barcode or a sentence',
  'A coach that knows your day, not a generic plan',
  'Steps and workouts from your phone, counted in',
];

/**
 * What to show when a request fails.
 *
 * The server now returns a sentence for a validation failure, but this is the
 * screen where a raw `ZodError` dump once landed in front of a user, so it
 * refuses anything shaped like a payload rather than a message. Belt and
 * braces across a boundary that has already failed once.
 */
function readableError(e: unknown): string {
  const fallback = 'Something went wrong. Try again.';
  if (!(e instanceof ApiError)) return fallback;
  const message = e.message?.trim() ?? '';
  if (!message) return fallback;
  if (message.length > 140 || /[{}[\]]|"code"|"path"/.test(message)) return fallback;
  return message;
}

export default function Login() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    // Answer locally rather than making someone wait for a round trip to be
    // told they left a field blank.
    if (!email.trim() || !password) {
      setError(!email.trim() ? 'Enter your email address.' : 'Enter your password.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    // `testID` rather than a copy assertion for "am I on the login screen":
    // the E2E flows need an identity, and the subtitle they used to match on
    // was marketing copy that has now changed once and will change again.
    <SafeAreaView style={styles.safe} testID="login-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <FadeIn index={0} distance={14}>
            <View style={styles.brand}>
              {/* Two concentric discs rather than one: a single flat disc has a
                  hard edge, which reads as a plate behind the mark instead of
                  light coming off it. */}
              <View style={styles.haloOuter} />
              <View style={styles.haloInner} />
              <BrandMark size={88} />
            </View>

            <Text style={styles.wordmark}>NutriAI</Text>
            <Text style={styles.pitch}>Tell it what you ate. It works out the rest.</Text>
          </FadeIn>

          <FadeIn index={1} distance={14} style={styles.proof}>
            {PROOF.map((line) => (
              <View key={line} style={styles.proofRow}>
                <View style={styles.dot} />
                <Text style={styles.proofText}>{line}</Text>
              </View>
            ))}
          </FadeIn>

          <FadeIn index={2} distance={14} style={styles.form}>
            <TextField
              placeholder="Email"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
            />
            <TextField
              placeholder="Password"
              secureTextEntry
              autoComplete="password"
              returnKeyType="go"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={onSubmit}
            />

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Button title="Sign in" onPress={onSubmit} busy={busy} />

            {/* Draws its own "or" rule and its own top margin. */}
            <GoogleSignInButton mode="signin" />
          </FadeIn>

          <FadeIn index={3} distance={14}>
            {/* `router.push` on a plain Pressable rather than `<Link asChild>`:
                Link clones its child and passes its own `style` down, which
                overrode this one — the card rendered as bare left-aligned text
                with no border or background. */}
            <Pressable
              onPress={() => router.push('/signup')}
              style={({ pressed }) => [styles.newHere, pressed && styles.newHerePressed]}
              accessibilityRole="button"
              accessibilityLabel="Create an account"
            >
              <Text style={styles.newHereLead}>New to NutriAI?</Text>
              <Text style={styles.newHereCta}>Create an account</Text>
            </Pressable>
          </FadeIn>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const HALO_OUTER = 156;
const HALO_INNER = 106;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.xxl,
  },

  brand: { alignItems: 'center', justifyContent: 'center' },
  haloOuter: {
    position: 'absolute',
    width: HALO_OUTER,
    height: HALO_OUTER,
    borderRadius: HALO_OUTER / 2,
    backgroundColor: 'rgba(74,222,128,0.045)',
  },
  haloInner: {
    position: 'absolute',
    width: HALO_INNER,
    height: HALO_INNER,
    borderRadius: HALO_INNER / 2,
    backgroundColor: 'rgba(74,222,128,0.06)',
  },

  wordmark: {
    color: colors.text,
    fontSize: 32,
    lineHeight: 38,
    fontFamily: fonts.extrabold,
    textAlign: 'center',
    marginTop: space.lg,
    letterSpacing: -0.4,
  },
  pitch: {
    color: colors.textDim,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: space.sm,
  },

  // One grouping step from the pitch above and the form below.
  proof: { marginTop: space.xl, alignSelf: 'center', gap: space.md },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.accent },
  proofText: { color: colors.textDim, fontSize: 14, lineHeight: 20, flexShrink: 1 },

  // No `gap`: TextField brings its own 12px bottom margin, and adding a gap
  // here is what made the fields sit twice as far apart as everything else.
  form: { marginTop: space.xxl },

  errorBox: {
    backgroundColor: 'rgba(248,113,113,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
    borderRadius: radius - 4,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    marginBottom: space.md,
  },
  errorText: { color: colors.danger, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },

  newHere: {
    marginTop: space.xl,
    alignSelf: 'center',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 2,
  },
  newHerePressed: { opacity: 0.85, borderColor: colors.accentDim },
  newHereLead: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  newHereCta: { color: colors.accent, fontSize: 15.5, lineHeight: 21, fontFamily: fonts.semibold },
});
