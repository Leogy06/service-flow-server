import type { Prisma } from "../../src/generated/prisma/client.js";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";

export const seedPermissions = async (prisma: Prisma.TransactionClient) => {
  const permissions = await Promise.all(Object.values(PERMISSIONS).map((name) =>
    prisma.permission.upsert({
      where: { name }, update: {},
      create: { name, description: "Can " + name.replace(":", " ") },
    }),
  ));
  console.log("Seeded " + permissions.length + " permissions");
  return permissions;
};
