import { WebClient } from "@slack/web-api";

let _slack: WebClient | null = null;

function getSlack(): WebClient {
  if (!_slack) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
    _slack = new WebClient(token);
  }
  return _slack;
}

// Lazy getter — avoids throwing at build time
export const slack = new Proxy({} as WebClient, {
  get(_, prop) {
    return (getSlack() as any)[prop];
  },
});

export async function postToThread(
  channel: string,
  threadTs: string,
  text: string,
  options?: { blocks?: unknown[] }
) {
  return getSlack().chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    ...options,
  });
}

export async function addReaction(channel: string, timestamp: string, emoji: string) {
  return getSlack().reactions.add({ channel, timestamp, name: emoji });
}

export async function removeReaction(channel: string, timestamp: string, emoji: string) {
  return getSlack().reactions.remove({ channel, timestamp, name: emoji });
}

export async function uploadFile(
  channel: string,
  threadTs: string,
  content: string,
  filename: string,
  title: string
) {
  return getSlack().files.uploadV2({
    channel_id: channel,
    thread_ts: threadTs,
    content,
    filename,
    title,
  });
}

export async function uploadBinaryFile(
  channel: string,
  threadTs: string,
  fileBuffer: Buffer,
  filename: string,
  title: string
) {
  return getSlack().files.uploadV2({
    channel_id: channel,
    thread_ts: threadTs,
    file: fileBuffer as unknown as string,
    filename,
    title,
  });
}
