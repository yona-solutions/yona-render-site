/**
 * Client-side Firebase Auth Helper
 *
 * Include via <script src="/auth.js"></script> in all protected pages.
 * Provides: auth state check, redirect to login, authFetch(), role-based nav.
 */

if (!firebase.apps.length) {
  firebase.initializeApp({
    apiKey: "AIzaSyAlaEV7cmVnh6cQ6oovPjib5blRr2jTKdw",
    authDomain: "yona-solutions-poc.firebaseapp.com",
    projectId: "yona-solutions-poc",
    appId: "1:940808232688:web:08ab5ea195f2be06e9ec35"
  });
}

const ADMIN_ONLY_PATHS = new Set([
  '/user-management'
]);

// Promise that resolves once we know the auth state for certain
const _authReady = new Promise((resolve) => {
  const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
    unsubscribe();
    resolve(user);
  });
});

/**
 * Wraps fetch() to add Firebase Authorization header.
 * Waits for auth to be ready before proceeding.
 */
async function authFetch(url, options = {}) {
  await _authReady;
  const user = firebase.auth().currentUser;
  if (!user) {
    throw new Error('Not authenticated');
  }

  const token = await user.getIdToken();
  const headers = options.headers instanceof Headers
    ? options.headers
    : new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(url, { ...options, headers });
}

/**
 * Get the current auth token for use with SSE (EventSource).
 * EventSource doesn't support custom headers, so token must be passed as query param.
 */
async function getAuthToken() {
  await _authReady;
  const user = firebase.auth().currentUser;
  if (!user) {
    throw new Error('Not authenticated');
  }
  return user.getIdToken();
}

/**
 * One-time auth check on page load.
 * Uses the _authReady promise so we only act after Firebase has fully
 * restored the session from IndexedDB (avoiding the null-then-user flicker).
 */
(async function initAuth() {
  let user = await _authReady;

  // If no user after the initial check, wait a bit more — Firebase compat
  // sometimes needs an extra moment to restore from IndexedDB on hard navigations
  if (!user) {
    user = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 2000);
      const unsub = firebase.auth().onAuthStateChanged((u) => {
        if (u) {
          clearTimeout(timeout);
          unsub();
          resolve(u);
        }
      });
    });
  }

  if (!user) {
    window.location.replace('/login.html');
    return;
  }

  try {
    const resp = await authFetch('/api/me');
    if (!resp.ok) {
      if (resp.status === 403) {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#c53030;"><div style="text-align:center"><h2>Access Denied</h2><p>Your account does not have access to SPHERE.</p><button onclick="firebase.auth().signOut().then(()=>location.href=\'/login.html\')" style="margin-top:16px;padding:8px 20px;cursor:pointer">Sign Out</button></div></div>';
        return;
      }
      throw new Error('Auth check failed');
    }

    const { role, email } = await resp.json();
    window.currentUserRole = role;
    window.currentUserEmail = email || user.email;
    enforcePageAccess(role);
    insertAdminNavItem(role);
    applyRoleToNav(role);
    addUserMenu({ email: email || user.email }, role);
    window.dispatchEvent(new CustomEvent('sphere-auth-ready', {
      detail: {
        role,
        email: email || user.email
      }
    }));
  } catch (error) {
    console.error('Auth state error:', error);
  }
})();

function enforcePageAccess(role) {
  if (role === 'admin') {
    return;
  }

  if (!ADMIN_ONLY_PATHS.has(window.location.pathname)) {
    return;
  }

  window.sphereAccessDenied = true;
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f8f9fa;color:#c53030;"><div style="max-width:420px;text-align:center;background:#fff;padding:32px;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.08);"><h2 style="margin-bottom:12px;">Admin Access Required</h2><p style="margin-bottom:20px;color:#4a5568;">Only admin users can open User Management.</p><div style="display:flex;gap:12px;justify-content:center;"><button onclick="location.href=\'/\'" style="padding:10px 18px;cursor:pointer;border:1px solid #cbd5e0;background:#fff;border-radius:6px;">Back to SPHERE</button><button onclick="firebase.auth().signOut().then(()=>location.href=\'/login.html\')" style="padding:10px 18px;cursor:pointer;border:none;background:#4a7c9e;color:#fff;border-radius:6px;">Sign Out</button></div></div></div>';
}

function insertAdminNavItem(role) {
  const adminLink = document.querySelector('[data-nav-user-management]');
  if (!adminLink || role !== 'admin') {
    return;
  }

  if (window.location.pathname === '/user-management') {
    adminLink.classList.add('active');
  }
}

/**
 * Hide admin-only nav items for viewers
 */
function applyRoleToNav(role) {
  if (role !== 'viewer') return;

  const adminPages = ['Dimension Config', 'Email Config', 'Email Templates', 'Run Log', 'Storage Browser', 'NetSuite Sync', 'User Management'];
  document.querySelectorAll('.nav-item').forEach(item => {
    const text = item.textContent.trim();
    if (adminPages.includes(text)) {
      item.style.display = 'none';
    }
  });
}

/**
 * Add user email and sign-out button to the sidebar
 */
function addUserMenu(user, role) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const userDiv = document.createElement('div');
  userDiv.style.cssText = 'padding:12px 16px;border-top:1px solid #dfe3e8;font-size:12px;color:#718096;';
  userDiv.innerHTML = `
    <div style="margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${user.email}">${user.email}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="text-transform:capitalize;font-weight:500;color:#4a5568;">${role}</span>
      <a href="#" onclick="firebase.auth().signOut().then(()=>location.href='/login.html');return false;" style="color:#4a7c9e;text-decoration:none;font-size:11px;">Sign out</a>
    </div>
  `;
  sidebar.appendChild(userDiv);
}
