// import { seedOrganization } from "./seeds/organization.js";
// import { prisma } from "../src/lib/prisma.js";
// import { seedPermissions } from "./seeds/permission.js";
// import { seedRoles } from "./seeds/roles.js";
// import { seedUsers } from "./seeds/users.js";

// async function main() {
//   const organizations = await seedOrganization(prisma);
//   const permissions = await seedPermissions(prisma);
//   const roles = await seedRoles(prisma, organizations, permissions);
//   const users = await seedUsers(prisma, organizations, roles);

//   console.log("Seed complete.");
// }

// main()
//   .then(async () => {
//     await prisma.$disconnect();
//   })
//   .catch(async (e) => {
//     console.error(e);
//     await prisma.$disconnect();
//     process.exit(1);
//   });
