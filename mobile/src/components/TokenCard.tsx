import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { tokensApi } from '@/api';
import { Button, Card } from '@/components/ui';
import { colors, fonts, mono, radius, type } from '@/theme';

/**
 * Personal API token for the Apple Health Shortcut and the Claude/MCP
 * connector. Sent as `Authorization: Bearer <token>`.
 */
export function TokenCard() {
  const [token, setToken] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    tokensApi
      .getTokenStatus()
      .then((s) => setHasToken(!!s.has_token))
      .catch(() => setError("Couldn't load token status."));
  }, []);

  const rotate = async () => {
    setWorking(true);
    setError(null);
    try {
      const res = await tokensApi.rotateToken();
      setToken(res.token);
      setHasToken(true);
      setConfirming(false);
    } catch {
      setError('An API token already exists and cannot be replaced.');
    } finally {
      setWorking(false);
    }
  };

  const revoke = async () => {
    setRevoking(true);
    setError(null);
    try {
      await tokensApi.revokeToken();
      setHasToken(false);
      setToken(null);
      setConfirming(false);
    } catch {
      setError("Couldn't revoke the current token.");
    } finally {
      setRevoking(false);
    }
  };

  const copy = async () => {
    if (!token) return;
    await Clipboard.setStringAsync(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <Text style={styles.title}>API token</Text>
      <Text style={styles.desc}>
        Used by the Apple Health Shortcut and the Claude connector. Send it as{' '}
        <Text style={styles.code}>Authorization: Bearer &lt;token&gt;</Text>.
      </Text>

      {token ? (
        <View style={styles.tokenBox}>
          <Text style={styles.token} selectable>
            {token}
          </Text>
          <Button title={copied ? 'Copied' : 'Copy'} onPress={copy} style={{ marginTop: 10 }} />
          <Text style={styles.warnNote}>
            Shown once. Save it now — reopening this screen won't show it again, and it cannot be replaced later.
          </Text>
        </View>
      ) : hasToken ? (
        <View>
          <Text style={styles.warnNote}>An API token is already set. Revoke it first if you want to generate a different one.</Text>
          <Button title={revoking ? 'Revoking…' : 'Revoke token'} variant="ghost" onPress={revoke} disabled={revoking} style={{ marginTop: 12 }} />
        </View>
      ) : confirming ? (
        <View>
          <Text style={styles.warnNote}>
            This creates your one and only API token. If you lose it, you will need the account reset or a
            different authentication path.
          </Text>
          <View style={styles.row}>
            <Button title="Cancel" variant="ghost" onPress={() => setConfirming(false)} style={styles.flex1} />
            <Button title={working ? 'Generating…' : 'Generate'} onPress={rotate} disabled={working} style={styles.flex1} />
          </View>
        </View>
      ) : (
        <Button title="Generate API token" variant="ghost" onPress={() => setConfirming(true)} />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 15, fontFamily: fonts.bold, marginBottom: 6 },
  desc: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  code: { fontFamily: mono, fontSize: 12 },
  tokenBox: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radius - 2, padding: 12 },
  token: { color: colors.text, fontFamily: mono, fontSize: 12.5, lineHeight: 18 },
  warnNote: { color: colors.warn, fontSize: 12.5, backgroundColor: 'rgba(251,191,36,0.1)', borderRadius: 10, padding: 10, marginTop: 12, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  flex1: { flex: 1 },
  error: { color: colors.danger, fontSize: 13, marginTop: 10 },
});
