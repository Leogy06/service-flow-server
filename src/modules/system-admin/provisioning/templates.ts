export const industryIds = ["AIRCON", "AUTO_REPAIR", "APPLIANCE_REPAIR", "CLEANING", "GENERAL"] as const;
export type IndustryId = (typeof industryIds)[number];
export type IndustryTemplate = {
  id: IndustryId;
  version: number;
  name: string;
  description: string;
  services: readonly { name: string; description: string }[];
  website: { headline: string; about: string };
  scenarios: readonly { title: string; description: string; completionNote: string }[];
};

/** Reviewed starter content. Prices, owner details and public contacts are never inferred. */
export const industryTemplates = [
  {
    id: "AIRCON", version: 1, name: "Air-conditioning services",
    description: "Residential and small-business cooling maintenance, diagnosis and installation.",
    services: [
      { name: "Split-type unit cleaning", description: "Clean filters, evaporator and drain system; inspect operation and document findings." },
      { name: "Cooling performance diagnosis", description: "Inspect airflow, controls and refrigerant-system symptoms before proposing repairs." },
      { name: "Air-conditioning installation", description: "Assess the installation site, mounting, pipe route and electrical requirements." },
      { name: "Refrigerant leak inspection", description: "Locate suspected leaks and prepare a repair recommendation before charging refrigerant." },
      { name: "Drain and water-leak repair", description: "Inspect the condensate route, clear obstructions and verify drainage." },
      { name: "Preventive maintenance visit", description: "Inspect operating condition and prepare a maintenance record for each cooling unit." },
    ],
    website: { headline: "Air-conditioning care for comfortable spaces", about: "We help homes and small businesses maintain reliable cooling with documented inspections, careful cleaning and clearly scoped repair recommendations. Confirm service coverage, availability and a written quotation with our team." },
    scenarios: [
      { title: "Living-room split unit cleaning", description: "Fictional resident reports reduced airflow from a 1.5 HP living-room unit. Inspect filters, clean the evaporator and verify condensate flow.", completionNote: "Filters and evaporator cleaned; drain cleared and airflow checked during the demonstration visit." },
      { title: "Office cooling diagnosis", description: "Fictional office reports intermittent cooling during afternoon hours. Record operating observations and prepare a repair recommendation.", completionNote: "Control wiring inspected and cooling performance documented; demonstration findings explained to the sample customer." },
      { title: "Bedroom installation site assessment", description: "Fictional resident requests an assessment for a bedroom cooling unit. Confirm mounting position, pipe route and power provision.", completionNote: "Site measurements and proposed installation scope recorded for the demonstration." },
    ],
  },
  {
    id: "AUTO_REPAIR", version: 1, name: "Automotive repair",
    description: "Inspection, routine vehicle maintenance and clearly scoped mechanical repair.",
    services: [
      { name: "Engine oil and filter service", description: "Verify the vehicle specification, replace engine oil and filter, and record the service." },
      { name: "Brake system inspection", description: "Inspect brake wear and operation, record measurements and recommend required work." },
      { name: "Engine diagnostic assessment", description: "Inspect reported symptoms and diagnostic readings before recommending repairs." },
      { name: "Battery and charging-system test", description: "Check battery condition, charging output and related connections." },
      { name: "Suspension and steering inspection", description: "Inspect steering and suspension components and document observed wear." },
      { name: "Scheduled vehicle maintenance", description: "Prepare a vehicle-specific maintenance scope based on mileage and service history." },
    ],
    website: { headline: "Clear advice for dependable vehicle care", about: "We provide practical inspections, routine maintenance and repair recommendations for everyday vehicles. Our team documents the work and confirms the scope and quotation before proceeding. Contact us to confirm vehicle coverage and appointment availability." },
    scenarios: [
      { title: "Sedan oil and filter service", description: "Fictional vehicle owner requests scheduled oil and filter replacement for a compact sedan. Verify the required specification and inspect for visible leaks.", completionNote: "Oil and filter replaced to the sample specification; demonstration service record completed." },
      { title: "Hatchback brake inspection", description: "Fictional vehicle owner reports brake noise at low speed. Inspect pads, discs and related hardware; document findings before recommending work.", completionNote: "Brake inspection completed and sample measurements recorded; repair recommendation reviewed with the fictional owner." },
      { title: "Utility vehicle engine warning diagnosis", description: "Fictional small-business vehicle has an intermittent engine warning. Arrange a diagnostic assessment and review the reported symptoms.", completionNote: "Diagnostic observations and proposed next steps recorded for the demonstration." },
    ],
  },
  {
    id: "APPLIANCE_REPAIR", version: 1, name: "Appliance repair",
    description: "Household appliance diagnosis, maintenance and repair coordination.",
    services: [
      { name: "Washing machine diagnosis", description: "Inspect reported washing, draining or spinning problems and document a repair scope." },
      { name: "Refrigerator cooling assessment", description: "Check cooling symptoms, controls and door seals before recommending repairs." },
      { name: "Electric range inspection", description: "Inspect heating and control problems with safe isolation and documented findings." },
      { name: "Dryer maintenance", description: "Inspect lint paths, airflow and operating condition before agreeing maintenance work." },
      { name: "Dishwasher service assessment", description: "Inspect filling, cleaning or draining symptoms and recommend the required work." },
      { name: "Small appliance diagnosis", description: "Assess eligible household appliances and confirm repair feasibility before proceeding." },
    ],
    website: { headline: "Practical help for household appliances", about: "We assess appliance problems and explain repair options before work begins. Clear findings, careful handling and an agreed service scope help customers make informed decisions. Confirm appliance types, parts availability and service coverage with our team." },
    scenarios: [
      { title: "Washing machine drain assessment", description: "Fictional resident reports water remaining after a wash cycle. Inspect the filter, drain route and pump operation before recommending repairs.", completionNote: "Drain obstruction cleared and demonstration drain cycle checked; sample maintenance advice recorded." },
      { title: "Refrigerator temperature inspection", description: "Fictional household reports uneven cooling. Inspect door seals, controls and airflow, and record the findings for a repair recommendation.", completionNote: "Door-seal and airflow inspection completed; demonstration findings reviewed with the sample customer." },
      { title: "Electric range heating assessment", description: "Fictional resident reports one heating element not responding. Schedule an isolated electrical and control assessment.", completionNote: "Inspection findings and proposed parts scope prepared for the demonstration." },
    ],
  },
  {
    id: "CLEANING", version: 1, name: "Cleaning services",
    description: "Residential, office and move-out cleaning with clear room-by-room scopes.",
    services: [
      { name: "Residential general cleaning", description: "Agree a room-by-room cleaning scope for occupied homes and apartments." },
      { name: "Office cleaning visit", description: "Clean agreed workspaces and common areas using the site's access and handling requirements." },
      { name: "Move-out deep cleaning", description: "Prepare a detailed cleaning scope for vacant property handover." },
      { name: "Post-renovation cleaning", description: "Assess dust and residue removal after renovation work and confirm surface requirements." },
      { name: "Upholstery cleaning assessment", description: "Inspect fabric and condition before selecting an appropriate cleaning method." },
      { name: "Scheduled common-area cleaning", description: "Plan recurring cleaning tasks, access windows and completion records for shared areas." },
    ],
    website: { headline: "Thoughtful cleaning for everyday spaces", about: "We help households and small businesses keep their spaces clean with agreed checklists, careful handling and clear completion records. Tell us about the space, access arrangements and priorities so we can prepare an appropriate service quotation." },
    scenarios: [
      { title: "Two-bedroom apartment cleaning", description: "Fictional resident requests kitchen, bathroom and common-area cleaning for an occupied apartment. Confirm surface care and the agreed room checklist.", completionNote: "Agreed rooms cleaned and demonstration checklist reviewed with the sample customer." },
      { title: "Small office cleaning visit", description: "Fictional office requests an after-hours visit for desks, floors and a pantry. Confirm secure access and avoid handling private documents.", completionNote: "Office cleaning checklist completed and demonstration handover observations recorded." },
      { title: "Vacant studio move-out assessment", description: "Fictional property manager requests a deep-cleaning assessment before handover. Inspect bathroom scale, cupboard interiors and window tracks.", completionNote: "Room-by-room scope and access arrangements recorded for the demonstration." },
    ],
  },
  {
    id: "GENERAL", version: 1, name: "General service business",
    description: "A flexible starting catalog for inspection, planned maintenance and repair visits.",
    services: [
      { name: "Site inspection and assessment", description: "Inspect the reported issue, document findings and prepare an agreed work scope." },
      { name: "Preventive maintenance visit", description: "Review asset condition and complete a customer-approved maintenance checklist." },
      { name: "Minor repair assessment", description: "Assess a reported defect and confirm skills, materials and quotation before repair." },
      { name: "Installation site assessment", description: "Review access, dimensions and requirements before agreeing installation work." },
      { name: "Follow-up service visit", description: "Review a previous service outcome and record any agreed follow-up work." },
      { name: "Scheduled service agreement", description: "Define recurring tasks, site arrangements and completion records with the customer." },
    ],
    website: { headline: "Clear scopes and dependable service", about: "We help customers organize inspections, maintenance and repairs with clear communication and documented work. Tell our team about the job and location so we can confirm whether it falls within our service coverage and prepare an appropriate quotation." },
    scenarios: [
      { title: "Common-area site inspection", description: "Fictional property representative requests an inspection of a shared entrance and maintenance concerns. Record findings and confirm the proposed work scope.", completionNote: "Site inspection completed and demonstration findings documented for the sample customer." },
      { title: "Small office maintenance visit", description: "Fictional office requests completion of an agreed basic maintenance checklist. Confirm access and the tasks within the team's competence.", completionNote: "Approved maintenance checklist completed and demonstration handover notes recorded." },
      { title: "Minor fitting repair assessment", description: "Fictional resident requests an assessment of a loose non-structural fitting. Inspect the condition and confirm whether repair is within scope.", completionNote: "Inspection findings and sample repair recommendation recorded for the demonstration." },
    ],
  },
] as const satisfies readonly IndustryTemplate[];

export function industryTemplate(id: IndustryId): IndustryTemplate {
  return industryTemplates.find((template) => template.id === id)!;
}
