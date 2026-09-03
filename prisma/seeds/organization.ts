export const seedOrganization = async (prisma) => {
  console.log("Seeding organizations...");

  const data = [
    { name: "Acme Plumbing Co.", slug: "acme-plumbing" },
    { name: "Bright Star Electrical", slug: "bright-star-electrical" },
    { name: "Summit HVAC Services", slug: "summit-hvac" },
  ];

  const orgs = await Promise.all(
    data.map((org) =>
      prisma.organization.upsert({
        where: { slug: org.slug },
        update: {},
        create: org,
      })
    )
  );

  console.log(`Seeded ${orgs.length} organizations`);
  return orgs;
};