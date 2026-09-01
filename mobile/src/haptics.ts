import * as Haptics from 'expo-haptics';

/**
 * Haptics that can't take the app down.
 *
 * expo-haptics has no web implementation: every call throws
 * `UnavailabilityError` ("not available on web, are you sure you've linked
 * all the native dependencies"). Nearly every call site here is fire-and-
 * forget — `void Haptics.selectionAsync()` — so on the PWA each one became an
 * unhandled promise rejection. Nothing visibly broke, which is the problem:
 * ten silent errors per session is where a real one goes to hide.
 *
 * Wrapping rather than adding `.catch(() => {})` at each call site, because
 * this is a property of the module, not of any one button — and the tenth
 * call site to be written would have forgotten it, exactly as nine of the
 * first ten did. Import this instead of expo-haptics and the call sites read
 * identically.
 *
 * A no-op is the correct web behaviour. Feedback is a nicety on a device that
 * can vibrate; there is nothing to degrade to in a browser, and the Vibration
 * API is a different sensation (a buzz, not a tap) that would be worse than
 * silence.
 */

export const { ImpactFeedbackStyle, NotificationFeedbackType } = Haptics;

const ignore = () => {};

export function selectionAsync(): Promise<void> {
  return Haptics.selectionAsync().catch(ignore);
}

export function impactAsync(style?: Haptics.ImpactFeedbackStyle): Promise<void> {
  return Haptics.impactAsync(style).catch(ignore);
}

export function notificationAsync(type?: Haptics.NotificationFeedbackType): Promise<void> {
  return Haptics.notificationAsync(type).catch(ignore);
}
