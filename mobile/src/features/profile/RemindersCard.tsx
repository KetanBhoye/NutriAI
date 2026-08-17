import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { colors, type } from '@/theme';
import { remindersEnabled, sendPreviewReminder, setRemindersEnabled } from '@/notifications/reminders';
import { MEAL_SLOTS } from '@/notifications/copy';
import {
  DELIVERY_SETTINGS_SUPPORTED,
  openAppSettings,
  openBatterySettings,
  openExactAlarmSettings,
} from '@/notifications/delivery';

export function RemindersCard() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

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

          {DELIVERY_SETTINGS_SUPPORTED ? (
            <View style={styles.help}>
              <Pressable onPress={() => setShowHelp((v) => !v)} hitSlop={8}>
                <Text style={styles.helpToggle}>
                  {showHelp ? 'Hide' : 'Reminders not arriving?'}
                </Text>
              </Pressable>

              {showHelp ? (
                <>
                  <Text style={styles.helpBody}>
                    Reminders are set on this phone, so they work with no signal and even when
                    NutriAI is closed. Android can still hold them back — two settings decide it.
                  </Text>
                  <Button
                    title="Allow exact alarms"
                    variant="ghost"
                    onPress={() => void openExactAlarmSettings()}
                    style={styles.helpButton}
                  />
                  <Text style={styles.helpHint}>
                    Lets a reminder arrive at the meal instead of whenever the phone next wakes up.
                  </Text>
                  <Button
                    title="Turn off battery optimisation"
                    variant="ghost"
                    onPress={() => void openBatterySettings()}
                    style={styles.helpButton}
                  />
                  <Text style={styles.helpHint}>
                    Find NutriAI in the list and set it to unrestricted. Some phones (vivo, iQOO,
                    Xiaomi, Oppo, Realme) also have an "auto-start" switch that has to be on —
                    that one lives in app settings.
                  </Text>
                  <Button
                    title="Open app settings"
                    variant="ghost"
                    onPress={() => void openAppSettings()}
                    style={styles.helpButton}
                  />
                </>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Text style={styles.note}>
        A meal you've already logged doesn't get a reminder. Reminders are scheduled on this device,
        so they work without a server — but they quote what you've logged as of the last time you
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
  help: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  helpToggle: { ...type.caption, color: colors.accent, fontSize: 13 },
  helpBody: { ...type.caption, fontSize: 11.5, color: colors.textDim, marginTop: 8, lineHeight: 16 },
  helpButton: { marginTop: 10 },
  helpHint: { ...type.caption, fontSize: 11, color: colors.textDim, marginTop: 6, lineHeight: 15 },
  message: { ...type.caption, color: colors.warn, marginTop: 12 },
  note: { ...type.caption, fontSize: 11.5, color: colors.textDim, marginTop: 12, lineHeight: 16 },
});
