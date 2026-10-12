import { randomUUID } from "node:crypto";
import { auditService } from "@/modules/audit/audit.service.js";
import { AppError } from "@/utils/AppError.js";
import { tenantOrganization, tenantTransaction, pagination } from "@/utils/tenant-transaction.js";
import type { Prisma } from "@/generated/prisma/client.js";
import type { CreateInvoice, UpdateInvoice, InvoiceList } from "./invoice.schema.js";
import { calculateItems } from "./money.js";

export const invoiceSelect = {
  id: true, invoiceNumber: true, customerId: true, jobId: true, status: true,
  subtotal: true, total: true, amountPaid: true, issuedAt: true, dueAt: true, createdAt: true, updatedAt: true, notes: true,
  customer: { select: { id: true, name: true } },
  job: { select: { id: true, referenceNumber: true, serviceRequestId: true } },
} satisfies Prisma.InvoiceSelect;
export function withBalance<T extends { total: Prisma.Decimal; amountPaid: Prisma.Decimal; status: string }>(invoice: T) {
  return { ...invoice, balance: invoice.status === "VOID" ? "0.00" : invoice.total.sub(invoice.amountPaid).toFixed(2) };
}

export const invoiceService = {
  async list(query: InvoiceList) {
    const organizationId = tenantOrganization();
    const where: Prisma.InvoiceWhereInput = { organizationId, status: query.status, jobId: query.jobId,
      ...(query.serviceRequestId ? { job: { organizationId, serviceRequestId: query.serviceRequestId } } : {}),
      ...(query.search ? { OR: [{ invoiceNumber: { contains: query.search } }, { customer: { organizationId, name: { contains: query.search } } }] } : {}),
    };
    return tenantTransaction(async (db) => {
      const meta = pagination(query.page, query.pageSize, await db.invoice.count({ where }));
      const invoices = await db.invoice.findMany({ where, select: invoiceSelect, skip: (meta.page - 1) * meta.pageSize,
        take: meta.pageSize, orderBy: [{ createdAt: query.sortOrder }, { id: "asc" }] });
      return { invoices: invoices.map(withBalance), pagination: meta };
    });
  },
  async get(id: string) {
    const organizationId = tenantOrganization();
    return tenantTransaction(async (db) => {
      const invoice = await db.invoice.findFirst({ where: { id, organizationId }, select: { ...invoiceSelect,
        items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        payments: { where: { invoice: { organizationId } }, orderBy: [{ receivedAt: "desc" }, { id: "asc" }] },
      } });
      if (!invoice) throw new AppError(404, "Invoice not found");
      return withBalance(invoice);
    });
  },
  async create(data: CreateInvoice) {
    const organizationId = tenantOrganization();
    const { lines, total } = calculateItems(data.items);
    return tenantTransaction(async (db) => {
      const job = await db.job.findFirst({ where: { id: data.jobId, organizationId }, include: { serviceRequest: true } });
      if (!job) throw new AppError(404, "Job not found");
      if (job.status !== "COMPLETED") throw new AppError(409, "Complete the job before invoicing it");
      if (job.serviceRequest && (job.serviceRequest.organizationId !== organizationId || job.serviceRequest.status !== "COMPLETED")) {
        throw new AppError(409, "Complete the parent service request before invoicing its jobs");
      }
      if (!await db.customer.findFirst({ where: { id: job.customerId, organizationId } })) throw new AppError(404, "Customer not found");
      if (await db.invoice.findFirst({ where: { jobId: job.id, organizationId } })) throw new AppError(409, "This job already has an invoice");
      const invoice = await db.invoice.create({ data: { organizationId, customerId: job.customerId, jobId: job.id,
        invoiceNumber: `INV-${randomUUID().toUpperCase()}`, subtotal: total, total,
        dueAt: data.dueAt, notes: data.notes, items: { create: lines },
      }, select: invoiceSelect });
      await auditService.recordInTransaction(db, { action: "create.invoice.success", entity: "Invoice", entityId: invoice.id,
        after: { jobId: job.id, total: total.toFixed(2) } });
      return withBalance(invoice);
    });
  },
  async update(id: string, data: UpdateInvoice) {
    const organizationId = tenantOrganization();
    const { lines, total } = calculateItems(data.items);
    return tenantTransaction(async (db) => {
      const invoice = await db.invoice.findFirst({ where: { id, organizationId }, include: { _count: { select: { payments: true } } } });
      if (!invoice) throw new AppError(404, "Invoice not found");
      if (invoice.status !== "UNPAID" || !invoice.amountPaid.isZero() || invoice._count.payments) {
        throw new AppError(409, "Only unpaid invoices with no payments can be edited");
      }
      const updated = await db.invoice.update({ where: { id, organizationId }, data: {
        subtotal: total, total, dueAt: data.dueAt, notes: data.notes,
        items: { deleteMany: {}, create: lines },
      }, select: invoiceSelect });
      await auditService.recordInTransaction(db, { action: "update.invoice.success", entity: "Invoice", entityId: id,
        before: { total: invoice.total.toFixed(2) }, after: { total: total.toFixed(2) } });
      return withBalance(updated);
    });
  },
  async void(id: string, reason: string) {
    const organizationId = tenantOrganization();
    return tenantTransaction(async (db) => {
      const invoice = await db.invoice.findFirst({ where: { id, organizationId }, include: { _count: { select: { payments: true } } } });
      if (!invoice) throw new AppError(404, "Invoice not found");
      if (invoice.status !== "UNPAID" || !invoice.amountPaid.isZero() || invoice._count.payments) {
        throw new AppError(409, "Only unpaid invoices with no payments can be voided");
      }
      const updated = await db.invoice.update({ where: { id, organizationId }, data: { status: "VOID" }, select: invoiceSelect });
      await auditService.recordInTransaction(db, { action: "void.invoice.success", entity: "Invoice", entityId: id, after: { reason } });
      return withBalance(updated);
    });
  },
};
