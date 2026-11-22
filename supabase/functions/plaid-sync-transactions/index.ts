import { corsHeaders, getUser, json, plaidPost, serviceClient } from '../_shared.ts';

function normalize(value: unknown) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function ruleForTransaction(tx: any, rules: any[]) {
  const text = normalize([
    tx.merchant_name,
    tx.name,
    ...(tx.counterparties || []).map((c: any) => c?.name),
  ].filter(Boolean).join(' '));
  if (!text) return null;
  return rules.find((rule: any) => {
    const pattern = normalize(rule.normalized_pattern || rule.merchant_pattern);
    return pattern && text.includes(pattern);
  }) || null;
}

function isTransfer(tx: any) {
  const primary = String(tx.personal_finance_category?.primary || '').toUpperCase();
  const detailed = String(tx.personal_finance_category?.detailed || '').toUpperCase();
  return primary.includes('TRANSFER') || detailed.includes('TRANSFER');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    const sb = serviceClient();
    const [{ data: items, error: itemError }, { data: rules, error: ruleError }] = await Promise.all([
      sb.from('plaid_items').select('*').eq('user_id', user.id).eq('is_active', true),
      sb.from('transaction_classification_rules').select('*').eq('user_id', user.id).eq('active', true).order('created_at', { ascending: true }),
    ]);
    if (itemError) throw itemError;
    if (ruleError) throw ruleError;

    let imported = 0;
    let removedCount = 0;
    let rulesApplied = 0;

    for (const item of items || []) {
      const balances = await plaidPost('/accounts/get', { access_token: item.access_token });
      const balanceRows = (balances.accounts || []).map((a: any) => ({
        user_id: user.id,
        item_id: item.item_id,
        institution_name: item.institution_name,
        account_id: a.account_id,
        name: a.name,
        official_name: a.official_name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        current_balance: a.balances?.current,
        available_balance: a.balances?.available,
        iso_currency_code: a.balances?.iso_currency_code,
        updated_at: new Date().toISOString(),
      }));
      if (balanceRows.length) {
        const { error: balanceError } = await sb.from('plaid_accounts').upsert(balanceRows, { onConflict: 'user_id,account_id' });
        if (balanceError) throw balanceError;
      }

      let cursor = item.cursor || undefined;
      let hasMore = true;
      while (hasMore) {
        const sync = await plaidPost('/transactions/sync', { access_token: item.access_token, cursor, count: 100 });
        cursor = sync.next_cursor;
        hasMore = sync.has_more;

        const txRows = (sync.added || []).concat(sync.modified || []).map((tx: any) => {
          const matchedRule = ruleForTransaction(tx, rules || []);
          if (matchedRule) rulesApplied += 1;
          const counterpartyNames = (tx.counterparties || []).map((c: any) => c?.name).filter(Boolean);
          const checkNumber = tx.check_number || tx.payment_meta?.reference_number || null;
          return {
            user_id: user.id,
            account_id: tx.account_id,
            transaction_id: tx.transaction_id,
            date: tx.date,
            name: tx.name,
            merchant_name: tx.merchant_name,
            amount: tx.amount,
            pending: tx.pending,
            category: tx.category || [],
            raw: tx,
            personal_finance_primary: tx.personal_finance_category?.primary || null,
            personal_finance_detailed: tx.personal_finance_category?.detailed || null,
            personal_finance_confidence: tx.personal_finance_category?.confidence_level || null,
            payment_channel: tx.payment_channel || null,
            check_number: checkNumber,
            counterparty_names: counterpartyNames,
            is_transfer: isTransfer(tx),
            is_check: Boolean(checkNumber) || String(tx.payment_channel || '').toLowerCase() === 'check',
            ...(matchedRule ? {
              spending_category: matchedRule.spending_category,
              spending_subcategory: matchedRule.spending_subcategory || null,
              classification_status: 'manual',
              classified_at: new Date().toISOString(),
              excluded_from_spending: Boolean(matchedRule.excluded_from_spending),
            } : {}),
          };
        });

        if (txRows.length) {
          const { error: txError } = await sb.from('plaid_transactions').upsert(txRows, { onConflict: 'user_id,transaction_id' });
          if (txError) throw txError;
          imported += txRows.length;
        }

        for (const removed of sync.removed || []) {
          const { error: removeError } = await sb.from('plaid_transactions').delete().eq('user_id', user.id).eq('transaction_id', removed.transaction_id);
          if (removeError) throw removeError;
          removedCount += 1;
        }
      }

      const { error: cursorError } = await sb.from('plaid_items').update({ cursor, updated_at: new Date().toISOString() }).eq('id', item.id);
      if (cursorError) throw cursorError;
    }

    return json({ ok: true, imported, removed: removedCount, rules_applied: rulesApplied });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 400);
  }
});
