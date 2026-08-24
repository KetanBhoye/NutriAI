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
 * Android's `adjustResize` was understood to resize only the *activity's*
 * window and not the separate window a transparent `Modal` lives in, so this
 * measured the keyboard and padded the sheet by it.
 *
 * On current Android that is no longer true — the modal window is resized as
 * well — and the two compensations stacked: the sheet rose by twice the
 * keyboard height, leaving a gap the size of the keyboard between it and the
 * keyboard, with the lower half of the form pushed off screen. It read as
 * "the panel has a huge gap" on the photo sheet and as "the editor closes the
 * moment I touch a macro field" on the entry editor, because the fields
 * vanished upward and a tap in the gap landed on the backdrop.
 *
 * Rather than swap one assumption for another, `Sheet` now measures whether
 * the window it is in has already been resized, and only lifts the sheet
 * itself when it hasn't. See the comment on `alreadyResized`.
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
  /** The height this sheet's container was actually given, from onLayout. */
  const [wrapHeight, setWrapHeight] = useState(0);

  /**
   * Has the OS already made room for the keyboard?
   *
   * If the container we were laid out in is much shorter than the screen while
   * a keyboard is up, the window was resized and the space is already gone —
   * lifting the sheet again would double it. Half the keyboard height is the
   * threshold because it only has to tell "resized" from "not resized", and a
   * navigation bar or a rounded-display inset shaves a few pixels either way.
   *
   * Measured rather than assumed on purpose: this behaviour differs by Android
   * version, and the previous version of this file was correct when it was
   * written and wrong later.
   */
  const alreadyResized = keyboard > 0 && wrapHeight > 0 && wrapHeight < screenHeight - keyboard / 2;
  const lift = alreadyResized ? 0 : keyboard;

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
        {/* The measurement lives on a plain View, not on the
            KeyboardAvoidingView: that component forwards its own layout event
            after React has released it, so reading `nativeEvent` there throws
            the event-pooling warning and yields nothing. */}
        <View
          style={styles.wrap}
          pointerEvents="box-none"
          onLayout={(e) => {
            const measured = e.nativeEvent.layout.height;
            // Only store a real change, or onLayout -> setState -> layout
            // loops forever.
            setWrapHeight((previous) => (Math.abs(previous - measured) > 1 ? measured : previous));
          }}
        >
          <View
            style={[
              styles.sheet,
              lift > 0 && { marginBottom: lift },
              keyboard > 0 && { maxHeight: (alreadyResized ? wrapHeight : screenHeight) * 0.92 },
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
              // `interactive` is iOS-only; Android silently gets nothing, so
              // give it the drag-to-dismiss it does support.
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.body}
            >
              {children}
            </ScrollView>
          </View>
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
