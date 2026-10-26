// Opt-in real Chromium/touch regression. Set SCENE_MOBILE_BROWSER_TEST=1.
// Optional: SCENE_PLAYWRIGHT_MODULE and SCENE_BROWSER_EXECUTABLE select existing
// local tooling. This test never installs software or contacts Twitch services.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "vite";

test("mounted mobile actions, live carousel, reconnect and visibility work without randomUUID", { skip: process.env.SCENE_MOBILE_BROWSER_TEST !== "1", timeout: 30000 }, async t => {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.SCENE_PLAYWRIGHT_MODULE || "playwright");
  const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  t.after(() => server.close());
  await server.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.SCENE_BROWSER_EXECUTABLE ? { executablePath: process.env.SCENE_BROWSER_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 360, height: 520 }, isMobile: true, hasTouch: true });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/mobile-mounted.html?withoutUuid=1`);
  await page.getByRole("heading", { name: "@funkyoushift" }).waitFor();
  await page.getByRole("button", { name: /Your moment/ }).tap();
  await page.locator(".mobile-burst").waitFor({ state: "visible" });
  assert.match(await page.locator(".mobile-burst").textContent(), /You made this moment!/);
  assert.equal(await page.locator("#fixture-errors").textContent(), "");
  await page.getByRole("button", { name: "Dismiss celebration" }).tap();
  await page.locator(".mobile-burst").waitFor({ state: "detached" });
  await page.getByRole("button", { name: /Your moment/ }).tap();
  await page.locator(".mobile-burst").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Dismiss celebration" }).tap();
  await page.getByRole("button", { name: /About this channel/ }).tap();
  await page.locator(".mobile-detail").waitFor({ state: "visible" });
  assert.match(await page.locator(".mobile-detail").textContent(), /You found the message/);
  await page.getByRole("button", { name: /Send some love/ }).tap();
  await page.getByText("1 from you this visit", { exact: false }).waitFor();
  assert.equal(await page.locator("#fixture-errors").textContent(), "");

  await page.getByText("Channel effects loaded. Waiting for a live moment.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Send mock carousel", exact: true }).tap();
  await page.getByRole("complementary", { name: "Fixture collection" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Next slide", exact: true }).tap();
  await page.getByText("Fixture shirt", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Dismiss carousel", exact: true }).tap();
  await page.getByRole("button", { name: "Expire mock moment", exact: true }).tap();

  await page.getByRole("button", { name: "Fail config requests", exact: true }).tap();
  await page.getByRole("button", { name: "Reconnect live moments", exact: true }).tap();
  await page.getByText(/Live moments could not connect/).waitFor();
  await page.getByRole("button", { name: "Restore config requests", exact: true }).tap();
  await page.getByRole("button", { name: "Reconnect live moments", exact: true }).tap();
  await page.getByText("Channel effects loaded. Waiting for a live moment.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Send mock carousel", exact: true }).tap();
  await page.getByRole("complementary", { name: "Fixture collection" }).waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Simulate hidden view", exact: true }).tap();
  await page.getByRole("complementary", { name: "Fixture collection" }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Send mock carousel", exact: true }).tap();
  await page.getByRole("button", { name: "Simulate visible view", exact: true }).tap();
  await page.getByRole("complementary", { name: "Fixture collection" }).waitFor({ state: "visible" });
  assert.match(await page.locator("#fixture-status").textContent(), /active reads: [1-9]/, "returning to the view retrieves the still-active moment");
  await page.getByRole("button", { name: "Simulate hidden view", exact: true }).tap();
  await page.getByRole("button", { name: "Expire mock moment", exact: true }).tap();
  await page.getByRole("button", { name: "Simulate visible view", exact: true }).tap();
  await page.getByText("Channel effects loaded. Waiting for a live moment.", { exact: true }).waitFor();
  assert.equal(await page.locator(".ss-live-card").count(), 0, "expired moments are not replayed after reopening");
  assert.equal(await page.locator("#fixture-errors").textContent(), "");
});
