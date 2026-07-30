import { ReactNode, useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, radius, type } from '@/theme';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * How tall the keyboard currently is on Android, or 0 elsewhere.
 *
 * Android's `adjustResize` resizes the *activity's* window, not the separate
 * window a transparent `Modal` lives in, so `KeyboardAvoidingView` had nothing
 * to react to and its `height` behavior measured the full screen instead —
 * which is what made the sheet jump and the keyboard flicker open and shut
 * while typing in the food search. Measuring the keyboard directly and padding
 * the sheet by it is stable in a modal window.
 */
function useAndroidKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

/** Themed bottom sheet built on a plain Modal — no gesture library this pass. */
export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const keyboard = useAndroidKeyboardHeight();
  const { height: screenHeight } = useWindowDimensions();

  /**
   * Dismiss the keyboard before the modal goes away. Tearing down a focused
   * `TextInput` along with its window leaves Android with a keyboard attached
   * to a view that no longer exists.
   */
  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <KeyboardAvoidingView
        // iOS gets no window resize at all, so it still needs padding here.
        // On Android the measured keyboard height below does the work; asking
        // for `height` as well shrinks the sheet twice.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.wrap}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.sheet,
            keyboard > 0 && { marginBottom: keyboard, maxHeight: screenHeight * 0.92 - keyboard },
          ]}
        >
          <View style={styles.grabber} />
          {title ? (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable onPress={close} hitSlop={12}>
                <Text style={styles.close}>Close</Text>
              </Pressable>
            </View>
          ) : null}
          {/* Scrollable so the keyboard can shrink the sheet without clipping
              the form. `handled` keeps a single tap working on buttons while
              the keyboard is up, instead of the first tap only dismissing it. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            // `interactive` is iOS-only; Android silently gets nothing, so give
            // it the drag-to-dismiss it does support.
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius + 4,
    borderTopRightRadius: radius + 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomWidth: 0,
    maxHeight: '92%',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  body: { paddingBottom: 8 },
  title: { ...type.heading, color: colors.text },
  close: { ...type.caption, fontFamily: fonts.semibold, color: colors.textDim },
});
