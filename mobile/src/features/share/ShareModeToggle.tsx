import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, space } from '@/theme';

export type ShareMode = 'card' | 'sticker';

/**
 * Chooses between the two things a share can be.
 *
 * Deliberately a toggle over the preview rather than two more share buttons.
 * The difference between a card and a sticker is entirely visual — one owns the
 * frame, the other sits on your own photo — and no button label explains that
 * as well as swapping the picture directly above it. Doubling the buttons would
 * also have made a sheet with five actions, where the two that matter are
 * "Snapchat" and "which one".
 *
 * Card stays the default: it is the finished object, and it is what someone
 * expects when they tap share. The sticker is the better post, but it asks for
 * a photo, and an app should not quietly turn a share into a photo shoot.
 */
export function ShareModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: ShareMode;
  onChange: (mode: ShareMode) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Option
        label="Card"
        hint="Post as is"
        active={mode === 'card'}
        disabled={disabled}
        onPress={() => onChange('card')}
      />
      <Option
        label="Sticker"
        hint="On your photo"
        active={mode === 'sticker'}
        disabled={disabled}
        onPress={() => onChange('sticker')}
      />
    </View>
  );
}

function Option({
  label,
  hint,
  active,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      // The hint is part of the label for anyone not looking at the preview,
      // where the whole distinction otherwise lives.
      accessibilityLabel={`${label} — ${hint}`}
      style={[styles.option, active && styles.optionActive, disabled && styles.optionDisabled]}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
      <Text style={[styles.hint, active && styles.hintActive]}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.xs,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius,
    padding: space.xs,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius - 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  optionActive: {
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderColor: 'rgba(74,222,128,0.35)',
  },
  optionDisabled: { opacity: 0.5 },
  label: { color: 'rgba(255,255,255,0.62)', fontFamily: fonts.bold, fontSize: 15 },
  labelActive: { color: colors.accent },
  hint: { color: 'rgba(255,255,255,0.34)', fontFamily: fonts.medium, fontSize: 11, marginTop: 2 },
  hintActive: { color: 'rgba(255,255,255,0.5)' },
});
