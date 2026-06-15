"use client";

import React, { useState, useEffect } from "react";
import { 
  Calendar, Clock, Plus, Trash2, ToggleLeft, 
  ToggleRight, Info, Check, AlertTriangle 
} from "lucide-react";
import { useAuth } from "../auth-provider";
import { supabase } from "@/lib/supabase";

interface Schedule {
  id: string;
  name: string;
  schedule_type: string;
  cron_expr: string;
  channel_id: string;
  is_active: boolean;
  next_run_at?: string;
}

export default function SchedulesManager() {
  const { workspaceId } = useAuth();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  
  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState("cron");
  const [cron, setCron] = useState("");
  const [channel, setChannel] = useState("");
  const [text, setText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const fetchSchedules = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("schedules")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
        
      if (data) {
        setSchedules(data as Schedule[]);
      }
    } catch (e) {
      console.log("Error loading schedules:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    
    if (!name || !cron || !channel) {
      setErrorMsg("Please fill in all required fields.");
      return;
    }

    try {
      const payload = { text: text || "Schedule reminder" };
      const { data, error } = await supabase
        .from("schedules")
        .insert([{
          name,
          schedule_type: type,
          cron_expr: cron,
          channel_id: channel,
          payload,
          is_active: true,
          workspace_id: workspaceId,
        }])
        .select();

      if (error) throw error;

      setShowForm(false);
      setName("");
      setCron("");
      setChannel("");
      setText("");
      fetchSchedules();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save schedule.");
    }
  };

  const handleToggle = async (id: string, current: boolean) => {
    try {
      await supabase
        .from("schedules")
        .update({ is_active: !current })
        .eq("id", id);
      fetchSchedules();
    } catch (e) {
      console.log("Toggle failed:", e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;
    try {
      await supabase
        .from("schedules")
        .delete()
        .eq("id", id);
      fetchSchedules();
    } catch (e) {
      console.log("Delete failed:", e);
    }
  };

  useEffect(() => {
    if (workspaceId) fetchSchedules();
  }, [workspaceId]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-wide">Schedules & Crons</h2>
          <p className="text-sm text-gray-400">Workspace schedules, standups, reminders, and silence detector crons.</p>
        </div>
        
        <button 
          onClick={() => setShowForm(!showForm)}
          className="px-5 py-3 rounded-xl bg-gradient-to-r from-sleekCyan to-neonPurple text-darkBg font-bold text-sm hover:opacity-95 shadow-[0_0_20px_rgba(0,229,255,0.2)] flex items-center gap-2"
        >
          <Plus className="w-4 h-4 text-darkBg" />
          Add Schedule
        </button>
      </div>

      {/* Add Schedule Form */}
      {showForm && (
        <form onSubmit={handleCreate} className="glass-panel p-6 rounded-2xl max-w-xl space-y-4">
          <h3 className="font-bold flex items-center gap-2 text-sleekCyan">
            <Clock className="w-4 h-4 text-sleekCyan" /> Create Workspace Schedule
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Schedule Name *</label>
              <input 
                type="text" 
                placeholder="e.g. Daily Standup Check" 
                value={name} 
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
              />
            </div>
            
            <div>
              <label className="block text-xs text-gray-400 mb-1">Type *</label>
              <select 
                value={type} 
                onChange={(e) => setType(e.target.value)}
                className="w-full bg-darkBg border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
              >
                <option value="cron">Automation Cron</option>
                <option value="standup">Standup Call</option>
                <option value="reminder">Reminder Alerts</option>
                <option value="silence_detector">Silence Detector</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cron Expression *</label>
              <input 
                type="text" 
                placeholder="e.g. 0 9 * * 1-5 (Every weekday at 9am)" 
                value={cron} 
                onChange={(e) => setCron(e.target.value)}
                className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
              />
            </div>
            
            <div>
              <label className="block text-xs text-gray-400 mb-1">Slack Channel ID *</label>
              <input 
                type="text" 
                placeholder="e.g. C12345678" 
                value={channel} 
                onChange={(e) => setChannel(e.target.value)}
                className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Custom Payload Text / Reminder Message</label>
            <textarea 
              placeholder="e.g. Remember to fill in your yesterday logs..." 
              value={text} 
              onChange={(e) => setText(e.target.value)}
              className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white h-20 resize-none"
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
              Save Schedule
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

      {/* Schedules List */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        {loading ? (
          <p className="text-sm text-gray-400">Loading schedules...</p>
        ) : schedules.length === 0 ? (
          <p className="text-sm text-gray-400">No schedules created yet. Click Add Schedule to configure one.</p>
        ) : (
          <div className="divide-y divide-glassBorder/30">
            {schedules.map((item) => (
              <div key={item.id} className="py-4 first:pt-0 last:pb-0 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-base">{item.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-glassBorder text-gray-400 capitalize">
                      {item.schedule_type}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 flex items-center gap-4">
                    <span>Cron: <code className="text-sleekCyan font-mono">{item.cron_expr}</code></span>
                    <span>Channel: <code className="text-gray-300 font-mono">{item.channel_id}</code></span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => handleToggle(item.id, item.is_active)}
                    className="text-gray-400 hover:text-white"
                  >
                    {item.is_active ? (
                      <ToggleRight className="w-8 h-8 text-glowGreen" />
                    ) : (
                      <ToggleLeft className="w-8 h-8 text-gray-600" />
                    )}
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
