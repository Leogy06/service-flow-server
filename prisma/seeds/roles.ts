// export const seedRoles = async (prisma, organizations, permissions) => {
//   console.log("Seeding roles...");

//   const roles = [];

//   for (const org of organizations) {
//     const adminPerms = permissions;
//     const managerPerms = permissions.filter((p) => !p.name.endsWith(":delete"));
//     const staffPerms = permissions.filter(
//       (p) => p.name.endsWith(":read") || p.name.endsWith(":update")
//     );

//     const roleDefs = [
//       { name: "Admin", perms: adminPerms },
//       { name: "Manager", perms: managerPerms },
//       { name: "Staff", perms: staffPerms },
//     ];

//     for (const def of roleDefs) {
//       const role = await prisma.role.upsert({
//         where: {
//           name_organizationId: {
//             name: def.name,
//             organizationId: org.id,
//           },
//         },
//         update: {},
//         create: {
//           name: def.name,
//           organizationId: org.id,
//         },
//       });

//       for (const perm of def.perms) {
//         await prisma.rolePermission.upsert({
//           where: {
//             roleId_permissionId: {
//               roleId: role.id,
//               permissionId: perm.id,
//             },
//           },
//           update: {},
//           create: {
//             roleId: role.id,
//             permissionId: perm.id,
//           },
//         });
//       }

//       roles.push(role);
//     }
//   }

//   console.log(`Seeded ${roles.length} roles`);
//   return roles;
// };