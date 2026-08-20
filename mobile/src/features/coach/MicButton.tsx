import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors } from '@/theme';

/**
 * The composer's mic.
 *
 * While listening it pulses with the actual input level rather than on a
 * timer: the single most common failure of phone dictation is a mic that isn't
 * hearing you — muted, covered, or grabbed by another app — and a ring that
 * animates regardless says everything is fine right up until nothing is
 * transcribed. A ring that doesn't move when you speak tells you immediately.
 */
export function MicButton({
  listening,
  level,
  onPress,
  disabled,
}: {
  listening: boolean;
  /** 0–1, from the recogniser's volume events. */
  level: number;
  onPress: () => void;
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(scale, {
      toValue: listening ? 1 + Math.min(level, 1) * 0.5 : 1,
      duration: 140,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [level, listening, scale]);

  return (
    <Pressable
      testID="coach-mic"
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={listening ? 'Stop dictation' : 'Dictate a message'}
      style={styles.wrap}
    >
      {listening ? <Animated.View style={[styles.halo, { transform: [{ scale }] }]} /> : null}
      <View style={[styles.button, listening && styles.buttonListening, disabled && styles.disabled]}>
        <Feather
          name={listening ? 'square' : 'mic'}
          size={listening ? 14 : 18}
          color={listening ? colors.onAccent : colors.textDim}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(74,222,128,0.22)',
  },
  button: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonListening: { backgroundColor: colors.accent, borderColor: colors.accent },
  disabled: { opacity: 0.4 },
});
