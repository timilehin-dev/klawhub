"use client";

import { useDashboard } from "../layout";
import {
  Plug,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Shield,
  FolderOpen,
  GitBranch,
  Hash,
  Cloud,
  FileText,
  Target,
  Layers,
  LifeBuoy,
  PlusCircle,
  Trash2,
  Plus,
  Globe,
} from "lucide-react";
import { useState, useCallback } from "react";
import Script from "next/script";
import { McpConnectionModal } from "./McpConnectionModal";

interface Integration {
  id: string;
  provider: string;
  status: string;
  externalAccountName: string | null;
  externalAccountEmail: string | null;
  scope: string | null;
  lastUsedAt: string | null;
  createdAt: string | null;
}

interface McpServer {
  id: string;
  name: string;
  url: string;
  status: string;
  createdAt: string;
}

// ── Provider display config ──

interface ProviderDisplay {
  id: string;
  name: string;
  description: string;
  icon: typeof Plug;
  color: string;
  bg: string;
  borderColor: string;
  required: boolean;
  scopes: string[];
  setupGuide: string;
}

const AVAILABLE_PROVIDERS: ProviderDisplay[] = [
  {
    id: "google",
    name: "Google Workspace",
    description: "Access Google Drive, Docs, Sheets, Gmail, and Calendar. Klawhub can search files, send emails, and manage your schedule.",
    icon: FolderOpen,
    color: "text-blue-600",
    bg: "bg-blue-50",
    borderColor: "border-blue-200",
    required: false,
    scopes: ["Drive", "Docs", "Sheets", "Gmail (Send/Read)", "Calendar"],
    setupGuide: "Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID. Enable Drive, Docs, Sheets, Gmail, and Calendar APIs.",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Access repositories, issues, and code search. Klawhub can list repos, read files, search code, and manage issues.",
    icon: GitBranch,
    color: "text-surface-900",
    bg: "bg-surface-100",
    borderColor: "border-surface-300",
    required: false,
    scopes: ["Repositories", "Issues & Pull Requests", "Code search", "Organization read"],
    setupGuide: "GitHub Settings → Developer settings → OAuth Apps → New OAuth App.",
  },
];

const FEATURED_MCP_SERVICES = [
  {
    id: "notion",
    name: "Notion",
    description: "Sync your Notion workspaces. Klawhub can read pages, search databases, and append notes to your docs.",
    icon: FileText,
    url: "https://mcp.klawhub.xyz/notion/sse",
    color: "text-zinc-900",
    bg: "bg-zinc-100",
    borderColor: "border-zinc-300",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description: "Connect your CRM. Klawhub can manage opportunities, leads, and accounts to help you close deals faster.",
    icon: Cloud,
    url: "https://mcp.klawhub.xyz/salesforce/sse",
    color: "text-sky-500",
    bg: "bg-sky-50",
    borderColor: "border-sky-200",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Manage your marketing and sales pipelines. Klawhub can track contacts, deals, and company data.",
    icon: Target,
    url: "https://mcp.klawhub.xyz/hubspot/sse",
    color: "text-orange-500",
    bg: "bg-orange-50",
    borderColor: "border-orange-200",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Steamline your project management. Klawhub can create issues, update statuses, and track project velocity.",
    icon: Layers,
    url: "https://mcp.klawhub.xyz/linear/sse",
    color: "text-indigo-600",
    bg: "bg-indigo-50",
    borderColor: "border-indigo-200",
  },
  {
    id: "jira",
    name: "Jira",
    description: "Manage your Atlassian workspace. Klawhub can search issues, update tickets, and track sprints.",
    icon: LifeBuoy,
    url: "https://mcp.klawhub.xyz/jira/sse",
    color: "text-blue-600",
    bg: "bg-blue-50",
    borderColor: "border-blue-200",
  },
];

function IntegrationCard({
  provider,
  connected,
  onConnect,
  onDisconnect,
  connecting,
  disconnecting,
}: {
  provider: ProviderDisplay;
  connected: Integration | null;
  onConnect: (providerId: string) => void;
  onDisconnect: (integrationId: string) => void;
  connecting: boolean;
  disconnecting: boolean;
}) {
  const isConnected = !!connected;
  const ProviderIcon = provider.icon;

  return (
    <div
      className={`rounded-xl border bg-white p-6 transition-all ${
        isConnected ? "border-emerald-200" : provider.borderColor
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`inline-flex h-11 w-11 items-center justify-center rounded-lg ${provider.bg}`}
          >
            <ProviderIcon size={22} className={provider.color} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-surface-900">{provider.name}</h3>
              {isConnected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 size={12} />
                  Connected
                </span>
              )}
              {!isConnected && !provider.required && (
                <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs font-medium text-surface-500">
                  Optional
                </span>
              )}
              {provider.required && !isConnected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                  Required
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-surface-500">{provider.description}</p>
          </div>
        </div>
      </div>

      {/* Connected info */}
      {isConnected && connected && (
        <div className="mt-4 rounded-lg bg-surface-50 p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-surface-500">Account</p>
              <p className="text-sm font-medium text-surface-900">
                {connected.externalAccountName || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-surface-500">Email</p>
              <p className="text-sm font-medium text-surface-900">
                {connected.externalAccountEmail || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-surface-500">Status</p>
              <p className="text-sm font-medium text-emerald-600">
                {connected.status === "active" ? "Active" : connected.status}
              </p>
            </div>
            <div>
              <p className="text-xs text-surface-500">Last Used</p>
              <p className="text-sm font-medium text-surface-900">
                {connected.lastUsedAt
                  ? new Date(connected.lastUsedAt).toLocaleDateString()
                  : "Not used yet"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Scopes */}
      <div className="mt-4">
        <p className="text-xs font-medium text-surface-500 mb-1.5">Permissions</p>
        <div className="flex flex-wrap gap-1.5">
          {provider.scopes.map((scope) => (
            <span
              key={scope}
              className="inline-flex items-center gap-1 rounded-md bg-surface-100 px-2 py-1 text-xs text-surface-700"
            >
              <Shield size={10} />
              {scope}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-5 flex items-center justify-between border-t border-surface-100 pt-4">
        {isConnected ? (
          <div className="flex items-center gap-3">
            <button
              onClick={() => onDisconnect(connected!.id)}
              disabled={disconnecting}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-50 disabled:opacity-50"
            >
              {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
              Disconnect
            </button>
            <button
              onClick={() => onConnect(provider.id)}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-lg border border-surface-200 px-4 py-2 text-sm font-medium text-surface-700 transition-all hover:bg-surface-50 disabled:opacity-50"
            >
              {connecting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Reconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => onConnect(provider.id)}
            disabled={connecting}
            className="inline-flex items-center gap-2 rounded-lg gradient-bg px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:brightness-110 disabled:opacity-50"
          >
            {connecting ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
            Connect {provider.name}
          </button>
        )}
        {!isConnected && (
          <p className="text-xs text-surface-400 max-w-[280px] text-right">
            {provider.setupGuide}
          </p>
        )}
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const { data, loading, refresh } = useDashboard();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMcpService, setSelectedMcpService] = useState<typeof FEATURED_MCP_SERVICES[0] | null>(null);
  const [isManualMcpModalOpen, setIsManualMcpModalOpen] = useState(false);

  const handleConnectMcp = useCallback(
    async (service: typeof FEATURED_MCP_SERVICES[0]) => {
      setConnecting(service.id);
      setError(null);
      try {
        const oauthProviders = ["notion", "salesforce", "hubspot", "linear", "jira"];
        if (oauthProviders.includes(service.id)) {
          const res = await fetch(`/api/integrations/connect/${service.id}?workspaceId=${data?.workspace?.id}`);
          const json = await res.json();
          
          if (!res.ok) {
            setError(json.error || `Failed to connect to ${service.name}`);
            return;
          }

          if (json.authUrl) {
            window.location.href = json.authUrl;
            return;
          } else {
            setError("No authorization URL returned from server");
          }
        } else {
          setSelectedMcpService(service);
        }
      } catch {
        setError("Network error — please try again");
      } finally {
        setConnecting(null);
      }
    },
    [data?.workspace?.id]
  );

  const handleConnect = useCallback(
    async (providerId: string) => {
      if (!data?.workspace?.id) return;

      setConnecting(providerId);
      setError(null);

      try {
        const res = await fetch(
          `/api/integrations/connect/${providerId}?workspaceId=${data.workspace.id}`
        );
        const json = await res.json();

        if (!res.ok) {
          setError(json.error || `Failed to initiate ${providerId} connection`);
          return;
        }

        // Redirect to provider OAuth
        window.location.href = json.authUrl;
      } catch {
        setError("Network error — please try again");
      } finally {
        setConnecting(null);
      }
    },
    [data?.workspace?.id]
  );

  const handleDisconnect = useCallback(
    async (integrationId: string) => {
      setDisconnecting(integrationId);
      setError(null);

      try {
        const res = await fetch(
          `/api/integrations/manage?integrationId=${integrationId}`,
          { method: "DELETE" }
        );

        if (!res.ok) {
          const json = await res.json();
          setError(json.error || "Failed to disconnect");
          return;
        }

        refresh();
      } catch {
        setError("Network error — please try again");
      } finally {
        setDisconnecting(null);
      }
    },
    [refresh]
  );

  const handleDisconnectMcp = useCallback(
    async (serverId: string) => {
      setDisconnecting(serverId);
      setError(null);

      try {
        const res = await fetch(`/api/mcp/connect?id=${serverId}`, { method: "DELETE" });

        if (!res.ok) {
          const json = await res.json();
          setError(json.error || "Failed to disconnect");
          return;
        }

        refresh();
      } catch {
        setError("Network error — please try again");
      } finally {
        setDisconnecting(null);
      }
    },
    [refresh]
  );

  if (loading) return null;

  const integrations = data?.integrations || [];
  const mcpServers = (data as any)?.mcpServers || [];
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900">Integrations</h1>
        <p className="mt-1 text-sm text-surface-700">
          Connect external tools to give Klawhub access to more context.
          Slack is always connected — everything else is optional.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <XCircle size={18} className="mt-0.5 text-red-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900">Connection Error</p>
            <p className="mt-0.5 text-sm text-red-700">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* Slack (always connected) */}
      <div className="rounded-xl border border-emerald-200 bg-white p-6">
        <div className="flex items-start gap-4">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-purple-50">
            <Hash size={22} className="text-purple-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-surface-900">Slack</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 size={12} />
                Connected
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                Required
              </span>
            </div>
            <p className="mt-1 text-sm text-surface-700">
              Klawhub lives in your Slack workspace. It receives messages via mentions and slash commands,
              and posts responses back to threads. This is the core integration that powers everything.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-100 px-2 py-1 text-xs text-surface-700">
                <Shield size={10} /> Chat messages
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-100 px-2 py-1 text-xs text-surface-700">
                <Shield size={10} /> Channel access
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-100 px-2 py-1 text-xs text-surface-700">
                <Shield size={10} /> File uploads
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-100 px-2 py-1 text-xs text-surface-700">
                <Shield size={10} /> Slash commands
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-100 px-2 py-1 text-xs text-surface-700">
                <Shield size={10} /> User profiles
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Optional Integrations */}
      <div>
        <h2 className="text-lg font-semibold text-surface-900">Optional Connections</h2>
        <p className="mt-1 text-sm text-surface-700">
          These give Klawhub additional context from your tools. Configure the ones you need.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {AVAILABLE_PROVIDERS.map((provider) => (
          <IntegrationCard
            key={provider.id}
            provider={provider}
            connected={integrations.find((i) => i.provider === provider.id) || null}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            connecting={connecting === provider.id}
            disconnecting={disconnecting === (integrations.find((i) => i.provider === provider.id)?.id || "")}
          />
        ))}
      </div>

      {/* Featured MCP Connections */}
      <div className="pt-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-surface-900 text-premium-gradient">Featured Managed Connections</h2>
            <p className="mt-1 text-sm text-surface-700">
              One-click setup for common enterprise tools via secure MCP integration.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURED_MCP_SERVICES.map((service) => {
            const isConnected = mcpServers.some((s: McpServer) => s.name.toLowerCase() === service.name.toLowerCase());
            const connectedServer = mcpServers.find((s: McpServer) => s.name.toLowerCase() === service.name.toLowerCase());
            const ServiceIcon = service.icon;

            return (
              <div key={service.id} className={`group relative rounded-2xl border p-5 transition-all duration-300 ${isConnected ? 'border-emerald-200 bg-emerald-50/30' : 'border-surface-200 bg-white hover:border-brand-300 hover:shadow-xl hover:shadow-brand-500/5 hover:-translate-y-1'}`}>
                <div className="flex items-start justify-between">
                  <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl shadow-sm transition-transform group-hover:scale-110 ${service.bg}`}>
                    <ServiceIcon size={24} className={service.color} />
                  </div>
                  {isConnected ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                      <CheckCircle2 size={12} />
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-surface-500">
                      Available
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <h3 className="font-bold text-surface-900 group-hover:text-brand-600 transition-colors">{service.name}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-surface-600">
                    {service.description}
                  </p>
                </div>

                <div className="mt-6 flex items-center justify-between gap-3">
                  {isConnected ? (
                    <button
                      onClick={() => handleDisconnectMcp(connectedServer!.id)}
                      disabled={disconnecting === connectedServer!.id}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-xs font-bold text-red-600 transition-all hover:bg-red-50 hover:border-red-300 active:scale-95 disabled:opacity-50"
                    >
                      {disconnecting === connectedServer!.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnectMcp(service)}
                      disabled={connecting === service.id}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl gradient-bg px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-brand-500/10 transition-all hover:shadow-xl hover:brightness-110 active:scale-95 disabled:opacity-50"
                    >
                      {connecting === service.id ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
                      Connect Now
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom MCP Servers */}
      <div className="mt-8 rounded-2xl border border-dashed border-surface-300 p-8 text-center bg-surface-50/30">
        <Globe size={32} className="mx-auto text-surface-400 mb-4" />
        <h3 className="text-lg font-semibold text-surface-900">Have a custom MCP server?</h3>
        <p className="mt-1 text-sm text-surface-600 max-w-md mx-auto mb-6">
          Connect to any private or self-hosted MCP server by providing its SSE endpoint URL manually.
        </p>
        <button
          onClick={() => setIsManualMcpModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-surface-900 px-6 py-2.5 text-xs font-bold text-white shadow-lg transition-all hover:bg-surface-800 active:scale-95"
        >
          <Plus size={16} />
          Connect Custom Server
        </button>
      </div>

      {/* MCP Connection Modal (Custom/Manual) */}
      {isManualMcpModalOpen && data?.workspace && (
        <McpConnectionModal
          workspaceId={data.workspace.id}
          onClose={() => setIsManualMcpModalOpen(false)}
          onSuccess={() => {
            refresh();
            setError(null);
          }}
        />
      )}

      {/* MCP Connection Modal (Specific Service - if needed as fallback) */}
      {selectedMcpService && data?.workspace && (
        <McpConnectionModal
          service={selectedMcpService}
          workspaceId={data.workspace.id}
          onClose={() => setSelectedMcpService(null)}
          onSuccess={() => {
            refresh();
            setError(null);
          }}
        />
      )}

      {/* Setup Help */}
      <div className="rounded-xl border border-surface-200 bg-surface-50 p-6">
        <h3 className="font-semibold text-surface-900">Setup Help</h3>
        <div className="mt-4 space-y-4">
          <div>
            <h4 className="text-sm font-medium text-surface-900">Google Workspace</h4>
            <ol className="mt-1 space-y-1 text-sm text-surface-700 list-decimal list-inside">
              <li>Go to <span className="font-mono text-xs bg-surface-200 px-1 rounded">Google Cloud Console</span> → APIs & Services → Credentials</li>
              <li>Create an OAuth 2.0 Client ID (Web application)</li>
              <li>Add redirect URI: <code className="text-xs bg-surface-200 px-1 rounded">{typeof window !== "undefined" ? `${window.location.origin}/api/integrations/callback/google` : "/api/integrations/callback/google"}</code></li>
              <li>Enable Drive, Docs, Sheets, Gmail, and Calendar APIs</li>
              <li>Set <code className="text-xs bg-surface-200 px-1 rounded">GOOGLE_CLIENT_ID</code> and <code className="text-xs bg-surface-200 px-1 rounded">GOOGLE_CLIENT_SECRET</code> in Vercel env</li>
            </ol>
          </div>
          <div>
            <h4 className="text-sm font-medium text-surface-900">GitHub</h4>
            <ol className="mt-1 space-y-1 text-sm text-surface-700 list-decimal list-inside">
              <li>Go to <span className="font-mono text-xs bg-surface-200 px-1 rounded">GitHub Settings</span> → Developer settings → OAuth Apps → New OAuth App</li>
              <li>Set Authorization callback URL: <code className="text-xs bg-surface-200 px-1 rounded">{typeof window !== "undefined" ? `${window.location.origin}/api/integrations/callback/github` : "/api/integrations/callback/github"}</code></li>
              <li>Set <code className="text-xs bg-surface-200 px-1 rounded">GITHUB_CLIENT_ID</code> and <code className="text-xs bg-surface-200 px-1 rounded">GITHUB_CLIENT_SECRET</code> in Vercel env</li>
            </ol>
          </div>
          <div>
            <h4 className="text-sm font-medium text-brand-600">Enterprise Tools (One-Key Mode)</h4>
            <p className="mt-1 text-sm text-surface-600">
              Klawhub uses <strong>Composio</strong> to provide a zero-config setup for enterprise tools like Notion, Salesforce, HubSpot, Linear, and Jira.
            </p>
            <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/50 p-3">
              <p className="text-xs text-brand-800 leading-relaxed">
                <strong>How to setup:</strong> Just add <code className="text-[10px] bg-brand-100 px-1 rounded">COMPOSIO_API_KEY</code> to your environment. 
                Once set, you can connect any of the featured services with a single click. Klawhub will automatically handle the OAuth flow and MCP tool bridge.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
