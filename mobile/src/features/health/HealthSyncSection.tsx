import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { health, DailyHealth } from '@/health';
import { syncToday } from '@/health/sync';
import { clearHealthConnected, markHealthConnected, wasHealthConnected } from '@/health/permission';
import { Button, Card, StatTile } from '@/components/ui';
import { colors, fonts, type } from '@/theme';
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

  const connect = async () => {
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
          <Button title={`Connect ${health.name}`} onPress={connect} busy={busy} />
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
});
