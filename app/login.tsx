import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { useAuth } from '@/auth';
import { ApiError } from '@/api';
import { Button, TextField } from '@/components/ui';
import { colors, fonts } from '@/theme';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
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
        <Text style={styles.logo}>NutriAI</Text>
        <Text style={styles.subtitle}>Sign in to keep tracking</Text>

        <TextField
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />
        <TextField
          placeholder="Password"
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={onSubmit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button title="Sign in" onPress={onSubmit} busy={busy} style={styles.button} />

        <GoogleSignInButton mode="signin" />

        <Link href="/signup" style={styles.link}>
          <Text style={styles.linkText}>New here? Create an account</Text>
        </Link>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo: { color: colors.accent, fontSize: 40, fontFamily: fonts.extrabold, textAlign: 'center' },
  subtitle: { color: colors.textDim, fontSize: 15, textAlign: 'center', marginTop: 6, marginBottom: 32 },
  error: { color: colors.danger, marginBottom: 12, textAlign: 'center' },
  button: { marginTop: 8 },
  link: { marginTop: 20, alignSelf: 'center' },
  linkText: { color: colors.accent, fontSize: 15, fontFamily: fonts.semibold },
});
