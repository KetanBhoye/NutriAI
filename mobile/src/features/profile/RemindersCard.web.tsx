import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { colors, type } from '@/theme';
import {
  disablePush,
  enablePush,
  type EnableResult,
  pushEnabled,
  pushSupported,
  sendSamplePush,
} from '@/notifications/push.web';

/**
 * Reminders in a browser.
 *
 * The phone schedules its own — four per-meal alarms set by the OS, which is
 * why they work with no signal and with the app closed (see RemindersCard.tsx
 * and notifications/reminders.ts). A browser cannot do that at all: nothing of
 * ours runs while the tab is shut, so a locally scheduled reminder would
 * simply never fire, and the honest version of this card is not the same card
 * with a dead switch in it.
 *
 * What a browser *can* do is receive a push the server sends, and this backend
 * already sends one — the evening nudge in src/services/reminders.ts, built
 * from the same day's totals and already used by the app at /app. So this
 * subscribes to that rather than pretending to schedule anything.
 *
 * The difference is real and is stated on the card, because a user who set
 * four meal reminders on their phone and sees a switch here would otherwise
 * reasonably assume they had just set four more.
 */
export function RemindersCard() {
  const [supported] = useState(pushSupported);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void pushEnabled().then(setEnabled);
  }, []);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setMessage(null);
    if (!next) {
      await disablePush();
      setEnabled(false);
      setBusy(false);
      return;
    }
    const result = await enablePush();
    setEnabled(result === 'enabled');
    setMessage(MESSAGES[result]);
    setBusy(false);
  };

  if (!supported) {
    return (
      <Card>
        <Text style={styles.title}>Daily reminder</Text>
        <Text style={styles.note}>
          This browser can't receive notifications. On an iPhone they arrive once NutriAI is added
          to the Home Screen; the Android and iOS apps set their own per-meal reminders and need
          nothing switched on here.
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.title}>Daily reminder</Text>
          <Text style={styles.sub}>An evening nudge if the day still needs logging.</Text>
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

      {enabled ? <Button title="Send a sample" variant="ghost" onPress={sendSamplePush} style={styles.sample} /> : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Text style={styles.note}>
        Sent by the server, so it arrives whether or not this tab is open — but it's one nudge in
        the evening, not the per-meal reminders the phone app sets. Those are scheduled by the phone
        itself, which is the only way to get a reminder at 8:30pm from software that isn't running.
      </Text>
    </Card>
  );
}

const MESSAGES: Record<EnableResult, string | null> = {
  enabled: null,
  denied: 'Notifications are blocked for this site. Allow them in your browser settings, then try again.',
  unsupported: "This browser can't receive notifications.",
  unconfigured: "This server doesn't have push notifications set up, so there's nothing to switch on yet.",
  error: "Couldn't turn reminders on. Try again in a moment.",
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  text: { flex: 1 },
  title: { ...type.subheading, color: colors.text },
  sub: { ...type.caption, color: colors.textDim, marginTop: 2 },
  sample: { marginTop: 14 },
  message: { ...type.caption, color: colors.warn, marginTop: 12 },
  note: { ...type.caption, fontSize: 11.5, color: colors.textDim, marginTop: 12, lineHeight: 16 },
});
