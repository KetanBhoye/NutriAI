/**
 * Renders a 1080×1920 (9:16) "daily story" card to a PNG and shares it via the
 * native share sheet — which surfaces Instagram Stories, Snapchat, WhatsApp,
 * etc. Design leans on the Spotify-Wrapped / Apple-Fitness playbook: dark, bold,
 * one hero ring, big numbers, a punchy caption, on brand green (#4ade80).
 */
export interface ShareStats {
  date: string;
  name: string;
  calories: { consumed: number; goal: number | null };
  protein: { consumed: number; goal: number | null };
  carbs_g: number;
  fat_g: number;
  steps: number | null;
  streak: number;
  weight_kg: number | null;
  weight_change_kg: number | null;
}

const W = 1080;
const H = 1920;
const GREEN = '#4ade80';
const CYAN = '#5ad1ff';
const TEXT = '#e9ecf1';
const DIM = '#8b93a3';

/** Chooses a bold, aesthetic caption from whichever metric is most impressive. */
export function pickCaption(s: ShareStats): { headline: string; sub: string } {
  const proteinHit = s.protein.goal != null && s.protein.consumed >= s.protein.goal;
  const underCals = s.calories.goal != null && s.calories.consumed > 0 && s.calories.consumed <= s.calories.goal;
  if (s.streak >= 7) return { headline: `${s.streak} DAYS.\nNO MISSES.`, sub: 'Consistency is the whole game.' };
  if (proteinHit) return { headline: 'PROTEIN,\nDEMOLISHED.', sub: 'Fueling the gains.' };
  if (s.steps != null && s.steps >= 10000) return { headline: `${s.steps.toLocaleString()}\nSTEPS DEEP.`, sub: 'Earning it, one step at a time.' };
  if (underCals) return { headline: 'DIALED\nIN.', sub: 'Calories in check, goals in sight.' };
  if (s.calories.consumed > 0) return { headline: 'SHOWING UP.\nEVERY DAY.', sub: 'Progress is a habit.' };
  return { headline: "TODAY'S\nTHE DAY.", sub: 'Log your first meal.' };
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

/** Draws the whole card onto a provided 1080×1920 canvas context. */
export function drawCard(ctx: CanvasRenderingContext2D, s: ShareStats): void {
  const sans = '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
  const mono = '"SF Mono", ui-monospace, Menlo, monospace';

  // ── Background: dark gradient + green glow ──────────────
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0f1318');
  bg.addColorStop(1, '#080a0d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 560, 60, W / 2, 560, 720);
  glow.addColorStop(0, 'rgba(74,222,128,0.16)');
  glow.addColorStop(1, 'rgba(74,222,128,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const PAD = 96;

  // ── Header ──────────────────────────────────────────────
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 30px ${mono}`;
  ctx.fillStyle = GREEN;
  ctx.textAlign = 'left';
  ctx.fillText('🥗 NUTRIAI', PAD, 120);
  ctx.fillStyle = DIM;
  ctx.textAlign = 'right';
  ctx.fillText(fmtDate(s.date), W - PAD, 120);

  // ── Caption headline ────────────────────────────────────
  const { headline, sub } = pickCaption(s);
  ctx.textAlign = 'left';
  ctx.fillStyle = TEXT;
  ctx.font = `800 94px ${sans}`;
  const lines = headline.split('\n');
  let hy = 250;
  for (const line of lines) {
    ctx.fillText(line, PAD, hy);
    hy += 100;
  }
  ctx.font = `500 34px ${sans}`;
  ctx.fillStyle = DIM;
  ctx.fillText(sub, PAD, hy + 6);

  // ── Hero: calorie ring ──────────────────────────────────
  const cx = W / 2;
  const cy = 940;
  const radius = 250;
  const thick = 40;
  const goal = s.calories.goal;
  const pct = goal ? Math.max(0, Math.min(1.2, s.calories.consumed / goal)) : 0;
  const start = -Math.PI / 2;

  // track
  ctx.lineWidth = thick;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  // progress
  if (goal) {
    const over = s.calories.consumed > goal;
    const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    grad.addColorStop(0, over ? '#fbbf24' : GREEN);
    grad.addColorStop(1, over ? '#f87171' : CYAN);
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + Math.PI * 2 * Math.min(pct, 1), false);
    ctx.stroke();
  }
  // center numbers
  ctx.textAlign = 'center';
  ctx.fillStyle = TEXT;
  ctx.font = `800 150px ${sans}`;
  ctx.fillText(s.calories.consumed.toLocaleString(), cx, cy + 30);
  ctx.font = `600 40px ${mono}`;
  ctx.fillStyle = GREEN;
  ctx.fillText('KCAL', cx, cy + 92);
  if (goal) {
    ctx.font = `500 34px ${sans}`;
    ctx.fillStyle = DIM;
    ctx.fillText(`of ${goal.toLocaleString()} goal`, cx, cy - 110);
  }

  // ── Metric tiles ────────────────────────────────────────
  const tileY = 1340;
  const tileH = 210;
  const gap = 24;
  const tileW = (W - PAD * 2 - gap * 2) / 3;
  const tiles: Array<{ label: string; value: string; hint: string; accent: string }> = [
    {
      label: 'PROTEIN',
      value: `${s.protein.consumed}g`,
      hint: s.protein.goal ? `of ${s.protein.goal}g` : 'logged',
      accent: GREEN,
    },
    {
      label: 'STEPS',
      value: s.steps != null ? s.steps.toLocaleString() : '—',
      hint: s.steps != null ? '👟 today' : 'no data',
      accent: '#fbbf24',
    },
    {
      label: 'STREAK',
      value: `${s.streak}`,
      hint: s.streak === 1 ? '🔥 day' : '🔥 days',
      accent: '#f87171',
    },
  ];
  tiles.forEach((t, i) => {
    const x = PAD + i * (tileW + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(ctx, x, tileY, tileW, tileH, 28);
    ctx.fill();
    // accent stripe
    ctx.fillStyle = t.accent;
    roundRect(ctx, x, tileY, 8, tileH, 4);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = `600 24px ${mono}`;
    ctx.fillStyle = DIM;
    ctx.fillText(t.label, x + 34, tileY + 56);
    ctx.font = `800 62px ${sans}`;
    ctx.fillStyle = TEXT;
    ctx.fillText(t.value, x + 32, tileY + 128);
    ctx.font = `500 26px ${sans}`;
    ctx.fillStyle = DIM;
    ctx.fillText(t.hint, x + 34, tileY + 172);
  });

  // ── Weight line ─────────────────────────────────────────
  if (s.weight_kg != null) {
    const wy = 1660;
    ctx.textAlign = 'left';
    ctx.font = `800 60px ${sans}`;
    ctx.fillStyle = TEXT;
    ctx.fillText(`${s.weight_kg.toFixed(1)} kg`, PAD, wy);
    if (s.weight_change_kg != null && s.weight_change_kg !== 0) {
      const down = s.weight_change_kg < 0;
      ctx.font = `600 36px ${sans}`;
      ctx.fillStyle = down ? GREEN : '#fbbf24';
      const arrow = down ? '↓' : '↑';
      ctx.fillText(`${arrow} ${Math.abs(s.weight_change_kg).toFixed(1)} kg`, PAD + 300, wy - 4);
      ctx.font = `500 28px ${sans}`;
      ctx.fillStyle = DIM;
      ctx.fillText('/ 2 weeks', PAD + 470, wy - 4);
    }
  }

  // ── Footer ──────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.font = `600 28px ${mono}`;
  ctx.fillStyle = DIM;
  ctx.fillText('TRACKED WITH', cx, H - 150);
  ctx.font = `800 52px ${sans}`;
  ctx.fillStyle = GREEN;
  ctx.fillText('NutriAI', cx, H - 96);
  ctx.font = `500 28px ${sans}`;
  ctx.fillStyle = DIM;
  ctx.fillText('your AI nutrition coach', cx, H - 54);
}

/** Renders the card and returns a PNG blob. */
export function buildStoryCard(s: ShareStats): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  drawCard(ctx, s);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('render failed'))), 'image/png');
  });
}

/** Shares the PNG via the native sheet (IG/Snapchat/WhatsApp), else downloads. */
export async function shareCard(blob: Blob): Promise<'shared' | 'downloaded' | 'error'> {
  const file = new File([blob], `nutriai-${Date.now()}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & {
    canShare?: (d: unknown) => boolean;
    share?: (d: unknown) => Promise<void>;
  };
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'My day on NutriAI' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared'; // user cancelled sheet
      return 'error';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
