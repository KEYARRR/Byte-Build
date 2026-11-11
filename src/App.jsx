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

const ADMIN_EMAILS = [
  'admin@bytebuild.ph',
  'kenneth@bytebuild.ph',
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

const DEFAULT_DSS_RULES = {
  psuBufferWatts: 120,
  minRecommendedRamGB: 16,
  minStorageCapacityGB: 500,
  maxAllowedTierGap: 2,
  gamingGpuWeight: 36,
  gamingCpuWeight: 21,
  creatorGpuWeight: 29,
  creatorCpuWeight: 27,
};

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

const detectPartFormFactor = (part) => {
  const raw = `${part?.form_factor || ''} ${part?.name || ''} ${part?.specs || ''}`.toUpperCase();
  if (raw.includes('MINI-ITX') || raw.includes('ITX')) return 'Mini-ITX';
  if (raw.includes('MICRO-ATX') || raw.includes('M-ATX') || raw.includes('MATX')) return 'Micro-ATX';
  if (raw.includes('E-ATX') || raw.includes('EATX')) return 'E-ATX';
  if (raw.includes('ATX')) return 'ATX';
  return 'Standard';
};

const getCpuProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  const tdpFromDb = Number(part?.tdp || 0);
  const score = Number(part?.hardware_score || 0);
  if (!name) return { tier: 0, label: 'No CPU Selected', watts: 0, coolerNeed: 0 };
  if (name.includes('ATHLON') || name.includes('200GE') || name.includes('3000G')) {
    return { tier: 1, label: 'Entry APU', watts: tdpFromDb || 35, coolerNeed: 1 };
  }
  if (name.includes('2200G') || name.includes('3200G') || name.includes('3400G')) {
    return { tier: 2, label: 'Entry APU', watts: tdpFromDb || 65, coolerNeed: 1 };
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
    return { tier: 5, label: 'Performance CPU', watts: tdpFromDb || 140, coolerNeed: 3 };
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
    return { tier: 6, label: 'Enthusiast Workstation CPU', watts: tdpFromDb || 180, coolerNeed: 4 };
  }
  return {
    tier: score >= 85 ? 5 : score >= 75 ? 4 : score >= 60 ? 3 : 2,
    label: 'Standard Processor',
    watts: tdpFromDb || 80,
    coolerNeed: score >= 80 ? 3 : 2,
  };
};

const getGpuProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  const wattsFromDb = Number(part?.wattage || part?.tdp || 0);
  const score = Number(part?.hardware_score || 0);
  if (!name) return { tier: 0, label: 'No GPU Selected', watts: 0 };
  if (name.includes('5090') || name.includes('4090') || name.includes('7900 XTX')) {
    return { tier: 6, label: 'Extreme 4K GPU', watts: wattsFromDb || 450 };
  }
  if (name.includes('5080') || name.includes('4080') || name.includes('7900 XT')) {
    return { tier: 5, label: 'High-End 1440p/4K GPU', watts: wattsFromDb || 350 };
  }
  if (
    name.includes('5070') ||
    name.includes('4070') ||
    name.includes('7800 XT') ||
    name.includes('B580')
  ) {
    return { tier: 4, label: 'Upper Mid-Range GPU', watts: wattsFromDb || 250 };
  }
  if (
    name.includes('5060') ||
    name.includes('4060') ||
    name.includes('7600') ||
    name.includes('RX 6600') ||
    name.includes('ARC A750') ||
    name.includes('2070 SUPER')
  ) {
    return { tier: 3, label: '1080p Mainstream GPU', watts: wattsFromDb || 180 };
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
    label: 'Dedicated Graphics',
    watts: wattsFromDb || 180,
  };
};

const getMotherboardProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  const socket = detectMotherboardSocket(part);
  const isITX = name.includes('ITX') || name.includes('MINI-ITX');
  const isMATX = name.includes('M-ATX') || name.includes('MATX') || name.includes('M ');
  const formFactor = isITX ? 'Mini-ITX' : isMATX ? 'Micro-ATX' : 'ATX';
  const dimmSlots = isITX ? 2 : (name.includes('PRO-VDH') || name.includes('M-K') || name.includes('PRIME A')) && isMATX ? 2 : 4;
  let tier = 'Entry';
  if (name.includes('Z690') || name.includes('Z790') || name.includes('X670') || name.includes('X870')) {
    tier = 'Enthusiast';
  } else if (name.includes('B550') || name.includes('B650') || name.includes('B760') || name.includes('B850') || name.includes('B660')) {
    tier = 'Mainstream';
  }
  const memoryType =
    part?.memory_type ||
    (name.includes('DDR5') || socket === 'AM5' ? 'DDR5' : 'DDR4');
  return { socket, formFactor, dimmSlots, tier, memoryType };
};

const getRamProfile = (part, userCount = null) => {
  const name = String(part?.name || '').toUpperCase();
  const capacityText = String(part?.capacity || '').toUpperCase();
  const dualPackMatch = `${name} ${capacityText}`.match(/(\d+)\s*X\s*(\d+)\s*GB/);
  const singleMatch = `${name} ${capacityText}`.match(/(\d+)\s*GB/);
  let perStickCapacity = 0;
  let packMultiplier = 1;
  if (dualPackMatch) {
    packMultiplier = Number(dualPackMatch[1]);
    perStickCapacity = Number(dualPackMatch[2]);
  } else if (singleMatch) {
    perStickCapacity = Number(singleMatch[1]);
  }
  const finalStickCount = userCount !== null ? userCount : packMultiplier;
  const totalCapacity = perStickCapacity * finalStickCount;
  return {
    perStickCapacity,
    stickCount: finalStickCount,
    hasChosenSticks: userCount !== null,
    totalCapacity,
    isSingleChannel: finalStickCount === 1,
    isDualChannel: finalStickCount === 2,
    isQuadChannelOrPopulated: finalStickCount >= 4,
    type:
      part?.memory_type ||
      (name.includes('DDR5') ? 'DDR5' : name.includes('DDR4') ? 'DDR4' : 'Unknown'),
  };
};

const getStorageProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  const capacityText = String(part?.capacity || '').toUpperCase();
  const isNvmeGen4 = name.includes('GEN4') || name.includes('PCIE 4') || name.includes('SN770') || name.includes('SN850') || name.includes('980 PRO') || name.includes('990 PRO') || name.includes('KC3000');
  const isNvmeGen3 = name.includes('GEN3') || name.includes('SN570') || name.includes('SN580') || name.includes('970 EVO') || name.includes('MP33') || name.includes('P3');
  const isSataSsd = name.includes('SATA') || (name.includes('SSD') && !name.includes('NVME') && !name.includes('M.2'));
  const isHdd = name.includes('HDD') || name.includes('BARRACUDA') || (name.includes('BLUE') && name.includes('RPM'));
  let driveClass = isNvmeGen4 ? 'Gen4 NVMe' : isNvmeGen3 ? 'Gen3 NVMe' : isSataSsd ? 'SATA SSD' : isHdd ? 'Mechanical HDD' : 'Standard SSD';
  const gbMatch = `${name} ${capacityText}`.match(/(\d+)\s*GB/);
  const tbMatch = `${name} ${capacityText}`.match(/(\d+)\s*TB/);
  const capacityGB = tbMatch ? Number(tbMatch[1]) * 1000 : gbMatch ? Number(gbMatch[1]) : 500;
  return {
    capacityGB,
    driveClass,
    isHdd,
    isSataSsd,
    isSlowPrimary: isHdd || isSataSsd,
    isTightCapacity: capacityGB < 500,
  };
};

const getPsuProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  const wattMatch = name.match(/(\d{3,4})\s*W/);
  const watts = Number(part?.wattage || 0) || (wattMatch ? Number(wattMatch[1]) : 0);
  const rating = name.includes('GOLD')
    ? '80+ Gold'
    : name.includes('BRONZE')
    ? '80+ Bronze'
    : name.includes('WHITE')
    ? '80+ White'
    : 'Unrated / Generic';
  return { watts, rating, isGeneric: rating === 'Unrated / Generic' };
};

const getCoolerProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  if (!name) return { tier: 0, label: 'Stock Cooler' };
  if (name.includes('360')) return { tier: 4, label: '360mm AIO Liquid Cooler' };
  if (name.includes('240')) return { tier: 3, label: '240mm AIO Liquid Cooler' };
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
  return { tier: 2, label: 'Standard Air Cooler' };
};

const getCaseProfile = (part) => {
  const name = String(part?.name || '').toUpperCase();
  return {
    airflow:
      name.includes('MESH') ||
      name.includes('AIR') ||
      name.includes('FLOW') ||
      name.includes('FAN'),
    formFactor: part?.form_factor || 'mATX / ATX',
  };
};

function ByteBuildGlobalStyles() {
  return (
    <style>{`
      :root {
        color-scheme: dark;
        background: #0b0f19;
      }
      html,
      body,
      #root {
        min-height: 100%;
        margin: 0;
        background: #0b0f19 !important;
        color: #f1f5f9;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      input,
      select,
      textarea {
        color-scheme: dark;
      }
      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      ::-webkit-scrollbar-track {
        background: #0b0f19;
      }
      ::-webkit-scrollbar-thumb {
        background: #2563eb;
        border-radius: 4px;
      }
      @keyframes appViewTransition {
        0% {
          opacity: 0.94;
          transform: translateY(6px);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .app-view-container {
        animation: appViewTransition 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
        will-change: transform, opacity;
      }
      @media print {
        @page {
          size: A4 portrait;
          margin: 12mm 15mm;
        }
        body, html, #root {
          background: #ffffff !important;
          color: #0f172a !important;
          font-size: 9pt !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        header,
        footer,
        nav,
        aside > div:last-child,
        button,
        input,
        select,
        .print\\:hidden,
        main > section > div:first-child,
        .mobile-bottom-bar {
          display: none !important;
        }
        aside {
          width: 100% !important;
          position: static !important;
          display: block !important;
        }
        #printable-quotation {
          display: block !important;
          position: static !important;
          width: 100% !important;
          background: #ffffff !important;
          color: #0f172a !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
          margin: 0 !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        #printable-quotation .print-table-wrapper {
          display: table !important;
          width: 100% !important;
          border-collapse: collapse !important;
          border-spacing: 0 !important;
        }
        #printable-quotation .print-table-row {
          display: table-row !important;
          border: none !important;
          background: transparent !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        #printable-quotation .print-table-row:nth-child(even) {
          background-color: #f8fafc !important;
        }
        #printable-quotation .print-cell-name {
          display: table-cell !important;
          padding: 6px 8px !important;
          border-bottom: 1px solid #e2e8f0 !important;
          vertical-align: middle !important;
          width: 70% !important;
        }
        #printable-quotation .print-cell-price {
          display: table-cell !important;
          padding: 6px 8px !important;
          border-bottom: 1px solid #e2e8f0 !important;
          vertical-align: middle !important;
          text-align: right !important;
          width: 30% !important;
        }
        #printable-quotation .print-price {
          font-size: 9.5pt !important;
          font-weight: 700 !important;
          font-family: monospace !important;
          color: #0f172a !important;
          display: inline-block !important;
          min-width: 80px !important;
          text-align: right !important;
        }
        #printable-quotation p,
        #printable-quotation span {
          color: #1e293b !important;
        }
        #printable-quotation .print-summary-box {
          background: #ffffff !important;
          border: 1px solid #cbd5e1 !important;
          color: #0f172a !important;
          margin-top: 14px !important;
          padding: 10px 14px !important;
          border-radius: 6px !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        #printable-quotation .print-total {
          color: #1e3a8a !important;
          font-size: 15pt !important;
          font-weight: 900 !important;
          font-family: monospace !important;
        }
      }
    `}</style>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState('home');
  const [activeProducts, setActiveProducts] = useState([]);
  const [preorderProducts, setPreorderProducts] = useState([]);
  const [referenceParts, setReferenceParts] = useState([]);
  const [inventoryMode, setInventoryMode] = useState('active');
  const [upgradeMode, setUpgradeMode] = useState('reference');
  const [activeTab, setActiveTab] = useState('Processors');

  // Search & Extended Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedFormFactor, setSelectedFormFactor] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortBy, setSortBy] = useState('price-asc');

  // Smart Build Assistant States
  const [assistantBudget, setAssistantBudget] = useState(40000);
  const [assistantProfile, setAssistantProfile] = useState('Gaming');
  const [assistantStatus, setAssistantStatus] = useState('');

  // Dynamic Rule-Based DSS Parameters
  const [dssRules, setDssRules] = useState(() => {
    try {
      const saved = localStorage.getItem('bytebuild_dss_rules');
      return saved ? { ...DEFAULT_DSS_RULES, ...JSON.parse(saved) } : DEFAULT_DSS_RULES;
    } catch {
      return DEFAULT_DSS_RULES;
    }
  });

  const [selectedBuild, setSelectedBuild] = useState(INITIAL_BUILD);
  const [existingPc, setExistingPc] = useState(INITIAL_EXISTING_PC);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [existingRamCount, setExistingRamCount] = useState(null);
  const [selectedRamCount, setSelectedRamCount] = useState(2);

  const printReferenceId = useMemo(() => Math.floor(100000 + Math.random() * 900000), []);
  const printDateString = useMemo(
    () => new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }),
    []
  );

  // Authentication & Password Recovery State
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [forgotEmailSent, setForgotEmailSent] = useState(false);

  // Saved Builds & Quotation Export State
  const [savedBuilds, setSavedBuilds] = useState([]);
  const [savingBuild, setSavingBuild] = useState(false);
  const [exportingQuote, setExportingQuote] = useState(false);

  // Pre-Order Workflow State
  const [preorderModalItem, setPreorderModalItem] = useState(null);
  const [userPreorders, setUserPreorders] = useState([]);
  const [preorderForm, setPreorderForm] = useState({
    customer_name: '',
    contact_number: '',
    email: '',
  });
  const [preorderSubmitting, setPreorderSubmitting] = useState(false);

  // Hidden Administrator Module States
  const [logoTapCount, setLogoTapCount] = useState(0);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [adminSection, setAdminSection] = useState('catalog');
  const [adminTableSource, setAdminTableSource] = useState('active');
  const [adminCategoryFilter, setAdminCategoryFilter] = useState('All');
  const [adminSearch, setAdminSearch] = useState('');
  const [adminQuotations, setAdminQuotations] = useState([]);
  const [adminAllPreorders, setAdminAllPreorders] = useState([]);
  const [adminSaving, setAdminSaving] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [newItemForm, setNewItemForm] = useState({
    name: '',
    brand: '',
    category: 'Processors',
    price: '',
    stock_status: 'In Stock',
    socket: '',
    memory_type: '',
    form_factor: '',
    hardware_score: 78,
    specs: '',
  });

  const isAdminAccount = useMemo(() => {
    if (!currentUser?.email) return false;
    return ADMIN_EMAILS.includes(currentUser.email.toLowerCase());
  }, [currentUser]);

  // Secret Keyboard Shortcut (Ctrl + Shift + A) to open Admin Lock screen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setActivePage('admin');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Secret 5-Tap Logo Handler (Works on Mobile APK & Desktop)
  const handleLogoClick = () => {
    setActivePage('home');
    setLogoTapCount((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        setActivePage('admin');
        return 0;
      }
      return next;
    });
  };

  // Dedicated Admin Logout / Lock Handler
  const handleAdminLogout = () => {
    setAdminUnlocked(false);
    setAdminPinInput('');
    setEditingItem(null);
    setActivePage('home');
  };

  // URL Hash Recovery Guard & Auth State Listener
  useEffect(() => {
    const checkRecoveryState = () => {
      const hash = window.location.hash;
      if (hash && (hash.includes('type=recovery') || hash.includes('access_token'))) {
        setActivePage('login');
        setAuthMode('update-password');
        return true;
      }
      return false;
    };

    const isRecovery = checkRecoveryState();

    if (!isRecovery) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setCurrentUser(session?.user ?? null);
        if (session?.user?.email) {
          setPreorderForm((prev) => ({ ...prev, email: session.user.email }));
        }
      });
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY' || window.location.hash.includes('type=recovery')) {
        setActivePage('login');
        setAuthMode('update-password');
      } else if (!window.location.hash.includes('type=recovery')) {
        setCurrentUser(session?.user ?? null);
        if (session?.user?.email) {
          setPreorderForm((prev) => ({ ...prev, email: session.user.email }));
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchInventory = useCallback(async () => {
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
      console.error('Database Sync Error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const fetchUserData = useCallback(async () => {
    if (!currentUser) {
      setSavedBuilds([]);
      setUserPreorders([]);
      return;
    }

    try {
      const { data: builds, error: buildsErr } = await supabase
        .from('bytebuild_saved_builds')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (!buildsErr && builds) setSavedBuilds(builds);

      const { data: orders, error: ordersErr } = await supabase
        .from('bytebuild_preorder_requests')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (!ordersErr && orders) setUserPreorders(orders);
    } catch (err) {
      console.error('User Records Sync Error:', err.message);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  const fetchAdminLogs = useCallback(async () => {
    try {
      const { data: quotes } = await supabase
        .from('bytebuild_quotations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (quotes) setAdminQuotations(quotes);
    } catch (_) {
      // Optional table
    }

    try {
      const { data: preorders } = await supabase
        .from('bytebuild_preorder_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (preorders) setAdminAllPreorders(preorders);
    } catch (_) {
      // Optional table
    }
  }, []);

  useEffect(() => {
    if (activePage === 'admin') {
      fetchAdminLogs();
    }
  }, [activePage, fetchAdminLogs]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      if (authMode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        if (data?.user) {
          setCurrentUser(data.user);
          setActivePage('home');
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        if (data?.user) {
          setCurrentUser(data.user);
          setActivePage('home');
        }
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePasswordReset = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(authEmail, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setForgotEmailSent(true);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      alert('Password updated successfully! You can now sign in with your new password.');
      
      window.location.hash = '';
      await supabase.auth.signOut();
      setCurrentUser(null);

      setAuthMode('login');
      setNewPassword('');
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setAdminUnlocked(false);
    setAdminPinInput('');
    setSavedBuilds([]);
    setUserPreorders([]);
    setAuthEmail('');
    setAuthPassword('');
    setActivePage('home');
  };

  // Admin Database CRUD Handlers
  const handleAdminAddItem = async (e, targetType = 'catalog') => {
    e.preventDefault();
    setAdminSaving(true);

    const tableName =
      targetType === 'reference'
        ? REFERENCE_TABLE
        : adminTableSource === 'preorder'
        ? PREORDER_TABLE
        : ACTIVE_TABLE;

    try {
      const payload = {
        name: newItemForm.name.trim(),
        brand: newItemForm.brand.trim() || 'OEM',
        category: newItemForm.category,
        socket: newItemForm.socket.trim() || null,
        memory_type: newItemForm.memory_type.trim() || null,
        form_factor: newItemForm.form_factor.trim() || null,
        hardware_score: Number(newItemForm.hardware_score) || 75,
        specs: newItemForm.specs.trim() || 'Standard specification',
      };

      if (targetType !== 'reference') {
        payload.price = Number(newItemForm.price) || 0;
        payload.stock_status =
          adminTableSource === 'preorder' ? 'Pre-Order' : newItemForm.stock_status;
      } else {
        payload.source_type = 'reference';
      }

      const { error } = await supabase.from(tableName).insert([payload]);
      if (error) throw error;

      alert(`Added "${payload.name}" to ${tableName}!`);
      setNewItemForm({
        name: '',
        brand: '',
        category: newItemForm.category,
        price: '',
        stock_status: 'In Stock',
        socket: '',
        memory_type: '',
        form_factor: '',
        hardware_score: 78,
        specs: '',
      });
      await fetchInventory();
    } catch (err) {
      alert(`Admin Insert Error: ${err.message}`);
    } finally {
      setAdminSaving(false);
    }
  };

  const handleAdminSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingItem) return;
    setAdminSaving(true);

    const tableName =
      editingItem._table ||
      (adminSection === 'reference'
        ? REFERENCE_TABLE
        : adminTableSource === 'preorder'
        ? PREORDER_TABLE
        : ACTIVE_TABLE);

    try {
      const updates = {
        name: editingItem.name,
        brand: editingItem.brand,
        category: editingItem.category,
        socket: editingItem.socket || null,
        memory_type: editingItem.memory_type || null,
        form_factor: editingItem.form_factor || null,
        hardware_score: Number(editingItem.hardware_score || 75),
        specs: editingItem.specs || '',
      };

      if (tableName !== REFERENCE_TABLE) {
        updates.price = Number(editingItem.price || 0);
        updates.stock_status = editingItem.stock_status || 'In Stock';
      }

      const { error } = await supabase
        .from(tableName)
        .update(updates)
        .eq('id', editingItem.id);

      if (error) throw error;

      setEditingItem(null);
      await fetchInventory();
    } catch (err) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setAdminSaving(false);
    }
  };

  const handleAdminQuickStatusToggle = async (item, tableName, nextStatus) => {
    try {
      const { error } = await supabase
        .from(tableName)
        .update({ stock_status: nextStatus })
        .eq('id', item.id);
      if (error) throw error;
      await fetchInventory();
    } catch (err) {
      alert(`Status update failed: ${err.message}`);
    }
  };

  const handleAdminDeleteItem = async (item, tableName) => {
    if (!window.confirm(`Delete "${item.name}" from ${tableName}?`)) return;
    try {
      const { error } = await supabase.from(tableName).delete().eq('id', item.id);
      if (error) throw error;
      await fetchInventory();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleAdminUpdatePreorderStatus = async (orderId, nextStatus) => {
    try {
      const { error } = await supabase
        .from('bytebuild_preorder_requests')
        .update({ status: nextStatus })
        .eq('id', orderId);
      if (error) throw error;
      await fetchAdminLogs();
    } catch (err) {
      alert(`Could not update pre-order: ${err.message}`);
    }
  };

  const handleSaveDssRules = (e) => {
    e.preventDefault();
    localStorage.setItem('bytebuild_dss_rules', JSON.stringify(dssRules));
    alert('Compatibility & Recommendation Engine rules updated and applied across the system.');
  };

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

  const activeRamCount = selectedBuild.Memory ? selectedRamCount : existingRamCount;

  const cpuProfile = getCpuProfile(effectiveParts.Processors);
  const gpuProfile = getGpuProfile(effectiveParts['Video Cards']);
  const motherboardProfile = useMemo(() => getMotherboardProfile(effectiveParts.Motherboards), [effectiveParts.Motherboards]);
  const ramProfile = getRamProfile(effectiveParts.Memory, activeRamCount);
  const storageProfile = getStorageProfile(effectiveParts.Storage);
  const psuProfile = getPsuProfile(effectiveParts['Power Supplies']);
  const coolerProfile = getCoolerProfile(effectiveParts['CPU Coolers']);
  const caseProfile = getCaseProfile(effectiveParts.Cases);

  const cpuSocket = detectCpuSocket(effectiveParts.Processors);
  const motherboardSocket = detectMotherboardSocket(effectiveParts.Motherboards);

  const totalSystemWattage = useMemo(() => {
    return cpuProfile.watts + gpuProfile.watts + Number(dssRules.psuBufferWatts || 120);
  }, [cpuProfile.watts, gpuProfile.watts, dssRules.psuBufferWatts]);

  const recommendedPsuWatts = useMemo(() => {
    return Math.ceil(totalSystemWattage / 50) * 50;
  }, [totalSystemWattage]);

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
        category: 'Socket Match',
        severity: 'critical',
        title: 'CPU and Motherboard Platform Incompatible',
        message: `${cpu.name} requires socket ${cpuSocket}, but ${board.name} operates on ${motherboardSocket}. Parts will not physically connect.`,
        action: `Select an ${cpuSocket} motherboard (e.g. ${cpuSocket === 'AM5' ? 'B650' : cpuSocket === 'AM4' ? 'B550' : 'B760'}) or change the processor.`,
      });
    }

    if (cpu && board && cpuProfile.tier >= 5 && motherboardProfile.tier === 'Entry') {
      issues.push({
        category: 'Power Delivery',
        severity: 'warning',
        title: 'Motherboard VRM Throttle Risk',
        message: `${cpu.name} (${cpuProfile.watts}W package power) is paired with an entry chipset (${board.name}). Unheatsinked VRMs will overheat under load.`,
        action: 'Upgrade to a B-series or Z/X-series motherboard with heatsinked power phases.',
      });
    }

    if (board && ram) {
      const boardMemory = board.memory_type || motherboardProfile.memoryType;
      const ramType = ramProfile.type;
      if (boardMemory && ramType && boardMemory !== 'Unknown' && ramType !== 'Unknown' && boardMemory !== ramType) {
        issues.push({
          category: 'RAM Standard',
          severity: 'critical',
          title: 'Memory Standard Mismatch',
          message: `${board.name} utilizes ${boardMemory} slots, but ${ram.name} is ${ramType}. Physical pinouts are incompatible.`,
          action: `Use ${boardMemory} memory modules for this platform.`,
        });
      }
    }

    if (board && ram && ramProfile.stickCount > motherboardProfile.dimmSlots) {
      issues.push({
        category: 'Slot Limit',
        severity: 'critical',
        title: 'Exceeded Physical DIMM Slot Limit',
        message: `Selected ${ramProfile.stickCount}x sticks of RAM, but ${board.name} has only ${motherboardProfile.dimmSlots} physical slots.`,
        action: `Use a 2-stick kit with higher per-stick density (e.g., 2x16GB instead of 4x8GB).`,
      });
    }

    if (ram) {
      if (!ramProfile.hasChosenSticks && activePage === 'upgrade') {
        issues.push({
          category: 'RAM Architecture',
          severity: 'info',
          title: 'Specify Installed Memory Modules',
          message: `Configure how many sticks of ${ram.name} are installed (1x, 2x, or 4x) to verify if your memory bus operates in 64-bit or 128-bit mode.`,
          action: 'Click 1x, 2x, or 4x on the memory selector card.',
        });
      } else if (ramProfile.isSingleChannel) {
        issues.push({
          category: 'Bandwidth',
          severity: 'warning',
          title: 'Single-Channel Memory Bus Bottleneck (64-Bit)',
          message: `Running 1 single RAM stick cuts peak memory bandwidth by ~50%, reducing 1% low gaming framerates.`,
          action: 'Install 2 matching RAM sticks in dual-channel configuration (Slots 2 & 4).',
        });
      } else if (ramProfile.isQuadChannelOrPopulated && ramProfile.type === 'DDR5') {
        issues.push({
          category: 'Memory Controller',
          severity: 'warning',
          title: '4-DIMM DDR5 Memory Controller Load',
          message: `Populating 4 sticks of DDR5 heavily loads the CPU memory controller, often forcing lower speed profiles for boot stability.`,
          action: 'For high stability, use a high-capacity 2-stick kit (2x16GB or 2x32GB).',
        });
      }

      const minRamRule = Number(dssRules.minRecommendedRamGB || 16);
      if (ramProfile.totalCapacity > 0 && ramProfile.totalCapacity < minRamRule) {
        issues.push({
          category: 'Capacity',
          severity: 'warning',
          title: 'Constrained Memory Capacity',
          message: `Total capacity is ${ramProfile.totalCapacity}GB (below the ${minRamRule}GB recommended rule). Modern desktop software leaves little headroom.`,
          action: `Upgrade to a ${minRamRule}GB dual-channel kit minimum.`,
        });
      }
    }

    if (cpu && gpu) {
      const tierGap = gpuProfile.tier - cpuProfile.tier;
      const maxAllowedGap = Number(dssRules.maxAllowedTierGap || 2);
      if (tierGap > maxAllowedGap) {
        issues.push({
          category: 'Gaming Balance',
          severity: 'critical',
          title: 'Severe CPU Bottleneck',
          message: `${gpu.name} is significantly faster than ${cpu.name}. The graphics card will remain underutilized.`,
          action: 'Upgrade to a modern 6-core/12-thread or 8-core gaming processor.',
        });
      } else if (tierGap === maxAllowedGap) {
        issues.push({
          category: 'Gaming Balance',
          severity: 'warning',
          title: 'Moderate CPU Processing Limit',
          message: `${cpu.name} handles ${gpu.name} well at 1440p, but high refresh 1080p will be CPU-limited.`,
          action: 'Plan for an eventual CPU upgrade to extract the full potential of your GPU.',
        });
      } else if (cpuProfile.tier - gpuProfile.tier > maxAllowedGap) {
        issues.push({
          category: 'Gaming Balance',
          severity: 'warning',
          title: 'Underpowered GPU Configuration',
          message: `${cpu.name} has substantial rendering headroom, but ${gpu.name} limits 3D visual fidelity.`,
          action: 'Allocate more budget to the graphics card if gaming is your primary focus.',
        });
      }
    }

    if (psu) {
      if (psuProfile.watts > 0 && psuProfile.watts < recommendedPsuWatts) {
        issues.push({
          category: 'Power Supply',
          severity: 'critical',
          title: 'Insufficient Power Supply Headroom',
          message: `System peak load requires at least ${recommendedPsuWatts}W. Current unit (${psuProfile.watts}W) risks shutdown during transient GPU spikes.`,
          action: `Replace with a quality ${recommendedPsuWatts}W or higher power supply.`,
        });
      } else if (psuProfile.isGeneric && gpuProfile.tier >= 3) {
        issues.push({
          category: 'Power Supply',
          severity: 'warning',
          title: 'Unrated Power Supply Risk',
          message: `${psu.name} lacks official 80+ efficiency certification. Lacks critical electrical circuit protections.`,
          action: 'Use a recognized 80+ Bronze or 80+ Gold tier power supply.',
        });
      }
    }

    if (storage) {
      const minStorageRule = Number(dssRules.minStorageCapacityGB || 500);
      if (storageProfile.isHdd) {
        issues.push({
          category: 'Storage Speed',
          severity: 'critical',
          title: 'Mechanical Boot Drive Detected',
          message: `Running Windows from a mechanical hard drive (${storage.name}) causes slow boot times and system lag.`,
          action: 'Install a high-speed M.2 NVMe SSD as the primary OS boot drive.',
        });
      } else if (storageProfile.capacityGB < minStorageRule) {
        issues.push({
          category: 'Storage Space',
          severity: 'warning',
          title: 'Restricted Storage Footprint',
          message: `${storageProfile.capacityGB}GB is below the ${minStorageRule}GB baseline threshold and fills up quickly with OS cache and games.`,
          action: `Equip at least a ${minStorageRule}GB or 1TB drive for a comfortable baseline.`,
        });
      }
    }

    if (cooler && coolerProfile.tier < cpuProfile.coolerNeed) {
      issues.push({
        category: 'Thermal',
        severity: 'warning',
        title: 'Cooling Capacity Below Recommended TDP',
        message: `${cooler.name} is undersized for ${effectiveParts.Processors?.name}. Under load, temperatures may trigger thermal throttle.`,
        action: 'Upgrade to a dual-tower air cooler or 240mm/360mm AIO liquid cooler.',
      });
    }

    if (pcCase && !caseProfile.airflow && gpuProfile.tier >= 4) {
      issues.push({
        category: 'Chassis',
        severity: 'warning',
        title: 'Restricted Front Panel Airflow',
        message: `Solid front panels trap heat from high-wattage GPUs (${gpuProfile.watts}W), raising internal ambient temperature.`,
        action: 'Select a case with a high-permeability front mesh intake.',
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
    motherboardProfile,
    recommendedPsuWatts,
    activePage,
    dssRules,
  ]);

  const recommendation = useMemo(() => {
    const critical = dssIssues.find((issue) => issue.severity === 'critical');
    const warnings = dssIssues.filter((issue) => issue.severity === 'warning');
    const preOrderPart = selectedItems.find((item) => item?.stock_status === 'Pre-Order');

    if (critical) {
      return {
        title: critical.title,
        tone: 'danger',
        summary: `${critical.message}\n\nRecommended Action: ${critical.action}`,
      };
    }
    if (warnings.length > 0) {
      return {
        title: `${warnings.length} Hardware Balance Note${warnings.length > 1 ? 's' : ''}`,
        tone: 'warning',
        summary: `Hardware is operational, but our validator detected ${warnings.length} balance bottlenecks.\n\nPrimary Focus: ${warnings[0].message}`,
      };
    }
    if (preOrderPart) {
      return {
        title: 'Pre-Order Allocation Pending',
        tone: 'info',
        summary: `${preOrderPart.name} is currently reserved via supplier pre-order. Final quotation and assembly lead time will be confirmed upon distributor stock arrival.`,
      };
    }
    if (selectedItems.length === 0 && Object.values(existingPc).filter(Boolean).length === 0) {
      return {
        title: 'System Validator Ready',
        tone: 'neutral',
        summary: 'Select existing or proposed components to analyze socket pinouts, RAM channels, power delivery, and thermal tolerances.',
      };
    }
    return {
      title: 'Platform Architecture Verified',
      tone: 'success',
      summary: `All platform criteria cleared.\n• Socket: ${cpuSocket || 'Validated'}\n• Memory Bus: ${ramProfile.isDualChannel ? '128-Bit Dual-Channel Active' : 'Configured'}\n• Power Headroom: ~${psuProfile.watts > 0 ? psuProfile.watts - recommendedPsuWatts : dssRules.psuBufferWatts}W buffer above transient peak.`,
    };
  }, [dssIssues, selectedItems, existingPc, cpuSocket, ramProfile, psuProfile, recommendedPsuWatts, dssRules.psuBufferWatts]);

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
    const cpuName = String(effectiveParts.Processors?.name || '').toUpperCase();
    const hasApuGraphics = cpuName.includes('G') && !effectiveParts['Video Cards'];

    if (!effectiveParts['Video Cards'] && !hasApuGraphics) {
      return {
        label: 'Select a Graphics Card',
        description: 'Choose a GPU (or an APU with integrated graphics) to estimate gaming and productivity performance tiers.',
      };
    }
    const critical = dssIssues.find((issue) => issue.severity === 'critical');
    if (critical) {
      return {
        label: 'Compatibility Conflict Detected',
        description: critical.message,
      };
    }
    if (gpuProfile.tier >= 4 && cpuProfile.tier >= 4) {
      return {
        label: 'Performance Gaming & Creator Rig',
        description: 'Excellent CPU and GPU balance for 1440p gaming, streaming, and content creation.',
      };
    }
    if (gpuProfile.tier === 3) {
      return {
        label: '1080p Esports & Productivity Rig',
        description: 'Optimal for smooth 1080p high refresh-rate competitive titles and office work.',
      };
    }
    return {
      label: 'Entry / Office Desktop Configuration',
      description: 'Ideal for general office productivity, academic workflows, and light esports titles.',
    };
  }, [effectiveParts, dssIssues, cpuProfile, gpuProfile]);

  const brandsForActiveCategory = useMemo(() => {
    const active = normalizeText(activeTab);
    const brands = catalogProducts
      .filter((product) => normalizeText(product?.category) === active && product?.brand)
      .map((product) => product.brand);
    return ['All', ...new Set(brands)];
  }, [catalogProducts, activeTab]);

  const formFactorsForActiveCategory = useMemo(() => {
    const active = normalizeText(activeTab);
    const factors = catalogProducts
      .filter((product) => normalizeText(product?.category) === active)
      .map((product) => detectPartFormFactor(product))
      .filter((ff) => ff !== 'Standard');
    return ['All', ...new Set(factors)];
  }, [catalogProducts, activeTab]);

  const filteredProducts = useMemo(() => {
    const active = normalizeText(activeTab);
    const query = normalizeText(searchQuery);
    const minP = minPrice !== '' ? Number(minPrice) : null;
    const maxP = maxPrice !== '' ? Number(maxPrice) : null;

    const filtered = catalogProducts.filter((product) => {
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
        product?.form_factor,
        product?.specs,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = query === '' || searchableText.includes(query);
      const matchesBrand = selectedBrand === 'All' || product?.brand === selectedBrand;
      const matchesFormFactor =
        selectedFormFactor === 'All' || detectPartFormFactor(product) === selectedFormFactor;

      const itemPrice = Number(product?.price || 0);
      const matchesMinPrice = minP === null || itemPrice >= minP;
      const matchesMaxPrice = maxP === null || itemPrice <= maxP;

      return (
        matchesSearch &&
        matchesBrand &&
        matchesFormFactor &&
        matchesMinPrice &&
        matchesMaxPrice
      );
    });

    return filtered.sort((a, b) => {
      const priceA = Number(a?.price || 0);
      const priceB = Number(b?.price || 0);
      if (sortBy === 'price-asc') return priceA - priceB;
      if (sortBy === 'price-desc') return priceB - priceA;
      if (sortBy === 'rating') return Number(b?.hardware_score || 0) - Number(a?.hardware_score || 0);
      return 0;
    });
  }, [
    catalogProducts,
    activeTab,
    searchQuery,
    selectedBrand,
    selectedFormFactor,
    minPrice,
    maxPrice,
    sortBy,
  ]);

  const categoryCounts = useMemo(() => {
    return CATEGORIES.reduce((acc, category) => {
      acc[category] = catalogProducts.filter(
        (product) => normalizeText(product?.category) === normalizeText(category)
      ).length;
      return acc;
    }, {});
  }, [catalogProducts]);

  // Rule-Based Smart Build Assistant Engine
  const handleRunSmartBuildAssistant = () => {
    const budget = Math.max(Number(assistantBudget) || 20000, 15000);
    const inStock = activeProducts.filter(
      (p) => p.stock_status !== 'Sold Out' && Number(p.price || 0) > 0
    );

    if (inStock.length === 0) {
      setAssistantStatus('Catalog is still loading. Try again in a moment.');
      return;
    }

    const byCat = (cat) =>
      inStock
        .filter((p) => normalizeText(p.category) === normalizeText(cat))
        .sort((a, b) => Number(a.price) - Number(b.price));

    const cpus = byCat('Processors');
    const boards = byCat('Motherboards');
    const gpus = byCat('Video Cards');
    const rams = byCat('Memory');
    const storages = byCat('Storage');
    const psus = byCat('Power Supplies');
    const coolers = byCat('CPU Coolers');
    const cases = byCat('Cases');

    const pickBestWithinCap = (list, cap, preferHighScore = true) => {
      if (!list || list.length === 0) return null;
      const affordable = list.filter((item) => Number(item.price) <= cap);
      if (affordable.length === 0) return list[0];
      if (preferHighScore) {
        return [...affordable].sort(
          (a, b) =>
            Number(b.hardware_score || 0) - Number(a.hardware_score || 0) ||
            Number(b.price) - Number(a.price)
        )[0];
      }
      return affordable[affordable.length - 1];
    };

    const isOfficeApu =
      assistantProfile === 'Office/Productivity' && budget <= 28000;

    const gGpu = Number(dssRules.gamingGpuWeight || 36) / 100;
    const gCpu = Number(dssRules.gamingCpuWeight || 21) / 100;
    const cGpu = Number(dssRules.creatorGpuWeight || 29) / 100;
    const cCpu = Number(dssRules.creatorCpuWeight || 27) / 100;

    const weights =
      assistantProfile === 'Gaming'
        ? { cpu: gCpu, gpu: gGpu, board: 0.13, ram: 0.08, storage: 0.08, psu: 0.06, cooler: 0.03, case: 0.05 }
        : assistantProfile === 'Content Creation'
        ? { cpu: cCpu, gpu: cGpu, board: 0.14, ram: 0.10, storage: 0.08, psu: 0.05, cooler: 0.03, case: 0.04 }
        : isOfficeApu
        ? { cpu: 0.32, gpu: 0.0, board: 0.22, ram: 0.14, storage: 0.12, psu: 0.09, cooler: 0.04, case: 0.07 }
        : { cpu: 0.24, gpu: 0.31, board: 0.14, ram: 0.09, storage: 0.08, psu: 0.06, cooler: 0.03, case: 0.05 };

    const apuPool = cpus.filter((c) => String(c.name).toUpperCase().includes('G'));
    const chosenCpu =
      isOfficeApu && apuPool.length > 0
        ? pickBestWithinCap(apuPool, budget * weights.cpu)
        : pickBestWithinCap(cpus, budget * weights.cpu);

    const targetSocket = detectCpuSocket(chosenCpu) || 'AM4';

    const compatibleBoards = boards.filter(
      (b) => detectMotherboardSocket(b) === targetSocket
    );
    const chosenBoard = pickBestWithinCap(
      compatibleBoards.length > 0 ? compatibleBoards : boards,
      budget * weights.board
    );

    const boardMemType =
      chosenBoard?.memory_type ||
      getMotherboardProfile(chosenBoard).memoryType ||
      (targetSocket === 'AM5' ? 'DDR5' : 'DDR4');
    const compatibleRams = rams.filter(
      (r) => getRamProfile(r, 2).type === boardMemType
    );
    const chosenRam = pickBestWithinCap(
      compatibleRams.length > 0 ? compatibleRams : rams,
      budget * weights.ram
    );

    const chosenGpu = isOfficeApu
      ? null
      : pickBestWithinCap(gpus, budget * weights.gpu);

    const ssdPool = storages.filter((s) => !getStorageProfile(s).isHdd);
    const chosenStorage = pickBestWithinCap(
      ssdPool.length > 0 ? ssdPool : storages,
      budget * weights.storage
    );

    const chosenCooler = pickBestWithinCap(coolers, budget * weights.cooler);
    const chosenCase = pickBestWithinCap(cases, budget * weights.case);

    const estWatts =
      getCpuProfile(chosenCpu).watts +
      getGpuProfile(chosenGpu).watts +
      Number(dssRules.psuBufferWatts || 120);
    const minSafeWatts = Math.ceil(estWatts / 50) * 50;
    const safePsus = psus.filter((p) => getPsuProfile(p).watts >= minSafeWatts);
    const chosenPsu = pickBestWithinCap(
      safePsus.length > 0 ? safePsus : psus,
      Math.max(budget * weights.psu, 2400)
    );

    const generatedBuild = {
      Processors: chosenCpu || null,
      Motherboards: chosenBoard || null,
      'Video Cards': chosenGpu || null,
      Memory: chosenRam || null,
      Storage: chosenStorage || null,
      'Power Supplies': chosenPsu || null,
      'CPU Coolers': chosenCooler || null,
      Cases: chosenCase || null,
    };

    let runningTotal = Object.values(generatedBuild)
      .filter(Boolean)
      .reduce((acc, item) => acc + Number(item.price || 0), 0);

    if (runningTotal > budget && generatedBuild['Video Cards']) {
      const cheaperGpus = gpus.filter(
        (g) => Number(g.price) <= Number(generatedBuild['Video Cards'].price) - (runningTotal - budget)
      );
      if (cheaperGpus.length > 0) {
        generatedBuild['Video Cards'] = cheaperGpus[cheaperGpus.length - 1];
      }
    }

    runningTotal = Object.values(generatedBuild)
      .filter(Boolean)
      .reduce((acc, item) => acc + Number(item.price || 0), 0);

    setSelectedBuild(generatedBuild);
    setSelectedRamCount(2);
    setAssistantStatus(
      `Smart Build generated for ${assistantProfile} (${targetSocket} · ${boardMemType}) — Total: ${peso(runningTotal)} / Target: ${peso(budget)}`
    );
  };

  // APK-Ready Quotation Export & D5 Database Storage
  const handleExportQuotation = async () => {
    if (selectedItems.length === 0) return;
    setExportingQuote(true);

    const refCode = `BB-${printReferenceId}`;

    try {
      await supabase.from('bytebuild_quotations').insert([
        {
          reference_code: refCode,
          user_id: currentUser ? currentUser.id : null,
          customer_email: currentUser ? currentUser.email : 'Walk-in / Guest',
          build_data: selectedBuild,
          total_price: totalPrice,
          compatibility_score: compatibilityScore,
        },
      ]);
    } catch (_) {
      // Fallback gracefully
    }

    try {
      const rowsHtml = CATEGORIES.map((cat) => {
        const item = selectedBuild[cat];
        if (!item) return '';
        return `
          <tr>
            <td style="padding:8px;border-bottom:1px solid #cbd5e1;font-weight:bold;color:#334155;">${getCategoryLabel(cat)}</td>
            <td style="padding:8px;border-bottom:1px solid #cbd5e1;color:#0f172a;">${item.name} <span style="color:#64748b;font-size:11px;">(${item.sku_code || item.id})</span></td>
            <td style="padding:8px;border-bottom:1px solid #cbd5e1;text-align:right;font-family:monospace;font-weight:bold;">${peso(item.price)}</td>
          </tr>`;
      }).join('');

      const invoiceHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ByteBuild Quotation ${refCode}</title>
</head>
<body style="font-family:Arial,sans-serif;max-width:750px;margin:24px auto;padding:20px;color:#0f172a;border:1px solid #cbd5e1;border-radius:8px;">
  <div style="display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:16px;">
    <div>
      <h1 style="margin:0;font-size:20px;">BYTEBUILD COMPUTER SOLUTIONS</h1>
      <p style="margin:4px 0 0;font-size:12px;color:#475569;">Quezon City, Metro Manila · Local PH Retail Distributor Quotation</p>
    </div>
    <div style="text-align:right;">
      <strong style="font-size:14px;">OFFICIAL QUOTATION</strong>
      <p style="margin:4px 0 0;font-family:monospace;font-size:12px;">REF: ${refCode}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#64748b;">Date: ${printDateString}</p>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="background:#f1f5f9;text-align:left;">
        <th style="padding:8px;border-bottom:2px solid #cbd5e1;">Category</th>
        <th style="padding:8px;border-bottom:2px solid #cbd5e1;">Component Specification</th>
        <th style="padding:8px;border-bottom:2px solid #cbd5e1;text-align:right;">Price (PHP)</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div style="margin-top:16px;padding:12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:12px;color:#475569;">Compatibility Score: <strong>${compatibilityScore}%</strong> · Est. Load: <strong>${totalSystemWattage}W</strong> (Rec. PSU: ${recommendedPsuWatts}W)</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">12-Month Installment Est.: ${peso(monthlyEstimate)}/mo (VAT Included)</div>
    </div>
    <div style="font-size:20px;font-weight:900;color:#1e3a8a;font-family:monospace;">${peso(totalPrice)}</div>
  </div>
</body>
</html>`;

      const blob = new Blob([invoiceHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ByteBuild-Quotation-${refCode}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export Error:', err);
    } finally {
      setExportingQuote(false);
    }
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
    if (inventoryMode === 'preorder' || product.stock_status === 'Pre-Order') {
      setPreorderModalItem(product);
      return;
    }
    handleSelectProduct(product);
  };

  const handleClearBuild = () => {
    setSelectedBuild(INITIAL_BUILD);
    setAssistantStatus('');
  };

  const handleClearExistingPc = () => setExistingPc(INITIAL_EXISTING_PC);

  const handleSaveCurrentBuild = async () => {
    if (!currentUser) {
      alert('Please sign in or create an account to save your PC build.');
      setActivePage('login');
      return;
    }
    if (selectedItems.length === 0) {
      alert('Your build is empty. Select components first.');
      return;
    }
    setSavingBuild(true);
    try {
      const buildName = prompt('Enter a name for this build:', `Rig - ${new Date().toLocaleDateString()}`);
      if (!buildName) {
        setSavingBuild(false);
        return;
      }
      const { error } = await supabase.from('bytebuild_saved_builds').insert([
        {
          user_id: currentUser.id,
          build_name: buildName,
          build_data: selectedBuild,
          total_price: totalPrice,
          compatibility_score: compatibilityScore,
        },
      ]);
      if (error) throw error;
      alert('Build saved successfully! View it under your Account tab.');
      fetchUserData();
    } catch (err) {
      alert(`Save error: ${err.message}`);
    } finally {
      setSavingBuild(false);
    }
  };

  const handleLoadSavedBuild = (buildRecord) => {
    setSelectedBuild(buildRecord.build_data || INITIAL_BUILD);
    setActivePage('builder');
  };

  const handleDeleteSavedBuild = async (buildId) => {
    if (!window.confirm('Delete this saved build?')) return;
    try {
      const { error } = await supabase.from('bytebuild_saved_builds').delete().eq('id', buildId);
      if (error) throw error;
      setSavedBuilds((prev) => prev.filter((b) => b.id !== buildId));
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePreorderSubmit = async (e) => {
    e.preventDefault();
    if (!preorderModalItem) return;
    setPreorderSubmitting(true);
    try {
      const { error } = await supabase.from('bytebuild_preorder_requests').insert([
        {
          user_id: currentUser ? currentUser.id : null,
          customer_name: preorderForm.customer_name,
          contact_number: preorderForm.contact_number,
          email: preorderForm.email || (currentUser ? currentUser.email : ''),
          product_id: String(preorderModalItem.id || preorderModalItem.sku_code || ''),
          product_name: preorderModalItem.name,
          estimated_price: Number(preorderModalItem.price || 0),
          status: 'Pending Supplier Confirmation',
        },
      ]);
      if (error) throw error;
      alert(`Pre-order submitted for ${preorderModalItem.name}! ByteBuild staff will contact you once supplier allocation is verified.`);
      setPreorderModalItem(null);
      setPreorderForm({ customer_name: '', contact_number: '', email: currentUser?.email || '' });
      fetchUserData();
    } catch (err) {
      alert(`Pre-order failed: ${err.message}`);
    } finally {
      setPreorderSubmitting(false);
    }
  };

  const renderProductRow = (product, allowAdd = true, existingCategory = null) => {
    const isReference = product.source_type === 'reference';
    const status = isReference ? 'reference' : inventoryMode === 'preorder' ? 'Pre-Order' : product.stock_status || 'In Stock';
    const formFactorTag = detectPartFormFactor(product);

    let buttonLabel = '+ Add';
    if (activePage === 'upgrade' && upgradeMode === 'reference') buttonLabel = 'Select Owned';
    if (activePage === 'upgrade' && upgradeMode === 'shop') buttonLabel = 'Choose Upgrade';
    if (inventoryMode === 'preorder' || product.stock_status === 'Pre-Order') buttonLabel = 'Pre-Order';

    return (
      <div
        key={`row-${product.id}`}
        className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5 hover:border-slate-500 transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider bg-[#1f293d] text-slate-300 px-2 py-0.5 rounded">
              {product.brand || 'OEM'}
            </span>
            {formFactorTag !== 'Standard' && (
              <span className="text-[10px] font-semibold bg-slate-800 text-blue-300 px-2 py-0.5 rounded">
                {formFactorTag}
              </span>
            )}
            <span className="text-[10px] text-slate-500 font-mono">
              SKU: {product.sku_code || product.id}
            </span>
            <span
              className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                status === 'In Stock'
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                  : status === 'Pre-Order'
                  ? 'bg-blue-950 text-blue-400 border border-blue-800/40'
                  : status === 'Sold Out'
                  ? 'bg-red-950 text-red-400 border border-red-800/40'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {status}
            </span>
          </div>

          <h4
            onClick={() => setSelectedProduct(product)}
            className="text-sm font-bold text-white hover:text-blue-400 cursor-pointer truncate"
          >
            {product.name}
          </h4>

          <p className="text-xs text-slate-400 mt-1 line-clamp-1">
            {product.specs || 'Standard specification'}
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end pt-2 sm:pt-0 border-t sm:border-0 border-[#1f293d]">
          <div className="text-left sm:text-right">
            <p className="text-xs text-slate-500">Retail Price</p>
            <p className="text-base font-black text-white font-mono">
              {isReference || !product.price ? 'Owned' : peso(product.price)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedProduct(product)}
              className="px-2.5 py-1.5 rounded bg-[#1f293d] hover:bg-slate-700 text-xs font-semibold text-slate-200"
            >
              Specs
            </button>
            {allowAdd && (
              <button
                onClick={() => handleUpgradeAction(existingCategory || product.category, product)}
                className={`px-3.5 py-1.5 rounded text-xs font-bold transition-colors ${
                  buttonLabel === 'Pre-Order'
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-blue-700 hover:bg-blue-600 text-white'
                }`}
              >
                {buttonLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCategoryNavStrip = () => (
    <div className="flex gap-2 overflow-x-auto pb-2 border-b border-[#1f293d]">
      {CATEGORIES.map((category) => {
        const isActive = activeTab === category && activePage !== 'home';
        const hasSelection = Boolean(selectedBuild[category]);

        return (
          <button
            key={category}
            onClick={() => {
              setActiveTab(category);
              setSelectedBrand('All');
              setSelectedFormFactor('All');
              setSearchQuery('');
              if (activePage === 'home') {
                setActivePage('products');
              }
            }}
            className={`shrink-0 px-3.5 py-2 rounded-lg border text-xs font-bold transition-all flex items-center gap-2 ${
              isActive
                ? 'bg-blue-600 border-blue-500 text-white shadow-sm'
                : 'bg-[#111827] border-[#1f293d] text-slate-300 hover:border-slate-500 hover:text-white'
            }`}
          >
            <span>{getCategoryLabel(category)}</span>
            {hasSelection && (
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            )}
            <span className="text-[10px] text-slate-400">
              ({categoryCounts[category] || 0})
            </span>
          </button>
        );
      })}
    </div>
  );

  const renderSmartBuildAssistantBar = () => (
    <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 text-left space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1f293d] pb-2.5">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
            Rule-Based Decision Support Module
          </span>
          <h3 className="text-sm font-bold text-white">
            Smart Build Assistant (Auto-Configure by Budget & Workload)
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          {[25000, 40000, 65000, 95000].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAssistantBudget(preset)}
              className={`px-2 py-1 rounded text-[10px] font-mono font-bold border ${
                Number(assistantBudget) === preset
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-[#0b0f19] border-[#1f293d] text-slate-400 hover:text-white'
              }`}
            >
              {peso(preset)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
        <div className="sm:col-span-4">
          <label className="text-[11px] text-slate-400 block mb-1 font-semibold">
            Target Budget (PHP)
          </label>
          <input
            type="number"
            min="15000"
            step="1000"
            value={assistantBudget}
            onChange={(e) => setAssistantBudget(e.target.value)}
            className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="sm:col-span-5">
          <label className="text-[11px] text-slate-400 block mb-1 font-semibold">
            Intended Workload Profile
          </label>
          <select
            value={assistantProfile}
            onChange={(e) => setAssistantProfile(e.target.value)}
            className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-xs text-white font-semibold focus:outline-none focus:border-blue-500"
          >
            <option value="Gaming">Gaming (GPU & Frame Pacing Priority)</option>
            <option value="Office/Productivity">Office / Productivity (Cost-Efficient APU/CPU)</option>
            <option value="Content Creation">Content Creation (Multi-Core & RAM Priority)</option>
            <option value="Mixed/Balanced">Mixed Dual-Purpose (Balanced Tier Parity)</option>
          </select>
        </div>

        <div className="sm:col-span-3">
          <button
            type="button"
            onClick={handleRunSmartBuildAssistant}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 px-3 rounded text-xs font-bold uppercase tracking-wider transition-colors shadow-sm"
          >
            Auto-Generate Rig
          </button>
        </div>
      </div>

      {assistantStatus && (
        <div className="p-2.5 rounded bg-blue-950/40 border border-blue-800/40 text-xs text-blue-300 font-medium">
          {assistantStatus}
        </div>
      )}
    </div>
  );

  const renderCatalogList = (existingCategory = null) => (
    <div className="space-y-4">
      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              placeholder="Search model, SKU, socket, specs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {activePage !== 'upgrade' && (
            <div className="flex items-center gap-1 bg-[#0b0f19] p-1 rounded-lg border border-[#1f293d] w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setInventoryMode('active')}
                className={`flex-1 sm:flex-initial px-3 py-1 rounded text-xs font-bold transition-colors ${
                  inventoryMode === 'active'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Active Stock ({activeProducts.length})
              </button>
              <button
                type="button"
                onClick={() => setInventoryMode('preorder')}
                className={`flex-1 sm:flex-initial px-3 py-1 rounded text-xs font-bold transition-colors ${
                  inventoryMode === 'preorder'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Pre-Order Catalog ({preorderProducts.length})
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-[#1f293d]">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400">Brand:</span>
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                {brandsForActiveCategory.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            {formFactorsForActiveCategory.length > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-400">Form Factor:</span>
                <select
                  value={selectedFormFactor}
                  onChange={(e) => setSelectedFormFactor(e.target.value)}
                  className="bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {formFactorsForActiveCategory.map((ff) => (
                    <option key={ff} value={ff}>
                      {ff}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-400">Price (₱):</span>
              <input
                type="number"
                placeholder="Min"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className="w-20 bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
              />
              <span className="text-slate-600 text-xs">-</span>
              <input
                type="number"
                placeholder="Max"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="w-20 bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
              />
              {(minPrice !== '' || maxPrice !== '' || selectedBrand !== 'All' || selectedFormFactor !== 'All') && (
                <button
                  type="button"
                  onClick={() => {
                    setMinPrice('');
                    setMaxPrice('');
                    setSelectedBrand('All');
                    setSelectedFormFactor('All');
                  }}
                  className="text-[11px] text-blue-400 hover:underline ml-1"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-blue-500 font-semibold"
            >
              <option value="price-asc">Price: Lowest to Highest</option>
              <option value="price-desc">Price: Highest to Lowest</option>
              <option value="rating">Hardware Rating (Score)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {filteredProducts.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-[#1f293d] rounded-lg text-slate-500 text-xs">
            No components found matching your current filter criteria.
          </div>
        ) : (
          filteredProducts.map((p) => renderProductRow(p, true, existingCategory))
        )}
      </div>
    </div>
  );

  const renderBuildSummary = () => (
    <div
      id="printable-quotation"
      className="bg-[#111827] border border-[#1f293d] rounded-lg p-4"
    >
      <div className="hidden print:block mb-4 border-b-2 border-slate-900 pb-3">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-lg font-black tracking-tight text-slate-900 uppercase">
              BYTEBUILD COMPUTER SOLUTIONS
            </h1>
            <p className="text-[8pt] text-slate-600">
              Quezon City, Metro Manila · Local PH Retail Distributor Quotation
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-sm font-black text-slate-900 uppercase">
              OFFICIAL QUOTATION
            </h2>
            <p className="text-[8pt] font-mono text-slate-600">
              REF: BB-{printReferenceId}
            </p>
            <p className="text-[8pt] text-slate-500">Date: {printDateString}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f293d] pb-3 mb-3 print:hidden">
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            System Manifest
          </h3>
          <p className="text-[10px] text-slate-400">
            {selectedItems.length} of 8 components configured
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSaveCurrentBuild}
            disabled={savingBuild || selectedItems.length === 0}
            className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[11px] font-bold disabled:opacity-40"
          >
            {savingBuild ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleExportQuotation}
            disabled={exportingQuote || selectedItems.length === 0}
            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-bold disabled:opacity-40"
            title="Download quotation file & log to database"
          >
            {exportingQuote ? 'Exporting...' : 'Export'}
          </button>
          <button
            onClick={() => window.print()}
            disabled={selectedItems.length === 0}
            className="px-2.5 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded text-[11px] font-bold disabled:opacity-40"
          >
            Print
          </button>
          <button
            onClick={handleClearBuild}
            className="px-2 py-1 text-slate-400 hover:text-white text-[11px]"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="space-y-1.5 print-table-wrapper">
        <div className="hidden print:table-row bg-slate-100 border-b border-slate-300 text-[8pt] font-black uppercase text-slate-700">
          <div className="table-cell p-2 text-left w-2/3">Component Specification</div>
          <div className="table-cell p-2 text-right w-1/3">Amount (PHP)</div>
        </div>

        {CATEGORIES.map((category) => {
          const item = selectedBuild[category];
          const isMemory = category === 'Memory';
          const printRowClass = !item ? 'print:hidden' : '';

          return (
            <div
              key={category}
              className={`p-2 rounded border border-[#1f293d] bg-[#0b0f19] flex items-center justify-between text-left print-table-row ${printRowClass}`}
            >
              <div className="min-w-0 flex-1 pr-2 print-cell-name">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold text-slate-400 uppercase">
                    {getCategoryLabel(category)}:
                  </span>
                  {isMemory && item && (
                    <div className="flex items-center gap-1 bg-[#111827] px-1 py-0.5 rounded print:hidden">
                      {[1, 2, 4].map((count) => (
                        <button
                          key={count}
                          onClick={() => setSelectedRamCount(count)}
                          className={`px-1 text-[9px] font-bold rounded ${
                            selectedRamCount === count
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400'
                          }`}
                        >
                          {count}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <p className="text-xs font-semibold text-white truncate mt-0.5">
                  {item ? item.name : <span className="text-slate-500 italic">Unassigned</span>}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 print-cell-price">
                <span className="text-xs font-mono font-bold text-slate-200 print-price">
                  {item ? (item.price ? peso(item.price) : 'Included') : '--'}
                </span>
                {item && (
                  <button
                    onClick={() =>
                      setSelectedBuild((prev) => ({ ...prev, [category]: null }))
                    }
                    className="text-slate-500 hover:text-red-400 font-bold px-1 print:hidden"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-[#1f293d] print-summary-box">
        <div className="mb-3 p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] print:hidden">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400 font-bold">Estimated Load:</span>
            <span className="font-mono text-white font-bold">{totalSystemWattage}W</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${
                totalSystemWattage > (psuProfile.watts || recommendedPsuWatts)
                  ? 'bg-red-500'
                  : 'bg-blue-500'
              }`}
              style={{
                width: `${Math.min(
                  (totalSystemWattage / (psuProfile.watts || 650)) * 100,
                  100
                )}%`,
              }}
            ></div>
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            Target PSU: {recommendedPsuWatts}W minimum
          </p>
        </div>

        <div className="flex justify-between items-baseline">
          <div>
            <p className="text-xs text-slate-400 font-bold">Total Estimate:</p>
            <p className="text-[10px] text-slate-500">VAT Included · PH Retail</p>
          </div>
          <p className="text-xl font-black text-emerald-400 font-mono print-total">
            {peso(totalPrice)}
          </p>
        </div>

        <div className="mt-2 pt-2 border-t border-[#1f293d] flex justify-between text-xs text-slate-400 print:hidden">
          <span>12-Month Est:</span>
          <span className="font-mono text-slate-300 font-bold">
            {peso(monthlyEstimate)}/mo
          </span>
        </div>
      </div>
    </div>
  );

  const renderRecommendationPanel = () => (
    <div className="space-y-3">
      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5">
        <div className="flex justify-between text-xs font-bold mb-1.5">
          <span className="text-slate-400 uppercase tracking-wider text-[10px]">
            Compatibility Score
          </span>
          <span
            className={
              compatibilityScore >= 90
                ? 'text-emerald-400'
                : compatibilityScore >= 70
                ? 'text-amber-400'
                : 'text-red-400'
            }
          >
            {compatibilityScore}%
          </span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              compatibilityScore >= 90
                ? 'bg-emerald-500'
                : compatibilityScore >= 70
                ? 'bg-amber-500'
                : 'bg-red-500'
            }`}
            style={{ width: `${compatibilityScore}%` }}
          ></div>
        </div>
      </div>

      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5 text-left">
        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
          Performance Scoring Module
        </span>
        <h4 className="text-sm font-bold text-white mt-0.5">
          {performanceTier.label}
        </h4>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          {performanceTier.description}
        </p>
      </div>

      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5 text-left">
        <div className="flex justify-between items-center mb-2.5 pb-2 border-b border-[#1f293d]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            System Diagnostics
          </span>
          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
              recommendation.tone === 'danger'
                ? 'bg-red-950 text-red-400 border border-red-800/40'
                : recommendation.tone === 'warning'
                ? 'bg-amber-950 text-amber-400 border border-amber-800/40'
                : 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
            }`}
          >
            {recommendation.title}
          </span>
        </div>

        {dssIssues.length === 0 ? (
          <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">
            {recommendation.summary}
          </p>
        ) : (
          <div className="space-y-2">
            {dssIssues.map((issue) => (
              <div
                key={issue.title}
                className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] text-xs"
              >
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-bold uppercase text-slate-500">
                    {issue.category}
                  </span>
                  <span
                    className={`text-[9px] font-bold uppercase ${
                      issue.severity === 'critical' ? 'text-red-400' : 'text-amber-400'
                    }`}
                  >
                    {issue.severity}
                  </span>
                </div>
                <p className="font-bold text-slate-200 mt-1">{issue.title}</p>
                <p className="text-slate-400 text-[11px] mt-0.5">{issue.message}</p>
                <p className="text-blue-400 text-[11px] mt-1 font-semibold">
                  Fix: {issue.action}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderHomePage = () => {
    const featuredAssortment = CATEGORIES.map((category) => {
      return activeProducts
        .filter(
          (p) =>
            p.category === category &&
            p.stock_status !== 'Sold Out' &&
            p.stock_status !== 'Pre-Order'
        )
        .sort((a, b) => Number(b.hardware_score || 0) - Number(a.hardware_score || 0))[0];
    }).filter(Boolean);

    return (
      <div className="space-y-6">
        <section className="bg-[#111827] border border-[#1f293d] rounded-lg p-6 sm:p-7 text-left">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Custom Hardware Configuration & Upgrade Workshop
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                Configure, Upgrade, and Quote Your Next Desktop.
              </h2>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                Use the Smart Build Assistant to generate budget-matched configurations, validate physical socket pinouts and memory channels, and export formal quotations.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={() => setActivePage('builder')}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors shadow-sm"
                >
                  Launch Smart Builder
                </button>
                <button
                  onClick={() => setActivePage('upgrade')}
                  className="bg-[#0b0f19] hover:bg-slate-800 text-slate-300 border border-[#1f293d] px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  Run Upgrade Checker
                </button>
              </div>
            </div>

            <div className="hidden lg:grid grid-cols-2 gap-3 shrink-0 w-72">
              <div className="p-3 bg-[#0b0f19] border border-[#1f293d] rounded">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">In-Stock SKUs</span>
                <span className="text-lg font-black text-white font-mono">{activeProducts.length} Parts</span>
              </div>
              <div className="p-3 bg-[#0b0f19] border border-[#1f293d] rounded">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">Validation</span>
                <span className="text-lg font-black text-blue-400 font-mono">Rule-Based DSS</span>
              </div>
              <div className="p-3 bg-[#0b0f19] border border-[#1f293d] rounded">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">Pre-Order SKUs</span>
                <span className="text-lg font-black text-white font-mono">{preorderProducts.length} Items</span>
              </div>
              <div className="p-3 bg-[#0b0f19] border border-[#1f293d] rounded">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">Reference DB</span>
                <span className="text-lg font-black text-emerald-400 font-mono">{referenceParts.length} Legacy</span>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Browse Components
            </h3>
            <button
              onClick={() => setActivePage('products')}
              className="text-xs text-blue-400 hover:underline"
            >
              Full Inventory ({activeProducts.length}) →
            </button>
          </div>
          {renderCategoryNavStrip()}
        </section>

        <section>
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 text-left">
              Featured In-Stock Components
            </h3>
            <span className="text-[11px] text-slate-500">
              Top rated per hardware class
            </span>
          </div>

          <div className="space-y-2">
            {featuredAssortment.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[#1f293d] rounded-lg text-slate-500 text-xs">
                Loading hardware catalog...
              </div>
            ) : (
              featuredAssortment.map((p) => renderProductRow(p, true))
            )}
          </div>
        </section>
      </div>
    );
  };

  const renderBuilderPage = () => (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pb-16 lg:pb-0">
      <div className="lg:col-span-8 space-y-4">
        {renderSmartBuildAssistantBar()}
        {renderCategoryNavStrip()}
        {renderCatalogList()}
      </div>

      <aside className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
        {renderBuildSummary()}
        {renderRecommendationPanel()}
      </aside>

      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-[#111827] border-t border-[#1f293d] p-3 px-4 flex justify-between items-center mobile-bottom-bar z-40">
        <div>
          <p className="text-[10px] text-slate-400 uppercase font-bold">Total Estimate</p>
          <p className="text-base font-black text-emerald-400 font-mono">
            {peso(totalPrice)}
          </p>
        </div>
        <button
          onClick={() =>
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
          }
          className="bg-blue-600 text-white px-3.5 py-1.5 rounded text-xs font-bold"
        >
          View Summary ({selectedItems.length}/8)
        </button>
      </div>
    </section>
  );

  const renderUpgradePage = () => (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-8 space-y-4">
        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-2.5 flex gap-2">
          <button
            onClick={() => setUpgradeMode('reference')}
            className={`flex-1 py-2 rounded text-xs font-bold transition-colors ${
              upgradeMode === 'reference'
                ? 'bg-blue-600 text-white'
                : 'bg-[#0b0f19] text-slate-400 hover:text-white'
            }`}
          >
            1. Select Your Current Hardware (Reference DB)
          </button>
          <button
            onClick={() => setUpgradeMode('shop')}
            className={`flex-1 py-2 rounded text-xs font-bold transition-colors ${
              upgradeMode === 'shop'
                ? 'bg-blue-600 text-white'
                : 'bg-[#0b0f19] text-slate-400 hover:text-white'
            }`}
          >
            2. Choose Shop Upgrades
          </button>
        </div>

        {renderCategoryNavStrip()}
        {renderCatalogList(activeTab)}
      </div>

      <aside className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 text-left print:hidden">
          <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#1f293d]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Your Current Rig
            </h4>
            <button
              onClick={handleClearExistingPc}
              className="text-[11px] text-slate-500 hover:text-white"
            >
              Reset
            </button>
          </div>

          <div className="space-y-1.5">
            {CATEGORIES.map((cat) => {
              const item = existingPc[cat];
              const isMemory = cat === 'Memory';

              return (
                <div
                  key={cat}
                  className="p-1.5 rounded bg-[#0b0f19] border border-[#1f293d] text-xs flex justify-between items-center"
                >
                  <div className="min-w-0 pr-2">
                    <span className="text-[9px] text-slate-500 uppercase block">
                      {getCategoryLabel(cat)}
                    </span>
                    <p className="text-white font-semibold truncate text-[11px]">
                      {item ? item.name : <span className="text-slate-600 italic">Not set</span>}
                    </p>
                  </div>
                  {isMemory && item && (
                    <div className="flex items-center gap-1 shrink-0">
                      {[1, 2, 4].map((count) => (
                        <button
                          key={count}
                          onClick={() => setExistingRamCount(count)}
                          className={`px-1 text-[9px] font-bold rounded ${
                            existingRamCount === count
                              ? 'bg-blue-600 text-white'
                              : 'bg-[#111827] text-slate-400'
                          }`}
                        >
                          {count}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {renderBuildSummary()}
        {renderRecommendationPanel()}
      </aside>
    </section>
  );

  // Hidden Administrator Console with PIN Lock & Dedicated Logout Button
  const renderAdminPage = () => {
    const isAuthorized = isAdminAccount || adminUnlocked;

    if (!isAuthorized) {
      return (
        <div className="max-w-md mx-auto bg-[#111827] border border-[#1f293d] rounded-lg p-6 text-left">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
              Restricted Staff Portal
            </span>
            <button
              onClick={() => setActivePage('home')}
              className="text-xs text-slate-500 hover:text-white"
            >
              ← Exit
            </button>
          </div>
          <h3 className="text-lg font-bold text-white mb-1">
            Administrator Console Lock
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Enter the authorized workshop PIN to unlock inventory, reference parts, and rule management.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (adminPinInput === '1234' || adminPinInput.toLowerCase() === 'admin') {
                setAdminUnlocked(true);
                setAdminPinInput('');
              } else {
                alert('Invalid Administrator PIN.');
              }
            }}
            className="space-y-3"
          >
            <div>
              <label className="text-xs text-slate-400 block mb-1">Workshop Admin PIN</label>
              <input
                type="password"
                required
                autoComplete="off"
                value={adminPinInput}
                onChange={(e) => setAdminPinInput(e.target.value)}
                placeholder="Enter PIN"
                className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-xs font-bold uppercase"
            >
              Unlock Console
            </button>
          </form>
        </div>
      );
    }

    const currentAdminDataset =
      adminSection === 'reference'
        ? referenceParts
        : adminTableSource === 'preorder'
        ? preorderProducts
        : activeProducts;

    const currentAdminTableName =
      adminSection === 'reference'
        ? REFERENCE_TABLE
        : adminTableSource === 'preorder'
        ? PREORDER_TABLE
        : ACTIVE_TABLE;

    const filteredAdminItems = currentAdminDataset.filter((item) => {
      const matchesCat =
        adminCategoryFilter === 'All' ||
        normalizeText(item.category) === normalizeText(adminCategoryFilter);
      const q = normalizeText(adminSearch);
      const matchesSearch =
        q === '' ||
        normalizeText(item.name).includes(q) ||
        normalizeText(item.brand).includes(q) ||
        normalizeText(item.socket).includes(q);
      return matchesCat && matchesSearch;
    });

    return (
      <div className="space-y-6 text-left">
        {/* Top Admin Header with Lock & Exit Admin Button */}
        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                ByteBuild System Administrator Console
              </span>
              <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded font-bold">
                Unlocked
              </span>
            </div>
            <h2 className="text-xl font-black text-white mt-0.5">
              Catalog, Reference DB, Compatibility Rules & Quotation Manager
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'catalog', label: `1. Catalog (${activeProducts.length + preorderProducts.length})` },
              { id: 'reference', label: `2. Reference DB (${referenceParts.length})` },
              { id: 'rules', label: '3. DSS Rules' },
              { id: 'quotations', label: '4. Quotations' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setAdminSection(tab.id)}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                  adminSection === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#0b0f19] border border-[#1f293d] text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}

            <button
              type="button"
              onClick={handleAdminLogout}
              className="px-3 py-1.5 rounded bg-red-950/80 hover:bg-red-800 text-red-300 border border-red-700/50 text-xs font-bold uppercase transition-colors ml-1"
            >
              Lock & Exit Admin
            </button>
          </div>
        </div>

        {/* SECTION 1 & 2: PRODUCT CATALOG & REFERENCE DATABASE CRUD */}
        {(adminSection === 'catalog' || adminSection === 'reference') && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                {adminSection === 'reference' ? 'D2: Reference Parts Database' : 'D1: Products Database'}
              </span>
              <h3 className="text-sm font-bold text-white">
                {adminSection === 'reference'
                  ? 'Add Legacy / Reference Component'
                  : 'Add New Catalog Component'}
              </h3>

              <form
                onSubmit={(e) =>
                  handleAdminAddItem(e, adminSection === 'reference' ? 'reference' : 'catalog')
                }
                className="space-y-2.5 text-xs"
              >
                <div>
                  <label className="text-slate-400 block mb-1">Component Name *</label>
                  <input
                    type="text"
                    required
                    value={newItemForm.name}
                    onChange={(e) => setNewItemForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. AMD Ryzen 5 5600"
                    className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Brand</label>
                    <input
                      type="text"
                      value={newItemForm.brand}
                      onChange={(e) => setNewItemForm((p) => ({ ...p, brand: e.target.value }))}
                      placeholder="AMD / Intel / MSI"
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Category</label>
                    <select
                      value={newItemForm.category}
                      onChange={(e) => setNewItemForm((p) => ({ ...p, category: e.target.value }))}
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1.5 text-white"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {adminSection === 'catalog' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Retail Price (PHP) *</label>
                      <input
                        type="number"
                        required
                        value={newItemForm.price}
                        onChange={(e) => setNewItemForm((p) => ({ ...p, price: e.target.value }))}
                        placeholder="7190"
                        className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Stock Status</label>
                      <select
                        value={newItemForm.stock_status}
                        onChange={(e) => setNewItemForm((p) => ({ ...p, stock_status: e.target.value }))}
                        className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1.5 text-white"
                      >
                        <option value="In Stock">In Stock</option>
                        <option value="Pre-Order">Pre-Order</option>
                        <option value="Sold Out">Sold Out</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Socket</label>
                    <input
                      type="text"
                      value={newItemForm.socket}
                      onChange={(e) => setNewItemForm((p) => ({ ...p, socket: e.target.value }))}
                      placeholder="AM4 / AM5"
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">RAM Std</label>
                    <input
                      type="text"
                      value={newItemForm.memory_type}
                      onChange={(e) => setNewItemForm((p) => ({ ...p, memory_type: e.target.value }))}
                      placeholder="DDR4 / DDR5"
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Score (1-100)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={newItemForm.hardware_score}
                      onChange={(e) => setNewItemForm((p) => ({ ...p, hardware_score: e.target.value }))}
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1.5 text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Technical Specifications</label>
                  <textarea
                    rows={2}
                    value={newItemForm.specs}
                    onChange={(e) => setNewItemForm((p) => ({ ...p, specs: e.target.value }))}
                    placeholder="6 Cores / 12 Threads, 65W TDP, PCIe 4.0..."
                    className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                  />
                </div>

                <button
                  type="submit"
                  disabled={adminSaving}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded font-bold uppercase tracking-wider"
                >
                  {adminSaving ? 'Saving to Supabase...' : '+ Insert Record'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-8 bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#1f293d]">
                <div className="flex items-center gap-2">
                  {adminSection === 'catalog' && (
                    <div className="flex bg-[#0b0f19] p-1 rounded border border-[#1f293d]">
                      <button
                        type="button"
                        onClick={() => setAdminTableSource('active')}
                        className={`px-2.5 py-1 rounded text-xs font-bold ${
                          adminTableSource === 'active' ? 'bg-blue-600 text-white' : 'text-slate-400'
                        }`}
                      >
                        Active Inventory ({activeProducts.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminTableSource('preorder')}
                        className={`px-2.5 py-1 rounded text-xs font-bold ${
                          adminTableSource === 'preorder' ? 'bg-blue-600 text-white' : 'text-slate-400'
                        }`}
                      >
                        Pre-Order Table ({preorderProducts.length})
                      </button>
                    </div>
                  )}
                  <select
                    value={adminCategoryFilter}
                    onChange={(e) => setAdminCategoryFilter(e.target.value)}
                    className="bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="All">All Categories</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <input
                  type="text"
                  placeholder="Filter records by name or brand..."
                  value={adminSearch}
                  onChange={(e) => setAdminSearch(e.target.value)}
                  className="bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-xs text-white w-full sm:w-64"
                />
              </div>

              <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
                {filteredAdminItems.map((item) => (
                  <div
                    key={`admin-${item.id}`}
                    className="p-3 rounded bg-[#0b0f19] border border-[#1f293d] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#111827] text-blue-400">
                          {item.category}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          ID: {item.id}
                        </span>
                        {item.socket && (
                          <span className="text-[10px] text-slate-400">
                            Socket: {item.socket}
                          </span>
                        )}
                      </div>
                      <p className="font-bold text-white truncate mt-0.5">{item.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{item.specs}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {adminSection === 'catalog' && (
                        <>
                          <span className="font-mono font-bold text-emerald-400">
                            {peso(item.price)}
                          </span>
                          <select
                            value={item.stock_status || 'In Stock'}
                            onChange={(e) =>
                              handleAdminQuickStatusToggle(item, currentAdminTableName, e.target.value)
                            }
                            className="bg-[#111827] border border-[#1f293d] rounded px-2 py-1 text-[11px] text-white"
                          >
                            <option value="In Stock">In Stock</option>
                            <option value="Pre-Order">Pre-Order</option>
                            <option value="Sold Out">Sold Out</option>
                          </select>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setEditingItem({ ...item, _table: currentAdminTableName })
                        }
                        className="px-2.5 py-1 rounded bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600 hover:text-white font-bold"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdminDeleteItem(item, currentAdminTableName)}
                        className="px-2 py-1 rounded text-slate-500 hover:text-red-400 font-bold"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: MAINTAIN COMPATIBILITY & RECOMMENDATION RULES (D3) */}
        {adminSection === 'rules' && (
          <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-5 max-w-3xl space-y-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                D3: Compatibility & Rule-Based Recommendation Engine
              </span>
              <h3 className="text-base font-bold text-white mt-0.5">
                Configure Deterministic Hardware Validation & Budget Allocation Rules
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Changes made here immediately govern the Compatibility Engine, Upgrade Checker, and Smart Build Assistant.
              </p>
            </div>

            <form onSubmit={handleSaveDssRules} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 rounded bg-[#0b0f19] border border-[#1f293d]">
                  <label className="font-bold text-white block mb-1">
                    PSU Transient Headroom Buffer (Watts)
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Added to CPU + GPU TDP to compute minimum safe power supply capacity.
                  </p>
                  <input
                    type="number"
                    value={dssRules.psuBufferWatts}
                    onChange={(e) =>
                      setDssRules((r) => ({ ...r, psuBufferWatts: Number(e.target.value) }))
                    }
                    className="w-full bg-[#111827] border border-[#1f293d] rounded px-3 py-1.5 text-white font-mono"
                  />
                </div>

                <div className="p-3 rounded bg-[#0b0f19] border border-[#1f293d]">
                  <label className="font-bold text-white block mb-1">
                    Minimum Recommended RAM Capacity (GB)
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Triggers a capacity warning if total installed memory falls below this threshold.
                  </p>
                  <input
                    type="number"
                    value={dssRules.minRecommendedRamGB}
                    onChange={(e) =>
                      setDssRules((r) => ({ ...r, minRecommendedRamGB: Number(e.target.value) }))
                    }
                    className="w-full bg-[#111827] border border-[#1f293d] rounded px-3 py-1.5 text-white font-mono"
                  />
                </div>

                <div className="p-3 rounded bg-[#0b0f19] border border-[#1f293d]">
                  <label className="font-bold text-white block mb-1">
                    Minimum Primary Storage Baseline (GB)
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Flags restricted OS/game storage footprint if SSD is smaller than this limit.
                  </p>
                  <input
                    type="number"
                    value={dssRules.minStorageCapacityGB}
                    onChange={(e) =>
                      setDssRules((r) => ({ ...r, minStorageCapacityGB: Number(e.target.value) }))
                    }
                    className="w-full bg-[#111827] border border-[#1f293d] rounded px-3 py-1.5 text-white font-mono"
                  />
                </div>

                <div className="p-3 rounded bg-[#0b0f19] border border-[#1f293d]">
                  <label className="font-bold text-white block mb-1">
                    Max Allowed CPU-to-GPU Tier Disparity
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Maximum tier difference before flagging a severe bottleneck alert.
                  </p>
                  <input
                    type="number"
                    min="1"
                    max="4"
                    value={dssRules.maxAllowedTierGap}
                    onChange={(e) =>
                      setDssRules((r) => ({ ...r, maxAllowedTierGap: Number(e.target.value) }))
                    }
                    className="w-full bg-[#111827] border border-[#1f293d] rounded px-3 py-1.5 text-white font-mono"
                  />
                </div>

                <div className="p-3 rounded bg-[#0b0f19] border border-[#1f293d]">
                  <label className="font-bold text-white block mb-1">
                    Smart Builder: Gaming GPU Budget Share (%)
                  </label>
                  <input
                    type="number"
                    min="20"
                    max="55"
                    value={dssRules.gamingGpuWeight}
                    onChange={(e) =>
                      setDssRules((r) => ({ ...r, gamingGpuWeight: Number(e.target.value) }))
                    }
                    className="w-full bg-[#111827] border border-[#1f293d] rounded px-3 py-1.5 text-white font-mono"
                  />
                </div>

                <div className="p-3 rounded bg-[#0b0f19] border border-[#1f293d]">
                  <label className="font-bold text-white block mb-1">
                    Smart Builder: Creator CPU Budget Share (%)
                  </label>
                  <input
                    type="number"
                    min="15"
                    max="45"
                    value={dssRules.creatorCpuWeight}
                    onChange={(e) =>
                      setDssRules((r) => ({ ...r, creatorCpuWeight: Number(e.target.value) }))
                    }
                    className="w-full bg-[#111827] border border-[#1f293d] rounded px-3 py-1.5 text-white font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold uppercase"
                >
                  Save & Apply Rule Parameters
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDssRules(DEFAULT_DSS_RULES);
                    localStorage.removeItem('bytebuild_dss_rules');
                  }}
                  className="px-4 py-2 rounded bg-[#1f293d] text-slate-300 hover:text-white font-bold"
                >
                  Reset Defaults
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SECTION 4: REVIEW GENERATED QUOTATIONS (D5) & PRE-ORDER REQUESTS */}
        {adminSection === 'quotations' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-center border-b border-[#1f293d] pb-2">
                <div>
                  <span className="text-[10px] font-bold uppercase text-blue-400">
                    D5: Quotations Database
                  </span>
                  <h3 className="text-sm font-bold text-white">
                    Generated Customer Quotations ({adminQuotations.length})
                  </h3>
                </div>
                <button
                  onClick={fetchAdminLogs}
                  className="text-xs text-blue-400 hover:underline"
                >
                  Refresh
                </button>
              </div>

              {adminQuotations.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  No exported quotations logged yet. Click "Export" in the Builder manifest to log a quotation.
                </p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {adminQuotations.map((q) => (
                    <div
                      key={q.id}
                      className="p-3 rounded bg-[#0b0f19] border border-[#1f293d] flex justify-between items-center text-xs"
                    >
                      <div>
                        <span className="font-mono font-bold text-blue-400">
                          {q.reference_code}
                        </span>
                        <p className="text-white font-semibold mt-0.5">
                          {q.customer_email || 'Walk-in Customer'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {new Date(q.created_at).toLocaleString()} · Compatibility: {q.compatibility_score}%
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-bold text-emerald-400 text-sm">
                          {peso(q.total_price)}
                        </p>
                        <button
                          onClick={() => {
                            if (q.build_data) {
                              setSelectedBuild(q.build_data);
                              setActivePage('builder');
                            }
                          }}
                          className="text-[11px] text-blue-400 hover:underline mt-1"
                        >
                          Inspect Rig →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-center border-b border-[#1f293d] pb-2">
                <div>
                  <span className="text-[10px] font-bold uppercase text-emerald-400">
                    Supplier Allocation Queue
                  </span>
                  <h3 className="text-sm font-bold text-white">
                    Customer Pre-Order Inquiries ({adminAllPreorders.length})
                  </h3>
                </div>
              </div>

              {adminAllPreorders.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  No pre-order requests submitted yet.
                </p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {adminAllPreorders.map((order) => (
                    <div
                      key={order.id}
                      className="p-3 rounded bg-[#0b0f19] border border-[#1f293d] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <p className="font-bold text-white">{order.product_name}</p>
                        <p className="text-slate-400 text-[11px]">
                          {order.customer_name} · {order.contact_number}
                        </p>
                        <p className="font-mono text-emerald-400 font-bold mt-0.5">
                          {peso(order.estimated_price)}
                        </p>
                      </div>
                      <select
                        value={order.status || 'Pending Supplier Confirmation'}
                        onChange={(e) =>
                          handleAdminUpdatePreorderStatus(order.id, e.target.value)
                        }
                        className="bg-[#111827] border border-[#1f293d] rounded px-2 py-1 text-[11px] text-white"
                      >
                        <option value="Pending Supplier Confirmation">Pending Supplier</option>
                        <option value="Allocation Confirmed">Allocation Confirmed</option>
                        <option value="Ready for Pickup">Ready for Pickup</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Edit Component Modal */}
        {editingItem && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
            <div className="bg-[#111827] border border-[#1f293d] max-w-md w-full rounded-lg p-5 shadow-2xl text-left text-white">
              <div className="flex justify-between items-center border-b border-[#1f293d] pb-2.5 mb-3">
                <h4 className="text-sm font-bold">Edit Hardware Specification</h4>
                <button
                  onClick={() => setEditingItem(null)}
                  className="text-slate-400 hover:text-white font-bold"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleAdminSaveEdit} className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Component Name</label>
                  <input
                    type="text"
                    required
                    value={editingItem.name || ''}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                  />
                </div>

                {editingItem._table !== REFERENCE_TABLE && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Price (PHP)</label>
                      <input
                        type="number"
                        value={editingItem.price || 0}
                        onChange={(e) =>
                          setEditingItem((prev) => ({ ...prev, price: e.target.value }))
                        }
                        className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Stock Status</label>
                      <select
                        value={editingItem.stock_status || 'In Stock'}
                        onChange={(e) =>
                          setEditingItem((prev) => ({ ...prev, stock_status: e.target.value }))
                        }
                        className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1.5 text-white"
                      >
                        <option value="In Stock">In Stock</option>
                        <option value="Pre-Order">Pre-Order</option>
                        <option value="Sold Out">Sold Out</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Socket</label>
                    <input
                      type="text"
                      value={editingItem.socket || ''}
                      onChange={(e) =>
                        setEditingItem((prev) => ({ ...prev, socket: e.target.value }))
                      }
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">RAM Type</label>
                    <input
                      type="text"
                      value={editingItem.memory_type || ''}
                      onChange={(e) =>
                        setEditingItem((prev) => ({ ...prev, memory_type: e.target.value }))
                      }
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Score</label>
                    <input
                      type="number"
                      value={editingItem.hardware_score || 75}
                      onChange={(e) =>
                        setEditingItem((prev) => ({ ...prev, hardware_score: e.target.value }))
                      }
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1.5 text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Specifications</label>
                  <textarea
                    rows={2}
                    value={editingItem.specs || ''}
                    onChange={(e) =>
                      setEditingItem((prev) => ({ ...prev, specs: e.target.value }))
                    }
                    className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="flex-1 py-1.5 rounded border border-[#1f293d] text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={adminSaving}
                    className="flex-1 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase"
                  >
                    {adminSaving ? 'Saving...' : 'Update Record'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLoginPage = () => {
    if (currentUser && authMode !== 'update-password') {
      return (
        <div className="max-w-4xl mx-auto space-y-4 text-left">
          <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-5 flex justify-between items-center">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Customer Account
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">{currentUser.email}</h3>
            </div>
            <button
              onClick={handleSignOut}
              className="px-3 py-1.5 border border-red-500/40 text-red-400 hover:bg-red-500/10 rounded text-xs font-bold"
            >
              Sign Out
            </button>
          </div>

          <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-5">
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
              Saved Rig Configurations ({savedBuilds.length})
            </h4>

            {savedBuilds.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No saved builds found.</p>
            ) : (
              <div className="space-y-2">
                {savedBuilds.map((b) => (
                  <div
                    key={b.id}
                    className="p-3 rounded bg-[#0b0f19] border border-[#1f293d] flex justify-between items-center"
                  >
                    <div>
                      <p className="text-sm font-bold text-white">{b.build_name}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(b.created_at).toLocaleDateString()} · Score: {b.compatibility_score}%
                      </p>
                      <p className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
                        {peso(b.total_price)}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoadSavedBuild(b)}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteSavedBuild(b.id)}
                        className="px-2.5 py-1 text-slate-500 hover:text-red-400 text-xs"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (authMode === 'update-password') {
      return (
        <div className="max-w-md mx-auto bg-[#111827] border border-[#1f293d] rounded-lg p-6 text-left">
          <h3 className="text-lg font-bold text-white mb-1">Set New Password</h3>
          <p className="text-xs text-slate-400 mb-4">
            Enter your new secure password below to finalize account recovery.
          </p>

          {authError && (
            <div className="p-2 mb-3 bg-red-950/60 border border-red-800/40 text-red-300 text-xs rounded">
              {authError}
            </div>
          )}

          <form onSubmit={handleUpdatePassword} className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-xs font-bold uppercase transition-colors"
            >
              {authLoading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      );
    }

    if (authMode === 'forgot-password') {
      return (
        <div className="max-w-md mx-auto bg-[#111827] border border-[#1f293d] rounded-lg p-6 text-left">
          <h3 className="text-lg font-bold text-white mb-1">Reset Password</h3>
          <p className="text-xs text-slate-400 mb-4">
            Enter your account email and we'll send you a secure password reset link.
          </p>

          {authError && (
            <div className="p-2 mb-3 bg-red-950/60 border border-red-800/40 text-red-300 text-xs rounded">
              {authError}
            </div>
          )}

          {forgotEmailSent ? (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-950/60 border border-emerald-800/40 text-emerald-300 text-xs rounded">
                Password recovery email sent! Check your inbox for the secure reset link.
              </div>
              <button
                onClick={() => {
                  setAuthMode('login');
                  setForgotEmailSent(false);
                }}
                className="w-full bg-[#1f293d] hover:bg-slate-700 text-white py-2 rounded text-xs font-bold uppercase transition-colors"
              >
                Return to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handlePasswordReset} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="e.g. kenneth@bytebuild.ph"
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-xs font-bold uppercase transition-colors"
              >
                {authLoading ? 'Sending Link...' : 'Send Recovery Email'}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          )}
        </div>
      );
    }

    return (
      <div className="max-w-md mx-auto bg-[#111827] border border-[#1f293d] rounded-lg p-6 text-left">
        <h3 className="text-lg font-bold text-white mb-1">
          {authMode === 'login' ? 'Sign In to Your Account' : 'Register Account'}
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          Save your build history and track distributor pre-orders.
        </p>

        {authError && (
          <div className="p-2 mb-3 bg-red-950/60 border border-red-800/40 text-red-300 text-xs rounded">
            {authError}
          </div>
        )}

        <form onSubmit={handleAuthSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Email Address</label>
            <input
              type="email"
              required
              autoComplete="username"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs text-slate-400">Password</label>
              {authMode === 'login' && (
                <button
                  type="button"
                  onClick={() => setAuthMode('forgot-password')}
                  className="text-[11px] text-blue-400 hover:underline"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={authLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-xs font-bold uppercase transition-colors"
          >
            {authLoading ? 'Verifying...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="mt-4 pt-3 border-t border-[#1f293d] text-center">
          <button
            onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
            className="text-xs text-blue-400 hover:underline"
          >
            {authMode === 'login'
              ? "Don't have an account? Register"
              : 'Already have an account? Sign In'}
          </button>
        </div>
      </div>
    );
  };

  const renderProductModal = () => {
    if (!selectedProduct) return null;
    const product = selectedProduct;
    const category = product.category;
    const cpu = getCpuProfile(product);
    const gpu = getGpuProfile(product);
    const ram = getRamProfile(product, 2);
    const storage = getStorageProfile(product);
    const psu = getPsuProfile(product);
    const cooler = getCoolerProfile(product);
    const pcCase = getCaseProfile(product);

    let generatedNote = 'Standard hardware specification.';
    if (category === 'Processors') {
      generatedNote = `${cpu.label} · Socket: ${product.socket || detectCpuSocket(product) || 'Unknown'} · TDP: ${cpu.watts || product.tdp || 'Unknown'}W.`;
    } else if (category === 'Motherboards') {
      generatedNote = `Platform: ${product.socket || detectMotherboardSocket(product) || 'Unknown'} · Chipset: ${product.chipset || 'Unknown'} · Memory: ${product.memory_type || 'Unknown'}.`;
    } else if (category === 'Video Cards') {
      generatedNote = `${gpu.label} · Board Power: ${gpu.watts || product.wattage || 'Unknown'}W.`;
    } else if (category === 'Memory') {
      generatedNote = `Kit Capacity: ${product.capacity || `${ram.perStickCapacity || 'Unknown'}GB per stick`} · Type: ${ram.type}.`;
    } else if (category === 'Storage') {
      generatedNote = `Device: ${product.capacity || 'Unknown'} · Interface: ${product.interface_type || storage.driveClass}.`;
    } else if (category === 'Power Supplies') {
      generatedNote = `Wattage: ${psu.watts || 'Unknown'}W · Certification: ${psu.rating}.`;
    } else if (category === 'CPU Coolers') {
      generatedNote = `${cooler.label} · Verify socket support before assembly.`;
    } else if (category === 'Cases') {
      generatedNote = `Form Factor: ${product.form_factor || pcCase.formFactor} · Airflow: ${pcCase.airflow ? 'High Airflow' : 'Standard'}.`;
    }

    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div className="bg-[#111827] border border-[#1f293d] max-w-xl w-full rounded-lg p-5 shadow-2xl text-left text-white">
          <div className="flex justify-between items-start border-b border-[#1f293d] pb-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                {getCategoryLabel(product.category)} Specification
              </span>
              <h3 className="text-base font-bold text-white mt-0.5">{product.name}</h3>
            </div>
            <button
              onClick={() => setSelectedProduct(null)}
              className="text-slate-400 hover:text-white font-bold text-lg"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5 my-4 text-xs">
            <div className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d]">
              <span className="text-[10px] text-slate-500 uppercase block">Brand</span>
              <span className="font-bold text-white">{product.brand || 'OEM'}</span>
            </div>
            <div className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d]">
              <span className="text-[10px] text-slate-500 uppercase block">Price</span>
              <span className="font-bold text-emerald-400 font-mono">
                {product.price ? peso(product.price) : 'Reference Part'}
              </span>
            </div>
            <div className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d]">
              <span className="text-[10px] text-slate-500 uppercase block">Hardware Rating</span>
              <span className="font-bold text-white">{product.hardware_score || 75}/100</span>
            </div>
            <div className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d]">
              <span className="text-[10px] text-slate-500 uppercase block">Form Factor / Socket</span>
              <span className="font-bold text-white">
                {product.socket || detectPartFormFactor(product)}
              </span>
            </div>
          </div>

          <div className="p-3 rounded bg-[#0b0f19] border border-[#1f293d] text-xs text-slate-300">
            <span className="text-[10px] text-slate-500 uppercase block mb-1 font-bold">
              Technical Description
            </span>
            {product.specs || generatedNote}
          </div>
        </div>
      </div>
    );
  };

  const renderPreorderModal = () => {
    if (!preorderModalItem) return null;
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
        <div className="bg-[#111827] border border-[#1f293d] max-w-md w-full rounded-lg p-5 shadow-2xl text-left text-white">
          <div className="flex justify-between items-start border-b border-[#1f293d] pb-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                Supplier Pre-Order Allocation
              </span>
              <h3 className="text-base font-bold text-white mt-0.5">{preorderModalItem.name}</h3>
            </div>
            <button
              onClick={() => setPreorderModalItem(null)}
              className="text-slate-400 hover:text-white font-bold text-lg"
            >
              ×
            </button>
          </div>

          <form onSubmit={handlePreorderSubmit} className="mt-4 space-y-3">
            <div className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] flex justify-between items-center text-xs">
              <span className="text-slate-400 font-bold">Estimated Price:</span>
              <span className="font-bold text-emerald-400 font-mono text-sm">
                {peso(preorderModalItem.price)}
              </span>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Customer Full Name</label>
              <input
                type="text"
                required
                value={preorderForm.customer_name}
                onChange={(e) => setPreorderForm((prev) => ({ ...prev, customer_name: e.target.value }))}
                placeholder="e.g. Kenneth Rabang"
                className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Contact Number</label>
              <input
                type="tel"
                required
                value={preorderForm.contact_number}
                onChange={(e) => setPreorderForm((prev) => ({ ...prev, contact_number: e.target.value }))}
                placeholder="09XX XXX XXXX"
                className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setPreorderModalItem(null)}
                className="flex-1 py-1.5 rounded border border-[#1f293d] text-xs font-bold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={preorderSubmitting}
                className="flex-1 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase transition-colors"
              >
                {preorderSubmitting ? 'Logging...' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0f19] text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-slate-500 font-mono">Loading ByteBuild Hardware Inventory...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ByteBuildGlobalStyles />
      <div className="min-h-screen bg-[#0b0f19] text-slate-200">
        <header className="border-b border-[#1f293d] bg-[#111827] sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
            <button
              onClick={handleLogoClick}
              title="ByteBuild Home"
              className="flex items-center gap-2 select-none"
            >
              <img src={bbLogo} alt="ByteBuild Logo" className="h-7 w-auto object-contain" />
              <span className="text-sm font-black tracking-tight text-white uppercase hidden sm:inline">
                BYTEBUILD
              </span>
            </button>

            <nav className="flex items-center gap-1 overflow-x-auto">
              {[
                'home',
                'products',
                'builder',
                'upgrade',
                ...(isAdminAccount || adminUnlocked ? ['admin'] : []),
              ].map((page) => (
                <button
                  key={page}
                  onClick={() => setActivePage(page)}
                  className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-colors ${
                    activePage === page
                      ? 'bg-blue-600 text-white'
                      : page === 'admin'
                      ? 'text-emerald-400 border border-emerald-800/50 bg-emerald-950/30 hover:bg-emerald-900/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {page === 'products'
                    ? 'Inventory'
                    : page === 'builder'
                    ? 'Builder'
                    : page === 'upgrade'
                    ? 'Upgrade'
                    : page === 'admin'
                    ? 'Admin Console'
                    : 'Home'}
                </button>
              ))}
            </nav>

            <div>
              <button
                onClick={() => setActivePage('login')}
                className="px-3 py-1.5 rounded bg-[#1f293d] hover:bg-slate-700 text-xs font-bold text-white"
              >
                {currentUser ? currentUser.email.split('@')[0] : 'Sign In'}
              </button>
            </div>
          </div>
        </header>

        <main key={activePage} className="max-w-7xl mx-auto px-4 py-6 app-view-container">
          {activePage === 'home' && renderHomePage()}
          {activePage === 'products' && (
            <div className="space-y-4">
              {renderCategoryNavStrip()}
              {renderCatalogList()}
            </div>
          )}
          {activePage === 'builder' && renderBuilderPage()}
          {activePage === 'upgrade' && renderUpgradePage()}
          {activePage === 'admin' && renderAdminPage()}
          {activePage === 'login' && renderLoginPage()}
        </main>
      </div>

      {renderProductModal()}
      {renderPreorderModal()}
    </>
  );
}