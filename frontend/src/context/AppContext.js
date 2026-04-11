import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const AppContext = createContext(null);

const STORAGE_KEY_CONFIG = 'heimdall_config';
const STORAGE_KEY_USERNAME = 'heimdall_username';
const STORAGE_KEY_ENVS = 'heimdall_envs';
const STORAGE_KEY_ACTIVE_ENV = 'heimdall_active_env';
const STORAGE_KEY_ONBOARDED = 'heimdall_onboarded';
const STORAGE_KEY_LLM = 'heimdall_llm';
const TOAST_TIMEOUT = 4500;

// Bump this when you add new tour steps or want the welcome tour to
// auto-show once to returning users. The storage key stores the version
// the user last saw; if it doesn't match APP_TOUR_VERSION, the tour
// auto-opens on next load.
// 2.0 → 2.1: replaced OnboardingModal with interactive UserTour dock
// 2.1 → 2.2: added spotlight + auto-navigation per step
// 2.2 → 3.0: project renamed GrafanaProbe → Heimdall
export const APP_TOUR_VERSION = '3.0';

// One-time migration: copy localStorage values from the old grafanaprobe_*
// / grafana_probe_* namespace into the new heimdall_* namespace so users
// who already configured DEV/PERF/PROD, LLM keys, or completed the tour
// don't lose their state after the rename. Runs once per browser, then
// deletes the old keys and sets a sentinel to skip on subsequent loads.
function migrateLegacyLocalStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    if (localStorage.getItem('heimdall_migrated_from_grafanaprobe') === '1') return;
    const map = {
      grafanaprobe_config: STORAGE_KEY_CONFIG,
      grafanaprobe_username: STORAGE_KEY_USERNAME,
      grafanaprobe_onboarded: STORAGE_KEY_ONBOARDED,
      grafana_probe_envs: STORAGE_KEY_ENVS,
      grafana_probe_active_env: STORAGE_KEY_ACTIVE_ENV,
      grafana_probe_llm: STORAGE_KEY_LLM,
    };
    for (const [oldKey, newKey] of Object.entries(map)) {
      const v = localStorage.getItem(oldKey);
      if (v != null && localStorage.getItem(newKey) == null) {
        localStorage.setItem(newKey, v);
      }
      if (v != null) localStorage.removeItem(oldKey);
    }
    localStorage.setItem('heimdall_migrated_from_grafanaprobe', '1');
  } catch { /* ignore */ }
}
migrateLegacyLocalStorage();

export const DEFAULT_ENVS = [
  { key: 'DEV', label: 'DEV', color: '#22d3ee', url: '', token: '' },
  { key: 'PERF', label: 'PERF', color: '#eab308', url: '', token: '' },
  { key: 'PROD', label: 'PROD', color: '#ef4444', url: '', token: '' },
];

let toastIdCounter = 0;

export function AppProvider({ children }) {
  // --- Config (persisted to localStorage) ---
  const [config, setConfigState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CONFIG);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const setConfig = useCallback((updater) => {
    setConfigState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(next));
      } catch {
        // storage full or unavailable — silently ignore
      }
      return next;
    });
  }, []);

  // --- User name (persisted to localStorage) ---
  const [userName, setUserNameState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_USERNAME) || '';
    } catch {
      return '';
    }
  });

  const setUserName = useCallback((name) => {
    setUserNameState(name);
    try {
      localStorage.setItem(STORAGE_KEY_USERNAME, name);
    } catch {
      // ignore
    }
  }, []);

  // --- Environments (shared with Settings page) ---
  const [envs, setEnvsState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_ENVS);
      return stored ? JSON.parse(stored) : DEFAULT_ENVS;
    } catch {
      return DEFAULT_ENVS;
    }
  });

  const setEnvs = useCallback((updater) => {
    setEnvsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem(STORAGE_KEY_ENVS, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // --- Active environment key ---
  const [activeEnvKey, setActiveEnvKeyState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY_ACTIVE_ENV) || ''; } catch { return ''; }
  });

  const setActiveEnvKey = useCallback((key) => {
    setActiveEnvKeyState(key || '');
    try {
      if (key) localStorage.setItem(STORAGE_KEY_ACTIVE_ENV, key);
      else localStorage.removeItem(STORAGE_KEY_ACTIVE_ENV);
    } catch {}
  }, []);

  const activeEnv = envs.find((e) => e.key === activeEnvKey) || null;

  // --- Onboarding / Welcome Tour ---
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      const seenVersion = localStorage.getItem(STORAGE_KEY_ONBOARDED);
      return seenVersion !== APP_TOUR_VERSION;
    } catch {
      return true;
    }
  });

  const openOnboarding = useCallback(() => setShowOnboarding(true), []);
  const closeOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try { localStorage.setItem(STORAGE_KEY_ONBOARDED, APP_TOUR_VERSION); } catch {}
  }, []);

  // --- Toasts ---
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }, []);

  const addToast = useCallback((message, type = 'info') => {
    const id = ++toastIdCounter;
    const toast = { id, message, type };
    setToasts((prev) => [...prev, toast]);

    timersRef.current[id] = setTimeout(() => {
      removeToast(id);
    }, TOAST_TIMEOUT + 300); // allow exit animation to complete

    return id;
  }, [removeToast]);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const value = {
    config,
    setConfig,
    toasts,
    addToast,
    removeToast,
    userName,
    setUserName,
    envs,
    setEnvs,
    activeEnvKey,
    setActiveEnvKey,
    activeEnv,
    showOnboarding,
    openOnboarding,
    closeOnboarding,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}

/**
 * Returns the currently-selected environment's credentials, or nulls.
 * Use this in any page that makes Grafana-bound API calls.
 */
export function useActiveEnv() {
  const { activeEnv } = useApp();
  return {
    env: activeEnv,
    grafanaUrl: activeEnv?.url || '',
    token: activeEnv?.token || '',
    label: activeEnv?.label || '',
    color: activeEnv?.color || '',
    isConfigured: Boolean(activeEnv && activeEnv.url),
  };
}

export default AppContext;
