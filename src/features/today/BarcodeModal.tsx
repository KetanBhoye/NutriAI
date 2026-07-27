import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { entriesApi } from '@/api';
import { BarcodeProduct } from '@/api/entries';
import { Button, Loading, Sheet } from '@/components/ui';
import { colors, radius, type } from '@/theme';
import { MealType } from '@/types';
import { capitalize } from '@/format';
import { AmountStepper } from './AmountStepper';

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
/** Formats OFF/USDA carry these; anything else is unlikely to be food. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] as const;

interface BarcodeModalProps {
  visible: boolean;
  date: string;
  defaultMeal: MealType;
  onClose: () => void;
  onLogged: () => void;
}

type Status = 'scanning' | 'looking' | 'found' | 'notfound' | 'error';

export function BarcodeModal({ visible, date, defaultMeal, onClose, onLogged }: BarcodeModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<Status>('scanning');
  const [product, setProduct] = useState<BarcodeProduct | null>(null);
  const [grams, setGrams] = useState(100);
  const [meal, setMeal] = useState<MealType>(defaultMeal);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStatus('scanning');
    setProduct(null);
    setError(null);
    setMeal(defaultMeal);
  }, [visible, defaultMeal]);

  const onScanned = async ({ data }: { data: string }) => {
    // The camera fires continuously; ignore everything after the first hit.
    if (status !== 'scanning') return;
    setStatus('looking');
    try {
      const res = await entriesApi.lookupBarcode(data);
      if (!res.found || !res.per_100g) {
        setProduct(res);
        setStatus('notfound');
        return;
      }
      setProduct(res);
      setGrams(Math.round(res.serving_g ?? 100));
      setStatus('found');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  };

  // Macros are quoted per 100g, so everything scales off the gram input.
  const g = grams;
  const scale = (v: number | null | undefined) =>
    v == null ? null : Math.round((v * g) / 100);
  const per = product?.per_100g;
  const kcal = per ? Math.round((per.calories * g) / 100) : 0;

  const log = async () => {
    if (!product || !per) return;
    setSaving(true);
    setError(null);
    try {
      await entriesApi.createEntry({
        food_name: [product.brand, product.name].filter(Boolean).join(' ') || 'Scanned item',
        calories: kcal,
        protein_g: scale(per.protein_g) ?? undefined,
        carbs_g: scale(per.carbs_g) ?? undefined,
        fat_g: scale(per.fat_g) ?? undefined,
        meal_type: meal,
        entry_date: date,
        quantity: g,
        unit: 'g',
      });
      onLogged();
      onClose();
    } catch {
      setError("Couldn't save that entry. Check your connection.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Scan barcode">
      {status === 'scanning' ? (
        !permission ? (
          <Loading />
        ) : !permission.granted ? (
          <View>
            <Text style={styles.note}>NutriAI needs camera access to scan a barcode.</Text>
            <Button title="Allow camera" onPress={requestPermission} />
          </View>
        ) : (
          <View>
            <View style={styles.cameraWrap}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
                onBarcodeScanned={onScanned}
              />
              <View style={styles.reticle} pointerEvents="none" />
            </View>
            <Text style={styles.note}>Point the camera at the product's barcode.</Text>
          </View>
        )
      ) : status === 'looking' ? (
        <Loading label="Looking it up…" />
      ) : status === 'notfound' ? (
        <View>
          <Text style={styles.note}>
            That barcode isn't in the food database{product?.code ? ` (${product.code})` : ''}. You can still add
            it by hand from "Add food".
          </Text>
          <Button title="Scan another" variant="ghost" onPress={() => setStatus('scanning')} />
        </View>
      ) : status === 'error' ? (
        <View>
          <Text style={styles.error}>{error}</Text>
          <Button title="Try again" variant="ghost" onPress={() => setStatus('scanning')} />
        </View>
      ) : (
        <View>
          <Text style={styles.name}>{product?.name}</Text>
          {product?.brand ? <Text style={styles.brand}>{product.brand}</Text> : null}

          <Text style={styles.label}>Amount</Text>
          <View style={styles.stepper}>
            <AmountStepper grams={grams} onChange={setGrams} />
          </View>

          <View style={styles.macros}>
            <Macro label="kcal" value={kcal} />
            <Macro label="Protein" value={scale(per?.protein_g)} unit="g" />
            <Macro label="Carbs" value={scale(per?.carbs_g)} unit="g" />
            <Macro label="Fat" value={scale(per?.fat_g)} unit="g" />
          </View>

          <Text style={styles.label}>Meal</Text>
          <View style={styles.mealRow}>
            {MEALS.map((m) => (
              <Pressable key={m} onPress={() => setMeal(m)} style={[styles.mealPill, meal === m && styles.mealPillActive]}>
                <Text style={[styles.mealText, meal === m && styles.mealTextActive]}>{capitalize(m)}</Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.row}>
            <Button title="Rescan" variant="ghost" onPress={() => setStatus('scanning')} style={styles.flex1} />
            <Button title={saving ? 'Logging…' : `Log ${kcal} kcal`} onPress={log} disabled={saving || g <= 0} style={styles.flex2} />
          </View>
        </View>
      )}
    </Sheet>
  );
}

function Macro({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.macroValue}>
        {value ?? '—'}
        {value != null && unit ? unit : ''}
      </Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraWrap: {
    height: 220,
    borderRadius: radius,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginBottom: 12,
  },
  reticle: {
    position: 'absolute',
    left: '12%',
    right: '12%',
    top: '28%',
    bottom: '28%',
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 10,
  },
  stepper: { marginBottom: 18 },
  note: { ...type.caption, color: colors.textDim, marginBottom: 14 },
  name: { ...type.heading, color: colors.text },
  brand: { ...type.caption, color: colors.textDim, marginBottom: 14 },
  macros: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  macroCell: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 2,
    paddingVertical: 12,
    alignItems: 'center',
  },
  macroValue: { ...type.figure, fontSize: 17, color: colors.text },
  macroLabel: { ...type.caption, fontSize: 11, color: colors.textDim, marginTop: 2 },
  label: { ...type.caption, color: colors.textDim, marginBottom: 6 },
  mealRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  mealPill: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 4,
  },
  mealPillActive: { borderColor: colors.accent, backgroundColor: 'rgba(74,222,128,0.08)' },
  mealText: { ...type.caption, color: colors.text },
  mealTextActive: { color: colors.accent },
  error: { ...type.caption, color: colors.danger, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
});
