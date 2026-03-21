/**
 * ════════════════════════════════════════════════════════════
 *  InsightFlow — auth.js  (JWT edition)
 *
 *  HOW IT WORKS:
 *  ─────────────────────────────────────────────────────────
 *  Login flow  : POST /login → backend returns signed JWT
 *                → call Auth.setSession(d.token)
 *                → JWT stored in localStorage as 'insightflow_jwt'
 *
 *  Every page  : auth.js decodes JWT payload, checks exp,
 *                redirects to index.html if invalid/expired
 *
 *  Every API   : use Auth.headers() for fetch() calls
 *                → sends  Authorization: Bearer <token>
 *
 *  On PROTECTED pages (dashboard, account, chatbot, etc.):
 *    <script src="auth.js"></script>   ← must be FIRST in <head>
 *
 *  On PUBLIC pages (index.html, login.html):
 *    <script src="auth.js" data-public></script>
 * ════════════════════════════════════════════════════════════
 */

;(function () {

  /* ── Config ── */
  var JWT_KEY    = 'insightflow_jwt'       // localStorage key for JWT
  var LEGACY_KEY = 'userEmail'             // kept for backward compat
  var LOGIN_PAGE = 'index.html'
  var API_BASE   = 'http://127.0.0.1:5000'
  var WARN_MS    = 15 * 60 * 1000         // warn 15 min before expiry

  /* ══════════════════════════════════════
     JWT HELPERS
  ══════════════════════════════════════ */

  function decodeJWT(token) {
    try {
      var parts = token.split('.')
      if (parts.length !== 3) return null
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      while (b64.length % 4) b64 += '='
      return JSON.parse(atob(b64))
    } catch (e) { return null }
  }

  function getToken()   { return localStorage.getItem(JWT_KEY) || null }
  function getPayload() { var t = getToken(); return t ? decodeJWT(t) : null }

  function isValid() {
    var p = getPayload()
    if (!p || !p.exp) return false
    return Date.now() < p.exp * 1000
  }

  function wipeSession() {
    localStorage.removeItem(JWT_KEY)
    localStorage.removeItem(LEGACY_KEY)
    localStorage.removeItem('insightflow_session')
    localStorage.removeItem('insightflow_dataset')
  }

  /* ══════════════════════════════════════
     PUBLIC API  —  window.Auth
  ══════════════════════════════════════ */

  window.Auth = {

    /**
     * Call after successful login with the JWT from the backend:
     *   Auth.setSession(d.token)
     */
    setSession: function (jwtToken) {
      var p = decodeJWT(jwtToken)
      if (!p) { console.error('Auth.setSession: invalid JWT'); return }
      localStorage.setItem(JWT_KEY, jwtToken)
      if (p.email) localStorage.setItem(LEGACY_KEY, p.email)  // backward compat
    },

    isLoggedIn: function () { return isValid() },
    getToken:   function () { return isValid() ? getToken() : null },

    getEmail: function () {
      var p = getPayload()
      return (p && isValid()) ? (p.email || p.sub || null) : null
    },

    getName: function () {
      var p = getPayload()
      return (p && isValid()) ? (p.name || (p.email ? p.email.split('@')[0] : null)) : null
    },

    getExpiry:    function () { var p = getPayload(); return (p && p.exp) ? p.exp * 1000 : 0 },
    getLoginTime: function () { var p = getPayload(); return (p && p.iat) ? p.iat * 1000 : 0 },

    getTimeRemaining: function () {
      var exp = window.Auth.getExpiry()
      if (!exp) return 'Not logged in'
      var ms = exp - Date.now()
      if (ms <= 0) return 'Expired'
      return Math.floor(ms / 3600000) + 'h ' + Math.floor((ms % 3600000) / 60000) + 'm remaining'
    },

    /**
     * Use for every fetch() call to protected endpoints:
     *   fetch(url, { headers: Auth.headers(), method: 'POST', body: ... })
     * Sends:  Authorization: Bearer <jwt>
     */
    headers: function () {
      var t = window.Auth.getToken()
      return t
        ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t }
        : { 'Content-Type': 'application/json' }
    },

    logout: function () {
      var email = window.Auth.getEmail()
      if (email) {
        fetch(API_BASE + '/logout', {
          method: 'POST',
          headers: window.Auth.headers(),
          body: JSON.stringify({ email: email })
        }).catch(function () {})
      }
      wipeSession()
      window.location.replace(LOGIN_PAGE)
    },

    // Backward compat — JWT expiry is fixed in the token, no sliding needed
    touch: function () {},

    // Backward compat — existing pages call Auth.getSession()
    getSession: function () {
      var p = getPayload()
      if (!p || !isValid()) return null
      return {
        email:       p.email || p.sub || '',
        name:        p.name  || (p.email ? p.email.split('@')[0] : ''),
        token:       getToken(),
        loginTime:   p.iat ? p.iat * 1000 : 0,
        expiresAt:   p.exp ? p.exp * 1000 : 0,
        loginExpiry: p.exp ? p.exp * 1000 : 0
      }
    },

    API_BASE: API_BASE
  }

  /* ══════════════════════════════════════
     AUTO GUARD
  ══════════════════════════════════════ */

  var thisScript   = document.currentScript
  var isPublicPage = thisScript && thisScript.hasAttribute('data-public')

  if (!isPublicPage) {

    if (!isValid()) {
      try { sessionStorage.setItem('insightflow_redirect', window.location.pathname + window.location.search) } catch(e) {}
      wipeSession()
      window.location.replace(LOGIN_PAGE)
      throw new Error('InsightFlow Auth: not logged in')
    }

    // Warn 15 min before expiry
    var _exp    = window.Auth.getExpiry()
    var _warnIn = (_exp - WARN_MS) - Date.now()
    if (_warnIn > 0) {
      setTimeout(function () {
        if (isValid()) console.warn('InsightFlow: session expires in ~' + Math.round((_exp - Date.now()) / 60000) + ' min')
      }, _warnIn)
    }

    // Check every 60s for expiry
    setInterval(function () {
      if (!isValid()) { alert('Your session has expired. Please log in again.'); window.Auth.logout() }
    }, 60 * 1000)

  } else {

    if (isValid()) {
      var dest = 'dashboard.html'
      try { dest = sessionStorage.getItem('insightflow_redirect') || dest } catch(e) {}
      try { sessionStorage.removeItem('insightflow_redirect') } catch(e) {}
      window.location.replace(dest)
      throw new Error('InsightFlow Auth: already logged in')
    }

  }

})()