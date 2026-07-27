import { StyleSheet, Text } from 'react-native';
import { colors, type } from '@/theme';
import { Card } from './Card';

export function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <Text style={styles.text}>{message}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  text: { ...type.body, color: colors.textDim },
});
