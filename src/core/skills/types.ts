export interface SkillContext {
  slackUserId: string;
  slackChannelId: string;
  slackThreadTs?: string;
  workspaceId?: string;
  teamId?: string;
}

export interface Skill {
  /** Unique name of the skill */
  name: string;
  
  /** Description of what the skill does (for logging/debugging) */
  description: string;
  
  /** Regex pattern to match user intent for fast-path routing */
  matchPattern: RegExp;
  
  /** 
   * Execute the skill logic directly, bypassing the heavy orchestrator.
   * Returns a markdown string to be sent to the user.
   */
  execute: (request: string, context: SkillContext) => Promise<string>;
}
