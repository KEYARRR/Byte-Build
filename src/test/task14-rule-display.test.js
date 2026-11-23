import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RULE_DISPLAY_META,
  getStatusBadgeLabel,
  getRuleChipMeta,
} from '../lib/ruleDisplay.js';

test('TC-72: getStatusBadgeLabel maps status, unverified, and estimated flags cleanly', () => {
  assert.equal(getStatusBadgeLabel('pass', true, 'database'), 'Unverified');
  assert.equal(getStatusBadgeLabel('pass', false, 'estimated'), 'Estimated');
  assert.equal(getStatusBadgeLabel('pass', false, 'database'), 'Verified');
  assert.equal(getStatusBadgeLabel('fail', false, 'database'), 'Conflict');
  assert.equal(getStatusBadgeLabel('warn', false, 'database'), 'Advisory');
  assert.equal(getStatusBadgeLabel('unknown', false, 'database'), 'Needs Spec Check');
});

test('TC-73: getRuleChipMeta returns short label, explanation, and status dot color', () => {
  const sockChip = getRuleChipMeta({
    ruleId: 'RULE-SOCK-01',
    status: 'pass',
    dataSource: 'database',
  });
  assert.equal(sockChip.label, RULE_DISPLAY_META['RULE-SOCK-01'].shortLabel);
  assert.equal(sockChip.dotClass, 'bg-emerald-400');
  assert.ok(sockChip.whyItMatters.length > 0);

  const estChip = getRuleChipMeta({
    ruleId: 'RULE-GPU-LEN-01',
    status: 'pass',
    dataSource: 'estimated',
  });
  assert.equal(estChip.dotClass, 'bg-amber-400');
  assert.equal(estChip.badgeLabel, 'Estimated');
});