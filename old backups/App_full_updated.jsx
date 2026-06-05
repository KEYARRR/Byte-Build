import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import bbLogo from './assets/bblogo.png';

const ACTIVE_TABLE = 'bytebuild_current_inventory';
const PREORDER_TABLE = 'bytebuild_preorder_inventory';
const REFERENCE_TABLE = 'bytebuild_reference_parts';

const CATEGORIES = [
  'Processors',
  'Motherboards',
  'Video Cards',
  'Memory',
  'Storage',
  'Power Supplies',
  'CPU Coolers',
  'Cases',
];

const INITIAL_BUILD = {
  Processors: null,
  Motherboards: null,
  'Video Cards': null,
  Memory: null,
  Storage: null,
  'Power Supplies': null,
  'CPU Coolers': null,
  Cases: null,
};

const INITIAL_EXISTING_PC = { ...INITIAL_BUILD };

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const peso = (value) =>
  `₱${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;

const getCategoryLabel = (category) => {
  if (category === 'Video Cards') return 'Graphics Cards';
  if (category === 'Power Supplies') return 'Power Supply';
  if (category === 'CPU Coolers') return 'CPU Cooler';
  return category;
};

const getShortLabel = (category) => {
  if (category === 'Processors') return 'CPU';
  if (category === 'Motherboards') return 'BOARD';
  if (category === 'Video Cards') return 'GPU';
  if (category === 'Memory') return 'RAM';
  if (category === 'Storage') return 'SSD';
  if (category === 'Power Supplies') return 'PSU';
  if (category === 'CPU Coolers') return 'FAN';
  if (category === 'Cases') return 'CASE';
  return 'PART';
};

const detectCpuSocket = (part) => {
  if (part?.socket) return part.socket;

  const name = String(part?.name || '').toUpperCase();

  if (
    name.includes('LGA1700') ||
    name.includes('12TH') ||
    name.includes('13TH') ||
    name.includes('14TH') ||
    name.includes('I3-12') ||
    name.includes('I5-12') ||
    name.includes('I7-12') ||
    name.includes('I9-12') ||
    name.includes('I3-13') ||
    name.includes('I5-13') ||
    name.includes('I7-13') ||
    name.includes('I9-13') ||
    name.includes('I3-14') ||
    name.includes('I5-14') ||
    name.includes('I7-14') ||
    name.includes('I9-14')
  ) {
    return 'LGA1700';
  }

  if (
    name.includes('AM5') ||
    name.includes('7500') ||
    name.includes('7600') ||
    name.includes('7700') ||
    name.includes('7800') ||
    name.includes('7900') ||
    name.includes('7950') ||
    name.includes('8400F') ||
    name.includes('8500G') ||
    name.includes('8600G') ||
    name.includes('8700G') ||
    name.includes('9000') ||
    name.includes('9600') ||
    name.includes('9700') ||
    name.includes('9800') ||
    name.includes('9900') ||
    name.includes('9950')
  ) {
    return 'AM5';
  }

  if (
    name.includes('AM4') ||
    name.includes('ATHLON') ||
    name.includes('200GE') ||
    name.includes('2200G') ||
    name.includes('3000G') ||
    name.includes('3200G') ||
    name.includes('3400G') ||
    name.includes('3600') ||
    name.includes('4500') ||
    name.includes('5500') ||
    name.includes('5600') ||
    name.includes('5700') ||
    name.includes('5800') ||
    name.includes('5900') ||
    name.includes('5950')
  ) {
    return 'AM4';
  }

  return '';
};

const detectMotherboardSocket = (part) => {
  if (part?.socket) return part.socket;

  const name = String(part?.name || '').toUpperCase();

  if (
    name.includes('A620') ||
    name.includes('B650') ||
    name.includes('B850') ||
    name.includes('X670') ||
    name.includes('X870')
  ) {
    return 'AM5';
  }

  if (
    name.includes('A320') ||
    name.includes('A520') ||
    name.includes('B350') ||
    name.includes('B450') ||
    name.includes('B550') ||
    name.includes('X370') ||
    name.includes('X470') ||
    name.includes('X570')
  ) {
    return 'AM4';
  }

  if (
    name.includes('H610') ||
    name.includes('B660') ||
    name.includes('B760') ||
    name.includes('H670') ||
    name.includes('Z690') ||
    name.includes('Z790')
  ) {
    return 'LGA1700';
  }

  return '';
};

const getCpuProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  const tdpFromDb = Number(part?.tdp || 0);
  const score = Number(part?.hardware_score || 0);

  if (!name) return { tier: 0, label: 'No CPU selected', watts: 0, coolerNeed: 0 };

  if (name.includes('ATHLON') || name.includes('200GE') || name.includes('3000G')) {
    return { tier: 1, label: 'Entry-Level APU', watts: tdpFromDb || 35, coolerNeed: 1 };
  }

  if (name.includes('2200G') || name.includes('3200G') || name.includes('3400G')) {
    return { tier: 2, label: 'Entry-Level APU', watts: tdpFromDb || 65, coolerNeed: 1 };
  }

  if (
    name.includes('4500') ||
    name.includes('5500') ||
    name.includes('3600') ||
    name.includes('10400') ||
    name.includes('11400') ||
    name.includes('12100')
  ) {
    return { tier: 3, label: 'Budget Gaming CPU', watts: tdpFromDb || 65, coolerNeed: 1 };
  }

  if (
    name.includes('5600') ||
    name.includes('5700X') ||
    name.includes('7500F') ||
    name.includes('7600') ||
    name.includes('12400') ||
    name.includes('13400') ||
    name.includes('14400')
  ) {
    return { tier: 4, label: 'Mainstream Gaming CPU', watts: tdpFromDb || 90, coolerNeed: 2 };
  }

  if (
    name.includes('5800X') ||
    name.includes('7700') ||
    name.includes('7800X3D') ||
    name.includes('9700') ||
    name.includes('9800X3D') ||
    name.includes('12700') ||
    name.includes('13700') ||
    name.includes('14700')
  ) {
    return { tier: 5, label: 'High-End CPU', watts: tdpFromDb || 140, coolerNeed: 3 };
  }

  if (
    name.includes('7900') ||
    name.includes('7950') ||
    name.includes('9900') ||
    name.includes('9950') ||
    name.includes('12900') ||
    name.includes('13900') ||
    name.includes('14900')
  ) {
    return { tier: 6, label: 'Enthusiast CPU', watts: tdpFromDb || 180, coolerNeed: 4 };
  }

  return {
    tier: score >= 85 ? 5 : score >= 75 ? 4 : score >= 60 ? 3 : 2,
    label: 'General CPU',
    watts: tdpFromDb || 80,
    coolerNeed: score >= 80 ? 3 : 2,
  };
};

const getGpuProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  const wattsFromDb = Number(part?.wattage || part?.tdp || 0);
  const score = Number(part?.hardware_score || 0);

  if (!name) return { tier: 0, label: 'No GPU selected', watts: 0 };

  if (name.includes('5090') || name.includes('4090') || name.includes('7900 XTX')) {
    return { tier: 6, label: 'Extreme GPU', watts: wattsFromDb || 450 };
  }

  if (name.includes('5080') || name.includes('4080') || name.includes('7900 XT')) {
    return { tier: 5, label: 'Enthusiast GPU', watts: wattsFromDb || 350 };
  }

  if (
    name.includes('5070') ||
    name.includes('4070') ||
    name.includes('7800 XT') ||
    name.includes('B580')
  ) {
    return { tier: 4, label: 'High Mid-Range GPU', watts: wattsFromDb || 250 };
  }

  if (
    name.includes('5060') ||
    name.includes('4060') ||
    name.includes('7600') ||
    name.includes('RX 6600') ||
    name.includes('ARC A750') ||
    name.includes('2070 SUPER')
  ) {
    return { tier: 3, label: 'Mid-Range GPU', watts: wattsFromDb || 180 };
  }

  if (
    name.includes('1650') ||
    name.includes('3050') ||
    name.includes('6400') ||
    name.includes('6500') ||
    name.includes('GT 1030')
  ) {
    return { tier: 2, label: 'Entry-Level GPU', watts: wattsFromDb || 100 };
  }

  return {
    tier: score >= 85 ? 5 : score >= 75 ? 4 : score >= 60 ? 3 : 2,
    label: 'General GPU',
    watts: wattsFromDb || 180,
  };
};

const getRamProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  const capacityText = part?.capacity || '';
  const gbMatch = `${name} ${capacityText}`.match(/(\d+)\s*GB/);
  const capacity = gbMatch ? Number(gbMatch[1]) : 0;

  return {
    capacity,
    type:
      part?.memory_type ||
      (name.includes('DDR5') ? 'DDR5' : name.includes('DDR4') ? 'DDR4' : 'Unknown'),
  };
};

const getStorageProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  const capacity = String(part?.capacity || '').toUpperCase();

  return {
    isSmall:
      name.includes('120GB') ||
      name.includes('128GB') ||
      name.includes('240GB') ||
      name.includes('256GB') ||
      capacity.includes('128GB') ||
      capacity.includes('256GB'),
    interfaceType:
      part?.interface_type ||
      (name.includes('NVME') || name.includes('M.2')
        ? 'NVMe / M.2'
        : name.includes('SSD')
        ? 'SATA SSD'
        : 'Unknown'),
  };
};

const getPsuProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  const wattMatch = name.match(/(\d{3,4})\s*W/);
  const watts = Number(part?.wattage || 0) || (wattMatch ? Number(wattMatch[1]) : 0);

  const rating = name.includes('GOLD')
    ? 'Gold'
    : name.includes('BRONZE')
    ? 'Bronze'
    : name.includes('WHITE')
    ? 'White'
    : 'Unknown';

  return { watts, rating };
};

const getCoolerProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();

  if (!name) return { tier: 0, label: 'No cooler selected' };
  if (name.includes('360')) return { tier: 4, label: '360mm Liquid Cooler' };
  if (name.includes('240')) return { tier: 3, label: '240mm Liquid Cooler' };

  if (
    name.includes('TOWER') ||
    name.includes('AK400') ||
    name.includes('AG400') ||
    name.includes('HYPER') ||
    name.includes('GAMMAXX')
  ) {
    return { tier: 2, label: 'Tower Air Cooler' };
  }

  if (name.includes('STOCK') || name.includes('WRAITH')) {
    return { tier: 1, label: 'Stock Cooler' };
  }

  return { tier: 2, label: 'Basic Cooler' };
};

const getCaseProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();

  return {
    airflow:
      name.includes('MESH') ||
      name.includes('AIR') ||
      name.includes('FLOW') ||
      name.includes('FAN'),
    formFactor: part?.form_factor || 'mATX / ATX support depends on model',
  };
};

export default function App() {
  const [activePage, setActivePage] = useState('home');
  const [activeProducts, setActiveProducts] = useState([]);
  const [preorderProducts, setPreorderProducts] = useState([]);
  const [referenceParts, setReferenceParts] = useState([]);
  const [inventoryMode, setInventoryMode] = useState('active');
  const [upgradeMode, setUpgradeMode] = useState('reference');
  const [activeTab, setActiveTab] = useState('Processors');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedBuild, setSelectedBuild] = useState(INITIAL_BUILD);
  const [existingPc, setExistingPc] = useState(INITIAL_EXISTING_PC);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [assistantForm, setAssistantForm] = useState({
    budget: '60000',
    purpose: 'Gaming',
    preference: 'Best Value',
  });

  useEffect(() => {
    async function fetchAllRows(tableName) {
      let allRows = [];
      let from = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .order('category', { ascending: true })
          .order('name', { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;

        const rows = data || [];
        allRows = [...allRows, ...rows];

        if (rows.length < pageSize) break;
        from += pageSize;
      }

      return allRows;
    }

    async function fetchInventory() {
      setLoading(true);

      try {
        const [activeRows, preorderRows, referenceRows] = await Promise.all([
          fetchAllRows(ACTIVE_TABLE),
          fetchAllRows(PREORDER_TABLE),
          fetchAllRows(REFERENCE_TABLE),
        ]);

        setActiveProducts(activeRows);
        setPreorderProducts(preorderRows);
        setReferenceParts(referenceRows);
      } catch (err) {
        console.error('Supabase Sync Error:', err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchInventory();
  }, []);

  const products = inventoryMode === 'active' ? activeProducts : preorderProducts;

  const upgradeCatalogProducts = useMemo(() => {
    if (upgradeMode === 'reference') return referenceParts;
    return activeProducts;
  }, [upgradeMode, referenceParts, activeProducts]);

  const catalogProducts = useMemo(() => {
    if (activePage === 'upgrade') return upgradeCatalogProducts;
    return products;
  }, [activePage, upgradeCatalogProducts, products]);

  const selectedItems = useMemo(() => Object.values(selectedBuild).filter(Boolean), [selectedBuild]);

  const totalPrice = selectedItems.reduce((sum, item) => sum + Number(item?.price || 0), 0);
  const monthlyEstimate = totalPrice > 0 ? totalPrice / 12 : 0;
  const buildProgress = Math.round((selectedItems.length / CATEGORIES.length) * 100);

  const effectiveParts = useMemo(() => {
    return {
      Processors: selectedBuild.Processors || existingPc.Processors,
      Motherboards: selectedBuild.Motherboards || existingPc.Motherboards,
      'Video Cards': selectedBuild['Video Cards'] || existingPc['Video Cards'],
      Memory: selectedBuild.Memory || existingPc.Memory,
      Storage: selectedBuild.Storage || existingPc.Storage,
      'Power Supplies': selectedBuild['Power Supplies'] || existingPc['Power Supplies'],
      'CPU Coolers': selectedBuild['CPU Coolers'] || existingPc['CPU Coolers'],
      Cases: selectedBuild.Cases || existingPc.Cases,
    };
  }, [selectedBuild, existingPc]);

  const cpuProfile = getCpuProfile(effectiveParts.Processors);
  const gpuProfile = getGpuProfile(effectiveParts['Video Cards']);
  const ramProfile = getRamProfile(effectiveParts.Memory);
  const storageProfile = getStorageProfile(effectiveParts.Storage);
  const psuProfile = getPsuProfile(effectiveParts['Power Supplies']);
  const coolerProfile = getCoolerProfile(effectiveParts['CPU Coolers']);
  const caseProfile = getCaseProfile(effectiveParts.Cases);

  const cpuSocket = detectCpuSocket(effectiveParts.Processors);
  const motherboardSocket = detectMotherboardSocket(effectiveParts.Motherboards);

  const recommendedPsuWatts = useMemo(() => {
    const base = cpuProfile.watts + gpuProfile.watts + 120;
    return Math.ceil(base / 50) * 50;
  }, [cpuProfile.watts, gpuProfile.watts]);

  const dssIssues = useMemo(() => {
    const issues = [];

    const cpu = effectiveParts.Processors;
    const board = effectiveParts.Motherboards;
    const gpu = effectiveParts['Video Cards'];
    const ram = effectiveParts.Memory;
    const storage = effectiveParts.Storage;
    const psu = effectiveParts['Power Supplies'];
    const cooler = effectiveParts['CPU Coolers'];
    const pcCase = effectiveParts.Cases;

    if (cpu && board && cpuSocket && motherboardSocket && cpuSocket !== motherboardSocket) {
      issues.push({
        severity: 'critical',
        title: 'CPU and Motherboard Socket Mismatch',
        message: `${cpu.name} uses ${cpuSocket}, while ${board.name} uses ${motherboardSocket}. These parts cannot be used together.`,
        action: 'Choose a motherboard with the same socket as the processor, or choose a processor that matches the motherboard.',
      });
    }

    if (board && ram) {
      const boardMemory = board.memory_type;
      const ramType = getRamProfile(ram).type;

      if (boardMemory && ramType && boardMemory !== ramType) {
        issues.push({
          severity: 'critical',
          title: 'Motherboard and RAM Type Mismatch',
          message: `${board.name} supports ${boardMemory}, while ${ram.name} is ${ramType}.`,
          action: `Use ${boardMemory} memory for this motherboard.`,
        });
      }
    }

    if (cpu && gpu) {
      const tierGap = gpuProfile.tier - cpuProfile.tier;

      if (tierGap >= 3) {
        issues.push({
          severity: 'critical',
          title: 'Severe CPU Bottleneck Risk',
          message: `${cpu.name} may heavily limit ${gpu.name}, especially in games and CPU-heavy workloads.`,
          action: 'Upgrade to a stronger 6-core or 8-core CPU before buying this graphics card.',
        });
      } else if (tierGap === 2) {
        issues.push({
          severity: 'warning',
          title: 'Possible CPU Bottleneck',
          message: `${gpu.name} can work, but ${cpu.name} may reduce frame rates and 1% lows.`,
          action: 'Consider upgrading the CPU if the customer wants smoother gaming performance.',
        });
      }

      if (cpuProfile.tier - gpuProfile.tier >= 3) {
        issues.push({
          severity: 'warning',
          title: 'GPU May Limit the Build',
          message: `${cpu.name} is much stronger than ${gpu.name}. Gaming performance may still be limited by the graphics card.`,
          action: 'Prioritize a GPU upgrade for gaming workloads.',
        });
      }
    }

    if (ram && ramProfile.capacity > 0 && ramProfile.capacity < 16) {
      issues.push({
        severity: 'warning',
        title: 'Low Memory Capacity',
        message: `Detected RAM is ${ramProfile.capacity}GB. This may limit gaming, browsing, and multitasking.`,
        action: 'Upgrade to 16GB dual-channel memory or higher.',
      });
    }

    if (storage && storageProfile.isSmall) {
      issues.push({
        severity: 'warning',
        title: 'Small Storage Capacity',
        message: `${storage.name} may be too small for Windows, applications, and modern games.`,
        action: 'Use at least a 500GB SSD.',
      });
    }

    if (psu && psuProfile.watts > 0 && psuProfile.watts < recommendedPsuWatts) {
      issues.push({
        severity: 'critical',
        title: 'Insufficient Power Supply',
        message: `${psu.name} is around ${psuProfile.watts}W. This build is recommended to use at least ${recommendedPsuWatts}W.`,
        action: `Use a ${recommendedPsuWatts}W or higher 80+ rated PSU.`,
      });
    }

    if (psu && psuProfile.rating === 'Unknown' && gpuProfile.tier >= 3) {
      issues.push({
        severity: 'warning',
        title: 'PSU Quality Check Needed',
        message: `${psu.name} does not show a clear efficiency rating in the product name.`,
        action: 'Use a known 80+ Bronze or Gold-rated PSU for gaming builds.',
      });
    }

    if (cooler && coolerProfile.tier < cpuProfile.coolerNeed) {
      issues.push({
        severity: 'warning',
        title: 'Cooling May Be Insufficient',
        message: `${cooler.name} may be weak for ${effectiveParts.Processors?.name}.`,
        action: 'Use a stronger tower cooler or liquid cooler depending on CPU heat output.',
      });
    }

    if (pcCase && !caseProfile.airflow && gpuProfile.tier >= 4) {
      issues.push({
        severity: 'warning',
        title: 'Case Airflow Warning',
        message: `${pcCase.name} may not provide enough airflow for a higher-power GPU.`,
        action: 'Use a mesh airflow case with proper fan support.',
      });
    }

    return issues;
  }, [
    effectiveParts,
    cpuSocket,
    motherboardSocket,
    cpuProfile,
    gpuProfile,
    ramProfile,
    storageProfile,
    psuProfile,
    coolerProfile,
    caseProfile,
    recommendedPsuWatts,
  ]);

  const recommendation = useMemo(() => {
    const critical = dssIssues.find((issue) => issue.severity === 'critical');
    const warning = dssIssues.find((issue) => issue.severity === 'warning');
    const preOrderPart = selectedItems.find((item) => item?.stock_status === 'Pre-Order');

    if (critical) {
      return {
        title: critical.title,
        tone: 'danger',
        summary: `${critical.message}\n\nRecommended Action: ${critical.action}`,
      };
    }

    if (warning) {
      return {
        title: warning.title,
        tone: 'warning',
        summary: `${warning.message}\n\nRecommended Action: ${warning.action}`,
      };
    }

    if (preOrderPart) {
      return {
        title: 'Pre-Order Item Included',
        tone: 'info',
        summary: `${preOrderPart.name} requires supplier confirmation before final quotation.`,
      };
    }

    if (selectedItems.length === 0 && Object.values(existingPc).filter(Boolean).length === 0) {
      return {
        title: 'Ready for Selection',
        tone: 'neutral',
        summary: 'Choose current PC parts or upgrade parts to generate compatibility, power, and upgrade recommendations.',
      };
    }

    return {
      title: 'Build Looks Compatible',
      tone: 'success',
      summary: `No major issue detected. Recommended PSU headroom: ${recommendedPsuWatts}W. The build is ready for upgrade or quotation review.`,
    };
  }, [dssIssues, selectedItems, existingPc, recommendedPsuWatts]);

  const compatibilityScore = useMemo(() => {
    let score = 100;

    dssIssues.forEach((issue) => {
      if (issue.severity === 'critical') score -= 35;
      if (issue.severity === 'warning') score -= 15;
    });

    selectedItems.forEach((item) => {
      if (item?.stock_status === 'Sold Out') score -= 25;
      if (item?.stock_status === 'Pre-Order') score -= 8;
    });

    return Math.max(score, 0);
  }, [dssIssues, selectedItems]);

  const performanceTier = useMemo(() => {
    if (!effectiveParts['Video Cards']) {
      return {
        label: 'Select a Graphics Card',
        description: 'Choose a GPU to estimate gaming and productivity performance.',
      };
    }

    const critical = dssIssues.find((issue) => issue.severity === 'critical');
    if (critical) {
      return {
        label: 'Compatibility Issue',
        description: critical.message,
      };
    }

    if (gpuProfile.tier >= 4 && cpuProfile.tier >= 4) {
      return {
        label: 'Balanced Gaming Build',
        description: 'Good CPU and GPU balance for gaming, school work, editing, and productivity.',
      };
    }

    if (gpuProfile.tier === 3) {
      return {
        label: 'Mid-Range Build',
        description: 'Good for 1080p gaming and daily productivity.',
      };
    }

    return {
      label: 'Entry-Level Build',
      description: 'Best for school work, office tasks, esports titles, and light gaming.',
    };
  }, [effectiveParts, dssIssues, cpuProfile, gpuProfile]);

  const brandsForActiveCategory = useMemo(() => {
    const active = normalizeText(activeTab);

    const brands = catalogProducts
      .filter((product) => normalizeText(product?.category) === active && product?.brand)
      .map((product) => product.brand);

    return ['All', ...new Set(brands)];
  }, [catalogProducts, activeTab]);

  const filteredProducts = useMemo(() => {
    const active = normalizeText(activeTab);
    const query = normalizeText(searchQuery);

    return catalogProducts.filter((product) => {
      if (normalizeText(product?.category) !== active) return false;

      const searchableText = [
        product?.name,
        product?.brand,
        product?.sku_code,
        product?.socket,
        product?.chipset,
        product?.memory_type,
        product?.capacity,
        product?.interface_type,
        product?.common_aliases,
        product?.specs,
        product?.recommended_pairing,
        product?.notes,
        product?.source_url,
        product?.spec_confidence,
        product?.data_method,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = query === '' || searchableText.includes(query);
      const matchesBrand = selectedBrand === 'All' || product?.brand === selectedBrand;

      return matchesSearch && matchesBrand;
    });
  }, [catalogProducts, activeTab, searchQuery, selectedBrand]);

  const categoryCounts = useMemo(() => {
    return CATEGORIES.reduce((acc, category) => {
      acc[category] = catalogProducts.filter(
        (product) => normalizeText(product?.category) === normalizeText(category)
      ).length;

      return acc;
    }, {});
  }, [catalogProducts]);

  const getPartsByCategory = useCallback(
    (category) => {
      return activeProducts
        .filter((item) => item.category === category && item.stock_status !== 'Sold Out')
        .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    },
    [activeProducts]
  );

  const pickPart = useCallback(
    (category, maxPrice, strategy = 'balanced') => {
      const allParts = getPartsByCategory(category);
      const list = allParts.filter((item) => Number(item.price || 0) <= maxPrice);

      if (list.length === 0) return allParts[0] || null;

      if (strategy === 'bestScore') {
        return [...list].sort((a, b) => Number(b.hardware_score || 0) - Number(a.hardware_score || 0))[0];
      }

      if (strategy === 'cheapest') {
        return list[0];
      }

      return list[Math.floor(list.length / 2)] || list[0];
    },
    [getPartsByCategory]
  );

  const getCompatibleMotherboard = useCallback(
    (cpu, maxPrice, strategy = 'balanced') => {
      if (!cpu) return null;

      const socket = detectCpuSocket(cpu);

      const boards = getPartsByCategory('Motherboards').filter((board) => {
        const boardSocket = detectMotherboardSocket(board);
        const priceOk = Number(board.price || 0) <= maxPrice;
        return socket && boardSocket && socket === boardSocket && priceOk;
      });

      const fallbackBoards = getPartsByCategory('Motherboards').filter(
        (board) => detectMotherboardSocket(board) === socket
      );

      const pool = boards.length > 0 ? boards : fallbackBoards;
      if (pool.length === 0) return null;

      if (strategy === 'cheapest') {
        return [...pool].sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
      }

      return [...pool].sort((a, b) => Number(b.hardware_score || 0) - Number(a.hardware_score || 0))[0];
    },
    [getPartsByCategory]
  );

  const getCompatibleMemory = useCallback(
    (motherboard, maxPrice, strategy = 'balanced') => {
      const boardMemory = motherboard?.memory_type || '';

      const memoryList = getPartsByCategory('Memory').filter((ram) => {
        const ramType = getRamProfile(ram).type;
        const priceOk = Number(ram.price || 0) <= maxPrice;

        if (!boardMemory) return priceOk;
        return priceOk && ramType === boardMemory;
      });

      const fallbackMemory = getPartsByCategory('Memory').filter((ram) => {
        const ramType = getRamProfile(ram).type;
        if (!boardMemory) return true;
        return ramType === boardMemory;
      });

      const pool = memoryList.length > 0 ? memoryList : fallbackMemory;
      if (pool.length === 0) return null;

      if (strategy === 'cheapest') {
        return [...pool].sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
      }

      return [...pool].sort((a, b) => Number(b.hardware_score || 0) - Number(a.hardware_score || 0))[0];
    },
    [getPartsByCategory]
  );

  const getCompatiblePsu = useCallback(
    (cpu, gpu, maxPrice) => {
      const requiredPsu = Math.ceil((getCpuProfile(cpu).watts + getGpuProfile(gpu).watts + 120) / 50) * 50;

      const psus = getPartsByCategory('Power Supplies')
        .filter((item) => {
          const profile = getPsuProfile(item);
          return profile.watts >= requiredPsu && Number(item.price || 0) <= maxPrice;
        })
        .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));

      if (psus.length > 0) return psus[0];

      return (
        getPartsByCategory('Power Supplies')
          .filter((item) => getPsuProfile(item).watts >= requiredPsu)
          .sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0] ||
        pickPart('Power Supplies', maxPrice, 'balanced')
      );
    },
    [getPartsByCategory, pickPart]
  );

  const createBuildOption = useCallback(
    (label, budget, strategy) => {
      const ratios = {
        budget: { cpu: 0.18, board: 0.13, gpu: 0.28, ram: 0.08, storage: 0.09, psu: 0.09, cooler: 0.05, case: 0.1 },
        value: { cpu: 0.18, board: 0.12, gpu: 0.35, ram: 0.08, storage: 0.08, psu: 0.09, cooler: 0.04, case: 0.06 },
        balanced: { cpu: 0.22, board: 0.13, gpu: 0.28, ram: 0.1, storage: 0.09, psu: 0.09, cooler: 0.04, case: 0.05 },
        upgrade: { cpu: 0.22, board: 0.18, gpu: 0.22, ram: 0.1, storage: 0.08, psu: 0.11, cooler: 0.04, case: 0.05 },
        productivity: { cpu: 0.25, board: 0.12, gpu: 0.18, ram: 0.13, storage: 0.13, psu: 0.09, cooler: 0.05, case: 0.05 },
      };

      const r = ratios[strategy];

      const cpu = pickPart('Processors', budget * r.cpu, strategy === 'budget' ? 'cheapest' : 'bestScore');
      const motherboard = getCompatibleMotherboard(cpu, budget * r.board, strategy === 'budget' ? 'cheapest' : 'bestScore');
      const memory = getCompatibleMemory(motherboard, budget * r.ram, strategy === 'budget' ? 'cheapest' : 'bestScore');
      const gpu = pickPart('Video Cards', budget * r.gpu, strategy === 'budget' ? 'cheapest' : 'bestScore');
      const psu = getCompatiblePsu(cpu, gpu, budget * r.psu);

      const build = {
        Processors: cpu,
        Motherboards: motherboard,
        'Video Cards': gpu,
        Memory: memory,
        Storage: pickPart('Storage', budget * r.storage, strategy === 'budget' ? 'cheapest' : 'balanced'),
        'Power Supplies': psu,
        'CPU Coolers': pickPart('CPU Coolers', budget * r.cooler, strategy === 'budget' ? 'cheapest' : 'balanced'),
        Cases: pickPart('Cases', budget * r.case, strategy === 'budget' ? 'cheapest' : 'balanced'),
      };

      const parts = Object.values(build).filter(Boolean);
      const total = parts.reduce((sum, item) => sum + Number(item.price || 0), 0);

      const socketOk =
        build.Processors &&
        build.Motherboards &&
        detectCpuSocket(build.Processors) === detectMotherboardSocket(build.Motherboards);

      const memoryOk =
        !build.Motherboards?.memory_type ||
        !build.Memory ||
        build.Motherboards.memory_type === getRamProfile(build.Memory).type;

      const avgScore =
        parts.length > 0
          ? Math.round(parts.reduce((sum, item) => sum + Number(item.hardware_score || 60), 0) / parts.length)
          : 0;

      const descriptions = {
        budget: 'Lowest practical complete build using compatible platform parts.',
        value: 'Prioritizes price-to-performance while keeping CPU and motherboard compatible.',
        balanced: 'Balances CPU, GPU, RAM, storage, and PSU with platform compatibility.',
        upgrade: 'Spends more on motherboard and PSU for better future upgrade support.',
        productivity: 'Prioritizes CPU, RAM, and storage for work, school, and multitasking.',
      };

      return {
        label,
        strategy,
        build,
        total,
        score: socketOk && memoryOk ? avgScore : Math.max(avgScore - 30, 0),
        description: descriptions[strategy],
        warning:
          !socketOk
            ? 'CPU and motherboard socket mismatch detected.'
            : !memoryOk
            ? 'Motherboard and RAM type mismatch detected.'
            : 'All core platform checks passed.',
      };
    },
    [pickPart, getCompatibleMotherboard, getCompatibleMemory, getCompatiblePsu]
  );

  const smartAssistantOptions = useMemo(() => {
    const budget = Number(assistantForm.budget || 0);

    return [
      createBuildOption('Budget Saver Build', budget, 'budget'),
      createBuildOption('Best Value Build', budget, 'value'),
      createBuildOption('Balanced Gaming Build', budget, 'balanced'),
      createBuildOption('Upgrade-Friendly Build', budget, 'upgrade'),
      createBuildOption('Productivity Build', budget, 'productivity'),
    ].filter((option) => Object.values(option.build).some(Boolean));
  }, [assistantForm, createBuildOption]);

  const handleUseSuggestedBuild = (build) => {
    setSelectedBuild(build);
    setActivePage('builder');
  };

  const handleSelectProduct = (product) => {
    const matchedCategory = CATEGORIES.find(
      (category) => normalizeText(category) === normalizeText(product?.category)
    );

    if (!matchedCategory) return;

    setSelectedBuild((prev) => ({
      ...prev,
      [matchedCategory]: {
        ...product,
        stock_status:
          inventoryMode === 'preorder'
            ? 'Pre-Order'
            : product.stock_status || 'In Stock',
      },
    }));
  };

  const handleSetExistingPart = (category, product) => {
    setExistingPc((prev) => ({
      ...prev,
      [category]: product,
    }));
  };

  const handleUpgradeAction = (category, product) => {
    if (activePage === 'upgrade' && upgradeMode === 'reference') {
      handleSetExistingPart(category, product);
      return;
    }

    handleSelectProduct(product);
  };

  const handleClearBuild = () => setSelectedBuild(INITIAL_BUILD);
  const handleClearExistingPc = () => setExistingPc(INITIAL_EXISTING_PC);

  const tone = useMemo(() => {
    if (recommendation.tone === 'danger') {
      return { card: 'border-red-200 bg-red-50', badge: 'bg-red-600 text-white', bar: 'bg-red-500' };
    }

    if (recommendation.tone === 'warning') {
      return { card: 'border-amber-200 bg-amber-50', badge: 'bg-amber-500 text-white', bar: 'bg-amber-500' };
    }

    if (recommendation.tone === 'info') {
      return { card: 'border-blue-200 bg-blue-50', badge: 'bg-blue-600 text-white', bar: 'bg-blue-500' };
    }

    if (recommendation.tone === 'success') {
      return { card: 'border-emerald-200 bg-emerald-50', badge: 'bg-emerald-600 text-white', bar: 'bg-emerald-500' };
    }

    return { card: 'border-slate-200 bg-white', badge: 'bg-slate-900 text-white', bar: 'bg-slate-500' };
  }, [recommendation.tone]);

  const getStockClasses = (status) => {
    if (status === 'reference') return 'bg-slate-50 text-slate-700 border-slate-200';
    if (status === 'Pre-Order') return 'bg-blue-50 text-blue-700 border-blue-200';
    if (status === 'Sold Out') return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  const getBrandGradient = (brand) => {
    const name = String(brand || '').toUpperCase();

    if (name.includes('ASUS')) return 'from-[#083B7A] to-[#061A3D]';
    if (name.includes('MSI')) return 'from-[#0B63CE] to-[#061A3D]';
    if (name.includes('GIGABYTE')) return 'from-[#0B63CE] to-[#11BFD7]';
    if (name.includes('INTEL')) return 'from-[#0B63CE] to-[#083B7A]';
    if (name.includes('AMD')) return 'from-[#083B7A] to-[#11BFD7]';
    if (name.includes('DEEPCOOL')) return 'from-[#11BFD7] to-[#061A3D]';
    if (name.includes('CORSAIR')) return 'from-[#083B7A] to-[#061A3D]';
    if (name.includes('SEASONIC')) return 'from-[#0B63CE] to-[#061A3D]';

    return 'from-[#083B7A] to-[#061A3D]';
  };

  const renderPageButton = (page, label) => (
    <button
      key={page}
      onClick={() => setActivePage(page)}
      className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide ${
        activePage === page
          ? 'bg-[#0B63CE] text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B63CE]'
      }`}
    >
      {label}
    </button>
  );

  const renderProductCard = (product, allowAdd = true, existingCategory = null, keyPrefix = 'product') => {
    const isReference = product.source_type === 'reference';
    const status = isReference ? 'reference' : inventoryMode === 'preorder' ? 'Pre-Order' : product.stock_status || 'In Stock';

    let buttonLabel = 'Add';

    if (activePage === 'upgrade' && upgradeMode === 'reference') buttonLabel = 'Owned';
    if (activePage === 'upgrade' && upgradeMode === 'shop') buttonLabel = 'Upgrade';
    if (inventoryMode === 'preorder') buttonLabel = 'Pre-Order';

    return (
      <div
        key={`${keyPrefix}-${upgradeMode}-${inventoryMode}-${product.id}`}
        className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all"
      >
        <div className={`h-24 bg-gradient-to-br ${getBrandGradient(product.brand)} p-4 text-white`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-black uppercase tracking-widest bg-white/15 px-2 py-1 rounded-full truncate">
              {product.brand || 'OEM'}
            </span>

            <span className={`text-[10px] font-black px-2 py-1 rounded-full border bg-white ${getStockClasses(status)}`}>
              {isReference ? 'Reference' : status}
            </span>
          </div>
        </div>

        <div className="p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            SKU {product.sku_code || product.id || 'N/A'}
          </p>

          <button
            onClick={() => setSelectedProduct(product)}
            className="text-left text-sm font-black text-slate-900 leading-snug mt-2 min-h-[44px] line-clamp-2 hover:text-[#0B63CE]"
          >
            {product.name || 'Unnamed Product'}
          </button>

          <div className="mt-5 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] text-slate-400 font-black uppercase">
                {isReference ? 'Status' : 'Price'}
              </p>
              <p className="text-2xl font-black">
                {isReference || !product.price ? 'Owned' : peso(product.price)}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setSelectedProduct(product)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-[10px] font-black uppercase hover:border-[#0B63CE]"
              >
                Details
              </button>

              {allowAdd && (
                <button
                  onClick={() => handleUpgradeAction(existingCategory || product.category, product)}
                  className="px-3 py-2 rounded-xl bg-slate-950 text-white text-[10px] font-black uppercase hover:bg-[#0B63CE]"
                >
                  {buttonLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCatalogPanel = (mode = 'builder', existingCategory = null) => (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-200">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-[#0B63CE]">
              {activePage === 'upgrade' && upgradeMode === 'reference'
                ? 'Current Parts Reference'
                : activePage === 'upgrade' && upgradeMode === 'shop'
                ? 'Available Shop Upgrades'
                : inventoryMode === 'active'
                ? 'Available Products'
                : 'Pre-Order Catalog'}
            </p>
            <h2 className="text-2xl font-black">{getCategoryLabel(activeTab)}</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full lg:w-[560px]">
            <input
              type="text"
              placeholder="Search model, brand, socket, chipset, or SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold outline-none focus:border-[#11BFD7]"
            />

            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-black outline-none focus:border-[#11BFD7] bg-white"
            >
              {brandsForActiveCategory.map((brand) => (
                <option key={brand} value={brand}>
                  {brand === 'All' ? 'All Brands' : brand}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="p-5 bg-[#fafafa] grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-h-[760px] overflow-y-auto">
        {filteredProducts.length === 0 ? (
          <div className="col-span-full bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
            <p className="font-black text-slate-500 uppercase tracking-widest text-xs">
              No products match your filter
            </p>
          </div>
        ) : (
          filteredProducts.map((product) =>
            renderProductCard(product, true, existingCategory, mode)
          )
        )}
      </div>
    </div>
  );

  const renderCategoryTabs = () => (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
      {CATEGORIES.map((category) => {
        const isActive = activeTab === category;

        return (
          <button
            key={category}
            onClick={() => {
              setActiveTab(category);
              setSelectedBrand('All');
              setSearchQuery('');
            }}
            className={`rounded-2xl border p-4 text-left transition-all ${
              isActive
                ? 'bg-slate-950 text-white border-slate-950 shadow-lg'
                : 'bg-white text-slate-700 border-slate-200 hover:border-[#11BFD7] hover:shadow-md'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-[10px] mb-3 ${
                isActive ? 'bg-[#0B63CE] text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {getShortLabel(category)}
            </div>

            <p className="text-[11px] font-black uppercase tracking-wider">
              {getCategoryLabel(category)}
            </p>

            <p className={`text-[10px] mt-1 ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
              {categoryCounts[category] || 0} items
            </p>
          </button>
        );
      })}
    </div>
  );

  const renderRecommendationPanel = () => (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-5">
        <div className="flex justify-between mb-2">
          <p className="text-sm font-black">Build Completion</p>
          <p className="text-sm font-black">{buildProgress}%</p>
        </div>

        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-[#0B63CE] rounded-full" style={{ width: `${buildProgress}%` }} />
        </div>

        <div className="mt-5 flex justify-between mb-2">
          <p className="text-sm font-black">Compatibility Score</p>
          <p className="text-sm font-black">{compatibilityScore}%</p>
        </div>

        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full ${tone.bar} rounded-full`} style={{ width: `${compatibilityScore}%` }} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-5">
        <p className="text-[11px] font-black uppercase tracking-widest text-blue-600">
          Estimated Use Case
        </p>
        <h3 className="text-2xl font-black mt-2">{performanceTier.label}</h3>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">{performanceTier.description}</p>
      </div>

      <div className={`border rounded-3xl shadow-sm p-5 ${tone.card}`}>
        <div className="flex items-center justify-between gap-3 border-b border-current/10 pb-3">
          <p className="text-[11px] font-black uppercase tracking-widest">
            DSS Compatibility Output
          </p>

          <span className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full ${tone.badge}`}>
            {recommendation.title}
          </span>
        </div>

        <p className="text-sm font-semibold leading-relaxed mt-4 text-slate-700 whitespace-pre-line">
          {recommendation.summary}
        </p>

        {dssIssues.length > 0 && (
          <div className="mt-4 space-y-3">
            {dssIssues.map((issue) => (
              <div key={issue.title} className="bg-white/70 border border-current/10 rounded-2xl p-3">
                <p className="text-xs font-black">{issue.title}</p>
                <p className="text-xs mt-1">{issue.message}</p>
                <p className="text-xs mt-1 font-black">Action: {issue.action}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderBuildSummary = () => (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-5">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-[#0B63CE]">
            Quote Summary
          </p>
          <h2 className="text-xl font-black">Selected Upgrade Parts</h2>
        </div>

        <button
          onClick={handleClearBuild}
          className="text-xs font-black text-slate-400 hover:text-rose-600"
        >
          Clear
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {CATEGORIES.map((category) => {
          const item = selectedBuild[category];

          return (
            <div
              key={category}
              className={`rounded-2xl border p-4 ${
                item ? 'bg-slate-50 border-slate-200' : 'bg-white border-dashed border-slate-200'
              }`}
            >
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {getCategoryLabel(category)}
                  </p>

                  <p className={`mt-1 text-sm font-black truncate ${item ? 'text-slate-900' : 'text-slate-400 italic'}`}>
                    {item ? item.name : `No ${getCategoryLabel(category).toLowerCase()} selected`}
                  </p>
                </div>

                {item ? (
                  <button
                    onClick={() =>
                      setSelectedBuild((prev) => ({
                        ...prev,
                        [category]: null,
                      }))
                    }
                    className="shrink-0 text-slate-400 hover:text-rose-600 font-black"
                  >
                    ×
                  </button>
                ) : (
                  <span className="shrink-0 text-[10px] font-black text-slate-300">
                    EMPTY
                  </span>
                )}
              </div>

              {item && (
                <div className="mt-3 flex items-center justify-between">
                  <span className={`text-[10px] font-black px-2 py-1 rounded-full border ${getStockClasses(item.stock_status)}`}>
                    {item.stock_status || 'In Stock'}
                  </span>

                  <span className="text-sm font-black">{item.price ? peso(item.price) : 'Owned'}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 bg-[#061A3D] text-white rounded-2xl p-5">
        <div className="flex justify-between items-end">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Upgrade Total
            </p>
            <p className="text-[11px] text-[#11BFD7] font-bold mt-1">
              VAT included estimate
            </p>
          </div>

          <p className="text-3xl font-black text-emerald-400">{peso(totalPrice)}</p>
        </div>

        <div className="mt-4 pt-4 border-t border-white/10 flex justify-between">
          <span className="text-[11px] text-slate-400 font-bold">12-month estimate</span>
          <span className="text-sm font-black">{peso(monthlyEstimate)}</span>
        </div>
      </div>
    </div>
  );

  const renderOwnedPcSummary = () => (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-5">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-[#0B63CE]">
            Customer Current PC
          </p>
          <h2 className="text-xl font-black">Owned Parts</h2>
        </div>

        <button
          onClick={handleClearExistingPc}
          className="text-xs font-black text-slate-400 hover:text-rose-600"
        >
          Clear
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {CATEGORIES.map((category) => {
          const item = existingPc[category];

          return (
            <div
              key={category}
              className={`rounded-2xl border p-4 ${
                item ? 'bg-[#E6FAFD] border-cyan-100' : 'bg-white border-dashed border-slate-200'
              }`}
            >
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Current {getCategoryLabel(category)}
              </p>
              <p className={`mt-1 text-sm font-black truncate ${item ? 'text-slate-900' : 'text-slate-400 italic'}`}>
                {item ? item.name : 'Not selected'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderHomePage = () => {
    const featured = CATEGORIES.map((category) => {
      return activeProducts
        .filter((product) => product.category === category && product.stock_status !== 'Sold Out')
        .sort((a, b) => Number(b.hardware_score || 0) - Number(a.hardware_score || 0))[0];
    })
      .filter(Boolean)
      .slice(0, 8);

    return (
      <div className="space-y-10">
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-[#061A3D] rounded-3xl p-8 sm:p-12 text-white overflow-hidden relative">
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,#11BFD7,transparent_35%)]"></div>

            <div className="relative max-w-3xl">
              <p className="text-[#11BFD7] text-xs font-black uppercase tracking-widest">
                ByteBuild PC Store
              </p>

              <h2 className="mt-4 text-4xl sm:text-6xl font-black tracking-tight leading-tight">
                Build, upgrade, and quote your next PC.
              </h2>

              <p className="mt-5 text-slate-300 leading-relaxed max-w-2xl">
                Shop available parts, request pre-order components, check compatibility, and get practical build recommendations.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  onClick={() => setActivePage('builder')}
                  className="bg-[#0B63CE] hover:bg-[#083B7A] px-6 py-3 rounded-xl font-black"
                >
                  Start PC Builder
                </button>

                <button
                  onClick={() => setActivePage('upgrade')}
                  className="bg-white/10 hover:bg-white/15 border border-white/10 px-6 py-3 rounded-xl font-black"
                >
                  Check Upgrade
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 grid grid-cols-1 gap-4">
            {[
              ['Free Basic Assembly', 'Available for selected complete system builds.'],
              ['Student Build Bundle', 'Budget-friendly PC options for school and office work.'],
              ['Upgrade Consultation', 'Check customer-owned PCs before buying new parts.'],
            ].map(([title, body]) => (
              <div key={title} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                <p className="text-[11px] font-black uppercase tracking-widest text-[#0B63CE]">Promo</p>
                <h3 className="text-2xl font-black mt-2">{title}</h3>
                <p className="text-sm text-slate-600 mt-2">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            [activeProducts.length, 'Active Items'],
            [CATEGORIES.length, 'Part Categories'],
            [preorderProducts.length, 'Pre-Order Items'],
            [referenceParts.length, 'Reference Parts'],
          ].map(([value, label]) => (
            <div key={label} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
              <p className="text-3xl font-black text-slate-950">{value}</p>
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 mt-2">{label}</p>
            </div>
          ))}
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-black">Shop by Category</h2>
            <button onClick={() => setActivePage('products')} className="text-sm font-black text-[#0B63CE]">
              View all products
            </button>
          </div>

          {renderCategoryTabs()}
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-black">Featured Products</h2>
            <button onClick={() => setActivePage('products')} className="text-sm font-black text-[#0B63CE]">
              Browse catalog
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {featured.map((product) => renderProductCard(product, true, null, 'featured'))}
          </div>
        </section>
      </div>
    );
  };

  const renderProductsPage = () => (
    <div className="space-y-6">
      {activePage !== 'upgrade' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setInventoryMode('active')}
            className={`flex-1 rounded-2xl px-5 py-4 text-left border ${
              inventoryMode === 'active'
                ? 'bg-[#0B63CE] text-white border-[#0B63CE]'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <p className="text-sm font-black uppercase">Available Products</p>
            <p className="text-xs opacity-80 mt-1">{activeProducts.length} active items</p>
          </button>

          <button
            onClick={() => setInventoryMode('preorder')}
            className={`flex-1 rounded-2xl px-5 py-4 text-left border ${
              inventoryMode === 'preorder'
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <p className="text-sm font-black uppercase">Pre-Order Products</p>
            <p className="text-xs opacity-80 mt-1">{preorderProducts.length} high-end items</p>
          </button>
        </div>
      )}

      {renderCategoryTabs()}
      {renderCatalogPanel('products')}
    </div>
  );

  const renderBuilderPage = () => (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-8 space-y-6">{renderProductsPage()}</div>

      <aside className="lg:col-span-4 space-y-5 lg:sticky lg:top-28">
        {renderBuildSummary()}
        {renderRecommendationPanel()}
      </aside>
    </section>
  );

  const renderUpgradePage = () => (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-8 space-y-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-5">
          <div className="flex justify-between items-center mb-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-[#0B63CE]">
                Upgrade Checker
              </p>
              <h2 className="text-2xl font-black">Current PC and Upgrade Parts</h2>
              <p className="text-sm text-slate-500 mt-1">
                Select owned parts from the reference list, then select available shop upgrades.
              </p>
            </div>

            <button
              onClick={handleClearExistingPc}
              className="text-xs font-black text-slate-400 hover:text-red-600"
            >
              Clear Owned Parts
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CATEGORIES.map((category) => (
              <div key={category} className="border border-slate-200 rounded-2xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Current {getCategoryLabel(category)}
                </p>
                <p className="text-sm font-black mt-1 truncate">
                  {existingPc[category]?.name || 'Not selected'}
                </p>
                <button
                  onClick={() => {
                    setUpgradeMode('reference');
                    setActiveTab(category);
                    setSelectedBrand('All');
                    setSearchQuery('');
                  }}
                  className="mt-3 text-xs font-black text-[#0B63CE]"
                >
                  Select owned part
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => {
              setUpgradeMode('reference');
              setSelectedBrand('All');
              setSearchQuery('');
            }}
            className={`rounded-2xl px-5 py-4 text-left border ${
              upgradeMode === 'reference'
                ? 'bg-slate-950 text-white border-slate-950'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <p className="text-sm font-black uppercase">Current Parts Reference</p>
            <p className="text-xs opacity-80 mt-1">Select parts the customer already owns</p>
          </button>

          <button
            onClick={() => {
              setUpgradeMode('shop');
              setSelectedBrand('All');
              setSearchQuery('');
            }}
            className={`rounded-2xl px-5 py-4 text-left border ${
              upgradeMode === 'shop'
                ? 'bg-[#0B63CE] text-white border-[#0B63CE]'
                : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            <p className="text-sm font-black uppercase">Available Shop Upgrades</p>
            <p className="text-xs opacity-80 mt-1">Select parts ByteBuild can sell as upgrades</p>
          </button>
        </div>

        {renderCategoryTabs()}
        {renderCatalogPanel('upgrade', activeTab)}
      </div>

      <aside className="lg:col-span-4 space-y-5 lg:sticky lg:top-28">
        {renderOwnedPcSummary()}
        {renderBuildSummary()}
        {renderRecommendationPanel()}
      </aside>
    </section>
  );

  const renderSmartAssistantPage = () => (
    <div className="space-y-6">
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-3xl p-6">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#0B63CE]">
            Smart Build Assistant
          </p>
          <h2 className="text-3xl font-black mt-2">Compare build options</h2>
          <p className="text-sm text-slate-600 mt-2">
            Generates compatible build variations using socket, RAM type, and PSU checks.
          </p>

          <div className="mt-6 space-y-4">
            <input
              value={assistantForm.budget}
              onChange={(e) =>
                setAssistantForm((prev) => ({
                  ...prev,
                  budget: e.target.value,
                }))
              }
              placeholder="Budget"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold"
            />

            <select
              value={assistantForm.purpose}
              onChange={(e) =>
                setAssistantForm((prev) => ({
                  ...prev,
                  purpose: e.target.value,
                }))
              }
              className="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold bg-white"
            >
              <option>Gaming</option>
              <option>Office</option>
              <option>Editing</option>
              <option>School</option>
            </select>

            <select
              value={assistantForm.preference}
              onChange={(e) =>
                setAssistantForm((prev) => ({
                  ...prev,
                  preference: e.target.value,
                }))
              }
              className="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold bg-white"
            >
              <option>Best Value</option>
              <option>AMD Preference</option>
              <option>Intel Preference</option>
              <option>Budget First</option>
            </select>
          </div>
        </div>

        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-3xl p-6">
          <p className="text-[11px] font-black uppercase tracking-widest text-blue-600">
            Recommendation Variations
          </p>
          <h2 className="text-3xl font-black mt-2">Suggested Complete Builds</h2>
          <p className="text-sm text-slate-600 mt-2">
            Each recommendation is generated with platform compatibility checks before showing it to the customer.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {smartAssistantOptions.map((option) => (
          <div key={option.label} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-[#0B63CE]">
                  {option.strategy}
                </p>
                <h3 className="text-2xl font-black mt-1">{option.label}</h3>
                <p className="text-sm text-slate-600 mt-2">{option.description}</p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-[10px] font-black uppercase text-slate-400">Total</p>
                <p className="text-2xl font-black">{peso(option.total)}</p>
                <p className="text-[10px] font-black uppercase text-slate-400 mt-2">Score {option.score}/100</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              {CATEGORIES.map((category) => {
                const part = option.build[category];

                return (
                  <div key={category} className="border border-slate-200 rounded-2xl p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {getCategoryLabel(category)}
                    </p>
                    <p className="text-sm font-black mt-1 line-clamp-2">
                      {part?.name || 'No part selected'}
                    </p>
                    {part && <p className="text-sm font-black text-[#0B63CE] mt-2">{peso(part.price)}</p>}
                  </div>
                );
              })}
            </div>

            <div className="mt-5 border border-slate-200 rounded-2xl p-4 bg-slate-50">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Compatibility Check
              </p>
              <p className="text-sm text-slate-700 mt-2">{option.warning}</p>
            </div>

            <button
              onClick={() => handleUseSuggestedBuild(option.build)}
              className="mt-5 w-full bg-[#061A3D] text-white rounded-xl px-4 py-3 font-black hover:bg-[#0B63CE]"
            >
              Use This Build
            </button>
          </div>
        ))}
      </section>
    </div>
  );

  const renderPromosPage = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      {[
        ['Free Basic Assembly', 'Complete system builds may qualify for free basic assembly.'],
        ['Student Budget Build', 'Entry-level package for school, office, and browsing.'],
        ['Gaming Starter Bundle', 'Recommended CPU, board, RAM, and GPU combo.'],
        ['SSD + RAM Upgrade', 'For older PCs needing faster boot and smoother multitasking.'],
        ['Pre-Order High-End Parts', 'Supplier confirmation required before final quotation.'],
        ['Maintenance Check', 'Optional cleaning and cable management service.'],
      ].map(([title, body]) => (
        <div key={title} className="bg-white border border-slate-200 rounded-3xl p-6">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#0B63CE]">Promo</p>
          <h3 className="text-2xl font-black mt-2">{title}</h3>
          <p className="text-sm text-slate-600 mt-2">{body}</p>
        </div>
      ))}
    </div>
  );

  const renderLoginPage = () => (
    <div className="max-w-xl mx-auto bg-white border border-slate-200 rounded-3xl p-8">
      <p className="text-[11px] font-black uppercase tracking-widest text-[#0B63CE]">
        Customer Account
      </p>
      <h2 className="text-3xl font-black mt-2">Login</h2>
      <p className="text-sm text-slate-600 mt-2">
        Placeholder screen for customer accounts, saved builds, quotation history, and pre-order requests.
      </p>

      <div className="mt-6 space-y-4">
        <input
          placeholder="Email address"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold"
        />
        <input
          placeholder="Password"
          type="password"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold"
        />
        <button className="w-full bg-[#061A3D] text-white rounded-xl px-4 py-3 font-black hover:bg-[#0B63CE]">
          Sign In
        </button>
      </div>
    </div>
  );

  const renderProductModal = () => {
    if (!selectedProduct) return null;

    const product = selectedProduct;
    const category = product.category;
    const cpu = getCpuProfile(product);
    const gpu = getGpuProfile(product);
    const ram = getRamProfile(product);
    const storage = getStorageProfile(product);
    const psu = getPsuProfile(product);
    const cooler = getCoolerProfile(product);
    const pcCase = getCaseProfile(product);

    let generatedNote = 'General component for standard PC builds.';

    if (category === 'Processors') {
      generatedNote = `${cpu.label}. Socket: ${product.socket || detectCpuSocket(product) || 'Unknown'}. Estimated TDP: ${cpu.watts || product.tdp || 'Unknown'}W.`;
    }

    if (category === 'Motherboards') {
      generatedNote = `Motherboard platform. Socket: ${product.socket || detectMotherboardSocket(product) || 'Unknown'}. Chipset: ${product.chipset || 'Unknown'}. Memory type: ${product.memory_type || 'Unknown'}.`;
    }

    if (category === 'Video Cards') {
      generatedNote = `${gpu.label}. Estimated board power: ${gpu.watts || product.wattage || 'Unknown'}W.`;
    }

    if (category === 'Memory') {
      generatedNote = `Memory kit. Capacity: ${product.capacity || `${ram.capacity || 'Unknown'}GB`}. Type: ${ram.type}.`;
    }

    if (category === 'Storage') {
      generatedNote = `Storage device. Capacity: ${product.capacity || 'Unknown'}. Interface: ${product.interface_type || storage.interfaceType}.`;
    }

    if (category === 'Power Supplies') {
      generatedNote = `Power supply. Wattage: ${psu.watts || 'Unknown'}W. Efficiency rating detected: ${psu.rating}.`;
    }

    if (category === 'CPU Coolers') {
      generatedNote = `${cooler.label}. Check CPU socket support and case clearance before installation.`;
    }

    if (category === 'Cases') {
      generatedNote = `PC case. Form factor support: ${product.form_factor || pcCase.formFactor}. Airflow estimate: ${
        pcCase.airflow ? 'Good airflow design' : 'Check fan support and airflow before high-power builds'
      }.`;
    }

    return (
      <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
        <div className="bg-white max-w-3xl w-full rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-[#0B63CE]">
                Product Details
              </p>
              <h2 className="text-2xl font-black mt-1">{product.name}</h2>
            </div>
            <button
              onClick={() => setSelectedProduct(null)}
              className="text-2xl font-black text-slate-400 hover:text-red-600"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            {[
              ['Brand', product.brand || 'OEM'],
              ['Category', getCategoryLabel(product.category)],
              ['Hardware Score', `${product.hardware_score || 70}/100`],
              ['Price', product.price ? peso(product.price) : 'Reference Part'],
              ['Socket', product.socket || 'N/A'],
              ['Chipset', product.chipset || 'N/A'],
              ['Memory Type', product.memory_type || 'N/A'],
              ['Form Factor', product.form_factor || 'N/A'],
              ['Wattage', product.wattage ? `${product.wattage}W` : 'N/A'],
              ['TDP', product.tdp ? `${product.tdp}W` : 'N/A'],
              ['Capacity', product.capacity || 'N/A'],
              ['Interface', product.interface_type || 'N/A'],
            ].map(([label, value]) => (
              <div key={label} className="border border-slate-200 rounded-2xl p-4">
                <p className="text-[10px] font-black uppercase text-slate-400">{label}</p>
                <p className="font-black mt-1">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-slate-400">Specifications</p>
            <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">
              {product.specs || generatedNote}
            </p>
          </div>

          <div className="mt-5 border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-slate-400">Recommended Pairing</p>
            <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">
              {product.recommended_pairing ||
                'Pair with compatible motherboard, 16GB RAM minimum, SSD storage, and PSU based on total system power requirement.'}
            </p>
          </div>

          <div className="mt-5 border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-slate-400">Notes</p>
            <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">
              {product.notes || 'No additional notes available.'}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderFooter = () => (
    <footer className="mt-16 bg-[#061A3D] text-white">
      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 md:grid-cols-4 gap-10">
        <div>
          <h3 className="font-black uppercase mb-4">Customer Service</h3>
          <p className="text-sm text-blue-100">Help Center</p>
          <p className="text-sm text-blue-100 mt-2">Build Inquiry</p>
          <p className="text-sm text-blue-100 mt-2">Warranty Assistance</p>
          <p className="text-sm text-blue-100 mt-2">Return Policy</p>
        </div>

        <div>
          <h3 className="font-black uppercase mb-4">My Account</h3>
          <p className="text-sm text-blue-100">Login / Register</p>
          <p className="text-sm text-blue-100 mt-2">Saved Builds</p>
          <p className="text-sm text-blue-100 mt-2">Quotation History</p>
          <p className="text-sm text-blue-100 mt-2">Pre-Order Requests</p>
        </div>

        <div>
          <h3 className="font-black uppercase mb-4">Tools</h3>
          <p className="text-sm text-blue-100">PC Builder</p>
          <p className="text-sm text-blue-100 mt-2">Upgrade Checker</p>
          <p className="text-sm text-blue-100 mt-2">Smart Build Assistant</p>
          <p className="text-sm text-blue-100 mt-2">Compatibility Check</p>
        </div>

        <div>
          <h3 className="font-black uppercase mb-4">ByteBuild</h3>
          <p className="text-sm text-blue-100">
            PC configuration, upgrade advisory, quotation, and inventory-based recommendations for small computer retailers.
          </p>
        </div>
      </div>

      <div className="bg-white text-slate-700">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-5 text-xs flex flex-col sm:flex-row justify-between gap-3">
          <span>© 2026 ByteBuild. All rights reserved.</span>
          <span>Terms & Conditions · Privacy Policy · Quality-checked records</span>
        </div>
      </div>
    </footer>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#0B63CE] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-xs font-black tracking-widest text-slate-500 uppercase">
            Loading ByteBuild catalog
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-slate-950">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="bg-[#061A3D] text-white text-[11px] font-bold">
          <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap justify-between gap-2">
            <span>Quality-checked product records</span>
            <span>ISO-aligned inventory workflow</span>
            <span>Secure data handling</span>
          </div>
        </div>

        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-20 flex items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img
                src={bbLogo}
                alt="ByteBuild Logo"
                className="h-14 w-auto object-contain"
              />

              <div>
                <h1 className="text-2xl font-black tracking-tight text-[#083B7A]">BYTEBUILD</h1>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#0B63CE]">
                  Intelligent PC Builder and Product Quotation
                </p>
              </div>
            </div>

            <nav className="hidden xl:flex items-center gap-2">
              {renderPageButton('home', 'Home')}
              {renderPageButton('products', 'Products')}
              {renderPageButton('builder', 'PC Builder')}
              {renderPageButton('upgrade', 'Upgrade Checker')}
              {renderPageButton('preorder', 'Pre-Order')}
              {renderPageButton('assistant', 'Smart Assistant')}
              {renderPageButton('promos', 'Promos')}
            </nav>

            <button
              onClick={() => setActivePage('login')}
              className="bg-[#061A3D] text-white px-4 py-2 rounded-xl text-xs font-black uppercase hover:bg-[#0B63CE]"
            >
              Login
            </button>
          </div>

          <div className="xl:hidden flex gap-2 overflow-x-auto pb-3">
            {renderPageButton('home', 'Home')}
            {renderPageButton('products', 'Products')}
            {renderPageButton('builder', 'Builder')}
            {renderPageButton('upgrade', 'Upgrade')}
            {renderPageButton('preorder', 'Pre-Order')}
            {renderPageButton('assistant', 'Assistant')}
            {renderPageButton('promos', 'Promos')}
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activePage === 'home' && renderHomePage()}
        {activePage === 'products' && renderProductsPage()}
        {activePage === 'builder' && renderBuilderPage()}
        {activePage === 'upgrade' && renderUpgradePage()}
        {activePage === 'preorder' && renderProductsPage()}
        {activePage === 'assistant' && renderSmartAssistantPage()}
        {activePage === 'promos' && renderPromosPage()}
        {activePage === 'login' && renderLoginPage()}
      </main>

      {renderFooter()}
      {renderProductModal()}
    </div>
  );
}