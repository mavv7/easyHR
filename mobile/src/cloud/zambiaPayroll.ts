// Monthly standard employment rules. Amounts are in ngwee.
export function suggestZambiaDeductions(period: string, basic: number, additional: number) {
  if (!/^2026-(0[1-9]|1[0-2])$/.test(period)) return null;

  const gross = basic + additional;
  const paye = Math.round((
    Math.max(0, Math.min(gross, 710_000) - 510_000) * 20 +
    Math.max(0, Math.min(gross, 920_000) - 710_000) * 30 +
    Math.max(0, gross - 920_000) * 37
  ) / 100);
  const napsa = Math.round(Math.min(gross, 3_723_600) * 5 / 100);
  const nhima = Math.round(basic / 100);
  const deductions = paye + napsa + nhima;

  return { gross, paye, napsa, nhima, deductions, net: gross - deductions, employer: napsa + nhima };
}
