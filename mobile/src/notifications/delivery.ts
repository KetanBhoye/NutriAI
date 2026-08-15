import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';

/**
 * Escape hatches for when Android decides not to deliver a reminder.
 *
 * Everything the app controls is handled elsewhere: the reminders are armed a
 * week ahead as exact alarms, on a MAX-importance channel, re-armed on every
 * launch. What remains is outside the app entirely — an OEM battery manager
 * that "hibernates" the app and drops its alarms, or the per-app exact-alarm
 * toggle on Android 14. Neither can be fixed in code, and neither is
 * discoverable: the user just sees reminders that stop coming.
 *
 * So the app can't fix it, but it can take them to the switch. Each of these
 * opens a settings screen and resolves whether or not the screen exists —
 * vendor skins rename and move them, and a missing screen must not throw into
 * a UI handler.
 */

const PACKAGE = `package:${Application.applicationId ?? 'app.nutriai.mobile'}`;

export const DELIVERY_SETTINGS_SUPPORTED = Platform.OS === 'android';

async function open(action: string, withPackage: boolean): Promise<boolean> {
  if (!DELIVERY_SETTINGS_SUPPORTED) return false;
  try {
    await IntentLauncher.startActivityAsync(action, withPackage ? { data: PACKAGE } : {});
    return true;
  } catch {
    return false;
  }
}

/**
 * "Alarms & reminders" for this app. On Android 14+ apps are denied exact
 * alarms by default, and this is the only place to grant it.
 */
export function openExactAlarmSettings(): Promise<boolean> {
  return open('android.settings.REQUEST_SCHEDULE_EXACT_ALARM', true);
}

/**
 * The battery-optimisation list. Deliberately the list rather than the
 * one-tap `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` dialog: that one needs a
 * Play-restricted permission, and on the skins where this matters most the
 * dialog is the part they've replaced anyway.
 */
export function openBatterySettings(): Promise<boolean> {
  return open('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS', false);
}

/** App info — the reliable way in to notification, battery and auto-start settings. */
export function openAppSettings(): Promise<boolean> {
  return open('android.settings.APPLICATION_DETAILS_SETTINGS', true);
}
