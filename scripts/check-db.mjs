import pg from "pg";
import { PrismaClient } from "@prisma/client";

const url =
  process.env.DATABASE_URL ??
  "postgresql://leadforge:leadforge_local@127.0.0.1:5432/leadforge?schema=public&connection_limit=1";

try {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const result = await client.query('select count(*)::int as n from "Company"');
  console.log("pg ok:", result.rows[0]);
  await client.end();
} catch (error) {
  console.log("pg failed:", error.message);
}

try {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const counts = await Promise.all([
    prisma.company.count(),
    prisma.contact.count(),
    prisma.emailAddress.count(),
  ]);
  console.log("prisma concurrent ok:", counts);
  await prisma.$disconnect();
} catch (error) {
  console.log("prisma failed:", error.message);
}
