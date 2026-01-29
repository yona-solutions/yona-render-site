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

    const { role } = await resp.json();
    applyRoleToNav(role);
    addUserMenu(user, role);
  } catch (error) {
    console.error('Auth state error:', error);
  }
})();

/**
 * Hide admin-only nav items for viewers
 */
function applyRoleToNav(role) {
  if (role !== 'viewer') return;

  const adminPages = ['Dimension Config', 'Email Config', 'Run Log', 'Fivetran Sync', 'Storage Browser'];
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
