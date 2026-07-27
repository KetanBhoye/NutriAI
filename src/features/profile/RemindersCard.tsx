import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { colors, type } from '@/theme';
import { remindersEnabled, sendPreviewReminder, setRemindersEnabled } from '@/notifications/reminders';

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
          <Text style={styles.title}>Daily log reminder</Text>
          <Text style={styles.sub}>A nudge at 8pm if you still have calories left to log.</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={toggle}
          disabled={busy}
          trackColor={{ true: colors.accent, false: colors.surface2 }}
          thumbColor="#fff"
        />
      </View>

      {enabled ? (
        <Button title="Send a sample" variant="ghost" onPress={sendPreviewReminder} style={styles.sample} />
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Text style={styles.note}>
        Reminders are scheduled on this device, so they work without an account or a server — but the wording
        reflects your log as of the last time you opened the app.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  text: { flex: 1 },
  title: { ...type.subheading, color: colors.text },
  sub: { ...type.caption, color: colors.textDim, marginTop: 2 },
  sample: { marginTop: 14 },
  message: { ...type.caption, color: colors.warn, marginTop: 12 },
  note: { ...type.caption, fontSize: 11.5, color: colors.textDim, marginTop: 12, lineHeight: 16 },
});
