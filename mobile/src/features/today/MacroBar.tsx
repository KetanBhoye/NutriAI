import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui';
import { colors } from '@/theme';
import { Goals, Totals } from '@/types';

interface MacroBarProps {
  totals: Totals;
  goals: Required<Pick<Goals, 'daily_calorie_goal' | 'daily_protein_goal_g' | 'daily_carbs_goal_g' | 'daily_fat_goal_g'>>;
}

export function MacroBar({ totals, goals }: MacroBarProps) {
  const calGoal = goals.daily_calorie_goal || 1;
  const caloriePct = Math.min(100, (totals.calories / calGoal) * 100);
  const over = totals.calories > calGoal;

  const macros = [
    { label: 'Protein', value: totals.protein_g, goal: goals.daily_protein_goal_g || 1 },
    { label: 'Carbs', value: totals.carbs_g, goal: goals.daily_carbs_goal_g || 1 },
    { label: 'Fat', value: totals.fat_g, goal: goals.daily_fat_goal_g || 1 },
  ];

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.label}>Calories</Text>
        <Text style={styles.value}>
          {Math.round(totals.calories)} / {goals.daily_calorie_goal}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${caloriePct}%` }, over && styles.fillOver]} />
      </View>

      <View style={styles.macroRow}>
        {macros.map((m) => (
          <View key={m.label} style={styles.macro}>
            <View style={styles.row}>
              <Text style={styles.macroLabel}>{m.label}</Text>
              <Text style={styles.macroValue}>{Math.round(m.value)}g</Text>
            </View>
            <View style={styles.trackThin}>
              <View style={[styles.fill, { width: `${Math.min(100, (m.value / m.goal) * 100)}%` }]} />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 16, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { color: colors.textDim, fontSize: 13 },
  value: { color: colors.text, fontSize: 13 },
  track: { height: 8, backgroundColor: colors.surface2, borderRadius: 999, overflow: 'hidden' },
  trackThin: { height: 5, backgroundColor: colors.surface2, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: 999 },
  fillOver: { backgroundColor: colors.warn },
  macroRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  macro: { flex: 1 },
  macroLabel: { color: colors.textDim, fontSize: 12 },
  macroValue: { color: colors.text, fontSize: 12 },
});
