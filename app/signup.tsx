import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { useAuth } from '@/auth';
import { ApiError } from '@/api';
import { Button, TextField } from '@/components/ui';
import { colors, fonts } from '@/theme';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

export default function SignUp() {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (name.trim().length < 1) return setError('Please enter your name.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      await signUp(name.trim(), email.trim(), password);
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
        style={styles.container}
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

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button title="Sign up" onPress={onSubmit} busy={busy} style={styles.button} />

        <GoogleSignInButton mode="signup" />

        <Link href="/login" style={styles.link}>
          <Text style={styles.linkText}>Already have an account? Sign in</Text>
        </Link>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo: { color: colors.text, fontSize: 30, fontFamily: fonts.extrabold, textAlign: 'center' },
  subtitle: { color: colors.textDim, fontSize: 15, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  error: { color: colors.danger, marginBottom: 12, textAlign: 'center' },
  button: { marginTop: 8 },
  link: { marginTop: 20, alignSelf: 'center' },
  linkText: { color: colors.accent, fontSize: 15, fontFamily: fonts.semibold },
});
