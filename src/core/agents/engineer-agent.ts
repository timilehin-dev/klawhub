import { BaseAgent } from "./base-agent";
import { writeCodeFromLearnings } from "./engineer";
import type { AgentMessage } from "@/core/a2a/message-bus";

export class EngineerAgent extends BaseAgent {
  constructor(workspaceId?: string) {
    super("engineer", workspaceId);
    this.capabilities = [
      "code_generation",
      "bug_fixing",
      "architecture_design",
      "performance_optimization",
      "security_implementation",
    ];
  }

  async handleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case "request":
        if (message.payload.type === "write_code") {
          await this.generateCode(message.payload.spec, message.from, message.payload.context);
        } else if (message.payload.type === "fix_code") {
          await this.fixCode(message.payload.code, message.payload.error, message.from);
        } else if (message.payload.type === "delegate") {
          await this.handleDelegation(message.payload.task);
        }
        break;
      case "broadcast":
        if (message.payload.type === "spec_available") {
          await this.checkSpecAndOfferHelp(message.payload);
        } else if (message.payload.type === "workspace_update") {
          await this.checkWorkspacePatterns();
        }
        break;
    }
  }

  async executeTask(task: any): Promise<any> {
    return this.generateCode(task.spec, task.from || "system", task.context);
  }

  private async generateCode(spec: any, requester: string, context?: any): Promise<void> {
    try {
      const result = await writeCodeFromLearnings(
        spec.spec || spec,
        spec.language || "python",
        spec.request || "Generate code based on specification",
        {
          runId: `eng_${Date.now()}`,
          slackUserId: requester,
          dependencies: spec.dependencies,
          learningsContext: context?.learnings,
        }
      );

      await this.sendMessage(requester, "response", {
        type: "code_generated",
        code: result.code,
        language: spec.language,
      });

      // Notify QA for testing
      await this.sendMessage("qa", "request", {
        type: "test_code",
        code: result.code,
        spec: spec.spec || spec,
        language: spec.language,
        requester,
      });
    } catch (error) {
      await this.sendMessage(requester, "response", {
        type: "error",
        error: (error as Error).message,
      });
    }
  }

  private async fixCode(code: string, error: string, requester: string): Promise<void> {
    try {
      const result = await writeCodeFromLearnings(
        `Fix this code that has the following error: ${error}\n\nOriginal code:\n${code}`,
        "python", // Would detect language
        "Fix the code error",
        {
          runId: `fix_${Date.now()}`,
          slackUserId: requester,
        }
      );

      await this.sendMessage(requester, "response", {
        type: "code_fixed",
        code: result.code,
      });
    } catch (error) {
      await this.sendMessage(requester, "response", {
        type: "error",
        error: (error as Error).message,
      });
    }
  }

  private async handleDelegation(task: any): Promise<void> {
    // Engineer can delegate testing to QA
    if (task.type === "test") {
      await this.delegateTask("qa", task);
    }
  }

  private async checkSpecAndOfferHelp(specData: any): Promise<void> {
      // If spec involves code, offer to implement
      if (specData.spec.language || specData.spec.includes("code")) {
        await this.broadcast("broadcast", {
          eventType: "offer_help",
          message: "I can implement the code for this specification. Would you like me to proceed?",
          spec: specData.spec,
          requester: specData.requester,
        });
      }
  }

  protected async checkWorkspacePatterns(): Promise<void> {
    // Check for code-related opportunities
    const pendingSpecs = await this.requestResponse("general", {
      type: "get_pending_specs",
    }).catch(() => []);

    if (pendingSpecs.length > 0) {
      for (const spec of pendingSpecs) {
        if (spec.needsCode) {
          await this.suggestTask({
            type: "implement_spec",
            spec,
            reason: "Found specification ready for implementation",
          });
        }
      }
    }
  }

  protected loadState(state: any): void {
    // Load coding preferences, recent projects, etc.
  }

  protected async saveState(): Promise<void> {
    await this.updateState({
      lastActivity: new Date().toISOString(),
    });
  }
}