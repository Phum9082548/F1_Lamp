/**
 * ============================================================================
 * F1 Lamp — Lighting Effect Mathematics
 * ============================================================================
 * Matches 1:1 with browser-side simulation formulas in effects.js
 * Generates smooth brightness level (0.0 to 1.0) for each LED pixel.
 */

#pragma once
#include <Arduino.h>
#include <math.h>

// Helper: Modulo arithmetic that correctly wraps negative values
inline float wrap(float x, float n) {
  return fmodf(fmodf(x, n) + n, n);
}

// Helper: Quintic smootherstep (0.0 - 1.0 range with zero 1st & 2nd derivatives at edges)
inline float smooth(float x) {
  x = fmaxf(0.0f, fminf(1.0f, x));
  return x * x * x * (x * (x * 6.0f - 15.0f) + 10.0f);
}

// Helper: Gaussian-like periodic pulse
inline float pulse(float t, float c, float p, float w) {
  float delta = wrap(t - c + p / 2.0f, p) - p / 2.0f;
  return expf(-powf(delta, 2.0f) / (w * w));
}

// Check whether the requested effect identifier is supported
inline bool validEffect(const String& e) {
  return e == "static"    ||
         e == "rev"       ||
         e == "chase"     ||
         e == "breathe"   ||
         e == "wave"      ||
         e == "scanner"   ||
         e == "ripple"    ||
         e == "heartbeat" ||
         e == "ember"     ||
         e == "cascade";
}

/**
 * Calculate the brightness multiplier for an individual LED pixel.
 * 
 * @param effect  Name of the active lighting effect
 * @param t       Phase time in seconds (adjusted by speed multiplier)
 * @param i       Zone/Strip index (0 = D1, 1 = D2, 2 = D5)
 * @param j       Pixel index inside the strip (0 to n - 1)
 * @param n       Total number of pixels in this strip
 * @return        Brightness factor between 0.0f and 1.0f
 */
inline float effectLevel(const String& effect, float t, int i, int j, int n) {
  const float TAU = 6.28318530718f;
  const float x = (n > 0) ? (float)j / (float)n : 0.0f;

  // 1. Static: Constant full glow
  if (effect == "static") {
    return 1.0f;
  }

  // 2. Engine Rev: Progressive acceleration curve.
  // D2 and D5 ignite first; D1 follows 3 steps later.
  if (effect == "rev") {
    float delay = (i == 0) ? 3.0f : 0.0f;
    return smooth(t * 3.0f + t * t * 1.4f - delay - (float)j);
  }

  // 3. Chase: Fast-moving comet trail
  if (effect == "chase") {
    float pos = wrap(x - t * 0.32f + 0.5f, 1.0f) - 0.5f;
    return 0.025f + 0.975f * expf(-powf(pos, 2.0f) / 0.018f);
  }

  // 4. Breathe: Gentle sinusoidal breathing cycle
  if (effect == "breathe") {
    return 0.08f + 0.92f * powf((1.0f - cosf(t * 1.8f)) / 2.0f, 1.4f);
  }

  // 5. Wave: Traveling light wave across strips
  if (effect == "wave") {
    return 0.08f + 0.92f * (1.0f + sinf(t * 2.2f - x * TAU - (float)i * 0.5f)) / 2.0f;
  }

  // 6. Scanner: Knight-Rider style back-and-forth beam
  if (effect == "scanner") {
    float center = (1.0f - cosf(t * 1.7f)) / 2.0f;
    return 0.025f + 0.975f * expf(-powf(x - center, 2.0f) / 0.028f);
  }

  // 7. Ripple: Circular wave expanding outward from the center
  if (effect == "ripple") {
    float dist = fabsf(x - 0.5f) * TAU * 1.6f - t * 2.4f;
    return 0.06f + 0.94f * powf((1.0f + cosf(dist)) / 2.0f, 2.0f);
  }

  // 8. Heartbeat: Double rhythmic pulse
  if (effect == "heartbeat") {
    float beat1 = pulse(t, 0.48f, 2.8f, 0.15f);
    float beat2 = pulse(t, 0.88f, 2.8f, 0.19f);
    return 0.06f + 0.94f * fminf(1.0f, beat1 + 0.65f * beat2);
  }

  // 9. Ember: Harmonic flickering like glowing hot exhaust
  if (effect == "ember") {
    return 0.44f +
           0.22f * sinf(t * 1.30f + (float)j * 1.7f + (float)i * 2.1f) +
           0.13f * sinf(t * 2.73f + (float)j * 0.8f + (float)i) +
           0.09f * sinf(t * 4.10f - (float)j * 1.2f);
  }

  // 10. Cascade: Sequential zone-by-zone cascade
  if (effect == "cascade") {
    float phase = t * 1.9f - (float)i * TAU / 3.0f - x * 0.7f;
    return 0.08f + 0.92f * powf((1.0f + sinf(phase)) / 2.0f, 1.6f);
  }

  return 1.0f;
}

