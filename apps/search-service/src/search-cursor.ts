export function decodeSearchCursor(cursor?: string): unknown[] | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2) throw new Error('invalid');
    return value;
  } catch {
    throw new Error('Invalid search cursor');
  }
}

export function encodeSearchCursor(sort?: unknown[]): string | null {
  return sort?.length === 2 ? Buffer.from(JSON.stringify(sort)).toString('base64url') : null;
}

export function escapeRedisGlob(value: string): string {
  return value.replace(/([*?\[\]\\])/g, '\\$1');
}
