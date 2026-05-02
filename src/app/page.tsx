export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 40, color: "#1a1a1a" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Klawhub</h1>
      <p style={{ fontSize: 18, color: "#666", marginTop: 0 }}>
        Your AI Coworker — lives in Slack
      </p>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 20, marginBottom: 16 }}>Capabilities</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Capability emoji="🔧" title="Build" desc="Scripts, tools, web apps, automations" />
          <Capability emoji="📄" title="Documents" desc="Reports, proposals, invoices — PDF & DOCX" />
          <Capability emoji="🔍" title="Research" desc="Market research, competitor analysis, deep dives" />
          <Capability emoji="📊" title="Analytics" desc="Data analysis, charts, business intelligence" />
        </div>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 20, marginBottom: 16 }}>How to Use</h2>
        <ol style={{ lineHeight: 2 }}>
          <li>DM <strong>@Klawhub</strong> or mention in a channel</li>
          <li>Describe what you need in plain English</li>
          <li>Get results — code, documents, research, or analysis</li>
        </ol>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 20, marginBottom: 16 }}>Slash Commands</h2>
        <ul style={{ lineHeight: 2 }}>
          <li><code style={{ background: "#f0f0f0", padding: "2px 6px", borderRadius: 4 }}>/klawhub [request]</code> — Any task</li>
          <li><code style={{ background: "#f0f0f0", padding: "2px 6px", borderRadius: 4 }}>/klawhub-status</code> — View activity</li>
        </ul>
      </section>

      <p style={{ marginTop: 48, color: "#999", fontSize: 14 }}>
        Status: <span style={{ color: "#22c55e" }}>● Online</span>
      </p>
    </main>
  );
}

function Capability({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <div style={{ padding: 16, border: "1px solid #e5e5e5", borderRadius: 8 }}>
      <div style={{ fontSize: 24 }}>{emoji}</div>
      <strong style={{ display: "block", marginTop: 8 }}>{title}</strong>
      <p style={{ margin: "4px 0 0", color: "#666", fontSize: 14 }}>{desc}</p>
    </div>
  );
}
