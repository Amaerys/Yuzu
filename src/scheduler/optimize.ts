// FSRS parameter fitting from the review log.
// Minimizes the log-loss of predicted recall (retrievability before each review that happened
// ≥ 1 day after the previous one) against what actually happened (Again = forgot), by gradient
// descent with numerical gradients. Small and dependency-free; a few seconds for ~10k reviews.
import type { Review } from "../lib/model";
import { DEFAULT_W, DAY, retrievability, updateMemory, toFsrs6 } from "./fsrs";

// Parameter bounds: FSRS-6 (ts-fsrs FSRS6ParameterBounds, short-term on, w17/w18 ceiling 2).
const LO = [0.001, 0.001, 0.001, 0.001, 1, 0.001, 0.001, 0.001, 0, 0, 0.001, 0.001, 0.001, 0.001, 0, 0, 1, 0, 0, 0.01, 0.1];
const HI = [100, 100, 100, 100, 10, 4, 4, 0.75, 4.5, 0.8, 3.5, 5, 0.25, 0.9, 4, 1, 6, 2, 2, 0.8, 0.8];
/** Fitted from day-separated reviews: 0–16 and the personal decay (20). 17–19 shape same-day reviews and stay at their values. */
const FIT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20];

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
        const p = Math.min(0.9999, Math.max(0.0001, retrievability(r.elapsedDays, card.stability, w)));
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

/** Fit weights starting from `start` (default FSRS-6). Needs enough data; returns the start weights otherwise. */
export async function fit(reviews: Review[], start0: number[] = DEFAULT_W, opts: { iterations?: number; minSamples?: number; onProgress?: (i: number, loss: number) => void; yieldEvery?: number } = {}): Promise<FitResult> {
  const samples = samplesFrom(reviews); const start = toFsrs6(start0);
  const base = logLoss(start, samples);
  const iterations = opts.iterations ?? 120, minSamples = opts.minSamples ?? 400;
  if (base.n < minSamples) return { w: start, before: base.loss, after: base.loss, n: base.n, iterations: 0 };
  let w = start.slice(); let best = base.loss; let bestW = w.slice();
  // Adam on the day-scale parameters (FIT), numerical gradients.
  const m = new Array(21).fill(0), v = new Array(21).fill(0); const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  let lr = 0.05;
  for (let it = 1; it <= iterations; it++) {
    const f0 = logLoss(w, samples).loss;
    const g = new Array(21).fill(0);
    for (const k of FIT) {
      const h = Math.max(1e-3, Math.abs(w[k]) * 1e-2);
      const wp = w.slice(); wp[k] = Math.min(HI[k], w[k] + h);
      if (wp[k] === w[k]) { wp[k] = Math.max(LO[k], w[k] - h); }
      const fp = logLoss(wp, samples).loss;
      g[k] = wp[k] !== w[k] ? (fp - f0) / (wp[k] - w[k]) : 0;
    }
    for (const k of FIT) {
      m[k] = b1 * m[k] + (1 - b1) * g[k]; v[k] = b2 * v[k] + (1 - b2) * g[k] * g[k];
      const mh = m[k] / (1 - Math.pow(b1, it)), vh = v[k] / (1 - Math.pow(b2, it));
      // scale the step with the parameter's range so big parameters (w3 ≈ 8) can move
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
        const p = retrievability(r.elapsedDays, card.stability, w); const b = Math.min(B - 1, Math.floor(p * B));
        sumP[b] += p; sumY[b] += r.rating > 1 ? 1 : 0; cnt[b]++;
      }
      const mem = updateMemory(w, card, r.rating, r.elapsedDays);
      card = { stability: mem.stability, difficulty: mem.difficulty, reps: card.reps + 1 };
    }
  }
  return Array.from({ length: B }, (_, b) => ({ bucket: `${b * 10}–${b * 10 + 10}%`, predicted: cnt[b] ? sumP[b] / cnt[b] : 0, observed: cnt[b] ? sumY[b] / cnt[b] : 0, n: cnt[b] })).filter((x) => x.n > 0);
}

/**
 * Workload vs recall target: simulate a year of learning `perDay` new cards a day at each target, with this user's
 * weights, answer mix and answer times. Returns minutes per day and the share of everything learned that is still
 * remembered at the end. (Pure "remembered per minute" always favours ~70%; like current Anki, show the trade-off.)
 */
export function retentionTradeoff(w0: number[], reviews: Review[], opts: { from?: number; to?: number; days?: number; perDay?: number } = {}) {
  const w = toFsrs6(w0); const from = opts.from ?? 0.7, to = opts.to ?? 0.97, days = opts.days ?? 365, perDay = opts.perDay ?? 10;
  // The user's own costs and answer mix (sensible defaults until there is history).
  const med = (xs: number[], d: number) => { const v = xs.filter((x) => x > 500 && x < 120000).sort((a, b) => a - b); return v.length >= 30 ? v[Math.floor(v.length / 2)] / 1000 : d; };
  const rev = reviews.filter((r) => r.state === "review");
  const recallCost = med(rev.filter((r) => r.rating > 1).map((r) => r.durationMs), 8);
  const forgetCost = med(rev.filter((r) => r.rating === 1).map((r) => r.durationMs), 18) + recallCost; // + relearning step
  const learnCost = med(reviews.filter((r) => r.state === "new").map((r) => r.durationMs), 20);
  const okMix = [0, 0, 0, 0]; for (const r of rev) if (r.rating > 1) okMix[r.rating - 1]++;
  const okN = okMix[1] + okMix[2] + okMix[3]; const pOk = okN >= 50 ? [okMix[1] / okN, okMix[2] / okN, okMix[3] / okN] : [0.1, 0.8, 0.1];
  const firstMix = [0, 0, 0, 0]; for (const r of reviews) if (r.state === "new") firstMix[r.rating - 1]++;
  const fN = firstMix.reduce((a, b) => a + b, 0); const pFirst = fN >= 50 ? firstMix.map((x) => x / fN) : [0.3, 0.1, 0.5, 0.1];
  const curve: { r: number; efficiency: number; minutesPerDay: number; remembered: number }[] = [];
  for (let target = from; target <= to + 1e-9; target += 0.01) {
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = (ps: number[]) => { let u = rnd(); for (let i = 0; i < ps.length; i++) { u -= ps[i]; if (u <= 0) return i; } return ps.length - 1; };
    let cost = 0, known = 0;
    for (let d = 0; d < days; d++) for (let k = 0; k < perDay; k++) {
      let g = (pick(pFirst) + 1) as 1 | 2 | 3 | 4; let card = { stability: 0, difficulty: 0, reps: 0 }; cost += learnCost;
      let m = updateMemory(w, card, g, 0); card = { ...m, reps: 1 };
      if (g === 1) { cost += recallCost; m = updateMemory(w, card, 3, 0); card = { ...m, reps: 2 }; } // learning step
      let t = d;
      for (;;) {
        const ivl = Math.max(1, Math.round((card.stability / (Math.pow(0.9, 1 / -w[20]) - 1)) * (Math.pow(target, 1 / -w[20]) - 1)));
        if (t + ivl >= days) { known += retrievability(days - t, card.stability, w); break; }
        t += ivl; const R = retrievability(ivl, card.stability, w);
        if (rnd() < R) { g = (pick(pOk) + 2) as 2 | 3 | 4; cost += recallCost; m = updateMemory(w, card, g, ivl); card = { ...m, reps: card.reps + 1 }; }
        else { cost += forgetCost; m = updateMemory(w, card, 1, ivl); card = { ...m, reps: card.reps + 1 }; m = updateMemory(w, card, 3, 0); card = { ...m, reps: card.reps + 1 }; }
      }
    }
    curve.push({ r: Math.round(target * 100) / 100, efficiency: known / cost, minutesPerDay: cost / days / 60, remembered: known });
  }
  return { curve: curve.map((c) => ({ ...c, rememberedShare: c.remembered / (days * perDay) })), costs: { recallCost, forgetCost, learnCost } };
}
