import { getDb } from "./connection";
import { skillUsage } from "./schema";
import { eq, desc, sql, count } from "drizzle-orm";

export function trackSkillUsage(
  skillName: string,
  slackUserId: string,
  slackChannelId: string,
  request: string,
  outcome: "success" | "error"
) {
  return getDb().insert(skillUsage).values({
    skillName,
    slackUserId,
    slackChannelId,
    request: request.slice(0, 500),
    outcome,
  });
}

export function getUserSkillStats(slackUserId: string) {
  return getDb()
    .select({
      skillName: skillUsage.skillName,
      count: count(),
    })
    .from(skillUsage)
    .where(eq(skillUsage.slackUserId, slackUserId))
    .groupBy(skillUsage.skillName)
    .orderBy(desc(count()));
}
