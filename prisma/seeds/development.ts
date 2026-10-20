import bcrypt from "bcryptjs";
import type { PrismaClient, Prisma } from "../../src/generated/prisma/client.js";
import { DEFAULT_ROLE_DEFINITIONS } from "../../src/constants/default-roles.js";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";
import { defaultSettings } from "../../src/modules/system-admin/operations-policy.js";
import { pageContentSchema } from "../../src/modules/organization/page.schema.js";
import { enforceSeatLimit } from "../../src/modules/system-admin/entitlement.js";
import { seedCatalogInTransaction } from "./catalog.js";
import { seedBrightStarInTransaction } from "./bright-star.js";
import { seedDevelopmentWorkflow } from "./development-workflows.js";
import { seedDevelopmentSignup, seedDevelopmentSubscription } from "./development-platform.js";
import {
  DEVELOPMENT_SEED, developmentId, developmentOrganizations, developmentOperatorEmail,
  developmentUserEmail, developmentPassword, assertDevelopmentSeedTarget,
} from "./development-data.js";

type DevelopmentEnvironment = { NODE_ENV: string; DATABASE_URL: string; DEV_SEED_PASSWORD?: string; SALT_ROUNDS?: number };

async function createAccount(db: Prisma.TransactionClient, data: Prisma.UserUncheckedCreateInput) {
  const existing = await db.user.findUnique({ where: { email: data.email },
    select: { id: true, organizationId: true, platformRole: true, roleId: true } });
  if (existing) {
    if (existing.id !== data.id || existing.organizationId !== data.organizationId || existing.platformRole !== data.platformRole || existing.roleId !== data.roleId) {
      throw new Error("A reserved development email is already in use by another account. No account was overwritten or promoted.");
    }
    return existing;
  }
  const user = await db.user.create({ data, select: { id: true } });
  await db.auditLog.create({ data: { scope: "PLATFORM", actorType: "OPERATOR", organizationId: data.organizationId,
    action: "seed.development.user", entity: "User", entityId: user.id,
    metadata: { source: DEVELOPMENT_SEED, simulated: true, roleId: data.roleId, platformRole: data.platformRole ?? "NONE" } } });
  return user;
}

/** Add a complete local workspace atomically. Reruns preserve sample edits and credentials. */
export async function seedDevelopment(prisma: PrismaClient, environment: DevelopmentEnvironment,
  { dryRun = true, now = new Date() }: { dryRun?: boolean; now?: Date } = {}) {
  assertDevelopmentSeedTarget(environment);
  // Hash before opening the transaction; plaintext never reaches Prisma or seed output.
  const passwordHash = dryRun ? null : await bcrypt.hash(developmentPassword(environment.DEV_SEED_PASSWORD), environment.SALT_ROUNDS ?? 10);
  return prisma.$transaction(async (db) => {
    const catalog = await seedCatalogInTransaction(db, dryRun);
    const marker = await db.auditLog.findUnique({ where: { id: developmentId("batch") },
      select: { scope: true, organizationId: true, action: true, metadata: true } });
    if (marker && (marker.scope !== "PLATFORM" || marker.organizationId !== null || marker.action !== "seed.development.completed")) {
      throw new Error("Development batch marker ownership mismatch.");
    }
    const accounts = [developmentOperatorEmail, ...developmentOrganizations.flatMap((org) =>
      DEFAULT_ROLE_DEFINITIONS.map((role) => developmentUserEmail(org.slug, role.name)))];
    if (dryRun || marker) return { status: marker ? "already-seeded" as const : "dry-run" as const,
      organizationIds: (await db.organization.findMany({ where: { slug: { in: developmentOrganizations.map((org) => org.slug) } }, select: { id: true } })).map((org) => org.id),
      catalog, accounts, summary: marker?.metadata ?? { organizations: 3, tenantAccounts: 9, platformOperators: 1,
        detailedElectricalWorkflow: true, independentPlumbingAndHvacWorkflows: true } };

    const platformRole = await db.role.upsert({ where: { id: developmentId("platform-role") }, update: {},
      create: { id: developmentId("platform-role"), name: "Development platform operator", organizationId: null } });
    if (platformRole.organizationId !== null || platformRole.deletedAt) throw new Error("Development operator role ownership mismatch.");
    const operator = await createAccount(db, {
      id: developmentId("operator"), email: developmentOperatorEmail, password: passwordHash!,
      firstName: "Development", lastName: "Operator", organizationId: null, roleId: platformRole.id,
      platformRole: "SYSTEM_ADMIN", status: "ACTIVE",
    });
    const permissions = await db.permission.findMany({ where: { name: { in: Object.values(PERMISSIONS) }, organizationId: null } });
    const plan = await db.plan.findUnique({ where: { name: "Starter Yearly" } });
    if (!plan || !plan.isActive || plan.maxActiveUsers < 3 || !plan.price.gt(0)) throw new Error("Development fixtures require an active Starter Yearly plan with at least three seats and a positive price; existing plan settings were preserved.");
    await db.platformSettings.upsert({ where: { id: "singleton" }, update: {},
      create: { ...defaultSettings, defaultPlanId: plan.id, paymentInstructions: "Development samples only. No real payments or transfers.", supportEmail: "support@service-flow.example.test" } });

    const organizationIds: string[] = [];
    for (const fixture of developmentOrganizations) {
      const organization = await db.organization.upsert({ where: { slug: fixture.slug }, update: {},
        create: { id: developmentId(`organization:${fixture.slug}`), name: fixture.name, slug: fixture.slug,
          billingEnabled: fixture.billing !== "pending" } });
      if (organization.status !== "ACTIVE") throw new Error("A development organization is inactive; its status was preserved.");
      organizationIds.push(organization.id);
      const actors = new Map<string, string>();
      for (const definition of DEFAULT_ROLE_DEFINITIONS) {
        const rolePermissions = permissions.filter((permission) => definition.permissionNames.includes(permission.name));
        if (rolePermissions.length !== definition.permissionNames.length) throw new Error("Default role permissions are missing from the global catalog.");
        const role = await db.role.upsert({ where: { name_organizationId: { name: definition.name, organizationId: organization.id } },
          update: {}, create: { name: definition.name, organizationId: organization.id,
            permissions: { create: rolePermissions.map((permission) => ({ permissionId: permission.id, isActive: true })) } } });
        if (role.organizationId !== organization.id || role.deletedAt) throw new Error("Development role is archived or belongs to another organization.");
        const user = await createAccount(db, {
          id: developmentId(`${organization.id}:user:${definition.name}`),
          email: developmentUserEmail(fixture.slug, definition.name), password: passwordHash!,
          firstName: "Sample", lastName: definition.name, roleId: role.id, organizationId: organization.id,
          status: "ACTIVE", platformRole: "NONE",
        });
        actors.set(definition.name, user.id);
      }
      await db.organizationSettings.upsert({ where: { organizationId: organization.id }, update: {},
        create: { organizationId: organization.id, primaryColor: fixture.color } });
      const content = pageContentSchema.parse({ headline: `${fixture.name} — development sample`,
        about: "Fictional sample business page for local development.", services: [{ name: "Sample service", description: "Contact our sample team to arrange a visit." }],
        address: "100 Sample Street, Quezon City", serviceArea: "Metro Manila", hours: "Monday to Friday, 9 AM to 5 PM",
        phone: "", email: `hello@${fixture.slug}.example.test` });
      await db.organizationPage.upsert({ where: { organizationId: organization.id }, update: {},
        create: { organizationId: organization.id, draft: content, published: content, publishedAt: now } });
      await seedDevelopmentSubscription(db, organization.id, fixture.billing, plan, operator.id, now);
      await enforceSeatLimit(db, organization.id, 0, { includePending: true });
      // One explicit override demonstrates a user-level denial without changing the role default.
      const denied = permissions.find((permission) => permission.name === PERMISSIONS.CUSTOMER_UPDATE);
      if (!denied) throw new Error("Customer update permission is missing.");
      await db.userPermission.create({ data: { userId: actors.get("Staff")!, permissionId: denied.id, isActive: false } });
      if (fixture.slug !== "bright-star-electrical") {
        await seedDevelopmentWorkflow(db, organization, { admin: actors.get("Admin")!, staff: actors.get("Staff")! }, now);
      }
      await db.auditLog.create({ data: { organizationId: organization.id, actorId: operator.id, actorType: "SYSTEM_ADMIN", scope: "PLATFORM",
        action: "seed.development.organization", entity: "Organization", entityId: organization.id,
        metadata: { source: DEVELOPMENT_SEED, simulated: true, accountsProvisioned: 3 } } });
    }
    const electrical = await seedBrightStarInTransaction(db, now);
    await seedDevelopmentSignup(db, passwordHash!, now);
    const summary = { source: DEVELOPMENT_SEED, simulated: true, anchoredAt: now.toISOString(),
      organizations: organizationIds.length, tenantAccounts: 9, platformOperators: 1, electrical: electrical.summary };
    await db.auditLog.create({ data: { id: developmentId("batch"), scope: "PLATFORM", actorType: "OPERATOR",
      action: "seed.development.completed", entity: "Seed", entityId: DEVELOPMENT_SEED, metadata: summary } });
    return { status: "created" as const, organizationIds, accounts, catalog, summary };
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 120000 });
}
