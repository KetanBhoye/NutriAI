import { Tabs } from 'expo-router';
import { Text } from 'react-native';

/** Two tabs: Today (nutrition summary) and Health (sync). */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0b0f1a' },
        headerTitleStyle: { color: '#f3f4f6' },
        tabBarStyle: { backgroundColor: '#0b0f1a', borderTopColor: '#1f2a44' },
        tabBarActiveTintColor: '#5b8cff',
        tabBarInactiveTintColor: '#6b7280',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🍽️</Text>,
        }}
      />
      <Tabs.Screen
        name="health"
        options={{
          title: 'Health',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>❤️</Text>,
        }}
      />
    </Tabs>
  );
}
