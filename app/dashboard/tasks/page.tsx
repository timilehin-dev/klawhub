"use client";

import React, { useState, useEffect } from "react";
import { 
  CheckSquare, Plus, Trash2, Calendar, Play, 
  Pause, Check, AlertCircle, RefreshCw 
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sabeiuxrflkndpahuczf.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface Task {
  id: string;
  title: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "paused";
  priority: "low" | "medium" | "high";
  due_at?: string;
  completed_at?: string;
  assigned_agent?: string;
}

export default function WorkspaceTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  
  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueAt, setDueAt] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) {
        setTasks(data as Task[]);
      }
    } catch (e) {
      console.log("Error loading tasks:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    
    if (!title) {
      setErrorMsg("Task Title is required.");
      return;
    }

    try {
      const { error } = await supabase
        .from("tasks")
        .insert([{
          title,
          description,
          priority,
          status: "pending",
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
          workspace_id: "b3196921-28c3-4cc9-964f-fa775f5b3e6b" // Mock uuid
        }]);

      if (error) throw error;

      setShowForm(false);
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueAt("");
      fetchTasks();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save task.");
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      await supabase
        .from("tasks")
        .update({ status: newStatus })
        .eq("id", id);
      fetchTasks();
    } catch (e) {
      console.log("Update status failed:", e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      await supabase
        .from("tasks")
        .delete()
        .eq("id", id);
      fetchTasks();
    } catch (e) {
      console.log("Delete failed:", e);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const getPriorityColor = (p: string) => {
    if (p === "high") return "text-red-400 bg-red-400/10 border-red-500/20";
    if (p === "medium") return "text-sleekCyan bg-sleekCyan/10 border-sleekCyan/20";
    return "text-gray-400 bg-white/5 border-glassBorder";
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-wide">Workspace Tasks</h2>
          <p className="text-sm text-gray-400">Workspace tasks assigned to and managed by KlawHub agents.</p>
        </div>
        
        <button 
          onClick={() => setShowForm(!showForm)}
          className="px-5 py-3 rounded-xl bg-gradient-to-r from-sleekCyan to-neonPurple text-darkBg font-bold text-sm hover:opacity-95 shadow-[0_0_20px_rgba(0,229,255,0.2)] flex items-center gap-2"
        >
          <Plus className="w-4 h-4 text-darkBg" />
          Add Task
        </button>
      </div>

      {/* Add Task Form */}
      {showForm && (
        <form onSubmit={handleCreate} className="glass-panel p-6 rounded-2xl max-w-xl space-y-4">
          <h3 className="font-bold flex items-center gap-2 text-sleekCyan">
            <CheckSquare className="w-4 h-4 text-sleekCyan" /> Create Workspace Task
          </h3>
          
          <div>
            <label className="block text-xs text-gray-400 mb-1">Task Title *</label>
            <input 
              type="text" 
              placeholder="e.g. Audit monthly financial spreadsheet" 
              value={title} 
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea 
              placeholder="Provide background context and expected skill tool runs..." 
              value={description} 
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white h-20 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Priority</label>
              <select 
                value={priority} 
                onChange={(e) => setPriority(e.target.value)}
                className="w-full bg-darkBg border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            
            <div>
              <label className="block text-xs text-gray-400 mb-1">Due Date</label>
              <input 
                type="date" 
                value={dueAt} 
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full bg-white/5 border border-glassBorder rounded-xl px-4 py-2 text-sm text-white"
              />
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs text-red-400 font-medium">{errorMsg}</p>
          )}

          <div className="flex gap-4">
            <button 
              type="submit" 
              className="px-5 py-2.5 rounded-xl bg-sleekCyan text-darkBg font-semibold text-sm hover:opacity-90"
            >
              Save Task
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

      {/* Task Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Pending Columns */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <h3 className="font-bold text-gray-300 flex items-center justify-between border-b border-glassBorder/30 pb-2">
            <span>Pending ⬜</span>
            <span className="text-xs font-mono font-normal text-gray-500">
              {tasks.filter(t => t.status === "pending").length}
            </span>
          </h3>
          
          <div className="space-y-4 overflow-y-auto max-h-[50vh] pr-2">
            {tasks.filter(t => t.status === "pending").map(task => (
              <div key={task.id} className="p-4 rounded-xl bg-white/5 border border-glassBorder/40 space-y-3 relative group">
                <div className="flex justify-between items-start">
                  <h4 className="font-semibold text-white leading-snug">{task.title}</h4>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border ${getPriorityColor(task.priority)} uppercase font-bold`}>
                    {task.priority}
                  </span>
                </div>
                {task.description && <p className="text-xs text-gray-400 line-clamp-2">{task.description}</p>}
                
                <div className="flex justify-between items-center pt-2 border-t border-glassBorder/10 text-xs">
                  <button 
                    onClick={() => handleUpdateStatus(task.id, "running")}
                    className="text-sleekCyan hover:underline flex items-center gap-1"
                  >
                    <Play className="w-3.5 h-3.5" /> Start Task
                  </button>
                  <button onClick={() => handleDelete(task.id)} className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Running Columns */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <h3 className="font-bold text-sleekCyan flex items-center justify-between border-b border-glassBorder/30 pb-2">
            <span>Running 🏃</span>
            <span className="text-xs font-mono font-normal text-sleekCyan/50">
              {tasks.filter(t => t.status === "running").length}
            </span>
          </h3>
          
          <div className="space-y-4 overflow-y-auto max-h-[50vh] pr-2">
            {tasks.filter(t => t.status === "running").map(task => (
              <div key={task.id} className="p-4 rounded-xl bg-sleekCyan/5 border border-sleekCyan/20 space-y-3 relative group">
                <div className="flex justify-between items-start">
                  <h4 className="font-semibold text-white leading-snug">{task.title}</h4>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border ${getPriorityColor(task.priority)} uppercase font-bold`}>
                    {task.priority}
                  </span>
                </div>
                {task.description && <p className="text-xs text-gray-400 line-clamp-2">{task.description}</p>}
                
                <div className="flex justify-between items-center pt-2 border-t border-glassBorder/10 text-xs">
                  <button 
                    onClick={() => handleUpdateStatus(task.id, "completed")}
                    className="text-glowGreen hover:underline flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" /> Complete
                  </button>
                  <button 
                    onClick={() => handleUpdateStatus(task.id, "pending")}
                    className="text-gray-400 hover:underline flex items-center gap-1"
                  >
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Completed Columns */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <h3 className="font-bold text-glowGreen flex items-center justify-between border-b border-glassBorder/30 pb-2">
            <span>Completed ✅</span>
            <span className="text-xs font-mono font-normal text-glowGreen/50">
              {tasks.filter(t => t.status === "completed").length}
            </span>
          </h3>
          
          <div className="space-y-4 overflow-y-auto max-h-[50vh] pr-2">
            {tasks.filter(t => t.status === "completed").map(task => (
              <div key={task.id} className="p-4 rounded-xl bg-glowGreen/5 border border-glowGreen/20 space-y-3 relative group">
                <div className="flex justify-between items-start">
                  <h4 className="font-semibold text-white/70 line-through leading-snug">{task.title}</h4>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border ${getPriorityColor(task.priority)} uppercase font-bold opacity-60`}>
                    {task.priority}
                  </span>
                </div>
                {task.description && <p className="text-xs text-gray-500 line-clamp-2">{task.description}</p>}
                
                <div className="flex justify-between items-center pt-2 border-t border-glassBorder/10 text-xs">
                  <span className="text-glowGreen flex items-center gap-1 font-mono text-[10px]">
                    Completed
                  </span>
                  <button onClick={() => handleDelete(task.id)} className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
