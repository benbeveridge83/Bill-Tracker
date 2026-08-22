import {
  corsHeaders,
  getUser,
  json,
  plaidPost,
  serviceClient,
} from '../_shared.ts';
import {
  clearConfirmedMatch,
  localMatchScore,
  plaidTransactionFields,
  recordConfirmedMatch,
  saveSuggestion,
} from '../_matching.ts';

function billMonthKey(
  dateValue: string,
  billId: string,
) {
  return `${billId}:${String(dateValue || '').slice(0, 7)}`;
}

function chooseBestLocalMatch(
  transaction: any,
  bills: any[],
  rules: any[],
) {
  const scored = bills
    .map((bill) => ({
      bill,
      result: localMatchScore(
        transaction,
        bill,
        rules,
      ),
    }))
    .filter((entry) => entry.result.confidence > 0)
    .sort(
      (left, right) =>
        right.result.confidence -
        left.result.confidence,
    );

  const best = scored[0];
  const second = scored[1];

  if (!best) return null;

  const margin =
    best.result.confidence -
    (second?.result.confidence || 0);

  if (
    second &&
    margin < 0.04 &&
    best.result.confidence < 0.965
  ) {
    return null;
  }

  return best;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  try {
    const user = await getUser(request);
    const supabase = serviceClient();

    const [
      itemsResult,
      billsResult,
      mappingsResult,
      rulesResult,
      marksResult,
    ] = await Promise.all([
      supabase
        .from('plaid_items')
        .select('*')
        .eq('user_id', user.id),
      supabase
        .from('bills')
        .select('*')
        .eq('user_id', user.id)
        .eq('archived', false),
      supabase
        .from('category_account_mappings')
        .select('*')
        .eq('user_id', user.id),
      supabase
        .from('bill_match_rules')
        .select('*')
        .eq('user_id', user.id)
        .eq('active', true),
      supabase
        .from('bill_month_marks')
        .select('bill_id,year,month,paid')
        .eq('user_id', user.id)
        .eq('paid', true),
    ]);

    for (const result of [
      itemsResult,
      billsResult,
      mappingsResult,
      rulesResult,
      marksResult,
    ]) {
      if (result.error) throw result.error;
    }

    const items = itemsResult.data || [];
    const bills = billsResult.data || [];
    const rules = rulesResult.data || [];

    const categoryByAccount = new Map(
      (mappingsResult.data || []).map(
        (mapping: any) => [
          mapping.account_id,
          mapping.bill_category,
        ],
      ),
    );

    const confirmedBillMonths = new Set(
      (marksResult.data || []).map(
        (mark: any) =>
          `${mark.bill_id}:${mark.year}-${String(mark.month).padStart(2, '0')}`,
      ),
    );

    let imported = 0;
    let removedCount = 0;
    let suggested = 0;
    let automatic = 0;

    for (const item of items) {
      const balances = await plaidPost(
        '/accounts/get',
        { access_token: item.access_token },
      );

      const balanceRows = (
        balances.accounts || []
      ).map((account: any) => ({
        user_id: user.id,
        item_id: item.item_id,
        institution_name: item.institution_name,
        account_id: account.account_id,
        name: account.name,
        official_name: account.official_name,
        mask: account.mask,
        type: account.type,
        subtype: account.subtype,
        current_balance:
          account.balances?.current,
        available_balance:
          account.balances?.available,
        iso_currency_code:
          account.balances?.iso_currency_code,
        updated_at: new Date().toISOString(),
      }));

      if (balanceRows.length) {
        const { error } = await supabase
          .from('plaid_accounts')
          .upsert(balanceRows, {
            onConflict: 'user_id,account_id',
          });
        if (error) throw error;
      }

      let cursor = item.cursor || undefined;
      let hasMore = true;

      while (hasMore) {
        const sync = await plaidPost(
          '/transactions/sync',
          {
            access_token: item.access_token,
            cursor,
            count: 100,
          },
        );

        cursor = sync.next_cursor;
        hasMore = sync.has_more;

        const changed = (sync.added || []).concat(
          sync.modified || [],
        );

        const transactionRows = changed.map(
          (transaction: any) => ({
            user_id: user.id,
            account_id: transaction.account_id,
            transaction_id:
              transaction.transaction_id,
            date: transaction.date,
            name: transaction.name,
            merchant_name:
              transaction.merchant_name,
            amount: transaction.amount,
            pending: transaction.pending,
            category: transaction.category || [],
            raw: transaction,
            ...plaidTransactionFields(transaction),
          }),
        );

        if (transactionRows.length) {
          const { error } = await supabase
            .from('plaid_transactions')
            .upsert(transactionRows, {
              onConflict:
                'user_id,transaction_id',
            });
          if (error) throw error;

          imported += transactionRows.length;

          const transactionIds =
            transactionRows.map(
              (row: any) => row.transaction_id,
            );

          const {
            data: storedTransactions,
            error: storedError,
          } = await supabase
            .from('plaid_transactions')
            .select('*')
            .eq('user_id', user.id)
            .in(
              'transaction_id',
              transactionIds,
            );
          if (storedError) throw storedError;

          for (
            const transaction
            of storedTransactions || []
          ) {
            if (
              transaction.pending ||
              Number(transaction.amount) <= 0 ||
              transaction.matched_bill_id
            ) {
              continue;
            }

            const category = categoryByAccount.get(
              transaction.account_id,
            );
            if (!category) continue;

            const eligibleBills = bills.filter(
              (bill: any) =>
                bill.category === category &&
                bill.match_mode !== 'off',
            );

            const best = chooseBestLocalMatch(
              transaction,
              eligibleBills,
              rules,
            );

            if (
              !best ||
              best.result.confidence < 0.72
            ) {
              continue;
            }

            const key = billMonthKey(
              transaction.date,
              best.bill.id,
            );

            if (
              best.bill.match_mode ===
                'automatic' &&
              best.result.confidence >= 0.94 &&
              !confirmedBillMonths.has(key)
            ) {
              await recordConfirmedMatch(
                supabase,
                user.id,
                best.bill,
                transaction,
                'automatic',
                best.result.confidence,
                best.result.reason,
                best.result.source,
              );

              confirmedBillMonths.add(key);
              automatic += 1;
            } else if (
              await saveSuggestion(
                supabase,
                user.id,
                best.bill,
                transaction,
                best.result.confidence,
                best.result.reason,
                best.result.source,
              )
            ) {
              suggested += 1;
            }
          }
        }

        for (
          const removed
          of sync.removed || []
        ) {
          const {
            data: existing,
            error: readError,
          } = await supabase
            .from('plaid_transactions')
            .select(
              'transaction_id,matched_bill_id',
            )
            .eq('user_id', user.id)
            .eq(
              'transaction_id',
              removed.transaction_id,
            )
            .maybeSingle();
          if (readError) throw readError;

          if (existing?.matched_bill_id) {
            await clearConfirmedMatch(
              supabase,
              user.id,
              removed.transaction_id,
            );
          }

          const { error } = await supabase
            .from('plaid_transactions')
            .delete()
            .eq('user_id', user.id)
            .eq(
              'transaction_id',
              removed.transaction_id,
            );
          if (error) throw error;

          removedCount += 1;
        }
      }

      const { error: cursorError } = await supabase
        .from('plaid_items')
        .update({
          cursor,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);
      if (cursorError) throw cursorError;
    }

    return json({
      ok: true,
      imported,
      removed: removedCount,
      suggested,
      automatic,
    });
  } catch (error) {
    return json(
      {
        error: String(error?.message || error),
      },
      400,
    );
  }
});
