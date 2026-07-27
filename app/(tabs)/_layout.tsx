import { Tabs } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { colors } from '@/theme';
import { useHealthAutoSync } from '@/health/useHealthAutoSync';

/** 5 tabs matching the web app: Today, Trends, Coach, Plan, You. */
export default function TabsLayout() {
  // Only reached once signed in, so there's always a session to sync against.
  useHealthAutoSync(true);

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
