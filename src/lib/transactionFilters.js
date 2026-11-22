export function filterIncludes(selection, value) {
  if (selection == null || selection === 'all') return true;
  return Array.isArray(selection) ? selection.includes(value) : selection === value;
}

function matchesAny(selection, choices) {
  if (selection == null || selection === 'all') return true;
  return Object.entries(choices).some(([key, matches]) => filterIncludes(selection, key) && matches);
}

function matchesFlow(tx, selection) {
  if (selection == null || selection === 'all') return true;
  // Treat these as separate transaction types: a transfer out is not an
  // ordinary expense, even though its amount also represents money out.
  const type = tx.is_transfer ? 'transfers'
    : tx.is_check ? 'checks'
      : Number(tx.amount) < 0 ? 'in'
        : Number(tx.amount) > 0 ? 'out' : null;
  return type !== null && filterIncludes(selection, type);
}

export function matchesTransactionFilters(tx, filters) {
  return filterIncludes(filters.account, tx.account_id)
    && matchesAny(filters.billState, {
      confirmed: Boolean(tx.matched_bill_id) && ['approved', 'automatic'].includes(tx.match_status),
      suggested: Boolean(tx.suggested_bill_id) && tx.match_status === 'suggested',
      'not-bill': !tx.matched_bill_id && !tx.suggested_bill_id && !tx.non_recurring_bill,
      'non-recurring': Boolean(tx.non_recurring_bill),
    })
    && matchesAny(filters.classification, {
      characterized: tx.classification_status !== 'uncharacterized',
      uncharacterized: tx.classification_status === 'uncharacterized',
    })
    && matchesAny(filters.reviewFlag, {
      'possible-fraud': Boolean(tx.possible_fraud),
      unflagged: !tx.possible_fraud,
    })
    && matchesFlow(tx, filters.flow);
}
