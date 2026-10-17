import type { InvoiceStatus, JobStatus, PaymentMethod, ServiceRequestPriority, ServiceRequestStatus } from "../../src/generated/prisma/client.js";

export const BRIGHT_STAR_SLUG = "bright-star-electrical";
export const BRIGHT_STAR_SEED = "bright-star-workflow-v1";

// Fictional Philippine households and businesses; all email addresses use a reserved domain.
export const brightStarCustomers = [
  { name: "Teresa Villamor", address: "18 Sampaguita Street, Barangay Holy Spirit, Quezon City", notes: "Homeowner. Call before arrival; the side gate opens onto the meter enclosure." },
  { name: "Amihan Bakehouse", address: "42 Maginhawa Street, Teachers Village, Quezon City", notes: "Contact: Bea Mendoza, store manager. Electrical shutdowns must finish before the 5 AM baking shift." },
  { name: "Greenridge Condominium Association", address: "126 C. Raymundo Avenue, Pasig City", notes: "Contact: Ramon Uy, facilities supervisor. Register tools at the basement security desk." },
  { name: "Mabini Dental Studio", address: "Unit 204, 87 Mabini Street, San Juan City", notes: "Contact: Dr. Celina Abad. Work around booked patient appointments; isolate the treatment-room circuits separately." },
  { name: "Luis and Mara Solis", address: "9 Narra Lane, Barangay Concepcion Dos, Marikina City", notes: "Residential renovation. Owners approve additional materials before installation." },
  { name: "Northline Auto Care", address: "220 Mindanao Avenue, Quezon City", notes: "Contact: Dennis Tan. Workshop manager holds the lockout keys for compressor and lift circuits." },
  { name: "Bayleaf Learning Center", address: "33 Scout Rallos Street, Diliman, Quezon City", notes: "Contact: Nina Valdez, administrator. Classroom work only after dismissal or on weekends." },
  { name: "Rosario Family Pharmacy", address: "65 A. Mabini Street, Caloocan City", notes: "Contact: Alma Rosario. Keep the medicine refrigerator powered during any circuit isolation." },
  { name: "Kawayan Property Management", address: "Suite 302, 14 Pioneer Street, Mandaluyong City", notes: "Contact: Joel Miranda. Include the serviced unit number on invoices and completion reports." },
  { name: "Elena Pascual", address: "7 Ilang-Ilang Street, Barangay San Roque, Antipolo City", notes: "Retired homeowner. Explain the breaker labels and leave a printed test checklist." },
  { name: "Riverbend Cold Storage", address: "Warehouse 3, 88 M. Almeda Street, Pateros", notes: "Contact: Arvin Co, operations lead. Coordinate downtime with the cold-room temperature monitoring team." },
  { name: "Estrella Tailoring Shop", address: "16 J.P. Rizal Street, Barangay Poblacion, Makati City", notes: "Contact: Rosa Estrella. Keep one sewing station available during opening hours." },
  { name: "Old Willow Events Studio", address: "28 Kamias Road, Quezon City", notes: "Former premises; the business moved out and the account was archived after its last inspection.", archived: true },
];

export const brightStarServices = [
  { name: "Electrical Inspection", description: "Circuit loading, earthing and protective-device checks with a written findings report.", basePrice: "700.00" },
  { name: "Circuit Breaker Replacement", description: "Diagnose nuisance trips, replace the approved breaker and test the protected circuit.", basePrice: "1000.00" },
  { name: "Light Fixture Installation", description: "Install customer-approved lighting, test switching and tidy the work area.", basePrice: "700.00" },
  { name: "Outlet Repair", description: "Replace damaged receptacles, correct loose terminations and verify polarity and grounding.", basePrice: "500.00" },
  { name: "Switch Replacement", description: "Replace worn switches and test the connected lighting circuit.", basePrice: "400.00" },
  { name: "Dedicated Circuit Installation", description: "Install a dedicated appliance circuit, protective device and labeled outlet, including commissioning tests.", basePrice: "4500.00" },
  { name: "Distribution Panel Upgrade", description: "Replace or extend a distribution panel with coordinated isolation, circuit labeling and load verification.", basePrice: "12500.00" },
  { name: "Emergency Lighting Maintenance", description: "Service exit signs and emergency lighting with battery discharge and mains-failure tests.", basePrice: "1800.00" },
  { name: "Legacy Fluorescent Ballast Repair", description: "Retired service; new quotations use LED fixture replacement instead.", basePrice: "450.00", isActive: false },
];

export type DemoJob = {
  status: JobStatus;
  description: string;
  day: number;
  unscheduled?: boolean;
  unassigned?: boolean;
  assignee?: "manager" | "staff";
};
export type DemoScenario = {
  key: string;
  customer: number;
  service: number;
  title: string;
  description: string;
  status: ServiceRequestStatus;
  priority: ServiceRequestPriority;
  day: number;
  jobs: DemoJob[];
  invoice?: { status: InvoiceStatus; method?: PaymentMethod; split?: boolean; dueDays: number; units?: number };
};

const completed = (
  key: string, customer: number, service: number, day: number, title: string, description: string,
  invoice?: DemoScenario["invoice"],
): DemoScenario => ({ key, customer, service, day, title, description, status: "COMPLETED", priority: "NORMAL",
  jobs: [{ status: "COMPLETED", description: title, day }], ...(invoice ? { invoice } : {}) });

export const brightStarScenarios: DemoScenario[] = [
  completed("01", 1, 5, -40, "Dedicated oven circuit for the morning baking line", "Installed a dedicated 32 A oven circuit with an isolator beside the preparation bench. Recorded insulation resistance and full-load current before handover.", { status: "PAID", method: "BANK_TRANSFER", dueDays: 14 }),
  completed("02", 0, 3, -33, "Replace heat-damaged kitchen outlets", "Replaced two discolored kitchen receptacles, tightened upstream terminations and verified polarity at all kitchen outlets.", { status: "PAID", method: "CASH", dueDays: 7 }),
  completed("03", 2, 7, -22, "Quarterly emergency lighting test at Greenridge", "Tested stairwell emergency lights on floors 1 through 6; replaced failed batteries and recorded the discharge-test results for the building logbook.", { status: "UNPAID", dueDays: 7 }),
  completed("04", 3, 5, -16, "Separate circuit for the dental sterilizer", "Installed a dedicated sterilizer circuit and labeled its protective device. Verified that the treatment-room outlets remain live during sterilizer isolation.", { status: "PARTIALLY_PAID", method: "BANK_TRANSFER", dueDays: 7 }),
  completed("05", 4, 2, -14, "Kitchen pendant lighting after the renovation", "Installed three owner-supplied pendant lights, aligned the shades over the island and verified the dimmer compatibility.", { status: "PAID", method: "GCASH", dueDays: 7 }),
  completed("06", 5, 6, -12, "Workshop panel upgrade and circuit labeling", "Replaced the crowded workshop panel, separated the compressor feeder and handed over a legible circuit schedule after load testing.", { status: "PAID", method: "CARD", dueDays: 14 }),
  completed("07", 6, 0, -10, "Classroom electrical safety inspection", "Inspected classroom outlets, checked earth continuity and delivered a room-by-room findings report before the new school term.", { status: "UNPAID", dueDays: 30 }),
  completed("08", 7, 1, -8, "Restore the pharmacy refrigerator circuit", "Replaced a failing breaker and corrected a loose neutral connection. Observed the refrigerator through two compressor cycles before handover.", { status: "PARTIALLY_PAID", method: "CASH", dueDays: 14 }),
  completed("09", 8, 4, -6, "Replace hallway switches in rental unit 3B", "Replaced four worn switches and checked the common lighting feed. The first invoice used the wrong purchase-order reference and was voided before payment.", { status: "VOID", dueDays: 14 }),
  completed("10", 9, 0, -5, "Safety inspection after a roof leak", "Checked the affected ceiling circuit, confirmed insulation resistance after drying and explained the updated breaker labels to the homeowner.", { status: "PAID", method: "OTHER", dueDays: 7 }),
  completed("11", 10, 5, -4, "Cold-room temperature alarm supply", "Installed and commissioned a dedicated supply for the temperature alarm and remote monitoring gateway. Completion report awaits billing."),
  completed("12", 11, 3, -3, "Repair the sewing-machine outlet row", "Replaced three loose receptacles, secured the surface boxes and checked load distribution while the sewing machines were running.", { status: "PAID", method: "BANK_TRANSFER", split: true, dueDays: 7, units: 3 }),
  completed("13", 2, 2, -2, "Replace lobby LED panels", "Replaced six flickering lobby LED panels and checked the lighting circuit. The building administrator signed the completion checklist.", { status: "UNPAID", dueDays: 7, units: 6 }),
  completed("14", 0, 1, -1, "Resolve nuisance trips on the laundry circuit", "Replaced the worn breaker after verifying cable size and appliance load. A final wash-cycle test passed; the job is ready to invoice."),
  { key: "15", customer: 7, service: 1, day: -1, status: "PENDING", priority: "URGENT", title: "Burning smell near the pharmacy distribution board", description: "The pharmacist isolated the affected circuit after noticing a hot-plastic smell. Arrange an urgent safe inspection; refrigerator remains on the separate supply.", jobs: [] },
  { key: "16", customer: 6, service: 7, day: 0, status: "PENDING", priority: "HIGH", title: "Exit signs not charging before the school event", description: "Two corridor exit signs fail the test button. Security will open the building for today's maintenance visit.", jobs: [{ status: "ASSIGNED", day: 0, description: "Inspect chargers, replace failed battery packs and run a mains-failure test." }] },
  { key: "17", customer: 8, service: 3, day: -2, status: "PENDING", priority: "NORMAL", title: "Loose bedroom outlet in rental unit 5A", description: "The tenant reports a socket pulling away from its wall box. Property manager is still arranging access; a technician and time slot are needed.", jobs: [{ status: "ASSIGNED", day: 1, unscheduled: true, unassigned: true, description: "Secure the wall box and replace the damaged bedroom receptacle once access is confirmed." }] },
  { key: "18", customer: 4, service: 2, day: 2, status: "PENDING", priority: "LOW", title: "Install the remaining garden wall lights", description: "Owners have supplied weatherproof fixtures. Schedule installation after the landscaper finishes the cable trench.", jobs: [{ status: "ASSIGNED", day: 2, description: "Install four IP-rated wall lights and test the dusk timer.", assignee: "manager" }] },
  { key: "19", customer: 1, service: 6, day: -2, status: "IN_PROGRESS", priority: "HIGH", title: "Bakehouse panel expansion for the second oven", description: "Carry out the panel upgrade in stages so the shop can continue trading. Owner has approved the feeder survey; final installation and testing remain open.", jobs: [
    { status: "COMPLETED", day: -2, description: "Survey the oven feeder, measure peak demand and confirm panel capacity.", assignee: "manager" },
    { status: "IN_PROGRESS", day: 0, description: "Install the expanded panel and terminate the new oven feeder under controlled isolation." },
    { status: "ASSIGNED", day: 1, description: "Perform final insulation tests, update the circuit schedule and obtain owner sign-off." },
  ] },
  { key: "20", customer: 10, service: 5, day: -3, status: "IN_PROGRESS", priority: "URGENT", title: "Cold-room condenser feeder overheating", description: "Temporary load reduction is in place. The replacement isolator delivery delayed the scheduled finish; operations need a revised handover time.", jobs: [{ status: "IN_PROGRESS", day: -2, description: "Replace the overheated isolator, remake cable terminations and thermally check the feeder at operating load." }] },
  { key: "21", customer: 3, service: 2, day: -1, status: "IN_PROGRESS", priority: "NORMAL", title: "Treatment-room lighting replacement awaiting sign-off", description: "Both lighting activities are finished. Office manager needs to review the checklist and explicitly close the request before billing.", jobs: [
    { status: "COMPLETED", day: -1, description: "Replace the treatment-room ceiling panels and verify illumination." },
    { status: "COMPLETED", day: -1, description: "Test the emergency light and hand over the maintenance checklist.", assignee: "manager" },
  ] },
  { key: "22", customer: 9, service: 2, day: -5, status: "CANCELLED", priority: "LOW", title: "Porch light installation cancelled by homeowner", description: "Homeowner postponed the porch renovation before dispatch. No work was performed and no invoice is due.", jobs: [] },
  { key: "23", customer: 11, service: 5, day: -4, status: "CANCELLED", priority: "NORMAL", title: "Additional sewing circuit cancelled after layout change", description: "The shop decided to move the machines to another unit. Dispatch cancelled the assigned visit before the technician started work.", jobs: [{ status: "CANCELLED", day: -3, description: "Install a dedicated circuit for two new sewing stations; cancelled before work started." }] },
  { key: "24", customer: 5, service: 0, day: -3, status: "PENDING", priority: "HIGH", title: "Workshop expansion needs a load assessment", description: "Owner is considering a second vehicle lift. Dispatch needs to arrange a survey and review the existing supply capacity before quoting.", jobs: [] },
  completed("25", 9, 4, 0, "Replace the entrance two-way switch", "Replaced the failed entrance switch, tested both control points and explained the new switch positions. Work completed this morning."),
];

// Manila reporting days, independent of the machine's timezone.
export function brightStarDate(now: Date, day: number, hour = 9) {
  const local = new Date(now.getTime() + 8 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, hour - 8));
}
