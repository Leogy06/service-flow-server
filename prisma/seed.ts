import { Role, UserStatus } from "../src/generated/prisma/client.js";
import bcrypt from "bcryptjs";
import {PrismaClient} from "../src/generated/prisma/client.js";
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";


const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaMariaDb({
  host: process.env.DATABASE_HOST ?? "localhost",
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  connectionLimit: 5,
});



const prisma = new PrismaClient({
  adapter
})

interface SeedUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  phone?: string;
  role: Role;
  status: UserStatus;
}

const seedUsers: SeedUser[] = [
  {
    email: "admin@serviceflow.dev",
    password: "Admin123!",
    firstName: "System",
    lastName: "Admin",
    role: "ADMIN",
    status: "ACTIVE",
  },
  {
    email: "staff1@serviceflow.dev",
    password: "Staff123!",
    firstName: "Juan",
    lastName: "Dela Cruz",
    middleName: "Santos",
    phone: "+639171234567",
    role: "STAFF",
    status: "ACTIVE",
  },
  {
    email: "staff2@serviceflow.dev",
    password: "Staff123!",
    firstName: "Maria",
    lastName: "Reyes",
    role: "STAFF",
    status: "ACTIVE", 
  },
  {
    email: "inactive@serviceflow.dev",
    password: "Inactive123!",
    firstName: "Pedro",
    lastName: "Garcia",
    role: "STAFF",
    status: "INACTIVE",
  },
];

async function main() {
  console.log("🌱 Seeding users...");

  for (const u of seedUsers) {
    const passwordHash = await bcrypt.hash(u.password, 12);

    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {}, // no-op if it already exists — keeps seed idempotent
      create: {
        email: u.email,
        password: passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        middleName: u.middleName,
        suffix: u.suffix,
        phone: u.phone,
        role: u.role,
        status: u.status,
      },
    });

    console.log(`  ✓ ${user.email} (${user.role})`);
  }

  console.log("✅ Seeding complete.");
}

main()
  .catch((err) => {
    console.error("❌ Seeding failed:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
