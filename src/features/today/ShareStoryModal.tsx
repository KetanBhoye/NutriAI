import { useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { dashboardApi } from '@/api';
import { ShareStats } from '@/api/dashboard';
import { Button, Loading, Sheet } from '@/components/ui';
import { colors, fonts, type } from '@/theme';
import { parseISODate } from '@/dates';

interface ShareStoryModalProps {
  visible: boolean;
  date: string;
  onClose: () => void;
}

/**
 * Renders a shareable summary card and hands a PNG of it to the OS share
 * sheet. The web app draws an equivalent card onto a <canvas>; here the card
 * is real RN views and `react-native-view-shot` snapshots them, which keeps
 * the styling in the same system as the rest of the app.
 */
export function ShareStoryModal({ visible, date, onClose }: ShareStoryModalProps) {
  const shotRef = useRef<View>(null);
  const [stats, setStats] = useState<ShareStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setStats(null);
    setError(null);
    dashboardApi
      .getShareStats(date)
      .then((s) => !cancelled && setStats(s))
      .catch(() => !cancelled && setError("Couldn't build your card."));
    return () => {
      cancelled = true;
    };
  }, [visible, date]);

  const share = async () => {
    setSharing(true);
    setError(null);
    try {
      const uri = await captureRef(shotRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await Share.share({ url: uri });
    } catch {
      setError("Couldn't share that card.");
    } finally {
      setSharing(false);
    }
  };

  const label = parseISODate(date).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const pct = stats?.calories.goal
    ? Math.min(100, (stats.calories.consumed / stats.calories.goal) * 100)
    : 0;

  return (
    <Sheet visible={visible} onClose={onClose} title="Share your day">
      {!stats && !error ? (
        <Loading />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : stats ? (
        <View>
          <ViewShot ref={shotRef} style={styles.card}>
            <Text style={styles.brand}>NUTRIAI</Text>
            <Text style={styles.name}>{stats.name}</Text>
            <Text style={styles.date}>{label}</Text>

            <Text style={styles.big}>{stats.calories.consumed.toLocaleString()}</Text>
            <Text style={styles.bigLabel}>
              kcal{stats.calories.goal ? ` of ${stats.calories.goal.toLocaleString()}` : ''}
            </Text>

            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%` }]} />
            </View>

            <View style={styles.row}>
              <Stat value={`${Math.round(stats.protein.consumed)}g`} label="Protein" />
              <Stat value={`${Math.round(stats.carbs_g)}g`} label="Carbs" />
              <Stat value={`${Math.round(stats.fat_g)}g`} label="Fat" />
            </View>

            <View style={styles.row}>
              {stats.steps != null ? <Stat value={stats.steps.toLocaleString()} label="Steps" /> : null}
              <Stat value={`${stats.streak}`} label="Day streak" />
              {stats.weight_change_kg != null ? (
                <Stat
                  value={`${stats.weight_change_kg > 0 ? '+' : ''}${stats.weight_change_kg.toFixed(1)}kg`}
                  label="Since start"
                />
              ) : null}
            </View>
          </ViewShot>

          <Button
            title={sharing ? 'Preparing…' : 'Share'}
            onPress={share}
            disabled={sharing}
            style={{ marginTop: 14 }}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Opaque background: a transparent snapshot renders black in most apps.
  card: { backgroundColor: colors.bg, borderRadius: 20, padding: 24 },
  brand: { ...type.overline, color: colors.accent, letterSpacing: 3 },
  name: { ...type.title, fontSize: 26, color: colors.text, marginTop: 10 },
  date: { ...type.caption, color: colors.textDim, marginBottom: 18 },
  big: { ...type.figureLarge, fontSize: 56, lineHeight: 60, color: colors.accent },
  bigLabel: { ...type.caption, color: colors.textDim, marginBottom: 14 },
  track: { height: 8, backgroundColor: colors.surface2, borderRadius: 999, overflow: 'hidden', marginBottom: 20 },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: 999 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  statValue: { ...type.figure, fontSize: 18, color: colors.text },
  statLabel: { ...type.caption, fontSize: 11, color: colors.textDim, marginTop: 2 },
  error: { ...type.body, color: colors.danger },
});
