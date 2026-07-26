<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api';
import type { MealType } from '../api';

// html5-qrcode is ~250KB — load it only when the scanner actually opens.
type Html5QrcodeInstance = import('html5-qrcode').Html5Qrcode;

const props = defineProps<{ mealType: MealType; date: string }>();
const emit = defineEmits<{ close: []; logged: [] }>();

type Product = {
  found: boolean;
  code: string;
  name: string;
  brand: string | null;
  serving_g: number | null;
  per_100g: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null;
};

const status = ref<'scanning' | 'looking' | 'found' | 'notfound' | 'error' | 'saving'>('scanning');
const errorMsg = ref<string | null>(null);
const product = ref<Product | null>(null);
const grams = ref<number>(100);

let scanner: Html5QrcodeInstance | null = null;
const READER_ID = 'bc-reader';

const scaled = computed(() => {
  const p = product.value?.per_100g;
  if (!p) return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const f = (grams.value || 0) / 100;
  return {
    calories: Math.round(p.calories * f),
    protein_g: Math.round(p.protein_g * f),
    carbs_g: Math.round(p.carbs_g * f),
    fat_g: Math.round(p.fat_g * f),
  };
});

async function startScan(): Promise<void> {
  status.value = 'scanning';
  errorMsg.value = null;
  await nextTick();
  try {
    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
    scanner = new Html5Qrcode(READER_ID, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
      ],
      verbose: false,
    });
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 160 } },
      (decoded) => void onDecoded(decoded),
      () => {}
    );
  } catch {
    errorMsg.value = 'Camera access is needed to scan. Allow it in your browser settings.';
    status.value = 'error';
  }
}

async function stopScan(): Promise<void> {
  if (scanner) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      /* already stopped */
    }
    scanner = null;
  }
}

async function onDecoded(code: string): Promise<void> {
  await stopScan();
  status.value = 'looking';
  try {
    const p = await api.lookupBarcode(code);
    product.value = p;
    if (p.found && p.per_100g) {
      grams.value = p.serving_g && p.serving_g > 0 ? Math.round(p.serving_g) : 100;
      status.value = 'found';
    } else {
      status.value = 'notfound';
    }
  } catch {
    status.value = 'notfound';
  }
}

async function logIt(): Promise<void> {
  if (!product.value?.per_100g) return;
  status.value = 'saving';
  try {
    await fetch('/api/entries', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        food_name: `${product.value.name}${product.value.brand ? ` (${product.value.brand})` : ''} (${grams.value}g)`,
        calories: scaled.value.calories,
        protein_g: scaled.value.protein_g,
        carbs_g: scaled.value.carbs_g,
        fat_g: scaled.value.fat_g,
        meal_type: props.mealType,
        entry_date: props.date,
        quantity: grams.value,
        unit: 'g',
      }),
    });
    if (navigator.vibrate) navigator.vibrate(10);
    emit('logged');
  } catch {
    errorMsg.value = 'Could not save. Check your connection.';
    status.value = 'found';
  }
}

onMounted(startScan);
onUnmounted(stopScan);
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet">
      <div class="sheet-head">
        <span class="sheet-title">📷 Scan barcode</span>
        <button class="x" aria-label="Close" @click="emit('close')">✕</button>
      </div>

      <div class="body">
        <!-- Scanner (kept in DOM while scanning) -->
        <div v-show="status === 'scanning'" class="scanwrap">
          <div :id="READER_ID" class="reader"></div>
          <p class="hint muted">Point at the product's barcode.</p>
        </div>

        <div v-if="status === 'looking'" class="center">
          <div class="spin"></div>
          <p>Looking it up…</p>
        </div>

        <div v-else-if="status === 'error'" class="center">
          <p>{{ errorMsg }}</p>
          <button class="btn" @click="startScan">Try again</button>
        </div>

        <div v-else-if="status === 'notfound'" class="center">
          <p>Not in the database.</p>
          <p class="muted small">Scan a different barcode, or add the food manually from the meal slots.</p>
          <div class="btnrow">
            <button class="btn btn-ghost" @click="emit('close')">Close</button>
            <button class="btn" @click="startScan">Scan again</button>
          </div>
        </div>

        <!-- Found: confirm portion -->
        <template v-else-if="status === 'found' || status === 'saving'">
          <div class="prod">
            <div class="p-name">{{ product?.name }}</div>
            <div v-if="product?.brand" class="p-brand muted">{{ product?.brand }}</div>
          </div>
          <label class="grams-field">
            <span>Amount (grams)</span>
            <input v-model.number="grams" type="number" inputmode="numeric" min="1" />
          </label>
          <div class="macros">
            <div class="m"><span class="m-v mono">{{ scaled.calories }}</span><span class="m-l">kcal</span></div>
            <div class="m"><span class="m-v mono">{{ scaled.protein_g }}</span><span class="m-l">protein</span></div>
            <div class="m"><span class="m-v mono">{{ scaled.carbs_g }}</span><span class="m-l">carbs</span></div>
            <div class="m"><span class="m-v mono">{{ scaled.fat_g }}</span><span class="m-l">fat</span></div>
          </div>
          <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
          <div class="btnrow">
            <button class="btn btn-ghost" @click="startScan">Scan again</button>
            <button class="btn grow" :disabled="status === 'saving'" @click="logIt">
              {{ status === 'saving' ? 'Logging…' : `Log to ${mealType}` }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sheet {
  width: 100%;
  max-width: 480px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px 20px 0 0;
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}

.sheet-title { font-size: 16px; font-weight: 600; }
.x { width: 34px; min-height: 34px; color: var(--text-dim); border-radius: 8px; }

.body { overflow-y: auto; padding: 0 16px calc(18px + env(safe-area-inset-bottom)); }

.scanwrap { text-align: center; }

.reader {
  width: 100%;
  border-radius: 14px;
  overflow: hidden;
  background: #000;
}

.reader :deep(video) {
  border-radius: 14px;
  width: 100% !important;
}

.hint { font-size: 13px; margin: 12px 0 0; }

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 0 8px;
  color: var(--text-dim);
  font-size: 14px;
  text-align: center;
}

.spin {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid var(--surface-2);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.prod { margin: 4px 0 14px; }
.p-name { font-size: 17px; font-weight: 600; }
.p-brand { font-size: 13px; margin-top: 2px; }

.grams-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 14px;
}

.macros {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.m {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 4px;
  text-align: center;
}

.m-v { display: block; font-size: 20px; font-weight: 700; }
.m-l { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }

.small { font-size: 12px; }
.err { color: var(--danger); font-size: 13px; margin: 0 0 10px; }

.btnrow { display: flex; gap: 10px; }
.btnrow .btn { flex: 1; }
.grow { flex: 2; }
</style>
