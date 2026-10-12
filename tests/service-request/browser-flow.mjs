import assert from "node:assert/strict";
import { createServer } from "node:http";
import process from "node:process";
import { withBrowser, until, delay } from "../../../frontend/tests/browser-harness.mjs";

export async function runServiceRequestBrowser({ app, slug, customerId, typeName, prisma, organizationId, admin, permissionId, auditService }) {
  const originalAudit = auditService.recordInTransaction;
  const title = "Browser sink repair";
  try {
    await withBrowser(createServer(app), `/${slug}/service-requests`, async ({ evaluate, ready, click, clickText, fill, call }) => {
      const search = '[aria-label="Search request number or customer"]';
      const text = (value) => until(() => evaluate(`document.body.textContent.includes(${JSON.stringify(value)})`), "Missing text: " + value);
      const closed = () => until(() => evaluate("!document.querySelector('[data-slot=dialog-content]')"), "Dialog did not close");
      const select = (selector, value) => evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await ready(search);
      await text("3 requests");
      await evaluate("window.rejections=[]; window.addEventListener('unhandledrejection',e=>window.rejections.push(String(e.reason)))");
      await clickText("button", "Service types");
      await clickText("button", "Create service type");
      await clickText("button", "Save service type");
      await text("Name is required");
      await fill("#type-name", typeName);
      await fill("#type-description", "Created through browser");
      await fill("#type-price", "75.25");
      await clickText("button", "Save service type");
      await closed();
      const type = await prisma.serviceType.findFirst({ where: { organizationId, name: typeName } });
      assert.ok(type, "Browser service type did not persist");
      assert.equal(String(type.basePrice), "75.25");

      await clickText("button", "Create request");
      await ready("#request-customer option[value='" + customerId + "']");
      await ready("#request-type option[value='" + type.id + "']");
      await clickText("button", "Save request");
      await text("Select a customer"); await text("Title is required");
      await select("#request-customer", customerId); await select("#request-type", type.id);
      await fill("#request-title", title); await fill("#request-description", "Created with real frontend and backend");
      await select("#request-priority", "HIGH");
      auditService.recordInTransaction = async () => { throw new Error("Injected browser audit failure"); };
      await clickText("button", "Save request");
      await text("Internal server error");
      assert.equal(await evaluate("document.querySelector('#request-title').value"), title);
      assert.equal(await prisma.serviceRequest.count({ where: { organizationId, title } }), 0);
      auditService.recordInTransaction = originalAudit;
      await clickText("button", "Save request"); await closed();
      const request = await prisma.serviceRequest.findFirst({ where: { organizationId, title } });
      assert.ok(request, "Browser request did not persist"); assert.equal(request.priority, "HIGH");

      await fill(search, request.referenceNumber); await delay(400);
      await text("1 requests");
      await clickText("tbody button", request.referenceNumber);
      await ready("[data-slot=sheet-content] dl");
      await text("No jobs linked to this request."); await text("Request created");
      await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate("document.querySelector('[data-slot=sheet-content]').getBoundingClientRect().width <= window.innerWidth"), true);
      await call("Emulation.clearDeviceMetricsOverride");
      await clickText("[data-slot=sheet-content] button", "Edit request"); await ready("#request-title");
      await fill("#request-title", title + " updated"); await clickText("button", "Save request"); await closed();
      assert.equal((await prisma.serviceRequest.findUnique({ where: { id: request.id } })).title, title + " updated");
      await clickText("tbody button", request.referenceNumber); await ready("[data-slot=sheet-content] dl");
      await clickText("[data-slot=sheet-content] button", "Start request");
      await until(() => evaluate("[...document.querySelectorAll('[data-slot=sheet-content] dd')].some(el=>el.textContent==='In progress')"), "Status did not refresh");
      await clickText("[data-slot=sheet-content] button", "Complete request");
      await text("Complete every related job");
      await clickText("[data-slot=sheet-content] button", "Cancel request");
      await until(() => evaluate("[...document.querySelectorAll('[data-slot=sheet-content] dd')].some(el=>el.textContent==='Cancelled')"), "Cancellation did not refresh");
      assert.equal((await prisma.serviceRequest.findUnique({ where: { id: request.id } })).status, "CANCELLED");
      await clickText("[data-slot=sheet-content] button", "Close");

      await fill(search, "missing-request"); await delay(400); await text("No results.");
      await clickText("button", "Clear filters"); await text("4 requests");
      await select('[aria-label="Filter request status"]', "COMPLETED"); await text("1 requests");
      await clickText("button", "Clear filters"); await text("4 requests");
      await clickText("button", "Created: Newest first"); await text("Created: Oldest first");
      // Verify server pagination through the actual table with additional tenant-scoped fixtures.
      await prisma.serviceRequest.createMany({ data: Array.from({ length: 10 }, (_, i) => ({
        title: `Pagination ${i}`, customerId, serviceTypeId: type.id, organizationId,
        referenceNumber: `${request.referenceNumber}-PAGE-${i}`,
      })) });
      await clickText("button", "Refresh"); await text("14 requests");
      // The collapsed service type filter also has pagination; target the request footer.
      await click('document.querySelector(\'[aria-label="Service request management"] > div:last-child button[aria-label="Go to next page"]\')');
      await until(() => evaluate("document.querySelectorAll('tbody tr').length===4"), "Server pagination did not advance");
      await fill(search, request.referenceNumber); await delay(400);
      await text("11 requests");
      await fill(search, "does-not-exist"); await delay(400); await text("No results.");
      await clickText("button", "Clear filters"); await text("14 requests");

      await prisma.userPermission.create({ data: { userId: admin, permissionId, isActive: false } });
      await evaluate("window.dispatchEvent(new Event('focus'))");
      await until(() => evaluate("!document.querySelector('[aria-label=\"Service type management\"]')"), "Permission change did not reset page state");
      const pending = await prisma.serviceRequest.findFirst({ where: { organizationId, status: "PENDING" } });
      await fill(search, pending.referenceNumber); await delay(400); await text("1 requests");
      await clickText("tbody button", pending.referenceNumber); await ready("[data-slot=sheet-content] dl");
      assert.equal(await evaluate("[...document.querySelectorAll('[data-slot=sheet-content] button')].some(el=>el.textContent==='Edit request')"), false);
      await clickText("[data-slot=sheet-content] button", "Close");
      await prisma.userPermission.deleteMany({ where: { userId: admin, permissionId } });
      await evaluate("window.dispatchEvent(new Event('focus'))");
      await delay(500);
      await clickText("button", "Service types");
      const typeSearch = '[aria-label="Search service types"]';
      await fill(typeSearch, typeName); await delay(400); await text(typeName);
      await clickText('[aria-label="Service type management"] button', "Archive");
      await clickText('[data-slot=dialog-content] button', "Archive service type"); await closed();
      assert.equal((await prisma.serviceType.findUnique({ where: { id: type.id } })).isActive, false);
      await clickText("button", "Create request"); await ready("#request-type");
      await text("No available service types match this search.");
      assert.equal(await evaluate("document.querySelectorAll('#request-type option').length"), 1);
      await clickText('[data-slot=dialog-content] button', "Cancel"); await closed();
      assert.deepEqual(await evaluate("window.rejections"), []);
      process.stdout.write("Browser creation, validation, failed writes/retry, details, edit, lifecycle, filters, pagination, permissions, archive and mobile sheet passed.\n");
    });
  } finally { auditService.recordInTransaction = originalAudit; }
}
