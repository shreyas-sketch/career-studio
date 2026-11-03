// Development only: loads Dossier's demo profile (Jane Doe, made up) into one account's schema,
// for trying the agents locally. Usage: tsx scripts/dev/seed-demo.mts u_<account id>
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { seedDemo } from "../../prisma/seed/demo";
const schema = process.argv[2]!;
const url = new URL("postgresql://postgres:pg@127.0.0.1:5432/career_studio");
url.searchParams.set("options", `-c search_path=${schema},public`);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema }) });
const result = await seedDemo(db as never, { reset: true }).catch((e) => { console.error(e.message); return null; });
console.log("seeded", result);
await db.$disconnect();
