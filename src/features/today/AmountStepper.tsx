import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts, type } from '@/theme';
import { gramStep } from '@/portion';

interface AmountStepperProps {
  grams: number;
  onChange: (grams: number) => void;
  /** Shown under the control, e.g. to flag an estimated weight. */
  hint?: string;
}

/**
 * Gram stepper shared by every logging surface. The number itself is typable,
 * because thumbing from 150g to 400g one step at a time is nobody's idea of a
 * good time.
 */
export function AmountStepper({ grams, onChange, hint }: AmountStepperProps) {
  const [text, setText] = useState(String(Math.round(grams)));

  // Follow the value when the buttons (or the parent) move it.
  useEffect(() => {
    setText(String(Math.round(grams)));
  }, [grams]);

  const nudge = (dir: 1 | -1) => {
    const step = gramStep(grams);
    void Haptics.selectionAsync();
    // Snap to the step grid so repeated taps don't drift to 137g.
    onChange(Math.max(step, Math.round((grams + dir * step) / step) * step));
  };

  const type_ = (v: string) => {
    const digits = v.replace(/[^0-9]/g, '').slice(0, 4);
    setText(digits);
    const n = Number(digits);
    if (Number.isFinite(n) && n > 0) onChange(n);
  };

  const step = gramStep(grams);

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          onPress={() => nudge(-1)}
          disabled={grams <= step}
          hitSlop={6}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed, grams <= step && styles.disabled]}
        >
          <Text style={styles.btnText}>−</Text>
        </Pressable>

        <View style={styles.value}>
          <TextInput
            testID="grams-input"
            value={text}
            onChangeText={type_}
            onBlur={() => setText(String(Math.round(grams)))}
            keyboardType="number-pad"
            selectTextOnFocus
            style={styles.qty}
          />
          <Text style={styles.unit}>g</Text>
        </View>

        <Pressable onPress={() => nudge(1)} hitSlop={6} style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
          <Text style={styles.btnText}>+</Text>
        </Pressable>
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  btn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.7, borderColor: colors.accentDim },
  disabled: { opacity: 0.35 },
  btnText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 24, lineHeight: 28 },
  value: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 3 },
  qty: {
    minWidth: 60,
    textAlign: 'right',
    color: colors.text,
    fontFamily: fonts.extrabold,
    fontSize: 34,
    padding: 0,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  unit: { ...type.body, color: colors.textDim },
  hint: { ...type.caption, fontSize: 11.5, color: colors.textDim, textAlign: 'center', marginTop: 8 },
});
