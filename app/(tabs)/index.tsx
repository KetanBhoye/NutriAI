import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from 'expo-router';
import { api } from '@/api';
import { useAuth } from '@/auth';

interface Totals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}
interface Dashboard {
  date: string;
  totals: Totals;
  profile?: Record<string, number | null> | null;
}
interface Goals {
  daily_calorie_goal?: number | null;
  daily_protein_goal_g?: number | null;
  daily_carbs_goal_g?: number | null;
  daily_fat_goal_g?: number | null;
}

export default function Today() {
  const { user, signOut } = useAuth();
  const navigation = useNavigation();
  const [data, setData] = useState<Dashboard | null>(null);
  const [goals, setGoals] = useState<Goals>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dash, g] = await Promise.all([
        api<Dashboard>('/api/dashboard'),
        api<Goals>('/api/goals').catch(() => ({}) as Goals),
      ]);
      setData(dash);
      setGoals(g ?? {});
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={signOut} hitSlop={12} style={{ marginRight: 16 }}>
          <Text style={{ color: '#9ca3af', fontSize: 14 }}>Sign out</Text>
        </Pressable>
      ),
    });
  }, [load, navigation]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const totals = data?.totals;
  const calGoal = goals.daily_calorie_goal ?? data?.profile?.daily_calorie_goal ?? null;
  const remaining = calGoal != null && totals ? Math.round(calGoal - totals.calories) : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#5b8cff" />}
    >
      <Text style={styles.greeting}>Hi{user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋</Text>
      <Text style={styles.date}>{data?.date ?? 'Today'}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Calories today</Text>
        <Text style={styles.bigNumber}>{Math.round(totals?.calories ?? 0)}</Text>
        {calGoal != null ? (
          <Text style={styles.sub}>
            of {calGoal} kcal · {remaining != null && remaining >= 0 ? `${remaining} left` : `${Math.abs(remaining ?? 0)} over`}
          </Text>
        ) : (
          <Text style={styles.sub}>logged today</Text>
        )}
      </View>

      <View style={styles.macroRow}>
        <Macro label="Protein" value={totals?.protein_g} goal={goals.daily_protein_goal_g} color="#34d399" />
        <Macro label="Carbs" value={totals?.carbs_g} goal={goals.daily_carbs_goal_g} color="#fbbf24" />
        <Macro label="Fat" value={totals?.fat_g} goal={goals.daily_fat_goal_g} color="#f472b6" />
      </View>

      <Text style={styles.footNote}>
        Log meals in the NutriAI web app or coach. This companion keeps your steps, energy and weight
        in sync from {`​`}your phone's health app — see the Health tab.
      </Text>
    </ScrollView>
  );
}

function Macro({
  label,
  value,
  goal,
  color,
}: {
  label: string;
  value?: number | null;
  goal?: number | null;
  color: string;
}) {
  return (
    <View style={styles.macroCard}>
      <Text style={[styles.macroValue, { color }]}>{Math.round(value ?? 0)}g</Text>
      <Text style={styles.macroLabel}>{label}</Text>
      {goal != null ? <Text style={styles.macroGoal}>/ {goal}g</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f1a' },
  content: { padding: 20, paddingBottom: 60 },
  greeting: { color: '#f3f4f6', fontSize: 24, fontWeight: '800' },
  date: { color: '#6b7280', fontSize: 14, marginTop: 2, marginBottom: 20 },
  error: { color: '#f87171', marginBottom: 12 },
  card: {
    backgroundColor: '#151c2c',
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: '#1f2a44',
    marginBottom: 16,
  },
  cardLabel: { color: '#9ca3af', fontSize: 14 },
  bigNumber: { color: '#f3f4f6', fontSize: 48, fontWeight: '800', marginTop: 4 },
  sub: { color: '#6b7280', fontSize: 14, marginTop: 2 },
  macroRow: { flexDirection: 'row', gap: 12 },
  macroCard: {
    flex: 1,
    backgroundColor: '#151c2c',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2a44',
  },
  macroValue: { fontSize: 20, fontWeight: '800' },
  macroLabel: { color: '#9ca3af', fontSize: 13, marginTop: 4 },
  macroGoal: { color: '#4b5563', fontSize: 12, marginTop: 1 },
  footNote: { color: '#4b5563', fontSize: 13, lineHeight: 19, marginTop: 24 },
});
