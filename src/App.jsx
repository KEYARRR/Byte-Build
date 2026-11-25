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
import { evaluateBuildRules } from './lib/compat.js';
import { parseRam } from './lib/ram.js';
import { runSmartBuildAssistant } from './lib/autobuilder.js';
import { prepareOcrImagePasses } from './lib/imagePrep.js';
import {
  cleanOcrText,
  levenshteinDistance,
  matchOcrTextToCatalog,
  applyInStockOcrMatches,
} from './lib/ocr.js';
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
import { RULE_CATALOG } from './lib/ruleCatalog.js';

const ACTIVE_TABLE = 'bytebuild_current_inventory';
const PREORDER_TABLE = 'bytebuild_preorder_inventory';
const REFERENCE_TABLE = 'bytebuild_reference_parts';
const DSS_SETTINGS_TABLE = 'bytebuild_dss_settings';
const ADMIN_PIN = String(import.meta.env.VITE_ADMIN_PIN || '').trim();

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

const PRIVACY_NOTICE_TEXT =
  'We collect your name, contact number, email, and build configuration solely to prepare quotations, process pre-order allocations, and assist with hardware builds. Only ByteBuild shop staff view submitted requests, handled in accordance with the Data Privacy Act of 2012 (RA 10173). To request deletion of your data, contact the shop directly via our official support channel.';

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
    return { stickCount: 0, perStickCapacity: 0, totalCapacity: 0, isKit: false, totalPrice: 0 };
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
      :root { color-scheme: dark; background: #0b0f19; }
      html, body, #root {
        min-height: 100%; margin: 0; background: #0b0f19 !important; color: #f1f5f9;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
      }
      *, *::before, *::after { box-sizing: border-box; }
      input, select, textarea { color-scheme: dark; }
      .font-mono {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif !important;
        font-variant-numeric: tabular-nums;
      }
      .no-scrollbar::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      .no-scrollbar { -ms-overflow-style: none !important; scrollbar-width: none !important; }
      @media print {
        @page { size: A4 portrait; margin: 12mm 15mm; }
        body, html, #root { background: #ffffff !important; color: #0f172a !important; font-size: 9pt !important; }
        header, footer, nav, button, input, select, .print\\:hidden, .mobile-bottom-bar { display: none !important; }
        #printable-quotation { display: block !important; position: static !important; width: 100% !important; background: #ffffff !important; color: #0f172a !important; }
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
  const [offlineMode, setOfflineMode] = useState(false);
  const [bannerNotice, setBannerNotice] = useState(null);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);

  const [buildFocused, setBuildFocused] = useState(false);
  const [showUnknownRules, setShowUnknownRules] = useState(false);
  const [showRuleCatalogPanel, setShowRuleCatalogPanel] = useState(false);

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
  const [platformPreference, setPlatformPreference] = useState('auto');
  const [buildVariationCount, setBuildVariationCount] = useState(0);
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
  const [ocrProgress, setOcrProgress] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [ocrScanResults, setOcrScanResults] = useState([]);
  const [showRawOcrText, setShowRawOcrText] = useState(false);

  const [ocrLabTruth, setOcrLabTruth] = useState('');
  const [ocrLabOutput, setOcrLabOutput] = useState('');
  const [ocrLabMetrics, setOcrLabMetrics] = useState(null);
  const [ocrLabRunning, setOcrLabRunning] = useState(false);

  const ocrWorkerRef = useRef(null);
  const focusViewRef = useRef(null);
  const refreshInventoryRef = useRef(null);
  const refreshAdminLogsRef = useRef(null);
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
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [forgotEmailSent, setForgotEmailSent] = useState(false);

  const [savedBuilds, setSavedBuilds] = useState([]);
  const [savingBuild, setSavingBuild] = useState(false);
  const [saveConsentChecked, setSaveConsentChecked] = useState(false);
  const [exportingQuote, setExportingQuote] = useState(false);
  const [quoteConsentChecked, setQuoteConsentChecked] = useState(false);

  const [preorderModalItem, setPreorderModalItem] = useState(null);
  const [, setUserPreorders] = useState([]);
  const [preorderForm, setPreorderForm] = useState({
    customer_name: '',
    contact_number: '',
    email: '',
    consent: false,
  });
  const [preorderSubmitting, setPreorderSubmitting] = useState(false);

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

  const showNotice = useCallback((type, message, onRetry = null) => {
    setBannerNotice({ type, message, onRetry });
  }, []);

  const isAdminAccount = useMemo(() => {
    if (!currentUser?.email) return false;
    return ADMIN_EMAILS.includes(currentUser.email.toLowerCase());
  }, [currentUser]);

  const canAccessAdmin = useMemo(() => {
    if (!ADMIN_PIN) return isAdminAccount;
    return isAdminAccount || adminUnlocked;
  }, [isAdminAccount, adminUnlocked]);

  useEffect(() => {
    return () => {
      if (ocrWorkerRef.current) {
        ocrWorkerRef.current.terminate().catch(() => {});
        ocrWorkerRef.current = null;
      }
    };
  }, []);

  const getOrCreateOcrWorker = useCallback(async (onProgress) => {
    if (!ocrWorkerRef.current) {
      ocrWorkerRef.current = await createWorker('eng', 1, {
        logger: (m) => {
          if (typeof onProgress === 'function') onProgress(m);
        },
      });
    }
    return ocrWorkerRef.current;
  }, []);

  const loadDssSettingsFromSupabase = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from(DSS_SETTINGS_TABLE)
        .select('settings')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      if (data?.settings) {
        const normalized = normalizeDssRules(data.settings, DEFAULT_DSS_RULES);
        setDssRules(normalized);
        localStorage.setItem('bytebuild_dss_rules', JSON.stringify(normalized));
        setSettingsNotice('');
        return;
      }
      setSettingsNotice('Using local settings (shared settings unavailable)');
    } catch {
      try {
        const saved = localStorage.getItem('bytebuild_dss_rules');
        if (saved) setDssRules(normalizeDssRules(JSON.parse(saved), DEFAULT_DSS_RULES));
      } catch {
        setDssRules(DEFAULT_DSS_RULES);
      }
      setSettingsNotice('Using local settings (shared settings unavailable)');
    }
  }, []);

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
      setOfflineMode(false);
      setBannerNotice(null);
    } catch (err) {
      setOfflineMode(true);
      showNotice(
        'error',
        `Inventory sync failed (${err.message}). Offline / using cached data.`,
        () => refreshInventoryRef.current?.()
      );
    }
  }, [showNotice]);

  const refreshAdminLogsNow = useCallback(async () => {
    try {
      const { data: quotes, error: qErr } = await supabase
        .from('bytebuild_quotations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (qErr) throw qErr;
      if (quotes) setAdminQuotations(quotes);
    } catch (err) {
      showNotice('error', `Could not load quotations: ${err.message}`, () =>
        refreshAdminLogsRef.current?.()
      );
    }

    try {
      const { data: preorders, error: pErr } = await supabase
        .from('bytebuild_preorder_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (pErr) throw pErr;
      if (preorders) setAdminAllPreorders(preorders);
    } catch (err) {
      showNotice('error', `Could not load pre-orders: ${err.message}`, () =>
        refreshAdminLogsRef.current?.()
      );
    }
  }, [showNotice]);

  useEffect(() => {
    refreshInventoryRef.current = refreshInventoryNow;
    refreshAdminLogsRef.current = refreshAdminLogsNow;
  }, [refreshInventoryNow, refreshAdminLogsNow]);

  useEffect(() => {
    if (buildFocused && focusViewRef.current) {
      focusViewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [buildFocused]);

  const handleLogoClick = () => {
    setActivePage('home');
  };

  const handleAdminLogout = () => {
    setAdminUnlocked(false);
    setAdminPinInput('');
    setEditingItem(null);
    setActivePage('home');
  };

  useEffect(() => {
    const hash = window.location.hash;
    const isRecoveryHash = Boolean(
      hash && (hash.includes('type=recovery') || hash.includes('access_token'))
    );

    if (isRecoveryHash) {
      Promise.resolve().then(() => {
        setActivePage('login');
        setAuthMode('update-password');
        setCurrentUser(null);
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
        setCurrentUser(null);
        setActivePage('login');
        setAuthMode('update-password');
        return;
      }

      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        return;
      }

      setAuthMode((currentMode) => {
        if (currentMode === 'update-password') {
          setCurrentUser(null);
          return currentMode;
        }
        setCurrentUser(session?.user ?? null);
        if (session?.user?.email) {
          setPreorderForm((prev) => ({ ...prev, email: session.user.email }));
        }
        return currentMode;
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      await refreshInventoryNow();
      await loadDssSettingsFromSupabase();
      if (!cancelled) setLoading(false);
    }

    initialLoad();

    const channel = supabase
      .channel('bytebuild-realtime-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: ACTIVE_TABLE }, () => {
        if (!cancelled) refreshInventoryNow();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: PREORDER_TABLE }, () => {
        if (!cancelled) refreshInventoryNow();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: REFERENCE_TABLE }, () => {
        if (!cancelled) refreshInventoryNow();
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: DSS_SETTINGS_TABLE },
        (payload) => {
          if (!cancelled && payload?.new?.settings) {
            const nextRules = normalizeDssRules(payload.new.settings, DEFAULT_DSS_RULES);
            setDssRules(nextRules);
            localStorage.setItem('bytebuild_dss_rules', JSON.stringify(nextRules));
            setSettingsNotice('');
          }
        }
      )
      .subscribe((status) => {
        if (!cancelled) setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [refreshInventoryNow, loadDssSettingsFromSupabase]);

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
        if (buildsErr) throw buildsErr;

        const { data: orders, error: ordersErr } = await supabase
          .from('bytebuild_preorder_requests')
          .select('*')
          .eq('user_id', currentUser.id)
          .order('created_at', { ascending: false });
        if (ordersErr) throw ordersErr;

        if (!cancelled) {
          if (builds) setSavedBuilds(builds);
          if (orders) setUserPreorders(orders);
        }
      } catch (err) {
        if (!cancelled) {
          showNotice('error', `Could not load account records: ${err.message}`, syncUserRecords);
        }
      }
    }

    syncUserRecords();
    return () => {
      cancelled = true;
    };
  }, [currentUser, showNotice]);

  useEffect(() => {
    if (activePage !== 'admin') return;
    let active = true;
    Promise.resolve().then(async () => {
      if (!active) return;
      await refreshAdminLogsNow();
    });
    return () => {
      active = false;
    };
  }, [activePage, refreshAdminLogsNow]);

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
          setShowPassword(false);
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
          setShowPassword(false);
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

      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      await supabase.auth.signOut();
      setCurrentUser(null);
      setAdminUnlocked(false);
      setNewPassword('');
      setAuthPassword('');
      setShowPassword(false);
      setAuthMode('login');
      setActivePage('login');
      showNotice('success', 'Password updated successfully! Please sign in with your new password.');
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
    setNewPassword('');
    setShowPassword(false);
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

      showNotice('success', `Added "${payload.name}" to ${tableName}.`);
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
      showNotice('error', `Admin insert failed: ${err.message}`);
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
      const { error } = await supabase.from(tableName).update(updates).eq('id', editingItem.id);
      if (error) throw error;

      setEditingItem(null);
      showNotice('success', `Updated "${updates.name || editingItem.name}".`);
      await refreshInventoryNow();
    } catch (err) {
      showNotice('error', `Update failed: ${err.message}`);
    } finally {
      setAdminSaving(false);
    }
  };

  const handleAdminQuickStatusToggle = async (item, tableName, nextStatus) => {
    try {
      const { error } = await supabase.from(tableName).update({ stock_status: nextStatus }).eq('id', item.id);
      if (error) throw error;
      await refreshInventoryNow();
    } catch (err) {
      showNotice('error', `Status update failed: ${err.message}`);
    }
  };

  const handleAdminDeleteItem = async (item, tableName) => {
    if (!window.confirm(`Delete "${item.name}" from ${tableName}?`)) return;
    try {
      const { error } = await supabase.from(tableName).delete().eq('id', item.id);
      if (error) throw error;
      await refreshInventoryNow();
    } catch (err) {
      showNotice('error', `Delete failed: ${err.message}`);
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
      showNotice('error', `Could not update pre-order: ${err.message}`);
    }
  };

  const handleSaveDssRules = async (e) => {
    e.preventDefault();
    const normalized = normalizeDssRules(dssRules, DEFAULT_DSS_RULES);
    setDssRules(normalized);
    localStorage.setItem('bytebuild_dss_rules', JSON.stringify(normalized));

    try {
      const { error } = await supabase.from(DSS_SETTINGS_TABLE).upsert(
        {
          id: 1,
          settings: normalized,
          updated_at: new Date().toISOString(),
          updated_by: currentUser?.email || 'admin',
        },
        { onConflict: 'id' }
      );
      if (error) throw error;
      setSettingsNotice('');
      showNotice('success', 'Saved DSS rules to Supabase shared settings and local storage.');
    } catch (err) {
      setSettingsNotice('Using local settings (shared settings unavailable)');
      showNotice(
        'warning',
        `Saved locally, but shared Supabase settings could not be updated (${err.message}).`,
        () => handleSaveDssRules(e)
      );
    }
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

  const runMultiPassRecognition = useCallback(
    async (file, onProgress) => {
      const worker = await getOrCreateOcrWorker(onProgress);
      const passes = await prepareOcrImagePasses(file, 2000);

      await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
      const resPass1 = await worker.recognize(passes.enhancedUrl);

      await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
      const resPass2 = await worker.recognize(passes.thresholdUrl);

      const conf1 = Number(resPass1?.data?.confidence || 0);
      const conf2 = Number(resPass2?.data?.confidence || 0);
      const text1 = String(resPass1?.data?.text || '').trim();
      const text2 = String(resPass2?.data?.text || '').trim();

      const matches1 = matchOcrTextToCatalog(text1, activeProducts, preorderProducts).filter(
        (m) => m.status === 'Matched'
      ).length;
      const matches2 = matchOcrTextToCatalog(text2, activeProducts, preorderProducts).filter(
        (m) => m.status === 'Matched'
      ).length;

      if (matches2 > matches1 || (matches2 === matches1 && conf2 > conf1)) {
        return { rawText: text2, confidence: conf2 };
      }
      return { rawText: text1, confidence: conf1 };
    },
    [getOrCreateOcrWorker, activeProducts, preorderProducts]
  );

  const handleOcrScanImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrLoading(true);
    setOcrError('');
    setOcrProgress('Preparing image...');
    setOcrScanResults([]);

    try {
      const { rawText, confidence } = await runMultiPassRecognition(file, (m) => {
        if (m?.status) {
          const pct = typeof m.progress === 'number' ? ` (${Math.round(m.progress * 100)}%)` : '';
          setOcrProgress(`${m.status}${pct}`);
        }
      });

      setOcrText(rawText);
      if (confidence < 55) {
        setShowRawOcrText(true);
      }
      const results = matchOcrTextToCatalog(rawText, activeProducts, preorderProducts).map(
        (entry) => ({
          ...entry,
          confirmed: entry.status === 'Matched',
        })
      );
      setOcrScanResults(results);
    } catch (err) {
      setOcrError(err?.message || 'Failed to read spec sheet image via OCR.');
    } finally {
      setOcrLoading(false);
      setOcrProgress('');
    }
  };

  const handleRematchEditedOcrText = () => {
    const results = matchOcrTextToCatalog(ocrText, activeProducts, preorderProducts).map(
      (entry) => ({
        ...entry,
        confirmed: entry.status === 'Matched',
      })
    );
    setOcrScanResults(results);
  };

  const handleToggleConfirmOcrLine = (idx, nextConfirmed) => {
    setOcrScanResults((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, confirmed: nextConfirmed } : row))
    );
  };

  const handleChangeOcrLinePart = (idx, partId) => {
    const found = allCatalogPool.find((p) => String(p.id) === String(partId)) || null;
    setOcrScanResults((prev) =>
      prev.map((row, i) =>
        i === idx
          ? {
              ...row,
              matchedPart: found,
              status: found ? 'Matched' : 'Unavailable',
              confidence: found ? Math.max(Number(row.confidence || 0), 0.8) : 0,
              reason: found ? 'Manually selected by user' : 'Skipped / cleared',
              confirmed: Boolean(found),
            }
          : row
      )
    );
  };

  const handleLoadConfirmedOcrParts = () => {
    setSelectedBuild((prev) => applyInStockOcrMatches(prev, ocrScanResults).build);
  };

  const handleRunOcrLabImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrLabRunning(true);
    try {
      const { rawText } = await runMultiPassRecognition(file);
      const cleaned = cleanOcrText(rawText);
      setOcrLabOutput(cleaned);

      const truthLines = String(ocrLabTruth || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const outLines = cleaned
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const truthFlat = truthLines.join(' ');
      const outFlat = outLines.join(' ');
      const maxLen = Math.max(truthFlat.length, outFlat.length, 1);
      const dist = levenshteinDistance(truthFlat, outFlat);
      const charAccuracy = Number(Math.max(0, (1 - dist / maxLen) * 100).toFixed(2));

      let matchedLineCount = 0;
      for (const tLine of truthLines) {
        const hit = outLines.some(
          (oLine) =>
            oLine.toLowerCase().includes(tLine.toLowerCase()) ||
            tLine.toLowerCase().includes(oLine.toLowerCase())
        );
        if (hit) matchedLineCount += 1;
      }
      const lineMatchRate =
        truthLines.length > 0
          ? Number(((matchedLineCount / truthLines.length) * 100).toFixed(2))
          : 0;

      setOcrLabMetrics({
        charAccuracy,
        lineMatchRate,
        truthLinesCount: truthLines.length,
        matchedLineCount,
      });
    } catch (err) {
      showNotice('error', `OCR Lab error: ${err.message}`);
    } finally {
      setOcrLabRunning(false);
    }
  };

  const handleExportOcrLabCsv = () => {
    if (!ocrLabMetrics) return;
    const rows = [
      ['metric', 'value'],
      ['character_accuracy_pct', ocrLabMetrics.charAccuracy],
      ['line_match_rate_pct', ocrLabMetrics.lineMatchRate],
      ['truth_lines', ocrLabMetrics.truthLinesCount],
      ['matched_lines', ocrLabMetrics.matchedLineCount],
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bytebuild-ocr-lab.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

  const missingCoreLabels = useMemo(() => {
    const missing = [];
    if (!selectedBuild.Processors) missing.push('CPU');
    if (!selectedBuild.Motherboards) missing.push('Motherboard');
    if (!selectedBuild.Memory) missing.push('RAM');
    if (!selectedBuild.Storage) missing.push('Boot Drive');
    if (!selectedBuild['Power Supplies']) missing.push('PSU');
    if (!selectedBuild.Cases) missing.push('Case');
    return missing;
  }, [selectedBuild]);

  const isBuildIncomplete = selectedItems.length > 0 && missingCoreLabels.length > 0;
  const incompleteBadgeText =
    missingCoreLabels.length === 1 && missingCoreLabels[0] === 'PSU'
      ? 'Incomplete build — missing: PSU'
      : `Incomplete build — missing: ${missingCoreLabels.join(', ')}`;

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
        workloadProfile: assistantProfile,
      }),
    [currentCpu, currentGpu, actionableIssues, assistantProfile]
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
    const profileKey = assistantProfile === 'Mixed/Balanced' ? 'Balanced' : assistantProfile;

    const result = runSmartBuildAssistant({
      products: activeProducts,
      budgetInput: assistantBudget,
      profile: profileKey,
      platformPreference,
      variationIndex: buildVariationCount,
      overclockEnabled,
    });

    if (!result.ok) {
      setAssistantStatus(result.reason || 'Unable to generate build.');
      return;
    }

    setSelectedBuild(result.build);
    setSelectedRamCount(result.ramStickCount || 2);

    const notes = Array.isArray(result.notes) ? result.notes : [];
    const highlights = [];

    if (notes.some((n) => /paired .* for 500gb\+ storage/i.test(String(n)))) {
      highlights.push('Included extra storage so you have at least 500GB total.');
    }
    if (notes.some((n) => /skipped budget\/unrated psu|adjusted psu/i.test(String(n)))) {
      highlights.push('Equipped with a reliable power supply for safe headroom.');
    }
    if (notes.some((n) => /swapped gpu|adjusted cpu/i.test(String(n)))) {
      highlights.push('Parts were balanced to stay within your budget.');
    }

    const totalFormatted = Number(result.totalPrice || 0).toLocaleString();
    const budgetFormatted = Number(assistantBudget || 0).toLocaleString();
    const platformText = result.platform ? ` (${result.platform})` : '';
    const baseLine = result.withinBudget
      ? `Built a ${assistantProfile} PC for ₱${totalFormatted} within your ₱${budgetFormatted} budget${platformText}.`
      : result.statusMessage;

    setAssistantStatus(
      highlights.length > 0 ? `${baseLine} ${highlights.join(' ')}` : baseLine
    );
    setBuildVariationCount((prev) => prev + 1);
    setBuildFocused(true);
  };

  const handleExportQuotation = async () => {
    if (selectedItems.length === 0) return;
    if (!quoteConsentChecked) {
      showNotice('warning', 'Please check the Data Privacy notice before exporting a quotation.');
      return;
    }
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
      const { error } = await supabase.from('bytebuild_quotations').insert([payload]);
      if (error) {
        showNotice(
          'warning',
          `Quotation downloaded locally, but database log failed (${error.message}).`,
          handleExportQuotation
        );
      }
    } catch (err) {
      showNotice(
        'warning',
        `Quotation downloaded locally, but database log failed (${err.message}).`,
        handleExportQuotation
      );
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
      if (Object.values(next).filter(Boolean).length === CATEGORIES.length) {
        setBuildFocused(true);
      }
      return next;
    });

    if (matchedCategory === 'Memory' && isPrebundledKit(product)) {
      setSelectedRamCount((prev) => Math.max(Number(prev) || 2, 2));
    }
  };

  const handleSetExistingPart = (category, product) => {
    setExistingPc((prev) => ({ ...prev, [category]: product }));
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
    setBuildVariationCount(0);
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
    if (!saveConsentChecked) {
      showNotice('warning', 'Please confirm the Data Privacy notice before saving your build.');
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
      showNotice('success', 'Build saved successfully! View it under your Account tab.');
      const { data: builds } = await supabase
        .from('bytebuild_saved_builds')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });
      if (builds) setSavedBuilds(builds);
    } catch (err) {
      showNotice('error', `Could not save build: ${err.message}`, handleSaveCurrentBuild);
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
      showNotice('error', `Delete failed: ${err.message}`);
    }
  };

  const handlePreorderSubmit = async (e) => {
    e.preventDefault();
    if (!preorderModalItem) return;
    if (!preorderForm.consent) {
      showNotice('warning', 'Please accept the Data Privacy notice before submitting a pre-order.');
      return;
    }

    const validation = validatePreorderInput({
      customerName: preorderForm.customer_name,
      contactNumber: preorderForm.contact_number,
    });
    if (!validation.valid) {
      showNotice('warning', validation.error);
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
      showNotice('success', `Pre-order submitted for ${preorderModalItem.name}.`);
      setPreorderModalItem(null);
      setPreorderForm({
        customer_name: '',
        contact_number: '',
        email: currentUser?.email || '',
        consent: false,
      });
    } catch (err) {
      showNotice('error', `Pre-order failed: ${err.message}`, () => handlePreorderSubmit(e));
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
              <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-900 text-slate-200 border-slate-700">
                SPL Tier {psu.tier}
              </span>
            )}
            <span className="text-[10px] text-slate-500 font-mono">SKU: {product.sku_code || product.id}</span>
            <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              {status}
            </span>
          </div>
          <h4
            onClick={() => setSelectedProduct(product)}
            className="text-sm font-bold text-white hover:text-blue-400 cursor-pointer truncate"
          >
            {product.name}
          </h4>
          <p className="text-xs text-slate-400 mt-1 line-clamp-1">{product.specs || 'Standard specification'}</p>
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
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
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
    <div className="flex gap-2 overflow-x-auto pb-2.5 pt-0.5 border-b border-[#1f293d] scroll-smooth">
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
              if (activePage === 'home') setActivePage('products');
            }}
            className={`shrink-0 px-3.5 py-2 rounded-lg border text-xs font-bold transition-all flex items-center gap-2 ${
              isActive
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-[#111827] border-[#1f293d] text-slate-300 hover:border-slate-500'
            }`}
          >
            <span>{getCategoryLabel(category)}</span>
            {hasSelection && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
            <span className="text-[10px] text-slate-400">({categoryCounts[category] || 0})</span>
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
          {[10000, 25000, 40000, 65000, 95000].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setAssistantBudget(preset);
                setBuildVariationCount(0);
              }}
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
        <div className="sm:col-span-3">
          <label className="text-[11px] text-slate-400 block mb-1 font-semibold">Target Budget (PHP)</label>
          <input
            type="number"
            min="1"
            step="500"
            value={assistantBudget}
            onChange={(e) => {
              setAssistantBudget(e.target.value);
              setBuildVariationCount(0);
            }}
            className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-xs text-white font-mono"
          />
        </div>
        <div className="sm:col-span-4">
          <label className="text-[11px] text-slate-400 block mb-1 font-semibold">Intended Workload Profile</label>
          <select
            value={assistantProfile}
            onChange={(e) => {
              setAssistantProfile(e.target.value);
              setBuildVariationCount(0);
            }}
            className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-xs text-white font-semibold"
          >
            <option value="Gaming">Gaming (GPU & Frame Pacing Priority)</option>
            <option value="Office/Productivity">Office / Productivity (Cost-Efficient APU/CPU)</option>
            <option value="Content Creation">Content Creation (Multi-Core & RAM Priority)</option>
            <option value="Mixed/Balanced">Mixed Dual-Purpose (Balanced Tier Parity)</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-[11px] text-slate-400 block mb-1 font-semibold">Platform</label>
          <select
            value={platformPreference}
            onChange={(e) => {
              setPlatformPreference(e.target.value);
              setBuildVariationCount(0);
            }}
            className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-xs text-white font-semibold"
          >
            <option value="auto">Auto (Ryzen / Intel)</option>
            <option value="ryzen">Ryzen (AMD)</option>
            <option value="intel">Intel</option>
          </select>
        </div>
        <div className="sm:col-span-3">
          <button
            type="button"
            onClick={() => handleRunSmartBuildAssistant()}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 px-3 rounded text-xs font-bold uppercase tracking-wider"
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
    const confirmedCount = ocrScanResults.filter((r) => r.confirmed && r.matchedPart).length;
    const avgConfidencePct =
      ocrScanResults.length > 0
        ? Math.round(
            (ocrScanResults.reduce((acc, r) => acc + Number(r.confidence || 0), 0) /
              ocrScanResults.length) *
              100
          )
        : 100;
    const isLowQuality = ocrScanResults.length > 0 && avgConfidencePct < 55;

    return (
      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 text-left space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1f293d] pb-2.5">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
              Paper Spec Sheet Scanner · On-Device OCR & Confirmation
            </span>
            <h3 className="text-sm font-bold text-white">
              Upload or Snap a Photo of Your Paper Spec Sheet
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Good light, flat page, whole text in frame, no glare.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {ocrText && (
              <button
                type="button"
                onClick={() => setShowRawOcrText((prev) => !prev)}
                className="px-2.5 py-1.5 rounded bg-[#0b0f19] border border-[#1f293d] text-[11px] font-semibold text-slate-300"
              >
                {showRawOcrText ? 'Hide Typed / OCR Text' : 'Edit OCR Text'}
              </button>
            )}
            {confirmedCount > 0 && (
              <button
                type="button"
                onClick={handleLoadConfirmedOcrParts}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                Load {confirmedCount} Confirmed Part{confirmedCount > 1 ? 's' : ''}
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
              {ocrProgress || 'Scanning spec sheet on-device...'}
            </span>
          )}
          {ocrError && <span className="text-xs text-red-400">{ocrError}</span>}
        </div>

        {isLowQuality && (
          <div className="p-2.5 rounded bg-amber-950/60 border border-amber-700/50 text-xs text-amber-200">
            Scan quality is low — correct the text below or type the list.
          </div>
        )}

        {(showRawOcrText || isLowQuality) && (
          <div className="space-y-2">
            <textarea
              rows={3}
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              placeholder="Type or paste part names line-by-line (e.g. Ryzen 5 5600, B550M, RX 6600)..."
              className="w-full bg-[#0b0f19] border border-[#1f293d] rounded p-2.5 text-xs text-white"
            />
            <button
              type="button"
              onClick={handleRematchEditedOcrText}
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
            >
              Re-Match Text
            </button>
          </div>
        )}

        {ocrScanResults.length > 0 && (
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {ocrScanResults.map((entry, idx) => {
              const confPct = Math.round(Number(entry.confidence || 0) * 100);
              return (
                <div
                  key={`ocr-line-${idx}`}
                  className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] flex flex-col lg:flex-row lg:items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-slate-500 truncate">
                      Scanned: "{entry.rawLine}" · {entry.reason} ({confPct}%)
                    </p>
                    <p className="font-bold text-white truncate">
                      {entry.matchedPart ? entry.matchedPart.name : 'No matching item'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">
                      {entry.status}
                    </span>
                    <select
                      value={entry.matchedPart?.id || ''}
                      onChange={(e) => handleChangeOcrLinePart(idx, e.target.value)}
                      className="bg-[#111827] border border-[#1f293d] rounded px-1.5 py-1 text-[10px] text-white max-w-[160px]"
                    >
                      <option value="">Change part...</option>
                      {allCatalogPool.slice(0, 40).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!entry.matchedPart}
                      onClick={() => handleToggleConfirmOcrLine(idx, true)}
                      className={`px-2 py-1 rounded text-[10px] font-bold ${
                        entry.confirmed && entry.matchedPart
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[#1f293d] text-slate-200 disabled:opacity-40'
                      }`}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleConfirmOcrLine(idx, false)}
                      className="px-2 py-1 rounded bg-slate-800 text-slate-400 hover:text-white text-[10px] font-bold"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderRulesAndDiagnosticsShowcase = () => {
    const ruleMap = new Map(ruleResults.map((r) => [r.ruleId, r]));

    return (
      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 text-left space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
              Rules Reference
            </span>
            <h4 className="text-sm font-bold text-white">Rules & Diagnostics Reference</h4>
          </div>
          <button
            type="button"
            onClick={() => setShowRuleCatalogPanel((prev) => !prev)}
            className="px-2.5 py-1.5 rounded bg-[#1f293d] text-xs font-bold text-white shrink-0"
          >
            {showRuleCatalogPanel ? 'Hide Rules ▲' : 'Show All Rules ▼'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 border-t border-[#1f293d] pt-2">
          <span>
            <strong className="text-emerald-400">Pass / Verified:</strong> Rule satisfied
          </span>
          <span>·</span>
          <span>
            <strong className="text-amber-300">Warn / Estimated:</strong> Caution or inferred spec
          </span>
          <span>·</span>
          <span>
            <strong className="text-red-400">Fail / Conflict:</strong> Incompatible pairing
          </span>
          <span>·</span>
          <span>
            <strong className="text-slate-300">Unknown / Needs Spec Check:</strong> Missing spec data
          </span>
        </div>

        {showRuleCatalogPanel && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {RULE_CATALOG.map((catRule) => {
              const live = ruleMap.get(catRule.id);
              const liveStatus = live?.status || 'not-evaluated';
              return (
                <div
                  key={catRule.id}
                  className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-white">{catRule.title}</span>
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#111827] text-blue-300">
                      {liveStatus}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">{catRule.whatItChecks}</p>
                  {live?.message && (
                    <p className="text-[10px] text-slate-300">Current: {live.message}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderRationaleAndCompareCards = () => {
    const activeChip = activeRule ? getRuleChipMeta(activeRule) : null;
    const isActiveRuleGreen =
      activeRule &&
      activeRule.status === 'pass' &&
      !activeRule.unverified &&
      (activeChip?.dotClass?.includes('emerald') ||
        activeRule.ruleId === 'RULE-RAM-LIM-01' ||
        activeRule.ruleId === 'RULE-IGPU-01' ||
        activeRule.ruleId === 'RULE-STOR-01');

    const effectiveBadgeLabel =
      isBuildIncomplete && activeChip?.badgeLabel?.toUpperCase() === 'VERIFIED'
        ? 'Build incomplete'
        : activeChip?.badgeLabel;

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
                  isBuildIncomplete && activeChip?.badgeLabel?.toUpperCase() === 'VERIFIED'
                    ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                    : activeRule.status === 'unknown' || activeRule.unverified
                    ? 'bg-slate-800 text-slate-300 border border-slate-700'
                    : activeRule.status === 'fail'
                    ? 'bg-red-950 text-red-400 border border-red-800/50'
                    : isActiveRuleGreen
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                    : activeRule.status === 'warn' || activeRule.dataSource === 'estimated'
                    ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                    : 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                }`}
              >
                {effectiveBadgeLabel}
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
                </p>
              )}
              {activeChip.whyItMatters && (
                <p className="text-[11px] text-slate-400">
                  <strong className="text-slate-300">Why this matters:</strong> {activeChip.whyItMatters}
                </p>
              )}
              {activeRule.recommendation && (
                <p
                  className={`${
                    activeRule.status === 'pass' ? 'text-emerald-400' : 'text-blue-400'
                  } text-[11px] font-semibold`}
                >
                  {activeRule.status === 'pass'
                    ? activeRule.recommendation
                    : `Next Step: ${activeRule.recommendation}`}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Select parts to inspect compatibility checks.</p>
          )}

          {ruleResults.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#1f293d]">
              {ruleResults.map((rule) => {
                const chip = getRuleChipMeta(rule);
                const isGreenPass =
                  rule.status === 'pass' &&
                  !rule.unverified &&
                  (chip.dotClass?.includes('emerald') ||
                    rule.ruleId === 'RULE-RAM-LIM-01' ||
                    rule.ruleId === 'RULE-IGPU-01' ||
                    rule.ruleId === 'RULE-STOR-01');
                return (
                  <button
                    key={rule.ruleId}
                    type="button"
                    onClick={() => setSelectedRuleId(rule.ruleId)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold border flex items-center gap-1.5 ${
                      activeRule?.ruleId === rule.ruleId
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : rule.status === 'fail'
                        ? 'bg-red-950/50 border-red-800/60 text-red-200'
                        : isGreenPass || rule.status === 'pass'
                        ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-200'
                        : rule.status === 'warn' || rule.dataSource === 'estimated'
                        ? 'bg-amber-950/50 border-amber-800/60 text-amber-200'
                        : 'bg-[#0b0f19] border-[#1f293d] text-slate-300'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${chip.dotClass}`} />
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
            {comparisonItems.map((item) => {
              const isPicked = selectedBuild[compareCategory]?.id === item.id;
              const effectivePrice = getEffectiveItemPrice(compareCategory, item, selectedRamCount);
              return (
                <div
                  key={`cmp-${item.id}`}
                  className="p-2 rounded bg-[#0b0f19] border border-[#1f293d] flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate">{item.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {peso(effectivePrice)} · Score: {item.hardware_score || 75}/100
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectProduct(item)}
                    className={`px-2 py-1 rounded text-[10px] font-bold ${
                      isPicked ? 'bg-emerald-700 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    {isPicked ? 'Selected' : 'Use'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderCatalogList = (existingCategory = null) => (
    <div className="space-y-4">
      <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <input
            type="text"
            placeholder="Search model, SKU, socket, PSU tier, specs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-80 bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-xs text-white"
          />
          {activePage !== 'upgrade' && (
            <div className="flex items-center gap-1 bg-[#0b0f19] p-1 rounded-lg border border-[#1f293d]">
              <button
                type="button"
                onClick={() => setInventoryMode('active')}
                className={`px-3 py-1 rounded text-xs font-bold ${
                  inventoryMode === 'active' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                }`}
              >
                Active Stock ({activeProducts.filter((p) => p.stock_status !== 'Sold Out').length})
              </button>
              <button
                type="button"
                onClick={() => setInventoryMode('preorder')}
                className={`px-3 py-1 rounded text-xs font-bold ${
                  inventoryMode === 'preorder' ? 'bg-blue-600 text-white' : 'text-slate-400'
                }`}
              >
                Pre-Order ({preorderProducts.length})
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-[#1f293d]">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1 text-xs text-white"
            >
              {brandsForActiveCategory.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            {formFactorsForActiveCategory.length > 1 && (
              <select
                value={selectedFormFactor}
                onChange={(e) => setSelectedFormFactor(e.target.value)}
                className="bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1 text-xs text-white"
              >
                {formFactorsForActiveCategory.map((ff) => (
                  <option key={ff} value={ff}>
                    {ff}
                  </option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-1">
              <input
                type="number"
                placeholder="Min ₱"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className="w-20 bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1 text-xs text-white font-mono"
              />
              <input
                type="number"
                placeholder="Max ₱"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="w-20 bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1 text-xs text-white font-mono"
              />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showSoldOut}
                onChange={(e) => setShowSoldOut(e.target.checked)}
              />
              <span>Show Sold Out</span>
            </label>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1 text-xs text-white font-semibold"
          >
            <option value="price-asc">Price: Lowest to Highest</option>
            <option value="price-desc">Price: Highest to Lowest</option>
            <option value="rating">Hardware Rating (Score)</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        {filteredProducts.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-[#1f293d] rounded-lg text-slate-500 text-xs">
            No components found matching your filter criteria.
          </div>
        ) : (
          filteredProducts.map((p) => renderProductRow(p, true, existingCategory))
        )}
      </div>
    </div>
  );

  const renderBuildSummary = (showFocusButton = false) => (
    <div id="printable-quotation" className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-[#1f293d] pb-2 mb-2 print:hidden">
        <div>
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">System Build</h3>
          <p className="text-[10px] text-slate-400">
            {selectedItems.length}/{CATEGORIES.length} components configured
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {showFocusButton && selectedItems.length > 0 && (
            <button
              type="button"
              onClick={() => setBuildFocused(true)}
              className="px-2 py-0.5 bg-sky-600 text-white rounded text-[10px] font-bold"
            >
              Focus Build
            </button>
          )}
          <button
            onClick={handleSaveCurrentBuild}
            disabled={savingBuild || selectedItems.length === 0}
            className="px-2 py-0.5 bg-emerald-700 text-white rounded text-[10px] font-bold disabled:opacity-40"
          >
            {savingBuild ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleExportQuotation}
            disabled={exportingQuote || selectedItems.length === 0}
            className="px-2 py-0.5 bg-indigo-600 text-white rounded text-[10px] font-bold disabled:opacity-40"
          >
            {exportingQuote ? 'Exporting...' : 'Export'}
          </button>
          <button
            onClick={() => window.print()}
            disabled={selectedItems.length === 0}
            className="px-2 py-0.5 bg-blue-700 text-white rounded text-[10px] font-bold disabled:opacity-40"
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

      {isBuildIncomplete && (
        <div className="mb-2 px-2.5 py-1.5 rounded bg-amber-950/60 border border-amber-700/50 text-[10px] font-bold text-amber-200 print:hidden">
          {incompleteBadgeText}
        </div>
      )}

      <div className="space-y-1">
        {slotManifestRows.map((row) => (
          <div
            key={row.category}
            className="px-2 py-1 rounded border border-[#1f293d] bg-[#0b0f19] flex items-center justify-between gap-2 text-left"
          >
            <div className="min-w-0 flex-1 flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0 w-12">
                {row.shortLabel}
              </span>
              <p className="text-[11px] font-semibold text-white truncate">
                {row.item ? row.item.name : <span className="text-slate-600 italic">Unassigned</span>}
              </p>
              {row.isUnverified && (
                <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-amber-950 text-amber-300">
                  unverified
                </span>
              )}
              {row.isMemory && row.item && (
                <div className="flex items-center gap-0.5 bg-[#111827] px-1 rounded">
                  {[1, 2, 4].map((count) => (
                    <button
                      key={count}
                      onClick={() => setSelectedRamCount(count)}
                      className={`px-1 text-[8px] font-bold rounded ${
                        selectedRamCount === count ? 'bg-blue-600 text-white' : 'text-slate-400'
                      }`}
                    >
                      {count}x
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] font-mono font-bold text-slate-200">{row.priceLabel}</span>
              {row.item && (
                <button
                  onClick={() => setSelectedBuild((prev) => ({ ...prev, [row.category]: null }))}
                  className="text-slate-500 hover:text-red-400 font-bold text-xs"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2.5 pt-2 border-t border-[#1f293d] space-y-2">
        <div className="p-2 rounded bg-[#0b0f19] border border-[#1f293d] space-y-1.5 print:hidden">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1">
              {['idle', 'load'].map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setPowerDisplayView(view)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    powerDisplayView === view ? 'bg-blue-600 text-white' : 'text-slate-400'
                  }`}
                >
                  {view === 'idle' ? 'Idle' : 'Peak Load'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {[false, true].map((oc) => (
                <button
                  key={String(oc)}
                  type="button"
                  onClick={() => setOverclockEnabled(oc)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    overclockEnabled === oc ? 'bg-emerald-700 text-white' : 'text-slate-400'
                  }`}
                >
                  {oc ? 'Overclocked' : 'Stock'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-between items-center text-[11px]">
            <span className="text-slate-300 font-semibold">
              {powerDisplaySummary.modeLabel}:{' '}
              <strong className="text-white font-mono">{powerDisplaySummary.displayedWatts}W</strong>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              Rec PSU: {powerDisplaySummary.recommendedPsuWatts ? `${powerDisplaySummary.recommendedPsuWatts}W` : '--'}
            </span>
          </div>
          <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${powerDisplaySummary.isOverPsuCap ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${powerDisplaySummary.loadPercent}%` }}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-[10px] text-slate-400 cursor-pointer print:hidden">
          <input
            type="checkbox"
            checked={quoteConsentChecked}
            onChange={(e) => setQuoteConsentChecked(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I agree to the{' '}
            <button
              type="button"
              onClick={() => setPrivacyModalOpen(true)}
              className="text-blue-400 underline"
            >
              Data Privacy Notice (RA 10173)
            </button>{' '}
            for quotation export.
          </span>
        </label>

        {currentUser && (
          <label className="flex items-start gap-2 text-[10px] text-slate-400 cursor-pointer print:hidden">
            <input
              type="checkbox"
              checked={saveConsentChecked}
              onChange={(e) => setSaveConsentChecked(e.target.checked)}
              className="mt-0.5"
            />
            <span>I consent to saving my build configuration under my account.</span>
          </label>
        )}

        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-slate-400 font-bold leading-none">Total Estimate</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Cash / Direct Retail (PHP)</p>
          </div>
          <p className="text-lg font-black text-emerald-400 font-mono">{peso(totalPrice)}</p>
        </div>
      </div>
    </div>
  );

  const renderRecommendationPanel = () => {
    const diagBadge = isBuildIncomplete
      ? 'Build incomplete'
      : recommendation.title || 'Verified';

    return (
      <div className="space-y-3">
        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5">
          <div className="flex justify-between items-center gap-2 text-xs font-bold mb-1.5">
            <span className="text-slate-400 uppercase tracking-wider text-[10px]">Compatibility Score</span>
            <span className="text-emerald-400">
              {compatibilityScore === null
                ? 'Not enough data'
                : `Score ${compatibilityScore}% (${verificationCoverage.verified}/${verificationCoverage.total} verified)`}
            </span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${compatibilityScore ?? 0}%` }}
            />
          </div>
        </div>

        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5 text-left">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
            Performance Scoring Module
          </span>
          <h4 className="text-sm font-bold text-white mt-0.5">{performanceTier.label}</h4>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">{performanceTier.description}</p>
          {bottleneckBalance?.message && (
            <p className="text-[11px] text-slate-300 mt-1.5">{bottleneckBalance.message}</p>
          )}
        </div>

        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3.5 text-left space-y-2.5">
          <div className="flex justify-between items-center pb-2 border-b border-[#1f293d] gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              System Diagnostics
            </span>
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                isBuildIncomplete
                  ? 'bg-amber-950 text-amber-300 border border-amber-700/50'
                  : 'bg-slate-800 text-slate-200'
              }`}
            >
              {diagBadge}
            </span>
          </div>

          {isBuildIncomplete && (
            <div className="p-2 rounded bg-amber-950/50 border border-amber-700/40 text-[11px] text-amber-200">
              {incompleteBadgeText}
            </div>
          )}

          {actionableIssues.length === 0 ? (
            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">
              {isBuildIncomplete
                ? 'Build is incomplete; assign all required core components (including PSU) before treating compatibility as complete.'
                : recommendation.summary}
            </p>
          ) : (
            <div className="space-y-2">
              {actionableIssues.map((issue, idx) => (
                <div
                  key={issue.id || idx}
                  onClick={() => setSelectedRuleId(issue.id)}
                  className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] cursor-pointer text-xs"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold uppercase text-slate-500">
                      {getCategoryLabel(issue.category)}
                    </span>
                    <span className="text-[9px] font-bold uppercase text-amber-300">
                      {issue.unverified ? 'unverified' : issue.severity}
                    </span>
                  </div>
                  <p className="font-bold text-slate-200 mt-1">{issue.title}</p>
                  <p className="text-slate-400 text-[11px] mt-0.5">{issue.message}</p>
                  <p className="text-blue-400 text-[11px] mt-1 font-semibold">Fix: {issue.action}</p>
                </div>
              ))}
            </div>
          )}

          {unknownCatalogIssues.length > 0 && (
            <div className="pt-2 border-t border-[#1f293d]">
              <button
                type="button"
                onClick={() => setShowUnknownRules((prev) => !prev)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded bg-[#0b0f19] border border-[#1f293d] text-[11px] font-semibold text-slate-400"
              >
                <span>Missing Catalog Spec Checks ({unknownCatalogIssues.length} unknown)</span>
                <span>{showUnknownRules ? 'Hide ▲' : 'Show ▼'}</span>
              </button>
            </div>
          )}
        </div>

        {renderRulesAndDiagnosticsShowcase()}
      </div>
    );
  };

  const renderFloatingMobileBar = () => {
    if (activePage !== 'builder' && activePage !== 'upgrade') return null;
    return (
      <div
        style={{ position: 'fixed', bottom: '14px', left: '12px', right: '12px', zIndex: 85 }}
        className="lg:hidden bg-[#111827]/95 border border-blue-500/40 rounded-xl p-3 px-4 flex justify-between items-center mobile-bottom-bar print:hidden"
      >
        <div className="text-left">
          <span className="text-[10px] text-slate-300 uppercase font-bold block">
            {activePage === 'upgrade' ? 'Upgrade Cost' : `Total (${selectedItems.length}/${CATEGORIES.length})`}
          </span>
          <p className="text-lg font-black text-emerald-400 font-mono leading-tight">{peso(totalPrice)}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowMobileDrawer(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-lg text-xs font-bold uppercase"
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
        ? 'Not enough data'
        : `Score ${compatibilityScore}% (${verificationCoverage.verified}/${verificationCoverage.total} verified)`;

    return (
      <div className="lg:hidden fixed inset-0 bg-black/80 z-[90] flex flex-col justify-end print:hidden">
        <div className="bg-[#0b0f19] border-t border-[#1f293d] rounded-t-2xl max-h-[85vh] flex flex-col">
          <div className="p-3.5 px-4 bg-[#111827] border-b border-[#1f293d] flex items-center justify-between">
            <h3 className="text-sm font-black text-white">
              System Build ({selectedItems.length}/{CATEGORIES.length}) · {drawerScoreLabel}
            </h3>
            <button
              type="button"
              onClick={() => setShowMobileDrawer(false)}
              className="px-3 py-1.5 rounded-md bg-[#1f293d] text-xs font-bold text-white"
            >
              Close ✕
            </button>
          </div>
          <div className="p-4 overflow-y-auto space-y-4">
            {renderBuildSummary(false)}
            {renderRecommendationPanel()}
          </div>
        </div>
      </div>
    );
  };

  const renderHomePage = () => {
    const availableActiveCount = activeProducts.filter((p) => p.stock_status !== 'Sold Out').length;

    const entryPaths = [
      {
        label: 'New Desktop',
        title: 'Plan a PC at Your Own Pace',
        desc: 'Not sure where to start? Set a budget and tell us what you use your PC for—or pick parts one by one with live compatibility checks.',
        cta: 'Open Smart Builder',
        onClick: () => setActivePage('builder'),
      },
      {
        label: 'Existing Rig',
        title: 'Check Upgrades Before You Buy',
        desc: 'Already own a desktop? Enter your current parts to see which upgrades fit your motherboard, case, and power supply safely.',
        cta: 'Check an Upgrade',
        onClick: () => setActivePage('upgrade'),
      },
      {
        label: 'Parts & Pricing',
        title: 'Browse Live Stock & Quotes',
        desc: 'Compare specs, check in-stock and pre-order availability, and export a clean quotation whenever you are ready.',
        cta: 'Browse Inventory',
        onClick: () => setActivePage('products'),
      },
    ];

    return (
      <div className="space-y-6 text-left">
        <section className="bg-[#111827] border border-[#1f293d] rounded-lg p-6 sm:p-8">
          <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
            Welcome to ByteBuild {realtimeConnected ? '· Live Store Inventory' : ''}
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-white mt-1.5">
            PC Building & Upgrading, Made Simple and Clear.
          </h2>
          <p className="text-sm text-slate-300 mt-3 max-w-3xl leading-relaxed">
            ByteBuild is your guided PC workshop and parts assistant. Whether you are planning your first desktop, upgrading a machine you already own, or just checking current prices and availability, we help you verify that every part fits together safely—so you can buy with confidence and zero guesswork.
          </p>

          <div className="mt-6 flex flex-wrap gap-2.5">
            <button
              onClick={() => setActivePage('builder')}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-md text-xs font-bold uppercase"
            >
              Start a Build
            </button>
            <button
              onClick={() => setActivePage('upgrade')}
              className="bg-[#0b0f19] text-slate-200 border border-[#1f293d] hover:border-slate-500 px-4 py-2.5 rounded-md text-xs font-bold uppercase"
            >
              Check an Upgrade
            </button>
            <button
              onClick={() => setActivePage('products')}
              className="bg-[#0b0f19] text-slate-200 border border-[#1f293d] hover:border-slate-500 px-4 py-2.5 rounded-md text-xs font-bold uppercase"
            >
              Explore Catalog
            </button>
          </div>

          <p className="text-xs text-slate-500 mt-5 font-mono">
            {availableActiveCount} In-Stock Parts · {preorderProducts.length} Pre-Order Items · {referenceParts.length} Reference Parts
          </p>
        </section>

        <section className="space-y-2.5">
          <div>
            <h3 className="text-sm font-bold text-white">Where Would You Like to Start?</h3>
            <p className="text-xs text-slate-400">Choose what fits your goal today—no technical background required.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {entryPaths.map((path) => (
              <div
                key={path.title}
                className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 flex flex-col justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 block">
                    {path.label}
                  </span>
                  <h4 className="text-sm font-bold text-white">{path.title}</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">{path.desc}</p>
                </div>
                <button
                  type="button"
                  onClick={path.onClick}
                  className="w-full py-2 px-3 rounded bg-[#0b0f19] hover:bg-blue-600 border border-[#1f293d] hover:border-blue-500 text-xs font-bold text-white transition-colors"
                >
                  {path.cta}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-1">
            <span className="text-[10px] font-bold uppercase text-emerald-400 font-mono">Built-In Checks</span>
            <h4 className="text-sm font-bold text-white">No Mismatched Parts</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Automatically checks sockets, memory types, display output, and case clearances before you finalize anything.
            </p>
          </div>
          <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-1">
            <span className="text-[10px] font-bold uppercase text-blue-400 font-mono">Power & Value</span>
            <h4 className="text-sm font-bold text-white">Honest, Balanced Advice</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Estimates wattage and PSU safety headroom while keeping recommendations practical for your budget.
            </p>
          </div>
          <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-1">
            <span className="text-[10px] font-bold uppercase text-amber-300 font-mono">Ready to Share</span>
            <h4 className="text-sm font-bold text-white">Save or Export Quotes</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Save builds to your account or export a clean summary with transparent pricing whenever you need it.
            </p>
          </div>
        </section>

        <div className="space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
            Or Jump Straight Into a Component Category
          </span>
          {renderCategoryNavStrip()}
        </div>
      </div>
    );
  };

  const renderBuilderPage = () => {
    const focusScoreLabel =
      compatibilityScore === null
        ? 'Not enough data'
        : `Score ${compatibilityScore}% (${verificationCoverage.verified}/${verificationCoverage.total} verified)`;

    if (buildFocused) {
      return (
        <section id="build-focus" ref={focusViewRef} className="max-w-5xl mx-auto space-y-5">
          <div className="bg-[#111827] border border-blue-500/40 rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
            <div className="text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 block">
                Build Focus Mode
              </span>
              <h2 className="text-sm font-black text-white">
                {selectedItems.length}/{CATEGORIES.length} Components Selected · {focusScoreLabel} · Total: {peso(totalPrice)}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isBuildIncomplete && (
                <span className="text-[10px] px-2.5 py-1 rounded bg-amber-950 text-amber-300 font-bold">
                  {incompleteBadgeText}
                </span>
              )}
              {hasAnyUnverifiedPart && (
                <span className="text-[10px] px-2.5 py-1 rounded bg-amber-950 text-amber-300 font-bold">
                  unverified
                </span>
              )}
              <button
                type="button"
                onClick={() => setBuildFocused(false)}
                className="px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase"
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
        <aside className="hidden lg:block lg:col-span-4 space-y-2.5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto pr-1">
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
            className={`flex-1 py-2 px-3 rounded text-xs font-bold ${
              upgradeMode === 'reference' ? 'bg-blue-600 text-white' : 'bg-[#0b0f19] text-slate-400'
            }`}
          >
            1. Select Current Hardware
          </button>
          <button
            onClick={() => setUpgradeMode('shop')}
            className={`flex-1 py-2 px-3 rounded text-xs font-bold ${
              upgradeMode === 'shop' ? 'bg-blue-600 text-white' : 'bg-[#0b0f19] text-slate-400'
            }`}
          >
            2. Choose Shop Upgrades
          </button>
          <button
            type="button"
            onClick={() => setCustomModalOpen(true)}
            className="py-2 px-3 rounded bg-amber-600/20 border border-amber-500/40 text-amber-300 text-xs font-bold"
          >
            + Custom Owned Part
          </button>
        </div>
        {renderRationaleAndCompareCards()}
        {renderCategoryNavStrip()}
        {renderCatalogList(activeTab)}
      </div>
      <aside className="hidden lg:block lg:col-span-4 space-y-2.5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto pr-1">
        <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 text-left">
          <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-[#1f293d]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Your Current Rig</h4>
            <button onClick={handleClearExistingPc} className="text-[11px] text-slate-500 hover:text-white">
              Reset
            </button>
          </div>
          <div className="space-y-1">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="p-1.5 rounded bg-[#0b0f19] border border-[#1f293d] text-xs flex justify-between items-center gap-2">
                <span className="text-slate-500 text-[10px]">{getCategoryLabel(cat)}</span>
                <span className="text-white font-semibold truncate max-w-[160px]">
                  {existingPc[cat]?.name || 'Not set'}
                </span>
                {cat === 'Memory' && existingPc[cat] && (
                  <button
                    type="button"
                    onClick={() => setExistingRamCount((c) => (c === 2 ? 1 : 2))}
                    className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[9px] font-mono"
                  >
                    {existingRamCount}x
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        {renderBuildSummary(false)}
        {renderRecommendationPanel()}
      </aside>
    </section>
  );

  const renderOcrLabPanel = () => (
    <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-3 text-xs">
      <div className="flex justify-between items-center border-b border-[#1f293d] pb-2">
        <div>
          <span className="text-[10px] font-bold uppercase text-blue-400">Admin OCR Lab</span>
          <h4 className="text-sm font-bold text-white">Ground-Truth Accuracy & CSV Export</h4>
        </div>
        {ocrLabMetrics && (
          <button
            type="button"
            onClick={handleExportOcrLabCsv}
            className="px-3 py-1 rounded bg-emerald-600 text-white font-bold"
          >
            Export CSV
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-slate-400 block mb-1">Ground-Truth Text (one item per line)</label>
          <textarea
            rows={4}
            value={ocrLabTruth}
            onChange={(e) => setOcrLabTruth(e.target.value)}
            className="w-full bg-[#0b0f19] border border-[#1f293d] rounded p-2 text-white"
          />
        </div>
        <div>
          <label className="text-slate-400 block mb-1">Test Image</label>
          <input type="file" accept="image/*" onChange={handleRunOcrLabImage} className="text-slate-300" />
          {ocrLabRunning && <p className="text-blue-400 mt-1">Running OCR Lab...</p>}
          {ocrLabMetrics && (
            <div className="mt-2 p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] space-y-1 font-mono">
              <p>Char Accuracy: {ocrLabMetrics.charAccuracy}%</p>
              <p>
                Line Match Rate: {ocrLabMetrics.lineMatchRate}% ({ocrLabMetrics.matchedLineCount}/
                {ocrLabMetrics.truthLinesCount})
              </p>
            </div>
          )}
        </div>
      </div>

      {ocrLabOutput && (
        <pre className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] text-slate-300 whitespace-pre-wrap">
          {ocrLabOutput}
        </pre>
      )}
    </div>
  );

  const renderAdminPage = () => {
    if (!canAccessAdmin) {
      return (
        <div className="max-w-md mx-auto bg-[#111827] border border-[#1f293d] rounded-lg p-6 text-left">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
              Restricted Staff Portal
            </span>
            <button onClick={() => setActivePage('home')} className="text-xs text-slate-500 hover:text-white">
              ← Exit
            </button>
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Administrator Console Lock</h3>
          <p className="text-xs text-slate-400 mb-4">
            {ADMIN_PIN
              ? 'Enter the configured workshop admin PIN or sign in with an authorized admin account.'
              : 'No PIN configured; sign in with an authorized administrator email account to access this console.'}
          </p>

          {ADMIN_PIN && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (adminPinInput === ADMIN_PIN) {
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
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-2 text-xs text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-xs font-bold uppercase"
              >
                Unlock Console
              </button>
            </form>
          )}
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
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              ByteBuild System Administrator Console
            </span>
            <h2 className="text-xl font-black text-white mt-0.5">
              Catalog, Reference DB, DSS Rules & Quotations
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'catalog', label: `Catalog (${activeProducts.length + preorderProducts.length})` },
              { id: 'reference', label: `Reference DB (${referenceParts.length})` },
              { id: 'rules', label: 'DSS Rules' },
              { id: 'quotations', label: 'Quotations' },
              { id: 'ocrlab', label: 'OCR Lab' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setAdminSection(tab.id)}
                className={`px-3 py-1.5 rounded text-xs font-bold ${
                  adminSection === tab.id ? 'bg-blue-600 text-white' : 'bg-[#0b0f19] text-slate-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              onClick={handleAdminLogout}
              className="px-3 py-1.5 rounded bg-red-950 text-red-300 text-xs font-bold uppercase"
            >
              Lock & Exit
            </button>
          </div>
        </div>

        {(adminSection === 'catalog' || adminSection === 'reference') && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-2.5 text-xs">
              <h3 className="text-sm font-bold text-white">
                {adminSection === 'reference' ? 'Add Reference Component' : 'Add Catalog Component'}
              </h3>
              <form
                onSubmit={(e) =>
                  handleAdminAddItem(e, adminSection === 'reference' ? 'reference' : 'catalog')
                }
                className="space-y-2"
              >
                <input
                  type="text"
                  required
                  value={newItemForm.name}
                  onChange={(e) => setNewItemForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Component Name *"
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newItemForm.brand}
                    onChange={(e) => setNewItemForm((p) => ({ ...p, brand: e.target.value }))}
                    placeholder="Brand"
                    className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                  />
                  <select
                    value={newItemForm.category}
                    onChange={(e) => setNewItemForm((p) => ({ ...p, category: e.target.value }))}
                    className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                {adminSection === 'catalog' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      required
                      value={newItemForm.price}
                      onChange={(e) => setNewItemForm((p) => ({ ...p, price: e.target.value }))}
                      placeholder="Retail Price (PHP) *"
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                    />
                    <select
                      value={newItemForm.stock_status}
                      onChange={(e) => setNewItemForm((p) => ({ ...p, stock_status: e.target.value }))}
                      className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                    >
                      <option value="In Stock">In Stock</option>
                      <option value="Pre-Order">Pre-Order</option>
                      <option value="Sold Out">Sold Out</option>
                    </select>
                  </div>
                )}
                <textarea
                  rows={2}
                  value={newItemForm.specs}
                  onChange={(e) => setNewItemForm((p) => ({ ...p, specs: e.target.value }))}
                  placeholder="Specs..."
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                />
                <button
                  type="submit"
                  disabled={adminSaving}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded font-bold uppercase"
                >
                  {adminSaving ? 'Saving...' : '+ Insert Record'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-8 bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#1f293d]">
                <div className="flex items-center gap-2">
                  {adminSection === 'catalog' && (
                    <div className="flex bg-[#0b0f19] p-1 rounded border border-[#1f293d]">
                      <button
                        type="button"
                        onClick={() => setAdminTableSource('active')}
                        className={`px-2 py-1 rounded font-bold ${
                          adminTableSource === 'active' ? 'bg-blue-600 text-white' : 'text-slate-400'
                        }`}
                      >
                        Active ({activeProducts.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminTableSource('preorder')}
                        className={`px-2 py-1 rounded font-bold ${
                          adminTableSource === 'preorder' ? 'bg-blue-600 text-white' : 'text-slate-400'
                        }`}
                      >
                        Pre-Order ({preorderProducts.length})
                      </button>
                    </div>
                  )}
                  <select
                    value={adminCategoryFilter}
                    onChange={(e) => setAdminCategoryFilter(e.target.value)}
                    className="bg-[#0b0f19] border border-[#1f293d] rounded px-2 py-1 text-white"
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
                  placeholder="Filter records..."
                  value={adminSearch}
                  onChange={(e) => setAdminSearch(e.target.value)}
                  className="bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1 text-white"
                />
              </div>
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {filteredAdminItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-white truncate">{item.name}</p>
                      <p className="text-[10px] text-slate-400">{item.category}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {adminSection === 'catalog' && (
                        <select
                          value={item.stock_status || 'In Stock'}
                          onChange={(e) =>
                            handleAdminQuickStatusToggle(item, currentAdminTableName, e.target.value)
                          }
                          className="bg-[#111827] border border-[#1f293d] rounded px-1.5 py-1 text-[10px] text-white"
                        >
                          <option value="In Stock">In Stock</option>
                          <option value="Pre-Order">Pre-Order</option>
                          <option value="Sold Out">Sold Out</option>
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingItem({ ...item, _table: currentAdminTableName })}
                        className="px-2 py-1 rounded bg-blue-600/20 text-blue-300 font-bold"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdminDeleteItem(item, currentAdminTableName)}
                        className="px-2 py-1 text-slate-500 hover:text-red-400 font-bold"
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
          <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-5 max-w-2xl space-y-4 text-xs">
            <h3 className="text-base font-bold text-white">DSS Rules & Shared Settings</h3>
            {settingsNotice && <p className="text-amber-300">{settingsNotice}</p>}
            <form onSubmit={handleSaveDssRules} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1">PSU Headroom Buffer (W)</label>
                <input
                  type="number"
                  value={dssRules.psuBufferWatts}
                  onChange={(e) => setDssRules((r) => ({ ...r, psuBufferWatts: e.target.value }))}
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Min Recommended RAM (GB)</label>
                <input
                  type="number"
                  value={dssRules.minRecommendedRamGB}
                  onChange={(e) => setDssRules((r) => ({ ...r, minRecommendedRamGB: e.target.value }))}
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Min Storage Baseline (GB)</label>
                <input
                  type="number"
                  value={dssRules.minStorageCapacityGB}
                  onChange={(e) => setDssRules((r) => ({ ...r, minStorageCapacityGB: e.target.value }))}
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Max Tier Gap</label>
                <input
                  type="number"
                  value={dssRules.maxAllowedTierGap}
                  onChange={(e) => setDssRules((r) => ({ ...r, maxAllowedTierGap: e.target.value }))}
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
              <div className="sm:col-span-2 flex gap-2 pt-2">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold uppercase"
                >
                  Save Rules
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDssRules(DEFAULT_DSS_RULES);
                    localStorage.removeItem('bytebuild_dss_rules');
                  }}
                  className="px-4 py-2 rounded bg-[#1f293d] text-slate-300 font-bold"
                >
                  Reset Defaults
                </button>
              </div>
            </form>
          </div>
        )}

        {adminSection === 'quotations' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-bold text-white">Quotations ({adminQuotations.length})</h3>
              {adminQuotations.map((q) => (
                <div key={q.id} className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] flex justify-between">
                  <span className="font-mono text-blue-400">{q.reference_code}</span>
                  <span className="font-mono text-emerald-400">{peso(q.total_price)}</span>
                </div>
              ))}
            </div>
            <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-bold text-white">Pre-Orders ({adminAllPreorders.length})</h3>
              {adminAllPreorders.map((ord) => (
                <div key={ord.id} className="p-2.5 rounded bg-[#0b0f19] border border-[#1f293d] flex justify-between items-center">
                  <span>{ord.product_name}</span>
                  <select
                    value={ord.status || 'Pending Supplier Confirmation'}
                    onChange={(e) => handleAdminUpdatePreorderStatus(ord.id, e.target.value)}
                    className="bg-[#111827] border border-[#1f293d] rounded px-2 py-1 text-[10px] text-white"
                  >
                    <option value="Pending Supplier Confirmation">Pending Supplier</option>
                    <option value="Allocation Confirmed">Allocation Confirmed</option>
                    <option value="Ready for Pickup">Ready for Pickup</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {adminSection === 'ocrlab' && renderOcrLabPanel()}

        {editingItem && (
          <div className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4">
            <div className="bg-[#111827] border border-[#1f293d] max-w-md w-full rounded-lg p-5 text-xs space-y-3">
              <h4 className="text-sm font-bold text-white">Edit Record</h4>
              <form onSubmit={handleAdminSaveEdit} className="space-y-2.5">
                <input
                  type="text"
                  required
                  value={editingItem.name || ''}
                  onChange={(e) => setEditingItem((p) => ({ ...p, name: e.target.value }))}
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                />
                {editingItem._table !== REFERENCE_TABLE && (
                  <input
                    type="number"
                    value={editingItem.price || 0}
                    onChange={(e) => setEditingItem((p) => ({ ...p, price: e.target.value }))}
                    className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
                  />
                )}
                <textarea
                  rows={2}
                  value={editingItem.specs || ''}
                  onChange={(e) => setEditingItem((p) => ({ ...p, specs: e.target.value }))}
                  className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
                />
                <div className="flex gap-2">
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
                    className="flex-1 py-1.5 rounded bg-blue-600 text-white font-bold uppercase"
                  >
                    Update
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
              <span className="text-[10px] font-bold uppercase text-emerald-400">Authenticated Account</span>
              <h3 className="text-lg font-bold text-white">{currentUser.email}</h3>
            </div>
            <button
              onClick={handleSignOut}
              className="px-3 py-1.5 border border-red-500/40 text-red-400 rounded text-xs font-bold"
            >
              Sign Out
            </button>
          </div>
          <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-5">
            <h4 className="text-sm font-bold uppercase text-slate-400 mb-3">
              Saved Builds ({savedBuilds.length})
            </h4>
            {savedBuilds.map((b) => (
              <div key={b.id} className="p-3 rounded bg-[#0b0f19] border border-[#1f293d] flex justify-between items-center mb-2">
                <div>
                  <p className="text-sm font-bold text-white">{b.build_name}</p>
                  <p className="text-xs font-mono text-emerald-400">{peso(b.total_price)}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleLoadSavedBuild(b)} className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-bold">
                    Load
                  </button>
                  <button onClick={() => handleDeleteSavedBuild(b.id)} className="px-2.5 py-1 text-slate-500 hover:text-red-400 text-xs">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (authMode === 'update-password') {
      return (
        <div className="max-w-md mx-auto bg-[#111827] border border-[#1f293d] rounded-lg p-6 text-left">
          <h3 className="text-lg font-bold text-white mb-3">Set New Password</h3>
          {authError && <p className="text-xs text-red-400 mb-2">{authError}</p>}
          <form onSubmit={handleUpdatePassword} className="space-y-3">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-2 pr-14 text-xs text-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400 hover:text-white"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <button type="submit" disabled={authLoading} className="w-full bg-blue-600 text-white py-2 rounded text-xs font-bold uppercase">
              Update Password
            </button>
          </form>
        </div>
      );
    }

    if (authMode === 'forgot-password') {
      return (
        <div className="max-w-md mx-auto bg-[#111827] border border-[#1f293d] rounded-lg p-6 text-left">
          <h3 className="text-lg font-bold text-white mb-3">Reset Password</h3>
          {forgotEmailSent ? (
            <p className="text-xs text-emerald-300">Recovery email sent.</p>
          ) : (
            <form onSubmit={handlePasswordReset} className="space-y-3">
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="Email"
                className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-2 text-xs text-white"
              />
              <button type="submit" disabled={authLoading} className="w-full bg-blue-600 text-white py-2 rounded text-xs font-bold uppercase">
                Send Recovery Email
              </button>
            </form>
          )}
        </div>
      );
    }

    return (
      <div className="max-w-md mx-auto bg-[#111827] border border-[#1f293d] rounded-lg p-6 text-left">
        <h3 className="text-lg font-bold text-white mb-1">{authMode === 'login' ? 'Sign In' : 'Register'}</h3>
        {authError && <p className="text-xs text-red-400 mb-2">{authError}</p>}
        <form onSubmit={handleAuthSubmit} className="space-y-3">
          <input
            type="email"
            required
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            placeholder="Email"
            className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-2 text-xs text-white"
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-2 pr-14 text-xs text-white"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400 hover:text-white"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <button type="submit" disabled={authLoading} className="w-full bg-blue-600 text-white py-2 rounded text-xs font-bold uppercase">
            {authLoading ? 'Verifying...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
        <div className="mt-3 flex justify-between text-xs">
          <button
            type="button"
            onClick={() => {
              setShowPassword(false);
              setAuthMode(authMode === 'login' ? 'register' : 'login');
            }}
            className="text-blue-400 hover:underline"
          >
            {authMode === 'login' ? 'Need an account? Register' : 'Have an account? Sign In'}
          </button>
          {authMode === 'login' && (
            <button
              type="button"
              onClick={() => {
                setShowPassword(false);
                setAuthMode('forgot-password');
              }}
              className="text-slate-400 hover:text-white"
            >
              Forgot password?
            </button>
          )}
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
      <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
        <div className="bg-[#111827] border border-[#1f293d] max-w-xl w-full rounded-lg p-5 text-left text-white space-y-3">
          <div className="flex justify-between items-start border-b border-[#1f293d] pb-2.5">
            <div>
              <span className="text-[10px] font-bold uppercase text-blue-400">
                {getCategoryLabel(product.category)}
              </span>
              <h3 className="text-base font-bold text-white">{product.name}</h3>
            </div>
            <button onClick={() => setSelectedProduct(null)} className="text-slate-400 hover:text-white font-bold text-lg">
              ×
            </button>
          </div>
          <p className="text-xs text-slate-300">
            {product.specs ||
              (normalizeText(product.category) === 'memory'
                ? `${ramInfo.stickCount}x ${ramInfo.perStickCapacity || ''}GB`
                : `SPL Tier ${psu.tier} · Score ${product.hardware_score || 75}/100`)}
          </p>
          {learnUrl && (
            <a href={learnUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-blue-400 underline">
              Learn More →
            </a>
          )}
        </div>
      </div>
    );
  };

  const renderCustomPartModal = () => {
    if (!customModalOpen) return null;
    return (
      <div className="fixed inset-0 bg-black/80 z-[115] flex items-center justify-center p-4">
        <div className="bg-[#111827] border border-[#1f293d] max-w-md w-full rounded-lg p-5 text-left text-white">
          <h3 className="text-base font-bold mb-3">Add Custom Current Part</h3>
          <form onSubmit={handleAddCustomPart} className="space-y-2.5 text-xs">
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
            <input
              type="text"
              required
              value={customPartForm.name}
              onChange={(e) => setCustomPartForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Part name *"
              className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={customPartForm.socket}
                onChange={(e) => setCustomPartForm((p) => ({ ...p, socket: e.target.value }))}
                placeholder="Socket (AM4/AM5/LGA1700)"
                className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white"
              />
              <input
                type="number"
                value={customPartForm.wattage}
                onChange={(e) => setCustomPartForm((p) => ({ ...p, wattage: e.target.value }))}
                placeholder="Wattage (W)"
                className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-2.5 py-1.5 text-white font-mono"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCustomModalOpen(false)}
                className="flex-1 py-1.5 rounded border border-[#1f293d] text-slate-300"
              >
                Cancel
              </button>
              <button type="submit" className="flex-1 py-1.5 rounded bg-amber-600 text-white font-bold uppercase">
                Save Part
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
      <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4">
        <div className="bg-[#111827] border border-[#1f293d] max-w-md w-full rounded-lg p-5 text-left text-white">
          <h3 className="text-base font-bold mb-2">Pre-Order: {preorderModalItem.name}</h3>
          <form onSubmit={handlePreorderSubmit} className="space-y-3 text-xs">
            <input
              type="text"
              required
              value={preorderForm.customer_name}
              onChange={(e) => setPreorderForm((p) => ({ ...p, customer_name: e.target.value }))}
              placeholder="Full Name"
              className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-white"
            />
            <input
              type="tel"
              required
              value={preorderForm.contact_number}
              onChange={(e) => setPreorderForm((p) => ({ ...p, contact_number: e.target.value }))}
              placeholder="Contact Number"
              className="w-full bg-[#0b0f19] border border-[#1f293d] rounded px-3 py-1.5 text-white"
            />
            <label className="flex items-start gap-2 text-[10px] text-slate-400">
              <input
                type="checkbox"
                checked={preorderForm.consent}
                onChange={(e) => setPreorderForm((p) => ({ ...p, consent: e.target.checked }))}
                className="mt-0.5"
              />
              <span>I agree to the Data Privacy Notice (RA 10173) for pre-order processing.</span>
            </label>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPreorderModalItem(null)}
                className="flex-1 py-1.5 rounded border border-[#1f293d] text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={preorderSubmitting}
                className="flex-1 py-1.5 rounded bg-blue-600 text-white font-bold uppercase"
              >
                {preorderSubmitting ? 'Logging...' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const renderPrivacyModal = () => {
    if (!privacyModalOpen) return null;
    return (
      <div className="fixed inset-0 bg-black/80 z-[130] flex items-center justify-center p-4">
        <div className="bg-[#111827] border border-[#1f293d] max-w-lg w-full rounded-lg p-5 text-left text-white space-y-3">
          <div className="flex justify-between items-center border-b border-[#1f293d] pb-2">
            <h3 className="text-sm font-bold">Data Privacy Notice (RA 10173)</h3>
            <button onClick={() => setPrivacyModalOpen(false)} className="text-slate-400 hover:text-white font-bold">
              ×
            </button>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{PRIVACY_NOTICE_TEXT}</p>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0f19] text-white flex items-center justify-center">
        <p className="text-xs text-slate-400 font-mono">Loading ByteBuild Hardware Inventory...</p>
      </div>
    );
  }

  return (
    <>
      <ByteBuildGlobalStyles />
      <div className="min-h-screen bg-[#0b0f19] text-slate-200 flex flex-col">
        <header className="border-b border-[#1f293d] bg-[#111827]/95 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 h-20 flex items-center justify-between gap-3">
            <button onClick={handleLogoClick} className="flex items-center gap-3.5 text-left shrink-0">
              <img
                src={bbLogo}
                alt="ByteBuild Logo"
                className="h-16 sm:h-[4.25rem] w-auto shrink-0 object-contain scale-115 origin-left brightness-125 contrast-125 drop-shadow-[0_2px_8px_rgba(255,255,255,0.2)]"
              />
              <div className="pl-1.5">
                <span className="text-lg font-black text-white uppercase block leading-none tracking-wide">
                  BYTEBUILD
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">Guided PC Builder</span>
              </div>
            </button>

            <nav className="hidden md:flex items-center gap-1.5">
              {['home', 'products', 'builder', 'upgrade', ...(canAccessAdmin ? ['admin'] : [])].map((page) => (
                <button
                  key={page}
                  onClick={() => setActivePage(page)}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-bold uppercase ${
                    activePage === page ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {page === 'products' ? 'Inventory' : page === 'admin' ? 'Admin Console' : page}
                </button>
              ))}
            </nav>

            <button
              onClick={() => setActivePage('login')}
              className="px-3.5 py-1.5 rounded-md bg-[#1f293d] text-xs font-bold text-white"
            >
              {currentUser ? currentUser.email.split('@')[0] : 'Sign In'}
            </button>
          </div>
        </header>

        {bannerNotice && (
          <div className="max-w-7xl w-full mx-auto px-3 sm:px-4 pt-3 print:hidden">
            <div className="p-3 rounded-lg bg-slate-900 border border-amber-600/50 text-xs text-amber-200 flex items-center justify-between gap-3">
              <span>
                {bannerNotice.message} {offlineMode ? '(Offline / using cached data)' : ''}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {typeof bannerNotice.onRetry === 'function' && (
                  <button
                    type="button"
                    onClick={bannerNotice.onRetry}
                    className="px-2.5 py-1 rounded bg-blue-600 text-white font-bold"
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBannerNotice(null)}
                  className="text-slate-400 hover:text-white font-bold"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        )}

        <main key={activePage} className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 py-5 pb-24 lg:pb-8">
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

        <footer className="border-t border-[#1f293d] bg-[#111827] py-3 px-4 text-[11px] text-slate-400 print:hidden">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>ByteBuild Decision Support System · RA 10173 Data Privacy Notice</span>
            <button type="button" onClick={() => setPrivacyModalOpen(true)} className="text-blue-400 underline">
              Privacy & Deletion Info
            </button>
          </div>
        </footer>
      </div>

      {renderFloatingMobileBar()}
      {renderMobileManifestDrawer()}
      {renderCustomPartModal()}
      {renderProductModal()}
      {renderPreorderModal()}
      {renderPrivacyModal()}
    </>
  );
}