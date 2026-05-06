interface AgentMessage {
  from: string;
  to: string;
  type: string;
  payload: any;
  correlationId?: string;
  timestamp: number;
}

const test: AgentMessage = {
  from: "test",
  to: "test",
  type: "test_type",
  payload: {},
  timestamp: Date.now()
};

console.log("TypeScript works");