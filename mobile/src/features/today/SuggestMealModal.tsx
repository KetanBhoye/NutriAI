import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { aiApi, entriesApi } from '@/api';
import { MealSuggestion } from '@/api/ai';
import { Button, Sheet } from '@/components/ui';
import { colors, fonts, radius, type } from '@/theme';
import { MealType } from '@/types';
import { estimateGrams } from '@/portion';

interface SuggestMealModalProps {
  visible: boolean;
  meal: MealType;
  date: string;
  onClose: () => void;
  onLogged: () => void;
}

export function SuggestMealModal({ visible, meal, date, onClose, onLogged }: SuggestMealModalProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [suggestions, setSuggestions] = useState<MealSuggestion[]>([]);
  const [remaining, setRemaining] = useState<{ cal: number | null; pro: number | null }>({ cal: null, pro: null });
  const [logged, setLogged] = useState<Set<number>>(new Set());
  const [busyIdx, setBusyIdx] = useState<number | null>(null);

  const load = () => {
    setStatus('loading');
    setLogged(new Set());
    aiApi
      .suggestMeal(meal)
      .then((res) => {
        setSuggestions(res.suggestions);
        setRemaining({ cal: res.remaining_calories, pro: res.remaining_protein });
        setStatus(res.suggestions.length ? 'ready' : 'error');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(() => {
    if (visible) load();
  }, [visible, meal]);

  const logIt = async (s: MealSuggestion, i: number) => {
    setBusyIdx(i);
    try {
      await entriesApi.createEntry({
        food_name: s.name,
        calories: Math.round(s.calories) || 0,
        protein_g: s.protein_g || 0,
        carbs_g: s.carbs_g || 0,
        fat_g: s.fat_g || 0,
        meal_type: meal,
        entry_date: date,
        // Weighed from the macros so the entry stays re-portionable.
        quantity: estimateGrams(s),
        unit: 'g',
      });
      setLogged((prev) => new Set([...prev, i]));
      onLogged();
    } finally {
      setBusyIdx(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="🍽️ What should I eat?">
      {remaining.cal !== null ? (
        <Text style={styles.sub}>
          For {meal} · about <Text style={styles.bold}>{remaining.cal} kcal</Text> left today
          {remaining.pro !== null && remaining.pro > 0 ? ` · ${remaining.pro}g protein to go` : ''}
        </Text>
      ) : null}

      {status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerText}>Thinking of simple options…</Text>
        </View>
      ) : status === 'error' ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>Couldn't get suggestions.</Text>
          <Button title="Try again" variant="ghost" onPress={load} />
        </View>
      ) : (
        <View>
          {suggestions.map((s, i) => (
            <View key={i} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.name}>{s.name}</Text>
                <Text style={styles.cal}>{s.calories} kcal</Text>
              </View>
              <Text style={styles.desc}>{s.description}</Text>
              <View style={styles.cardBottom}>
                <Text style={styles.macros}>
                  {s.protein_g}g P · {s.carbs_g}g C · {s.fat_g}g F
                </Text>
                {logged.has(i) ? (
                  <Text style={styles.done}>✓ Logged</Text>
                ) : (
                  <Button
                    title={busyIdx === i ? '…' : '+ Log'}
                    onPress={() => logIt(s, i)}
                    disabled={busyIdx === i}
                    style={styles.logBtn}
                  />
                )}
              </View>
            </View>
          ))}
          <Button title="↻ Suggest others" variant="ghost" onPress={load} style={{ marginTop: 6 }} />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sub: { color: colors.textDim, fontSize: 13, marginBottom: 14 },
  bold: { color: colors.text, fontFamily: fonts.bold },
  center: { alignItems: 'center', paddingVertical: 30, gap: 12 },
  centerText: { color: colors.textDim, fontSize: 14 },
  card: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: 14,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  name: { color: colors.text, fontSize: 15.5, fontFamily: fonts.bold, flexShrink: 1 },
  cal: { ...type.figureSmall, color: colors.accent },
  desc: { color: colors.textDim, fontSize: 13.5, lineHeight: 19, marginBottom: 10 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  macros: { ...type.figureSmall, fontSize: 12, color: colors.textDim },
  logBtn: { paddingHorizontal: 14, minHeight: 34 },
  done: { color: colors.accent, fontSize: 13, fontFamily: fonts.bold },
});
