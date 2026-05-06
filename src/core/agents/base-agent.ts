import { messageBus, AgentMessage } from "@/core/a2a/message-bus";
import { saveAgentState, getAgentState } from "@/db";

export abstract class BaseAgent {
  protected name: string;
  protected workspaceId?: string;
  protected capabilities: string[] = [];

  constructor(name: string, workspaceId?: string) {
    this.name = name;
    this.workspaceId = workspaceId;
    this.initialize();
  }

  private async initialize() {
    // Load persistent state
    const state = await getAgentState(this.workspaceId, this.name);
    if (state) {
      this.loadState(state);
    }

    // Subscribe to messages
    messageBus.subscribe(this.name, this.handleMessage.bind(this));
  }

  protected abstract handleMessage(message: AgentMessage): Promise<void>;
  protected abstract executeTask(task: any): Promise<any>;
  protected abstract loadState(state: any): void;
  protected abstract saveState(): Promise<void>;

  async sendMessage(to: string, type: AgentMessage['type'], payload: any): Promise<void> {
    await messageBus.sendMessage(to, {
      from: this.name,
      type,
      payload,
    });
  }

  async broadcast(eventType: string, payload: any): Promise<void> {
    await messageBus.broadcast({
      from: this.name,
      type: eventType,
      payload,
    });
  }

  async requestResponse(to: string, payload: any): Promise<any> {
    return messageBus.requestResponse(this.name, to, payload);
  }

  protected async updateState(updates: Record<string, any>): Promise<void> {
    await saveAgentState(this.workspaceId, this.name, updates);
  }

  // Proactive methods - agents can initiate actions
  protected async checkWorkspacePatterns(): Promise<void> {
    // Override in subclasses to scan for opportunities
  }

  protected async suggestTask(task: any): Promise<void> {
    await this.sendMessage('general', 'request', {
      type: 'suggestion',
      task,
    });
  }

  protected async delegateTask(to: string, task: any): Promise<any> {
    const result = await this.requestResponse(to, {
      type: 'delegate',
      task,
    });
    return result;
  }
}