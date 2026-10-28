import { test } from "node:test"; import assert from "node:assert/strict";
import { DEFAULT_W, updateMemory, toFsrs6, FSRS5_DEFAULT_W, retrievability, intervalFor } from "../src/scheduler/fsrs.ts";
const close = (a: number, b: number, tol = 1e-4) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test("FSRS-6 matches the reference (ts-fsrs/fsrs-rs memory-state vectors)", () => {
  // ts-fsrs legacy/__tests__/FSRS-6.test.ts — "memory state using next_state[short-term]"
  const ratings = [1, 3, 3, 3, 3, 3] as const, days = [0, 0, 1, 3, 8, 21];
  let c = { stability: 0, difficulty: 0, reps: 0 };
  ratings.forEach((g, i) => { const m = updateMemory(DEFAULT_W, c, g, days[i]); c = { ...m, reps: c.reps + 1 }; });
  close(c.stability, 53.62691); close(c.difficulty, 6.3574867);
  // "first repeat": initial stability and difficulty per rating
  const init = ([1, 2, 3, 4] as const).map((g) => updateMemory(DEFAULT_W, { stability: 0, difficulty: 0, reps: 0 }, g, 0));
  assert.deepEqual(init.map((m) => m.stability), [0.212, 1.2931, 2.3065, 8.2956]);
  [6.4133, 5.11217071, 2.11810397, 1].forEach((d, i) => close(init[i].difficulty, d, 1e-6));
});

test("FSRS-6: retrievability is 90% at stability; interval = stability at 90% retention", () => {
  close(retrievability(10, 10, DEFAULT_W), 0.9, 1e-9); assert.equal(intervalFor(10, 0.9, 36500, DEFAULT_W), 10);
  assert.ok(intervalFor(10, 0.85, 36500, DEFAULT_W) > 10 && intervalFor(10, 0.95, 36500, DEFAULT_W) < 10);
});

test("upgrading saved weights: FSRS-5 defaults → FSRS-6 defaults; tuned FSRS-5 keeps its behaviour", () => {
  assert.deepEqual(toFsrs6(FSRS5_DEFAULT_W), DEFAULT_W);
  const tuned = FSRS5_DEFAULT_W.map((x) => x * 1.1); const up = toFsrs6(tuned);
  assert.equal(up.length, 21); assert.equal(up[19], 0); assert.equal(up[20], 0.5);
  // with decay 0.5 the curve is FSRS-5's: R = (1 + 19/81 · t/S)^-0.5
  close(retrievability(30, 10, up), Math.pow(1 + (19 / 81) * 3, -0.5), 1e-9);
});
