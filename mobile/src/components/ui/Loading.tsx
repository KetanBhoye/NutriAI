import { StyleSheet, View } from 'react-native';
import { NutriLoader } from './NutriLoader';

/**
 * Centred loader with an optional caption, for in-progress screen sections.
 *
 * Delegates to `NutriLoader` rather than `ActivityIndicator`: the stock
 * spinner is the same grey one every app on the phone shows, and it appears
 * in enough places here that it set the tone for the whole product.
 */
export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.wrap}>
      <NutriLoader size={64} label={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
});
