import { Tabs } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { colors } from '@/theme';
import { useHealthAutoSync } from '@/health/useHealthAutoSync';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { initialiseReminders, scheduleDailyReminder } from '@/notifications/reminders';
import { notifyIfUpdateAvailable } from '@/notifications/updateNotice';
import { scheduleWeeklyReport } from '@/notifications/weeklyReport';
import { shouldShowWeeklyBadge, subscribeWeeklyBadge } from '@/features/nudge/weeklyBadge';
import { todayISO } from '@/dates';
import { useAuth } from '@/auth';
import { subscribeGoalsChanged } from '@/goalsBus';

// Show reminders even while the app is open, rather than silently dropping them.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** 5 tabs matching the web app: Today, Trends, Coach, Plan, You. */
export default function TabsLayout() {
  // Only reached once signed in, so there's always a session to sync against.
  useHealthAutoSync(true);
  const { refreshUser } = useAuth();

  /**
   * A dot on Trends for the whole of Sunday, until the tab is opened.
   *
   * The 7pm notification arrives once and a phone that was face-down never
   * shows it again; this is the quiet second chance for anyone who opens the
   * app at any point that day.
   */
  const [weeklyBadge, setWeeklyBadge] = useState(false);
  const refreshBadge = useCallback(() => {
    void shouldShowWeeklyBadge(todayISO()).then(setWeeklyBadge);
  }, []);

  useEffect(() => {
    refreshBadge();
    // Trends clears it when opened, and a phone left running past midnight on
    // Saturday should pick Sunday up without a relaunch.
    const unsub = subscribeWeeklyBadge(refreshBadge);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refreshBadge();
    });
    return () => {
      unsub();
      sub.remove();
    };
  }, [refreshBadge]);

  // The OS fixes the notification text when it's scheduled, so refresh it on
  // each launch to reflect the current day's log. On a first run this also
  // asks for notification permission, because reminders default to on.
  useEffect(() => {
    void initialiseReminders();
    // Armed generically here; Trends re-arms the imminent one with the week's
    // real figures once it has them. See notifications/weeklyCopy.ts for why
    // only the soonest notification may quote numbers.
    void scheduleWeeklyReport().catch(() => {});
    // Local, not a server push — see updateNotice.ts. It can only fire while
    // the app is running, so launch is the moment to check.
    void notifyIfUpdateAvailable();
  }, []);

  // Backgrounding is the last moment before the reminder can fire, so it's
  // where the day's totals are freshest — re-scheduling here is what keeps the
  // notification's numbers matching the app's.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'active') void scheduleDailyReminder();
    });
    return () => sub.remove();
  }, []);

  // Editing the plan changes the calorie target the reminder counts against,
  // and the target the You tab shows from /api/me.
  useEffect(
    () =>
      subscribeGoalsChanged(() => {
        void scheduleDailyReminder();
        void refreshUser().catch(() => {});
      }),
    [refreshUser]
  );

  return (
    <Tabs
      screenOptions={{
        // Every screen renders its own title/header (mirroring the web app's
        // full-bleed pages), so a navigator header would just duplicate it.
        headerShown: false,
        // A short cross-fade. Tabs are siblings, so a slide would imply an
        // order they do not have; 180ms is under the threshold where a
        // transition starts to feel like waiting.
        animation: 'fade',
        transitionSpec: { animation: 'timing', config: { duration: 180 } },
        // The surface a cross-fade reveals between scenes. The dark navigation
        // theme already covers this, but the scene container is the thing
        // actually on screen mid-transition, so it says so explicitly.
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, size }) => <Feather name="sun" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Trends',
          tabBarBadge: weeklyBadge ? '' : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, minWidth: 10, maxHeight: 10, borderRadius: 5 },
          tabBarIcon: ({ color, size }) => <Feather name="bar-chart-2" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color, size }) => <Feather name="message-circle" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'Plan',
          tabBarIcon: ({ color, size }) => <Feather name="target" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'You',
          tabBarIcon: ({ color, size }) => <Feather name="user" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
