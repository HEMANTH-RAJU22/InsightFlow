/* ============================================================
   INSIGHTFLOW — script.js
   ============================================================ */

let chartInstance
let dataset     = []
let headers     = []
let currentPage = 1
let rowsPerPage = 10


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

  /* reset previous */
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

  /* show file info */
  document.getElementById("fileName").innerText = file.name
  document.getElementById("fileSize").innerText = file.size < 1048576
    ? (file.size / 1024).toFixed(2) + " KB"
    : (file.size / 1048576).toFixed(2) + " MB"
  document.getElementById("fileType").innerText = file.name.split(".").pop().toUpperCase()

  showLoading(file.name)

  let formData = new FormData()
  formData.append("file", file)

  fetch("http://127.0.0.1:5000/upload", { method:"POST", body:formData })
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

  /* CSV / TXT */
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
function logout(){
  if(window.Auth) window.Auth.logout()
  else {
    localStorage.removeItem("userEmail")
    localStorage.removeItem("insightflow_dataset")
    window.location.href = "index.html"
  }
}


/* ── Auth ───────────────────────────────────────────────────── */
function login(){
  let email    = document.getElementById("emailInput").value.trim().toLowerCase()
  let password = document.getElementById("passwordInput").value
  let btn      = document.getElementById("mainButton")

  if(!email || !password){ alert("Email and password are required."); return }

  if(btn){ btn.disabled = true; btn.innerText = "Logging in..." }

  fetch("http://127.0.0.1:5000/login", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email, password})
  })
  .then(res => res.json())
  .then(data => {
    if(data.status === "success"){
      // Use Auth module — creates secure session with token + expiry
      if(window.Auth) window.Auth.setSession(data.email, data.name)
      else localStorage.setItem("userEmail", data.email)  // fallback
      // Redirect to intended page or dashboard
      let dest = "dashboard.html"
      try { dest = sessionStorage.getItem("insightflow_redirect") || "dashboard.html" } catch(e){}
      try { sessionStorage.removeItem("insightflow_redirect") } catch(e){}
      window.location.href = dest
    } else {
      if(btn){ btn.disabled = false; btn.innerText = "Login" }
      alert(data.message || "Login failed")
    }
  })
  .catch(() => {
    if(btn){ btn.disabled = false; btn.innerText = "Login" }
    alert("Cannot reach server. Make sure Flask is running.")
  })
}

function register(){
  let name     = document.getElementById("nameInput").value.trim()
  let email    = document.getElementById("emailInput").value.trim().toLowerCase()
  let password = document.getElementById("passwordInput").value
  let btn      = document.getElementById("mainButton")

  if(!name || !email || !password){ alert("All fields are required."); return }
  if(name.length < 2){ alert("Name must be at least 2 characters."); return }
  if(!/^[^@]+@[^@]+\.[^@]+$/.test(email)){ alert("Enter a valid email address."); return }
  if(password.length < 6){ alert("Password must be at least 6 characters."); return }

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
      toggleForm()  // Switch back to login form
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
  let email = window.Auth ? window.Auth.getEmail() : localStorage.getItem("userEmail")
  if(!email){ window.location.href = "index.html"; return }
  fetch(`http://127.0.0.1:5000/account/${encodeURIComponent(email)}`)
    .then(res => { if(!res.ok) throw new Error("Not found"); return res.json() })
    .then(data => {
      if(data.error){ console.warn("Account:", data.error); return }
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


/* ── Load dataset from sessionStorage ─────────────────────── */
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

  /* update header UI */
  /* datasetLabel removed from UI */

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

  /* build context for AI — 50 sample rows */
  const sample = (ds || []).slice(0, 50)
  datasetContext =
    `File: ${fileName}\n` +
    `Shape: ${rows} rows × ${columns} columns\n` +
    `Missing values: ${missing} | Duplicate rows: ${duplicates}\n` +
    `Numeric columns: ${numeric} | Categorical columns: ${categorical}\n` +
    `Column names: ${(hdrs || []).join(", ")}\n\n` +
    `Sample data (first ${sample.length} rows):\n` +
    sample.map(row => (hdrs || []).map((h, i) => `${h}: ${row[i] ?? ""}`).join(", ")).join("\n")

  /* simple greeting */
  appendBotMessage("Hi! I'm ready to analyze **" + fileName + "**. Use the quick buttons or ask me anything.")

  enableChatInput()
  let inp = document.getElementById("chatInput")
  if(inp) inp.focus()
}


/* ── Send message ──────────────────────────────────────────── */
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
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      message:         userMsg,
      history:         chatHistory.slice(0, -1),
      dataset_context: datasetContext || "No dataset loaded."
    })
  })
  .then(res => {
    if(!res.ok) throw new Error("Server error " + res.status)
    return res.json()
  })
  .then(data => {
    removeTyping(typingId)
    setChatSending(false)
    if(data.error){ appendBotMessage("⚠️ " + data.error + (data.details ? "\n\nDetail: " + data.details.split("\n").slice(-3).join(" ") : "")); chatHistory.pop(); return }
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
      appendBotMessage("⚠️ Invalid API key.\n\nSet your key before starting Flask:\n`set ANTHROPIC_API_KEY=sk-ant-...`")
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


/* ── Chat input state ──────────────────────────────────────── */
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


/* ── Message rendering ─────────────────────────────────────── */
function appendUserMessage(text){
  let win = document.getElementById("chatWindow")
  if(!win) return
  let div = document.createElement("div")
  div.className = "chat-message user-message"
  div.innerHTML = `<div class="user-avatar">YOU</div><div class="message-bubble">${escapeHtml(text)}</div>`
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


/* ── Init ───────────────────────────────────────────────────── */
window.onload = function(){
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


/* ── Init ── */
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


/* ── Detect numeric column ── */
function isNumericCol(colIdx){
  const vals = vizDataset.map(r => r[colIdx]).filter(v => v !== "" && v !== null && v !== undefined)
  const nums = vals.map(v => parseFloat(v)).filter(v => !isNaN(v))
  return nums.length > vals.length * 0.5
}


/* ── Populate selects ── */
function populateSelects(){
  const xMenu = document.getElementById("xAxisMenu")
  const yMenu = document.getElementById("yAxisMenu")

  xMenu.innerHTML = ""
  yMenu.innerHTML = ""

  let firstCat = -1, firstNum = -1

  vizHeaders.forEach((h, i) => {
    const isNum = isNumericCol(i)

    const xItem = document.createElement("div")
    xItem.className = "chart-dd-item"
    xItem.setAttribute("data-idx", i)
    xItem.innerHTML = `<span>${isNum ? "🔢" : "🔤"}</span> ${h}`
    xItem.onclick = () => pickAxisCol("x", i, h)
    xMenu.appendChild(xItem)

    if(isNum){
      const yItem = document.createElement("div")
      yItem.className = "chart-dd-item"
      yItem.setAttribute("data-idx", i)
      yItem.innerHTML = `<span>🔢</span> ${h}`
      yItem.onclick = () => pickAxisCol("y", i, h)
      yMenu.appendChild(yItem)
    }

    if(firstCat === -1 && !isNum) firstCat = i
    if(firstNum === -1 && isNum)  firstNum = i
  })

  // auto-select
  const xDefault = firstCat !== -1 ? firstCat : 0
  const yDefault = firstNum !== -1 ? firstNum : 0

  pickAxisCol("x", xDefault, vizHeaders[xDefault])
  pickAxisCol("y", yDefault, vizHeaders[yDefault])
}


/* ── Axis dropdown helpers ── */
let xAxisVal = ""
let yAxisVal = ""

function toggleAxisDropdown(axis){
  const menuId = axis === "x" ? "xAxisMenu" : "yAxisMenu"
  const ddId   = axis === "x" ? "xAxisDropdown" : "yAxisDropdown"
  const menu   = document.getElementById(menuId)
  const dd     = document.getElementById(ddId)
  // close other
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

/* ── Custom chart dropdown ── */
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

// Close all dropdowns when clicking outside
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

/* ── Update data points display ── */
function updateDPDisplay(val){
  const range = document.getElementById("maxPoints")
  const pct = (val - range.min) / (range.max - range.min) * 100
  range.style.setProperty("--fill", pct + "%")
}

/* ── Chart type from dropdown ── */
function setChartTypeFromSelect(type){
  chartType = type
  const noY = ["pie", "doughnut", "polarArea"]
  document.getElementById("yAxisGroup").style.display =
    noY.includes(type) ? "none" : "block"

  // multi-color toggle only useful for bar/horizontalBar/stackedBar
  // pie/doughnut/polarArea already use multi colors by default
  // line/area/scatter/bubble/radar use single color by nature
  const showToggle = ["bar","horizontalBar","stackedBar"].includes(type)
  const toggleRow  = document.getElementById("multiColorToggle")?.closest(".control-group")
  if(toggleRow) toggleRow.style.display = showToggle ? "block" : "none"

  buildChart()
}


/* ── Set color ── */
function setColor(c1, c2, el){
  chartColor  = c1
  chartColor2 = c2
  document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("active"))
  if(el) el.classList.add("active")
  buildChart()
}


/* ── Build chart ── */
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

  const multiColors = [
    "#ff8c00","#3b82f6","#10b981","#ec4899","#8b5cf6",
    "#ef4444","#f59e0b","#06b6d4","#84cc16","#f97316"
  ]

  const noYTypes   = ["pie","doughnut","polarArea"]
  const isMultiCol = noYTypes.includes(chartType)

  let dsConfig = {}

  if(isMultiCol){
    const counts = countOccurrences(labels)
    dsConfig = {
      label: vizHeaders[xIdx],
      data:  Object.values(counts),
      backgroundColor: multiColors,
      borderWidth: 2,
      borderColor: "#0d1117"
    }
  } else if(chartType === "scatter"){
    dsConfig = {
      label: `${vizHeaders[xIdx]} vs ${vizHeaders[yIdx]}`,
      data:  rows.map(r => ({ x: parseFloat(r[xIdx])||0, y: parseFloat(r[yIdx])||0 })),
      backgroundColor: chartColor + "bb",
      borderColor: chartColor,
      pointRadius: 6,
      pointHoverRadius: 8
    }
  } else if(chartType === "bubble"){
    dsConfig = {
      label: `${vizHeaders[xIdx]} vs ${vizHeaders[yIdx]}`,
      data:  rows.map((r,i) => ({
        x: parseFloat(r[xIdx])||i,
        y: parseFloat(r[yIdx])||0,
        r: Math.max(3, Math.min(20, (parseFloat(r[yIdx])||10)/10))
      })),
      backgroundColor: chartColor + "88",
      borderColor: chartColor,
      borderWidth: 1
    }
  } else if(chartType === "radar"){
    dsConfig = {
      label: vizHeaders[yIdx],
      data:  values,
      backgroundColor: chartColor + "33",
      borderColor: chartColor,
      borderWidth: 2,
      pointBackgroundColor: chartColor,
      pointRadius: 4
    }
  } else {
    const isArea       = chartType === "area"
    const isHBar       = chartType === "horizontalBar"
    const isStackedBar = chartType === "stackedBar"
    const isMultiMode  = document.getElementById("multiColorToggle")?.checked

    const multiColors = [
      "#ff8c00","#3b82f6","#10b981","#ec4899","#8b5cf6",
      "#ef4444","#f59e0b","#06b6d4","#84cc16","#f97316",
      "#14b8a6","#a855f7","#64748b","#fb7185","#38bdf8"
    ]

    const bgColor = isMultiMode
      ? values.map((_, i) => multiColors[i % multiColors.length] + "dd")
      : (isArea || chartType === "line") ? chartColor + "22" : chartColor + "dd"

    const borderCol = isMultiMode
      ? values.map((_, i) => multiColors[i % multiColors.length])
      : chartColor

    dsConfig = {
      label: vizHeaders[yIdx],
      data:  values,
      backgroundColor: bgColor,
      borderColor: borderCol,
      borderWidth: 2,
      borderRadius: (chartType === "bar" || isStackedBar) ? 6 : 0,
      fill: isArea,
      tension: 0.4,
      pointBackgroundColor: isMultiMode ? multiColors : chartColor2,
      pointBorderColor: isMultiMode ? multiColors : chartColor,
      pointRadius: (chartType === "line" || isArea) ? 4 : 0,
      pointHoverRadius: 6
    }
  }

  const chartData = isMultiCol
    ? { labels: Object.keys(countOccurrences(labels)), datasets: [dsConfig] }
    : { labels, datasets: [dsConfig] }

  const noScales     = ["pie","doughnut","polarArea","radar"]
  const isHBar       = chartType === "horizontalBar"
  const isStackedBar = chartType === "stackedBar"
  const isArea       = chartType === "area"
  const actualType   = isHBar ? "bar" : isStackedBar ? "bar" : isArea ? "line" : chartType

  chartInst = new Chart(ctx, {
    type: actualType,
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: 0,
      layout: {
        padding: { top: 10, bottom: 10, left: 5, right: 10 }
      },
      animation: { duration: 600, easing: "easeInOutQuart" },
      plugins: {
        title: {
          display: true,
          text: noScales.includes(chartType)
            ? `${vizHeaders[xIdx]} Distribution`
            : `${vizHeaders[xIdx]} vs ${vizHeaders[yIdx]}`,
          color: "#cccccc",
          font: { size: 13, weight: "600" },
          padding: { bottom: 16 }
        },
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: "rgba(10,10,20,0.9)",
          titleColor: chartColor,
          bodyColor: "#ffffff",
          borderColor: chartColor + "44",
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8
        }
      },
      indexAxis: isHBar ? "y" : "x",
      scales: noScales.includes(chartType) ? {} : {
        x: {
          stacked: isStackedBar,
          title: {
            display: true,
            text: isHBar ? vizHeaders[yIdx] : vizHeaders[xIdx],
            color: "#888",
            font: { size: 12, weight: "600" },
            padding: { top: 10 }
          },
          ticks: { color: "#666", maxRotation: 40, font: { size: 11 } },
          grid:  { color: "rgba(255,255,255,0.04)" }
        },
        y: {
          stacked: isStackedBar,
          title: {
            display: true,
            text: isHBar ? vizHeaders[xIdx] : vizHeaders[yIdx],
            color: "#888",
            font: { size: 12, weight: "600" },
            padding: { bottom: 10 }
          },
          ticks: { color: "#666", font: { size: 11 } },
          grid:  { color: "rgba(255,255,255,0.04)" }
        }
      }
    }
  })
}


/* ── Count for pie ── */
function countOccurrences(arr){
  const map = {}
  arr.forEach(v => { map[v] = (map[v]||0) + 1 })
  return map
}


/* ── Summary stats ── */
function buildSummaryStats(d){
  const grid = document.getElementById("statsGrid")
  document.getElementById("vizStats").style.display = "block"

  grid.innerHTML = d.headers.map((h, i) => {
    const vals  = d.dataset.map(r => r[i]).filter(v => v !== "" && v !== null && v !== undefined)
    const nums  = vals.map(v => parseFloat(v)).filter(v => !isNaN(v))
    const isNum = nums.length > vals.length * 0.5
    const miss  = d.dataset.length - vals.length

    let rows = ""
    if(isNum && nums.length > 0){
      const min = Math.min(...nums).toLocaleString()
      const max = Math.max(...nums).toLocaleString()
      const avg = (nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(2)
      rows = `
        <div class="stat-row"><span>Min</span><span>${min}</span></div>
        <div class="stat-row"><span>Max</span><span>${max}</span></div>
        <div class="stat-row"><span>Avg</span><span>${avg}</span></div>
      `
    } else {
      rows = `<div class="stat-row"><span>Unique</span><span>${new Set(vals).size}</span></div>`
    }

    return `
      <div class="stat-card">
        <div class="stat-col-name" title="${h}">${h}</div>
        <div class="stat-type">${isNum ? "Numeric" : "Categorical"}</div>
        ${rows}
        <div class="stat-row missing"><span>Missing</span><span>${miss}</span></div>
      </div>
    `
  }).join("")
}


/* ── Download chart ── */
function downloadChart(format){
  if(!chartInst){ alert("Generate a chart first"); return }

  const canvas = document.getElementById("myChart")
  let link = document.createElement("a")

  if(format === "jpg"){
    // For JPG, draw on white background canvas
    const tmp = document.createElement("canvas")
    tmp.width  = canvas.width
    tmp.height = canvas.height
    const tCtx = tmp.getContext("2d")
    tCtx.fillStyle = "#0f172a"
    tCtx.fillRect(0, 0, tmp.width, tmp.height)
    tCtx.drawImage(canvas, 0, 0)
    link.download = "insightflow-chart.jpg"
    link.href = tmp.toDataURL("image/jpeg", 0.95)
  } else {
    link.download = "insightflow-chart.png"
    link.href = canvas.toDataURL("image/png")
  }

  link.click()
}


/* ── Theme toggle ── */
function toggleTheme(){
  const body = document.body
  const btn  = document.getElementById("themeToggle")
  const isLight = body.classList.toggle("light-mode")
  btn.textContent = isLight ? "🌙" : "☀️"
  localStorage.setItem("vizTheme", isLight ? "light" : "dark")

  // Update chart colors
  if(chartInst){
    const textColor = isLight ? "#333" : "#666"
    const gridColor = isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.04)"
    const titleColor = isLight ? "#111" : "#cccccc"

    if(chartInst.options.plugins?.title)
      chartInst.options.plugins.title.color = titleColor
    if(chartInst.options.scales?.x){
      chartInst.options.scales.x.ticks.color = textColor
      chartInst.options.scales.x.grid.color  = gridColor
      chartInst.options.scales.x.title.color = textColor
    }
    if(chartInst.options.scales?.y){
      chartInst.options.scales.y.ticks.color = textColor
      chartInst.options.scales.y.grid.color  = gridColor
      chartInst.options.scales.y.title.color = textColor
    }
    chartInst.update()
  }
}

/* ── Restore saved theme ── */
window.addEventListener("DOMContentLoaded", () => {
  if(localStorage.getItem("vizTheme") === "light"){
    document.body.classList.add("light-mode")
    const btn = document.getElementById("themeToggle")
    if(btn) btn.textContent = "🌙"
  }
})

/* ── Navigation ── */
function goAccount(){ window.location.href = "account.html" }
function logout(){
  if(window.Auth) window.Auth.logout()
  else {
    localStorage.removeItem("userEmail")
    localStorage.removeItem("insightflow_dataset")
    window.location.href = "index.html"
  }
}
/* ============================================================
   INSIGHTFLOW — report.js  (BI Dashboard Generator)
   ============================================================ */
 
let rptHeaders = []
let rptDataset = []
let rptMeta    = {}
let biCharts   = []
 
const BI_COLORS = ["#ff8c00","#3b82f6","#10b981","#ec4899","#8b5cf6","#ef4444","#f59e0b","#06b6d4","#84cc16","#f97316"]
 
/* ── Init ── */
function initReport(){
  // Hide everything first
  const noMsg = document.getElementById("noDataMsg")
  const wrapper = document.getElementById("dashboardWrapper")
  const biDiv = document.getElementById("biDashboard")
  
  if(noMsg) noMsg.style.display = "none"
  if(wrapper) wrapper.style.display = "none"
  if(biDiv) biDiv.style.display = "none"
 
  const raw = localStorage.getItem("insightflow_dataset")
  if(!raw){
    if(noMsg){ noMsg.style.display = "flex" }
    return
  }
 
  const d = JSON.parse(raw)
  rptHeaders = d.headers || []
  rptDataset = d.dataset || []
  rptMeta    = d
 
  // Show the appropriate dashboard based on what's available
  if(wrapper) {
    wrapper.style.display = "flex"
    document.getElementById("dashboardTitle").innerText = d.fileName
    document.getElementById("dashboardSubtitle").innerText = Number(d.rows).toLocaleString() + " rows • " + d.columns + " columns"
  } else if(biDiv) {
    biDiv.style.display = "flex"
    // Old sidebar dashboard fallback
    try {
      document.getElementById("biFileName").innerText = d.fileName + "  ·  " + Number(d.rows).toLocaleString() + " rows  ·  " + d.columns + " cols"
      document.getElementById("sidebarDsName").innerText = d.fileName
      document.getElementById("sidebarDsRows").innerText = Number(d.rows).toLocaleString() + " rows · " + d.columns + " cols"
    } catch(e) { /* element may not exist */ }
  }
  
  if(noMsg) noMsg.style.display = "none"
 
  buildBI()
}
 
// Run immediately - HTML is already parsed since script is at bottom of body
initReport()
 
 
/* ── Detect numeric ── */
function isNum(i){
  const vals = rptDataset.map(r=>r[i]).filter(v=>v!=="")
  return vals.map(v=>parseFloat(v)).filter(v=>!isNaN(v)).length > vals.length * 0.5
}
 
function numCols(){ return rptHeaders.map((_,i)=>i).filter(isNum) }
function catCols(){ return rptHeaders.map((_,i)=>i).filter(i=>!isNum(i)) }
 
function colStats(i){
  const vals = rptDataset.map(r=>parseFloat(r[i])).filter(v=>!isNaN(v))
  if(!vals.length) return null
  const sum = vals.reduce((a,b)=>a+b,0)
  return { min: Math.min(...vals), max: Math.max(...vals), avg: sum/vals.length, sum, count: vals.length }
}
 
function topN(colIdx, n=8){
  const counts = {}
  rptDataset.forEach(r=>{ const v=String(r[colIdx]??""); counts[v]=(counts[v]||0)+1 })
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,n)
}
 
 
/* ── Filters ── */
function buildFilters(){
  const cats = catCols().slice(0,3)
  const row  = document.getElementById("filterRow")
  row.innerHTML = ""
  cats.forEach(i => {
    const btn = document.createElement("div")
    btn.className = "bi-filter"
    btn.innerText = rptHeaders[i]
    row.appendChild(btn)
  })
}
 
 
/* ── Main build ── */
function buildBI(){
  // FIXED: Added null checks for safer chart destruction
  biCharts.forEach(c => {
    try {
      if(c && typeof c.destroy === 'function') {
        c.destroy()
      }
    } catch(e) {
      console.warn("Error destroying chart:", e)
    }
  })
  biCharts = []
 
  // FIXED: Add empty state checking
  if(!rptDataset || rptDataset.length === 0) {
    console.warn("No dataset available for BI build")
    return
  }
 
  // Build in new modern layout
  buildKPIs()
  buildModernCharts()
}
 
 
/* ── KPI Cards ── */
function buildKPIs(){
  const sec = document.getElementById("biKpiSection")
  sec.innerHTML = ""
  const nums = numCols().slice(0,5)
  const cats = catCols().slice(0,2)
 
  const accentColors = ["#ff8c00","#3b82f6","#10b981","#ec4899","#8b5cf6","#f59e0b","#06b6d4"]
 
  nums.forEach((i, idx) => {
    const s = colStats(i)
    if(!s) return
    const prev   = s.avg * (0.88 + Math.random()*0.15)
    const isUp   = s.avg >= prev
    const pct    = Math.abs(((s.avg-prev)/prev)*100).toFixed(1)
    const color  = accentColors[idx % accentColors.length]
    const val    = s.avg % 1 === 0 ? s.avg.toLocaleString() : s.avg.toFixed(1)
 
    sec.innerHTML += `
      <div class="bi-kpi">
        <div class="bi-kpi-accent" style="background:${color}"></div>
        <div class="bi-kpi-label">${rptHeaders[i]}</div>
        <div class="bi-kpi-value">${val}</div>
        <div class="bi-kpi-sub">Min ${s.min.toLocaleString()}  ·  Max ${s.max.toLocaleString()}</div>
        <div class="bi-kpi-trend ${isUp?'up':'down'}">${isUp?'▲':'▼'} ${pct}%</div>
      </div>`
  })
 
  cats.forEach((i, idx) => {
    const vals   = rptDataset.map(r=>r[i]).filter(v=>v!=="")
    const unique = new Set(vals).size
    const color  = accentColors[(nums.length + idx) % accentColors.length]
    sec.innerHTML += `
      <div class="bi-kpi">
        <div class="bi-kpi-accent" style="background:${color}"></div>
        <div class="bi-kpi-label">${rptHeaders[i]}</div>
        <div class="bi-kpi-value">${unique}</div>
        <div class="bi-kpi-sub">${vals.length.toLocaleString()} total entries</div>
        <div class="bi-kpi-trend flat">● Categories</div>
      </div>`
  })
}
 
 
/* ── Row 1: Wide bar + Pie ── */
function buildRow1(){
  const sec  = document.getElementById("biRow1")
  sec.innerHTML = ""
  const nums = numCols()
  const cats = catCols()
  
  // FIXED: Early return if insufficient data
  if(!nums.length || !cats.length) {
    sec.innerHTML = '<div class="bi-empty-state" style="grid-column: 1/-1; padding: 60px 20px;"><div class="bi-empty-state-icon">📊</div><div class="bi-empty-state-text">Insufficient data for visualization. Need both numeric and categorical columns.</div></div>'
    return
  }
 
  const xi = cats[0], yi = nums[0]
  const rows = rptDataset.slice(0, 20)
 
  // Wide bar
  const card1 = mkCard("BAR", `${rptHeaders[xi]} vs ${rptHeaders[yi]}`, 220)
  sec.appendChild(card1)
  const c1 = card1.querySelector("canvas")
  
  try {
    const inst1 = new Chart(c1, {
      type: "bar",
      data: {
        labels: rows.map(r=>String(r[xi]??"")),
        datasets: [{ data: rows.map(r=>parseFloat(r[yi])||0),
          backgroundColor: BI_COLORS[0]+"cc", borderColor: BI_COLORS[0],
          borderWidth: 1, borderRadius: 4 }]
      },
      options: biOpts(false, BI_COLORS[0])
    })
    biCharts.push(inst1)
  } catch(e) {
    console.error("Error creating bar chart:", e)
  }
 
  // Pie
  if(cats.length > 0){
    const top = topN(cats[0])
    const card2 = mkCard("PIE", `${rptHeaders[cats[0]]} Share`, 220)
    sec.appendChild(card2)
    const c2 = card2.querySelector("canvas")
    
    try {
      const inst2 = new Chart(c2, {
        type: "doughnut",
        data: { labels: top.map(e=>e[0]), datasets: [{ data: top.map(e=>e[1]), backgroundColor: BI_COLORS, borderWidth: 2, borderColor: "#13171f" }] },
        options: { ...biOpts(true), cutout: "60%" }
      })
      biCharts.push(inst2)
    } catch(e) {
      console.error("Error creating pie chart:", e)
    }
  }
}
 
 
/* ── Row 2: 3 charts ── */
function buildRow2(){
  const sec  = document.getElementById("biRow2")
  sec.innerHTML = ""
  const nums = numCols()
  const cats = catCols()
 
  // Line
  if(nums.length > 0){
    const yi   = nums[0]
    const rows = rptDataset.slice(0, 30)
    const card = mkCard("LINE", `${rptHeaders[yi]} Trend`, 180)
    sec.appendChild(card)
    
    try {
      const inst = new Chart(card.querySelector("canvas"), {
        type: "line",
        data: { labels: rows.map((_,i)=>`#${i+1}`),
          datasets: [{ data: rows.map(r=>parseFloat(r[yi])||0),
            borderColor: BI_COLORS[1], backgroundColor: BI_COLORS[1]+"22",
            fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2 }] },
        options: biOpts(false, BI_COLORS[1])
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating line chart:", e)
    }
  }
 
  // Horizontal bar
  if(cats.length > 0 && nums.length > 0){
    const xi = cats[0], yi = nums[nums.length > 1 ? 1 : 0]
    const top = topN(xi, 6)
    const card = mkCard("H-BAR", `Top ${rptHeaders[xi]}`, 180)
    sec.appendChild(card)
    
    try {
      const inst = new Chart(card.querySelector("canvas"), {
        type: "bar",
        data: { labels: top.map(e=>e[0]),
          datasets: [{ data: top.map(e=>e[1]),
            backgroundColor: BI_COLORS[2]+"cc", borderColor: BI_COLORS[2],
            borderWidth: 1, borderRadius: 4 }] },
        options: { ...biOpts(false, BI_COLORS[2]), indexAxis: "y" }
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating horizontal bar chart:", e)
    }
  }
 
  // Polar / second pie
  if(cats.length > 1){
    const top  = topN(cats[1], 6)
    const card = mkCard("POLAR", `${rptHeaders[cats[1]]} Distribution`, 180)
    sec.appendChild(card)
    
    try {
      const inst = new Chart(card.querySelector("canvas"), {
        type: "polarArea",
        data: { labels: top.map(e=>e[0]),
          datasets: [{ data: top.map(e=>e[1]), backgroundColor: BI_COLORS.map(c=>c+"bb"), borderWidth: 1 }] },
        options: biOpts(true)
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating polar chart:", e)
    }
  } else if(nums.length > 1) {
    // Scatter fallback
    const xi = nums[0], yi = nums[1]
    const rows = rptDataset.slice(0, 30)
    const card = mkCard("SCATTER", `${rptHeaders[xi]} vs ${rptHeaders[yi]}`, 180)
    sec.appendChild(card)
    
    try {
      const inst = new Chart(card.querySelector("canvas"), {
        type: "scatter",
        data: { datasets: [{ data: rows.map(r=>({ x:parseFloat(r[xi])||0, y:parseFloat(r[yi])||0 })),
          backgroundColor: BI_COLORS[3]+"88", borderColor: BI_COLORS[3], pointRadius: 5 }] },
        options: biOpts(false, BI_COLORS[3])
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating scatter chart:", e)
    }
  }
}
 
 
/* ── Row 3: Table + Chart ── */
function buildRow3(){
  const sec = document.getElementById("biRow3")
  sec.innerHTML = ""
 
  // Mini data table
  const card1 = document.createElement("div")
  card1.className = "bi-card"
  const cols  = rptHeaders.slice(0, 5)
  const rows  = rptDataset.slice(0, 10)
  
  if(cols.length === 0 || rows.length === 0) {
    card1.innerHTML = '<div class="bi-empty-state"><div class="bi-empty-state-icon">📋</div><div class="bi-empty-state-text">No data to preview</div></div>'
    sec.appendChild(card1)
    return
  }
  
  card1.innerHTML = `
    <div class="bi-card-header">
      <span class="bi-card-title">Data Preview</span>
      <span class="bi-card-badge">TABLE</span>
    </div>
    <table class="bi-table">
      <thead><tr>${cols.map(h=>`<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r=>`<tr>${cols.map((_,i)=>`<td>${r[i]??""}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`
  sec.appendChild(card1)
 
  // Stacked / area chart
  const nums = numCols()
  const cats = catCols()
  if(nums.length > 0 && cats.length > 0){
    const xi = cats[0], yi = nums[0]
    const rows2 = rptDataset.slice(0, 20)
    const card2 = mkCard("AREA", `${rptHeaders[yi]} Area Chart`, 260)
    sec.appendChild(card2)
    
    try {
      const inst = new Chart(card2.querySelector("canvas"), {
        type: "line",
        data: { labels: rows2.map(r=>String(r[xi]??"")),
          datasets: [{ data: rows2.map(r=>parseFloat(r[yi])||0),
            borderColor: BI_COLORS[4], backgroundColor: BI_COLORS[4]+"33",
            fill: true, tension: 0.4, pointRadius: 3, borderWidth: 2 }] },
        options: biOpts(false, BI_COLORS[4])
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating area chart:", e)
    }
  }
}
 
 
/* ── Card factory ── */
function mkCard(badge, title, canvasHeight){
  const div = document.createElement("div")
  div.className = "bi-card"
  div.innerHTML = `
    <div class="bi-card-header">
      <span class="bi-card-title">${title}</span>
      <span class="bi-card-badge">${badge}</span>
    </div>
    <canvas style="height:${canvasHeight}px"></canvas>`
  return div
}
 
 
/* ── Common chart options ── */
function biOpts(isCircular, color){
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: "easeInOutQuart" },
    plugins: {
      legend: { display: isCircular, labels: { color:"#555", font:{size:10}, padding:8, usePointStyle:true } },
      tooltip: { backgroundColor:"rgba(5,8,15,0.95)", titleColor: color||"#ff8c00",
        bodyColor:"#aaa", padding:10, cornerRadius:8 }
    },
    scales: isCircular ? {} : {
      x: { ticks:{color:"#444",font:{size:9},maxRotation:35}, grid:{color:"rgba(255,255,255,0.03)"}, border:{color:"rgba(255,255,255,0.06)"} },
      y: { ticks:{color:"#444",font:{size:9}}, grid:{color:"rgba(255,255,255,0.03)"}, border:{color:"rgba(255,255,255,0.06)"} }
    }
  }
}
 
 
/* ── Export ── */
function exportPDF(){
  window.print()
}
 
function logout(){
  if(window.Auth) window.Auth.logout()
  else {
    localStorage.removeItem("userEmail")
    localStorage.removeItem("insightflow_dataset")
    window.location.href = "index.html"
  }
}
 
/* ──────────────────────────────────────────────────────────
   MODERN DASHBOARD LAYOUT (Power BI / Tableau Style)
   ────────────────────────────────────────────────────────── */
 
function buildModernCharts(){
  const grid = document.getElementById("biChartsGrid")
  if(!grid) {
    // Fallback to old layout if new dashboard not loaded
    buildRow1()
    buildRow2()
    buildRow3()
    return
  }
  
  grid.innerHTML = ""
  const nums = numCols()
  const cats = catCols()
 
  // Chart 1: Bar Chart (Wide)
  if(nums.length > 0 && cats.length > 0) {
    const xi = cats[0], yi = nums[0]
    const rows = rptDataset.slice(0, 15)
    const card = createModernCard(`${rptHeaders[xi]} vs ${rptHeaders[yi]}`, "BAR", true)
    grid.appendChild(card)
    
    try {
      const canvas = card.querySelector("canvas")
      const inst = new Chart(canvas, {
        type: "bar",
        data: {
          labels: rows.map(r => String(r[xi] ?? "").substring(0, 12)),
          datasets: [{
            data: rows.map(r => parseFloat(r[yi]) || 0),
            backgroundColor: "rgba(255, 140, 0, 0.8)",
            borderColor: "#ff8c00",
            borderWidth: 1,
            borderRadius: 6
          }]
        },
        options: biOpts(false, "#ff8c00")
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating bar chart:", e)
    }
  }
 
  // Chart 2: Pie Chart
  if(cats.length > 0) {
    const top = topN(cats[0], 8)
    const card = createModernCard(`${rptHeaders[cats[0]]} Distribution`, "PIE")
    grid.appendChild(card)
    
    try {
      const canvas = card.querySelector("canvas")
      const inst = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels: top.map(e => String(e[0]).substring(0, 10)),
          datasets: [{
            data: top.map(e => e[1]),
            backgroundColor: ["#ff8c00", "#3b82f6", "#10b981", "#ec4899", "#8b5cf6", "#ef4444", "#f59e0b", "#06b6d4"],
            borderColor: "#16213e",
            borderWidth: 2
          }]
        },
        options: { ...biOpts(true), cutout: "65%" }
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating pie chart:", e)
    }
  }
 
  // Chart 3: Line Trend
  if(nums.length > 0) {
    const yi = nums[0]
    const rows = rptDataset.slice(0, 30)
    const card = createModernCard(`${rptHeaders[yi]} Trend`, "LINE")
    grid.appendChild(card)
    
    try {
      const canvas = card.querySelector("canvas")
      const inst = new Chart(canvas, {
        type: "line",
        data: {
          labels: rows.map((_, i) => `#${i + 1}`),
          datasets: [{
            data: rows.map(r => parseFloat(r[yi]) || 0),
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: "#3b82f6",
            borderWidth: 2
          }]
        },
        options: biOpts(false, "#3b82f6")
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating line chart:", e)
    }
  }
 
  // Chart 4: Horizontal Bar (Top N)
  if(cats.length > 0 && nums.length > 0) {
    const xi = cats[0]
    const yi = nums[nums.length > 1 ? 1 : 0]
    const top = topN(xi, 8)
    const card = createModernCard(`Top ${rptHeaders[xi]}`, "H-BAR")
    grid.appendChild(card)
    
    try {
      const canvas = card.querySelector("canvas")
      const inst = new Chart(canvas, {
        type: "bar",
        data: {
          labels: top.map(e => String(e[0]).substring(0, 15)),
          datasets: [{
            data: top.map(e => e[1]),
            backgroundColor: "rgba(16, 185, 129, 0.8)",
            borderColor: "#10b981",
            borderWidth: 1,
            borderRadius: 6
          }]
        },
        options: { ...biOpts(false, "#10b981"), indexAxis: "y" }
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating horizontal bar chart:", e)
    }
  }
 
  // Chart 5: Area Chart (Wide)
  if(nums.length > 0 && cats.length > 0) {
    const xi = cats[cats.length > 1 ? 1 : 0]
    const yi = nums[0]
    const rows = rptDataset.slice(0, 20)
    const card = createModernCard(`${rptHeaders[yi]} Over ${rptHeaders[xi]}`, "AREA", true)
    grid.appendChild(card)
    
    try {
      const canvas = card.querySelector("canvas")
      const inst = new Chart(canvas, {
        type: "line",
        data: {
          labels: rows.map(r => String(r[xi] ?? "").substring(0, 12)),
          datasets: [{
            data: rows.map(r => parseFloat(r[yi]) || 0),
            borderColor: "#ec4899",
            backgroundColor: "rgba(236, 72, 153, 0.15)",
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: "#ec4899",
            borderWidth: 2
          }]
        },
        options: biOpts(false, "#ec4899")
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating area chart:", e)
    }
  }
 
  // Chart 6: Scatter (if 2+ numeric columns)
  if(nums.length > 1) {
    const xi = nums[0]
    const yi = nums[1]
    const rows = rptDataset.slice(0, 30)
    const card = createModernCard(`${rptHeaders[xi]} vs ${rptHeaders[yi]}`, "SCATTER")
    grid.appendChild(card)
    
    try {
      const canvas = card.querySelector("canvas")
      const inst = new Chart(canvas, {
        type: "scatter",
        data: {
          datasets: [{
            data: rows.map(r => ({
              x: parseFloat(r[xi]) || 0,
              y: parseFloat(r[yi]) || 0
            })),
            backgroundColor: "rgba(139, 92, 246, 0.6)",
            borderColor: "#8b5cf6",
            pointRadius: 5,
            borderWidth: 1
          }]
        },
        options: biOpts(false, "#8b5cf6")
      })
      biCharts.push(inst)
    } catch(e) {
      console.error("Error creating scatter chart:", e)
    }
  }
}
 
function createModernCard(title, badge, isWide = false) {
  const card = document.createElement("div")
  card.className = "chart-card" + (isWide ? " chart-wide" : "")
  card.innerHTML = `
    <div class="chart-header">
      <span class="chart-title">${title}</span>
      <span class="chart-badge">${badge}</span>
    </div>
    <div class="chart-body">
      <canvas></canvas>
    </div>
  `
  return card
}