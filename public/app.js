// ============================================
// STATE STORE
// ============================================
const state = {
  user: null,
  activeTab: 'dashboard',
  selectedPortal: 'MANAGEMENT',
  dashboardStats: null,
  dashboardLoading: false,
  students: [],
  studentsLoaded: false,
  studentPagination: { page: 1, totalPages: 1, total: 0 },
  studentSearch: '',
  studentStatusFilter: 'ACTIVE', // 'ACTIVE' | 'INACTIVE' | 'ALL'
  batches: [],
  batchesLoaded: false,
  fees: [],
  feesLoaded: false,
  feePagination: { page: 1, totalPages: 1, total: 0 },
  feeStatusFilter: 'ALL',
  invoices: [],
  invoicesLoaded: false,
  alertMessage: null,
  alertType: 'danger'
};

// ============================================
// API CLIENT
// ============================================
async function api(endpoint, options = {}) {
  try {
    const res = await fetch(endpoint, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(!(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {})
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error occurred');
    return data;
  } catch (err) {
    showAlert(err.message, 'danger');
    throw err;
  }
}

// ============================================
// ALERT SYSTEM
// ============================================
let _alertTimeout = null;

function showAlert(message, type = 'danger') {
  state.alertMessage = message;
  state.alertType = type;
  renderAlert();
  if (_alertTimeout) clearTimeout(_alertTimeout);
  _alertTimeout = setTimeout(() => {
    state.alertMessage = null;
    renderAlert();
  }, 6000);
}

function renderAlert() {
  const container = document.getElementById('global-alert-container');
  if (!container) return;
  if (!state.alertMessage) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div class="alert alert-${state.alertType}">
      <span>${state.alertMessage}</span>
      <button onclick="state.alertMessage=null;renderAlert();" style="background:none;border:none;cursor:pointer;font-size:1.25rem;color:inherit;line-height:1;flex-shrink:0;">&times;</button>
    </div>
  `;
}

// ============================================
// AUTHENTICATION
// ============================================
async function checkAuthSession() {
  try {
    const data = await fetch('/api/auth/me').then(r => r.json());
    if (data.authenticated) {
      state.user = data.user;
      state.activeTab = state.user.role === 'MANAGEMENT' ? 'dashboard' : 'enrollment';
    } else {
      state.user = null;
    }
  } catch (e) { state.user = null; }
  renderApp();
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const submitBtn = document.getElementById('login-submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="loading-spinner"></span> Authenticating...`;
  try {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portalType: state.selectedPortal, username, password })
    });
    state.user = res.user;
    state.activeTab = state.user.role === 'MANAGEMENT' ? 'dashboard' : 'enrollment';
    showAlert(`Welcome, ${state.user.displayName}! You are now signed in.`, 'success');
    renderApp();
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `Sign In to ${state.selectedPortal === 'MANAGEMENT' ? 'Management Dashboard' : 'Faculty Portal'}`;
  }
}

async function handleLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { }
  state.user = null;
  state.dashboardStats = null;
  state.dashboardLoading = false;
  state.students = [];
  state.studentsLoaded = false;
  state.batches = [];
  state.batchesLoaded = false;
  state.fees = [];
  state.feesLoaded = false;
  state.invoices = [];
  state.invoicesLoaded = false;
  state.activeTab = 'dashboard';
  showAlert('Signed out successfully.', 'success');
  renderApp();
}

// ============================================
// DATA FETCHERS
// ============================================
async function loadDashboardStats() {
  if (state.user?.role !== 'MANAGEMENT') return;
  state.dashboardLoading = true;
  try {
    state.dashboardStats = await api('/api/dashboard/stats');
  } catch (e) {
    state.dashboardStats = null;
  } finally {
    state.dashboardLoading = false;
  }
  const container = document.getElementById('tab-content-container');
  if (container && state.activeTab === 'dashboard') container.innerHTML = renderDashboardView();
}

async function loadStudents(page = 1) {
  try {
    const params = new URLSearchParams({
      page,
      search: state.studentSearch,
      status: state.studentStatusFilter
    });
    const res = await api(`/api/students?${params}`);
    state.students = res.students;
    state.studentsLoaded = true;
    state.studentPagination = { page: res.page, totalPages: res.totalPages, total: res.total };
  } catch (e) { }
  const container = document.getElementById('tab-content-container');
  if (container && (state.activeTab === 'students' || state.activeTab === 'enrollment')) {
    container.innerHTML = state.activeTab === 'students' ? renderStudentListView() : renderEnrollmentBatchView();
  }
}

async function loadBatches() {
  try {
    const res = await api('/api/batches');
    state.batches = res.batches;
    state.batchesLoaded = true;
  } catch (e) { }
}

async function loadFees(page = 1) {
  if (state.user?.role !== 'MANAGEMENT') return;
  try {
    const res = await api(`/api/fees?page=${page}&status=${state.feeStatusFilter}`);
    state.fees = res.fees;
    state.feesLoaded = true;
    state.feePagination = { page: res.page, totalPages: res.totalPages, total: res.total };
  } catch (e) { }
  const container = document.getElementById('tab-content-container');
  if (container && state.activeTab === 'fees') container.innerHTML = renderFeeManagementView();
}

async function loadInvoices() {
  if (state.user?.role !== 'MANAGEMENT') return;
  try {
    const res = await api('/api/invoices');
    state.invoices = res.invoices;
    state.invoicesLoaded = true;
  } catch (e) { }
}

// ============================================
// RENDER ENGINE
// ============================================
function renderApp() {
  const root = document.getElementById('app');
  if (!root) return;

  if (!state.user) {
    root.innerHTML = renderLoginView();
    return;
  }

  const isMgmt = state.user.role === 'MANAGEMENT';

  root.innerHTML = `
    <header class="sdn-header">
      <div class="sdn-header-inner">
        <a href="#" class="sdn-brand" onclick="navigateTo('${isMgmt ? 'dashboard' : 'enrollment'}'); return false;" id="header-brand">
          <div class="sdn-emblem"><img src="/logo.png" alt="Sridevi Nrithyalaya Logo"></div>
          <div class="sdn-brand-text">
            <h1>Sridevi Nrithyalaya</h1>
            <p>Natyam Moksha Sadhanam &bull; ${isMgmt ? 'Management Portal' : 'Faculty Portal'}</p>
          </div>
        </a>
        <div class="user-badge">
          <span class="role-tag">${isMgmt ? 'Management' : 'Faculty'}</span>
          <button class="btn-logout" onclick="handleLogout()">Sign Out</button>
        </div>
      </div>
    </header>

    <nav class="sdn-nav">
      <div class="sdn-nav-inner">
        ${isMgmt ? `
          <button class="nav-link ${state.activeTab === 'dashboard' ? 'active' : ''}" onclick="navigateTo('dashboard')" id="nav-dashboard">
            <span>📊</span> Dashboard
          </button>
          <button class="nav-link ${state.activeTab === 'onboarding' ? 'active' : ''}" onclick="navigateTo('onboarding')" id="nav-onboarding">
            <span>📝</span> Student Onboarding
          </button>
        ` : ''}
        <button class="nav-link ${state.activeTab === 'students' ? 'active' : ''}" onclick="navigateTo('students')" id="nav-students">
          <span>👥</span> Student Records
        </button>
        <button class="nav-link ${state.activeTab === 'enrollment' ? 'active' : ''}" onclick="navigateTo('enrollment')" id="nav-enrollment">
          <span>🎯</span> Batch Allocation
        </button>
        ${isMgmt ? `
          <button class="nav-link ${state.activeTab === 'fees' ? 'active' : ''}" onclick="navigateTo('fees')" id="nav-fees">
            <span>💳</span> Fee Management
          </button>
          <button class="nav-link ${state.activeTab === 'invoices' ? 'active' : ''}" onclick="navigateTo('invoices')" id="nav-invoices">
            <span>🧾</span> Invoices
          </button>
        ` : ''}
      </div>
    </nav>

    <main class="sdn-main animate-fade">
      <div id="global-alert-container"></div>
      <div id="tab-content-container"></div>
    </main>

    <div id="modal-root"></div>
  `;

  renderAlert();
  renderCurrentTab();
}

function navigateTo(tab) {
  if (!state.user) return;
  if (state.user.role === 'FACULTY' && tab !== 'enrollment' && tab !== 'students') {
    showAlert('Access Restricted: Faculty members can only access Student Records and Batch Allocation.', 'danger');
    return;
  }
  state.activeTab = tab;
  renderApp();
}

function renderCurrentTab() {
  const container = document.getElementById('tab-content-container');
  if (!container) return;

  switch (state.activeTab) {
    case 'dashboard':
      if (!state.dashboardStats && !state.dashboardLoading) {
        container.innerHTML = renderDashboardSkeleton();
        loadDashboardStats();
      } else if (state.dashboardLoading) {
        container.innerHTML = renderDashboardSkeleton();
      } else {
        container.innerHTML = renderDashboardView();
      }
      break;

    case 'onboarding':
      if (!state.batchesLoaded) loadBatches();
      container.innerHTML = renderOnboardingView();
      break;

    case 'students':
      if (!state.studentsLoaded) {
        container.innerHTML = renderTableSkeleton('Student Records', 5);
        loadStudents(1);
      } else {
        container.innerHTML = renderStudentListView();
      }
      break;

    case 'fees':
      if (!state.feesLoaded) {
        container.innerHTML = renderTableSkeleton('Fee Management', 5);
        Promise.all([loadStudents(1), loadFees(1)]);
      } else {
        container.innerHTML = renderFeeManagementView();
      }
      break;

    case 'enrollment':
      if (!state.batchesLoaded || !state.studentsLoaded) {
        container.innerHTML = renderTableSkeleton('Enrollment & Batches', 4);
        Promise.all([loadBatches(), loadStudents(1)]).then(() => {
          const c = document.getElementById('tab-content-container');
          if (c && state.activeTab === 'enrollment') c.innerHTML = renderEnrollmentBatchView();
        });
      } else {
        container.innerHTML = renderEnrollmentBatchView();
      }
      break;

    case 'invoices':
      if (!state.invoicesLoaded) {
        container.innerHTML = renderTableSkeleton('Invoice Generation', 3);
        Promise.all([
          loadInvoices(),
          state.feesLoaded ? Promise.resolve() : loadFees(1)
        ]).then(() => {
          const c = document.getElementById('tab-content-container');
          if (c && state.activeTab === 'invoices') c.innerHTML = renderInvoiceGenerationView();
        });
      } else {
        container.innerHTML = renderInvoiceGenerationView();
      }
      break;

    default:
      container.innerHTML = '<p>Tab not found</p>';
  }
}

// ============================================
// SKELETON LOADERS
// ============================================
function renderDashboardSkeleton() {
  return `
    <div style="margin-bottom:1.75rem;">
      <div class="skeleton skeleton-text medium" style="height:28px; width:380px; margin-bottom:10px;"></div>
      <div class="skeleton skeleton-text short" style="width:260px;"></div>
    </div>
    <div class="kpi-grid">
      ${[1, 2, 3, 4].map(() => `<div class="skeleton skeleton-card"></div>`).join('')}
    </div>
    <div class="sdn-card">
      <div class="sdn-card-header"><div class="skeleton skeleton-text medium" style="height:20px; width:280px;"></div></div>
      <div class="sdn-card-body">
        <div class="age-group-panel">
          ${[1, 2, 3, 4].map(() => `<div class="skeleton" style="height:90px; border-radius:var(--radius-sm);"></div>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderTableSkeleton(title, rows = 5) {
  return `
    <div class="sdn-card">
      <div class="sdn-card-header">
        <div class="skeleton skeleton-text medium" style="height:22px; width:260px;"></div>
      </div>
      <div style="padding:1.5rem;">
        ${[...Array(rows)].map(() => `
          <div style="display:flex; gap:1rem; margin-bottom:1rem; align-items:center;">
            <div class="skeleton" style="width:40px; height:40px; border-radius:50%; flex-shrink:0;"></div>
            <div style="flex:1;">
              <div class="skeleton skeleton-text medium" style="margin-bottom:6px;"></div>
              <div class="skeleton skeleton-text short"></div>
            </div>
            <div class="skeleton" style="width:80px; height:28px; border-radius:var(--radius-full);"></div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ============================================
// LOGIN VIEW
// ============================================
function renderLoginView() {
  const isMgmt = state.selectedPortal === 'MANAGEMENT';
  const defaultUser = isMgmt ? 'Admin' : 'SDNFaculty';
  const defaultPass = isMgmt ? 'AdminSDN@123' : 'FacultySDN@123';

  return `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="login-header">
          <div class="login-emblem"><img src="/logo.png" alt="Sridevi Nrithyalaya Logo"></div>
          <h2 style="font-size:1.55rem; color:var(--sdn-red); margin-bottom:0.2rem;">Sridevi Nrithyalaya</h2>
          <p style="font-size:0.75rem; color:var(--sdn-text-muted); text-transform:uppercase; letter-spacing:0.14em; font-weight:700;">Natyam Moksha Sadhanam</p>
          <p style="font-size:0.875rem; color:var(--sdn-gold); margin-top:0.45rem; font-weight:700;">Student &amp; Academy Administration Portal</p>
        </div>

        <div id="global-alert-container"></div>

        <div class="login-role-selector">
          <button type="button" class="role-tab-btn ${isMgmt ? 'active' : ''}" onclick="selectLoginPortal('MANAGEMENT')" id="btn-portal-mgmt">
            🏛 Management
          </button>
          <button type="button" class="role-tab-btn ${!isMgmt ? 'active' : ''}" onclick="selectLoginPortal('FACULTY')" id="btn-portal-faculty">
            👩‍🏫 Faculty
          </button>
        </div>

        <form onsubmit="handleLogin(event)" id="login-form">
          <div class="form-group" style="margin-bottom:1.25rem;">
            <label class="form-label" for="login-username">Username</label>
            <input type="text" id="login-username" class="form-control" required placeholder="Enter username" value="${defaultUser}" autocomplete="username">
          </div>
          <div class="form-group" style="margin-bottom:1.75rem;">
            <label class="form-label" for="login-password">Password</label>
            <div class="password-wrapper">
              <input type="password" id="login-password" class="form-control" required placeholder="Enter password" value="${defaultPass}" autocomplete="current-password">
              <button type="button" class="password-toggle" onclick="togglePasswordVisibility('login-password', this)" id="pass-toggle-btn">Show</button>
            </div>
          </div>
          <button type="submit" id="login-submit-btn" class="btn btn-primary btn-lg" style="width:100%;">
            Sign In to ${isMgmt ? 'Management Dashboard' : 'Faculty Portal'}
          </button>
        </form>
      </div>
    </div>
  `;
}

function selectLoginPortal(portal) {
  state.selectedPortal = portal;
  renderApp();
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') { input.type = 'text'; btn.innerText = 'Hide'; }
  else { input.type = 'password'; btn.innerText = 'Show'; }
}

// ============================================
// DASHBOARD VIEW
// ============================================
function renderDashboardView() {
  const s = state.dashboardStats;
  if (!s) return renderDashboardSkeleton();

  const ag = s.ageGroups || { kids: 0, juniors: 0, teens: 0, seniors: 0 };
  const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return `
    <div class="page-header animate-fade">
      <h2>Academy Overview &amp; Administration</h2>
      <p>Real-time institutional metrics, age-group breakdowns, and financial status.</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Active Students</div>
        <div class="kpi-value">${s.totalStudents}</div>
        <div class="kpi-subtext">Currently enrolled &amp; active</div>
      </div>
      <div class="kpi-card gold-border">
        <div class="kpi-label">Total Enrolled</div>
        <div class="kpi-value">${s.currentEnrollments}</div>
        <div class="kpi-subtext">In active batches</div>
      </div>
      <div class="kpi-card warning-border">
        <div class="kpi-label">Fees Pending</div>
        <div class="kpi-value">${s.pendingFees.count}</div>
        <div class="kpi-subtext">Students with pending dues</div>
      </div>
      <div class="kpi-card green-border">
        <div class="kpi-label">Fees Collected</div>
        <div class="kpi-value">${s.completedFees.count}</div>
        <div class="kpi-subtext">Students with all dues paid</div>
      </div>
    </div>

    <!-- Age Group Segregation -->
    <div class="sdn-card animate-slide-up">
      <div class="sdn-card-header">
        <div>
          <h3 class="sdn-card-title">Enrolled Students — Age Group Segregation</h3>
          <p style="font-size:0.85rem; color:var(--sdn-text-muted); margin-top:3px;">
            ${s.currentEnrollments} enrolled dancers grouped into classical curriculum tiers.
          </p>
        </div>
        <span class="badge badge-active">${s.currentEnrollments} Enrolled Total</span>
      </div>
      <div class="sdn-card-body">
        <div class="age-group-panel">
          <div class="age-tile">
            <div class="age-tile-title">Kids · Ages 3–7</div>
            <div class="age-tile-count">${ag.kids}</div>
            <div class="age-tile-desc">Salangai Pooja Tots &amp; Foundations</div>
          </div>
          <div class="age-tile">
            <div class="age-tile-title">Juniors · Ages 8–12</div>
            <div class="age-tile-count">${ag.juniors}</div>
            <div class="age-tile-desc">Bala Margam &amp; Intermediate Adavus</div>
          </div>
          <div class="age-tile">
            <div class="age-tile-title">Teens · Ages 13–17</div>
            <div class="age-tile-count">${ag.teens}</div>
            <div class="age-tile-desc">Margam Intensive &amp; Varnam Coaching</div>
          </div>
          <div class="age-tile">
            <div class="age-tile-title">Seniors · Ages 18+</div>
            <div class="age-tile-count">${ag.seniors}</div>
            <div class="age-tile-desc">Arangetram &amp; Professional Repertory</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="sdn-card" style="background:linear-gradient(135deg,#fff 55%,var(--sdn-gold-light) 100%);">
      <div class="sdn-card-body" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1.25rem;">
        <div>
          <h3 style="font-size:1.1rem; color:var(--sdn-maroon); margin-bottom:0.35rem;">Administrative Quick Actions</h3>
          <p style="font-size:0.875rem; color:var(--sdn-text-muted);">Onboard students, manage fees, or assign batch allocations.</p>
        </div>
        <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="navigateTo('onboarding')" id="dash-btn-onboard">+ Onboard Student</button>
          <button class="btn btn-gold" onclick="navigateTo('fees')" id="dash-btn-fees">Fee Administration</button>
          <button class="btn btn-outline" onclick="navigateTo('enrollment')" id="dash-btn-batch">Batch Allocation</button>
        </div>
      </div>
    </div>

    <!-- Recent Tables -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(400px, 1fr)); gap:1.75rem;">
      <div class="sdn-card">
        <div class="sdn-card-header">
          <h3 class="sdn-card-title">Recent Registrations</h3>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('students')" id="dash-view-all-btn">View All</button>
        </div>
        <div class="table-responsive">
          <table class="sdn-table">
            <thead><tr><th>Student</th><th>Phone</th><th>Batch</th></tr></thead>
            <tbody>
              ${s.recentStudents && s.recentStudents.length ? s.recentStudents.map(st => `
                <tr>
                  <td>
                    <div style="font-weight:700; color:var(--sdn-maroon);">${st.name}</div>
                    <div style="font-size:0.74rem; color:var(--sdn-text-light);">${st.student_id_code}</div>
                  </td>
                  <td>${st.phone}</td>
                  <td><span class="badge badge-active">${st.batch_name || 'Unassigned'}</span></td>
                </tr>
              `).join('') : '<tr><td colspan="3" style="text-align:center; padding:2.5rem; color:var(--sdn-text-light);">No students yet. Onboard above.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="sdn-card">
        <div class="sdn-card-header">
          <h3 class="sdn-card-title">Recent Payments</h3>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('fees')" id="dash-view-fees-btn">View All Fees</button>
        </div>
        <div class="table-responsive">
          <table class="sdn-table">
            <thead><tr><th>Student</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              ${s.recentPayments && s.recentPayments.length ? s.recentPayments.map(p => `
                <tr>
                  <td>
                    <div style="font-weight:700;">${p.student_name}</div>
                    <div style="font-size:0.74rem; color:var(--sdn-text-light);">${p.payment_reference || 'Ref: Pending'}</div>
                  </td>
                  <td>${p.fee_type}</td>
                  <td style="font-weight:700;">₹${Number(p.amount).toFixed(2)}</td>
                  <td><span class="badge ${getFeeBadgeClass(p.status)}">${p.status}</span></td>
                </tr>
              `).join('') : '<tr><td colspan="4" style="text-align:center; padding:2.5rem; color:var(--sdn-text-light);">No payment activity yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ============================================
// STUDENT ONBOARDING
// ============================================
function renderOnboardingView() {
  const now = new Date();
  const currentYear = now.getFullYear();
  return `
    <div class="sdn-card animate-fade">
      <div class="sdn-card-header">
        <div>
          <h2 class="sdn-card-title" style="font-size:1.35rem;">Student Onboarding &amp; Registration</h2>
          <p style="font-size:0.875rem; color:var(--sdn-text-muted); margin-top:3px;">Register a new student. Starred fields (<span class="required-star">*</span>) are mandatory.</p>
        </div>
        <button class="btn btn-outline btn-sm" onclick="openImportModal()" id="bulk-import-btn">📁 Bulk Import Excel / CSV</button>
      </div>

      <div class="sdn-card-body">
        <form onsubmit="handleOnboardSubmit(event)" id="onboard-form" enctype="multipart/form-data">

          <h3 style="font-size:1rem; color:var(--sdn-maroon); margin-bottom:1rem; border-bottom:1px solid var(--sdn-border); padding-bottom:0.5rem;">
            1. Identity &amp; Primary Details (Mandatory)
          </h3>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="stu-name">Student Name<span class="required-star">*</span></label>
              <input type="text" id="stu-name" name="name" class="form-control" placeholder="e.g. Priyadarshini Sundaram" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="stu-dob">Date of Birth<span class="required-star">*</span></label>
              <input type="date" id="stu-dob" name="date_of_birth" class="form-control" max="${currentYear}-12-31" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="stu-phone">WhatsApp Contact Number<span class="required-star">*</span></label>
              <input type="tel" id="stu-phone" name="phone" class="form-control" placeholder="e.g. 9840112345" required pattern="[0-9]{10}" maxlength="10" minlength="10" title="Please enter exactly 10 digits" oninput="this.value = this.value.replace(/[^0-9]/g, '').slice(0, 10)">
              <span style="font-size:0.72rem; color:var(--sdn-text-muted); margin-top:2px;">Must be exactly 10 digits (used for WhatsApp communication)</span>
            </div>
            <div class="form-group">
              <label class="form-label" for="stu-mother-tongue">Mother Tongue</label>
              <input type="text" id="stu-mother-tongue" name="mother_tongue" class="form-control" placeholder="e.g. Tamil, Telugu">
            </div>
          </div>

          <h3 style="font-size:1rem; color:var(--sdn-maroon); margin:2rem 0 1rem; border-bottom:1px solid var(--sdn-border); padding-bottom:0.5rem;">
            2. Family Details (Optional)
          </h3>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="stu-father">Father's Name</label>
              <input type="text" id="stu-father" name="father_name" class="form-control" placeholder="e.g. Sundaram Raman">
            </div>
            <div class="form-group">
              <label class="form-label" for="stu-mother">Mother's Name</label>
              <input type="text" id="stu-mother" name="mother_name" class="form-control" placeholder="e.g. Kavitha Sundaram">
            </div>
            <div class="form-group full-width">
              <label class="form-label" for="stu-address">Residential Address</label>
              <textarea id="stu-address" name="address" class="form-control" rows="2" placeholder="e.g. Door No. 12, Trustpuram 1st Cross Street, Kodambakkam, Chennai 600024"></textarea>
            </div>
          </div>

          <h3 style="font-size:1rem; color:var(--sdn-maroon); margin:2rem 0 1rem; border-bottom:1px solid var(--sdn-border); padding-bottom:0.5rem;">
            3. Educational &amp; Dance Background (Optional)
          </h3>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="stu-edu">Educational Qualification</label>
              <input type="text" id="stu-edu" name="educational_qualification" class="form-control" placeholder="e.g. Class 8 / B.Com Graduate">
            </div>
            <div class="form-group">
              <label class="form-label" for="stu-email">Email ID</label>
              <input type="email" id="stu-email" name="email" class="form-control" placeholder="e.g. student@example.com">
              <span style="font-size:0.72rem; color:var(--sdn-text-muted); margin-top:2px;">Optional — used for email fee reminders</span>
            </div>
            <div class="form-group full-width">
              <label class="form-label" for="stu-experience">Previous Dance Experience</label>
              <textarea id="stu-experience" name="previous_experience" class="form-control" rows="2" placeholder="e.g. 3 years Bharatanatyam at XYZ academy, completed Rangapravesha"></textarea>
            </div>
          </div>

          <h3 style="font-size:1rem; color:var(--sdn-maroon); margin:2rem 0 1rem; border-bottom:1px solid var(--sdn-border); padding-bottom:0.5rem;">
            4. Student Photo &amp; Batch (Optional)
          </h3>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="stu-photo">Student Photo</label>
              <input type="file" id="stu-photo" name="photo" class="form-control" accept="image/jpeg,image/png,image/webp">
              <span style="font-size:0.72rem; color:var(--sdn-text-muted); margin-top:2px;">JPG/PNG/WebP, max 5 MB</span>
            </div>
            <div class="form-group">
              <label class="form-label" for="stu-batch">Assign Batch (Optional)</label>
              <select id="stu-batch" name="batch_id" class="form-control">
                <option value="">— Assign Later —</option>
                ${state.batches.map(b => `<option value="${b.id}">${escHtml(b.batch_name)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="margin-top:2rem; display:flex; justify-content:flex-end; gap:0.85rem;">
            <button type="reset" class="btn btn-outline" id="onboard-reset-btn">Reset Form</button>
            <button type="submit" id="onboard-submit-btn" class="btn btn-primary">Save &amp; Register Student</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

async function handleOnboardSubmit(e) {
  e.preventDefault();
  const form = document.getElementById('onboard-form');
  const submitBtn = document.getElementById('onboard-submit-btn');
  const formData = new FormData(form);

  const phoneInput = document.getElementById('stu-phone');
  const cleanPhone = (phoneInput?.value || '').replace(/\D/g, '');
  if (cleanPhone.length !== 10) {
    showAlert('Please enter a valid 10-digit WhatsApp contact number.', 'danger');
    phoneInput?.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="loading-spinner"></span> Registering...`;

  try {
    const res = await api('/api/students', { method: 'POST', body: formData });
    showAlert(`Student onboarded successfully with ID ${res.studentCode}!`, 'success');
    form.reset();
    state.studentsLoaded = false;
    state.dashboardStats = null;
    loadStudents(1);
    loadDashboardStats();
    navigateTo('students');
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Save &amp; Register Student';
  }
}

function openImportModal() {
  openModal('Import Students from Excel / CSV', `
    <div>
      <p style="font-size:0.875rem; color:var(--sdn-text-muted); margin-bottom:1.15rem;">
        Upload a spreadsheet (.xlsx, .xls, .csv). Row 1 must have headers:<br>
        <strong>Name*</strong>, <strong>Phone Number*</strong>, Date of Birth, Father Name, Mother Name, Address, Email IDs (optional).
      </p>
      <div class="form-group" style="margin-bottom:1.25rem;">
        <label class="form-label">Select Spreadsheet File</label>
        <input type="file" id="import-file-input" class="form-control" accept=".xlsx,.xls,.csv" required>
      </div>
      <div id="import-preview-box" style="display:none; max-height:220px; overflow-y:auto; border:1px solid var(--sdn-border); padding:0.85rem; border-radius:var(--radius-sm); font-size:0.85rem; margin-bottom:1rem; background:var(--sdn-surface-subtle);"></div>
      <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
        <button class="btn btn-outline" onclick="runImportPreview(true)" id="preview-import-btn">Preview File</button>
        <button class="btn btn-primary" onclick="runImportPreview(false)" id="commit-import-btn">Commit &amp; Import</button>
      </div>
    </div>
  `);
}

async function runImportPreview(isPreview) {
  const fileInput = document.getElementById('import-file-input');
  if (!fileInput.files[0]) { showAlert('Please select a file first', 'danger'); return; }
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  try {
    const res = await api(`/api/students/import?preview=${isPreview ? 'true' : 'false'}`, { method: 'POST', body: formData });
    const s = res.summary;
    const box = document.getElementById('import-preview-box');
    box.style.display = 'block';
    box.innerHTML = `
      <div style="font-weight:bold; color:var(--sdn-maroon); margin-bottom:0.5rem;">
        Import Summary: ${s.validRows} valid, ${s.invalidRows} invalid, ${s.duplicates} duplicates.
      </div>
      ${s.errors.length ? `<div style="color:var(--sdn-danger); margin-bottom:0.5rem;"><strong>Issues:</strong><br>${s.errors.join('<br>')}</div>` : ''}
      ${s.imported.length ? `<div><strong>Sample Valid Rows:</strong><br>${s.imported.slice(0, 5).map(r => `${r.name} (Phone: ${r.phone})`).join('<br>')}</div>` : ''}
    `;
    if (!isPreview) {
      showAlert(`Successfully imported ${s.validRows} student records!`, 'success');
      closeModal();
      state.studentsLoaded = false;
      state.dashboardStats = null;
      loadStudents(1);
      loadDashboardStats();
    }
  } catch (err) { }
}

// ============================================
// STUDENT MANAGEMENT VIEW
// ============================================
function renderStudentListView() {
  const isMgmt = state.user?.role === 'MANAGEMENT';

  return `
    <div class="sdn-card animate-fade">
      <div class="sdn-card-header">
        <div>
          <h2 class="sdn-card-title">Student Records &amp; Directory</h2>
          <p style="font-size:0.875rem; color:var(--sdn-text-muted); margin-top:3px;">Searchable roster with batch allocation &amp; fee status.</p>
        </div>
        <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
          <input type="text" id="student-search-input" class="form-control" style="width:200px;" placeholder="Search name, phone…" value="${escHtml(state.studentSearch)}" onkeypress="if(event.key==='Enter') handleStudentSearch()">
          <button class="btn btn-primary btn-sm" onclick="handleStudentSearch()" id="search-btn">Search</button>
          <!-- Status Filter -->
          <select id="student-status-filter" class="form-control" style="width:auto;" onchange="changeStudentStatusFilter(this.value)">
            <option value="ACTIVE" ${state.studentStatusFilter === 'ACTIVE' ? 'selected' : ''}>Active Students</option>
            <option value="INACTIVE" ${state.studentStatusFilter === 'INACTIVE' ? 'selected' : ''}>Inactive / Left</option>
            <option value="ALL" ${state.studentStatusFilter === 'ALL' ? 'selected' : ''}>All Students</option>
          </select>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('enrollment')" id="records-to-batch-btn">🎯 Batch Allocation</button>
          ${isMgmt ? `<button class="btn btn-gold btn-sm" onclick="navigateTo('onboarding')" id="new-student-btn">+ New Student</button>` : ''}
        </div>
      </div>

      ${state.studentStatusFilter === 'INACTIVE' ? `
        <div style="background:#fef9ec; border-bottom:1px solid #fde68a; padding:0.75rem 1.25rem; font-size:0.85rem; color:#92400e; display:flex; align-items:center; gap:0.5rem;">
          <span>📋</span>
          <span>Showing <strong>Inactive / Left</strong> students. Their historical records, fees, and batch history are preserved below.</span>
        </div>
      ` : ''}

      <div class="table-responsive">
        <table class="sdn-table">
          <thead>
            <tr>
              <th>ID &amp; Name</th>
              <th>Date of Birth</th>
              <th>WhatsApp</th>
              <th>Parent(s)</th>
              <th style="min-width:180px;">Batch Allocation</th>
              ${isMgmt ? '<th>Fee Status</th>' : ''}
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${state.students.length ? state.students.map(st => {
    const isInactive = st.admission_status !== 'ACTIVE';
    return `
              <tr style="${isInactive ? 'opacity:0.75; background:#fafafa;' : ''}">
                <td>
                  <div style="display:flex; align-items:center; gap:0.6rem;">
                    <div style="width:36px; height:36px; border-radius:50%; background:var(--sdn-surface-subtle); border:2px solid var(--sdn-gold); display:flex; align-items:center; justify-content:center; font-size:0.85rem; font-weight:bold; color:var(--sdn-red); overflow:hidden; flex-shrink:0;">
                      ${st.photo_url ? `<img src="${escHtml(st.photo_url)}" style="width:100%; height:100%; object-fit:cover;">` : escHtml(st.name.charAt(0))}
                    </div>
                    <div>
                      <div style="font-weight:700; color:var(--sdn-maroon);">${escHtml(st.name)}</div>
                      <div style="font-size:0.74rem; color:var(--sdn-text-light);">${st.student_id_code}</div>
                    </div>
                  </div>
                </td>
                <td>${st.date_of_birth ? formatDob(st.date_of_birth) : (st.age ? `~${st.age} yrs` : '—')}</td>
                <td>${st.phone}</td>
                <td style="font-size:0.84rem;">
                  ${st.father_name ? `<div>${escHtml(st.father_name)}</div>` : ''}
                  ${st.mother_name ? `<div>${escHtml(st.mother_name)}</div>` : ''}
                  ${!st.father_name && !st.mother_name ? '—' : ''}
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:0.4rem; justify-content:space-between; flex-wrap:wrap;">
                    ${st.batch_name
        ? `<span class="badge badge-active" style="font-weight:600;">${escHtml(st.batch_name)}</span>`
        : `<span style="color:#aaa; font-size:0.82rem; font-style:italic;">Unassigned</span>`}
                    ${!isInactive ? `
                      <button class="btn btn-outline btn-sm" style="padding:0.18rem 0.5rem; font-size:0.75rem; white-space:nowrap;" onclick="openAllocateBatchModal(${st.id}, '${escHtml(st.name)}', ${st.batch_id || 'null'})" id="alloc-batch-btn-${st.id}" title="Assign or change batch">
                        🎯 Allocate
                      </button>
                    ` : ''}
                  </div>
                </td>
                ${isMgmt ? `
                  <td>
                    ${!isInactive
          ? (st.latest_month_fee_status === 'Paid'
            ? `<span class="badge badge-paid">Paid</span>`
            : `<span class="badge badge-pending">Pending</span>`)
          : `<span style="color:#aaa; font-size:0.8rem;">—</span>`}
                  </td>
                ` : ''}
                <td>
                  ${isInactive
        ? `<span class="badge badge-overdue" title="${escHtml(st.leaving_reason || '')}">Inactive</span>`
        : `<span class="badge badge-active">Active</span>`}
                </td>
                <td>
                  <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                    <button class="btn btn-outline btn-sm" onclick="viewStudentDetails(${st.id})" id="view-stu-${st.id}">Details</button>
                    ${!isInactive ? `<button class="btn btn-outline btn-sm" onclick="openAllocateBatchModal(${st.id}, '${escHtml(st.name)}', ${st.batch_id || 'null'})" id="action-alloc-btn-${st.id}" title="Allocate Batch">Batch</button>` : ''}
                    ${isMgmt ? `<button class="btn btn-outline btn-sm" onclick="openEditStudentModal(${st.id})" id="edit-stu-${st.id}">Edit</button>` : ''}
                    ${isMgmt && !isInactive ? `<button class="btn btn-sm" style="background:#fef2f2; color:#b91c1c; border:1px solid #fecaca;" onclick="openMarkInactiveModal(${st.id}, '${escHtml(st.name)}')" id="deactivate-stu-${st.id}" title="Mark as Inactive / Left">Mark Inactive</button>` : ''}
                    ${isMgmt && isInactive ? `<button class="btn btn-outline btn-sm" onclick="reactivateStudent(${st.id}, '${escHtml(st.name)}')" id="reactivate-stu-${st.id}">Reactivate</button>` : ''}
                  </div>
                </td>
              </tr>
            `}).join('') : `
              <tr>
                <td colspan="${isMgmt ? 8 : 7}">
                  <div class="empty-state">
                    <div class="empty-state-icon">👥</div>
                    <h3>No Students Found</h3>
                    <p>${state.studentSearch ? `No results for "${escHtml(state.studentSearch)}"` : `No ${state.studentStatusFilter === 'INACTIVE' ? 'inactive' : 'active'} students found.`}</p>
                    ${isMgmt && state.studentStatusFilter === 'ACTIVE' ? `<button class="btn btn-primary btn-sm" onclick="navigateTo('onboarding')">+ Onboard First Student</button>` : ''}
                  </div>
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>

      <div class="pagination-bar">
        <span class="pagination-info">Page ${state.studentPagination.page} of ${state.studentPagination.totalPages} &bull; ${state.studentPagination.total} Students (${state.studentStatusFilter})</span>
        <div class="pagination-controls">
          <button class="btn btn-outline btn-sm" ${state.studentPagination.page <= 1 ? 'disabled' : ''} onclick="loadStudents(${state.studentPagination.page - 1})" id="prev-page-btn">← Previous</button>
          <button class="btn btn-outline btn-sm" ${state.studentPagination.page >= state.studentPagination.totalPages ? 'disabled' : ''} onclick="loadStudents(${state.studentPagination.page + 1})" id="next-page-btn">Next →</button>
        </div>
      </div>
    </div>
  `;
}

function formatDob(dob) {
  if (!dob) return '—';
  try {
    const d = new Date(dob);
    return d.toLocaleDateString('en-IN');
  } catch (e) { return dob; }
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function changeStudentStatusFilter(value) {
  state.studentStatusFilter = value;
  state.studentsLoaded = false;
  state.studentSearch = '';
  loadStudents(1);
  const container = document.getElementById('tab-content-container');
  if (container && state.activeTab === 'students') container.innerHTML = renderTableSkeleton('Student Records', 5);
}

function handleStudentSearch() {
  const val = document.getElementById('student-search-input')?.value || '';
  state.studentSearch = val;
  state.studentsLoaded = false;
  loadStudents(1);
  const container = document.getElementById('tab-content-container');
  if (container && state.activeTab === 'students') container.innerHTML = renderTableSkeleton('Student Records', 5);
}

function getFeeBadgeClass(status) {
  const map = { Paid: 'badge-paid', Pending: 'badge-pending', Overdue: 'badge-overdue', 'Verification Pending': 'badge-verification', Failed: 'badge-failed' };
  return map[status] || 'badge-pending';
}

// Mark student inactive modal
function openMarkInactiveModal(studentId, studentName) {
  openModal(`Mark as Inactive: ${escHtml(studentName)}`, `
    <div>
      <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:var(--radius-sm); padding:1rem; margin-bottom:1.25rem; font-size:0.875rem; color:#7f1d1d;">
        <strong>⚠️ Important:</strong> This will mark <strong>${escHtml(studentName)}</strong> as Inactive / Left.
        Their records, fee history, and batch assignments are <strong>permanently preserved</strong> and viewable under "Inactive" filter.
      </div>
      <div class="form-group" style="margin-bottom:1.5rem;">
        <label class="form-label">Reason for Leaving<span class="required-star">*</span></label>
        <textarea id="leaving-reason-input" class="form-control" rows="3" placeholder="e.g. Relocated to another city, Completed arangetram, Personal reasons…" required></textarea>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" style="background:#b91c1c; border-color:#b91c1c;" onclick="confirmMarkInactive(${studentId})" id="confirm-inactive-btn">Confirm: Mark Inactive</button>
      </div>
    </div>
  `);
}

async function confirmMarkInactive(studentId) {
  const reason = document.getElementById('leaving-reason-input')?.value?.trim();
  if (!reason) { showAlert('Please provide a reason for leaving.', 'danger'); return; }
  const btn = document.getElementById('confirm-inactive-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Processing...'; }
  try {
    const res = await api(`/api/students/${studentId}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({ leaving_reason: reason })
    });
    showAlert(res.message, 'success');
    closeModal();
    state.studentsLoaded = false;
    state.dashboardStats = null;
    await Promise.all([loadStudents(state.studentPagination.page), loadDashboardStats()]);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Confirm: Mark Inactive'; }
  }
}

async function reactivateStudent(studentId, studentName) {
  if (!confirm(`Reactivate student "${studentName}"? This will set their status back to Active.`)) return;
  try {
    const res = await api(`/api/students/${studentId}/reactivate`, { method: 'POST', body: JSON.stringify({}) });
    showAlert(res.message, 'success');
    state.studentsLoaded = false;
    state.dashboardStats = null;
    await Promise.all([loadStudents(state.studentPagination.page), loadDashboardStats()]);
  } catch (err) { }
}

async function openAllocateBatchModal(studentId, studentName, currentBatchId) {
  if (!state.batchesLoaded) {
    await loadBatches();
  }
  openModal(`Batch Allocation: ${escHtml(studentName)}`, `
    <div>
      <p style="font-size:0.875rem; color:var(--sdn-text-muted); margin-bottom:1.25rem;">
        Assign or reallocate the dance curriculum batch for <strong>${escHtml(studentName)}</strong>.
      </p>
      <div class="form-group" style="margin-bottom:1.25rem;">
        <label class="form-label">Dance Curriculum Batch<span class="required-star">*</span></label>
        <select id="modal-batch-select" class="form-control" style="font-size:0.9rem;">
          <option value="">— Unassigned / Remove Batch —</option>
          ${state.batches.map(b => `
            <option value="${b.id}" ${b.id === currentBatchId ? 'selected' : ''}>
              ${escHtml(b.batch_name)} (${escHtml(b.level)}) &bull; ${escHtml(b.schedule)} &bull; Guru: ${escHtml(b.instructor)}
            </option>
          `).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:1.5rem;">
        <label class="form-label">Allocation Notes (Optional)</label>
        <input type="text" id="modal-batch-notes" class="form-control" placeholder="e.g. Assigned to Beginner Margam, transferred schedule...">
      </div>
      <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitModalBatchAllocation(${studentId})" id="modal-save-batch-btn">Save Allocation</button>
      </div>
    </div>
  `);
}

async function submitModalBatchAllocation(studentId) {
  const select = document.getElementById('modal-batch-select');
  const notesInput = document.getElementById('modal-batch-notes');
  const btn = document.getElementById('modal-save-batch-btn');
  const batchId = select?.value;
  const notes = notesInput?.value;

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Saving...'; }

  try {
    const res = await api('/api/enrollments/assign', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, batch_id: batchId || null, notes })
    });
    showAlert(res.message, 'success');
    closeModal();
    state.batchesLoaded = false;
    state.studentsLoaded = false;
    state.dashboardStats = null;
    await Promise.all([loadBatches(), loadStudents(state.studentPagination.page), loadDashboardStats()]);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Save Allocation'; }
  }
}

async function saveBatchAllocationFromModal(studentId) {
  const select = document.getElementById(`detail-batch-select-${studentId}`);
  const btn = document.getElementById('detail-save-batch-btn');
  const batchId = select?.value;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span>'; }

  try {
    const res = await api('/api/enrollments/assign', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, batch_id: batchId || null })
    });
    showAlert(res.message, 'success');
    state.batchesLoaded = false;
    state.studentsLoaded = false;
    state.dashboardStats = null;
    await Promise.all([loadBatches(), loadStudents(state.studentPagination.page), loadDashboardStats()]);
    // Refresh student profile view
    viewStudentDetails(studentId);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Update Batch'; }
  }
}

async function viewStudentDetails(studentId) {
  try {
    if (!state.batchesLoaded) await loadBatches();
    const res = await api(`/api/students/${studentId}`);
    const st = res.student;
    const isMgmt = state.user?.role === 'MANAGEMENT';
    const isInactive = st.admission_status !== 'ACTIVE';

    openModal(`Student Profile: ${escHtml(st.name)}`, `
      <div>
        <!-- Header with photo -->
        <div style="display:flex; gap:1.25rem; align-items:flex-start; margin-bottom:1.25rem;">
          <div style="width:76px; height:76px; border-radius:50%; background:var(--sdn-surface-subtle); border:2.5px solid var(--sdn-gold); display:flex; align-items:center; justify-content:center; font-size:1.4rem; font-weight:bold; color:var(--sdn-red); overflow:hidden; flex-shrink:0;">
            ${st.photo_url ? `<img src="${escHtml(st.photo_url)}" style="width:100%; height:100%; object-fit:cover;">` : escHtml(st.name.charAt(0))}
          </div>
          <div style="flex:1;">
            <h3 style="color:var(--sdn-maroon); font-size:1.15rem;">${escHtml(st.name)}</h3>
            <p style="font-size:0.82rem; color:var(--sdn-text-muted);">${st.student_id_code} &bull; DOB: ${st.date_of_birth ? formatDob(st.date_of_birth) : '—'}${st.age ? ` (Age: ${st.age})` : ''} &bull; Registered: ${new Date(st.created_at).toLocaleDateString('en-IN')}</p>
            ${isInactive ? `<p style="margin-top:0.4rem;"><span class="badge badge-overdue">Inactive / Left</span> ${st.left_at ? `on ${new Date(st.left_at).toLocaleDateString('en-IN')}` : ''}</p>` : ''}
          </div>
        </div>

        <!-- Batch Allocation Card beside Student Records -->
        <div style="background:#fdfcfb; border:1.5px solid #f1e5d1; border-radius:8px; padding:1rem; margin-bottom:1.25rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem; flex-wrap:wrap; gap:0.5rem;">
            <div style="font-size:0.88rem; font-weight:700; color:var(--sdn-maroon); display:flex; align-items:center; gap:0.4rem;">
              <span>🎯</span> BATCH ALLOCATION
            </div>
            <span class="badge ${st.batch_name ? 'badge-active' : 'badge-pending'}">${st.batch_name ? escHtml(st.batch_name) : 'Unassigned'}</span>
          </div>
          <div style="font-size:0.82rem; color:var(--sdn-text-muted); display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:0.5rem; margin-bottom:0.75rem;">
            <div><strong>Level:</strong> ${st.batch_level ? escHtml(st.batch_level) : '—'}</div>
            <div><strong>Schedule:</strong> ${st.schedule ? escHtml(st.schedule) : '—'}</div>
            <div><strong>Guru / Instructor:</strong> ${st.instructor ? escHtml(st.instructor) : '—'}</div>
          </div>
          ${!isInactive ? `
            <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; border-top:1px dashed #e5d7c3; padding-top:0.6rem;">
              <label style="font-size:0.8rem; font-weight:600; color:var(--sdn-text);">Assign / Change Batch:</label>
              <select id="detail-batch-select-${st.id}" class="form-control" style="font-size:0.82rem; flex:1; min-width:180px; max-width:280px;">
                <option value="">— Unassigned —</option>
                ${state.batches.map(b => `<option value="${b.id}" ${b.id === st.batch_id ? 'selected' : ''}>${escHtml(b.batch_name)} (${escHtml(b.schedule)})</option>`).join('')}
              </select>
              <button class="btn btn-primary btn-sm" onclick="saveBatchAllocationFromModal(${st.id})" id="detail-save-batch-btn">Update Batch</button>
            </div>
          ` : '<div style="font-size:0.78rem; color:#b91c1c; font-style:italic;">Student is inactive. Batch allocation is withdrawn.</div>'}
        </div>

        <!-- Personal Details Grid -->
        <div class="form-grid" style="margin-bottom:1.25rem; gap:1rem;">
          <div><span style="color:var(--sdn-text-muted); font-size:0.8rem;">WHATSAPP / PHONE</span><div style="font-weight:600; margin-top:2px;">${escHtml(st.phone)}</div></div>
          ${st.email ? `<div><span style="color:var(--sdn-text-muted); font-size:0.8rem;">EMAIL</span><div style="font-weight:600; margin-top:2px;">${escHtml(st.email)}</div></div>` : ''}
          ${st.mother_tongue ? `<div><span style="color:var(--sdn-text-muted); font-size:0.8rem;">MOTHER TONGUE</span><div style="font-weight:600; margin-top:2px;">${escHtml(st.mother_tongue)}</div></div>` : ''}
          ${st.father_name ? `<div><span style="color:var(--sdn-text-muted); font-size:0.8rem;">FATHER'S NAME</span><div style="font-weight:600; margin-top:2px;">${escHtml(st.father_name)}</div></div>` : ''}
          ${st.mother_name ? `<div><span style="color:var(--sdn-text-muted); font-size:0.8rem;">MOTHER'S NAME</span><div style="font-weight:600; margin-top:2px;">${escHtml(st.mother_name)}</div></div>` : ''}
          ${st.educational_qualification ? `<div><span style="color:var(--sdn-text-muted); font-size:0.8rem;">EDUCATION</span><div style="font-weight:600; margin-top:2px;">${escHtml(st.educational_qualification)}</div></div>` : ''}
          ${st.address ? `<div style="grid-column:1/-1;"><span style="color:var(--sdn-text-muted); font-size:0.8rem;">ADDRESS</span><div style="font-weight:600; margin-top:2px;">${escHtml(st.address)}</div></div>` : ''}
          ${st.previous_experience ? `<div style="grid-column:1/-1;"><span style="color:var(--sdn-text-muted); font-size:0.8rem;">DANCE EXPERIENCE</span><div style="font-weight:600; margin-top:2px;">${escHtml(st.previous_experience)}</div></div>` : ''}
          ${isInactive && st.leaving_reason ? `<div style="grid-column:1/-1;"><span style="color:var(--sdn-text-muted); font-size:0.8rem;">REASON FOR LEAVING</span><div style="font-weight:600; margin-top:2px; color:#b91c1c;">${escHtml(st.leaving_reason)}</div></div>` : ''}
        </div>

        ${isMgmt ? (() => {
        const joinDate = new Date(st.created_at || Date.now());
        const now = new Date();
        const startYear = joinDate.getFullYear();
        const startMonth = joinDate.getMonth();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        const monthList = [];
        let y = startYear, m = startMonth;
        while (y < currentYear || (y === currentYear && m <= currentMonth)) {
          monthList.push({ monthName: ALL_MONTHS[m], year: y, label: `${ALL_MONTHS[m]} ${y}` });
          m++;
          if (m > 11) { m = 0; y++; }
        }

        const monthlyCards = monthList.map(ml => {
          const feeMatch = res.fees.find(f => {
            const ft = (f.fee_type || '').toLowerCase();
            return ft.includes(ml.monthName.toLowerCase()) && (ft.includes(String(ml.year)) || (!ft.includes('202') && ml.year === currentYear));
          });

          let status = 'Not Billed', badgeClass = 'status-not-billed', amount = '—', ref = '';
          if (feeMatch) {
            status = feeMatch.status;
            amount = `₹${Number(feeMatch.amount).toFixed(2)}`;
            if (status === 'Paid') { badgeClass = 'status-paid'; ref = feeMatch.payment_reference ? `Ref: ${feeMatch.payment_reference}` : 'Confirmed'; }
            else if (status === 'Pending') { badgeClass = 'status-pending'; ref = `Due: ${feeMatch.due_date || 'N/A'}`; }
            else if (status === 'Overdue') { badgeClass = 'status-overdue'; ref = `Due: ${feeMatch.due_date || 'N/A'}`; }
            else { badgeClass = 'status-pending'; ref = feeMatch.status; }
          }
          return `
              <div class="monthly-fee-card ${badgeClass}">
                <div>
                  <div class="month-card-title">${ml.label}</div>
                  <div class="month-card-sub">${feeMatch ? escHtml(feeMatch.fee_type) : 'Monthly Tuition Fee'}</div>
                </div>
                <div style="margin-top:0.75rem; display:flex; justify-content:space-between; align-items:flex-end;">
                  <div>
                    <div style="font-size:0.95rem; font-weight:800; color:var(--sdn-maroon);">${amount}</div>
                    ${ref ? `<div style="font-size:0.72rem; color:var(--sdn-text-muted);">${escHtml(ref)}</div>` : ''}
                  </div>
                  <span class="badge ${getFeeBadgeClass(status)}">${status}</span>
                </div>
              </div>
            `;
        }).reverse();

        return `
            <div style="margin-top:1.5rem; border-top:1px solid var(--sdn-border); padding-top:1.25rem;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem; flex-wrap:wrap; gap:0.5rem;">
                <h4 style="color:var(--sdn-maroon); font-size:1rem;">Monthly Payment Status (From: ${ALL_MONTHS[startMonth]} ${startYear})</h4>
                <span style="font-size:0.78rem; color:var(--sdn-text-muted);">Due date: 7th of each month &bull; ${monthList.length} months tracked</span>
              </div>
              <div class="payment-history-timeline">${monthlyCards.join('')}</div>
            </div>

            <h4 style="color:var(--sdn-maroon); font-size:0.95rem; border-bottom:1px solid var(--sdn-border); padding-bottom:0.35rem; margin-top:1.5rem; margin-bottom:0.75rem;">All Fee Records &amp; Receipts</h4>
            <div class="table-responsive">
              <table class="sdn-table">
                <thead><tr><th>Fee Type</th><th>Amount</th><th>Due Date (7th)</th><th>Status</th><th>Ref</th></tr></thead>
                <tbody>
                  ${res.fees.length ? res.fees.map(f => `
                    <tr>
                      <td>${escHtml(f.fee_type)}</td>
                      <td>₹${Number(f.amount).toFixed(2)}</td>
                      <td>${f.due_date}</td>
                      <td><span class="badge ${getFeeBadgeClass(f.status)}">${f.status}</span></td>
                      <td style="font-size:0.8rem; color:var(--sdn-text-muted);">${escHtml(f.payment_reference || '—')}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="5" style="text-align:center; color:var(--sdn-text-light); padding:1.25rem;">No fee records yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          `;
      })() : ''}
      </div>
    `);
  } catch (e) { }
}

async function openEditStudentModal(studentId) {
  try {
    const res = await api(`/api/students/${studentId}`);
    const st = res.student;
    openModal(`Edit Student: ${escHtml(st.name)}`, `
      <form onsubmit="handleUpdateStudent(event, ${st.id})" enctype="multipart/form-data">
        <h4 style="color:var(--sdn-maroon); font-size:0.95rem; margin-bottom:1rem;">Primary Details</h4>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Student Name<span class="required-star">*</span></label>
            <input type="text" id="edit-name" class="form-control" value="${escHtml(st.name)}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Date of Birth<span class="required-star">*</span></label>
            <input type="date" id="edit-dob" class="form-control" value="${st.date_of_birth || ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label">WhatsApp Contact<span class="required-star">*</span></label>
            <input type="tel" id="edit-phone" class="form-control" value="${escHtml(st.phone)}" required pattern="[0-9]{10}" maxlength="10" minlength="10" oninput="this.value = this.value.replace(/[^0-9]/g, '').slice(0, 10)">
          </div>
          <div class="form-group">
            <label class="form-label">Mother Tongue</label>
            <input type="text" id="edit-mother-tongue" class="form-control" value="${escHtml(st.mother_tongue || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Father's Name</label>
            <input type="text" id="edit-father" class="form-control" value="${escHtml(st.father_name || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Mother's Name</label>
            <input type="text" id="edit-mother" class="form-control" value="${escHtml(st.mother_name || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Email ID</label>
            <input type="email" id="edit-email" class="form-control" value="${escHtml(st.email || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Educational Qualification</label>
            <input type="text" id="edit-edu" class="form-control" value="${escHtml(st.educational_qualification || '')}">
          </div>
          <div class="form-group full-width">
            <label class="form-label">Previous Dance Experience</label>
            <textarea id="edit-experience" class="form-control" rows="2">${escHtml(st.previous_experience || '')}</textarea>
          </div>
          <div class="form-group full-width">
            <label class="form-label">Residential Address</label>
            <textarea id="edit-address" class="form-control" rows="2">${escHtml(st.address || '')}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Student Photo (upload new to replace)</label>
            <input type="file" id="edit-photo" name="photo" class="form-control" accept="image/jpeg,image/png,image/webp">
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select id="edit-status" class="form-control" onchange="toggleLeavingReason(this.value)">
              <option value="ACTIVE" ${st.admission_status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
              <option value="INACTIVE" ${st.admission_status === 'INACTIVE' ? 'selected' : ''}>INACTIVE (Left)</option>
              <option value="ON_LEAVE" ${st.admission_status === 'ON_LEAVE' ? 'selected' : ''}>ON LEAVE</option>
            </select>
          </div>
          <div class="form-group full-width" id="leaving-reason-group" style="display:${st.admission_status === 'INACTIVE' ? 'block' : 'none'};">
            <label class="form-label">Reason for Leaving<span class="required-star">*</span></label>
            <textarea id="edit-leaving-reason" class="form-control" rows="2">${escHtml(st.leaving_reason || '')}</textarea>
          </div>
        </div>
        <div style="margin-top:1.5rem; display:flex; justify-content:flex-end; gap:0.75rem;">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="update-stu-btn">Save Changes</button>
        </div>
      </form>
    `);
  } catch (e) { }
}

function toggleLeavingReason(status) {
  const grp = document.getElementById('leaving-reason-group');
  if (grp) grp.style.display = (status === 'INACTIVE' || status === 'WITHDRAWN') ? 'block' : 'none';
}

async function handleUpdateStudent(e, studentId) {
  e.preventDefault();
  const btn = document.getElementById('update-stu-btn');
  const phoneVal = (document.getElementById('edit-phone')?.value || '').replace(/\D/g, '');
  if (phoneVal.length !== 10) { showAlert('Please enter a valid 10-digit WhatsApp number.', 'danger'); return; }

  const status = document.getElementById('edit-status')?.value;
  const leavingReason = document.getElementById('edit-leaving-reason')?.value || '';
  if ((status === 'INACTIVE' || status === 'WITHDRAWN') && !leavingReason.trim()) {
    showAlert('Reason for Leaving is required when marking a student Inactive.', 'danger');
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Saving...'; }

  // Use FormData to support photo upload in edit
  const formData = new FormData();
  formData.append('name', document.getElementById('edit-name').value);
  formData.append('date_of_birth', document.getElementById('edit-dob').value);
  formData.append('phone', phoneVal);
  formData.append('email', document.getElementById('edit-email')?.value || '');
  formData.append('mother_tongue', document.getElementById('edit-mother-tongue')?.value || '');
  formData.append('father_name', document.getElementById('edit-father')?.value || '');
  formData.append('mother_name', document.getElementById('edit-mother')?.value || '');
  formData.append('address', document.getElementById('edit-address')?.value || '');
  formData.append('educational_qualification', document.getElementById('edit-edu')?.value || '');
  formData.append('previous_experience', document.getElementById('edit-experience')?.value || '');
  formData.append('admission_status', status);
  formData.append('leaving_reason', leavingReason);
  const photoFile = document.getElementById('edit-photo')?.files[0];
  if (photoFile) formData.append('photo', photoFile);

  try {
    await api(`/api/students/${studentId}`, { method: 'PUT', body: formData });
    showAlert('Student details updated successfully', 'success');
    closeModal();
    state.studentsLoaded = false;
    state.dashboardStats = null;
    await Promise.all([loadStudents(state.studentPagination.page), loadDashboardStats()]);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Save Changes'; }
  }
}

// ============================================
// FEE MANAGEMENT VIEW
// ============================================
function renderFeeManagementView() {
  return `
    <div class="sdn-card animate-fade">
      <div class="sdn-card-header">
        <div>
          <h2 class="sdn-card-title">Fee Management &amp; Verification</h2>
          <p style="font-size:0.875rem; color:var(--sdn-text-muted); margin-top:3px;">Track dues, verify payments, send reminders. Monthly fees due on the <strong>7th of each month</strong>.</p>
        </div>
        <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
          <select id="fee-status-filter" class="form-control" style="width:auto;" onchange="filterFeeStatus(this.value)">
            <option value="ALL" ${state.feeStatusFilter === 'ALL' ? 'selected' : ''}>All Statuses</option>
            <option value="Pending" ${state.feeStatusFilter === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="Verification Pending" ${state.feeStatusFilter === 'Verification Pending' ? 'selected' : ''}>Verification Pending</option>
            <option value="Paid" ${state.feeStatusFilter === 'Paid' ? 'selected' : ''}>Paid</option>
            <option value="Overdue" ${state.feeStatusFilter === 'Overdue' ? 'selected' : ''}>Overdue</option>
          </select>
          <button class="btn btn-gold btn-sm" onclick="openBroadcastReminderModal()" id="broadcast-btn">📢 Send Reminders to All</button>
          <button class="btn btn-primary btn-sm" onclick="openGenerateMonthlyFeeModal()" id="generate-monthly-fee-btn">📅 Generate Monthly Fees</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="sdn-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Fee Description</th>
              <th>Amount</th>
              <th>Due Date</th>
              <th>Status</th>
              <th>Payment Details</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${state.fees.length ? state.fees.map(f => `
              <tr>
                <td>
                  <div style="font-weight:700; color:var(--sdn-maroon);">${escHtml(f.student_name)}</div>
                  <div style="font-size:0.74rem; color:var(--sdn-text-light);">${f.student_id_code} &bull; ${f.student_phone}</div>
                  ${f.admission_status !== 'ACTIVE' ? `<span class="badge badge-overdue" style="font-size:0.65rem;">Inactive</span>` : ''}
                </td>
                <td>
                  <div style="font-weight:600;">${escHtml(f.fee_type)}</div>
                  ${f.description ? `<div style="font-size:0.74rem; color:var(--sdn-text-light);">${escHtml(f.description)}</div>` : ''}
                </td>
                <td style="font-weight:700;">₹${Number(f.amount).toFixed(2)}</td>
                <td>${f.due_date}</td>
                <td><span class="badge ${getFeeBadgeClass(f.status)}">${f.status}</span></td>
                <td>
                  ${f.payment_reference
      ? `<div style="font-size:0.82rem; font-weight:600;">Ref: ${escHtml(f.payment_reference)}</div><div style="font-size:0.74rem; color:var(--sdn-text-light);">${f.payment_method || 'Online'}</div>`
      : f.payment_evidence_url
        ? `<a href="${f.payment_evidence_url}" target="_blank" style="font-size:0.8rem; color:var(--sdn-info);">View Evidence</a>`
        : `<span style="color:#aaa; font-size:0.82rem;">—</span>`}
                </td>
                <td>
                  <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                    ${f.status !== 'Paid' ? `
                      <button class="btn btn-outline btn-sm" onclick="openPaymentVerifyModal(${f.id})" id="verify-fee-${f.id}">Verify</button>
                      <button class="btn btn-outline btn-sm" onclick="openReminderModal(${f.id})" id="remind-fee-${f.id}">Remind</button>
                    ` : `
                      ${f.invoice_number
      ? `<button class="btn btn-outline btn-sm" onclick="navigateTo('invoices')" id="view-inv-${f.id}">📄 ${f.invoice_number}</button>`
      : `<button class="btn btn-gold btn-sm" onclick="generateInvoiceForFee(${f.id})" id="gen-inv-${f.id}">Generate Invoice</button>`}
                    `}
                  </div>
                </td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="7">
                  <div class="empty-state">
                    <div class="empty-state-icon">💳</div>
                    <h3>No Fee Records Found</h3>
                    <p>Click "Generate Monthly Fees" above to bill all active students. Monthly fees are due on the <strong>7th of each month</strong>.</p>
                  </div>
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>

      <div class="pagination-bar">
        <span class="pagination-info">Page ${state.feePagination.page} of ${state.feePagination.totalPages} &bull; ${state.feePagination.total} Total Fees</span>
        <div class="pagination-controls">
          <button class="btn btn-outline btn-sm" ${state.feePagination.page <= 1 ? 'disabled' : ''} onclick="goFeePagePrev()" id="fee-prev-btn">← Previous</button>
          <button class="btn btn-outline btn-sm" ${state.feePagination.page >= state.feePagination.totalPages ? 'disabled' : ''} onclick="goFeePageNext()" id="fee-next-btn">Next →</button>
        </div>
      </div>
    </div>
  `;
}

function goFeePagePrev() { if (state.feePagination.page > 1) { state.feesLoaded = false; loadFees(state.feePagination.page - 1); } }
function goFeePageNext() { if (state.feePagination.page < state.feePagination.totalPages) { state.feesLoaded = false; loadFees(state.feePagination.page + 1); } }

function filterFeeStatus(status) {
  state.feeStatusFilter = status;
  state.feesLoaded = false;
  const container = document.getElementById('tab-content-container');
  if (container) container.innerHTML = renderTableSkeleton('Fee Management', 5);
  loadFees(1);
}

let selectedFeePickerMonth = new Date().toLocaleString('en-IN', { month: 'long' });
let selectedFeePickerYear = new Date().getFullYear();
let selectedReminderMonth = new Date().toLocaleString('en-IN', { month: 'long' });
let selectedReminderYear = new Date().getFullYear();

const ALL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function selectFeeMonth(monthName) {
  selectedFeePickerMonth = monthName;
  document.querySelectorAll('#fee-gen-months .month-chip').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-month') === monthName);
  });
  updateFeeDescPreview();
}

function selectFeeYear(yearVal) {
  selectedFeePickerYear = parseInt(yearVal, 10);
  updateFeeDescPreview();
}

function updateFeeDescPreview() {
  const descInput = document.getElementById('gen-fee-desc');
  if (descInput) descInput.value = `Monthly Tuition Fee for ${selectedFeePickerMonth} ${selectedFeePickerYear}`;
  // Auto-set due date to 7th
  const dueInput = document.getElementById('gen-fee-due');
  if (dueInput) {
    const monthIdx = ALL_MONTHS.indexOf(selectedFeePickerMonth);
    if (monthIdx !== -1) {
      const d = new Date(selectedFeePickerYear, monthIdx, 7);
      dueInput.value = d.toISOString().split('T')[0];
    }
  }
}

function openGenerateMonthlyFeeModal() {
  const currentMonth = new Date().toLocaleString('en-IN', { month: 'long' });
  const currentYear = new Date().getFullYear();
  selectedFeePickerMonth = currentMonth;
  selectedFeePickerYear = currentYear;

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
  const monthIdx = ALL_MONTHS.indexOf(currentMonth);
  const dueDateVal = monthIdx !== -1
    ? new Date(currentYear, monthIdx, 7).toISOString().split('T')[0]
    : '';

  openModal('📅 Monthly Fee Generation for All Active Students', `
    <form onsubmit="handleGenerateMonthlyFees(event)">
      <div style="background:var(--sdn-gold-light); border:1px solid var(--sdn-gold); border-radius:var(--radius-sm); padding:1rem 1.25rem; margin-bottom:1.25rem;">
        <h4 style="color:var(--sdn-maroon); font-size:1rem; margin-bottom:0.25rem;">Simultaneous Monthly Billing</h4>
        <p style="font-size:0.85rem; color:var(--sdn-text-muted);">
          Generates fee records for <strong>all active students</strong> at once. Due date is automatically set to the <strong>7th of the selected month</strong>. Existing records for the same month are skipped to prevent duplicates.
        </p>
      </div>

      <div class="calendar-month-picker">
        <div class="calendar-month-header">
          <label class="form-label" style="margin:0; font-weight:700;">Select Billing Month &amp; Year<span class="required-star">*</span></label>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:0.85rem; font-weight:600; color:var(--sdn-maroon);">Year:</span>
            <select id="fee-gen-year" class="form-control" style="width:auto; padding:0.35rem 0.75rem; font-weight:700;" onchange="selectFeeYear(this.value)">
              ${yearOptions.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="month-grid" id="fee-gen-months">
          ${ALL_MONTHS.map(m => `
            <button type="button" class="month-chip ${m === currentMonth ? 'active' : ''}" data-month="${m}" onclick="selectFeeMonth('${m}')">
              ${m}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Monthly Amount per Student (₹)<span class="required-star">*</span></label>
          <input type="number" id="gen-fee-amount" class="form-control" min="100" step="50" value="2000" required>
        </div>
        <div class="form-group">
          <label class="form-label">Due Date <span style="color:var(--sdn-text-muted); font-weight:400;">(Fixed: 7th of Month)</span></label>
          <input type="date" id="gen-fee-due" class="form-control" value="${dueDateVal}" readonly style="background:var(--sdn-surface-subtle); cursor:not-allowed;">
        </div>
        <div class="form-group full-width">
          <label class="form-label">Fee Description / Remarks</label>
          <input type="text" id="gen-fee-desc" class="form-control" value="Monthly Tuition Fee for ${currentMonth} ${currentYear}">
        </div>
      </div>

      <div style="margin-top:1.5rem; display:flex; justify-content:flex-end; gap:0.75rem;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="gen-monthly-fee-btn">✓ Generate Fees for All Students</button>
      </div>
    </form>
  `);
}

async function handleGenerateMonthlyFees(e) {
  e.preventDefault();
  const btn = document.getElementById('gen-monthly-fee-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Generating for all students...'; }

  const amount = document.getElementById('gen-fee-amount')?.value;
  const description = document.getElementById('gen-fee-desc')?.value;

  try {
    const res = await api('/api/fees/generate-monthly', {
      method: 'POST',
      body: JSON.stringify({ month: selectedFeePickerMonth, year: selectedFeePickerYear, amount, description })
    });
    showAlert(res.message, 'success');
    closeModal();
    state.feesLoaded = false;
    state.dashboardStats = null;
    loadFees(1);
    loadDashboardStats();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = '✓ Generate Fees for All Students'; }
  }
}

function openPaymentVerifyModal(feeId) {
  const fee = state.fees.find(f => f.id === feeId);
  if (!fee) return;

  openModal(`Verify Payment: ${escHtml(fee.student_name)}`, `
    <div>
      <div style="background:var(--sdn-surface-subtle); padding:1rem; border-radius:var(--radius-sm); margin-bottom:1.25rem;">
        <p><strong>Fee:</strong> ${escHtml(fee.fee_type)} (₹${Number(fee.amount).toFixed(2)})</p>
        <p><strong>Student:</strong> ${escHtml(fee.student_name)} (${fee.student_phone})</p>
        <p><strong>Due Date:</strong> ${fee.due_date}</p>
        <p><strong>Status:</strong> <span class="badge ${getFeeBadgeClass(fee.status)}">${fee.status}</span></p>
      </div>
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:var(--radius-sm); padding:0.75rem 1rem; margin-bottom:1.25rem; font-size:0.83rem; color:#15803d;">
        <strong>✅ Auto-action after approval:</strong> An invoice PDF will be automatically generated and sent to the student's WhatsApp number (${fee.student_phone}).
      </div>
      <div class="form-group" style="margin-bottom:1rem;">
        <label class="form-label">Payment Channel / Method<span class="required-star">*</span></label>
        <select id="verify-method" class="form-control">
          <option value="BANK_TRANSFER">Bank NEFT / RTGS Transfer</option>
          <option value="QR_CODE">In-Person Bank UPI QR Code</option>
          <option value="ONLINE_LINK">Online Gateway Link</option>
          <option value="CASH">In-Person Cash</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:1.5rem;">
        <label class="form-label">Bank UTR / Transaction Reference<span class="required-star">*</span></label>
        <input type="text" id="verify-ref" class="form-control" placeholder="e.g. UTR102938491029" value="${fee.payment_reference || ''}">
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
        <button class="btn btn-outline" style="color:var(--sdn-danger); border-color:var(--sdn-danger);" onclick="submitPaymentDecision(${fee.id}, 'REJECT')" id="reject-pay-btn">Reject / Mark Failed</button>
        <div style="display:flex; gap:0.5rem;">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitPaymentDecision(${fee.id}, 'APPROVE')" id="approve-pay-btn">✓ Verify &amp; Confirm</button>
        </div>
      </div>
    </div>
  `);
}

async function submitPaymentDecision(feeId, action) {
  const method = document.getElementById('verify-method')?.value;
  const ref = document.getElementById('verify-ref')?.value;
  const approveBtn = document.getElementById('approve-pay-btn');
  const rejectBtn = document.getElementById('reject-pay-btn');
  if (approveBtn) { approveBtn.disabled = true; approveBtn.innerHTML = '<span class="loading-spinner"></span> Processing...'; }
  if (rejectBtn) rejectBtn.disabled = true;

  try {
    const res = await api(`/api/fees/${feeId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ action, payment_method: method, payment_reference: ref })
    });

    let msg = res.message;
    if (action === 'APPROVE' && res.invoice) {
      if (res.invoice.created) {
        msg += ` Invoice ${res.invoice.invoiceNumber} generated.`;
      }
      if (res.whatsapp) {
        if (res.whatsapp.success) msg += ` Invoice sent to WhatsApp ✓`;
        else if (res.whatsapp.simulated) msg += ` (WhatsApp: credentials pending in .env)`;
        else if (res.whatsapp.error) msg += ` (WhatsApp: ${res.whatsapp.error})`;
      }
    }

    showAlert(msg, 'success');
    closeModal();
    state.feesLoaded = false;
    state.invoicesLoaded = false;
    state.dashboardStats = null;
    loadFees(state.feePagination.page);
    loadDashboardStats();
  } catch (e) {
    if (approveBtn) { approveBtn.disabled = false; approveBtn.innerHTML = '✓ Verify &amp; Confirm'; }
    if (rejectBtn) rejectBtn.disabled = false;
  }
}

function openReminderModal(feeId) {
  const fee = state.fees.find(f => f.id === feeId);
  if (!fee) return;
  const defaultMsg = `Dear Parent/Guardian (${fee.student_name}),\n\nThis is a cordial reminder from Sridevi Nrithyalaya regarding the pending ${fee.fee_type} of ₹${Number(fee.amount).toFixed(2)} due by ${fee.due_date} (7th of the month).\nPlease complete the payment via bank transfer or the Academy UPI: sridevinrithyalaya@indianbank\n\nWarm regards,\nSridevi Nrithyalaya`;

  openModal(`Send Fee Reminder: ${escHtml(fee.student_name)}`, `
    <div>
      <div class="form-group" style="margin-bottom:1rem;">
        <label class="form-label">Reminder Channel</label>
        <div style="display:flex; gap:1.25rem; flex-wrap:wrap;">
          <label style="cursor:pointer; display:flex; align-items:center; gap:0.4rem; font-weight:600;">
            <input type="radio" name="reminder-channel" value="EMAIL" ${fee.student_email ? 'checked' : 'disabled'}> Email (${fee.student_email || 'Not set'})
          </label>
          <label style="cursor:pointer; display:flex; align-items:center; gap:0.4rem; font-weight:600;">
            <input type="radio" name="reminder-channel" value="WHATSAPP" ${!fee.student_email ? 'checked' : ''}> WhatsApp (${fee.student_phone})
          </label>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:1.5rem;">
        <label class="form-label">Message Content</label>
        <textarea id="reminder-msg-text" class="form-control" rows="6">${defaultMsg}</textarea>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitFeeReminder(${fee.id})" id="send-remind-btn">Dispatch Reminder</button>
      </div>
    </div>
  `);
}

async function submitFeeReminder(feeId) {
  const btn = document.getElementById('send-remind-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Sending...'; }
  const channel = document.querySelector('input[name="reminder-channel"]:checked')?.value || 'EMAIL';
  const custom_message = document.getElementById('reminder-msg-text')?.value;
  try {
    const res = await api(`/api/fees/${feeId}/remind`, { method: 'POST', body: JSON.stringify({ channel, custom_message }) });
    showAlert(res.message, 'success');
    closeModal();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Dispatch Reminder'; }
  }
}

async function generateInvoiceForFee(feeId) {
  const btn = document.getElementById(`gen-inv-${feeId}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span>'; }
  try {
    const res = await api('/api/invoices/generate', {
      method: 'POST',
      body: JSON.stringify({ fee_id: feeId, invoice_type: 'GSTIN' })
    });
    showAlert(`${res.message} Navigate to Invoices tab to download.`, 'success');
    state.feesLoaded = false;
    state.invoicesLoaded = false;
    loadFees(state.feePagination.page);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Generate Invoice'; }
  }
}

// ============================================
// ENROLLMENT & BATCH MANAGEMENT
// ============================================
function renderEnrollmentBatchView() {
  const isMgmt = state.user?.role === 'MANAGEMENT';
  // Only show active students in enrollment tab
  const activeStudents = state.students.filter(s => s.admission_status === 'ACTIVE' || !s.admission_status);

  return `
    <div style="display:grid; grid-template-columns:1fr; gap:2rem;" class="animate-fade">
      <!-- Batches Overview -->
      <div class="sdn-card">
        <div class="sdn-card-header">
          <div>
            <h2 class="sdn-card-title">Dance Curriculum Batches</h2>
            <p style="font-size:0.875rem; color:var(--sdn-text-muted); margin-top:3px;">Current batch configurations, timings, and enrolled students.</p>
          </div>
          ${isMgmt ? `<button class="btn btn-outline btn-sm" onclick="openNewBatchModal()" id="add-batch-btn">+ Add New Batch</button>` : ''}
        </div>

        <div class="sdn-card-body" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:1.25rem;">
          ${state.batches.length ? state.batches.map(b => `
            <div class="batch-card" onclick="viewBatchDetails(${b.id})" title="Click to view batch details & enrolled students (A–Z)">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.65rem;">
                <h4 style="color:var(--sdn-maroon); font-size:1.05rem;">${escHtml(b.batch_name)}</h4>
              </div>
              <div style="font-size:0.84rem; color:var(--sdn-text-muted); display:grid; gap:0.4rem;">
                <div><strong>Schedule:</strong> ${escHtml(b.schedule)}</div>
                <div><strong>Guru:</strong> ${escHtml(b.instructor)}</div>
              </div>
              <div style="font-size:0.82rem; font-weight:700; color:var(--sdn-red); margin-top:0.75rem;">
                <span>${b.enrolled_count} student${b.enrolled_count !== 1 ? 's' : ''} enrolled</span>
              </div>
              <div class="batch-card-tag">🔍 Click to view batch students (A–Z) →</div>
            </div>
          `).join('') : `
            <div style="grid-column:1/-1;">
              <div class="empty-state">
                <div class="empty-state-icon">🎭</div>
                <h3>No Batches Configured</h3>
                <p>Create the first dance curriculum batch to start allocating students.</p>
                ${isMgmt ? `<button class="btn btn-primary btn-sm" onclick="openNewBatchModal()" id="first-batch-btn">+ Add New Batch</button>` : ''}
              </div>
            </div>
          `}
        </div>
      </div>

      <!-- Student Batch Allocations -->
      <div class="sdn-card">
        <div class="sdn-card-header">
          <div>
            <h2 class="sdn-card-title">Student Batch Allocations</h2>
            <p style="font-size:0.875rem; color:var(--sdn-text-muted); margin-top:3px;">
              ${isMgmt ? 'Management & Faculty' : 'Faculty'} can assign or change batch allocations for active students.
            </p>
          </div>
        </div>

        <div class="table-responsive">
          <table class="sdn-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Date of Birth</th>
                <th>WhatsApp</th>
                <th>Current Batch</th>
                <th>Assign Batch</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${activeStudents.length ? activeStudents.map(st => `
                <tr>
                  <td>
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                      <div style="width:32px; height:32px; border-radius:50%; background:var(--sdn-surface-subtle); border:2px solid var(--sdn-gold); display:flex; align-items:center; justify-content:center; font-size:0.8rem; font-weight:bold; color:var(--sdn-red); overflow:hidden; flex-shrink:0;">
                        ${st.photo_url ? `<img src="${escHtml(st.photo_url)}" style="width:100%; height:100%; object-fit:cover;">` : escHtml(st.name.charAt(0))}
                      </div>
                      <div>
                        <div style="font-weight:700; color:var(--sdn-maroon);">${escHtml(st.name)}</div>
                        <div style="font-size:0.74rem; color:var(--sdn-text-light);">${st.student_id_code}</div>
                      </div>
                    </div>
                  </td>
                  <td>${st.date_of_birth ? formatDob(st.date_of_birth) : (st.age ? `~${st.age} yrs` : '—')}</td>
                  <td>${st.phone}</td>
                  <td>
                    ${st.batch_name
      ? `<span class="badge badge-active">${escHtml(st.batch_name)}</span>`
      : `<span style="color:#aaa; font-size:0.82rem;">Unassigned</span>`}
                  </td>
                  <td>
                    <select id="batch-assign-select-${st.id}" class="form-control" style="font-size:0.84rem; width:100%; max-width:260px;">
                      <option value="">— Unassigned —</option>
                      ${state.batches.map(b => `<option value="${b.id}" ${b.id === st.batch_id ? 'selected' : ''}>${escHtml(b.batch_name)}</option>`).join('')}
                    </select>
                  </td>
                  <td>
                    <button class="btn btn-primary btn-sm" onclick="saveBatchAllocation(${st.id})" id="save-batch-${st.id}">Save</button>
                  </td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="6">
                    <div class="empty-state">
                      <div class="empty-state-icon">👥</div>
                      <h3>No Active Students</h3>
                      <p>${isMgmt ? 'Onboard students first to assign them to batches.' : 'No active students found in the system.'}</p>
                    </div>
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function saveBatchAllocation(studentId) {
  const select = document.getElementById(`batch-assign-select-${studentId}`);
  const btn = document.getElementById(`save-batch-${studentId}`);
  const batchId = select?.value;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span>'; }
  try {
    const res = await api('/api/enrollments/assign', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, batch_id: batchId || null })
    });
    showAlert(res.message, 'success');
    state.batchesLoaded = false;
    state.studentsLoaded = false;
    state.dashboardStats = null;
    await Promise.all([loadBatches(), loadStudents(state.studentPagination.page), loadDashboardStats()]);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Save'; }
  }
}

async function viewBatchDetails(batchId) {
  try {
    const res = await api(`/api/batches/${batchId}`);
    const b = res.batch;
    const students = res.students || [];

    openModal(`Batch Details: ${escHtml(b.batch_name)}`, `
      <div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:0.85rem; margin-bottom:1.5rem;">
          <div class="batch-detail-metric">
            <div class="batch-detail-metric-label">Schedule &amp; Timings</div>
            <div class="batch-detail-metric-val" style="font-size:0.95rem;">${escHtml(b.schedule)}</div>
          </div>
          <div class="batch-detail-metric">
            <div class="batch-detail-metric-label">Guru / Instructor</div>
            <div class="batch-detail-metric-val" style="font-size:0.95rem;">${escHtml(b.instructor)}</div>
          </div>
          <div class="batch-detail-metric">
            <div class="batch-detail-metric-label">Total Enrolled</div>
            <div class="batch-detail-metric-val" style="color:var(--sdn-red);">${b.enrolled_count} Active Student${b.enrolled_count !== 1 ? 's' : ''}</div>
          </div>
        </div>

        <h4 style="color:var(--sdn-maroon); font-size:1.05rem; margin-bottom:0.75rem; border-bottom:1px solid var(--sdn-border); padding-bottom:0.4rem; display:flex; justify-content:space-between; align-items:center;">
          <span>Enrolled Students (Alphabetical A–Z)</span>
          <span class="badge badge-active">${students.length} Student${students.length === 1 ? '' : 's'}</span>
        </h4>

        <div class="table-responsive" style="max-height:380px; overflow-y:auto;">
          <table class="sdn-table">
            <thead>
              <tr>
                <th>#</th>
                <th>ID &amp; Name</th>
                <th>Date of Birth</th>
                <th>Contact</th>
                <th>Parent(s)</th>
                <th>Enrolled Date</th>
              </tr>
            </thead>
            <tbody>
              ${students.length ? students.map((st, idx) => `
                <tr>
                  <td style="color:var(--sdn-text-muted); font-weight:600;">${idx + 1}</td>
                  <td>
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                      <div style="width:28px; height:28px; border-radius:50%; background:var(--sdn-surface-subtle); border:1.5px solid var(--sdn-gold); display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:bold; color:var(--sdn-red); overflow:hidden; flex-shrink:0;">
                        ${st.photo_url ? `<img src="${escHtml(st.photo_url)}" style="width:100%; height:100%; object-fit:cover;">` : escHtml(st.name.charAt(0))}
                      </div>
                      <div>
                        <div style="font-weight:700; color:var(--sdn-maroon);">${escHtml(st.name)}</div>
                        <div style="font-size:0.72rem; color:var(--sdn-text-light);">${st.student_id_code}</div>
                      </div>
                    </div>
                  </td>
                  <td>${st.date_of_birth ? formatDob(st.date_of_birth) : (st.age ? `~${st.age} yrs` : '—')}</td>
                  <td>
                    <div>${st.phone}</div>
                    ${st.email ? `<div style="font-size:0.72rem; color:var(--sdn-text-light);">${st.email}</div>` : ''}
                  </td>
                  <td style="font-size:0.84rem;">
                    ${st.father_name ? `<div>${escHtml(st.father_name)}</div>` : ''}
                    ${st.mother_name ? `<div>${escHtml(st.mother_name)}</div>` : ''}
                    ${!st.father_name && !st.mother_name ? '—' : ''}
                  </td>
                  <td style="font-size:0.82rem; color:var(--sdn-text-muted);">${st.enrolled_date || 'Active'}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="6" style="text-align:center; padding:2rem; color:var(--sdn-text-muted);">
                    No students currently allocated to this batch.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>

        <div style="margin-top:1.5rem; display:flex; justify-content:flex-end;">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Close</button>
        </div>
      </div>
    `);
  } catch (err) { }
}

function openNewBatchModal() {
  openModal('Add New Dance Curriculum Batch', `
    <form onsubmit="handleCreateBatch(event)">
      <div class="form-grid">
        <div class="form-group full-width">
          <label class="form-label">Batch Name<span class="required-star">*</span></label>
          <input type="text" id="new-batch-name" class="form-control" placeholder="e.g. Bala Margam Evening Regular" required>
        </div>

        <div class="form-group full-width">
          <label class="form-label">Weekly Schedule (Days)<span class="required-star">*</span></label>
          <div class="day-chips-grid">
            <span class="day-chip active" data-day="Mon" onclick="toggleBatchDay(this)">✓ Mon</span>
            <span class="day-chip" data-day="Tue" onclick="toggleBatchDay(this)">Tue</span>
            <span class="day-chip active" data-day="Wed" onclick="toggleBatchDay(this)">✓ Wed</span>
            <span class="day-chip" data-day="Thu" onclick="toggleBatchDay(this)">Thu</span>
            <span class="day-chip active" data-day="Fri" onclick="toggleBatchDay(this)">✓ Fri</span>
            <span class="day-chip" data-day="Sat" onclick="toggleBatchDay(this)">Sat</span>
            <span class="day-chip" data-day="Sun" onclick="toggleBatchDay(this)">Sun</span>
          </div>
        </div>

        <div class="form-group full-width">
          <label class="form-label">Class Timing Slot<span class="required-star">*</span></label>
          <div class="time-slot-builder">
            <div class="time-picker-row">
              <div style="display:flex; flex-direction:column; gap:0.25rem;">
                <span style="font-size:0.75rem; font-weight:700; color:var(--sdn-text-muted);">Start Time:</span>
                <div style="display:flex; align-items:center; gap:0.4rem;">
                  <div class="time-picker-clock">
                    <span style="font-size:1rem;">⏰</span>
                    <select id="slot-start-hour" class="time-select-input" onchange="updateBatchSchedulePreview()">
                      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => `<option value="${h}" ${h === 5 ? 'selected' : ''}>${String(h).padStart(2, '0')}</option>`).join('')}
                    </select>
                    <span style="font-weight:700; color:var(--sdn-maroon);">:</span>
                    <select id="slot-start-min" class="time-select-input" onchange="updateBatchSchedulePreview()">
                      <option value="00">00</option><option value="15">15</option><option value="30" selected>30</option><option value="45">45</option>
                    </select>
                  </div>
                  <div class="ampm-toggle">
                    <button type="button" class="ampm-btn" data-target="slot-start-ampm" data-val="AM" onclick="setAmPm(this)">AM</button>
                    <button type="button" class="ampm-btn active" data-target="slot-start-ampm" data-val="PM" onclick="setAmPm(this)">PM</button>
                    <input type="hidden" id="slot-start-ampm" value="PM">
                  </div>
                </div>
              </div>
              <div style="font-weight:800; color:var(--sdn-gold); margin-top:1.25rem; font-size:1.1rem;">to</div>
              <div style="display:flex; flex-direction:column; gap:0.25rem;">
                <span style="font-size:0.75rem; font-weight:700; color:var(--sdn-text-muted);">End Time:</span>
                <div style="display:flex; align-items:center; gap:0.4rem;">
                  <div class="time-picker-clock">
                    <span style="font-size:1rem;">⏰</span>
                    <select id="slot-end-hour" class="time-select-input" onchange="updateBatchSchedulePreview()">
                      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => `<option value="${h}" ${h === 7 ? 'selected' : ''}>${String(h).padStart(2, '0')}</option>`).join('')}
                    </select>
                    <span style="font-weight:700; color:var(--sdn-maroon);">:</span>
                    <select id="slot-end-min" class="time-select-input" onchange="updateBatchSchedulePreview()">
                      <option value="00" selected>00</option><option value="15">15</option><option value="30">30</option><option value="45">45</option>
                    </select>
                  </div>
                  <div class="ampm-toggle">
                    <button type="button" class="ampm-btn" data-target="slot-end-ampm" data-val="AM" onclick="setAmPm(this)">AM</button>
                    <button type="button" class="ampm-btn active" data-target="slot-end-ampm" data-val="PM" onclick="setAmPm(this)">PM</button>
                    <input type="hidden" id="slot-end-ampm" value="PM">
                  </div>
                </div>
              </div>
            </div>
            <div style="margin-top:0.75rem;">
              <span style="font-size:0.78rem; font-weight:700; color:var(--sdn-text-muted);">Calculated Schedule Summary:</span>
              <div id="schedule-preview-text" class="schedule-preview-badge">📅 Mon, Wed, Fri &bull; 05:30 PM – 07:00 PM</div>
              <input type="hidden" id="new-batch-sched" value="Mon, Wed, Fri 05:30 PM - 07:00 PM">
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Guru / Instructor<span class="required-star">*</span></label>
          <input type="text" id="new-batch-inst" class="form-control" placeholder="e.g. Guru Dr. Sheela Unnikrishnan" required>
        </div>

        <div class="form-group">
          <label class="form-label">Level / Curriculum</label>
          <input type="text" id="new-batch-level" class="form-control" placeholder="e.g. Bala Margam, Advanced Margam">
        </div>
      </div>

      <div style="margin-top:1.5rem; display:flex; justify-content:flex-end; gap:0.75rem;">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="create-batch-btn">Create Batch</button>
      </div>
    </form>
  `);
  setTimeout(updateBatchSchedulePreview, 50);
}

function toggleBatchDay(chip) {
  chip.classList.toggle('active');
  const day = chip.getAttribute('data-day');
  chip.textContent = chip.classList.contains('active') ? '✓ ' + day : day;
  updateBatchSchedulePreview();
}

function setAmPm(btn) {
  const targetId = btn.getAttribute('data-target');
  const val = btn.getAttribute('data-val');
  btn.parentElement.querySelectorAll('.ampm-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const input = document.getElementById(targetId);
  if (input) input.value = val;
  updateBatchSchedulePreview();
}

function updateBatchSchedulePreview() {
  const activeChips = Array.from(document.querySelectorAll('.day-chip.active')).map(c => c.getAttribute('data-day'));
  const daysStr = activeChips.length > 0 ? activeChips.join(', ') : 'Daily';
  const sHour = document.getElementById('slot-start-hour')?.value || '05';
  const sMin = document.getElementById('slot-start-min')?.value || '30';
  const sAmPm = document.getElementById('slot-start-ampm')?.value || 'PM';
  const eHour = document.getElementById('slot-end-hour')?.value || '07';
  const eMin = document.getElementById('slot-end-min')?.value || '00';
  const eAmPm = document.getElementById('slot-end-ampm')?.value || 'PM';
  const fullSchedule = `${daysStr} • ${String(sHour).padStart(2, '0')}:${sMin} ${sAmPm} – ${String(eHour).padStart(2, '0')}:${eMin} ${eAmPm}`;
  const preview = document.getElementById('schedule-preview-text');
  const input = document.getElementById('new-batch-sched');
  if (preview) preview.innerHTML = `📅 ${fullSchedule}`;
  if (input) input.value = fullSchedule;
}

async function handleCreateBatch(e) {
  e.preventDefault();
  const btn = document.getElementById('create-batch-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Creating...'; }
  try {
    const schedVal = document.getElementById('new-batch-sched')?.value || 'Mon, Wed, Fri 05:30 PM - 07:00 PM';
    await api('/api/batches', {
      method: 'POST',
      body: JSON.stringify({
        batch_name: document.getElementById('new-batch-name').value,
        schedule: schedVal,
        instructor: document.getElementById('new-batch-inst').value,
        level: document.getElementById('new-batch-level')?.value || 'Regular'
      })
    });
    showAlert('Batch created successfully', 'success');
    closeModal();
    state.batchesLoaded = false;
    await loadBatches();
    const container = document.getElementById('tab-content-container');
    if (container && state.activeTab === 'enrollment') container.innerHTML = renderEnrollmentBatchView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Create Batch'; }
  }
}

// ============================================
// INVOICE GENERATION VIEW
// ============================================
function renderInvoiceGenerationView() {
  const paidFees = state.fees.filter(f => f.status === 'Paid');

  return `
    <div class="sdn-card animate-fade">
      <div class="sdn-card-header">
        <div>
          <h2 class="sdn-card-title">Invoice Generation &amp; PDF Repository</h2>
          <p style="font-size:0.875rem; color:var(--sdn-text-muted); margin-top:3px;">
            Generate institutional invoices for confirmed payments. Supports GSTIN &amp; Non-GSTIN formats. Invoices are auto-sent via WhatsApp on payment verification.
          </p>
        </div>
      </div>

      <!-- Generator Box -->
      <div class="sdn-card-body" style="background:var(--sdn-surface-subtle); border-bottom:1px solid var(--sdn-border);">
        <h3 style="font-size:1rem; color:var(--sdn-maroon); margin-bottom:0.85rem;">Generate Invoice Manually</h3>
        ${paidFees.length === 0 ? `
          <div style="padding:1rem; background:var(--sdn-warning-bg); border:1px solid var(--sdn-warning-border); border-radius:var(--radius-sm); font-size:0.875rem; color:var(--sdn-warning);">
            <strong>No paid fee records available.</strong> Verify a payment in Fee Management first. Invoices are also auto-generated on payment verification.
          </div>
        ` : `
          <div style="display:flex; gap:1.25rem; align-items:flex-end; flex-wrap:wrap;">
            <div style="flex:1; min-width:280px;">
              <label class="form-label">Select Verified Paid Fee Record</label>
              <select id="invoice-paid-fee-select" class="form-control">
                ${paidFees.map(f => `
                  <option value="${f.id}">${escHtml(f.student_name)} — ${escHtml(f.fee_type)} (₹${Number(f.amount).toFixed(2)}) ${f.invoice_number ? `[Invoice: ${f.invoice_number}]` : '[No Invoice Yet]'}</option>
                `).join('')}
              </select>
            </div>
            <div class="toggle-container" style="margin-bottom:2px;">
              <span class="toggle-label" id="label-nongst">Without GST</span>
              <label class="switch">
                <input type="checkbox" id="invoice-gst-toggle" checked onchange="handleGstToggleChange(this.checked)">
                <span class="slider"></span>
              </label>
              <span class="toggle-label" id="label-gst" style="color:var(--sdn-red);">With GSTIN</span>
            </div>
            <button class="btn btn-primary" onclick="submitInvoiceGeneration()" id="gen-invoice-btn">Generate &amp; Save Invoice</button>
          </div>
        `}
      </div>

      <!-- Invoices Table -->
      <div class="table-responsive">
        <table class="sdn-table">
          <thead>
            <tr>
              <th>Invoice No.</th>
              <th>Student</th>
              <th>Type</th>
              <th>Description</th>
              <th>Total</th>
              <th>Tax</th>
              <th>WhatsApp</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${state.invoices.length ? state.invoices.map(inv => `
              <tr>
                <td style="font-weight:700; color:var(--sdn-maroon); white-space:nowrap;">${inv.invoice_number}</td>
                <td>
                  <div style="font-weight:600;">${escHtml(inv.student_name)}</div>
                  <div style="font-size:0.74rem; color:var(--sdn-text-light);">${inv.student_phone || ''}</div>
                </td>
                <td><span class="badge ${inv.invoice_type === 'GSTIN' ? 'badge-verification' : 'badge-active'}">${inv.invoice_type}</span></td>
                <td>${escHtml(inv.description)}</td>
                <td style="font-weight:700;">₹${Number(inv.total_amount).toFixed(2)}</td>
                <td style="font-size:0.78rem;">
                  ${inv.invoice_type === 'GSTIN'
      ? `CGST 9%: ₹${Number(inv.cgst_amount).toFixed(2)}<br>SGST 9%: ₹${Number(inv.sgst_amount).toFixed(2)}`
      : '<span style="color:var(--sdn-text-muted);">Non-GST Receipt</span>'}
                </td>
                <td>
                  ${inv.whatsapp_sent
      ? `<span class="badge" style="background:#dcfce7; color:#15803d;" title="Sent at ${inv.whatsapp_sent_at || ''}">✓ Sent</span>`
      : inv.whatsapp_status === 'SIMULATED'
        ? `<span class="badge" style="background:#fef3c7; color:#b45309;">Simulated</span>`
        : inv.whatsapp_status === 'FAILED'
          ? `<span class="badge badge-failed" title="${escHtml(inv.whatsapp_error || '')}">Failed</span>`
          : `<span style="color:#aaa; font-size:0.8rem;">—</span>`}
                </td>
                <td>${new Date(inv.created_at).toLocaleDateString('en-IN')}</td>
                <td>
                  <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                    <button class="btn btn-primary btn-sm" onclick="downloadInvoicePdf(${inv.id}, '${inv.invoice_number.replace(/\//g, '_')}')" id="dl-inv-${inv.id}">
                      📥 PDF
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="resendWhatsAppInvoice(${inv.id})" id="wa-resend-${inv.id}" title="Resend via WhatsApp">
                      📱 WA
                    </button>
                  </div>
                </td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="9">
                  <div class="empty-state">
                    <div class="empty-state-icon">🧾</div>
                    <h3>No Invoices Generated Yet</h3>
                    <p>Invoices are auto-generated when you verify a payment. You can also generate one manually above.</p>
                  </div>
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function handleGstToggleChange(isGst) {
  const lblGst = document.getElementById('label-gst');
  const lblNonGst = document.getElementById('label-nongst');
  if (lblGst) lblGst.style.color = isGst ? 'var(--sdn-red)' : 'var(--sdn-text-muted)';
  if (lblNonGst) lblNonGst.style.color = isGst ? 'var(--sdn-text-muted)' : 'var(--sdn-red)';
}

async function submitInvoiceGeneration() {
  const feeSelect = document.getElementById('invoice-paid-fee-select');
  const feeId = feeSelect?.value;
  if (!feeId) { showAlert('Please select a Paid fee record first', 'danger'); return; }
  const isGst = document.getElementById('invoice-gst-toggle')?.checked;
  const invoiceType = isGst ? 'GSTIN' : 'NON_GSTIN';
  const btn = document.getElementById('gen-invoice-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Generating...'; }
  try {
    const res = await api('/api/invoices/generate', {
      method: 'POST',
      body: JSON.stringify({ fee_id: feeId, invoice_type: invoiceType })
    });
    showAlert(res.message, 'success');
    state.invoicesLoaded = false;
    state.feesLoaded = false;
    await Promise.all([loadInvoices(), loadFees(1)]);
    const container = document.getElementById('tab-content-container');
    if (container && state.activeTab === 'invoices') container.innerHTML = renderInvoiceGenerationView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Generate &amp; Save Invoice'; }
  }
}

async function downloadInvoicePdf(invoiceId, invoiceNumber) {
  const btn = document.getElementById(`dl-inv-${invoiceId}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span>'; }
  try {
    const response = await fetch(`/api/invoices/${invoiceId}/pdf`, { method: 'GET', credentials: 'same-origin' });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Download failed. Please try again.' }));
      throw new Error(err.error || 'Download failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Invoice_${invoiceNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showAlert('Invoice PDF downloaded successfully!', 'success');
  } catch (err) {
    showAlert(err.message || 'Could not download invoice PDF.', 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '📥 PDF'; }
  }
}

async function resendWhatsAppInvoice(invoiceId) {
  const btn = document.getElementById(`wa-resend-${invoiceId}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span>'; }
  try {
    const res = await api(`/api/invoices/${invoiceId}/resend-whatsapp`, { method: 'POST', body: JSON.stringify({}) });
    showAlert(res.message, 'success');
    state.invoicesLoaded = false;
    await loadInvoices();
    const container = document.getElementById('tab-content-container');
    if (container && state.activeTab === 'invoices') container.innerHTML = renderInvoiceGenerationView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '📱 WA'; }
  }
}

// ============================================
// BROADCAST REMINDER MODAL
// ============================================
let activeReminderPreview = null;

function selectReminderMonth(m) {
  selectedReminderMonth = m;
  document.querySelectorAll('#reminder-month-grid .month-chip').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-month') === m);
  });
  updateReminderLabelPreview();
  loadReminderPreview();
}

function selectReminderYear(y) {
  selectedReminderYear = parseInt(y, 10);
  updateReminderLabelPreview();
  loadReminderPreview();
}

function updateReminderLabelPreview() {
  const input = document.getElementById('broadcast-month-label');
  if (input) input.value = `${selectedReminderMonth} ${selectedReminderYear}`;
}

async function loadReminderPreview() {
  const container = document.getElementById('reminder-preview-container');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center; padding:1.5rem; color:var(--sdn-text-muted);"><span class="loading-spinner"></span> Checking student fee records...</div>';
  try {
    const data = await api(`/api/reminders/preview?month=${encodeURIComponent(selectedReminderMonth)}&year=${selectedReminderYear}`);
    activeReminderPreview = data;
    const channel = document.querySelector('input[name="broadcast-channel"]:checked')?.value || 'ALL';
    renderReminderPreviewUi(data, channel);
  } catch (err) {
    container.innerHTML = `<div style="color:var(--sdn-danger); padding:1rem; font-size:0.88rem;">Error loading reminder preview: ${escHtml(err.message)}</div>`;
  }
}

function onReminderChannelChange(ch) {
  if (activeReminderPreview) renderReminderPreviewUi(activeReminderPreview, ch);
}

function renderReminderPreviewUi(data, channel) {
  const container = document.getElementById('reminder-preview-container');
  if (!container) return;
  const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const studentsList = data.eligibleStudents || [];
  const excludedList = data.excludedStudents || [];

  container.innerHTML = `
    <div style="background:var(--sdn-surface-subtle); border:1px solid var(--sdn-border); border-radius:var(--radius-sm); padding:1rem 1.25rem; margin-bottom:1.25rem;">
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:0.75rem; text-align:center;">
        <div>
          <div style="font-size:0.72rem; text-transform:uppercase; color:var(--sdn-text-muted); font-weight:700;">Total Outstanding</div>
          <div style="font-size:1.35rem; font-weight:800; color:var(--sdn-maroon); margin-top:2px;">${fmtINR(data.totalOutstanding)}</div>
        </div>
        <div>
          <div style="font-size:0.72rem; text-transform:uppercase; color:var(--sdn-text-muted); font-weight:700;">Eligible Students</div>
          <div style="font-size:1.35rem; font-weight:800; color:var(--sdn-maroon); margin-top:2px;">${studentsList.length}</div>
        </div>
      </div>
    </div>

    <div style="margin-bottom:1.25rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
        <span style="font-weight:700; font-size:0.875rem; color:var(--sdn-maroon);">Eligible Students (${studentsList.length}):</span>
        <span style="font-size:0.75rem; color:var(--sdn-text-muted);">Due: 7th ${data.billingPeriod}</span>
      </div>
      <div class="table-responsive" style="max-height:180px; overflow-y:auto; border:1px solid var(--sdn-border); border-radius:var(--radius-sm);">
        <table class="sdn-table" style="font-size:0.82rem; margin:0;">
          <thead><tr><th>Student</th><th>Due Amount</th><th>Contact</th><th>Status</th></tr></thead>
          <tbody>
            ${studentsList.length ? studentsList.map(st => `
              <tr>
                <td><strong>${escHtml(st.name)}</strong> <span style="font-size:0.72rem; color:var(--sdn-text-muted);">(${st.code})</span></td>
                <td style="font-weight:700; color:var(--sdn-red);">${fmtINR(st.outstanding)}</td>
                <td style="font-size:0.75rem;">
                  <div>📧 ${st.hasValidEmail ? escHtml(st.email) : '<span style="color:#ef4444;">Missing/Invalid</span>'}</div>
                  <div>📱 ${st.hasValidPhone ? escHtml(st.phone) : '<span style="color:#ef4444;">Missing/Invalid</span>'}</div>
                </td>
                <td style="font-size:0.75rem;">
                  ${st.emailAlreadySent ? '<span class="badge" style="background:#e0f2fe; color:#0369a1;">Email Sent</span>' : ''}
                  ${st.waAlreadySent ? '<span class="badge" style="background:#dcfce7; color:#15803d;">WA Sent</span>' : ''}
                  ${(!st.emailAlreadySent && !st.waAlreadySent) ? '<span class="badge badge-active">Ready</span>' : ''}
                </td>
              </tr>
            `).join('') : `
              <tr><td colspan="4" style="text-align:center; padding:1.5rem; color:var(--sdn-text-muted);">No students owe fees for ${data.billingPeriod}.</td></tr>
            `}
          </tbody>
        </table>
      </div>
    </div>

    ${excludedList.length ? `
      <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:var(--radius-sm); padding:0.75rem 1rem; margin-bottom:1.25rem;">
        <div style="font-size:0.82rem; font-weight:700; color:#b91c1c; margin-bottom:0.25rem;">⚠️ Excluded (${excludedList.length})</div>
        <ul style="font-size:0.78rem; color:#7f1d1d; margin:0; padding-left:1.25rem;">
          ${excludedList.map(ex => `<li><strong>${escHtml(ex.name)}</strong>: ${escHtml(ex.reason)}</li>`).join('')}
        </ul>
      </div>
    ` : ''}
  `;

  const submitBtn = document.getElementById('broadcast-submit-btn');
  if (submitBtn) submitBtn.disabled = studentsList.length === 0;
}

function openBroadcastReminderModal() {
  const currentMonth = new Date().toLocaleString('en-IN', { month: 'long' });
  const currentYear = new Date().getFullYear();
  selectedReminderMonth = currentMonth;
  selectedReminderYear = currentYear;
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

  openModal('📢 Automated Fee Reminders &amp; UPI Payment Links', `
    <div>
      <div style="background:var(--sdn-gold-light); border:1px solid var(--sdn-gold); border-radius:var(--radius-sm); padding:1rem 1.25rem; margin-bottom:1.25rem;">
        <h4 style="color:var(--sdn-maroon); font-size:1rem; margin-bottom:0.3rem;">Automated Multi-Channel Dispatch — Active Students Only</h4>
        <p style="font-size:0.84rem; color:var(--sdn-text-muted); margin:0;">
          Dispatches fee reminders via Email &amp; WhatsApp with UPI payment links. Only active students are contacted. Inactive/Left students are automatically excluded. Monthly fees are due on the <strong>7th of each month</strong>.
        </p>
      </div>

      <div class="calendar-month-picker">
        <div class="calendar-month-header">
          <label class="form-label" style="margin:0; font-weight:700;">Select Billing Cycle Period<span class="required-star">*</span></label>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:0.85rem; font-weight:600; color:var(--sdn-maroon);">Year:</span>
            <select id="reminder-year-select" class="form-control" style="width:auto; padding:0.35rem 0.75rem; font-weight:700;" onchange="selectReminderYear(this.value)">
              ${yearOptions.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="month-grid" id="reminder-month-grid">
          ${ALL_MONTHS.map(m => `
            <button type="button" class="month-chip ${m === currentMonth ? 'active' : ''}" data-month="${m}" onclick="selectReminderMonth('${m}')">
              ${m}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="form-group" style="margin-bottom:1.25rem;">
        <label class="form-label">Delivery Channel</label>
        <div style="display:flex; gap:1.5rem; flex-wrap:wrap;">
          <label style="cursor:pointer; display:flex; align-items:center; gap:0.4rem; font-weight:600;">
            <input type="radio" name="broadcast-channel" value="ALL" checked onchange="onReminderChannelChange('ALL')"> Email + WhatsApp
          </label>
          <label style="cursor:pointer; display:flex; align-items:center; gap:0.4rem; font-weight:600;">
            <input type="radio" name="broadcast-channel" value="EMAIL" onchange="onReminderChannelChange('EMAIL')"> Email Only
          </label>
          <label style="cursor:pointer; display:flex; align-items:center; gap:0.4rem; font-weight:600;">
            <input type="radio" name="broadcast-channel" value="WHATSAPP" onchange="onReminderChannelChange('WHATSAPP')"> WhatsApp Only
          </label>
        </div>
      </div>

      <div id="reminder-preview-container">
        <div style="text-align:center; padding:1.5rem; color:var(--sdn-text-muted);"><span class="loading-spinner"></span> Loading...</div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.25rem;">
        <label style="font-size:0.8rem; color:var(--sdn-text-muted); display:flex; align-items:center; gap:0.4rem; cursor:pointer;">
          <input type="checkbox" id="retry-failed-chk"> Retry previously failed attempts
        </label>
        <div style="display:flex; gap:0.75rem;">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="broadcast-submit-btn" onclick="submitBroadcastReminders()">🚀 Send to Everyone Now</button>
        </div>
      </div>
    </div>
  `);

  loadReminderPreview();
}

async function submitBroadcastReminders() {
  const btn = document.getElementById('broadcast-submit-btn');

  const channel =
    document.querySelector('input[name="broadcast-channel"]:checked')?.value ||
    'ALL';

  const retryFailed = Boolean(
    document.getElementById('retry-failed-chk')?.checked
  );

  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<span class="loading-spinner"></span> Preparing reminders...';
  }

  try {
    const res = await api('/api/fees/broadcast-reminders', {
      method: 'POST',
      body: JSON.stringify({
        channel,
        month: selectedReminderMonth,
        year: selectedReminderYear,
        retryFailed
      })
    });

    const whatsappLinks = res.whatsappLinks || [];
    const details = res.details || [];

    const whatsappSection = whatsappLinks.length
      ? `
        <div style="
          margin-bottom: 1.25rem;
          padding: 1rem;
          border: 1px solid var(--sdn-border);
          border-radius: var(--radius-sm);
        ">
          <h4 style="
            margin-bottom: 0.5rem;
            color: var(--sdn-maroon);
          ">
            WhatsApp Reminders Ready
          </h4>

          <p style="
            font-size: 0.85rem;
            color: var(--sdn-text-muted);
            margin-bottom: 1rem;
          ">
            Open WhatsApp for each student and press Send manually.
            These reminders have not been sent automatically.
          </p>

          <div style="
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
          ">
            ${whatsappLinks.map(item => `
              <div style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 1rem;
                padding: 0.75rem;
                background: var(--sdn-surface-subtle);
                border-radius: var(--radius-sm);
              ">
                <div>
                  <strong>\${escHtml(item.student || 'Student')}</strong>
                  <div style="
                    font-size: 0.75rem;
                    color: var(--sdn-text-muted);
                  ">
                    \${escHtml(item.phone || '')}
                  </div>
                </div>

                <a
                  href="\${escHtml(item.url || item.whatsappLink || '#')}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-primary"
                  style="
                    text-decoration: none;
                    white-space: nowrap;
                  "
                  \${item.url || item.whatsappLink ? '' : 'aria-disabled="true"'}
                >
                  Open WhatsApp
                </a>
              </div>
            `).join('')}
          </div>
        </div>
      `
      : '';

    const detailsTable = `
      <div
        class="table-responsive"
        style="
          max-height: 260px;
          overflow-y: auto;
          border: 1px solid var(--sdn-border);
          border-radius: var(--radius-sm);
        "
      >
        <table
          class="sdn-table"
          style="font-size: 0.82rem; margin: 0;"
        >
          <thead>
            <tr>
              <th>Student</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Info</th>
            </tr>
          </thead>

          <tbody>
            ${details.map(d => {
              let statusBadge = '';

              if (d.status === 'SENT') {
                statusBadge = `
                  <span class="badge" style="background:#dcfce7;color:#15803d;">
                    SENT
                  </span>
                `;
              } else if (d.status === 'PREPARED') {
                statusBadge = `
                  <span class="badge" style="background:#dbeafe;color:#1d4ed8;">
                    READY
                  </span>
                `;
              } else if (d.status === 'SIMULATED') {
                statusBadge = `
                  <span class="badge" style="background:#fef3c7;color:#b45309;">
                    SIMULATED
                  </span>
                `;
              } else if (d.status === 'SKIPPED') {
                statusBadge = `
                  <span class="badge" style="background:#f1f5f9;color:#475569;">
                    SKIPPED
                  </span>
                `;
              } else if (d.status === 'FAILED') {
                statusBadge = `
                  <span class="badge badge-failed">
                    FAILED
                  </span>
                `;
              } else {
                statusBadge = `
                  <span class="badge">
                    \${escHtml(d.status || 'UNKNOWN')}
                  </span>
                `;
              }

              const info = d.providerId
                ? `ID: \${d.providerId}`
                : d.error || d.reason || 'Processed';

              return `
                <tr>
                  <td>
                    <strong>\${escHtml(d.student || '—')}</strong>
                  </td>
                  <td>\${escHtml(d.channel || '—')}</td>
                  <td>\${statusBadge}</td>
                  <td style="font-size: 0.75rem; color: var(--sdn-text-muted);">
                    \${escHtml(info)}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    openModal(
      'Campaign Report — Delivery Results',
      `
        <div>
          <div style="
            background: var(--sdn-surface-subtle);
            border: 1px solid var(--sdn-border);
            border-radius: var(--radius-sm);
            padding: 1.25rem;
            margin-bottom: 1.25rem;
          ">
            <h4 style="
              color: var(--sdn-maroon);
              font-size: 1.05rem;
              margin-bottom: 0.5rem;
            ">
              ${escHtml(res.message || 'Campaign processed.')}
            </h4>

            <div style="
              font-size: 0.84rem;
              color: var(--sdn-text-muted);
            ">
              Campaign ID:
              <strong>${escHtml(res.campaignId || 'N/A')}</strong>
              &bull;
              Period:
              <strong>${escHtml(res.billingPeriod || 'N/A')}</strong>
            </div>
          </div>

          ${whatsappSection}
          ${detailsTable}

          <div style="
            margin-top: 1.25rem;
            display: flex;
            justify-content: flex-end;
          ">
            <button
              class="btn btn-primary"
              onclick="closeModal()"
            >
              Done
            </button>
          </div>
        </div>
      `
    );

    state.feesLoaded = false;
    loadFees(state.feePagination.page);

  } catch (err) {
    showAlert(
      err.message || 'Failed to prepare reminders.',
      'danger'
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🚀 Send to Everyone Now';
    }
  }
}


// ============================================
// MODAL CONTROLLER
// ============================================
function openModal(title, bodyHtml) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = `
    <div class="modal-overlay" onclick="handleOverlayClick(event)" id="modal-overlay">
      <div class="modal-content" id="modal-dialog">
        <div class="modal-header">
          <h3 style="font-size:1.15rem; color:var(--sdn-maroon);">${title}</h3>
          <button class="close-btn" onclick="closeModal()" id="modal-close-btn" title="Close">&times;</button>
        </div>
        <div class="modal-body">
          ${bodyHtml}
        </div>
      </div>
    </div>
  `;
}

function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

function handleOverlayClick(e) {
  if (e.target.id === 'modal-overlay') closeModal();
}

// ============================================
// INITIALIZE
// ============================================
window.addEventListener('DOMContentLoaded', () => {
  checkAuthSession();
});
