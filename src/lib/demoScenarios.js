// src/lib/demoScenarios.js
export const DEMO_SCENARIOS = [
  {
    id: 'all-pass',
    name: '1. All Pass (Balanced AM4/DDR4 Build)',
    expectedOutcomes: ['All checked rules pass', 'Compatibility Score ~100%'],
    build: {
      Processors: { id: 'demo-cpu-5600', name: 'AMD Ryzen 5 5600 (demo)', category: 'Processors', socket: 'AM4', wattage: 65, hardware_score: 80, price: 6500 },
      Motherboards: { id: 'demo-mobo-b550', name: 'MSI B550M PRO-VDH (demo)', category: 'Motherboards', socket: 'AM4', memory_type: 'DDR4', form_factor: 'mATX', price: 5200 },
      Memory: { id: 'demo-ram-16', name: '16GB (2x8GB) DDR4 3200MHz (demo)', category: 'Memory', memory_type: 'DDR4', price: 2400 },
      Storage: { id: 'demo-ssd-500', name: '500GB NVMe SSD (demo)', category: 'Storage', capacity_gb: 500, price: 2500 },
      'Hard Drives': null,
      'Video Cards': { id: 'demo-gpu-6600', name: 'Radeon RX 6600 8GB (demo)', category: 'Video Cards', wattage: 132, hardware_score: 78, price: 12500 },
      'Power Supplies': { id: 'demo-psu-550b', name: '550W Bronze Tier B (demo)', category: 'Power Supplies', wattage: 550, psu_tier: 'B', price: 2900 },
      'CPU Coolers': { id: 'demo-cool-120', name: 'Tower Air Cooler 120W (demo)', category: 'CPU Coolers', price: 1100 },
      Cases: { id: 'demo-case-matx', name: 'mATX Airflow Case (demo)', category: 'Cases', form_factor: 'mATX', price: 1900 },
    },
  },
  {
    id: 'socket-mismatch',
    name: '2. Socket Mismatch (FAIL)',
    expectedOutcomes: ['RULE-SOCK-01 fails (AM4 CPU vs LGA1700 board)'],
    build: {
      Processors: { id: 'demo-cpu-am4', name: 'AMD Ryzen 5 5600X (demo)', category: 'Processors', socket: 'AM4', wattage: 65, price: 7800 },
      Motherboards: { id: 'demo-mobo-lga1700', name: 'B760M DDR4 Board (demo)', category: 'Motherboards', socket: 'LGA1700', memory_type: 'DDR4', form_factor: 'mATX', price: 6400 },
    },
  },
  {
    id: 'ddr-mismatch',
    name: '3. DDR4 Board + DDR5 RAM (FAIL)',
    expectedOutcomes: ['RULE-MEM-01 fails on DDR4 vs DDR5 mismatch'],
    build: {
      Processors: { id: 'demo-cpu-12400f', name: 'Intel Core i5-12400F (demo)', category: 'Processors', socket: 'LGA1700', wattage: 65, price: 7200 },
      Motherboards: { id: 'demo-mobo-ddr4', name: 'H610M DDR4 Board (demo)', category: 'Motherboards', socket: 'LGA1700', memory_type: 'DDR4', form_factor: 'mATX', price: 4800 },
      Memory: { id: 'demo-ram-ddr5', name: '16GB DDR5 5200MHz (demo)', category: 'Memory', memory_type: 'DDR5', price: 3500 },
    },
  },
  {
    id: 'psu-undersized',
    name: '4. PSU Too Small for GPU (FAIL/WARN)',
    expectedOutcomes: ['RULE-PSU-01 warns or fails due to low wattage PSU'],
    build: {
      Processors: { id: 'demo-cpu-5700x', name: 'Ryzen 7 5700X (demo)', category: 'Processors', socket: 'AM4', wattage: 65, price: 9500 },
      Motherboards: { id: 'demo-mobo-b550-2', name: 'B550 ATX Board (demo)', category: 'Motherboards', socket: 'AM4', memory_type: 'DDR4', form_factor: 'ATX', price: 6200 },
      Memory: { id: 'demo-ram-16-2', name: '16GB DDR4 3200MHz (demo)', category: 'Memory', memory_type: 'DDR4', price: 2400 },
      Storage: { id: 'demo-ssd-1tb', name: '1TB NVMe SSD (demo)', category: 'Storage', capacity_gb: 1000, price: 3800 },
      'Video Cards': { id: 'demo-gpu-high', name: 'High-TDP GPU 220W (demo)', category: 'Video Cards', wattage: 220, price: 24000 },
      'Power Supplies': { id: 'demo-psu-450', name: '450W PSU (demo)', category: 'Power Supplies', wattage: 450, psu_tier: 'C', price: 1800 },
    },
  },
  {
    id: 'missing-specs',
    name: '5. Missing Specs -> Unknown / Not Enough Data',
    expectedOutcomes: ['Unknown rule status when specs are absent'],
    build: {
      Processors: { id: 'demo-cpu-unknown', name: 'Generic CPU (demo)', category: 'Processors', price: 5000 },
      Motherboards: { id: 'demo-mobo-unknown', name: 'Generic Board (demo)', category: 'Motherboards', price: 4500 },
    },
  },
  {
    id: 'estimated-data',
    name: '6. Estimated Data Build (Warn / Estimated)',
    expectedOutcomes: ['Uses estimated/inferred specs and shows balance warning'],
    build: {
      Processors: { id: 'demo-cpu-est', name: 'Ryzen 5 5500 (demo)', category: 'Processors', socket: 'AM4', price: 5200 },
      Motherboards: { id: 'demo-mobo-est', name: 'A520M Board (demo)', category: 'Motherboards', socket: 'AM4', memory_type: 'DDR4', form_factor: 'mATX', price: 3800 },
      Memory: { id: 'demo-ram-8gb', name: '8GB DDR4 2666MHz (demo)', category: 'Memory', memory_type: 'DDR4', price: 1400 },
      Storage: { id: 'demo-ssd-240', name: '240GB SATA SSD (demo)', category: 'Storage', price: 1500 },
    },
  },
];