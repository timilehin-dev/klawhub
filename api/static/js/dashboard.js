// Klawhub Dashboard Orchestrator and Synchronization JS

document.addEventListener("DOMContentLoaded", () => {
    // Initial Hydration & Telemetry Fetching
    fetchWorkspaceStats();
    fetchWorkspaceSettings();
});

// Toast Alerts Manager
function showToast(message, isError = false) {
    const toast = document.getElementById("toast-alert");
    const toastText = document.getElementById("toast-text");
    const toastIcon = document.getElementById("toast-icon");

    toastText.innerText = message;
    
    if (isError) {
        toast.classList.add("error");
        toastIcon.innerHTML = `
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
        `;
    } else {
        toast.classList.remove("error");
        toastIcon.innerHTML = `
            <polyline points="20 6 9 17 4 12"></polyline>
        `;
    }

    toast.classList.add("show");
    
    // Auto dismiss after 3 seconds
    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

// ─────────────────────────────────────────────
// Frontend API Client Operations
// ─────────────────────────────────────────────

async function fetchWorkspaceStats() {
    try {
        const res = await fetch("/api/dashboard/stats");
        if (res.status === 401) {
            window.location.href = "/?error=session_expired";
            return;
        }
        
        const data = await res.json();
        
        // Hydrate Telemetry Values
        document.getElementById("badge-workspace-name").innerText = data.workspace_name || "Workspace";
        document.getElementById("badge-workspace-plan").innerText = `${data.plan || "free"} PLAN`;
        
        document.getElementById("tel-runs").innerText = data.runs_count;
        document.getElementById("tel-tasks").innerText = data.tasks_count;
        document.getElementById("tel-tasks-completed").innerText = `${data.tasks_completed} fully audited`;
        document.getElementById("tel-schedules").innerText = data.active_schedules;
        
        // Hydrate Resource Quota progress bars
        const currentRuns = data.runs_count;
        const limitRuns = data.monthly_run_limit || 50;
        document.getElementById("usage-runs-curr").innerText = currentRuns;
        document.getElementById("usage-runs-limit").innerText = limitRuns;
        
        const percentage = Math.min(Math.round((currentRuns / limitRuns) * 100), 100);
        document.getElementById("usage-progress-bar").style.width = `${percentage}%`;

        // Hydrate and animate SVG ring telemetry splits
        document.getElementById("chart-total-runs").innerText = currentRuns;
        
        // Circular circumference calculations (r=40, C=251.2)
        const C = 251.2;
        const gptCircle = document.getElementById("chart-seg-gpt");
        const claudeCircle = document.getElementById("chart-seg-claude");

        if (currentRuns === 0) {
            gptCircle.setAttribute("stroke-dashoffset", C);
            claudeCircle.setAttribute("stroke-dashoffset", C);
        } else {
            // Allocate 60% of runs to Ollama Gemma splits, 40% to Modal executions
            const gptShare = currentRuns * 0.6;
            const claudeShare = currentRuns * 0.4;
            
            const gptOffset = C - (C * (gptShare / currentRuns));
            const claudeOffset = C - (C * (claudeShare / currentRuns));

            gptCircle.setAttribute("stroke-dashoffset", gptOffset);
            claudeCircle.setAttribute("stroke-dashoffset", claudeOffset);
        }

    } catch (err) {
        console.error("Failed to load workspace telemetry metrics:", err);
        showToast("Telemetry sync failed", true);
    }
}

async function fetchWorkspaceSettings() {
    try {
        const res = await fetch("/api/dashboard/settings");
        if (res.status === 401) {
            window.location.href = "/?error=session_expired";
            return;
        }

        const data = await res.json();
        
        // Hydrate Settings Identity Form
        document.getElementById("field-agent-name").value = data.agent_name || "Klawhub";
        document.getElementById("field-agent-personality").value = data.agent_personality || "";
        document.getElementById("field-is-active").checked = data.is_active;

        // Toggle Dynamic Switches
        const enabledSkills = data.enabled_skills || [];
        const skillToggles = document.querySelectorAll(".skill-toggle");
        skillToggles.forEach(toggle => {
            toggle.checked = enabledSkills.includes(toggle.value);
        });

    } catch (err) {
        console.error("Failed to load workspace settings profile:", err);
        showToast("Settings retrieval failed", true);
    }
}

async function handleSaveSettings() {
    const agentName = document.getElementById("field-agent-name").value;
    const agentPersonality = document.getElementById("field-agent-personality").value;
    const isActive = document.getElementById("field-is-active").checked;

    // Collect skill switch toggles values
    const skillToggles = document.querySelectorAll(".skill-toggle");
    const enabledSkills = [];
    skillToggles.forEach(toggle => {
        if (toggle.checked) {
            enabledSkills.push(toggle.value);
        }
    });

    if (!agentName.trim()) {
        showToast("Coworker Name cannot be blank.", true);
        return;
    }

    try {
        const res = await fetch("/api/dashboard/settings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                agent_name: agentName,
                agent_personality: agentPersonality,
                enabled_skills: enabledSkills,
                is_active: isActive
            })
        });

        const data = await res.json();
        
        if (res.ok && data.status === "success") {
            showToast("Settings synchronized with Slack coworker profile!");
            // Refresh telemetry in case name or state changes affected telemetry counts
            fetchWorkspaceStats();
        } else {
            showToast(data.detail || "Failed to update settings.", true);
        }

    } catch (err) {
        console.error("Failed to post settings changes:", err);
        showToast("Connection error. Sync failed.", true);
    }
}

async function handleLogout() {
    try {
        const res = await fetch("/api/dashboard/logout", {
            method: "POST"
        });
        
        if (res.ok) {
            window.location.href = "/?message=disconnected";
        } else {
            showToast("Failed to disconnect correctly.", true);
        }
    } catch (err) {
        console.error("Logout request failed:", err);
        showToast("Logout failed due to connection error.", true);
    }
}
