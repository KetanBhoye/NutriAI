import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Sheet } from '@/components/ui';
import { colors, fonts, radius, type } from '@/theme';

/**
 * Long-press actions for one chat message.
 *
 * A chat with no way to copy a message out of it is a dead end: the coach's
 * reply is often a number the user wants in a note, and the user's own message
 * is often one they want to send again with a word changed. Both were
 * previously impossible — the bubbles weren't even selectable.
 *
 * A bottom sheet rather than a context menu: `Alert` can't show icons and
 * caps at three buttons on Android, and a floating menu would need a gesture
 * library this app deliberately doesn't have.
 */

export interface MessageAction {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  /** Rendered in the danger colour — for anything that discards something. */
  destructive?: boolean;
}

export function MessageMenu({
  visible,
  preview,
  actions,
  onClose,
}: {
  visible: boolean;
  /** The message the actions apply to, so a mis-aimed long-press is obvious. */
  preview: string;
  actions: MessageAction[];
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Message">
      <Text style={styles.preview} numberOfLines={3}>
        {preview}
      </Text>
      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            onPress={() => {
              // Close first: running the action behind a sheet that is still
              // up means the copy toast (and the keyboard, on retry) land
              // under it.
              onClose();
              action.onPress();
            }}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          >
            <Feather
              name={action.icon}
              size={17}
              color={action.destructive ? colors.danger : colors.accent}
            />
            <Text style={[styles.actionLabel, action.destructive && styles.actionLabelDanger]}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  preview: {
    ...type.caption,
    color: colors.textDim,
    backgroundColor: colors.surface2,
    borderRadius: radius - 2,
    padding: 12,
    marginBottom: 14,
  },
  actions: { gap: 8 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius - 2,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionPressed: { opacity: 0.7, borderColor: colors.accentDim },
  actionLabel: { ...type.body, fontFamily: fonts.semibold, color: colors.text },
  actionLabelDanger: { color: colors.danger },
});
