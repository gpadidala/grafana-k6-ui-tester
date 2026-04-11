import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/* ──────────────────────────────────────────────────────────────
   Tour content — each step can optionally highlight a DOM
   element by setting `target` to a CSS selector. The tour
   auto-navigates to `route` first (if the current page differs)
   then waits for the target to render before spotlighting it.
   ────────────────────────────────────────────────────────────── */
const TOUR_STEPS = [
  {
    icon: '👋',
    title: 'Welcome to Heimdall',
    body: (
      <>
        <p>A complete testing platform for your Grafana stack — K6 API tests, Playwright E2E, JMeter performance, AI-generated tests, and upgrade-drift detection all in one app.</p>
        <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 10 }}>This guided tour will show and tell every feature in under 2 minutes. I'll highlight each part of the app as we go. Click <strong>Next</strong> to start.</p>
      </>
    ),
  },
  {
    icon: '🌐',
    title: 'Pick your target environment',
    body: (
      <>
        <p>Every test, snapshot, and AI run targets a specific environment. Pick <strong style={{ color: '#22d3ee' }}>DEV</strong>, <strong style={{ color: '#eab308' }}>PERF</strong>, or <strong style={{ color: '#ef4444' }}>PROD</strong> from these pills.</p>
        <p style={{ color: '#94a3b8', fontSize: 12 }}>Each env has its own URL and API token — configure them in Settings. The active env drives K6, Playwright, JMeter, AI Tests, and Snapshots.</p>
      </>
    ),
    target: '[data-tour="env-pills"]',
    route: '/',
  },
  {
    icon: '📊',
    title: 'Dashboard — your command center',
    body: (
      <>
        <p>The home page gives you a quick overview — latest run pass rate, summary stats, and one-click access to every test category.</p>
        <p style={{ color: '#94a3b8', fontSize: 12 }}>Click <strong>▶ Run</strong> on any category card to jump straight into Run Tests with just that category pre-selected.</p>
      </>
    ),
    target: '[data-tour="dashboard-page"]',
    route: '/',
  },
  {
    icon: '🧠',
    title: 'AI Tests — describe, review, run',
    body: (
      <>
        <p>Type what you want to test in plain English — Claude or GPT converts it into a safe, read-only test plan using a whitelisted action vocabulary.</p>
        <p style={{ color: '#94a3b8', fontSize: 12 }}>Review the plan, edit the JSON if needed, click Approve & Run, and get AI-explained results. 5 Smart Suite templates ship out of the box.</p>
      </>
    ),
    target: '[data-tour="ai-tests-page"]',
    route: '/ai-tests',
  },
  {
    icon: '▶️',
    title: 'Run Tests — three engines in one',
    body: (
      <>
        <p><strong>K6 API</strong> (22 categories), <strong>Playwright E2E</strong> (12 suites), and <strong>JMeter</strong> (18 load plans) — switch between them with the tabs.</p>
        <p style={{ color: '#94a3b8', fontSize: 12 }}>Failures link back to the specific Grafana resource so you can verify fixes live.</p>
      </>
    ),
    target: '[data-tour="run-tests-page"]',
    route: '/run',
  },
  {
    icon: '🗄',
    title: 'Scope by Datasource',
    body: (
      <>
        <p>Testing the blast radius of an exporter upgrade? Pick a datasource here and the test run will only touch dashboards and alerts that reference it.</p>
        <p style={{ color: '#a5b4fc', fontSize: 12, marginTop: 10 }}>💡 Works across K6, Playwright, AND JMeter. Preview shows exactly how many dashboards + alerts will be tested before you click Run.</p>
      </>
    ),
    target: '[data-tour="ds-scope"]',
    route: '/run',
  },
  {
    icon: '📸',
    title: 'Snapshots — time-machine for Grafana',
    body: (
      <>
        <p>Capture every dashboard JSON, alert rule, and contact point into a local gzipped archive. Compare any two snapshots to see exactly what changed.</p>
        <p style={{ color: '#94a3b8', fontSize: 12 }}>Each change is risk-rated (critical / high / medium / low) with a unified diff view and clickable Grafana links for quick verification.</p>
      </>
    ),
    target: '[data-tour="snapshots-page"]',
    route: '/snapshots',
  },
  {
    icon: '📋',
    title: 'Reports — full history, clickable failures',
    body: (
      <>
        <p>Every test run is persisted. Click 📄 <strong>HTML</strong> on any report for a branded standalone page, and every failing row links back to the Grafana resource where the issue occurred.</p>
        <p style={{ color: '#94a3b8', fontSize: 12 }}>Retention is configurable — the last N runs per environment are kept automatically.</p>
      </>
    ),
    target: '[data-tour="reports-page"]',
    route: '/reports',
  },
  {
    icon: '🔍',
    title: 'Compare — baseline vs current',
    body: (
      <>
        <p>Compare any two test runs side by side. See which checks regressed, which improved, and which new failures appeared after a deployment.</p>
      </>
    ),
    target: '[data-tour="compare-page"]',
    route: '/compare',
  },
  {
    icon: '⚙️',
    title: 'Settings — one place for everything',
    body: (
      <>
        <p><strong>Environments:</strong> DEV / PERF / PROD URLs, tokens, test connection</p>
        <p><strong>Retention:</strong> how many runs to keep per env</p>
        <p><strong>LLM:</strong> OpenAI or Claude API keys</p>
        <p><strong>Welcome Tour:</strong> re-open this tour anytime</p>
      </>
    ),
    target: '[data-tour="settings-page"]',
    route: '/settings',
  },
  {
    icon: '❓',
    title: 'Reopen the tour anytime',
    body: (
      <>
        <p>This <strong>?</strong> button is always visible in the sidebar footer. Click it to re-open this tour from anywhere in the app — useful for demos or onboarding new teammates.</p>
      </>
    ),
    target: '[data-tour="help-button"]',
    route: '/',
  },
  {
    icon: '🎉',
    title: "You're ready to go!",
    body: (
      <>
        <p>That's every feature. Happy testing — and may your Grafana always be green.</p>
        <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 10 }}>You can reopen this tour from the <strong>?</strong> in the sidebar footer or from Settings.</p>
      </>
    ),
  },
];

/* ── keyframes injected once ── */
let kfInjected = false;
function injectKf() {
  if (kfInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = `
    @keyframes userTourSlideIn {
      from { transform: translateX(20px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes userTourFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes userTourPulse {
      0%, 100% { box-shadow: 0 0 0 9999px rgba(3, 7, 18, 0.72), 0 0 0 3px #6366f1, 0 0 30px rgba(99, 102, 241, 0.6); }
      50% { box-shadow: 0 0 0 9999px rgba(3, 7, 18, 0.72), 0 0 0 3px #a78bfa, 0 0 40px rgba(167, 139, 250, 0.8); }
    }
    .ut-btn:hover { filter: brightness(1.15); }
    .ut-btn-ghost:hover { background: rgba(148, 163, 184, 0.08); color: #cbd5e1; }
    .ut-close:hover { background: rgba(239, 68, 68, 0.12); color: #fca5a5; }
  `;
  document.head.appendChild(el);
  kfInjected = true;
}

/* Find a tour target on the current page, retrying briefly to give
   route changes time to render. Returns DOMRect or null. */
function findTargetWithRetry(selector, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tryFind = () => {
      const el = document.querySelector(selector);
      if (el) {
        // Scroll into view (smooth) before measuring
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        } catch (_) { /* scrollIntoView options unsupported — fallback noop */ }
        // Give scroll a moment, then measure
        setTimeout(() => {
          const rect = el.getBoundingClientRect();
          resolve({ el, rect });
        }, 200);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        resolve(null);
        return;
      }
      requestAnimationFrame(tryFind);
    };
    tryFind();
  });
}

export default function UserTour({ onComplete }) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const hasNavigatedRef = useRef(false);

  useEffect(() => { injectKf(); }, []);

  const current = TOUR_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TOUR_STEPS.length - 1;
  const progress = ((step + 1) / TOUR_STEPS.length) * 100;

  /* On step change: navigate if needed, then locate + spotlight target.
     Refs sidestep stale closures so we don't need every dep in the array. */
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const locationRef = useRef(location);
  locationRef.current = location;
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    let cancelled = false;
    setTargetRect(null);

    const stepData = currentRef.current;
    const needNav = stepData.route && locationRef.current.pathname !== stepData.route;
    if (needNav) {
      navigateRef.current(stepData.route);
      hasNavigatedRef.current = true;
    }

    if (!stepData.target) return;

    // Wait a tick after navigation for the new route to render
    const delay = needNav ? 350 : 50;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      const found = await findTargetWithRetry(stepData.target);
      if (cancelled || !found) return;
      setTargetRect(found.rect);
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step]);

  /* Recompute the spotlight position on window resize / scroll so
     the highlight sticks to the element even if the user scrolls. */
  useLayoutEffect(() => {
    if (!current.target) return;
    const update = () => {
      const el = document.querySelector(current.target);
      if (el) setTargetRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [current.target, step]);

  const next = () => {
    if (isLast) {
      onComplete && onComplete();
    } else {
      setStep((s) => s + 1);
    }
  };
  const back = () => setStep((s) => Math.max(0, s - 1));
  const skip = () => onComplete && onComplete();

  /* ── Styles ── */
  const styles = {
    dimBackdrop: {
      position: 'fixed', inset: 0,
      background: 'rgba(3, 7, 18, 0.72)',
      zIndex: 9997,
      pointerEvents: 'none',
      animation: 'userTourFadeIn 0.25s ease',
    },
    spotlight: targetRect ? {
      position: 'fixed',
      top: Math.max(0, targetRect.top - 6),
      left: Math.max(0, targetRect.left - 6),
      width: targetRect.width + 12,
      height: targetRect.height + 12,
      borderRadius: 10,
      pointerEvents: 'none',
      zIndex: 9998,
      animation: 'userTourPulse 2.2s ease-in-out infinite',
    } : null,
    panel: {
      position: 'fixed',
      top: 24,
      right: 24,
      bottom: 24,
      width: 380,
      background: '#0f172a',
      border: '1.5px solid #6366f1',
      borderRadius: 16,
      boxShadow: '0 20px 60px rgba(99, 102, 241, 0.35), 0 0 0 1px rgba(99, 102, 241, 0.2)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      animation: 'userTourSlideIn 0.3s ease',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    header: {
      padding: '18px 22px 14px',
      borderBottom: '1px solid #1e293b',
      display: 'flex', alignItems: 'center', gap: 10,
    },
    headerLogo: {
      fontSize: 20, fontWeight: 800,
      background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
      WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    },
    headerTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: 600, flex: 1 },
    headerStep: { color: '#64748b', fontSize: 11, fontWeight: 600 },
    closeBtn: {
      width: 28, height: 28, borderRadius: 6,
      background: 'transparent', border: '1px solid #1e293b',
      color: '#64748b', fontSize: 14, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'inherit', transition: 'all 0.15s ease',
    },
    progressBar: { height: 3, background: '#1e293b', margin: '0 22px', borderRadius: 2, overflow: 'hidden' },
    progressFill: {
      height: '100%', width: `${progress}%`,
      background: 'linear-gradient(90deg, #6366f1, #a78bfa)',
      transition: 'width 0.3s ease',
    },
    content: {
      flex: 1, overflowY: 'auto', padding: '20px 22px',
      color: '#cbd5e1', fontSize: 13, lineHeight: 1.6,
    },
    stepIcon: { fontSize: 44, marginBottom: 10, display: 'block' },
    stepTitle: {
      fontSize: 19, fontWeight: 700, color: '#f1f5f9',
      margin: '0 0 12px 0', letterSpacing: '-0.2px',
    },
    highlightHint: {
      marginTop: 14, padding: '10px 14px',
      background: 'rgba(99, 102, 241, 0.12)',
      border: '1px solid rgba(99, 102, 241, 0.3)',
      borderRadius: 8, fontSize: 11, color: '#a5b4fc',
      display: 'flex', alignItems: 'center', gap: 8,
    },
    footer: {
      padding: '14px 22px 18px',
      borderTop: '1px solid #1e293b',
      display: 'flex', alignItems: 'center', gap: 8,
    },
    btnBack: {
      padding: '8px 14px', background: 'transparent',
      border: '1px solid #334155', color: '#94a3b8',
      borderRadius: 7, fontSize: 12, fontWeight: 600,
      cursor: 'pointer', fontFamily: 'inherit',
      transition: 'all 0.15s ease',
    },
    btnSkip: {
      padding: '8px 14px', background: 'transparent', border: 'none',
      color: '#64748b', borderRadius: 7, fontSize: 12, fontWeight: 500,
      cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto',
      transition: 'all 0.15s ease',
    },
    btnNext: {
      padding: '8px 18px',
      background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
      border: 'none', color: '#fff', borderRadius: 7,
      fontSize: 12, fontWeight: 700, cursor: 'pointer',
      fontFamily: 'inherit',
      boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
      transition: 'all 0.15s ease',
    },
  };

  return (
    <>
      {/* Dim the whole app only when there's no target to spotlight
          (welcome / finish steps). When a target IS set, the spotlight
          itself provides the dim via box-shadow, so the user can still
          visually "see and tell" which element we're talking about. */}
      {!targetRect && <div style={styles.dimBackdrop} />}

      {/* Spotlight ring around the highlighted element */}
      {targetRect && <div style={styles.spotlight} />}

      {/* Tour panel */}
      <div style={styles.panel} role="dialog" aria-label="Heimdall product tour">
        <div style={styles.header}>
          <span style={styles.headerLogo}>H</span>
          <span style={styles.headerTitle}>Welcome Tour</span>
          <span style={styles.headerStep}>{step + 1} / {TOUR_STEPS.length}</span>
          <button
            className="ut-close"
            style={styles.closeBtn}
            onClick={skip}
            title="Close tour"
            aria-label="Close tour"
          >
            ✕
          </button>
        </div>

        <div style={styles.progressBar}>
          <div style={styles.progressFill} />
        </div>

        <div style={styles.content}>
          <span style={styles.stepIcon}>{current.icon}</span>
          <h2 style={styles.stepTitle}>{current.title}</h2>
          <div>{current.body}</div>
          {current.target && targetRect && (
            <div style={styles.highlightHint}>
              <span>👈</span>
              <span>See the purple glow? That's the exact feature I'm talking about.</span>
            </div>
          )}
          {current.target && !targetRect && (
            <div style={{ ...styles.highlightHint, color: '#94a3b8', background: 'rgba(148,163,184,0.05)', border: '1px solid #1e293b' }}>
              <span>🔍</span>
              <span>Looking for the feature on the page…</span>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          {!isFirst && (
            <button className="ut-btn-ghost" style={styles.btnBack} onClick={back}>
              ← Back
            </button>
          )}
          <button className="ut-btn-ghost" style={styles.btnSkip} onClick={skip}>
            Skip tour
          </button>
          <button className="ut-btn" style={styles.btnNext} onClick={next}>
            {isLast ? 'Finish 🎉' : 'Next →'}
          </button>
        </div>
      </div>
    </>
  );
}
