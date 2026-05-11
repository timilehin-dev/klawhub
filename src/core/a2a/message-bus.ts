import { Redis } from "@upstash/redis";

// Defensive Redis initialization — prevents crash if env vars are missing
let redis: Redis | null = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch {
  console.warn("[A2A] Redis initialization failed — message bus will no-op.");
}

export interface AgentMessage {
  from: string;
  to: string;
  type: string;
  payload: any;
  correlationId?: string;
  timestamp: number;
}

export class A2AMessageBus {
  // We removed local Maps to ensure Serverless statelessness
  // Subscribers pull from Upstash Redis or poll responses

  async publish(channel: string, message: AgentMessage): Promise<void> {
    if (!redis) return;
    
    // If it's a direct response to a requestResponse correlationId, store it
    // so the stateless polling can pick it up across serverless environments
    if (message.correlationId && message.type === 'response') {
      await redis.set(`response:${message.correlationId}`, JSON.stringify(message.payload), { ex: 60 });
    }
    
    // Also publish via standard Pub/Sub for standard subscribers
    await redis.publish(channel, JSON.stringify(message));
  }

  private subscriberClient: Redis | null = null;
 
  async subscribe(agentName: string, handler: (message: AgentMessage) => void): Promise<void> {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      console.warn(`[A2A] Redis env vars missing. Cannot subscribe ${agentName}.`);
      return;
    }
 
    const client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
 
    // Simulate long-lived subscription via polling list queue
    console.log(`[A2A] Starting simulated REST subscription polling for agent:${agentName}`);
    
    // Background polling loop
    (async () => {
      while (true) {
        try {
          const rawMessage = await client.rpop(`queue:agent:${agentName}`);
          if (rawMessage) {
            const message: AgentMessage = typeof rawMessage === "string" ? JSON.parse(rawMessage) : (rawMessage as unknown as AgentMessage);
            handler(message);
          } else {
            // No message, delay before polling again
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (err) {
          console.error(`[A2A] Polling failed for ${agentName}:`, err);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    })();
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

  // Stateless coordination for serverless
  async requestResponse(from: string, to: string, payload: any, timeoutMs = 30000): Promise<any> {
    if (!redis) throw new Error("Redis not configured");

    const correlationId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    await this.sendMessage(to, {
      from,
      type: 'request',
      payload,
      correlationId,
    });

    // Stateless polling for the response key
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const responseStr = await redis.get(`response:${correlationId}`);
      if (responseStr) {
        await redis.del(`response:${correlationId}`);
        try {
          return typeof responseStr === 'string' ? JSON.parse(responseStr) : responseStr;
        } catch {
          return responseStr;
        }
      }
      // Delay before polling again - optimized for responsiveness
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    throw new Error(`Request timeout for ${correlationId}`);
  }
}

export const messageBus = new A2AMessageBus();