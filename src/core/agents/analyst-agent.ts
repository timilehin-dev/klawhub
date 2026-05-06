import { BaseAgent } from "./base-agent";
import type { AgentMessage } from "@/core/a2a/message-bus";

export class AnalystAgent extends BaseAgent {
  constructor(workspaceId?: string) {
    super("analyst", workspaceId);
    this.capabilities = [
      "data_analysis",
      "visualization",
      "statistical_modeling",
      "reporting",
      "insights_generation",
    ];
  }

  async handleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case "request":
        if (message.payload.type === "analyze_data") {
          await this.analyzeData(message.payload.data, message.from, message.payload.query);
        } else if (message.payload.type === "generate_report") {
          await this.generateReport(message.payload.topic, message.from);
        } else if (message.payload.type === "delegate") {
          await this.handleDelegation(message.payload.task);
        }
        break;
      case "broadcast":
        if (message.payload.eventType === "research_available") {
          await this.checkResearchAndOfferAnalysis(message.payload);
        } else if (message.payload.eventType === "workspace_update") {
          await this.checkWorkspacePatterns();
        }
        break;
    }
  }

  async executeTask(task: any): Promise<any> {
    return this.analyzeData(task.data, task.from || "system", task.query);
  }

  private async analyzeData(data: any, requester: string, query?: string): Promise<void> {
    try {
      // Use code execution for analysis
      const analysisCode = this.generateAnalysisCode(data, query);

      const result = await this.requestResponse("engineer", {
        type: "execute_code",
        code: analysisCode,
        language: "python",
      });

      const insights = this.extractInsights(result);

      await this.sendMessage(requester, "response", {
        type: "analysis_complete",
        insights,
        visualizations: [], // Would generate charts
      });

      // Cache analysis for future
      await this.updateState({
        lastAnalysis: {
          query,
          dataSize: JSON.stringify(data).length,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      await this.sendMessage(requester, "response", {
        type: "error",
        error: (error as Error).message,
      });
    }
  }

  private async generateReport(topic: string, requester: string): Promise<void> {
    // Generate comprehensive report
    const report = {
      title: `Analysis Report: ${topic}`,
      sections: [
        "Executive Summary",
        "Methodology",
        "Findings",
        "Recommendations",
        "Conclusion",
      ],
      generatedAt: new Date().toISOString(),
    };

    await this.sendMessage(requester, "response", {
      type: "report_generated",
      report,
    });
  }

  private async checkResearchAndOfferAnalysis(researchData: any): Promise<void> {
    // If research involves data, offer analysis
    if (researchData.topic.toLowerCase().includes("data") ||
        researchData.topic.toLowerCase().includes("analysis")) {
      await this.sendMessage(researchData.requester, "request", {
        type: "offer_analysis",
        message: "The research contains data that could benefit from analysis. Would you like me to analyze it?",
        topic: researchData.topic,
      });
    }
  }

  private async handleDelegation(task: any): Promise<void> {
    // Analyst can delegate data collection to researcher
    if (task.type === "collect_data") {
      await this.delegateTask("researcher", task);
    }
  }

  private generateAnalysisCode(data: any, query?: string): string {
    return `
import pandas as pd
import numpy as np

# Load data
data = ${JSON.stringify(data)}

# Basic analysis
df = pd.DataFrame(data)
summary = df.describe()

# Custom analysis based on query
${query ? `result = df.${query}` : "result = summary"}

print(result.to_string())
`;
  }

  private extractInsights(result: any): any[] {
    // Extract key insights from analysis results
    return [
      "Data summary generated",
      "Key metrics identified",
      "Trends observed",
    ];
  }

  protected async checkWorkspacePatterns(): Promise<void> {
    // Check for data that needs analysis
    const availableData = await this.requestResponse("general", {
      type: "get_available_data",
    }).catch(() => []);

    if (availableData.length > 0) {
      for (const data of availableData) {
        if (data.needsAnalysis) {
          await this.suggestTask({
            type: "analyze_data",
            data,
            reason: "Found data ready for analysis",
          });
        }
      }
    }
  }

  protected loadState(state: any): void {
    // Load analysis preferences, common queries, etc.
  }

  protected async saveState(): Promise<void> {
    await this.updateState({
      lastActivity: new Date().toISOString(),
    });
  }
}