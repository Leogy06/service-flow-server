const { industryTemplates } = await import("@/modules/system-admin/provisioning/templates.js");
const { provisioningBody } = await import("@/modules/system-admin/provisioning/provisioning.schema.js");

const input = {
  idempotencyKey: "9b112271-de6b-47ae-a2a6-1be4b844641e", templateId: "AIRCON", mode: "REAL",
  organization: { name: "New Aircon Services", slug: "new-aircon" },
  owner: { firstName: "Marina", lastName: "Santos", email: "owner@example.test" },
  planId: "plan", reason: "Verified owner onboarding", confirm: true,
};

test("catalog has exactly five versioned industry templates with relevant services and realistic scenarios", () => {
  expect(industryTemplates.map((template) => template.id)).toEqual(["AIRCON", "AUTO_REPAIR", "APPLIANCE_REPAIR", "CLEANING", "GENERAL"]);
  for (const template of industryTemplates) {
    expect(template.version).toBe(1);
    expect(template.services.length).toBeGreaterThanOrEqual(5);
    expect(new Set(template.services.map((service) => service.name)).size).toBe(template.services.length);
    expect(template.scenarios).toHaveLength(3);
    expect(template.website.headline).toBeTruthy();
  }
  expect(JSON.stringify(industryTemplates.find((template) => template.id === "AUTO_REPAIR"))).not.toMatch(/aircon|refrigerator/i);
  expect(JSON.stringify(industryTemplates.find((template) => template.id === "CLEANING"))).not.toMatch(/compressor|brake/i);
});

test("provisioning schema normalizes identities and defaults real trials without accepting privileges", () => {
  const normalized = provisioningBody.parse({ ...input, organization: { name: " New Aircon Services ", slug: " New-Aircon " }, owner: { ...input.owner, email: " OWNER@EXAMPLE.TEST " } });
  expect(normalized).toMatchObject({ organization: { name: "New Aircon Services", slug: "new-aircon" }, owner: { email: "owner@example.test" }, startTrial: true, generateWebsite: true, includeDemoData: false });
  expect(provisioningBody.safeParse({ ...input, owner: { ...input.owner, platformRole: "SYSTEM_ADMIN" } }).success).toBe(false);
  expect(provisioningBody.safeParse({ ...input, organizationId: "foreign" }).success).toBe(false);
});

test.each([
  { ...input, planId: undefined }, { ...input, includeDemoData: true }, { ...input, confirm: false },
  { ...input, idempotencyKey: "repeat" }, { ...input, templateId: "UNKNOWN" },
  { ...input, organization: { ...input.organization, slug: "business" } },
  { ...input, mode: "DEMO" }, { ...input, mode: "DEMO", planId: undefined, startTrial: true },
])("rejects unsafe or incomplete provisioning input %#", (value) => {
  expect(provisioningBody.safeParse(value).success).toBe(false);
});

test("demo mode accepts sample fixtures without a subscription or synthetic credentials", () => {
  const parsed = provisioningBody.parse({ ...input, mode: "DEMO", planId: undefined, includeDemoData: true });
  expect(parsed).toMatchObject({ mode: "DEMO", includeDemoData: true });
  expect(parsed.startTrial).toBeUndefined();
});

