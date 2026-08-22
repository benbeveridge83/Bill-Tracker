import { toISO } from './dates';

export const DEFAULT_SPENDING_CATEGORIES = [
  'Bills & Utilities',
  'Business Services',
  'Education',
  'Entertainment',
  'Fees & Charges',
  'Food & Dining',
  'Gifts & Charity',
  'Health & Medical',
  'Home',
  'Income',
  'Insurance',
  'Personal Care',
  'Professional',
  'Shopping',
  'Taxes',
  'Transportation',
  'Travel',
  'Transfer',
  'Uncategorized',
  'Other',
];

export function currentMonthValue(date = new Date()) {
  return (
    `${date.getFullYear()}-` +
    String(date.getMonth() + 1).padStart(2, '0')
  );
}

export function monthBounds(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(
    String(monthValue || ''),
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) return null;

  return {
    year,
    month,
    start: toISO(new Date(year, month - 1, 1)),
    end: toISO(new Date(year, month, 0)),
  };
}

export function monthLabel(monthValue) {
  const bounds = monthBounds(monthValue);

  if (!bounds) return String(monthValue || '');

  return new Date(
    bounds.year,
    bounds.month - 1,
    1,
  ).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export function inMonth(dateValue, monthValue) {
  return (
    String(dateValue || '').slice(0, 7) ===
    monthValue
  );
}

export function transactionName(transaction) {
  return (
    transaction?.merchant_name ||
    transaction?.name ||
    'Bank transaction'
  );
}

export function accountLabel(account) {
  if (!account) return 'Unknown account';

  const mask = account.mask
    ? ` •••• ${account.mask}`
    : '';

  return (
    `${account.institution_name || ''} ` +
    `${account.name || account.official_name || 'Account'}` +
    mask
  ).trim();
}

export function humanizeFinanceCategory(value) {
  return String(value || '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map(
      (word) =>
        `${word[0]?.toUpperCase() || ''}${word.slice(1)}`,
    )
    .join(' ');
}

export function isMoneyIn(transaction) {
  return Number(transaction?.amount) < 0;
}

export function isMoneyOut(transaction) {
  return Number(transaction?.amount) > 0;
}

export function isConfirmedBillTransaction(
  transaction,
) {
  return (
    Boolean(transaction?.matched_bill_id) &&
    ['approved', 'automatic'].includes(
      transaction?.match_status,
    )
  );
}

export function isSuggestedBillTransaction(
  transaction,
) {
  return (
    Boolean(transaction?.suggested_bill_id) &&
    transaction?.match_status === 'suggested'
  );
}

export function confidenceLabel(value) {
  const confidence = Number(value);

  if (!Number.isFinite(confidence)) return '';

  return `${Math.round(confidence * 100)}%`;
}

export function categoryForSpending(transaction) {
  if (transaction?.spending_category) {
    return transaction.spending_category;
  }

  if (transaction?.personal_finance_primary) {
    return humanizeFinanceCategory(
      transaction.personal_finance_primary,
    );
  }

  return 'Uncharacterized';
}
