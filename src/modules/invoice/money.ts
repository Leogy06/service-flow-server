import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/utils/AppError";

export const maxMoney = new Prisma.Decimal("99999999.99");
export function calculateItems(
  items: { description: string; quantity: string; unitPrice: string }[],
) {
  const lines = items.map((item) => {
    const quantity = new Prisma.Decimal(item.quantity);
    const unitPrice = new Prisma.Decimal(item.unitPrice);
    const amount = quantity
      .mul(unitPrice)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (
      !quantity.isFinite() ||
      !unitPrice.isFinite() ||
      quantity.lte(0) ||
      unitPrice.lt(0) ||
      amount.gt(maxMoney)
    ) {
      throw new AppError(400, "Invoice item exceeds the permitted amount");
    }
    return { description: item.description, quantity, unitPrice, amount };
  });
  const total = lines.reduce(
    (sum, line) => sum.add(line.amount),
    new Prisma.Decimal(0),
  );
  if (total.lte(0) || total.gt(maxMoney))
    throw new AppError(
      400,
      "Invoice total must be positive and within the permitted amount",
    );
  return { lines, total };
}
