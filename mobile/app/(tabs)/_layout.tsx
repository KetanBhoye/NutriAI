import { Tabs } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { colors } from '@/theme';
import { useHealthAutoSync } from '@/health/useHealthAutoSync';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { initialiseReminders, scheduleDailyReminder } from '@/notifications/reminders';
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

  // The OS fixes the notification text when it's scheduled, so refresh it on
  // each launch to reflect the current day's log. On a first run this also
  // asks for notification permission, because reminders default to on.
  useEffect(() => {
    void initialiseReminders();
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
