import bcrypt from "bcryptjs";

export const seedUsers = async (prisma, organizations, roles) => {
  console.log("Seeding users...");

  const users = [];
  const passwordHash = await bcrypt.hash("Password123!", 10);

  for (const org of organizations) {
    const orgRoles = roles.filter((r) => r.organizationId === org.id);
    const adminRole = orgRoles.find((r) => r.name === "Admin");
    const managerRole = orgRoles.find((r) => r.name === "Manager");
    const staffRole = orgRoles.find((r) => r.name === "Staff");

    const userDefs = [
      {
        firstName: "Ana",
        lastName: "Reyes",
        email: `admin@${org.slug}.com`,
        role: adminRole,
      },
      {
        firstName: "Marco",
        lastName: "Santos",
        email: `manager@${org.slug}.com`,
        role: managerRole,
      },
      {
        firstName: "Liza",
        lastName: "Cruz",
        email: `staff@${org.slug}.com`,
        role: staffRole,
      },
    ];

    for (const def of userDefs) {
      if (!def.role) {
        console.warn(`Skip ${def.email}, role not found for org ${org.slug}`);
        continue;
      }

      const user = await prisma.user.upsert({
        where: { email: def.email },
        update: {},
        create: {
          firstName: def.firstName,
          lastName: def.lastName,
          email: def.email,
          password: passwordHash,
          organizationId: org.id,
          roleId: def.role.id,
        },
      });
      users.push(user);
    }
  }

  console.log(`Seeded ${users.length} users`);
  return users;
};
