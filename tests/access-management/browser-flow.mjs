// Optional browser verification using the installed Edge and its DevTools protocol.
// No browser framework or production dependency is added.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm, access, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve, relative, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";

const { fetch, WebSocket } = globalThis;

async function port() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const selected = server.address().port;
  await new Promise((done) => server.close(done));
  return selected;
}
async function until(check, message, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* Wait for compilation/navigation. */ }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(message);
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((done) => execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => done()));
  } else child.kill("SIGTERM");
}
async function removeProfile(profileRoot, profile) {
  const withinTemp = relative(profileRoot, resolve(profile));
  if (!withinTemp || withinTemp.startsWith("..") || isAbsolute(withinTemp) || !withinTemp.startsWith("service-flow-permissions-")) throw new Error("Unexpected browser profile path");
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
async function removeBuildOutput(frontend) {
  const buildRoot = resolve(frontend, ".next");
  const target = resolve(buildRoot, "permission-tests");
  if (relative(buildRoot, target) !== "permission-tests") throw new Error("Unexpected browser test output path");
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
async function restoreGeneratedConfig(frontend, originalConfig, originalEnv) {
  const path = join(frontend, "tsconfig.json");
  const current = JSON.parse(await readFile(path, "utf8"));
  current.include = current.include.filter((entry) => !entry.startsWith(".next/permission-tests/"));
  const normalizedOriginal = JSON.parse(originalConfig);
  normalizedOriginal.include = normalizedOriginal.include.filter((entry) => !entry.startsWith(".next/permission-tests/"));
  const unchanged = JSON.stringify(current) === JSON.stringify(normalizedOriginal);
  await writeFile(path, unchanged ? originalConfig : JSON.stringify(current, null, 2) + "\n");
  const envPath = join(frontend, "next-env.d.ts");
  const currentEnv = await readFile(envPath, "utf8");
  if (currentEnv.includes(".next/permission-tests/")) await writeFile(envPath, originalEnv.replaceAll(".next/permission-tests/", ".next/"));
}

export async function runBrowserFlow({ apiUrl, slug, email, password, staffEmail, verify }) {
  const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "../../../frontend");
  const browser = process.env.ACCESS_TEST_BROWSER ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  await access(browser);
  const webPort = await port(), debugPort = await port();
  const origin = `http://localhost:${webPort}`;
  const profileRoot = resolve(tmpdir());
  const profile = await mkdtemp(join(profileRoot, "service-flow-permissions-"));
  const originalConfig = await readFile(join(frontend, "tsconfig.json"), "utf8");
  const originalEnv = await readFile(join(frontend, "next-env.d.ts"), "utf8");
  let next, edge, socket;
  try {
    next = spawn(process.execPath, [join(frontend, "node_modules/next/dist/bin/next"), "dev", "--hostname", "localhost", "--port", String(webPort)], {
      cwd: frontend, env: { ...process.env, NODE_ENV: "development", NEXT_PUBLIC_API_URL: apiUrl, NEXT_TELEMETRY_DISABLED: "1", SERVICE_FLOW_ACCESS_TEST_RUN: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let nextOutput = "";
    for (const stream of [next.stdout, next.stderr]) stream.on("data", (data) => { nextOutput = (nextOutput + data.toString()).slice(-4000); });
    try { await until(async () => (await fetch(origin + "/login")).ok, "Next.js login page did not start"); }
    catch { throw new Error(`Next.js login page did not start: ${nextOutput}`); }
    edge = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
    let target;
    await until(async () => { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((page) => page.type === "page"); return !!target; }, "Headless Edge did not start");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const reply = JSON.parse(event.data);
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      clearTimeout(request.timer);
      if (reply.error) request.reject(new Error(reply.error.message));
      else request.resolve(reply.result);
    });
    function call(method, params = {}) {
      return new Promise((resolveCall, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 15000);
        pending.set(id, { resolve: resolveCall, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evaluate(expression) {
      const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error("Browser interaction failed");
      return result.result.value;
    }
    const ready = (selector) => until(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `Missing browser control: ${selector}`);
    async function mouseClick(expression) {
      const point = await evaluate(`(() => { const element = ${expression}; element.scrollIntoView({ block: 'center' }); const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
      await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    }
    const click = (selector) => mouseClick(`document.querySelector(${JSON.stringify(selector)})`);
    const clickText = async (selector, text) => {
      await until(() => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(element => element.textContent.trim() === ${JSON.stringify(text)})`), `Missing browser action: ${text}`);
      await mouseClick(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.trim() === ${JSON.stringify(text)})`);
    };
    async function fill(selector, value) {
      await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); input.select(); })()`);
      await call("Input.insertText", { text: value });
    }
    async function openStaff() {
      await until(() => evaluate(`[...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes(${JSON.stringify(staffEmail)}))`), "Staff row did not load");
      await mouseClick(`[...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes(${JSON.stringify(staffEmail)})).querySelector('button')`);
      await clickText('[role="menuitem"]', "Manage Permissions");
      await ready('[aria-label="Override for customer:read"]');
    }
    async function choose(permission, state) {
      await click(`[aria-label="Override for ${permission}"]`);
      await ready('[data-slot="select-content"][data-open]');
      async function key(name, code) {
        await call("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code });
        await call("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
      }
      await key(state === "Deny" ? "End" : "Home", state === "Deny" ? 35 : 36);
      if (state === "Grant") await key("ArrowDown", 40);
      await key("Enter", 13);
      try { await until(() => evaluate(`document.querySelector(${JSON.stringify(`[aria-label="Override for ${permission}"] [data-slot="select-value"]`)}).textContent.trim() === ${JSON.stringify(state)}`), `Override selection did not update: ${permission}`, 5000); }
      catch { throw new Error(`Override selection did not update: ${await evaluate("document.body.innerText.slice(-1800)")}`); }
    }
    async function save() {
      await clickText('[role="dialog"] button', "Save Changes");
      await clickText('[role="alertdialog"] button', "Confirm");
      try {
        await until(() => evaluate(`!!document.querySelector('[role="dialog"]') && [...document.querySelectorAll('[role="dialog"] span[role="status"]')].some(element => element.textContent === 'No unsaved changes')`), "Permission save was not acknowledged");
      } catch {
        const state = await evaluate("JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(-1800) })");
        throw new Error(`Permission save was not acknowledged: ${state}`);
      }
    }
    await call("Page.enable");
    await call("Page.navigate", { url: origin + "/login" });
    await ready("#email");
    await until(() => evaluate(`Object.keys(document.querySelector('#email')).some(key => key.startsWith('__reactProps$'))`), "Login form did not hydrate");
    await fill("#email", email);
    await fill("#password", password);
    await evaluate("document.querySelector('form').requestSubmit()");
    try { await until(() => evaluate(`location.pathname.endsWith('/dashboard')`), "Actual login did not complete"); }
    catch { throw new Error(`Actual login did not complete: ${await evaluate("JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(-900) })")}`); }
    await call("Page.navigate", { url: `${origin}/${slug}/user-management` });
    await openStaff();
    assert.equal(await evaluate(`document.querySelector('[aria-label="Effective access for customer:read"]').getAttribute('aria-checked')`), "true");
    await click('[aria-label="Effective access for customer:read"]');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Effective access for customer:read"]').getAttribute('aria-checked')`), "false");
    await clickText('[role="dialog"] button', "Cancel");
    await clickText('[role="alertdialog"] button', "Discard changes");
    await verify("inherit");
    await openStaff();
    await choose("customer:read", "Deny");
    await choose("customer:update", "Grant");
    await save();
    await verify("denied");
    await call("Page.reload");
    await openStaff();
    assert.equal(await evaluate(`document.querySelector('[aria-label="Override for customer:read"] [data-slot="select-value"]').textContent.trim()`), "Deny");
    assert.equal(await evaluate(`document.querySelector('[aria-label="Effective access for customer:update"]').getAttribute('aria-checked')`), "true");
    await choose("customer:read", "Inherit");
    assert.equal(await evaluate(`document.querySelector('[aria-label="Effective access for customer:read"]').getAttribute('aria-checked')`), "true");
    await save();
    await verify("inherit");
    await call("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, "Mobile dialog overflows horizontally");
  } finally {
    socket?.close();
    await stop(edge);
    await stop(next);
    await restoreGeneratedConfig(frontend, originalConfig, originalEnv);
    await removeBuildOutput(frontend);
    // Validate the resolved target before removing this test's temporary browser profile.
    await removeProfile(profileRoot, profile);
  }
}
