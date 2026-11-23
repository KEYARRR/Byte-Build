import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRam } from '../lib/ram.js';

test('TC-50: parseRam parses kit packs, single sticks, speeds, and never invents capacity', () => {
  const kit = parseRam({ name: 'Corsair Vengeance 32GB (2x16GB) DDR5-6000' }, 2);
  assert.equal(kit.stickCount, 2);
  assert.equal(kit.perStickCapacity, 16);
  assert.equal(kit.totalCapacity, 32);
  assert.equal(kit.speedMhz, 6000);
  assert.equal(kit.isKit, true);

  const single = parseRam({ name: 'Kingston Fury Beast 8GB DDR4 3200MHz' }, 2);
  assert.equal(single.stickCount, 2);
  assert.equal(single.perStickCapacity, 8);
  assert.equal(single.totalCapacity, 16);
  assert.equal(single.speedMhz, 3200);
  assert.equal(single.isKit, false);

  const missingCap = parseRam({ name: 'Generic DDR4 Module' }, 2);
  assert.equal(missingCap.perStickCapacity, 0);
  assert.equal(missingCap.totalCapacity, 0);
});