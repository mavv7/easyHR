export function contractEndStatus(end: string | null, today: string) {
  if (!end) return null;
  if (end < today) return 'Expired';
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + 30);
  return end <= cutoff.toISOString().slice(0, 10) ? 'Ending soon' : null;
}
