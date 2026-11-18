import type { CloudLeave } from './api';

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && dateKey(date) === value;
}

export function companyDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}

export function calendarMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return dateKey(date).slice(0, 7);
}

export function calendarDays(month: string, requests: CloudLeave[]) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const nextMonth = `${calendarMonth(month, 1)}-01`;
  const scheduled = requests.filter(request =>
    (request.status === 'Approved' || request.status === 'Pending') &&
    request.start_date < nextMonth && request.end_date >= dateKey(first),
  );
  const days: ({ date: string; requests: CloudLeave[] } | null)[] = Array.from(
    { length: (first.getUTCDay() + 6) % 7 }, () => null,
  );
  for (const day = new Date(first); dateKey(day) < nextMonth; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = dateKey(day);
    const weekday = day.getUTCDay() >= 1 && day.getUTCDay() <= 5;
    days.push({ date, requests: weekday ? scheduled.filter(request => request.start_date <= date && request.end_date >= date) : [] });
  }
  while (days.length % 7) days.push(null);
  return days;
}

export function monthlyAgenda(days: ReturnType<typeof calendarDays>) {
  const byId = new Map<string, CloudLeave>();
  for (const day of days) {
    for (const request of day?.requests ?? []) byId.set(request.id, request);
  }
  return [...byId.values()].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date));
}
