import { WebClient } from "@slack/web-api";

if (!process.env.SLACK_BOT_TOKEN) {
  throw new Error("SLACK_BOT_TOKEN is not set");
}

export const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function postToThread(
  channel: string,
  threadTs: string,
  text: string,
  options?: { blocks?: any[] }
) {
  return slack.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    ...options,
  });
}

export async function addReaction(channel: string, timestamp: string, emoji: string) {
  return slack.reactions.add({
    channel,
    timestamp,
    name: emoji,
  });
}

export async function uploadFile(
  channel: string,
  threadTs: string,
  content: string,
  filename: string,
  title: string
) {
  return slack.files.uploadV2({
    channel_id: channel,
    thread_ts: threadTs,
    content,
    filename,
    title,
  });
}
