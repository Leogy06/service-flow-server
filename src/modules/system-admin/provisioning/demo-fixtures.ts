import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { calculateItems } from "@/modules/invoice/money";
import { AppError } from "@/utils/AppError";
import type { IndustryTemplate } from "./templates";

export const sampleId = (provisioningId: string, key: string) => `d${createHash("sha256").update(`${provisioningId}:${key}`).digest("hex").slice(0, 24)}`;
const ids = z.array(z.string().regex(/^d[a-f0-9]{24}$/)).max(30);
const manifestSchema = z.object({ version: z.literal(1), customers: ids, requests: ids, jobs: ids, invoices: ids, payments: ids, invoiceItems: ids, histories: ids }).strict();
export type DemoManifest = z.infer<typeof manifestSchema>;

/** Fictional records only; no tracking links, provider calls, staff identities or real contact data. */
export async function createDemoFixtures(db: Prisma.TransactionClient, provisioningId: string, organizationId: string, template: IndustryTemplate, now = new Date()): Promise<DemoManifest> {
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { isDemo: true } });
  if (!organization?.isDemo) throw new AppError(409, "Sample data requires a demo organization");
  const manifest: DemoManifest = { version: 1, customers: [], requests: [], jobs: [], invoices: [], payments: [], invoiceItems: [], histories: [] };
  const customerNames = ["Harbor View Demo Residence", "Cedar Lane Demo Office", "Maple Court Demo Property"];
  for (const [index, scenario] of template.scenarios.entries()) {
    const customerId = sampleId(provisioningId, `customer:${index}`);
    const requestId = sampleId(provisioningId, `request:${index}`);
    const jobId = sampleId(provisioningId, `job:${index}`);
    const serviceTypeId = sampleId(provisioningId, `service:${index}`);
    const completed = index < 2;
    const scheduledStart = new Date(now.getTime() + (completed ? -9 + index * 4 : 2) * 86_400_000);
    const scheduledEnd = new Date(scheduledStart.getTime() + 2 * 3_600_000);
    const requestedAt = new Date((completed ? scheduledStart : now).getTime() - 86_400_000);
    const assignedAt = new Date((completed ? scheduledStart : now).getTime() - 12 * 3_600_000);
    const reference = `${provisioningId.slice(0, 12).toUpperCase()}-${index + 1}`;
    const sampleNotes = "[Demo sample] Fictional scenario for presentation and training only.";
    await db.customer.create({ data: {
      id: customerId, organizationId, name: `${customerNames[index]} [Demo sample]`,
      email: `customer-${index + 1}@${provisioningId.slice(0, 12)}.example.test`,
      // Reserved international example numbers; never presented as reachable customer contacts.
      phoneNumber: `+1202555010${index + 1}`, address: `${index + 1} Example Lane, Demonstration District`, notes: sampleNotes,
      createdAt: new Date(now.getTime() - 30 * 86_400_000),
    } });
    await db.serviceRequest.create({ data: {
      id: requestId, organizationId, customerId, serviceTypeId, referenceNumber: `DEMO-SR-${reference}`,
      title: `[Demo sample] ${scenario.title}`, description: `${sampleNotes} ${scenario.description}`,
      location: "Fictional demonstration site", preferredDate: scheduledStart,
      status: completed ? "COMPLETED" : "PENDING", priority: index === 1 ? "HIGH" : "NORMAL", trackingToken: null,
      createdAt: requestedAt,
    } });
    await db.job.create({ data: {
      id: jobId, organizationId, customerId, serviceTypeId, serviceRequestId: requestId,
      referenceNumber: `DEMO-JOB-${reference}`, description: `[Demo sample] ${scenario.title}`,
      location: "Fictional demonstration site", scheduledStart, scheduledEnd, assignedStaffId: null,
      status: completed ? "COMPLETED" : "ASSIGNED",
      createdAt: assignedAt,
      ...(completed ? { startedAt: scheduledStart, completedAt: scheduledEnd } : {}),
      internalNotes: `${sampleNotes}${completed ? ` ${scenario.completionNote}` : " Awaiting a demonstration appointment."}`,
    } });
    const transitions = completed ? ["ASSIGNED", "IN_PROGRESS", "COMPLETED"] as const : ["ASSIGNED"] as const;
    for (const [step, status] of transitions.entries()) {
      const id = sampleId(provisioningId, `history:${index}:${step}`);
      await db.jobStatusHistory.create({ data: {
        id, jobId, fromStatus: step === 0 ? null : transitions[step - 1], toStatus: status,
        note: sampleNotes, changedById: null, createdAt: step === 0 ? assignedAt : step === 1 ? scheduledStart : scheduledEnd,
      } });
      manifest.histories.push(id);
    }
    manifest.customers.push(customerId); manifest.requests.push(requestId); manifest.jobs.push(jobId);
    if (!completed) continue;
    const invoiceId = sampleId(provisioningId, `invoice:${index}`);
    const paymentId = sampleId(provisioningId, `payment:${index}`);
    const itemId = sampleId(provisioningId, `invoice-item:${index}`);
    // Demonstration invoice values are independent of the unconfirmed starter catalog prices.
    const { lines, total } = calculateItems([{ description: `[Demo sample] ${scenario.title}`, quantity: "1", unitPrice: index === 0 ? "1600.00" : "2400.00" }]);
    const paid = index === 0 ? total : new Prisma.Decimal("800.00");
    await db.invoice.create({ data: {
      id: invoiceId, organizationId, customerId, jobId, invoiceNumber: `DEMO-INV-${reference}`,
      status: index === 0 ? "PAID" : "PARTIALLY_PAID", subtotal: total, total, amountPaid: paid,
      issuedAt: scheduledEnd, createdAt: scheduledEnd, dueAt: new Date(scheduledEnd.getTime() + 7 * 86_400_000), notes: sampleNotes,
    } });
    await db.invoiceItem.create({ data: { id: itemId, invoiceId, createdAt: scheduledEnd, ...lines[0]! } });
    await db.payment.create({ data: {
      id: paymentId, invoiceId, amount: paid, method: "CASH", referenceNumber: `DEMO-PAY-${reference}`,
      receivedAt: scheduledEnd, createdAt: scheduledEnd, notes: `${sampleNotes} No money was collected.`,
    } });
    manifest.invoices.push(invoiceId); manifest.payments.push(paymentId); manifest.invoiceItems.push(itemId);
  }
  return manifest;
}

/** Remove only the saved fixture manifest, refusing custom rows linked to its records. */
export async function removeDemoFixtures(db: Prisma.TransactionClient, organizationId: string, rawManifest: Prisma.JsonValue | null) {
  const parsed = manifestSchema.safeParse(rawManifest);
  if (!parsed.success) throw new AppError(409, "Sample record ownership is unavailable; no records were removed");
  const m = parsed.data;
  const references = await Promise.all([
    db.serviceRequest.count({ where: { organizationId, customerId: { in: m.customers }, id: { notIn: m.requests } } }),
    db.job.count({ where: { organizationId, id: { notIn: m.jobs }, OR: [{ customerId: { in: m.customers } }, { serviceRequestId: { in: m.requests } }] } }),
    db.invoice.count({ where: { organizationId, id: { notIn: m.invoices }, OR: [{ customerId: { in: m.customers } }, { jobId: { in: m.jobs } }] } }),
    db.feedbackInvitation.count({ where: { organizationId, serviceRequestId: { in: m.requests } } }),
    db.jobStatusHistory.count({ where: { jobId: { in: m.jobs }, job: { organizationId }, id: { notIn: m.histories } } }),
    db.invoiceItem.count({ where: { invoiceId: { in: m.invoices }, invoice: { organizationId }, id: { notIn: m.invoiceItems } } }),
    db.payment.count({ where: { invoiceId: { in: m.invoices }, invoice: { organizationId }, id: { notIn: m.payments } } }),
  ]);
  if (references.some((count) => count > 0)) throw new AppError(409, "Custom records reference sample operations. Remove those links before resetting the demo.");
  await db.payment.deleteMany({ where: { id: { in: m.payments }, invoice: { organizationId } } });
  await db.invoiceItem.deleteMany({ where: { id: { in: m.invoiceItems }, invoice: { organizationId } } });
  await db.invoice.deleteMany({ where: { id: { in: m.invoices }, organizationId } });
  await db.jobStatusHistory.deleteMany({ where: { id: { in: m.histories }, job: { organizationId } } });
  await db.job.deleteMany({ where: { id: { in: m.jobs }, organizationId } });
  await db.serviceRequest.deleteMany({ where: { id: { in: m.requests }, organizationId } });
  await db.customer.deleteMany({ where: { id: { in: m.customers }, organizationId } });
}
