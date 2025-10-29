// public/app.js
const qs = (id) => document.getElementById(id);
const $  = (sel) => document.querySelector(sel);

/* =========================
   AUTH: login / registro
   =========================*/
async function onLogin(e){
  e.preventDefault();
  const email = qs("loginEmail")?.value.trim();
  const password = qs("loginPass")?.value || "";
  const r = await fetch("/login",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ email, password })
  });
  const j = await r.json();
  if(j.ok){
    localStorage.setItem("userId", j.userId || "");
    localStorage.setItem("email", email || "");
    location.href = "calculo.html";
  }else{
    alert("Credenciales inválidas");
  }
}

async function onRegister(e){
  e.preventDefault();
  const email = qs("regEmail")?.value.trim();
  const password = qs("regPass")?.value || "";
  const r = await fetch("/register",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ email, password })
  });
  const j = await r.json();
  if(j.ok){
    alert("Cuenta creada. Inicia sesión.");
    qs("tabLogin")?.click();
  }else{
    alert("No se pudo registrar");
  }
}

function initLogin(){
  const tabLogin    = qs("tabLogin");
  const tabRegister = qs("tabRegister");
  const formLogin   = qs("formLogin");
  const formRegister= qs("formRegister");
  if(!tabLogin) return;

  tabLogin.addEventListener("click", ()=>{
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    formLogin.classList.remove("hidden");
    formRegister.classList.add("hidden");
  });

  tabRegister.addEventListener("click", ()=>{
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    formRegister.classList.remove("hidden");
    formLogin.classList.add("hidden");
  });

  formLogin.addEventListener("submit", onLogin);
  formRegister.addEventListener("submit", onRegister);
}

/* =========================
   CÁLCULO AVANZADO (con huecos)
   =========================*/
const holes = [];

function renderHoles(){
  const box = qs("holes");
  if(!box) return;
  box.innerHTML = "";
  holes.forEach((h,i)=>{
    const row = document.createElement("div");
    row.className = "holes-item";
    row.innerHTML = `
      <span>${h.width} m × ${h.height} m</span>
      <button data-del="${i}" class="btn">Quitar</button>
    `;
    box.appendChild(row);
  });
}

function initCalcUI(){
  const add = qs("addHole");
  if(!add) return;

  add.addEventListener("click", ()=>{
    const w = parseFloat(qs("hW").value);
    const h = parseFloat(qs("hH").value);
    if(!w || !h || w<=0 || h<=0) return;
    holes.push({ width: w, height: h });
    qs("hW").value = "";
    qs("hH").value = "";
    renderHoles();
  });

  document.addEventListener("click", (e)=>{
    const del = e.target.closest("[data-del]");
    if(!del) return;
    const idx = parseInt(del.getAttribute("data-del"),10);
    holes.splice(idx,1);
    renderHoles();
  });
}

async function onCalcAdvanced(e){
  e.preventDefault();
  const width  = parseFloat(qs("width").value);
  const height = parseFloat(qs("height").value);
  const userId = localStorage.getItem("userId") || null;

  const r = await fetch("/api/calc/wall/v2",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ width, height, openings: holes, userId })
  });
  const j = await r.json();
  if(!j.ok) return alert("Datos inválidos");

  const rows = j.breakdown
    .map(b=>`<tr>
      <td>${b.panel}</td>
      <td>${b.qty}</td>
      <td>${(b.panelArea).toFixed(2)} m²</td>
      <td>${(b.qty * b.panelArea).toFixed(2)} m²</td>
    </tr>`).join("");

  qs("result").innerHTML = `
    <div>Área bruta: <b>${j.grossArea} m²</b></div>
    <div>Huecos: <b>${j.openingsArea} m²</b></div>
    <div>Área neta: <b>${j.netArea} m²</b></div>
    <table class="table">
      <thead><tr><th>Panel</th><th>Cantidad</th><th>Área panel</th><th>Área cubierta</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div>Total paneles: <b>${j.totalPanels}</b></div>
  `;

  // Auto-guardar en historial si hay usuario
  try{
    if (userId) {
      await fetch("/api/calcs", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          userId,
          width,
          height,
          openings: holes,
          result: {
            grossArea   : j.grossArea,
            openingsArea: j.openingsArea,
            netArea     : j.netArea,
            totalPanels : j.totalPanels,
            breakdown   : j.breakdown
          }
        })
      });
    }
  }catch(_e){}
}

function initCalcAdvanced(){
  const f = qs("formCalc");
  if(!f) return;
  f.addEventListener("submit", onCalcAdvanced);
  initCalcUI();
  renderHoles();
}

/* =========================
   CÁLCULO BÁSICO (KPIs rápidos)
   =========================*/
function areaFromStr(s){
  const [a,b] = String(s).split("x").map(Number);
  return a*b;
}
function fmt(n){
  return new Intl.NumberFormat("es-CO",{ maximumFractionDigits:2 }).format(n);
}

function initCalcBasic(){
  const form = $("#calcForm");
  if(!form) return;

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const w  = parseFloat($("#width").value);
    const h  = parseFloat($("#height").value);
    const pa = areaFromStr($("#panel").value);
    if(!w || !h || !pa) return;

    const wallA = w*h;
    const units = Math.ceil(wallA/pa);

    $("#resultTitle").textContent = "Resultado del cálculo";
    $("#resultText").textContent  = "Con las medidas ingresadas se recomienda usar paneles del tamaño seleccionado.";
    $("#kArea").textContent  = fmt(wallA) + " m²";
    $("#kPanel").textContent = fmt(pa)    + " m²";
    $("#kUnits").textContent = String(units);
    $("#result").hidden = false;

    // Opcional: también registrar en v2 sin huecos
    try{
      await fetch("/api/calc/wall/v2",{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          width: w,
          height: h,
          openings: [],
          userId: localStorage.getItem("userId") || null
        })
      });
    }catch(_e){}
  });
}

/* =========================
   Boot
   =========================*/
if (qs("formLogin")) initLogin();
if (qs("formCalc"))  initCalcAdvanced();
if (qs("calcForm"))  initCalcBasic();
