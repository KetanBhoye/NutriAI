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
import { useAuth } from '@/auth';
import { ApiError } from '@/api';

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
        <Text style={styles.subtitle}>Sign in to sync your health data</Text>

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
          placeholder="Password"
          placeholderTextColor="#6b7280"
          secureTextEntry
          autoComplete="password"
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
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </Pressable>

        <Text style={styles.hint}>Use the same email &amp; password as the NutriAI web app.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0f1a' },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo: { color: '#5b8cff', fontSize: 40, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#9ca3af', fontSize: 15, textAlign: 'center', marginTop: 6, marginBottom: 32 },
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
  hint: { color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 20 },
});
