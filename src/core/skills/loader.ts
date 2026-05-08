import { Skill } from "./types";
import { meetingSummarizationSkill } from "./meeting_summarization";
import { taskBreakdownSkill } from "./task_breakdown";
import { competitorResearchSkill } from "./competitor_research";
import { sprintPlanningSkill } from "./sprint_planning";
import { slackThreadAnalysisSkill } from "./slack_thread_analysis";
import { bugTriageSkill } from "./bug_triage";
import { calendarConflictResolutionSkill } from "./calendar_conflict_resolution";

/**
 * Static registry of all active skills.
 * We use static imports to ensure 100% reliability in serverless environments (Vercel)
 * where dynamic file-system loading can fail due to Webpack bundling.
 */
export const activeSkills: Skill[] = [
  meetingSummarizationSkill,
  taskBreakdownSkill,
  competitorResearchSkill,
  sprintPlanningSkill,
  slackThreadAnalysisSkill,
  bugTriageSkill,
  calendarConflictResolutionSkill,
];

/**
 * Check if the user's request matches a fast-path skill.
 */
export function matchSkill(request: string): Skill | null {
  const text = request.trim();
  for (const skill of activeSkills) {
    if (skill.matchPattern.test(text)) {
      return skill;
    }
  }
  return null;
}
