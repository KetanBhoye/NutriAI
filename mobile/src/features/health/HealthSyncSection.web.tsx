import { StyleSheet, Text, View } from 'react-native';
import { colors, type } from '@/theme';

/**
 * Health sync, in a browser — which can't do it, and shouldn't pretend to.
 *
 * Steps, active energy and weight come from Apple Health and Health Connect.
 * Both are OS databases reachable only by an installed native app holding a
 * granted permission; there is no browser equivalent and no partial one. The
 * Web APIs that sound close (Sensors, Web Bluetooth) read a live device, not
 * the health record, and would produce a different and worse number.
 *
 * The section stays rather than being hidden, because the data itself is not
 * missing here: whatever the phone app has already synced is on the server,
 * and every calorie figure in this PWA counts it. What's unavailable is the
 * *connection*, and a user looking for why their steps appear needs to be
 * told where they come from — an absent section answers nothing.
 */
export function HealthSyncSection() {
  return (
    <View>
      <Text style={styles.title}>Synced from your phone</Text>
      <Text style={styles.body}>
        Steps, workouts and weight come from Apple Health or Health Connect, which only the iOS and
        Android apps can read. Anything they've synced is counted in your totals here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...type.subheading, color: colors.text },
  body: { ...type.caption, color: colors.textDim, marginTop: 6, lineHeight: 18 },
});
