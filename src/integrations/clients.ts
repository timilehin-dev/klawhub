import { getValidAccessToken, touchLastUsed, markIntegrationError, getIntegrationByProvider } from "./store";
import { getProvider } from "./providers/registry";

// ── Helper: get a valid access token for a workspace's integration ──

type ProviderId = "google_drive" | "github" | "google";

async function getAccessToken(workspaceId: string, providerId: ProviderId): Promise<string | null> {
  const provider = getProvider(providerId);
  if (!provider) return null;

  const integration = await getIntegrationByProvider(workspaceId, providerId);
  if (!integration) return null;

  const token = await getValidAccessToken(integration, provider);
  if (token) {
    touchLastUsed(integration.id).catch(() => {});
  }
  return token;
}

// ═══════════════════════════════════════════════════════════
// GOOGLE DRIVE
// ═══════════════════════════════════════════════════════════

export async function googleDriveSearch(workspaceId: string, query: string) {
  const token = await getAccessToken(workspaceId, "google_drive");
  if (!token) throw new Error("Google Workspace is not connected");

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=10&fields=files(id,name,mimeType,webViewLink,modifiedTime,size)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) throw new Error(`Google Drive search failed: ${resp.status}`);
  const data = await resp.json();
  return (data.files || []).map((f: Record<string, unknown>) => ({
    id: f.id,
    name: f.name,
    type: f.mimeType,
    url: f.webViewLink,
    modifiedAt: f.modifiedTime,
    size: f.size,
  }));
}

export async function googleDriveRead(workspaceId: string, fileId: string) {
  const token = await getAccessToken(workspaceId, "google_drive");
  if (!token) throw new Error("Google Workspace is not connected");

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) throw new Error(`Google Drive read failed: ${resp.status}`);
  return { content: await resp.text(), contentType: resp.headers.get("content-type") };
}

export async function googleDriveExportDoc(workspaceId: string, fileId: string) {
  const token = await getAccessToken(workspaceId, "google_drive");
  if (!token) throw new Error("Google Workspace is not connected");

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/html`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) throw new Error(`Google Doc export failed: ${resp.status}`);
  const html = await resp.text();
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return { content: text, html };
}

export async function googleDriveExportSheet(workspaceId: string, fileId: string) {
  const token = await getAccessToken(workspaceId, "google_drive");
  if (!token) throw new Error("Google Workspace is not connected");

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) throw new Error(`Google Sheet export failed: ${resp.status}`);
  const csv = await resp.text();
  return { content: csv };
}

export async function googleDriveListFiles(workspaceId: string, pageSize = 20) {
  const token = await getAccessToken(workspaceId, "google_drive");
  if (!token) throw new Error("Google Workspace is not connected");

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&fields=files(id,name,mimeType,webViewLink,modifiedTime)&orderBy=modifiedTime desc`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) throw new Error(`Google Drive list failed: ${resp.status}`);
  const data = await resp.json();
  return (data.files || []).map((f: Record<string, unknown>) => ({
    id: f.id,
    name: f.name,
    type: f.mimeType,
    url: f.webViewLink,
    modifiedAt: f.modifiedTime,
  }));
}

// ═══════════════════════════════════════════════════════════
// GITHUB
// ═══════════════════════════════════════════════════════════

export async function githubListRepos(workspaceId: string) {
  const token = await getAccessToken(workspaceId, "github");
  if (!token) throw new Error("GitHub is not connected");

  const resp = await fetch("https://api.github.com/user/repos?sort=updated&per_page=20", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!resp.ok) throw new Error(`GitHub list repos failed: ${resp.status}`);
  return (await resp.json()).map((r: Record<string, unknown>) => ({
    id: r.id,
    name: r.full_name,
    description: r.description,
    url: r.html_url,
    language: r.language,
    stars: r.stargazers_count,
    updatedAt: r.updated_at,
  }));
}

export async function githubReadFile(workspaceId: string, owner: string, repo: string, path: string) {
  const token = await getAccessToken(workspaceId, "github");
  if (!token) throw new Error("GitHub is not connected");

  const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3.raw",
    },
  });

  if (!resp.ok) throw new Error(`GitHub read file failed: ${resp.status}`);
  return { content: await resp.text() };
}

export async function githubListIssues(workspaceId: string, owner: string, repo: string, state = "open") {
  const token = await getAccessToken(workspaceId, "github");
  if (!token) throw new Error("GitHub is not connected");

  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=20`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!resp.ok) throw new Error(`GitHub list issues failed: ${resp.status}`);
  return (await resp.json()).map((i: Record<string, unknown>) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    url: i.html_url,
    labels: ((i.labels || []) as Array<Record<string, unknown>>).map((l) => l.name),
    createdAt: i.created_at,
    body: ((i.body as string) || "").slice(0, 500),
  }));
}

export async function githubSearchCode(workspaceId: string, query: string) {
  const token = await getAccessToken(workspaceId, "github");
  if (!token) throw new Error("GitHub is not connected");

  const resp = await fetch(
    `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=10`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!resp.ok) throw new Error(`GitHub search code failed: ${resp.status}`);
  const data = await resp.json();
  return (data.items || []).map((i: Record<string, unknown>) => ({
    name: i.name,
    path: i.path,
    repository: (i.repository as Record<string, unknown>)?.full_name,
    url: i.html_url,
  }));
}

// ═══════════════════════════════════════════════════════════
// GMAIL
// ═══════════════════════════════════════════════════════════

export async function gmailSendEmail(workspaceId: string, to: string, subject: string, body: string) {
  const token = await getAccessToken(workspaceId, "google_drive");
  if (!token) throw new Error("Google Workspace is not connected");

  // Construct raw mime format
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const messageParts = [
    `To: ${to}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${utf8Subject}`,
    "",
    body,
  ];
  const message = messageParts.join("\n");
  const base64SafeMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const resp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64SafeMessage }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gmail send failed: ${resp.status} - ${errText}`);
  }
  return await resp.json();
}

export async function gmailListMessages(workspaceId: string, maxResults = 10, query?: string) {
  const token = await getAccessToken(workspaceId, "google_drive");
  if (!token) throw new Error("Google Workspace is not connected");

  const qParam = query ? `&q=${encodeURIComponent(query)}` : "";
  const resp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${qParam}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) throw new Error(`Gmail list messages failed: ${resp.status}`);
  const data = await resp.json();
  const messages = data.messages || [];
  
  // Fetch details for each message
  const details = await Promise.all(
    messages.map(async (msg: { id: string }) => {
      try {
        const detailResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!detailResp.ok) return null;
        const detailData = await detailResp.json();
        
        const headers = detailData.payload?.headers || [];
        const subject = headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value || "No Subject";
        const from = headers.find((h: any) => h.name?.toLowerCase() === "from")?.value || "Unknown Sender";
        const date = headers.find((h: any) => h.name?.toLowerCase() === "date")?.value || "";
        const snippet = detailData.snippet || "";
        
        return { id: msg.id, subject, from, date, snippet };
      } catch {
        return null;
      }
    })
  );
  
  return details.filter((m): m is Exclude<typeof m, null> => m !== null);
}
