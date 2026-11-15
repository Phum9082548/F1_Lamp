/**
 * ============================================================================
 * F1 Lamp — Frontend Lighting Effects
 * ============================================================================
 * Matches 1:1 with hardware formulas in hardware/F1_Lamp/effects.h
 */

const TAU = Math.PI * 2;
const { sin, cos, exp, pow, abs, min, max } = Math;

export const wrap = (x, n) => ((x % n) + n) % n;

export const smooth = (x) => {
  x = max(0, min(1, x));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

export const pulse = (t, c, p, w) => {
  return exp(-pow(wrap(t - c + p / 2, p) - p / 2, 2) / (w * w));
};

export const modes = [
  { id: "static",    label: "ไฟค้าง",       name: "STATIC GLOW" },
  { id: "rev",       label: "เร่งเครื่อง",   name: "ENGINE REV" },
  { id: "chase",     label: "ดาวหาง",       name: "COMET TRAIL" },
  { id: "breathe",   label: "หายใจ",        name: "SOFT BREATH" },
  { id: "wave",      label: "คลื่นแสง",     name: "RED WAVE" },
  { id: "scanner",   label: "สแกนไปกลับ",   name: "SCANNER" },
  { id: "ripple",    label: "แผ่ออกจากกลาง", name: "CENTER RIPPLE" },
  { id: "heartbeat", label: "หัวใจเต้น",    name: "HEARTBEAT" },
  { id: "ember",     label: "ประกายไฟ",     name: "EMBER GLOW" },
  { id: "cascade",   label: "ไหลสลับโซน",   name: "ZONE CASCADE" }
];

export function level(effect, t, i, j, n) {
  const x = (n > 0) ? (j / n) : 0;
  switch (effect) {
    case "static":
      return 1;

    case "rev":
      return smooth(t * 3 + t * t * 1.4 - (i === 0 ? 3 : 0) - j);

    case "chase":
      return 0.025 + 0.975 * exp(-pow(wrap(x - t * 0.32 + 0.5, 1) - 0.5, 2) / 0.018);

    case "breathe":
      return 0.08 + 0.92 * pow((1 - cos(t * 1.8)) / 2, 1.4);

    case "wave":
      return 0.08 + 0.92 * (1 + sin(t * 2.2 - x * TAU - i * 0.5)) / 2;

    case "scanner":
      return 0.025 + 0.975 * exp(-pow(x - (1 - cos(t * 1.7)) / 2, 2) / 0.028);

    case "ripple":
      return 0.06 + 0.94 * pow((1 + cos(abs(x - 0.5) * TAU * 1.6 - t * 2.4)) / 2, 2);

    case "heartbeat":
      return 0.06 + 0.94 * min(1, pulse(t, 0.48, 2.8, 0.15) + 0.65 * pulse(t, 0.88, 2.8, 0.19));

    case "ember":
      return 0.44 +
             0.22 * sin(t * 1.3 + j * 1.7 + i * 2.1) +
             0.13 * sin(t * 2.73 + j * 0.8 + i) +
             0.09 * sin(t * 4.1 - j * 1.2);

    case "cascade":
      return 0.08 + 0.92 * pow((1 + sin(t * 1.9 - (i * TAU) / 3 - x * 0.7)) / 2, 1.6);

    default:
      return 1;
  }
}

globalThis.F1Effects = { modes, level, smooth };

