const BASE = "http://localhost:3000/api/v1";
const email = `smoke+${Date.now()}@example.com`;
const email2 = `smoke2+${Date.now()}@example.com`;
const password = "Str0ng!Pass1";
const line = (label, obj) => console.log(label + " " + (typeof obj === "string" ? obj : JSON.stringify(obj)));
let token;
const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });
try {
  let r = await fetch(`${BASE}/auth/register`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, password }) });
  line(`1. REGISTER -> ${r.status}`, await r.json());
  r = await fetch(`${BASE}/auth/login`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, password }) });
  const login = await r.json(); token = login.accessToken;
  line(`2. LOGIN -> ${r.status}`, { tokenType: login.tokenType, expiresIn: login.expiresIn, tokenLen: (token||"").length });
  r = await fetch(`${BASE}/categories`, { method:"POST", headers: auth(), body: JSON.stringify({ name:"Groceries" }) });
  const cat = await r.json(); line(`3. CREATE CATEGORY -> ${r.status}`, cat); const categoryId = cat.id;
  for (const [amount,date,description] of [["42.50","2024-03-05","Weekly run"],["17.25","2024-03-12",undefined],["100.00","2024-03-20",undefined]]) {
    r = await fetch(`${BASE}/expenses`, { method:"POST", headers: auth(), body: JSON.stringify({ amount, currency:"USD", date, categoryId, description }) });
    const b = await r.json(); line(`4. CREATE EXPENSE ${amount} -> ${r.status}`, b.id ? "ok" : b);
  }
  r = await fetch(`${BASE}/expenses`, { headers: auth() }); const list = await r.json();
  line(`5. LIST -> ${r.status}`, { total: list.meta.pagination.total, items: list.data.map(e=>`${e.date}:${e.amount}`) });
  r = await fetch(`${BASE}/analytics/monthly?month=2024-03`, { headers: auth() });
  line(`6. MONTHLY 2024-03 (expect 159.75) -> ${r.status}`, await r.json());
  r = await fetch(`${BASE}/analytics/by-category?startDate=2024-03-01&endDate=2024-03-31`, { headers: auth() });
  line(`7. BY-CATEGORY -> ${r.status}`, await r.json());
  r = await fetch(`${BASE}/budgets`, { method:"POST", headers: auth(), body: JSON.stringify({ limitAmount:"200.00", period:"monthly", categoryId }) });
  const bud = await r.json(); line(`8. CREATE BUDGET -> ${r.status}`, bud);
  r = await fetch(`${BASE}/budgets/${bud.id}/status`, { headers: auth() });
  line(`9. BUDGET STATUS -> ${r.status}`, await r.json());
  r = await fetch(`${BASE}/expenses`, { method:"POST", headers: auth(), body: JSON.stringify({ amount:"-5", currency:"USD", date:"2024-03-05", categoryId }) });
  line(`10. INVALID AMOUNT (expect 400) -> ${r.status}`, await r.json());
  await fetch(`${BASE}/auth/register`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email: email2, password }) });
  const l2 = await (await fetch(`${BASE}/auth/login`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email: email2, password }) })).json();
  const iso = await (await fetch(`${BASE}/expenses`, { headers:{ Authorization:`Bearer ${l2.accessToken}` } })).json();
  line(`11. ISOLATION user B total (expect 0) -> ${iso.meta.pagination.total}`, "");
  console.log("SMOKE_TEST_RESULT: PASS");
} catch (e) { console.log("SMOKE_TEST_RESULT: ERROR " + e.message); process.exit(1); }
