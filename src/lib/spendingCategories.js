import { DEFAULT_SPENDING_CATEGORIES } from './bank.js';

export function visibleSpendingCategories(saved = [], hidden = []) {
  const hiddenNames = new Set(hidden.map((item) => item.category_name));
  return [...new Set([
    ...DEFAULT_SPENDING_CATEGORIES.filter((name) => !hiddenNames.has(name)),
    ...saved.map((item) => item.name),
  ])].sort((a, b) => a.localeCompare(b));
}
