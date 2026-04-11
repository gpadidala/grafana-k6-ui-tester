import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

const NAV_ITEMS = [
  { icon: '📊', label: 'Dashboard', path: '/' },
  { icon: '🧠', label: 'AI Tests', path: '/ai-tests' },
  { icon: '▶️', label: 'Run Tests', path: '/run' },
  { icon: '📋', label: 'Reports', path: '/reports' },
  { icon: '🔍', label: 'Compare', path: '/compare' },
  { icon: '📸', label: 'Snapshots', path: '/snapshots' },
  { icon: '⚙️', label: 'Settings', path: '/settings' },
];

const SIDEBAR_CSS = `
.gp-sidebar {
  position: fixed; top: 0; left: 0; bottom: 0; width: 260px;
  background-color: #111827; border-right: 1px solid #1e293b;
  display: flex; flex-direction: column; z-index: 1000; overflow-y: auto;
}
.gp-sidebar-logo {
  padding: 24px 20px 16px; border-bottom: 1px solid #1e293b;
}
.gp-sidebar-logo-row { display: flex; align-items: center; gap: 10px; }
.gp-sidebar-logo-text {
  font-size: 28px; font-weight: 800;
  background: linear-gradient(135deg, #6366f1, #a78bfa);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; letter-spacing: -0.5px; line-height: 1;
}
.gp-sidebar-brand { font-size: 16px; font-weight: 600; color: #e2e8f0; letter-spacing: -0.2px; }
.gp-sidebar-badge {
  display: inline-block; margin-left: 8px; padding: 2px 8px;
  font-size: 11px; font-weight: 600; color: #a78bfa;
  background-color: rgba(99, 102, 241, 0.15); border-radius: 9999px; vertical-align: middle;
}
.gp-sidebar-subtitle { font-size: 12px; color: #94a3b8; margin-top: 6px; padding-left: 2px; }

/* Env selector */
.gp-env-selector {
  padding: 14px 16px 10px;
  border-bottom: 1px solid #1e293b;
}
.gp-env-label {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.8px; color: #64748b; margin-bottom: 8px;
}
.gp-env-pills { display: flex; gap: 6px; }
.gp-env-pill {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 6px; border-radius: 8px;
  font-size: 11px; font-weight: 700;
  background: #0f172a; border: 1.5px solid #1e293b; color: #64748b;
  cursor: pointer; transition: all 0.15s ease;
  font-family: inherit;
}
.gp-env-pill:hover { background: #1e293b; color: #cbd5e1; }
.gp-env-pill.gp-env-active {
  color: #f1f5f9; background: rgba(99, 102, 241, 0.08);
}
.gp-env-pill.gp-env-not-configured {
  opacity: 0.5;
}
.gp-env-dot {
  width: 8px; height: 8px; border-radius: 50%;
}
.gp-env-warning {
  margin-top: 8px; padding: 6px 8px; border-radius: 6px;
  background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3);
  font-size: 10px; color: #eab308; line-height: 1.3;
}
.gp-sidebar-nav { flex: 1; padding: 12px 0; }

/* Nav item base */
.gp-nav-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 20px; margin: 2px 8px; border-radius: 8px;
  font-size: 14px; font-weight: 500; color: #94a3b8;
  cursor: pointer; transition: background-color 0.15s ease, color 0.15s ease;
  border: none; background: none; width: calc(100% - 16px);
  text-align: left; border-left: 3px solid transparent;
  font-family: inherit;
}
/* Hover — only when NOT active */
.gp-nav-item:hover:not(.gp-nav-active) {
  background-color: #1e293b;
  color: #e2e8f0;
}
/* Active state — wins over hover */
.gp-nav-item.gp-nav-active {
  background-color: rgba(99, 102, 241, 0.1);
  color: #e2e8f0;
  border-left: 3px solid #6366f1;
  font-weight: 600;
}
.gp-nav-icon { font-size: 16px; width: 24px; text-align: center; flex-shrink: 0; }
.gp-sidebar-bottom {
  padding: 16px 20px; border-top: 1px solid #1e293b;
  display: flex; align-items: center; gap: 10px;
}
.gp-sidebar-bottom-left { flex: 1; min-width: 0; }
.gp-sidebar-cats { font-size: 12px; color: #94a3b8; margin-bottom: 4px; }
.gp-sidebar-version { font-size: 11px; color: #475569; }
.gp-sidebar-help {
  width: 32px; height: 32px; border-radius: 8px;
  background: transparent; border: 1px solid #1e293b;
  color: #64748b; font-size: 16px; font-weight: 700;
  cursor: pointer; font-family: inherit;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s ease; flex-shrink: 0;
}
.gp-sidebar-help:hover {
  background: rgba(99, 102, 241, 0.12);
  border-color: #6366f1;
  color: #a5b4fc;
}
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = SIDEBAR_CSS;
  document.head.appendChild(el);
  cssInjected = true;
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { envs, activeEnvKey, setActiveEnvKey, activeEnv, openOnboarding } = useApp();

  React.useEffect(() => { injectCss(); }, []);

  const needsConfig = !activeEnv || !activeEnv.url;

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleClick = (e, path) => {
    // Blur the button immediately so the focus state doesn't linger
    if (e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();
    navigate(path);
  };

  return (
    <aside className="gp-sidebar">
      <div className="gp-sidebar-logo">
        <div className="gp-sidebar-logo-row">
          <span className="gp-sidebar-logo-text">H</span>
          <div>
            <span className="gp-sidebar-brand">Heimdall</span>
            <span className="gp-sidebar-badge">v3.0</span>
          </div>
        </div>
        <div className="gp-sidebar-subtitle">by Gopal Rao</div>
      </div>

      <div className="gp-env-selector" data-tour="env-pills">
        <div className="gp-env-label">Target Environment</div>
        <div className="gp-env-pills">
          {envs.map((env) => {
            const isSelected = activeEnvKey === env.key;
            const hasUrl = Boolean(env.url);
            return (
              <button
                key={env.key}
                className={`gp-env-pill${isSelected ? ' gp-env-active' : ''}${!hasUrl ? ' gp-env-not-configured' : ''}`}
                style={isSelected ? { borderColor: env.color, boxShadow: `0 0 0 1px ${env.color}40` } : {}}
                onClick={(e) => { e.currentTarget.blur(); setActiveEnvKey(env.key); }}
                title={hasUrl ? env.url : 'Not configured — go to Settings'}
              >
                <span className="gp-env-dot" style={{ background: env.color }} />
                {env.label}
              </button>
            );
          })}
        </div>
        {needsConfig && (
          <div className="gp-env-warning">
            {!activeEnv
              ? 'No environment selected — pick one above'
              : `${activeEnv.label} has no URL — configure in Settings`}
          </div>
        )}
      </div>

      <nav className="gp-sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.path}
            className={`gp-nav-item${isActive(item.path) ? ' gp-nav-active' : ''}`}
            onClick={(e) => handleClick(e, item.path)}
          >
            <span className="gp-nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="gp-sidebar-bottom">
        <div className="gp-sidebar-bottom-left">
          <div className="gp-sidebar-cats">22 test categories</div>
          <div className="gp-sidebar-version">Heimdall v3.0.0</div>
        </div>
        <button
          className="gp-sidebar-help"
          data-tour="help-button"
          onClick={(e) => { e.currentTarget.blur(); openOnboarding(); }}
          title="Show welcome tour"
          aria-label="Show welcome tour"
        >
          ?
        </button>
      </div>
    </aside>
  );
}
