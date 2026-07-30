import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, type } from '@/theme';

/**
 * Shown when the numbers on screen came from the cache because the network
 * failed. Without it the app would present stale figures as if they were
 * current, which for a calorie total is actively misleading.
 */
export function StaleNotice({ label = "Showing your last saved data — couldn't reach the server." }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
    borderRadius: radius - 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  text: { ...type.caption, fontSize: 12, color: colors.warn },
});
