import { Redis } from "@upstash/redis";

// Use existing Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface AgentMessage {
  from: string;
  to: string;
  type: 'request' | 'response' | 'broadcast' | 'status';
  payload: any;
  correlationId?: string;
  timestamp: number;
}

export class A2AMessageBus {
  private subscribers: Map<string, (message: AgentMessage) => void> = new Map();

  async publish(channel: string, message: AgentMessage): Promise<void> {
    await redis.publish(channel, JSON.stringify(message));
  }

  async subscribe(agentName: string, handler: (message: AgentMessage) => void): Promise<void> {
    this.subscribers.set(agentName, handler);
    // In a real implementation, you'd use Redis subscribe here
    // For now, agents will poll or use direct calls
  }

  async sendMessage(to: string, message: Omit<AgentMessage, 'timestamp' | 'to'>): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
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
      const timeout = setTimeout(() => reject(new Error('Request timeout')), timeoutMs);

      // In a real system, use Redis pub/sub with listeners
      // For now, simulate direct call or use DB polling
      // This is a placeholder for actual A2A implementation
      resolve({ status: 'simulated', payload });
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