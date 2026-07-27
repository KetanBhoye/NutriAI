import { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors } from '@/theme';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: ViewStyle;
  /**
   * Which edges to inset. Navigator headers are disabled app-wide (each screen
   * draws its own), so the default insets the top too — without it the first
   * row slides under the notch / Dynamic Island.
   */
  edges?: readonly Edge[];
}

/** Shared screen chrome: safe area + optional pull-to-refresh scroll view. */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  contentStyle,
  edges = ['top', 'bottom'],
}: ScreenProps) {
  if (!scroll) {
    return (
      <SafeAreaView style={styles.safe} edges={edges}>
        <View style={[styles.content, contentStyle]}>{children}</View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 60 },
});
