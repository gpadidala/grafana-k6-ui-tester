import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import RunTestPage from './pages/RunTestPage';
import HistoryPage from './pages/HistoryPage';
import EnvironmentsPage from './pages/EnvironmentsPage';
import CronPage from './pages/CronPage';
import { Page } from './types';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <DashboardPage />;
      case 'run-test': return <RunTestPage />;
      case 'history': return <HistoryPage />;
      case 'environments': return <EnvironmentsPage />;
      case 'cron': return <CronPage />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="flex-1 overflow-y-auto p-8">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
