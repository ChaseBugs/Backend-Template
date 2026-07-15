export type DependencyState = 'up' | 'down';

export async function checkServiceReadiness(
  services: Readonly<Record<string, string>>,
  timeoutMs = 2000,
  request: typeof fetch = fetch,
): Promise<Array<readonly [string, DependencyState]>> {
  return Promise.all(Object.entries(services).map(async ([service, rawUrl]) => {
    try {
      const url = new URL(rawUrl);
      url.pathname = `${url.pathname.replace(/\/$/, '')}/ready`;
      const response = await request(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return [service, 'down'] as const;
      const body = await response.json() as { status?: string };
      return [service, body.status === 'ready' ? 'up' : 'down'] as const;
    } catch {
      return [service, 'down'] as const;
    }
  }));
}
