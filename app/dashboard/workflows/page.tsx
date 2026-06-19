"use client";

import React, { useState, useEffect } from "react";
import { 
  GitFork, GitMerge, Plus, Trash2, Play, 
  Settings, CheckCircle, Info, Edit3 
} from "lucide-react";
import { useAuth } from "../auth-provider";
import { apiFetch } from "@/lib/supabase";

interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger_type: string;
  trigger_config: any;
  steps: any;
  is_active: boolean;
}

export default function WorkflowsDesigner() {
  const { workspaceId } = useAuth();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  
  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState("slack_event");
  const [stepsInput, setStepsInput] = useState(
    '[\n  {"action": "search_web", "query": "latest news about generative AI"},\n  {"action": "compile_report", "format": "pdf"},\n  {"action": "slack_alert", "text": "Report generated successfully!"}\n]'
  );
  const [errorMsg, setErrorMsg] = useState("");

  const fetchWorkflows = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await apiFetch<Workflow[]>(`/api/dashboard/workflows?workspace_id=${encodeURIComponent(workspaceId)}`);
      setWorkflows(data);
    } catch (e) {
      console.log("Error loading workflows:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    
    if (!name) {
      setErrorMsg("Workflow Name is required.");
      return;
    }

    try {
      // Validate steps JSON
      const parsedSteps = JSON.parse(stepsInput);
      
      await apiFetch(`/api/dashboard/workflows?workspace_id=${encodeURIComponent(workspaceId || "")}`, {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          trigger_type: triggerType,
          trigger_config: { filter: "all" },
          steps: parsedSteps,
          is_active: true,
        }),
      });

      setShowForm(false);
      setName("");
      setDescription("");
      setStepsInput(
        '[\n  {"action": "search_web", "query": "latest news about generative AI"},\n  {"action": "compile_report", "format": "pdf"},\n  {"action": "slack_alert", "text": "Report generated successfully!"}\n]'
      );
      fetchWorkflows();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save workflow. Check if Steps JSON is valid.");
    }
  };

  const handleTrigger = async (id: string) => {
    if (!workspaceId) {
      console.log("Trigger failed: no workspace");
      return;
    }
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "workflow_trigger",
          workflow_id: id,
          workspace_id: workspaceId,
        })
      });
      alert("Workflow execution triggered asynchronously via Inngest step functions!");
    } catch (e) {
      console.log("Trigger failed:", e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this automation?")) return;
    try {
      await apiFetch(`/api/dashboard/workflows/${id}?workspace_id=${encodeURIComponent(workspaceId || "")}`, {
        method: "DELETE",
      });
      fetchWorkflows();
    } catch (e: any) {
      console.log("Delete failed:", e);
    }
  };

  useEffect(() => {
    if (workspaceId) fetchWorkflows();
  }, [workspaceId]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-wide">Automations & Workflows</h2>
          <p className="text-sm text-gray-400">Trigger multi-step agent actions based on Slack events, schedules, or webhooks.</p>
        </div>
        
        <button 
          onClick={() => setShowForm(!showForm)}
          className="px-5 py-3 rounded-xl bg-gradient-to-r from-sleekCyan to-neonPurple text-darkBg font-bold text-sm hover:opacity-95 shadow-[0_0_20px_rgba(0,229,255,0.2)] flex items-center gap-2"
        >
          <Plus className="w-4 h-4 text-darkBg" />
          Add Workflow
        </button>
      </div>

      {/* Add Workflow Form */}
      {showForm && (
        <form onSubmit={handleCreate} className="glass-panel p-6 rounded-2xl max-w-xl space-y-4">
          <h3 className="font-bold flex items-center gap-2 text-sleekCyan">
            <GitMerge className="w-4 h-4 text-sleekCyan" /> Create Automation Workflow
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Workflow Name *</label>
              <input 
                type="text" 
                placeholder="e.g. Generate Financial Report" 
                value={name} 
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
              />
            </div>
            
            <div>
              <label className="block text-xs text-gray-400 mb-1">Trigger Type *</label>
              <select 
                value={triggerType} 
                onChange={(e) => setTriggerType(e.target.value)}
                className="w-full bg-darkBg border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
              >
                <option value="slack_event">Slack Event (App Mention)</option>
                <option value="cron">Cron Schedule Trigger</option>
                <option value="webhook">REST Webhook Callback</option>
                <option value="manual">Manual Execution Only</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <input 
              type="text" 
              placeholder="e.g. Triggered daily to research financial metrics and generate a PDF." 
              value={description} 
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Sequential Steps Definition (JSON array) *</label>
            <textarea 
              value={stepsInput} 
              onChange={(e) => setStepsInput(e.target.value)}
              className="w-full bg-darkBg border border-glassBorder rounded-xl px-4 py-2 text-xs text-sleekCyan font-mono h-40 resize-none"
            />
          </div>

          {errorMsg && (
            <p className="text-xs text-red-400 font-medium">{errorMsg}</p>
          )}

          <div className="flex gap-4">
            <button 
              type="submit" 
              className="px-5 py-2.5 rounded-xl bg-sleekCyan text-darkBg font-semibold text-sm hover:opacity-90"
            >
              Save Workflow
            </button>
            <button 
              type="button" 
              onClick={() => setShowForm(false)}
              className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-medium border border-glassBorder"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Workflows List */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        {loading ? (
          <p className="text-sm text-gray-400">Loading workflows...</p>
        ) : workflows.length === 0 ? (
          <p className="text-sm text-gray-400">No automated workflows configured yet. Click Add Workflow to start designing.</p>
        ) : (
          <div className="divide-y divide-glassBorder/30">
            {workflows.map((item) => (
              <div key={item.id} className="py-4 first:pt-0 last:pb-0 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-base">{item.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-sleekCyan/10 border border-sleekCyan/20 text-sleekCyan font-mono">
                      {item.trigger_type}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{item.description}</p>
                </div>

                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => handleTrigger(item.id)}
                    className="px-3 py-1.5 rounded-lg bg-sleekCyan/10 border border-sleekCyan/20 text-sleekCyan hover:bg-sleekCyan/20 text-xs flex items-center gap-1.5 font-medium"
                  >
                    <Play className="w-3.5 h-3.5" /> Execute Run
                  </button>

                  <button 
                    onClick={() => handleDelete(item.id)}
                    className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
