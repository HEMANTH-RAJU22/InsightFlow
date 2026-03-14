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
  let el  = document.getElementById(id)
  if(!el) return
  let start = 0, steps = 60, duration = 2000
  let inc = Math.ceil(value / steps)
  let counter = setInterval(() => {
    start += inc
    if(start >= value){ start = value; clearInterval(counter) }
    el.innerText = start
  }, duration / steps)
}


/* ── Show all dashboard sections ───────────────────────────── */
function showLoading(fileName){
  let overlay = document.getElementById("loadingOverlay")
  let sub     = document.getElementById("loadingFileName")
  if(overlay) overlay.style.display = "flex"
  if(sub)     sub.innerText = fileName
  /* disable upload button */
  let btn = document.querySelector(".upload-box button")
  if(btn){ btn.disabled = true; btn.style.opacity = "0.5" }
}

function hideLoading(){
  let overlay = document.getElementById("loadingOverlay")
  if(overlay) overlay.style.display = "none"
  /* re-enable upload button */
  let btn = document.querySelector(".upload-box button")
  if(btn){ btn.disabled = false; btn.style.opacity = "1" }
}

function showSections(){
  document.getElementById("previewSection").style.display = "block"
  document.getElementById("aiCta").style.display          = "block"
  document.getElementById("kpiContainer").style.display   = "flex"
  document.getElementById("clearBtn").style.display       = "inline-block"
}

function clearDataset(){
  /* reset state */
  dataset     = []
  headers     = []
  currentPage = 1

  /* reset file input */
  document.getElementById("fileInput").value = ""

  /* hide sections */
  document.getElementById("previewSection").style.display = "none"
  document.getElementById("aiCta").style.display          = "none"
  document.getElementById("clearBtn").style.display       = "none"

  /* clear table */
  document.querySelector("#dataTable thead").innerHTML = ""
  document.querySelector("#dataTable tbody").innerHTML = ""

  /* reset KPI values */
  document.getElementById("fileName").innerText        = "No file"
  document.getElementById("fileSize").innerText        = "—"
  document.getElementById("fileType").innerText        = "—"
  document.getElementById("totalRows").innerText       = "0"
  document.getElementById("totalColumns").innerText    = "0"
  document.getElementById("missingValues").innerText   = "0"
  document.getElementById("duplicateRows").innerText   = "0"
  document.getElementById("numericColumns").innerText  = "0"
  document.getElementById("categoricalColumns").innerText = "0"

  /* clear sessionStorage */
  sessionStorage.removeItem("insightflow_dataset")
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

  /* save for chatbot page */
  try {
    sessionStorage.setItem("insightflow_dataset", JSON.stringify({
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

  /* reset previous results */
  dataset = []
  headers = []
  currentPage = 1
  document.getElementById("previewSection").style.display = "none"
  document.getElementById("aiCta").style.display          = "none"
  document.querySelector("#dataTable thead").innerHTML    = ""
  document.querySelector("#dataTable tbody").innerHTML    = ""
  document.getElementById("totalRows").innerText       = "0"
  document.getElementById("totalColumns").innerText    = "0"
  document.getElementById("missingValues").innerText   = "0"
  document.getElementById("duplicateRows").innerText   = "0"
  document.getElementById("numericColumns").innerText  = "0"
  document.getElementById("categoricalColumns").innerText = "0"
  document.getElementById("fileName").innerText        = "No file"
  document.getElementById("fileSize").innerText        = "—"
  document.getElementById("fileType").innerText        = "—"

  /* validate file size — warn if empty */
  if(file.size === 0){
    alert("This file is empty. Please select a valid dataset.")
    return
  }

  /* show file info */
  document.getElementById("fileName").innerText = file.name
  document.getElementById("fileSize").innerText = file.size < 1048576
    ? (file.size/1024).toFixed(2) + " KB"
    : (file.size/1048576).toFixed(2) + " MB"
  document.getElementById("fileType").innerText = file.name.split(".").pop().toUpperCase()

  /* show loading spinner */
  showLoading(file.name)

  /* try Flask backend first */
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
      /* Flask down or CORS — fall back to local browser parsing */
      console.warn("Flask unavailable (" + err.message + "), parsing locally")
      parseLocalFile(file)  /* hideLoading called inside buildAndShow */
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
        buildAndShow(json[0].map(String), json.slice(1).filter(r=>r.some(c=>c!=="")), file.name)
      } catch(err){
        hideLoading()
        let msg = err.message || String(err)
        if(msg.includes("ZIP") || msg.includes("encryption") || msg.includes("password")){
          alert("This Excel file is password-protected or encrypted.\n\nPlease remove the password in Excel:\nFile → Info → Protect Workbook → Remove Password\n\nThen try uploading again.")
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
        for(let i=0; i<line.length; i++){
          let ch = line[i]
          if(ch === '"'){ inQ = !inQ }
          else if(ch === delim && !inQ){ cols.push(cur.trim()); cur="" }
          else { cur += ch }
        }
        cols.push(cur.trim())
        return cols
      }

      let hdrs = parseLine(lines[0])
      let rows = lines.slice(1).map(parseLine)
      buildAndShow(hdrs, rows, file.name)
    } catch(e){ hideLoading(); alert("Could not read file: " + e.message) }
  }
  reader.readAsText(file)
}


/* ── Build KPI stats and call showDashboard ─────────────────── */
function buildAndShow(hdrs, rows, fileName){
  /* validate parsed data */
  if(!hdrs || hdrs.length === 0){
    hideLoading()
    alert("No columns found. Please check your file format.")
    return
  }
  if(!rows || rows.length === 0){
    hideLoading()
    alert("No data rows found in this file.")
    return
  }

  let missing=0, dupMap={}, dupes=0, numeric=0, categorical=0

  rows.forEach(r => {
    r.forEach(c => { if(c===""||c===null||c===undefined) missing++ })
    let key = JSON.stringify(r)
    dupMap[key] = (dupMap[key]||0)+1
  })
  Object.values(dupMap).forEach(v => { if(v>1) dupes += v-1 })

  hdrs.forEach((h,i) => {
    let sample = rows.map(r=>r[i]).find(v=>v!==""&&v!==null&&v!==undefined) ?? ""
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

  /* build header using innerHTML — faster than DOM creation */
  let colWidth = Math.max(120, Math.floor(900 / Math.max(headers.length, 1)))
  thead.innerHTML = "<tr>" +
    headers.map(h => `<th style="min-width:${colWidth}px">${String(h).replace(/</g,"&lt;")}</th>`).join("") +
    "</tr>"

  let start    = (currentPage-1) * rowsPerPage
  let pageData = dataset.slice(start, start + rowsPerPage)

  /* build all rows as one HTML string — fastest possible render */
  let html = pageData.map(row =>
    "<tr>" +
    headers.map((h,i) => {
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

function nextPage(){
  if(currentPage * rowsPerPage < dataset.length){ currentPage++; renderTable() }
}
function prevPage(){
  if(currentPage > 1){ currentPage--; renderTable() }
}


/* ── Navigation ─────────────────────────────────────────────── */
function goDashboard(){ window.location.href = "login.html" }
function goAccount(){   window.location.href = "account.html" }
function goToChatbot(){ window.location.href = "chatbot.html" }
function logout(){
  localStorage.removeItem("userEmail")
  window.location.href = "index.html"
}


/* ── Auth ───────────────────────────────────────────────────── */
function login(){
  let email    = document.getElementById("emailInput").value
  let password = document.getElementById("passwordInput").value

  fetch("http://127.0.0.1:5000/login", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email, password})
  })
  .then(res => res.json())
  .then(data => {
    if(data.status === "success"){
      localStorage.setItem("userEmail", data.email)
      window.location.href = "dashboard.html"
    } else {
      alert(data.message || "Login failed")
    }
  })
  .catch(() => alert("Cannot reach server. Make sure Flask is running."))
}

function register(){
  let name     = document.getElementById("nameInput").value
  let email    = document.getElementById("emailInput").value
  let password = document.getElementById("passwordInput").value

  fetch("http://127.0.0.1:5000/register", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({name, email, password})
  })
  .then(res => res.json())
  .then(data => alert(data.message))
  .catch(() => alert("Register failed. Make sure Flask is running."))
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
  let email = localStorage.getItem("userEmail")
  if(!email) return
  fetch(`http://127.0.0.1:5000/account/${email}`)
    .then(res => res.json())
    .then(data => {
      let u = document.getElementById("username")
      let e = document.getElementById("email")
      if(u) u.innerText = data.name  || ""
      if(e) e.innerText = data.email || ""
    })
    .catch(() => {})
}


/* ── Dark mode toggle ───────────────────────────────────────── */
let toggle = document.getElementById("modeToggle")
if(toggle){ toggle.onclick = () => document.body.classList.toggle("dark-mode") }


/* ── Chatbot page functions ─────────────────────────────────── */
let chatHistory    = []
let datasetContext = ""

function loadDataset(){
  if(!document.getElementById("chatWindow")) return
  let raw = sessionStorage.getItem("insightflow_dataset")
  if(!raw){
    appendBotMessage("⚠️ No dataset found. Go back to **Dashboard**, upload a dataset, then click **Analyze with AI**.")
    return
  }
  let d = JSON.parse(raw)
  let el = document.getElementById("datasetLabel")
  if(el) el.innerText = d.fileName || "Dataset loaded"
  let stats = document.getElementById("chatbotStats")
  if(stats) stats.style.display = "flex"
  let sr = document.getElementById("statRows")
  let sc = document.getElementById("statCols")
  let sm = document.getElementById("statMissing")
  if(sr) sr.innerText = d.rows.toLocaleString() + " rows"
  if(sc) sc.innerText = d.columns + " cols"
  if(sm) sm.innerText = d.missing + " missing"

  let preview = d.dataset.slice(0,30)
  datasetContext =
    `File: ${d.fileName}\nShape: ${d.rows} rows × ${d.columns} columns\n` +
    `Missing: ${d.missing} | Duplicates: ${d.duplicates}\n` +
    `Numeric: ${d.numeric} | Categorical: ${d.categorical}\n` +
    `Columns: ${d.headers.join(", ")}\n\nSample data:\n` +
    preview.map(row => d.headers.map((h,i) => `${h}: ${row[i]}`).join(", ")).join("\n")

  appendBotMessage(
    `Dataset **${d.fileName}** ready!\n\n` +
    `**${d.rows.toLocaleString()} rows** × **${d.columns} columns**` +
    (d.missing > 0 ? ` — ${d.missing} missing values detected` : "") +
    `.\n\nAsk me anything about your data.`
  )
}

function sendChat(){
  let input   = document.getElementById("chatInput")
  let userMsg = input.value.trim()
  if(!userMsg) return
  input.value = ""
  appendUserMessage(userMsg)
  let typingId = appendTyping()
  chatHistory.push({role:"user", content:userMsg})

  fetch("http://127.0.0.1:5000/chat", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      message:         userMsg,
      history:         chatHistory.slice(0,-1),
      dataset_context: datasetContext || "No dataset loaded."
    })
  })
  .then(res => res.json())
  .then(data => {
    removeTyping(typingId)
    if(data.error){ appendBotMessage("⚠️ " + data.error); chatHistory.pop(); return }
    chatHistory.push({role:"assistant", content:data.reply})
    appendBotMessage(data.reply)
  })
  .catch(() => {
    removeTyping(typingId)
    appendBotMessage("⚠️ Could not reach server. Make sure Flask is running.")
    chatHistory.pop()
  })
}

function sendQuick(prompt){
  document.getElementById("chatInput").value = prompt
  sendChat()
}

function appendUserMessage(text){
  let win = document.getElementById("chatWindow")
  let div = document.createElement("div")
  div.className = "chat-message user-message"
  div.innerHTML = `<div class="user-avatar">YOU</div><div class="message-bubble">${escapeHtml(text)}</div>`
  win.appendChild(div)
  win.scrollTop = win.scrollHeight
}

function appendBotMessage(text){
  let win = document.getElementById("chatWindow")
  let div = document.createElement("div")
  div.className = "chat-message bot-message"
  div.innerHTML = `<div class="bot-avatar">AI</div><div class="message-bubble">${formatMarkdown(text)}</div>`
  win.appendChild(div)
  win.scrollTop = win.scrollHeight
}

function appendTyping(){
  let win = document.getElementById("chatWindow")
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
    .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
    .replace(/^- (.*)/gm,"• $1")
    .replace(/\n/g,"<br>")
}


/* ── Init ───────────────────────────────────────────────────── */
window.onload = function(){
  if(document.getElementById("chatWindow")) loadDataset()
  if(document.getElementById("username"))   loadAccount()
}