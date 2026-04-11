import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';

const KEYFRAMES = `
@keyframes obFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes obSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
@keyframes obScaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
@keyframes obFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes obPulse { 0%,100% { box-shadow: 0 0 30px rgba(99,102,241,0.4); } 50% { box-shadow: 0 0 60px rgba(99,102,241,0.7); } }
`;

let kfInjected = false;
function injectKF() {
  if (kfInjected || typeof document === 'undefined') return;
  const s = document.createElement('style');
  s.textContent = KEYFRAMES;
  document.head.appendChild(s);
  kfInjected = true;
}

const ENVS = [
  { id: 'production', label: 'Production', icon: '🚀', color: '#ef4444', desc: 'Live customer-facing instance' },
  { id: 'staging', label: 'Staging', icon: '🧪', color: '#eab308', desc: 'Pre-production validation' },
  { id: 'development', label: 'Development', icon: '💻', color: '#10b981', desc: 'Local or dev environment' },
];

const styles = {
  backdrop: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(3, 7, 18, 0.85)', backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
    animation: 'obFadeIn 0.3s ease',
  },
  modal: {
    width: 600, maxWidth: 'calc(100vw - 40px)',
    background: 'linear-gradient(180deg, #111827 0%, #0f172a 100%)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 20, padding: '40px 48px 32px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(99,102,241,0.15)',
    animation: 'obScaleIn 0.4s cubic-bezier(0.22,1,0.36,1)',
    color: '#e2e8f0',
  },
  progressDots: {
    display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 32,
  },
  dot: (state) => ({
    width: state === 'active' ? 32 : 8, height: 8,
    borderRadius: 999,
    background: state === 'active' ? '#6366f1' : state === 'completed' ? '#6366f1' : '#374151',
    transition: 'all 0.3s cubic-bezier(0.22,1,0.36,1)',
    opacity: state === 'inactive' ? 0.5 : 1,
  }),
  step: { animation: 'obSlideUp 0.4s cubic-bezier(0.22,1,0.36,1)' },
  logo: {
    fontSize: 80, fontWeight: 900, textAlign: 'center',
    background: 'linear-gradient(135deg, #6366f1, #a78bfa, #f0abfc)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
    backgroundClip: 'text', letterSpacing: '-3px', lineHeight: 1,
    marginBottom: 8, animation: 'obFloat 3s ease-in-out infinite',
  },
  title: { fontSize: 28, fontWeight: 800, textAlign: 'center', color: '#fff', marginBottom: 12, letterSpacing: '-0.5px' },
  subtitle: { fontSize: 16, textAlign: 'center', color: '#94a3b8', lineHeight: 1.5, marginBottom: 24 },
  input: {
    width: '100%', boxSizing: 'border-box',
    background: '#0f172a', border: '2px solid #1e293b',
    borderRadius: 10, padding: '14px 18px', fontSize: 16, color: '#e2e8f0',
    outline: 'none', transition: 'border-color 0.2s',
    fontFamily: 'inherit',
  },
  helper: { fontSize: 13, color: '#64748b', marginTop: 8, textAlign: 'center' },
  envGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 8 },
  envCard: (active, color) => ({
    padding: '20px 16px', borderRadius: 12,
    background: active ? `${color}15` : '#0f172a',
    border: `2px solid ${active ? color : '#1e293b'}`,
    cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.22,1,0.36,1)',
    textAlign: 'center',
    boxShadow: active ? `0 6px 24px ${color}30` : 'none',
  }),
  envIcon: { fontSize: 32, marginBottom: 8 },
  envLabel: { fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 },
  envDesc: { fontSize: 11, color: '#94a3b8', lineHeight: 1.4 },
  badges: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 },
  badge: {
    padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
    background: 'rgba(99,102,241,0.15)', color: '#a78bfa',
    border: '1px solid rgba(99,102,241,0.3)',
  },
  buttons: {
    display: 'flex', gap: 12, marginTop: 32, justifyContent: 'space-between',
  },
  btnSecondary: {
    padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600,
    background: 'transparent', color: '#94a3b8', border: '1px solid #374151',
    cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
  },
  btnPrimary: {
    padding: '12px 32px', borderRadius: 10, fontSize: 14, fontWeight: 700,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: '#fff',
    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
    boxShadow: '0 6px 20px rgba(99,102,241,0.35)',
    fontFamily: 'inherit',
  },
  btnFull: {
    width: '100%', padding: '14px 32px', borderRadius: 10, fontSize: 15, fontWeight: 700,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: '#fff',
    border: 'none', cursor: 'pointer', marginTop: 32,
    boxShadow: '0 6px 24px rgba(99,102,241,0.4)',
    animation: 'obPulse 2s ease-in-out infinite',
    fontFamily: 'inherit',
  },
};

export default function OnboardingModal({ onComplete }) {
  const { setUserName } = useApp();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [env, setEnv] = useState(null);

  useEffect(() => { injectKF(); }, []);

  const next = () => setStep((s) => Math.min(4, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  const finish = () => {
    if (name.trim()) setUserName(name.trim());
    // Versioned onboarded flag is written by AppContext.closeOnboarding
    // (which is what `onComplete` points at). Keep the default-env
    // side-channel here since it's unrelated to the tour version.
    if (env) try { localStorage.setItem('grafanaprobe_default_env', env); } catch {}
    onComplete && onComplete();
  };

  const dotState = (i) => i < step ? 'completed' : i === step ? 'active' : 'inactive';

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <div style={styles.progressDots}>
          {[1,2,3,4].map(i => <div key={i} style={styles.dot(dotState(i))} />)}
        </div>

        {step === 1 && (
          <div style={styles.step}>
            <div style={styles.logo}>GP</div>
            <h2 style={styles.title}>Welcome to GrafanaProbe</h2>
            <p style={styles.subtitle}>
              The enterprise testing platform for Grafana.<br/>
              17 test categories. 3 engines. One dashboard.
            </p>
            <div style={styles.badges}>
              <span style={styles.badge}>⚡ K6 API</span>
              <span style={styles.badge}>🎭 Playwright</span>
              <span style={styles.badge}>🔥 JMeter</span>
              <span style={styles.badge}>🤖 AI Analysis</span>
            </div>
            <button style={{ ...styles.btnFull, animation: 'none' }} onClick={next}>
              Get Started →
            </button>
          </div>
        )}

        {step === 2 && (
          <div style={styles.step}>
            <h2 style={styles.title}>What's your name?</h2>
            <p style={styles.subtitle}>
              We'll use this to greet you on the dashboard.
            </p>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) next(); }}
              placeholder="e.g. Gopal Rao"
              style={styles.input}
              onFocus={(e) => e.target.style.borderColor = '#6366f1'}
              onBlur={(e) => e.target.style.borderColor = '#1e293b'}
            />
            <p style={styles.helper}>You can change this later in Settings.</p>
            <div style={styles.buttons}>
              <button style={styles.btnSecondary} onClick={back}>← Back</button>
              <button style={{ ...styles.btnPrimary, opacity: name.trim() ? 1 : 0.5, cursor: name.trim() ? 'pointer' : 'not-allowed' }} disabled={!name.trim()} onClick={next}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={styles.step}>
            <h2 style={styles.title}>Which environment?</h2>
            <p style={styles.subtitle}>
              Choose your default environment. You can add more later.
            </p>
            <div style={styles.envGrid}>
              {ENVS.map((e) => (
                <div key={e.id} style={styles.envCard(env === e.id, e.color)}
                  onClick={() => setEnv(e.id)}>
                  <div style={styles.envIcon}>{e.icon}</div>
                  <div style={styles.envLabel}>{e.label}</div>
                  <div style={styles.envDesc}>{e.desc}</div>
                </div>
              ))}
            </div>
            <div style={styles.buttons}>
              <button style={styles.btnSecondary} onClick={back}>← Back</button>
              <button style={{ ...styles.btnPrimary, opacity: env ? 1 : 0.5, cursor: env ? 'pointer' : 'not-allowed' }} disabled={!env} onClick={next}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div style={styles.step}>
            <div style={{ fontSize: 80, textAlign: 'center', marginBottom: 8, animation: 'obFloat 3s ease-in-out infinite' }}>✨</div>
            <h2 style={styles.title}>You're all set, {name.split(' ')[0]}!</h2>
            <p style={styles.subtitle}>
              Configure your Grafana URL and token in Settings,<br/>
              then run your first test in seconds.
            </p>
            <div style={styles.badges}>
              <span style={styles.badge}>17 Categories</span>
              <span style={styles.badge}>Live Progress</span>
              <span style={styles.badge}>HTML Reports</span>
              <span style={styles.badge}>Dependency Graph</span>
              <span style={styles.badge}>Multi-Env</span>
            </div>
            <button style={styles.btnFull} onClick={finish}>
              Launch Dashboard 🚀
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
