import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSocketText,
  detectCpuSocket,
  detectMotherboardSocket,
} from '../lib/compat.js';

test('TC-47: normalizeSocketText normalizes spacing, hyphens, casing, and SOCKET keyword', () => {
  assert.equal(normalizeSocketText('LGA 1700'), 'LGA1700');
  assert.equal(normalizeSocketText('Socket AM4'), 'AM4');
  assert.equal(normalizeSocketText('lga-1851'), 'LGA1851');
  assert.equal(normalizeSocketText('socket am5'), 'AM5');
});

test('TC-48: detectCpuSocket maps Intel and AMD models accurately', () => {
  assert.equal(detectCpuSocket({ name: 'Intel Core i5-9600K' }), 'LGA1151');
  assert.equal(detectCpuSocket({ name: 'Intel Core i5-8400' }), 'LGA1151');
  assert.equal(detectCpuSocket({ name: 'Intel Core i7-7700' }), 'LGA1151');
  assert.equal(detectCpuSocket({ name: 'Intel Core i7-9700F' }), 'LGA1151');
  assert.equal(detectCpuSocket({ name: 'Intel Core i5-10400F' }), 'LGA1200');
  assert.equal(detectCpuSocket({ name: 'Intel Core i5-11400' }), 'LGA1200');
  assert.equal(detectCpuSocket({ name: 'Intel Core i5-13600K' }), 'LGA1700');
  assert.equal(detectCpuSocket({ name: 'Intel Core Ultra 5 245K' }), 'LGA1851');

  assert.equal(detectCpuSocket({ name: 'AMD Ryzen 7 2700' }), 'AM4');
  assert.equal(detectCpuSocket({ name: 'AMD Ryzen 5 1600' }), 'AM4');
  assert.equal(detectCpuSocket({ name: 'AMD Ryzen 5 4600G' }), 'AM4');
  assert.equal(detectCpuSocket({ name: 'AMD Ryzen 5 3500' }), 'AM4');
  assert.equal(detectCpuSocket({ name: 'AMD Ryzen 5 5600' }), 'AM4');
  assert.equal(detectCpuSocket({ name: 'AMD Ryzen 5 7600X' }), 'AM5');
  assert.equal(detectCpuSocket({ name: 'AMD Ryzen 7 9800X3D' }), 'AM5');
});

test('TC-49: detectMotherboardSocket maps chipsets and explicit sockets', () => {
  assert.equal(detectMotherboardSocket({ name: 'MSI B460M PRO-VDH' }), 'LGA1200');
  assert.equal(detectMotherboardSocket({ name: 'ASUS PRIME Z490-P' }), 'LGA1200');
  assert.equal(detectMotherboardSocket({ name: 'Gigabyte B560M DS3H' }), 'LGA1200');
  assert.equal(detectMotherboardSocket({ name: 'ASUS ROG STRIX Z890-A' }), 'LGA1851');
  assert.equal(detectMotherboardSocket({ name: 'MSI H510M-A PRO' }), 'LGA1200');
  assert.equal(detectMotherboardSocket({ name: 'MSI B365M PRO-VH' }), 'LGA1151');
  assert.equal(detectMotherboardSocket({ name: 'MSI B550M PRO-VDH WIFI' }), 'AM4');
  assert.equal(detectMotherboardSocket({ name: 'ASUS TUF GAMING B650M-PLUS' }), 'AM5');
  assert.equal(detectMotherboardSocket({ name: 'Custom Board', socket: 'LGA 1700' }), 'LGA1700');
});