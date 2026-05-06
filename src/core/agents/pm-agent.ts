import { BaseAgent } from "./base-agent";
import { createSpec } from "./pm";
import type { AgentMessage } from "@/core/a2a/message-bus";

export class PMAgent extends BaseAgent {
  constructor(workspaceId?: string) {
    super("pm", workspaceId);
    this.capabilities = [
      "requirement_analysis",
      "project_specification",
      "task_breakdown",
      "scope_management",
      "risk_assessment",
    ];
  }

  async handleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case "request":
        if (message.payload.type === "analyze_requirements") {
          await this.analyzeRequirements(message.payload.task, message.from);
        } else if (message.payload.type === "create_spec") {
          await this.createProjectSpec(message.payload.request, message.from);
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
    return this.createProjectSpec(task.request, task.from || "system");
  }

  private async analyzeRequirements(task: any, requester: string): Promise<void> {
    // Analyze and suggest improvements
    const analysis = {
      complexity: this.assessComplexity(task),
      risks: this.identifyRisks(task),
      suggestions: this.generateSuggestions(task),
    };

    await this.sendMessage(requester, "response", {
      type: "analysis",
      analysis,
    });
  }

  private async createProjectSpec(request: string, requester: string): Promise<void> {
    try {
      // Get user context from memory if available
      const userContext = await this.requestResponse("general", {
        type: "get_user_context",
        userId: requester,
      }).catch(() => "");

      const spec = await createSpec(request, userContext);

      await this.sendMessage(requester, "response", {
        type: "spec_created",
        spec,
      });

      // Notify relevant agents
      await this.broadcast("spec_available", {
        spec,
        requester,
      });
    } catch (error) {
      await this.sendMessage(requester, "response", {
        type: "error",
        error: (error as Error).message,
      });
    }
  }

  private async handleDelegation(task: any): Promise<void> {
    // PM can delegate to other agents based on task type
    if (task.type === "research") {
      await this.delegateTask("researcher", task);
    } else if (task.type === "code") {
      await this.delegateTask("engineer", task);
    } else if (task.type === "analysis") {
      await this.delegateTask("analyst", task);
    }
  }

  protected async checkWorkspacePatterns(): Promise<void> {
    // Proactively check for incomplete projects or stalled tasks
    const stalledTasks = await this.requestResponse("general", {
      type: "get_stalled_tasks",
    }).catch(() => []);

    if (stalledTasks.length > 0) {
      await this.suggestTask({
        type: "review_stalled",
        tasks: stalledTasks,
        reason: "Found stalled tasks that may need attention",
      });
    }
  }

  private assessComplexity(task: any): "low" | "medium" | "high" {
    const indicators = {
      low: ["simple", "basic", "quick"],
      high: ["complex", "enterprise", "integration", "scale"],
    };

    const description = JSON.stringify(task).toLowerCase();

    if (indicators.high.some(word => description.includes(word))) return "high";
    if (indicators.low.some(word => description.includes(word))) return "low";
    return "medium";
  }

  private identifyRisks(task: any): string[] {
    const risks: string[] = [];
    const desc = JSON.stringify(task).toLowerCase();

    if (desc.includes("deadline") || desc.includes("urgent")) {
      risks.push("Tight timeline may affect quality");
    }
    if (desc.includes("integration") || desc.includes("api")) {
      risks.push("External dependencies may cause delays");
    }
    if (desc.includes("new") || desc.includes("unfamiliar")) {
      risks.push("Learning curve for new technologies");
    }

    return risks;
  }

  private generateSuggestions(task: any): string[] {
    const suggestions: string[] = [];
    const desc = JSON.stringify(task).toLowerCase();

    if (desc.includes("code") && !desc.includes("test")) {
      suggestions.push("Consider adding automated testing");
    }
    if (desc.includes("user") && !desc.includes("feedback")) {
      suggestions.push("Plan for user acceptance testing");
    }
    if (desc.includes("data") && !desc.includes("security")) {
      suggestions.push("Review data privacy and security requirements");
    }

    return suggestions;
  }

  protected loadState(state: any): void {
    // Load any persistent state
  }

  protected async saveState(): Promise<void> {
    // Save current state
    await this.updateState({
      lastActivity: new Date().toISOString(),
      activeProjects: [], // Would track in real implementation
    });
  }
}