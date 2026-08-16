import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, ThemeProvider, type Theme } from '@react-navigation/native';
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
import { NutriLoader } from '@/components/ui/NutriLoader';
import { colors } from '@/theme';

applyDefaultFont();

/**
 * The navigator's own theme.
 *
 * React Navigation defaults to a **light** theme whose background is
 * `rgb(242, 242, 242)`. Every screen here paints its own dark background, so
 * that was invisible until the tabs started cross-fading — and then it showed
 * as a white flash between scenes, because a fade briefly reveals whatever the
 * navigator is drawing underneath.
 *
 * Fixing it at the theme rather than per-navigator: the same white sits behind
 * modals, the stack, and anything added later, so patching one `sceneStyle`
 * would just move the bug somewhere less obvious.
 */
const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    border: colors.border,
    text: colors.text,
    primary: colors.accent,
  },
};

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
        <NutriLoader size={72} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        /**
         * A fade, not the platform's default push.
         *
         * These are not a navigation hierarchy — they are states: signed out,
         * onboarding, in the app. Sliding implies a back gesture that does not
         * exist, and the redirect is a `replace`, so the slide plays against a
         * screen the user can never return to. A cross-fade reads as the app
         * changing state, which is what happened.
         */
        animation: 'fade',
        animationDuration: 220,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
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
      <ThemeProvider value={navigationTheme}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <AuthProvider>
            <StatusBar style="light" />
            <AuthGate />
          </AuthProvider>
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
