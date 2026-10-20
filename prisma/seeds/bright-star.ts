import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient, type JobStatus } from "../../src/generated/prisma/client.js";
import { calculateItems } from "../../src/modules/invoice/money.js";
import { BRIGHT_STAR_SEED, BRIGHT_STAR_SLUG, brightStarCustomers, brightStarServices, brightStarScenarios, brightStarDate } from "./bright-star-data.js";

export const brightStarId = (organizationId: string, key: string) =>
  `c${createHash("sha256").update(`${BRIGHT_STAR_SEED}:${organizationId}:${key}`).digest("hex").slice(0, 24)}`;

export function brightStarCustomerData(organizationId: string, index: number) {
  const customer = brightStarCustomers[index]!;
  const id = brightStarId(organizationId, `customer:${index}`);
  return {
    id, organizationId, name: customer.name, address: customer.address,
    email: `customer-${index + 1}@bright-star.example.test`,
    phoneNumber: `09${String(Number.parseInt(createHash("sha256").update(id).digest("hex").slice(0, 10), 16) % 1_000_000_000).padStart(9, "0")}`,
    notes: `${customer.notes} [Sample record]`,
  };
}

async function target(db: Prisma.TransactionClient) {
  const organization = await db.organization.findUnique({ where: { slug: BRIGHT_STAR_SLUG },
    select: { id: true, name: true, slug: true, status: true } });
  if (!organization) throw new Error(`Existing organization ${BRIGHT_STAR_SLUG} was not found; no organization will be created.`);
  if (organization.status !== "ACTIVE") throw new Error("Bright Star Electrical must be active before demo data can be added.");
  const users = await db.user.findMany({ where: {
    organizationId: organization.id, status: "ACTIVE", deletedAt: null,
    securityStatus: "ACTIVE", platformRole: "NONE",
    role: { organizationId: organization.id, deletedAt: null },
  }, select: { id: true, role: { select: { name: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const role = (name: string) => users.find((user) => user.role.name.toLowerCase().replace(/[\s_-]/g, "") === name);
  const admin = role("admin") ?? role("tenantadmin");
  const manager = role("manager");
  const staff = role("staff");
  if (!admin || !manager || !staff) throw new Error("An active tenant Admin, Manager and Staff member are required; existing accounts and permissions are preserved.");
  return { organization, admin, manager, staff };
}

export async function inspectBrightStarSeed(db: Prisma.TransactionClient) {
  const actors = await target(db);
  const organizationId = actors.organization.id;
  const marker = await db.auditLog.findUnique({ where: { id: brightStarId(organizationId, "batch") },
    select: { organizationId: true, action: true, entityId: true, metadata: true } });
  if (marker && (marker.organizationId !== organizationId || marker.entityId !== organizationId || marker.action !== "seed.bright_star.completed"))
    throw new Error("Seed marker ownership mismatch.");
  if (!marker) {
    const customers = brightStarCustomers.map((_, index) => brightStarCustomerData(organizationId, index));
    const collision = await db.customer.findFirst({ where: { OR: [
      { id: { in: customers.map((row) => row.id) } },
      { name: { in: customers.map((row) => row.name) } },
      { email: { in: customers.map((row) => row.email) } },
      { phoneNumber: { in: customers.map((row) => row.phoneNumber) } },
    ] }, select: { id: true } });
    if (collision) throw new Error("A demo customer conflicts with an existing record. Nothing was changed; inspect the conflict instead of overwriting it.");
  }
  return { ...actors, marker };
}

const billedItems = [
  [{ description: "Electrical inspection and written findings report", quantity: "1", unitPrice: "700.00" }, { description: "Insulation resistance and earth continuity tests", quantity: "1", unitPrice: "650.00" }],
  [{ description: "Breaker diagnosis, replacement and commissioning labor", quantity: "1", unitPrice: "1000.00" }, { description: "DIN-rail circuit breaker, approved rating", quantity: "1", unitPrice: "850.00" }],
  [{ description: "Light fixture installation and switching tests", quantity: "3", unitPrice: "700.00" }, { description: "Connectors, fixings and consumables", quantity: "1", unitPrice: "350.00" }],
  [{ description: "Outlet replacement labor and polarity checks", quantity: "2", unitPrice: "500.00" }, { description: "Grounded receptacle and faceplate", quantity: "2", unitPrice: "385.50" }],
  [{ description: "Switch replacement labor", quantity: "4", unitPrice: "400.00" }, { description: "Replacement switch mechanism and plate", quantity: "4", unitPrice: "245.00" }],
  [{ description: "Dedicated circuit installation and commissioning", quantity: "1", unitPrice: "4500.00" }, { description: "THHN copper wire, measured route in meters", quantity: "24.5", unitPrice: "125.75" }, { description: "Protective breaker, isolator and enclosure", quantity: "1", unitPrice: "2250.00" }],
  [{ description: "Panel upgrade labor, isolation and load tests", quantity: "1", unitPrice: "12500.00" }, { description: "Distribution board with coordinated protection", quantity: "1", unitPrice: "8450.00" }, { description: "Circuit labels, cable lugs and gland kit", quantity: "1", unitPrice: "1350.00" }],
  [{ description: "Emergency lighting maintenance and discharge test", quantity: "1", unitPrice: "1800.00" }, { description: "Replacement emergency-light battery pack", quantity: "4", unitPrice: "625.00" }],
];

export async function seedBrightStarInTransaction(db: Prisma.TransactionClient, now = new Date()) {
    // Serialize this additive batch, including concurrent reruns, without resetting tables.
    await db.$queryRaw`SELECT id FROM Organization WHERE slug = ${BRIGHT_STAR_SLUG} FOR UPDATE`;
    const { organization, admin, manager, staff, marker } = await inspectBrightStarSeed(db);
    const organizationId = organization.id;
    if (marker) return { status: "already-seeded" as const, organizationId, summary: marker.metadata };
    const id = (key: string) => brightStarId(organizationId, key);
    const date = (day: number, hour = 9) => brightStarDate(now, day, hour);
    const audits: Prisma.AuditLogCreateManyInput[] = [];
    const audit = (key: string, actorId: string | null, action: string, entity: string, entityId: string,
      createdAt: Date, after: Prisma.InputJsonObject, before?: Prisma.InputJsonObject, scope: "TENANT" | "PLATFORM" = "TENANT") => {
      audits.push({ id: id(`audit:${key}`), organizationId, scope,
        actorId, actorType: actorId ? "USER" : "CUSTOMER", action, entity, entityId, createdAt,
        metadata: { source: BRIGHT_STAR_SEED, simulated: true, after, ...(before ? { before } : {}) } });
    };

    const customers = [];
    for (const [index, fixture] of brightStarCustomers.entries()) {
      const createdAt = date(-65 + index);
      const deletedAt = fixture.archived ? date(-10) : null;
      const customer = await db.customer.create({ data: { ...brightStarCustomerData(organizationId, index), createdAt, updatedAt: deletedAt ?? createdAt, deletedAt } });
      customers.push(customer);
      audit(`customer:${index}`, admin.id, "create.customer.success", "Customer", customer.id, createdAt, { name: customer.name });
      if (deletedAt) audit(`customer:${index}:archive`, admin.id, "delete.customer.success", "Customer", customer.id, deletedAt, { deletedAt: deletedAt.toISOString() });
    }

    const services = [];
    let createdServices = 0;
    for (const [index, fixture] of brightStarServices.entries()) {
      const existing = await db.serviceType.findUnique({ where: { organizationId_name: { organizationId, name: fixture.name } } });
      if (existing) {
        if (existing.isActive !== (fixture.isActive ?? true)) throw new Error(`Service type ${fixture.name} has a different active state; it was preserved and the batch was rolled back.`);
        services.push(existing);
        continue;
      }
      const createdAt = date(-66);
      const service = await db.serviceType.create({ data: { ...fixture, id: id(`service:${index}`), organizationId, createdAt, updatedAt: createdAt } });
      services.push(service);
      createdServices++;
      audit(`service:${index}`, admin.id, "create.service_type.success", "ServiceType", service.id, createdAt, { name: service.name, isActive: service.isActive });
    }

    let jobs = 0, histories = 0, invoices = 0, payments = 0;
    const completedRequests: { id: string; completedAt: Date; customerName: string }[] = [];
    for (const scenario of brightStarScenarios) {
      const customer = customers[scenario.customer]!;
      const service = services[scenario.service]!;
      const requestId = id(`request:${scenario.key}`);
      const createdAt = date(Math.min(scenario.day - 4, -4));
      // Today's completion stays in the past even when the seed runs before business hours.
      const finish = scenario.day === 0 && scenario.status === "COMPLETED"
        ? new Date(date(0, 0).getTime() + (now.getTime() - date(0, 0).getTime()) / 2)
        : date(Math.max(scenario.day, ...scenario.jobs.map((job) => job.day)), 14);
      await db.serviceRequest.create({ data: {
        id: requestId, organizationId, customerId: customer.id, serviceTypeId: service.id,
        referenceNumber: `SR-BSE-DEMO-${scenario.key}`, title: scenario.title, description: scenario.description,
        priority: scenario.priority, status: scenario.status, location: customer.address,
        preferredDate: date(scenario.day), trackingToken: randomBytes(32).toString("hex"), createdAt, updatedAt: createdAt,
      } });
      audit(`request:${scenario.key}`, manager.id, "create.service_request.success", "ServiceRequest", requestId, createdAt,
        { title: scenario.title, status: "PENDING", priority: scenario.priority });

      const jobRows = [];
      for (const [index, fixture] of scenario.jobs.entries()) {
        const key = `${scenario.key}:${index}`;
        const jobId = id(`job:${key}`);
        const assignedStaffId = fixture.unassigned ? null : fixture.assignee === "manager" ? manager.id : staff.id;
        const jobCreatedAt = new Date(createdAt.getTime() + 3_600_000);
        const completedAt = fixture.status === "COMPLETED" ? (scenario.day === 0 && scenario.status === "COMPLETED" ? new Date(finish.getTime() - 60_000) : date(fixture.day, 13)) : null;
        const startedAt = fixture.status === "COMPLETED" ? new Date(completedAt!.getTime() - 2 * 3_600_000)
          : fixture.status === "IN_PROGRESS" ? date(Math.min(fixture.day, -1), 10) : null;
        const changedAt = completedAt ?? startedAt ?? (fixture.status === "CANCELLED" ? date(fixture.day, 12) : jobCreatedAt);
        const job = await db.job.create({ data: {
          id: jobId, organizationId, customerId: customer.id, serviceTypeId: service.id, serviceRequestId: requestId,
          referenceNumber: `JOB-BSE-DEMO-${scenario.key}-${index + 1}`, assignedStaffId,
          description: fixture.description, location: customer.address, status: fixture.status,
          scheduledStart: fixture.unscheduled ? null : scenario.key === "25" ? startedAt : date(fixture.day),
          scheduledEnd: fixture.unscheduled ? null : scenario.key === "25" ? completedAt : date(fixture.day, 14), startedAt, completedAt,
          internalNotes: fixture.status === "CANCELLED" ? "Customer cancelled before dispatch; no billable work performed."
            : fixture.status === "IN_PROGRESS" ? "Follow lockout procedures. Confirm parts availability and call the site contact before re-energizing."
            : fixture.status === "COMPLETED" ? "Test results recorded; work area cleared and customer handover completed."
            : "Confirm site access with the contact before leaving the workshop.",
          createdAt: jobCreatedAt, updatedAt: changedAt,
        } });
        jobRows.push(job);
        jobs++;
        audit(`job:${key}`, manager.id, "create.job.success", "Job", jobId, jobCreatedAt, { serviceRequestId: requestId, assignedStaffId });
        const transitions: { to: JobStatus; at: Date; note: string }[] = [
          { to: "ASSIGNED", at: jobCreatedAt, note: fixture.unassigned ? "Work order opened; technician and access time awaiting dispatch." : "Dispatch assigned the work order and confirmed the site instructions." },
          ...(startedAt ? [{ to: "IN_PROGRESS" as const, at: startedAt, note: "Technician arrived, isolated the circuit and began the approved work." }] : []),
          ...(completedAt ? [{ to: "COMPLETED" as const, at: completedAt, note: "Testing passed, site cleared and completion checklist handed over." }] : []),
          ...(fixture.status === "CANCELLED" ? [{ to: "CANCELLED" as const, at: changedAt, note: "Customer changed the layout; visit cancelled before work started." }] : []),
        ];
        for (const [step, transition] of transitions.entries()) {
          const fromStatus = step ? transitions[step - 1]!.to : null;
          const changedById = step === 0 || transition.to === "CANCELLED" ? manager.id : assignedStaffId!;
          await db.jobStatusHistory.create({ data: { id: id(`history:${key}:${step}`), jobId, fromStatus, toStatus: transition.to,
            changedById, note: transition.note, createdAt: transition.at } });
          histories++;
          if (step) audit(`job:${key}:${step}`, changedById, "status_change.job.success", "Job", jobId, transition.at, { status: transition.to }, { status: fromStatus });
        }
      }

      const firstStartedJob = jobRows.filter((job) => job.startedAt).sort((a, b) => a.startedAt!.getTime() - b.startedAt!.getTime())[0];
      const firstStart = firstStartedJob?.startedAt;
      const requestUpdatedAt = scenario.status === "COMPLETED" || scenario.status === "CANCELLED" ? finish
        : new Date(Math.max(createdAt.getTime(), ...jobRows.map((job) => job.updatedAt.getTime())));
      await db.serviceRequest.update({ where: { id: requestId, organizationId }, data: { updatedAt: requestUpdatedAt } });
      if (firstStart) audit(`request:${scenario.key}:start`, firstStartedJob!.assignedStaffId, "status_change.service_request.success", "ServiceRequest", requestId, firstStart,
        { status: "IN_PROGRESS" }, { status: "PENDING" });
      if (scenario.status === "COMPLETED" || scenario.status === "CANCELLED")
        audit(`request:${scenario.key}:close`, manager.id, "status_change.service_request.success", "ServiceRequest", requestId, finish,
          { status: scenario.status, ...(scenario.status === "CANCELLED" ? { reason: scenario.description } : {}) }, { status: firstStart ? "IN_PROGRESS" : "PENDING" });
      if (scenario.status === "COMPLETED") completedRequests.push({ id: requestId, completedAt: finish, customerName: customer.name });

      if (scenario.invoice) {
        const fixture = scenario.invoice;
        const invoiceId = id(`invoice:${scenario.key}`);
        const { lines, total } = calculateItems(billedItems[scenario.service]!.map((item) => ({ ...item,
          quantity: fixture.units && (scenario.service === 3 || item.quantity !== "1") ? String(fixture.units) : item.quantity })));
        const issuedAt = new Date(finish.getTime() + 3_600_000);
        const amountPaid = fixture.status === "PAID" ? total : fixture.status === "PARTIALLY_PAID" ? total.div(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : new Prisma.Decimal(0);
        const receivedAt = new Date(issuedAt.getTime() + 3_600_000);
        const invoice = await db.invoice.create({ data: {
          id: invoiceId, organizationId, customerId: customer.id, jobId: jobRows[0]!.id,
          invoiceNumber: `INV-BSE-DEMO-${scenario.key}`, status: fixture.status, subtotal: total, total, amountPaid,
          issuedAt, dueAt: new Date(issuedAt.getTime() + fixture.dueDays * 86_400_000), createdAt: issuedAt,
          updatedAt: amountPaid.gt(0) ? receivedAt : issuedAt,
          notes: fixture.status === "VOID" ? "VOID: purchase-order reference was incorrect. No payment collected. Reissue after the property manager confirms the correct reference."
            : `For ${scenario.title.toLowerCase()}. Please quote the invoice number when paying. Fictional demonstration invoice.`,
          items: { create: lines.map((line, index) => ({ ...line, id: id(`item:${scenario.key}:${index}`), createdAt: issuedAt })) },
        } });
        invoices++;
        audit(`invoice:${scenario.key}`, admin.id, "create.invoice.success", "Invoice", invoiceId, issuedAt, { jobId: invoice.jobId, total: total.toFixed(2), status: "UNPAID" });
        if (fixture.status === "VOID") audit(`invoice:${scenario.key}:void`, admin.id, "void.invoice.success", "Invoice", invoiceId, new Date(issuedAt.getTime() + 60_000), { reason: "Incorrect purchase-order reference; no payment collected." });
        if (amountPaid.gt(0)) {
          const amounts = fixture.split ? [amountPaid.div(2).toDecimalPlaces(2), amountPaid.sub(amountPaid.div(2).toDecimalPlaces(2))] : [amountPaid];
          let running = new Prisma.Decimal(0);
          for (const [index, amount] of amounts.entries()) {
            const paymentId = id(`payment:${scenario.key}:${index}`);
            const method = index ? "GCASH" : fixture.method!;
            await db.payment.create({ data: { id: paymentId, invoiceId, amount, method,
              referenceNumber: `BSE-DEMO-${scenario.key}-${index + 1}`, notes: method === "OTHER" ? "Settled by customer cheque; cleared and recorded by the office." : "Office receipt matched to the invoice. Fictional sample payment.",
              receivedAt, createdAt: receivedAt } });
            payments++;
            const before = running;
            running = running.add(amount);
            audit(`payment:${scenario.key}:${index}`, admin.id, "payment.invoice.success", "Invoice", invoiceId, receivedAt,
              { paymentId, amount: amount.toFixed(2), method, amountPaid: running.toFixed(2), status: running.eq(total) ? "PAID" : "PARTIALLY_PAID" }, { amountPaid: before.toFixed(2) });
          }
        }
      }
    }

    const comments = [
      "The kitchen outlets feel secure now and the electrician cleaned up before leaving. The arrival call was helpful.",
      "The emergency-light tests were documented clearly. Please send the next maintenance schedule a little earlier.",
      "The sterilizer circuit works well, but the visit started later than the time we had arranged with reception.",
      "The pendant lights are aligned properly over the island. We appreciated having the dimmer checked before handover.",
      "The workshop stayed usable during the panel work. The revised circuit schedule made the final handover straightforward.",
      "The classroom inspection report is clear and the electrician explained which outlets need closer monitoring next term.",
    ];
    for (const [index, request] of completedRequests.slice(0, 9).entries()) {
      const invitationId = id(`invitation:${index}`);
      const createdAt = new Date(request.completedAt.getTime() + 2 * 3_600_000);
      await db.feedbackInvitation.create({ data: { id: invitationId, organizationId, serviceRequestId: request.id,
        tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
        expiresAt: new Date(createdAt.getTime() + 30 * 86_400_000), createdAt, updatedAt: createdAt } });
      audit(`invitation:${index}`, manager.id, "feedback.invitation.created", "FeedbackInvitation", invitationId, createdAt,
        { serviceRequestId: request.id });
      // An expired historical invitation and two current invitations remain unanswered.
      if (index === 0 || index > comments.length) continue;
      const feedbackId = id(`feedback:${index}`);
      const submittedAt = new Date(createdAt.getTime() + 3_600_000);
      const status = (["NEW", "IN_REVIEW", "RESOLVED"] as const)[index % 3]!;
      await db.customerFeedback.create({ data: { id: feedbackId, organizationId, invitationId, rating: [5, 5, 4, 3, 5, 4][index - 1]!,
        comment: `[Sample feedback] ${comments[index - 1]}`, displayName: request.customerName, status,
        // Simulated comments must never qualify as approved testimonials.
        consentGrantedAt: null, consentVersion: null, testimonialApprovedAt: null,
        createdAt: submittedAt, updatedAt: new Date(submittedAt.getTime() + 3_600_000) } });
      audit(`feedback:${index}`, null, "feedback.customer.submitted", "CustomerFeedback", feedbackId, submittedAt, { consentVersion: null });
      if (status !== "NEW") audit(`feedback:${index}:review`, manager.id, "feedback.customer.reviewed", "CustomerFeedback", feedbackId,
        new Date(submittedAt.getTime() + 3_600_000), { status, testimonialApproved: false });
    }

    for (const [index, actor] of [admin, admin, manager, staff].entries()) {
      const feedbackId = id(`product-feedback:${index}`);
      const createdAt = date(-3 + (index % 3), 16);
      const comment = [
        "The billing overview makes unpaid work easier to follow. A saved overdue-invoice filter would help our weekly collections review.",
        "Request and job separation is useful for larger installations. Please make the final request sign-off easier to find after the last job is complete.",
        "The dispatch queue helps me spot requests without technicians. A quick way to see site access instructions would save a call to the office.",
        "My job list shows today's work clearly. Being able to check the customer address before travelling has been helpful.",
      ][index]!;
      await db.productFeedback.create({ data: { id: feedbackId, organizationId, authorId: actor.id,
        submissionKey: `${createHash("sha256").update(feedbackId).digest("hex").slice(0, 8)}-0000-4000-8000-000000000001`,
        rating: index === 1 ? 4 : 5, comment: `[Sample feedback] ${comment}`, status: "NEW", createdAt, updatedAt: createdAt,
        consentVersion: null, consentGrantedAt: null, testimonialApprovedAt: null } });
      audit(`product-feedback:${index}`, actor.id, "feedback.product.submitted", "ProductFeedback", feedbackId, createdAt, { consentVersion: null }, undefined, "PLATFORM");
    }
    const summary = { source: BRIGHT_STAR_SEED, simulated: true, anchoredAt: now.toISOString(),
      customers: customers.length, serviceTypesCreated: createdServices, serviceTypesReused: services.length - createdServices,
      serviceRequests: brightStarScenarios.length, jobs, jobStatusHistory: histories, invoices, payments,
      feedbackInvitations: 9, customerFeedback: 6, productFeedback: 4, auditLogs: audits.length + 1 };
    await db.auditLog.createMany({ data: audits });
    await db.auditLog.create({ data: { id: id("batch"), organizationId, scope: "TENANT", actorType: "SYSTEM",
      action: "seed.bright_star.completed", entity: "Organization", entityId: organizationId, metadata: summary, createdAt: now } });
    return { status: "created" as const, organizationId, summary };
}

export async function seedBrightStar(prisma: PrismaClient, now = new Date()) {
  return prisma.$transaction((db) => seedBrightStarInTransaction(db, now),
    { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 });
}
