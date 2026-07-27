import { Stack, useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect } from 'react';
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

  // Render even if the fonts fail rather than hanging on the splash forever —
  // RN falls back to the system font, which is a degraded look, not a break.
  const ready = fontsLoaded || !!fontError;

  const onLayout = useCallback(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={onLayout}>
        <AuthProvider>
          <StatusBar style="light" />
          <AuthGate />
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  );
}
