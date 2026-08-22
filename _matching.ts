const DESCRIPTOR_STOP_WORDS = new Set([
  'ach',
  'auth',
  'card',
  'checkcard',
  'credit',
  'debit',
  'online',
  'payment',
  'pos',
  'purchase',
  'recurring',
  'transaction',
  'withdrawal',
  'www',
  'com',
]);

const BILL_STOP_WORDS = new Set([
  'and',
  'bill',
  'company',
  'inc',
  'llc',
  'monthly',
  'payment',
  'service',
  'the',
]);

export function normalizeDescriptor(value: unknown) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:x{2,}|\*+)\d{2,}\b/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !DESCRIPTOR_STOP_WORDS.has(word))
    .join(' ')
    .trim();
}

export function transactionDescriptor(transaction: any) {
  return normalizeDescriptor(
    [
      transaction.merchant_name,
      transaction.name,
      ...(transaction.counterparty_names || []),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function billTokens(bill: any) {
  const keywords = Array.isArray(bill.match_keywords)
    ? bill.match_keywords
    : [];

  const values = [bill.name, ...keywords]
    .filter(Boolean)
    .map(normalizeDescriptor)
    .filter(Boolean);

  return [...new Set(values.flatMap((value) => value.split(/\s+/)))]
    .filter((word) => word.length >= 3 && !BILL_STOP_WORDS.has(word));
}

export function amountIsClose(
  transactionAmount: unknown,
  expectedAmount: unknown,
  toleranceValue = 0.15,
) {
  const actual = Math.abs(Number(transactionAmount) || 0);
  const expected = Math.abs(Number(expectedAmount) || 0);
  if (!expected) return true;

  const tolerance = Math.min(
    1,
    Math.max(0, Number(toleranceValue) || 0.15),
  );

  return Math.abs(actual - expected) <= Math.max(2, expected * tolerance);
}

function amountSimilarity(
  transactionAmount: unknown,
  expectedAmount: unknown,
) {
  const actual = Math.abs(Number(transactionAmount) || 0);
  const expected = Math.abs(Number(expectedAmount) || 0);
  if (!actual || !expected) return 0;

  return Math.max(
    0,
    1 - Math.abs(actual - expected) / Math.max(actual, expected),
  );
}

export function plaidTransactionFields(transaction: any) {
  const financeCategory = transaction.personal_finance_category || {};
  const counterpartyNames = (transaction.counterparties || [])
    .map((counterparty: any) => counterparty?.name)
    .filter(Boolean);

  const primary = financeCategory.primary || null;
  const detailed = financeCategory.detailed || null;

  return {
    personal_finance_primary: primary,
    personal_finance_detailed: detailed,
    personal_finance_confidence:
      financeCategory.confidence_level || null,
    payment_channel: transaction.payment_channel || null,
    check_number: transaction.check_number || null,
    counterparty_names: counterpartyNames,
    is_transfer:
      String(primary || '').startsWith('TRANSFER_') ||
      String(detailed || '').includes('TRANSFER'),
    is_check:
      Boolean(transaction.check_number) ||
      String(detailed || '').includes('CHECK'),
  };
}

export function localMatchScore(
  transaction: any,
  bill: any,
  rules: any[] = [],
) {
  if (
    bill.match_mode === 'off' ||
    transaction.pending ||
    Number(transaction.amount) <= 0
  ) {
    return { confidence: 0, reason: '', source: '' };
  }

  const descriptor = transactionDescriptor(transaction);
  if (!descriptor) {
    return { confidence: 0, reason: '', source: '' };
  }

  const tolerance = Number(bill.match_amount_tolerance ?? 0.15);
  const closeAmount = amountIsClose(
    transaction.amount,
    bill.amount,
    tolerance,
  );
  const similarity = amountSimilarity(transaction.amount, bill.amount);

  const matchingRules = rules.filter(
    (rule) =>
      rule.active !== false &&
      rule.bill_id === bill.id &&
      rule.account_id === transaction.account_id,
  );

  for (const rule of matchingRules) {
    const learnedDescriptor = normalizeDescriptor(
      rule.normalized_descriptor,
    );
    if (!learnedDescriptor) continue;

    const learnedAmountClose = amountIsClose(
      transaction.amount,
      rule.amount_average || bill.amount,
      rule.amount_tolerance ?? tolerance,
    );

    if (
      descriptor === learnedDescriptor &&
      learnedAmountClose
    ) {
      return {
        confidence: 0.995,
        reason:
          'Previously approved bank wording matched exactly and the amount is similar.',
        source: 'learned_rule',
      };
    }

    if (
      learnedAmountClose &&
      learnedDescriptor.length >= 5 &&
      (
        descriptor.includes(learnedDescriptor) ||
        learnedDescriptor.includes(descriptor)
      )
    ) {
      return {
        confidence: 0.965,
        reason:
          'Previously approved bank wording matched closely and the amount is similar.',
        source: 'learned_rule',
      };
    }
  }

  const normalizedName = normalizeDescriptor(bill.name);
  const tokens = billTokens(bill);
  const matchedTokens = tokens.filter((token) =>
    descriptor.includes(token)
  );
  const tokenRatio = tokens.length
    ? matchedTokens.length / tokens.length
    : 0;
  const phraseMatch =
    normalizedName.length >= 4 &&
    (
      descriptor.includes(normalizedName) ||
      normalizedName.includes(descriptor)
    );

  if (phraseMatch && closeAmount) {
    return {
      confidence: 0.94,
      reason:
        'The bank wording matches the bill name and the amount is within the allowed tolerance.',
      source: 'keyword',
    };
  }

  if (
    matchedTokens.length >= 1 &&
    tokenRatio >= 0.5 &&
    closeAmount
  ) {
    return {
      confidence: Math.min(
        0.93,
        0.84 + tokenRatio * 0.07 + similarity * 0.03,
      ),
      reason:
        `Matched bill wording (${matchedTokens.join(', ')}) and a similar amount.`,
      source: 'keyword',
    };
  }

  if (phraseMatch) {
    return {
      confidence: 0.76,
      reason:
        'The bank wording matches the bill name, but the amount differs from the expected amount.',
      source: 'keyword',
    };
  }

  if (
    matchedTokens.length >= 2 &&
    tokenRatio >= 0.5
  ) {
    return {
      confidence: 0.72,
      reason:
        `Several bill words match (${matchedTokens.join(', ')}), but the amount is not close.`,
      source: 'keyword',
    };
  }

  return { confidence: 0, reason: '', source: '' };
}

function monthParts(dateValue: string) {
  const [yearText, monthText] = String(dateValue || '').split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  if (!year || month < 1 || month > 12) {
    throw new Error('Transaction has an invalid date');
  }

  return { year, month };
}

function trackerKey(
  billId: string,
  year: number,
  month: number,
) {
  return `${billId}:${year}:${month}`;
}

async function removePriorConfirmedLink(
  supabase: any,
  userId: string,
  transaction: any,
) {
  if (!transaction?.matched_bill_id) return;

  const { error: markError } = await supabase
    .from('bill_month_marks')
    .delete()
    .eq('user_id', userId)
    .eq('plaid_transaction_id', transaction.transaction_id);
  if (markError) throw markError;

  const { error: logError } = await supabase
    .from('payment_logs')
    .delete()
    .eq('user_id', userId)
    .eq('plaid_transaction_id', transaction.transaction_id);
  if (logError) throw logError;
}

async function clearCompetingMonthMatch(
  supabase: any,
  userId: string,
  billId: string,
  year: number,
  month: number,
  newTransactionId: string,
) {
  const key = trackerKey(billId, year, month);

  const { data: existingMark, error: markReadError } = await supabase
    .from('bill_month_marks')
    .select('plaid_transaction_id')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  if (markReadError) throw markReadError;

  const oldTransactionId = existingMark?.plaid_transaction_id;
  if (
    !oldTransactionId ||
    oldTransactionId === newTransactionId
  ) {
    return;
  }

  const { error: oldTransactionError } = await supabase
    .from('plaid_transactions')
    .update({
      matched_bill_id: null,
      suggested_bill_id: null,
      match_status: 'unmatched',
      match_confidence: null,
      match_reason: null,
      match_source: null,
      matched_at: null,
    })
    .eq('user_id', userId)
    .eq('transaction_id', oldTransactionId);
  if (oldTransactionError) throw oldTransactionError;

  const { error: oldLogError } = await supabase
    .from('payment_logs')
    .delete()
    .eq('user_id', userId)
    .eq('plaid_transaction_id', oldTransactionId);
  if (oldLogError) throw oldLogError;
}

async function learnRule(
  supabase: any,
  userId: string,
  bill: any,
  transaction: any,
) {
  const descriptor = transactionDescriptor(transaction);
  if (!descriptor) return;

  const { data: existing, error: readError } = await supabase
    .from('bill_match_rules')
    .select('*')
    .eq('user_id', userId)
    .eq('bill_id', bill.id)
    .eq('account_id', transaction.account_id)
    .eq('normalized_descriptor', descriptor)
    .maybeSingle();
  if (readError) throw readError;

  const amount = Math.abs(Number(transaction.amount) || 0);

  if (existing) {
    const count = Math.max(
      1,
      Number(existing.confirmation_count) || 1,
    );
    const average =
      (
        (Number(existing.amount_average) || 0) * count +
        amount
      ) /
      (count + 1);

    const { error } = await supabase
      .from('bill_match_rules')
      .update({
        merchant_name:
          transaction.merchant_name || existing.merchant_name,
        transaction_name:
          transaction.name || existing.transaction_name,
        amount_average: average,
        amount_tolerance: Number(
          bill.match_amount_tolerance ??
          existing.amount_tolerance ??
          0.15
        ),
        confirmation_count: count + 1,
        active: true,
        last_confirmed_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('bill_match_rules')
    .insert({
      user_id: userId,
      bill_id: bill.id,
      account_id: transaction.account_id,
      normalized_descriptor: descriptor,
      merchant_name: transaction.merchant_name || null,
      transaction_name: transaction.name || null,
      amount_average: amount,
      amount_tolerance: Number(
        bill.match_amount_tolerance ?? 0.15
      ),
      confirmation_count: 1,
      active: true,
    });
  if (error) throw error;
}

export async function saveSuggestion(
  supabase: any,
  userId: string,
  bill: any,
  transaction: any,
  confidence: number,
  reason: string,
  source: string,
) {
  if (
    transaction.matched_bill_id ||
    bill.match_mode === 'off'
  ) {
    return false;
  }

  const { data: rejected, error: feedbackError } = await supabase
    .from('bill_match_feedback')
    .select('id')
    .eq('user_id', userId)
    .eq('bill_id', bill.id)
    .eq('transaction_id', transaction.transaction_id)
    .eq('decision', 'rejected')
    .maybeSingle();
  if (feedbackError) throw feedbackError;
  if (rejected) return false;

  const currentConfidence =
    Number(transaction.match_confidence) || 0;

  if (
    transaction.suggested_bill_id &&
    currentConfidence > confidence
  ) {
    return false;
  }

  const { error } = await supabase
    .from('plaid_transactions')
    .update({
      suggested_bill_id: bill.id,
      match_status: 'suggested',
      match_confidence: Math.max(
        0,
        Math.min(1, confidence),
      ),
      match_reason: reason,
      match_source: source,
      matched_at: null,
    })
    .eq('user_id', userId)
    .eq('transaction_id', transaction.transaction_id);
  if (error) throw error;

  return true;
}

export async function recordConfirmedMatch(
  supabase: any,
  userId: string,
  bill: any,
  transaction: any,
  status: 'approved' | 'automatic',
  confidence: number,
  reason: string,
  source: string,
  learn = true,
) {
  await removePriorConfirmedLink(
    supabase,
    userId,
    transaction,
  );

  const { year, month } = monthParts(transaction.date);
  await clearCompetingMonthMatch(
    supabase,
    userId,
    bill.id,
    year,
    month,
    transaction.transaction_id,
  );

  const amount = Math.abs(
    Number(transaction.amount) || 0
  );
  const now = new Date().toISOString();

  const { error: transactionError } = await supabase
    .from('plaid_transactions')
    .update({
      matched_bill_id: bill.id,
      suggested_bill_id: null,
      match_status: status,
      match_confidence: Math.max(
        0,
        Math.min(1, confidence),
      ),
      match_reason: reason,
      match_source: source,
      matched_at: now,
    })
    .eq('user_id', userId)
    .eq('transaction_id', transaction.transaction_id);
  if (transactionError) throw transactionError;

  const { error: markError } = await supabase
    .from('bill_month_marks')
    .upsert(
      {
        user_id: userId,
        bill_id: bill.id,
        key: trackerKey(bill.id, year, month),
        year,
        month,
        paid: true,
        amount,
        date: transaction.date,
        source: 'plaid',
        plaid_transaction_id:
          transaction.transaction_id,
        match_confidence: Math.max(
          0,
          Math.min(1, confidence),
        ),
        match_reason: reason,
      },
      { onConflict: 'user_id,key' },
    );
  if (markError) throw markError;

  const merchant =
    transaction.merchant_name ||
    transaction.name ||
    'Bank transaction';

  const { error: logError } = await supabase
    .from('payment_logs')
    .upsert(
      {
        user_id: userId,
        bill_id: bill.id,
        date: transaction.date,
        amount,
        memo: `Bank match: ${merchant}`,
        period_key:
          `plaid:${year}-${String(month).padStart(2, '0')}`,
        source:
          status === 'automatic'
            ? 'plaid-auto'
            : 'plaid-approved',
        plaid_transaction_id:
          transaction.transaction_id,
      },
      { onConflict: 'plaid_transaction_id' },
    );
  if (logError) throw logError;

  const { error: feedbackError } = await supabase
    .from('bill_match_feedback')
    .upsert(
      {
        user_id: userId,
        bill_id: bill.id,
        transaction_id: transaction.transaction_id,
        decision: 'approved',
        updated_at: now,
      },
      {
        onConflict:
          'user_id,bill_id,transaction_id',
      },
    );
  if (feedbackError) throw feedbackError;

  if (learn) {
    await learnRule(
      supabase,
      userId,
      bill,
      transaction,
    );
  }
}

export async function clearConfirmedMatch(
  supabase: any,
  userId: string,
  transactionId: string,
) {
  const { data: transaction, error: readError } = await supabase
    .from('plaid_transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('transaction_id', transactionId)
    .maybeSingle();
  if (readError) throw readError;
  if (!transaction) {
    throw new Error('Transaction not found');
  }

  await removePriorConfirmedLink(
    supabase,
    userId,
    transaction,
  );

  const { error } = await supabase
    .from('plaid_transactions')
    .update({
      matched_bill_id: null,
      suggested_bill_id: null,
      match_status: 'unmatched',
      match_confidence: null,
      match_reason: null,
      match_source: null,
      matched_at: null,
    })
    .eq('user_id', userId)
    .eq('transaction_id', transactionId);
  if (error) throw error;
}
