import { Redis } from "@upstash/redis";

// Use existing Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface AgentMessage {
  from: string;
  to: string;
  type: string;
  payload: any;
  correlationId?: string;
  timestamp: number;
}

export class A2AMessageBus {
  private subscribers: Map<string, (message: AgentMessage) => void> = new Map();
  private pendingRequests: Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; timeout: NodeJS.Timeout }> = new Map();

  async publish(channel: string, message: AgentMessage): Promise<void> {
    await redis.publish(channel, JSON.stringify(message));
  }

  private subscriberClient: Redis | null = null;
 
  async subscribe(agentName: string, handler: (message: AgentMessage) => void): Promise<void> {
    this.subscribers.set(agentName, handler);
 
    if (!this.subscriberClient) {
      this.subscriberClient = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      });
    }
 
    // Note: Upstash Redis REST 'subscribe' is actually a long-polling or webhook-based 
    // mechanism depending on the exact package version. Reusing the client is safer.
    (this.subscriberClient as any).subscribe(`agent:${agentName}`, (rawMessage: any) => {
      try {
        const message: AgentMessage = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
        if (message.correlationId) {
          const pending = this.pendingRequests.get(message.correlationId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(message.correlationId);
            pending.resolve(message.payload);
            return;
          }
        }
        handler(message);
      } catch (err) {
        console.error(`[A2A] Failed to parse message for ${agentName}:`, err);
      }
    });
  }

  async sendMessage(to: string, message: Omit<AgentMessage, 'timestamp' | 'to'>): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
      to,
      timestamp: Date.now(),
    };
    await this.publish(`agent:${to}`, fullMessage);
  }

  async broadcast(message: Omit<AgentMessage, 'to' | 'timestamp'>): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
      to: '*',
      timestamp: Date.now(),
    };
    await this.publish('agent:broadcast', fullMessage);
  }

  // For direct coordination (simpler than pub/sub for initial implementation)
  async requestResponse(from: string, to: string, payload: any, timeoutMs = 30000): Promise<any> {
    const correlationId = `req_${Date.now()}_${Math.random()}`;

    const promise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error('Request timeout'));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, reject, timeout });
    });

    await this.sendMessage(to, {
      from,
      type: 'request',
      payload,
      correlationId,
    });

    return promise;
  }
}

export const messageBus = new A2AMessageBus();