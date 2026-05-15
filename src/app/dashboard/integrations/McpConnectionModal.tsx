"use client";

import { useState } from "react";
import { X, Loader2, ShieldCheck, AlertCircle, Globe } from "lucide-react";

interface McpService {
  id: string;
  name: string;
  description: string;
  icon: any;
  url: string;
  color: string;
  bg: string;
}

interface McpConnectionModalProps {
  service?: McpService;
  workspaceId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function McpConnectionModal({ service, workspaceId, onClose, onSuccess }: McpConnectionModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    const name = service?.name || manualName;
    const url = service?.url || manualUrl;

    if (!name.trim()) {
      setError("Please enter a server name");
      return;
    }
    if (!url.trim()) {
      setError("Please enter the SSE URL");
      return;
    }
    if (!apiKey.trim()) {
      setError("Please enter an API Key or Token");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/mcp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: name.trim(),
          url: url.trim(),
          apiKey: apiKey.trim(),
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Failed to connect service");
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-950/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-surface-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${service?.bg || 'bg-surface-100'}`}>
              {service ? <service.icon size={20} className={service.color} /> : <Globe size={20} className="text-surface-600" />}
            </div>
            <div>
              <h3 className="text-lg font-bold text-surface-900">{service ? `Connect ${service.name}` : 'Connect Custom MCP'}</h3>
              <p className="text-xs text-surface-500 truncate max-w-[200px]">{service?.url || 'Provide SSE endpoint details'}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-surface-400 hover:bg-surface-100 hover:text-surface-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {!service && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-surface-900 uppercase tracking-wider">Server Name</label>
                <input
                  placeholder="e.g. My Internal Tools"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="w-full rounded-xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm focus:border-brand-500 focus:outline-none transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-surface-900 uppercase tracking-wider">SSE URL</label>
                <input
                  placeholder="https://mcp.yourdomain.com/sse"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  className="w-full rounded-xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm focus:border-brand-500 focus:outline-none transition-all"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-surface-900 uppercase tracking-wider">
              API Key / Token
            </label>
            <input
              type="password"
              placeholder={`Enter the secret token...`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded-xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10 transition-all"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-100">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4 border border-emerald-100">
            <ShieldCheck size={24} className="text-emerald-600 shrink-0" />
            <p className="text-xs text-emerald-800 leading-normal">
              Your credentials are encrypted at rest and never shared. Klawhub uses them only to facilitate the MCP connection.
            </p>
          </div>

          <div className="pt-2 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-surface-200 py-3 text-sm font-semibold text-surface-700 hover:bg-surface-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConnect}
              disabled={loading}
              className="flex-[2] rounded-xl gradient-bg py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:brightness-110 disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Verifying...
                </span>
              ) : (
                "Connect Service"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
