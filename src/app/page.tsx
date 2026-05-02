export default function Home() {
  return (
    <main style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>
      <h1>🚀 Klawhub Build Squad</h1>
      <p>Describe any tool you need in Slack. Our agent team builds it.</p>
      <h2>How it works</h2>
      <ol>
        <li>DM <code>@Klawhub</code> or mention it in a channel</li>
        <li>Describe what you want built</li>
        <li>Watch PM → Engineer → QA collaborate in real-time</li>
        <li>Receive tested, working code</li>
      </ol>
      <h2>Commands</h2>
      <ul>
        <li><code>/klawhub [request]</code> — Start a build</li>
        <li><code>/klawhub-status</code> — Check your builds</li>
      </ul>
      <p style={{ marginTop: 40, color: "#666" }}>
        Status: <span style={{ color: "green" }}>● Online</span>
      </p>
    </main>
  );
}
