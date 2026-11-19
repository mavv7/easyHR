export const companyTypes = [
  ['sole_proprietorship', 'Sole proprietorship'],
  ['partnership', 'Partnership'],
  ['limited_company', 'Limited company'],
  ['nonprofit', 'Nonprofit'],
  ['public_body', 'Public body'],
  ['other', 'Other'],
] as const;

export function registrationPhone(value: string) {
  const cleaned = value.trim().replace(/[\s()-]/g, '');
  const international = /^0[0-9]{9}$/.test(cleaned) ? '+260' + cleaned.slice(1) : cleaned;
  return /^\+[1-9][0-9]{7,14}$/.test(international) ? international : null;
}
