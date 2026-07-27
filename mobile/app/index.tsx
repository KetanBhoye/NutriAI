import { Redirect } from 'expo-router';
import { useAuth } from '@/auth';

/** Entry point: bounce to the app or the login screen. */
export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Redirect href={user ? '/(tabs)' : '/login'} />;
}
