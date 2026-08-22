import { corsHeaders, getUser, json, plaidPost, serviceClient } from '../_shared.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    const { item_id } = await req.json();
    if (!item_id) throw new Error('Missing item_id');

    const sb = serviceClient();
    const { data: item, error: itemError } = await sb.from('plaid_items')
      .select('id,item_id,access_token')
      .eq('user_id', user.id)
      .eq('item_id', item_id)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) throw new Error('Connected institution not found');

    await plaidPost('/item/remove', { access_token: item.access_token });

    const { data: accounts, error: accountReadError } = await sb.from('plaid_accounts')
      .select('account_id')
      .eq('user_id', user.id)
      .eq('item_id', item_id);
    if (accountReadError) throw accountReadError;
    const accountIds = (accounts || []).map((account: { account_id: string }) => account.account_id);
    if (accountIds.length) {
      const { error: txDeleteError } = await sb.from('plaid_transactions')
        .delete()
        .eq('user_id', user.id)
        .in('account_id', accountIds);
      if (txDeleteError) throw txDeleteError;
    }
    const { error: accountDeleteError } = await sb.from('plaid_accounts').delete().eq('user_id', user.id).eq('item_id', item_id);
    if (accountDeleteError) throw accountDeleteError;
    const { error: itemDeleteError } = await sb.from('plaid_items').delete().eq('id', item.id);
    if (itemDeleteError) throw itemDeleteError;

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e.message || e) }, 400);
  }
});
