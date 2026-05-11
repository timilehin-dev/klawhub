export interface SchedulePreset {
  id: string;
  name: string;
  description: string;
  cronExpr: string;
  action: string;
  recommendedChannelName?: string;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: "morning-brief",
    name: "Comprehensive Morning Briefing",
    description: "A detailed summary of the last 24h across Slack, GitHub, Gmail, and Google Calendar.",
    cronExpr: "0 8 * * *",
    action: "Generate a comprehensive Morning Briefing summarizing all activity from the last 24 hours across Slack, GitHub, and Gmail.",
    recommendedChannelName: "general",
  },
  {
    id: "daily-standup",
    name: "Interactive Daily Huddle",
    description: "A recurring morning huddle that prompts the team for daily updates and compiles them into a summary.",
    cronExpr: "0 9 * * 1-5",
    action: "Start a daily huddle check-in: prompt everyone for their updates and summarize the team's status.",
    recommendedChannelName: "huddles",
  },
  {
    id: "github-sentinel",
    name: "GitHub PR Sentinel",
    description: "Scans connected repositories for open Pull Requests and pings assignees for review.",
    cronExpr: "0 17 * * 1-5",
    action: "Scan all connected GitHub repositories for open Pull Requests that are awaiting review and post a summary pinging the reviewers.",
    recommendedChannelName: "engineering",
  },
  {
    id: "friday-retro",
    name: "Friday Team Retrospective",
    description: "A weekly Friday afternoon prompt to reflect on the week's progress and blockers.",
    cronExpr: "0 16 * * 5",
    action: "Run a weekly retrospective: ask the team what went well, what could be improved, and what the key wins were.",
    recommendedChannelName: "general",
  },
];
