let chartInstance;

/* FILE UPLOAD */

let dataset = []
let headers = []
let currentPage = 1
let rowsPerPage = 10


/* KPI Animation */

function animateKPI(id,value){

let element = document.getElementById(id)

let start = 0
let duration = 3000
let steps = 60

let increment = Math.ceil(value/steps)

let counter = setInterval(()=>{

start += increment

if(start >= value){
start = value
clearInterval(counter)
}

element.innerText = start

}, duration/steps)

}


/* Upload Dataset */
function uploadFile(){

let fileInput = document.getElementById("fileInput")
let file = fileInput.files[0]

if(!file){
alert("Please select a dataset")
return
}

/* dataset info */

document.getElementById("fileName").innerText = file.name

let size

if(file.size < 1024*1024){
size = (file.size/1024).toFixed(2) + " KB"
}else{
size = (file.size/(1024*1024)).toFixed(2) + " MB"
}

document.getElementById("fileSize").innerText = size

let type = file.name.split(".").pop().toUpperCase()
document.getElementById("fileType").innerText = type


/* send file to backend */

let formData = new FormData()
formData.append("file", file)

fetch("http://127.0.0.1:5000/upload",{
method:"POST",
body:formData
})
.then(res => res.json())
.then(data => {

if(data.error){
alert(data.error)
return
}

/* store dataset */

headers = data.headers
dataset = data.preview

currentPage = 1


/* show preview + KPI */

document.querySelector(".preview-section").style.display="block"
document.querySelector(".kpi-container").style.display="flex"


/* render table */

renderTable()


/* update KPI */

animateKPI("totalRows",data.rows)
animateKPI("totalColumns",data.columns)
animateKPI("missingValues",data.missing)
animateKPI("duplicateRows",data.duplicates)
animateKPI("numericColumns",data.numeric)
animateKPI("categoricalColumns",data.categorical)

})
.catch(err=>{
console.error(err)
alert("Upload failed")
})

}
function renderTable(){

let tableHead = document.querySelector("#dataTable thead")
let tableBody = document.querySelector("#dataTable tbody")

tableHead.innerHTML=""
tableBody.innerHTML=""

let headRow=document.createElement("tr")

headers.forEach(h=>{
let th=document.createElement("th")
th.innerText=h
headRow.appendChild(th)
})

tableHead.appendChild(headRow)


let start=(currentPage-1)*rowsPerPage
let end=start+rowsPerPage
let pageData=dataset.slice(start,end)


let fragment=document.createDocumentFragment()

pageData.forEach(row=>{

let tr=document.createElement("tr")

row.forEach(col=>{
let td=document.createElement("td")
td.innerText=col
tr.appendChild(td)
})

fragment.appendChild(tr)

})

tableBody.appendChild(fragment)

document.getElementById("pageInfo").innerText=
`Page ${currentPage} / ${Math.ceil(dataset.length/rowsPerPage)}`
}

function nextPage(){

if(currentPage*rowsPerPage < dataset.length){
currentPage++
renderTable()
}

}

function prevPage(){

if(currentPage>1){
currentPage--
renderTable()
}

}
/* CHART */

function generateChart(){

const ctx = document.getElementById('myChart')

if(chartInstance){
chartInstance.destroy()
}

chartInstance = new Chart(ctx, {

type:'bar',

data:{
labels:["Jan","Feb","Mar","Apr","May"],
datasets:[{
label:"Sales",
data:[12,19,3,5,2],
borderWidth:1
}]
}

})

}


/* AI INSIGHTS */

function generateInsights(){

let insights = document.getElementById("insights")

insights.innerHTML = "AI is analyzing the dataset..."

setTimeout(()=>{

insights.innerHTML =
"Top Insight: Sales increased by 35% in Q2. Highest revenue product category is Electronics."

},2000)

}


/* DARK MODE */

let toggle = document.getElementById("modeToggle")

if(toggle){
toggle.onclick = function(){
document.body.classList.toggle("dark-mode")
}
}


/* PAGE NAVIGATION */

function goDashboard(){
window.location.href="login.html"
}

function goHome(){
window.location.href="welcome.html"
}

function goAccount(){
window.location.href="account.html"
}


/* LOGOUT */

function logout(){
alert("Logged out successfully")
window.location.href="index.html"
}


/* LOAD ACCOUNT DATA */
function loadAccount(){

let email = localStorage.getItem("userEmail")

fetch(`http://127.0.0.1:5000/account/${email}`)
.then(res=>res.json())
.then(data=>{

document.getElementById("username").innerText = data.name
document.getElementById("email").innerText = data.email

})

}
function register(){

let name = document.getElementById("nameInput").value
let email = document.getElementById("emailInput").value
let password = document.getElementById("passwordInput").value

fetch("http://127.0.0.1:5000/register",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
name:name,
email:email,
password:password
})

})

.then(res=>res.json())
.then(data=>{
alert(data.message)
})
.catch(error=>{
console.error(error)
alert("Register failed")
})

}
function login(){

let email = document.getElementById("emailInput").value
let password = document.getElementById("passwordInput").value

fetch("http://127.0.0.1:5000/login",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({
email:email,
password:password
})
})
.then(res=>res.json())
.then(data=>{

if(data.status === "success"){

localStorage.setItem("userEmail",data.email)
window.location.href="dashboard.html"

}else{
alert(data.message)
}

})

}
let isRegister = false;

function toggleForm(){

let nameField = document.getElementById("nameInput");
let title = document.getElementById("formTitle");
let button = document.getElementById("mainButton");
let toggleText = document.getElementById("toggleText");

let email = document.getElementById("emailInput");
let password = document.getElementById("passwordInput");

isRegister = !isRegister;

/* CLEAR INPUTS */
email.value = "";
password.value = "";
nameField.value = "";

if(isRegister){

nameField.style.display = "block";
title.innerText = "Register";

button.innerText = "Register";
button.onclick = register;

toggleText.innerHTML =
'Already have an account? <span onclick="toggleForm()">Login</span>';

}else{

nameField.style.display = "none";
title.innerText = "Login";

button.innerText = "Login";
button.onclick = login;

toggleText.innerHTML =
'Don\'t have an account? <span onclick="toggleForm()">Register</span>';

}

}
function changeBanner(src){

document.getElementById("banner").src = src

}