import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius, type } from '@/theme';
import { UPDATES_SUPPORTED, checkForUpdate } from '@/updates';
import { dismissedVersion, rememberDismissal } from './bannerState';

/**
 * A line on Today when a newer build is waiting.
 *
 * Installing an update has always required knowing to go to You → App version,
 * which nobody does unprompted. The launch notification helps, but only if
 * notifications are allowed and only once — someone who swipes it away has no
 * remaining path to the update short of being told about it.
 *
 * Deliberately a banner rather than a modal: an update is worth mentioning,
 * never worth interrupting a meal log for. It is dismissible, and a dismissal
 * is remembered **per version**, so saying "not now" is honoured until there
 * is genuinely something new to say.
 *
 * Android-only, like the updater itself (see src/updates/).
 */
export function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!UPDATES_SUPPORTED) return;
    let cancelled = false;

    (async () => {
      try {
        const check = await checkForUpdate();
        if (cancelled || !check.available || !check.latestVersion) return;
        if ((await dismissedVersion()) === check.latestVersion) return;
        if (!cancelled) setVersion(check.latestVersion);
      } catch {
        // A background check the user never asked for has no business
        // reporting a failure on the log screen.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) return null;

  const dismiss = () => {
    void rememberDismissal(version);
    setVersion(null);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.main}
        onPress={() => router.push('/(tabs)/profile')}
        accessibilityRole="button"
        accessibilityLabel={`NutriAI ${version} is available. Opens the You tab to install it.`}
      >
        <Feather name="download" size={15} color={colors.accent} />
        <Text style={styles.text}>
          <Text style={styles.strong}>NutriAI {version}</Text> is ready — tap to install it from the
          You tab. Your log is untouched.
        </Text>
      </Pressable>
      <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Feather name="x" size={15} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(74,222,128,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.35)',
    borderRadius: radius - 4,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  text: { ...type.caption, fontSize: 12, color: colors.text, flex: 1, lineHeight: 17 },
  strong: { color: colors.accent, fontFamily: undefined },
});
