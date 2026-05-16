export async function getNangoToken(connectionId: string, providerConfigKey: string): Promise<string | null> {
  const secretKey = process.env.NANGO_SECRET_KEY;
  if (!secretKey) {
    console.error("[Nango] NANGO_SECRET_KEY is not set");
    return null;
  }

  try {
    const response = await fetch(
      `https://api.nango.dev/connection/${connectionId}?provider_config_key=${providerConfigKey}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Nango] Failed to fetch connection ${connectionId}:`, error);
      return null;
    }

    const data = await response.json();
    return data.credentials?.accessToken || null;
  } catch (err) {
    console.error("[Nango] Error fetching token:", err);
    return null;
  }
}
