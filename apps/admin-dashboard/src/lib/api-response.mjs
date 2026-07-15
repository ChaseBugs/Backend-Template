export function normalizeApiResponse(json) {
  const data = json?.data ?? json;
  if (data && typeof data === 'object' && Array.isArray(data.data) && data.meta) {
    const { data: items, meta, ...extra } = data;
    return { items, ...meta, ...extra };
  }
  return data;
}
