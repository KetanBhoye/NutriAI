import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { AuthProvider, useAuth } from '@/auth';
import { applyDefaultFont } from '@/components/applyDefaultFont';
import { colors } from '@/theme';

applyDefaultFont();

// Hold the native splash until fonts are ready, so no frame renders in the
// fallback system font and then reflows once Inter loads.
void SplashScreen.preventAutoHideAsync();

/** Redirects between login, onboarding and the app based on auth state. */
function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inApp = segments[0] === '(tabs)';
    const inOnboarding = segments[0] === 'onboarding';

    if (!user && (inApp || inOnboarding)) {
      router.replace('/login');
    } else if (user && !user.onboarded && !inOnboarding) {
      router.replace('/onboarding');
    } else if (user && user.onboarded && !inApp) {
      router.replace('/(tabs)');
    }
  }, [user, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  // Font loading can hang rather than fail — on a device build the assets
  // resolve differently than through Metro, and `useFonts` then neither
  // resolves nor errors. Rendering `null` in that state leaves a permanently
  // black screen, so give up waiting after a moment and render in the system
  // font: a degraded look beats a dead app.
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaitedTooLong(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const ready = fontsLoaded || !!fontError || waitedTooLong;

  // Hide the splash as soon as we're ready, even if the first layout pass
  // hasn't fired — otherwise a missed onLayout keeps the splash up forever.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <AuthProvider>
          <StatusBar style="light" />
          <AuthGate />
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  );
}
