export const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
export const toISO = (d) => {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const z = new Date(x.getTime() - x.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const parseISO = (s) => { const d = new Date(s); if (Number.isNaN(d.getTime())) return null; d.setHours(0,0,0,0); return d; };
export const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate() + n); x.setHours(0,0,0,0); return x; };
export const addMonths = (d,n) => { const x = new Date(d); const day = x.getDate(); x.setMonth(x.getMonth() + n); if (x.getDate() < day) x.setDate(0); x.setHours(0,0,0,0); return x; };
export const addYears = (d,n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); x.setHours(0,0,0,0); return x; };
export const fmtMoney = (n) => (Number(n) || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
export const clamp0 = (v) => Math.max(0, Number(v) || 0);
