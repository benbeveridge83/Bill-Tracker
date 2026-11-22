import React, { useId, useState } from 'react';
import { transactionName } from '../lib/bank';
import { Modal } from './ui';

export default function ExpenseTypePicker({ transaction, types, onApply, onAdd }) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(transaction.expense_type_id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choices = types.filter((type) => `${type.name} ${type.category} ${type.subcategory || ''}`.toLowerCase().includes(query.toLowerCase().trim()));
  const selected = types.find((type) => type.id === (selectedId || transaction.expense_type_id));

  async function apply() {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try { await onApply(transaction, selected); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  return <div className="inlineBillMatch expensePicker">
    <div><strong>Non-recurring expense</strong><div className="help">Find a saved expense, or add one with its bookkeeping category.</div></div>
    <label htmlFor={inputId}>Search non-recurring expenses</label>
    <input id={inputId} type="search" placeholder="Walmart, office supplies, parking..." value={query} onChange={(event) => setQuery(event.target.value)} />
    {choices.length > 0 && <div className="expenseChoices" role="group" aria-label="Matching non-recurring expenses">
      {choices.slice(0, 12).map((type) => <button type="button" key={type.id} className={selectedId === type.id ? 'brand mini' : 'ghost mini'} onClick={() => setSelectedId(type.id)}>
        {type.name} <span className="help">· {type.category}{type.subcategory ? ` / ${type.subcategory}` : ''}</span>
      </button>)}
    </div>}
    {!choices.length && <div className="help">No saved expense matches. Add one below.</div>}
    <div className="toolbar billMatchButtons">
      <button className="brand mini" disabled={!selected || busy} onClick={apply}>{busy ? 'Saving...' : 'Categorize as expense'}</button>
      <button className="ghost mini" onClick={() => onAdd(transaction)}>+ Add a non-recurring expense</button>
    </div>
    {error && <div className="errorMessage" role="alert">{error}</div>}
  </div>;
}

export function ExpenseTypeDialog({ transaction, types, categories, onManageCategories, onSave, onClose }) {
  const [name, setName] = useState(transactionName(transaction));
  const [category, setCategory] = useState(transaction.spending_category || 'Shopping');
  const [subcategory, setSubcategory] = useState(transaction.spending_subcategory || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const categoryOptions = [...new Set([...categories, ...types.map((item) => item.category)])];

  async function save() {
    if (!name.trim() || !category.trim() || busy) return;
    setBusy(true);
    setError('');
    try { await onSave(transaction, { name: name.trim(), category: category.trim(), subcategory: subcategory.trim() || null }); onClose(); }
    catch (cause) { setError(cause.message); setBusy(false); }
  }

  return <Modal title="Add a non-recurring expense" onClose={onClose}>
    <p className="help">Save this expense for future transactions. This charge will be labeled and characterized now.</p>
    <label>Expense name</label><input value={name} onChange={(event) => setName(event.target.value)} />
    <div className="toolbar"><label>Bookkeeping category</label><button className="ghost mini" onClick={onManageCategories}>Edit category list</button></div>
    <input list="expense-type-categories" value={category} onChange={(event) => setCategory(event.target.value)} />
    <datalist id="expense-type-categories">{categoryOptions.map((option) => <option key={option} value={option} />)}</datalist>
    <label>Subcategory (optional)</label><input value={subcategory} onChange={(event) => setSubcategory(event.target.value)} />
    {error && <div className="errorMessage" role="alert">{error}</div>}
    <div className="toolbar"><button className="brand" onClick={save} disabled={busy || !name.trim() || !category.trim()}>{busy ? 'Saving...' : 'Save and categorize'}</button><button className="ghost" onClick={onClose}>Cancel</button></div>
  </Modal>;
}
