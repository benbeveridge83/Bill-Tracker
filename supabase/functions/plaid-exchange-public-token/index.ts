import { corsHeaders, getUser, json, plaidPost, serviceClient } from '../_shared.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    const { public_token, institution } = await req.json();
    if (!public_token) throw new Error('Missing public_token');

    const exchanged = await plaidPost('/item/public_token/exchange', { public_token });
    const item = await plaidPost('/item/get', { access_token: exchanged.access_token });
    const accounts = await plaidPost('/accounts/get', { access_token: exchanged.access_token });
    const sb = serviceClient();

    const institutionId = item.item?.institution_id || institution?.institution_id || null;
    if (institutionId && accounts.accounts?.length) {
      const { data: priorItems, error: priorError } = await sb.from('plaid_items')
        .select('item_id').eq('user_id', user.id).eq('institution_id', institutionId)
        .eq('is_active', true).neq('item_id', exchanged.item_id);
      if (priorError) throw priorError;
      if (priorItems?.length) {
        const { data: oldAccounts, error: accountsError } = await sb.from('plaid_accounts')
          .select('item_id,mask,type,subtype').eq('user_id', user.id)
          .in('item_id', priorItems.map((prior: any) => prior.item_id));
        if (accountsError) throw accountsError;
        const allAlreadyConnected = accounts.accounts.every((account: any) =>
          account.mask && oldAccounts?.some((old: any) => old.mask === account.mask
            && old.type === account.type && old.subtype === account.subtype));
        if (allAlreadyConnected) {
          await plaidPost('/item/remove', { access_token: exchanged.access_token });
          return json({ ok: true, already_connected: true, accounts: 0 });
        }
      }
    }

    const { error: itemError } = await sb.from('plaid_items').upsert({
      user_id: user.id,
      item_id: exchanged.item_id,
      access_token: exchanged.access_token,
      institution_id: institutionId,
      institution_name: institution?.name || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,item_id' });
    if (itemError) throw itemError;

    const accountRows = (accounts.accounts || []).map((a: any) => ({
      user_id: user.id,
      item_id: exchanged.item_id,
      institution_name: institution?.name || null,
      account_id: a.account_id,
      name: a.name,
      official_name: a.official_name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      current_balance: a.balances?.current,
      available_balance: a.balances?.available,
      iso_currency_code: a.balances?.iso_currency_code
    }));
    if (accountRows.length) {
      const { error: accountError } = await sb.from('plaid_accounts').upsert(accountRows, { onConflict: 'user_id,account_id' });
      if (accountError) throw accountError;
    }

    return json({ ok: true, item_id: exchanged.item_id, accounts: accountRows.length });
  } catch (e) {
    return json({ error: String(e.message || e) }, 400);
  }
});
