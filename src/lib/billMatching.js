export function normalizeBillText(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function accountBillCategory(account, mappings = []) {
  if (['Business', 'Household', 'all'].includes(account?.bill_match_category)) return account.bill_match_category;
  const categories = [...new Set(mappings.filter((m) => m.account_id === account?.account_id).map((m) => m.bill_category))];
  return categories.length === 1 ? categories[0] : 'all';
}

export function candidateBills(transaction, bills, category = 'all', { manual = false, feedback = [] } = {}) {
  return bills.filter((bill) => !bill.archived && (category === 'all' || bill.category === category)
    && (manual || (bill.match_mode !== 'off' && (!bill.bank_account_id || bill.bank_account_id === transaction.account_id)
      && !feedback.some((f) => f.transaction_id === transaction.transaction_id && f.bill_id === bill.id && f.decision === 'rejected'))));
}

export function searchBills(bills, query = '', sort = 'amount-desc') {
  const words = normalizeBillText(query).split(' ').filter(Boolean);
  return bills.filter((bill) => !bill.archived && words.every((word) => normalizeBillText(
    [bill.name, bill.subcategory, ...(Array.isArray(bill.match_keywords) ? bill.match_keywords : [])].filter(Boolean).join(' '),
  ).includes(word))).sort((a, b) => {
    const amount = Math.abs(Number(a.amount) || 0) - Math.abs(Number(b.amount) || 0);
    if (sort === 'amount-asc' && amount) return amount;
    if (sort === 'amount-desc' && amount) return -amount;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
}

export function suggestBill(transaction, bills, { category = 'all', rules = [], feedback = [] } = {}) {
  if (transaction.pending || Number(transaction.amount) <= 0) return null;
  const text = normalizeBillText([transaction.merchant_name, transaction.name, ...(transaction.counterparty_names || [])].filter(Boolean).join(' '));
  if (!text) return null;
  const candidates = candidateBills(transaction, bills, category, { feedback }).map((bill) => {
    const expected = Math.abs(Number(bill.amount) || 0);
    const difference = Math.abs(Math.abs(Number(transaction.amount)) - expected);
    const tolerance = Math.max(0, Number(bill.match_amount_tolerance ?? 0.15));
    const close = !expected || difference <= Math.max(2, expected * tolerance);
    const learned = rules.some((rule) => rule.active !== false && rule.bill_id === bill.id && rule.account_id === transaction.account_id
      && normalizeBillText(rule.normalized_descriptor).length >= 3
      && (` ${text} `.includes(` ${normalizeBillText(rule.normalized_descriptor)} `)
        || normalizeBillText(rule.normalized_descriptor) === normalizeBillText(transaction.merchant_name || transaction.name)));
    const phrases = [bill.name, ...(Array.isArray(bill.match_keywords) ? bill.match_keywords : [])].map(normalizeBillText).filter(Boolean);
    const phrase = phrases.some((value) => value.length >= 3 && ` ${text} `.includes(` ${value} `));
    const tokens = normalizeBillText(bill.name).split(' ').filter((word) => word.length >= 3 && !['the', 'and', 'bill', 'monthly', 'payment', 'service', 'inc', 'llc'].includes(word));
    const ratio = tokens.length ? tokens.filter((word) => ` ${text} `.includes(` ${word} `)).length / tokens.length : 0;
    const confidence = learned ? (close ? 0.99 : 0.90) : phrase ? (close ? 0.94 : 0.84) : ratio >= 0.6 ? (close ? 0.78 : 0.70) : 0;
    return { bill, confidence, source: learned ? 'learned_rule' : 'local', reason: learned ? 'Previously approved wording for this account.' : close ? 'The bill name and transaction wording match.' : 'The bill name matches; review the different amount.' };
  }).filter((item) => item.confidence >= 0.7).sort((a, b) => b.confidence - a.confidence);
  if (candidates[1] && candidates[0].confidence - candidates[1].confidence < 0.04) return null;
  return candidates[0] || null;
}

export function validateAiMatches(matches, contexts) {
  if (!Array.isArray(matches)) return [];
  const used = new Set();
  return [...matches].sort((a, b) => Number(b?.confidence || 0) - Number(a?.confidence || 0)).flatMap((match) => {
    if (!match || used.has(match.transaction_id)) return [];
    const context = contexts.find((item) => item.transaction.transaction_id === match.transaction_id);
    const bill = context?.bills.find((item) => item.id === match.bill_id);
    const confidence = Number(match.confidence);
    if (!bill || !Number.isFinite(confidence) || confidence < 0.55 || confidence > 1) return [];
    used.add(match.transaction_id);
    return [{ transaction_id: match.transaction_id, bill_id: bill.id, category: bill.category, confidence, reason: String(match.reason || 'AI found matching merchant wording and billing details.').slice(0, 400), source: 'openai' }];
  });
}

export function sanitizePickerPreferences(value = {}) {
  return {
    category: ['account', 'all', 'Business', 'Household'].includes(value?.category) ? value.category : 'account',
    sort: ['amount-desc', 'amount-asc', 'alpha'].includes(value?.sort) ? value.sort : 'amount-desc',
  };
}

export function readPickerPreferences(userId) {
  try { return sanitizePickerPreferences(JSON.parse(localStorage.getItem(`billtracker:bill-picker:${userId}`) || '{}')); }
  catch { return sanitizePickerPreferences(); }
}
