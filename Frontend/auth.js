/**
 * ════════════════════════════════════════════════════════════
 *  InsightFlow — auth.js
 *  Central security & session management module.
 *
 *  HOW TO USE:
 *  ─────────────────────────────────────────────────────────
 *  On PROTECTED pages (dashboard, report, chatbot, visualize, account):
 *    <script src="auth.js"></script>   ← must be FIRST script in <head>
 *
 *  On PUBLIC page (index.html only):
 *    <script src="auth.js" data-public></script>
 *
 *  ─────────────────────────────────────────────────────────
 *  COMPATIBLE with both old login (localStorage "userEmail")
 *  and new login (Auth.setSession → "insightflow_session").
 *  Old sessions are automatically upgraded on first check.
 * ════════════════════════════════════════════════════════════
 */

;(function () {

  /* ── Config ── */
  var SESSION_KEY    = 'insightflow_session'
  var LEGACY_KEY     = 'userEmail'            // old key — still supported
  var SESSION_TTL_MS = 8 * 60 * 60 * 1000    // 8 hours
  var LOGIN_PAGE     = 'login.html'
  var API_BASE       = 'http://127.0.0.1:5000'

  /* ══════════════════════════════════════
     INTERNAL HELPERS
  ══════════════════════════════════════ */

  function genToken() {
    try {
      var arr = new Uint8Array(32)
      window.crypto.getRandomValues(arr)
      return Array.from(arr).map(function (b) {
        return b.toString(16).padStart(2, '0')
      }).join('')
    } catch (e) {
      return Math.random().toString(36).substr(2) + Date.now().toString(36)
    }
  }

  function readSession() {
    try {
      /* ── Try new session object first ── */
      var raw = localStorage.getItem(SESSION_KEY)
      if (raw) {
        var s = JSON.parse(raw)
        if (s && s.email && s.token && s.expiresAt) return s
      }

      /* ── Fallback: old "userEmail" key — upgrade it automatically ── */
      var legacyEmail = localStorage.getItem(LEGACY_KEY)
      if (legacyEmail && legacyEmail.indexOf('@') > -1) {
        /* Upgrade old session to new format transparently */
        var now = Date.now()
        var upgraded = {
          email:      legacyEmail,
          name:       legacyEmail.split('@')[0],
          token:      genToken(),
          loginTime:  now,
          expiresAt:  now + SESSION_TTL_MS,
          loginExpiry: now + SESSION_TTL_MS,
          upgraded:   true
        }
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(upgraded)) } catch (e) {}
        return upgraded
      }

      return null
    } catch (e) {
      return null
    }
  }

  function sessionValid() {
    var s = readSession()
    if (!s) return false
    if (Date.now() > s.expiresAt) {
      wipeSession()
      return false
    }
    return true
  }

  function wipeSession() {
    try { localStorage.removeItem(SESSION_KEY) } catch (e) {}
    try { localStorage.removeItem(LEGACY_KEY)  } catch (e) {}
  }

  function slideExpiry() {
    var s = readSession()
    if (!s) return
    s.expiresAt = Date.now() + SESSION_TTL_MS
    // Preserve loginExpiry — never overwrite it
    if (!s.loginExpiry && s.loginTime) {
      s.loginExpiry = s.loginTime + SESSION_TTL_MS
    }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch (e) {}
  }

  /* ══════════════════════════════════════
     PUBLIC API  —  window.Auth
  ══════════════════════════════════════ */

  window.Auth = {

    /* Called after successful login */
    setSession: function (email, name) {
      var expiry = Date.now() + SESSION_TTL_MS
      var session = {
        email:      email,
        name:       name || email.split('@')[0],
        token:      genToken(),
        loginTime:  Date.now(),
        expiresAt:  expiry,
        loginExpiry: expiry   // fixed at login — never changed by slideExpiry
      }
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session))
        localStorage.setItem(LEGACY_KEY, email)   // keep legacy key in sync
      } catch (e) {
        console.error('Auth.setSession failed:', e)
      }
    },

    isLoggedIn:  function () { return sessionValid() },
    getSession:  function () { return readSession()  },

    getEmail: function () {
      var s = readSession()
      return (s && sessionValid()) ? s.email : null
    },

    getName: function () {
      var s = readSession()
      return (s && sessionValid()) ? (s.name || s.email.split('@')[0]) : null
    },

    getToken: function () {
      var s = readSession()
      return (s && sessionValid()) ? s.token : null
    },

    getTimeRemaining: function () {
      var s = readSession()
      if (!s) return 'Not logged in'
      var ms = s.expiresAt - Date.now()
      if (ms <= 0) return 'Expired'
      var h = Math.floor(ms / 3600000)
      var m = Math.floor((ms % 3600000) / 60000)
      return h + 'h ' + m + 'm remaining'
    },

    touch: slideExpiry,

    logout: function () {
      wipeSession()
      try { localStorage.removeItem('insightflow_dataset') } catch (e) {}
      window.location.href = LOGIN_PAGE
    },

    API_BASE: API_BASE
  }

  /* ══════════════════════════════════════
     AUTO GUARD
  ══════════════════════════════════════ */

  var thisScript   = document.currentScript
  var isPublicPage = thisScript && thisScript.hasAttribute('data-public')

  if (!isPublicPage) {

    /* Protected page — redirect to login if no session */
    if (!sessionValid()) {
      try {
        sessionStorage.setItem(
          'insightflow_redirect',
          window.location.pathname + window.location.search
        )
      } catch (e) {}
      window.location.replace(LOGIN_PAGE)
      throw new Error('InsightFlow Auth: not logged in')
    }

    /* Keep session alive on activity */
    ;['click', 'keydown', 'mousemove', 'scroll'].forEach(function (evt) {
      document.addEventListener(evt, slideExpiry, { passive: true })
    })

    /* Check every minute for expiry while page is open */
    setInterval(function () {
      if (!sessionValid()) {
        alert('Your session has expired. Please log in again.')
        window.Auth.logout()
      }
    }, 60 * 1000)

  } else {

    /* Public page — redirect to dashboard only if session was created
       by a real login (not auto-upgraded from legacy userEmail key).
       This prevents the login page from being skipped on first load. */
    var s = readSession()
    if (s && sessionValid() && !s.upgraded) {
      var dest = 'dashboard.html'
      try { dest = sessionStorage.getItem('insightflow_redirect') || dest } catch (e) {}
      try { sessionStorage.removeItem('insightflow_redirect') } catch (e) {}
      window.location.replace(dest)
      throw new Error('InsightFlow Auth: already logged in')
    }

  }

})()