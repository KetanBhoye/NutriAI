import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { health, DailyHealth } from '@/health';
import { syncToday } from '@/health/sync';
import { clearHealthConnected, markHealthConnected, wasHealthConnected } from '@/health/permission';
import { Button, Card, StatTile } from '@/components/ui';
import { colors, fonts, radius, type } from '@/theme';
import { NutriLoader } from '@/components/ui/NutriLoader';

type Status = 'checking' | 'unavailable' | 'needs-update' | 'needs-permission' | 'ready';

/** Apple Health / Health Connect sync, as a section embedded in the You tab. */
/** "exercise_minutes" → "exercise minutes". */
function readableMetric(key: string): string {
  return key.replace(/_/g, ' ').replace(' kcal', '').replace(' km', '').replace(' kg', '');
}

/**
 * Something a person can act on.
 *
 * The API returns Zod's raw issue array as its error message, so rendering
 * `e.message` put a wall of JSON on the screen — `{"code":"too_big",...}` —
 * which tells the user nothing and looks broken.
 */
function humanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw.trim().startsWith('[') || raw.trim().startsWith('{')) {
    return "Your health app sent a reading NutriAI couldn't accept. Nothing was saved — try again, and tell us if it keeps happening.";
  }
  if (/network|timeout|fetch/i.test(raw)) {
    return "Couldn't reach NutriAI. Check your connection and try again.";
  }
  return raw;
}

export function HealthSyncSection() {
  const [status, setStatus] = useState<Status>('checking');
  const [reading, setReading] = useState<DailyHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Failures are styled as failures — the same slot in green read as success. */
  const [failed, setFailed] = useState(false);
  /** Offer the settings shortcut only once a request has actually been refused. */
  const [denied, setDenied] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  /** Record types Health Connect has not granted, when it can tell us. */
  const [missing, setMissing] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  /**
   * Whether the disclosure below has been shown and accepted this time round.
   *
   * Google's User Data policy requires a *prominent in-app disclosure* before
   * sensitive data is collected — and the OS permission sheet does not count
   * as one. It names the permission, not what we do with the reading, and the
   * thing that actually triggers the duty is invisible to it: these numbers
   * leave the phone. They are POSTed to /api/activity so the coach and the
   * daily totals can use them, and a user who assumed the data stayed on the
   * device would be wrong in exactly the way the policy exists to prevent.
   *
   * So the OS sheet is never the first thing anyone sees. `connect` opens
   * this, and only an explicit accept calls requestPermissions().
   */
  const [disclosing, setDisclosing] = useState(false);

  useEffect(() => {
    (async () => {
      const state = health.availability ? await health.availability() :
        (await health.isAvailable()) ? 'available' : 'unavailable';
      if (state !== 'available') {
        setStatus(state === 'needs-update' ? 'needs-update' : 'unavailable');
        return;
      }

      // Granted outside the app — in Health Connect's own settings, which is
      // where the button below sends people. Without this the card would still
      // demand a connection the user had already made.
      if (health.missingPermissions) {
        setMissing(await health.missingPermissions().catch(() => []));
      }

      if (health.hasPermissions && (await health.hasPermissions())) {
        try {
          const r = await health.getDailyHealth(new Date());
          await markHealthConnected();
          setReading(r);
          setStatus('ready');
          return;
        } catch {
          // Fall through to the stored-flag path below.
        }
      }
      // Already connected on a previous launch: go straight to the readings
      // instead of asking again. A read that throws means access was revoked
      // in Settings, so fall back to the connect prompt.
      if (await wasHealthConnected()) {
        try {
          const r = await health.getDailyHealth(new Date());
          setReading(r);
          setStatus('ready');
          return;
        } catch {
          await clearHealthConnected();
        }
      }
      setStatus('needs-permission');
    })();
  }, []);

  /** Opens the disclosure. The permission request itself is `grantAccess`. */
  const connect = () => {
    setMessage(null);
    setFailed(false);
    setDenied(false);
    setDisclosing(true);
  };

  const grantAccess = async () => {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    setDenied(false);
    try {
      const granted = await health.requestPermissions();
      if (!granted) {
        // A refusal is a failure and must look like one. This branch set the
        // message but not `failed`, so "Permission was not granted" rendered in
        // the same green as "Synced ✓".
        setFailed(true);
        setDenied(true);
        setMessage(
          `${health.name} didn't grant access. If you didn't see a prompt, Android stops asking after a couple of refusals — open the settings below and allow NutriAI there.`
        );
        return;
      }
      await markHealthConnected();
      setStatus('ready');
      const r = await health.getDailyHealth(new Date());
      setReading(r);
    } catch (e) {
      setFailed(true);
      setMessage(humanError(e));
    } finally {
      setBusy(false);
      // Closed either way: granted moves the card to `ready`, refused shows
      // the message and the settings shortcut, and leaving the disclosure up
      // over either would read as though nothing had happened.
      setDisclosing(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      const { reading: r, posted, skipped } = await syncToday();
      setReading(r);
      setLastSync(new Date().toLocaleTimeString());
      if (!posted) {
        setMessage('No metrics available to sync yet.');
        setShowHelp(true);
        return;
      }
      /**
       * A sync that read no steps used to say "Synced ✓" — technically true,
       * and the single most confusing thing the card could say to someone
       * whose steps are missing. It was indistinguishable from working.
       */
      if (r.steps == null || r.steps === 0) {
        setMessage(
          `Synced ✓, but ${health.name} had no steps for today. That usually means nothing is writing steps to it yet.`
        );
        setShowHelp(true);
        return;
      }
      // Say which readings were ignored rather than quietly dropping them —
      // a number your health app is showing you should not vanish in silence.
      setMessage(
        skipped.length
          ? `Synced ✓ — ignored ${skipped.map(readableMetric).join(' and ')}, which your health app reported an impossible value for.`
          : 'Synced to NutriAI ✓'
      );
    } catch (e) {
      setFailed(true);
      setMessage(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={styles.title}>{health.name}</Text>
      <Text style={styles.subtitle}>
        Steps, energy and weight sync automatically each time you open NutriAI. Use the button below to
        sync right now.
      </Text>

      {status === 'checking' && <NutriLoader size={38} />}

      {status === 'needs-update' && (
        <Card>
          <Text style={styles.cardText}>
            Health Connect is installed but too old to talk to NutriAI. Update it from the Play
            Store, then come back and connect.
          </Text>
        </Card>
      )}

      {status === 'unavailable' && (
        <Card>
          <Text style={styles.cardText}>
            {health.name} isn't available on this device. On Android, install "Health Connect" from
            the Play Store; on iOS, Apple Health is built in.
          </Text>
        </Card>
      )}

      {status === 'needs-permission' && (
        <>
          {disclosing ? (
            /**
             * The prominent disclosure. Deliberately specific, because the
             * policy is about informed consent rather than a notice: it names
             * every record type we read, what each one is for, and — the part
             * the OS sheet can never say — that the readings are sent to
             * NutriAI's servers rather than staying on the phone.
             */
            <View style={styles.disclosure}>
              <Text style={styles.disclosureTitle}>Before you connect {health.name}</Text>
              <Text style={styles.disclosureBody}>
                NutriAI reads these from {health.name}:
              </Text>
              <View style={styles.disclosureList}>
                <Text style={styles.disclosureItem}>
                  <Text style={styles.disclosureItemName}>Steps, distance and exercise</Text> — so
                  the day's movement counts towards your calorie target.
                </Text>
                <Text style={styles.disclosureItem}>
                  <Text style={styles.disclosureItemName}>Active energy</Text> — so what you burned
                  is added to what you can eat.
                </Text>
                <Text style={styles.disclosureItem}>
                  <Text style={styles.disclosureItemName}>Weight</Text> — so the plan can adapt to
                  the trend instead of a single weigh-in.
                </Text>
              </View>
              <Text style={styles.disclosureBody}>
                These readings are sent to NutriAI's servers and stored with your account, so your
                totals and your coach stay in step across your devices. They are never used for
                advertising and never sold. You can disconnect at any time in {health.name}, and
                deleting your account deletes them.
              </Text>
              <Button
                title={`Agree and connect ${health.name}`}
                onPress={grantAccess}
                busy={busy}
                style={{ marginTop: 4 }}
              />
              <Button
                title="Not now"
                variant="ghost"
                onPress={() => setDisclosing(false)}
                disabled={busy}
                style={{ marginTop: 8 }}
              />
            </View>
          ) : (
            <Button title={`Connect ${health.name}`} onPress={connect} busy={busy} />
          )}
          {denied && health.openSettings ? (
            <Button
              title={`Open ${health.name} settings`}
              variant="ghost"
              onPress={() => health.openSettings!().catch(() => {})}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </>
      )}

      {status === 'ready' && (
        <>
          <View style={styles.grid}>
            <Stat label="Steps" value={reading?.steps} unit="" />
            <Stat label="Active energy" value={reading?.activeEnergyKcal} unit="kcal" />
            <Stat label="Distance" value={reading?.distanceKm} unit="km" decimals={2} />
            <Stat label="Exercise" value={reading?.exerciseMinutes} unit="min" />
            <Stat label="Weight" value={reading?.weightKg} unit="kg" decimals={1} />
          </View>

          <Button title="Sync now" onPress={sync} busy={busy} />

          {lastSync ? <Text style={styles.lastSync}>Last synced at {lastSync}</Text> : null}
        </>
      )}

      {message ? <Text style={[styles.message, failed && styles.messageFailed]}>{message}</Text> : null}

      {/* The troubleshooting guide. Mirrors "Reminders not arriving?" above it,
          for the same reason: this is a chain of four things that each fail
          silently, and the app is the only place that can say which one. */}
      {status === 'ready' || status === 'needs-permission' ? (
        <Pressable onPress={() => setShowHelp((v) => !v)} style={styles.helpToggle}>
          <Text style={styles.helpToggleText}>
            {showHelp ? 'Hide' : 'Steps not syncing?'}
          </Text>
        </Pressable>
      ) : null}

      {showHelp ? <StepsHelp providerName={health.name} missing={missing} /> : null}
    </View>
  );
}

/**
 * Why steps go missing, in the order it actually happens.
 *
 * Written for Android, and for vivo/iQOO in particular, where the default
 * setup produces an empty Health Connect and no error anywhere: the phone's
 * own step counter does not write to Health Connect, so every layer above it
 * is working perfectly on top of no data.
 */
function StepsHelp({ providerName, missing }: { providerName: string; missing: string[] }) {
  const stepsMissing = missing.includes('Steps');

  return (
    <View style={styles.help}>
      <Text style={styles.helpIntro}>
        Steps travel phone → {providerName} → NutriAI. Each part of that chain can be working
        perfectly on top of an empty one before it, so work down the list in order.
      </Text>

      {stepsMissing ? (
        <View style={styles.helpAlert}>
          <Text style={styles.helpAlertText}>
            NutriAI does not have permission to read Steps. That alone explains it — step 2 below
            fixes it.
          </Text>
        </View>
      ) : null}

      <HelpStep
        n="1"
        title="Is anything writing steps into Health Connect?"
        body={
          'The usual cause on vivo and iQOO phones. The built-in health app (Jovi / vivo Health) counts your steps but does not always share them with Health Connect, so Health Connect itself is empty — and every app reading from it, including this one, correctly reports nothing.\n\n' +
          'Check: open Health Connect → Data and access → Activity → Steps → See all entries. If today is empty, nothing is writing steps.\n\n' +
          'Fix: give it a source. In vivo Health look for Settings → Health Connect / data sharing and turn it on. If there is no such option, install Google Fit — it counts steps itself and writes them to Health Connect automatically.'
        }
      />
      <HelpStep
        n="2"
        title="Is NutriAI allowed to read Steps?"
        body={
          'Health Connect grants each data type separately, so weight can be allowed while steps is not.\n\n' +
          'Open Health Connect → App permissions → NutriAI and turn on Steps. The "Open ' +
          providerName +
          ' settings" button on this card goes straight there.'
        }
      />
      <HelpStep
        n="3"
        title="Is Health Connect itself present and current?"
        body={
          'On Android 13 it is a separate Play Store app; on Android 14 and later it is built in, under Settings → Security & privacy → Health Connect. An out-of-date copy can accept permissions and still return nothing, so update it in the Play Store.'
        }
      />
      <HelpStep
        n="4"
        title="Is the phone letting NutriAI run?"
        body={
          'Funtouch OS is aggressive with background apps. Settings → Battery → Background power consumption management → NutriAI → allow background running, and turn off "deep optimisation" or sleep for it.\n\n' +
          'NutriAI syncs whenever you open it, so this mostly affects how fresh the numbers are before you look — not whether they arrive at all.'
        }
      />
      <HelpStep
        n="5"
        title="Health Connect has the steps but NutriAI does not?"
        body={
          'Then it is our bug, not your phone. Tap "Sync now" with the step count visible in Health Connect, and tell us both numbers and the time — that is enough to find it.'
        }
      />
    </View>
  );
}

function HelpStep({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <View style={styles.helpStep}>
      <Text style={styles.helpStepTitle}>
        {n}. {title}
      </Text>
      <Text style={styles.helpStepBody}>{body}</Text>
    </View>
  );
}

function Stat({
  label,
  value,
  unit,
  decimals = 0,
}: {
  label: string;
  value?: number | null;
  unit: string;
  decimals?: number;
}) {
  const display = value == null ? '—' : decimals ? value.toFixed(decimals) : Math.round(value).toString();
  return <StatTile label={label} value={display} unit={value != null ? unit : undefined} />;
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontFamily: fonts.extrabold },
  subtitle: { color: colors.textDim, fontSize: 14, marginTop: 4, marginBottom: 16 },
  cardText: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  lastSync: { ...type.figureSmall, fontSize: 12, color: colors.textDim, textAlign: 'center', marginTop: 10 },
  message: { color: colors.accent, fontSize: 13, textAlign: 'center', marginTop: 12, lineHeight: 18 },
  messageFailed: { color: colors.danger },
  helpToggle: { marginTop: 14, alignSelf: 'flex-start' },
  helpToggleText: { ...type.caption, fontFamily: fonts.semibold, color: colors.accent },
  help: { marginTop: 10, gap: 14 },
  disclosure: {
    backgroundColor: colors.surface2,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  disclosureTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.semibold },
  disclosureBody: { color: colors.textDim, fontSize: 13.5, lineHeight: 20 },
  disclosureList: { gap: 8, paddingLeft: 2 },
  disclosureItem: { color: colors.textDim, fontSize: 13.5, lineHeight: 20 },
  disclosureItemName: { color: colors.text, fontFamily: fonts.medium },
  helpIntro: { ...type.caption, color: colors.textDim, lineHeight: 19 },
  helpAlert: {
    borderWidth: 1,
    borderColor: colors.warn,
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderRadius: 10,
    padding: 12,
  },
  helpAlertText: { ...type.caption, color: colors.text, lineHeight: 19 },
  helpStep: { gap: 4 },
  helpStepTitle: { ...type.caption, fontFamily: fonts.semibold, color: colors.text, fontSize: 13.5 },
  helpStepBody: { ...type.caption, color: colors.textDim, lineHeight: 19 },
});