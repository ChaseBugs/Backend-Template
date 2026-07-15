export interface RatingSummary { average: number; count: number }

export function ratingSummary(rows: Array<{ rating: number }>): RatingSummary {
  if (rows.length === 0) return { average: 0, count: 0 };
  const average = rows.reduce((sum, row) => sum + row.rating, 0) / rows.length;
  return { average: Math.round(average * 100) / 100, count: rows.length };
}
