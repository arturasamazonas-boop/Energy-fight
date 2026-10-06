import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { EN, EN_ITEMS } from "../client/src/lang/en.ts";
import { ITEM_BASES, SLOTS } from "../shared/src/index.ts";

test("every Lithuanian text has an English translation and vice versa", () => {
  const src = fs.readFileSync("client/src/i18n.ts", "utf8");
  const ltKeys = new Set([...src.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*"/gim)].map((m) => m[1]));
  const missingEn = [...ltKeys].filter((k) => !(k in EN));
  const missingLt = Object.keys(EN).filter((k) => !ltKeys.has(k));
  assert.deepEqual(missingEn, [], "keys without English text");
  assert.deepEqual(missingLt, [], "keys without Lithuanian text");
});

test("every item base and ULTRA item has an English name", () => {
  for (const s of SLOTS) {
    for (let i = 0; i < ITEM_BASES[s].length; i++) assert.ok(EN_ITEMS[`${s}_${i}`], `${s}_${i}`);
    assert.ok(EN_ITEMS[`ultra_${s}`], `ultra_${s}`);
  }
});
