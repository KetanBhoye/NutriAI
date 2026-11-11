import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius, type } from '@/theme';
import { getAnnouncement, type Announcement } from '@/api/announcement';
import { dismissedAnnouncement, rememberAnnouncementDismissal } from './announceState';

/**
 * A line on Today carrying the one thing the server wants users to know.
 *
 * It exists because there was no way to tell anyone anything: reminders are
 * scheduled on the device, so the server cannot push to the native apps at
 * all. A message fetched at open reaches everyone who opens the app.
 *
 * A banner, not a modal, for the same reason as the update banner beside it:
 * news about the app is worth mentioning, never worth interrupting a meal log
 * for. Dismissal is remembered per announcement id.
 */
export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = await getAnnouncement();
      if (cancelled || !current) return;
      if ((await dismissedAnnouncement()) === current.id) return;
      if (!cancelled) setAnnouncement(current);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!announcement) return null;

  const dismiss = () => {
    void rememberAnnouncementDismissal(announcement.id);
    setAnnouncement(null);
  };

  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Feather name="zap" size={15} color={colors.accent} />
      <Text style={styles.text}>
        <Text style={styles.strong}>{announcement.title}</Text>
        {'  '}
        {announcement.body}
      </Text>
      <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Feather name="x" size={15} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(74,222,128,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.35)',
    borderRadius: radius - 4,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  text: { ...type.caption, fontSize: 12, color: colors.text, flex: 1, lineHeight: 17 },
  strong: { color: colors.accent, fontFamily: undefined },
});
