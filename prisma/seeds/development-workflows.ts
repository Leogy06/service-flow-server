import { randomBytes } from "node:crypto";
import { Prisma } from "../../src/generated/prisma/client.js";
import { calculateItems } from "../../src/modules/invoice/money.js";
import { serviceTypeCatalog } from "./serviceTypes.js";
import { DEVELOPMENT_SEED, developmentId } from "./development-data.js";

/** Small independent tenant workflows complement the detailed electrical fixtures. */
export async function seedDevelopmentWorkflow(db: Prisma.TransactionClient,
  organization: { id: string; slug: string; name: string }, actors: { admin: string; staff: string }, now: Date) {
  const organizationId = organization.id;
  const id = (key: string) => developmentId(`${organizationId}:${key}`);
  const catalog = serviceTypeCatalog(organization);
  if (!catalog) throw new Error("Development service catalog is missing.");
  const services = [];
  for (const fixture of catalog.services) {
    services.push(await db.serviceType.upsert({
      where: { organizationId_name: { organizationId, name: fixture.name } },
      update: {}, create: { ...fixture, organizationId },
    }));
  }
  const service = services.find((item) => item.isActive);
  if (!service) throw new Error("Development workflow requires an active service.");
  const customer = await db.customer.create({ data: {
    id: id("customer"), organizationId, name: `Sample customer (${organization.slug})`,
    email: `customer@${organization.slug}.example.test`,
    phoneNumber: organization.slug === "acme-plumbing" ? "09000001001" : "09000001002",
    address: "100 Sample Street, Quezon City", notes: "Fictional development customer.",
  } });
  const completedAt = new Date(now.getTime() - 86_400_000);
  const startedAt = new Date(completedAt.getTime() - 3_600_000);
  const createdAt = new Date(startedAt.getTime() - 3_600_000);
  const request = await db.serviceRequest.create({ data: {
    id: id("request"), organizationId, customerId: customer.id, serviceTypeId: service.id,
    referenceNumber: `SR-DEV-${organization.slug}`, title: `Sample ${service.name}`,
    description: "Fictional completed service visit for development.", status: "COMPLETED",
    trackingToken: randomBytes(32).toString("hex"), location: customer.address, createdAt, updatedAt: completedAt,
  } });
  const job = await db.job.create({ data: {
    id: id("job"), organizationId, customerId: customer.id, serviceTypeId: service.id,
    serviceRequestId: request.id, assignedStaffId: actors.staff, referenceNumber: `JOB-DEV-${organization.slug}`,
    status: "COMPLETED", description: `Sample ${service.name}`, location: customer.address,
    scheduledStart: startedAt, scheduledEnd: completedAt, startedAt, completedAt, createdAt, updatedAt: completedAt,
    statusHistory: { create: [
      { fromStatus: null, toStatus: "ASSIGNED", changedById: actors.admin, createdAt, note: "Sample dispatch." },
      { fromStatus: "ASSIGNED", toStatus: "IN_PROGRESS", changedById: actors.staff, createdAt: startedAt, note: "Sample work started." },
      { fromStatus: "IN_PROGRESS", toStatus: "COMPLETED", changedById: actors.staff, createdAt: completedAt, note: "Sample completion." },
    ] },
  } });
  const { lines, total } = calculateItems([{ description: service.name, quantity: "1", unitPrice: service.basePrice.toFixed(2) }]);
  if (!total.gt(0)) throw new Error("Development workflow requires a positive service price; existing pricing was preserved.");
  const amountPaid = total.div(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const invoice = await db.invoice.create({ data: {
    id: id("invoice"), organizationId, customerId: customer.id, jobId: job.id,
    invoiceNumber: `INV-DEV-${organization.slug}`, status: amountPaid.gt(0) ? "PARTIALLY_PAID" : "UNPAID",
    subtotal: total, total, amountPaid, issuedAt: completedAt, dueAt: new Date(now.getTime() + 7 * 86_400_000),
    notes: "Fictional development invoice.", items: { create: lines },
    ...(amountPaid.gt(0) ? { payments: { create: { amount: amountPaid, method: "CASH", notes: "Fictional sample receipt." } } } : {}),
  } });
  // Summarize every simulated entity without logging customer details or tracking secrets.
  for (const [entity, entityId] of [["Customer", customer.id], ["Job", job.id], ["ServiceRequest", request.id], ["Invoice", invoice.id]]) {
    await db.auditLog.create({ data: { organizationId, actorId: actors.admin, actorType: "USER",
      action: "seed.development.workflow", entity, entityId,
      metadata: { source: DEVELOPMENT_SEED, simulated: true } } });
  }
}
