import { createHash } from "node:crypto";
import { invalidating } from "@/utils/module-cache";
import { Prisma } from "@/generated/prisma/client";
import { auditService } from "@/modules/audit/audit.service";
import { invoiceSelect, withBalance } from "@/modules/invoice/invoice.service";
import {
  tenantOrganization,
  tenantTransaction,
} from "@/utils/tenant-transaction";
import { AppError } from "@/utils/AppError";
import type { RecordPayment } from "./payment.schema";
import { assertDemoActionAllowed } from "@/lib/demo-guard";

export const paymentService = {
  async record(invoiceId: string, data: RecordPayment) {
    const organizationId = tenantOrganization();
    // The existing Payment primary key durably stores an invoice-scoped retry identity.
    const id = createHash("sha256")
      .update(`${invoiceId}:${data.idempotencyKey}`)
      .digest("hex");
    const amount = new Prisma.Decimal(data.amount);
    const work = async (db: Prisma.TransactionClient) => {
      await assertDemoActionAllowed(db, organizationId, "record payments");
      // Serialize financial writes on this tenant's invoice before checking its balance.
      const locked = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM Invoice WHERE id = ${invoiceId} AND organizationId = ${organizationId} FOR UPDATE
      `);
      if (!locked.length) throw new AppError(404, "Invoice not found");
      const invoice = await db.invoice.findFirst({
        where: { id: invoiceId, organizationId },
        select: invoiceSelect,
      });
      if (!invoice) throw new AppError(404, "Invoice not found");
      const previous = await db.payment.findFirst({
        where: { id, invoiceId, invoice: { organizationId } },
      });
      if (previous) {
        if (
          !previous.amount.eq(amount) ||
          previous.method !== data.method ||
          (previous.referenceNumber ?? "") !== data.referenceNumber ||
          (previous.notes ?? "") !== data.notes
        ) {
          throw new AppError(
            409,
            "This payment retry key was already used for different payment details",
          );
        }
        return {
          payment: previous,
          invoice: withBalance(invoice),
          replayed: true,
        };
      }
      if (invoice.status === "VOID" || invoice.status === "PAID")
        throw new AppError(409, "This invoice cannot receive payments");
      const balance = invoice.total.sub(invoice.amountPaid);
      if (!amount.isFinite() || amount.lte(0) || amount.gt(balance))
        throw new AppError(409, "Payment exceeds the outstanding balance");
      if (
        data.referenceNumber &&
        (await db.payment.findFirst({
          where: {
            invoiceId,
            referenceNumber: data.referenceNumber,
            invoice: { organizationId },
          },
        }))
      ) {
        throw new AppError(
          409,
          "A payment with this external reference is already recorded for this invoice",
        );
      }
      const payment = await db.payment.create({
        data: {
          id,
          invoiceId,
          amount,
          method: data.method,
          referenceNumber: data.referenceNumber,
          notes: data.notes,
        },
      });
      const amountPaid = invoice.amountPaid.add(amount);
      const updated = await db.invoice.update({
        where: { id: invoiceId, organizationId },
        data: {
          amountPaid,
          status: amountPaid.eq(invoice.total) ? "PAID" : "PARTIALLY_PAID",
        },
        select: invoiceSelect,
      });
      await auditService.recordInTransaction(db, {
        action: "payment.invoice.success",
        entity: "Invoice",
        entityId: invoiceId,
        before: { amountPaid: invoice.amountPaid.toFixed(2) },
        after: {
          paymentId: id,
          amount: amount.toFixed(2),
          method: data.method,
          amountPaid: amountPaid.toFixed(2),
          status: updated.status,
        },
      });
      return { payment, invoice: withBalance(updated), replayed: false };
    };
    return invalidating("invoices", async () => {
      try {
        return await tenantTransaction(work);
      } catch (error) {
        // Concurrent identical requests may race on the primary key. Read the committed result.
        if (error instanceof AppError && error.code === "DUPLICATE_RECORD")
          return tenantTransaction(work);
        throw error;
      }
    });
  },
};
