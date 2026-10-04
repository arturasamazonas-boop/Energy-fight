// Browser end-to-end check in mobile emulation (Chromium, touch, 844×390 landscape).
// This is emulation, not a physical Android/iPhone test.
// Usage: start a server (npm run build && npm start), then
//   E2E_BASE=http://localhost:2567 npm run test:e2e
import { chromium, type Page } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.E2E_BASE ?? "http://localhost:2567";
const out = process.env.E2E_SHOTS ?? "test-results";
fs.mkdirSync(out, { recursive: true });
const exe = fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined;
const browser = await chromium.launch({ executablePath: exe });
const mobile = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors: string[] = [];

async function newPlayer(name: string) {
  const ctx = await browser.newContext(mobile); // isolated storage → separate guest credential
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(base);
  await page.fill(".name", name);
  await page.click(".go");
  await page.waitForSelector(".create-btn");
  return { ctx, page };
}
const self = (p: Page) =>
  p.evaluate(() => {
    const r = (window as any).__ef.room;
    const me = r?.state?.players?.get(r.sessionId);
    return me ? { sid: r.sessionId, x: me.x, y: me.y, life: me.life, n: r.state.players.size, phase: r.state.phase } : null;
  });

const a = await newPlayer("Ana");
const b = await newPlayer("Bo");
await a.page.screenshot({ path: `${out}/lab.png` });
await a.page.click(".create-btn");
await a.page.waitForSelector(".code-box .code:not(:empty)");
const code = (await a.page.textContent(".code-box .code"))!.trim();
await b.page.fill(".code-input", code);
await b.page.click(".join-btn");
await b.page.waitForSelector(".ready-btn");
await b.page.click(".ready-btn");
await a.page.waitForTimeout(300);
await a.page.screenshot({ path: `${out}/lobby.png` });
await a.page.click(".start-btn");
await a.page.waitForSelector(".cbtn.atk");
await b.page.waitForSelector(".cbtn.atk");
console.log("✓ two browser sessions joined by room code and started the mission");

// Multi-touch: stick and attack held together.
const cdp = await a.ctx.newCDPSession(a.page);
const atk = (await a.page.locator(".cbtn.atk").boundingBox())!;
const start = (await self(a.page))!;
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 120, y: 280, id: 1 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 170, y: 280, id: 1 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 170, y: 280, id: 1 }, { x: atk.x + atk.width / 2, y: atk.y + atk.height / 2, id: 2 }] });
await a.page.waitForTimeout(1500);
const moved = (await self(a.page))!;
const held = await a.page.evaluate(() => document.querySelector(".cbtn.atk")!.classList.contains("held"));
await a.page.screenshot({ path: `${out}/fight.png` });
await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
assert.ok(moved.x > start.x + 60, "stick moved the character while attack was held");
assert.ok(held, "attack held simultaneously");
await a.page.waitForTimeout(500);
const x1 = (await self(a.page))!.x;
await a.page.waitForTimeout(700);
assert.ok(Math.abs((await self(a.page))!.x - x1) < 1, "no stuck movement after touch cancel");
console.log("✓ multi-touch move + attack, released cleanly on cancel");

// Reload during combat: same seat and identity, no duplicate.
const before = (await self(b.page))!;
await b.page.reload();
await b.page.waitForSelector(".cbtn.atk", { timeout: 15000 });
await b.page.waitForTimeout(800);
const afterReload = (await self(b.page))!;
assert.equal(afterReload.sid, before.sid, "same session restored after reload");
assert.equal(afterReload.n, 2, "no duplicate character");
const seenByA = await a.page.evaluate((sid) => (window as any).__ef.room.state.players.get(sid)?.connected, before.sid);
assert.equal(seenByA, true);
console.log("✓ page reload during combat restored the same seat");

// Control sizes after scaling (CSS px).
const sizes = await a.page.evaluate(() =>
  [...document.querySelectorAll(".cbtn")].filter((b) => getComputedStyle(b).display !== "none").map((b) => b.getBoundingClientRect().width),
);
assert.ok(sizes.every((w) => w >= 56), `primary controls ≥ 56 CSS px (${sizes.join(", ")})`);
console.log(`✓ visible control sizes: ${sizes.map((s) => Math.round(s)).join(", ")} px`);

// Portrait shows the rotate overlay.
await a.page.setViewportSize({ width: 390, height: 844 });
await a.page.waitForTimeout(200);
assert.equal(await a.page.evaluate(() => getComputedStyle(document.getElementById("rotate")!).display), "flex");
console.log("✓ portrait orientation shows rotate overlay");

assert.deepEqual(errors, [], "no page errors");
await browser.close();
console.log(`screenshots in ${out}/`);
