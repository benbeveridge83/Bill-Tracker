import { addDays, addMonths, addYears, clamp0, today, toISO } from './dates';

export function monthlyEq(b) {
  const amt = clamp0(b.amount);
  switch (b.frequency) {
    case 'yearly': return amt / 12;
    case 'quarterly': return amt / 3;
    case 'weekly': return amt * 52 / 12;
    case 'custom': return amt * (30.4375 / Math.max(1, Number(b.custom_days) || 30));
    default: return amt;
  }
}

export function nextDueFrom(b, fromDate) {
  let due = b.next_due ? new Date(b.next_due) : (b.anchor ? new Date(b.anchor) : today());
  if (Number.isNaN(due.getTime())) due = today();
  due.setHours(0,0,0,0);
  const base = new Date(fromDate || today()); base.setHours(0,0,0,0);
  const step = () => {
    switch (b.frequency) {
      case 'weekly': due = addDays(due, 7); break;
      case 'monthly': due = addMonths(due, 1); break;
      case 'quarterly': due = addMonths(due, 3); break;
      case 'yearly': due = addYears(due, 1); break;
      case 'custom': due = addDays(due, Math.max(1, Number(b.custom_days) || 30)); break;
      default: due = addMonths(due, 1);
    }
  };
  while (due < base) step();
  return due;
}

export function statusFor(b) {
  const due = nextDueFrom(b);
  const t = today();
  if (b.archived) return { code: 'archived', label: 'Archived', due };
  if (b.cancel_requested) return { code: 'cancel', label: 'Need to cancel', due };
  const zero = clamp0(b.overdue) === 0 && clamp0(b.balance) === 0;
  if (zero && b.current_as_of) return { code: 'current', label: 'Current', due };
  if (due < t) return { code: 'overdue', label: 'Overdue', due };
  if ((due - t) / 86400000 <= 7) return { code: 'due', label: b.autopay ? 'Due soon (autopay)' : 'Due soon', due };
  return { code: 'future', label: 'Future', due };
}

export function monthKey(billId, year, month) { return `${billId}:${year}:${month}`; }
export function monthNameShort(i) { return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i - 1] || ''; }
export function periodKey(b, dueDate) { const due = dueDate ? new Date(dueDate) : nextDueFrom(b); return `${b.frequency || 'monthly'}:${toISO(due)}`; }
