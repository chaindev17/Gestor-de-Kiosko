import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { api, setSessionToken } from './lib/api.js';
import LoginScreen from './components/LoginScreen.jsx';
import Layout, { getNavForRole } from './components/Layout.jsx';
import JefeDashboard from './pages/JefeDashboard.jsx';
import StaffShiftsPage from './pages/StaffShiftsPage.jsx';
import PosPage from './pages/PosPage.jsx';
import ShiftIpvPage from './pages/ShiftIpvPage.jsx';
import WarehousePage from './pages/WarehousePage.jsx';
import PricingMfpPage from './pages/PricingMfpPage.jsx';
import FinanceDashboard from './pages/FinanceDashboard.jsx';
import OnatTaxesPage from './pages/OnatTaxesPage.jsx';
import PayrollPage from './pages/PayrollPage.jsx';
import AccountingNcifPage from './pages/AccountingNcifPage.jsx';
import CompliancePage from './pages/CompliancePage.jsx';

function defaultPageForRole(role) {
  if (role === 'jefe') return 'jefe-home';
  if (role === 'economico') return 'banking';
  if (role === 'almacenero') return 'warehouse';
  return 'pos';
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [badges, setBadges] = useState({});
  const [activePage, setActivePage] = useState('jefe-home');
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, type = 'success') => {
    setToast({ id: Date.now(), message, type });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const applySession = useCallback((payload) => {
    if (payload.token) setSessionToken(payload.token);
    setUser(payload.user);
    setConfig(payload.config);
    setBadges(payload.badges || {});
    setActivePage(defaultPageForRole(payload.user.role));
  }, []);

  const refreshBadges = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me');
      setBadges(res.badges || {});
      setConfig(res.config);
    } catch {
      // ignore transient errors
    }
  }, []);

  useEffect(() => {
    api
      .get('/api/auth/me')
      .then((res) => {
        setUser(res.user);
        setConfig(res.config);
        setBadges(res.badges || {});
        setActivePage(defaultPageForRole(res.user.role));
      })
      .catch(() => {
        setSessionToken(null);
      })
      .finally(() => setBooting(false));
  }, []);

  async function handleSwitchUser(userId) {
    try {
      const res = await api.post('/api/auth/quick-switch', { user_id: userId });
      applySession(res);
      notify(`Sesión cambiada a ${res.user.full_name} (${res.user.role}).`);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function handleLogout() {
    try {
      await api.post('/api/auth/logout', {});
    } catch {
      // ignore
    }
    setSessionToken(null);
    setUser(null);
  }

  // Ensure activePage is permitted for current role
  useEffect(() => {
    if (!user) return;
    const allowed = getNavForRole(user.role, badges).map((n) => n.id);
    if (!allowed.includes(activePage)) {
      setActivePage(defaultPageForRole(user.role));
    }
  }, [user, activePage, badges]);

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F5F0] text-sm text-[#66707D]">
        Iniciando Gestor de Kiosko...
      </div>
    );
  }

  return (
    <>
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-xl border shadow-lg px-4 py-3 text-xs flex items-start gap-2.5 bg-white border-[#DFDBD0] no-print">
          {toast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-[#0F5C4D] shrink-0 mt-0.5" />
          )}
          <p className={`flex-1 leading-relaxed ${toast.type === 'error' ? 'text-red-800 font-medium' : 'text-[#171C22]'}`}>
            {toast.message}
          </p>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-[#87909D] hover:text-[#171C22] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!user ? (
        <LoginScreen onAuthenticated={applySession} />
      ) : (
        <Layout
          user={user}
          config={config}
          badges={badges}
          activePage={activePage}
          onNavigate={setActivePage}
          onSwitchUser={handleSwitchUser}
          onLogout={handleLogout}
        >
          {activePage === 'jefe-home' && (
            <JefeDashboard onNavigate={setActivePage} onRefreshBadges={refreshBadges} notify={notify} />
          )}
          {activePage === 'staff' && (
            <StaffShiftsPage user={user} onRefreshBadges={refreshBadges} notify={notify} />
          )}
          {activePage === 'pos' && (
            <PosPage user={user} onNavigate={setActivePage} onRefreshBadges={refreshBadges} notify={notify} />
          )}
          {activePage === 'shift-ipv' && (
            <ShiftIpvPage user={user} onRefreshBadges={refreshBadges} notify={notify} />
          )}
          {activePage === 'warehouse' && (
            <WarehousePage user={user} onRefreshBadges={refreshBadges} notify={notify} />
          )}
          {activePage === 'pricing' && (
            <PricingMfpPage user={user} onRefreshBadges={refreshBadges} notify={notify} />
          )}
          {activePage === 'banking' && (
            <FinanceDashboard onRefreshBadges={refreshBadges} notify={notify} />
          )}
          {activePage === 'onat' && (
            <OnatTaxesPage onRefreshBadges={refreshBadges} notify={notify} />
          )}
          {activePage === 'payroll' && (
            <PayrollPage onRefreshBadges={refreshBadges} notify={notify} />
          )}
          {activePage === 'accounting' && <AccountingNcifPage notify={notify} />}
          {activePage === 'compliance' && (
            <CompliancePage
              user={user}
              onConfigUpdated={setConfig}
              onRefreshBadges={refreshBadges}
              notify={notify}
            />
          )}
        </Layout>
      )}
    </>
  );
}
