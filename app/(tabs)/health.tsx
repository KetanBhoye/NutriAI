import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { health, DailyHealth } from '@/health';
import { syncToday } from '@/health/sync';

type Status = 'checking' | 'unavailable' | 'needs-permission' | 'ready';

export default function Health() {
  const [status, setStatus] = useState<Status>('checking');
  const [reading, setReading] = useState<DailyHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const available = await health.isAvailable();
      setStatus(available ? 'needs-permission' : 'unavailable');
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
      setStatus('ready');
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    const r = await health.getDailyHealth(new Date());
    setReading(r);
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{health.name}</Text>
      <Text style={styles.subtitle}>Sync steps, energy and weight into NutriAI.</Text>

      {status === 'checking' && <ActivityIndicator color="#5b8cff" style={{ marginTop: 40 }} />}

      {status === 'unavailable' && (
        <View style={styles.card}>
          <Text style={styles.cardText}>
            {health.name} isn't available on this device. On Android, install “Health Connect” from the
            Play Store; on iOS, Apple Health is built in.
          </Text>
        </View>
      )}

      {status === 'needs-permission' && (
        <Pressable style={styles.button} onPress={connect} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Connect {health.name}</Text>}
        </Pressable>
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

          <Pressable style={styles.button} onPress={sync} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sync now</Text>}
          </Pressable>

          {lastSync ? <Text style={styles.lastSync}>Last synced at {lastSync}</Text> : null}
        </>
      )}

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
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
  const display =
    value == null ? '—' : decimals ? value.toFixed(decimals) : Math.round(value).toString();
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>
        {display}
        {value != null && unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f1a' },
  content: { padding: 20, paddingBottom: 60 },
  title: { color: '#f3f4f6', fontSize: 24, fontWeight: '800' },
  subtitle: { color: '#9ca3af', fontSize: 15, marginTop: 4, marginBottom: 24 },
  card: {
    backgroundColor: '#151c2c',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1f2a44',
    marginTop: 12,
  },
  cardText: { color: '#9ca3af', fontSize: 15, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  statCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: '#151c2c',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2a44',
  },
  statValue: { color: '#f3f4f6', fontSize: 26, fontWeight: '800' },
  statUnit: { color: '#6b7280', fontSize: 14, fontWeight: '600' },
  statLabel: { color: '#9ca3af', fontSize: 13, marginTop: 4 },
  button: {
    backgroundColor: '#5b8cff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  lastSync: { color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 12 },
  message: { color: '#5b8cff', fontSize: 14, textAlign: 'center', marginTop: 16 },
});
