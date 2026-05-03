import { getValidAccessToken, touchLastUsed, markIntegrationError, getIntegrationByProvider } from "./store";
import { getProvider } from "./providers/registry";
import type { OAuthProviderConfig } from "./providers/registry";

// ── Helper: get a valid access token for a workspace's integration ──

type ProviderId = "google_drive" | "github" | "notion" | "linear" | "hubspot";

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
  if (!token) throw new Error("Google Drive is not connected");

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
  if (!token) throw new Error("Google Drive is not connected");

  // Export as plain text or PDF depending on mime type
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) throw new Error(`Google Drive read failed: ${resp.status}`);
  return { content: await resp.text(), contentType: resp.headers.get("content-type") };
}

export async function googleDriveExportDoc(workspaceId: string, fileId: string) {
  const token = await getAccessToken(workspaceId, "google_drive");
  if (!token) throw new Error("Google Drive is not connected");

  // Export Google Doc as HTML
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/html`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) throw new Error(`Google Doc export failed: ${resp.status}`);
  const html = await resp.text();
  // Strip HTML tags for plain text
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return { content: text, html };
}

export async function googleDriveExportSheet(workspaceId: string, fileId: string) {
  const token = await getAccessToken(workspaceId, "google_drive");
  if (!token) throw new Error("Google Drive is not connected");

  // Export Google Sheet as CSV
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
  if (!token) throw new Error("Google Drive is not connected");

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
// NOTION
// ═══════════════════════════════════════════════════════════

export async function notionSearch(workspaceId: string, query: string) {
  const token = await getAccessToken(workspaceId, "notion");
  if (!token) throw new Error("Notion is not connected");

  const resp = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, page_size: 10 }),
  });

  if (!resp.ok) throw new Error(`Notion search failed: ${resp.status}`);
  const data = await resp.json();
  return (data.results || []).map((r: Record<string, unknown>) => ({
    id: r.id,
    type: r.object,
    title: extractNotionTitle(r),
    url: r.url,
    lastEdited: r.last_edited_time,
  }));
}

export async function notionReadPage(workspaceId: string, pageId: string) {
  const token = await getAccessToken(workspaceId, "notion");
  if (!token) throw new Error("Notion is not connected");

  // Get page properties
  const pageResp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
    },
  });

  if (!pageResp.ok) throw new Error(`Notion read page failed: ${pageResp.status}`);
  const pageData = await pageResp.json();

  // Get page content (blocks)
  const blocksResp = await fetch(
    `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    }
  );

  if (!blocksResp.ok) throw new Error(`Notion read blocks failed: ${blocksResp.status}`);
  const blocksData = await blocksResp.json();

  // Convert blocks to plain text
  const content = blocksToPlainText(blocksData.results || []);

  return {
    title: extractNotionTitle(pageData),
    content,
    url: pageData.url,
    properties: pageData.properties,
  };
}

export async function notionListPages(workspaceId: string, pageSize = 20) {
  const token = await getAccessToken(workspaceId, "notion");
  if (!token) throw new Error("Notion is not connected");

  const resp = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filter: { value: "page", property: "object" }, page_size: pageSize }),
  });

  if (!resp.ok) throw new Error(`Notion list pages failed: ${resp.status}`);
  const data = await resp.json();
  return (data.results || []).map((r: Record<string, unknown>) => ({
    id: r.id,
    title: extractNotionTitle(r),
    url: r.url,
    lastEdited: r.last_edited_time,
    createdTime: r.created_time,
  }));
}

function extractNotionTitle(page: Record<string, unknown>): string {
  const props = page.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return "Untitled";
  for (const prop of Object.values(props)) {
    if (prop.type === "title") {
      const titleArr = (prop.title as Array<Record<string, unknown>>) || [];
      return titleArr.map((t) => t.plain_text).join("") || "Untitled";
    }
  }
  return "Untitled";
}

function blocksToPlainText(blocks: Record<string, unknown>[]): string {
  return blocks
    .map((block) => {
      const type = block.type as string;
      const richTexts = (block[type] as Record<string, unknown>)?.text as
        | Array<Record<string, unknown>>
        | undefined;
      if (!richTexts) return "";
      return richTexts.map((rt) => rt.plain_text).join("");
    })
    .join("\n");
}

// ═══════════════════════════════════════════════════════════
// LINEAR (GraphQL)
// ═══════════════════════════════════════════════════════════

async function linearQuery(workspaceId: string, query: string, variables?: Record<string, unknown>) {
  const token = await getAccessToken(workspaceId, "linear");
  if (!token) throw new Error("Linear is not connected");

  const resp = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!resp.ok) throw new Error(`Linear query failed: ${resp.status}`);
  return resp.json();
}

export async function linearListIssues(workspaceId: string, first = 20) {
  const data = await linearQuery(
    workspaceId,
    `query ($first: Int) {
      issues(first: $first, orderBy: updatedAt) {
        nodes {
          id
          title
          state { name }
          priority
          assignee { name }
          url
          createdAt
          description
        }
      }
    }`,
    { first }
  );
  return (data.data?.issues?.nodes || []).map((i: Record<string, unknown>) => ({
    id: i.id,
    title: i.title,
    state: (i.state as Record<string, unknown>)?.name,
    priority: i.priority,
    assignee: (i.assignee as Record<string, unknown>)?.name,
    url: i.url,
    createdAt: i.createdAt,
  }));
}

export async function linearSearch(workspaceId: string, query: string) {
  const data = await linearQuery(
    workspaceId,
    `query ($query: String!) {
      issueSearch(query: $query, first: 10) {
        nodes {
          id
          title
          state { name }
          url
        }
      }
    }`,
    { query }
  );
  return (data.data?.issueSearch?.nodes || []).map((i: Record<string, unknown>) => ({
    id: i.id,
    title: i.title,
    state: (i.state as Record<string, unknown>)?.name,
    url: i.url,
  }));
}

export async function linearListTeams(workspaceId: string) {
  const data = await linearQuery(
    workspaceId,
    `query {
      teams {
        nodes { id name key }
      }
    }`
  );
  return (data.data?.teams?.nodes || []).map((t: Record<string, unknown>) => ({
    id: t.id,
    name: t.name,
    key: t.key,
  }));
}

// ═══════════════════════════════════════════════════════════
// HUBSPOT
// ═══════════════════════════════════════════════════════════

async function hubspotRequest(workspaceId: string, path: string, options?: RequestInit) {
  const token = await getAccessToken(workspaceId, "hubspot");
  if (!token) throw new Error("HubSpot is not connected");

  const resp = await fetch(`https://api.hubapi.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`HubSpot API error (${resp.status}): ${error}`);
  }
  return resp.json();
}

export async function hubspotListContacts(workspaceId: string, limit = 20) {
  const data = await hubspotRequest(
    workspaceId,
    `/crm/v3/objects/contacts?limit=${limit}&properties=firstname,lastname,email,phone,company`
  );
  return (data.results || []).map((c: Record<string, unknown>) => {
    const props = c.properties as Record<string, unknown> | undefined;
    return {
      id: c.id,
      firstName: props?.firstname,
      lastName: props?.lastname,
      email: props?.email,
      phone: props?.phone,
      company: props?.company,
      createdAt: c.createdAt,
    };
  });
}

export async function hubspotSearchContacts(workspaceId: string, query: string) {
  const data = await hubspotRequest(workspaceId, "/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: "email", operator: "CONTAINS_TOKEN", value: query },
            { propertyName: "firstname", operator: "CONTAINS_TOKEN", value: query },
            { propertyName: "lastname", operator: "CONTAINS_TOKEN", value: query },
          ],
        },
      ],
      properties: ["firstname", "lastname", "email", "phone", "company"],
    }),
  });
  return (data.results || []).map((c: Record<string, unknown>) => {
    const props = c.properties as Record<string, unknown> | undefined;
    return {
      id: c.id,
      firstName: props?.firstname,
      lastName: props?.lastname,
      email: props?.email,
      phone: props?.phone,
      company: props?.company,
    };
  });
}

export async function hubspotListDeals(workspaceId: string, limit = 20) {
  const data = await hubspotRequest(
    workspaceId,
    `/crm/v3/objects/deals?limit=${limit}&properties=dealname,amount,dealstage,pipeline,closedate`
  );
  return (data.results || []).map((d: Record<string, unknown>) => {
    const props = d.properties as Record<string, unknown> | undefined;
    return {
      id: d.id,
      name: props?.dealname,
      amount: props?.amount,
      stage: props?.dealstage,
      pipeline: props?.pipeline,
      closeDate: props?.closedate,
      createdAt: d.createdAt,
    };
  });
}

export async function hubspotListCompanies(workspaceId: string, limit = 20) {
  const data = await hubspotRequest(
    workspaceId,
    `/crm/v3/objects/companies?limit=${limit}&properties=name,domain,industry,numberofemployees`
  );
  return (data.results || []).map((c: Record<string, unknown>) => {
    const props = c.properties as Record<string, unknown> | undefined;
    return {
      id: c.id,
      name: props?.name,
      domain: props?.domain,
      industry: props?.industry,
      employees: props?.numberofemployees,
    };
  });
}
