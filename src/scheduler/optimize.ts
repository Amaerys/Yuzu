// FSRS parameter fitting from the review log.
// Minimizes the log-loss of predicted recall (retrievability before each review that happened
// ≥ 1 day after the previous one) against what actually happened (Again = forgot), by gradient
// descent with numerical gradients. Small and dependency-free; a few seconds for ~10k reviews.
import type { Review } from "../lib/model";
import { DEFAULT_W, DAY, retrievability, updateMemory } from "./fsrs";

// Parameter bounds (FSRS-5 optimizer defaults).
const LO = [0.001, 0.001, 0.001, 0.001, 1, 0.001, 0.001, 0.001, 0, 0, 0.001, 0.001, 0.001, 0.001, 0, 0, 1, 0, 0];
const HI = [100, 100, 100, 100, 10, 4, 6, 0.75, 4.5, 0.8, 3.5, 5, 0.25, 0.9, 4, 1, 6, 2, 2];

export interface Sample { seq: { rating: 1 | 2 | 3 | 4; elapsedDays: number }[] }

/** Group reviews by card into ordered rating/elapsed sequences. */
export function samplesFrom(reviews: Review[]): Sample[] {
  const by = new Map<string, Review[]>();
  for (const r of reviews) (by.get(r.cid) ?? by.set(r.cid, []).get(r.cid)!).push(r);
  const out: Sample[] = [];
  for (const list of by.values()) {
    list.sort((a, b) => a.ts - b.ts);
    let lastDay = 0; const seq: Sample["seq"] = [];
    for (const r of list) {
      const elapsedDays = lastDay ? (r.ts - lastDay) / DAY : 0;
      seq.push({ rating: r.rating, elapsedDays });
      if (elapsedDays >= 1 || r.rating >= 3) lastDay = r.ts; else lastDay = lastDay || r.ts;
    }
    if (seq.length >= 2) out.push({ seq });
  }
  return out;
}

/** Mean log-loss (and count) of recall predictions over all samples with the given weights. */
export function logLoss(w: number[], samples: Sample[]): { loss: number; n: number } {
  let loss = 0, n = 0;
  for (const s of samples) {
    let card = { stability: 0, difficulty: 0, reps: 0 };
    for (const r of s.seq) {
      if (card.reps > 0 && r.elapsedDays >= 1) {
        const p = Math.min(0.9999, Math.max(0.0001, retrievability(r.elapsedDays, card.stability)));
        const y = r.rating > 1 ? 1 : 0;
        loss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); n++;
      }
      const mem = updateMemory(w, card, r.rating, r.elapsedDays);
      card = { stability: mem.stability, difficulty: mem.difficulty, reps: card.reps + 1 };
    }
  }
  return { loss: n ? loss / n : 0, n };
}

export interface FitResult { w: number[]; before: number; after: number; n: number; iterations: number }

/** Fit weights starting from `start` (default FSRS-5). Needs enough data; returns the start weights otherwise. */
export async function fit(reviews: Review[], start: number[] = DEFAULT_W, opts: { iterations?: number; minSamples?: number; onProgress?: (i: number, loss: number) => void; yieldEvery?: number } = {}): Promise<FitResult> {
  const samples = samplesFrom(reviews);
  const base = logLoss(start, samples);
  const iterations = opts.iterations ?? 120, minSamples = opts.minSamples ?? 400;
  if (base.n < minSamples) return { w: start, before: base.loss, after: base.loss, n: base.n, iterations: 0 };
  let w = start.slice(); let best = base.loss; let bestW = w.slice();
  // Adam on the first 17 parameters (17, 18 govern same-day reviews and need intraday data to fit well).
  const m = new Array(19).fill(0), v = new Array(19).fill(0); const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  let lr = 0.05;
  for (let it = 1; it <= iterations; it++) {
    const f0 = logLoss(w, samples).loss;
    const g = new Array(19).fill(0);
    for (let k = 0; k < 17; k++) {
      const h = Math.max(1e-3, Math.abs(w[k]) * 1e-2);
      const wp = w.slice(); wp[k] = Math.min(HI[k], w[k] + h);
      const fp = logLoss(wp, samples).loss;
      g[k] = (fp - f0) / (wp[k] - w[k]);
    }
    for (let k = 0; k < 17; k++) {
      m[k] = b1 * m[k] + (1 - b1) * g[k]; v[k] = b2 * v[k] + (1 - b2) * g[k] * g[k];
      const mh = m[k] / (1 - Math.pow(b1, it)), vh = v[k] / (1 - Math.pow(b2, it));
      // scale the step with the parameter's range so big parameters (w3 ≈ 15) can move
      const scale = Math.max(0.05, Math.abs(w[k]));
      w[k] = Math.min(HI[k], Math.max(LO[k], w[k] - lr * scale * mh / (Math.sqrt(vh) + eps)));
    }
    const f1 = logLoss(w, samples).loss;
    if (f1 < best) { best = f1; bestW = w.slice(); } else lr *= 0.9;
    opts.onProgress?.(it, f1);
    if (opts.yieldEvery && it % opts.yieldEvery === 0) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
  }
  return { w: bestW, before: base.loss, after: best, n: base.n, iterations };
}

/** Observed vs predicted recall, bucketed by predicted retrievability. For the calibration chart. */
export function calibration(reviews: Review[], w: number[]): { bucket: string; predicted: number; observed: number; n: number }[] {
  const samples = samplesFrom(reviews);
  const B = 10; const sumP = new Array(B).fill(0), sumY = new Array(B).fill(0), cnt = new Array(B).fill(0);
  for (const s of samples) {
    let card = { stability: 0, difficulty: 0, reps: 0 };
    for (const r of s.seq) {
      if (card.reps > 0 && r.elapsedDays >= 1) {
        const p = retrievability(r.elapsedDays, card.stability); const b = Math.min(B - 1, Math.floor(p * B));
        sumP[b] += p; sumY[b] += r.rating > 1 ? 1 : 0; cnt[b]++;
      }
      const mem = updateMemory(w, card, r.rating, r.elapsedDays);
      card = { stability: mem.stability, difficulty: mem.difficulty, reps: card.reps + 1 };
    }
  }
  return Array.from({ length: B }, (_, b) => ({ bucket: `${b * 10}–${b * 10 + 10}%`, predicted: cnt[b] ? sumP[b] / cnt[b] : 0, observed: cnt[b] ? sumY[b] / cnt[b] : 0, n: cnt[b] })).filter((x) => x.n > 0);
}
