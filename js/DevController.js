/* =====================================================================
   DevController.js
   -----------------------------------------------------------------
   Responsável pela "Gestão do Painel Dev":
     - dev.html       (login do desenvolvedor)
     - iniciodev.html (métricas por usuário & logs do sistema)

   Dados no Firestore:
     devs/{uid}                       → quem tem acesso dev (campo livre, ex: role)
     users/{uid}                      → name, email
     users/{uid}/dashboard/summary    → stats, weeklyCalories (mesmo doc do dashboard)
     logs/{logId}                     → createdAt, method, endpoint, status, payload

   Como o painel exibe dados escritos pelos próprios usuários (nome,
   stats), todo texto é inserido com textContent — nunca innerHTML.
   ===================================================================== */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, loginDev, requireDev } from "./AuthService.js";
import { baseBarOptions, charts } from "./DashboardController.js";

/* =====================================================================
   PÁGINA: LOGIN DEV (dev.html)
   ===================================================================== */
function friendlyLoginError(err) {
  switch (err?.code) {
    case "vita/not-dev":
      return err.message;
    case "auth/too-many-requests":
      return "Muitas tentativas. Aguarde um pouco e tente novamente.";
    case "permission-denied":
      return "Sem permissão para verificar o acesso dev. Confira as regras do Firestore.";
    default:
      return "E-mail ou senha inválidos. Tente novamente.";
  }
}

export function initDevLoginForm() {
  const form = document.getElementById("dev-login-form");
  if (!form) return;

  const errorEl = document.getElementById("login-error");
  const passwordInput = document.getElementById("dev-password");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";

    const submitBtn = form.querySelector("button[type='submit']");
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Entrando...";

    try {
      await loginDev(
        document.getElementById("dev-email").value,
        passwordInput.value
      );
      window.location.href = "iniciodev.html";
    } catch (err) {
      console.error("Falha no login dev:", err);
      errorEl.textContent = friendlyLoginError(err);
      errorEl.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

/* =====================================================================
   PÁGINA: PAINEL DEV (iniciodev.html)
   ===================================================================== */
const CHART_COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#f97316"];
const EVENTS_LIMIT = 20;

/* ---------------------------------------------------------------------
   DADOS
--------------------------------------------------------------------- */
function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") return Number(v.replace(",", ".")) || 0;
  return 0;
}

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// O app Android grava `nome`; o web antigo usava `name`. Aceita ambos.
async function fetchDevUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs
    .map((d) => {
      const data = d.data();
      const name = data.nome || data.name || data.email || d.id;
      return { id: d.id, name: data.email && name !== data.email ? `${name} (${data.email})` : name };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Calcula as métricas a partir dos dados reais do Android:
// users/{uid}, users/{uid}/refeicoes e users/{uid}/agua.
async function fetchUserSummary(userId) {
  const [profileSnap, mealsSnap, waterSnap] = await Promise.all([
    getDoc(doc(db, "users", userId)),
    getDocs(collection(db, "users", userId, "refeicoes")),
    getDocs(collection(db, "users", userId, "agua")),
  ]);

  const profile = profileSnap.exists() ? profileSnap.data() : {};
  const meals = mealsSnap.docs.map((d) => d.data());
  const water = waterSnap.docs.map((d) => d.data());

  const mealCalories = (m) =>
    m.total_calorias !== undefined
      ? toNumber(m.total_calorias)
      : (Array.isArray(m.alimentos) ? m.alimentos : []).reduce((t, f) => t + toNumber(f.calorias), 0);

  const today = new Date();
  const todayMeals = meals.filter((m) => { const d = toDate(m.data); return d && sameDay(d, today); });
  const todayWater = water
    .filter((w) => { const d = toDate(w.data); return d && sameDay(d, today); })
    .reduce((t, w) => t + toNumber(w.quantidade_ml ?? w.quantidadeMl), 0);

  const sum = (key) => todayMeals.reduce((t, m) => t + toNumber(m[key]), 0);

  const labels = [];
  const values = [];
  for (let off = 6; off >= 0; off--) {
    const day = new Date();
    day.setDate(day.getDate() - off);
    labels.push(new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(day));
    values.push(Math.round(meals.reduce((t, m) => {
      const d = toDate(m.data);
      return d && sameDay(d, day) ? t + mealCalories(m) : t;
    }, 0)));
  }

  return {
    hasData: profileSnap.exists() || meals.length > 0 || water.length > 0,
    stats: [
      { label: "Calorias hoje", value: `${Math.round(todayMeals.reduce((t, m) => t + mealCalories(m), 0))} kcal` },
      { label: "Proteínas hoje", value: `${Math.round(sum("total_proteinas"))} g` },
      { label: "Carboidratos hoje", value: `${Math.round(sum("total_carboidratos"))} g` },
      { label: "Água hoje", value: `${Math.round(todayWater)} ml` },
      { label: "Refeições registradas", value: String(meals.length) },
      { label: "Peso atual", value: profile.peso ? `${profile.peso} kg` : "--" },
    ],
    weeklyCalories: {
      labels,
      values,
      colors: labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
    },
  };
}

function formatEventTime(createdAt) {
  const d = createdAt?.toDate ? createdAt.toDate() : createdAt ? new Date(createdAt) : null;
  if (!d || Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString("pt-BR", { hour12: false });
}

async function fetchRecentEvents() {
  const q = query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(EVENTS_LIMIT));
  const snap = await getDocs(q);

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      time: formatEventTime(data.createdAt),
      method: data.method ?? "",
      endpoint: data.endpoint ?? "",
      status: Number(data.status) || 0,
      payload: data.payload ?? null,
    };
  });
}

/* ---------------------------------------------------------------------
   RENDER
--------------------------------------------------------------------- */
function renderDevUserSelect(users, selectedId) {
  const select = document.getElementById("user-select");
  select.replaceChildren();

  users.forEach((u) => {
    const option = document.createElement("option");
    option.value = u.id;
    option.textContent = u.name;
    option.selected = u.id === selectedId;
    select.appendChild(option);
  });
}

function renderDevUserId(userId) {
  document.getElementById("user-id-label").textContent = `ID: ${userId ?? "--"}`;
}

function renderDevStats(stats) {
  const grid = document.getElementById("dev-stat-grid");
  grid.replaceChildren();

  if (!stats) {
    const msg = document.createElement("p");
    msg.className = "dev-subtitle";
    msg.textContent = "Este usuário ainda não tem dados de dashboard.";
    grid.appendChild(msg);
    return;
  }

  stats.forEach((s) => {
    const card = document.createElement("div");
    card.className = "dev-stat-card";

    const label = document.createElement("div");
    label.className = "dev-stat-label";
    label.textContent = s.label;

    const value = document.createElement("div");
    value.className = "dev-stat-value";
    value.textContent = s.value;

    card.append(label, value);
    grid.appendChild(card);
  });
}

function renderDevChart(data) {
  const ctx = document.getElementById("chart-dev-calorias");
  if (charts.devCalorias) charts.devCalorias.destroy();

  const weekly = data ?? { labels: [], values: [], colors: [] };

  charts.devCalorias = new Chart(ctx, {
    type: "bar",
    data: {
      labels: weekly.labels,
      datasets: [{ data: weekly.values, backgroundColor: weekly.colors, borderRadius: 6, barThickness: 34 }],
    },
    options: baseBarOptions(false),
  });
}

function renderDevEvents(events) {
  const body = document.getElementById("events-table-body");
  body.replaceChildren();

  if (!events.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "Nenhum evento registrado ainda.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  events.forEach((e) => {
    const row = document.createElement("tr");

    const cells = [e.time, e.method, e.endpoint, String(e.status)].map((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      return td;
    });
    cells[2].className = "endpoint";
    cells[3].className = e.status >= 200 && e.status < 300 ? "status-ok" : "status-error";

    const actionCell = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "ver-json-btn";
    btn.textContent = "Ver JSON";
    btn.addEventListener("click", () => {
      alert(JSON.stringify(e.payload ?? { id: e.id, method: e.method, endpoint: e.endpoint, status: e.status }, null, 2));
    });
    actionCell.appendChild(btn);

    row.append(...cells, actionCell);
    body.appendChild(row);
  });
}

function showDevError(message) {
  const page = document.getElementById("dev-page");
  const msg = document.createElement("p");
  msg.className = "data-error";
  msg.textContent = message;
  page.prepend(msg);
}

/* ---------------------------------------------------------------------
   BOOTSTRAP
--------------------------------------------------------------------- */
async function loadDevUser(userId) {
  renderDevUserId(userId);
  document.querySelectorAll("#dev-page .data-error").forEach((el) => el.remove());

  try {
    const summary = await fetchUserSummary(userId);
    renderDevStats(summary.hasData ? summary.stats : null);
    renderDevChart(summary.weeklyCalories);
  } catch (err) {
    console.error("Erro ao carregar dados do usuário:", err);
    showDevError(
      err?.code === "permission-denied"
        ? "Sem permissão para ler os dados deste usuário. Publique o firestore.rules atualizado."
        : "Não foi possível carregar os dados deste usuário."
    );
  }
}

export async function initDevDashboard() {
  const user = await requireDev();
  if (!user) return;

  // Usuários e logs carregam separadamente: se um falhar (ex.: regra de
  // `logs` ausente), o outro continua funcionando.
  const [usersResult, eventsResult] = await Promise.allSettled([fetchDevUsers(), fetchRecentEvents()]);

  if (eventsResult.status === "fulfilled") {
    renderDevEvents(eventsResult.value);
  } else {
    console.error("Erro ao carregar logs:", eventsResult.reason);
    renderDevEvents([]);
    if (eventsResult.reason?.code === "permission-denied") {
      showDevError("Sem permissão para ler a coleção `logs`. Publique o firestore.rules atualizado.");
    }
  }

  if (usersResult.status === "rejected") {
    console.error("Erro ao carregar usuários:", usersResult.reason);
    renderDevUserSelect([], null);
    renderDevUserId(null);
    renderDevStats(null);
    renderDevChart(null);
    showDevError(
      usersResult.reason?.code === "permission-denied"
        ? "Sem permissão para listar usuários. Publique o firestore.rules atualizado no Firebase."
        : "Não foi possível carregar os usuários. Tente novamente mais tarde."
    );
    return;
  }

  const users = usersResult.value;
  if (!users.length) {
    renderDevUserSelect([], null);
    renderDevUserId(null);
    renderDevStats(null);
    renderDevChart(null);
    return;
  }

  renderDevUserSelect(users, users[0].id);
  await loadDevUser(users[0].id);

  document.getElementById("user-select").addEventListener("change", (e) => {
    loadDevUser(e.target.value);
  });
}
