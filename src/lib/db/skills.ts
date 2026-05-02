import { getDb } from "./connection";
import { skills } from "./schema";
import { eq } from "drizzle-orm";

export function getActiveSkills() {
  return getDb().select().from(skills).where(eq(skills.isActive, true));
}
