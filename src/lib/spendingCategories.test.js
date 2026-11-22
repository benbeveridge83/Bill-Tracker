import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleSpendingCategories } from './spendingCategories.js';

test('hidden presets leave custom category choices and existing names intact', () => {
  const options = visibleSpendingCategories(
    [{ name: 'Groceries' }, { name: 'Eating Out' }],
    [{ category_name: 'Food & Dining' }],
  );
  assert.ok(options.includes('Groceries'));
  assert.ok(options.includes('Eating Out'));
  assert.ok(!options.includes('Food & Dining'));
  assert.ok(options.includes('Transportation'));
});
