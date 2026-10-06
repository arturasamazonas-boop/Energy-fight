import { test } from "node:test";
import assert from "node:assert/strict";
import { PerfWatch } from "../client/src/game/perf.ts";

test("perf watchdog lowers quality step by step only after sustained slow frames", () => {
  const lowered: string[] = [];
  const w = new PerfWatch(["effects", "resolution"], (s) => lowered.push(s));
  const run = (fps: number, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / fps) w.update(1 / fps);
  };
  run(60, 10);
  assert.deepEqual(lowered, [], "fast device keeps full quality");
  run(20, 2);
  run(60, 3);
  assert.deepEqual(lowered, [], "a short hitch is ignored");
  run(25, 12);
  assert.deepEqual(lowered, ["effects"]);
  run(25, 12);
  assert.deepEqual(lowered, ["effects", "resolution"]);
  run(10, 30);
  assert.equal(lowered.length, 2, "never lowers past the last step");
});
