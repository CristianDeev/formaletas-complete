// server.js
require("dotenv").config();
const path   = require("path");
const express= require("express");
const mysql  = require("mysql2");
const bcrypt = require("bcryptjs");

const app = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// DB
const db = mysql.createConnection({
  host    : process.env.DB_HOST,
  user    : process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});
db.connect((err)=>{
  if (err) {
    console.error("Error conectando a MySQL:", err);
    process.exit(1);
  } else {
    console.log("MySQL conectado ✅");
  }
});

/* =========================
   Auth básico
   =========================*/
app.post("/register", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false });
  const hash = bcrypt.hashSync(password, 10);
  db.query(
    "INSERT INTO users(email,password) VALUES(?,?)",
    [email, hash],
    (err) => {
      if (err) return res.json({ ok: false });
      res.json({ ok: true });
    }
  );
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false });

  db.query(
    "SELECT id,password FROM users WHERE email=?",
    [email],
    (err, rows) => {
      if (err || rows.length === 0) return res.json({ ok: false });
      const ok = bcrypt.compareSync(password, rows[0].password);
      if (!ok) return res.json({ ok: false });
      res.json({ ok: true, userId: rows[0].id });
    }
  );
});

/* =========================
   Cálculo de paneles
   =========================*/
function greedyBreakdown(area) {
  const panels = [
    { name: "120x60", area: 1.2 * 0.6 }, // 0.72
    { name: "90x60",  area: 0.9 * 0.6 }, // 0.54
    { name: "60x60",  area: 0.6 * 0.6 }, // 0.36
    { name: "60x30",  area: 0.6 * 0.3 }  // 0.18
  ];
  let rem = area;
  const out = [];
  for (const p of panels) {
    const n = Math.max(0, Math.floor(rem / p.area));
    if (n > 0) {
      out.push({ panel: p.name, qty: n, panelArea: p.area });
      rem = +(rem - n * p.area).toFixed(4);
    }
  }
  if (rem > 0) { // residuo, sumar 1 de 60x30
    out.push({ panel: "60x30", qty: 1, panelArea: 0.18 });
    rem = 0;
  }
  return out;
}

// Avanzado (con huecos) + log en wall_calculations (si existe)
app.post("/api/calc/wall/v2", (req, res) => {
  const { width, height, openings, userId } = req.body || {};
  const w = Number(width);
  const h = Number(height);
  if (!w || !h || w <= 0 || h <= 0) return res.status(400).json({ ok: false });

  let openingsArea = 0;
  if (Array.isArray(openings)) {
    for (const o of openings) {
      const ow = Number(o.width) || 0;
      const oh = Number(o.height) || 0;
      if (ow > 0 && oh > 0) openingsArea += ow * oh;
    }
  }

  const gross = +(w * h).toFixed(2);
  const net   = Math.max(0, +(gross - openingsArea).toFixed(2));
  const breakdown = greedyBreakdown(net);
  const totalPanels = breakdown.reduce((a,b)=>a + b.qty, 0);

  // Guardar si existe la tabla (si falla, no rompemos la respuesta)
  db.query(
    "INSERT INTO wall_calculations(user_id,width,height,gross_area,openings_area,net_area,breakdown_json) VALUES(?,?,?,?,?,?,?)",
    [userId || null, w, h, gross, +openingsArea.toFixed(2), net, JSON.stringify(breakdown)],
    () => {}
  );

  res.json({
    ok: true,
    grossArea   : gross,
    openingsArea: +openingsArea.toFixed(2),
    netArea     : net,
    totalPanels,
    breakdown
  });
});

// Básico (solo muro) + log en walls (si existe)
app.post("/api/calc/wall", (req, res) => {
  const { width, height, userId } = req.body || {};
  const w = Number(width);
  const h = Number(height);
  if (!w || !h) return res.status(400).json({ ok: false });

  const area = +(w * h).toFixed(2);
  const panelArea = 0.72;
  const qty120x60 = Math.ceil(area / panelArea);

  db.query(
    "INSERT INTO walls(user_id,width,height,area) VALUES(?,?,?,?)",
    [userId || null, w, h, area],
    () => {}
  );

  res.json({
    ok: true,
    area,
    modules: [{ panel: "120x60", qty: qty120x60, panelArea }]
  });
});

/* =========================
   Historial de cálculos
   =========================*/
// Guardar cálculo explícitamente
app.post("/api/calcs", (req, res) => {
  const { userId, width, height, openings = [], result } = req.body || {};
  if (!userId || !width || !height || !result) {
    return res.status(400).json({ ok:false, msg:"faltan datos" });
  }

  db.query(
    `INSERT INTO calculations
     (user_id,width,height,openings_json,gross_area,openings_area,net_area,total_panels,breakdown_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      userId,
      width,
      height,
      JSON.stringify(openings || []),
      Number(result.grossArea || 0),
      Number(result.openingsArea || 0),
      Number(result.netArea || 0),
      Number(result.totalPanels || 0),
      JSON.stringify(result.breakdown || [])
    ],
    (err, r) => {
      if (err) return res.status(500).json({ ok:false });
      res.json({ ok:true, id:r.insertId });
    }
  );
});

// Listar últimos 50 de un usuario
app.get("/api/calcs/:userId", (req, res) => {
  const uid = parseInt(req.params.userId, 10);
  if (!uid) return res.status(400).json({ ok:false });

  db.query(
    `SELECT id,width,height,gross_area AS grossArea,openings_area AS openingsArea,
            net_area AS netArea,total_panels AS totalPanels,created_at
     FROM calculations
     WHERE user_id=?
     ORDER BY created_at DESC
     LIMIT 50`,
    [uid],
    (err, rows) => {
      if (err) return res.status(500).json({ ok:false });
      res.json({ ok:true, items: rows });
    }
  );
});

// Detalle con JSONs
app.get("/api/calcs/detail/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok:false });

  db.query(
    `SELECT id,user_id AS userId,width,height,
            openings_json AS openingsJson,
            breakdown_json AS breakdownJson,
            gross_area AS grossArea, openings_area AS openingsArea,
            net_area AS netArea, total_panels AS totalPanels, created_at
     FROM calculations WHERE id=?`,
    [id],
    (err, rows) => {
      if (err || rows.length===0) return res.status(404).json({ ok:false });
      const r = rows[0];
      try {
        r.openings  = r.openingsJson  ? JSON.parse(r.openingsJson)  : [];
        r.breakdown = r.breakdownJson ? JSON.parse(r.breakdownJson) : [];
      } catch {}
      res.json({ ok:true, item: r });
    }
  );
});

/* =========================
   Misc
   =========================*/
app.get("/health", (_req, res) => res.json({ ok:true }));

// servir index si se entra a raíz
app.get("/", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor listo en http://localhost:${PORT}`));
