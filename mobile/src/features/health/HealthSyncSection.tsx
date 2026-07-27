import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { health, DailyHealth } from '@/health';
import { syncToday } from '@/health/sync';
import { clearHealthConnected, markHealthConnected, wasHealthConnected } from '@/health/permission';
import { Button, Card, StatTile } from '@/components/ui';
import { colors, fonts, type } from '@/theme';

type Status = 'checking' | 'unavailable' | 'needs-permission' | 'ready';

/** Apple Health / Health Connect sync, as a section embedded in the You tab. */
export function HealthSyncSection() {
  const [status, setStatus] = useState<Status>('checking');
  const [reading, setReading] = useState<DailyHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!(await health.isAvailable())) {
        setStatus('unavailable');
        return;
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
    try {
      const granted = await health.requestPermissions();
      if (!granted) {
        setMessage('Permission was not granted. Enable NutriAI in your health app settings.');
        return;
      }
      await markHealthConnected();
      setStatus('ready');
      const r = await health.getDailyHealth(new Date());
      setReading(r);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { reading: r, posted } = await syncToday();
      setReading(r);
      setLastSync(new Date().toLocaleTimeString());
      setMessage(posted ? 'Synced to NutriAI ✓' : 'No metrics available to sync yet.');
    } catch (e) {
      setMessage((e as Error).message);
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

      {status === 'checking' && <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />}

      {status === 'unavailable' && (
        <Card>
          <Text style={styles.cardText}>
            {health.name} isn't available on this device. On Android, install "Health Connect" from
            the Play Store; on iOS, Apple Health is built in.
          </Text>
        </Card>
      )}

      {status === 'needs-permission' && (
        <Button title={`Connect ${health.name}`} onPress={connect} busy={busy} />
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

      {message ? <Text style={styles.message}>{message}</Text> : null}
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
  message: { color: colors.accent, fontSize: 13, textAlign: 'center', marginTop: 12 },
});
