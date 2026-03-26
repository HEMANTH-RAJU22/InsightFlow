/* ============================================================
   INSIGHTFLOW — script.js
   ============================================================ */

let chartInstance
let dataset     = []
let headers     = []
let currentPage = 1
let rowsPerPage = 10

/* ── JWT & Session Helpers ───────────────────────────────── */
function getJwtToken(){
  try{
    if(window.Auth && window.Auth.getToken) return window.Auth.getToken() || ''
    return localStorage.getItem('insightflow_jwt') || localStorage.getItem('jwtToken') || ''
  }catch(e){ return '' }
}

function getToken(){
  if(window.Auth && window.Auth.getToken && window.Auth.getToken()) return window.Auth.getToken()
  return localStorage.getItem('insightflow_jwt') || localStorage.getItem('jwtToken') || ''
}

function getAuthEmail(){
  try{ if(window.Auth && window.Auth.getEmail) return window.Auth.getEmail() || '' }catch(e){}
  try{
    var raw = localStorage.getItem('insightflow_session')
    if(raw){ var s=JSON.parse(raw); if(s&&s.email) return s.email }
  }catch(e){}
  return localStorage.getItem('userEmail') || ''
}

// Single authHeaders — uses getToken(), no X-User-Email, no duplicates
function authHeaders(){
  var h = {'Content-Type':'application/json'}
  var token = getToken()
  if(token) h['Authorization'] = 'Bearer ' + token
  return h
}

// Adds _token to body as fallback for file:// CORS restrictions
function withToken(body){
  var t = getToken(); if(t) body._token = t; return body
}

function isSessionValid(){
  var token = getJwtToken()
  if(!token) return false
  try{
    var payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
    return Date.now() < payload.exp * 1000
  }catch(e){ return false }
}

function getTokenExpiry(){
  var token = getJwtToken()
  if(!token) return null
  try{
    var payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
    return new Date(payload.exp * 1000)
  }catch(e){ return null }
}

function clearSession(){
  try{ localStorage.removeItem('jwtToken') }catch(e){}
  try{ localStorage.removeItem('insightflow_jwt') }catch(e){}
  try{ localStorage.removeItem('userEmail') }catch(e){}
  try{ localStorage.removeItem('userName') }catch(e){}
  try{ localStorage.removeItem('insightflow_session') }catch(e){}
  try{ localStorage.removeItem('insightflow_dataset') }catch(e){}
}


/* ── KPI counter animation ─────────────────────────────────── */
function animateKPI(id, value){
  let el = document.getElementById(id)
  if(!el) return
  let start = 0, steps = 60, duration = 2000
  let inc = Math.ceil(value / steps)
  let counter = setInterval(() => {
    start += inc
    if(start >= value){ start = value; clearInterval(counter) }
    el.innerText = start
  }, duration / steps)
}


/* ── Loading spinner ───────────────────────────────────────── */
function showLoading(fileName){
  let overlay = document.getElementById("loadingOverlay")
  let sub     = document.getElementById("loadingFileName")
  if(overlay) overlay.style.display = "flex"
  if(sub)     sub.innerText = fileName
  document.querySelectorAll(".upload-box button").forEach(b => { b.disabled = true; b.style.opacity = "0.5" })
}

function hideLoading(){
  let overlay = document.getElementById("loadingOverlay")
  if(overlay) overlay.style.display = "none"
  document.querySelectorAll(".upload-box button").forEach(b => { b.disabled = false; b.style.opacity = "1" })
}


/* ── Show sections after upload ────────────────────────────── */
function showSections(){
  document.getElementById("previewSection").style.display = "block"
  document.getElementById("aiCta").style.display          = "block"
  document.getElementById("kpiContainer").style.display   = "flex"
  document.getElementById("clearBtn").style.display       = "inline-block"
}


/* ── Clear dataset ─────────────────────────────────────────── */
function clearDataset(){
  dataset = []; headers = []; currentPage = 1

  document.getElementById("fileInput").value              = ""
  document.getElementById("previewSection").style.display = "none"
  document.getElementById("aiCta").style.display          = "none"
  document.getElementById("clearBtn").style.display       = "none"
  document.querySelector("#dataTable thead").innerHTML    = ""
  document.querySelector("#dataTable tbody").innerHTML    = ""

  document.getElementById("fileName").innerText           = "No file"
  document.getElementById("fileSize").innerText           = "—"
  document.getElementById("fileType").innerText           = "—"
  document.getElementById("totalRows").innerText          = "0"
  document.getElementById("totalColumns").innerText       = "0"
  document.getElementById("missingValues").innerText      = "0"
  document.getElementById("duplicateRows").innerText      = "0"
  document.getElementById("numericColumns").innerText     = "0"
  document.getElementById("categoricalColumns").innerText = "0"

  localStorage.removeItem("insightflow_dataset")
}


/* ── Populate dashboard after data received ────────────────── */
function showDashboard(data, fileName){
  headers     = data.headers
  dataset     = data.preview
  currentPage = 1

  showSections()
  renderTable()

  animateKPI("totalRows",          data.rows)
  animateKPI("totalColumns",       data.columns)
  animateKPI("missingValues",      data.missing)
  animateKPI("duplicateRows",      data.duplicates)
  animateKPI("numericColumns",     data.numeric)
  animateKPI("categoricalColumns", data.categorical)

  try {
    localStorage.setItem("insightflow_dataset", JSON.stringify({
      fileName,
      rows:        data.rows,
      columns:     data.columns,
      missing:     data.missing,
      duplicates:  data.duplicates,
      numeric:     data.numeric,
      categorical: data.categorical,
      headers:     data.headers,
      dataset:     data.preview
    }))
  } catch(e){ console.warn("sessionStorage unavailable:", e) }
}


/* ── Upload button click ───────────────────────────────────── */
function uploadFile(){
  let fileInput = document.getElementById("fileInput")
  let file      = fileInput.files[0]
  if(!file){ alert("Please select a dataset first"); return }

  dataset = []; headers = []; currentPage = 1
  document.getElementById("previewSection").style.display = "none"
  document.getElementById("aiCta").style.display          = "none"
  document.querySelector("#dataTable thead").innerHTML    = ""
  document.querySelector("#dataTable tbody").innerHTML    = ""
  document.getElementById("totalRows").innerText          = "0"
  document.getElementById("totalColumns").innerText       = "0"
  document.getElementById("missingValues").innerText      = "0"
  document.getElementById("duplicateRows").innerText      = "0"
  document.getElementById("numericColumns").innerText     = "0"
  document.getElementById("categoricalColumns").innerText = "0"
  document.getElementById("fileName").innerText           = "No file"
  document.getElementById("fileSize").innerText           = "—"
  document.getElementById("fileType").innerText           = "—"

  if(file.size === 0){ alert("This file is empty. Please select a valid dataset."); return }

  document.getElementById("fileName").innerText = file.name
  document.getElementById("fileSize").innerText = file.size < 1048576
    ? (file.size / 1024).toFixed(2) + " KB"
    : (file.size / 1048576).toFixed(2) + " MB"
  document.getElementById("fileType").innerText = file.name.split(".").pop().toUpperCase()

  showLoading(file.name)

  let formData = new FormData()
  formData.append("file", file)

  // FIX: use getToken() not getJwtToken(), no X-User-Email header
  var uploadHdrs = {}
  var _token = getToken()
  if(_token) uploadHdrs["Authorization"] = "Bearer " + _token
  fetch("http://127.0.0.1:5000/upload", { method:"POST", headers: uploadHdrs, body:formData })
    .then(res => {
      if(!res.ok) throw new Error("HTTP " + res.status)
      return res.json()
    })
    .then(data => {
      if(data.error) throw new Error(data.error)
      hideLoading()
      showDashboard(data, file.name)
    })
    .catch(err => {
      console.warn("Flask unavailable (" + err.message + "), parsing locally")
      parseLocalFile(file)
    })
}


/* ── Local file parsing (no Flask needed) ──────────────────── */
function parseLocalFile(file){
  let ext = file.name.split(".").pop().toLowerCase()

  if(ext === "xlsx"){
    let reader = new FileReader()
    reader.onload = e => {
      try {
        let wb   = XLSX.read(e.target.result, {type:"array"})
        let ws   = wb.Sheets[wb.SheetNames[0]]
        let json = XLSX.utils.sheet_to_json(ws, {header:1, defval:""})
        if(json.length < 2){ hideLoading(); alert("File appears empty"); return }
        buildAndShow(json[0].map(String), json.slice(1).filter(r => r.some(c => c !== "")), file.name)
      } catch(err){
        hideLoading()
        let msg = err.message || String(err)
        if(msg.includes("ZIP") || msg.includes("encrypt") || msg.includes("password")){
          alert("This Excel file is password-protected.\n\nRemove password in Excel:\nFile → Info → Protect Workbook → Remove Password")
        } else {
          alert("Could not read Excel file: " + msg)
        }
      }
    }
    reader.onerror = () => { hideLoading(); alert("Failed to read file.") }
    reader.readAsArrayBuffer(file)
    return
  }

  let reader = new FileReader()
  reader.onload = e => {
    try {
      let text  = e.target.result
      let lines = text.split(/\r?\n/).filter(l => l.trim() !== "")
      if(lines.length < 2){ hideLoading(); alert("File appears empty"); return }

      let delim = lines[0].includes("\t") ? "\t" : ","

      function parseLine(line){
        let cols=[], cur="", inQ=false
        for(let ch of line){
          if(ch === '"'){ inQ = !inQ }
          else if(ch === delim && !inQ){ cols.push(cur.trim()); cur = "" }
          else { cur += ch }
        }
        cols.push(cur.trim())
        return cols
      }

      buildAndShow(parseLine(lines[0]), lines.slice(1).map(parseLine), file.name)
    } catch(e){ hideLoading(); alert("Could not read file: " + e.message) }
  }
  reader.readAsText(file)
}


/* ── Build KPI stats from local parse ──────────────────────── */
function buildAndShow(hdrs, rows, fileName){
  if(!hdrs || hdrs.length === 0){ hideLoading(); alert("No columns found. Check your file format."); return }
  if(!rows || rows.length === 0){ hideLoading(); alert("No data rows found in this file."); return }

  let missing=0, dupMap={}, dupes=0, numeric=0, categorical=0

  rows.forEach(r => {
    r.forEach(c => { if(c === "" || c === null || c === undefined) missing++ })
    let key = JSON.stringify(r)
    dupMap[key] = (dupMap[key] || 0) + 1
  })
  Object.values(dupMap).forEach(v => { if(v > 1) dupes += v - 1 })

  hdrs.forEach((h, i) => {
    let sample = rows.map(r => r[i]).find(v => v !== "" && v !== null && v !== undefined) ?? ""
    ;(!isNaN(parseFloat(sample)) && isFinite(sample)) ? numeric++ : categorical++
  })

  hideLoading()
  showDashboard({
    rows:        rows.length,
    columns:     hdrs.length,
    missing,
    duplicates:  dupes,
    numeric,
    categorical,
    headers:     hdrs,
    preview:     rows.slice(0, 100)
  }, fileName)
}


/* ── Table rendering ────────────────────────────────────────── */
function renderTable(){
  let thead = document.querySelector("#dataTable thead")
  let tbody = document.querySelector("#dataTable tbody")
  if(!thead || !tbody) return

  let colWidth = Math.max(120, Math.floor(900 / Math.max(headers.length, 1)))
  thead.innerHTML = "<tr>" +
    headers.map(h => `<th style="min-width:${colWidth}px">${String(h).replace(/</g,"&lt;")}</th>`).join("") +
    "</tr>"

  let start    = (currentPage - 1) * rowsPerPage
  let pageData = dataset.slice(start, start + rowsPerPage)

  let html = pageData.map(row =>
    "<tr>" +
    headers.map((h, i) => {
      let val = (row[i] === null || row[i] === undefined) ? "" : String(row[i])
      return `<td>${val.replace(/</g,"&lt;")}</td>`
    }).join("") +
    "</tr>"
  ).join("")

  requestAnimationFrame(() => {
    tbody.innerHTML = html
    let pi = document.getElementById("pageInfo")
    if(pi) pi.innerText = `Page ${currentPage} / ${Math.ceil(dataset.length / rowsPerPage)}`
  })
}

function nextPage(){ if(currentPage * rowsPerPage < dataset.length){ currentPage++; renderTable() } }
function prevPage(){ if(currentPage > 1){ currentPage--; renderTable() } }


/* ── Navigation ─────────────────────────────────────────────── */
function goDashboard(){ window.location.href = "login.html" }
function goAccount(){   window.location.href = "account.html" }
function goToChatbot(){ window.location.href = "chatbot.html" }
/* ── Auth ───────────────────────────────────────────────────── */
function login(){
  let email    = document.getElementById("emailInput").value
  let password = document.getElementById("passwordInput").value
  fetch("http://127.0.0.1:5000/login", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email, password})
  })
  .then(res => res.json())
  .then(data => {
    if(data.status === "success"){
      if(window.Auth && data.token){ window.Auth.setSession(data.token) }
      else if(data.token){ try{ localStorage.setItem('insightflow_jwt', data.token) }catch(e){} }
      let dest = "dashboard.html"
      try{ dest = sessionStorage.getItem("insightflow_redirect") || "dashboard.html" }catch(e){}
      try{ sessionStorage.removeItem("insightflow_redirect") }catch(e){}
      window.location.href = dest
    } else {
      alert(data.message || "Login failed")
    }
  })
  .catch(() => alert("Cannot reach server. Make sure Flask is running."))
}

function register(){
  let name     = document.getElementById("nameInput").value.trim()
  let email    = document.getElementById("emailInput").value.trim().toLowerCase()
  let password = document.getElementById("passwordInput").value
  let btn      = document.getElementById("mainButton")

  if(!name || !email || !password){ alert("All fields are required."); return }
  if(name.length < 2){ alert("Name must be at least 2 characters."); return }
  if(!/^[^@]+@[^@]+\.[^@]+$/.test(email)){ alert("Enter a valid email address."); return }
  if(password.length < 8){ alert("Password must be at least 8 characters."); return }
  if(!/[A-Z]/.test(password)){ alert("Password must contain at least one uppercase letter."); return }
  if(!/[0-9]/.test(password)){ alert("Password must contain at least one number."); return }
  if(btn){ btn.disabled = true; btn.innerText = "Registering..." }

  fetch("http://127.0.0.1:5000/register", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({name, email, password})
  })
  .then(res => res.json())
  .then(data => {
    if(btn){ btn.disabled = false; btn.innerText = "Register" }
    if(data.status === "success"){
      alert("Account created! Please log in.")
      if(typeof toggleForm === "function") toggleForm()
    } else {
      alert(data.message || "Registration failed")
    }
  })
  .catch(() => {
    if(btn){ btn.disabled = false; btn.innerText = "Register" }
    alert("Register failed. Make sure Flask is running.")
  })
}

let isRegister = false
function toggleForm(){
  let nameField  = document.getElementById("nameInput")
  let title      = document.getElementById("formTitle")
  let button     = document.getElementById("mainButton")
  let toggleText = document.getElementById("toggleText")
  isRegister = !isRegister

  document.getElementById("emailInput").value    = ""
  document.getElementById("passwordInput").value = ""
  if(nameField) nameField.value = ""

  if(isRegister){
    if(nameField) nameField.style.display = "block"
    title.innerText  = "Register"
    button.innerText = "Register"
    button.onclick   = register
    toggleText.innerHTML = 'Already have an account? <span onclick="toggleForm()">Login</span>'
  } else {
    if(nameField) nameField.style.display = "none"
    title.innerText  = "Login"
    button.innerText = "Login"
    button.onclick   = login
    toggleText.innerHTML = 'Don\'t have an account? <span onclick="toggleForm()">Register</span>'
  }
}

function loadAccount(){
  let email = getAuthEmail()
  if(!email) return
  fetch(`http://127.0.0.1:5000/account/${email}`, { headers: authHeaders() })
    .then(res => res.json())
    .then(data => {
      let u = document.getElementById("username")
      let e = document.getElementById("email")
      if(u) u.innerText = data.name  || ""
      if(e) e.innerText = data.email || ""
    })
    .catch(() => {})
}


/* ── Dark mode ──────────────────────────────────────────────── */
let toggle = document.getElementById("modeToggle")
if(toggle){ toggle.onclick = () => document.body.classList.toggle("dark-mode") }


/* ============================================================
   CHATBOT — used by chatbot.html
   ============================================================ */

let chatHistory    = []
let datasetContext = ""
let isSending      = false

function loadDataset(){
  if(!document.getElementById("chatWindow")) return

  const raw = localStorage.getItem("insightflow_dataset")

  if(!raw){
    appendBotMessage("⚠️ No dataset found.\n\nPlease go back to the **Dashboard**, upload a dataset, then click **Analyze with AI**.")
    disableChatInput("Go to Dashboard to upload a dataset first")
    return
  }

  let d
  try { d = JSON.parse(raw) }
  catch(e){ appendBotMessage("⚠️ Dataset data corrupted. Please re-upload from the Dashboard."); return }

  const { headers: hdrs, dataset: ds, fileName, rows, columns, missing, duplicates, numeric, categorical } = d

  let stats = document.getElementById("chatbotStats")
  if(stats) stats.style.display = "flex"

  let sr = document.getElementById("statRows")
  let sc = document.getElementById("statCols")
  let sm = document.getElementById("statMissing")
  let sd = document.getElementById("statDupes")
  if(sr) sr.innerText = Number(rows).toLocaleString() + " rows"
  if(sc) sc.innerText = columns + " cols"
  if(sm) sm.innerText = missing + " missing"
  if(sd) sd.innerText = duplicates + " duplicates"

  const sample = (ds || []).slice(0, 50)
  datasetContext =
    `File: ${fileName}\n` +
    `Shape: ${rows} rows × ${columns} columns\n` +
    `Missing values: ${missing} | Duplicate rows: ${duplicates}\n` +
    `Numeric columns: ${numeric} | Categorical columns: ${categorical}\n` +
    `Column names: ${(hdrs || []).join(", ")}\n\n` +
    `Sample data (first ${sample.length} rows):\n` +
    sample.map(row => (hdrs || []).map((h, i) => `${h}: ${row[i] ?? ""}`).join(", ")).join("\n")

  appendBotMessage("Hi! I'm ready to analyze **" + fileName + "**. Use the quick buttons or ask me anything.")

  enableChatInput()
  let inp = document.getElementById("chatInput")
  if(inp) inp.focus()
}


/* ── Send message — FIX: uses authHeaders() + withToken() ── */
function sendChat(){
  if(isSending) return
  let input   = document.getElementById("chatInput")
  let userMsg = input.value.trim()
  if(!userMsg) return

  input.value = ""
  appendUserMessage(userMsg)
  setChatSending(true)

  let typingId = appendTyping()
  chatHistory.push({role:"user", content:userMsg})

  fetch("http://127.0.0.1:5000/chat", {
    method:"POST",
    headers: authHeaders(),
    body: JSON.stringify(withToken({
      message:         userMsg,
      history:         chatHistory.slice(0, -1),
      dataset_context: datasetContext || "No dataset loaded."
    }))
  })
  .then(res => {
    if(!res.ok) throw new Error("Server error " + res.status)
    return res.json()
  })
  .then(data => {
    removeTyping(typingId)
    setChatSending(false)
    if(data.error){
      var errMsg = data.error
      if(errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('invalid key')){
        errMsg = "⚠️ Invalid GROQ_API_KEY.\n\nAdd it to your .env file:\n`GROQ_API_KEY=gsk_your_key_here`\n\nThen restart Flask."
      } else {
        errMsg = "⚠️ " + errMsg + (data.details ? "\n\nDetail: " + data.details.split("\n").slice(-3).join(" ") : "")
      }
      appendBotMessage(errMsg)
      chatHistory.pop()
      return
    }
    chatHistory.push({role:"assistant", content:data.reply})
    appendBotMessage(data.reply)
  })
  .catch(err => {
    removeTyping(typingId)
    setChatSending(false)
    chatHistory.pop()
    let msg = err.message || ""
    if(msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ERR_CONNECTION")){
      appendBotMessage("⚠️ Cannot reach Flask server.\n\nMake sure you ran **python app.py** and it shows:\n`Running on http://127.0.0.1:5000`")
    } else if(msg.includes("401")){
      appendBotMessage("⚠️ Session expired or not logged in.\n\nPlease log in again.")
    } else {
      appendBotMessage("⚠️ Something went wrong: " + msg)
    }
  })
}

function sendQuick(prompt){
  if(isSending) return
  document.getElementById("chatInput").value = prompt
  sendChat()
}

function setChatSending(state){
  isSending = state
  let input = document.getElementById("chatInput")
  let btn   = document.getElementById("sendBtn")
  let qbtns = document.querySelectorAll(".quick-btn")
  if(input){ input.disabled = state }
  if(btn){   btn.disabled = state; btn.style.opacity = state ? "0.5" : "1" }
  qbtns.forEach(b => b.disabled = state)
  if(!state && input) input.focus()
}

function disableChatInput(placeholder){
  let input = document.getElementById("chatInput")
  let btn   = document.getElementById("sendBtn")
  if(input){ input.disabled = true; input.placeholder = placeholder || "Unavailable" }
  if(btn){   btn.disabled = true; btn.style.opacity = "0.4" }
  document.querySelectorAll(".quick-btn").forEach(b => b.disabled = true)
}

function enableChatInput(){
  let input = document.getElementById("chatInput")
  let btn   = document.getElementById("sendBtn")
  if(input){ input.disabled = false; input.placeholder = "Ask anything about your data..." }
  if(btn){   btn.disabled = false; btn.style.opacity = "1" }
}

function getUserAvatarHtml(){
  var email = window.Auth ? window.Auth.getEmail() : (localStorage.getItem('userEmail') || '')
  var name  = window.Auth ? window.Auth.getName()  : (localStorage.getItem('userName')  || '')
  var photo = email ? localStorage.getItem('insightflow_avatar_' + email) : null
  if(photo) return '<div class="user-avatar" style="background-image:url(' + photo + ');background-size:cover;background-position:center;font-size:0"> </div>'
  var initial = (name || email || 'U').charAt(0).toUpperCase()
  return '<div class="user-avatar">' + initial + '</div>'
}

function appendUserMessage(text){
  let win = document.getElementById("chatWindow")
  if(!win) return
  let div = document.createElement("div")
  div.className = "chat-message user-message"
  div.innerHTML = getUserAvatarHtml() + `<div class="message-bubble">${escapeHtml(text)}</div>`
  win.appendChild(div)
  win.scrollTop = win.scrollHeight
}

function appendBotMessage(text){
  let win = document.getElementById("chatWindow")
  if(!win) return
  let div = document.createElement("div")
  div.className = "chat-message bot-message"
  div.innerHTML = `<div class="bot-avatar">AI</div><div class="message-bubble">${formatMarkdown(text)}</div>`
  win.appendChild(div)
  win.scrollTop = win.scrollHeight
}

function appendTyping(){
  let win = document.getElementById("chatWindow")
  if(!win) return ""
  let id  = "typing-" + Date.now()
  let div = document.createElement("div")
  div.className = "chat-message bot-message"
  div.id = id
  div.innerHTML = `<div class="bot-avatar">AI</div><div class="message-bubble typing-bubble"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`
  win.appendChild(div)
  win.scrollTop = win.scrollHeight
  return id
}

function removeTyping(id){
  let el = document.getElementById(id)
  if(el) el.remove()
}

function escapeHtml(t){
  return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
}

function formatMarkdown(t){
  return escapeHtml(t)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/^- (.*)/gm, "• $1")
    .replace(/\n/g, "<br>")
}

window.onload = function(){
  var _isAuthPage = ['index.html','login.html'].some(function(p){
    return window.location.pathname.indexOf(p) !== -1 || window.location.pathname === '/'
  })
  if(!_isAuthPage && getAuthEmail()){
    var _token = getJwtToken()
    if(_token && !isSessionValid()){
      clearSession()
      alert('Your session has expired. Please log in again.')
      window.location.href = 'login.html'
      return
    }
    var _expiry = getTokenExpiry()
    if(_expiry){
      var _remaining = _expiry - Date.now()
      if(_remaining > 0 && _remaining < 30 * 60 * 1000)
        console.warn('InsightFlow: Session expires in', Math.round(_remaining/60000), 'minutes')
    }
  }
  if(document.getElementById("chatWindow")) loadDataset()
  if(document.getElementById("username"))   loadAccount()
}

/* ============================================================
   INSIGHTFLOW — visualize.js
   ============================================================ */

let vizHeaders  = []
let vizDataset  = []
let chartType   = "bar"
let chartColor  = "#ff8c00"
let chartColor2 = "#ffb347"
let chartInst   = null

window.addEventListener("DOMContentLoaded", function(){
  const raw = localStorage.getItem("insightflow_dataset")
  if(!raw){
    document.getElementById("noDataMsg").style.display  = "block"
    document.getElementById("vizContent").style.display = "none"
    return
  }

  const d = JSON.parse(raw)
  vizHeaders = d.headers || []
  vizDataset = d.dataset || []

  const nameEl = document.getElementById("vizDatasetName")
  if(nameEl) nameEl.innerText = d.fileName + " — " + Number(d.rows).toLocaleString() + " rows × " + d.columns + " columns"

  populateSelects()
  buildSummaryStats(d)
})

function isNumericCol(colIdx){
  const vals = vizDataset.map(r => r[colIdx]).filter(v => v !== "" && v !== null && v !== undefined)
  const nums = vals.map(v => parseFloat(v)).filter(v => !isNaN(v))
  return nums.length > vals.length * 0.5
}

/* ── Populate selects — FIX: Y shows ALL columns, smart X≠Y default ── */
function populateSelects(){
  const xMenu = document.getElementById("xAxisMenu")
  const yMenu = document.getElementById("yAxisMenu")

  xMenu.innerHTML = ""
  yMenu.innerHTML = ""

  let firstCat = -1, firstNum = -1, secondNum = -1, secondCol = -1

  vizHeaders.forEach((h, i) => {
    const isNum = isNumericCol(i)

    const xItem = document.createElement("div")
    xItem.className = "chart-dd-item"
    xItem.setAttribute("data-idx", i)
    xItem.innerHTML = `<span>${isNum ? "🔢" : "🔤"}</span> ${h}`
    xItem.onclick = () => pickAxisCol("x", i, h)
    xMenu.appendChild(xItem)

    // Y axis — ALL columns (not just numeric)
    const yItem = document.createElement("div")
    yItem.className = "chart-dd-item"
    yItem.setAttribute("data-idx", i)
    yItem.innerHTML = `<span>${isNum ? "🔢" : "🔤"}</span> ${h}`
    yItem.onclick = () => pickAxisCol("y", i, h)
    yMenu.appendChild(yItem)

    if(firstCat === -1 && !isNum) firstCat = i
    if(firstNum === -1 && isNum)  firstNum = i
    else if(firstNum !== -1 && secondNum === -1 && isNum) secondNum = i
    if(secondCol === -1 && i > 0) secondCol = i
  })

  // Smart auto-select: always pick DIFFERENT columns for X and Y
  let xDefault, yDefault
  if(firstCat !== -1 && firstNum !== -1){ xDefault = firstCat; yDefault = firstNum }
  else if(firstNum !== -1 && secondNum !== -1){ xDefault = firstNum; yDefault = secondNum }
  else if(vizHeaders.length >= 2){ xDefault = 0; yDefault = secondCol !== -1 ? secondCol : 1 }
  else { xDefault = 0; yDefault = 0 }

  pickAxisCol("x", xDefault, vizHeaders[xDefault])
  pickAxisCol("y", yDefault, vizHeaders[yDefault])
}

let xAxisVal = ""
let yAxisVal = ""

function toggleAxisDropdown(axis){
  const menuId = axis === "x" ? "xAxisMenu" : "yAxisMenu"
  const ddId   = axis === "x" ? "xAxisDropdown" : "yAxisDropdown"
  const menu   = document.getElementById(menuId)
  const dd     = document.getElementById(ddId)
  const otherId = axis === "x" ? "yAxisMenu" : "xAxisMenu"
  document.getElementById(otherId)?.classList.remove("open")
  document.getElementById(axis === "x" ? "yAxisDropdown" : "xAxisDropdown")?.classList.remove("open")
  const open = menu.classList.toggle("open")
  dd.classList.toggle("open", open)
}

function pickAxisCol(axis, idx, label){
  if(axis === "x"){
    xAxisVal = idx
    document.getElementById("xAxisLabel").innerText = label
    document.getElementById("xAxisMenu").classList.remove("open")
    document.getElementById("xAxisDropdown").classList.remove("open")
    document.querySelectorAll("#xAxisMenu .chart-dd-item").forEach(i => i.classList.remove("active"))
    document.querySelector(`#xAxisMenu [data-idx="${idx}"]`)?.classList.add("active")
  } else {
    yAxisVal = idx
    document.getElementById("yAxisLabel").innerText = label
    document.getElementById("yAxisMenu").classList.remove("open")
    document.getElementById("yAxisDropdown").classList.remove("open")
    document.querySelectorAll("#yAxisMenu .chart-dd-item").forEach(i => i.classList.remove("active"))
    document.querySelector(`#yAxisMenu [data-idx="${idx}"]`)?.classList.add("active")
  }
  buildChart()
}

function toggleChartDropdown(){
  const menu = document.getElementById("chartDropdownMenu")
  const dd   = document.getElementById("chartDropdown")
  const open = menu.classList.toggle("open")
  dd.classList.toggle("open", open)
}

function pickChart(type, label, el){
  document.getElementById("selectedChartLabel").innerText = label
  document.querySelectorAll(".chart-dd-item").forEach(i => i.classList.remove("active"))
  el.classList.add("active")
  document.getElementById("chartDropdownMenu").classList.remove("open")
  document.getElementById("chartDropdown").classList.remove("open")
  setChartTypeFromSelect(type)
}

document.addEventListener("click", function(e){
  if(!e.target.closest("#chartDropdown")){
    document.getElementById("chartDropdownMenu")?.classList.remove("open")
    document.getElementById("chartDropdown")?.classList.remove("open")
  }
  if(!e.target.closest("#xAxisDropdown")){
    document.getElementById("xAxisMenu")?.classList.remove("open")
    document.getElementById("xAxisDropdown")?.classList.remove("open")
  }
  if(!e.target.closest("#yAxisDropdown")){
    document.getElementById("yAxisMenu")?.classList.remove("open")
    document.getElementById("yAxisDropdown")?.classList.remove("open")
  }
})

function updateDPDisplay(val){
  const range = document.getElementById("maxPoints")
  const pct = (val - range.min) / (range.max - range.min) * 100
  range.style.setProperty("--fill", pct + "%")
}

function setChartTypeFromSelect(type){
  chartType = type
  const noY = ["pie", "doughnut", "polarArea"]
  document.getElementById("yAxisGroup").style.display = noY.includes(type) ? "none" : "block"
  const showToggle = ["bar","horizontalBar","stackedBar"].includes(type)
  const toggleRow  = document.getElementById("multiColorToggle")?.closest(".control-group")
  if(toggleRow) toggleRow.style.display = showToggle ? "block" : "none"
  buildChart()
}

function setColor(c1, c2, el){
  chartColor  = c1
  chartColor2 = c2
  document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("active"))
  if(el) el.classList.add("active")
  buildChart()
}

function buildChart(){
  const xIdx = parseInt(xAxisVal)
  const yIdx = parseInt(yAxisVal)
  const max  = parseInt(document.getElementById("maxPoints").value)

  if(isNaN(xIdx) || (chartType !== "pie" && isNaN(yIdx))){
    document.getElementById("chartPlaceholder").style.display = "flex"
    document.getElementById("myChart").style.display = "none"
    return
  }

  document.getElementById("chartPlaceholder").style.display = "none"
  document.getElementById("myChart").style.display          = "block"

  const rows   = vizDataset.slice(0, max)
  const labels = rows.map(r => String(r[xIdx] ?? ""))
  const values = rows.map(r => parseFloat(r[yIdx]) || 0)

  if(chartInst) chartInst.destroy()

  const ctx = document.getElementById("myChart").getContext("2d")

  const multiColors = ["#ff8c00","#3b82f6","#10b981","#ec4899","#8b5cf6","#ef4444","#f59e0b","#06b6d4","#84cc16","#f97316"]
  const noYTypes   = ["pie","doughnut","polarArea"]
  const isMultiCol = noYTypes.includes(chartType)

  let dsConfig = {}

  if(isMultiCol){
    const counts = countOccurrences(labels)
    dsConfig = { label: vizHeaders[xIdx], data: Object.values(counts), backgroundColor: multiColors, borderWidth: 2, borderColor: "#0d1117" }
  } else if(chartType === "scatter"){
    dsConfig = { label: `${vizHeaders[xIdx]} vs ${vizHeaders[yIdx]}`, data: rows.map(r => ({ x: parseFloat(r[xIdx])||0, y: parseFloat(r[yIdx])||0 })), backgroundColor: chartColor + "bb", borderColor: chartColor, pointRadius: 6, pointHoverRadius: 8 }
  } else if(chartType === "bubble"){
    dsConfig = { label: `${vizHeaders[xIdx]} vs ${vizHeaders[yIdx]}`, data: rows.map((r,i) => ({ x: parseFloat(r[xIdx])||i, y: parseFloat(r[yIdx])||0, r: Math.max(3, Math.min(20, (parseFloat(r[yIdx])||10)/10)) })), backgroundColor: chartColor + "88", borderColor: chartColor, borderWidth: 1 }
  } else if(chartType === "radar"){
    dsConfig = { label: vizHeaders[yIdx], data: values, backgroundColor: chartColor + "33", borderColor: chartColor, borderWidth: 2, pointBackgroundColor: chartColor, pointRadius: 4 }
  } else {
    const isArea = chartType === "area", isHBar = chartType === "horizontalBar", isStackedBar = chartType === "stackedBar"
    const isMultiMode = document.getElementById("multiColorToggle")?.checked
    const mc2 = ["#ff8c00","#3b82f6","#10b981","#ec4899","#8b5cf6","#ef4444","#f59e0b","#06b6d4","#84cc16","#f97316","#14b8a6","#a855f7","#64748b","#fb7185","#38bdf8"]
    const bgColor = isMultiMode ? values.map((_,i) => mc2[i%mc2.length]+"dd") : (isArea||chartType==="line") ? chartColor+"22" : chartColor+"dd"
    const borderCol = isMultiMode ? values.map((_,i) => mc2[i%mc2.length]) : chartColor
    dsConfig = { label: vizHeaders[yIdx], data: values, backgroundColor: bgColor, borderColor: borderCol, borderWidth: 2, borderRadius: (chartType==="bar"||isStackedBar)?6:0, fill: isArea, tension: 0.4, pointBackgroundColor: isMultiMode?mc2:chartColor2, pointBorderColor: isMultiMode?mc2:chartColor, pointRadius: (chartType==="line"||isArea)?4:0, pointHoverRadius: 6 }
  }

  const chartData = isMultiCol ? { labels: Object.keys(countOccurrences(labels)), datasets: [dsConfig] } : { labels, datasets: [dsConfig] }
  const noScales = ["pie","doughnut","polarArea","radar"]
  const isHBar = chartType === "horizontalBar", isStackedBar = chartType === "stackedBar", isArea = chartType === "area"
  const actualType = isHBar ? "bar" : isStackedBar ? "bar" : isArea ? "line" : chartType

  chartInst = new Chart(ctx, {
    type: actualType,
    data: chartData,
    options: {
      responsive: true, maintainAspectRatio: false, aspectRatio: 0,
      layout: { padding: { top:10, bottom:10, left:5, right:10 } },
      animation: { duration: 600, easing: "easeInOutQuart" },
      plugins: {
        title: { display: true, text: noScales.includes(chartType) ? `${vizHeaders[xIdx]} Distribution` : `${vizHeaders[xIdx]} vs ${vizHeaders[yIdx]}`, color: "#cccccc", font: { size:13, weight:"600" }, padding: { bottom:16 } },
        legend: { display: false },
        tooltip: { backgroundColor: "rgba(10,10,20,0.9)", titleColor: chartColor, bodyColor: "#ffffff", borderColor: chartColor+"44", borderWidth:1, padding:12, cornerRadius:8 }
      },
      indexAxis: isHBar ? "y" : "x",
      scales: noScales.includes(chartType) ? {} : {
        x: { stacked: isStackedBar, title: { display:true, text: isHBar?vizHeaders[yIdx]:vizHeaders[xIdx], color:"#888", font:{size:12,weight:"600"}, padding:{top:10} }, ticks:{color:"#666",maxRotation:40,font:{size:11}}, grid:{color:"rgba(255,255,255,0.04)"} },
        y: { stacked: isStackedBar, title: { display:true, text: isHBar?vizHeaders[xIdx]:vizHeaders[yIdx], color:"#888", font:{size:12,weight:"600"}, padding:{bottom:10} }, ticks:{color:"#666",font:{size:11}}, grid:{color:"rgba(255,255,255,0.04)"} }
      }
    }
  })
}

function countOccurrences(arr){
  const map = {}
  arr.forEach(v => { map[v] = (map[v]||0) + 1 })
  return map
}

function buildSummaryStats(d){
  const grid = document.getElementById("statsGrid")
  document.getElementById("vizStats").style.display = "block"
  grid.innerHTML = d.headers.map((h, i) => {
    const vals  = d.dataset.map(r => r[i]).filter(v => v !== "" && v !== null && v !== undefined)
    const nums  = vals.map(v => parseFloat(v)).filter(v => !isNaN(v))
    const isNum = nums.length > vals.length * 0.5
    const miss  = d.dataset.length - vals.length
    let rows = isNum && nums.length > 0
      ? `<div class="stat-row"><span>Min</span><span>${Math.min(...nums).toLocaleString()}</span></div><div class="stat-row"><span>Max</span><span>${Math.max(...nums).toLocaleString()}</span></div><div class="stat-row"><span>Avg</span><span>${(nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(2)}</span></div>`
      : `<div class="stat-row"><span>Unique</span><span>${new Set(vals).size}</span></div>`
    return `<div class="stat-card"><div class="stat-col-name" title="${h}">${h}</div><div class="stat-type">${isNum?"Numeric":"Categorical"}</div>${rows}<div class="stat-row missing"><span>Missing</span><span>${miss}</span></div></div>`
  }).join("")
}

function downloadChart(format){
  if(!chartInst){ alert("Generate a chart first"); return }
  const canvas = document.getElementById("myChart")
  let link = document.createElement("a")
  if(format === "jpg"){
    const tmp = document.createElement("canvas"); tmp.width = canvas.width; tmp.height = canvas.height
    const tCtx = tmp.getContext("2d"); tCtx.fillStyle = "#0f172a"; tCtx.fillRect(0,0,tmp.width,tmp.height); tCtx.drawImage(canvas,0,0)
    link.download = "insightflow-chart.jpg"; link.href = tmp.toDataURL("image/jpeg",0.95)
  } else { link.download = "insightflow-chart.png"; link.href = canvas.toDataURL("image/png") }
  link.click()
}

function saveChart(){
  if(!chartInst){ alert('Generate a chart first'); return }
  var email = getAuthEmail()
  if(!email){ alert('Please log in to save charts'); return }
  var nameDefault = (vizHeaders[xAxisVal] || 'X') + ' vs ' + (vizHeaders[yAxisVal] || 'Y')
  var chartName = prompt('Chart name:', nameDefault)
  if(!chartName) return
  var thumbnail = null
  try{
    var canvas = document.getElementById('myChart')
    var tmp = document.createElement('canvas'); tmp.width = 400; tmp.height = 220
    var tCtx = tmp.getContext('2d'); tCtx.fillStyle = '#0f172a'; tCtx.fillRect(0,0,tmp.width,tmp.height); tCtx.drawImage(canvas,0,0,tmp.width,tmp.height)
    thumbnail = tmp.toDataURL('image/jpeg',0.7)
  }catch(e){}
  var config = JSON.stringify({ chartType:chartType, xAxis:xAxisVal, yAxis:yAxisVal, color:chartColor, color2:chartColor2 })
  var btn = document.getElementById('saveChartBtn')
  if(btn){ btn.textContent = 'Saving...'; btn.disabled = true }
  fetch('http://127.0.0.1:5000/charts/save', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(withToken({ chart_name:chartName, chart_type:chartType, config:config, thumbnail:thumbnail }))
  })
  .then(function(r){ return r.json() })
  .then(function(d){
    if(btn){ btn.textContent = '\uD83D\uDCBE Save Chart'; btn.disabled = false }
    if(d.status === 'success') alert('Chart saved! View in Account \u2192 Saved Charts.')
    else alert('Save failed: ' + (d.error || 'Unknown error'))
  })
  .catch(function(){
    if(btn){ btn.textContent = '\uD83D\uDCBE Save Chart'; btn.disabled = false }
    alert('Could not reach server.')
  })
}

function toggleTheme(){
  const body = document.body, btn = document.getElementById("themeToggle")
  const isLight = body.classList.toggle("light-mode")
  btn.textContent = isLight ? "🌙" : "☀️"
  localStorage.setItem("vizTheme", isLight ? "light" : "dark")
  if(chartInst){
    const tc = isLight?"#333":"#666", gc = isLight?"rgba(0,0,0,0.08)":"rgba(255,255,255,0.04)", ttc = isLight?"#111":"#cccccc"
    if(chartInst.options.plugins?.title) chartInst.options.plugins.title.color = ttc
    if(chartInst.options.scales?.x){ chartInst.options.scales.x.ticks.color=tc; chartInst.options.scales.x.grid.color=gc; chartInst.options.scales.x.title.color=tc }
    if(chartInst.options.scales?.y){ chartInst.options.scales.y.ticks.color=tc; chartInst.options.scales.y.grid.color=gc; chartInst.options.scales.y.title.color=tc }
    chartInst.update()
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if(localStorage.getItem("vizTheme") === "light"){
    document.body.classList.add("light-mode")
    const btn = document.getElementById("themeToggle")
    if(btn) btn.textContent = "🌙"
  }
})

function goAccount(){ window.location.href = "account.html" }
/* ============================================================
   INSIGHTFLOW — report.js  (Dashboard Generator)
   ============================================================ */

let rptHeaders  = []
let rptDataset  = []
let rptMeta     = {}
let chartInsts  = []

const CHART_COLORS = ["#ff8c00","#3b82f6","#10b981","#ec4899","#8b5cf6","#ef4444","#f59e0b","#06b6d4"]

window.addEventListener("DOMContentLoaded", function(){
  const raw = localStorage.getItem("insightflow_dataset")
  if(!raw){ document.getElementById("noDataMsg").style.display="block"; document.getElementById("reportContent").style.display="none"; return }
  const d = JSON.parse(raw)
  rptHeaders = d.headers || []; rptDataset = d.dataset || []; rptMeta = d
  document.getElementById("reportMeta").innerText = `${d.fileName}  ·  ${Number(d.rows).toLocaleString()} rows  ·  ${d.columns} columns`
  buildDashboard()
})

function buildDashboard(){
  chartInsts.forEach(c => c.destroy()); chartInsts = []
  const numCols = rptHeaders.filter((h,i) => isNumericCol(i)), catCols = rptHeaders.filter((h,i) => !isNumericCol(i))
  const numIdx = rptHeaders.map((h,i)=>i).filter(i => isNumericCol(i)), catIdx = rptHeaders.map((h,i)=>i).filter(i => !isNumericCol(i))
  buildKPIs(numIdx, catIdx); buildCharts(numIdx, catIdx); buildAISuggestion(numCols, catCols)
}

function buildKPIs(numIdx, catIdx){
  const row = document.getElementById("kpiRow"); row.innerHTML = ""
  const kpis = []
  numIdx.slice(0,4).forEach(i => {
    const vals = rptDataset.map(r => parseFloat(r[i])).filter(v => !isNaN(v)); if(!vals.length) return
    const avg = vals.reduce((a,b)=>a+b,0)/vals.length, min = Math.min(...vals), max = Math.max(...vals)
    const prev = avg*(0.85+Math.random()*0.15), trend = avg>=prev?"up":"down", pct = Math.abs(((avg-prev)/prev)*100).toFixed(1)
    kpis.push({ label:rptHeaders[i], value: avg%1===0?avg.toLocaleString():avg.toFixed(2), sub:`Min ${min.toLocaleString()}  ·  Max ${max.toLocaleString()}`, trend, pct })
  })
  catIdx.slice(0,2).forEach(i => {
    const vals = rptDataset.map(r => r[i]).filter(v => v!==""&&v!=null)
    kpis.push({ label:rptHeaders[i], value:new Set(vals).size, sub:`${vals.length} total values`, trend:"neutral", pct:"0" })
  })
  kpis.forEach(k => {
    const arrow = k.trend==="up"?`<span class="kpi-trend up">▲ ${k.pct}%</span>`:k.trend==="down"?`<span class="kpi-trend down">▼ ${k.pct}%</span>`:`<span class="kpi-trend neutral">● Categorical</span>`
    row.innerHTML += `<div class="rpt-kpi-card"><div class="rpt-kpi-label">${k.label}</div><div class="rpt-kpi-value">${k.value}</div><div class="rpt-kpi-sub">${k.sub}</div>${arrow}</div>`
  })
}

function buildCharts(numIdx, catIdx){
  const grid = document.getElementById("chartsGrid"); grid.innerHTML = ""
  suggestCharts(numIdx, catIdx).forEach((cfg, idx) => {
    const id = `rptChart_${idx}`, div = document.createElement("div")
    div.className = "rpt-chart-card"
    div.innerHTML = `<div class="rpt-chart-header"><span class="rpt-chart-title">${cfg.title}</span><span class="rpt-chart-type">${cfg.typeLabel}</span></div><canvas id="${id}"></canvas>`
    grid.appendChild(div)
    setTimeout(() => { const inst = renderChart(id, cfg); if(inst) chartInsts.push(inst) }, idx*100)
  })
}

function suggestCharts(numIdx, catIdx){
  const charts = [], rows = rptDataset.slice(0,20)
  if(catIdx.length>0&&numIdx.length>0){ const xi=catIdx[0],yi=numIdx[0]; charts.push({type:"bar",typeLabel:"Bar Chart",title:`${rptHeaders[xi]} vs ${rptHeaders[yi]}`,labels:rows.map(r=>String(r[xi]??"")),data:rows.map(r=>parseFloat(r[yi])||0),color:CHART_COLORS[0]}) }
  if(numIdx.length>1){ const yi=numIdx[1]; charts.push({type:"line",typeLabel:"Line Chart",title:`${rptHeaders[yi]} Trend`,labels:rows.map((_,i)=>`#${i+1}`),data:rows.map(r=>parseFloat(r[yi])||0),color:CHART_COLORS[1]}) }
  if(catIdx.length>0){ const xi=catIdx[0],vals=rptDataset.map(r=>String(r[xi]??"")),counts={}; vals.forEach(v=>{counts[v]=(counts[v]||0)+1}); const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8); charts.push({type:"pie",typeLabel:"Pie Chart",title:`${rptHeaders[xi]} Distribution`,labels:top.map(e=>e[0]),data:top.map(e=>e[1]),color:CHART_COLORS}) }
  if(catIdx.length>1){ const xi=catIdx[1],vals=rptDataset.map(r=>String(r[xi]??"")),counts={}; vals.forEach(v=>{counts[v]=(counts[v]||0)+1}); const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6); charts.push({type:"doughnut",typeLabel:"Doughnut",title:`${rptHeaders[xi]} Breakdown`,labels:top.map(e=>e[0]),data:top.map(e=>e[1]),color:CHART_COLORS}) }
  if(catIdx.length>0&&numIdx.length>1){ const xi=catIdx.length>1?catIdx[1]:catIdx[0],yi=numIdx[1]; charts.push({type:"horizontalBar",typeLabel:"Horizontal Bar",title:`${rptHeaders[xi]} by ${rptHeaders[yi]}`,labels:rows.map(r=>String(r[xi]??"")),data:rows.map(r=>parseFloat(r[yi])||0),color:CHART_COLORS[2]}) }
  if(numIdx.length>=2){ const xi=numIdx[0],yi=numIdx[1]; charts.push({type:"scatter",typeLabel:"Scatter Plot",title:`${rptHeaders[xi]} vs ${rptHeaders[yi]}`,scatterData:rows.map(r=>({x:parseFloat(r[xi])||0,y:parseFloat(r[yi])||0})),color:CHART_COLORS[3]}) }
  return charts
}

function renderChart(canvasId, cfg){
  const ctx = document.getElementById(canvasId); if(!ctx) return null
  const isCircular=["pie","doughnut","polarArea"].includes(cfg.type), isHBar=cfg.type==="horizontalBar", isScatter=cfg.type==="scatter"
  let dataset = {}
  if(isCircular){ dataset={data:cfg.data,backgroundColor:cfg.color,borderWidth:2,borderColor:"#0d1117"} }
  else if(isScatter){ dataset={data:cfg.scatterData,backgroundColor:cfg.color+"99",borderColor:cfg.color,pointRadius:5} }
  else { const isLine=cfg.type==="line"; dataset={data:cfg.data,backgroundColor:isLine?cfg.color+"22":cfg.color+"cc",borderColor:cfg.color,borderWidth:2,borderRadius:isLine?0:5,fill:isLine,tension:0.4,pointRadius:isLine?3:0} }
  return new Chart(ctx, {
    type: isHBar?"bar":isCircular?cfg.type:isScatter?"scatter":cfg.type,
    data: { labels:cfg.labels||[], datasets:[dataset] },
    options: { responsive:true, maintainAspectRatio:false, indexAxis:isHBar?"y":"x", animation:{duration:800,easing:"easeInOutQuart"},
      plugins: { legend:{display:isCircular,labels:{color:"#aaa",font:{size:11},padding:10,usePointStyle:true}}, tooltip:{backgroundColor:"rgba(10,10,20,0.9)",titleColor:cfg.color.length>7?"#ff8c00":cfg.color,bodyColor:"#fff",padding:10,cornerRadius:8} },
      scales: isCircular?{}:{ x:{ticks:{color:"#555",font:{size:10},maxRotation:40},grid:{color:"rgba(255,255,255,0.04)"}}, y:{ticks:{color:"#555",font:{size:10}},grid:{color:"rgba(255,255,255,0.04)"}} }
    }
  })
}

function buildAISuggestion(numCols, catCols){
  const tips = []
  if(numCols.length>0) tips.push(`${numCols.length} numeric column${numCols.length>1?'s':''} detected — showing trend and distribution charts`)
  if(catCols.length>0) tips.push(`${catCols.length} categorical column${catCols.length>1?'s':''} — pie and bar breakdowns generated`)
  if(rptMeta.missing>0) tips.push(`⚠️ ${rptMeta.missing} missing values detected`)
  if(rptMeta.duplicates>0) tips.push(`⚠️ ${rptMeta.duplicates} duplicate rows found`)
  const el = document.getElementById("aiSuggestionText")
  if(el) el.innerText = tips.join("  ·  ") || "Dashboard generated from your dataset"
}

function isNumericCol(colIdx){
  const vals = rptDataset.map(r => r[colIdx]).filter(v => v!==""&&v!==null&&v!==undefined)
  const nums = vals.map(v => parseFloat(v)).filter(v => !isNaN(v))
  return nums.length > vals.length * 0.5
}

function regenerate(){ buildDashboard() }

function exportDashboard(){
  alert("To export: Right-click the page → Print → Save as PDF\n\nOr use Ctrl+P and select 'Save as PDF'")
}

function logout() {
  try { sessionStorage.removeItem('insightflow_redirect') } catch(e) {}
  try {
    var email = getAuthEmail()
    if (email) fetch("http://127.0.0.1:5000/logout", {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify(withToken({ email: email }))
    }).catch(function () {})
  } catch(e) {}
  clearSession()
  // Wipe JWT directly — do NOT call Auth.logout() as it causes double redirect
  try { localStorage.removeItem('insightflow_jwt') } catch(e) {}
  window.location.href = "login.html"  // ← always lands on login, then dashboard after login
}