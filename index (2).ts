import {
  corsHeaders,
  getUser,
  json,
  plaidPost,
  serviceClient,
} from '../_shared.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  try {
    const user = await getUser(request);
    const { item_id: itemId } =
      await request.json();

    if (!itemId) {
      throw new Error('Missing item_id');
    }

    const supabase = serviceClient();

    const {
      data: item,
      error: itemError,
    } = await supabase
      .from('plaid_items')
      .select('id,item_id,access_token')
      .eq('user_id', user.id)
      .eq('item_id', itemId)
      .maybeSingle();

    if (itemError) throw itemError;
    if (!item) {
      throw new Error(
        'Connected institution not found',
      );
    }

    await plaidPost('/item/remove', {
      access_token: item.access_token,
    });

    const {
      data: accounts,
      error: accountReadError,
    } = await supabase
      .from('plaid_accounts')
      .select('account_id')
      .eq('user_id', user.id)
      .eq('item_id', itemId);

    if (accountReadError) {
      throw accountReadError;
    }

    const accountIds = (
      accounts || []
    ).map(
      (account: { account_id: string }) =>
        account.account_id,
    );

    if (accountIds.length) {
      const {
        data: transactionRows,
        error: transactionReadError,
      } = await supabase
        .from('plaid_transactions')
        .select('transaction_id')
        .eq('user_id', user.id)
        .in('account_id', accountIds);

      if (transactionReadError) {
        throw transactionReadError;
      }

      const transactionIds = (
        transactionRows || []
      ).map(
        (row: { transaction_id: string }) =>
          row.transaction_id,
      );

      if (transactionIds.length) {
        const { error: markDeleteError } =
          await supabase
            .from('bill_month_marks')
            .delete()
            .eq('user_id', user.id)
            .in(
              'plaid_transaction_id',
              transactionIds,
            );
        if (markDeleteError) {
          throw markDeleteError;
        }

        const { error: logDeleteError } =
          await supabase
            .from('payment_logs')
            .delete()
            .eq('user_id', user.id)
            .in(
              'plaid_transaction_id',
              transactionIds,
            );
        if (logDeleteError) {
          throw logDeleteError;
        }
      }

      const { error: transactionDeleteError } =
        await supabase
          .from('plaid_transactions')
          .delete()
          .eq('user_id', user.id)
          .in('account_id', accountIds);
      if (transactionDeleteError) {
        throw transactionDeleteError;
      }
    }

    const { error: accountDeleteError } =
      await supabase
        .from('plaid_accounts')
        .delete()
        .eq('user_id', user.id)
        .eq('item_id', itemId);
    if (accountDeleteError) {
      throw accountDeleteError;
    }

    const { error: itemDeleteError } =
      await supabase
        .from('plaid_items')
        .delete()
        .eq('id', item.id);
    if (itemDeleteError) {
      throw itemDeleteError;
    }

    return json({ ok: true });
  } catch (error) {
    return json(
      {
        error: String(error?.message || error),
      },
      400,
    );
  }
});
