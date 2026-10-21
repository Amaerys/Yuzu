// FSRS (Free Spaced Repetition Scheduler) — the algorithm modern Anki uses.
// Implemented from the published FSRS-5 formulas with the default parameters.
import type { Card, CardState, Rating, Review } from "../lib/model";

export const DEFAULT_W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;
export const DAY = 86400000;

export interface SchedulerConfig {
  w: number[];
  desiredRetention: number;   // 0.9 default
  maximumInterval: number;    // days
  learningSteps: number[];    // minutes, for new cards
  relearningSteps: number[];  // minutes, after a lapse
}
export const DEFAULT_CONFIG: SchedulerConfig = {
  w: DEFAULT_W, desiredRetention: 0.9, maximumInterval: 36500, learningSteps: [1, 10], relearningSteps: [10],
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
}
export function intervalFor(stability: number, retention: number, maxDays: number): number {
  const i = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(i), 1, maxDays);
}
function initStability(w: number[], g: Rating) { return Math.max(w[g - 1], 0.1); }
function initDifficulty(w: number[], g: Rating) { return clamp(w[4] - Math.exp(w[5] * (g - 1)) + 1, 1, 10); }
function nextDifficulty(w: number[], d: number, g: Rating) {
  const delta = -w[6] * (g - 3);
  const dPrime = d + delta * ((10 - d) / 9);
  return clamp(w[7] * initDifficulty(w, 4) + (1 - w[7]) * dPrime, 1, 10);
}
function nextRecallStability(w: number[], d: number, s: number, r: number, g: Rating) {
  const hard = g === 2 ? w[15] : 1;
  const easy = g === 4 ? w[16] : 1;
  return s * (Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy + 1);
}
function nextForgetStability(w: number[], d: number, s: number, r: number) {
  const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
  return Math.min(sf, s);
}
function shortTermStability(w: number[], s: number, g: Rating) {
  return s * Math.exp(w[17] * (g - 3 + w[18]));
}

/** Memory-state update only (no learning steps). Used by both live scheduling and revlog replay. */
export function updateMemory(w: number[], card: { stability: number; difficulty: number; reps: number }, g: Rating, elapsedDays: number) {
  if (card.reps === 0 || card.stability <= 0) {
    return { stability: initStability(w, g), difficulty: initDifficulty(w, g) };
  }
  if (elapsedDays < 1) {
    return { stability: shortTermStability(w, card.stability, g), difficulty: nextDifficulty(w, card.difficulty, g) };
  }
  const r = retrievability(elapsedDays, card.stability);
  const difficulty = nextDifficulty(w, card.difficulty, g);
  const stability = g === 1 ? nextForgetStability(w, card.difficulty, card.stability, r) : nextRecallStability(w, card.difficulty, card.stability, r, g);
  return { stability, difficulty };
}

export interface Outcome { card: Card; review: Review; intervalDays: number }

/** Apply a rating to a card at time `now`. Returns the new card and the review record. */
export function rate(card: Card, g: Rating, now: number, cfg: SchedulerConfig = DEFAULT_CONFIG, durationMs = 0): Outcome {
  const w = cfg.w;
  const elapsedDays = card.lastReview ? (now - card.lastReview) / DAY : 0;
  const before = card.state;
  const mem = updateMemory(w, card, g, elapsedDays);
  const next: Card = { ...card, ...mem, reps: card.reps + 1, lastReview: now, mod: now };
  let intervalDays = 0;

  const scheduleReview = () => {
    intervalDays = intervalFor(next.stability, cfg.desiredRetention, cfg.maximumInterval);
    if (g === 4 && before !== "review") intervalDays = Math.max(intervalDays, 4);
    next.state = "review"; next.step = 0;
    next.due = now + intervalDays * DAY;
  };
  const scheduleStep = (idx: number, stepList: number[]) => {
    next.step = idx; next.due = now + stepList[idx] * 60000;
  };

  if (before === "new" || before === "learning") {
    next.state = "learning";
    if (g === 1) scheduleStep(0, cfg.learningSteps);
    else if (g === 2) scheduleStep(Math.min(card.step, cfg.learningSteps.length - 1), cfg.learningSteps);
    else if (g === 3) {
      const nextStep = before === "new" ? 0 + 1 : card.step + 1;
      if (nextStep >= cfg.learningSteps.length) scheduleReview(); else scheduleStep(nextStep, cfg.learningSteps);
    } else scheduleReview();
  } else if (before === "review") {
    if (g === 1) {
      next.lapses = card.lapses + 1;
      next.state = "relearning";
      if (cfg.relearningSteps.length) scheduleStep(0, cfg.relearningSteps); else scheduleReview();
    } else scheduleReview();
  } else { // relearning
    if (g === 1) scheduleStep(0, cfg.relearningSteps);
    else if (g === 2) scheduleStep(Math.min(card.step, cfg.relearningSteps.length - 1), cfg.relearningSteps);
    else {
      const nextStep = card.step + 1;
      if (g === 4 || nextStep >= cfg.relearningSteps.length) scheduleReview(); else scheduleStep(nextStep, cfg.relearningSteps);
    }
  }

  const review: Review = {
    id: `${card.id}-${now}`, cid: card.id, ts: now, rating: g, state: before,
    elapsedDays: Math.round(elapsedDays * 100) / 100, scheduledDays: intervalDays, durationMs,
  };
  return { card: next, review, intervalDays };
}

/** Rebuild a card's memory state from an ordered review history (e.g. imported from Anki). */
export function replay(card: Card, reviews: Review[], w: number[] = DEFAULT_W, retention = 0.9): Card {
  let c: Card = { ...card, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, state: "new", step: 0 };
  if (reviews.length) c.mod = Math.max(c.mod ?? 0, reviews[reviews.length - 1].ts);
  let lastDay = 0;
  for (const r of reviews) {
    const elapsedDays = lastDay ? (r.ts - lastDay) / DAY : 0;
    const mem = updateMemory(w, c, r.rating, elapsedDays);
    const wasReview = c.state === "review";
    c = { ...c, ...mem, reps: c.reps + 1, lastReview: r.ts };
    if (r.rating === 1 && wasReview) c.lapses++;
    // Collapse learning into review once a non-Again rating happens on a different day or after Good/Easy.
    c.state = r.rating === 1 ? (wasReview || c.state === "relearning" ? "relearning" : "learning") : "review";
    if (elapsedDays >= 1 || r.rating >= 3) lastDay = r.ts; else lastDay = lastDay || r.ts;
  }
  if (c.reps === 0) return c;
  if (c.state === "review") {
    const ivl = intervalFor(c.stability, retention, 36500);
    c.due = c.lastReview + ivl * DAY;
  } else {
    c.due = c.lastReview + 10 * 60000; // still in steps: show soon
  }
  return c;
}

export function previewIntervals(card: Card, now: number, cfg: SchedulerConfig = DEFAULT_CONFIG): Record<Rating, string> {
  const out = {} as Record<Rating, string>;
  for (const g of [1, 2, 3, 4] as Rating[]) {
    const { card: c } = rate(card, g, now, cfg);
    out[g] = humanInterval(c.due - now);
  }
  return out;
}

export function humanInterval(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(m, 1)}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(ms / DAY);
  if (d < 30) return `${d}d`;
  const mo = d / 30.4;
  if (mo < 12) return `${mo.toFixed(mo < 2 ? 1 : 0)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
