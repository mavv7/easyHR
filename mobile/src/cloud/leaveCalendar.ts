import type { CloudLeave } from './api';

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
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
