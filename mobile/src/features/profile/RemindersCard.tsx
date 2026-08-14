import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { colors, type } from '@/theme';
import { remindersEnabled, sendPreviewReminder, setRemindersEnabled } from '@/notifications/reminders';
import { MEAL_SLOTS } from '@/notifications/copy';

export function RemindersCard() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    remindersEnabled().then(setEnabled);
  }, []);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setMessage(null);
    const result = await setRemindersEnabled(next);
    setEnabled(result);
    if (next && !result) {
      setMessage('Notifications are turned off for NutriAI. Enable them in Settings, then try again.');
    }
    setBusy(false);
  };

  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.title}>Meal reminders</Text>
          <Text style={styles.sub}>
            A nudge at each meal, and a catch-up if one didn't get logged.
          </Text>
        </View>
        <Switch
          testID="reminder-toggle"
          value={enabled}
          onValueChange={toggle}
          disabled={busy}
          trackColor={{ true: colors.accent, false: colors.surface2 }}
          thumbColor="#fff"
        />
      </View>

      {enabled ? (
        <>
          <View style={styles.times}>
            {MEAL_SLOTS.map((slot) => (
              <View key={slot.meal} style={styles.timeRow}>
                <Text style={styles.timeMeal}>
                  {slot.meal[0]!.toUpperCase() + slot.meal.slice(1)}
                </Text>
                <Text style={styles.timeAt}>{slot.label}</Text>
              </View>
            ))}
          </View>

          <Button title="Send a sample" variant="ghost" onPress={sendPreviewReminder} style={styles.sample} />
        </>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Text style={styles.note}>
        A meal you've already logged doesn't get a reminder. Reminders are scheduled on this device,
        so they work without a server — today's quote what you've logged as of the last time you
        opened the app.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  text: { flex: 1 },
  title: { ...type.subheading, color: colors.text },
  sub: { ...type.caption, color: colors.textDim, marginTop: 2 },
  times: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  timeMeal: { ...type.caption, color: colors.text, fontSize: 13 },
  timeAt: { ...type.figureSmall, fontSize: 13, color: colors.accent },
  sample: { marginTop: 14 },
  message: { ...type.caption, color: colors.warn, marginTop: 12 },
  note: { ...type.caption, fontSize: 11.5, color: colors.textDim, marginTop: 12, lineHeight: 16 },
});
