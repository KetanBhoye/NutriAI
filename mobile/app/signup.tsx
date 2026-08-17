import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { useAuth } from '@/auth';
import { ApiError } from '@/api';
import { Button, TextField } from '@/components/ui';
import { colors, fonts, space } from '@/theme';
import { API_URL } from '@/config';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

export default function SignUp() {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (name.trim().length < 1) return setError('Please enter your name.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    // Checked here as well as disabling the button: consent has to be a real
    // decision, and an unchecked box must never reach the server.
    if (!accepted) return setError('Please accept the Terms and Privacy Policy to continue.');
    setBusy(true);
    try {
      await signUp(name.trim(), email.trim(), password, accepted);
      // On success the auth gate redirects into onboarding automatically.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create account. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
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
        <Text style={styles.logo}>Create account</Text>
        <Text style={styles.subtitle}>Start tracking with NutriAI</Text>

        <TextField placeholder="Name" autoCapitalize="words" value={name} onChangeText={setName} />
        <TextField
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />
        <TextField
          placeholder="Password (min 8 characters)"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={onSubmit}
        />

        {/*
          Unticked by default, and the button stays disabled until it is ticked.
          A pre-ticked box is not consent under GDPR, and health data is
          special-category — so this is the one control on the screen that must
          not be "helpful".
        */}
        <Pressable
          style={styles.consent}
          onPress={() => setAccepted((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          accessibilityLabel="Accept the Terms of Service and Privacy Policy"
        >
          <View style={[styles.box, accepted && styles.boxOn]}>
            {accepted ? <Text style={styles.tick}>✓</Text> : null}
          </View>
          <Text style={styles.consentText}>
            I agree to the{' '}
            <Text style={styles.legalLink} onPress={() => Linking.openURL(`${API_URL}/terms`)}>
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text style={styles.legalLink} onPress={() => Linking.openURL(`${API_URL}/privacy`)}>
              Privacy Policy
            </Text>
            , including how my health data is used.
          </Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title="Sign up"
          onPress={onSubmit}
          busy={busy}
          disabled={!accepted}
          style={styles.button}
        />

        <GoogleSignInButton mode="signup" />

        <Link href="/login" style={styles.link}>
          <Text style={styles.linkText}>Already have an account? Sign in</Text>
        </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: space.md },
  box: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.onAccent, fontSize: 14, fontWeight: '900', lineHeight: 16 },
  consentText: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 19 },
  legalLink: { color: colors.accent, textDecorationLine: 'underline' },
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 32 },
  logo: { color: colors.text, fontSize: 30, fontFamily: fonts.extrabold, textAlign: 'center' },
  subtitle: { color: colors.textDim, fontSize: 15, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  error: { color: colors.danger, marginBottom: 12, textAlign: 'center' },
  button: { marginTop: 8 },
  link: { marginTop: 20, alignSelf: 'center' },
  linkText: { color: colors.accent, fontSize: 15, fontFamily: fonts.semibold },
});
