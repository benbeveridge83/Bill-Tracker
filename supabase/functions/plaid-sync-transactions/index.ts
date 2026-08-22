import { corsHeaders, getUser, json, plaidPost, serviceClient } from '../_shared.ts';

function billMatchScore(tx: any, bill: any) {
  const hay = `${tx.name || ''} ${tx.merchant_name || ''}`.toLowerCase();
  const words = `${bill.name || ''} ${bill.notes || ''}`.toLowerCase().split(/[,\s]+/).filter((w: string) => w.length >= 3);
  let score = 0;
  for (const w of new Set(words)) if (hay.includes(w)) score += 1;
  const amount = Math.abs(Number(tx.amount || 0));
  const billAmount = Number(bill.amount || 0);
  if (billAmount && Math.abs(amount - billAmount) <= Math.max(5, billAmount * 0.08)) score += 2;
  return score;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    const sb = serviceClient();
    const { data: items, error: itemError } = await sb.from('plaid_items').select('*').eq('user_id', user.id);
    if (itemError) throw itemError;
    const { data: bills, error: billError } = await sb.from('bills').select('*').eq('user_id', user.id).eq('archived', false);
    if (billError) throw billError;

    let imported = 0; let removedCount = 0;
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
        updated_at: new Date().toISOString()
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
          let bestBill = null; let bestScore = 0;
          for (const bill of bills || []) {
            const s = billMatchScore(tx, bill);
            if (s > bestScore) { bestScore = s; bestBill = bill; }
          }
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
            matched_bill_id: !tx.pending && Number(tx.amount) > 0 && bestScore >= 3 ? bestBill?.id : null
          };
        });
        if (txRows.length) {
          const { error: txError } = await sb.from('plaid_transactions').upsert(txRows, { onConflict: 'user_id,transaction_id' });
          if (txError) throw txError;
          imported += txRows.length;
        }
        if ((sync.removed || []).length) {
          for (const removed of sync.removed) {
            const { error: removeError } = await sb.from('plaid_transactions').delete().eq('user_id', user.id).eq('transaction_id', removed.transaction_id);
            if (removeError) throw removeError;
            removedCount++;
          }
        }
      }
      const { error: cursorError } = await sb.from('plaid_items').update({ cursor, updated_at: new Date().toISOString() }).eq('id', item.id);
      if (cursorError) throw cursorError;
    }
    return json({ ok: true, imported, removed: removedCount });
  } catch (e) {
    return json({ error: String(e.message || e) }, 400);
  }
});
