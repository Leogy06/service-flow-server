export const seedPermissions = async (prisma) => {
  console.log("Seeding permissions...");

  const actions = ["create", "read", "update", "delete"];
  const resources = ["customer", "job", "invoice", "serviceRequest", "user"];

  const data = [];
  for (const resource of resources) {
    for (const action of actions) {
      data.push({
        name: `${resource}:${action}`,
        description: `Can ${action} ${resource}`,
      });
    }
  }

  const permissions = await Promise.all(
    data.map((perm) =>
      prisma.permission.upsert({
        where: { name: perm.name },
        update: {},
        create: perm,
      })
    )
  );

  console.log(`Seeded ${permissions.length} permissions`);
  return permissions;
};