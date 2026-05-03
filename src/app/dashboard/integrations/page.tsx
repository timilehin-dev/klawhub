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
} from "lucide-react";
import { useState, useCallback } from "react";

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
    id: "google_drive",
    name: "Google Workspace",
    description: "Access Google Drive, Docs, and Sheets. Klawhub can search, read, and export files from your workspace.",
    icon: FolderOpen,
    color: "text-blue-600",
    bg: "bg-blue-50",
    borderColor: "border-blue-200",
    required: false,
    scopes: ["Drive (read)", "Docs (read/write)", "Sheets (read/write)"],
    setupGuide: "Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID. Enable Google Drive API, Docs API, Sheets API.",
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

  if (loading) return null;

  const integrations = data?.integrations || [];

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

      {/* Setup Help */}
      <div className="rounded-xl border border-surface-200 bg-surface-50 p-6">
        <h3 className="font-semibold text-surface-900">Setup Help</h3>
        <div className="mt-4 space-y-4">
          <div>
            <h4 className="text-sm font-medium text-surface-900">Google Workspace</h4>
            <ol className="mt-1 space-y-1 text-sm text-surface-700 list-decimal list-inside">
              <li>Go to <span className="font-mono text-xs bg-surface-200 px-1 rounded">Google Cloud Console</span> → APIs & Services → Credentials</li>
              <li>Create an OAuth 2.0 Client ID (Web application)</li>
              <li>Add redirect URI: <code className="text-xs bg-surface-200 px-1 rounded">{typeof window !== "undefined" ? `${window.location.origin}/api/integrations/callback/google_drive` : "/api/integrations/callback/google_drive"}</code></li>
              <li>Enable Google Drive API, Docs API, and Sheets API</li>
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
        </div>
      </div>
    </div>
  );
}
