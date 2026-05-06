import { BaseAgent } from "./base-agent";
import { conductResearch } from "./researcher";
import type { AgentMessage } from "@/core/a2a/message-bus";

export class ResearcherAgent extends BaseAgent {
  constructor(workspaceId?: string) {
    super("researcher", workspaceId);
    this.capabilities = [
      "web_research",
      "market_analysis",
      "technology_scanning",
      "competitor_intelligence",
      "trend_monitoring",
    ];
  }

  async handleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case "request":
        if (message.payload.type === "research") {
          await this.performResearch(message.payload.query, message.from, message.payload.context);
        } else if (message.payload.type === "monitor_trends") {
          await this.monitorTrends(message.payload.topic, message.from);
        } else if (message.payload.type === "delegate") {
          await this.handleDelegation(message.payload.task);
        }
        break;
      case "broadcast":
        if (message.payload.type === "workspace_update") {
          await this.checkWorkspacePatterns();
        }
        break;
    }
  }

  async executeTask(task: any): Promise<any> {
    return this.performResearch(task.query, task.from || "system", task.context);
  }

  private async performResearch(query: string, requester: string, context?: string): Promise<void> {
    try {
      const enrichedQuery = context ? `${query}\n\nContext: ${context}` : query;
      const result = await conductResearch(enrichedQuery, {
        taskId: `research_${Date.now()}`,
        slackUserId: requester,
      });

      await this.sendMessage(requester, "response", {
        type: "research_complete",
        result,
      });

      // Cache research for future use
      await this.updateState({
        lastResearch: {
          query,
          sources: result.sources.length,
          timestamp: new Date().toISOString(),
        },
      });

      // Notify other agents that might benefit
      await this.broadcast("research_available", {
        topic: query,
        summary: result.findings.slice(0, 200),
        requester,
      });
    } catch (error) {
      await this.sendMessage(requester, "response", {
        type: "error",
        error: (error as Error).message,
      });
    }
  }

  private async monitorTrends(topic: string, requester: string): Promise<void> {
    // Set up ongoing monitoring
    const monitoringId = `monitor_${topic}_${Date.now()}`;

    await this.updateState({
      activeMonitoring: {
        [monitoringId]: {
          topic,
          requester,
          started: new Date().toISOString(),
        },
      },
    });

    await this.sendMessage(requester, "response", {
      type: "monitoring_started",
      monitoringId,
      topic,
    });

    // Perform initial research
    await this.performResearch(`Latest trends in ${topic}`, requester);
  }

  private async handleDelegation(task: any): Promise<void> {
    // Researcher can delegate analysis to analyst
    if (task.type === "analyze") {
      await this.delegateTask("analyst", task);
    }
  }

  protected async checkWorkspacePatterns(): Promise<void> {
    // Check for topics that might benefit from research
    const recentActivity = await this.requestResponse("general", {
      type: "get_recent_activity",
    }).catch(() => []);

    const researchOpportunities = this.identifyResearchNeeds(recentActivity);

    if (researchOpportunities.length > 0) {
      for (const opportunity of researchOpportunities) {
        await this.suggestTask({
          type: "research",
          query: opportunity.query,
          reason: opportunity.reason,
        });
      }
    }
  }

  private identifyResearchNeeds(activity: any[]): any[] {
    const opportunities: any[] = [];

    // Look for technical terms that might need research
    const techTerms = activity
      .filter(item => item.type === "message")
      .map(item => item.content)
      .join(" ")
      .match(/\b(React|Python|AI|ML|API|cloud|serverless|database)\b/gi) || [];

    const uniqueTerms = [...new Set(techTerms)];

    for (const term of uniqueTerms) {
      if (!this.hasRecentResearch(term)) {
        opportunities.push({
          query: `Latest developments and best practices for ${term}`,
          reason: `Recent mentions of ${term} suggest research opportunity`,
        });
      }
    }

    return opportunities;
  }

  private hasRecentResearch(topic: string): boolean {
    // Check if we researched this recently
    const state = this.getState();
    const lastResearch = state?.lastResearch;

    if (!lastResearch) return false;

    const lastDate = new Date(lastResearch.timestamp);
    const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);

    return daysSince < 7 && lastResearch.query.toLowerCase().includes(topic.toLowerCase());
  }

  private getState(): any {
    // In real implementation, this would be loaded from DB
    return null;
  }

  protected loadState(state: any): void {
    // Load monitoring state, research history, etc.
  }

  protected async saveState(): Promise<void> {
    await this.updateState({
      lastActivity: new Date().toISOString(),
    });
  }
}