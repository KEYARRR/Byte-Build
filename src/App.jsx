import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWorker } from 'tesseract.js';
import { supabase } from './supabaseClient';
import bbLogo from './assets/bblogo.png';
import { CATEGORIES, WORKLOAD_WEIGHTS } from './lib/config.js';
import { calculateBuildTotal, getEffectiveItemPrice, isPrebundledKit } from './lib/pricing.js';
import { calculateRigWattage, getPsuProfile } from './lib/power.js';
import {
  calculateCompatibilityScore,
  evaluateBottleneckBalance,
  getVerificationCoverage,
} from './lib/scoring.js';
import {
  evaluateBuildRules,
  detectCpuSocket,
  detectMotherboardSocket,
} from './lib/compat.js';
import { parseRam } from './lib/ram.js';
import { runSmartBuildAssistant } from './lib/autobuilder.js';
import { matchOcrTextToCatalog, applyInStockOcrMatches } from './lib/ocr.js';
import {
  detectPartFormFactor,
  getBrandsForCategory,
  getFormFactorsForCategory,
  getCategoryCounts,
  filterAndSortCatalogProducts,
} from './lib/catalog.js';
import {
  buildQuotationPayload,
  buildQuotationHtmlDocument,
} from './lib/quotation.js';
import {
  normalizeSavedBuildRecord,
  validatePreorderInput,
  buildPreorderRequestPayload,
} from './lib/orders.js';
import {
  buildAdminInsertPayload,
  buildAdminUpdatePayload,
  filterAdminRecords,
  normalizeDssRules,
} from './lib/admin.js';
import {
  createCustomOwnedPart,
  isCustomPartItem,
  getCustomBuildSummary,
  buildLearnMoreUrl,
  getItemDisplayStatus,
} from './lib/customParts.js';
import {
  buildDiagnosticIssues,
  buildSystemRecommendation,
  evaluatePerformanceTier,
} from './lib/diagnostics.js';
import {
  buildSlotManifestRows,
  computePowerDisplayMetrics,
} from './lib/buildSummary.js';
import { getRuleChipMeta } from './lib/ruleDisplay.js';

const ACTIVE_TABLE = 'bytebuild_current_inventory';
const PREORDER_TABLE = 'bytebuild_preorder_inventory';
const REFERENCE_TABLE = 'bytebuild_reference_parts';

const ADMIN_EMAILS = [
  'admin@bytebuild.ph',
  'kenneth@bytebuild.ph',
];

const INITIAL_BUILD = CATEGORIES.reduce((acc, cat) => {
  acc[cat] = null;
  return acc;
}, {});

const INITIAL_EXISTING_PC = { ...INITIAL_BUILD };

const DEFAULT_DSS_RULES = {
  psuBufferWatts: 120,
  minRecommendedRamGB: 16,
  minStorageCapacityGB: 500,
  maxAllowedTierGap: 2,
  gamingGpuWeight: WORKLOAD_WEIGHTS?.Gaming?.['Video Cards'] ?? 36,
  gamingCpuWeight: WORKLOAD_WEIGHTS?.Gaming?.Processors ?? 21,
  creatorGpuWeight: WORKLOAD_WEIGHTS?.['Content Creation']?.['Video Cards'] ?? 29,
  creatorCpuWeight: WORKLOAD_WEIGHTS?.['Content Creation']?.Processors ?? 27,
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const peso = (value) =>
  `\u20B1${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;

const getCategoryLabel = (category) => {
  if (category === 'Video Cards') return 'Graphics Cards';
  if (category === 'Power Supplies') return 'Power Supply';
  if (category === 'CPU Coolers') return 'CPU Cooler';
  return category;
};

const getRamSummary = (part, stickCount = 2) => {
  if (!part) {
    return {
      stickCount: 0,
      perStickCapacity: 0,
      totalCapacity: 0,
      isKit: false,
      totalPrice: 0,
    };
  }
  const parsed = parseRam(part, stickCount);
  return {
    stickCount: parsed.stickCount,
    perStickCapacity: parsed.perStickCapacity,
    totalCapacity: parsed.totalCapacity,
    isKit: parsed.isKit,
    totalPrice: getEffectiveItemPrice('Memory', part, stickCount),
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
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
      }
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }
      input,
      select,
      textarea {
        color-scheme: dark;
      }
      .font-mono {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif !important;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.01em;
      }
      .no-scrollbar::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
      .no-scrollbar {
        -ms-overflow-style: none !important;
        scrollbar-width: none !important;
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
          transform: translateY(4px);
        }
        100% {
          opacity: 1;
          transform: none;
        }
      }
      .app-view-container {
        animation: appViewTransition 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
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
        button,
        input,
        select,
        .print\\:hidden,
        .mobile-bottom-bar {
          display: none !important;
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

  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const [buildFocused, setBuildFocused] = useState(false);
  const [showUnknownRules, setShowUnknownRules] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedFormFactor, setSelectedFormFactor] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortBy, setSortBy] = useState('price-asc');
  const [showSoldOut, setShowSoldOut] = useState(false);

  const [overclockEnabled, setOverclockEnabled] = useState(false);
  const [powerDisplayView, setPowerDisplayView] = useState('load');
  const [assistantBudget, setAssistantBudget] = useState(40000);
  const [assistantProfile, setAssistantProfile] = useState('Gaming');
  const [assistantStatus, setAssistantStatus] = useState('');

  const [dssRules, setDssRules] = useState(() => {
    try {
      const saved = localStorage.getItem('bytebuild_dss_rules');
      return normalizeDssRules(saved ? JSON.parse(saved) : {}, DEFAULT_DSS_RULES);
    } catch {
      return DEFAULT_DSS_RULES;
    }
  });

  const [selectedBuild, setSelectedBuild] = useState(INITIAL_BUILD);
  const [existingPc, setExistingPc] = useState(INITIAL_EXISTING_PC);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);

  const [existingRamCount, setExistingRamCount] = useState(2);
  const [selectedRamCount, setSelectedRamCount] = useState(2);

  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customPartForm, setCustomPartForm] = useState({
    category: 'Processors',
    name: '',
    brand: 'Custom',
    price: '',
    socket: '',
    memory_type: '',
    form_factor: '',
    wattage: '',
    specs: '',
    specs_url: '',
  });

  const [ocrText, setOcrText] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [ocrScanResults, setOcrScanResults] = useState([]);
  const [showRawOcrText, setShowRawOcrText] = useState(false);

  const focusViewRef = useRef(null);
  const [compareCategory, setCompareCategory] = useState('Video Cards');
  const [selectedRuleId, setSelectedRuleId] = useState(null);

  const [printReferenceId] = useState(() => Math.floor(100000 + Math.random() * 900000));
  const [printDateString] = useState(() =>
    new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
  );

  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [forgotEmailSent, setForgotEmailSent] = useState(false);

  const [savedBuilds, setSavedBuilds] = useState([]);
  const [savingBuild, setSavingBuild] = useState(false);
  const [exportingQuote, setExportingQuote] = useState(false);

  const [preorderModalItem, setPreorderModalItem] = useState(null);
  const [userPreorders, setUserPreorders] = useState([]);
  const [preorderForm, setPreorderForm] = useState({
    customer_name: '',
    contact_number: '',
    email: '',
  });
  const [preorderSubmitting, setPreorderSubmitting] = useState(false);

  const [, setLogoTapCount] = useState(0);
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
    psu_tier: '',
    hardware_score: 78,
    specs: '',
  });

  const isAdminAccount = useMemo(() => {
    if (!currentUser?.email) return false;
    return ADMIN_EMAILS.includes(currentUser.email.toLowerCase());
  }, [currentUser]);

  const refreshInventoryNow = useCallback(async () => {
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
    }
  }, []);

  const refreshAdminLogsNow = useCallback(async () => {
    try {
      const { data: quotes } = await supabase
        .from('bytebuild_quotations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (quotes) setAdminQuotations(quotes);
    } catch {
      // Optional table
    }

    try {
      const { data: preorders } = await supabase
        .from('bytebuild_preorder_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (preorders) setAdminAllPreorders(preorders);
    } catch {
      // Optional table
    }
  }, []);

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

  useEffect(() => {
    if (buildFocused && focusViewRef.current) {
      focusViewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [buildFocused]);

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

  const handleAdminLogout = () => {
    setAdminUnlocked(false);
    setAdminPinInput('');
    setEditingItem(null);
    setActivePage('home');
  };

  useEffect(() => {
    const hash = window.location.hash;
    const isRecovery = Boolean(
      hash && (hash.includes('type=recovery') || hash.includes('access_token'))
    );

    if (isRecovery) {
      Promise.resolve().then(() => {
        setActivePage('login');
        setAuthMode('update-password');
      });
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setCurrentUser(session?.user ?? null);
        if (session?.user?.email) {
          setPreorderForm((prev) => ({ ...prev, email: session.user.email }));
        }
      });
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
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

  useEffect(() => {
    let cancelled = false;

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

    async function initialLoad() {
      try {
        const [activeRows, preorderRows, referenceRows] = await Promise.all([
          fetchAllRows(ACTIVE_TABLE),
          fetchAllRows(PREORDER_TABLE),
          fetchAllRows(REFERENCE_TABLE),
        ]);
        if (!cancelled) {
          setActiveProducts(activeRows);
          setPreorderProducts(preorderRows);
          setReferenceParts(referenceRows);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Database Sync Error:', err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initialLoad();

    const channel = supabase
      .channel('bytebuild-realtime-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: ACTIVE_TABLE },
        () => {
          if (!cancelled) refreshInventoryNow();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: PREORDER_TABLE },
        () => {
          if (!cancelled) refreshInventoryNow();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: REFERENCE_TABLE },
        () => {
          if (!cancelled) refreshInventoryNow();
        }
      )
      .subscribe((status) => {
        if (!cancelled) {
          setRealtimeConnected(status === 'SUBSCRIBED');
        }
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [refreshInventoryNow]);

  useEffect(() => {
    let cancelled = false;

    async function syncUserRecords() {
      if (!currentUser) {
        if (!cancelled) {
          setSavedBuilds([]);
          setUserPreorders([]);
        }
        return;
      }

      try {
        const { data: builds, error: buildsErr } = await supabase
          .from('bytebuild_saved_builds')
          .select('*')
          .eq('user_id', currentUser.id)
          .order('created_at', { ascending: false });

        const { data: orders, error: ordersErr } = await supabase
          .from('bytebuild_preorder_requests')
          .select('*')
          .eq('user_id', currentUser.id)
          .order('created_at', { ascending: false });

        if (!cancelled) {
          if (!buildsErr && builds) setSavedBuilds(builds);
          if (!ordersErr && orders) setUserPreorders(orders);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('User Records Sync Error:', err.message);
        }
      }
    }

    syncUserRecords();

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    if (activePage !== 'admin') return;
    let cancelled = false;

    async function syncAdminLogs() {
      try {
        const { data: quotes } = await supabase
          .from('bytebuild_quotations')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (!cancelled && quotes) setAdminQuotations(quotes);
      } catch {
        // Optional table
      }

      try {
        const { data: preorders } = await supabase
          .from('bytebuild_preorder_requests')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (!cancelled && preorders) setAdminAllPreorders(preorders);
      } catch {
        // Optional table
      }
    }

    syncAdminLogs();

    return () => {
      cancelled = true;
    };
  }, [activePage]);

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
      const payload = buildAdminInsertPayload(newItemForm, targetType, tableName);

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
        psu_tier: '',
        hardware_score: 78,
        specs: '',
      });
      await refreshInventoryNow();
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
      const updates = buildAdminUpdatePayload(editingItem, tableName === REFERENCE_TABLE);

      const { error } = await supabase
        .from(tableName)
        .update(updates)
        .eq('id', editingItem.id);

      if (error) throw error;

      setEditingItem(null);
      await refreshInventoryNow();
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
      await refreshInventoryNow();
    } catch (err) {
      alert(`Status update failed: ${err.message}`);
    }
  };

  const handleAdminDeleteItem = async (item, tableName) => {
    if (!window.confirm(`Delete "${item.name}" from ${tableName}?`)) return;
    try {
      const { error } = await supabase.from(tableName).delete().eq('id', item.id);
      if (error) throw error;
      await refreshInventoryNow();
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
      await refreshAdminLogsNow();
    } catch (err) {
      alert(`Could not update pre-order: ${err.message}`);
    }
  };

  const handleSaveDssRules = (e) => {
    e.preventDefault();
    const normalized = normalizeDssRules(dssRules, DEFAULT_DSS_RULES);
    setDssRules(normalized);
    localStorage.setItem('bytebuild_dss_rules', JSON.stringify(normalized));
    alert('Compatibility & Recommendation Engine rules updated and applied across the system.');
  };

  const handleAddCustomPart = (e) => {
    e.preventDefault();
    const customItem = createCustomOwnedPart(customPartForm);
    if (!customItem) return;

    setExistingPc((prev) => ({
      ...prev,
      [customItem.category]: customItem,
    }));
    setCustomModalOpen(false);
    setCustomPartForm({
      category: customItem.category,
      name: '',
      brand: 'Custom',
      price: '',
      socket: '',
      memory_type: '',
      form_factor: '',
      wattage: '',
      specs: '',
      specs_url: '',
    });
  };

  const allCatalogPool = useMemo(
    () => [...activeProducts, ...preorderProducts, ...referenceParts],
    [activeProducts, preorderProducts, referenceParts]
  );

  const handleOcrScanImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrLoading(true);
    setOcrError('');
    setOcrScanResults([]);

    let worker;
    try {
      worker = await createWorker('eng');
      const { data } = await worker.recognize(file);
      const rawText = (data?.text || '').trim();
      setOcrText(rawText);

      const results = matchOcrTextToCatalog(rawText, activeProducts, preorderProducts);
      setOcrScanResults(results);
    } catch (err) {
      setOcrError(err?.message || 'Failed to read spec sheet image via OCR.');
    } finally {
      if (worker) {
        await worker.terminate();
      }
      setOcrLoading(false);
    }
  };

  const handleLoadScannedInStockParts = () => {
    setSelectedBuild((prev) => applyInStockOcrMatches(prev, ocrScanResults).build);
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

  const customPartFlags = useMemo(() => getCustomBuildSummary(selectedBuild), [selectedBuild]);
  const hasAnyUnverifiedPart = customPartFlags.hasCustomPart;

  const totalPrice = useMemo(
    () => calculateBuildTotal(selectedBuild, CATEGORIES, selectedRamCount),
    [selectedBuild, selectedRamCount]
  );

  const effectiveParts = useMemo(
    () =>
      CATEGORIES.reduce((acc, cat) => {
        acc[cat] = selectedBuild[cat] || existingPc[cat] || null;
        return acc;
      }, {}),
    [selectedBuild, existingPc]
  );

  const activeRamCount = selectedBuild.Memory ? selectedRamCount : existingRamCount;
  const currentPsu = effectiveParts['Power Supplies'];
  const currentCpu = effectiveParts.Processors;
  const currentGpu = effectiveParts['Video Cards'];

  const psuInfo = useMemo(() => getPsuProfile(currentPsu), [currentPsu]);

  const powerMetrics = useMemo(() => {
    const bufferWatts = Number(dssRules.psuBufferWatts || 120);
    return calculateRigWattage(effectiveParts, activeRamCount || 2, {
      overclocked: overclockEnabled,
      bufferWatts,
    });
  }, [effectiveParts, activeRamCount, overclockEnabled, dssRules.psuBufferWatts]);

  const ruleResults = useMemo(
    () =>
      evaluateBuildRules(effectiveParts, {
        ramStickCount: activeRamCount || 2,
        peakWatts: powerMetrics.activePeakWatts,
        recommendedPsuWatts: powerMetrics.recommendedPsuWatts,
        minRamGb: Number(dssRules.minRecommendedRamGB || 16),
        minStorageGb: Number(dssRules.minStorageCapacityGB || 500),
        hasEstimatedPower: Boolean(
          powerMetrics.hasMissingSpecs || powerMetrics.hasEstimatedCpuPeak
        ),
      }),
    [effectiveParts, activeRamCount, powerMetrics, dssRules]
  );

  const verificationCoverage = useMemo(
    () => getVerificationCoverage(ruleResults),
    [ruleResults]
  );

  const compatibilityScore = useMemo(
    () => calculateCompatibilityScore(ruleResults),
    [ruleResults]
  );

  const bottleneckBalance = useMemo(
    () => evaluateBottleneckBalance(currentCpu, currentGpu),
    [currentCpu, currentGpu]
  );

  const { actionableIssues, unknownCatalogIssues } = useMemo(
    () => buildDiagnosticIssues(ruleResults),
    [ruleResults]
  );

  const recommendation = useMemo(
    () =>
      buildSystemRecommendation({
        actionableIssues,
        selectedItems,
        existingPc,
        currentCpu,
        currentPsu,
        psuTier: psuInfo.tier,
        activePeakWatts: powerMetrics.activePeakWatts,
        recommendedPsuWatts: powerMetrics.recommendedPsuWatts,
      }),
    [
      actionableIssues,
      selectedItems,
      existingPc,
      currentCpu,
      currentPsu,
      psuInfo.tier,
      powerMetrics.activePeakWatts,
      powerMetrics.recommendedPsuWatts,
    ]
  );

  const performanceTier = useMemo(
    () =>
      evaluatePerformanceTier({
        currentCpu,
        currentGpu,
        actionableIssues,
      }),
    [currentCpu, currentGpu, actionableIssues]
  );

  const activeRule = useMemo(
    () => ruleResults.find((r) => r.ruleId === selectedRuleId) || ruleResults[0] || null,
    [ruleResults, selectedRuleId]
  );

  const comparisonItems = useMemo(
    () =>
      allCatalogPool
        .filter((item) => normalizeText(item.category) === normalizeText(compareCategory))
        .slice(0, 4),
    [allCatalogPool, compareCategory]
  );

  const catalogFilterOpts = useMemo(
    () => ({
      isReferenceView: activePage === 'upgrade' && upgradeMode === 'reference',
      inventoryMode,
      showSoldOut,
    }),
    [activePage, upgradeMode, inventoryMode, showSoldOut]
  );

  const brandsForActiveCategory = useMemo(
    () => getBrandsForCategory(catalogProducts, activeTab, catalogFilterOpts),
    [catalogProducts, activeTab, catalogFilterOpts]
  );

  const formFactorsForActiveCategory = useMemo(
    () => getFormFactorsForCategory(catalogProducts, activeTab, catalogFilterOpts),
    [catalogProducts, activeTab, catalogFilterOpts]
  );

  const filteredProducts = useMemo(
    () =>
      filterAndSortCatalogProducts(catalogProducts, {
        category: activeTab,
        searchQuery,
        brand: selectedBrand,
        formFactor: selectedFormFactor,
        minPrice,
        maxPrice,
        sortBy,
        ...catalogFilterOpts,
      }),
    [
      catalogProducts,
      activeTab,
      searchQuery,
      selectedBrand,
      selectedFormFactor,
      minPrice,
      maxPrice,
      sortBy,
      catalogFilterOpts,
    ]
  );

  const categoryCounts = useMemo(
    () => getCategoryCounts(catalogProducts, catalogFilterOpts),
    [catalogProducts, catalogFilterOpts]
  );

  const slotManifestRows = useMemo(
    () => buildSlotManifestRows(selectedBuild, selectedRamCount),
    [selectedBuild, selectedRamCount]
  );

  const powerDisplaySummary = useMemo(
    () =>
      computePowerDisplayMetrics({
        powerMetrics,
        psuInfo,
        powerDisplayView,
        overclockEnabled,
      }),
    [powerMetrics, psuInfo, powerDisplayView, overclockEnabled]
  );

  const handleRunSmartBuildAssistant = () => {
    const profileKey =
      assistantProfile === 'Mixed/Balanced' ? 'Balanced' : assistantProfile;
    const result = runSmartBuildAssistant({
      products: activeProducts,
      budgetInput: assistantBudget,
      profile: profileKey,
      overclockEnabled,
    });

    if (!result.ok) {
      setAssistantStatus(result.reason || 'Unable to generate build.');
      return;
    }

    setSelectedBuild(result.build);
    setSelectedRamCount(result.ramStickCount || 2);
    const detailLine =
      Array.isArray(result.notes) && result.notes.length > 0
        ? ` (${result.notes.join(' ')})`
        : '';
    setAssistantStatus(`${result.statusMessage}${detailLine}`);
    setBuildFocused(true);
  };

  const handleExportQuotation = async () => {
    if (selectedItems.length === 0) return;
    setExportingQuote(true);

    const refCode = `BB-${printReferenceId}`;

    try {
      const payload = buildQuotationPayload({
        refCode,
        currentUser,
        selectedBuild,
        selectedRamCount,
        totalPrice,
        compatibilityScore,
      });
      await supabase.from('bytebuild_quotations').insert([payload]);
    } catch {
      // Fallback gracefully
    }

    try {
      const invoiceHtml = buildQuotationHtmlDocument({
        refCode,
        printDateString,
        selectedBuild,
        selectedRamCount,
        totalPrice,
        compatibilityScore,
        verificationCoverage,
        activePeakWatts: powerMetrics.activePeakWatts,
        recommendedPsuWatts: powerMetrics.recommendedPsuWatts,
      });

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

    setSelectedBuild((prev) => {
      const next = {
        ...prev,
        [matchedCategory]: {
          ...product,
          stock_status:
            inventoryMode === 'preorder'
              ? 'Pre-Order'
              : product.stock_status || 'In Stock',
        },
      };
      const filledCount = Object.values(next).filter(Boolean).length;
      if (filledCount === CATEGORIES.length) {
        setBuildFocused(true);
      }
      return next;
    });

    if (matchedCategory === 'Memory' && isPrebundledKit(product)) {
      setSelectedRamCount((prev) => Math.max(Number(prev) || 2, 2));
    }
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
    setSelectedRamCount(2);
    setAssistantStatus('');
    setBuildFocused(false);
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
      const buildName = prompt('Enter a name for this build:', `Rig - ${printDateString}`);
      if (!buildName) {
        setSavingBuild(false);
        return;
      }
      const { error } = await supabase.from('bytebuild_saved_builds').insert([
        {
          user_id: currentUser.id,
          build_name: buildName,
          build_data: { ...selectedBuild, __ramStickCount: selectedRamCount },
          total_price: totalPrice,
          compatibility_score: compatibilityScore,
        },
      ]);
      if (error) throw error;
      alert('Build saved successfully! View it under your Account tab.');
      const { data: builds } = await supabase
        .from('bytebuild_saved_builds')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });
      if (builds) setSavedBuilds(builds);
    } catch (err) {
      alert(`Save error: ${err.message}`);
    } finally {
      setSavingBuild(false);
    }
  };

  const handleLoadSavedBuild = (buildRecord) => {
    const { buildData, ramStickCount } = normalizeSavedBuildRecord(buildRecord);
    setSelectedBuild({ ...INITIAL_BUILD, ...buildData });
    setSelectedRamCount(ramStickCount);
    setActivePage('builder');
    setBuildFocused(true);
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

    const validation = validatePreorderInput({
      customerName: preorderForm.customer_name,
      contactNumber: preorderForm.contact_number,
    });
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    setPreorderSubmitting(true);
    try {
      const payload = buildPreorderRequestPayload({
        currentUser,
        customerName: validation.customerName,
        contactNumber: validation.contactNumber,
        email: preorderForm.email,
        product: preorderModalItem,
      });

      const { error } = await supabase.from('bytebuild_preorder_requests').insert([payload]);
      if (error) throw error;
      alert(
        `Pre-order submitted for ${preorderModalItem.name}! ByteBuild staff will contact you once supplier allocation is verified.`
      );
      setPreorderModalItem(null);
      setPreorderForm({ customer_name: '', contact_number: '', email: currentUser?.email || '' });
      if (currentUser) {
        const { data: orders } = await supabase
          .from('bytebuild_preorder_requests')
          .select('*')
          .eq('user_id', currentUser.id)
          .order('created_at', { ascending: false });
        if (orders) setUserPreorders(orders);
      }
    } catch (err) {
      alert(`Pre-order failed: ${err.message}`);
    } finally {
      setPreorderSubmitting(false);
    }
  };

  const renderProductRow = (product, allowAdd = true, existingCategory = null) => {
    const isReferenceView = activePage === 'upgrade' && upgradeMode === 'reference';
    const status = getItemDisplayStatus(product, { inventoryMode, isReferenceView });
    const isSoldOut = status === 'Sold Out';
    const formFactorTag = detectPartFormFactor(product);
    const isPsu = normalizeText(product?.category) === 'power supplies';
    const psu = isPsu ? getPsuProfile(product) : null;
    const learnUrl = buildLearnMoreUrl(product);

    let buttonLabel = '+ Add';
    if (isSoldOut) buttonLabel = 'Sold Out';
    else if (activePage === 'upgrade' && upgradeMode === 'reference') buttonLabel = 'Select Owned';
    else if (activePage === 'upgrade' && upgradeMode === 'shop') buttonLabel = 'Choose Upgrade';
    else if (inventoryMode === 'preorder' || product.stock_status === 'Pre-Order') buttonLabel = 'Pre-Order';

    return (
      <div
        key={`row-${product.id}`}
        className={`bg-[#111827] border border-[#1f293d] rounded-lg p-3.5 transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-left ${
          isSoldOut ? 'opacity-70' : 'hover:border-slate-500'
        }`}
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
            {isPsu && psu && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                  psu.tierRank >= 4
                    ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/40'
                    : psu.tierRank === 3
                    ? 'bg-blue-950/70 text-blue-300 border-blue-700/40'
                    : 'bg-red-950/70 text-red-300 border-red-700/40'
                }`}
              >
                SPL Tier {psu.tier}
              </span>
            )}
            <span className="text-[10px] text-slate-500 font-mono">
              SKU: {product.sku_code || product.id}
            </span>
            <span
              className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                status === 'unverified'
                  ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                  : status === 'In Stock'
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
              {status === 'reference' || !product.price ? 'Owned' : peso(product.price)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {learnUrl && (
              <a
                href={learnUrl}
                target="_blank"
                rel="noreferrer"
                className="px-2 py-1.5 rounded bg-[#0b0f19] border border-[#1f293d] hover:border-blue-500 text-xs font-semibold text-blue-400"
              >
                Learn More
              </a>
            )}
            <button
              type="button"
              onClick={() => setSelectedProduct(product)}
              className="px-2.5 py-1.5 rounded bg-[#1f293d] hover:bg-slate-700 text-xs font-semibold text-slate-200"
            >
              Specs
            </button>
            {allowAdd && (
              <button
                type="button"
                disabled={isSoldOut}
                onClick={() =>
                  !isSoldOut && handleUpgradeAction(existingCategory || product.category, product)
                }
                className={`px-3.5 py-1.5 rounded text-xs font-bold transition-colors ${
                  isSoldOut
                    ? 'bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed'
                    : buttonLabel === 'Pre-Order'
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
    <div
      onWheel={(e) => {
        if (e.deltaY !== 0) {
          e.currentTarget.scrollLeft += e.deltaY;
        }
      }}
      className="flex gap-2 overflow-x-auto pb-2.5 pt-0.5 border-b border-[#1f293d] scroll-smooth"
    >
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
            {hasSelection && <span className="w-2 h-2 rounded-full bg-emerald-400"></span>}
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
            Recommended System Build · Rule-Based DSS & SPL PSU Tiers
          </span>
          <h3 className="text-sm font-bold text-white">
            Smart Build Assistant (Auto-Generate Recommended System Build)
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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

  const renderPaperSpecScannerCard = () => {
    const inStockCount = ocrScanResults.filter((r) => r.status === 'In Stock').length;

    return (
      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 text-left space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1f293d] pb-2.5">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
              Paper Spec Sheet Scanner · Live Stock Cross-Check
            </span>
            <h3 className="text-sm font-bold text-white">
              Upload or Snap a Photo of Your Paper Spec Sheet
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Reads listed parts from a printed or handwritten sheet and checks shop availability.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {ocrText && (
              <button
                type="button"
                onClick={() => setShowRawOcrText((prev) => !prev)}
                className="px-2.5 py-1.5 rounded bg-[#0b0f19] border border-[#1f293d] hover:border-slate-600 text-[11px] font-semibold text-slate-300"
              >
                {showRawOcrText ? 'Hide OCR Text' : 'View OCR Text'}
              </button>
            )}
            {inStockCount > 0 && (
              <button
                type="button"
                onClick={handleLoadScannedInStockParts}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                Load {inStockCount} In-Stock Part{inStockCount > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleOcrScanImage}
            className="text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-500"
          />
          {ocrLoading && (
            <span className="text-xs text-blue-400 font-mono">
              Scanning spec sheet & cross-checking inventory...
            </span>
          )}
          {ocrError && <span className="text-xs text-red-400">{ocrError}</span>}
        </div>

        {showRawOcrText && ocrText && (
          <pre className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] text-[11px] text-slate-300 max-h-28 overflow-y-auto whitespace-pre-wrap">
            {ocrText}
          </pre>
        )}

        {ocrScanResults.length > 0 && (
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {ocrScanResults.map((entry, idx) => (
              <div
                key={`ocr-line-${idx}`}
                className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-500 truncate">
                    Scanned: "{entry.rawLine}"
                  </p>
                  <p className="font-bold text-white truncate">
                    {entry.matchedPart ? entry.matchedPart.name : 'No matching item in shop stock'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      entry.status === 'In Stock'
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800/50'
                        : entry.status === 'Pre-Order'
                        ? 'bg-blue-950 text-blue-400 border-blue-800/50'
                        : entry.status === 'Sold Out'
                        ? 'bg-red-950 text-red-400 border-red-800/50'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {entry.status}
                  </span>

                  {entry.matchedPart && entry.status === 'In Stock' && (
                    <button
                      type="button"
                      onClick={() => handleSelectProduct(entry.matchedPart)}
                      className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold"
                    >
                      + Add ({peso(entry.matchedPart.price)})
                    </button>
                  )}

                  {entry.matchedPart && entry.status === 'Pre-Order' && (
                    <button
                      type="button"
                      onClick={() => setPreorderModalItem(entry.matchedPart)}
                      className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold"
                    >
                      Pre-Order
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderRationaleAndCompareCards = () => {
    const activeChip = activeRule ? getRuleChipMeta(activeRule) : null;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 block">
                Build Compatibility Checklist
              </span>
              <p className="text-[11px] text-slate-400">
                Click any check below to see how your parts were verified.
              </p>
            </div>
            {activeChip && (
              <span
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded uppercase shrink-0 ${
                  activeRule.status === 'unknown' || activeRule.unverified
                    ? 'bg-slate-800 text-slate-300 border border-slate-700'
                    : activeRule.status === 'fail'
                    ? 'bg-red-950 text-red-400 border border-red-800/50'
                    : activeRule.status === 'warn'
                    ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                    : activeRule.dataSource === 'estimated'
                    ? 'bg-amber-950/70 text-amber-300 border border-amber-700/50'
                    : 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                }`}
              >
                {activeChip.badgeLabel}
              </span>
            )}
          </div>

          {activeRule && activeChip ? (
            <div className="p-3 rounded bg-[#0b0f19] border border-[#1f293d] space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-white">{activeRule.title || activeRule.ruleId}</p>
                <span className="text-[10px] font-mono text-slate-500">{activeRule.ruleId}</span>
              </div>
              <p className="text-slate-200">{activeRule.message || activeRule.detail}</p>
              {activeRule.dataSource && (
                <p className="text-[10px] text-slate-400 font-mono">
                  Source: {activeRule.dataSource}
                  {Array.isArray(activeRule.missingFields) && activeRule.missingFields.length > 0
                    ? ` · Missing: ${activeRule.missingFields.join(', ')}`
                    : ''}
                </p>
              )}
              {activeChip.whyItMatters && (
                <p className="text-[11px] text-slate-400">
                  <strong className="text-slate-300">Why this matters:</strong>{' '}
                  {activeChip.whyItMatters}
                </p>
              )}
              {activeRule.recommendation && activeRule.status !== 'pass' && (
                <p className="text-blue-400 text-[11px] font-semibold">
                  Next Step: {activeRule.recommendation}
                </p>
              )}
              {activeRule.category && effectiveParts[activeRule.category] && (
                <a
                  href={buildLearnMoreUrl(effectiveParts[activeRule.category])}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block pt-1 text-[11px] text-sky-400 hover:underline font-semibold"
                >
                  View Specs for {effectiveParts[activeRule.category].name} →
                </a>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Select parts to inspect compatibility checks.</p>
          )}

          {ruleResults.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#1f293d]">
              {ruleResults.map((rule) => {
                const chip = getRuleChipMeta(rule);
                return (
                  <button
                    key={rule.ruleId}
                    type="button"
                    onClick={() => setSelectedRuleId(rule.ruleId)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold border flex items-center gap-1.5 transition-colors ${
                      activeRule?.ruleId === rule.ruleId
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : rule.status === 'fail'
                        ? 'bg-red-950/50 border-red-800/60 text-red-200 hover:border-red-500'
                        : rule.status === 'warn' || rule.dataSource === 'estimated'
                        ? 'bg-amber-950/50 border-amber-800/60 text-amber-200 hover:border-amber-500'
                        : rule.status === 'pass'
                        ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-200 hover:border-emerald-500'
                        : 'bg-[#0b0f19] border-[#1f293d] text-slate-300 hover:text-white'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${chip.dotClass}`}></span>
                    <span>{chip.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              Compare & Swap Components
            </span>
            <select
              value={compareCategory}
              onChange={(e) => setCompareCategory(e.target.value)}
              className="bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1 text-[11px] text-white"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {getCategoryLabel(cat)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {comparisonItems.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No items available for comparison in {getCategoryLabel(compareCategory)}.
              </p>
            ) : (
              comparisonItems.map((item) => {
                const isPicked = selectedBuild[compareCategory]?.id === item.id;
                const itemUnverified = isCustomPartItem(item);
                const learnHref = buildLearnMoreUrl(item);
                const effectivePrice = getEffectiveItemPrice(
                  compareCategory,
                  item,
                  selectedRamCount
                );
                return (
                  <div
                    key={`cmp-${item.id}`}
                    className="p-2 rounded bg-[#0b0f19] border border-[#1f293d] flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-bold text-white truncate">{item.name}</p>
                        {itemUnverified && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700/50 font-bold">
                            unverified
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {peso(effectivePrice)} · Score: {item.hardware_score || 75}/100
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {learnHref && (
                        <a
                          href={learnHref}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-sky-400 hover:underline font-semibold"
                        >
                          Learn More
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleSelectProduct(item)}
                        className={`px-2 py-1 rounded text-[10px] font-bold ${
                          isPicked
                            ? 'bg-emerald-700 text-white'
                            : 'bg-blue-600 hover:bg-blue-500 text-white'
                        }`}
                      >
                        {isPicked ? 'Selected' : 'Use'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCatalogList = (existingCategory = null) => (
    <div className="space-y-4">
      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              placeholder="Search model, SKU, socket, PSU tier, specs..."
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
                Active Stock (
                {showSoldOut
                  ? activeProducts.length
                  : activeProducts.filter((p) => p.stock_status !== 'Sold Out').length}
                )
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
              {(minPrice !== '' ||
                maxPrice !== '' ||
                selectedBrand !== 'All' ||
                selectedFormFactor !== 'All') && (
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

          <div className="flex flex-wrap items-center gap-3">
            {inventoryMode === 'active' &&
              !(activePage === 'upgrade' && upgradeMode === 'reference') && (
                <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showSoldOut}
                    onChange={(e) => setShowSoldOut(e.target.checked)}
                    className="rounded border-[#1f293d] bg-[#0b0f19] text-blue-600 focus:ring-0"
                  />
                  <span>Show Sold Out</span>
                </label>
              )}

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

  const renderBuildSummary = (showFocusButton = false) => (
    <div
      id="printable-quotation"
      className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5"
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
            <h2 className="text-sm font-black text-slate-900 uppercase">OFFICIAL QUOTATION</h2>
            <p className="text-[8pt] font-mono text-slate-600">REF: BB-{printReferenceId}</p>
            <p className="text-[8pt] text-slate-500">Date: {printDateString}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-[#1f293d] pb-2 mb-2 print:hidden">
        <div>
          <h3 className="text-xs font-bold text-white uppercase tracking-wider leading-tight">
            System Build
          </h3>
          <p className="text-[10px] text-slate-400">
            {selectedItems.length}/8 components configured
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {showFocusButton && selectedItems.length > 0 && (
            <button
              type="button"
              onClick={() => setBuildFocused(true)}
              className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-bold"
            >
              Focus Build
            </button>
          )}
          <button
            onClick={handleSaveCurrentBuild}
            disabled={savingBuild || selectedItems.length === 0}
            className="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[10px] font-bold disabled:opacity-40"
          >
            {savingBuild ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleExportQuotation}
            disabled={exportingQuote || selectedItems.length === 0}
            className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold disabled:opacity-40"
            title="Download quotation file & log to database"
          >
            {exportingQuote ? 'Exporting...' : 'Export'}
          </button>
          <button
            onClick={() => window.print()}
            disabled={selectedItems.length === 0}
            className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-[10px] font-bold disabled:opacity-40"
          >
            Print
          </button>
          <button
            onClick={handleClearBuild}
            className="px-1.5 py-0.5 text-slate-400 hover:text-white text-[10px]"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="space-y-1 print-table-wrapper">
        {slotManifestRows.map((row) => {
          const {
            category,
            shortLabel,
            item,
            isMemory,
            isPsu,
            isUnverified,
            ramInfo,
            psuTier,
            priceLabel,
          } = row;
          const printRowClass = !item ? 'print:hidden' : '';

          return (
            <div
              key={category}
              className={`px-2 py-1 rounded border border-[#1f293d] bg-[#0b0f19] flex items-center justify-between gap-2 text-left print-table-row ${printRowClass}`}
            >
              <div className="min-w-0 flex-1 flex items-center gap-1.5 print-cell-name">
                <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0 w-12">
                  {shortLabel}
                </span>

                <p className="text-[11px] font-semibold text-white truncate">
                  {item ? (
                    item.name
                  ) : (
                    <span className="text-slate-600 italic">Unassigned</span>
                  )}
                  {ramInfo && (
                    <span className="text-blue-300 font-medium">
                      {' '}
                      · {ramInfo.stickCount}x {ramInfo.perStickCapacity || ''}GB
                    </span>
                  )}
                </p>

                {isUnverified && (
                  <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700/50 shrink-0 print:hidden">
                    unverified
                  </span>
                )}

                {isPsu && psuTier && (
                  <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/40 shrink-0 print:hidden">
                    T-{psuTier}
                  </span>
                )}

                {isMemory && item && (
                  <div className="flex items-center gap-0.5 bg-[#111827] px-1 rounded shrink-0 print:hidden">
                    {[1, 2, 4].map((count) => (
                      <button
                        key={count}
                        onClick={() => setSelectedRamCount(count)}
                        disabled={ramInfo?.isKit && count < 2}
                        className={`px-1 text-[8px] font-bold rounded disabled:opacity-30 ${
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

              <div className="flex items-center gap-1.5 shrink-0 print-cell-price">
                <span className="text-[11px] font-mono font-bold text-slate-200 print-price">
                  {priceLabel}
                </span>
                {item && (
                  <button
                    onClick={() =>
                      setSelectedBuild((prev) => ({ ...prev, [category]: null }))
                    }
                    className="text-slate-500 hover:text-red-400 font-bold text-xs leading-none print:hidden"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2.5 pt-2 border-t border-[#1f293d] print-summary-box">
        <div className="mb-2 p-2 rounded bg-[#0b0f19] border border-[#1f293d] space-y-1.5 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div className="flex items-center gap-1 bg-[#111827] p-0.5 rounded border border-[#1f293d]">
              {[
                { id: 'idle', label: 'Idle' },
                { id: 'load', label: 'Peak Load' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPowerDisplayView(tab.id)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${
                    powerDisplayView === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-[#111827] p-0.5 rounded border border-[#1f293d]">
              {[
                { oc: false, label: 'Stock' },
                { oc: true, label: 'Overclocked' },
              ].map((mode) => (
                <button
                  key={mode.label}
                  type="button"
                  onClick={() => setOverclockEnabled(mode.oc)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${
                    overclockEnabled === mode.oc
                      ? mode.oc
                        ? 'bg-amber-600 text-white'
                        : 'bg-emerald-700 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-between items-center text-[11px]">
            <span className="text-slate-300 font-semibold">
              {powerDisplaySummary.modeLabel}:{' '}
              <strong className="text-white font-mono">
                {powerDisplaySummary.displayedWatts}W
              </strong>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              Rec PSU:{' '}
              {powerDisplaySummary.recommendedPsuWatts
                ? `${powerDisplaySummary.recommendedPsuWatts}W`
                : '--'}
            </span>
          </div>

          <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${
                powerDisplaySummary.isOverPsuCap ? 'bg-red-500' : 'bg-blue-500'
              }`}
              style={{ width: `${powerDisplaySummary.loadPercent}%` }}
            ></div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[9px] text-slate-400 font-mono">
            <div className="bg-[#111827] px-1.5 py-0.5 rounded flex justify-between">
              <span>Idle</span>
              <strong className="text-slate-200">{powerDisplaySummary.idleWatts}W</strong>
            </div>
            <div className="bg-[#111827] px-1.5 py-0.5 rounded flex justify-between">
              <span>Stock</span>
              <strong className="text-emerald-300">{powerDisplaySummary.stockPeakWatts}W</strong>
            </div>
            <div className="bg-[#111827] px-1.5 py-0.5 rounded flex justify-between">
              <span>OC</span>
              <strong className="text-amber-300">{powerDisplaySummary.ocPeakWatts}W</strong>
            </div>
          </div>

          {powerDisplaySummary.missingSpecs.length > 0 && (
            <div className="p-2 rounded bg-amber-950/60 border border-amber-700/50 text-[10px] text-amber-200 leading-snug text-left">
              Power estimate incomplete:{' '}
              {powerDisplaySummary.missingSpecs.map((m) => m.name).join(', ')} have no wattage data.
            </div>
          )}
        </div>

        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-slate-400 font-bold leading-none">Total Estimate</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Cash / Direct Retail (PHP)</p>
          </div>
          <p className="text-lg font-black text-emerald-400 font-mono print-total">
            {peso(totalPrice)}
          </p>
        </div>
      </div>
    </div>
  );

  const renderRecommendationPanel = () => (
    <div className="space-y-3">
      {Array.isArray(powerMetrics.missingSpecs) && powerMetrics.missingSpecs.length > 0 && (
        <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-700/50 text-xs text-amber-200 text-left">
          Power estimate incomplete:{' '}
          {powerMetrics.missingSpecs.map((m) => m.name).join(', ')} have no wattage data.
        </div>
      )}

      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5">
        <div className="flex justify-between items-center gap-2 text-xs font-bold mb-1.5">
          <span className="text-slate-400 uppercase tracking-wider text-[10px]">
            Compatibility Score
          </span>
          <span
            className={
              compatibilityScore === null
                ? 'text-slate-400'
                : compatibilityScore >= 90
                ? 'text-emerald-400'
                : compatibilityScore >= 70
                ? 'text-amber-400'
                : 'text-red-400'
            }
          >
            {compatibilityScore === null
              ? 'Score: not enough data'
              : `Score ${compatibilityScore}% - ${verificationCoverage.verified}/${verificationCoverage.total} verified`}
          </span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              compatibilityScore === null
                ? 'bg-slate-600'
                : compatibilityScore >= 90
                ? 'bg-emerald-500'
                : compatibilityScore >= 70
                ? 'bg-amber-500'
                : 'bg-red-500'
            }`}
            style={{ width: `${compatibilityScore ?? 0}%` }}
          ></div>
        </div>
      </div>

      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5 text-left">
        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
          Performance Scoring Module
        </span>
        <h4 className="text-sm font-bold text-white mt-0.5">{performanceTier.label}</h4>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          {performanceTier.description}
        </p>
        {bottleneckBalance?.message && (
          <p className="text-[11px] text-slate-300 mt-1.5">{bottleneckBalance.message}</p>
        )}
      </div>

      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5 text-left space-y-2.5">
        <div className="flex justify-between items-center pb-2 border-b border-[#1f293d]">
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

        {actionableIssues.length === 0 ? (
          <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">
            {recommendation.summary}
          </p>
        ) : (
          <div className="space-y-2">
            {actionableIssues.map((issue, idx) => (
              <div
                key={issue.id || `${issue.title}-${idx}`}
                onClick={() => setSelectedRuleId(issue.id)}
                className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] hover:border-blue-500/50 cursor-pointer text-xs"
              >
                <div className="flex justify-between items-center gap-1">
                  <span className="text-[9px] font-bold uppercase text-slate-500">
                    {getCategoryLabel(issue.category)}
                  </span>
                  <span
                    className={`text-[9px] font-bold uppercase ${
                      issue.unverified
                        ? 'text-amber-300'
                        : issue.severity === 'critical'
                        ? 'text-red-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {issue.unverified ? 'unverified' : issue.severity}
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

        {unknownCatalogIssues.length > 0 && (
          <div className="pt-2 border-t border-[#1f293d]">
            <button
              type="button"
              onClick={() => setShowUnknownRules((prev) => !prev)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded bg-[#0b0f19] border border-[#1f293d] hover:border-slate-600 text-[11px] font-semibold text-slate-400"
            >
              <span>
                Missing Catalog Spec Checks ({unknownCatalogIssues.length} unknown)
              </span>
              <span className="text-blue-400">{showUnknownRules ? 'Hide ▲' : 'Show ▼'}</span>
            </button>

            {showUnknownRules && (
              <div className="mt-2 space-y-1.5">
                {unknownCatalogIssues.map((issue, idx) => (
                  <div
                    key={issue.id || `unk-${idx}`}
                    onClick={() => setSelectedRuleId(issue.id)}
                    className="p-2 rounded bg-[#0b0f19]/80 border border-[#1f293d] hover:border-slate-600 cursor-pointer text-[11px]"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-300">{issue.title}</span>
                      <span className="text-[9px] font-bold uppercase text-slate-500">
                        unknown
                      </span>
                    </div>
                    <p className="text-slate-400 mt-0.5">{issue.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderFloatingMobileBar = () => {
    if (activePage !== 'builder' && activePage !== 'upgrade') return null;

    return (
      <div
        style={{ position: 'fixed', bottom: '14px', left: '12px', right: '12px', zIndex: 85 }}
        className="lg:hidden bg-[#111827]/95 backdrop-blur-md border border-blue-500/40 rounded-xl p-3 px-4 flex justify-between items-center shadow-[0_10px_30px_rgba(0,0,0,0.85)] mobile-bottom-bar print:hidden"
      >
        <div className="text-left">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-300 uppercase font-bold tracking-wider">
              {activePage === 'upgrade'
                ? 'Upgrade Cost'
                : `Total (${selectedItems.length}/8)`}
            </span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                compatibilityScore === null
                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                  : compatibilityScore >= 90
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/40'
                  : compatibilityScore >= 70
                  ? 'bg-amber-950 text-amber-400 border border-amber-700/40'
                  : 'bg-red-950 text-red-400 border border-red-700/40'
              }`}
            >
              {compatibilityScore === null
                ? 'Score: not enough data'
                : `Score ${compatibilityScore}%`}
            </span>
          </div>
          <p className="text-lg font-black text-emerald-400 font-mono leading-tight mt-0.5">
            {peso(totalPrice)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowMobileDrawer(true)}
          className="bg-blue-600 hover:bg-blue-500 active:scale-95 text-white px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wide shadow-md transition-transform shrink-0"
        >
          {activePage === 'upgrade' ? 'Inspect Rig ▲' : 'View Build ▲'}
        </button>
      </div>
    );
  };

  const renderMobileManifestDrawer = () => {
    if (!showMobileDrawer) return null;

    const drawerScoreLabel =
      compatibilityScore === null
        ? 'Score: not enough data'
        : `Score ${compatibilityScore}% - ${verificationCoverage.verified}/${verificationCoverage.total} verified`;

    return (
      <div className="lg:hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-[90] flex flex-col justify-end print:hidden">
        <div className="bg-[#0b0f19] border-t border-[#1f293d] rounded-t-2xl max-h-[85vh] flex flex-col shadow-2xl">
          <div className="p-3.5 px-4 bg-[#111827] border-b border-[#1f293d] rounded-t-2xl flex items-center justify-between shrink-0">
            <div className="text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 block">
                Live Build & DSS Diagnostics
              </span>
              <h3 className="text-sm font-black text-white">
                System Build ({selectedItems.length}/8) · {drawerScoreLabel}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowMobileDrawer(false)}
              className="px-3 py-1.5 rounded-md bg-[#1f293d] hover:bg-slate-700 text-xs font-bold text-white"
            >
              Close ✕
            </button>
          </div>

          <div className="p-4 overflow-y-auto space-y-4">
            {activePage === 'upgrade' && (
              <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5 text-left">
                <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-[#1f293d]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Your Current Rig
                  </h4>
                  <button
                    onClick={handleClearExistingPc}
                    className="text-[11px] text-slate-400 hover:text-white"
                  >
                    Reset
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {CATEGORIES.map((cat) => {
                    const item = existingPc[cat];
                    return (
                      <div
                        key={`mob-ex-${cat}`}
                        className="p-1.5 rounded bg-[#0b0f19] border border-[#1f293d] text-[10px]"
                      >
                        <span className="text-slate-500 uppercase block text-[8px]">
                          {getCategoryLabel(cat)}
                        </span>
                        <p className="text-white font-semibold truncate">
                          {item ? item.name : 'Not set'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {renderBuildSummary(false)}
            {renderRecommendationPanel()}
          </div>
        </div>
      </div>
    );
  };

  const renderHomePage = () => {
    const featuredAssortment = CATEGORIES.map((category) =>
      activeProducts
        .filter(
          (p) =>
            p.category === category &&
            p.stock_status !== 'Sold Out' &&
            p.stock_status !== 'Pre-Order'
        )
        .sort((a, b) => Number(b.hardware_score || 0) - Number(a.hardware_score || 0))[0]
    ).filter(Boolean);

    const availableActiveCount = activeProducts.filter(
      (p) => p.stock_status !== 'Sold Out'
    ).length;

    return (
      <div className="space-y-6">
        <section className="bg-[#111827] border border-[#1f293d] rounded-lg p-5 sm:p-7 text-left">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    realtimeConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  } shrink-0`}
                ></span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Custom Hardware Configuration & Upgrade Workshop{' '}
                  {realtimeConnected ? '· Realtime Sync Active' : ''}
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                Configure, Upgrade, and Quote Your Next Desktop.
              </h2>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                Use the Smart Build Assistant to generate Recommended System Builds with SPL PSU tier
                validation, power draw estimation, paper spec sheet scanning, and formal quotations.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  onClick={() => setActivePage('builder')}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors shadow-sm"
                >
                  Launch Smart Builder
                </button>
                <button
                  onClick={() => setActivePage('upgrade')}
                  className="bg-[#0b0f19] hover:bg-slate-800 text-slate-300 border border-[#1f293d] px-4 py-2.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  Run Upgrade Checker
                </button>
              </div>
            </div>

            <div className="hidden lg:grid grid-cols-2 gap-3 shrink-0 w-72">
              <div className="p-3 bg-[#0b0f19] border border-[#1f293d] rounded">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">
                  In-Stock SKUs
                </span>
                <span className="text-lg font-black text-white font-mono">
                  {availableActiveCount} Parts
                </span>
              </div>
              <div className="p-3 bg-[#0b0f19] border border-[#1f293d] rounded">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">
                  Validation
                </span>
                <span className="text-lg font-black text-blue-400 font-mono">Hardware DSS</span>
              </div>
              <div className="p-3 bg-[#0b0f19] border border-[#1f293d] rounded">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">
                  Pre-Order SKUs
                </span>
                <span className="text-lg font-black text-white font-mono">
                  {preorderProducts.length} Items
                </span>
              </div>
              <div className="p-3 bg-[#0b0f19] border border-[#1f293d] rounded">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">
                  Reference DB
                </span>
                <span className="text-lg font-black text-emerald-400 font-mono">
                  {referenceParts.length} Legacy
                </span>
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
              Full Inventory ({availableActiveCount}) →
            </button>
          </div>
          {renderCategoryNavStrip()}
        </section>

        <section>
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 text-left">
              Featured In-Stock Components
            </h3>
            <span className="text-[11px] text-slate-500">Top rated per hardware class</span>
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

  const renderBuilderPage = () => {
    const focusScoreLabel =
      compatibilityScore === null
        ? 'Score: not enough data'
        : `Score ${compatibilityScore}% - ${verificationCoverage.verified}/${verificationCoverage.total} verified`;

    if (buildFocused) {
      return (
        <section
          id="build-focus"
          ref={focusViewRef}
          className="max-w-5xl mx-auto space-y-5 app-view-container"
        >
          <div className="bg-[#111827] border border-blue-500/40 rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
            <div className="text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 block">
                Build Focus Mode · Side Panel & Catalog Collapsed
              </span>
              <h2 className="text-sm font-black text-white">
                {selectedItems.length}/8 Components Selected · {focusScoreLabel} · Total:{' '}
                {peso(totalPrice)}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hasAnyUnverifiedPart && (
                <span className="text-[10px] px-2.5 py-1 rounded bg-amber-950 border border-amber-700/50 text-amber-300 font-bold">
                  unverified
                </span>
              )}
              <button
                type="button"
                onClick={() => setBuildFocused(false)}
                className="px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider"
              >
                Expand Parts Catalog / Edit Build
              </button>
            </div>
          </div>

          <div className="print:hidden">{renderSmartBuildAssistantBar()}</div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-6">{renderBuildSummary(false)}</div>
            <div className="lg:col-span-6 print:hidden">{renderRecommendationPanel()}</div>
          </div>

          <div className="print:hidden">{renderRationaleAndCompareCards()}</div>
        </section>
      );
    }

    return (
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-4">
          {renderSmartBuildAssistantBar()}
          {renderPaperSpecScannerCard()}
          {renderCategoryNavStrip()}
          {renderCatalogList()}
        </div>

        <aside className="hidden lg:block lg:col-span-4 space-y-2.5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto pr-1 print:block">
          {renderBuildSummary(true)}
          {renderRecommendationPanel()}
        </aside>
      </section>
    );
  };

  const renderUpgradePage = () => (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-8 space-y-4">
        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-2.5 flex flex-wrap gap-2 items-center">
          <button
            onClick={() => setUpgradeMode('reference')}
            className={`flex-1 py-2 px-3 rounded text-xs font-bold transition-colors ${
              upgradeMode === 'reference'
                ? 'bg-blue-600 text-white'
                : 'bg-[#0b0f19] text-slate-400 hover:text-white'
            }`}
          >
            1. Select Current Hardware
          </button>
          <button
            onClick={() => setUpgradeMode('shop')}
            className={`flex-1 py-2 px-3 rounded text-xs font-bold transition-colors ${
              upgradeMode === 'shop'
                ? 'bg-blue-600 text-white'
                : 'bg-[#0b0f19] text-slate-400 hover:text-white'
            }`}
          >
            2. Choose Shop Upgrades
          </button>
          <button
            type="button"
            onClick={() => {
              setCustomPartForm((prev) => ({ ...prev, category: activeTab }));
              setCustomModalOpen(true);
            }}
            className="py-2 px-3 rounded bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 text-xs font-bold shrink-0"
          >
            + Custom Owned Part
          </button>
        </div>

        {renderRationaleAndCompareCards()}
        {renderCategoryNavStrip()}
        {renderCatalogList(activeTab)}
      </div>

      <aside className="hidden lg:block lg:col-span-4 space-y-2.5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto pr-1">
        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 text-left print:hidden">
          <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#1f293d]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Your Current Rig
            </h4>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCustomPartForm((prev) => ({ ...prev, category: activeTab }));
                  setCustomModalOpen(true);
                }}
                className="px-2 py-0.5 rounded bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 text-[10px] font-bold"
              >
                + Custom Part
              </button>
              <button
                onClick={handleClearExistingPc}
                className="text-[11px] text-slate-500 hover:text-white"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            {CATEGORIES.map((cat) => {
              const item = existingPc[cat];
              const isMemory = cat === 'Memory';
              const isCustomOwned = isCustomPartItem(item);

              return (
                <div
                  key={cat}
                  className="p-1.5 rounded bg-[#0b0f19] border border-[#1f293d] text-xs flex justify-between items-center gap-2"
                >
                  <div className="min-w-0 pr-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-500 uppercase">
                        {getCategoryLabel(cat)}
                      </span>
                      {isCustomOwned && (
                        <span className="text-[8px] font-bold px-1 rounded bg-amber-950 text-amber-300 border border-amber-700/50">
                          custom
                        </span>
                      )}
                    </div>
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

        {renderBuildSummary(false)}
        {renderRecommendationPanel()}
      </aside>
    </section>
  );

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
          <h3 className="text-lg font-bold text-white mb-1">Administrator Console Lock</h3>
          <p className="text-xs text-slate-400 mb-4">
            Enter the authorized workshop PIN to unlock inventory, reference parts, and rule
            management.
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

    const filteredAdminItems = filterAdminRecords(currentAdminDataset, {
      categoryFilter: adminCategoryFilter,
      searchQuery: adminSearch,
    });

    return (
      <div className="space-y-6 text-left">
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
              {
                id: 'catalog',
                label: `1. Catalog (${activeProducts.length + preorderProducts.length})`,
              },
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

        {(adminSection === 'catalog' || adminSection === 'reference') && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                {adminSection === 'reference'
                  ? 'D2: Reference Parts Database'
                  : 'D1: Products Database'}
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
                    placeholder="e.g. Kingston NV3 1TB PCIe 4.0 NVMe M.2 SSD"
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
                      placeholder="AMD / Kingston / MSI"
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Category</label>
                    <select
                      value={newItemForm.category}
                      onChange={(e) =>
                        setNewItemForm((p) => ({ ...p, category: e.target.value }))
                      }
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
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
                        onChange={(e) =>
                          setNewItemForm((p) => ({ ...p, price: e.target.value }))
                        }
                        placeholder="10855"
                        className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Stock Status</label>
                      <select
                        value={newItemForm.stock_status}
                        onChange={(e) =>
                          setNewItemForm((p) => ({ ...p, stock_status: e.target.value }))
                        }
                        className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
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
                      onChange={(e) =>
                        setNewItemForm((p) => ({ ...p, socket: e.target.value }))
                      }
                      placeholder="AM4 / AM5"
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">SPL PSU Tier</label>
                    <select
                      value={newItemForm.psu_tier}
                      onChange={(e) =>
                        setNewItemForm((p) => ({ ...p, psu_tier: e.target.value }))
                      }
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                    >
                      <option value="">Auto</option>
                      <option value="A+">A+</option>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="D">D</option>
                      <option value="E">E</option>
                      <option value="F">F</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Score (1-100)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={newItemForm.hardware_score}
                      onChange={(e) =>
                        setNewItemForm((p) => ({ ...p, hardware_score: e.target.value }))
                      }
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Technical Specifications</label>
                  <textarea
                    rows={2}
                    value={newItemForm.specs}
                    onChange={(e) => setNewItemForm((p) => ({ ...p, specs: e.target.value }))}
                    placeholder="1TB M.2 NVMe PCIe 4.0 x4, up to 6000 MB/s read..."
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
                          adminTableSource === 'active'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400'
                        }`}
                      >
                        Active Inventory ({activeProducts.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminTableSource('preorder')}
                        className={`px-2.5 py-1 rounded text-xs font-bold ${
                          adminTableSource === 'preorder'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400'
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
                  placeholder="Filter records by name, brand, or SPL tier..."
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
                        <span className="text-[10px] text-slate-500 font-mono">ID: {item.id}</span>
                        {normalizeText(item.category) === 'power supplies' && (
                          <span className="text-[10px] font-bold text-emerald-400">
                            SPL Tier: {getPsuProfile(item).tier}
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
                              handleAdminQuickStatusToggle(
                                item,
                                currentAdminTableName,
                                e.target.value
                              )
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
                        onClick={() => setEditingItem({ ...item, _table: currentAdminTableName })}
                        className="px-2.5 py-1 rounded bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600 hover:text-white font-bold"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdminDeleteItem(item, currentAdminTableName)}
                        className="px-2.5 py-1 rounded text-slate-500 hover:text-red-400 font-bold"
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

        {adminSection === 'rules' && (
          <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-5 max-w-3xl space-y-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                D3: Compatibility & SPL PSU Tier Recommendation Engine
              </span>
              <h3 className="text-base font-bold text-white mt-0.5">
                Configure Deterministic Hardware Validation & Budget Allocation Rules
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Changes made here immediately govern the Compatibility Engine, Upgrade Checker, and
                Smart Build Assistant.
              </p>
            </div>

            <form onSubmit={handleSaveDssRules} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 rounded bg-[#0b0f19] border border-[#1f293d]">
                  <label className="font-bold text-white block mb-1">
                    PSU Transient Headroom Buffer (Watts)
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Added to active component load to size minimum safe PSU wattage.
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
                    Flags compact storage drives below this threshold and guides Auto-Builder SSD
                    selection.
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
                  onClick={refreshAdminLogsNow}
                  className="text-xs text-blue-400 hover:underline"
                >
                  Refresh
                </button>
              </div>

              {adminQuotations.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  No exported quotations logged yet. Click "Export" in the System Build
                  card to log a quotation.
                </p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {adminQuotations.map((q) => (
                    <div
                      key={q.id}
                      className="p-3 rounded bg-[#0b0f19] border border-[#1f293d] flex justify-between items-center text-xs"
                    >
                      <div>
                        <span className="font-mono font-bold text-blue-400">{q.reference_code}</span>
                        <p className="text-white font-semibold mt-0.5">
                          {q.customer_email || 'Walk-in Customer'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {new Date(q.created_at).toLocaleString()} · Compatibility:{' '}
                          {q.compatibility_score === null || q.compatibility_score === undefined
                            ? 'Not enough data'
                            : `${q.compatibility_score}%`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-bold text-emerald-400 text-sm">
                          {peso(q.total_price)}
                        </p>
                        <button
                          onClick={() => {
                            if (q.build_data) {
                              const { buildData, ramStickCount } = normalizeSavedBuildRecord(q);
                              setSelectedBuild({ ...INITIAL_BUILD, ...buildData });
                              setSelectedRamCount(ramStickCount);
                              setActivePage('builder');
                              setBuildFocused(true);
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
                        className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
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
                    <label className="text-slate-400 block mb-1">SPL PSU Tier</label>
                    <select
                      value={editingItem.psu_tier || ''}
                      onChange={(e) =>
                        setEditingItem((prev) => ({ ...prev, psu_tier: e.target.value }))
                      }
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                    >
                      <option value="">Auto</option>
                      <option value="A+">A+</option>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="D">D</option>
                      <option value="E">E</option>
                      <option value="F">F</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Score</label>
                    <input
                      type="number"
                      value={editingItem.hardware_score || 75}
                      onChange={(e) =>
                        setEditingItem((prev) => ({ ...prev, hardware_score: e.target.value }))
                      }
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
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
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                Authenticated Account
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
                        {new Date(b.created_at).toLocaleDateString()} · Score:{' '}
                        {b.compatibility_score === null || b.compatibility_score === undefined
                          ? 'Not enough data'
                          : `${b.compatibility_score}%`}
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

          {userPreorders.length > 0 && (
            <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-5">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
                Pre-Order Allocations ({userPreorders.length})
              </h4>
              <div className="space-y-2">
                {userPreorders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3 rounded bg-[#0b0f19] border border-[#1f293d] flex justify-between items-center text-xs"
                  >
                    <div>
                      <p className="font-bold text-white">{ord.product_name}</p>
                      <p className="text-slate-400">{ord.status}</p>
                    </div>
                    <span className="font-mono font-bold text-emerald-400">
                      {peso(ord.estimated_price)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
    const psu = getPsuProfile(product);
    const ramInfo = getRamSummary(product, selectedRamCount);
    const learnUrl = buildLearnMoreUrl(product);

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
              <span className="text-[10px] text-slate-500 uppercase block">
                {normalizeText(product.category) === 'power supplies'
                  ? 'SPL PSU Tier'
                  : 'Hardware Rating'}
              </span>
              <span className="font-bold text-white">
                {normalizeText(product.category) === 'power supplies'
                  ? `Tier ${psu.tier} (Score: ${product.hardware_score || 75}/100)`
                  : `${product.hardware_score || 75}/100`}
              </span>
            </div>
            <div className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d]">
              <span className="text-[10px] text-slate-500 uppercase block">
                Socket / Form Factor
              </span>
              <span className="font-bold text-white">
                {product.socket ||
                  detectCpuSocket(product) ||
                  detectMotherboardSocket(product) ||
                  detectPartFormFactor(product)}
              </span>
            </div>
          </div>

          <div className="p-3 rounded bg-[#0b0f19] border border-[#1f293d] text-xs text-slate-300">
            <span className="text-[10px] text-slate-500 uppercase block mb-1 font-bold">
              Technical Description
            </span>
            {product.specs ||
              (normalizeText(product.category) === 'memory'
                ? `${ramInfo.stickCount}x ${ramInfo.perStickCapacity || ''}GB ${
                    ramInfo.isKit ? '(Prebundled Kit)' : '(Single Stick)'
                  }`
                : 'Standard hardware specification.')}
          </div>

          {learnUrl && (
            <div className="mt-4 flex justify-end">
              <a
                href={learnUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
              >
                Learn More (Spec Sheet) →
              </a>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCustomPartModal = () => {
    if (!customModalOpen) return null;
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[115] flex items-center justify-center p-4">
        <div className="bg-[#111827] border border-[#1f293d] max-w-md w-full rounded-lg p-5 shadow-2xl text-left text-white">
          <div className="flex justify-between items-start border-b border-[#1f293d] pb-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                Upgrade Rig · Unlisted Owned Hardware
              </span>
              <h3 className="text-base font-bold text-white mt-0.5">Add Custom Current Part</h3>
            </div>
            <button
              type="button"
              onClick={() => setCustomModalOpen(false)}
              className="text-slate-400 hover:text-white font-bold text-lg"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleAddCustomPart} className="mt-4 space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-slate-400 block mb-1">Category</label>
                <select
                  value={customPartForm.category}
                  onChange={(e) => setCustomPartForm((p) => ({ ...p, category: e.target.value }))}
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {getCategoryLabel(cat)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Form Factor</label>
                <input
                  type="text"
                  value={customPartForm.form_factor}
                  onChange={(e) =>
                    setCustomPartForm((p) => ({ ...p, form_factor: e.target.value }))
                  }
                  placeholder="ATX / mATX / ITX"
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Current Part Name *</label>
              <input
                type="text"
                required
                value={customPartForm.name}
                onChange={(e) => setCustomPartForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Existing Unlisted Motherboard or PSU"
                className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-slate-400 block mb-1">Socket</label>
                <input
                  type="text"
                  value={customPartForm.socket}
                  onChange={(e) => setCustomPartForm((p) => ({ ...p, socket: e.target.value }))}
                  placeholder="AM4 / AM5 / LGA1700"
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Memory Type</label>
                <input
                  type="text"
                  value={customPartForm.memory_type}
                  onChange={(e) =>
                    setCustomPartForm((p) => ({ ...p, memory_type: e.target.value }))
                  }
                  placeholder="DDR4 / DDR5"
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Wattage (W)</label>
                <input
                  type="number"
                  min="0"
                  value={customPartForm.wattage}
                  onChange={(e) => setCustomPartForm((p) => ({ ...p, wattage: e.target.value }))}
                  placeholder="0"
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">
                Specs / Notes (leave blank to flag unverified)
              </label>
              <textarea
                rows={2}
                value={customPartForm.specs}
                onChange={(e) => setCustomPartForm((p) => ({ ...p, specs: e.target.value }))}
                className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
              />
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setCustomModalOpen(false)}
                className="flex-1 py-1.5 rounded border border-[#1f293d] text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold uppercase"
              >
                Save to Current Rig
              </button>
            </div>
          </form>
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
                onChange={(e) =>
                  setPreorderForm((prev) => ({ ...prev, customer_name: e.target.value }))
                }
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
                onChange={(e) =>
                  setPreorderForm((prev) => ({ ...prev, contact_number: e.target.value }))
                }
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
        <header className="border-b border-[#1f293d] bg-[#111827]/95 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-3 sm:px-4">
            <div className="h-14 flex items-center justify-between gap-3">
              <button
                onClick={handleLogoClick}
                title="ByteBuild Home"
                className="flex items-center gap-2.5 select-none text-left shrink-0"
              >
                <img src={bbLogo} alt="ByteBuild Logo" className="h-8 w-auto object-contain" />
                <div>
                  <span className="text-sm font-black tracking-tight text-white uppercase block leading-none">
                    BYTEBUILD
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium block mt-0.5">
                    Guided PC Builder
                  </span>
                </div>
              </button>

              <nav className="hidden md:flex items-center gap-1.5">
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
                    className={`px-3.5 py-1.5 rounded-md text-xs font-bold uppercase transition-colors ${
                      activePage === page
                        ? 'bg-blue-600 text-white shadow-sm'
                        : page === 'admin'
                        ? 'text-emerald-400 border border-emerald-800/50 bg-emerald-950/30 hover:bg-emerald-900/40'
                        : 'text-slate-400 hover:text-white hover:bg-[#1f293d]/50'
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

              <div className="shrink-0">
                <button
                  onClick={() => setActivePage('login')}
                  className="px-3.5 py-1.5 rounded-md bg-[#1f293d] hover:bg-slate-700 text-xs font-bold text-white whitespace-nowrap border border-slate-700/60"
                >
                  {currentUser ? currentUser.email.split('@')[0] : 'Sign In'}
                </button>
              </div>
            </div>

            <nav className="flex md:hidden items-center gap-1.5 pb-2.5 pt-1 overflow-x-auto no-scrollbar border-t border-[#1f293d]/70">
              {[
                'home',
                'products',
                'builder',
                'upgrade',
                ...(isAdminAccount || adminUnlocked ? ['admin'] : []),
              ].map((page) => (
                <button
                  key={`mob-${page}`}
                  onClick={() => setActivePage(page)}
                  className={`flex-1 min-w-[72px] py-2 px-2 rounded-md text-[11px] font-bold uppercase text-center transition-colors whitespace-nowrap ${
                    activePage === page
                      ? 'bg-blue-600 text-white shadow-sm'
                      : page === 'admin'
                      ? 'text-emerald-400 border border-emerald-800/50 bg-emerald-950/40'
                      : 'bg-[#0b0f19]/80 text-slate-300 border border-[#1f293d]'
                  }`}
                >
                  {page === 'products'
                    ? 'Inventory'
                    : page === 'builder'
                    ? 'Builder'
                    : page === 'upgrade'
                    ? 'Upgrade'
                    : page === 'admin'
                    ? 'Admin'
                    : 'Home'}
                </button>
              ))}
            </nav>
          </div>
        </header>

        <main
          key={activePage}
          className="max-w-7xl mx-auto px-3 sm:px-4 py-5 pb-28 lg:pb-8 app-view-container"
        >
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

      {renderFloatingMobileBar()}
      {renderMobileManifestDrawer()}
      {renderCustomPartModal()}
      {renderProductModal()}
      {renderPreorderModal()}
    </>
  );
}