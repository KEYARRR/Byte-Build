import test from 'node:test';
import assert from 'node:assert/strict';
import { runSmartBuildAssistant } from '../lib/autobuilder.js';
import { detectCpuSocket, detectMotherboardSocket, evaluateBuildRules } from '../lib/compat.js';

test('Auto-builder matches CPU and Motherboard sockets and populates Memory and Storage', () => {
  const catalog = [
    { id: 1, category: 'Processors', name: 'Intel Core i5-12400F', price: 7800, hardware_score: 80, stock_status: 'In Stock' },
    { id: 2, category: 'Processors', name: 'AMD Ryzen 5 5600', price: 7200, hardware_score: 79, stock_status: 'In Stock' },
    { id: 3, category: 'Motherboards', name: 'MSI PRO B760M-A DDR4', memory_type: 'DDR4', price: 7500, hardware_score: 78, stock_status: 'In Stock' },
    { id: 4, category: 'Motherboards', name: 'ASUS TUF GAMING B550M-PLUS', memory_type: 'DDR4', price: 6800, hardware_score: 80, stock_status: 'In Stock' },
    { id: 5, category: 'Memory', name: '16GB (2x8GB) DDR4-3200', memory_type: 'DDR4', price: 2800, hardware_score: 76, stock_status: 'In Stock' },
    { id: 6, category: 'Storage', name: 'Kingston NV2 1TB NVMe PCIe 4.0', price: 3400, hardware_score: 77, stock_status: 'In Stock' },
    { id: 7, category: 'Video Cards', name: 'RTX 4060 8GB', price: 18500, hardware_score: 82, stock_status: 'In Stock' },
    { id: 8, category: 'Power Supplies', name: '650W 80+ Bronze', psu_tier: 'B', price: 3300, hardware_score: 75, stock_status: 'In Stock' },
    { id: 9, category: 'CPU Coolers', name: 'DeepCool AG400', price: 1250, hardware_score: 75, stock_status: 'In Stock' },
    { id: 10, category: 'Cases', name: 'Tecware Flatline mATX', price: 2200, hardware_score: 75, stock_status: 'In Stock' },
  ];

  const result = runSmartBuildAssistant({
    products: catalog,
    budgetInput: 50000,
    profile: 'Gaming',
  });

  assert.equal(result.ok, true);
  assert.ok(result.build.Processors, 'CPU should be selected');
  assert.ok(result.build.Motherboards, 'Motherboard should be selected');
  assert.ok(result.build.Memory, 'Memory (RAM) should always be populated');
  assert.ok(result.build.Storage, 'Storage (SSD) should always be populated');

  const cpuSock = detectCpuSocket(result.build.Processors);
  const moboSock = detectMotherboardSocket(result.build.Motherboards);
  if (cpuSock && moboSock) {
    assert.equal(cpuSock, moboSock);
  }

  const rules = evaluateBuildRules(result.build, { ramStickCount: result.ramStickCount });
  const socketRule = rules.find((r) => r.ruleId === 'RULE-SOCK-01');
  if (socketRule) {
    assert.notEqual(socketRule.status, 'fail', 'CPU and Motherboard should not have a socket mismatch');
  }
});