export type Employee = { id: string; name: string; role: string; department: string; email: string; salary: number; balance: number };
export type Leave = { id: string; employeeId: string; start: string; end: string; days: number; reason: string; status: 'Pending' | 'Approved' | 'Declined' };
export type State = { employees: Employee[]; leave: Leave[]; contracts: { id: string; employeeId: string; title: string; status: string }[]; tasks: { id: string; title: string; owner: string; done: boolean }[]; clock: { start: string; end?: string }[]; audit: string[] };
export const seed: State = {
  employees: [
    { id: '1', name: 'Chanda Mwansa', role: 'People Operations Lead', department: 'People', email: 'chanda@example.com', salary: 1800000, balance: 18 },
    { id: '2', name: 'Mutale Banda', role: 'Product Designer', department: 'Design', email: 'mutale@example.com', salary: 1500000, balance: 16 },
    { id: '3', name: 'Thandiwe Phiri', role: 'Finance Officer', department: 'Finance', email: 'thandiwe@example.com', salary: 1250000, balance: 21 },
    { id: '4', name: 'Mulenga Tembo', role: 'Software Engineer', department: 'Engineering', email: 'mulenga@example.com', salary: 2200000, balance: 12 },
    { id: '5', name: 'Natasha Zulu', role: 'Customer Success', department: 'Operations', email: 'natasha@example.com', salary: 950000, balance: 15 },
  ],
  leave: [{ id: 'l1', employeeId: '2', start: '2026-11-23', end: '2026-11-25', days: 3, reason: 'Annual leave · family time', status: 'Pending' }, { id: 'l2', employeeId: '4', start: '2026-11-26', end: '2026-11-27', days: 2, reason: 'Annual leave · personal', status: 'Pending' }],
  contracts: [{ id: 'c1', employeeId: '5', title: 'Employment agreement', status: 'Needs review' }, { id: 'c2', employeeId: '1', title: 'Permanent employment', status: 'Reviewed' }],
  tasks: [{ id: 't1', title: 'Review PAYE return preparation', owner: 'Finance · ZRA', done: false }, { id: 't2', title: 'Reconcile NAPSA contribution schedule', owner: 'Finance · NAPSA', done: false }, { id: 't3', title: 'Check NHIMA member register', owner: 'People · NHIMA', done: false }, { id: 't4', title: 'Review employee document retention', owner: 'People · Internal policy', done: true }],
  clock: [], audit: ['Demo workspace created · fictional records'],
};
export function weekdays(start: string, end: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw Error('Use dates in YYYY-MM-DD format.');
  const a = new Date(start + 'T00:00:00Z'), b = new Date(end + 'T00:00:00Z');
  if (!Number.isFinite(+a) || !Number.isFinite(+b) || a.toISOString().slice(0, 10) !== start || b.toISOString().slice(0, 10) !== end || b < a || +b - +a > 366 * 86400000) throw Error('Enter a valid date range of up to one year.');
  let days = 0;
  for (let d = +a; d <= +b; d += 86400000) if (![0, 6].includes(new Date(d).getUTCDay())) days++;
  if (!days) throw Error('Select at least one weekday.');
  return days;
}
export function decideLeave(state: State, id: string, approved: boolean): State {
  const item = state.leave.find(l => l.id === id);
  if (!item || item.status !== 'Pending') throw Error('This request has already been processed.');
  const employee = state.employees.find(e => e.id === item.employeeId);
  if (!employee) throw Error('Employee not found.');
  if (approved && employee.balance < item.days) throw Error('Insufficient leave balance.');
  return { ...state, leave: state.leave.map(l => l.id === id ? { ...l, status: approved ? 'Approved' : 'Declined' } : l), employees: state.employees.map(e => approved && e.id === employee.id ? { ...e, balance: e.balance - item.days } : e) };
}
export const money = (minor: number) => 'K ' + (minor / 100).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
