import {
  corsHeaders,
  getUser,
  json,
  serviceClient,
} from '../_shared.ts';
import {
  clearConfirmedMatch,
  recordConfirmedMatch,
} from '../_matching.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  try {
    const user = await getUser(request);
    const body = await request
      .json()
      .catch(() => ({}));

    const action = String(body.action || '');
    const transactionId = String(
      body.transaction_id || '',
    );

    if (!transactionId) {
      throw new Error('Missing transaction_id');
    }

    if (
      !['approve', 'reject', 'unmatch'].includes(
        action,
      )
    ) {
      throw new Error('Invalid match action');
    }

    const supabase = serviceClient();

    const {
      data: transaction,
      error: transactionError,
    } = await supabase
      .from('plaid_transactions')
      .select('*')
      .eq('user_id', user.id)
      .eq('transaction_id', transactionId)
      .maybeSingle();

    if (transactionError) {
      throw transactionError;
    }
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (action === 'unmatch') {
      const priorBillId =
        body.bill_id ||
        transaction.matched_bill_id;

      await clearConfirmedMatch(
        supabase,
        user.id,
        transactionId,
      );

      if (priorBillId) {
        const { error: feedbackError } =
          await supabase
            .from('bill_match_feedback')
            .upsert(
              {
                user_id: user.id,
                bill_id: priorBillId,
                transaction_id: transactionId,
                decision: 'rejected',
                updated_at:
                  new Date().toISOString(),
              },
              {
                onConflict:
                  'user_id,bill_id,transaction_id',
              },
            );
        if (feedbackError) {
          throw feedbackError;
        }
      }

      return json({
        ok: true,
        action,
      });
    }

    const billId =
      body.bill_id ||
      transaction.suggested_bill_id ||
      transaction.matched_bill_id;

    if (!billId) {
      throw new Error('Choose a bill first');
    }

    const {
      data: bill,
      error: billError,
    } = await supabase
      .from('bills')
      .select('*')
      .eq('user_id', user.id)
      .eq('id', billId)
      .maybeSingle();

    if (billError) throw billError;
    if (!bill) {
      throw new Error('Bill not found');
    }

    if (action === 'reject') {
      const now = new Date().toISOString();

      const { error: feedbackError } =
        await supabase
          .from('bill_match_feedback')
          .upsert(
            {
              user_id: user.id,
              bill_id: bill.id,
              transaction_id:
                transaction.transaction_id,
              decision: 'rejected',
              updated_at: now,
            },
            {
              onConflict:
                'user_id,bill_id,transaction_id',
            },
          );
      if (feedbackError) {
        throw feedbackError;
      }

      const { error: updateError } =
        await supabase
          .from('plaid_transactions')
          .update({
            suggested_bill_id: null,
            match_status:
              transaction.matched_bill_id
                ? transaction.match_status
                : 'unmatched',
            match_confidence:
              transaction.matched_bill_id
                ? transaction.match_confidence
                : null,
            match_reason:
              transaction.matched_bill_id
                ? transaction.match_reason
                : null,
            match_source:
              transaction.matched_bill_id
                ? transaction.match_source
                : null,
          })
          .eq('user_id', user.id)
          .eq(
            'transaction_id',
            transactionId,
          );
      if (updateError) throw updateError;

      return json({
        ok: true,
        action,
        bill_id: bill.id,
      });
    }

    if (transaction.pending) {
      throw new Error(
        'Wait until the transaction posts before approving it',
      );
    }

    if (Number(transaction.amount) <= 0) {
      throw new Error(
        'Only money-out transactions can be approved as bill payments',
      );
    }

    const confidence = Number(
      body.confidence ??
      transaction.match_confidence ??
      1,
    );

    const reason = String(
      body.reason ||
      transaction.match_reason ||
      'Manually linked to this bill by the user.',
    );

    const source = String(
      body.source ||
      (
        transaction.suggested_bill_id
          ? transaction.match_source ||
            'suggestion'
          : 'manual'
      ),
    );

    await recordConfirmedMatch(
      supabase,
      user.id,
      bill,
      transaction,
      'approved',
      confidence,
      reason,
      source,
      true,
    );

    return json({
      ok: true,
      action,
      bill_id: bill.id,
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
