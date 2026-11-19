import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { api, setSessionToken } from './lib/api.js';
import { decodeCatalogSnapshot } from './lib/whatsapp.js';
import ConectaLanding from './components/ConectaLanding.jsx';
import AuthFlow from './components/AuthFlow.jsx';
import AccountHub from './components/AccountHub.jsx';
import CreateCompanyWizard from './components/CreateCompanyWizard.jsx';
import PublicCatalog from './components/PublicCatalog.jsx';
import Layout, { getDefaultPageForRole, getNavForRole } from './components/Layout.jsx';
import WorkspaceSettingsPage from './pages/WorkspaceSettingsPage.jsx';
import CatalogWhatsappPage from './pages/CatalogWhatsappPage.jsx';
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

export default function App() {
  const [booting, setBooting] = useState(true);
  // view: 'landing' | 'auth' | 'hub' | 'create_wizard' | 'workspace' | 'catalog'
  const [view, setView] = useState('landing');
  const [catalogState, setCatalogState] = useState({
    code: 'kiosko-CEIBA1',
    snapshot: null,
    ownerPreview: false,
    returnView: 'landing',
  });
  const [catalogInitialTab, setCatalogInitialTab] = useState('orders');
  const [authOpts, setAuthOpts] = useState({
    mode: 'login',
    intent: 'create',
    businessName: '',
    preset: 'solo_dueno',
    code: '',
  });
  const [demoLoading, setDemoLoading] = useState(false);

  // Session state
  const [account, setAccount] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [activeCompany, setActiveCompany] = useState(null);
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

  const applyPayload = useCallback((payload, nextView = null) => {
    if (payload.token) setSessionToken(payload.token);
    if (payload.account !== undefined) setAccount(payload.account);
    if (payload.memberships !== undefined) setMemberships(payload.memberships || []);
    if (payload.active_company !== undefined) setActiveCompany(payload.active_company);
    setUser(payload.user || null);
    setConfig(payload.config || null);
    setBadges(payload.badges || {});

    if (nextView) {
      setView(nextView);
    } else if (payload.user) {
      setActivePage(getDefaultPageForRole(payload.user.role, payload.badges || {}, payload.config));
      setView('workspace');
    } else if (payload.account) {
      setView('hub');
    } else {
      setView('landing');
    }
  }, []);

  const refreshBadges = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me');
      if (res.account !== undefined) setAccount(res.account);
      if (res.memberships !== undefined) setMemberships(res.memberships || []);
      if (res.active_company !== undefined) setActiveCompany(res.active_company);
      if (res.config) setConfig(res.config);
      setBadges(res.badges || {});
    } catch {
      // ignore transient errors
    }
  }, []);

  const refreshAccount = useCallback(async () => {
    const res = await api.get('/api/platform/account');
    setAccount(res.account);
    setMemberships(res.memberships || []);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const storeCode = params.get('tienda') || params.get('catalogo') || params.get('store') || '';
    const snapParam = params.get('s') || '';
    const urlCode = params.get('codigo') || params.get('code') || '';

    // Customer clicked a store catalog link (?tienda=kiosko-XXXXXX) -> open directly, no login needed!
    if (storeCode || snapParam) {
      const decoded = snapParam ? decodeCatalogSnapshot(snapParam) : null;
      setCatalogState({
        code: storeCode || decoded?.store?.company_code || '',
        snapshot: decoded,
        ownerPreview: false,
        returnView: 'landing',
      });
      setView('catalog');
      setBooting(false);
      return;
    }

    api
      .get('/api/auth/me')
      .then((res) => {
        if (urlCode) {
          setAccount(res.account || null);
          setMemberships(res.memberships || []);
          setAuthOpts((o) => ({ ...o, mode: 'affiliate', code: urlCode }));
          setView('auth');
          window.history.replaceState({}, '', window.location.pathname);
          return;
        }
        applyPayload(res);
      })
      .catch(() => {
        setSessionToken(null);
        if (urlCode) {
          setAuthOpts((o) => ({ ...o, mode: 'affiliate', code: urlCode }));
          setView('auth');
          window.history.replaceState({}, '', window.location.pathname);
        }
      })
      .finally(() => setBooting(false));
  }, [applyPayload]);

  // Keep activePage valid when creator toggles modules or changes role view
  useEffect(() => {
    if (view !== 'workspace' || !user) return;
    const allowed = getNavForRole(user.role, badges, config).map((n) => n.id);
    if (!allowed.includes(activePage)) {
      setActivePage(getDefaultPageForRole(user.role, badges, config));
    }
  }, [view, user, activePage, badges, config]);

  function openCatalogPreview(code, fromView = view, isOwner = false) {
    setCatalogState({
      code: code || activeCompany?.company_code || config?.company_code || 'kiosko-CEIBA1',
      snapshot: null,
      ownerPreview: isOwner,
      returnView: fromView,
    });
    setView('catalog');
    window.scrollTo(0, 0);
  }

  function openCatalogTab(tabName) {
    setCatalogInitialTab(tabName || 'orders');
    setActivePage('catalog-wa');
  }

  async function handleTryDemo() {
    setDemoLoading(true);
    try {
      const res = await api.post('/api/auth/quick-switch', { username: 'jefe', demo: true });
      applyPayload(res, 'workspace');
      notify('Entraste a la empresa de demostración (Kiosko La Ceiba).');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleSwitchUser(userId) {
    try {
      const res = await api.post('/api/auth/quick-switch', { user_id: userId });
      applyPayload(res, 'workspace');
      notify(`Vista cambiada a ${res.user.full_name} (${res.user.role}).`);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function handleOpenHub() {
    try {
      const res = await api.post('/api/platform/exit-to-hub', {});
      applyPayload(res, 'hub');
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
    setAccount(null);
    setMemberships([]);
    setActiveCompany(null);
    setUser(null);
    setConfig(null);
    setBadges({});
    setView('landing');
  }

  function handleGovernanceUpdated(res) {
    if (res?.config) setConfig(res.config);
    if (res?.active_company) setActiveCompany(res.active_company);
    if (res?.badges) setBadges(res.badges);
  }

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF8F4] text-sm text-[#7A746B]">
        Cargando Kiosko Conecta...
      </div>
    );
  }

  return (
    <>
      {toast && (
        <div className="fixed bottom-20 lg:bottom-4 right-4 z-50 max-w-md rounded-2xl border shadow-xl px-4 py-3 text-xs flex items-start gap-2.5 bg-white border-[#E5DED0] no-print">
          {toast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-[#15614B] shrink-0 mt-0.5" />
          )}
          <p
            className={`flex-1 leading-relaxed ${
              toast.type === 'error' ? 'text-red-800 font-medium' : 'text-[#181715]'
            }`}
          >
            {toast.message}
          </p>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-[#9C958B] hover:text-[#181715] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {view === 'catalog' && (
        <PublicCatalog
          companyCode={catalogState.code}
          initialSnapshot={catalogState.snapshot}
          ownerPreview={catalogState.ownerPreview}
          onBack={() => {
            if (window.location.search) {
              window.history.replaceState({}, '', window.location.pathname);
            }
            if (catalogState.ownerPreview && user) {
              refreshBadges();
              setView('workspace');
            } else {
              setView(catalogState.returnView || 'landing');
            }
          }}
          onConfigureWhatsapp={() => {
            setCatalogInitialTab('settings');
            setActivePage('catalog-wa');
            setView('workspace');
          }}
          onOrderCreated={() => {
            if (user) refreshBadges();
          }}
          notify={notify}
        />
      )}

      {view === 'landing' && (
        <ConectaLanding
          demoLoading={demoLoading}
          onStartLogin={() => {
            setAuthOpts((o) => ({ ...o, mode: 'login' }));
            setView('auth');
            window.scrollTo(0, 0);
          }}
          onStartRegister={({ intent = 'create', businessName = '', preset = 'solo_dueno' } = {}) => {
            setAuthOpts({ mode: 'register', intent, businessName, preset, code: '' });
            setView('auth');
            window.scrollTo(0, 0);
          }}
          onStartAffiliate={(code = '') => {
            setAuthOpts((o) => ({ ...o, mode: 'affiliate', code: typeof code === 'string' ? code : '' }));
            setView('auth');
            window.scrollTo(0, 0);
          }}
          onTryCatalog={() => openCatalogPreview('kiosko-CEIBA1', 'landing', false)}
          onTryDemo={handleTryDemo}
        />
      )}

      {view === 'auth' && (
        <AuthFlow
          initialMode={authOpts.mode}
          initialIntent={authOpts.intent}
          initialBusinessName={authOpts.businessName}
          initialCode={authOpts.code}
          account={account}
          onBack={() => setView(account ? 'hub' : 'landing')}
          onTryDemo={account ? null : handleTryDemo}
          onAuthComplete={(payload, nextAction) => {
            if (payload.message) notify(payload.message);
            if (nextAction === 'create_wizard') {
              applyPayload(payload, 'create_wizard');
            } else if (nextAction === 'affiliate') {
              if (payload.token) setSessionToken(payload.token);
              setAccount(payload.account);
              setMemberships(payload.memberships || []);
              setAuthOpts((o) => ({ ...o, mode: 'affiliate' }));
              setView('auth');
            } else if (nextAction === 'hub') {
              applyPayload(payload, 'hub');
            } else {
              applyPayload(payload);
            }
          }}
        />
      )}

      {view === 'hub' && (
        <AccountHub
          account={account}
          memberships={memberships}
          onSelectCompany={(res) => applyPayload(res, 'workspace')}
          onPreviewCatalog={(code) => openCatalogPreview(code, 'hub', true)}
          onStartCreateCompany={() => setView('create_wizard')}
          onStartAffiliate={() => {
            setAuthOpts((o) => ({ ...o, mode: 'affiliate', code: '' }));
            setView('auth');
          }}
          onRefreshAccount={refreshAccount}
          onTryDemo={handleTryDemo}
          onLogout={handleLogout}
          notify={notify}
        />
      )}

      {view === 'create_wizard' && (
        <CreateCompanyWizard
          account={account}
          initialBusinessName={authOpts.businessName}
          initialPreset={authOpts.preset}
          onBack={() => setView('hub')}
          onCreated={(res) => {
            applyPayload(res, 'workspace');
            notify(`¡Bienvenido al panel de ${res.active_company?.name}!`);
          }}
          notify={notify}
        />
      )}

      {view === 'workspace' && user && (
        <Layout
          user={user}
          account={account}
          activeCompany={activeCompany}
          config={config}
          badges={badges}
          activePage={activePage}
          onNavigate={(pageId) => {
            if (pageId === 'catalog-wa') setCatalogInitialTab('orders');
            setActivePage(pageId);
          }}
          onPreviewCatalog={(code) => openCatalogPreview(code, 'workspace', true)}
          onSwitchUser={handleSwitchUser}
          onOpenHub={account ? handleOpenHub : null}
          onLogout={handleLogout}
          notify={notify}
        >
          {activePage === 'workspace-settings' && (
            <WorkspaceSettingsPage
              config={config}
              activeCompany={activeCompany}
              onGovernanceUpdated={handleGovernanceUpdated}
              onRefreshBadges={refreshBadges}
              notify={notify}
            />
          )}
          {activePage === 'catalog-wa' && (
            <CatalogWhatsappPage
              user={user}
              initialTab={catalogInitialTab}
              onPreviewCatalog={(code) => openCatalogPreview(code, 'workspace', true)}
              onRefreshBadges={refreshBadges}
              onConfigUpdated={(nextCfg) => setConfig(nextCfg)}
              notify={notify}
            />
          )}
          {activePage === 'jefe-home' && (
            <JefeDashboard
              onNavigate={setActivePage}
              onOpenCatalogTab={openCatalogTab}
              onPreviewCatalog={(code) => openCatalogPreview(code, 'workspace', true)}
              onRefreshBadges={refreshBadges}
              notify={notify}
            />
          )}
          {activePage === 'staff' && (
            <StaffShiftsPage user={user} onRefreshBadges={refreshBadges} notify={notify} />
          )}
          {activePage === 'pos' && (
            <PosPage
              user={user}
              badges={badges}
              onNavigate={setActivePage}
              onRefreshBadges={refreshBadges}
              notify={notify}
            />
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
