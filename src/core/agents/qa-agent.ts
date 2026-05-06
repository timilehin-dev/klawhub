import { BaseAgent } from "./base-agent";
import { testCode } from "./qa";
import type { AgentMessage } from "@/core/a2a/message-bus";

export class QAAgent extends BaseAgent {
  constructor(workspaceId?: string) {
    super("qa", workspaceId);
    this.capabilities = [
      "code_testing",
      "quality_assurance",
      "bug_detection",
      "performance_analysis",
      "security_audit",
    ];
  }

  async handleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case "request":
        if (message.payload.type === "test_code") {
          await this.testCode(message.payload, message.from);
        } else if (message.payload.type === "audit_quality") {
          await this.auditQuality(message.payload.target, message.from);
        } else if (message.payload.type === "delegate") {
          await this.handleDelegation(message.payload.task);
        }
        break;
      case "broadcast":
        if (message.payload.eventType === "code_generated") {
          await this.offerTesting(message.payload);
        } else if (message.payload.eventType === "workspace_update") {
          await this.checkWorkspacePatterns();
        }
        break;
    }
  }

  async executeTask(task: any): Promise<any> {
    return this.testCode(task, task.from || "system");
  }

  private async testCode(testData: any, requester: string): Promise<void> {
    try {
      const result = await testCode(
        testData.code,
        testData.language || "python",
        testData.spec,
        testData.request || "Test the provided code",
        {
          runId: `qa_${Date.now()}`,
          slackUserId: requester,
        }
      );

      const briefResult = result.passed ? "All checks passed." : "Issues found.";

      await this.sendMessage(requester, "response", {
        type: "test_complete",
        passed: result.passed,
        brief: briefResult,
        fullReport: result.evaluation,
      });

      // Store learnings for future improvements
      await this.updateState({
        lastTest: {
          passed: result.passed,
          language: testData.language,
          timestamp: new Date().toISOString(),
        },
      });

      // Notify engineer if failed
      if (!result.passed) {
        await this.sendMessage("engineer", "request", {
          type: "fix_required",
          code: testData.code,
          error: result.evaluation,
          requester,
        });
      }
    } catch (error) {
      await this.sendMessage(requester, "response", {
        type: "error",
        error: (error as Error).message,
      });
    }
  }

  private async auditQuality(target: any, requester: string): Promise<void> {
    // Perform quality audit on various targets (code, docs, etc.)
    const auditResult = {
      score: 85, // Would calculate based on criteria
      issues: ["Minor documentation improvements needed"],
      recommendations: ["Add more comments", "Consider error handling"],
    };

    await this.sendMessage(requester, "response", {
      type: "audit_complete",
      audit: auditResult,
    });
  }

  private async offerTesting(codeData: any): Promise<void> {
      // Offer to test newly generated code
      await this.broadcast("broadcast", {
        eventType: "offer_testing",
        message: "I can test the generated code for quality and correctness. Would you like me to proceed?",
        code: codeData.code,
        language: codeData.language,
        requester: codeData.requester,
      });
  }

  private async handleDelegation(task: any): Promise<void> {
    // QA can delegate security audits to specialized agents if needed
    // For now, handle internally
  }

  protected async checkWorkspacePatterns(): Promise<void> {
    // Check for code that hasn't been tested
    const untestedCode = await this.requestResponse("general", {
      type: "get_untested_code",
    }).catch(() => []);

    if (untestedCode.length > 0) {
      for (const code of untestedCode) {
        await this.suggestTask({
          type: "test_code",
          code,
          reason: "Found untested code that should be validated",
        });
      }
    }
  }

  protected loadState(state: any): void {
    // Load testing history, known issues, etc.
  }

  protected async saveState(): Promise<void> {
    await this.updateState({
      lastActivity: new Date().toISOString(),
    });
  }
}