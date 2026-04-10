import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Common/Sidebar';
import OnboardingModal from './components/Onboarding/OnboardingModal';
import DashboardPage from './components/Dashboard/DashboardPage';
import TestRunnerPage from './components/TestRunner/TestRunnerPage';
import ReportsPage from './components/Reports/ReportsPage';
import ComparePage from './components/Compare/ComparePage';
import SettingsPage from './components/Settings/SettingsPage';
import AITestsPage from './components/AITests/AITestsPage';

const layoutStyle = {
  display: 'flex',
  minHeight: '100vh',
  background: '#030712',
};

const mainStyle = {
  flex: 1,
  marginLeft: 260,
  padding: '24px 32px',
  overflowY: 'auto',
  maxHeight: '100vh',
};

function AppShell() {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    try {
      const onboarded = localStorage.getItem('grafanaprobe_onboarded');
      if (!onboarded) setShowOnboarding(true);
    } catch {}
  }, []);

  return (
    <BrowserRouter>
      {showOnboarding && <OnboardingModal onComplete={() => setShowOnboarding(false)} />}
      <div style={layoutStyle}>
        <Sidebar />
        <main style={mainStyle}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/ai-tests" element={<AITestsPage />} />
            <Route path="/run" element={<TestRunnerPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
