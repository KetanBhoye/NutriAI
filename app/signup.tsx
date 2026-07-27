import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { useAuth } from '@/auth';
import { ApiError } from '@/api';

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
      // On success the auth gate redirects into the app automatically.
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

        <TextInput
          style={styles.input}
          placeholder="Name"
          placeholderTextColor="#6b7280"
          autoCapitalize="words"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#6b7280"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password (min 8 characters)"
          placeholderTextColor="#6b7280"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={onSubmit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.button, (busy || pressed) && styles.buttonPressed]}
          onPress={onSubmit}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign up</Text>}
        </Pressable>

        <Link href="/login" style={styles.link}>
          <Text style={styles.linkText}>Already have an account? Sign in</Text>
        </Link>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0f1a' },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo: { color: '#f3f4f6', fontSize: 30, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#9ca3af', fontSize: 15, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  input: {
    backgroundColor: '#151c2c',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#f3f4f6',
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1f2a44',
  },
  error: { color: '#f87171', marginBottom: 12, textAlign: 'center' },
  button: {
    backgroundColor: '#5b8cff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { marginTop: 20, alignSelf: 'center' },
  linkText: { color: '#5b8cff', fontSize: 15, fontWeight: '600' },
});
